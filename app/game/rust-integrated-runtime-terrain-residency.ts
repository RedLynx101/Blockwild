import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec";
import { RustIntegratedRuntimeServiceV1 } from "./rust-integrated-runtime-service";

export const RUST_INTEGRATED_TERRAIN_RESIDENCY_TYPE_V1 = "blockwild.world.terrain-residency.ensure.r4.v1";
export const RUST_INTEGRATED_TERRAIN_RESIDENCY_RECEIPT_TYPE_V1 = "blockwild.world.terrain-residency-receipt.r4.v1";
export const RUST_INTEGRATED_TERRAIN_RESIDENCY_MAX_CHUNKS_V1 = 25;

const encoder = new TextEncoder();
const HEADER_BYTES = 28;
const REQUEST_MAGIC = Uint8Array.of(0x42, 0x57, 0x54, 0x34); // BWT4
const RECEIPT_MAGIC = Uint8Array.of(0x42, 0x57, 0x55, 0x34); // BWU4
const HASH = /^[0-9a-f]{32}$/u;
const MAX_SAFE_U64 = BigInt(Number.MAX_SAFE_INTEGER);
const FACTIONS = ["hobbits", "goblins", "atlantians", "sugarcourt", "wood-elves", "dwarves"] as const;
const GENERATION_OPTION_KEYS = ["biomeScale", "caveFrequency", "enabledFactions", "largeTownFrequency", "profile", "resourceAbundance", "roadCoverage", "settlementClustering", "settlementDensity", "settlementPattern", "structures"] as const;

export type RustIntegratedTerrainWorldRevisionV1 = Readonly<{
  epoch: bigint;
  mutation: bigint;
  residency: bigint;
}>;

export type RustIntegratedTerrainChunkV1 = Readonly<{ chunkX: number; chunkZ: number }>;

export type RustIntegratedTerrainResidencyRequestV1 = Readonly<{
  expectedWorldRevision: RustIntegratedTerrainWorldRevisionV1;
  generationOptionsJson: string;
  chunks: readonly RustIntegratedTerrainChunkV1[];
}>;

export type RustIntegratedTerrainResidencyChunkReceiptV1 = Readonly<{
  chunkX: number;
  chunkZ: number;
  status: "already-resident" | "generated";
  residentSections: number;
  editCount: number;
  generationRevision: number;
  requestHash: string;
  sourceHash: string;
  editHash: string;
  namespaceHash: string;
  cacheHit: boolean;
}>;

export type RustIntegratedTerrainResidencyReceiptV1 = Readonly<{
  previousWorldRevision: RustIntegratedTerrainWorldRevisionV1;
  worldRevision: RustIntegratedTerrainWorldRevisionV1;
  requestedChunks: number;
  generatedChunks: number;
  alreadyResidentChunks: number;
  requestedResidentChunks: number;
  residentSections: number;
  chunks: readonly RustIntegratedTerrainResidencyChunkReceiptV1[];
  stateHash: string;
}>;

export class RustIntegratedTerrainResidencyErrorV1 extends Error {
  readonly name = "RustIntegratedTerrainResidencyErrorV1";
  constructor(readonly code: string, message: string) { super(message); }
}

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private append(value: Uint8Array) { this.parts.push(value); this.length += value.byteLength; }
  raw(value: Uint8Array) { this.append(value); }
  u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); this.append(bytes); }
  u32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); this.append(bytes); }
  i32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setInt32(0, value, true); this.append(bytes); }
  u64(value: bigint) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, value, true); this.append(bytes); }
  bytes(value: Uint8Array) { this.u32(value.byteLength); this.append(value); }
  string(value: string) { this.bytes(encoder.encode(value)); }
  finish() { const output = new Uint8Array(this.length); let offset = 0; for (const part of this.parts) { output.set(part, offset); offset += part.byteLength; } return output; }
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  take(length: number) { const end = this.offset + length; if (end > this.bytes.byteLength) fail("terrain-residency-truncated", "terrain residency packet is truncated"); const value = this.bytes.subarray(this.offset, end); this.offset = end; return value; }
  u8() { return this.take(1)[0]; }
  u16() { const value = this.take(2); return new DataView(value.buffer, value.byteOffset, 2).getUint16(0, true); }
  u32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, true); }
  i32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getInt32(0, true); }
  u64() { const value = this.take(8); return new DataView(value.buffer, value.byteOffset, 8).getBigUint64(0, true); }
  finish() { if (this.offset !== this.bytes.byteLength) fail("terrain-residency-trailing", "terrain residency packet has trailing bytes"); }
}

