import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  MultiplayerProtocolError,
  MultiplayerSession,
  RELIABLE_CHANNEL_LABEL,
  type DataChannelLike,
  type MultiplayerEvent,
  type PeerConnectionFactory,
  type PeerConnectionLike,
  type PeerIdentity,
} from "../app/game/multiplayer.ts";
import {
  createNetworkAuthorityIdentityV1,
  createNetworkInterestSetV1,
  type NetworkAuthorityIdentityV1,
} from "../app/game/network-authority-contract.ts";
import type {
  RustMultiplayerAuthorityDecisionV1,
  RustMultiplayerAuthorityPeerV1,
  RustMultiplayerAuthorityV1,
  RustMultiplayerInboundCommandV1,
  RustMultiplayerDeltaFrameV1,
} from "../app/game/rust-multiplayer-authority.ts";
import { createRustMultiplayerRuntimeDescriptorV2 } from "../app/game/rust-multiplayer-runtime-bootstrap.ts";
import type { AgentCapabilityGrant, AgentCommandEnvelope } from "../app/game/agent-platform.ts";

const HOST: PeerIdentity = { id: "player_host_001", name: "Host", color: "#44aaee" };
const GUEST: PeerIdentity = { id: "player_guest_01", name: "Guest", color: "#ee8844" };
const AGENT: PeerIdentity = { id: "agent_drone_001", name: "Mica", color: "#88dd66", peerKind: "agent" };
const WORLD_IDENTITY = createNetworkAuthorityIdentityV1(
  { universeId: "blockwild", locationId: "world-main" },
  { epoch: 1, world: 7, entities: 11, gameplay: 13, persistence: 17 },
);
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
  readonly receipts = new Map<string, Readonly<{ encoded: string; decision: RustMultiplayerAuthorityDecisionV1 }>>();
  gate: Promise<void> | null = null;
  authorityNow = Date.now();
  deltaPacket = Uint8Array.of(1, 2, 3);
  deltaCodes: string[] = [];
  private receiptSequence = 0;

  currentIdentity() { return this.identity; }
  createHandshake(input: Readonly<{ sessionId: string; peerId: string; peerKind: "human" | "agent"; role: "host" | "guest" }>) { return new TextEncoder().encode(JSON.stringify(input)); }
  async negotiate() { return { capabilities: ["interact", "inventory", "build", "chat", "agent-work"] as const, maxCommandBytes: 1_048_576 }; }
  async installPeer(peer: RustMultiplayerAuthorityPeerV1) { this.peerGrants.push(peer); this.nextSequence.set(peer.peerId, peer.nextSequence); }
  async authorizeInbound(command: RustMultiplayerInboundCommandV1) {
    this.inbound.push(command);
    if (this.gate) { const gate = this.gate; this.gate = null; await gate; }
    const payload = command.payload as Record<string, unknown>;
    const commandId = typeof payload.commandId === "string" ? payload.commandId
      : typeof payload.requestId === "string" ? payload.requestId
        : `${command.messageType}:${command.peerId}:${command.sequence}`;
    const cached = this.receipts.get(commandId);
    if (cached) {
      if (cached.encoded === command.encodedEnvelope) return cached.decision;
      return this.decision(false, commandId, "invalid");
    }
    if (command.messageType === "agent-command" && typeof payload.expiresAt === "number" && payload.expiresAt < this.authorityNow) {
      return this.decision(false, commandId, "expired");
    }
    if (command.expected.stateHash !== this.identity.stateHash) return this.decision(false, commandId, "stale-revision");
    if (command.actorId !== command.peerId) return this.decision(false, commandId, "connection-mismatch");
    if (command.sequence !== (this.nextSequence.get(command.peerId) ?? 0)) return this.decision(false, commandId, "sequence");
    this.nextSequence.set(command.peerId, command.sequence + 1);
    const decision = this.decision(true, commandId, "accepted");
    this.receipts.set(commandId, { encoded: command.encodedEnvelope, decision });
    return decision;
  }
  async installAgentGrant(grant: AgentCapabilityGrant) { this.agentGrants.push(structuredClone(grant)); }
  async upsertReplicationRecord() {}
  async removeReplicationRecord() {}
  async buildDelta() { return { scopeProbes: 1, candidateRecords: 2, emittedRecords: 2, packet: this.deltaPacket }; }
  async acceptDelta(value: RustMultiplayerDeltaFrameV1) {
    this.acceptedDeltas.push(value);
    return { code: this.deltaCodes.shift() ?? "applied", sequence: this.acceptedDeltas.length, stateHash: this.identity.stateHash };
  }
  async reconnectCheckpoint() { return null; }
  async releaseCommand(commandId: string) { this.releasedCommands.push(commandId); }
  async releasePeer(peerId: string) { this.releasedPeers.push(peerId); }
  async drain() {}

  private decision(accepted: boolean, commandId: string, code: string): RustMultiplayerAuthorityDecisionV1 {
    const receiptHash = accepted ? (++this.receiptSequence).toString(16).padStart(32, "0") : (++this.receiptSequence).toString(16).padStart(32, "f").slice(-32);
    return { accepted, commandId, idempotencyKey: `idem:${commandId}`, code, receiptHash };
  }
}

