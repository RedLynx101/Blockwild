import assert from "node:assert/strict";
import test from "node:test";
import {
  RichSaveMigrationEnvelopeError,
  assertRichSaveMigrationEnvelopeV1,
  createRichSaveMigrationEnvelopeV1,
  decodeRichSaveMigrationEnvelopeV1,
  encodeRichSaveMigrationEnvelopeV1,
  richSaveMigrationDomainRootV1,
  richSaveMigrationEnvelopeRootV1,
  richSaveMigrationPageHashV1,
  type RichSaveMigrationDomainInputV1,
  type RichSaveMigrationDomainV1,
  type RichSaveMigrationEnvelopeV1,
  type RichSaveMigrationPageV1,
} from "../app/game/rust-rich-save-migration.ts";
import { encodeCanonicalWorldSaveValueV1 } from "../app/game/world-save-sharding.ts";

const HASH_A = "0123456789abcdef0123456789abcdef";
const HASH_B = "fedcba9876543210fedcba9876543210";

function canonicalSource(extra: Readonly<Record<string, unknown>> = {}) {
  return encodeCanonicalWorldSaveValueV1({
    version: 2,
    generatorVersion: 18,
    seed: "rich-save-fixture",
    edits: { "0,0": [[0, 31]] },
    blockFacings: { "0,-64,0": 1 },
    liquidLevels: [["0,-64,0", { kind: "water", level: 0, source: true, falling: false }]],
    ...extra,
  });
}

function domains(): RichSaveMigrationDomainInputV1[] {
  return [
    {
      domainId: "world",
      codecVersion: 4,
      properties: ["edits", "blockFacings"],
      pages: [
        { pageIndex: 1, itemStart: 2, itemCount: 1, payload: Uint8Array.of(0x20, 0x21) },
        { pageIndex: 0, itemStart: 0, itemCount: 2, payload: Uint8Array.of(0x10, 0x11, 0x12) },
      ],
    },
    {
      domainId: "metadata",
      codecVersion: 1,
      properties: ["version", "seed", "generatorVersion"],
      pages: [{ pageIndex: 0, itemStart: 0, itemCount: 3, payload: Uint8Array.of(0x01) }],
    },
    {
      domainId: "liquids",
      codecVersion: 1,
      properties: ["liquidLevels"],
      pages: [{ pageIndex: 0, itemStart: 0, itemCount: 1, payload: Uint8Array.of(0x77, 0x00, 0x80, 0xff) }],
    },
  ];
}

function envelope(sourcePayload = canonicalSource(), domainInputs = domains()) {
  return createRichSaveMigrationEnvelopeV1({
    source: {
      sourceKey: "blockwild-world-data-v1:rich-save-fixture",
      sourceFormat: "blockwild-world-save-canonical-v1",
      saveVersion: 2,
      payload: sourcePayload,
    },
    target: {
      universeId: "world:rich-save-fixture",
      locationId: "overworld",
      generatorHash: HASH_A,
      contentHash: HASH_B,
    },
    domains: domainInputs,
  });
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof RichSaveMigrationEnvelopeError && error.code === code;
}

function replaceDomain(
  source: RichSaveMigrationEnvelopeV1,
  domainId: string,
  replacement: RichSaveMigrationDomainV1,
): RichSaveMigrationEnvelopeV1 {
  return { ...source, domains: source.domains.map((domain) => domain.domainId === domainId ? replacement : domain) };
}

function replacePage(
  source: RichSaveMigrationEnvelopeV1,
  domainId: string,
  pageIndex: number,
  replacement: RichSaveMigrationPageV1,
): RichSaveMigrationEnvelopeV1 {
  const domain = source.domains.find((candidate) => candidate.domainId === domainId);
  assert.ok(domain);
  return replaceDomain(source, domainId, {
    ...domain,
    pages: domain.pages.map((page) => page.pageIndex === pageIndex ? replacement : page),
  });
}

