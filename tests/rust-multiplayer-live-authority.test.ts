import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  MultiplayerPeerTransportUnavailableError,
  MultiplayerProtocolError,
  MultiplayerSession,
  RELIABLE_CHANNEL_LABEL,
  type DataChannelLike,
  type MultiplayerEvent,
  type PeerConnectionFactory,
  type PeerConnectionLike,
  type PeerIdentity,
  type PlayerSessionSnapshot,
} from "../app/game/multiplayer.ts";
import {
  createNetworkAuthorityIdentityV1,
  createNetworkDeltaV1,
  createNetworkInterestSetV1,
  type NetworkAuthorityIdentityV1,
  type NetworkDeltaInputV1,
} from "../app/game/network-authority-contract.ts";
import { encodeNetworkDeltaWireV1 } from "../app/game/rust-network-wire-v1.ts";
import type {
  RustMultiplayerAuthorityDecisionV1,
  RustMultiplayerAuthorityPeerV1,
  RustMultiplayerAuthorityV1,
  RustMultiplayerInboundCommandV1,
  RustMultiplayerDeltaFrameV1,
} from "../app/game/rust-multiplayer-authority.ts";
import { createRustMultiplayerRuntimeDescriptorV2 } from "../app/game/rust-multiplayer-runtime-bootstrap.ts";
import type { AgentCapabilityGrant, AgentCommandEnvelope } from "../app/game/agent-platform.ts";
import { createSkillState } from "../app/game/skills.ts";

const HOST: PeerIdentity = { id: "player_host_001", name: "Host", color: "#44aaee" };
const GUEST: PeerIdentity = { id: "player_guest_01", name: "Guest", color: "#ee8844" };
const AGENT: PeerIdentity = { id: "agent_drone_001", name: "Mica", color: "#88dd66", peerKind: "agent" };
const WORLD_IDENTITY = createNetworkAuthorityIdentityV1(
  { universeId: "blockwild", locationId: "world-main" },
  { epoch: 1, world: 7, entities: 11, gameplay: 13, persistence: 17 },
);
const REPLICATED_STATE_HASH = "f".repeat(32);
const INTEREST = createNetworkInterestSetV1({
  sequence: 1,
  chunks: [{ universeId: "blockwild", locationId: "world-main", chunkX: 0, chunkZ: 0 }],
  entityIds: [],
});
const RUNTIME = createRustMultiplayerRuntimeDescriptorV2({
  worldSeed: "rust-live-authority-fixture",
  universeId: WORLD_IDENTITY.address.universeId,
  locationId: WORLD_IDENTITY.address.locationId,
  runtimeSessionId: "session_rust_live_001",
  generatorHash: "a".repeat(32),
  contentHash: "b".repeat(32),
  terrainContentHash: "c".repeat(32),
  generationOptionsJson: JSON.stringify({
    biomeScale: 1.35,
    caveFrequency: 1,
    enabledFactions: ["hobbits", "goblins", "atlantians", "sugarcourt", "wood-elves", "dwarves"],
    largeTownFrequency: "balanced",
    profile: "world-below-v15",
    resourceAbundance: 1,
    roadCoverage: "regional",
    settlementClustering: "regional",
    settlementDensity: 1,
    settlementPattern: "heartlands-v2",
    structures: true,
  }),
});

class FakeChannel implements DataChannelLike {
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  binaryType: BinaryType = "arraybuffer";
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  remote: FakeChannel | null = null;
  readonly sent: string[] = [];

  constructor(readonly label: string, readonly ordered: boolean, readonly maxRetransmits: number | null) {}

  open() { this.readyState = "open"; this.onopen?.({ type: "open" } as Event); }
  send(data: string) {
    if (this.readyState !== "open") throw new Error("channel closed");
    this.sent.push(data);
    const remote = this.remote;
    queueMicrotask(() => { if (remote?.readyState === "open") remote.onmessage?.({ data } as MessageEvent); });
  }
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    const remote = this.remote;
    this.remote = null;
    this.onclose?.({ type: "close" } as Event);
    remote?.remoteClose();
  }
  private remoteClose() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.remote = null;
    this.onclose?.({ type: "close" } as Event);
  }
}

class FakeRtcNetwork {
  private nextId = 0;
  readonly connections: FakeConnection[] = [];
  readonly factory: PeerConnectionFactory = () => {
    const connection = new FakeConnection(this, `rtc_${++this.nextId}`);
    this.connections.push(connection);
    return connection;
  };
}

class FakeConnection implements PeerConnectionLike {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = "complete";
  connectionState: RTCPeerConnectionState = "new";
  onicegatheringstatechange: ((event: Event) => void) | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  readonly channels: FakeChannel[] = [];
  private remoteOfferId: string | null = null;

  constructor(private readonly network: FakeRtcNetwork, readonly id: string) {}
  createDataChannel(label: string, options: RTCDataChannelInit = {}) {
    const channel = new FakeChannel(label, options.ordered ?? true, options.maxRetransmits ?? null);
    this.channels.push(channel);
    return channel;
  }
  async createOffer() { return { type: "offer" as const, sdp: `offer:${this.id}` }; }
  async createAnswer() { return { type: "answer" as const, sdp: `answer:${this.id}:${this.remoteOfferId}` }; }
  async setLocalDescription(value: RTCSessionDescriptionInit) { this.localDescription = { type: value.type, sdp: value.sdp }; }
  async setRemoteDescription(value: RTCSessionDescriptionInit) {
    this.remoteDescription = { type: value.type, sdp: value.sdp };
    if (value.type === "offer") { this.remoteOfferId = value.sdp?.split(":")[1] ?? null; return; }
    const [, guestId, hostId] = value.sdp?.split(":") ?? [];
    const guest = this.network.connections.find((candidate) => candidate.id === guestId);
    if (!guest || hostId !== this.id) throw new Error("bad fake answer");
    for (const local of this.channels) {
      const remote = new FakeChannel(local.label, local.ordered, local.maxRetransmits);
      local.remote = remote; remote.remote = local; guest.channels.push(remote);
      guest.ondatachannel?.({ channel: remote } as unknown as RTCDataChannelEvent);
      local.open(); remote.open();
    }
    this.connectionState = "connected"; guest.connectionState = "connected";
    this.onconnectionstatechange?.({ type: "connectionstatechange" } as Event);
    guest.onconnectionstatechange?.({ type: "connectionstatechange" } as Event);
  }
  close() { if (this.connectionState !== "closed") { this.connectionState = "closed"; for (const channel of this.channels) channel.close(); } }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

class FakeAuthority implements RustMultiplayerAuthorityV1 {
  readonly backend = "rust-wasm-worker" as const;
  identity: NetworkAuthorityIdentityV1 = WORLD_IDENTITY;
  readonly inbound: RustMultiplayerInboundCommandV1[] = [];
  readonly peerGrants: RustMultiplayerAuthorityPeerV1[] = [];
  readonly agentGrants: AgentCapabilityGrant[] = [];
  readonly releasedCommands: string[] = [];
  readonly releasedPeers: string[] = [];
  readonly acceptedDeltas: RustMultiplayerDeltaFrameV1[] = [];
  readonly nextSequence = new Map<string, number>();
  readonly peerConnections = new Map<string, Readonly<{ connectionId: string; connectionGeneration: number }>>();
  readonly receipts = new Map<string, Readonly<{ encoded: string; decision: RustMultiplayerAuthorityDecisionV1 }>>();
  readonly poseRecordRevisions = new Map<string, number>();
  readonly poseRecordHashes = new Map<string, string>();
  gate: Promise<void> | null = null;
  authorityNow = Date.now();
  deltaPacket: Uint8Array | null = null;
  deltaBuildGate: Promise<void> | null = null;
  deltaRecords: NetworkDeltaInputV1["records"] = [];
  deltaCodes: string[] = [];
  enforceSharedPlayerLease = false;
  nextInstallConnectionGeneration: number | null = null;
  readonly playerLeaseTimeline: string[] = [];
  private receiptSequence = 0;
  private activePlayerLease: string | null = null;

