import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import { type WorldAddressV1 } from "./world-authority-contract";

/** Canonical R9 boundary. WebRTC, voice, and media remain platform-owned. */
export const NETWORK_AUTHORITY_SCHEMA_V1 = 1 as const;
export const NETWORK_AUTHORITY_PROTOCOL_V1 = 1 as const;
export const NETWORK_MAX_COMMAND_BYTES_V1 = 2 * 1024 * 1024;
export const NETWORK_MAX_DELTA_BYTES_V1 = 16 * 1024 * 1024;
export const NETWORK_MAX_DELTA_RECORDS_V1 = 16_384;
export const NETWORK_MAX_INTEREST_CHUNKS_V1 = 1_024;
export const NETWORK_MAX_INTEREST_ENTITIES_V1 = 16_384;
export const NETWORK_MAX_LEASE_KEYS_V1 = 2_048;
export const NETWORK_MAX_IDEMPOTENCY_RECEIPTS_V1 = 512;

const HASH_PATTERN = /^[0-9a-f]{32}$/u;

export type NetworkPeerKindV1 = "human" | "agent";
export type NetworkPeerRoleV1 = "host" | "guest";
export type NetworkCapabilityV1 =
  | "observe"
  | "chat"
  | "interact"
  | "inventory"
  | "build"
  | "combat"
  | "creature-care"
  | "trade"
  | "travel"
  | "agent-work";

export const NETWORK_CAPABILITY_ORDER_V1: readonly NetworkCapabilityV1[] = Object.freeze([
  "observe", "chat", "interact", "inventory", "build", "combat", "creature-care", "trade", "travel", "agent-work",
]);

export type NetworkAuthorityRevisionV1 = Readonly<{
  epoch: number;
  world: number;
  entities: number;
  gameplay: number;
  persistence: number;
}>;

export type NetworkAuthorityIdentityV1 = Readonly<{
  address: WorldAddressV1;
  revision: NetworkAuthorityRevisionV1;
  stateHash: string;
}>;

export type NetworkHandshakeV1 = Readonly<{
  schemaVersion: typeof NETWORK_AUTHORITY_SCHEMA_V1;
  protocolVersion: typeof NETWORK_AUTHORITY_PROTOCOL_V1;
  sessionId: string;
  peerId: string;
  peerKind: NetworkPeerKindV1;
  role: NetworkPeerRoleV1;
  engineVersion: string;
  contentHash: string;
  generatorHash: string;
  capabilities: readonly NetworkCapabilityV1[];
  maxCommandBytes: number;
  handshakeHash: string;
}>;

export type NetworkHandshakeSourceV1 = Omit<NetworkHandshakeV1, "schemaVersion" | "protocolVersion" | "capabilities" | "maxCommandBytes" | "handshakeHash"> & Readonly<{
  capabilities: readonly NetworkCapabilityV1[];
  maxCommandBytes?: number;
}>;

export type NetworkHandshakeDecisionV1 = Readonly<{
  status: "compatible" | "rejected";
  code: "ok" | "schema-mismatch" | "protocol-mismatch" | "session-mismatch" | "role-conflict" | "engine-mismatch" | "content-mismatch" | "generator-mismatch" | "command-budget";
  capabilities: readonly NetworkCapabilityV1[];
  maxCommandBytes: number;
  message: string;
}>;

export type NetworkInterestChunkV1 = WorldAddressV1 & Readonly<{ chunkX: number; chunkZ: number }>;
export type NetworkInterestSetV1 = Readonly<{
  sequence: number;
  chunks: readonly NetworkInterestChunkV1[];
  entityIds: readonly string[];
  interestHash: string;
}>;

export type NetworkInterestSetSourceV1 = Omit<NetworkInterestSetV1, "chunks" | "entityIds" | "interestHash"> & Readonly<{
  chunks: readonly NetworkInterestChunkV1[];
  entityIds: readonly string[];
}>;

export type NetworkCommandKindV1 = "world" | "gameplay" | "agent" | "chat" | "interest" | "reconnect" | "pose" | "presentation-state";
export type NetworkCommandV1 = Readonly<{
  schemaVersion: typeof NETWORK_AUTHORITY_SCHEMA_V1;
  protocolVersion: typeof NETWORK_AUTHORITY_PROTOCOL_V1;
  sessionId: string;
  commandId: string;
  idempotencyKey: string;
  peerId: string;
  connectionId: string;
  actorId: string;
  peerKind: NetworkPeerKindV1;
  kind: NetworkCommandKindV1;
  requiredCapability: NetworkCapabilityV1;
  sequence: number;
  expected: NetworkAuthorityIdentityV1;
  expiresAt: number;
  leaseKeys: readonly string[];
  payload: Uint8Array;
  commandHash: string;
}>;