test("rich migration envelope derives exact source provenance, accounts for every property, and calculates canonical roots", () => {
  const source = canonicalSource();
  const inputDomains = domains();
  const inputWorldPayload = inputDomains[0].pages[0].payload;
  const value = envelope(source, inputDomains);

  assert.equal(value.schemaVersion, 1);
  assert.deepEqual(value.sourceProperties, ["blockFacings", "edits", "generatorVersion", "liquidLevels", "seed", "version"]);
  assert.deepEqual(value.domains.map((domain) => domain.domainId), ["liquids", "metadata", "world"]);
  assert.deepEqual(value.domains.find((domain) => domain.domainId === "metadata")?.properties, ["generatorVersion", "seed", "version"]);
  assert.deepEqual(value.domains.find((domain) => domain.domainId === "world")?.pages.map((page) => page.pageIndex), [0, 1]);
  assert.equal(value.totalPageCount, 4);
  assert.equal(value.totalPageBytes, 10);
  assert.match(value.source.semanticHash, /^[0-9a-f]{32}$/u);
  assert.match(value.envelopeRoot, /^[0-9a-f]{32}$/u);
  assert.equal(value.source.semanticHash, "5929d861d97bd46cd0b31836b4762521");
  assert.equal(value.envelopeRoot, "2b8ba716658e2110c83a5732cadf32f6", "the V1 root is a frozen interoperability vector");

  for (const domain of value.domains) {
    assert.equal(richSaveMigrationDomainRootV1(domain), domain.semanticRoot);
    for (const page of domain.pages) assert.equal(richSaveMigrationPageHashV1(page), page.pageHash);
  }
  assert.equal(richSaveMigrationEnvelopeRootV1(value), value.envelopeRoot);
  assert.doesNotThrow(() => assertRichSaveMigrationEnvelopeV1(value, {
    envelopeRoot: value.envelopeRoot,
    universeId: "world:rich-save-fixture",
    locationId: "overworld",
    generatorHash: HASH_A,
    contentHash: HASH_B,
    sourceKey: "blockwild-world-data-v1:rich-save-fixture",
    sourceFormat: "blockwild-world-save-canonical-v1",
    sourceSaveVersion: 2,
    sourcePayload: source,
  }));

  source[0] ^= 0xff;
  inputWorldPayload[0] ^= 0xff;
  assert.equal(value.domains.find((domain) => domain.domainId === "world")?.pages[1].payload[0], 0x20,
    "the envelope owns defensive page copies");
  assert.doesNotThrow(() => assertRichSaveMigrationEnvelopeV1(value), "later caller mutations cannot alter source provenance or page bytes");
});

test("equivalent unordered constructor inputs produce one deterministic envelope and binary codec", () => {
  const first = envelope();
  const secondDomains = domains().reverse().map((domain) => ({
    ...domain,
    properties: [...domain.properties].reverse(),
    pages: [...domain.pages].reverse(),
  }));
  const second = envelope(canonicalSource(), secondDomains);

  assert.equal(second.envelopeRoot, first.envelopeRoot);
  assert.deepEqual(second, first);
  const encoded = encodeRichSaveMigrationEnvelopeV1(first);
  assert.equal(new TextDecoder().decode(encoded.slice(0, 4)), "BWRM");
  const decoded = decodeRichSaveMigrationEnvelopeV1(encoded, {
    envelopeRoot: first.envelopeRoot,
    universeId: first.target.universeId,
    locationId: first.target.locationId,
    sourcePayload: canonicalSource(),
  });
  assert.deepEqual(decoded, first);
  assert.deepEqual(encodeRichSaveMigrationEnvelopeV1(decoded), encoded);
});

test("source-property accounting rejects missing, duplicate, multiply-owned, and non-source properties", () => {
  const missing = domains().filter((domain) => domain.domainId !== "liquids");
  assert.throws(() => envelope(canonicalSource(), missing), hasCode("missing-property"));

  const duplicateWithinDomain = domains();
  duplicateWithinDomain[0] = { ...duplicateWithinDomain[0], properties: ["edits", "edits", "blockFacings"] };
  assert.throws(() => envelope(canonicalSource(), duplicateWithinDomain), hasCode("duplicate-property"));

  const multiplyOwned = domains();
  multiplyOwned[1] = { ...multiplyOwned[1], properties: [...multiplyOwned[1].properties, "edits"] };
  assert.throws(() => envelope(canonicalSource(), multiplyOwned), hasCode("multiply-owned-property"));

  const unknown = domains();
  unknown[2] = { ...unknown[2], properties: ["liquidLevels", "futureState"] };
  assert.throws(() => envelope(canonicalSource(), unknown), hasCode("unknown-property"));

  const valid = envelope();
  assert.throws(() => assertRichSaveMigrationEnvelopeV1({
    ...valid,
    sourceProperties: [valid.sourceProperties[0], valid.sourceProperties[0], ...valid.sourceProperties.slice(1)],
  }), hasCode("duplicate-source-property"));
});

test("source bytes are canonical, exact, and independently re-verifiable", () => {
  const noncanonical = new TextEncoder().encode('{ "version": 2, "seed": "x" }');
  assert.throws(() => envelope(noncanonical, [{
    domainId: "metadata",
    codecVersion: 1,
    properties: ["seed", "version"],
    pages: [{ pageIndex: 0, itemStart: 0, itemCount: 2, payload: new Uint8Array() }],
  }]), hasCode("source-canonical"));

  const value = envelope();
  const changedSource = canonicalSource({ day: 2 });
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(value, { sourcePayload: changedSource }), hasCode("expected-source"));
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(value, { universeId: "world:other" }), hasCode("expected-identity"));
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(value, { envelopeRoot: "0".repeat(32) }), hasCode("expected-root"));
});

