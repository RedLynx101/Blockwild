import {
  AGENT_COMMAND_KINDS,
  type AgentCapabilityGrant,
  type AgentCommandEnvelope,
} from "./agent-platform";
import {
  NETWORK_MAX_COMMAND_BYTES_V1,
  createNetworkCommandV1,
  createNetworkReconnectCheckpointV1,
  type NetworkAuthorityIdentityV1,
  type NetworkCapabilityV1,
  type NetworkCommandKindV1,
  type NetworkInterestSetV1,
  type NetworkPeerGrantV1,
} from "./network-authority-contract";
import type { RustIntegratedNetworkRuntimePortV1 } from "./rust-integrated-runtime-domain-adapters";
import type {
  RustIntegratedNetworkDeltaBuildRequestV1,
  RustIntegratedScopedDeltaRecordV1,
} from "./rust-integrated-runtime-network-lifecycle";
import { RustNetworkRuntimeContractError } from "./rust-network-runtime-contract";
import { RustNetworkRuntimeServiceV1 } from "./rust-network-runtime-service";
import {
  encodeNetworkCommandWireV1,
  encodeNetworkHandshakeSourceWireV1,
  encodeNetworkReconnectCheckpointWireV1,
} from "./rust-network-wire-v1";
import {
  encodeRustNetworkPlayerPoseProjectionV1,
  encodeRustNetworkPlayerPoseV1,
  type RustNetworkPlayerPoseProjectionV1,
} from "./rust-network-player-pose-v1";
import {
  encodeRustNetworkAgentWorkCommandV1,
  RUST_NETWORK_AGENT_WORK_MAX_WORK_UNITS_V1,
  RustNetworkAgentWorkV1Error,
} from "./rust-network-agent-work-v1";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

const encoder = new TextEncoder();
const DEFAULT_GRANT_LIFETIME_MS = 10 * 60_000;
export const RUST_MULTIPLAYER_MAX_DURABLE_PEER_LIFECYCLES_V1 = 1_024;
const MAX_NATIVE_POSE_RECORDS_V1 = 1_024;
const MAX_NATIVE_POSE_PROJECTIONS_V1 = 512;

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

export type RustMultiplayerAuthorityModeV1 = "rust-authoritative" | "legacy-compatibility";

export type RustMultiplayerAuthorityPeerV1 = Readonly<{
  sessionId: string;
  peerId: string;
  connectionId: string;
  actorId: string;
  peerKind: "human" | "agent";
  role: "host" | "guest";
  capabilities: readonly NetworkCapabilityV1[];
  expiresAt: number;
  nextSequence: number;
  interest: NetworkInterestSetV1;
  connectionGeneration: number;
}>;

export type RustMultiplayerAuthorityPeerFenceV1 = Pick<
  RustMultiplayerAuthorityPeerV1,
  "sessionId" | "peerId" | "connectionId" | "connectionGeneration"
>;

export type RustMultiplayerAuthorityPeerInstallV1 = Readonly<{
  status: "installed" | "superseded";
  nextSequence: number;
  /** Durable adapter-owned generation; absent only on compatibility test doubles. */
  connectionGeneration?: number;
}>;

export type RustMultiplayerDeltaBuildRequestV1 = Readonly<
  Omit<RustIntegratedNetworkDeltaBuildRequestV1, "acknowledgedCommandSequence">
  & Pick<RustMultiplayerAuthorityPeerV1, "connectionId" | "connectionGeneration">
>;

export type RustMultiplayerInboundCommandV1 = Readonly<{
  sessionId: string;
  peerId: string;
  connectionId: string;
  peerKind: "human" | "agent";
  actorId: string;
  messageType: string;
  sequence: number;
  sentAt: number;
  expected: NetworkAuthorityIdentityV1;
  encodedEnvelope: string;
  payload: unknown;
}>;

/**
 * Canonical guest movement input decoded, range-checked, and re-emitted by the
 * Rust R9 authority. Appearance, inventory, equipment, and held-item state are
 * deliberately absent: those remain host-owned player-session projections.
 */
export type RustMultiplayerNativePoseV1 = Readonly<{
  schema: 1;
  playerId: string;
  tick: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  selected?: number;
  shieldRaised: boolean;
  crouching: boolean;
  sprinting: boolean;
  action: "none" | "mine" | "use";
  swimming?: number;
  seated?: number;
  boatId?: string;
  boatSeat?: number;
  boatForward?: number;
  boatTurn?: number;
  mountedCreatureId?: number;
  mountedCreatureSeat?: number;
  poseHash: string;
}>;

