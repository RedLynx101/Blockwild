import {
  assertGeneratedChunkV2, createGeneratedChunkV2, decodeTerrainGenerationMarkerTableV2,
  type GeneratedChunkV2, type GenerateChunkRequestV2,
} from "../../app/game/terrain-generation-contract.ts";
import { terrainGenerationChunksByteEqualV2 } from "../../app/game/rust-terrain-generation-backend.ts";

export const R3_WORKER_STREAM_NAMES = ["blocks", "heightmap", "biomes", "sectionBlockCounts", "skyTops", "light", "lightIndices", "leafIndices", "markerOffsets", "markerBytes"] as const;

export type R3WorkerCase = Readonly<{
  id: string; ordinal: number; seed: string; chunk: readonly [number, number];
  options?: Readonly<Record<string, unknown>>; edits?: readonly (readonly [number, number])[];
  coverage: readonly string[]; markerToken?: string; absentMarkerToken?: string;
  minimumMarkers?: number; maximumMarkers?: number;
  streamBytes: readonly number[]; expectedChunkHash: string; expectedBytesHash: string;
}>;

export type R3WorkerManifest = Readonly<{
  schema: 1; artifactHash: string; corpusHash: string; coverageCount: number; cases: readonly R3WorkerCase[];
  schedules: Readonly<Record<"forward" | "reverse" | "zipper", readonly string[]>>;
}>;

export function r3WorkerStreams(chunk: GeneratedChunkV2) {
  return [chunk.blocks, chunk.heightmap, chunk.biomes, chunk.sectionBlockCounts, chunk.skyTops,
    chunk.light, chunk.lightIndices, chunk.leafIndices, chunk.markerTable.offsets, chunk.markerTable.bytes] as const;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`R3 production worker: ${message}`);
}

export function encodeR3WorkerExpectedBytes(chunk: GeneratedChunkV2) {
  assertGeneratedChunkV2(chunk);
  const streams = r3WorkerStreams(chunk);
  const bytes = new Uint8Array(streams.reduce((sum, stream) => sum + stream.byteLength, 0));
  let offset = 0;
  for (const stream of streams) {
    bytes.set(new Uint8Array(stream.buffer, stream.byteOffset, stream.byteLength), offset);
    offset += stream.byteLength;
  }
  return bytes;
}

export function decodeR3WorkerExpectedChunk(bytes: Uint8Array, entry: R3WorkerCase, request: GenerateChunkRequestV2) {
  invariant(entry.streamBytes.length === R3_WORKER_STREAM_NAMES.length, "expected stream count changed");
  invariant(entry.streamBytes.every(length => Number.isSafeInteger(length) && length >= 0), "expected stream length is invalid");
  invariant(entry.streamBytes.reduce((sum, length) => sum + length, 0) === bytes.byteLength, "expected bytes are truncated or trailing");
  let offset = 0;
  const buffers = entry.streamBytes.map(length => {
    const buffer = bytes.slice(offset, offset + length).buffer;
    offset += length;
    return buffer;
  });
  const markerTable = { offsets: new Uint32Array(buffers[8]), bytes: new Uint8Array(buffers[9]) };
  const expected = createGeneratedChunkV2(request, {
    key: request.key, cx: request.cx, cz: request.cz,
    blocks: new Uint16Array(buffers[0]), heightmap: new Int16Array(buffers[1]), biomes: new Uint8Array(buffers[2]),
    sectionBlockCounts: new Uint16Array(buffers[3]), skyTops: new Int16Array(buffers[4]), light: new Uint16Array(buffers[5]),
    lightIndices: new Uint32Array(buffers[6]), leafIndices: new Uint32Array(buffers[7]),
    structureMarkers: decodeTerrainGenerationMarkerTableV2(markerTable),
  });
  invariant(expected.chunkHash === entry.expectedChunkHash, `${entry.id}: independently generated expected bytes/hash disagree`);
  invariant(encodeR3WorkerExpectedBytes(expected).every((byte, index) => byte === bytes[index]), `${entry.id}: expected marker bytes are not canonical`);
  return expected;
}

export function assertR3ProductionWorkerResult(
  candidate: GeneratedChunkV2 & { structureMarkers: unknown },
  canonicalExpected: GeneratedChunkV2,
  actualRequest: GenerateChunkRequestV2,
) {
  const expected = createGeneratedChunkV2(actualRequest, {
    ...canonicalExpected,
    structureMarkers: decodeTerrainGenerationMarkerTableV2(canonicalExpected.markerTable),
  });
  invariant(terrainGenerationChunksByteEqualV2(expected, candidate), "a transferred stream or request identity differs from the independent legacy oracle");
  invariant(candidate.chunkHash === expected.chunkHash, "result chunk hash differs from the independent legacy oracle");
  const markers = decodeTerrainGenerationMarkerTableV2(expected.markerTable);
  invariant(JSON.stringify(candidate.structureMarkers) === JSON.stringify(markers), "decoded POI metadata differs from exact transferred marker bytes");
  const streams = r3WorkerStreams(candidate);
  const constructors = [Uint16Array, Int16Array, Uint8Array, Uint16Array, Int16Array, Uint16Array, Uint32Array, Uint32Array, Uint32Array, Uint8Array];
  invariant(new Set(streams.map(stream => stream.buffer)).size === streams.length, "result streams alias transfer buffers");
  streams.forEach((stream, index) => {
    invariant(stream instanceof constructors[index], `${R3_WORKER_STREAM_NAMES[index]} has the wrong typed-array representation`);
    invariant(stream.buffer instanceof ArrayBuffer && stream.byteOffset === 0 && stream.buffer.byteLength === stream.byteLength,
      `${R3_WORKER_STREAM_NAMES[index]} is not an exact owned transfer buffer`);
  });
  return { chunkHash: candidate.chunkHash, streamBytes: streams.map(stream => stream.byteLength), markerCount: markers.length };
}
