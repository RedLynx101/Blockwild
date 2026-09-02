import { persistencePayloadHashV1 } from "./persistence-journal-contract";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import { encodeCanonicalWorldSaveValueV1 } from "./world-save-sharding";

export const RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1 = 1 as const;
export const RICH_SAVE_MIGRATION_MAX_SOURCE_BYTES_V1 = 64 * 1024 * 1024;
export const RICH_SAVE_MIGRATION_MAX_PAGE_BYTES_V1 = 4 * 1024 * 1024;
export const RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1 = 256 * 1024 * 1024;
export const RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1 = 4_096;
export const RICH_SAVE_MIGRATION_MAX_DOMAINS_V1 = 256;
export const RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1 = 4_096;
export const RICH_SAVE_MIGRATION_MAX_TOTAL_PAGES_V1 = 16_384;

const ENVELOPE_MAGIC_V1 = Uint8Array.of(0x42, 0x57, 0x52, 0x4d); // BWRM
const MAX_ENCODED_ENVELOPE_BYTES_V1 = RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1 + 16 * 1024 * 1024;
const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const DOMAIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type RichSaveMigrationSourceV1 = Readonly<{
  sourceKey: string;
  sourceFormat: string;
  saveVersion: number;
  byteLength: number;
  semanticHash: string;
}>;

export type RichSaveMigrationTargetV1 = Readonly<{
  universeId: string;
  locationId: string;
  generatorHash: string;
  contentHash: string;
}>;

export type RichSaveMigrationPageV1 = Readonly<{
  schemaVersion: typeof RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1;
  universeId: string;
  locationId: string;
  sourceSemanticHash: string;
  domainId: string;
  codecVersion: number;
  pageIndex: number;
  pageCount: number;
  itemStart: number;
  itemCount: number;
  byteLength: number;
  payloadHash: string;
  pageHash: string;
  payload: Uint8Array;
}>;

export type RichSaveMigrationDomainV1 = Readonly<{
  domainId: string;
  codecVersion: number;
  properties: readonly string[];
  pageCount: number;
  itemCount: number;
  byteLength: number;
  pages: readonly RichSaveMigrationPageV1[];
  semanticRoot: string;
}>;

export type RichSaveMigrationEnvelopeV1 = Readonly<{
  schemaVersion: typeof RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1;
  source: RichSaveMigrationSourceV1;
  target: RichSaveMigrationTargetV1;
  sourceProperties: readonly string[];
  domains: readonly RichSaveMigrationDomainV1[];
  totalPageCount: number;
  totalPageBytes: number;
  envelopeRoot: string;
}>;

export type RichSaveMigrationPageInputV1 = Readonly<{
  pageIndex: number;
  itemStart: number;
  itemCount: number;
  payload: Uint8Array;
}>;

export type RichSaveMigrationDomainInputV1 = Readonly<{
  domainId: string;
  codecVersion: number;
  properties: readonly string[];
  pages: readonly RichSaveMigrationPageInputV1[];
}>;

export type RichSaveMigrationEnvelopeInputV1 = Readonly<{
  source: Readonly<{
    sourceKey: string;
    sourceFormat: string;
    saveVersion: number;
    payload: Uint8Array;
  }>;
  target: RichSaveMigrationTargetV1;
  domains: readonly RichSaveMigrationDomainInputV1[];
}>;

export type RichSaveMigrationEnvelopeExpectationV1 = Readonly<{
  envelopeRoot?: string;
  universeId?: string;
  locationId?: string;
  generatorHash?: string;
  contentHash?: string;
  sourceKey?: string;
  sourceFormat?: string;
  sourceSaveVersion?: number;
  sourcePayload?: Uint8Array;
}>;

export class RichSaveMigrationEnvelopeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RichSaveMigrationEnvelopeError";
  }
}

function fail(code: string, message: string): never {
  throw new RichSaveMigrationEnvelopeError(code, message);
}

function compareOrdinal(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function integer(value: unknown, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail("integer-range", `${label} must be a safe integer in ${minimum}..${maximum}`);
  }
  return value as number;
}

function hash(value: unknown, label: string) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) fail("hash", `${label} must be a lowercase 128-bit hash`);
  return value;
}

function stringLabel(value: unknown, label: string, maximumBytes: number, pattern?: RegExp) {
  if (typeof value !== "string" || value.length < 1) fail("label", `${label} must be a non-empty string`);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0x20 || unit === 0x7f) fail("label", `${label} cannot contain control characters`);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail("label", `${label} cannot contain an unpaired surrogate`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail("label", `${label} cannot contain an unpaired surrogate`);
  }
  if (encoder.encode(value).byteLength > maximumBytes) fail("label", `${label} exceeds ${maximumBytes} UTF-8 bytes`);
  if (pattern && !pattern.test(value)) fail("label", `${label} has a non-canonical form`);
  return value;
}

function plainRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("shape", `${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("shape", `${label} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort(compareOrdinal);
  const canonical = [...expected].sort(compareOrdinal);
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    fail("shape", `${label} does not have the exact V1 field set`);
  }
}

function orderedUniqueStrings(
  value: unknown,
  label: string,
  maximumCount: number,
  duplicateCode: string,
  orderCode: string,
) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumCount) {
    fail("collection-size", `${label} requires 1..${maximumCount} entries`);
  }
  const seen = new Set<string>();
  let prior: string | null = null;
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = stringLabel(value[index], `${label}[${index}]`, 256);
    if (seen.has(entry)) fail(duplicateCode, `${label} contains duplicate ${entry}`);
    if (prior !== null && compareOrdinal(prior, entry) >= 0) fail(orderCode, `${label} must be strictly ordinal-sorted`);
    seen.add(entry);
    prior = entry;
    result.push(entry);
  }
  return result;
}

function deriveSourceProperties(payload: Uint8Array) {
  if (!(payload instanceof Uint8Array)
    || payload.byteLength < 1
    || payload.byteLength > RICH_SAVE_MIGRATION_MAX_SOURCE_BYTES_V1) {
    fail("source-size", `canonical source must contain 1..${RICH_SAVE_MIGRATION_MAX_SOURCE_BYTES_V1} bytes`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(payload)); }
  catch { fail("source-json", "source payload is not valid UTF-8 canonical JSON"); }
  const source = plainRecord(parsed, "source payload");
  const canonical = encodeCanonicalWorldSaveValueV1(source);
  if (!equalBytes(canonical, payload)) fail("source-canonical", "source payload is not canonical WorldSave JSON");
  const properties = Object.keys(source).sort(compareOrdinal);
  if (properties.length < 1 || properties.length > RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1) {
    fail("source-properties", `source requires 1..${RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1} top-level properties`);
  }
  for (let index = 0; index < properties.length; index += 1) {
    stringLabel(properties[index], `source property ${index}`, 256);
  }
  return Object.freeze(properties);
}

function assertPropertyAccounting(
  sourceProperties: readonly string[],
  domains: readonly Pick<RichSaveMigrationDomainV1, "domainId" | "properties">[],
) {
  const source = new Set(sourceProperties);
  const owners = new Map<string, string>();
  for (const domain of domains) for (const property of domain.properties) {
    if (!source.has(property)) fail("unknown-property", `domain ${domain.domainId} owns non-source property ${property}`);
    const owner = owners.get(property);
    if (owner) fail("multiply-owned-property", `source property ${property} is owned by both ${owner} and ${domain.domainId}`);
    owners.set(property, domain.domainId);
  }
  for (const property of sourceProperties) {
    if (!owners.has(property)) fail("missing-property", `source property ${property} has no migration domain owner`);
  }
}

export function richSaveMigrationPageHashV1(
  page: Omit<RichSaveMigrationPageV1, "pageHash" | "payload">,
) {
  return new TypeScriptCanonicalHasher("blockwild-rich-save-migration-page-v1")
    .writeU16(page.schemaVersion)
    .writeString(page.universeId)
    .writeString(page.locationId)
    .writeString(page.sourceSemanticHash)
    .writeString(page.domainId)
    .writeU16(page.codecVersion)
    .writeU32(page.pageIndex)
    .writeU32(page.pageCount)
    .writeU64(page.itemStart)
    .writeU64(page.itemCount)
    .writeU32(page.byteLength)
    .writeString(page.payloadHash)
    .finishHex();
}

export function richSaveMigrationDomainRootV1(
  domain: Omit<RichSaveMigrationDomainV1, "semanticRoot">,
) {
  const hasher = new TypeScriptCanonicalHasher("blockwild-rich-save-migration-domain-v1")
    .writeString(domain.domainId)
    .writeU16(domain.codecVersion)
    .writeU32(domain.properties.length);
  for (const property of domain.properties) hasher.writeString(property);
  hasher.writeU32(domain.pageCount).writeU64(domain.itemCount).writeU64(domain.byteLength);
  for (const page of domain.pages) hasher.writeString(page.pageHash);
  return hasher.finishHex();
}

export function richSaveMigrationEnvelopeRootV1(
  envelope: Omit<RichSaveMigrationEnvelopeV1, "envelopeRoot">,
) {
  const hasher = new TypeScriptCanonicalHasher("blockwild-rich-save-migration-envelope-v1")
    .writeU16(envelope.schemaVersion)
    .writeString(envelope.source.sourceKey)
    .writeString(envelope.source.sourceFormat)
    .writeU16(envelope.source.saveVersion)
    .writeU64(envelope.source.byteLength)
    .writeString(envelope.source.semanticHash)
    .writeString(envelope.target.universeId)
    .writeString(envelope.target.locationId)
    .writeString(envelope.target.generatorHash)
    .writeString(envelope.target.contentHash)
    .writeU32(envelope.sourceProperties.length);
  for (const property of envelope.sourceProperties) hasher.writeString(property);
  hasher.writeU32(envelope.domains.length);
  for (const domain of envelope.domains) {
    hasher.writeString(domain.domainId)
      .writeU16(domain.codecVersion)
      .writeU32(domain.pageCount)
      .writeU64(domain.itemCount)
      .writeU64(domain.byteLength)
      .writeString(domain.semanticRoot);
  }
  return hasher.writeU32(envelope.totalPageCount).writeU64(envelope.totalPageBytes).finishHex();
}

