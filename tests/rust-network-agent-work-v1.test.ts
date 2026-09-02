import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AGENT_COMMAND_KINDS,
  type AgentCommandKind,
} from "../app/game/agent-platform.ts";
import {
  createRustNetworkAgentWorkCommandV1,
  decodeRustNetworkAgentWorkCommandV1,
  encodeRustNetworkAgentWorkCommandV1,
  RUST_NETWORK_AGENT_WORK_MAX_ARGUMENT_BYTES_V1,
  RUST_NETWORK_AGENT_WORK_MAX_WIRE_BYTES_V1,
  RUST_NETWORK_AGENT_WORK_MAX_WORK_UNITS_V1,
  type RustNetworkAgentWorkCommandSourceV1,
} from "../app/game/rust-network-agent-work-v1.ts";

type Fixture = Readonly<{
  browserAgentCommand: Readonly<{ nestedWorkBwa1Hex: string }>;
}>;

const FIXTURE = JSON.parse(readFileSync(
  new URL("./fixtures/rust-engine/integrated-runtime-v1/r9-network-wire-fixture.json", import.meta.url),
  "utf8",
)) as Fixture;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fromHex(value: string) {
  assert.match(value, /^(?:[0-9a-f]{2})+$/u);
  return Uint8Array.from({ length: value.length / 2 }, (_, index) => (
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  ));
}

function toHex(value: Uint8Array) {
  return Buffer.from(value).toString("hex");
}

function source(overrides: Partial<RustNetworkAgentWorkCommandSourceV1> = {}) {
  return {
    commandId: "command:fixture-1",
    agentId: "agent:fixture-1",
    kind: "observe" as AgentCommandKind,
    expectedWorldRevision: 41,
    issuedAt: 1_100,
    expiresAt: 10_100,
    workUnits: 1,
    taskId: null,
    arguments: encoder.encode("fixture"),
    ...overrides,
  } satisfies RustNetworkAgentWorkCommandSourceV1;
}

function fieldOffsets(packet: Uint8Array) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  let cursor = 8;
  const commandLength = view.getUint16(cursor, true);
  const commandOffset = cursor + 2;
  cursor = commandOffset + commandLength;
  const agentLength = view.getUint16(cursor, true);
  cursor += 2 + agentLength;
  const kind = cursor;
  const expectedWorldRevision = kind + 1;
  const workUnits = expectedWorldRevision + 24;
  const taskFlag = workUnits + 2;
  const argumentLength = taskFlag + 1;
  return { commandOffset, kind, expectedWorldRevision, workUnits, taskFlag, argumentLength };
}

test("public BWA1 codec independently decodes and exactly re-encodes the Rust-authored R9 work packet", () => {
  const packet = fromHex(FIXTURE.browserAgentCommand.nestedWorkBwa1Hex);
  const decoded = decodeRustNetworkAgentWorkCommandV1(packet);
  assert.deepEqual(
    {
      schema: decoded.schema,
      protocol: decoded.protocol,
      commandId: decoded.commandId,
      agentId: decoded.agentId,
      kind: decoded.kind,
      expectedWorldRevision: decoded.expectedWorldRevision,
      issuedAt: decoded.issuedAt,
      expiresAt: decoded.expiresAt,
      workUnits: decoded.workUnits,
      taskId: decoded.taskId,
      arguments: decoder.decode(decoded.arguments),
      commandHash: decoded.commandHash,
    },
    {
      schema: 1,
      protocol: 1,
      commandId: "cmd-agent-1",
      agentId: "agent:field-drone-1",
      kind: "harvest_area",
      expectedWorldRevision: 41,
      issuedAt: 1_100,
      expiresAt: 10_100,
      workUnits: 12,
      taskId: "task:harvest-1",
      arguments: "radius=8;resource=frostpine",
      commandHash: toHex(packet.subarray(packet.byteLength - 16)),
    },
  );
  assert.equal(toHex(encodeRustNetworkAgentWorkCommandV1(decoded)), FIXTURE.browserAgentCommand.nestedWorkBwa1Hex);
  assert.equal(toHex(encodeRustNetworkAgentWorkCommandV1({
    commandId: decoded.commandId,
    agentId: decoded.agentId,
    kind: decoded.kind,
    expectedWorldRevision: decoded.expectedWorldRevision,
    issuedAt: decoded.issuedAt,
    expiresAt: decoded.expiresAt,
    workUnits: decoded.workUnits,
    taskId: decoded.taskId,
    arguments: decoded.arguments,
  })), FIXTURE.browserAgentCommand.nestedWorkBwa1Hex);
});