/**
 * Exact native custody proof for one accepted guest pose. The specialized
 * receipt binds the generic command receipt, typed payload, presentation
 * cursor, connection, and resulting per-player pose record.
 */
export type RustMultiplayerNativePoseReceiptV1 = Readonly<{
  schema: 1;
  sessionId: string;
  peerId: string;
  connectionId: string;
  commandId: string;
  commandSequence: number;
  commandHash: string;
  authorityReceiptHash: string;
  presentedDeltaSequence: number;
  presentedIdentityHash: string;
  recordRevision: number;
  previousRecordHash: string;
  recordHash: string;
  pose: RustMultiplayerNativePoseV1;
  receiptHash: string;
}>;

export type RustMultiplayerAuthorityDecisionV1 = Readonly<{
  accepted: boolean;
  commandId: string;
  idempotencyKey: string;
  code: string;
  receiptHash: string | null;
  /** Present only for a Rust-decoded player-pose command. */
  nativePose?: RustMultiplayerNativePoseReceiptV1;
  expected?: NetworkAuthorityIdentityV1;
  current?: NetworkAuthorityIdentityV1;
}>;

export type RustMultiplayerDeltaFrameV1 = Readonly<{
  sessionId: string;
  peerId: string;
  connectionGeneration: number;
  keyframe: boolean;
  interest: NetworkInterestSetV1;
  remoteIdentity: NetworkAuthorityIdentityV1;
  packet: Uint8Array;
}>;

export interface RustMultiplayerAuthorityV1 {
  readonly backend: "rust-wasm-worker";
  currentIdentity(): NetworkAuthorityIdentityV1;
  createHandshake(input: Readonly<{ sessionId: string; peerId: string; peerKind: "human" | "agent"; role: "host" | "guest" }>): Uint8Array;
  negotiate(hostPacket: Uint8Array, peerPacket: Uint8Array): Promise<Readonly<{ capabilities: readonly NetworkCapabilityV1[]; maxCommandBytes: number }>>;
  installPeer(peer: RustMultiplayerAuthorityPeerV1): Promise<RustMultiplayerAuthorityPeerInstallV1>;
  authorizeInbound(command: RustMultiplayerInboundCommandV1): Promise<RustMultiplayerAuthorityDecisionV1>;
  installAgentGrant(grant: AgentCapabilityGrant, peer: RustMultiplayerAuthorityPeerV1): Promise<void>;
  upsertReplicationRecord(value: RustIntegratedScopedDeltaRecordV1): Promise<void>;
  removeReplicationRecord(value: RustIntegratedScopedDeltaRecordV1): Promise<void>;
  buildDelta(value: RustMultiplayerDeltaBuildRequestV1): Promise<Readonly<{ scopeProbes: number; candidateRecords: number; emittedRecords: number; packet: Uint8Array }>>;
  acceptDelta(value: RustMultiplayerDeltaFrameV1): Promise<Readonly<{ code: string; sequence: number; stateHash: string }>>;
  reconnectCheckpoint(sessionId: string, peerId: string, connectionGeneration: number): Promise<Uint8Array | null>;
  releaseCommand(commandId: string): Promise<void>;
  releasePeer(peer: RustMultiplayerAuthorityPeerFenceV1): Promise<"released" | "superseded">;
  runExclusiveMutation<T>(operation: () => Promise<T>): Promise<T>;
  drain(): Promise<void>;
}

export type IntegratedRustMultiplayerAuthorityOptionsV1 = Readonly<{
  network: RustNetworkRuntimeServiceV1;
  lifecycle: RustIntegratedNetworkRuntimePortV1;
  identity: () => NetworkAuthorityIdentityV1;
  engineVersion: string;
  contentHash: string;
  generatorHash: string;
  now?: () => number;
  grantLifetimeMs?: number;
}>;

type CommandShape = Readonly<{
  kind: NetworkCommandKindV1;
  capability: NetworkCapabilityV1;
}>;

const COMMAND_SHAPES: Readonly<Record<string, CommandShape>> = Object.freeze({
  "player-pose": { kind: "pose", capability: "interact" },
  "block-action": { kind: "world", capability: "build" },
  "sleep-vote": { kind: "gameplay", capability: "interact" },
  "inventory-action": { kind: "gameplay", capability: "inventory" },
  "container-action": { kind: "gameplay", capability: "inventory" },
  "facility-action": { kind: "gameplay", capability: "interact" },
  "player-state": { kind: "presentation-state", capability: "interact" },
  "player-progress": { kind: "gameplay", capability: "interact" },
  "boat-action": { kind: "gameplay", capability: "travel" },
  "combat-action": { kind: "gameplay", capability: "combat" },
  "creature-action": { kind: "gameplay", capability: "creature-care" },
  "tcg-action": { kind: "gameplay", capability: "interact" },
  "map-share": { kind: "gameplay", capability: "travel" },
  "agent-command": { kind: "agent", capability: "agent-work" },
  chat: { kind: "chat", capability: "chat" },
  "voice-chunk": { kind: "chat", capability: "chat" },
});

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stableLeaseKey(prefix: string, value: unknown) {
  const source = typeof value === "string" ? value : JSON.stringify(value);
  return `${prefix}:${new TypeScriptCanonicalHasher("blockwild-network-lease-key-v1").writeString(source).finishHex()}`;
}