function freezePage(page: RichSaveMigrationPageV1) {
  return Object.freeze({ ...page, payload: Uint8Array.from(page.payload) }) satisfies RichSaveMigrationPageV1;
}

function freezeDomain(domain: RichSaveMigrationDomainV1) {
  return Object.freeze({
    ...domain,
    properties: Object.freeze([...domain.properties]),
    pages: Object.freeze(domain.pages.map(freezePage)),
  }) satisfies RichSaveMigrationDomainV1;
}

function freezeEnvelope(envelope: RichSaveMigrationEnvelopeV1) {
  return Object.freeze({
    ...envelope,
    source: Object.freeze({ ...envelope.source }),
    target: Object.freeze({ ...envelope.target }),
    sourceProperties: Object.freeze([...envelope.sourceProperties]),
    domains: Object.freeze(envelope.domains.map(freezeDomain)),
  }) satisfies RichSaveMigrationEnvelopeV1;
}

export function createRichSaveMigrationEnvelopeV1(input: RichSaveMigrationEnvelopeInputV1) {
  const sourcePayload = input.source?.payload;
  const sourceProperties = deriveSourceProperties(sourcePayload);
  const source: RichSaveMigrationSourceV1 = Object.freeze({
    sourceKey: stringLabel(input.source.sourceKey, "source.sourceKey", 512),
    sourceFormat: stringLabel(input.source.sourceFormat, "source.sourceFormat", 128),
    saveVersion: integer(input.source.saveVersion, 1, 0xffff, "source.saveVersion"),
    byteLength: sourcePayload.byteLength,
    semanticHash: persistencePayloadHashV1(sourcePayload),
  });
  const target: RichSaveMigrationTargetV1 = Object.freeze({
    universeId: stringLabel(input.target?.universeId, "target.universeId", 64),
    locationId: stringLabel(input.target?.locationId, "target.locationId", 128),
    generatorHash: hash(input.target?.generatorHash, "target.generatorHash"),
    contentHash: hash(input.target?.contentHash, "target.contentHash"),
  });
  if (!Array.isArray(input.domains) || input.domains.length < 1 || input.domains.length > RICH_SAVE_MIGRATION_MAX_DOMAINS_V1) {
    fail("domain-count", `envelope requires 1..${RICH_SAVE_MIGRATION_MAX_DOMAINS_V1} domains`);
  }
  const domainIds = new Set<string>();
  const domains = input.domains.map((candidate, inputIndex) => {
    const domainId = stringLabel(candidate?.domainId, `domains[${inputIndex}].domainId`, 128, DOMAIN_ID_PATTERN);
    if (domainIds.has(domainId)) fail("duplicate-domain", `envelope contains duplicate domain ${domainId}`);
    domainIds.add(domainId);
    const codecVersion = integer(candidate.codecVersion, 1, 0xffff, `${domainId}.codecVersion`);
    if (!Array.isArray(candidate.properties) || candidate.properties.length < 1
      || candidate.properties.length > RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1) {
      fail("collection-size", `domain ${domainId} must own at least one bounded source property`);
    }
    const properties = candidate.properties.map((property: unknown, index: number) =>
      stringLabel(property, `${domainId}.properties[${index}]`, 256)).sort(compareOrdinal);
    for (let index = 1; index < properties.length; index += 1) {
      if (properties[index - 1] === properties[index]) fail("duplicate-property", `domain ${domainId} repeats property ${properties[index]}`);
    }
    if (!Array.isArray(candidate.pages) || candidate.pages.length < 1
      || candidate.pages.length > RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1) {
      fail("page-count", `domain ${domainId} requires 1..${RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1} pages`);
    }
    const pageInputs = [...candidate.pages].sort((left, right) => left.pageIndex - right.pageIndex);
    const pageIndices = new Set<number>();
    const pageCount = pageInputs.length;
    let expectedItemStart = 0;
    let byteLength = 0;
    const pages = pageInputs.map((page, pageIndex) => {
      const declaredIndex = integer(page?.pageIndex, 0, RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1 - 1, `${domainId}.pageIndex`);
      if (pageIndices.has(declaredIndex)) fail("duplicate-page", `domain ${domainId} repeats page ${declaredIndex}`);
      pageIndices.add(declaredIndex);
      if (declaredIndex !== pageIndex) fail("omitted-page", `domain ${domainId} omits page ${pageIndex}`);
      const itemStart = integer(page.itemStart, 0, Number.MAX_SAFE_INTEGER, `${domainId}.pages[${pageIndex}].itemStart`);
      const itemCount = integer(page.itemCount, 0, Number.MAX_SAFE_INTEGER, `${domainId}.pages[${pageIndex}].itemCount`);
      if (itemStart !== expectedItemStart) fail("item-range", `domain ${domainId} page ${pageIndex} does not continue the prior item range`);
      if (itemCount > Number.MAX_SAFE_INTEGER - itemStart) fail("item-range", `domain ${domainId} item range overflows JavaScript's exact range`);
      expectedItemStart += itemCount;
      if (!(page.payload instanceof Uint8Array) || page.payload.byteLength > RICH_SAVE_MIGRATION_MAX_PAGE_BYTES_V1) {
        fail("page-size", `domain ${domainId} page ${pageIndex} exceeds its byte budget`);
      }
      if (byteLength > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1 - page.payload.byteLength) {
        fail("page-size", `domain ${domainId} exceeds the total page byte budget`);
      }
      byteLength += page.payload.byteLength;
      const payload = Uint8Array.from(page.payload);
      const withoutHash = {
        schemaVersion: RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1,
        universeId: target.universeId,
        locationId: target.locationId,
        sourceSemanticHash: source.semanticHash,
        domainId,
        codecVersion,
        pageIndex,
        pageCount,
        itemStart,
        itemCount,
        byteLength: payload.byteLength,
        payloadHash: persistencePayloadHashV1(payload),
      } as const;
      return Object.freeze({ ...withoutHash, pageHash: richSaveMigrationPageHashV1(withoutHash), payload }) satisfies RichSaveMigrationPageV1;
    });
    const withoutRoot = {
      domainId,
      codecVersion,
      properties: Object.freeze(properties),
      pageCount,
      itemCount: expectedItemStart,
      byteLength,
      pages: Object.freeze(pages),
    } as const;
    return Object.freeze({ ...withoutRoot, semanticRoot: richSaveMigrationDomainRootV1(withoutRoot) }) satisfies RichSaveMigrationDomainV1;
  }).sort((left, right) => compareOrdinal(left.domainId, right.domainId));
  assertPropertyAccounting(sourceProperties, domains);
  const totalPageCount = domains.reduce((total, domain) => total + domain.pageCount, 0);
  if (totalPageCount > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGES_V1) fail("page-count", "envelope exceeds its total page count budget");
  const totalPageBytes = domains.reduce((total, domain) => total + domain.byteLength, 0);
  if (totalPageBytes > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1) fail("page-size", "envelope exceeds its total page byte budget");
  const withoutRoot = {
    schemaVersion: RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1,
    source,
    target,
    sourceProperties,
    domains: Object.freeze(domains),
    totalPageCount,
    totalPageBytes,
  } as const;
  return freezeEnvelope(Object.freeze({ ...withoutRoot, envelopeRoot: richSaveMigrationEnvelopeRootV1(withoutRoot) }));
}

