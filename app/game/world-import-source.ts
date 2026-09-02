import {
  RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1,
  rustPersistencePlatformPayloadHashV1,
  type RustPersistencePlatformRequestV1,
  type RustPersistenceResponseV1,
} from "./rust-persistence-runtime-contract";

export const WORLD_IMPORT_SOURCE_SCHEMA_V1 = 1 as const;
export const WORLD_IMPORT_SOURCE_MAX_BYTES_V1 = 64 * 1024 * 1024;
/** Archive identity is deliberately outside every catalog/native world namespace. */
export const WORLD_IMPORT_SOURCE_ARCHIVE_V1 = "blockwild-original-import-sources-v1" as const;

export type WorldImportSourceReferenceV1 = Readonly<{
  schemaVersion: typeof WORLD_IMPORT_SOURCE_SCHEMA_V1;
  provenance: "uploaded-file-bytes";
  sourceFormat: "blockwild-world-export-v1";
  encoding: "utf-8";
  archiveWorldId: typeof WORLD_IMPORT_SOURCE_ARCHIVE_V1;
  objectId: string;
  /** SHA-256 of the complete original file, NOT a normalized save semantic hash. */
  rawSha256: string;
  byteLength: number;
}>;

export interface WorldImportSourceAdapterV1 {
  executePlatform(request: RustPersistencePlatformRequestV1): Promise<Extract<RustPersistenceResponseV1, { kind: "platform" }>>;
  readPreservedLegacyBackup(input: Readonly<{ worldId: string; objectId: string; totalBytes: number }>): Promise<Uint8Array>;
}

export class WorldImportSourceError extends Error {
  constructor(readonly code: "invalid" | "unsupported-version" | "quota" | "unavailable" | "corrupt", message: string) {
    super(message);
    this.name = "WorldImportSourceError";
  }
}

function fail(code: WorldImportSourceError["code"], message: string): never {
  throw new WorldImportSourceError(code, message);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertWorldImportSourceReferenceV1(value: unknown): asserts value is WorldImportSourceReferenceV1 {
  if (!record(value)
    || Object.keys(value).sort().join(",") !== "archiveWorldId,byteLength,encoding,objectId,provenance,rawSha256,schemaVersion,sourceFormat"
    || value.schemaVersion !== WORLD_IMPORT_SOURCE_SCHEMA_V1 || value.provenance !== "uploaded-file-bytes"
    || value.sourceFormat !== "blockwild-world-export-v1" || value.encoding !== "utf-8"
    || value.archiveWorldId !== WORLD_IMPORT_SOURCE_ARCHIVE_V1
    || typeof value.rawSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.rawSha256)
    || value.objectId !== `sha256-${value.rawSha256}`
    || !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 1
    || (value.byteLength as number) > WORLD_IMPORT_SOURCE_MAX_BYTES_V1) {
    fail("corrupt", "The original-import source reference is invalid.");
  }
}

async function rawSha256(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) fail("unavailable", "Original-file preservation requires Web Crypto SHA-256.");
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
}

function decodeExport(bytes: Uint8Array) {
  let json: string;
  // Fatal UTF-8 rejects replacement decoding. A leading UTF-8 BOM is accepted
  // by TextDecoder, but remains present in the archived bytes and raw hash.
  try { json = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return fail("invalid", "That world file is not valid UTF-8."); }
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { return fail("invalid", "That file is not valid JSON."); }
  if (!record(value) || value.format !== "blockwild-world") fail("invalid", "That file is not a Blockwild world export.");
  if (value.version !== 1) fail("unsupported-version", "That Blockwild world export uses an unsupported version.");
  if (!record(value.world) || value.world.version !== 1 || !record(value.world.metadata)
    || !record(value.world.options) || !record(value.world.save)) fail("invalid", "The exported world record is incomplete.");
  return json;
}

/** Exact complete readback; never substitutes canonicalized JSON for source bytes. */
export async function readWorldImportSourceV1(adapter: WorldImportSourceAdapterV1, reference: WorldImportSourceReferenceV1) {
  assertWorldImportSourceReferenceV1(reference);
  const expected = Object.freeze({ ...reference });
  const returned = await adapter.readPreservedLegacyBackup({
    worldId: expected.archiveWorldId, objectId: expected.objectId, totalBytes: expected.byteLength,
  });
  if (!(returned instanceof Uint8Array) || returned.byteLength !== expected.byteLength) {
    fail("corrupt", "Original-file archive failed exact SHA-256 readback.");
  }
  // Neither a mutable caller reference nor adapter-owned bytes may change the
  // identity or returned data while the asynchronous digest is in flight.
  const bytes = Uint8Array.from(returned);
  if (await rawSha256(bytes) !== expected.rawSha256) fail("corrupt", "Original-file archive failed exact SHA-256 readback.");
  return bytes;
}

/**
 * Archive before the caller normalizes or publishes a catalog entry. This is
 * source preservation only: no journal checkpoint, native adoption, or consent.
 * Failed/abandoned attempts retain immutable content-addressed backups for retry.
 */
export async function preserveWorldImportSourceV1(adapter: WorldImportSourceAdapterV1, input: Uint8Array) {
  if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > WORLD_IMPORT_SOURCE_MAX_BYTES_V1) {
    fail("invalid", `World import files must contain 1–${WORLD_IMPORT_SOURCE_MAX_BYTES_V1} bytes.`);
  }
  // Own the snapshot before the first await; caller mutation cannot relabel it.
  const bytes = Uint8Array.from(input);
  const json = decodeExport(bytes);
  const hash = await rawSha256(bytes);
  const reference: WorldImportSourceReferenceV1 = Object.freeze({
    schemaVersion: WORLD_IMPORT_SOURCE_SCHEMA_V1, provenance: "uploaded-file-bytes",
    sourceFormat: "blockwild-world-export-v1", encoding: "utf-8",
    archiveWorldId: WORLD_IMPORT_SOURCE_ARCHIVE_V1, objectId: `sha256-${hash}`,
    rawSha256: hash, byteLength: bytes.byteLength,
  });
  for (let offset = 0, requestId = 1; offset < bytes.byteLength; requestId += 1) {
    const payload = bytes.slice(offset, offset + RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1);
    const response = await adapter.executePlatform(Object.freeze({
      kind: "platform", operation: "preserve-legacy-backup-chunk", requestId,
      worldId: reference.archiveWorldId, objectId: reference.objectId,
      expectedHeadHash: null, cursor: offset, limit: 0, totalBytes: bytes.byteLength,
      payloadHash: rustPersistencePlatformPayloadHashV1(payload), payload,
    }));
    if (response.kind !== "platform" || response.requestId !== requestId
      || response.operation !== "preserve-legacy-backup-chunk" || response.code !== "accepted"
      || response.nextCursor !== offset + payload.byteLength) {
      const code = response.code === "quota" ? "quota" : response.code === "unavailable" ? "unavailable" : "corrupt";
      fail(code, `Original-file archive did not commit: ${response.message || response.code}.`);
    }
    offset += payload.byteLength;
  }
  const readback = await readWorldImportSourceV1(adapter, reference);
  if (!readback.every((value, index) => value === bytes[index])) fail("corrupt", "Original-file archive bytes differ from the uploaded file.");
  return Object.freeze({ reference, json });
}
