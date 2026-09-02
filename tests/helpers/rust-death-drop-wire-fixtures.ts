import { readFileSync } from "node:fs";

import { rustIntegratedRuntimeWireChecksumV1 } from "../../app/game/rust-integrated-runtime-codec.ts";

type WireVector = Readonly<{
  direction: "typescript-to-rust" | "rust-to-typescript";
  magic: string;
  byteLength: number;
  wireChecksum: string;
  hex: string;
}>;

type FixtureDocument = Readonly<{
  schema: number;
  generator: string;
  vectors: Readonly<Record<string, WireVector>>;
}>;

const fixture = JSON.parse(readFileSync(new URL(
  "../fixtures/rust-engine/integrated-runtime-v1/death-respawn-drop-wire-v1.json",
  import.meta.url,
), "utf8")) as FixtureDocument;

if (fixture.schema !== 1
  || fixture.generator !== "blockwild-engine/death_respawn_drop_wire_fixtures") {
  throw new Error("native death/drop wire fixture metadata is not V1");
}

export function nativeDeathDropWireVector(name: string) {
  const vector = fixture.vectors[name];
  if (!vector || !/^[0-9a-f]+$/u.test(vector.hex) || vector.hex.length % 2 !== 0) {
    throw new Error(`missing or malformed native death/drop wire vector ${name}`);
  }
  const bytes = Uint8Array.from(Buffer.from(vector.hex, "hex"));
  if (bytes.byteLength !== vector.byteLength
    || rustIntegratedRuntimeWireChecksumV1(bytes) !== vector.wireChecksum
    || Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== vector.magic) {
    throw new Error(`native death/drop wire vector ${name} failed retained metadata checks`);
  }
  return Object.freeze({ ...vector, bytes });
}

export function resealNativeWirePacket(
  packet: Uint8Array,
  mutate: (bytes: Uint8Array) => void,
) {
  const bytes = Uint8Array.from(packet);
  mutate(bytes);
  bytes.set(Buffer.from(rustIntegratedRuntimeWireChecksumV1(bytes.subarray(28)), "hex"), 12);
  return bytes;
}