  currentIdentity() { return this.identity; }
  createHandshake(input: Readonly<{ sessionId: string; peerId: string; peerKind: "human" | "agent"; role: "host" | "guest" }>) { return new TextEncoder().encode(JSON.stringify(input)); }
  async negotiate() { return { capabilities: ["interact", "inventory", "build", "chat", "agent-work"] as const, maxCommandBytes: 1_048_576 }; }
  runExclusiveMutation<T>(operation: () => Promise<T>) { return operation(); }
  async installPeer(peer: RustMultiplayerAuthorityPeerV1) {
    this.peerGrants.push(peer);
    const nextSequence = Math.max(peer.nextSequence, this.nextSequence.get(peer.peerId) ?? 0);
    const connectionGeneration = this.nextInstallConnectionGeneration ?? peer.connectionGeneration;
    this.nextInstallConnectionGeneration = null;
    this.nextSequence.set(peer.peerId, nextSequence);
    this.peerConnections.set(peer.peerId, Object.freeze({
      connectionId: peer.connectionId,
      connectionGeneration,
    }));
    return { status: "installed" as const, nextSequence, connectionGeneration };
  }
  async authorizeInbound(command: RustMultiplayerInboundCommandV1) {
    this.inbound.push(command);
    if (this.gate) { const gate = this.gate; this.gate = null; await gate; }
    const payload = command.payload as Record<string, unknown>;
    const commandId = typeof payload.commandId === "string" ? payload.commandId
      : typeof payload.requestId === "string" ? payload.requestId
        : `${command.messageType}:${command.peerId}:${command.sequence}`;
    const usesSharedPlayerLease = command.messageType === "player-state" || command.messageType === "player-progress";
    if (this.enforceSharedPlayerLease && usesSharedPlayerLease) {
      this.playerLeaseTimeline.push(`authorize:${commandId}:${this.activePlayerLease ?? "free"}`);
      if (this.activePlayerLease) return this.decision(false, commandId, "lease-conflict", command.expected);
    }
    const cached = this.receipts.get(commandId);
    if (cached) {
      if (cached.encoded === command.encodedEnvelope) return cached.decision;
      return this.decision(false, commandId, "invalid", command.expected);
    }
    if (command.messageType === "agent-command" && typeof payload.expiresAt === "number" && payload.expiresAt < this.authorityNow) {
      return this.decision(false, commandId, "expired", command.expected);
    }
    if (command.expected.stateHash !== this.identity.stateHash) return this.decision(false, commandId, "stale-revision", command.expected);
    if (command.actorId !== command.peerId) return this.decision(false, commandId, "connection-mismatch", command.expected);
    if (command.sequence !== (this.nextSequence.get(command.peerId) ?? 0)) return this.decision(false, commandId, "sequence", command.expected);
    this.nextSequence.set(command.peerId, command.sequence + 1);
    const decision = this.decision(true, commandId, "accepted", command.expected, command);
    if (this.enforceSharedPlayerLease && usesSharedPlayerLease) this.activePlayerLease = commandId;
    this.receipts.set(commandId, { encoded: command.encodedEnvelope, decision });
    return decision;
  }
  async installAgentGrant(grant: AgentCapabilityGrant) { this.agentGrants.push(structuredClone(grant)); }
  async upsertReplicationRecord() {}
  async removeReplicationRecord() {}
  async buildDelta(value: Parameters<RustMultiplayerAuthorityV1["buildDelta"]>[0]) {
    const active = this.peerConnections.get(value.peerId);
    if (!active
      || active.connectionId !== value.connectionId
      || active.connectionGeneration !== value.connectionGeneration) throw new Error("superseded fixture delta build");
    if (this.deltaBuildGate) {
      const gate = this.deltaBuildGate;
      this.deltaBuildGate = null;
      await gate;
    }
    const packet = this.deltaPacket ?? encodeNetworkDeltaWireV1(createNetworkDeltaV1({
      ...value,
      acknowledgedCommandSequence: this.nextSequence.get(value.peerId) ?? 0,
      interestHash: value.interest.interestHash,
      records: this.deltaRecords,
    }));
    return { scopeProbes: 1, candidateRecords: this.deltaRecords.length, emittedRecords: this.deltaRecords.length, packet };
  }
  async acceptDelta(value: RustMultiplayerDeltaFrameV1) {
    this.acceptedDeltas.push(value);
    // Rust returns a hash over the accepted replicated projection, not the
    // integrated authority identity embedded in the delta.
    return { code: this.deltaCodes.shift() ?? "applied", sequence: this.acceptedDeltas.length, stateHash: REPLICATED_STATE_HASH };
  }
  async reconnectCheckpoint() { return null; }
  async releaseCommand(commandId: string) {
    this.releasedCommands.push(commandId);
    if (this.activePlayerLease === commandId) {
      this.playerLeaseTimeline.push(`release:${commandId}`);
      this.activePlayerLease = null;
    }
  }
  async releasePeer(peer: Parameters<RustMultiplayerAuthorityV1["releasePeer"]>[0]) {
    const active = this.peerConnections.get(peer.peerId);
    if (!active
      || active.connectionId !== peer.connectionId
      || active.connectionGeneration !== peer.connectionGeneration) return "superseded" as const;
    this.releasedPeers.push(peer.peerId);
    this.peerConnections.delete(peer.peerId);
    return "released" as const;
  }
  async drain() {}