function fail(code: string, message: string): never { throw new RustIntegratedTerrainResidencyErrorV1(code, message); }
function checksumBytes(bytes: Uint8Array) { const hex = rustIntegratedRuntimeWireChecksumV1(bytes); return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)); }
function hashHex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

function validateRevision(value: RustIntegratedTerrainWorldRevisionV1) {
  for (const lane of [value.epoch, value.mutation, value.residency]) {
    if (typeof lane !== "bigint" || lane < BigInt(0) || lane > MAX_SAFE_U64) fail("terrain-residency-revision", "terrain world revision is outside the authority safe-u64 range");
  }
}

function canonicalChunks(chunks: readonly RustIntegratedTerrainChunkV1[]) {
  if (!Array.isArray(chunks) || chunks.length === 0 || chunks.length > RUST_INTEGRATED_TERRAIN_RESIDENCY_MAX_CHUNKS_V1) fail("terrain-residency-count", "terrain residency chunk set is empty or exceeds its bound");
  for (const chunk of chunks) {
    if (!Number.isInteger(chunk.chunkX) || !Number.isInteger(chunk.chunkZ) || chunk.chunkX < -0x8000_0000 || chunk.chunkX > 0x7fff_ffff || chunk.chunkZ < -0x8000_0000 || chunk.chunkZ > 0x7fff_ffff) fail("terrain-residency-coordinate", "terrain residency coordinate is outside i32");
  }
  const result = chunks.map((chunk) => Object.freeze({ ...chunk })).sort((left, right) => left.chunkX - right.chunkX || left.chunkZ - right.chunkZ);
  if (result.some((chunk, index) => index > 0 && chunk.chunkX === result[index - 1].chunkX && chunk.chunkZ === result[index - 1].chunkZ)) fail("terrain-residency-order", "terrain residency chunks must be unique");
  return result;
}

