import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decodeRustIntegratedCameraConfigR10,
  decodeRustIntegratedCameraConfigReceiptR10,
  encodeRustIntegratedCameraConfigR10,
  encodeRustIntegratedCameraConfigReceiptR10,
  rustIntegratedCameraStateHashR10,
  RustIntegratedCameraWireErrorR10,
  type RustIntegratedCameraProfileR10,
} from "../app/game/rust-integrated-runtime-camera-r10.ts";
import {
  decodeRustIntegratedRuntimeRequestV1,
  decodeRustIntegratedRuntimeResponseV1,
  encodeRustIntegratedRuntimeRequestV1,
  encodeRustIntegratedRuntimeResponseV1,
  rustIntegratedRuntimeExtractionChecksumV1,
  rustIntegratedRuntimeWireChecksumV1,
  RustIntegratedRuntimeCodecError,
} from "../app/game/rust-integrated-runtime-codec.ts";
import type {
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeRequestV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import { RustIntegratedRuntimeServiceV1 } from "../app/game/rust-integrated-runtime-service.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/integrated-runtime-v1/wire-fixtures.json", import.meta.url), "utf8")) as {
  envelopes: readonly { name: string; direction: "request" | "response"; hex: string }[];
  cameraPackets: readonly { name: string; hex: string }[];
};
const ZERO_HASH = "0".repeat(32);

function profile(): RustIntegratedCameraProfileR10 {
  return Object.freeze({
    eyeHeight: 1.62,
    thirdPersonTargetHeight: 1.34,
    thirdPersonDistance: 4.35,
    thirdPersonPitchScale: 0.72,
    rearShoulderOffset: 0.22,
    collisionRadius: 0.18,
    collisionPadding: 0.16,
    minimumDistance: 0.28,
    baseVerticalFovRadians: 72 * Math.PI / 180,
    aimVerticalFovRadians: 72 * 0.68 * Math.PI / 180,
    near: 0.05,
    far: 512,
  });
}

function identity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "camera-universe",
    locationId: "surface",
    revision: Object.freeze({ epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5, network: 6, simulation: 7 }),
    tick: 8,
    stateHash: "1".repeat(32),
  });
}

function viewRequest(): Extract<RustIntegratedRuntimeRequestV1, { type: "runtime-extract-v1" }> {
  return Object.freeze({
    type: "runtime-extract-v1",
    requestId: 41,
    clientEpoch: 3,
    expected: identity(),
    afterRevision: 9,
    maxBytes: 6 * 1024 * 1024,
    view: Object.freeze({ viewportWidth: 1920, viewportHeight: 1080, viewRevision: 11 }),
  });
}

function hex(bytes: Uint8Array) { return Buffer.from(bytes).toString("hex"); }
function fixtureHex(name: string) {
  const match = [...FIXTURE.envelopes, ...FIXTURE.cameraPackets].find((entry) => entry.name === name);
  assert.ok(match, `missing fixture ${name}`);
  return match.hex;
}

function resealEnvelope(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(24, bytes.byteLength - 44, true);
  bytes.set(Buffer.from(rustIntegratedRuntimeWireChecksumV1(bytes.subarray(44)), "hex"), 28);
}

function resealDomain(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(8, bytes.byteLength - 28, true);
  bytes.set(Buffer.from(rustIntegratedRuntimeWireChecksumV1(bytes.subarray(28)), "hex"), 12);
}

test("schema-5 ExtractView is exact, bounded, and leaves schema-2 bytes unchanged", () => {
  const legacy: RustIntegratedRuntimeRequestV1 = Object.freeze({
    type: "runtime-extract-v1",
    requestId: 41,
    clientEpoch: 3,
    expected: identity(),
    afterRevision: 9,
    maxBytes: 6 * 1024 * 1024,
  });
  const legacyBytes = encodeRustIntegratedRuntimeRequestV1(legacy);
  const viewBytes = encodeRustIntegratedRuntimeRequestV1(viewRequest());
  assert.equal(new DataView(legacyBytes.buffer).getUint16(6, true), 2);
  assert.equal(new DataView(viewBytes.buffer).getUint16(6, true), 5);
  assert.deepEqual(viewBytes.subarray(44, viewBytes.byteLength - 16), legacyBytes.subarray(44));
  assert.deepEqual(decodeRustIntegratedRuntimeRequestV1(legacyBytes), legacy);
  assert.deepEqual(decodeRustIntegratedRuntimeRequestV1(viewBytes), viewRequest());
  assert.equal(hex(viewBytes), fixtureHex("extract-view-v5-1920x1080"));

  for (const invalid of [
    { ...viewRequest(), view: { ...viewRequest().view!, viewportWidth: 0 } },
    { ...viewRequest(), view: { ...viewRequest().view!, viewportHeight: 16_385 } },
    { ...viewRequest(), view: { ...viewRequest().view!, viewRevision: Number.MAX_SAFE_INTEGER + 1 } },
  ]) {
    assert.throws(
      () => encodeRustIntegratedRuntimeRequestV1(invalid),
      (error: unknown) => error instanceof RustIntegratedRuntimeCodecError,
    );
  }

  const v5AsV2 = viewBytes.slice();
  new DataView(v5AsV2.buffer).setUint16(6, 2, true);
  assert.throws(
    () => decodeRustIntegratedRuntimeRequestV1(v5AsV2),
    (error: unknown) => error instanceof RustIntegratedRuntimeCodecError && error.code === "trailing-bytes",
  );
  const zeroWidth = viewBytes.slice();
  new DataView(zeroWidth.buffer).setUint32(zeroWidth.byteLength - 16, 0, true);
  resealEnvelope(zeroWidth);
  assert.throws(
    () => decodeRustIntegratedRuntimeRequestV1(zeroWidth),
    (error: unknown) => error instanceof RustIntegratedRuntimeCodecError && error.code === "invalid-integer",
  );
  const unsafeRevision = viewBytes.slice();
  new DataView(unsafeRevision.buffer).setBigUint64(unsafeRevision.byteLength - 8, BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), true);
  resealEnvelope(unsafeRevision);
  assert.throws(
    () => decodeRustIntegratedRuntimeRequestV1(unsafeRevision),
    (error: unknown) => error instanceof RustIntegratedRuntimeCodecError && error.code === "unsafe-u64",
  );
});