  private decision(
    accepted: boolean,
    commandId: string,
    code: string,
    expected: NetworkAuthorityIdentityV1,
    command?: RustMultiplayerInboundCommandV1,
  ): RustMultiplayerAuthorityDecisionV1 {
    const receiptHash = accepted ? (++this.receiptSequence).toString(16).padStart(32, "0") : (++this.receiptSequence).toString(16).padStart(32, "f").slice(-32);
    if (!accepted || command?.messageType !== "player-pose") {
      return { accepted, commandId, idempotencyKey: `idem:${commandId}`, code, receiptHash, expected, current: this.identity };
    }
    const payload = command.payload as Record<string, unknown>;
    const recordRevision = (this.poseRecordRevisions.get(command.peerId) ?? 0) + 1;
    const previousRecordHash = this.poseRecordHashes.get(command.peerId) ?? "0".repeat(32);
    const recordHash = (10_000 + this.receiptSequence).toString(16).padStart(32, "0");
    const poseHash = (20_000 + this.receiptSequence).toString(16).padStart(32, "0");
    const authorityReceiptHash = (30_000 + this.receiptSequence).toString(16).padStart(32, "0");
    const commandHash = (40_000 + this.receiptSequence).toString(16).padStart(32, "0");
    this.poseRecordRevisions.set(command.peerId, recordRevision);
    this.poseRecordHashes.set(command.peerId, recordHash);
    return {
      accepted,
      commandId,
      idempotencyKey: `idem:${commandId}`,
      code,
      receiptHash,
      nativePose: Object.freeze({
        schema: 1,
        sessionId: command.sessionId,
        peerId: command.peerId,
        connectionId: command.connectionId,
        commandId,
        commandSequence: command.sequence,
        commandHash,
        authorityReceiptHash,
        presentedDeltaSequence: 1,
        presentedIdentityHash: command.expected.stateHash,
        recordRevision,
        previousRecordHash,
        recordHash,
        pose: Object.freeze({
          schema: 1,
          playerId: String(payload.playerId),
          tick: Number(payload.tick),
          x: Number(payload.x), y: Number(payload.y), z: Number(payload.z),
          yaw: Number(payload.yaw), pitch: Number(payload.pitch),
          vx: Number(payload.vx), vy: Number(payload.vy), vz: Number(payload.vz),
          grounded: Boolean(payload.grounded),
          ...(payload.selected === undefined ? {} : { selected: Number(payload.selected) }),
          shieldRaised: Boolean(payload.shieldRaised),
          crouching: Boolean(payload.crouching),
          sprinting: Boolean(payload.sprinting),
          action: payload.action === "mine" || payload.action === "use" ? payload.action : "none",
          ...(typeof payload.swimming === "number" ? { swimming: payload.swimming } : {}),
          ...(typeof payload.seated === "number" ? { seated: payload.seated } : {}),
          ...(typeof payload.boatId === "string" ? { boatId: payload.boatId } : {}),
          ...(typeof payload.boatSeat === "number" ? { boatSeat: payload.boatSeat } : {}),
          ...(typeof payload.boatForward === "number" ? { boatForward: payload.boatForward } : {}),
          ...(typeof payload.boatTurn === "number" ? { boatTurn: payload.boatTurn } : {}),
          ...(typeof payload.mountedCreatureId === "number" ? { mountedCreatureId: payload.mountedCreatureId } : {}),
          ...(typeof payload.mountedCreatureSeat === "number" ? { mountedCreatureSeat: payload.mountedCreatureSeat } : {}),
          poseHash,
        }),
        receiptHash,
      }),
      expected,
      current: this.identity,
    };
  }
}

let idSequence = 0;
function makeSession(
  identity: PeerIdentity,
  network: FakeRtcNetwork,
  authority: FakeAuthority,
  events: MultiplayerEvent[],
  options: Readonly<{ authorityTimeoutMs?: number }> = {},
) {
  return new MultiplayerSession({
    identity,
    sessionId: RUNTIME.runtimeSessionId,
    rustAuthority: authority,
    authorityInterest: () => INTEREST,
    rustRuntimeDescriptor: RUNTIME,
    peerConnectionFactory: network.factory,
    randomId: (prefix) => `${prefix}_${identity.id}_${++idSequence}`,
    autoMaintenance: false,
    ...options,
    onEvent: (event) => events.push(event),
  });
}

async function flush() {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function connect(host: MultiplayerSession, guest: MultiplayerSession) {
  const offer = await host.createHostInvite();
  const answer = await guest.createGuestAnswer(offer.inviteCode);
  await host.acceptGuestAnswer(answer.answerCode);
  await flush();
  return offer.token;
}

async function acceptInitialKeyframe(
  host: MultiplayerSession,
  guest: MultiplayerSession,
  hostAuthority: FakeAuthority,
  guestEvents: MultiplayerEvent[],
  sequence = 1,
) {
  const identity = hostAuthority.currentIdentity();
  await host.sendRustAuthorityDelta({
    deltaId: `delta_bootstrap_${sequence}`,
    keyframe: true,
    sequence,
    from: identity,
    to: identity,
  }, guest.identity.id);
  await guest.drainAuthority();
  await flush();
  const event = guestEvents.findLast((candidate): candidate is Extract<MultiplayerEvent, { type: "authority-delta" }> => (
    candidate.type === "authority-delta" && candidate.sequence === sequence
  ));
  assert.ok(event, "guest must emit the Rust-accepted keyframe");
  assert.equal(event.stateHash, REPLICATED_STATE_HASH,
    "presentation acknowledgements must use the Rust receiver's replicated-state hash");
  assert.equal(guest.acceptedRustHostAuthorityIdentity()?.stateHash, WORLD_IDENTITY.stateHash,
    "the accepted host identity must retain its separate authority-state hash");
  assert.throws(
    () => guest.confirmRustGuestPresentationApplied(event.sequence, WORLD_IDENTITY.stateHash),
    /does not match an accepted Rust keyframe stream/,
    "the host authority identity hash must not confirm the receiver projection",
  );
  guest.confirmRustGuestPresentationApplied(event.sequence, event.stateHash);
  return event;
}

test("Rust authority is mandatory unless legacy compatibility is explicitly selected", () => {
  const network = new FakeRtcNetwork();
  assert.throws(() => new MultiplayerSession({ identity: HOST, peerConnectionFactory: network.factory, autoMaintenance: false }), MultiplayerProtocolError);
  assert.doesNotThrow(() => new MultiplayerSession({ identity: HOST, authorityMode: "legacy-compatibility", peerConnectionFactory: network.factory, autoMaintenance: false }).dispose());
  assert.throws(() => new MultiplayerSession({ identity: { ...HOST, id: "player_雪_001" }, authorityMode: "legacy-compatibility", peerConnectionFactory: network.factory, autoMaintenance: false }), MultiplayerProtocolError);
});

test("a delta build completing after its exact peer closes is a typed connection cancellation", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, []);
  await connect(host, guest);

  const gate = deferred();
  hostAuthority.deltaBuildGate = gate.promise;
  const identity = hostAuthority.currentIdentity();
  const pending = host.sendRustAuthorityDelta({
    deltaId: "delta_closed_during_build_001",
    keyframe: true,
    sequence: 1,
    from: identity,
    to: identity,
  }, GUEST.id);
  await flush();
  guest.disconnect("graceful-test-exit");
  await flush();
  gate.resolve();

  await assert.rejects(pending, (error) => (
    error instanceof MultiplayerPeerTransportUnavailableError
    && error.sentChunks === 0
    && error.chunkCount >= 1
  ));
  assert.equal(host.getPeers().length, 0);
  assert.equal(hostEvents.some((event) => event.type === "error"
    && event.error.message.includes("Rust delta transport accepted")), false,
  "connection cancellation must not be emitted as a transport protocol fault");

  host.dispose();
  guest.dispose();
  await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("a session adopts the adapter's durable generation before events and exact-fence cleanup", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const guestEvents: MultiplayerEvent[] = [];
  hostAuthority.nextInstallConnectionGeneration = 7;
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);

  await connect(host, guest);
  assert.equal(hostAuthority.peerGrants.at(-1)?.connectionGeneration, 1,
    "the new session begins from its local generation-one proposal");
  assert.equal(host.authorityTransportDiagnostics().peers[0]?.authorityGeneration, 7,
    "the effective adapter-owned generation is visible before connected work proceeds");
  const connectedEvent = hostEvents.find((event): event is Extract<MultiplayerEvent, { type: "peer" }> => (
    event.type === "peer" && event.peer.state === "connected"
  ));
  assert.equal(connectedEvent?.peer.identity?.id, GUEST.id);

  assert.equal(host.disconnectPeer(GUEST.id, "durable-generation-test"), true);
  await host.drainAuthority();
  assert.deepEqual(hostAuthority.releasedPeers, [GUEST.id],
    "teardown releases the effective generation rather than the superseded local proposal");

  host.dispose(); guest.dispose();
  await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("host emits only after serialized Rust receipts and suppresses replay/conflict/stale commands", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const guestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
  await connect(host, guest);
  await acceptInitialKeyframe(host, guest, hostAuthority, guestEvents);
  hostEvents.length = 0;

  const gate = deferred(); hostAuthority.gate = gate.promise;
  guest.sendChat({ schema: 1, id: "chat_msg_0001", sequence: 1, authorId: GUEST.id, authorName: GUEST.name, peerKind: "human", channel: "global", text: "水辺の salamander 🐉", sentAt: Date.now() });
  guest.sendChat({ schema: 1, id: "chat_msg_0002", sequence: 2, authorId: GUEST.id, authorName: GUEST.name, peerKind: "human", channel: "global", text: "second", sentAt: Date.now() });
  await flush();
  assert.equal(hostAuthority.inbound.length, 1, "one peer cannot run concurrent authority decisions");
  assert.equal(hostEvents.some((event) => event.type === "message"), false);
  gate.resolve();
  await host.drainAuthority(); await flush();
  assert.equal(hostAuthority.inbound.length, 2);
  const messages = hostEvents.filter((event) => event.type === "message");
  assert.equal(messages.length, 2);
  assert.equal((messages[0]!.envelope.payload as { text: string }).text, "水辺の salamander 🐉");
  assert.deepEqual(hostAuthority.inbound.map((entry) => entry.sequence), [0, 1], "control frames do not puncture the Rust command stream");

  const guestReliable = network.connections[1]!.channels.find((channel) => channel.label === RELIABLE_CHANNEL_LABEL)!;
  const firstChat = guestReliable.sent.map((value) => JSON.parse(value) as { type: string; payload: { id?: string } }).findIndex((value) => value.type === "chat" && value.payload.id === "chat_msg_0001");
  guestReliable.send(guestReliable.sent[firstChat]!);
  await host.drainAuthority(); await flush();
  assert.equal(hostEvents.filter((event) => event.type === "message").length, 2, "a cached Rust receipt never re-emits gameplay");

  const first = { requestId: "request_0001", actorId: GUEST.id, kind: "move" as const, from: { scope: "hotbar" as const, slot: 0 }, to: { scope: "hotbar" as const, slot: 1 }, status: "request" as const };
  guest.sendInventoryAction(first);
  guest.sendInventoryAction({ ...first, count: 2 });
  await host.drainAuthority(); await flush();
  assert.ok(hostEvents.some((event) => event.type === "authority-rejection" && event.code === "invalid"));
  const rejection = hostEvents.find((event) => event.type === "authority-rejection" && event.code === "invalid");
  assert.equal(rejection?.type, "authority-rejection");
  if (rejection?.type === "authority-rejection") {
    assert.equal(rejection.messageType, "inventory-action");
    assert.equal(rejection.expected.stateHash, WORLD_IDENTITY.stateHash);
    assert.equal(rejection.current.stateHash, WORLD_IDENTITY.stateHash);
    assert.equal(Object.isFrozen(rejection.expected), true);
    assert.equal(Object.isFrozen(rejection.current), true);
  }

  guestAuthority.identity = createNetworkAuthorityIdentityV1(WORLD_IDENTITY.address, { ...WORLD_IDENTITY.revision, gameplay: WORLD_IDENTITY.revision.gameplay - 1 });
  guest.sendChat({ schema: 1, id: "chat_msg_stale", sequence: 3, authorId: GUEST.id, authorName: GUEST.name, peerKind: "human", channel: "global", text: "stale", sentAt: Date.now() });
  await host.drainAuthority(); await flush();
  assert.equal(hostAuthority.inbound.at(-1)?.expected.stateHash, WORLD_IDENTITY.stateHash,
    "guest envelopes retain the last accepted host identity rather than a stale local runtime identity");
  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("Rust-authorized player poses expose bounded transport and admission diagnostics", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const guestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
  await connect(host, guest);
  await acceptInitialKeyframe(host, guest, hostAuthority, guestEvents);
  hostEvents.length = 0;

  const gate = deferred();
  hostAuthority.gate = gate.promise;
  assert.equal(guest.sendPlayerPose({
    playerId: GUEST.id,
    tick: 1,
    x: 4,
    y: 48.5,
    z: -3,
    yaw: 0.25,
    pitch: -0.1,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    action: "none",
  }), 1);
  await flush();

  const pending = host.authorityTransportDiagnostics();
  assert.equal(pending.peers.length, 1);
  assert.equal(pending.peers[0]?.lastInboundType, "player-pose");
  assert.equal(pending.peers[0]?.lastInboundAuthoritySequence, 0);
  assert.equal(pending.peers[0]?.authorityQueued, 1);
  assert.equal(pending.peers[0]?.authorityInFlight, 1);
  assert.equal(pending.peers[0]?.authorityAccepted, 0);
  assert.equal(pending.peers[0]?.nativePoseAccepted, 0);
  assert.equal(pending.peers[0]?.nativePoseDelivered, 0);
  assert.equal(guest.authorityTransportDiagnostics().outbound.authorityCommandSequence, 1);
  assert.equal(hostEvents.some((event) => event.type === "message"), false);

  gate.resolve();
  await host.drainAuthority();
  await flush();
  const completed = host.authorityTransportDiagnostics();
  assert.equal(completed.peers[0]?.authorityInFlight, 0);
  assert.equal(completed.peers[0]?.authorityAccepted, 1);
  assert.equal(completed.peers[0]?.authorityRejected, 0);
  assert.equal(completed.peers[0]?.authorityErrors, 0);
  assert.equal(completed.peers[0]?.nativePoseAccepted, 1);
  assert.equal(completed.peers[0]?.nativePoseDelivered, 1);
  assert.equal(completed.peers[0]?.nativePoseStaleGenerationDrops, 0);
  const nativePose = hostEvents.find((event): event is Extract<MultiplayerEvent, { type: "native-player-pose" }> => event.type === "native-player-pose");
  assert.ok(nativePose);
  assert.equal(nativePose.receipt.pose.x, 4);
  assert.equal(nativePose.receipt.pose.y, 48.5);
  assert.equal(nativePose.receipt.pose.playerId, GUEST.id);
  assert.equal(nativePose.receipt.commandSequence, 0);
  assert.equal(nativePose.receipt.receiptHash, completed.peers[0]?.lastNativePoseReceiptHash);
  assert.equal(nativePose.receipt.recordHash, completed.peers[0]?.lastNativePoseRecordHash);
  assert.equal(Object.isFrozen(nativePose.receipt), true);
  assert.equal(hostEvents.some((event) => event.type === "message" && event.envelope.type === "player-pose"), false,
    "Rust mode never emits the original raw pose envelope");
  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("a delayed accepted native pose from a superseded connection is released without delivery", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const firstGuestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const firstGuestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const firstGuest = makeSession(GUEST, network, firstGuestAuthority, firstGuestEvents);
  await connect(host, firstGuest);
  await acceptInitialKeyframe(host, firstGuest, hostAuthority, firstGuestEvents);
  hostEvents.length = 0;

  const gate = deferred();
  hostAuthority.gate = gate.promise;
  assert.equal(firstGuest.sendPlayerPose({
    playerId: GUEST.id,
    tick: 1,
    x: 4,
    y: 48.5,
    z: -3,
    yaw: 0.25,
    pitch: -0.1,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    action: "none",
  }), 1);
  await flush();
  const delayedCommand = hostAuthority.inbound.at(-1);
  assert.ok(delayedCommand);
  assert.equal(delayedCommand.messageType, "player-pose");
  const delayedCommandId = `player-pose:${GUEST.id}:${delayedCommand.sequence}`;
  const firstGrant = hostAuthority.peerGrants.at(-1);
  assert.ok(firstGrant);
  assert.equal(firstGrant.connectionGeneration, 1);

  assert.equal(host.disconnectPeer(GUEST.id, "supersede-delayed-pose"), true);
  await flush();

  const secondGuestAuthority = new FakeAuthority();
  const secondGuestEvents: MultiplayerEvent[] = [];
  const secondGuest = makeSession(GUEST, network, secondGuestAuthority, secondGuestEvents);
  await connect(host, secondGuest);
  const secondGrant = hostAuthority.peerGrants.at(-1);
  assert.ok(secondGrant);
  assert.equal(secondGrant.connectionGeneration, 2);
  assert.notEqual(secondGrant.connectionId, firstGrant.connectionId);

  gate.resolve();
  await host.drainAuthority();
  await flush();

  const delayedDecision = hostAuthority.receipts.get(delayedCommandId)?.decision;
  assert.ok(delayedDecision?.accepted, "the delayed fixture result must be an accepted native pose receipt");
  assert.equal(delayedDecision.nativePose?.connectionId, firstGrant.connectionId);
  assert.deepEqual(hostAuthority.releasedCommands, [delayedCommandId],
    "an accepted pose result for the closed generation must release its command custody");
  assert.deepEqual(hostAuthority.releasedPeers, [],
    "the superseded generation's deferred peer release must not release the replacement grant");
  assert.equal(
    hostEvents.some((event) => event.type === "native-player-pose"),
    false,
    "an accepted native pose from generation A must not cross the event boundary after generation B replaces it",
  );

  await acceptInitialKeyframe(host, secondGuest, hostAuthority, secondGuestEvents);
  assert.equal(secondGuest.authorityTransportDiagnostics().outbound.authorityCommandSequence, 1,
    "the replacement guest resumes after the stale accepted command cursor");
  assert.equal(secondGuest.sendPlayerPose({
    playerId: GUEST.id,
    tick: 2,
    x: 8,
    y: 48.5,
    z: -3,
    yaw: 0.25,
    pitch: -0.1,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    action: "none",
  }), 1);
  await host.drainAuthority();
  await flush();

  const replacementPoseEvents = hostEvents.filter(
    (event): event is Extract<MultiplayerEvent, { type: "native-player-pose" }> => event.type === "native-player-pose",
  );
  assert.equal(replacementPoseEvents.length, 1);
  assert.equal(replacementPoseEvents[0]?.connectionGeneration, 2);
  assert.equal(replacementPoseEvents[0]?.receipt.connectionId, secondGrant.connectionId);
  assert.equal(replacementPoseEvents[0]?.receipt.commandSequence, 1);
  assert.equal(replacementPoseEvents[0]?.receipt.pose.x, 8);
  const replacementDiagnostics = host.authorityTransportDiagnostics().peers[0];
  assert.equal(replacementDiagnostics?.nativePoseAccepted, 1);
  assert.equal(replacementDiagnostics?.nativePoseDelivered, 1);
  assert.equal(replacementDiagnostics?.nativePoseStaleGenerationDrops, 0);

  host.dispose(); firstGuest.dispose(); secondGuest.dispose();
  await Promise.all([host.drainAuthority(), firstGuest.drainAuthority(), secondGuest.drainAuthority()]);
});

test("a late accepted pose advances custody only, then reconnect continues the native record chain", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const firstGuestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const firstGuestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents, { authorityTimeoutMs: 250 });
  const firstGuest = makeSession(GUEST, network, firstGuestAuthority, firstGuestEvents);
  await connect(host, firstGuest);
  await acceptInitialKeyframe(host, firstGuest, hostAuthority, firstGuestEvents);

  const gate = deferred();
  hostAuthority.gate = gate.promise;
  assert.equal(firstGuest.sendPlayerPose({
    playerId: GUEST.id, tick: 1, x: 4, y: 48.5, z: -3, yaw: 0.25, pitch: -0.1,
    vx: 0, vy: 0, vz: 0, grounded: true, action: "none",
  }), 1);
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  await flush();
  assert.equal(hostEvents.some((event) => event.type === "native-player-pose"), false,
    "a pose that misses the authority deadline must never reach gameplay delivery");
  assert.ok(hostEvents.some((event) => event.type === "error" && /authority deadline/u.test(event.error.message)));

  gate.resolve();
  await host.drainAuthority();
  await flush();
  const lateDecision = hostAuthority.receipts.get(`player-pose:${GUEST.id}:0`)?.decision;
  assert.equal(lateDecision?.accepted, true);
  assert.equal(lateDecision.nativePose?.recordRevision, 1);
  assert.ok(hostAuthority.releasedCommands.includes(`player-pose:${GUEST.id}:0`));
  firstGuest.dispose();
  await firstGuest.drainAuthority();

  const secondGuestAuthority = new FakeAuthority();
  const secondGuestEvents: MultiplayerEvent[] = [];
  const secondGuest = makeSession(GUEST, network, secondGuestAuthority, secondGuestEvents);
  await connect(host, secondGuest);
  await acceptInitialKeyframe(host, secondGuest, hostAuthority, secondGuestEvents);
  assert.equal(secondGuest.authorityTransportDiagnostics().outbound.authorityCommandSequence, 1);
  assert.equal(secondGuest.sendPlayerPose({
    playerId: GUEST.id, tick: 2, x: 8, y: 48.5, z: -3, yaw: 0.25, pitch: -0.1,
    vx: 0, vy: 0, vz: 0, grounded: true, action: "none",
  }), 1);
  await host.drainAuthority();
  await flush();

  const delivered = hostEvents.filter(
    (event): event is Extract<MultiplayerEvent, { type: "native-player-pose" }> => event.type === "native-player-pose",
  );
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.receipt.recordRevision, 2);
  assert.equal(delivered[0]?.receipt.previousRecordHash, lateDecision.nativePose?.recordHash);
  assert.equal(delivered[0]?.receipt.pose.x, 8);

  host.dispose(); secondGuest.dispose();
  await Promise.all([host.drainAuthority(), secondGuest.drainAuthority()]);
});