export type NetworkCommandSourceV1 = Omit<NetworkCommandV1, "schemaVersion" | "protocolVersion" | "expected" | "leaseKeys" | "payload" | "commandHash"> & Readonly<{
  expected: Omit<NetworkAuthorityIdentityV1, "stateHash"> & Partial<Pick<NetworkAuthorityIdentityV1, "stateHash">>;
  leaseKeys: readonly string[];
  payload: Uint8Array;
}>;

export type NetworkCommandReceiptV1 =
  | Readonly<{ schemaVersion: typeof NETWORK_AUTHORITY_SCHEMA_V1; status: "accepted"; commandId: string; idempotencyKey: string; peerId: string; identity: NetworkAuthorityIdentityV1; receiptHash: string }>
  | Readonly<{ schemaVersion: typeof NETWORK_AUTHORITY_SCHEMA_V1; status: "rejected"; commandId: string; idempotencyKey: string; peerId: string; code: "unknown-peer" | "connection-mismatch" | "peer-kind-mismatch" | "session-expired" | "command-expired" | "sequence" | "stale-revision" | "capability-denied" | "lease-conflict" | "interest-denied" | "invalid"; message: string; identity: NetworkAuthorityIdentityV1; receiptHash: string }>;

export type NetworkPeerGrantV1 = Readonly<{
  sessionId: string;
  peerId: string;
  connectionId: string;
  actorId: string;
  peerKind: NetworkPeerKindV1;
  role: NetworkPeerRoleV1;
  capabilities: readonly NetworkCapabilityV1[];
  expiresAt: number;
  nextSequence: number;
  interest: NetworkInterestSetV1;
}>;

export type NetworkDeltaRecordKindV1 = "world" | "entity" | "gameplay" | "player" | "agent" | "tombstone";
export type NetworkDeltaRecordV1 = Readonly<{
  kind: NetworkDeltaRecordKindV1;
  recordId: string;
  revision: number;
  payload: Uint8Array;
  payloadHash: string;
}>;

export type NetworkDeltaV1 = Readonly<{
  schemaVersion: typeof NETWORK_AUTHORITY_SCHEMA_V1;
  protocolVersion: typeof NETWORK_AUTHORITY_PROTOCOL_V1;
  sessionId: string;
  deltaId: string;
  peerId: string;
  keyframe: boolean;
  sequence: number;
  /** Next stable gameplay-command sequence the host will admit for this peer; unlike delta sequence, it survives reconnect. */
  acknowledgedCommandSequence: number;
  from: NetworkAuthorityIdentityV1;
  to: NetworkAuthorityIdentityV1;
  interestHash: string;
  records: readonly NetworkDeltaRecordV1[];
  byteLength: number;
  deltaHash: string;
}>;

export type NetworkDeltaSourceV1 = Omit<NetworkDeltaV1, "schemaVersion" | "protocolVersion" | "from" | "to" | "records" | "byteLength" | "deltaHash"> & Readonly<{
  from: Omit<NetworkAuthorityIdentityV1, "stateHash"> & Partial<Pick<NetworkAuthorityIdentityV1, "stateHash">>;
  to: Omit<NetworkAuthorityIdentityV1, "stateHash"> & Partial<Pick<NetworkAuthorityIdentityV1, "stateHash">>;
  records: readonly Omit<NetworkDeltaRecordV1, "payload" | "payloadHash">[] & readonly { payload?: never }[];
}>;

export type NetworkDeltaInputRecordV1 = Omit<NetworkDeltaRecordV1, "payloadHash" | "payload"> & Readonly<{ payload: Uint8Array }>;
export type NetworkDeltaInputV1 = Omit<NetworkDeltaSourceV1, "records"> & Readonly<{ records: readonly NetworkDeltaInputRecordV1[] }>;

export type NetworkReconnectCheckpointV1 = Readonly<{
  schemaVersion: typeof NETWORK_AUTHORITY_SCHEMA_V1;
  sessionId: string;
  peerId: string;
  connectionGeneration: number;
  acknowledgedCommandSequence: number;
  acknowledgedDeltaSequence: number;
  identity: NetworkAuthorityIdentityV1;
  interestHash: string;
  checkpointHash: string;
}>;

export type NetworkDesyncDiagnosticV1 = Readonly<{
  sessionId: string;
  peerId: string;
  checkpointHash: string;
  expectedStateHash: string;
  observedStateHash: string;
  firstDivergentSubsystem: "world" | "entities" | "gameplay" | "persistence" | "unknown";
  replaySequence: number;
}>;

export class NetworkAuthorityContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NetworkAuthorityContractError";
  }
}

function integer(value: number, minimum: number, maximum: number, name: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new NetworkAuthorityContractError("invalid-integer", `${name} must be an integer in ${minimum}..${maximum}`);
  return Object.is(value, -0) ? 0 : value;
}

function label(value: string, name: string, maximum = 180) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) throw new NetworkAuthorityContractError("invalid-label", `${name} must be a non-empty string no longer than ${maximum} code units`);
  return value;
}

function hash(value: string, name: string) {
  if (!HASH_PATTERN.test(value)) throw new NetworkAuthorityContractError("invalid-hash", `${name} must be a canonical 128-bit lowercase hash`);
  return value;
}

