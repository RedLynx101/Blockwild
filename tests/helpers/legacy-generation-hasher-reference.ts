/**
 * Independent pre-limb reference, frozen before the production optimization.
 * Copied from terrain-generation-contract.ts at checkpoint 3775d22, SHA-256
 * 461388c0bbe7c535b8590bfe173baf152c5feaeb30f73db986c8977e3a699610.
 * Keep this BigInt implementation independent of production constants/helpers.
 */
const FNV_64_OFFSET = BigInt("14695981039346656037");
const FNV_64_PRIME = BigInt("1099511628211");
const HIGH_LANE_SALT = BigInt("11562461410679940143");
const HIGH_LANE_PRIME = FNV_64_PRIME ^ BigInt("315");
const BYTE_MASK = BigInt("255");

export class LegacyGenerationHasherReference {
  private low = FNV_64_OFFSET;
  private high = FNV_64_OFFSET ^ HIGH_LANE_SALT;

  constructor(domain: string) { this.writeString(domain); }

  private wrap(value: bigint) { return BigInt.asUintN(64, value); }

  private writeRawByte(byte: number) {
    const value = BigInt(byte);
    this.low = this.wrap((this.low ^ value) * FNV_64_PRIME);
    this.high = this.wrap((this.high ^ ((value << BigInt(1)) | BigInt(1))) * HIGH_LANE_PRIME);
  }

  writeU16(value: number) {
    for (let shift = 0; shift < 16; shift += 8) this.writeRawByte((value >>> shift) & 0xff);
  }

  writeU32(value: number) {
    const normalized = value >>> 0;
    for (let shift = 0; shift < 32; shift += 8) this.writeRawByte((normalized >>> shift) & 0xff);
  }

  writeI32(value: number) { this.writeU32(value); }

  writeI64(value: bigint) { this.writeU64(BigInt.asUintN(64, value)); }

  writeU8(value: number) { this.writeRawByte(value & 0xff); }

  writeU64(value: number | bigint) {
    let remaining = BigInt(value);
    for (let index = 0; index < 8; index += 1) {
      this.writeRawByte(Number(remaining & BYTE_MASK));
      remaining >>= BigInt(8);
    }
  }

  writeBytes(bytes: Uint8Array) {
    this.writeU64(bytes.byteLength);
    for (const byte of bytes) {
      const value = BigInt(byte);
      this.low = this.wrap((this.low ^ value) * FNV_64_PRIME);
      this.high = this.wrap((this.high ^ (value << BigInt(1))) * HIGH_LANE_PRIME);
    }
  }

  writeString(value: string) { this.writeBytes(new TextEncoder().encode(value)); }

  finish() {
    const bytes = new Uint8Array(16);
    for (const [offset, lane] of [[0, this.low], [8, this.high]] as const) {
      let remaining = lane;
      for (let index = 0; index < 8; index += 1) {
        bytes[offset + index] = Number(remaining & BYTE_MASK);
        remaining >>= BigInt(8);
      }
    }
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}
