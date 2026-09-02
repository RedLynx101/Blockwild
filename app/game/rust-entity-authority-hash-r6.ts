import type { RustEntityAuthoritySnapshotR6V2 } from "./rust-entity-authority-contract-r6";
import {
  decodeRustEntityAuthoritySnapshotR6V2,
  encodeRustEntityAuthoritySnapshotR6V2,
} from "./rust-entity-authority-codec-r6";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

const AUTHORITY_HASH_DOMAIN = "blockwild.entity.authority.v2";
const HASH_PATTERN = /^[0-9a-f]{32}$/u;

/**
 * Mirrors EntityAuthority::canonical_hash from validated semantic state.
 *
 * Rust defines this hash as a domain-framed canonical BWEA serialization. The
 * independent TS serializer walks every slot, cursor, resident and component;
 * this function never hashes an unchecked received packet or an embedded hash.
 */
export function computeRustEntityAuthorityHashR6V2(snapshot: RustEntityAuthoritySnapshotR6V2): string {
  const canonical = encodeRustEntityAuthoritySnapshotR6V2(snapshot);
  // Also validate the f32-normalized wire representation. A finite JS number
  // can underflow to an invalid zero radius or otherwise change a typed bound.
  decodeRustEntityAuthoritySnapshotR6V2(canonical);
  return new TypeScriptCanonicalHasher(AUTHORITY_HASH_DOMAIN).writeBytes(canonical).finishHex();
}

export function assertRustEntityAuthorityHashR6V2(snapshot: RustEntityAuthoritySnapshotR6V2, expectedHash: string): string {
  if (typeof expectedHash !== "string" || !HASH_PATTERN.test(expectedHash)) {
    throw new TypeError("R6 authority hash must be canonical lowercase 128-bit hexadecimal");
  }
  const actualHash = computeRustEntityAuthorityHashR6V2(snapshot);
  if (actualHash !== expectedHash) throw new Error("R6 semantic entity-authority hash mismatch");
  return actualHash;
}

/** Verify a received BWEA snapshot by decoding and independently re-authoring its canonical state. */
export function decodeAndVerifyRustEntityAuthoritySnapshotR6V2(packet: Uint8Array | ArrayBuffer, expectedHash: string) {
  const snapshot = decodeRustEntityAuthoritySnapshotR6V2(packet);
  assertRustEntityAuthorityHashR6V2(snapshot, expectedHash);
  return snapshot;
}
