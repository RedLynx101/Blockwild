import assert from "node:assert/strict";
import test from "node:test";
import {
  RUST_HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2,
  RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_MAGIC_V2,
  RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2,
  RUST_HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2,
  RUST_HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2,
  RUST_HISTORICAL_EXTERNAL_PROFILE_V2,
  RUST_HISTORICAL_EXTERNAL_PROPOSAL_MAGIC_V2,
  RustHistoricalSavePersistenceError,
  advanceRustHistoricalExternalDescriptorProposalV2,
  assertRustHistoricalExternalDescriptorEnvelopeV2,
  assertRustHistoricalExternalDescriptorPlanV2,
  assertRustHistoricalStoredWorldEnvelopeCasV2,
  bindRustHistoricalExternalDescriptorProposalV2,
  createInitialRustHistoricalExternalDescriptorProposalV2,
  createRustHistoricalExternalDescriptorProposalV2,
  createRustHistoricalStoredWorldEnvelopeV2,
  decodeRustHistoricalExternalDescriptorProposalV2,
  decodeRustHistoricalExternalDescriptorV2,
  decodeRustHistoricalStoredWorldCanonicalBytesV2,
  decodeRustHistoricalStoredWorldEnvelopeV2,
  encodeRustHistoricalExternalDescriptorProposalV2,
  encodeRustHistoricalExternalDescriptorV2,
  rustHistoricalExternalDocumentChunkAddressV2,
  type RustHistoricalExternalImmutableV2,
  type RustHistoricalStoredWorldEnvelopeV2,
} from "../app/game/rust-historical-save-persistence.ts";
import { persistencePayloadHashV1, type PersistenceRecordDescriptorV1 } from "../app/game/persistence-journal-contract.ts";
import type { RustHistoricalSaveCompatibilityPlanV1 } from "../app/game/rust-historical-save-compatibility.ts";
import { encodeCanonicalWorldSaveValueV1 } from "../app/game/world-save-sharding.ts";
import type { WorldImportSourceReferenceV1 } from "../app/game/world-import-source.ts";
import type { StoredWorld } from "../app/game/world-storage.ts";

const encoder = new TextEncoder();
const SOURCE_SHA = "11".repeat(32);

function hash(byte: number) { return byte.toString(16).padStart(2, "0").repeat(16); }

function source(): WorldImportSourceReferenceV1 {
  return Object.freeze({
    schemaVersion: 1,
    provenance: "uploaded-file-bytes",
    sourceFormat: "blockwild-world-export-v1",
    encoding: "utf-8",
    archiveWorldId: "blockwild-original-import-sources-v1",
    objectId: `sha256-${SOURCE_SHA}`,
    rawSha256: SOURCE_SHA,
    byteLength: 8_192,
  });
}

const GENERATION_OPTIONS_JSON = "{\"biomeScale\":1.35}";
const GENERATION_IDENTITY = Object.freeze({
  schemaVersion: 1 as const,
  generatorHash: hash(0x26),
  terrainContentHash: hash(0x27),
  generationOptionsJson: GENERATION_OPTIONS_JSON,
});

function storedWorld(turn = 1): StoredWorld {
  const save: Record<string, unknown> = { seed: "water-🌿", edits: {}, player: { x: turn } };
  if (turn === 1) Object.defineProperty(save, "__proto__", {
    enumerable: true, configurable: true, writable: true, value: { retained: true },
  });
  return {
    version: 1,
    metadata: {
      id: "historical-g16",
      ownership: "host-device",
      name: "Historical",
      seed: "water-🌿",
      mode: "survival",
      createdAt: 1,
      updatedAt: turn,
      lastPlayedAt: null,
      playTimeMs: turn,
      lastSavedGameVersion: "1.12.0",
      generationIdentity: GENERATION_IDENTITY,
    },
    options: { biomeScale: 1.35 } as StoredWorld["options"],
    save: save as unknown as StoredWorld["save"],
    importSource: source(),
  };
}

function nativeRecords(): readonly PersistenceRecordDescriptorV1[] {
  return Object.freeze(RUST_HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2.map((template, index) => Object.freeze({
    address: Object.freeze({
      universeId: "world:historical-g16",
      locationId: "overworld",
      kind: template.kind,
      recordId: template.recordId,
    }),
    revision: 1,
    byteLength: 100 + index,
    payloadHash: hash(0x40 + index),
  })));
}