let idSequence = 0;
function makeSession(identity: PeerIdentity, network: FakeRtcNetwork, authority: FakeAuthority, events: MultiplayerEvent[]) {
  return new MultiplayerSession({
    identity,
    sessionId: RUNTIME.runtimeSessionId,
    rustAuthority: authority,
    authorityInterest: () => INTEREST,
    rustRuntimeDescriptor: RUNTIME,
    peerConnectionFactory: network.factory,
    randomId: (prefix) => `${prefix}_${identity.id}_${++idSequence}`,
    autoMaintenance: false,
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

test("Rust authority is mandatory unless legacy compatibility is explicitly selected", () => {
  const network = new FakeRtcNetwork();
  assert.throws(() => new MultiplayerSession({ identity: HOST, peerConnectionFactory: network.factory, autoMaintenance: false }), MultiplayerProtocolError);
  assert.doesNotThrow(() => new MultiplayerSession({ identity: HOST, authorityMode: "legacy-compatibility", peerConnectionFactory: network.factory, autoMaintenance: false }).dispose());
  assert.throws(() => new MultiplayerSession({ identity: { ...HOST, id: "player_雪_001" }, authorityMode: "legacy-compatibility", peerConnectionFactory: network.factory, autoMaintenance: false }), MultiplayerProtocolError);
});

test("host emits only after serialized Rust receipts and suppresses replay/conflict/stale commands", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const guestAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const guest = makeSession(GUEST, network, guestAuthority, []);
  await connect(host, guest);
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

  guestAuthority.identity = createNetworkAuthorityIdentityV1(WORLD_IDENTITY.address, { ...WORLD_IDENTITY.revision, gameplay: WORLD_IDENTITY.revision.gameplay - 1 });
  guest.sendChat({ schema: 1, id: "chat_msg_stale", sequence: 3, authorId: GUEST.id, authorName: GUEST.name, peerKind: "human", channel: "global", text: "stale", sentAt: Date.now() });
  await host.drainAuthority(); await flush();
  assert.ok(hostEvents.some((event) => event.type === "authority-rejection" && event.code === "stale-revision"));
  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

test("agent grants precede work receipts and terminal/shutdown paths release leases", async () => {
  const network = new FakeRtcNetwork();
  const hostAuthority = new FakeAuthority();
  const agentAuthority = new FakeAuthority();
  const hostEvents: MultiplayerEvent[] = [];
  const host = makeSession(HOST, network, hostAuthority, hostEvents);
  const agent = makeSession(AGENT, network, agentAuthority, []);
  const token = await connect(host, agent);
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
  hostAuthority.deltaPacket = Uint8Array.from({ length: 220_000 }, (_, index) => index % 251);
  guestAuthority.deltaCodes.push("sequence-gap", "applied");
  const to = guestAuthority.currentIdentity();
  await host.sendRustAuthorityDelta({ deltaId: "delta_nonkey_001", keyframe: false, sequence: 1, acknowledgedCommandSequence: 0, to }, GUEST.id);
  await guest.drainAuthority(); await flush();
  assert.ok(guestEvents.some((event) => event.type === "authority-resync" && event.code === "sequence-gap"));
  await host.sendRustAuthorityDelta({ deltaId: "delta_keyframe_01", keyframe: true, sequence: 2, acknowledgedCommandSequence: 0, to }, GUEST.id);
  await guest.drainAuthority(); await flush();
  const applied = guestEvents.find((event) => event.type === "authority-delta");
  assert.ok(applied && applied.packet.byteLength === 220_000 && applied.keyframe);
  assert.deepEqual([...guestAuthority.acceptedDeltas.at(-1)!.packet], [...hostAuthority.deltaPacket]);
  host.dispose(); guest.dispose(); await Promise.all([host.drainAuthority(), guest.drainAuthority()]);
});

assert.equal(MULTIPLAYER_PROTOCOL_VERSION, 3);