function assertExpectation(envelope: RichSaveMigrationEnvelopeV1, expected: RichSaveMigrationEnvelopeExpectationV1) {
  if (expected.envelopeRoot !== undefined
    && hash(expected.envelopeRoot, "expected.envelopeRoot") !== envelope.envelopeRoot) {
    fail("expected-root", "envelope root does not match the expected migration root");
  }
  const comparisons = [
    ["universeId", expected.universeId, envelope.target.universeId],
    ["locationId", expected.locationId, envelope.target.locationId],
    ["generatorHash", expected.generatorHash, envelope.target.generatorHash],
    ["contentHash", expected.contentHash, envelope.target.contentHash],
    ["sourceKey", expected.sourceKey, envelope.source.sourceKey],
    ["sourceFormat", expected.sourceFormat, envelope.source.sourceFormat],
  ] as const;
  for (const [label, wanted, actual] of comparisons) {
    if (wanted !== undefined && wanted !== actual) fail("expected-identity", `envelope ${label} does not match the expected identity`);
  }
  if (expected.sourceSaveVersion !== undefined
    && integer(expected.sourceSaveVersion, 1, 0xffff, "expected.sourceSaveVersion") !== envelope.source.saveVersion) {
    fail("expected-identity", "envelope source save version does not match the expected identity");
  }
  if (expected.sourcePayload !== undefined) {
    const properties = deriveSourceProperties(expected.sourcePayload);
    if (expected.sourcePayload.byteLength !== envelope.source.byteLength
      || persistencePayloadHashV1(expected.sourcePayload) !== envelope.source.semanticHash) {
      fail("expected-source", "envelope source provenance does not match the expected canonical source bytes");
    }
    if (properties.length !== envelope.sourceProperties.length
      || properties.some((property, index) => property !== envelope.sourceProperties[index])) {
      fail("expected-source", "envelope property accounting does not match the expected canonical source bytes");
    }
  }
}