function commandIdentity(value: RustMultiplayerInboundCommandV1) {
  const payload = record(value.payload);
  if (value.messageType === "agent-command" && typeof payload?.commandId === "string") return payload.commandId;
  if (typeof payload?.requestId === "string") return payload.requestId;
  // The dense command cursor is stable for this authority runtime session and
  // peer, including across connection replacement. It therefore remains a
  // bounded, collision-free fallback identity without exposing invite tokens.
  return `${value.messageType}:${value.peerId}:${value.sequence}`;
}

function commandLeaseKeys(value: RustMultiplayerInboundCommandV1) {
  // Native pose records are connection/sequence fenced and immediately
  // released; they must not allocate gameplay resource leases.
  if (value.messageType === "player-pose") return Object.freeze([]);
  const payload = record(value.payload) ?? {};
  const keys = value.messageType === "block-action" ? [] : [stableLeaseKey("request", `${value.sessionId}/${value.peerId}/${commandIdentity(value)}`)];
  if (value.messageType === "block-action") {
    const edits = Array.isArray(payload.edits) ? payload.edits : [];
    for (const edit of edits) {
      const cell = record(edit);
      keys.push(stableLeaseKey("block", [cell?.x, cell?.y, cell?.z]));
    }
  }
  else if (value.messageType === "container-action") keys.push(stableLeaseKey("container", payload.containerKey ?? payload.target ?? value.actorId));
  else if (value.messageType === "facility-action") keys.push(stableLeaseKey("facility", payload.facilityKey ?? payload.key ?? value.actorId));
  else if (value.messageType === "boat-action") keys.push(stableLeaseKey("boat", payload.boatId ?? value.actorId));
  else if (value.messageType === "combat-action") keys.push(stableLeaseKey("combat", payload.targetId ?? payload.mobId ?? value.actorId));
  else if (value.messageType === "creature-action") keys.push(stableLeaseKey("creature", payload.creatureId ?? payload.mobId ?? value.actorId));
  else if (value.messageType === "agent-command") keys.push(stableLeaseKey("agent", value.actorId));
  else if (["inventory-action", "player-state", "player-progress"].includes(value.messageType)) keys.push(stableLeaseKey("player", value.actorId));
  return Object.freeze([...new Set(keys)].sort());
}

function agentWorkUnits(command: AgentCommandEnvelope) {
  const args = record(command.arguments) ?? {};
  const candidates = [args.placements, args.removals, args.cells, args.targets]
    .filter(Array.isArray)
    .reduce((total, value) => total + (value as unknown[]).length, 0);
  return Math.max(1, Math.min(RUST_NETWORK_AGENT_WORK_MAX_WORK_UNITS_V1, candidates || 1));
}

function encodeAgentWorkCommand(command: AgentCommandEnvelope) {
  const kindTag = AGENT_COMMAND_KINDS.indexOf(command.kind);
  if (kindTag < 0) throw new RustNetworkRuntimeContractError("agent-kind", "unknown agent command kind");
  const taskId = typeof command.arguments.taskId === "string" && command.arguments.taskId.length <= 128
    ? command.arguments.taskId
    : null;
  const argumentsBytes = encoder.encode(JSON.stringify({ arguments: command.arguments, ...(command.clientIntent ? { clientIntent: command.clientIntent } : {}) }));
  try {
    return encodeRustNetworkAgentWorkCommandV1({
      commandId: command.commandId,
      agentId: command.agentId,
      kind: command.kind,
      expectedWorldRevision: command.expectedWorldRevision,
      issuedAt: command.issuedAt,
      expiresAt: command.expiresAt,
      workUnits: agentWorkUnits(command),
      taskId,
      arguments: argumentsBytes,
    });
  }
  catch (error) {
    if (error instanceof RustNetworkAgentWorkV1Error) {
      throw new RustNetworkRuntimeContractError(error.code, error.message);
    }
    throw error;
  }
}

