import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

/** Persistence envelope versions accepted by the R7 gameplay authority. */
export const RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1 = 1 as const;
export const RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V2 = 2 as const;
export const RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V3 = 3 as const;
export const RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V4 = 4 as const;
export const RUST_GAMEPLAY_SNAPSHOT_MIN_SCHEMA_R7 = RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1;
export const RUST_GAMEPLAY_SNAPSHOT_CURRENT_SCHEMA_R7 = RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V4;
export const RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7 = 68;
export const RUST_GAMEPLAY_MAX_SNAPSHOT_BYTES_R7 = 256 * 1_048_576;
export const RUST_GAMEPLAY_MAX_SNAPSHOT_EXTENSION_BYTES_R7 = 4 * 1_048_576;

/** @deprecated Use the schema-neutral R7 constant. */
export const RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7_V1 = RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7;
/** @deprecated Use the schema-neutral R7 constant. */
export const RUST_GAMEPLAY_MAX_SNAPSHOT_BYTES_R7_V1 = RUST_GAMEPLAY_MAX_SNAPSHOT_BYTES_R7;
/** @deprecated Use the schema-neutral R7 constant. */
export const RUST_GAMEPLAY_MAX_SNAPSHOT_EXTENSION_BYTES_R7_V1 = RUST_GAMEPLAY_MAX_SNAPSHOT_EXTENSION_BYTES_R7;

const MAGIC = Uint8Array.of(0x42, 0x57, 0x47, 0x50, 0x53, 0x4e, 0x50, 0x00); // BWGPSNP\0
const HASH_BYTES = 16;
const U64_MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export type RustGameplaySnapshotSchemaR7 =
  | typeof RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1
  | typeof RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V2
  | typeof RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V3
  | typeof RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V4;

export type RustGameplaySnapshotEnvelopeR7<Schema extends RustGameplaySnapshotSchemaR7 = RustGameplaySnapshotSchemaR7> = Readonly<{
  schema: Schema;
  flags: 0;
  payloadLength: number;
  stateHash: string;
  replayHash: string;
  payloadHash: string;
  snapshotHash: string;
  /**
   * The complete Rust-owned payload. Its final bounded field contains future
   * extension bytes. The browser deliberately preserves this payload opaquely:
   * only Rust is allowed to interpret or install authority state.
   */
  payload: Uint8Array;
  bytes: Uint8Array;
}>;

/** Exact legacy V1 envelope shape retained for compatibility-oriented callers. */
export type RustGameplaySnapshotEnvelopeR7V1 = RustGameplaySnapshotEnvelopeR7<typeof RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1>;
/** Exact legacy V2 envelope shape retained for compatibility-oriented callers. */
export type RustGameplaySnapshotEnvelopeR7V2 = RustGameplaySnapshotEnvelopeR7<typeof RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V2>;
/** Exact legacy V3 envelope shape retained for compatibility-oriented callers. */
export type RustGameplaySnapshotEnvelopeR7V3 = RustGameplaySnapshotEnvelopeR7<typeof RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V3>;
/** Exact current V4 envelope shape emitted by `blockwild-gameplay`. */
export type RustGameplaySnapshotEnvelopeR7V4 = RustGameplaySnapshotEnvelopeR7<typeof RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V4>;

export type RustGameplaySnapshotEnvelopeErrorCodeR7 =
  | "capacity"
  | "truncated"
  | "magic"
  | "schema"
  | "flags"
  | "length"
  | "payload-hash";

export class RustGameplaySnapshotEnvelopeErrorR7 extends Error {
  constructor(readonly code: RustGameplaySnapshotEnvelopeErrorCodeR7, readonly offset: number, message: string) {
    super(message);
    this.name = "RustGameplaySnapshotEnvelopeErrorR7";
  }
}