test("BWA1 command kind tags preserve the complete canonical Rust ordering", () => {
  AGENT_COMMAND_KINDS.forEach((kind, index) => {
    const value = createRustNetworkAgentWorkCommandV1(source({
      commandId: `command:${index}`,
      kind,
    }));
    const encoded = encodeRustNetworkAgentWorkCommandV1(value);
    const decoded = decodeRustNetworkAgentWorkCommandV1(encoded);
    assert.equal(decoded.kind, kind);
    assert.equal(decoded.commandHash, value.commandHash);
    assert.equal(toHex(encodeRustNetworkAgentWorkCommandV1(decoded)), toHex(encoded));
  });
});

test("BWA1 preserves exact safe-u64, work-unit, binary, and maximum argument boundaries", () => {
  const boundary = createRustNetworkAgentWorkCommandV1(source({
    expectedWorldRevision: Number.MAX_SAFE_INTEGER,
    issuedAt: Number.MAX_SAFE_INTEGER - 600_000,
    expiresAt: Number.MAX_SAFE_INTEGER,
    workUnits: RUST_NETWORK_AGENT_WORK_MAX_WORK_UNITS_V1,
    taskId: "task:boundary-1",
    arguments: Uint8Array.of(0, 0x7f, 0x80, 0xff),
  }));
  const decodedBoundary = decodeRustNetworkAgentWorkCommandV1(
    encodeRustNetworkAgentWorkCommandV1(boundary),
  );
  assert.deepEqual([...decodedBoundary.arguments], [0, 0x7f, 0x80, 0xff]);
  assert.equal(decodedBoundary.expectedWorldRevision, Number.MAX_SAFE_INTEGER);
  assert.equal(decodedBoundary.workUnits, RUST_NETWORK_AGENT_WORK_MAX_WORK_UNITS_V1);

  const maximumArguments = new Uint8Array(RUST_NETWORK_AGENT_WORK_MAX_ARGUMENT_BYTES_V1);
  maximumArguments[0] = 0x80;
  maximumArguments[maximumArguments.byteLength - 1] = 0xff;
  const maximumWire = encodeRustNetworkAgentWorkCommandV1(source({ arguments: maximumArguments }));
  assert.ok(maximumWire.byteLength <= RUST_NETWORK_AGENT_WORK_MAX_WIRE_BYTES_V1);
  const decodedMaximum = decodeRustNetworkAgentWorkCommandV1(maximumWire);
  assert.equal(decodedMaximum.arguments.byteLength, RUST_NETWORK_AGENT_WORK_MAX_ARGUMENT_BYTES_V1);
  assert.equal(decodedMaximum.arguments[0], 0x80);
  assert.equal(decodedMaximum.arguments[decodedMaximum.arguments.byteLength - 1], 0xff);
});