function agentEnvelope(value: unknown): AgentCommandEnvelope | null {
  const candidate = record(value);
  if (!candidate || candidate.schema !== 1 || typeof candidate.commandId !== "string" || typeof candidate.agentId !== "string"
    || typeof candidate.kind !== "string" || !AGENT_COMMAND_KINDS.includes(candidate.kind as AgentCommandEnvelope["kind"])
    || !Number.isSafeInteger(candidate.expectedWorldRevision) || !Number.isSafeInteger(candidate.issuedAt)
    || !Number.isSafeInteger(candidate.expiresAt) || !record(candidate.arguments)) return null;
  return candidate as AgentCommandEnvelope;
}

export class IntegratedRustMultiplayerAuthorityV1 implements RustMultiplayerAuthorityV1 {
  readonly backend = "rust-wasm-worker" as const;
  private readonly now: () => number;
  private readonly grantLifetimeMs: number;
  private readonly peerLifecycles = new Map<string, {
    sessionId: string;
    peerId: string;
    connectionId: string;
    requestedConnectionGeneration: number;
    connectionGeneration: number;
    nextCommandSequence: number;
    active: boolean;
    commandsOpen: boolean;
    leasedCommandIds: Set<string>;
  }>();
  private readonly nativePoseChains = new Map<string, Readonly<{
    recordRevision: number;
    recordHash: string;
  }>>();
  private readonly nativePoseProjections = new Map<string, Readonly<{
    wire: Uint8Array;
  }>>();
  private readonly nativePoseProjectionOrder: string[] = [];
  private serial = Promise.resolve<unknown>(undefined);

  constructor(private readonly options: IntegratedRustMultiplayerAuthorityOptionsV1) {
    this.now = options.now ?? (() => Date.now());
    this.grantLifetimeMs = options.grantLifetimeMs ?? DEFAULT_GRANT_LIFETIME_MS;
    if (!Number.isSafeInteger(this.grantLifetimeMs) || this.grantLifetimeMs < 1_000 || this.grantLifetimeMs > 24 * 60 * 60_000) {
      throw new RustNetworkRuntimeContractError("grant-lifetime", "multiplayer grant lifetime is outside the V1 bound");
    }
  }

  currentIdentity() { return this.options.identity(); }

  createHandshake(input: Readonly<{ sessionId: string; peerId: string; peerKind: "human" | "agent"; role: "host" | "guest" }>) {
    return encodeNetworkHandshakeSourceWireV1({
      ...input,
      engineVersion: this.options.engineVersion,
      contentHash: this.options.contentHash,
      generatorHash: this.options.generatorHash,
      capabilities: ["observe", "chat", "interact", "inventory", "build", "combat", "creature-care", "trade", "travel", ...(input.peerKind === "agent" ? ["agent-work" as const] : [])],
      maxCommandBytes: NETWORK_MAX_COMMAND_BYTES_V1,
    });
  }

  negotiate(hostPacket: Uint8Array, peerPacket: Uint8Array) {
    return this.track(async () => {
      const result = await this.options.network.negotiate(hostPacket, peerPacket);
      if (result.kind !== "handshake") throw new RustNetworkRuntimeContractError("response-kind", `Expected Rust handshake response, received ${result.kind}`);
      if (!result.compatible || result.code !== "ok") throw new RustNetworkRuntimeContractError(result.code, result.message);
      return Object.freeze({ capabilities: result.capabilities, maxCommandBytes: result.maxCommandBytes });
    });
  }