export function assertRichSaveMigrationEnvelopeV1(
  value: unknown,
  expected: RichSaveMigrationEnvelopeExpectationV1 = {},
): asserts value is RichSaveMigrationEnvelopeV1 {
  const envelope = plainRecord(value, "envelope");
  exactKeys(envelope, ["schemaVersion", "source", "target", "sourceProperties", "domains", "totalPageCount", "totalPageBytes", "envelopeRoot"], "envelope");
  if (envelope.schemaVersion !== RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1) fail("schema-version", "rich-save envelope schema is unsupported");

  const source = plainRecord(envelope.source, "envelope.source");
  exactKeys(source, ["sourceKey", "sourceFormat", "saveVersion", "byteLength", "semanticHash"], "envelope.source");
  const normalizedSource: RichSaveMigrationSourceV1 = {
    sourceKey: stringLabel(source.sourceKey, "source.sourceKey", 512),
    sourceFormat: stringLabel(source.sourceFormat, "source.sourceFormat", 128),
    saveVersion: integer(source.saveVersion, 1, 0xffff, "source.saveVersion"),
    byteLength: integer(source.byteLength, 1, RICH_SAVE_MIGRATION_MAX_SOURCE_BYTES_V1, "source.byteLength"),
    semanticHash: hash(source.semanticHash, "source.semanticHash"),
  };
  const target = plainRecord(envelope.target, "envelope.target");
  exactKeys(target, ["universeId", "locationId", "generatorHash", "contentHash"], "envelope.target");
  const normalizedTarget: RichSaveMigrationTargetV1 = {
    universeId: stringLabel(target.universeId, "target.universeId", 64),
    locationId: stringLabel(target.locationId, "target.locationId", 128),
    generatorHash: hash(target.generatorHash, "target.generatorHash"),
    contentHash: hash(target.contentHash, "target.contentHash"),
  };
  const sourceProperties = orderedUniqueStrings(
    envelope.sourceProperties,
    "sourceProperties",
    RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1,
    "duplicate-source-property",
    "source-property-order",
  );

  if (!Array.isArray(envelope.domains) || envelope.domains.length < 1
    || envelope.domains.length > RICH_SAVE_MIGRATION_MAX_DOMAINS_V1) {
    fail("domain-count", `envelope requires 1..${RICH_SAVE_MIGRATION_MAX_DOMAINS_V1} domains`);
  }
  const domainIds = new Set<string>();
  let priorDomain: string | null = null;
  let totalPageCount = 0;
  let totalPageBytes = 0;
  const normalizedDomains: RichSaveMigrationDomainV1[] = [];
  for (let domainIndex = 0; domainIndex < envelope.domains.length; domainIndex += 1) {
    const domain = plainRecord(envelope.domains[domainIndex], `domains[${domainIndex}]`);
    exactKeys(domain, ["domainId", "codecVersion", "properties", "pageCount", "itemCount", "byteLength", "pages", "semanticRoot"], `domains[${domainIndex}]`);
    const domainId = stringLabel(domain.domainId, `domains[${domainIndex}].domainId`, 128, DOMAIN_ID_PATTERN);
    if (domainIds.has(domainId)) fail("duplicate-domain", `envelope contains duplicate domain ${domainId}`);
    if (priorDomain !== null && compareOrdinal(priorDomain, domainId) >= 0) fail("domain-order", "domains must be strictly ordinal-sorted");
    domainIds.add(domainId);
    priorDomain = domainId;
    const codecVersion = integer(domain.codecVersion, 1, 0xffff, `${domainId}.codecVersion`);
    const properties = orderedUniqueStrings(
      domain.properties,
      `${domainId}.properties`,
      RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1,
      "duplicate-property",
      "property-order",
    );
    const pageCount = integer(domain.pageCount, 1, RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1, `${domainId}.pageCount`);
    const itemCount = integer(domain.itemCount, 0, Number.MAX_SAFE_INTEGER, `${domainId}.itemCount`);
    const byteLength = integer(domain.byteLength, 0, RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1, `${domainId}.byteLength`);
    if (!Array.isArray(domain.pages) || domain.pages.length !== pageCount) fail("omitted-page", `domain ${domainId} page count is incomplete`);
    let expectedItemStart = 0;
    let observedBytes = 0;
    const pageIndices = new Set<number>();
    const pages: RichSaveMigrationPageV1[] = [];
    for (let pageIndex = 0; pageIndex < domain.pages.length; pageIndex += 1) {
      const page = plainRecord(domain.pages[pageIndex], `${domainId}.pages[${pageIndex}]`);
      exactKeys(page, ["schemaVersion", "universeId", "locationId", "sourceSemanticHash", "domainId", "codecVersion", "pageIndex", "pageCount", "itemStart", "itemCount", "byteLength", "payloadHash", "pageHash", "payload"], `${domainId}.pages[${pageIndex}]`);
      if (page.schemaVersion !== RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1) fail("page-schema", `domain ${domainId} page ${pageIndex} has an unsupported schema`);
      const declaredIndex = integer(page.pageIndex, 0, RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1 - 1, `${domainId}.pages[${pageIndex}].pageIndex`);
      if (pageIndices.has(declaredIndex)) fail("duplicate-page", `domain ${domainId} repeats page ${declaredIndex}`);
      pageIndices.add(declaredIndex);
      if (declaredIndex !== pageIndex) fail("page-order", `domain ${domainId} pages must be contiguous and index ordered`);
      if (page.pageCount !== pageCount) fail("page-count", `domain ${domainId} page ${pageIndex} has the wrong page count`);
      if (page.universeId !== normalizedTarget.universeId || page.locationId !== normalizedTarget.locationId) {
        fail("page-address", `domain ${domainId} page ${pageIndex} belongs to another world`);
      }
      if (page.sourceSemanticHash !== normalizedSource.semanticHash) fail("page-source", `domain ${domainId} page ${pageIndex} belongs to another source`);
      if (page.domainId !== domainId || page.codecVersion !== codecVersion) fail("page-domain", `domain ${domainId} page ${pageIndex} has the wrong codec identity`);
      const pageItemStart = integer(page.itemStart, 0, Number.MAX_SAFE_INTEGER, `${domainId}.pages[${pageIndex}].itemStart`);
      const pageItemCount = integer(page.itemCount, 0, Number.MAX_SAFE_INTEGER, `${domainId}.pages[${pageIndex}].itemCount`);
      if (pageItemStart !== expectedItemStart || pageItemCount > Number.MAX_SAFE_INTEGER - pageItemStart) {
        fail("item-range", `domain ${domainId} page ${pageIndex} has a non-contiguous item range`);
      }
      expectedItemStart += pageItemCount;
      const pageByteLength = integer(page.byteLength, 0, RICH_SAVE_MIGRATION_MAX_PAGE_BYTES_V1, `${domainId}.pages[${pageIndex}].byteLength`);
      if (!(page.payload instanceof Uint8Array) || page.payload.byteLength !== pageByteLength) {
        fail("page-length", `domain ${domainId} page ${pageIndex} payload length does not match its descriptor`);
      }
      const payloadHash = hash(page.payloadHash, `${domainId}.pages[${pageIndex}].payloadHash`);
      if (persistencePayloadHashV1(page.payload) !== payloadHash) fail("page-payload-hash", `domain ${domainId} page ${pageIndex} payload hash mismatch`);
      const normalizedPage = {
        schemaVersion: RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1,
        universeId: stringLabel(page.universeId, `${domainId}.pages[${pageIndex}].universeId`, 64),
        locationId: stringLabel(page.locationId, `${domainId}.pages[${pageIndex}].locationId`, 128),
        sourceSemanticHash: hash(page.sourceSemanticHash, `${domainId}.pages[${pageIndex}].sourceSemanticHash`),
        domainId: stringLabel(page.domainId, `${domainId}.pages[${pageIndex}].domainId`, 128, DOMAIN_ID_PATTERN),
        codecVersion: integer(page.codecVersion, 1, 0xffff, `${domainId}.pages[${pageIndex}].codecVersion`),
        pageIndex: declaredIndex,
        pageCount,
        itemStart: pageItemStart,
        itemCount: pageItemCount,
        byteLength: pageByteLength,
        payloadHash,
        pageHash: hash(page.pageHash, `${domainId}.pages[${pageIndex}].pageHash`),
        payload: page.payload,
      } satisfies RichSaveMigrationPageV1;
      if (richSaveMigrationPageHashV1(normalizedPage) !== normalizedPage.pageHash) {
        fail("page-hash", `domain ${domainId} page ${pageIndex} descriptor hash mismatch`);
      }
      observedBytes += pageByteLength;
      pages.push(normalizedPage);
    }
    if (expectedItemStart !== itemCount) fail("domain-item-count", `domain ${domainId} item total does not match its pages`);
    if (observedBytes !== byteLength) fail("domain-byte-length", `domain ${domainId} byte total does not match its pages`);
    const normalizedDomain = {
      domainId,
      codecVersion,
      properties,
      pageCount,
      itemCount,
      byteLength,
      pages,
      semanticRoot: hash(domain.semanticRoot, `${domainId}.semanticRoot`),
    } satisfies RichSaveMigrationDomainV1;
    if (richSaveMigrationDomainRootV1(normalizedDomain) !== normalizedDomain.semanticRoot) {
      fail("domain-root", `domain ${domainId} semantic root mismatch`);
    }
    totalPageCount += pageCount;
    totalPageBytes += byteLength;
    if (totalPageCount > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGES_V1) fail("page-count", "envelope exceeds its total page count budget");
    if (totalPageBytes > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1) fail("page-size", "envelope exceeds its total page byte budget");
    normalizedDomains.push(normalizedDomain);
  }
  assertPropertyAccounting(sourceProperties, normalizedDomains);
  if (integer(envelope.totalPageCount, 1, RICH_SAVE_MIGRATION_MAX_TOTAL_PAGES_V1, "envelope.totalPageCount") !== totalPageCount) {
    fail("page-count", "envelope total page count does not match its domains");
  }
  if (integer(envelope.totalPageBytes, 0, RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1, "envelope.totalPageBytes") !== totalPageBytes) {
    fail("page-size", "envelope total page bytes do not match its domains");
  }
  const envelopeRoot = hash(envelope.envelopeRoot, "envelope.envelopeRoot");
  const normalizedEnvelope = {
    schemaVersion: RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1,
    source: normalizedSource,
    target: normalizedTarget,
    sourceProperties,
    domains: normalizedDomains,
    totalPageCount,
    totalPageBytes,
  } as const;
  if (richSaveMigrationEnvelopeRootV1(normalizedEnvelope) !== envelopeRoot) fail("envelope-root", "envelope canonical root mismatch");
  assertExpectation({ ...normalizedEnvelope, envelopeRoot }, expected);
}