function ownedBytes(value: Uint8Array | ArrayBuffer) {
  return value instanceof Uint8Array ? Uint8Array.from(value) : new Uint8Array(value.slice(0));
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function bytesToHex(bytes: Uint8Array) {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function isSupportedSchema(value: number): value is RustGameplaySnapshotSchemaR7 {
  return value >= RUST_GAMEPLAY_SNAPSHOT_MIN_SCHEMA_R7 && value <= RUST_GAMEPLAY_SNAPSHOT_CURRENT_SCHEMA_R7;
}

function hashPayload(schema: RustGameplaySnapshotSchemaR7, bytes: Uint8Array) {
  return new TypeScriptCanonicalHasher("blockwild.gameplay.snapshot.payload.v1")
    .writeU16(schema)
    .writeBytes(bytes)
    .finishHex();
}

export function rustGameplaySnapshotFileHashR7(bytes: Uint8Array | ArrayBuffer) {
  const owned = ownedBytes(bytes);
  return new TypeScriptCanonicalHasher("blockwild.gameplay.snapshot.file.v1").writeBytes(owned).finishHex();
}

/**
 * Validate the exact supported outer snapshot envelope and return owned bytes.
 *
 * This is intentionally a browser preflight, not a substitute for Rust's full
 * state/replay/idempotency/metadata decoder. A snapshot may be installed only
 * after the authority worker validates the complete opaque payload atomically.
 */
export function inspectRustGameplaySnapshotEnvelopeR7(value: Uint8Array | ArrayBuffer): RustGameplaySnapshotEnvelopeR7 {
  const bytes = ownedBytes(value);
  if (bytes.byteLength > RUST_GAMEPLAY_MAX_SNAPSHOT_BYTES_R7) {
    throw new RustGameplaySnapshotEnvelopeErrorR7("capacity", 0, "R7 gameplay snapshot exceeds 256 MiB");
  }
  if (bytes.byteLength < RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7) {
    throw new RustGameplaySnapshotEnvelopeErrorR7("truncated", bytes.byteLength, "R7 gameplay snapshot is shorter than its 68-byte header");
  }
  if (!bytesEqual(bytes.subarray(0, MAGIC.byteLength), MAGIC)) {
    throw new RustGameplaySnapshotEnvelopeErrorR7("magic", 0, "R7 gameplay snapshot magic is invalid");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const schema = view.getUint16(8, true);
  if (!isSupportedSchema(schema)) {
    throw new RustGameplaySnapshotEnvelopeErrorR7("schema", 8, `unsupported R7 gameplay snapshot schema ${schema}`);
  }
  const flags = view.getUint16(10, true);
  if (flags !== 0) throw new RustGameplaySnapshotEnvelopeErrorR7("flags", 10, `unsupported R7 gameplay snapshot flags ${flags}`);
  const payloadLength64 = view.getBigUint64(12, true);
  if (payloadLength64 > U64_MAX_SAFE) {
    throw new RustGameplaySnapshotEnvelopeErrorR7("capacity", 12, "R7 gameplay payload length cannot be represented safely in the browser");
  }
  const payloadLength = Number(payloadLength64);
  const expectedLength = RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7 + payloadLength;
  if (expectedLength !== bytes.byteLength) {
    throw new RustGameplaySnapshotEnvelopeErrorR7("length", 20, `R7 gameplay payload declares ${payloadLength} bytes but file has ${bytes.byteLength - RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7}`);
  }
  const stateHash = bytesToHex(bytes.subarray(20, 20 + HASH_BYTES));
  const replayHash = bytesToHex(bytes.subarray(36, 36 + HASH_BYTES));
  const payloadHash = bytesToHex(bytes.subarray(52, 52 + HASH_BYTES));
  const payload = Uint8Array.from(bytes.subarray(RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7));
  const actualPayloadHash = hashPayload(schema, payload);
  if (actualPayloadHash !== payloadHash) {
    throw new RustGameplaySnapshotEnvelopeErrorR7("payload-hash", RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7, "R7 gameplay payload checksum does not match the Rust envelope");
  }
  return Object.freeze({
    schema,
    flags: 0 as const,
    payloadLength,
    stateHash,
    replayHash,
    payloadHash,
    snapshotHash: rustGameplaySnapshotFileHashR7(bytes),
    payload,
    bytes,
  });
}

/** Byte-identical copy used at persistence and worker-transfer boundaries. */
export function cloneValidatedRustGameplaySnapshotR7(value: Uint8Array | ArrayBuffer) {
  return inspectRustGameplaySnapshotEnvelopeR7(value).bytes.slice();
}

/** @deprecated The R7 preflight now accepts every supported V1-V4 envelope. */
export const inspectRustGameplaySnapshotEnvelopeR7V1 = inspectRustGameplaySnapshotEnvelopeR7;
/** @deprecated Use `cloneValidatedRustGameplaySnapshotR7`. */
export const cloneValidatedRustGameplaySnapshotR7V1 = cloneValidatedRustGameplaySnapshotR7;
/** @deprecated Use `rustGameplaySnapshotFileHashR7`. */
export const rustGameplaySnapshotFileHashR7V1 = rustGameplaySnapshotFileHashR7;