  installPeer(peer: RustMultiplayerAuthorityPeerV1): Promise<RustMultiplayerAuthorityPeerInstallV1> {
    return this.track(async () => {
      if (!Number.isSafeInteger(peer.connectionGeneration) || peer.connectionGeneration < 1) {
        throw new RustNetworkRuntimeContractError("connection-generation", "peer connection generation must be a positive safe integer");
      }
      const key = this.peerKey(peer.sessionId, peer.peerId);
      const current = this.peerLifecycles.get(key);
      if (!current && this.peerLifecycles.size >= RUST_MULTIPLAYER_MAX_DURABLE_PEER_LIFECYCLES_V1) {
        throw new RustNetworkRuntimeContractError(
          "peer-capacity",
          "durable multiplayer peer lifecycle history reached its V1 capacity",
        );
      }
      if (current?.active && peer.connectionGeneration < current.connectionGeneration) {
        return Object.freeze({
          status: "superseded" as const,
          nextSequence: current.nextCommandSequence,
          connectionGeneration: current.connectionGeneration,
        });
      }
      if (current?.active
        && peer.connectionGeneration === current.connectionGeneration
        && peer.connectionId !== current.connectionId) {
        throw new RustNetworkRuntimeContractError("connection-generation", "peer grant reused one connection generation for another token");
      }
      if (current
        && !current.active
        && peer.connectionId === current.connectionId
        && peer.connectionGeneration <= current.connectionGeneration) {
        return Object.freeze({
          status: "superseded" as const,
          nextSequence: current.nextCommandSequence,
          connectionGeneration: current.connectionGeneration,
        });
      }
      let connectionGeneration = peer.connectionGeneration;
      if (current && !current.active && peer.connectionId !== current.connectionId
        && connectionGeneration <= current.connectionGeneration) {
        if (current.connectionGeneration >= Number.MAX_SAFE_INTEGER) {
          throw new RustNetworkRuntimeContractError("connection-generation", "peer connection generation space is exhausted");
        }
        connectionGeneration = current.connectionGeneration + 1;
      }
      if (current && connectionGeneration < current.connectionGeneration) {
        return Object.freeze({
          status: "superseded" as const,
          nextSequence: current.nextCommandSequence,
          connectionGeneration: current.connectionGeneration,
        });
      }
      if (current && connectionGeneration > current.connectionGeneration) {
        current.active = false;
        current.commandsOpen = false;
        for (const commandId of current.leasedCommandIds) await this.options.lifecycle.releaseCommand(commandId);
        current.leasedCommandIds.clear();
      }
      const nextSequence = Math.max(peer.nextSequence, current?.nextCommandSequence ?? 0);
      const grant: NetworkPeerGrantV1 = Object.freeze({
        sessionId: peer.sessionId, peerId: peer.peerId, connectionId: peer.connectionId, actorId: peer.actorId,
        peerKind: peer.peerKind, role: peer.role, capabilities: peer.capabilities,
        expiresAt: peer.expiresAt || this.now() + this.grantLifetimeMs, nextSequence, interest: peer.interest,
      });
      const replacement = {
        sessionId: peer.sessionId,
        peerId: peer.peerId,
        connectionId: peer.connectionId,
        requestedConnectionGeneration: current?.connectionId === peer.connectionId
          && current.connectionGeneration === connectionGeneration
          ? current.requestedConnectionGeneration
          : peer.connectionGeneration,
        connectionGeneration,
        nextCommandSequence: nextSequence,
        active: false,
        commandsOpen: false,
        leasedCommandIds: current?.connectionGeneration === connectionGeneration
          ? current.leasedCommandIds
          : new Set<string>(),
      };
      this.peerLifecycles.set(key, replacement);
      try {
        await this.options.lifecycle.installPeerGrant(grant);
      } catch (error) {
        replacement.active = false;
        replacement.commandsOpen = false;
        throw error;
      }
      replacement.active = true;
      replacement.commandsOpen = current?.connectionGeneration === connectionGeneration
        ? current.commandsOpen
        : true;
      return Object.freeze({ status: "installed" as const, nextSequence, connectionGeneration });
    });
  }