class Writer {
  private readonly chunks: Uint8Array[] = [];
  private byteLength = 0;

  raw(bytes: Uint8Array) { this.chunks.push(bytes); this.byteLength += bytes.byteLength; return this; }
  u16(value: number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return this.raw(bytes);
  }
  u32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return this.raw(bytes);
  }
  u64(value: number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
    return this.raw(bytes);
  }
  string(value: string) { const bytes = encoder.encode(value); return this.u16(bytes.byteLength).raw(bytes); }
  hash(value: string) {
    const bytes = new Uint8Array(16);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    return this.raw(bytes);
  }
  bytes(value: Uint8Array) { return this.u32(value.byteLength).raw(value); }
  finish() {
    const output = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const chunk of this.chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  }
}

class Reader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly input: Uint8Array) {
    this.view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  }

  take(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.input.byteLength - this.offset) {
      fail("truncated", "rich-save envelope is truncated");
    }
    const result = this.input.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
  u16() { const offset = this.offset; this.take(2); return this.view.getUint16(offset, true); }
  u32() { const offset = this.offset; this.take(4); return this.view.getUint32(offset, true); }
  u64(label: string) {
    const offset = this.offset;
    this.take(8);
    const value = this.view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("integer-range", `${label} exceeds JavaScript's exact integer range`);
    return Number(value);
  }
  string(label: string, maximumBytes: number, pattern?: RegExp) {
    const bytes = this.take(this.u16());
    if (bytes.byteLength > maximumBytes) fail("label", `${label} exceeds ${maximumBytes} UTF-8 bytes`);
    let value: string;
    try { value = decoder.decode(bytes); }
    catch { fail("utf8", `${label} is not valid UTF-8`); }
    if (!equalBytes(encoder.encode(value), bytes)) fail("utf8", `${label} is not canonical UTF-8`);
    return stringLabel(value, label, maximumBytes, pattern);
  }
  hash() { return [...this.take(16)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
  bytes(maximum: number) { const length = this.u32(); if (length > maximum) fail("page-size", "encoded page exceeds its byte budget"); return this.take(length); }
  finish() { if (this.offset !== this.input.byteLength) fail("trailing-bytes", "rich-save envelope contains trailing bytes"); }
}

export function encodeRichSaveMigrationEnvelopeV1(value: unknown) {
  assertRichSaveMigrationEnvelopeV1(value);
  const envelope = value;
  const writer = new Writer().raw(ENVELOPE_MAGIC_V1).u16(envelope.schemaVersion)
    .string(envelope.source.sourceKey).string(envelope.source.sourceFormat).u16(envelope.source.saveVersion)
    .u64(envelope.source.byteLength).hash(envelope.source.semanticHash)
    .string(envelope.target.universeId).string(envelope.target.locationId)
    .hash(envelope.target.generatorHash).hash(envelope.target.contentHash)
    .u32(envelope.sourceProperties.length);
  for (const property of envelope.sourceProperties) writer.string(property);
  writer.u32(envelope.domains.length);
  for (const domain of envelope.domains) {
    writer.string(domain.domainId).u16(domain.codecVersion).u32(domain.properties.length);
    for (const property of domain.properties) writer.string(property);
    writer.u32(domain.pageCount).u64(domain.itemCount).u64(domain.byteLength).hash(domain.semanticRoot);
    for (const page of domain.pages) {
      writer.u16(page.schemaVersion).string(page.universeId).string(page.locationId).hash(page.sourceSemanticHash)
        .string(page.domainId).u16(page.codecVersion).u32(page.pageIndex).u32(page.pageCount)
        .u64(page.itemStart).u64(page.itemCount).u32(page.byteLength)
        .hash(page.payloadHash).hash(page.pageHash).bytes(page.payload);
    }
  }
  const encoded = writer.u32(envelope.totalPageCount).u64(envelope.totalPageBytes).hash(envelope.envelopeRoot).finish();
  if (encoded.byteLength > MAX_ENCODED_ENVELOPE_BYTES_V1) fail("envelope-size", "encoded rich-save envelope exceeds its byte budget");
  return encoded;
}

export function decodeRichSaveMigrationEnvelopeV1(
  encoded: Uint8Array,
  expected: RichSaveMigrationEnvelopeExpectationV1 = {},
) {
  if (!(encoded instanceof Uint8Array) || encoded.byteLength < 6 || encoded.byteLength > MAX_ENCODED_ENVELOPE_BYTES_V1) {
    fail("envelope-size", "encoded rich-save envelope is truncated or exceeds its byte budget");
  }
  const reader = new Reader(encoded);
  if (!equalBytes(reader.take(ENVELOPE_MAGIC_V1.byteLength), ENVELOPE_MAGIC_V1)) fail("magic", "rich-save envelope magic does not match");
  const schemaVersion = reader.u16();
  if (schemaVersion !== RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1) fail("schema-version", "rich-save envelope schema is unsupported");
  const source: RichSaveMigrationSourceV1 = {
    sourceKey: reader.string("source.sourceKey", 512),
    sourceFormat: reader.string("source.sourceFormat", 128),
    saveVersion: reader.u16(),
    byteLength: reader.u64("source.byteLength"),
    semanticHash: reader.hash(),
  };
  const target: RichSaveMigrationTargetV1 = {
    universeId: reader.string("target.universeId", 64),
    locationId: reader.string("target.locationId", 128),
    generatorHash: reader.hash(),
    contentHash: reader.hash(),
  };
  const sourcePropertyCount = reader.u32();
  if (sourcePropertyCount < 1 || sourcePropertyCount > RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1) fail("source-properties", "encoded source property count is outside its bound");
  const sourceProperties = Array.from({ length: sourcePropertyCount }, (_, index) => reader.string(`sourceProperties[${index}]`, 256));
  const domainCount = reader.u32();
  if (domainCount < 1 || domainCount > RICH_SAVE_MIGRATION_MAX_DOMAINS_V1) fail("domain-count", "encoded domain count is outside its bound");
  let observedPages = 0;
  let observedBytes = 0;
  const domains: RichSaveMigrationDomainV1[] = [];
  for (let domainIndex = 0; domainIndex < domainCount; domainIndex += 1) {
    const domainId = reader.string(`domains[${domainIndex}].domainId`, 128, DOMAIN_ID_PATTERN);
    const codecVersion = reader.u16();
    const propertyCount = reader.u32();
    if (propertyCount < 1 || propertyCount > RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1) fail("collection-size", `encoded domain ${domainId} property count is outside its bound`);
    const properties = Array.from({ length: propertyCount }, (_, index) => reader.string(`${domainId}.properties[${index}]`, 256));
    const pageCount = reader.u32();
    if (pageCount < 1 || pageCount > RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1
      || observedPages > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGES_V1 - pageCount) {
      fail("page-count", `encoded domain ${domainId} page count is outside its bound`);
    }
    observedPages += pageCount;
    const itemCount = reader.u64(`${domainId}.itemCount`);
    const byteLength = reader.u64(`${domainId}.byteLength`);
    if (byteLength > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1
      || observedBytes > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1 - byteLength) {
      fail("page-size", `encoded domain ${domainId} byte length is outside its bound`);
    }
    observedBytes += byteLength;
    const semanticRoot = reader.hash();
    const pages: RichSaveMigrationPageV1[] = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      pages.push({
        schemaVersion: reader.u16() as typeof RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1,
        universeId: reader.string(`${domainId}.pages[${pageIndex}].universeId`, 64),
        locationId: reader.string(`${domainId}.pages[${pageIndex}].locationId`, 128),
        sourceSemanticHash: reader.hash(),
        domainId: reader.string(`${domainId}.pages[${pageIndex}].domainId`, 128, DOMAIN_ID_PATTERN),
        codecVersion: reader.u16(),
        pageIndex: reader.u32(),
        pageCount: reader.u32(),
        itemStart: reader.u64(`${domainId}.pages[${pageIndex}].itemStart`),
        itemCount: reader.u64(`${domainId}.pages[${pageIndex}].itemCount`),
        byteLength: reader.u32(),
        payloadHash: reader.hash(),
        pageHash: reader.hash(),
        payload: reader.bytes(RICH_SAVE_MIGRATION_MAX_PAGE_BYTES_V1),
      });
    }
    domains.push({ domainId, codecVersion, properties, pageCount, itemCount, byteLength, pages, semanticRoot });
  }
  const envelope: RichSaveMigrationEnvelopeV1 = {
    schemaVersion,
    source,
    target,
    sourceProperties,
    domains,
    totalPageCount: reader.u32(),
    totalPageBytes: reader.u64("envelope.totalPageBytes"),
    envelopeRoot: reader.hash(),
  };
  reader.finish();
  assertRichSaveMigrationEnvelopeV1(envelope, expected);
  return freezeEnvelope(envelope);
}
