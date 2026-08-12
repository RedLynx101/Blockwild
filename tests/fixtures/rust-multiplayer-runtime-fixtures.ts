import {
  createNetworkAuthorityIdentityV1,
  createNetworkInterestSetV1,
  type NetworkAuthorityIdentityV1,
} from "../../app/game/network-authority-contract.ts";
import type {
  DataChannelLike,
  PeerConnectionFactory,
  PeerConnectionLike,
  PeerIdentity,
} from "../../app/game/multiplayer.ts";
import type {
  RustMultiplayerAuthorityDecisionV1,
  RustMultiplayerAuthorityV1,
} from "../../app/game/rust-multiplayer-authority.ts";
import { createRustMultiplayerRuntimeDescriptorV2 } from "../../app/game/rust-multiplayer-runtime-bootstrap.ts";

export const RUNTIME_SESSION_ID = "session_runtime_bootstrap_001";
export const GENERATOR_HASH = "a".repeat(32);
export const CONTENT_HASH = "b".repeat(32);
export const TERRAIN_CONTENT_HASH = "c".repeat(32);
export const GENERATION_OPTIONS_JSON = JSON.stringify({
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
});
export const HOST_IDENTITY: PeerIdentity = { id: "player_runtime_host_001", name: "Runtime Host", color: "#44aaee" };
export const GUEST_IDENTITY: PeerIdentity = { id: "player_runtime_guest_001", name: "Runtime Guest", color: "#ee8844" };
export const RUNTIME_DESCRIPTOR = createRustMultiplayerRuntimeDescriptorV2({
  worldSeed: "runtime-bootstrap-world",
  universeId: "blockwild",
  locationId: "surface",
  runtimeSessionId: RUNTIME_SESSION_ID,
  generatorHash: GENERATOR_HASH,
  contentHash: CONTENT_HASH,
  terrainContentHash: TERRAIN_CONTENT_HASH,
  generationOptionsJson: GENERATION_OPTIONS_JSON,
});

export const RUNTIME_INTEREST = createNetworkInterestSetV1({
  sequence: 1,
  chunks: [{ universeId: RUNTIME_DESCRIPTOR.universeId, locationId: RUNTIME_DESCRIPTOR.locationId, chunkX: 0, chunkZ: 0 }],
  entityIds: [],
});

export class FixtureRustAuthority implements RustMultiplayerAuthorityV1 {
  readonly backend = "rust-wasm-worker" as const;
  identity: NetworkAuthorityIdentityV1;
  negotiateError: Error | null = null;
  negotiateGate: Promise<void> | null = null;
  readonly events: string[] = [];

  constructor(universeId = RUNTIME_DESCRIPTOR.universeId, locationId = RUNTIME_DESCRIPTOR.locationId) {
    this.identity = createNetworkAuthorityIdentityV1(
      { universeId, locationId },
      { epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1 },
    );
  }

  currentIdentity() { this.events.push("identity"); return this.identity; }
  createHandshake() { this.events.push("handshake"); return Uint8Array.of(1, 2, 3); }
  async negotiate() {
    this.events.push("negotiate");
    if (this.negotiateGate) await this.negotiateGate;
    if (this.negotiateError) throw this.negotiateError;
    return { capabilities: ["interact"] as const, maxCommandBytes: 1_024 };
  }
  async installPeer() { this.events.push("install-peer"); }
  async authorizeInbound(): Promise<RustMultiplayerAuthorityDecisionV1> {
    return { accepted: true, commandId: "fixture", idempotencyKey: "fixture", code: "accepted", receiptHash: "c".repeat(32) };
  }
  async installAgentGrant() {}
  async upsertReplicationRecord() {}
  async removeReplicationRecord() {}
  async buildDelta() { return { scopeProbes: 0, candidateRecords: 0, emittedRecords: 0, packet: new Uint8Array() }; }
  async acceptDelta() { return { code: "applied", sequence: 0, stateHash: this.identity.stateHash }; }
  async reconnectCheckpoint() { return null; }
  async releaseCommand() {}
  async releasePeer() { this.events.push("release-peer"); }
  async drain() { this.events.push("drain"); }
}

class FixtureDataChannel implements DataChannelLike {
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  binaryType: BinaryType = "arraybuffer";
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(
    readonly label: string,
    readonly ordered: boolean,
    readonly maxRetransmits: number | null,
  ) {}

  send() { if (this.readyState !== "open") throw new Error("fixture channel is closed"); }
  close() { this.readyState = "closed"; }
}

export class FixtureRtcNetwork {
  private nextId = 0;
  readonly connections: FixturePeerConnection[] = [];
  readonly factory: PeerConnectionFactory = () => {
    const connection = new FixturePeerConnection(`runtime_rtc_${++this.nextId}`);
    this.connections.push(connection);
    return connection;
  };
}

export class FixturePeerConnection implements PeerConnectionLike {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = "complete";
  connectionState: RTCPeerConnectionState = "new";
  onicegatheringstatechange: ((event: Event) => void) | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  readonly channels: FixtureDataChannel[] = [];
  closed = false;

  constructor(readonly id: string) {}

  createDataChannel(label: string, options: RTCDataChannelInit = {}) {
    const channel = new FixtureDataChannel(label, options.ordered ?? true, options.maxRetransmits ?? null);
    this.channels.push(channel);
    return channel;
  }
  async createOffer() { return { type: "offer" as const, sdp: `fixture-offer:${this.id}` }; }
  async createAnswer() { return { type: "answer" as const, sdp: `fixture-answer:${this.id}` }; }
  async setLocalDescription(value: RTCSessionDescriptionInit) { this.localDescription = { type: value.type, sdp: value.sdp }; }
  async setRemoteDescription(value: RTCSessionDescriptionInit) { this.remoteDescription = { type: value.type, sdp: value.sdp }; }
  close() { this.closed = true; this.connectionState = "closed"; for (const channel of this.channels) channel.close(); }
}

export function deterministicRuntimeIds(namespace: string) {
  let sequence = 0;
  return (prefix: string) => `${prefix}_${namespace}_${++sequence}`;
}

export function unsafeInviteCode(value: unknown) {
  return `BW1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