function immutable(initialDocument: RustHistoricalStoredWorldEnvelopeV2["initialDocument"]): RustHistoricalExternalImmutableV2 {
  return {
    authority: {
      claim: RUST_HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2,
      nativePlayer: "off",
      nativeRichState: "not-adopted",
    },
    profile: RUST_HISTORICAL_EXTERNAL_PROFILE_V2,
    nativeExecutionScope: RUST_HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2,
    source: { ...source(), generatorVersion: 16 },
    initialDocument,
    planHash: hash(0x23),
    custodyRoot: hash(0x24),
    externalStateFlags: 0x7f,
    target: {
      catalogWorldId: "historical-g16",
      universeId: "world:historical-g16",
      locationId: "overworld",
      worldSeed: "water-🌿",
      contentHash: hash(0x25),
      generationIdentity: {
        ...GENERATION_IDENTITY,
        generationOptionsHash: persistencePayloadHashV1(encoder.encode(GENERATION_OPTIONS_JSON)),
        generationOptionsByteLength: encoder.encode(GENERATION_OPTIONS_JSON).byteLength,
      },
      optionsSemanticHash: hash(0x28),
      optionsByteLength: 127,
    },
    bwas: {
      projectionHash: hash(0x29),
      projectionByteLength: 1_024,
      compatibilityChecksum: hash(0x2a),
      extensionChecksum: hash(0x2b),
      editCount: 39,
      facingCount: 2,
    },
  };
}

function fingerprints(envelope: RustHistoricalStoredWorldEnvelopeV2) {
  return envelope.chunks.map(chunk => ({
    index: chunk.index,
    byteOffset: chunk.byteOffset,
    byteLength: chunk.byteLength,
    payloadHash: chunk.payloadHash,
  }));
}

function fixtureProposal(envelope: RustHistoricalStoredWorldEnvelopeV2) {
  return createRustHistoricalExternalDescriptorProposalV2({
    immutable: immutable(envelope.initialDocument),
    currentDocument: envelope.currentDocument,
    expectedPreviousDocument: envelope.expectedPreviousDocument,
    chunks: fingerprints(envelope),
  });
}

function compatibilityPlan(document: StoredWorld): RustHistoricalSaveCompatibilityPlanV1 {
  const normalizedBytes = encodeCanonicalWorldSaveValueV1(document.save);
  const optionsBytes = encodeCanonicalWorldSaveValueV1(document.options);
  const projectionBytes = Uint8Array.from([1, 2, 3]);
  return {
    schemaVersion: 1,
    profile: RUST_HISTORICAL_EXTERNAL_PROFILE_V2,
    status: "external-custody-planned",
    authority: {
      claim: RUST_HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2,
      nativePlayer: "off",
      nativeRichState: "not-adopted",
    },
    nativeExecutionScope: "world-r4-projection-only",
    source: {
      raw: { ...source(), generatorVersion: 16 },
      normalized: {
        semanticHash: persistencePayloadHashV1(normalizedBytes),
        byteLength: normalizedBytes.byteLength,
        canonicalBytes: normalizedBytes,
      },
    },
    target: {
      catalogWorldId: "historical-g16",
      universeId: "world:historical-g16",
      locationId: "overworld",
      worldSeed: "water-🌿",
      contentHash: hash(0x25),
      generationIdentity: GENERATION_IDENTITY,
      options: document.options,
      optionsSemanticHash: persistencePayloadHashV1(optionsBytes),
      optionsByteLength: optionsBytes.byteLength,
    },
    sourceProperties: Object.freeze(Object.keys(document.save).sort()),
    domains: Object.freeze([]),
    externalStateFlags: 0x7f,
    nativeWorld: {
      address: { universeId: "world:historical-g16", locationId: "overworld" },
      projectionHash: persistencePayloadHashV1(projectionBytes),
      projectionByteLength: projectionBytes.byteLength,
      projectionBytes,
      compatibilityChecksum: hash(0x2a),
      extensionChecksum: hash(0x2b),
      editCount: 39,
      facingCount: 2,
      expectedReadback: {
        universeId: "world:historical-g16",
        locationId: "overworld",
        projectionHash: persistencePayloadHashV1(projectionBytes),
        projectionByteLength: projectionBytes.byteLength,
        nativeWorldSemanticHash: persistencePayloadHashV1(projectionBytes),
        editCount: 39,
        facingCount: 2,
      },
    },
    custodyRoot: hash(0x24),
    planHash: hash(0x23),
  };
}