test("schema 5 is valid only for ExtractView requests and never for responses", () => {
  const command = encodeRustIntegratedRuntimeRequestV1({
    type: "runtime-shutdown-v1",
    requestId: 7,
    clientEpoch: 3,
    expected: null,
  });
  new DataView(command.buffer).setUint16(6, 5, true);
  assert.throws(
    () => decodeRustIntegratedRuntimeRequestV1(command),
    (error: unknown) => error instanceof RustIntegratedRuntimeCodecError && error.code === "runtime-schema",
  );
  const shutdown = encodeRustIntegratedRuntimeResponseV1({
    type: "runtime-shutdown-v1",
    requestId: 7,
    clientEpoch: 3,
    workerEpoch: 2,
  });
  new DataView(shutdown.buffer).setUint16(6, 5, true);
  assert.throws(
    () => decodeRustIntegratedRuntimeResponseV1(shutdown),
    (error: unknown) => error instanceof RustIntegratedRuntimeCodecError && error.code === "runtime-schema",
  );
});

test("service selects schema-5 view extraction only for callers that provide a complete view", async () => {
  const extractRequests: Extract<RustIntegratedRuntimeRequestV1, { type: "runtime-extract-v1" }>[] = [];
  const current = identity();
  const service = new RustIntegratedRuntimeServiceV1({
    mode: "protocol-test",
    transportFactory: () => ({
      async request(request) {
        if (request.type === "runtime-create-v1") return {
          type: "runtime-ready-v1" as const,
          requestId: request.requestId,
          clientEpoch: request.clientEpoch,
          workerEpoch: 1,
          runtimeHandle: 1,
          identity: current,
          artifactHash: "fixture",
          instanceId: "camera-wire",
          capabilities: ["awaited-receipts-v1", "bounded-extraction-v1", "integrated-runtime-v1"],
        };
        if (request.type === "runtime-extract-v1") {
          extractRequests.push(request);
          const value = {
            identity: current,
            extractionRevision: extractRequests.length,
            render: new Uint8Array(),
            hud: new Uint8Array(),
            audio: new Uint8Array(),
            platformRequests: new Uint8Array(),
            diagnostics: new Uint8Array(),
          };
          return {
            type: "runtime-extraction-v1" as const,
            requestId: request.requestId,
            clientEpoch: request.clientEpoch,
            workerEpoch: 1,
            extraction: Object.freeze({ ...value, extractionHash: rustIntegratedRuntimeExtractionChecksumV1(value) }),
          };
        }
        throw new Error(`unexpected request ${request.type}`);
      },
      dispose() {},
    }),
  });
  await service.start({
    worldSeed: "camera",
    universeId: current.universeId,
    locationId: current.locationId,
    sessionId: "camera-wire",
    contentHash: "2".repeat(32),
    generatorHash: "3".repeat(32),
    terrainContentHash: "cc59903be77dfe30109d15bfaf0e3022",
    generationOptionsJson: "{\"biomeScale\":1.35,\"caveFrequency\":1,\"enabledFactions\":[\"hobbits\",\"goblins\",\"atlantians\",\"sugarcourt\",\"wood-elves\",\"dwarves\"],\"largeTownFrequency\":\"balanced\",\"profile\":\"world-below-v15\",\"resourceAbundance\":1,\"roadCoverage\":\"regional\",\"settlementClustering\":\"regional\",\"settlementDensity\":1,\"settlementPattern\":\"heartlands-v2\",\"structures\":true}",
    waterBlockId: 2,
    directionalBlockIds: [],
    waterloggedBlockIds: [],
  });
  await service.extract(0);
  await service.extract(1, 1024, { viewportWidth: 1920, viewportHeight: 1080, viewRevision: 5 });
  assert.equal(extractRequests[0]?.view, undefined);
  assert.deepEqual(extractRequests[1]?.view, { viewportWidth: 1920, viewportHeight: 1080, viewRevision: 5 });
  assert.equal(new DataView(encodeRustIntegratedRuntimeRequestV1(extractRequests[0]!).buffer).getUint16(6, true), 2);
  assert.equal(new DataView(encodeRustIntegratedRuntimeRequestV1(extractRequests[1]!).buffer).getUint16(6, true), 5);
});