  authorizeInbound(command: RustMultiplayerInboundCommandV1): Promise<RustMultiplayerAuthorityDecisionV1> {
    return this.track(async () => {
      const shape = COMMAND_SHAPES[command.messageType];
      if (!shape) throw new RustNetworkRuntimeContractError("message-type", `Rust authority does not recognize ${command.messageType}`);
      const commandId = commandIdentity(command);
      const idempotencyKey = `idem:${new TypeScriptCanonicalHasher("blockwild-network-idempotency-v1").writeString(command.sessionId).writeString(command.peerId).writeString(commandId).finishHex()}`;
      const agent = command.messageType === "agent-command" ? agentEnvelope(command.payload) : null;
      if (command.messageType === "agent-command" && !agent) throw new RustNetworkRuntimeContractError("agent-envelope", "agent command cannot be encoded for Rust authority");
      const payload = agent ? encodeAgentWorkCommand(agent)
        : command.messageType === "player-pose" ? encodeRustNetworkPlayerPoseV1(command.payload)
          : encoder.encode(command.encodedEnvelope);
      const current = this.peerLifecycles.get(this.peerKey(command.sessionId, command.peerId));
      const ownerMatches = current?.active === true && current.connectionId === command.connectionId;
      const rejectWithoutNative = (code: string) => Object.freeze({
        accepted: false,
        commandId,
        idempotencyKey,
        code,
        receiptHash: null,
        expected: command.expected,
        current: this.currentIdentity(),
      });
      if (!ownerMatches) return rejectWithoutNative("connection-mismatch");
      if (command.sequence > current.nextCommandSequence) return rejectWithoutNative("sequence");
      if (command.sequence === current.nextCommandSequence && !current.commandsOpen) return rejectWithoutNative("connection-mismatch");
      const authorityNow = this.now();
      const oldestAcceptedSentAt = Math.max(0, authorityNow - 30_000);
      const newestAcceptedSentAt = Math.min(Number.MAX_SAFE_INTEGER, authorityNow + 120_000);
      if (!agent && (command.sentAt < oldestAcceptedSentAt || command.sentAt > newestAcceptedSentAt)) {
        return rejectWithoutNative("command-expired");
      }
      const expiresAt = agent?.expiresAt
        ?? Math.min(Number.MAX_SAFE_INTEGER, command.sentAt + 30_000, newestAcceptedSentAt);
      const consumesCurrentSequence = command.sequence === current.nextCommandSequence;
      const canonicalCommand = createNetworkCommandV1({
        sessionId: command.sessionId, commandId, idempotencyKey, peerId: command.peerId,
        connectionId: command.connectionId, actorId: command.actorId, peerKind: command.peerKind,
        kind: shape.kind, requiredCapability: shape.capability, sequence: command.sequence,
        expected: command.expected, expiresAt, leaseKeys: commandLeaseKeys(command), payload,
      });
      const packet = encodeNetworkCommandWireV1(canonicalCommand);
      if (consumesCurrentSequence) current.nextCommandSequence = command.sequence + 1;
      if (command.messageType === "player-pose") {
        let response: Awaited<ReturnType<RustNetworkRuntimeServiceV1["authorizeGuestPose"]>>;
        const requestIdentity = this.currentIdentity();
        try {
          response = await this.options.network.authorizeGuestPose(requestIdentity, this.now(), packet);
        } catch (error) {
          if (consumesCurrentSequence) current.commandsOpen = false;
          throw error;
        }
        if (response.kind !== "guest-pose") {
          if (consumesCurrentSequence) current.commandsOpen = false;
          throw new RustNetworkRuntimeContractError("response-kind", `Expected Rust guest-pose response, received ${response.kind}`);
        }
        const receipt = response.receipt;
        const projection = response.projection;
        const accepted = receipt.status === "accepted";
        try {
          if (receipt.commandId !== commandId
            || receipt.idempotencyKey !== idempotencyKey
            || receipt.peerId !== command.peerId
            || receipt.identity.stateHash !== requestIdentity.stateHash) {
            throw new RustNetworkRuntimeContractError("pose-receipt", "Rust guest pose receipt is not bound to the exact authority request");
          }
          if (accepted && (!projection
            || projection.sessionId !== command.sessionId
            || projection.peerId !== command.peerId
            || projection.connectionId !== command.connectionId
            || projection.playerId !== command.actorId
            || projection.commandId !== commandId
            || projection.commandSequence !== command.sequence
            || projection.commandHash !== canonicalCommand.commandHash
            || projection.authorityReceiptHash !== receipt.receiptHash
            || projection.presentedIdentityHash !== command.expected.stateHash
            || !equalBytes(encodeRustNetworkPlayerPoseV1(projection.pose), payload))) {
            throw new RustNetworkRuntimeContractError("pose-projection", "Rust accepted guest pose without an exact command-bound native projection");
          }
          if (!accepted && projection) {
            throw new RustNetworkRuntimeContractError("pose-projection", "Rust rejected guest pose but returned a native projection");
          }
          if (accepted && projection) {
            this.recordNativePoseProjection(this.peerKey(command.sessionId, command.peerId), projection);
          }
        } catch (error) {
          if (consumesCurrentSequence) current.commandsOpen = false;
          if (accepted) await this.options.lifecycle.releaseCommand(commandId);
          throw error;
        }
        if (consumesCurrentSequence && !accepted) current.commandsOpen = false;
        if (accepted) current.leasedCommandIds.add(commandId);
        return Object.freeze({
          accepted,
          commandId,
          idempotencyKey,
          code: accepted ? "accepted" : receipt.code,
          receiptHash: projection?.projectionHash ?? receipt.receiptHash,
          ...(projection ? { nativePose: Object.freeze({
            schema: 1 as const,
            sessionId: projection.sessionId,
            peerId: projection.peerId,
            connectionId: projection.connectionId,
            commandId: projection.commandId,
            commandSequence: projection.commandSequence,
            commandHash: projection.commandHash,
            authorityReceiptHash: projection.authorityReceiptHash,
            presentedDeltaSequence: projection.presentedDeltaSequence,
            presentedIdentityHash: projection.presentedIdentityHash,
            recordRevision: projection.recordRevision,
            previousRecordHash: projection.previousRecordHash,
            recordHash: projection.recordHash,
            pose: projection.pose,
            receiptHash: projection.projectionHash,
          }) } : {}),
          expected: command.expected,
          current: receipt.identity,
        });
      }
      if (agent) {
        let response: Awaited<ReturnType<RustNetworkRuntimeServiceV1["authorizeAgent"]>>;
        try {
          response = await this.options.network.authorizeAgent(this.currentIdentity(), this.now(), packet, payload);
        } catch (error) {
          if (consumesCurrentSequence) current.commandsOpen = false;
          throw error;
        }
        if (response.kind !== "agent-command") {
          if (consumesCurrentSequence) current.commandsOpen = false;
          throw new RustNetworkRuntimeContractError("response-kind", `Expected Rust agent-command response, received ${response.kind}`);
        }
        const receipt = response.receipt;
        const accepted = response.code === "accepted" && receipt?.status === "accepted";
        if (consumesCurrentSequence && !accepted) current.commandsOpen = false;
        if (accepted) current.leasedCommandIds.add(commandId);
        return Object.freeze({
          accepted,
          commandId, idempotencyKey, code: response.code, receiptHash: receipt?.receiptHash ?? null,
          expected: command.expected,
          current: receipt?.identity ?? this.currentIdentity(),
        });
      }
      let response: Awaited<ReturnType<RustNetworkRuntimeServiceV1["authorize"]>>;
      try {
        response = await this.options.network.authorize(this.currentIdentity(), this.now(), [packet]);
      } catch (error) {
        if (consumesCurrentSequence) current.commandsOpen = false;
        throw error;
      }
      if (response.kind !== "command-batch") {
        if (consumesCurrentSequence) current.commandsOpen = false;
        throw new RustNetworkRuntimeContractError("response-kind", `Expected Rust command-batch response, received ${response.kind}`);
      }
      const receipt = response.receipts[0];
      if (response.receipts.length !== 1 || !receipt) {
        if (consumesCurrentSequence) current.commandsOpen = false;
        throw new RustNetworkRuntimeContractError("receipt-count", "Rust authority did not return exactly one command receipt");
      }
      const accepted = receipt.status === "accepted";
      if (consumesCurrentSequence && !accepted) current.commandsOpen = false;
      if (accepted) current.leasedCommandIds.add(commandId);
      return Object.freeze({
        accepted, commandId, idempotencyKey,
        code: receipt.status === "accepted" ? "accepted" : receipt.code,
        receiptHash: receipt.receiptHash,
        expected: command.expected,
        current: receipt.identity,
      });
    });
  }