function validateCanonicalGenerationOptionsJson(value: string) {
  if (typeof value !== "string" || value.length === 0 || encoder.encode(value).byteLength > 16 * 1024 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail("terrain-generation-options", "terrain generation options are not bounded visible canonical JSON");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { fail("terrain-generation-options", "terrain generation options are not JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("terrain-generation-options", "terrain generation options must be an object");
  const options = parsed as Record<string, unknown>;
  const enabledFactions = options.enabledFactions;
  if (JSON.stringify(options) !== value || JSON.stringify(Object.keys(options)) !== JSON.stringify(GENERATION_OPTION_KEYS)) fail("terrain-generation-options", "terrain generation options are not in canonical field order");
  const rounded = (candidate: unknown, minimum: number, maximum: number) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= minimum && candidate <= maximum && candidate === Math.round(candidate * 100) / 100;
  if (!rounded(options.biomeScale, 0.25, 4) || !rounded(options.caveFrequency, 0, 3) || !rounded(options.resourceAbundance, 0.25, 4) || !rounded(options.settlementDensity, 0, 3)
    || options.profile !== "legacy-v14" && options.profile !== "world-below-v15"
    || options.settlementPattern !== "legacy-scattered-v1" && options.settlementPattern !== "heartlands-v2"
    || options.settlementClustering !== "even" && options.settlementClustering !== "regional" && options.settlementClustering !== "strong"
    || options.roadCoverage !== "none" && options.roadCoverage !== "local" && options.roadCoverage !== "regional" && options.roadCoverage !== "dense"
    || options.largeTownFrequency !== "rare" && options.largeTownFrequency !== "balanced" && options.largeTownFrequency !== "frequent"
    || typeof options.structures !== "boolean"
    || !Array.isArray(enabledFactions)
    || enabledFactions.some((faction, index) => typeof faction !== "string" || FACTIONS.indexOf(faction as typeof FACTIONS[number]) <= (index === 0 ? -1 : FACTIONS.indexOf(enabledFactions[index - 1] as typeof FACTIONS[number])))) {
    fail("terrain-generation-options", "terrain generation options contain an unsupported or non-normalized field");
  }
}

function wrap(magic: Uint8Array, body: Uint8Array) {
  const output = new Uint8Array(HEADER_BYTES + body.byteLength); const view = new DataView(output.buffer);
  output.set(magic); view.setUint16(4, 1, true); view.setUint16(6, 1, true); view.setUint32(8, body.byteLength, true);
  output.set(checksumBytes(body), 12); output.set(body, HEADER_BYTES); return output;
}

function unwrap(magic: Uint8Array, packet: Uint8Array) {
  if (!(packet instanceof Uint8Array) || packet.byteLength < HEADER_BYTES || !magic.every((byte, index) => packet[index] === byte)) fail("terrain-residency-header", "terrain residency packet header is malformed");
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength); const length = view.getUint32(8, true);
  if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 1 || length !== packet.byteLength - HEADER_BYTES) fail("terrain-residency-header", "terrain residency packet version or length is invalid");
  const body = packet.subarray(HEADER_BYTES); if (!checksumBytes(body).every((byte, index) => packet[index + 12] === byte)) fail("terrain-residency-checksum", "terrain residency packet checksum is invalid"); return body;
}

function writeRevision(writer: Writer, value: RustIntegratedTerrainWorldRevisionV1) { validateRevision(value); writer.u64(value.epoch); writer.u64(value.mutation); writer.u64(value.residency); }
function readRevision(reader: Reader) {
  const revision = Object.freeze({ epoch: reader.u64(), mutation: reader.u64(), residency: reader.u64() });
  validateRevision(revision);
  return revision;
}

export function encodeRustIntegratedTerrainResidencyRequestV1(value: RustIntegratedTerrainResidencyRequestV1) {
  validateRevision(value.expectedWorldRevision);
  validateCanonicalGenerationOptionsJson(value.generationOptionsJson);
  const chunks = canonicalChunks(value.chunks); const writer = new Writer(); writeRevision(writer, value.expectedWorldRevision); writer.string(value.generationOptionsJson); writer.u32(chunks.length);
  for (const chunk of chunks) { writer.i32(chunk.chunkX); writer.i32(chunk.chunkZ); }
  return wrap(REQUEST_MAGIC, writer.finish());
}

export function decodeRustIntegratedTerrainResidencyReceiptV1(packet: Uint8Array): RustIntegratedTerrainResidencyReceiptV1 {
  const reader = new Reader(unwrap(RECEIPT_MAGIC, packet)); const previousWorldRevision = readRevision(reader); const worldRevision = readRevision(reader);
  const requestedChunks = reader.u32(); const generatedChunks = reader.u32(); const alreadyResidentChunks = reader.u32(); const requestedResidentChunks = reader.u32(); const residentSections = reader.u32(); const count = reader.u32();
  if (count === 0 || count > RUST_INTEGRATED_TERRAIN_RESIDENCY_MAX_CHUNKS_V1) fail("terrain-residency-count", "terrain residency receipt chunk count is outside bounds");
  const chunks: RustIntegratedTerrainResidencyChunkReceiptV1[] = [];
  for (let index = 0; index < count; index += 1) {
    const chunkX = reader.i32(); const chunkZ = reader.i32(); const statusByte = reader.u8(); const residentSectionCount = reader.u16(); const editCount = reader.u32(); const generationRevision = reader.u32();
    const hashes = [hashHex(reader.take(16)), hashHex(reader.take(16)), hashHex(reader.take(16)), hashHex(reader.take(16))]; const cacheHitByte = reader.u8();
    if (statusByte > 1 || cacheHitByte > 1 || residentSectionCount !== 12 || generationRevision === 0 || hashes.some((hash) => !HASH.test(hash))) fail("terrain-residency-receipt", "terrain residency chunk diagnostics are malformed");
    chunks.push(Object.freeze({ chunkX, chunkZ, status: statusByte === 0 ? "already-resident" : "generated", residentSections: residentSectionCount, editCount, generationRevision, requestHash: hashes[0], sourceHash: hashes[1], editHash: hashes[2], namespaceHash: hashes[3], cacheHit: cacheHitByte === 1 }));
  }
  const stateHash = hashHex(reader.take(16)); reader.finish();
  const actualGeneratedChunks = chunks.filter((chunk) => chunk.status === "generated").length;
  if (requestedChunks !== count
    || requestedResidentChunks !== count
    || generatedChunks + alreadyResidentChunks !== count
    || generatedChunks !== actualGeneratedChunks
    || alreadyResidentChunks !== count - actualGeneratedChunks
    || chunks.some((chunk, index) => index > 0 && (chunks[index - 1].chunkX > chunk.chunkX || (chunks[index - 1].chunkX === chunk.chunkX && chunks[index - 1].chunkZ >= chunk.chunkZ)))) fail("terrain-residency-receipt", "terrain residency receipt counters or order are inconsistent");
  return Object.freeze({ previousWorldRevision, worldRevision, requestedChunks, generatedChunks, alreadyResidentChunks, requestedResidentChunks, residentSections, chunks: Object.freeze(chunks), stateHash });
}

/** Coarse awaited terrain residency operation for the sole integrated runtime. */
export class RustIntegratedTerrainResidencyPortV1 {
  private serial = Promise.resolve<unknown>(undefined);
  constructor(private readonly runtime: RustIntegratedRuntimeServiceV1, private readonly actorId = "platform:terrain") {}
  ensure(value: RustIntegratedTerrainResidencyRequestV1) {
    const expectedChunks = canonicalChunks(value.chunks);
    const payload = encodeRustIntegratedTerrainResidencyRequestV1(value); const payloadHash = rustIntegratedRuntimeWireChecksumV1(payload);
    const operation = () => this.runtime.command(createRustIntegratedRuntimeCommandBatchV1({ commandId: `terrain-residency:${payloadHash}`, idempotencyKey: `terrain-residency:${payloadHash}`, actorId: this.actorId, expected: this.runtime.identity(), operations: [createRustIntegratedRuntimeDomainOperationV1({ domain: "world", typeId: RUST_INTEGRATED_TERRAIN_RESIDENCY_TYPE_V1, schema: 1, payload })] })).then((receipt) => {
      if (receipt.status === "rejected") throw new RustIntegratedTerrainResidencyErrorV1(receipt.code, receipt.message); const response = receipt.domainReceipts[0];
      if (receipt.domainReceipts.length !== 1 || response.domain !== "world" || response.typeId !== RUST_INTEGRATED_TERRAIN_RESIDENCY_RECEIPT_TYPE_V1 || response.schema !== 1) fail("terrain-residency-receipt", "terrain residency returned an unexpected native receipt");
      const decoded = decodeRustIntegratedTerrainResidencyReceiptV1(response.payload);
      if (decoded.previousWorldRevision.epoch !== value.expectedWorldRevision.epoch
        || decoded.previousWorldRevision.mutation !== value.expectedWorldRevision.mutation
        || decoded.previousWorldRevision.residency !== value.expectedWorldRevision.residency
        || decoded.chunks.some((chunk, index) => chunk.chunkX !== expectedChunks[index]?.chunkX || chunk.chunkZ !== expectedChunks[index]?.chunkZ)) {
        fail("terrain-residency-receipt", "terrain residency receipt does not match its request");
      }
      return decoded;
    });
    const next = this.serial.then(operation, operation); this.serial = next.then(() => undefined, () => undefined); return next;
  }
}
