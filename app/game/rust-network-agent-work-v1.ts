import {
  AGENT_COMMAND_KINDS,
  type AgentCommandKind,
} from "./agent-platform";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

export const RUST_NETWORK_AGENT_WORK_SCHEMA_V1 = 1 as const;
export const RUST_NETWORK_AGENT_WORK_PROTOCOL_V1 = 1 as const;
export const RUST_NETWORK_AGENT_WORK_MAX_ARGUMENT_BYTES_V1 = 128 * 1024;
export const RUST_NETWORK_AGENT_WORK_MAX_WIRE_BYTES_V1 = RUST_NETWORK_AGENT_WORK_MAX_ARGUMENT_BYTES_V1 + 1024;
export const RUST_NETWORK_AGENT_WORK_MAX_WORK_UNITS_V1 = 2_048;

const MAGIC = new TextEncoder().encode("BWA1");
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const MAX_SAFE_U64 = Number.MAX_SAFE_INTEGER;
const MAX_LIFETIME_MILLISECONDS = 10 * 60_000;

export type RustNetworkAgentWorkCommandSourceV1 = Readonly<{
  commandId: string;
  agentId: string;
  kind: AgentCommandKind;
  expectedWorldRevision: number;
  issuedAt: number;
  expiresAt: number;
  workUnits: number;
  taskId?: string | null;
  arguments: Uint8Array;
}>;

export type RustNetworkAgentWorkCommandV1 = Readonly<{
  schema: typeof RUST_NETWORK_AGENT_WORK_SCHEMA_V1;
  protocol: typeof RUST_NETWORK_AGENT_WORK_PROTOCOL_V1;
  commandId: string;
  agentId: string;
  kind: AgentCommandKind;
  expectedWorldRevision: number;
  issuedAt: number;
  expiresAt: number;
  workUnits: number;
  taskId: string | null;
  arguments: Uint8Array;
  commandHash: string;
}>;

export class RustNetworkAgentWorkV1Error extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RustNetworkAgentWorkV1Error";
  }
}

function fail(code: string, message: string): never {
  throw new RustNetworkAgentWorkV1Error(code, message);
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hashBytes(value: string) {
  if (!HASH_PATTERN.test(value)) fail("hash", "agent work hash must be canonical 128-bit lowercase hex");
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function safeU64(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_SAFE_U64) {
    fail("integer", `${name} exceeds JavaScript's exact u64 range`);
  }
}

function agentId(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string"
    || encoder.encode(value).byteLength < 1
    || encoder.encode(value).byteLength > 128
    || !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/u.test(value)) {
    fail("agent-id", `${name} is not a canonical Rust agent identifier`);
  }
}

function canonicalCommand(source: RustNetworkAgentWorkCommandSourceV1): RustNetworkAgentWorkCommandV1 {
  agentId(source.commandId, "agent work command ID");
  agentId(source.agentId, "agent work agent ID");
  if (!AGENT_COMMAND_KINDS.includes(source.kind)) fail("agent-kind", "unknown agent command kind");
  safeU64(source.expectedWorldRevision, "agent work expected world revision");
  safeU64(source.issuedAt, "agent work issued timestamp");
  safeU64(source.expiresAt, "agent work expiry timestamp");
  if (source.expiresAt < source.issuedAt || source.expiresAt - source.issuedAt > MAX_LIFETIME_MILLISECONDS) {
    fail("integer", "agent work timestamps exceed the Rust V1 lifetime bound");
  }
  if (!Number.isInteger(source.workUnits)
    || source.workUnits < 1
    || source.workUnits > RUST_NETWORK_AGENT_WORK_MAX_WORK_UNITS_V1) {
    fail("agent-size", "agent work units exceed the Rust V1 budget");
  }
  const taskId = source.taskId ?? null;
  if (taskId !== null) agentId(taskId, "agent work task ID");
  if (!(source.arguments instanceof Uint8Array)
    || source.arguments.byteLength > RUST_NETWORK_AGENT_WORK_MAX_ARGUMENT_BYTES_V1) {
    fail("agent-size", "agent work arguments exceed the Rust V1 budget");
  }
  const argumentsBytes = Uint8Array.from(source.arguments);
  const commandHash = new TypeScriptCanonicalHasher("blockwild-agent-work-command-v1")
    .writeU16(RUST_NETWORK_AGENT_WORK_SCHEMA_V1)
    .writeU16(RUST_NETWORK_AGENT_WORK_PROTOCOL_V1)
    .writeString(source.commandId)
    .writeString(source.agentId)
    .writeString(source.kind)
    .writeU64(source.expectedWorldRevision)
    .writeU64(source.issuedAt)
    .writeU64(source.expiresAt)
    .writeU16(source.workUnits)
    .writeU16(taskId === null ? 0 : 1);
  if (taskId !== null) commandHash.writeString(taskId);
  commandHash.writeBytes(argumentsBytes);
  return Object.freeze({
    schema: RUST_NETWORK_AGENT_WORK_SCHEMA_V1,
    protocol: RUST_NETWORK_AGENT_WORK_PROTOCOL_V1,
    commandId: source.commandId,
    agentId: source.agentId,
    kind: source.kind,
    expectedWorldRevision: source.expectedWorldRevision,
    issuedAt: source.issuedAt,
    expiresAt: source.expiresAt,
    workUnits: source.workUnits,
    taskId,
    arguments: argumentsBytes,
    commandHash: commandHash.finishHex(),
  });
}