test("a stalled Rust authority queue is bounded per peer and drops queued work after disconnect", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const guestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
  await connect(host, guest);
  await acceptInitialKeyframe(host, guest, hostAuthority, guestEvents);

  const gate = deferred();
  hostAuthority.gate = gate.promise;
  const pose = (tick: number) => ({
    playerId: GUEST.id, tick, x: 4 + tick / 100, y: 48.5, z: -3, yaw: 0.25, pitch: -0.1,
    vx: 0, vy: 0, vz: 0, grounded: true, action: "none" as const,
  });
  for (let index = 0; index < 65; index += 1) {
    assert.equal(guest.sendPlayerPose(pose(index + 1)), 1);
  }
  await flush();

  assert.ok(hostEvents.some((event) => event.type === "error" && /retained-work budget/u.test(event.error.message)),
    "the host must expose the exact per-peer authority queue budget failure");
  assert.equal(host.authorityTransportDiagnostics().peers.length, 0,
    "a peer that exceeds the native retained-work budget is closed immediately");
  const authorityCallsAtClose = hostAuthority.inbound.length;
  assert.ok(authorityCallsAtClose <= 1,
    "at most the already in-flight command may enter the stalled authority");

  gate.resolve();
  await host.drainAuthority();
  await flush();
  assert.equal(hostAuthority.inbound.length, authorityCallsAtClose,
    "queued closures become no-ops after the peer is closed");
  assert.equal(hostEvents.filter((event) => event.type === "native-player-pose").length, 0,
    "the late accepted in-flight command is released without gameplay delivery");
  if (authorityCallsAtClose === 1) {
    assert.ok(hostAuthority.releasedCommands.includes(`player-pose:${GUEST.id}:0`));
  }

  host.dispose(); guest.dispose();
  await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("reconnect keyframe seeds the stable command cursor before the guest resumes at the next suffix", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const firstGuestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const firstGuestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const firstGuest = makeSession(GUEST, network, firstGuestAuthority, firstGuestEvents);
  await connect(host, firstGuest);
  await acceptInitialKeyframe(host, firstGuest, hostAuthority, firstGuestEvents);
  const pose = (tick: number, x: number) => ({
    playerId: GUEST.id,
    tick,
    x,
    y: 48.5,
    z: -3,
    yaw: 0.25,
    pitch: -0.1,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    action: "none" as const,
  });
  assert.equal(firstGuest.sendPlayerPose(pose(1, 4)), 1);
  assert.equal(firstGuest.sendPlayerPose(pose(2, 5)), 1);
  await host.drainAuthority();
  await flush();
  assert.deepEqual(hostAuthority.inbound.slice(-2).map((command) => command.sequence), [0, 1]);
  assert.equal(hostAuthority.nextSequence.get(GUEST.id), 2);
  assert.deepEqual(
    hostEvents.filter((event): event is Extract<MultiplayerEvent, { type: "native-player-pose" }> => event.type === "native-player-pose")
      .slice(-2).map((event) => [event.connectionGeneration, event.receipt.commandSequence, event.receipt.recordRevision]),
    [[1, 0, 1], [1, 1, 2]],
  );

  assert.equal(host.disconnectPeer(GUEST.id, "fixture-reconnect"), true);
  await Promise.all([host.drainAuthority(), firstGuest.drainAuthority()]);
  firstGuest.dispose();
  await firstGuest.drainAuthority();

  const secondGuestAuthority = new FakeAuthority();
  const secondGuestEvents: MultiplayerEvent[] = [];
  const secondGuest = makeSession(GUEST, network, secondGuestAuthority, secondGuestEvents);
  await connect(host, secondGuest);
  const blockedBeforeKeyframe = secondGuest.sendPlayerPose(pose(3, 6));
  assert.equal(blockedBeforeKeyframe, 0);
  const reconnectIdentity = hostAuthority.currentIdentity();
  await host.sendRustAuthorityDelta({
    deltaId: "delta_reconnect_bootstrap_001",
    keyframe: true,
    sequence: 1,
    from: reconnectIdentity,
    to: reconnectIdentity,
  }, GUEST.id);
  await secondGuest.drainAuthority();
  await flush();
  const reconnectKeyframe = secondGuestEvents.findLast((event): event is Extract<MultiplayerEvent, { type: "authority-delta" }> => event.type === "authority-delta");
  assert.ok(reconnectKeyframe);
  assert.equal(reconnectKeyframe.delta.acknowledgedCommandSequence, 2);
  assert.equal(secondGuest.authorityTransportDiagnostics().outbound.authorityCommandSequence, 0,
    "Rust acceptance alone cannot seed or open the guest command allocator");
  assert.equal(secondGuest.sendPlayerPose(pose(4, 7)), 0);
  assert.equal(secondGuest.confirmRustGuestPresentationApplied(reconnectKeyframe.sequence, reconnectKeyframe.stateHash), true);
  assert.equal(secondGuest.authorityTransportDiagnostics().outbound.authorityCommandSequence, 2);

  assert.equal(secondGuest.sendPlayerPose(pose(5, 8)), 1);
  assert.equal(secondGuest.sendPlayerPose(pose(6, 9)), 1);
  await host.drainAuthority();
  await flush();
  assert.deepEqual(hostAuthority.inbound.slice(-2).map((command) => command.sequence), [2, 3]);
  assert.equal(hostAuthority.nextSequence.get(GUEST.id), 4);
  assert.deepEqual(
    hostEvents.filter((event): event is Extract<MultiplayerEvent, { type: "native-player-pose" }> => event.type === "native-player-pose")
      .slice(-2).map((event) => [event.connectionGeneration, event.receipt.commandSequence, event.receipt.recordRevision]),
    [[2, 2, 3], [2, 3, 4]],
    "native pose revisions and command custody remain monotonic across a fenced reconnect",
  );

  const identity = hostAuthority.currentIdentity();
  hostAuthority.deltaPacket = encodeNetworkDeltaWireV1(createNetworkDeltaV1({
    sessionId: RUNTIME.runtimeSessionId,
    deltaId: "delta_reconnect_ack_lower_002",
    peerId: GUEST.id,
    keyframe: true,
    sequence: 2,
    acknowledgedCommandSequence: 2,
    from: identity,
    to: identity,
    interestHash: INTEREST.interestHash,
    records: [],
  }));
  await host.sendRustAuthorityDelta({
    deltaId: "delta_reconnect_ack_lower_002",
    keyframe: true,
    sequence: 2,
    from: identity,
    to: identity,
  }, GUEST.id);
  await secondGuest.drainAuthority();
  await flush();
  const lowerAcknowledgement = secondGuestEvents.findLast((event): event is Extract<MultiplayerEvent, { type: "authority-delta" }> => event.type === "authority-delta" && event.sequence === 2);
  assert.ok(lowerAcknowledgement);
  assert.equal(secondGuest.confirmRustGuestPresentationApplied(lowerAcknowledgement.sequence, lowerAcknowledgement.stateHash), true);
  assert.equal(secondGuest.authorityTransportDiagnostics().outbound.authorityCommandSequence, 4,
    "a later host acknowledgement cannot rewind already allocated command suffixes");

  hostAuthority.deltaPacket = encodeNetworkDeltaWireV1(createNetworkDeltaV1({
    sessionId: RUNTIME.runtimeSessionId,
    deltaId: "delta_reconnect_ack_impossible_003",
    peerId: GUEST.id,
    keyframe: true,
    sequence: 3,
    acknowledgedCommandSequence: 5,
    from: identity,
    to: identity,
    interestHash: INTEREST.interestHash,
    records: [],
  }));
  await host.sendRustAuthorityDelta({
    deltaId: "delta_reconnect_ack_impossible_003",
    keyframe: true,
    sequence: 3,
    from: identity,
    to: identity,
  }, GUEST.id);
  await secondGuest.drainAuthority();
  await flush();
  const impossibleAcknowledgement = secondGuestEvents.findLast((event): event is Extract<MultiplayerEvent, { type: "authority-delta" }> => event.type === "authority-delta" && event.sequence === 3);
  assert.ok(impossibleAcknowledgement);
  assert.throws(() => secondGuest.confirmRustGuestPresentationApplied(impossibleAcknowledgement.sequence, impossibleAcknowledgement.stateHash), /did not author/u);
  assert.equal(secondGuest.isRustGuestPresentationReady(), false);

  hostAuthority.deltaPacket = null;
  host.dispose();
  secondGuest.dispose();
  await Promise.all([host.drainAuthority(), secondGuest.drainAuthority()]);
});

