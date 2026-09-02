import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";

type Sampler = Readonly<{ mag: number; min: number; mip: number; wrapU: number; wrapV: number }>;
type Atlas = Readonly<{ columns: number; rows: number; tileWidth: number; tileHeight: number; edgeInset: number; origin: number }>;
type Texture = Readonly<{
  kind: 4; id: bigint; revision: number; width: number; height: number; colorSpace: number; filter: number;
  sampler: Sampler | null; atlas: Atlas | null; rgba8: Uint8Array;
}>;
type Material = Readonly<{
  kind: 0; id: bigint; revision: number; shading: number; blend: number; base: Uint8Array; emissive: Uint8Array;
  doubleSided: boolean; depthWrite: boolean; emissiveStrength: number; roughness: number; metalness: number;
  alphaCutoff: number; atlasTile: number | null;
  texture: Readonly<{ id: bigint; uvMode: number; animation: number; opacity: number }>;
}>;
type Operation = Texture | Material;
export type TextureMaterialFixtureR11 = Readonly<{
  schema: number; flags: number; epoch: bigint; revision: bigint; hash: Uint8Array; operations: readonly Operation[];
}>;

class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  raw(length: number) {
    const end = this.offset + length;
    if (!Number.isSafeInteger(length) || length < 0 || end > this.bytes.byteLength) throw new RangeError("BWRD fixture is truncated");
    const value = this.bytes.slice(this.offset, end); this.offset = end; return value;
  }
  u8() { return this.raw(1)[0]!; }
  u16() { const value = new DataView(this.raw(2).buffer).getUint16(0, true); return value; }
  u32() { return new DataView(this.raw(4).buffer).getUint32(0, true); }
  u64() { return new DataView(this.raw(8).buffer).getBigUint64(0, true); }
  f32() { return new DataView(this.raw(4).buffer).getFloat32(0, true); }
  sizedBytes() { return this.raw(this.u32()); }
  finish() { assert.equal(this.offset, this.bytes.byteLength, "BWRD fixture has trailing bytes"); }
}

class Writer {
  readonly bytes: number[] = [];
  raw(value: Uint8Array | readonly number[]) { this.bytes.push(...value); }
  u8(value: number) { this.bytes.push(value); }
  u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); this.raw(bytes); }
  u32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); this.raw(bytes); }
  u64(value: bigint) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, value, true); this.raw(bytes); }
  f32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setFloat32(0, Object.is(value, -0) ? 0 : Math.fround(value), true); this.raw(bytes); }
  sizedBytes(value: Uint8Array) { this.u32(value.byteLength); this.raw(value); }
  finish() { return Uint8Array.from(this.bytes); }
}

function decodeTexture(reader: Reader): Texture {
  const id = reader.u64(), revision = reader.u32(), width = reader.u32(), height = reader.u32();
  const colorSpace = reader.u8(), filter = reader.u8(), flags = reader.u16();
  assert.equal(flags & ~3, 0, "unknown texture extension flags");
  const sampler = flags & 1 ? Object.freeze({
    mag: reader.u8(), min: reader.u8(), mip: reader.u8(), wrapU: reader.u8(), wrapV: reader.u8(),
    ...(assert.equal(reader.u8(), 0, "texture sampler reserved byte"), {}),
  }) as Sampler : null;
  const atlas = flags & 2 ? Object.freeze({
    columns: reader.u16(), rows: reader.u16(), tileWidth: reader.u16(), tileHeight: reader.u16(), edgeInset: reader.f32(), origin: reader.u8(),
    ...(assert.deepEqual(reader.raw(3), new Uint8Array(3), "texture atlas reserved bytes"), {}),
  }) as Atlas : null;
  return Object.freeze({ kind: 4 as const, id, revision, width, height, colorSpace, filter, sampler, atlas, rgba8: reader.sizedBytes() });
}

function decodeMaterial(reader: Reader): Material {
  const id = reader.u64(), revision = reader.u32(), shading = reader.u8(), blend = reader.u8();
  const base = reader.raw(4), emissive = reader.raw(3), flags = reader.u8();
  assert.equal(flags & ~7, 0, "unknown material extension flags");
  assert.ok(flags & 4, "texture/material fixture omitted its texture binding");
  const emissiveStrength = reader.f32(), roughness = reader.f32(), metalness = reader.f32(), alphaCutoff = reader.f32();
  const tile = reader.u16();
  const textureId = reader.u64(), uvMode = reader.u8(), animation = reader.u8();
  assert.equal(reader.u16(), 0, "material texture reserved bits");
  const texture = Object.freeze({ id: textureId, uvMode, animation, opacity: reader.f32() });
  return Object.freeze({
    kind: 0 as const, id, revision, shading, blend, base, emissive,
    doubleSided: Boolean(flags & 1), depthWrite: Boolean(flags & 2), emissiveStrength, roughness, metalness,
    alphaCutoff, atlasTile: tile === 0xffff ? null : tile, texture,
  });
}