export function createRustNetworkAgentWorkCommandV1(
  source: RustNetworkAgentWorkCommandSourceV1,
): RustNetworkAgentWorkCommandV1 {
  return canonicalCommand(source);
}

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  private append(value: Uint8Array) {
    this.parts.push(value);
    this.length += value.byteLength;
  }

  raw(value: Uint8Array) { this.append(value); }
  u8(value: number) { this.append(Uint8Array.of(value)); }
  u16(value: number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    this.append(bytes);
  }
  u32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.append(bytes);
  }
  u64(value: number) {
    safeU64(value, "agent work u64");
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, value >>> 0, true);
    view.setUint32(4, Math.floor(value / 0x1_0000_0000), true);
    this.append(bytes);
  }
  bytes(value: Uint8Array) {
    this.u32(value.byteLength);
    this.append(value);
  }
  string(value: string) {
    const bytes = encoder.encode(value);
    this.u16(bytes.byteLength);
    this.append(bytes);
  }
  finish() {
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    return output;
  }
}

class Reader {
  private offset = 0;

  constructor(private readonly source: Uint8Array) {}

  take(length: number) {
    const end = this.offset + length;
    if (!Number.isSafeInteger(length) || length < 0 || end > this.source.byteLength) {
      fail("truncated", "agent work wire is truncated");
    }
    const value = this.source.subarray(this.offset, end);
    this.offset = end;
    return value;
  }
  u8() { return this.take(1)[0]; }
  u16() {
    const bytes = this.take(2);
    return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, true);
  }
  u32() {
    const bytes = this.take(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }
  u64() {
    const bytes = this.take(8);
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
    const value = view.getUint32(0, true) + view.getUint32(4, true) * 0x1_0000_0000;
    safeU64(value, "agent work u64");
    return value;
  }
  string() {
    const length = this.u16();
    if (length > 128) fail("agent-id", "agent work string exceeds the Rust V1 bound");
    try {
      return decoder.decode(this.take(length));
    }
    catch {
      return fail("agent-id", "agent work string is not valid UTF-8");
    }
  }
  finish() {
    if (this.offset !== this.source.byteLength) fail("trailing", "agent work wire contains trailing bytes");
  }
}

export function encodeRustNetworkAgentWorkCommandV1(
  value: RustNetworkAgentWorkCommandSourceV1 | RustNetworkAgentWorkCommandV1,
) {
  if ("schema" in value && value.schema !== RUST_NETWORK_AGENT_WORK_SCHEMA_V1) {
    fail("protocol", "agent work schema is not V1");
  }
  if ("protocol" in value && value.protocol !== RUST_NETWORK_AGENT_WORK_PROTOCOL_V1) {
    fail("protocol", "agent work protocol is not V1");
  }
  const canonical = canonicalCommand(value);
  if ("commandHash" in value && value.commandHash !== canonical.commandHash) {
    fail("hash", "agent work command hash mismatch");
  }
  const kindTag = AGENT_COMMAND_KINDS.indexOf(canonical.kind);
  const writer = new Writer();
  writer.raw(MAGIC);
  writer.u16(canonical.schema);
  writer.u16(canonical.protocol);
  writer.string(canonical.commandId);
  writer.string(canonical.agentId);
  writer.u8(kindTag);
  writer.u64(canonical.expectedWorldRevision);
  writer.u64(canonical.issuedAt);
  writer.u64(canonical.expiresAt);
  writer.u16(canonical.workUnits);
  writer.u8(canonical.taskId === null ? 0 : 1);
  if (canonical.taskId !== null) writer.string(canonical.taskId);
  writer.bytes(canonical.arguments);
  writer.raw(hashBytes(canonical.commandHash));
  const output = writer.finish();
  if (output.byteLength > RUST_NETWORK_AGENT_WORK_MAX_WIRE_BYTES_V1) {
    fail("agent-size", "encoded agent work command exceeds the Rust V1 wire budget");
  }
  return output;
}

export function decodeRustNetworkAgentWorkCommandV1(bytes: Uint8Array): RustNetworkAgentWorkCommandV1 {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > RUST_NETWORK_AGENT_WORK_MAX_WIRE_BYTES_V1) {
    fail("agent-size", "agent work wire exceeds the Rust V1 budget");
  }
  const reader = new Reader(bytes);
  if (hex(reader.take(4)) !== hex(MAGIC)) fail("magic", "agent work wire magic is not BWA1");
  const schema = reader.u16();
  const protocol = reader.u16();
  if (schema !== RUST_NETWORK_AGENT_WORK_SCHEMA_V1 || protocol !== RUST_NETWORK_AGENT_WORK_PROTOCOL_V1) {
    fail("protocol", "agent work wire version mismatch");
  }
  const commandId = reader.string();
  const agentIdValue = reader.string();
  const kind = AGENT_COMMAND_KINDS[reader.u8()];
  if (kind === undefined) fail("agent-kind", "invalid agent command kind");
  const expectedWorldRevision = reader.u64();
  const issuedAt = reader.u64();
  const expiresAt = reader.u64();
  const workUnits = reader.u16();
  const taskFlag = reader.u8();
  if (taskFlag !== 0 && taskFlag !== 1) fail("flag", "invalid agent work task ID presence flag");
  const taskId = taskFlag === 1 ? reader.string() : null;
  const argumentLength = reader.u32();
  if (argumentLength > RUST_NETWORK_AGENT_WORK_MAX_ARGUMENT_BYTES_V1) {
    fail("agent-size", "agent work arguments exceed the Rust V1 budget");
  }
  const argumentsBytes = Uint8Array.from(reader.take(argumentLength));
  const suppliedHash = hex(reader.take(16));
  reader.finish();
  const canonical = canonicalCommand({
    commandId,
    agentId: agentIdValue,
    kind,
    expectedWorldRevision,
    issuedAt,
    expiresAt,
    workUnits,
    taskId,
    arguments: argumentsBytes,
  });
  if (suppliedHash !== canonical.commandHash) fail("hash", "agent work wire hash mismatch");
  return canonical;
}