  installAgentGrant(grant: AgentCapabilityGrant, peer: RustMultiplayerAuthorityPeerV1) {
    return this.track(async () => {
      const current = this.peerLifecycles.get(this.peerKey(peer.sessionId, peer.peerId));
      if (!current?.active
        || current.connectionId !== peer.connectionId
        || (current.connectionGeneration !== peer.connectionGeneration
          && current.requestedConnectionGeneration !== peer.connectionGeneration)) return;
      await this.options.lifecycle.installAgentGrant({
        agentId: grant.agentId, peerId: peer.peerId, connectionId: grant.connectionId,
        status: grant.status, requested: grant.requested, granted: grant.granted,
        expiresAt: peer.expiresAt || this.now() + this.grantLifetimeMs,
      });
    });
  }

  upsertReplicationRecord(value: RustIntegratedScopedDeltaRecordV1) { return this.track(() => this.options.lifecycle.upsertReplicationRecord(value)); }
  removeReplicationRecord(value: RustIntegratedScopedDeltaRecordV1) { return this.track(() => this.options.lifecycle.removeReplicationRecord(value)); }

  buildDelta(value: RustMultiplayerDeltaBuildRequestV1) {
    return this.track(async () => {
      const current = this.peerLifecycles.get(this.peerKey(value.sessionId, value.peerId));
      if (!current?.active
        || current.connectionId !== value.connectionId
        || current.connectionGeneration !== value.connectionGeneration) {
        throw new RustNetworkRuntimeContractError("connection-mismatch", "delta build was authored for a superseded peer connection");
      }
      const result = await this.options.lifecycle.buildDelta({
        sessionId: value.sessionId,
        deltaId: value.deltaId,
        peerId: value.peerId,
        keyframe: value.keyframe,
        sequence: value.sequence,
        acknowledgedCommandSequence: current.nextCommandSequence,
        from: value.from,
        to: value.to,
        interest: value.interest,
      });
      return Object.freeze({ scopeProbes: result.scopeProbes, candidateRecords: result.candidateRecords, emittedRecords: result.emittedRecords, packet: result.deltaPacket });
    });
  }