test("opaque StoredWorld envelopes preserve canonical JSON and exact CAS lineage", async () => {
  const initial = await createRustHistoricalStoredWorldEnvelopeV2({ document: storedWorld(), source: source(), previous: null });
  const decoded = await decodeRustHistoricalStoredWorldEnvelopeV2(initial);
  assert.equal((decoded.document.save as unknown as Record<string, unknown>).__proto__ instanceof Object, false);
  assert.equal(
    ((decoded.document.save as unknown as Record<string, unknown>).__proto__ as Record<string, unknown>).retained,
    true,
  );
  assert.equal(initial.currentDocument.revision, 1);
  assert.equal(initial.expectedPreviousDocument, null);

  const successor = await createRustHistoricalStoredWorldEnvelopeV2({
    document: storedWorld(2),
    source: source(),
    previous: {
      source: initial.source,
      initialDocument: initial.initialDocument,
      currentDocument: initial.currentDocument,
    },
  });
  assert.equal(successor.currentDocument.revision, 2);
  assert.deepEqual(successor.expectedPreviousDocument, initial.currentDocument);
  await assert.doesNotReject(() => assertRustHistoricalStoredWorldEnvelopeCasV2(successor, initial));

  const tampered = structuredClone(successor);
  tampered.chunks[0].bytes[0] ^= 1;
  await assert.rejects(decodeRustHistoricalStoredWorldEnvelopeV2(tampered), /exact deterministic slice|document identity/u);
});

test("strict StoredWorld decoding rejects duplicate and noncanonical JSON", async () => {
  const duplicate = encoder.encode(`{"importSource":${JSON.stringify(source())},"metadata":{"id":"historical-g16","seed":"water-🌿"},"options":{},"save":{"seed":"water-🌿","x":1,"\\u0078":2},"version":1}`);
  await assert.rejects(decodeRustHistoricalStoredWorldCanonicalBytesV2(duplicate, source()), (error: unknown) =>
    error instanceof RustHistoricalSavePersistenceError && error.code === "duplicate-json-key");
  const noncanonical = encoder.encode(`{"version":1,"save":{"seed":"water-🌿"},"options":{},"metadata":{"seed":"water-🌿","id":"historical-g16"},"importSource":${JSON.stringify(source())}}`);
  await assert.rejects(decodeRustHistoricalStoredWorldCanonicalBytesV2(noncanonical, source()), (error: unknown) =>
    error instanceof RustHistoricalSavePersistenceError && error.code === "document-canonical");
});

test("BWHP remains unbound until Rust supplies the exact six primary native records", async () => {
  const envelope = await createRustHistoricalStoredWorldEnvelopeV2({ document: storedWorld(), source: source(), previous: null });
  const proposal = fixtureProposal(envelope);
  const proposalBytes = encodeRustHistoricalExternalDescriptorProposalV2(proposal);
  assert.equal(new TextDecoder().decode(proposalBytes.subarray(0, 4)), RUST_HISTORICAL_EXTERNAL_PROPOSAL_MAGIC_V2);
  assert.deepEqual(decodeRustHistoricalExternalDescriptorProposalV2(proposalBytes), proposal);
  assert.throws(() => decodeRustHistoricalExternalDescriptorV2(proposalBytes), /magic mismatch/u);
  const oversizedChunkCount = proposalBytes.slice();
  // One fingerprint, its set hash, and the proposal hash occupy the final 64 bytes.
  new DataView(oversizedChunkCount.buffer).setUint32(oversizedChunkCount.byteLength - 68, 0xffff_ffff, true);
  assert.throws(
    () => decodeRustHistoricalExternalDescriptorProposalV2(oversizedChunkCount),
    (error: unknown) => error instanceof RustHistoricalSavePersistenceError && error.code === "chunk-count",
  );

  assert.throws(() => bindRustHistoricalExternalDescriptorProposalV2(proposal, []), /exactly the six/u);
  const reversed = [...nativeRecords()].reverse();
  assert.throws(() => bindRustHistoricalExternalDescriptorProposalV2(proposal, reversed), /exact primary record set/u);
  const descriptor = bindRustHistoricalExternalDescriptorProposalV2(proposal, nativeRecords());
  const descriptorBytes = encodeRustHistoricalExternalDescriptorV2(descriptor);
  assert.equal(new TextDecoder().decode(descriptorBytes.subarray(0, 4)), RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_MAGIC_V2);
  assert.equal(descriptor.schemaVersion, RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2);
  assert.deepEqual(decodeRustHistoricalExternalDescriptorV2(descriptorBytes), descriptor);
  assert.throws(() => decodeRustHistoricalExternalDescriptorProposalV2(descriptorBytes), /magic mismatch/u);
  await assert.doesNotReject(() => assertRustHistoricalExternalDescriptorEnvelopeV2(descriptor, envelope));
});