export function decodeTextureMaterialFixtureR11(bytes: Uint8Array): TextureMaterialFixtureR11 {
  const reader = new Reader(bytes);
  assert.equal(new TextDecoder().decode(reader.raw(4)), "BWRD");
  const schema = reader.u16(), flags = reader.u16();
  assert.equal(schema, 2); assert.equal(flags, 1, "texture/material BWRD extension flag");
  const epoch = reader.u64(), revision = reader.u64(), count = reader.u32(), hash = reader.raw(16);
  const operations: Operation[] = [];
  for (let index = 0; index < count; index += 1) {
    const kind = reader.u8();
    operations.push(kind === 4 ? decodeTexture(reader) : kind === 0 ? decodeMaterial(reader) : assert.fail(`unsupported fixture operation ${kind}`));
  }
  reader.finish();
  return Object.freeze({ schema, flags, epoch, revision, hash, operations: Object.freeze(operations) });
}

function encodeTexture(writer: Writer, value: Texture) {
  writer.u8(value.kind); writer.u64(value.id); writer.u32(value.revision); writer.u32(value.width); writer.u32(value.height);
  writer.u8(value.colorSpace); writer.u8(value.filter); writer.u16(Number(Boolean(value.sampler)) | Number(Boolean(value.atlas)) << 1);
  if (value.sampler) {
    writer.u8(value.sampler.mag); writer.u8(value.sampler.min); writer.u8(value.sampler.mip);
    writer.u8(value.sampler.wrapU); writer.u8(value.sampler.wrapV); writer.u8(0);
  }
  if (value.atlas) {
    writer.u16(value.atlas.columns); writer.u16(value.atlas.rows); writer.u16(value.atlas.tileWidth); writer.u16(value.atlas.tileHeight);
    writer.f32(value.atlas.edgeInset); writer.u8(value.atlas.origin); writer.raw([0, 0, 0]);
  }
  writer.sizedBytes(value.rgba8);
}

function encodeMaterial(writer: Writer, value: Material) {
  writer.u8(value.kind); writer.u64(value.id); writer.u32(value.revision); writer.u8(value.shading); writer.u8(value.blend);
  writer.raw(value.base); writer.raw(value.emissive); writer.u8(Number(value.doubleSided) | Number(value.depthWrite) << 1 | 4);
  writer.f32(value.emissiveStrength); writer.f32(value.roughness); writer.f32(value.metalness); writer.f32(value.alphaCutoff);
  writer.u16(value.atlasTile ?? 0xffff); writer.u64(value.texture.id); writer.u8(value.texture.uvMode); writer.u8(value.texture.animation); writer.u16(0); writer.f32(value.texture.opacity);
}

export function encodeTextureMaterialFixtureR11(value: TextureMaterialFixtureR11) {
  const writer = new Writer(); writer.raw(new TextEncoder().encode("BWRD")); writer.u16(value.schema); writer.u16(value.flags);
  writer.u64(value.epoch); writer.u64(value.revision); writer.u32(value.operations.length); writer.raw(value.hash);
  for (const operation of value.operations) {
    if (operation.kind === 4) encodeTexture(writer, operation);
    else encodeMaterial(writer, operation);
  }
  return writer.finish();
}

function f32Bits(value: number) {
  const bytes = new Uint8Array(4); new DataView(bytes.buffer).setFloat32(0, Object.is(value, -0) ? 0 : Math.fround(value), true);
  return new DataView(bytes.buffer).getUint32(0, true);
}