test("absolute BWC5 camera configuration and BWR5 receipt match native fixtures", () => {
  const config = Object.freeze({ expectedCameraRevision: BigInt(7), mode: "third-rear" as const, profile: profile() });
  const configBytes = encodeRustIntegratedCameraConfigR10(config);
  assert.deepEqual(decodeRustIntegratedCameraConfigR10(configBytes), config);
  assert.equal(hex(configBytes), fixtureHex("camera-config-bwc5-third-rear"));

  const requestPayloadHash = rustIntegratedRuntimeWireChecksumV1(configBytes);
  const receipt = Object.freeze({
    requestPayloadHash,
    previousCameraRevision: BigInt(7),
    resultingCameraRevision: BigInt(8),
    mode: config.mode,
    profile: config.profile,
    cameraStateHash: rustIntegratedCameraStateHashR10(BigInt(8), config.mode, config.profile),
  });
  const receiptBytes = encodeRustIntegratedCameraConfigReceiptR10(receipt);
  assert.deepEqual(decodeRustIntegratedCameraConfigReceiptR10(receiptBytes), receipt);
  assert.equal(hex(receiptBytes), fixtureHex("camera-config-receipt-bwr5-changed"));

  const idempotent = Object.freeze({
    ...receipt,
    previousCameraRevision: BigInt(8),
    resultingCameraRevision: BigInt(8),
  });
  assert.deepEqual(decodeRustIntegratedCameraConfigReceiptR10(encodeRustIntegratedCameraConfigReceiptR10(idempotent)), idempotent);
});

test("camera packets reject invalid profiles, revisions, modes, hashes, and trailing bytes", () => {
  const valid = Object.freeze({ expectedCameraRevision: BigInt(1), mode: "first" as const, profile: profile() });
  assert.throws(
    () => encodeRustIntegratedCameraConfigR10({ ...valid, expectedCameraRevision: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1) }),
    (error: unknown) => error instanceof RustIntegratedCameraWireErrorR10 && error.code === "camera-revision",
  );
  assert.throws(
    () => encodeRustIntegratedCameraConfigR10({ ...valid, profile: { ...profile(), far: 0.01 } }),
    (error: unknown) => error instanceof RustIntegratedCameraWireErrorR10 && error.code === "camera-profile",
  );

  const unknownMode = encodeRustIntegratedCameraConfigR10(valid).slice();
  unknownMode[28 + 8] = 0xff;
  resealDomain(unknownMode);
  assert.throws(
    () => decodeRustIntegratedCameraConfigR10(unknownMode),
    (error: unknown) => error instanceof RustIntegratedCameraWireErrorR10 && error.code === "camera-mode",
  );

  const trailing = new Uint8Array(encodeRustIntegratedCameraConfigR10(valid).byteLength + 1);
  trailing.set(encodeRustIntegratedCameraConfigR10(valid));
  trailing[trailing.byteLength - 1] = 0xaa;
  resealDomain(trailing);
  assert.throws(
    () => decodeRustIntegratedCameraConfigR10(trailing),
    (error: unknown) => error instanceof RustIntegratedCameraWireErrorR10 && error.code === "camera-trailing",
  );

  const invalidReceipt = Object.freeze({
    requestPayloadHash: ZERO_HASH,
    previousCameraRevision: BigInt(1),
    resultingCameraRevision: BigInt(3),
    mode: "first" as const,
    profile: profile(),
    cameraStateHash: rustIntegratedCameraStateHashR10(BigInt(3), "first", profile()),
  });
  assert.throws(
    () => encodeRustIntegratedCameraConfigReceiptR10(invalidReceipt),
    (error: unknown) => error instanceof RustIntegratedCameraWireErrorR10 && error.code === "camera-revision",
  );
  assert.throws(
    () => encodeRustIntegratedCameraConfigReceiptR10({ ...invalidReceipt, resultingCameraRevision: BigInt(2), cameraStateHash: ZERO_HASH }),
    (error: unknown) => error instanceof RustIntegratedCameraWireErrorR10 && error.code === "camera-state-hash",
  );
});