function compareOrdinal(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeCapabilities(input: readonly NetworkCapabilityV1[]) {
  const found = new Set<NetworkCapabilityV1>();
  for (const capability of input) {
    if (!NETWORK_CAPABILITY_ORDER_V1.includes(capability)) throw new NetworkAuthorityContractError("capability", `unknown network capability: ${String(capability)}`);
    found.add(capability);
  }
  return Object.freeze(NETWORK_CAPABILITY_ORDER_V1.filter((capability) => found.has(capability)));
}

function revisionKey(value: NetworkAuthorityRevisionV1) {
  return `${value.epoch}:${value.world}:${value.entities}:${value.gameplay}:${value.persistence}`;
}

export function createNetworkAuthorityIdentityV1(address: WorldAddressV1, revision: NetworkAuthorityRevisionV1): NetworkAuthorityIdentityV1 {
  label(address.universeId, "address.universeId", 64); label(address.locationId, "address.locationId", 128);
  const normalized = Object.freeze({
    epoch: integer(revision.epoch, 0, Number.MAX_SAFE_INTEGER, "revision.epoch"),
    world: integer(revision.world, 0, Number.MAX_SAFE_INTEGER, "revision.world"),
    entities: integer(revision.entities, 0, Number.MAX_SAFE_INTEGER, "revision.entities"),
    gameplay: integer(revision.gameplay, 0, Number.MAX_SAFE_INTEGER, "revision.gameplay"),
    persistence: integer(revision.persistence, 0, Number.MAX_SAFE_INTEGER, "revision.persistence"),
  });
  const stateHash = new TypeScriptCanonicalHasher("blockwild-network-authority-v1")
    .writeString(address.universeId).writeString(address.locationId)
    .writeU64(normalized.epoch).writeU64(normalized.world).writeU64(normalized.entities).writeU64(normalized.gameplay).writeU64(normalized.persistence)
    .finishHex();
  return Object.freeze({ address: Object.freeze({ ...address }), revision: normalized, stateHash });
}

function normalizeIdentity(source: NetworkCommandSourceV1["expected"] | NetworkDeltaInputV1["from"]) {
  const normalized = createNetworkAuthorityIdentityV1(source.address, source.revision);
  if (source.stateHash !== undefined && hash(source.stateHash, "identity.stateHash") !== normalized.stateHash) throw new NetworkAuthorityContractError("identity-hash", "authority identity hash does not match its address and revision");
  return normalized;
}

export function networkAuthorityIdentityEqualsV1(left: NetworkAuthorityIdentityV1, right: NetworkAuthorityIdentityV1) {
  return left.address.universeId === right.address.universeId
    && left.address.locationId === right.address.locationId
    && revisionKey(left.revision) === revisionKey(right.revision)
    && left.stateHash === right.stateHash;
}

export function createNetworkHandshakeV1(source: NetworkHandshakeSourceV1): NetworkHandshakeV1 {
  label(source.sessionId, "sessionId"); label(source.peerId, "peerId"); label(source.engineVersion, "engineVersion", 64);
  hash(source.contentHash, "contentHash"); hash(source.generatorHash, "generatorHash");
  if (source.peerKind !== "human" && source.peerKind !== "agent") throw new NetworkAuthorityContractError("peer-kind", "peer kind must be human or agent");
  if (source.role !== "host" && source.role !== "guest") throw new NetworkAuthorityContractError("peer-role", "peer role must be host or guest");
  const capabilities = normalizeCapabilities(source.capabilities);
  const maxCommandBytes = integer(source.maxCommandBytes ?? NETWORK_MAX_COMMAND_BYTES_V1, 1, NETWORK_MAX_COMMAND_BYTES_V1, "maxCommandBytes");
  const hasher = new TypeScriptCanonicalHasher("blockwild-network-handshake-v1");
  hasher.writeU16(NETWORK_AUTHORITY_SCHEMA_V1).writeU16(NETWORK_AUTHORITY_PROTOCOL_V1).writeString(source.sessionId).writeString(source.peerId)
    .writeString(source.peerKind).writeString(source.role).writeString(source.engineVersion).writeString(source.contentHash).writeString(source.generatorHash)
    .writeU32(capabilities.length);
  for (const capability of capabilities) hasher.writeString(capability);
  hasher.writeU32(maxCommandBytes);
  return Object.freeze({ schemaVersion: NETWORK_AUTHORITY_SCHEMA_V1, protocolVersion: NETWORK_AUTHORITY_PROTOCOL_V1, ...source, capabilities, maxCommandBytes, handshakeHash: hasher.finishHex() });
}

export function negotiateNetworkHandshakeV1(host: NetworkHandshakeV1, peer: NetworkHandshakeV1): NetworkHandshakeDecisionV1 {
  const reject = (code: Exclude<NetworkHandshakeDecisionV1["code"], "ok">, message: string): NetworkHandshakeDecisionV1 => Object.freeze({ status: "rejected", code, capabilities: Object.freeze([]), maxCommandBytes: 0, message });
  if (host.schemaVersion !== peer.schemaVersion) return reject("schema-mismatch", "Save/network schema versions differ.");
  if (host.protocolVersion !== peer.protocolVersion) return reject("protocol-mismatch", "Network protocol versions differ.");
  if (host.sessionId !== peer.sessionId) return reject("session-mismatch", "Peers did not present the same session.");
  if (host.role !== "host" || peer.role !== "guest") return reject("role-conflict", "A session requires exactly one host authority.");
  if (host.engineVersion !== peer.engineVersion) return reject("engine-mismatch", "Engine versions are not compatible.");
  if (host.contentHash !== peer.contentHash) return reject("content-mismatch", "Authored content fingerprints differ.");
  if (host.generatorHash !== peer.generatorHash) return reject("generator-mismatch", "World generator fingerprints differ.");
  const maxCommandBytes = Math.min(host.maxCommandBytes, peer.maxCommandBytes);
  if (maxCommandBytes < 1) return reject("command-budget", "No compatible command payload budget exists.");
  const peerSet = new Set(peer.capabilities);
  const capabilities = Object.freeze(host.capabilities.filter((capability) => peerSet.has(capability)));
  return Object.freeze({ status: "compatible", code: "ok", capabilities, maxCommandBytes, message: "Peer may join through host Rust authority." });
}

function chunkKey(value: NetworkInterestChunkV1) {
  label(value.universeId, "chunk.universeId", 64); label(value.locationId, "chunk.locationId", 128);
  integer(value.chunkX, -2_147_483_648, 2_147_483_647, "chunk.chunkX"); integer(value.chunkZ, -2_147_483_648, 2_147_483_647, "chunk.chunkZ");
  return `${encodeURIComponent(value.universeId)}@${encodeURIComponent(value.locationId)}/${value.chunkX},${value.chunkZ}`;
}

export function createNetworkInterestSetV1(source: NetworkInterestSetSourceV1): NetworkInterestSetV1 {
  const sequence = integer(source.sequence, 0, Number.MAX_SAFE_INTEGER, "interest.sequence");
  if (source.chunks.length > NETWORK_MAX_INTEREST_CHUNKS_V1 || source.entityIds.length > NETWORK_MAX_INTEREST_ENTITIES_V1) throw new NetworkAuthorityContractError("interest-size", "interest set exceeds its V1 bounds");
  const chunks = [...source.chunks].map((entry) => Object.freeze({ ...entry })).sort((left, right) => compareOrdinal(chunkKey(left), chunkKey(right)));
  const entityIds = [...new Set(source.entityIds.map((value) => label(value, "entityId", 128)))].sort(compareOrdinal);
  for (let index = 1; index < chunks.length; index += 1) if (chunkKey(chunks[index - 1]) === chunkKey(chunks[index])) throw new NetworkAuthorityContractError("duplicate-interest", "interest set contains a duplicate chunk");
  const hasher = new TypeScriptCanonicalHasher("blockwild-network-interest-v1").writeU64(sequence).writeU32(chunks.length);
  for (const chunk of chunks) hasher.writeString(chunk.universeId).writeString(chunk.locationId).writeI32(chunk.chunkX).writeI32(chunk.chunkZ);
  hasher.writeU32(entityIds.length); for (const entityId of entityIds) hasher.writeString(entityId);
  return Object.freeze({ sequence, chunks: Object.freeze(chunks), entityIds: Object.freeze(entityIds), interestHash: hasher.finishHex() });
}

function normalizeLeaseKeys(source: readonly string[]) {
  if (source.length > NETWORK_MAX_LEASE_KEYS_V1) throw new NetworkAuthorityContractError("lease-size", "command exceeds the lease-key budget");
  const keys = [...new Set(source.map((value) => label(value, "leaseKey", 256)))].sort(compareOrdinal);
  return Object.freeze(keys);
}

export function createNetworkCommandV1(source: NetworkCommandSourceV1): NetworkCommandV1 {
  label(source.sessionId, "sessionId"); label(source.commandId, "commandId"); label(source.idempotencyKey, "idempotencyKey", 256);
  label(source.peerId, "peerId"); label(source.connectionId, "connectionId"); label(source.actorId, "actorId");
  if (source.peerKind !== "human" && source.peerKind !== "agent") throw new NetworkAuthorityContractError("peer-kind", "peer kind must be human or agent");
  if (!(["world", "gameplay", "agent", "chat", "interest", "reconnect", "pose", "presentation-state"] as const).includes(source.kind)) throw new NetworkAuthorityContractError("command-kind", "unknown network command kind");
  normalizeCapabilities([source.requiredCapability]);
  if (!(source.payload instanceof Uint8Array) || source.payload.byteLength > NETWORK_MAX_COMMAND_BYTES_V1) throw new NetworkAuthorityContractError("command-payload", "command payload must be a Uint8Array inside the V1 budget");
  const sequence = integer(source.sequence, 0, Number.MAX_SAFE_INTEGER, "sequence");
  const expiresAt = integer(source.expiresAt, 0, Number.MAX_SAFE_INTEGER, "expiresAt");
  const expected = normalizeIdentity(source.expected);
  const leaseKeys = normalizeLeaseKeys(source.leaseKeys);
  const payload = Uint8Array.from(source.payload);
  const hasher = new TypeScriptCanonicalHasher("blockwild-network-command-v1");
  hasher.writeU16(NETWORK_AUTHORITY_SCHEMA_V1).writeU16(NETWORK_AUTHORITY_PROTOCOL_V1).writeString(source.sessionId).writeString(source.commandId).writeString(source.idempotencyKey)
    .writeString(source.peerId).writeString(source.connectionId).writeString(source.actorId).writeString(source.peerKind).writeString(source.kind).writeString(source.requiredCapability)
    .writeU64(sequence).writeString(expected.stateHash).writeU64(expiresAt).writeU32(leaseKeys.length);
  for (const key of leaseKeys) hasher.writeString(key);
  hasher.writeBytes(payload);
  return Object.freeze({ schemaVersion: NETWORK_AUTHORITY_SCHEMA_V1, protocolVersion: NETWORK_AUTHORITY_PROTOCOL_V1, ...source, sequence, expected, expiresAt, leaseKeys, payload, commandHash: hasher.finishHex() });
}

function normalizeDeltaRecord(source: NetworkDeltaInputRecordV1) {
  if (!(["world", "entity", "gameplay", "player", "agent", "tombstone"] as const).includes(source.kind)) throw new NetworkAuthorityContractError("delta-kind", "unknown delta record kind");
  label(source.recordId, "recordId", 256);
  const revision = integer(source.revision, 0, Number.MAX_SAFE_INTEGER, "record.revision");
  if (!(source.payload instanceof Uint8Array)) throw new NetworkAuthorityContractError("delta-payload", "delta payload must be Uint8Array");
  const payload = Uint8Array.from(source.payload);
  const payloadHash = new TypeScriptCanonicalHasher("blockwild-network-delta-record-v1").writeBytes(payload).finishHex();
  return Object.freeze({ kind: source.kind, recordId: source.recordId, revision, payload, payloadHash });
}

function deltaRecordKey(value: Pick<NetworkDeltaRecordV1, "kind" | "recordId">) { return `${value.kind}/${encodeURIComponent(value.recordId)}`; }

export function createNetworkDeltaV1(source: NetworkDeltaInputV1): NetworkDeltaV1 {
  label(source.sessionId, "sessionId"); label(source.deltaId, "deltaId"); label(source.peerId, "peerId"); hash(source.interestHash, "interestHash");
  const sequence = integer(source.sequence, 0, Number.MAX_SAFE_INTEGER, "sequence");
  const acknowledgedCommandSequence = integer(source.acknowledgedCommandSequence, 0, Number.MAX_SAFE_INTEGER, "acknowledgedCommandSequence");
  if (source.records.length > NETWORK_MAX_DELTA_RECORDS_V1) throw new NetworkAuthorityContractError("delta-record-count", "delta exceeds its record budget");
  const from = normalizeIdentity(source.from); const to = normalizeIdentity(source.to);
  if (!source.keyframe && (from.address.universeId !== to.address.universeId || from.address.locationId !== to.address.locationId)) throw new NetworkAuthorityContractError("delta-location", "non-keyframe deltas cannot cross locations");
  const records = source.records.map(normalizeDeltaRecord).sort((left, right) => compareOrdinal(deltaRecordKey(left), deltaRecordKey(right)));
  for (let index = 1; index < records.length; index += 1) if (deltaRecordKey(records[index - 1]) === deltaRecordKey(records[index])) throw new NetworkAuthorityContractError("duplicate-delta-record", "delta contains a duplicate record");
  const byteLength = records.reduce((total, record) => total + record.payload.byteLength, 0);
  if (byteLength > NETWORK_MAX_DELTA_BYTES_V1) throw new NetworkAuthorityContractError("delta-size", "delta exceeds its byte budget");
  const hasher = new TypeScriptCanonicalHasher("blockwild-network-delta-v1");
  hasher.writeU16(NETWORK_AUTHORITY_SCHEMA_V1).writeU16(NETWORK_AUTHORITY_PROTOCOL_V1).writeString(source.sessionId).writeString(source.deltaId).writeString(source.peerId)
    .writeU16(source.keyframe ? 1 : 0).writeU64(sequence).writeU64(acknowledgedCommandSequence).writeString(from.stateHash).writeString(to.stateHash).writeString(source.interestHash).writeU32(records.length);
  for (const record of records) hasher.writeString(record.kind).writeString(record.recordId).writeU64(record.revision).writeString(record.payloadHash).writeBytes(record.payload);
  return Object.freeze({ schemaVersion: NETWORK_AUTHORITY_SCHEMA_V1, protocolVersion: NETWORK_AUTHORITY_PROTOCOL_V1, ...source, sequence, acknowledgedCommandSequence, from, to, records: Object.freeze(records), byteLength, deltaHash: hasher.finishHex() });
}

export function networkDeltaTransferListV1(delta: NetworkDeltaV1) {
  const result: ArrayBuffer[] = [];
  const seen = new Set<ArrayBuffer>();
  for (const record of delta.records) {
    if (!(record.payload.buffer instanceof ArrayBuffer)) throw new NetworkAuthorityContractError("shared-buffer", "V1 deltas require transferable ArrayBuffers");
    if (!seen.has(record.payload.buffer)) { seen.add(record.payload.buffer); result.push(record.payload.buffer); }
  }
  return result;
}

export function networkDeltaMatchesInterestV1(delta: NetworkDeltaV1, interest: NetworkInterestSetV1) {
  return delta.interestHash === interest.interestHash;
}

export function createNetworkReconnectCheckpointV1(source: Omit<NetworkReconnectCheckpointV1, "schemaVersion" | "identity" | "checkpointHash"> & Readonly<{ identity: NetworkCommandSourceV1["expected"] }>): NetworkReconnectCheckpointV1 {
  label(source.sessionId, "sessionId"); label(source.peerId, "peerId"); hash(source.interestHash, "interestHash");
  const connectionGeneration = integer(source.connectionGeneration, 0, Number.MAX_SAFE_INTEGER, "connectionGeneration");
  const acknowledgedCommandSequence = integer(source.acknowledgedCommandSequence, 0, Number.MAX_SAFE_INTEGER, "acknowledgedCommandSequence");
  const acknowledgedDeltaSequence = integer(source.acknowledgedDeltaSequence, 0, Number.MAX_SAFE_INTEGER, "acknowledgedDeltaSequence");
  const identity = normalizeIdentity(source.identity);
  const checkpointHash = new TypeScriptCanonicalHasher("blockwild-network-reconnect-v1").writeString(source.sessionId).writeString(source.peerId)
    .writeU64(connectionGeneration).writeU64(acknowledgedCommandSequence).writeU64(acknowledgedDeltaSequence).writeString(identity.stateHash).writeString(source.interestHash).finishHex();
  return Object.freeze({ schemaVersion: NETWORK_AUTHORITY_SCHEMA_V1, sessionId: source.sessionId, peerId: source.peerId, connectionGeneration, acknowledgedCommandSequence, acknowledgedDeltaSequence, identity, interestHash: source.interestHash, checkpointHash });
}

export function diagnoseNetworkDesyncV1(checkpoint: NetworkReconnectCheckpointV1, observed: NetworkAuthorityIdentityV1): NetworkDesyncDiagnosticV1 | null {
  if (checkpoint.identity.stateHash === observed.stateHash) return null;
  const expected = checkpoint.identity.revision;
  const actual = observed.revision;
  const firstDivergentSubsystem = expected.world !== actual.world ? "world" : expected.entities !== actual.entities ? "entities" : expected.gameplay !== actual.gameplay ? "gameplay" : expected.persistence !== actual.persistence ? "persistence" : "unknown";
  return Object.freeze({ sessionId: checkpoint.sessionId, peerId: checkpoint.peerId, checkpointHash: checkpoint.checkpointHash, expectedStateHash: checkpoint.identity.stateHash, observedStateHash: observed.stateHash, firstDivergentSubsystem, replaySequence: checkpoint.acknowledgedCommandSequence });
}

type ActiveLease = Readonly<{ commandId: string; peerId: string; expiresAt: number }>;
type PeerPresentation = Readonly<{ connectionId: string; deltaSequence: number; identity: NetworkAuthorityIdentityV1 }>;

function hashBytes(value: string) {
  hash(value, "canonicalHash");
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

function identityExtends(previous: NetworkAuthorityIdentityV1, next: NetworkAuthorityIdentityV1) {
  return previous.address.universeId === next.address.universeId
    && previous.address.locationId === next.address.locationId
    && previous.revision.epoch <= next.revision.epoch
    && previous.revision.world <= next.revision.world
    && previous.revision.entities <= next.revision.entities
    && previous.revision.gameplay <= next.revision.gameplay
    && previous.revision.persistence <= next.revision.persistence;
}

function presentationIsReachableFromCurrent(presented: NetworkAuthorityIdentityV1, current: NetworkAuthorityIdentityV1) {
  return presented.address.universeId === current.address.universeId
    && presented.address.locationId === current.address.locationId
    && presented.revision.epoch === current.revision.epoch
    && presented.revision.world <= current.revision.world
    && presented.revision.entities <= current.revision.entities
    && presented.revision.gameplay <= current.revision.gameplay
    && presented.revision.persistence <= current.revision.persistence;
}

/** TypeScript parity oracle. Rust becomes the authority; both human and agent commands use this one path. */
export class TypeScriptNetworkAuthorityV1 {
  private readonly grants = new Map<string, NetworkPeerGrantV1>();
  private readonly receipts = new Map<string, NetworkCommandReceiptV1>();
  private readonly receiptCommandHashes = new Map<string, string>();
  private readonly receiptOrder: string[] = [];
  private readonly leases = new Map<string, ActiveLease>();
  private readonly presentations = new Map<string, PeerPresentation>();

  constructor(readonly sessionId: string) { label(sessionId, "sessionId"); }

  upsertGrant(grant: NetworkPeerGrantV1) {
    if (grant.sessionId !== this.sessionId) throw new NetworkAuthorityContractError("session-mismatch", "grant belongs to another session");
    label(grant.peerId, "peerId"); label(grant.connectionId, "connectionId"); label(grant.actorId, "actorId");
    const normalized = Object.freeze({ ...grant, capabilities: normalizeCapabilities(grant.capabilities), expiresAt: integer(grant.expiresAt, 0, Number.MAX_SAFE_INTEGER, "expiresAt"), nextSequence: integer(grant.nextSequence, 0, Number.MAX_SAFE_INTEGER, "nextSequence") });
    const current = this.grants.get(grant.peerId);
    if (current && current.connectionId !== normalized.connectionId) this.presentations.delete(grant.peerId);
    this.grants.set(grant.peerId, normalized);
    return normalized;
  }

  grant(peerId: string) { return this.grants.get(peerId) ?? null; }

  recordPeerPresentation(peerId: string, deltaSequence: number, identity: NetworkAuthorityIdentityV1) {
    label(peerId, "peerId");
    const sequence = integer(deltaSequence, 0, Number.MAX_SAFE_INTEGER, "deltaSequence");
    const grant = this.grants.get(peerId);
    if (!grant) throw new NetworkAuthorityContractError("unknown-peer", "delta presentation peer has no active host grant");
    const normalizedIdentity = normalizeIdentity(identity);
    const next = Object.freeze({ connectionId: grant.connectionId, deltaSequence: sequence, identity: normalizedIdentity });
    const current = this.presentations.get(peerId);
    if (current) {
      if (current.connectionId !== next.connectionId) throw new NetworkAuthorityContractError("connection-mismatch", "delta presentation connection does not match the active host grant");
      if (sequence < current.deltaSequence) throw new NetworkAuthorityContractError("sequence", "delta presentation sequence regressed");
      if (sequence === current.deltaSequence) {
        if (!networkAuthorityIdentityEqualsV1(current.identity, next.identity)) throw new NetworkAuthorityContractError("hash-mismatch", "delta presentation sequence was reused for another authority identity");
        return false;
      }
      if (!identityExtends(current.identity, next.identity)) throw new NetworkAuthorityContractError("hash-mismatch", "delta presentation identity does not extend the recorded authority chain");
    }
    this.presentations.set(peerId, next);
    return true;
  }

  authorityFingerprint() {
    const hasher = new TypeScriptCanonicalHasher("blockwild-network-authority-runtime-v1").writeString(this.sessionId);
    const grants = [...this.grants].sort(([left], [right]) => compareOrdinal(left, right));
    hasher.writeU32(grants.length);
    for (const [peerId, grant] of grants) {
      hasher.writeString(peerId).writeString(grant.connectionId).writeString(grant.actorId).writeString(grant.peerKind)
        .writeU64(grant.expiresAt).writeU64(grant.nextSequence).writeString(grant.interest.interestHash);
    }
    hasher.writeU32(this.receiptOrder.length);
    for (const key of this.receiptOrder) {
      const receipt = this.receipts.get(key);
      const commandHash = this.receiptCommandHashes.get(key);
      if (receipt && commandHash) hasher.writeString(key).writeBytes(hashBytes(commandHash)).writeBytes(hashBytes(receipt.receiptHash));
    }
    const leases = [...this.leases].sort(([left], [right]) => compareOrdinal(left, right));
    hasher.writeU32(leases.length);
    for (const [key, lease] of leases) hasher.writeString(key).writeString(lease.commandId).writeString(lease.peerId).writeU64(lease.expiresAt);
    const presentations = [...this.presentations].sort(([left], [right]) => compareOrdinal(left, right));
    hasher.writeU32(presentations.length);
    for (const [peerId, presentation] of presentations) {
      hasher.writeString(peerId).writeString(presentation.connectionId).writeU64(presentation.deltaSequence)
        .writeString(presentation.identity.stateHash);
    }
    return hasher.finishHex();
  }

  private receipt(command: NetworkCommandV1, identity: NetworkAuthorityIdentityV1, status: "accepted" | "rejected", code?: Extract<NetworkCommandReceiptV1, { status: "rejected" }>["code"], message = "", cache = true) {
    const hasher = new TypeScriptCanonicalHasher("blockwild-network-receipt-v1").writeString(status).writeString(command.commandId).writeString(command.idempotencyKey).writeString(command.peerId).writeString(identity.stateHash);
    if (code) hasher.writeString(code).writeString(message);
    const result: NetworkCommandReceiptV1 = status === "accepted"
      ? Object.freeze({ schemaVersion: NETWORK_AUTHORITY_SCHEMA_V1, status, commandId: command.commandId, idempotencyKey: command.idempotencyKey, peerId: command.peerId, identity, receiptHash: hasher.finishHex() })
      : Object.freeze({ schemaVersion: NETWORK_AUTHORITY_SCHEMA_V1, status, commandId: command.commandId, idempotencyKey: command.idempotencyKey, peerId: command.peerId, code: code ?? "invalid", message, identity, receiptHash: hasher.finishHex() });
    if (cache) {
      this.receipts.set(command.idempotencyKey, result); this.receiptCommandHashes.set(command.idempotencyKey, command.commandHash); this.receiptOrder.push(command.idempotencyKey);
      while (this.receiptOrder.length > NETWORK_MAX_IDEMPOTENCY_RECEIPTS_V1) { const expired = this.receiptOrder.shift(); if (expired) { this.receipts.delete(expired); this.receiptCommandHashes.delete(expired); } }
    }
    return result;
  }

  authorize(command: NetworkCommandV1, current: NetworkAuthorityIdentityV1, now: number): NetworkCommandReceiptV1 {
    const replay = this.receipts.get(command.idempotencyKey);
    if (replay) {
      if (this.receiptCommandHashes.get(command.idempotencyKey) === command.commandHash) return replay;
      return this.receipt(command, current, "rejected", "invalid", "Idempotency key was already used by a different command.", false);
    }
    const reject = (code: Extract<NetworkCommandReceiptV1, { status: "rejected" }>["code"], message: string) => this.receipt(command, current, "rejected", code, message);
    if (command.sessionId !== this.sessionId) return reject("invalid", "Command belongs to another session.");
    const grant = this.grants.get(command.peerId);
    if (!grant) return reject("unknown-peer", "Peer has no active host grant.");
    if (grant.connectionId !== command.connectionId || grant.actorId !== command.actorId) return reject("connection-mismatch", "Command is not bound to the granted connection and actor.");
    if (grant.peerKind !== command.peerKind) return reject("peer-kind-mismatch", "Command peer kind does not match the host grant.");
    if (grant.expiresAt < now) return reject("session-expired", "Peer grant expired.");
    if (command.expiresAt < now) return reject("command-expired", "Command expired before host validation.");
    if (command.sequence !== grant.nextSequence) return reject("sequence", `Expected command sequence ${grant.nextSequence}.`);
    const presentationBound = command.kind === "pose" || command.kind === "presentation-state";
    const expectedIdentityMatches = presentationBound
      ? (() => {
          const presentation = this.presentations.get(command.peerId);
          return !!presentation && presentation.connectionId === command.connectionId
            && networkAuthorityIdentityEqualsV1(presentation.identity, command.expected)
            && presentationIsReachableFromCurrent(presentation.identity, current);
        })()
      : networkAuthorityIdentityEqualsV1(command.expected, current);
    if (!expectedIdentityMatches) {
      const message = command.kind === "pose"
        ? "Pose command does not match the latest connection-bound authority presentation."
        : command.kind === "presentation-state"
          ? "Player-state command does not match the latest connection-bound authority presentation."
          : "Command was created from stale authoritative state.";
      return reject("stale-revision", message);
    }
    if (!grant.capabilities.includes(command.requiredCapability)) return reject("capability-denied", `Host did not grant ${command.requiredCapability}.`);
    const locationInInterest = grant.interest.chunks.some((chunk) => chunk.universeId === command.expected.address.universeId && chunk.locationId === command.expected.address.locationId);
    if (!locationInInterest && command.kind !== "interest" && command.kind !== "reconnect" && command.kind !== "chat") return reject("interest-denied", "Command targets a location outside this peer's host-authorized interest set.");
    this.releaseExpiredLeases(now);
    for (const key of command.leaseKeys) { const lease = this.leases.get(key); if (lease && lease.commandId !== command.commandId) return reject("lease-conflict", `Resource ${key} is leased by another command.`); }
    for (const key of command.leaseKeys) this.leases.set(key, Object.freeze({ commandId: command.commandId, peerId: command.peerId, expiresAt: command.expiresAt }));
    this.grants.set(command.peerId, Object.freeze({ ...grant, nextSequence: grant.nextSequence + 1 }));
    return this.receipt(command, current, "accepted");
  }

  releaseCommand(commandId: string) { for (const [key, lease] of this.leases) if (lease.commandId === commandId) this.leases.delete(key); }
  releasePeer(peerId: string) { for (const [key, lease] of this.leases) if (lease.peerId === peerId) this.leases.delete(key); this.grants.delete(peerId); this.presentations.delete(peerId); }
  releaseExpiredLeases(now: number) { for (const [key, lease] of this.leases) if (lease.expiresAt < now) this.leases.delete(key); }
  activeLeaseCount() { return this.leases.size; }
}