test("BWA1 source validation rejects invalid IDs, kinds, integers, lifetime, units, arguments, and supplied hashes", () => {
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1(source({ commandId: "_invalid" })), /identifier/u);
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1(source({ agentId: "agent snow" })), /identifier/u);
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1(source({ taskId: "task snow" })), /identifier/u);
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1(source({ kind: "unknown" as AgentCommandKind })), /kind/u);
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1(source({ expectedWorldRevision: Number.MAX_SAFE_INTEGER + 1 })), /exact u64/u);
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1(source({ issuedAt: 2_000, expiresAt: 1_999 })), /lifetime/u);
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1(source({ issuedAt: 1, expiresAt: 600_002 })), /lifetime/u);
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1(source({ workUnits: 0 })), /work units/u);
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1(source({ workUnits: RUST_NETWORK_AGENT_WORK_MAX_WORK_UNITS_V1 + 1 })), /work units/u);
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1(source({
    arguments: new Uint8Array(RUST_NETWORK_AGENT_WORK_MAX_ARGUMENT_BYTES_V1 + 1),
  })), /arguments/u);
  const valid = createRustNetworkAgentWorkCommandV1(source());
  assert.throws(() => encodeRustNetworkAgentWorkCommandV1({
    ...valid,
    commandHash: "0".repeat(32),
  }), /hash mismatch/u);
});

test("BWA1 decoding fails closed on malformed, unsafe, noncanonical, oversized, and trailing packets", () => {
  const canonical = encodeRustNetworkAgentWorkCommandV1(source({ taskId: "task:fixture-1" }));
  const offsets = fieldOffsets(canonical);

  const badMagic = Uint8Array.from(canonical);
  badMagic[0] ^= 1;
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(badMagic), /magic/u);

  const badVersion = Uint8Array.from(canonical);
  badVersion[6] = 2;
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(badVersion), /version/u);

  const badUtf8 = Uint8Array.from(canonical);
  badUtf8[offsets.commandOffset] = 0xff;
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(badUtf8), /UTF-8/u);

  const badIdentifier = Uint8Array.from(canonical);
  badIdentifier[offsets.commandOffset] = "_".charCodeAt(0);
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(badIdentifier), /identifier/u);

  const badKind = Uint8Array.from(canonical);
  badKind[offsets.kind] = 0xff;
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(badKind), /kind/u);

  const unsafeInteger = Uint8Array.from(canonical);
  const unsafeView = new DataView(unsafeInteger.buffer, unsafeInteger.byteOffset, unsafeInteger.byteLength);
  unsafeView.setUint32(offsets.expectedWorldRevision, 0, true);
  unsafeView.setUint32(offsets.expectedWorldRevision + 4, 0x20_0000, true);
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(unsafeInteger), /exact u64/u);

  const badWorkUnits = Uint8Array.from(canonical);
  new DataView(badWorkUnits.buffer, badWorkUnits.byteOffset, badWorkUnits.byteLength)
    .setUint16(offsets.workUnits, 0, true);
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(badWorkUnits), /work units/u);

  const badTaskFlag = Uint8Array.from(canonical);
  badTaskFlag[offsets.taskFlag] = 2;
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(badTaskFlag), /presence flag/u);

  const excessiveArgumentLength = Uint8Array.from(encodeRustNetworkAgentWorkCommandV1(source()));
  const noTaskOffsets = fieldOffsets(excessiveArgumentLength);
  new DataView(excessiveArgumentLength.buffer, excessiveArgumentLength.byteOffset, excessiveArgumentLength.byteLength)
    .setUint32(noTaskOffsets.argumentLength, RUST_NETWORK_AGENT_WORK_MAX_ARGUMENT_BYTES_V1 + 1, true);
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(excessiveArgumentLength), /arguments/u);

  const hashTamper = Uint8Array.from(canonical);
  hashTamper[hashTamper.byteLength - 1] ^= 1;
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(hashTamper), /hash mismatch/u);

  const trailing = new Uint8Array(canonical.byteLength + 1);
  trailing.set(canonical);
  assert.throws(() => decodeRustNetworkAgentWorkCommandV1(trailing), /trailing/u);

  for (const length of [0, 4, 8, canonical.byteLength - 1]) {
    assert.throws(() => decodeRustNetworkAgentWorkCommandV1(canonical.subarray(0, length)), /truncated/u);
  }
  assert.throws(
    () => decodeRustNetworkAgentWorkCommandV1(new Uint8Array(RUST_NETWORK_AGENT_WORK_MAX_WIRE_BYTES_V1 + 1)),
    /wire exceeds/u,
  );
});