test("validator rejects reordered, duplicate, omitted, cross-world, cross-source, and corrupt pages", () => {
  const value = envelope();
  assert.throws(() => assertRichSaveMigrationEnvelopeV1({ ...value, domains: [...value.domains].reverse() }), hasCode("domain-order"));

  const world = value.domains.find((domain) => domain.domainId === "world");
  assert.ok(world);
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(replaceDomain(value, "world", {
    ...world,
    pages: [...world.pages].reverse(),
  })), hasCode("page-order"));
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(replaceDomain(value, "world", {
    ...world,
    pages: [world.pages[0], world.pages[0]],
  })), hasCode("duplicate-page"));
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(replaceDomain(value, "world", {
    ...world,
    pages: world.pages.slice(0, 1),
  })), hasCode("omitted-page"));

  const first = world.pages[0];
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(replacePage(value, "world", 0, {
    ...first,
    universeId: "world:other",
  })), hasCode("page-address"));
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(replacePage(value, "world", 0, {
    ...first,
    sourceSemanticHash: "0".repeat(32),
  })), hasCode("page-source"));
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(replacePage(value, "world", 0, {
    ...first,
    payload: Uint8Array.of(...first.payload.slice(0, -1), first.payload.at(-1)! ^ 0xff),
  })), hasCode("page-payload-hash"));
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(replacePage(value, "world", 0, {
    ...first,
    pageHash: "0".repeat(32),
  })), hasCode("page-hash"));
});

test("domain and envelope roots reject descriptor tampering, while an expected root detects coherent omission", () => {
  const value = envelope();
  const world = value.domains.find((domain) => domain.domainId === "world");
  assert.ok(world);
  assert.throws(() => assertRichSaveMigrationEnvelopeV1(replaceDomain(value, "world", {
    ...world,
    semanticRoot: "0".repeat(32),
  })), hasCode("domain-root"));
  assert.throws(() => assertRichSaveMigrationEnvelopeV1({ ...value, envelopeRoot: "0".repeat(32) }), hasCode("envelope-root"));

  const onePageWorld = domains().map((domain) => domain.domainId !== "world" ? domain : {
    ...domain,
    pages: [{ pageIndex: 0, itemStart: 0, itemCount: 3, payload: Uint8Array.of(0x10, 0x11, 0x12, 0x20, 0x21) }],
  });
  const coherentAlternative = envelope(canonicalSource(), onePageWorld);
  assert.doesNotThrow(() => assertRichSaveMigrationEnvelopeV1(coherentAlternative));
  assert.throws(
    () => assertRichSaveMigrationEnvelopeV1(coherentAlternative, { envelopeRoot: value.envelopeRoot }),
    hasCode("expected-root"),
    "hashes provide identity, so a caller must retain the expected oracle root to reject a different coherent page plan",
  );
});

test("binary decoder fails closed on truncation, trailing bytes, bad magic, schema drift, and payload corruption", () => {
  const value = envelope();
  const encoded = encodeRichSaveMigrationEnvelopeV1(value);

  assert.throws(() => decodeRichSaveMigrationEnvelopeV1(encoded.slice(0, -1)), hasCode("truncated"));
  const trailing = new Uint8Array(encoded.byteLength + 1);
  trailing.set(encoded);
  trailing[trailing.length - 1] = 1;
  assert.throws(() => decodeRichSaveMigrationEnvelopeV1(trailing), hasCode("trailing-bytes"));

  const badMagic = Uint8Array.from(encoded);
  badMagic[0] ^= 0xff;
  assert.throws(() => decodeRichSaveMigrationEnvelopeV1(badMagic), hasCode("magic"));
  const badSchema = Uint8Array.from(encoded);
  badSchema[4] = 2;
  assert.throws(() => decodeRichSaveMigrationEnvelopeV1(badSchema), hasCode("schema-version"));

  const corruptPayload = Uint8Array.from(encoded);
  const marker = Uint8Array.of(0x77, 0x00, 0x80, 0xff);
  let markerOffset = -1;
  outer: for (let index = 0; index <= corruptPayload.length - marker.length; index += 1) {
    for (let offset = 0; offset < marker.length; offset += 1) if (corruptPayload[index + offset] !== marker[offset]) continue outer;
    markerOffset = index;
    break;
  }
  assert.notEqual(markerOffset, -1);
  corruptPayload[markerOffset] ^= 0x40;
  assert.throws(() => decodeRichSaveMigrationEnvelopeV1(corruptPayload), hasCode("page-payload-hash"));
});

test("prototype-named source properties remain ordinary, fully accounted data", () => {
  const source: Record<string, unknown> = { version: 2 };
  Object.defineProperty(source, "__proto__", { value: { retained: true }, enumerable: true, configurable: true });
  Object.defineProperty(source, "constructor", { value: { retained: true }, enumerable: true, configurable: true });
  Object.defineProperty(source, "prototype", { value: { retained: true }, enumerable: true, configurable: true });
  const payload = encodeCanonicalWorldSaveValueV1(source);
  const value = envelope(payload, [{
    domainId: "metadata",
    codecVersion: 1,
    properties: ["prototype", "version", "__proto__", "constructor"],
    pages: [{ pageIndex: 0, itemStart: 0, itemCount: 4, payload: Uint8Array.of(1) }],
  }]);
  assert.deepEqual(value.sourceProperties, ["__proto__", "constructor", "prototype", "version"]);
  assert.doesNotThrow(() => assertRichSaveMigrationEnvelopeV1(value, { sourcePayload: payload }));
});