test("plan-bound initial and successor proposals preserve immutable custody", async () => {
  const document = storedWorld();
  const plan = compatibilityPlan(document);
  const envelope = await createRustHistoricalStoredWorldEnvelopeV2({ document, source: source(), previous: null });
  const proposal = await createInitialRustHistoricalExternalDescriptorProposalV2(plan, envelope);
  const descriptor = bindRustHistoricalExternalDescriptorProposalV2(proposal, nativeRecords());
  await assert.doesNotReject(() => assertRustHistoricalExternalDescriptorPlanV2(descriptor, plan, envelope));

  const successorEnvelope = await createRustHistoricalStoredWorldEnvelopeV2({
    document: storedWorld(2),
    source: source(),
    previous: { source: envelope.source, initialDocument: envelope.initialDocument, currentDocument: envelope.currentDocument },
  });
  const successor = await advanceRustHistoricalExternalDescriptorProposalV2(descriptor, successorEnvelope);
  assert.deepEqual(successor.immutable, descriptor.immutable);
  assert.equal(successor.external.currentDocument.revision, 2);

  const stalePlan = {
    ...structuredClone(plan),
    target: {
      ...structuredClone(plan.target),
      contentHash: hash(0x7e),
    },
  };
  await assert.rejects(assertRustHistoricalExternalDescriptorPlanV2(descriptor, stalePlan, envelope), /freshly revalidated/u);
});

test("chunk address identity is deterministic and separate from BWHE", () => {
  assert.deepEqual(
    rustHistoricalExternalDocumentChunkAddressV2("world:historical-g16", "overworld", 7),
    {
      universeId: "world:historical-g16",
      locationId: "overworld",
      kind: "settings-reference",
      recordId: "historical-external-document-v2-00000007",
    },
  );
});

test("BWHP and BWHE match the Rust cross-language wire vector", () => {
  const initialDocument = { hash: hash(0x21), sha256: "22".repeat(32), byteLength: 21 };
  const proposal = createRustHistoricalExternalDescriptorProposalV2({
    immutable: immutable(initialDocument),
    currentDocument: { ...initialDocument, revision: 1 },
    expectedPreviousDocument: null,
    chunks: [{ index: 0, byteOffset: 0, byteLength: 21, payloadHash: hash(0x2c) }],
  });
  const descriptor = bindRustHistoricalExternalDescriptorProposalV2(proposal, nativeRecords());
  const proposalBytes = encodeRustHistoricalExternalDescriptorProposalV2(proposal);
  const descriptorBytes = encodeRustHistoricalExternalDescriptorV2(descriptor);
  assert.deepEqual({
    proposalHash: proposal.proposalHash,
    proposalLength: proposalBytes.byteLength,
    proposalPayload: persistencePayloadHashV1(proposalBytes),
    descriptorHash: descriptor.descriptorHash,
    descriptorLength: descriptorBytes.byteLength,
    descriptorPayload: persistencePayloadHashV1(descriptorBytes),
    chunkSet: proposal.external.chunkSetHash,
    nativeSet: descriptor.mutable.nativeRecordSetHash,
  }, {
    proposalHash: "cf812587143c5b28e021e8c411f64c02",
    proposalLength: 886,
    proposalPayload: "64d5e9f644e5a5dd2020f5cfb9356bd3",
    descriptorHash: "15be5f3cae66dc51202cd2c715134b01",
    descriptorLength: 1_443,
    descriptorPayload: "8bdef884ff36b971903a79ec1e08154d",
    chunkSet: "b3515e57dc7adc6e30168d11f4a7df86",
    nativeSet: "ba45d7135649d2f15042b03ef13f27da",
  });
});