test("ordered Rust player-state requests release the shared player lease after delivery", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  hostAuthority.enforceSharedPlayerLease = true;
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const guestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
  await connect(host, guest);
  await acceptInitialKeyframe(host, guest, hostAuthority, guestEvents);
  hostEvents.length = 0;

  const state = (revision: number): PlayerSessionSnapshot => ({
    playerId: GUEST.id,
    revision,
    variant: "male",
    inventory: Array.from({ length: 36 }, () => null),
    equipment: { head: null, chest: null, legs: null, feet: null },
    selected: 0,
    health: 10,
    hunger: 10,
    xp: 0,
    level: 0,
    skills: createSkillState(),
  });
  const requestIds = ["state_ordered_001", "state_ordered_002"];
  assert.equal(guest.sendPlayerState({
    requestId: requestIds[0]!, actorId: GUEST.id, expectedRevision: 0,
    state: state(1), status: "request",
  }), 1);
  assert.equal(guest.sendPlayerState({
    requestId: requestIds[1]!, actorId: GUEST.id, expectedRevision: 1,
    state: state(2), status: "request",
  }), 1);

  await host.drainAuthority();
  await flush();
  const deliveredRequestIds = hostEvents.flatMap((event) => (
    event.type === "message" && event.envelope.type === "player-state"
      ? [(event.envelope.payload as { requestId: string }).requestId]
      : []
  ));
  assert.deepEqual(deliveredRequestIds, requestIds);
  assert.equal(hostEvents.some((event) => event.type === "authority-rejection"), false);
  assert.deepEqual(hostAuthority.releasedCommands, requestIds);
  assert.deepEqual(hostAuthority.playerLeaseTimeline, [
    `authorize:${requestIds[0]}:free`,
    `release:${requestIds[0]}`,
    `authorize:${requestIds[1]}:free`,
    `release:${requestIds[1]}`,
  ], "the second Rust authorization must observe the shared player lease as released");

  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("Rust player-progress chunks release the shared player lease before player-state authorization", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  hostAuthority.enforceSharedPlayerLease = true;
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const guestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
  await connect(host, guest);
  await acceptInitialKeyframe(host, guest, hostAuthority, guestEvents);
  hostEvents.length = 0;

  const transferId = "progress_shared_001";
  const stateRequestId = "state_after_progress_001";
  assert.equal(guest.sendPlayerProgress({
    transferId,
    actorId: GUEST.id,
    revision: 1,
    chunkIndex: 0,
    chunkCount: 1,
    data: "e30=",
    status: "request",
  }), 1);
  assert.equal(guest.sendPlayerState({
    requestId: stateRequestId,
    actorId: GUEST.id,
    expectedRevision: 0,
    state: {
      playerId: GUEST.id,
      revision: 1,
      variant: "male",
      inventory: Array.from({ length: 36 }, () => null),
      equipment: { head: null, chest: null, legs: null, feet: null },
      selected: 0,
      health: 10,
      hunger: 10,
      xp: 0,
      level: 0,
      skills: createSkillState(),
    },
    status: "request",
  }), 1);

  await host.drainAuthority();
  await flush();
  const progressCommandId = `player-progress:${GUEST.id}:0`;
  assert.deepEqual(hostEvents.flatMap((event) => (
    event.type === "message" ? [event.envelope.type] : []
  )), ["player-progress", "player-state"]);
  assert.equal(hostEvents.some((event) => event.type === "authority-rejection"), false);
  assert.deepEqual(hostAuthority.releasedCommands, [progressCommandId, stateRequestId]);
  assert.deepEqual(hostAuthority.playerLeaseTimeline, [
    `authorize:${progressCommandId}:free`,
    `release:${progressCommandId}`,
    `authorize:${stateRequestId}:free`,
    `release:${stateRequestId}`,
  ], "the state request must not collide with the synchronously handled progression chunk");

  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("suppressed Rust host terminal responses release retained commands without sending legacy payloads", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const guestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
  await connect(host, guest);
  await acceptInitialKeyframe(host, guest, hostAuthority, guestEvents);
  hostEvents.length = 0;
  guestEvents.length = 0;

  const request = {
    requestId: "terminal_suppressed_001",
    actorId: GUEST.id,
    kind: "move" as const,
    from: { scope: "hotbar" as const, slot: 0 },
    to: { scope: "hotbar" as const, slot: 1 },
    status: "request" as const,
  };
  assert.equal(guest.sendInventoryAction(request), 1);
  await host.drainAuthority();
  await flush();
  assert.ok(hostEvents.some((event) => event.type === "message"
    && event.envelope.type === "inventory-action"));
  assert.deepEqual(hostAuthority.releasedCommands, [], "a non-terminal request retains its Rust command lease");

  const hostReliable = network.connections[0]!.channels.find((channel) => channel.label === RELIABLE_CHANNEL_LABEL)!;
  const sentBeforeTerminal = hostReliable.sent.length;
  assert.equal(host.sendInventoryAction({
    ...request,
    status: "rejected",
    reason: "The host projection superseded this request.",
  }, GUEST.id), 0);
  await host.drainAuthority();
  await flush();

  assert.equal(hostReliable.sent.length, sentBeforeTerminal, "the compatibility response must remain suppressed");
  assert.equal(guestEvents.some((event) => event.type === "message"
    && event.envelope.type === "inventory-action"), false);
  assert.deepEqual(hostAuthority.releasedCommands, [request.requestId]);

  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("agent grants precede work receipts and terminal/shutdown paths release leases", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const agentAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const agentEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const agent = makeSession(AGENT, network, agentAuthority, agentEvents);
  const token = await connect(host, agent);
  await acceptInitialKeyframe(host, agent, hostAuthority, agentEvents);
  const now = Date.now();
  const grant: AgentCapabilityGrant = { schema: 1, agentId: AGENT.id, connectionId: token, status: "approved", requested: ["observe.world"], granted: ["observe.world"], updatedAt: now };
  assert.equal(host.sendAgentCapabilities(grant, AGENT.id), 1);
  await host.drainAuthority(); await flush();
  assert.equal(hostAuthority.agentGrants[0]?.status, "approved");

  const command: AgentCommandEnvelope = { schema: 1, commandId: "command_agent_0001", agentId: AGENT.id, kind: "observe", expectedWorldRevision: 13, issuedAt: now, expiresAt: now + 30_000, arguments: {}, clientIntent: "Inspect 雪 and emberflies" };
  agent.sendAgentCommand(command);
  await host.drainAuthority(); await flush();
  assert.ok(hostEvents.some((event) => event.type === "message" && event.envelope.type === "agent-command"));
  assert.equal((hostAuthority.inbound.find((entry) => entry.messageType === "agent-command")?.payload as AgentCommandEnvelope).clientIntent, "Inspect 雪 and emberflies");

  host.sendAgentResult({ schema: 1, commandId: command.commandId, agentId: AGENT.id, kind: "observe", status: "completed", code: "ok", message: "done", worldRevision: 13, startedAt: now, updatedAt: now + 1, terminal: true }, AGENT.id);
  await host.drainAuthority();
  assert.deepEqual(hostAuthority.releasedCommands, [command.commandId]);

  const expiryGate = deferred(); hostAuthority.gate = expiryGate.promise;
  const expired: AgentCommandEnvelope = { ...command, commandId: "command_agent_expired", issuedAt: now + 2, expiresAt: now + 1_000 };
  agent.sendAgentCommand(expired);
  await flush();
  hostAuthority.authorityNow = expired.expiresAt + 1;
  expiryGate.resolve();
  await host.drainAuthority(); await flush();
  assert.ok(hostEvents.some((event) => event.type === "authority-rejection" && event.commandId === expired.commandId && event.code === "expired"));
  host.disconnectPeer(AGENT.id, "test-complete");
  await host.drainAuthority();
  assert.equal(hostAuthority.agentGrants.at(-1)?.status, "disconnected");
  assert.deepEqual(hostAuthority.releasedPeers, [AGENT.id]);
  host.dispose(); agent.dispose(); await Promise.all([host.drainAuthority(), agent.drainAuthority()]);
});

test("Rust delta reassembly requests resync then recovers from a keyframe", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const guestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, []);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
  await connect(host, guest);
  hostAuthority.deltaRecords = [{
    kind: "world",
    recordId: "large-keyframe-record",
    revision: 2,
    payload: Uint8Array.from({ length: 220_000 }, (_, index) => index % 251),
  }];
  guestAuthority.deltaCodes.push("sequence-gap", "applied");
  const identity = hostAuthority.currentIdentity();
  await host.sendRustAuthorityDelta({
    deltaId: "delta_nonkey_001", keyframe: false, sequence: 1,
    from: identity, to: identity,
  }, GUEST.id);
  await guest.drainAuthority(); await flush();
  assert.ok(guestEvents.some((event) => event.type === "authority-resync" && event.code === "sequence-gap"));
  await host.sendRustAuthorityDelta({
    deltaId: "delta_keyframe_01", keyframe: true, sequence: 2,
    from: identity, to: identity,
  }, GUEST.id);
  await guest.drainAuthority(); await flush();
  const applied = guestEvents.find((event) => event.type === "authority-delta");
  assert.ok(applied && applied.packet.byteLength > 220_000 && applied.keyframe);
  assert.equal(applied.delta.records[0]?.payload.byteLength, 220_000);
  assert.deepEqual([...guestAuthority.acceptedDeltas.at(-1)!.packet], [...applied.packet]);
  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("Rust guests suppress commands until the accepted keyframe projection is applied", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const guestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
  await connect(host, guest);

  const chat = { schema: 1 as const, id: "chat_pre_keyframe", sequence: 1, authorId: GUEST.id, authorName: GUEST.name, peerKind: "human" as const, channel: "global" as const, text: "wait", sentAt: Date.now() };
  assert.equal(guest.sendChat(chat), 0);
  await flush();
  assert.equal(hostEvents.some((event) => event.type === "message"), false);

  const identity = hostAuthority.currentIdentity();
  await host.sendRustAuthorityDelta({
    deltaId: "delta_readiness_01", keyframe: true, sequence: 1,
    from: identity, to: identity,
  }, GUEST.id);
  await guest.drainAuthority(); await flush();
  const accepted = guestEvents.find((event): event is Extract<MultiplayerEvent, { type: "authority-delta" }> => event.type === "authority-delta");
  assert.ok(accepted);
  assert.equal(guest.sendChat({ ...chat, id: "chat_accepted_not_applied", sequence: 2 }), 0,
    "Rust acceptance alone does not open command flow before engine application");
  guest.confirmRustGuestPresentationApplied(accepted.sequence, accepted.stateHash);
  assert.equal(guest.isRustGuestPresentationReady(), true);
  assert.equal(guest.sendChat({ ...chat, id: "chat_after_projection", sequence: 3 }), 1);
  await host.drainAuthority(); await flush();
  assert.ok(hostEvents.some((event) => event.type === "message"
    && (event.envelope.payload as { id?: string }).id === "chat_after_projection"));
  guest.disconnect("readiness-reset");
  assert.equal(guest.isRustGuestPresentationReady(), false);
  assert.equal(guest.acceptedRustHostAuthorityIdentity(), null);
  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("Rust presentation barriers drain ordered guest commands and freeze until the replacement keyframe is applied", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const guestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
  await connect(host, guest);
  await acceptInitialKeyframe(host, guest, hostAuthority, guestEvents);

  const gate = deferred();
  hostAuthority.gate = gate.promise;
  assert.equal(guest.sendChat({
    schema: 1,
    id: "chat_before_barrier",
    sequence: 1,
    authorId: GUEST.id,
    authorName: GUEST.name,
    peerKind: "human",
    channel: "global",
    text: "ordered before freeze",
    sentAt: Date.now(),
  }), 1);
  const barrier = host.freezeRustGuestCommands(GUEST.id);
  let barrierResolved = false;
  void barrier.then(() => { barrierResolved = true; });
  await flush();
  assert.equal(barrierResolved, false, "the host fence waits for already-received Rust command authorization");
  assert.equal(guest.isRustGuestPresentationReady(), false);
  assert.equal(guest.sendChat({
    schema: 1,
    id: "chat_during_barrier",
    sequence: 2,
    authorId: GUEST.id,
    authorName: GUEST.name,
    peerKind: "human",
    channel: "global",
    text: "must remain local",
    sentAt: Date.now(),
  }), 0);

  gate.resolve();
  await barrier;
  await host.drainAuthority();
  await flush();
  assert.ok(hostEvents.some((event) => event.type === "message"
    && (event.envelope.payload as { id?: string }).id === "chat_before_barrier"));
  assert.equal(hostEvents.some((event) => event.type === "message"
    && (event.envelope.payload as { id?: string }).id === "chat_during_barrier"), false);

  const identity = hostAuthority.currentIdentity();
  await host.sendRustAuthorityDelta({
    deltaId: "delta_after_barrier_02",
    keyframe: true,
    sequence: 2,
    from: identity,
    to: identity,
  }, GUEST.id);
  await guest.drainAuthority();
  await flush();
  const replacement = guestEvents.findLast((event): event is Extract<MultiplayerEvent, { type: "authority-delta" }> => (
    event.type === "authority-delta" && event.sequence === 2
  ));
  assert.ok(replacement);
  assert.equal(guest.isRustGuestPresentationReady(), false, "Rust acceptance alone does not reopen the fence");
  guest.confirmRustGuestPresentationApplied(replacement.sequence, replacement.stateHash);
  assert.equal(guest.isRustGuestPresentationReady(), true);

  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("a later Rust fence prevents an older accepted projection from reopening guest commands", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const guestEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, []);
  const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
  await connect(host, guest);

  const identity = hostAuthority.currentIdentity();
  await host.sendRustAuthorityDelta({
    deltaId: "delta_superseded_01",
    keyframe: true,
    sequence: 1,
    from: identity,
    to: identity,
  }, GUEST.id);
  await guest.drainAuthority();
  await flush();
  const superseded = guestEvents.find((event): event is Extract<MultiplayerEvent, { type: "authority-delta" }> => (
    event.type === "authority-delta" && event.sequence === 1
  ));
  assert.ok(superseded);

  await host.freezeRustGuestCommands(GUEST.id);
  await flush();
  assert.equal(guest.confirmRustGuestPresentationApplied(superseded.sequence, superseded.stateHash), false);
  assert.equal(guest.isRustGuestPresentationReady(), false);

  await host.sendRustAuthorityDelta({
    deltaId: "delta_current_02",
    keyframe: true,
    sequence: 2,
    from: identity,
    to: identity,
  }, GUEST.id);
  await guest.drainAuthority();
  await flush();
  const current = guestEvents.findLast((event): event is Extract<MultiplayerEvent, { type: "authority-delta" }> => (
    event.type === "authority-delta" && event.sequence === 2
  ));
  assert.ok(current);
  assert.equal(guest.confirmRustGuestPresentationApplied(current.sequence, current.stateHash), true);
  assert.equal(guest.isRustGuestPresentationReady(), true);

  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("Rust guest delta linkage fails closed on a non-keyframe bootstrap or mismatched peer", async () => {
  for (const mismatch of ["non-keyframe", "peer"] as const) {
    const network = new FakeRtcNetwork();
    const hostAuthority = new FakeAuthority();
    const guestAuthority = new FakeAuthority();
    const guestEvents: MultiplayerEvent[] = [];
    const host = makeSession(HOST, network, hostAuthority, []);
    const guest = makeSession(GUEST, network, guestAuthority, guestEvents);
    await connect(host, guest);
    const identity = hostAuthority.currentIdentity();
    const keyframe = mismatch === "peer";
    if (mismatch === "peer") {
      hostAuthority.deltaPacket = encodeNetworkDeltaWireV1(createNetworkDeltaV1({
        sessionId: RUNTIME.runtimeSessionId,
        deltaId: "delta_wrong_peer",
        peerId: "player_intruder_001",
        keyframe: true,
        sequence: 1,
        acknowledgedCommandSequence: 0,
        from: identity,
        to: identity,
        interestHash: INTEREST.interestHash,
        records: [],
      }));
    }
    await host.sendRustAuthorityDelta({
      deltaId: `delta_fail_${mismatch.replace("-", "_")}`,
      keyframe,
      sequence: 1,
      from: identity,
      to: identity,
    }, GUEST.id);
    await guest.drainAuthority(); await flush();
    assert.ok(guestEvents.some((event) => event.type === "error"
      && /first accepted|does not match/iu.test(event.error.message)), mismatch);
    assert.equal(guest.getPeers().length, 0, `${mismatch} closes the invalid Rust peer`);
    host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
  }
});

assert.equal(MULTIPLAYER_PROTOCOL_VERSION, 3);