export function textureMaterialFixtureHashR11(value: TextureMaterialFixtureR11) {
  const hash = new TypeScriptCanonicalHasher("blockwild.render.resources.v2");
  hash.writeU16(value.schema).writeU64(value.epoch).writeU64(value.revision).writeU64(value.operations.length);
  for (const operation of value.operations) {
    hash.writeU16(operation.kind);
    if (operation.kind === 4) {
      hash.writeU64(operation.id).writeU32(operation.revision).writeU32(operation.width).writeU32(operation.height);
      hash.writeU16(operation.colorSpace).writeU16(operation.filter).writeBytes(operation.rgba8);
      if (operation.sampler) {
        hash.writeU16(0x5341).writeU16(operation.sampler.mag).writeU16(operation.sampler.min).writeU16(operation.sampler.mip)
          .writeU16(operation.sampler.wrapU).writeU16(operation.sampler.wrapV);
      }
      if (operation.atlas) {
        hash.writeU16(0x4154).writeU16(operation.atlas.columns).writeU16(operation.atlas.rows)
          .writeU16(operation.atlas.tileWidth).writeU16(operation.atlas.tileHeight).writeU32(f32Bits(operation.atlas.edgeInset))
          .writeU16(operation.atlas.origin);
      }
    } else {
      hash.writeU64(operation.id).writeU32(operation.revision).writeU16(operation.shading).writeU16(operation.blend)
        .writeBytes(operation.base).writeBytes(operation.emissive);
      for (const scalar of [operation.emissiveStrength, operation.roughness, operation.metalness, operation.alphaCutoff]) hash.writeU32(f32Bits(scalar));
      hash.writeU16(operation.atlasTile ?? 0xffff).writeU16(Number(operation.doubleSided)).writeU16(Number(operation.depthWrite));
      hash.writeU16(0x5458).writeU64(operation.texture.id).writeU16(operation.texture.uvMode).writeU16(operation.texture.animation)
        .writeU32(f32Bits(operation.texture.opacity));
    }
  }
  return hash.finish();
}

export function verifyTextureMaterialFixtureR11(bytes: Uint8Array) {
  const fixture = decodeTextureMaterialFixtureR11(bytes);
  assert.deepEqual(encodeTextureMaterialFixtureR11(fixture), bytes, "TypeScript BWRD re-encode differs from Rust bytes");
  assert.deepEqual(textureMaterialFixtureHashR11(fixture), fixture.hash, "TypeScript canonical hash differs from Rust");
  const texture = fixture.operations.find((operation): operation is Texture => operation.kind === 4)!;
  const materials = fixture.operations.filter((operation): operation is Material => operation.kind === 0);
  assert.deepEqual(texture.sampler, { mag: 0, min: 0, mip: 0, wrapU: 0, wrapV: 0 });
  assert.deepEqual(texture.atlas && { ...texture.atlas, edgeInset: Number(texture.atlas.edgeInset.toFixed(3)) }, {
    columns: 2, rows: 1, tileWidth: 2, tileHeight: 2, edgeInset: 0.014, origin: 0,
  });
  assert.equal(materials.length, 3);
  assert.deepEqual(materials.map((value) => ({ blend: value.blend, alpha: value.base[3], opacity: value.texture.opacity, cutoff: value.alphaCutoff, tile: value.atlasTile, uv: value.texture.uvMode, animation: value.texture.animation, doubleSided: value.doubleSided, depthWrite: value.depthWrite })), [
    { blend: 1, alpha: 255, opacity: 1, cutoff: Math.fround(0.32), tile: 0, uv: 1, animation: 0, doubleSided: true, depthWrite: true },
    { blend: 4, alpha: 255, opacity: Math.fround(0.76), cutoff: 0, tile: 1, uv: 1, animation: 1, doubleSided: true, depthWrite: false },
    { blend: 2, alpha: 255, opacity: Math.fround(0.86), cutoff: 0, tile: null, uv: 0, animation: 0, doubleSided: false, depthWrite: true },
  ]);
  return fixture;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fixturePath = path.resolve(process.argv[2] ?? path.join(root, "tests/fixtures/rust-engine/r11-renderer/texture-material-v2.bwrd"));
  const reportPath = path.join(root, "work/hybrid-rust-migration/renderer-r11/texture-material-codec.json");
  const bytes = new Uint8Array(await readFile(fixturePath));
  const fixture = verifyTextureMaterialFixtureR11(bytes);
  const hex = Buffer.from(fixture.hash).toString("hex");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ schema: 1, fixture: path.relative(root, fixturePath).replaceAll("\\", "/"), bytes: bytes.byteLength, operations: fixture.operations.length, batchHash: hex, byteExactRoundTrip: true, crossLanguageHashParity: true }, null, 2)}\n`);
  console.log(`rust_renderer_material_codec=ok bytes=${bytes.byteLength} operations=${fixture.operations.length} hash=${hex}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