  acceptDelta(value: RustMultiplayerDeltaFrameV1) {
    return this.track(async () => {
      const recovered = await this.options.lifecycle.reconnectCheckpoint(value.sessionId, value.peerId, value.connectionGeneration);
      const checkpoint = recovered ?? encodeNetworkReconnectCheckpointWireV1(createNetworkReconnectCheckpointV1({
        sessionId: value.sessionId, peerId: value.peerId, connectionGeneration: value.connectionGeneration,
        acknowledgedCommandSequence: 0, acknowledgedDeltaSequence: 0, identity: value.remoteIdentity,
        interestHash: value.interest.interestHash,
      }));
      const result = await this.options.network.validateDelta(checkpoint, value.interest, value.packet);
      if (result.kind !== "delta-delivery") throw new RustNetworkRuntimeContractError("response-kind", `Expected Rust delta-delivery response, received ${result.kind}`);
      return Object.freeze({ code: result.code, sequence: result.sequence, stateHash: result.stateHash });
    });
  }

  reconnectCheckpoint(sessionId: string, peerId: string, connectionGeneration: number) {
    return this.track(() => this.options.lifecycle.reconnectCheckpoint(sessionId, peerId, connectionGeneration));
  }

  releaseCommand(commandId: string) {
    return this.track(async () => {
      await this.options.lifecycle.releaseCommand(commandId);
      for (const peer of this.peerLifecycles.values()) peer.leasedCommandIds.delete(commandId);
    });
  }
  releasePeer(peer: RustMultiplayerAuthorityPeerFenceV1) {
    return this.track(async () => {
      const current = this.peerLifecycles.get(this.peerKey(peer.sessionId, peer.peerId));
      if (!current?.active
        || current.connectionId !== peer.connectionId
        || (current.connectionGeneration !== peer.connectionGeneration
          && current.requestedConnectionGeneration !== peer.connectionGeneration)) return "superseded" as const;
      current.active = false;
      current.commandsOpen = false;
      await this.options.lifecycle.releasePeer(peer.peerId);
      current.leasedCommandIds.clear();
      // Native receipts and the stable command cursor intentionally outlive
      // one connection grant. A replacement grant resumes at this exact next
      // sequence and receives it in the first accepted Rust delta.
      return "released" as const;
    });
  }
  runExclusiveMutation<T>(operation: () => Promise<T>) { return this.track(operation); }
  async drain() { await this.serial; }

  private track<T>(operation: () => Promise<T>) {
    const next = this.serial.then(operation, operation);
    this.serial = next.then(() => undefined, () => undefined);
    return next;
  }

  private recordNativePoseProjection(peerKey: string, projection: RustNetworkPlayerPoseProjectionV1) {
    const wire = encodeRustNetworkPlayerPoseProjectionV1(projection);
    const projectionKey = `${peerKey}\u0000${projection.projectionHash}`;
    const seen = this.nativePoseProjections.get(projectionKey);
    if (seen) {
      if (!equalBytes(seen.wire, wire)) {
        throw new RustNetworkRuntimeContractError("pose-projection", "Rust replayed one native pose projection hash with different canonical bytes");
      }
      return;
    }
    const prior = this.nativePoseChains.get(peerKey);
    const ancestryMatches = prior
      ? projection.recordRevision === prior.recordRevision + 1
        && projection.previousRecordHash === prior.recordHash
      : projection.recordRevision === 1
        && projection.previousRecordHash === "0".repeat(32);
    if (!ancestryMatches) {
      throw new RustNetworkRuntimeContractError("pose-projection", "Rust native player pose record ancestry is not contiguous");
    }
    if (!prior && this.nativePoseChains.size >= MAX_NATIVE_POSE_RECORDS_V1) {
      throw new RustNetworkRuntimeContractError("pose-record-budget", "Rust native player pose record budget exceeded its browser mirror");
    }
    this.nativePoseChains.set(peerKey, Object.freeze({
      recordRevision: projection.recordRevision,
      recordHash: projection.recordHash,
    }));
    this.nativePoseProjections.set(projectionKey, Object.freeze({ wire }));
    this.nativePoseProjectionOrder.push(projectionKey);
    while (this.nativePoseProjectionOrder.length > MAX_NATIVE_POSE_PROJECTIONS_V1) {
      const expired = this.nativePoseProjectionOrder.shift();
      if (expired) this.nativePoseProjections.delete(expired);
    }
  }

  private peerKey(sessionId: string, peerId: string) { return `${sessionId}\u0000${peerId}`; }
}
