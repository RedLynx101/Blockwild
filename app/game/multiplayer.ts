import type { DragonState } from "./dragons";
import type { CharacterColors, CharacterSkillAllocation } from "./character-profiles";
import type { FactionRace } from "./factions";
import type { SkillState } from "./skills";
import { MAX_TRADE_QUANTITY, type BankAccountState, type GoldWalletState, type MerchantState, type StockMarketState } from "./economy";
import type { QuestBook, QuestDefinition } from "./quests";
import type { MapKnowledge } from "./map-system";
import type { PlantBestiaryState } from "./plants";
import type { BlueprintState } from "./blueprints";
import type { MagicState } from "./magic";
import type { LivingBestiaryEntryV2 } from "./living-bestiary";
import { validateTcgNetworkAction, type TcgNetworkAction } from "./tcg/network";
import {
  AGENT_CAPABILITIES,
  validateAgentCapabilityGrant,
  validateAgentChatMessage,
  validateAgentCommand,
  validateAgentObservation,
  validateAgentResult,
  validateAgentVoiceChunk,
  type AgentCapability,
  type AgentCapabilityGrant,
  type AgentChatMessage,
  type AgentCommandEnvelope,
  type AgentCommandResult,
  type AgentObservationV1,
  type AgentPeerKind,
  type AgentVoiceChunk,
} from "./agent-platform";
import {
  createNetworkInterestSetV1,
  createNetworkAuthorityIdentityV1,
  type NetworkAuthorityIdentityV1,
  type NetworkCapabilityV1,
  type NetworkInterestSetV1,
} from "./network-authority-contract";
import type {
  RustMultiplayerAuthorityModeV1,
  RustMultiplayerAuthorityPeerV1,
  RustMultiplayerAuthorityV1,
} from "./rust-multiplayer-authority";
import {
  canonicalizeRustMultiplayerRuntimeBindingV2,
  parseRustMultiplayerRuntimeDescriptorV2,
  rustMultiplayerRuntimeDescriptorEqualsV2,
  validateRustMultiplayerRuntimeDescriptorV2,
  type RustMultiplayerAuthorityInterestV1,
  type RustMultiplayerGuestAuthorityFactoryV2,
  type RustMultiplayerRuntimeBindingV2,
  type RustMultiplayerRuntimeDescriptorV2,
} from "./rust-multiplayer-runtime-bootstrap";
import type { RustIntegratedNetworkDeltaBuildRequestV1 } from "./rust-integrated-runtime-network-lifecycle";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

/**
 * Browser-only, host-authoritative WebRTC multiplayer transport for Blockwild.
 *
 * The host owns one RTCPeerConnection per guest (a star topology). Signaling is
 * deliberately manual: players copy an offer code to a guest, then copy the
 * answer code back to the host. Once connected, authoritative gameplay uses a
 * reliable ordered channel while short-lived pose updates use an unordered,
 * no-retransmit channel.
 *
 * This module contains transport, validation, and peer lifecycle only. It does
 * not mutate the voxel world; the game simulation consumes typed `message`
 * events, validates actions as host, and publishes authoritative snapshots.
 */

export const MULTIPLAYER_PROTOCOL_VERSION = 3 as const;
export const MULTIPLAYER_PROTOCOL_NAME = "blockwild-webrtc" as const;
export const RELIABLE_CHANNEL_LABEL = "blockwild.gameplay.v3" as const;
export const MOVEMENT_CHANNEL_LABEL = "blockwild.movement.v3" as const;
export const VOICE_CHANNEL_LABEL = "blockwild.voice.v1" as const;

export const MAX_RELIABLE_MESSAGE_BYTES = 256 * 1024;
export const MAX_MOVEMENT_MESSAGE_BYTES = 64 * 1024;
export const MAX_VOICE_MESSAGE_BYTES = 64 * 1024;
export const MAX_INVITE_CODE_CHARS = 160 * 1024;
const MAX_SDP_CHARS = 112 * 1024;
const MAX_RELIABLE_BUFFERED_BYTES = 2 * 1024 * 1024;
const MAX_MOVEMENT_BUFFERED_BYTES = 64 * 1024;
const MAX_VOICE_BUFFERED_BYTES = 512 * 1024;
const MAX_PROTOCOL_STRIKES = 3;
const COORDINATE_LIMIT = 30_000_000;
const RUST_AUTHORITY_DELTA_SCHEMA = 1 as const;
const RUST_AUTHORITY_DELTA_CHUNK_BYTES = 96 * 1024;
const RUST_AUTHORITY_MAX_DELTA_BYTES = 16 * 1024 * 1024;
const RUST_AUTHORITY_MAX_DELTA_CHUNKS = Math.ceil(RUST_AUTHORITY_MAX_DELTA_BYTES / RUST_AUTHORITY_DELTA_CHUNK_BYTES);
const RUST_AUTHORITY_MAX_REASSEMBLIES_PER_PEER = 4;
const RUST_AUTHORITY_REASSEMBLY_TIMEOUT_MS = 30_000;

export type MultiplayerRole = "host" | "guest";
export type MultiplayerSessionState = "idle" | "hosting" | "joining" | "connected" | "disconnected" | "closed" | "error";
export type MultiplayerPeerState = "invited" | "connecting" | "connected" | "stale" | "disconnected" | "failed" | "closed";
export type MultiplayerChannelKind = "reliable" | "movement" | "voice";

export type PeerIdentity = {
  id: string;
  name: string;
  color: string;
  /** Optional protocol-v1 appearance preference, carried before the first pose. */
  variant?: "male" | "female";
  /** Stable character/browser keys let a reconnect recover the same host-owned state. */
  profileId?: string;
  browserId?: string;
  sex?: "male" | "female";
  race?: FactionRace;
  colors?: CharacterColors;
  /** First-join progression seed. The host uses it only when no saved state exists. */
  startingSkills?: CharacterSkillAllocation;
  /** Protocol-v3 peers default to human when this field is absent. */
  peerKind?: AgentPeerKind;
  /** Agent runner build, surfaced to the host during approval and diagnostics. */
  runnerVersion?: string;
  /** Least-privilege request. The host remains authoritative over the grant. */
  requestedCapabilities?: AgentCapability[];
};

export type PlayerPose = {
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
  /** Lightweight hotbar intent rides the unordered pose lane, not reliable inventory state. */
  selected?: number;
  heldItem?: number;
  /** Optional protocol-v1 appearance hint for metadata-backed Capture Orbs. */
  heldItemFilled?: boolean;
  offhandItem?: number;
  shieldRaised?: boolean;
  crouching?: boolean;
  sprinting?: boolean;
  action?: "none" | "mine" | "use";
  /** Optional for protocol-v1 peers; absent peers render with the legacy male model and no armor. */
  variant?: "male" | "female";
  sex?: "male" | "female";
  profileId?: string;
  browserId?: string;
  race?: FactionRace;
  colors?: CharacterColors;
  swimming?: number;
  seated?: number;
  equipment?: Partial<Record<"head" | "chest" | "legs" | "feet", number>>;
  boatId?: string;
  boatSeat?: number;
  /** Ephemeral helm intent. The host integrates the hull only for seat zero. */
  boatForward?: number;
  boatTurn?: number;
  /** Host-approved ridden creature; omitted immediately on dismount. */
  mountedCreatureId?: number;
  /** Host-assigned zero-based seat. Only seat zero contributes movement input. */
  mountedCreatureSeat?: number;
};

export type BlockEdit = { x: number; y: number; z: number; type: number; facing?: 0 | 1 | 2 | 3 };
export type ActionStatus = "request" | "accepted" | "rejected";

export type BlockAction = {
  requestId: string;
  actorId: string;
  tick: number;
  kind: "break" | "place" | "batch";
  edits: BlockEdit[];
  /**
   * Guest hotbar intent at the moment of the edit. The host still resolves the
   * actual item from its authoritative inventory; this only prevents the
   * unordered pose lane from leaving tool validation one wheel notch old.
   */
  selectedSlot?: number;
  /** Item optimistically consumed by a guest for a player-initiated placement. */
  consumedItem?: number;
  /** Presentation hint; voxel edits remain the authoritative state. */
  effect?: {
    kind: "tree-fell";
    rootX: number;
    rootY: number;
    rootZ: number;
    directionX: number;
    directionZ: number;
  };
  status?: ActionStatus;
  reason?: string;
};

export type MobSnapshotEntry = {
  id: number;
  kind: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  state: string;
  /** Compact Living Bestiary combat state; protocol-v1 peers ignore it. */
  level?: number;
  currentTypes?: string[];
  typeRevision?: string;
  statuses?: Array<{ id: string; stacks: number; remainingSeconds: number }>;
  activeMove?: { moveId: string; phase: "windup" | "active" | "recovery"; remainingSeconds: number } | null;
  /** Public host-authored capture-readiness progress; no hidden rolls or private inventory data. */
  pacification?: {
    participantId: string | null;
    route: "outmaneuver" | "offering" | null;
    cleanEvades: number;
    holdSeconds: number;
    offeringItem: number | null;
    offeringSeconds: number;
    retrySeconds: number;
    settledSeconds: number;
    settledRoute: "outmaneuver" | "offering" | null;
  } | null;
  /** Stable specimen and compact host-authored appearance keep rare forms identical for every peer. */
  specimenId?: string;
  primeAnchorId?: string | null;
  appearanceRevision?: string;
  appearance?: {
    progressionSeed: number;
    shiny: boolean;
    rarityForm: "ordinary" | "prime" | "regional" | "seasonal" | "story" | "legendary" | "summoned";
    phenotype: { sizeScale: number; hueShift: number; markingMask: number; markingIntensity: number; accentVariant: number };
  };
  /** Optional appearance/bond hints; old clients safely ignore them. */
  scale?: number;
  tamed?: boolean;
  saddled?: boolean;
  bondTier?: "wary" | "familiar" | "trusted" | "partnered" | "kindred";
  baby?: boolean;
  cargoChests?: number;
  lifeStage?: "tiny" | "juvenile" | "adult";
  aquaticOnly?: boolean;
  airProgress?: number;
  /** Complete authoritative lifecycle state for protocol-v1 dragon peers. */
  dragonState?: DragonState;
  /** Optional culture provenance keeps aligned settlement creatures authoritative for guests. */
  factionId?: "player" | "hobbits" | "goblins" | "atlantians" | "sugarcourt" | "wood-elves" | "dwarves" | null;
  aligned?: boolean;
  /** Bond metadata required for remote keepers to see and address their companions. */
  ownerId?: string | null;
  command?: string | null;
  followDistance?: number | "dynamic";
  stance?: "passive" | "defensive" | "offensive";
  name?: string;
  attunedOrbId?: string | null;
  /** Host-owned lead attachment. Unfenced leads follow this keeper, not the host process. */
  lead?: {
    ownerId: string | null;
    maximumLength: number;
    fence?: { x: number; y: number; z: number };
  } | null;
};

export type SnapshotScope = {
  centerPlayerId: string;
  radius: number;
  epoch: number;
};

export type MobSnapshot = { tick: number; scope: SnapshotScope; mobs: MobSnapshotEntry[] };

export type DropSnapshotEntry = {
  id: number;
  item: number;
  count: number;
  x: number;
  y: number;
  z: number;
  /** Host velocity for smooth guest prediction. Omitted by older protocol-v2 clients. */
  vx?: number;
  vy?: number;
  vz?: number;
  age: number;
  /** Remaining host pickup lock. Omitted by older protocol-v2 clients. */
  pickupDelay?: number | null;
  durability?: number;
  /** Bounded JSON state for placed eggs and other exact-state world drops. */
  metadata?: Record<string, unknown>;
};

export type DropSnapshot = { tick: number; scope: SnapshotScope; drops: DropSnapshotEntry[] };

export type DestructionTombstone = {
  id: string;
  tick: number;
  kind: "block" | "mob" | "drop";
  cause: "broken" | "killed" | "collected" | "expired" | "replaced";
  entityId?: number;
  block?: { x: number; y: number; z: number };
};

export type TombstoneBatch = { tick: number; tombstones: DestructionTombstone[] };
export type SailboatSnapshotEntry = {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  velocity: number;
  passengers: string[];
  ownerId?: string | null;
};
export type NetworkWeatherState = {
  kind: "clear" | "overcast" | "drizzle" | "rain" | "thunder" | "snow" | "sandstorm" | "mist" | "ashfall";
  cycle: number;
  elapsedSeconds: number;
  durationSeconds: number;
  intensity: number;
  windAngle: number;
  windSpeed: number;
};
export type TimeWeatherSnapshot = {
  tick: number;
  worldTime: number;
  day: number;
  /** Legacy precipitation mirror retained for v1.1 peers. */
  weather: "clear" | "rain";
  weatherState?: NetworkWeatherState;
  boats?: SailboatSnapshotEntry[];
};
export type SleepTarget = "morning" | "night";
export type SleepVote = { actorId: string; tick: number; target: SleepTarget; active: boolean };

export type SessionWorldOptions = {
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  dayLengthMinutes: number;
  mobDensity: number;
  butterflyDensity: number;
  caveFrequency: number;
  biomeScale: number;
  resourceAbundance: number;
  structures: boolean;
  weather: boolean;
  keepInventory: boolean;
  friendlyFire: boolean;
  sleepRule?: "any-player" | "percentage" | "all-players";
  sleepPercentage?: number;
  enabledFactions?: readonly ("hobbits" | "goblins" | "atlantians" | "sugarcourt" | "wood-elves" | "dwarves")[];
  settlementPattern?: "legacy-scattered-v1" | "heartlands-v2";
  settlementDensity?: number;
  settlementClustering?: "even" | "regional" | "strong";
  roadCoverage?: "none" | "local" | "regional" | "dense";
  largeTownFrequency?: "rare" | "balanced" | "frequent";
  origin?: { mode: "wilderness" } | { mode: "near-any-settlement" } | { mode: "culture-settlement"; factionId: "hobbits" | "goblins" | "atlantians" | "sugarcourt" | "wood-elves" | "dwarves"; minimumSize: "hamlet" | "village" | "town" };
};

export type InventoryEndpoint = {
  scope: "inventory" | "hotbar" | "equipment" | "craft" | "cursor" | "container";
  slot: number;
  containerId?: string;
};

export type InventoryAction = {
  requestId: string;
  actorId: string;
  kind: "move" | "split" | "swap" | "collect" | "equip" | "drop" | "craft";
  from?: InventoryEndpoint;
  to?: InventoryEndpoint;
  count?: number;
  expectedRevision?: number;
  /** World-drop collection is resolved by the host rather than the guest. */
  dropId?: number;
  /**
   * Guest-observed pickup point. The host never trusts this as authority: it
   * only uses it for bounded lag compensation against the latest accepted
   * player pose.
   */
  pickupAt?: { x: number; y: number; z: number };
  /** Host-authored pack image committed atomically with a pickup. */
  playerState?: PlayerSessionSnapshot;
  /** Host-authored stack remainder after the accepted pickup. */
  remainingCount?: number;
  status?: ActionStatus;
  reason?: string;
};

export type ContainerSlotTarget = {
  owner: "player" | "container" | "equipment" | "offhand" | "trash";
  slot: number;
};

export type ContainerOperation =
  | { op: "click"; target: ContainerSlotTarget; button: "left" | "right"; shift?: boolean }
  | { op: "distribute"; targets: number[]; button: "left" | "right" }
  | { op: "collect-matching"; item?: number }
  | { op: "sort"; target: "player" | "container" }
  | { op: "stack" | "transfer-all"; direction: "player-to-container" | "container-to-player" };

export type ContainerAction = {
  requestId: string;
  actorId: string;
  containerId: string;
  kind: "open" | "close" | "mutate";
  expectedRevision?: number;
  /** Host-owned player revision on which this atomic chest transaction is based. */
  expectedPlayerRevision?: number;
  /** Compact player intent. Guests never author full inventory images for mutations. */
  operation?: ContainerOperation;
  /** Host-authored recovery/commit image. It is forbidden on guest requests. */
  slots?: ItemStackSnapshot[];
  /** Host-authored matching player recovery/commit image. Never guest input. */
  playerState?: PlayerSessionSnapshot;
  /** Host-authored furnace clocks travel with its shared three-slot image. */
  machine?: { progress: number; burn: number; burnMax: number };
  status?: ActionStatus;
  reason?: string;
};

export type ItemStackSnapshot = { item: number; count: number; durability?: number; metadata?: Record<string, unknown> } | null;
export type InventorySnapshot = { revision: number; slots: ItemStackSnapshot[]; selected: number };
export type ContainerSnapshot = {
  id: string;
  kind: "chest" | "double-chest" | "furnace" | "wheat-mill" | "crafting";
  revision: number;
  slots: ItemStackSnapshot[];
  machine?: { progress: number; burn: number; burnMax: number };
};
export type SharedFacilityKind = "apiary" | "morph-loom" | "orb-rack" | "healing-station" | "waygrid-items" | "waygrid-creatures" | "aquarium" | "golem-forge" | "alchemy" | "distillery" | "sugarworks";
export type FacilityAction = {
  requestId: string;
  actorId: string;
  facilityId: string;
  facilityKind: SharedFacilityKind;
  kind: "open" | "close" | "update";
  expectedRevision?: number;
  expectedPlayerRevision?: number;
  state?: Record<string, unknown>;
  playerState?: PlayerSessionSnapshot;
  status?: ActionStatus;
  reason?: string;
};
export type PlayerSessionSnapshot = {
  playerId: string;
  revision: number;
  variant: "male" | "female";
  /** Optional character profile data; variant mirrors sex for older peers. */
  sex?: "male" | "female";
  profileId?: string;
  browserId?: string;
  race?: FactionRace;
  colors?: CharacterColors;
  inventory: ItemStackSnapshot[];
  /** Optional for protocol-v1 compatibility; current clients include the carried cursor stack. */
  cursor?: ItemStackSnapshot;
  /** Recoverable last-discarded stack; optional for older peers. */
  trash?: ItemStackSnapshot;
  equipment: Record<"head" | "chest" | "legs" | "feet", ItemStackSnapshot>;
  offhand?: ItemStackSnapshot;
  selected: number;
  health: number;
  hunger: number;
  xp: number;
  level: number;
  skills: SkillState;
};

export type PlayerBestiarySnapshot = Record<string, LivingBestiaryEntryV2>;

export type PlayerProgressionSnapshot = {
  questBook: QuestBook;
  sideQuestDefinitions: QuestDefinition[];
  mapKnowledge: MapKnowledge;
  bestiary: PlayerBestiarySnapshot;
  plantBestiary: PlantBestiaryState;
  blueprints: BlueprintState;
  magicState: MagicState;
  potionBuffs: Record<string, number>;
  rangedLoaded: Record<string, number>;
  bankAccount: BankAccountState;
  stockMarket: StockMarketState;
  respawn?: { x: number; y: number; z: number };
};

export type PlayerProgressAction = {
  transferId: string;
  actorId: string;
  revision: number;
  chunkIndex?: number;
  chunkCount?: number;
  data?: string;
  status?: ActionStatus;
  reason?: string;
};

export type PlayerStateAction = {
  requestId: string;
  actorId: string;
  /** Host revision the guest based its mutation on; prevents stale health/inventory resurrection. */
  expectedRevision?: number;
  state: PlayerSessionSnapshot;
  status?: ActionStatus;
  reason?: string;
};

/** Reliable lifecycle actions; continuous helm input stays on PlayerPose. */
export type BoatAction = {
  requestId: string;
  actorId: string;
  tick: number;
  kind: "launch" | "board" | "leave" | "pack";
  boatId?: string;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  boat?: SailboatSnapshotEntry;
  playerState?: PlayerSessionSnapshot;
  status?: ActionStatus;
  reason?: string;
};

export type CombatAction = {
  requestId: string;
  actorId: string;
  tick: number;
  targetKind: "mob" | "player";
  targetId: string;
  attack: "melee" | "ranged";
  status?: ActionStatus;
  reason?: string;
  resultingHealth?: number;
  killed?: boolean;
};
export type CreatureAction = {
  requestId: string;
  actorId: string;
  tick: number;
  kind: "capture" | "release" | "recall" | "command" | "pacify-offering" | "camp-care" | "camp-connect" | "camp-form-bond" | "camp-transfer-offer" | "camp-transfer-accept" | "interact" | "sentient-open" | "sentient-close" | "trade" | "lead-hitch" | "lead-unhitch" | "aquarium-sync" | "aquarium-insert" | "aquarium-remove" | "dragon-command" | "dragon-shoulder" | "dragon-harvest";
  targetId?: number;
  command?: string;
  orbId?: string;
  offerId?: string;
  recipientId?: string;
  sourceName?: string;
  creatureName?: string;
  name?: string;
  distance?: number | "dynamic";
  /** Interaction modifier is authored by the guest but revalidated by the host. */
  crouching?: boolean;
  /** Host result for mount/dismount interactions; guests never author this field. */
  mounted?: boolean;
  /** Host-assigned zero-based seat when `mounted` is true. */
  mountSeat?: number;
  panel?: "pet" | "follower" | "dragon" | "sentient";
  merchantId?: string;
  tradeDirection?: "player-buys" | "player-sells";
  itemKey?: string;
  tradeCount?: number;
  /** Host-authored economy images; guests only send the trade intent above. */
  merchantState?: MerchantState;
  walletState?: GoldWalletState;
  playerState?: PlayerSessionSnapshot;
  containerKey?: string;
  residentId?: string;
  /** Host-authored bounded tank state returned after an aquarium action. */
  aquariumState?: Record<string, unknown>;
  x?: number;
  y?: number;
  z?: number;
  status?: ActionStatus;
  reason?: string;
  /** Optional short host-authored feedback for an accepted creature interaction. */
  message?: string;
};
export type CartographyMapShare = {
  tableKey: string;
  reply: boolean;
  map: {
    schema: number;
    worldId: string;
    playerId: string;
    revision: number;
    exploredChunks: string[];
    markers: Array<Record<string, unknown>>;
    activeBedId: string | null;
    fastTravelCharges: number;
  };
};

export type WorldSnapshot = {
  tick: number;
  seed: string;
  /** Optional for protocol-v1 peers; current hosts always publish it. */
  mode?: "builder" | "survival";
  generatorVersion: number;
  generatorProfile?: "legacy-v14" | "world-below-v15";
  players: PlayerPose[];
  blockEdits: BlockEdit[];
  mobs: MobSnapshotEntry[];
  mobScope: SnapshotScope;
  drops: DropSnapshotEntry[];
  dropScope: SnapshotScope;
  tombstones?: DestructionTombstone[];
  boats?: SailboatSnapshotEntry[];
  time: TimeWeatherSnapshot;
  worldOptions?: SessionWorldOptions;
  inventory?: InventorySnapshot;
  containers?: ContainerSnapshot[];
  /** Targeted host-owned state for the peer receiving this snapshot. */
  playerState?: PlayerSessionSnapshot;
  /** Shared host-authored guild ledger; guests may inspect but never mutate it directly. */
  guildBook?: unknown;
};

/** Platform framing only. The packet remains opaque until Rust validates it. */
export type RustAuthorityDeltaChunk = Readonly<{
  schema: typeof RUST_AUTHORITY_DELTA_SCHEMA;
  transferId: string;
  keyframe: boolean;
  packetBytes: number;
  packetHash: string;
  chunkIndex: number;
  chunkCount: number;
  data: string;
  interest: NetworkInterestSetV1;
}>;

export type MultiplayerPayloadMap = {
  hello: { identity: PeerIdentity; role: MultiplayerRole };
  heartbeat: { nonce: string; reply: boolean };
  goodbye: { reason: string };
  snapshot: WorldSnapshot;
  "player-pose": PlayerPose;
  "block-action": BlockAction;
  "mob-snapshot": MobSnapshot;
  "drop-snapshot": DropSnapshot;
  tombstones: TombstoneBatch;
  "time-weather": TimeWeatherSnapshot;
  "sleep-vote": SleepVote;
  "inventory-action": InventoryAction;
  "container-action": ContainerAction;
  "facility-action": FacilityAction;
  "player-state": PlayerStateAction;
  "player-progress": PlayerProgressAction;
  "boat-action": BoatAction;
  "combat-action": CombatAction;
  "creature-action": CreatureAction;
  "tcg-action": TcgNetworkAction;
  "map-share": CartographyMapShare;
  "agent-command": AgentCommandEnvelope;
  "agent-result": AgentCommandResult;
  "agent-observation": AgentObservationV1;
  "agent-capabilities": AgentCapabilityGrant;
  chat: AgentChatMessage;
  "voice-chunk": AgentVoiceChunk;
  "rust-authority-delta": RustAuthorityDeltaChunk;
};

export type MultiplayerMessageType = keyof MultiplayerPayloadMap;

export type MultiplayerEnvelope<K extends MultiplayerMessageType = MultiplayerMessageType> = {
  version: typeof MULTIPLAYER_PROTOCOL_VERSION;
  sessionId: string;
  type: K;
  sequence: number;
  sentAt: number;
  from: string;
  payload: MultiplayerPayloadMap[K];
  /** Required outside explicit legacy compatibility; authored by the Rust runtime. */
  authority?: NetworkAuthorityIdentityV1;
  /** Dense Rust command stream; independent of transport/control sequencing. */
  authoritySequence?: number;
};

export type PeerInfo = {
  token: string;
  identity: PeerIdentity | null;
  state: MultiplayerPeerState;
  connectedAt: number | null;
  lastSeenAt: number;
  latencyMs: number | null;
  reliableOpen: boolean;
  movementOpen: boolean;
  voiceOpen: boolean;
};

export type MultiplayerEvent =
  | { type: "state"; previous: MultiplayerSessionState; state: MultiplayerSessionState }
  | { type: "peer"; peer: PeerInfo; reason?: string }
  | { type: "message"; peer: PeerInfo; channel: MultiplayerChannelKind; envelope: MultiplayerEnvelope }
  | { type: "authority-rejection"; peer: PeerInfo; commandId: string; code: string }
  | { type: "authority-delta"; peer: PeerInfo; keyframe: boolean; sequence: number; stateHash: string; packet: Uint8Array }
  | { type: "authority-resync"; peer: PeerInfo; code: string }
  | { type: "error"; error: Error; peer?: PeerInfo };

export type MultiplayerListener = (event: MultiplayerEvent) => void;

export type MultiplayerSupport = {
  supported: boolean;
  secureContext: boolean;
  webRTC: boolean;
  dataChannels: boolean;
  textCodec: boolean;
  cryptographicRandom: boolean;
  reasons: string[];
};

export interface DataChannelLike {
  readonly label: string;
  readonly ordered: boolean;
  readonly maxRetransmits: number | null;
  readonly readyState: RTCDataChannelState;
  readonly bufferedAmount: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface PeerConnectionLike {
  readonly localDescription: RTCSessionDescriptionInit | null;
  readonly remoteDescription: RTCSessionDescriptionInit | null;
  readonly iceGatheringState: RTCIceGatheringState;
  readonly connectionState: RTCPeerConnectionState;
  onicegatheringstatechange: ((event: Event) => void) | null;
  onconnectionstatechange: ((event: Event) => void) | null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null;
  createDataChannel(label: string, options?: RTCDataChannelInit): DataChannelLike;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  close(): void;
}

export type PeerConnectionFactory = (configuration: RTCConfiguration) => PeerConnectionLike;

export type MultiplayerOptions = {
  identity: PeerIdentity;
  /** Binds WebRTC signaling to an already-selected Rust runtime session. */
  sessionId?: string;
  rtcConfiguration?: RTCConfiguration;
  peerConnectionFactory?: PeerConnectionFactory;
  now?: () => number;
  randomId?: (prefix: string) => string;
  heartbeatIntervalMs?: number;
  peerTimeoutMs?: number;
  connectionTimeoutMs?: number;
  iceGatheringTimeoutMs?: number;
  autoMaintenance?: boolean;
  /** Developer-only outbound transport delay used for real browser QA. */
  artificialLatencyMs?: { min: number; max: number };
  /** Rust is mandatory unless a caller names the non-promotable compatibility mode. */
  authorityMode?: RustMultiplayerAuthorityModeV1;
  rustAuthority?: RustMultiplayerAuthorityV1;
  authorityInterest?: RustMultiplayerAuthorityInterestV1;
  /** Required beside a ready authority so offers attest the exact active runtime. */
  rustRuntimeDescriptor?: RustMultiplayerRuntimeDescriptorV2;
  /** Guest-only path: starts and attests the offered runtime before negotiation. */
  guestAuthorityFactory?: RustMultiplayerGuestAuthorityFactoryV2;
  authorityTimeoutMs?: number;
  authorityGrantLifetimeMs?: number;
  onEvent?: MultiplayerListener;
};

type AuthoritySignalV1 = Readonly<{ schema: 1; packet: string }>;

type OfferSignal = {
  version: typeof MULTIPLAYER_PROTOCOL_VERSION;
  protocol: typeof MULTIPLAYER_PROTOCOL_NAME;
  kind: "offer";
  sessionId: string;
  token: string;
  identity: PeerIdentity;
  description: RTCSessionDescriptionInit;
  authority?: AuthoritySignalV1;
  runtime?: RustMultiplayerRuntimeDescriptorV2;
};

type AnswerSignal = {
  version: typeof MULTIPLAYER_PROTOCOL_VERSION;
  protocol: typeof MULTIPLAYER_PROTOCOL_NAME;
  kind: "answer";
  sessionId: string;
  token: string;
  identity: PeerIdentity;
  description: RTCSessionDescriptionInit;
  authority?: AuthoritySignalV1;
  runtime?: RustMultiplayerRuntimeDescriptorV2;
};

export type ManualSignal = OfferSignal | AnswerSignal;

type PeerRecord = {
  token: string;
  identity: PeerIdentity | null;
  connection: PeerConnectionLike;
  reliable: DataChannelLike | null;
  movement: DataChannelLike | null;
  voice: DataChannelLike | null;
  state: MultiplayerPeerState;
  createdAt: number;
  connectedAt: number | null;
  lastSeenAt: number;
  latencyMs: number | null;
  lastReliableSequence: number;
  lastMovementSequence: number;
  lastVoiceSequence: number;
  protocolStrikes: number;
  pendingHeartbeatNonce: string | null;
  pendingHeartbeatAt: number;
  authorityCapabilities: readonly NetworkCapabilityV1[];
  authorityGeneration: number;
  authorityGrant: RustMultiplayerAuthorityPeerV1 | null;
  lastAgentGrant: AgentCapabilityGrant | null;
  authorityQueue: Promise<void>;
  acceptedAuthorityCommands: Set<string>;
  deliveredAuthorityReceipts: Set<string>;
  closed: boolean;
};

type RustDeltaReassembly = {
  transferId: string;
  keyframe: boolean;
  packetBytes: number;
  packetHash: string;
  chunkCount: number;
  interest: NetworkInterestSetV1;
  chunks: Array<Uint8Array | null>;
  receivedBytes: number;
  expiresAt: number;
};

const MESSAGE_TYPES = new Set<MultiplayerMessageType>([
  "hello", "heartbeat", "goodbye", "snapshot", "player-pose", "block-action", "mob-snapshot", "drop-snapshot", "tombstones", "time-weather", "sleep-vote", "inventory-action", "container-action", "facility-action", "player-state", "player-progress", "boat-action", "combat-action", "creature-action", "tcg-action", "map-share", "agent-command", "agent-result", "agent-observation", "agent-capabilities", "chat", "voice-chunk", "rust-authority-delta",
]);
const CONTROL_TYPES = new Set<MultiplayerMessageType>(["hello", "heartbeat", "goodbye"]);
const GUEST_OUTBOUND_TYPES = new Set<MultiplayerMessageType>(["hello", "heartbeat", "goodbye", "player-pose", "block-action", "sleep-vote", "inventory-action", "container-action", "facility-action", "player-state", "player-progress", "boat-action", "combat-action", "creature-action", "tcg-action", "map-share", "agent-command", "chat", "voice-chunk"]);
const RUST_GUEST_PRESENTATION_TYPES = new Set<MultiplayerMessageType>(["agent-result", "agent-observation", "agent-capabilities", "chat", "voice-chunk", "rust-authority-delta"]);
const IMMEDIATE_AUTHORITY_RELEASE_TYPES = new Set<MultiplayerMessageType>(["player-pose", "sleep-vote", "map-share", "chat", "voice-chunk"]);

export class MultiplayerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultiplayerProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFiniteNumber(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isInteger(value: unknown, min: number, max: number) {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isShortString(value: unknown, max: number, allowEmpty = false) {
  return typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isId(value: unknown) {
  // Character identities combine a browser id and profile id with a dot. The
  // longer bound remains small enough for every reliable payload budget.
  return typeof value === "string" && /^[A-Za-z0-9_.-]{8,160}$/u.test(value);
}

const CHARACTER_RACES = new Set(["wayfarer", "hearthkin", "goblin", "atlantian", "confectkin", "wood-elf", "dwarf"]);
const CHARACTER_COLOR_KEYS = ["skin", "hair", "shirt", "trousers", "accent"] as const;
const CHARACTER_SKILL_IDS = ["melee", "ranged", "mining", "crafting", "survival", "husbandry", "exploration", "magic", "bartering", "luck"] as const;

function validateCharacterColors(value: unknown): value is CharacterColors {
  return isRecord(value)
    && Object.keys(value).every((key) => CHARACTER_COLOR_KEYS.includes(key as typeof CHARACTER_COLOR_KEYS[number]))
    && CHARACTER_COLOR_KEYS.every((key) => typeof value[key] === "string" && /^#[0-9a-fA-F]{6}$/u.test(value[key] as string));
}

function validateCharacterSkillAllocation(value: unknown): value is CharacterSkillAllocation {
  return isRecord(value)
    && Object.keys(value).every((key) => CHARACTER_SKILL_IDS.includes(key as typeof CHARACTER_SKILL_IDS[number]))
    && CHARACTER_SKILL_IDS.every((key) => isInteger(value[key], 0, 20))
    && CHARACTER_SKILL_IDS.reduce((total, key) => total + (value[key] as number), 0) <= 20;
}

export function validatePeerIdentity(value: unknown): value is PeerIdentity {
  const requestedCapabilities = value && isRecord(value) ? value.requestedCapabilities : undefined;
  return isRecord(value)
    && isId(value.id)
    && typeof value.name === "string"
    && value.name === value.name.trim()
    && value.name.length >= 1
    && value.name.length <= 24
    && !/[\u0000-\u001f\u007f]/u.test(value.name)
    && typeof value.color === "string"
    && /^#[0-9a-fA-F]{6}$/u.test(value.color)
    && (value.variant === undefined || value.variant === "male" || value.variant === "female")
    && (value.sex === undefined || value.sex === "male" || value.sex === "female")
    && (value.variant === undefined || value.sex === undefined || value.variant === value.sex)
    && (value.profileId === undefined || isId(value.profileId))
    && (value.browserId === undefined || isId(value.browserId))
    && (value.race === undefined || CHARACTER_RACES.has(value.race as string))
    && (value.colors === undefined || validateCharacterColors(value.colors))
    && (value.startingSkills === undefined || validateCharacterSkillAllocation(value.startingSkills))
    && (value.peerKind === undefined || value.peerKind === "human" || value.peerKind === "agent")
    && (value.runnerVersion === undefined || isShortString(value.runnerVersion, 64))
    && (requestedCapabilities === undefined || (Array.isArray(requestedCapabilities)
      && requestedCapabilities.length <= AGENT_CAPABILITIES.length
      && new Set(requestedCapabilities).size === requestedCapabilities.length
      && requestedCapabilities.every((capability) => AGENT_CAPABILITIES.includes(capability as AgentCapability))))
    && (value.peerKind === "agent" || (value.runnerVersion === undefined && value.requestedCapabilities === undefined));
}

function validateDescription(value: unknown, type: "offer" | "answer"): value is RTCSessionDescriptionInit {
  // `RTCPeerConnection.localDescription` is a browser-native
  // RTCSessionDescription instance, not a plain JSON record. The wire decoder
  // still supplies plain objects, but rejecting the native prototype here made
  // every real invite fail after ICE gathering with "Missing local offer
  // description" even though the SDP was present and valid.
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const description = value as { type?: unknown; sdp?: unknown };
  return description.type === type
    && typeof description.sdp === "string"
    && description.sdp.length > 0
    && description.sdp.length <= MAX_SDP_CHARS;
}

function validateBlockEdit(value: unknown): value is BlockEdit {
  return isRecord(value)
    && isInteger(value.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isInteger(value.y, -4096, 4096)
    && isInteger(value.z, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isInteger(value.type, 0, 65_535)
    && (value.facing === undefined || isInteger(value.facing, 0, 3));
}

function validatePose(value: unknown): value is PlayerPose {
  const validEquipment = value && isRecord(value) && value.equipment !== undefined
    ? isRecord(value.equipment)
      && Object.keys(value.equipment).every((slot) => ["head", "chest", "legs", "feet"].includes(slot))
      && Object.values(value.equipment).every((item) => isInteger(item, 0, 65_535))
    : true;
  return isRecord(value)
    && isId(value.playerId)
    && isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
    && isFiniteNumber(value.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isFiniteNumber(value.y, -4096, 4096)
    && isFiniteNumber(value.z, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isFiniteNumber(value.yaw, -100_000, 100_000)
    && isFiniteNumber(value.pitch, -Math.PI, Math.PI)
    && isFiniteNumber(value.vx, -256, 256)
    && isFiniteNumber(value.vy, -256, 256)
    && isFiniteNumber(value.vz, -256, 256)
    && typeof value.grounded === "boolean"
    && (value.selected === undefined || isInteger(value.selected, 0, 8))
    && (value.heldItem === undefined || isInteger(value.heldItem, 0, 65_535))
    && (value.heldItemFilled === undefined || typeof value.heldItemFilled === "boolean")
    && (value.offhandItem === undefined || isInteger(value.offhandItem, 0, 65_535))
    && (value.shieldRaised === undefined || typeof value.shieldRaised === "boolean")
    && (value.crouching === undefined || typeof value.crouching === "boolean")
    && (value.sprinting === undefined || typeof value.sprinting === "boolean")
    && (value.action === undefined || value.action === "none" || value.action === "mine" || value.action === "use")
    && (value.variant === undefined || value.variant === "male" || value.variant === "female")
    && (value.sex === undefined || value.sex === "male" || value.sex === "female")
    && (value.variant === undefined || value.sex === undefined || value.variant === value.sex)
    && (value.profileId === undefined || isId(value.profileId))
    && (value.browserId === undefined || isId(value.browserId))
    && (value.race === undefined || CHARACTER_RACES.has(value.race as string))
    && (value.colors === undefined || validateCharacterColors(value.colors))
    && (value.swimming === undefined || isFiniteNumber(value.swimming, 0, 1))
    && (value.seated === undefined || isFiniteNumber(value.seated, 0, 1))
    && (value.boatId === undefined || isId(value.boatId))
    && (value.boatSeat === undefined || isInteger(value.boatSeat, 0, 1))
    && (value.boatForward === undefined || isFiniteNumber(value.boatForward, -1, 1))
    && (value.boatTurn === undefined || isFiniteNumber(value.boatTurn, -1, 1))
    && (value.mountedCreatureId === undefined || isInteger(value.mountedCreatureId, 0, Number.MAX_SAFE_INTEGER))
    && (value.mountedCreatureSeat === undefined || isInteger(value.mountedCreatureSeat, 0, 3))
    && validEquipment;
}

export class MultiplayerOperationCancelledError extends Error {
  constructor(message = "Multiplayer setup was cancelled because the session changed") {
    super(message);
    this.name = "MultiplayerOperationCancelledError";
  }
}

export function isMultiplayerOperationCancellation(error: unknown) {
  if (error instanceof MultiplayerOperationCancelledError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /user[- ]initiated.*(?:abort|close)|(?:abort|close).*called|session (?:changed|closed)|setup was cancelled/iu.test(message);
}

function validateSailboat(value: unknown): value is SailboatSnapshotEntry {
  return isRecord(value)
    && isId(value.id)
    && isFiniteNumber(value.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isFiniteNumber(value.y, -4096, 4096)
    && isFiniteNumber(value.z, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isFiniteNumber(value.yaw, -100_000, 100_000)
    && isFiniteNumber(value.velocity, -32, 32)
    && Array.isArray(value.passengers)
    && value.passengers.length <= 2
    && value.passengers.every(isId)
    && (value.ownerId === undefined || value.ownerId === null || isId(value.ownerId));
}

function validateDragonState(value: unknown): value is DragonState {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) return false;
  if (value.type !== "fire" && value.type !== "ice" && value.type !== "steel" && value.type !== "sea" && value.type !== "gold" && value.type !== "silver") return false;
  const validVariants: Readonly<Record<string, readonly string[]>> = {
    fire: ["furnacecrest", "cindercoil", "crownflare", "emberkite"],
    ice: ["glacierhorn", "rimeplume", "hoarfang", "prismcoil"],
    steel: ["rivetback", "gearwing", "anvilback", "razorfan"],
    sea: ["tidemane", "mantaroyal", "ribboncoil", "reefcrown"],
    gold: ["sunmane", "auric-roc", "treasury-coil", "idolback"],
    silver: ["moonhart", "argent-moth", "mirrorcoil", "crescent-wyvern"],
  };
  if (value.schemaVersion === 2 && !validVariants[value.type].includes(String(value.variant))) return false;
  if (value.sex !== "female" && value.sex !== "male") return false;
  if (value.command !== "follow" && value.command !== "stay" && value.command !== "guard-lair" && value.command !== "wander") return false;
  const equipment = value.equipment;
  if (!isRecord(equipment)
    || typeof equipment.saddle !== "boolean"
    || !Array.isArray(equipment.chests)
    || equipment.chests.length !== 2
    || !equipment.chests.every((attached) => typeof attached === "boolean")
    || !isRecord(equipment.armor)) return false;
  const armor = equipment.armor;
  const armorSlots = ["head", "neck", "body", "tail"] as const;
  if (!armorSlots.every((slot) => armor[slot] === null || isShortString(armor[slot], 96))) return false;
  const validHome = value.home === null || (isRecord(value.home)
    && isShortString(value.home.lairId, 96)
    && isShortString(value.home.dimension, 96)
    && isRecord(value.home.position)
    && isFiniteNumber(value.home.position.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isFiniteNumber(value.home.position.y, -4096, 4096)
    && isFiniteNumber(value.home.position.z, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isFiniteNumber(value.home.guardRadius, 0, 512));
  return validHome
    && isShortString(value.dragonId, 96)
    && isInteger(value.geneticSeed, 0, 0xffff_ffff)
    && isInteger(value.ageTicks, 0, Number.MAX_SAFE_INTEGER)
    && isInteger(value.stage, 1, 5)
    && isFiniteNumber(value.growthScale, 0.01, 8)
    && isFiniteNumber(value.health, 0, 100_000)
    && isFiniteNumber(value.maxHealth, 1, 100_000)
    && typeof value.alive === "boolean"
    && typeof value.tamed === "boolean"
    && (value.ownerId === null || isShortString(value.ownerId, 160))
    && isInteger(value.trust, 0, 3)
    && typeof value.onShoulder === "boolean"
    && isInteger(value.scaleReserve, 0, 1_000_000)
    && isInteger(value.scaleShedTicks, 0, Number.MAX_SAFE_INTEGER)
    && isInteger(value.breedCooldownTicks, 0, Number.MAX_SAFE_INTEGER)
    && (value.customName === null || isShortString(value.customName, 48))
    && value.persistent === true;
}

function validateMob(value: unknown): value is MobSnapshotEntry {
  return isRecord(value)
    && isInteger(value.id, 0, Number.MAX_SAFE_INTEGER)
    && isShortString(value.kind, 32)
    && isFiniteNumber(value.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isFiniteNumber(value.y, -4096, 4096)
    && isFiniteNumber(value.z, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isFiniteNumber(value.yaw, -100_000, 100_000)
    && isFiniteNumber(value.health, 0, 100_000)
    && isShortString(value.state, 32)
    && (value.level === undefined || isInteger(value.level, 1, 60))
    && (value.currentTypes === undefined || (Array.isArray(value.currentTypes) && value.currentTypes.length <= 32 && value.currentTypes.every((type) => isShortString(type, 24))))
    && (value.typeRevision === undefined || isShortString(value.typeRevision, 512))
    && (value.statuses === undefined || (Array.isArray(value.statuses) && value.statuses.length <= 12 && value.statuses.every((status) => isRecord(status)
      && isShortString(status.id, 32) && isInteger(status.stacks, 1, 3) && isFiniteNumber(status.remainingSeconds, 0, 120))))
    && (value.activeMove === undefined || value.activeMove === null || (isRecord(value.activeMove)
      && isShortString(value.activeMove.moveId, 64)
      && ["windup", "active", "recovery"].includes(value.activeMove.phase as string)
      && isFiniteNumber(value.activeMove.remainingSeconds, 0, 30)))
    && (value.pacification === undefined || value.pacification === null || (isRecord(value.pacification)
      && (value.pacification.participantId === null || isShortString(value.pacification.participantId, 160))
      && (value.pacification.route === null || value.pacification.route === "outmaneuver" || value.pacification.route === "offering")
      && isInteger(value.pacification.cleanEvades, 0, 2)
      && isFiniteNumber(value.pacification.holdSeconds, 0, 3)
      && (value.pacification.offeringItem === null || isInteger(value.pacification.offeringItem, 0, 100_000))
      && isFiniteNumber(value.pacification.offeringSeconds, 0, 4)
      && isFiniteNumber(value.pacification.retrySeconds, 0, 30)
      && isFiniteNumber(value.pacification.settledSeconds, 0, 10)
      && (value.pacification.settledRoute === null || value.pacification.settledRoute === "outmaneuver" || value.pacification.settledRoute === "offering")))
    && (value.specimenId === undefined || isShortString(value.specimenId, 160))
    && (value.primeAnchorId === undefined || value.primeAnchorId === null
      || (typeof value.primeAnchorId === "string" && isShortString(value.primeAnchorId, 160) && value.primeAnchorId.startsWith(`prime:${value.kind}:`)))
    && (value.appearanceRevision === undefined || isShortString(value.appearanceRevision, 256))
    && (value.appearance === undefined || (isRecord(value.appearance)
      && isInteger(value.appearance.progressionSeed, 0, 0xffff_ffff)
      && typeof value.appearance.shiny === "boolean"
      && ["ordinary", "prime", "regional", "seasonal", "story", "legendary", "summoned"].includes(value.appearance.rarityForm as string)
      && isRecord(value.appearance.phenotype)
      && isFiniteNumber(value.appearance.phenotype.sizeScale, .5, 2)
      && isFiniteNumber(value.appearance.phenotype.hueShift, -.5, .5)
      && isInteger(value.appearance.phenotype.markingMask, 0, 15)
      && isFiniteNumber(value.appearance.phenotype.markingIntensity, 0, 1)
      && isInteger(value.appearance.phenotype.accentVariant, 0, 15)))
    && (value.scale === undefined || isFiniteNumber(value.scale, 0.01, 8))
    && (value.tamed === undefined || typeof value.tamed === "boolean")
    && (value.saddled === undefined || typeof value.saddled === "boolean")
    && (value.bondTier === undefined || ["wary", "familiar", "trusted", "partnered", "kindred"].includes(value.bondTier as string))
    && (value.baby === undefined || typeof value.baby === "boolean")
    && (value.cargoChests === undefined || isInteger(value.cargoChests, 0, 6))
    && (value.lifeStage === undefined || value.lifeStage === "tiny" || value.lifeStage === "juvenile" || value.lifeStage === "adult")
    && (value.aquaticOnly === undefined || typeof value.aquaticOnly === "boolean")
    && (value.airProgress === undefined || isFiniteNumber(value.airProgress, 0, 1))
    && (value.dragonState === undefined || (validateDragonState(value.dragonState) && value.kind === `${value.dragonState.type}-dragon`))
    && (value.factionId === undefined || value.factionId === null
      || ["player", "hobbits", "goblins", "atlantians", "sugarcourt", "wood-elves", "dwarves"].includes(value.factionId as string))
    && (value.aligned === undefined || typeof value.aligned === "boolean")
    // Migrated single-player companions may still use the canonical "local"
    // owner marker when first entering a hosted session. Dragon state already
    // accepts the same bounded identifier, so the envelope must not reject it.
    && (value.ownerId === undefined || value.ownerId === null || isShortString(value.ownerId, 160))
    && (value.command === undefined || value.command === null || isShortString(value.command, 32))
    && (value.name === undefined || isShortString(value.name, 48))
    && (value.attunedOrbId === undefined || value.attunedOrbId === null || isShortString(value.attunedOrbId, 160))
    && (value.lead === undefined || value.lead === null || (isRecord(value.lead)
      && (value.lead.ownerId === null || isShortString(value.lead.ownerId, 160))
      && isFiniteNumber(value.lead.maximumLength, 2, 16)
      && (value.lead.fence === undefined || (isRecord(value.lead.fence)
        && isFiniteNumber(value.lead.fence.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
        && isFiniteNumber(value.lead.fence.y, -4096, 4096)
        && isFiniteNumber(value.lead.fence.z, -COORDINATE_LIMIT, COORDINATE_LIMIT)))));
}

function validateDropMetadata(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  try { return JSON.stringify(value).length <= 8_192; }
  catch { return false; }
}

function validateDrop(value: unknown): value is DropSnapshotEntry {
  return isRecord(value)
    && isInteger(value.id, 0, Number.MAX_SAFE_INTEGER)
    && isInteger(value.item, 0, 65_535)
    && isInteger(value.count, 1, 65_535)
    && isFiniteNumber(value.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && isFiniteNumber(value.y, -4096, 4096)
    && isFiniteNumber(value.z, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    && (value.vx === undefined || isFiniteNumber(value.vx, -128, 128))
    && (value.vy === undefined || isFiniteNumber(value.vy, -128, 128))
    && (value.vz === undefined || isFiniteNumber(value.vz, -128, 128))
    && isFiniteNumber(value.age, 0, 1_000_000)
    && (value.pickupDelay === undefined || value.pickupDelay === null || isFiniteNumber(value.pickupDelay, 0, 1_000_000))
    && (value.durability === undefined || isInteger(value.durability, 0, 1_000_000))
    && validateDropMetadata(value.metadata);
}

function validateTimeWeather(value: unknown): value is TimeWeatherSnapshot {
  return isRecord(value)
    && isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
    && isFiniteNumber(value.worldTime, 0, 1)
    && isInteger(value.day, 1, 1_000_000)
    && (value.weather === "clear" || value.weather === "rain")
    && (value.weatherState === undefined || (isRecord(value.weatherState)
      && ["clear", "overcast", "drizzle", "rain", "thunder", "snow", "sandstorm", "mist", "ashfall"].includes(value.weatherState.kind as string)
      && isInteger(value.weatherState.cycle, 0, Number.MAX_SAFE_INTEGER)
      && isFiniteNumber(value.weatherState.elapsedSeconds, 0, 86_400)
      && isFiniteNumber(value.weatherState.durationSeconds, 1, 86_400)
      && isFiniteNumber(value.weatherState.intensity, 0, 1)
      && isFiniteNumber(value.weatherState.windAngle, -100_000, 100_000)
      && isFiniteNumber(value.weatherState.windSpeed, 0, 100)))
    && (value.boats === undefined || (Array.isArray(value.boats) && value.boats.length <= 128 && value.boats.every(validateSailboat)));
}

function validateEndpoint(value: unknown): value is InventoryEndpoint {
  return isRecord(value)
    && ["inventory", "hotbar", "equipment", "craft", "cursor", "container"].includes(value.scope as string)
    && isInteger(value.slot, 0, 1023)
    && (value.containerId === undefined || isShortString(value.containerId, 96));
}

function validateSnapshotScope(value: unknown): value is SnapshotScope {
  return isRecord(value)
    && isId(value.centerPlayerId)
    && isFiniteNumber(value.radius, 1, 4_096)
    && isInteger(value.epoch, 0, Number.MAX_SAFE_INTEGER);
}

function validateContainerOperation(value: unknown): value is ContainerOperation {
  if (!isRecord(value) || typeof value.op !== "string") return false;
  if (value.op === "click") return isRecord(value.target)
    && ["player", "container", "equipment", "offhand", "trash"].includes(value.target.owner as string)
    && isInteger(value.target.slot, 0, 1023)
    && (value.button === "left" || value.button === "right")
    && (value.shift === undefined || typeof value.shift === "boolean");
  if (value.op === "distribute") return Array.isArray(value.targets)
    && value.targets.length >= 2
    && value.targets.length <= 36
    && new Set(value.targets).size === value.targets.length
    && value.targets.every((target) => isInteger(target, 0, 35))
    && (value.button === "left" || value.button === "right");
  if (value.op === "collect-matching") return value.item === undefined || isInteger(value.item, 0, 65_535);
  if (value.op === "sort") return value.target === "player" || value.target === "container";
  if (value.op === "stack" || value.op === "transfer-all") return value.direction === "player-to-container" || value.direction === "container-to-player";
  return false;
}

function validateTombstone(value: unknown): value is DestructionTombstone {
  if (!isRecord(value)
    || !isId(value.id)
    || !isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
    || !["block", "mob", "drop"].includes(value.kind as string)
    || !["broken", "killed", "collected", "expired", "replaced"].includes(value.cause as string)
    || (value.entityId !== undefined && !isInteger(value.entityId, 0, Number.MAX_SAFE_INTEGER))) return false;
  if (value.block !== undefined) {
    if (!isRecord(value.block)
      || !isInteger(value.block.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
      || !isInteger(value.block.y, -4096, 4096)
      || !isInteger(value.block.z, -COORDINATE_LIMIT, COORDINATE_LIMIT)) return false;
  }
  return value.kind === "block" ? value.block !== undefined : value.entityId !== undefined;
}

function validateStatusFields(value: Record<string, unknown>) {
  return (value.status === undefined || value.status === "request" || value.status === "accepted" || value.status === "rejected")
    && (value.reason === undefined || isShortString(value.reason, 160, true));
}

function validateBoundedMetadata(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  try { return JSON.stringify(value).length <= 8_192; }
  catch { return false; }
}

function validateMachineState(value: unknown) {
  return value === undefined || (isRecord(value)
    && isFiniteNumber(value.progress, 0, 86_400)
    && isFiniteNumber(value.burn, 0, 86_400)
    && isFiniteNumber(value.burnMax, 0, 86_400));
}

function validateWalletState(value: unknown) {
  return value === undefined || (isRecord(value)
    && value.schema === 1
    && isShortString(value.authorityId, 160)
    && isInteger(value.revision, 0, Number.MAX_SAFE_INTEGER)
    && Array.isArray(value.recentEventIds)
    && value.recentEventIds.length <= 64
    && value.recentEventIds.every((event) => isShortString(event, 192))
    && isShortString(value.ownerId, 160)
    && typeof value.balance === "string"
    && /^\d{1,80}$/u.test(value.balance));
}

function validateMerchantState(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value) || value.schema !== 1 || !isShortString(value.id, 160)) return false;
  try { return JSON.stringify(value).length <= 128 * 1024; }
  catch { return false; }
}

function validateFacilityState(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  try { return JSON.stringify(value).length <= 128 * 1024; }
  catch { return false; }
}

function validateGuildBookPayload(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value) || value.schema !== 1 || !isRecord(value.guilds) || !isRecord(value.worldQuestOutcomes)) return false;
  try { return JSON.stringify(value).length <= 256 * 1024; }
  catch { return false; }
}

function validateAquariumStatePayload(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value) || value.schema !== 1 || !Array.isArray(value.blockKeys) || !Array.isArray(value.residents)) return false;
  if (value.blockKeys.length < 1 || value.blockKeys.length > 20 || value.residents.length > 20) return false;
  if (!value.blockKeys.every((key) => typeof key === "string" && /^-?\d+,-?\d+,-?\d+$/u.test(key) && key.length <= 64)) return false;
  try { return JSON.stringify(value).length <= 131_072; }
  catch { return false; }
}

function validateItemStack(value: unknown): value is ItemStackSnapshot {
  return value === null || (isRecord(value)
    && isInteger(value.item, 0, 65_535)
    && isInteger(value.count, 1, 65_535)
    && (value.durability === undefined || isInteger(value.durability, 0, 1_000_000))
    && validateBoundedMetadata(value.metadata));
}

function validateInventorySnapshot(value: unknown): value is InventorySnapshot {
  return isRecord(value)
    && isInteger(value.revision, 0, Number.MAX_SAFE_INTEGER)
    && Array.isArray(value.slots)
    && value.slots.length <= 128
    && value.slots.every(validateItemStack)
    && isInteger(value.selected, 0, 127);
}

function validateContainerSnapshot(value: unknown): value is ContainerSnapshot {
  return isRecord(value)
    && isShortString(value.id, 96)
    && ["chest", "double-chest", "furnace", "wheat-mill", "crafting"].includes(value.kind as string)
    && isInteger(value.revision, 0, Number.MAX_SAFE_INTEGER)
    && Array.isArray(value.slots)
    && value.slots.length <= 128
    && value.slots.every(validateItemStack)
    && validateMachineState(value.machine);
}

function validateSkillState(value: unknown): value is SkillState {
  if (!isRecord(value) || (value.schema !== 1 && value.schema !== 2 && value.schema !== 3) || !isRecord(value.skills)) return false;
  const skills = value.skills;
  const skillIds = ["melee", "ranged", "mining", "crafting", "survival", "husbandry", "exploration", "magic", "bartering", "luck"];
  if (!skillIds.every((id) => {
    const progress = skills[id];
    return isRecord(progress)
      && isInteger(progress.level, 0, 1_000)
      && isFiniteNumber(progress.xp, 0, Number.MAX_SAFE_INTEGER);
  })) return false;
  return isInteger(value.characterLevel, 1, Number.MAX_SAFE_INTEGER)
    && isFiniteNumber(value.characterXp, 0, Number.MAX_SAFE_INTEGER)
    && isInteger(value.perkPoints, 0, Number.MAX_SAFE_INTEGER)
    && Array.isArray(value.unlockedPerkIds)
    && value.unlockedPerkIds.length <= 256
    && value.unlockedPerkIds.every((id) => isShortString(id, 96))
    && (value.ascendantTraits === undefined || (isRecord(value.ascendantTraits)
      && Object.values(value.ascendantTraits).every((enabled) => typeof enabled === "boolean")))
    && typeof value.ascendantHealthFloorEnabled === "boolean";
}

export function validatePlayerProgressionSnapshot(value: unknown): value is PlayerProgressionSnapshot {
  if (!isRecord(value)
    || !isRecord(value.questBook)
    || !Array.isArray(value.sideQuestDefinitions)
    || value.sideQuestDefinitions.length > 128
    || !isRecord(value.mapKnowledge)
    || !isRecord(value.bestiary)
    || !isRecord(value.plantBestiary)
    || !isRecord(value.blueprints)
    || !isRecord(value.magicState)
    || !isRecord(value.potionBuffs)
    || !isRecord(value.rangedLoaded)
    || !isRecord(value.bankAccount)
    || !isRecord(value.stockMarket)
    || (value.respawn !== undefined && (!isRecord(value.respawn)
      || !isFiniteNumber(value.respawn.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
      || !isFiniteNumber(value.respawn.y, -4096, 4096)
      || !isFiniteNumber(value.respawn.z, -COORDINATE_LIMIT, COORDINATE_LIMIT)))) return false;
  // Every nested subsystem is normalized again by the engine. Large maps are
  // allowed here because the wire format chunks them below the message limit.
  try { return JSON.stringify(value).length <= 64 * 1024 * 1024; }
  catch { return false; }
}

function validatePlayerSessionSnapshot(value: unknown): value is PlayerSessionSnapshot {
  if (!isRecord(value) || !isRecord(value.equipment)) return false;
  const equipment = value.equipment;
  const equipmentSlots = ["head", "chest", "legs", "feet"];
  return isId(value.playerId)
    && isInteger(value.revision, 0, Number.MAX_SAFE_INTEGER)
    && (value.variant === "male" || value.variant === "female")
    && (value.sex === undefined || value.sex === "male" || value.sex === "female")
    && (value.sex === undefined || value.sex === value.variant)
    && (value.profileId === undefined || isId(value.profileId))
    && (value.browserId === undefined || isId(value.browserId))
    && (value.race === undefined || CHARACTER_RACES.has(value.race as string))
    && (value.colors === undefined || validateCharacterColors(value.colors))
    && Array.isArray(value.inventory)
    && value.inventory.length === 36
    && value.inventory.every(validateItemStack)
    && (value.cursor === undefined || validateItemStack(value.cursor))
    && (value.trash === undefined || validateItemStack(value.trash))
    && (value.offhand === undefined || validateItemStack(value.offhand))
    && equipmentSlots.every((slot) => validateItemStack(equipment[slot]))
    && isInteger(value.selected, 0, 8)
    && isFiniteNumber(value.health, 0, 10)
    && isFiniteNumber(value.hunger, 0, 10)
    && isFiniteNumber(value.xp, 0, Number.MAX_SAFE_INTEGER)
    && isInteger(value.level, 0, Number.MAX_SAFE_INTEGER)
    && validateSkillState(value.skills);
}

function validateSessionWorldOptions(value: unknown): value is SessionWorldOptions {
  return isRecord(value)
    && ["peaceful", "easy", "normal", "hard"].includes(value.difficulty as string)
    && isFiniteNumber(value.dayLengthMinutes, 5, 120)
    && isFiniteNumber(value.mobDensity, 0, 3)
    && isFiniteNumber(value.butterflyDensity, 0, 4)
    && isFiniteNumber(value.caveFrequency, 0, 3)
    && isFiniteNumber(value.biomeScale, 0.25, 4)
    && isFiniteNumber(value.resourceAbundance, 0.25, 4)
    && typeof value.structures === "boolean"
    && typeof value.weather === "boolean"
    && typeof value.keepInventory === "boolean"
    && typeof value.friendlyFire === "boolean"
    && (value.sleepRule === undefined || ["any-player", "percentage", "all-players"].includes(value.sleepRule as string))
    && (value.sleepPercentage === undefined || isFiniteNumber(value.sleepPercentage, 1, 100))
    && (value.enabledFactions === undefined || (Array.isArray(value.enabledFactions)
      && value.enabledFactions.length <= 6
      && new Set(value.enabledFactions).size === value.enabledFactions.length
      && value.enabledFactions.every((entry) => ["hobbits", "goblins", "atlantians", "sugarcourt", "wood-elves", "dwarves"].includes(entry as string))))
    && (value.settlementPattern === undefined || value.settlementPattern === "legacy-scattered-v1" || value.settlementPattern === "heartlands-v2")
    && (value.settlementDensity === undefined || isFiniteNumber(value.settlementDensity, 0, 2))
    && (value.settlementClustering === undefined || ["even", "regional", "strong"].includes(value.settlementClustering as string))
    && (value.roadCoverage === undefined || ["none", "local", "regional", "dense"].includes(value.roadCoverage as string))
    && (value.largeTownFrequency === undefined || ["rare", "balanced", "frequent"].includes(value.largeTownFrequency as string))
    && (value.origin === undefined || (isRecord(value.origin) && ["wilderness", "near-any-settlement", "culture-settlement"].includes(value.origin.mode as string)));
}

function validateAuthorityIdentity(value: unknown): value is NetworkAuthorityIdentityV1 {
  if (!isRecord(value) || !isRecord(value.address) || !isRecord(value.revision) || typeof value.stateHash !== "string") return false;
  try {
    const canonical = createNetworkAuthorityIdentityV1({
      universeId: String(value.address.universeId ?? ""), locationId: String(value.address.locationId ?? ""),
    }, {
      epoch: Number(value.revision.epoch), world: Number(value.revision.world), entities: Number(value.revision.entities),
      gameplay: Number(value.revision.gameplay), persistence: Number(value.revision.persistence),
    });
    return canonical.stateHash === value.stateHash;
  } catch { return false; }
}

function validateNetworkInterest(value: unknown): value is NetworkInterestSetV1 {
  if (!isRecord(value) || !Array.isArray(value.chunks) || !Array.isArray(value.entityIds)) return false;
  try {
    const canonical = createNetworkInterestSetV1({
      sequence: Number(value.sequence),
      chunks: value.chunks as NetworkInterestSetV1["chunks"],
      entityIds: value.entityIds as readonly string[],
    });
    return canonical.interestHash === value.interestHash;
  } catch { return false; }
}

function validateRustAuthorityDeltaChunk(value: unknown): value is RustAuthorityDeltaChunk {
  return isRecord(value)
    && value.schema === RUST_AUTHORITY_DELTA_SCHEMA
    && isShortString(value.transferId, 180)
    && typeof value.keyframe === "boolean"
    && isInteger(value.packetBytes, 1, RUST_AUTHORITY_MAX_DELTA_BYTES)
    && typeof value.packetHash === "string" && /^[0-9a-f]{32}$/u.test(value.packetHash)
    && isInteger(value.chunkIndex, 0, RUST_AUTHORITY_MAX_DELTA_CHUNKS - 1)
    && isInteger(value.chunkCount, 1, RUST_AUTHORITY_MAX_DELTA_CHUNKS)
    && (value.chunkIndex as number) < (value.chunkCount as number)
    && typeof value.data === "string" && value.data.length > 0 && value.data.length <= Math.ceil(RUST_AUTHORITY_DELTA_CHUNK_BYTES * 4 / 3) + 8
    && /^[A-Za-z0-9_-]+$/u.test(value.data)
    && validateNetworkInterest(value.interest);
}

export function validatePayload<K extends MultiplayerMessageType>(type: K, value: unknown): value is MultiplayerPayloadMap[K] {
  if (!isRecord(value)) return false;
  switch (type) {
    case "hello":
      return validatePeerIdentity(value.identity) && (value.role === "host" || value.role === "guest");
    case "heartbeat":
      return isId(value.nonce) && typeof value.reply === "boolean";
    case "goodbye":
      return isShortString(value.reason, 160, true);
    case "agent-command":
      return validateAgentCommand(value);
    case "agent-result":
      return validateAgentResult(value);
    case "agent-observation":
      return validateAgentObservation(value);
    case "agent-capabilities":
      return validateAgentCapabilityGrant(value);
    case "chat":
      return validateAgentChatMessage(value);
    case "voice-chunk":
      return validateAgentVoiceChunk(value);
    case "rust-authority-delta":
      return validateRustAuthorityDeltaChunk(value);
    case "player-pose":
      return validatePose(value);
    case "block-action":
      return isId(value.requestId)
        && isId(value.actorId)
        && isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
        && (value.kind === "break" || value.kind === "place" || value.kind === "batch")
        && Array.isArray(value.edits)
        && value.edits.length >= 1
        && value.edits.length <= 2_048
        && value.edits.every(validateBlockEdit)
        && (value.selectedSlot === undefined || isInteger(value.selectedSlot, 0, 8))
        && (value.consumedItem === undefined || isInteger(value.consumedItem, 0, 65_535))
        && (value.effect === undefined || (isRecord(value.effect)
          && value.effect.kind === "tree-fell"
          && isInteger(value.effect.rootX, -COORDINATE_LIMIT, COORDINATE_LIMIT)
          && isInteger(value.effect.rootY, -4096, 4096)
          && isInteger(value.effect.rootZ, -COORDINATE_LIMIT, COORDINATE_LIMIT)
          && isFiniteNumber(value.effect.directionX, -1, 1)
          && isFiniteNumber(value.effect.directionZ, -1, 1)))
        && validateStatusFields(value);
    case "mob-snapshot":
      return isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
        && validateSnapshotScope(value.scope)
        && Array.isArray(value.mobs)
        && value.mobs.length <= 512
        && value.mobs.every(validateMob);
    case "drop-snapshot":
      return isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
        && validateSnapshotScope(value.scope)
        && Array.isArray(value.drops)
        && value.drops.length <= 1024
        && value.drops.every(validateDrop);
    case "tombstones":
      return isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
        && Array.isArray(value.tombstones)
        && value.tombstones.length <= 512
        && value.tombstones.every(validateTombstone);
    case "time-weather":
      return validateTimeWeather(value);
    case "sleep-vote":
      return isId(value.actorId)
        && isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
        && (value.target === "morning" || value.target === "night")
        && typeof value.active === "boolean";
    case "inventory-action":
      return isId(value.requestId)
        && isId(value.actorId)
        && ["move", "split", "swap", "collect", "equip", "drop", "craft"].includes(value.kind as string)
        && (value.from === undefined || validateEndpoint(value.from))
        && (value.to === undefined || validateEndpoint(value.to))
        && (value.count === undefined || isInteger(value.count, 1, 65_535))
        && (value.expectedRevision === undefined || isInteger(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER))
        && (value.expectedPlayerRevision === undefined || isInteger(value.expectedPlayerRevision, 0, Number.MAX_SAFE_INTEGER))
        && (value.dropId === undefined || isInteger(value.dropId, 0, Number.MAX_SAFE_INTEGER))
        && (value.pickupAt === undefined || (isRecord(value.pickupAt)
          && isFiniteNumber(value.pickupAt.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
          && isFiniteNumber(value.pickupAt.y, -4096, 4096)
          && isFiniteNumber(value.pickupAt.z, -COORDINATE_LIMIT, COORDINATE_LIMIT)))
        && (value.playerState === undefined || validatePlayerSessionSnapshot(value.playerState))
        && (value.remainingCount === undefined || isInteger(value.remainingCount, 0, 65_535))
        && ((value.status !== undefined && value.status !== "request") || (value.playerState === undefined && value.remainingCount === undefined))
        && validateStatusFields(value);
    case "container-action":
      return isId(value.requestId)
        && isId(value.actorId)
        && isShortString(value.containerId, 96)
        && (value.kind === "open" || value.kind === "close" || value.kind === "mutate")
        && (value.expectedRevision === undefined || isInteger(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER))
        && (value.expectedPlayerRevision === undefined || isInteger(value.expectedPlayerRevision, 0, Number.MAX_SAFE_INTEGER))
        && (value.kind === "mutate" ? validateContainerOperation(value.operation) : value.operation === undefined)
        && (value.slots === undefined || (Array.isArray(value.slots) && value.slots.length <= 128 && value.slots.every(validateItemStack)))
        && (value.playerState === undefined || validatePlayerSessionSnapshot(value.playerState))
        && validateMachineState(value.machine)
        && ((value.status !== undefined && value.status !== "request") || (value.slots === undefined && value.playerState === undefined && value.machine === undefined))
        && validateStatusFields(value);
    case "facility-action":
      return isId(value.requestId)
        && isId(value.actorId)
        && isShortString(value.facilityId, 96)
        && ["apiary", "morph-loom", "orb-rack", "healing-station", "waygrid-items", "waygrid-creatures", "aquarium", "golem-forge", "alchemy", "distillery", "sugarworks"].includes(value.facilityKind as string)
        && (value.kind === "open" || value.kind === "close" || value.kind === "update")
        && (value.expectedRevision === undefined || isInteger(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER))
        && (value.expectedPlayerRevision === undefined || isInteger(value.expectedPlayerRevision, 0, Number.MAX_SAFE_INTEGER))
        && validateFacilityState(value.state)
        && (value.playerState === undefined || validatePlayerSessionSnapshot(value.playerState))
        && validateStatusFields(value);
    case "player-state":
      return isId(value.requestId)
        && isId(value.actorId)
        && (value.expectedRevision === undefined || isInteger(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER))
        && validatePlayerSessionSnapshot(value.state)
        && value.state.playerId === value.actorId
        && validateStatusFields(value);
    case "player-progress": {
      const hasChunk = value.data !== undefined || value.chunkIndex !== undefined || value.chunkCount !== undefined;
      return isId(value.transferId)
        && isId(value.actorId)
        && isInteger(value.revision, 0, Number.MAX_SAFE_INTEGER)
        && (value.status !== "request" || hasChunk)
        && (!hasChunk || (typeof value.data === "string"
          && value.data.length > 0 && value.data.length <= 180_000
          && /^[A-Za-z0-9+/=]+$/u.test(value.data)
          && isInteger(value.chunkIndex, 0, 511)
          && isInteger(value.chunkCount, 1, 512)
          && (value.chunkIndex as number) < (value.chunkCount as number)))
        && validateStatusFields(value);
    }
    case "boat-action":
      return isId(value.requestId)
        && isId(value.actorId)
        && isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
        && ["launch", "board", "leave", "pack"].includes(value.kind as string)
        && (value.boatId === undefined || isId(value.boatId))
        && (value.x === undefined || isFiniteNumber(value.x, -COORDINATE_LIMIT, COORDINATE_LIMIT))
        && (value.y === undefined || isFiniteNumber(value.y, -4096, 4096))
        && (value.z === undefined || isFiniteNumber(value.z, -COORDINATE_LIMIT, COORDINATE_LIMIT))
        && (value.yaw === undefined || isFiniteNumber(value.yaw, -100_000, 100_000))
        && (value.boat === undefined || validateSailboat(value.boat))
        && (value.playerState === undefined || validatePlayerSessionSnapshot(value.playerState))
        && validateStatusFields(value);
    case "combat-action":
      return isId(value.requestId)
        && isId(value.actorId)
        && isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
        && (value.targetKind === "mob" || value.targetKind === "player")
        && isShortString(value.targetId, 160)
        && (value.attack === "melee" || value.attack === "ranged")
        && (value.resultingHealth === undefined || isFiniteNumber(value.resultingHealth, 0, 100_000))
        && (value.killed === undefined || typeof value.killed === "boolean")
        && validateStatusFields(value);
    case "creature-action":
      return isId(value.requestId)
        && isId(value.actorId)
        && isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
        && ["capture", "release", "recall", "command", "pacify-offering", "camp-care", "camp-connect", "camp-form-bond", "camp-transfer-offer", "camp-transfer-accept", "interact", "sentient-open", "sentient-close", "trade", "lead-hitch", "lead-unhitch", "aquarium-sync", "aquarium-insert", "aquarium-remove", "dragon-command", "dragon-shoulder", "dragon-harvest"].includes(value.kind as string)
        && (value.targetId === undefined || isInteger(value.targetId, 0, Number.MAX_SAFE_INTEGER))
        && (value.command === undefined || isShortString(value.command, 32))
        && (value.orbId === undefined || isShortString(value.orbId, 80))
        && (value.offerId === undefined || isShortString(value.offerId, 120))
        && (value.recipientId === undefined || isShortString(value.recipientId, 160))
        && (value.sourceName === undefined || isShortString(value.sourceName, 48))
        && (value.creatureName === undefined || isShortString(value.creatureName, 48))
        && (value.kind !== "dragon-command" || ["follow", "stay", "guard-lair", "wander"].includes(value.command as string))
        && ((value.kind === "dragon-command" || value.kind === "dragon-shoulder" || value.kind === "dragon-harvest") ? value.targetId !== undefined : true)
        && (value.name === undefined || isShortString(value.name, 48))
        && (value.distance === undefined || value.distance === "dynamic" || isFiniteNumber(value.distance, 1.5, 10))
        && (value.crouching === undefined || typeof value.crouching === "boolean")
        && (value.mounted === undefined || typeof value.mounted === "boolean")
        && (value.mountSeat === undefined || isInteger(value.mountSeat, 0, 3))
        && (value.panel === undefined || value.panel === "pet" || value.panel === "follower" || value.panel === "dragon" || value.panel === "sentient")
        && (value.merchantId === undefined || isShortString(value.merchantId, 160))
        && (value.tradeDirection === undefined || value.tradeDirection === "player-buys" || value.tradeDirection === "player-sells")
        && (value.itemKey === undefined || isShortString(value.itemKey, 128))
        && (value.tradeCount === undefined || isInteger(value.tradeCount, 1, MAX_TRADE_QUANTITY))
        && validateMerchantState(value.merchantState)
        && validateWalletState(value.walletState)
        && (value.playerState === undefined || validatePlayerSessionSnapshot(value.playerState))
        && (value.containerKey === undefined || (typeof value.containerKey === "string" && isShortString(value.containerKey, 96) && /^-?\d+,-?\d+,-?\d+$/u.test(value.containerKey)))
        && (value.residentId === undefined || isShortString(value.residentId, 160))
        && validateAquariumStatePayload(value.aquariumState)
        && (value.x === undefined || isFiniteNumber(value.x, -COORDINATE_LIMIT, COORDINATE_LIMIT))
        && (value.y === undefined || isFiniteNumber(value.y, -4096, 4096))
        && (value.z === undefined || isFiniteNumber(value.z, -COORDINATE_LIMIT, COORDINATE_LIMIT))
        && (value.message === undefined || isShortString(value.message, 160, true))
        && validateStatusFields(value);
    case "tcg-action":
      return validateTcgNetworkAction(value);
    case "map-share": {
      if (!isShortString(value.tableKey, 96) || typeof value.reply !== "boolean" || !isRecord(value.map)) return false;
      const map = value.map;
      return isInteger(map.schema, 1, 10)
        && isShortString(map.worldId, 128)
        && isShortString(map.playerId, 160)
        && isInteger(map.revision, 0, Number.MAX_SAFE_INTEGER)
        && Array.isArray(map.exploredChunks)
        && map.exploredChunks.length <= 4096
        && map.exploredChunks.every((entry) => isShortString(entry, 48))
        && Array.isArray(map.markers)
        && map.markers.length <= 512
        && map.markers.every((entry) => isRecord(entry)
          && isShortString(entry.id, 128)
          && isShortString(entry.name, 160)
          && ["natural-poi", "manual", "wayshrine", "bed-spawn", "settlement"].includes(entry.kind as string)
          && (entry.kind !== "settlement" || ["rumored", "charted", "visited"].includes(entry.settlementKnowledge as string))
          && isRecord(entry.position)
          && isFiniteNumber(entry.position.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
          && isFiniteNumber(entry.position.y, -COORDINATE_LIMIT, COORDINATE_LIMIT)
          && isFiniteNumber(entry.position.z, -COORDINATE_LIMIT, COORDINATE_LIMIT))
        && (map.activeBedId === null || isShortString(map.activeBedId, 128))
        && isInteger(map.fastTravelCharges, 0, 999);
    }
    case "snapshot":
      return isInteger(value.tick, 0, Number.MAX_SAFE_INTEGER)
        && isShortString(value.seed, 128)
        && (value.mode === undefined || value.mode === "builder" || value.mode === "survival")
        && isInteger(value.generatorVersion, 1, 1_000_000)
        && Array.isArray(value.players)
        && value.players.length <= 64
        && value.players.every(validatePose)
        && Array.isArray(value.blockEdits)
        && value.blockEdits.length <= 16_384
        && value.blockEdits.every(validateBlockEdit)
        && Array.isArray(value.mobs)
        && value.mobs.length <= 512
        && value.mobs.every(validateMob)
        && validateSnapshotScope(value.mobScope)
        && Array.isArray(value.drops)
        && value.drops.length <= 1024
        && value.drops.every(validateDrop)
        && validateSnapshotScope(value.dropScope)
        && (value.tombstones === undefined || (Array.isArray(value.tombstones) && value.tombstones.length <= 512 && value.tombstones.every(validateTombstone)))
        && (value.boats === undefined || (Array.isArray(value.boats) && value.boats.length <= 128 && value.boats.every(validateSailboat)))
        && validateTimeWeather(value.time)
        && (value.worldOptions === undefined || validateSessionWorldOptions(value.worldOptions))
        && (value.inventory === undefined || validateInventorySnapshot(value.inventory))
        && (value.containers === undefined || (Array.isArray(value.containers) && value.containers.length <= 4 && value.containers.every(validateContainerSnapshot)))
        && (value.playerState === undefined || validatePlayerSessionSnapshot(value.playerState))
        && validateGuildBookPayload(value.guildBook);
    default:
      return false;
  }
}

export function validateEnvelope(value: unknown): value is MultiplayerEnvelope {
  if (!isRecord(value)
    || value.version !== MULTIPLAYER_PROTOCOL_VERSION
    || !isId(value.sessionId)
    || !MESSAGE_TYPES.has(value.type as MultiplayerMessageType)
    || !isInteger(value.sequence, 0, Number.MAX_SAFE_INTEGER)
    || !isFiniteNumber(value.sentAt, 0, Number.MAX_SAFE_INTEGER)
    || !isId(value.from)
    || (value.authority !== undefined && !validateAuthorityIdentity(value.authority))
    || (value.authoritySequence !== undefined && !isInteger(value.authoritySequence, 0, Number.MAX_SAFE_INTEGER))) return false;
  const type = value.type as MultiplayerMessageType;
  return validatePayload(type, value.payload);
}

function utf8ByteLength(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

export function encodeEnvelope(envelope: MultiplayerEnvelope, maxBytes = MAX_RELIABLE_MESSAGE_BYTES) {
  if (!validateEnvelope(envelope)) throw new MultiplayerProtocolError("Invalid multiplayer envelope");
  const encoded = JSON.stringify(envelope);
  if (utf8ByteLength(encoded) > maxBytes) throw new MultiplayerProtocolError(`Multiplayer message exceeds ${maxBytes} bytes`);
  return encoded;
}

function decodeText(data: unknown, maxBytes: number) {
  if (typeof data === "string") {
    if (utf8ByteLength(data) > maxBytes) throw new MultiplayerProtocolError(`Multiplayer message exceeds ${maxBytes} bytes`);
    return data;
  }
  if (data instanceof ArrayBuffer) {
    if (data.byteLength > maxBytes) throw new MultiplayerProtocolError(`Multiplayer message exceeds ${maxBytes} bytes`);
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    if (data.byteLength > maxBytes) throw new MultiplayerProtocolError(`Multiplayer message exceeds ${maxBytes} bytes`);
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  throw new MultiplayerProtocolError("Unsupported multiplayer message encoding");
}

export function decodeEnvelope(data: unknown, maxBytes = MAX_RELIABLE_MESSAGE_BYTES): MultiplayerEnvelope {
  const text = decodeText(data, maxBytes);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new MultiplayerProtocolError("Malformed multiplayer JSON"); }
  if (!validateEnvelope(parsed)) throw new MultiplayerProtocolError("Invalid multiplayer envelope");
  return parsed;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new MultiplayerProtocolError("Invite code contains invalid characters");
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - value.length % 4) % 4);
  let binary: string;
  try { binary = atob(padded); } catch { throw new MultiplayerProtocolError("Invite code is not valid base64url"); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function validateManualSignal(value: unknown): value is ManualSignal {
  if (!isRecord(value)
    || value.version !== MULTIPLAYER_PROTOCOL_VERSION
    || value.protocol !== MULTIPLAYER_PROTOCOL_NAME
    || (value.kind !== "offer" && value.kind !== "answer")
    || !isId(value.sessionId)
    || !isId(value.token)
    || !validatePeerIdentity(value.identity)
    || (value.authority !== undefined && (!isRecord(value.authority) || value.authority.schema !== 1
      || typeof value.authority.packet !== "string" || value.authority.packet.length < 1 || value.authority.packet.length > 32 * 1024
      || !/^[A-Za-z0-9_-]+$/u.test(value.authority.packet)))
    || (value.runtime !== undefined && !validateRustMultiplayerRuntimeDescriptorV2(value.runtime))
    || ((value.authority === undefined) !== (value.runtime === undefined))
    || (value.runtime !== undefined && value.runtime.runtimeSessionId !== value.sessionId)) return false;
  return validateDescription(value.description, value.kind);
}

export function encodeInviteCode(signal: ManualSignal) {
  if (!validateManualSignal(signal)) throw new MultiplayerProtocolError("Invalid manual WebRTC signal");
  const encoded = `BW1.${bytesToBase64Url(new TextEncoder().encode(JSON.stringify(signal)))}`;
  if (encoded.length > MAX_INVITE_CODE_CHARS) throw new MultiplayerProtocolError("Invite code is too large");
  return encoded;
}

export function decodeInviteCode(code: string): ManualSignal {
  if (typeof code !== "string") throw new MultiplayerProtocolError("Invite code must be text");
  const compact = code.trim().replace(/\s+/gu, "");
  if (compact.length > MAX_INVITE_CODE_CHARS) throw new MultiplayerProtocolError("Invite code is too large");
  if (!compact.startsWith("BW1.")) throw new MultiplayerProtocolError("Invite code has an unsupported version");
  const bytes = base64UrlToBytes(compact.slice(4));
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new MultiplayerProtocolError("Invite code payload is malformed"); }
  if (!validateManualSignal(parsed)) throw new MultiplayerProtocolError("Invite code payload is invalid");
  return parsed;
}

export function detectMultiplayerSupport(scope: typeof globalThis = globalThis): MultiplayerSupport {
  const secureContext = (scope as typeof globalThis & { isSecureContext?: boolean }).isSecureContext !== false;
  const rtcConstructor = (scope as typeof globalThis & { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
  const webRTC = typeof rtcConstructor === "function";
  const dataChannels = webRTC && typeof rtcConstructor.prototype?.createDataChannel === "function";
  const textCodec = typeof scope.TextEncoder === "function" && typeof scope.TextDecoder === "function" && typeof scope.btoa === "function" && typeof scope.atob === "function";
  const cryptographicRandom = typeof scope.crypto?.getRandomValues === "function";
  const reasons: string[] = [];
  if (!secureContext) reasons.push("WebRTC multiplayer requires a secure context (HTTPS or localhost).");
  if (!webRTC) reasons.push("RTCPeerConnection is unavailable in this browser.");
  else if (!dataChannels) reasons.push("WebRTC data channels are unavailable in this browser.");
  if (!textCodec) reasons.push("Required text/base64 codecs are unavailable in this browser.");
  if (!cryptographicRandom) reasons.push("Cryptographic random IDs are unavailable in this browser.");
  return { supported: secureContext && webRTC && dataChannels && textCodec && cryptographicRandom, secureContext, webRTC, dataChannels, textCodec, cryptographicRandom, reasons };
}

function defaultRandomId(prefix: string) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}_${bytesToBase64Url(bytes)}`;
}

/**
 * Opt-in real-browser transport impairment for multiplayer acceptance tests.
 * Example: `?mpLatency=100-250`. Invalid or excessive values fail closed so
 * normal players can never accidentally inherit a pathological delay.
 */
export function parseMultiplayerLatencyRange(search: string) {
  const value = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("mpLatency")?.trim() ?? "";
  const match = /^(\d{1,4})-(\d{1,4})$/u.exec(value);
  if (!match) return undefined;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min || max > 2_000) return undefined;
  return { min, max };
}

export function createPeerIdentity(
  name: string,
  color: string,
  idFactory = defaultRandomId,
  variant?: "male" | "female",
  details: Partial<Pick<PeerIdentity, "profileId" | "browserId" | "sex" | "race" | "colors" | "startingSkills" | "peerKind" | "runnerVersion" | "requestedCapabilities">> = {},
): PeerIdentity {
  const sex = details.sex ?? variant;
  const identity = {
    id: idFactory(details.peerKind === "agent" ? "agent" : "player"),
    name,
    color,
    ...(variant ? { variant } : sex ? { variant: sex } : {}),
    ...(sex ? { sex } : {}),
    ...details,
  };
  if (!validatePeerIdentity(identity)) throw new MultiplayerProtocolError("Invalid peer identity");
  return identity;
}

function copyIdentity(identity: PeerIdentity): PeerIdentity {
  return {
    id: identity.id,
    name: identity.name,
    color: identity.color,
    ...(identity.variant ? { variant: identity.variant } : {}),
    ...(identity.sex ? { sex: identity.sex } : {}),
    ...(identity.profileId ? { profileId: identity.profileId } : {}),
    ...(identity.browserId ? { browserId: identity.browserId } : {}),
    ...(identity.race ? { race: identity.race } : {}),
    ...(identity.colors ? { colors: { ...identity.colors } } : {}),
    ...(identity.startingSkills ? { startingSkills: { ...identity.startingSkills } } : {}),
    ...(identity.peerKind ? { peerKind: identity.peerKind } : {}),
    ...(identity.runnerVersion ? { runnerVersion: identity.runnerVersion } : {}),
    ...(identity.requestedCapabilities ? { requestedCapabilities: [...identity.requestedCapabilities] } : {}),
  };
}

function defaultPeerConnectionFactory(configuration: RTCConfiguration): PeerConnectionLike {
  if (typeof RTCPeerConnection !== "function") throw new MultiplayerProtocolError("WebRTC is unavailable in this browser");
  return new RTCPeerConnection(configuration) as unknown as PeerConnectionLike;
}

function plainDescription(description: RTCSessionDescriptionInit | null, expectedType: "offer" | "answer") {
  if (!description || !validateDescription(description, expectedType)) throw new MultiplayerProtocolError(`Missing local ${expectedType} description`);
  return { type: expectedType, sdp: description.sdp } satisfies RTCSessionDescriptionInit;
}

export class MultiplayerSession {
  readonly identity: PeerIdentity;
  readonly rtcConfiguration: RTCConfiguration;
  readonly authorityMode: RustMultiplayerAuthorityModeV1;
  role: MultiplayerRole | null = null;
  sessionId: string | null = null;
  state: MultiplayerSessionState = "idle";

  private readonly peerConnectionFactory: PeerConnectionFactory;
  private readonly now: () => number;
  private readonly randomId: (prefix: string) => string;
  private readonly heartbeatIntervalMs: number;
  private readonly peerTimeoutMs: number;
  private readonly connectionTimeoutMs: number;
  private readonly iceGatheringTimeoutMs: number;
  private readonly artificialLatencyMs: { min: number; max: number } | null;
  private rustAuthority: RustMultiplayerAuthorityV1 | null;
  private authorityInterest: RustMultiplayerAuthorityInterestV1 | null;
  private rustRuntimeDescriptor: RustMultiplayerRuntimeDescriptorV2 | null;
  private readonly guestAuthorityFactory: RustMultiplayerGuestAuthorityFactoryV2 | null;
  private readonly preboundSessionId: string | null;
  private readonly authorityTimeoutMs: number;
  private readonly authorityGrantLifetimeMs: number;
  private readonly peers = new Map<string, PeerRecord>();
  private readonly listeners = new Set<MultiplayerListener>();
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private reliableSequence = 0;
  private movementSequence = 0;
  private voiceSequence = 0;
  private authorityCommandSequence = 0;
  private readonly artificialSendTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly nextReliableArtificialSendAt = new Map<string, number>();
  private readonly nextVoiceArtificialSendAt = new Map<string, number>();
  private readonly authorityOperations = new Set<Promise<unknown>>();
  private readonly authorityGenerations = new Map<string, number>();
  private readonly rustDeltaReassemblies = new Map<string, RustDeltaReassembly>();
  private guestBootstrapController: AbortController | null = null;
  private guestBootstrapGeneration = 0;
  private ownedGuestRuntimeShutdown: (() => Promise<unknown>) | null = null;
  /** Final host responses retained briefly so reconnect/retry is exactly-once. */
  private readonly responseCache = new Map<string, {
    peerId: string;
    requestId: string;
    expiresAt: number;
    envelopes: Array<{ type: MultiplayerMessageType; payload: MultiplayerPayloadMap[MultiplayerMessageType] }>;
  }>();
  private disposed = false;

  constructor(options: MultiplayerOptions) {
    if (!validatePeerIdentity(options.identity)) throw new MultiplayerProtocolError("A valid local peer identity is required");
    if (!options.peerConnectionFactory) {
      const support = detectMultiplayerSupport();
      if (!support.supported) throw new MultiplayerProtocolError(support.reasons.join(" "));
    }
    this.identity = copyIdentity(options.identity);
    this.authorityMode = options.authorityMode ?? "rust-authoritative";
    const requestedSessionId = options.sessionId ?? null;
    if (requestedSessionId !== null && !isId(requestedSessionId)) {
      throw new MultiplayerProtocolError("Prebound multiplayer session ID is invalid");
    }
    const hasReadyMember = options.rustAuthority !== undefined
      || options.authorityInterest !== undefined
      || options.rustRuntimeDescriptor !== undefined;
    const hasReadyAuthority = options.rustAuthority !== undefined
      && options.authorityInterest !== undefined
      && options.rustRuntimeDescriptor !== undefined;
    const hasGuestFactory = options.guestAuthorityFactory !== undefined;
    this.rustAuthority = null;
    this.authorityInterest = null;
    this.rustRuntimeDescriptor = null;
    this.guestAuthorityFactory = options.guestAuthorityFactory ?? null;
    let preboundSessionId = requestedSessionId;
    if (this.authorityMode === "rust-authoritative") {
      if (hasReadyMember && !hasReadyAuthority) {
        throw new MultiplayerProtocolError("A ready Rust authority requires its interest provider and runtime descriptor");
      }
      if (hasReadyAuthority === hasGuestFactory) {
        throw new MultiplayerProtocolError("Rust multiplayer requires either one ready authority binding or one guest authority factory");
      }
      if (hasReadyAuthority) {
        let binding: RustMultiplayerRuntimeBindingV2;
        try {
          binding = canonicalizeRustMultiplayerRuntimeBindingV2({
            descriptor: options.rustRuntimeDescriptor!,
            authority: options.rustAuthority!,
            interest: options.authorityInterest!,
            shutdown: async () => undefined,
          });
        } catch (error) {
          throw new MultiplayerProtocolError(error instanceof Error ? error.message : "Ready Rust authority binding is invalid");
        }
        if (preboundSessionId && preboundSessionId !== binding.descriptor.runtimeSessionId) {
          throw new MultiplayerProtocolError("Prebound multiplayer session does not match the Rust runtime session");
        }
        preboundSessionId = binding.descriptor.runtimeSessionId;
        this.rustAuthority = binding.authority;
        this.authorityInterest = binding.interest;
        this.rustRuntimeDescriptor = binding.descriptor;
      }
    } else if (hasReadyMember || hasGuestFactory) {
      throw new MultiplayerProtocolError("Legacy compatibility cannot run beside Rust authority configuration");
    }
    this.preboundSessionId = preboundSessionId;
    this.authorityTimeoutMs = options.authorityTimeoutMs ?? 10_000;
    this.authorityGrantLifetimeMs = options.authorityGrantLifetimeMs ?? 10 * 60_000;
    this.peerConnectionFactory = options.peerConnectionFactory ?? defaultPeerConnectionFactory;
    this.rtcConfiguration = options.rtcConfiguration ?? {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      bundlePolicy: "max-bundle",
    };
    this.now = options.now ?? (() => Date.now());
    this.randomId = options.randomId ?? defaultRandomId;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 2_000;
    this.peerTimeoutMs = options.peerTimeoutMs ?? 12_000;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 90_000;
    this.iceGatheringTimeoutMs = options.iceGatheringTimeoutMs ?? 12_000;
    this.artificialLatencyMs = options.artificialLatencyMs ?? null;
    if (!isFiniteNumber(this.heartbeatIntervalMs, 250, 60_000)
      || !isFiniteNumber(this.peerTimeoutMs, this.heartbeatIntervalMs * 2, 300_000)
      || !isFiniteNumber(this.connectionTimeoutMs, 5_000, 600_000)
      || !isFiniteNumber(this.iceGatheringTimeoutMs, 500, 60_000)
      || !isFiniteNumber(this.authorityTimeoutMs, 250, 60_000)
      || !isFiniteNumber(this.authorityGrantLifetimeMs, 1_000, 24 * 60 * 60_000)
      || (this.artificialLatencyMs !== null && (!isFiniteNumber(this.artificialLatencyMs.min, 0, 2_000)
        || !isFiniteNumber(this.artificialLatencyMs.max, this.artificialLatencyMs.min, 2_000)))) {
      throw new MultiplayerProtocolError("Invalid multiplayer timeout configuration");
    }
    if (options.onEvent) this.listeners.add(options.onEvent);
    if (options.autoMaintenance !== false) this.startMaintenance();
  }

  subscribe(listener: MultiplayerListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPeers() {
    return [...this.peers.values()].map((peer) => this.peerInfo(peer));
  }

  getPeer(peerIdOrToken: string) {
    const peer = this.resolvePeer(peerIdOrToken);
    return peer ? this.peerInfo(peer) : null;
  }

  private authority() {
    if (!this.rustAuthority) throw new MultiplayerProtocolError("Rust multiplayer authority is unavailable");
    return this.rustAuthority;
  }

  private canonicalInterest(peer: PeerIdentity, role: MultiplayerRole) {
    if (!this.sessionId || !this.authorityInterest) throw new MultiplayerProtocolError("Rust multiplayer interest is unavailable");
    return createNetworkInterestSetV1(this.authorityInterest({ sessionId: this.sessionId, local: this.identity, peer, role }));
  }

  private checkedRuntimeBinding(expected?: RustMultiplayerRuntimeDescriptorV2) {
    if (!this.rustAuthority || !this.authorityInterest || !this.rustRuntimeDescriptor) {
      throw new MultiplayerProtocolError("Rust multiplayer runtime is not ready");
    }
    try {
      return canonicalizeRustMultiplayerRuntimeBindingV2({
        descriptor: this.rustRuntimeDescriptor,
        authority: this.rustAuthority,
        interest: this.authorityInterest,
        shutdown: async () => undefined,
      }, expected);
    } catch (error) {
      throw new MultiplayerProtocolError(error instanceof Error ? error.message : "Rust multiplayer runtime binding is invalid");
    }
  }

  private async shutdownUnadoptedGuestRuntime(binding: RustMultiplayerRuntimeBindingV2) {
    if (!binding || typeof binding.shutdown !== "function") return;
    const operation = Promise.resolve().then(() => binding.shutdown());
    this.trackAuthority(operation);
    try { await operation; } catch { /* Preserve the cancellation or validation failure. */ }
  }

  private async acquireGuestRuntime(
    descriptor: RustMultiplayerRuntimeDescriptorV2,
    controller: AbortController,
    generation: number,
  ) {
    if (!this.guestAuthorityFactory) return this.checkedRuntimeBinding(descriptor);
    const factoryOperation = Promise.resolve().then(() => this.guestAuthorityFactory!({ descriptor, signal: controller.signal }));
    this.trackAuthority(factoryOperation);
    const created = await factoryOperation;
    if (this.disposed || controller.signal.aborted || generation !== this.guestBootstrapGeneration) {
      await this.shutdownUnadoptedGuestRuntime(created);
      throw new MultiplayerOperationCancelledError("Guest runtime startup was cancelled because the session changed");
    }
    let binding: RustMultiplayerRuntimeBindingV2;
    try { binding = canonicalizeRustMultiplayerRuntimeBindingV2(created, descriptor); }
    catch (error) {
      await this.shutdownUnadoptedGuestRuntime(created);
      throw new MultiplayerProtocolError(error instanceof Error ? error.message : "Guest Rust runtime binding is invalid");
    }
    this.rustAuthority = binding.authority;
    this.authorityInterest = binding.interest;
    this.rustRuntimeDescriptor = binding.descriptor;
    this.ownedGuestRuntimeShutdown = binding.shutdown;
    return binding;
  }

  private releaseOwnedGuestRuntime() {
    const shutdown = this.ownedGuestRuntimeShutdown;
    if (!shutdown) return Promise.resolve();
    this.ownedGuestRuntimeShutdown = null;
    const authority = this.rustAuthority;
    const pending = [...this.authorityOperations];
    const operation = (async () => {
      let failure: unknown = null;
      await Promise.allSettled(pending);
      try { await authority?.drain(); }
      catch (error) { failure = error; }
      try { await shutdown(); }
      catch (error) { failure ??= error; }
      if (this.rustAuthority === authority) {
        this.rustAuthority = null;
        this.authorityInterest = null;
        this.rustRuntimeDescriptor = null;
      }
      if (failure) throw failure;
    })();
    this.trackAuthority(operation);
    return operation;
  }

  private authorityPeer(peer: PeerRecord, capabilities = peer.authorityCapabilities): RustMultiplayerAuthorityPeerV1 {
    if (!this.sessionId || !peer.identity) throw new MultiplayerProtocolError("Cannot grant an unidentified multiplayer peer");
    const peerKind = peer.identity.peerKind ?? "human";
    const grantedCapabilities = peerKind === "agent"
      ? capabilities.filter((capability) => capability === "agent-work" || capability === "chat")
      : capabilities.filter((capability) => capability !== "agent-work");
    return Object.freeze({
      sessionId: this.sessionId,
      peerId: peer.identity.id,
      connectionId: peer.token,
      actorId: peer.identity.id,
      peerKind,
      role: this.role === "host" ? "guest" : "host",
      capabilities: grantedCapabilities,
      expiresAt: this.now() + this.authorityGrantLifetimeMs,
      nextSequence: 0,
      interest: this.canonicalInterest(peer.identity, this.role!),
      connectionGeneration: peer.authorityGeneration,
    });
  }

  private trackAuthority<T>(operation: Promise<T>) {
    this.authorityOperations.add(operation);
    void operation.finally(() => this.authorityOperations.delete(operation)).catch(() => undefined);
    return operation;
  }

  private async authorityDeadline<T>(operation: Promise<T>, label: string, signal?: AbortSignal) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let abortListener: (() => void) | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new MultiplayerProtocolError(`${label} exceeded the Rust authority deadline`)), this.authorityTimeoutMs);
    });
    const cancelled = signal ? new Promise<never>((_, reject) => {
      abortListener = () => reject(new MultiplayerOperationCancelledError(`${label} was cancelled because the session changed`));
      if (signal.aborted) abortListener();
      else signal.addEventListener("abort", abortListener, { once: true });
    }) : null;
    const bounded = Promise.race(cancelled ? [operation, timeout, cancelled] : [operation, timeout]);
    this.trackAuthority(bounded);
    try { return await bounded; }
    finally {
      if (timer !== null) clearTimeout(timer);
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    }
  }

  private queuePeerAuthority(peer: PeerRecord, operation: () => Promise<void>) {
    const queued = peer.authorityQueue.then(operation, operation);
    peer.authorityQueue = queued.catch(() => undefined);
    this.trackAuthority(queued);
    return queued;
  }

  private nextAuthorityGeneration(peerId: string) {
    const next = (this.authorityGenerations.get(peerId) ?? 0) + 1;
    this.authorityGenerations.set(peerId, next);
    return next;
  }

  async drainAuthority() {
    while (this.authorityOperations.size > 0) {
      await Promise.allSettled([...this.authorityOperations]);
    }
    if (this.rustAuthority) await this.rustAuthority.drain();
  }

  /**
   * Peak fraction of a channel's bounded send budget currently queued across
   * connected peers. This is intentionally a normalized health signal: agent
   * observations can react to transport pressure without learning private
   * peer/channel internals or copying WebRTC implementation details.
   */
  channelBackpressure() {
    let peak = 0;
    for (const peer of this.peers.values()) {
      if (peer.closed || peer.state !== "connected") continue;
      const channels: readonly (readonly [DataChannelLike | null, number])[] = [
        [peer.reliable, MAX_RELIABLE_BUFFERED_BYTES],
        [peer.movement, MAX_MOVEMENT_BUFFERED_BYTES],
        [peer.voice, MAX_VOICE_BUFFERED_BYTES],
      ];
      for (const [channel, limit] of channels) {
        if (!channel || channel.readyState !== "open") continue;
        peak = Math.max(peak, channel.bufferedAmount / limit);
      }
    }
    return Math.max(0, Math.min(1, peak));
  }

  private emit(event: MultiplayerEvent) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* Consumers cannot break transport bookkeeping. */ }
    }
  }

  private emitError(error: unknown, peer?: PeerRecord) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.emit({ type: "error", error: normalized, ...(peer ? { peer: this.peerInfo(peer) } : {}) });
  }

  private setState(state: MultiplayerSessionState) {
    if (this.state === state) return;
    const previous = this.state;
    this.state = state;
    this.emit({ type: "state", previous, state });
  }

  private peerInfo(peer: PeerRecord): PeerInfo {
    return {
      token: peer.token,
      identity: peer.identity ? copyIdentity(peer.identity) : null,
      state: peer.state,
      connectedAt: peer.connectedAt,
      lastSeenAt: peer.lastSeenAt,
      latencyMs: peer.latencyMs,
      reliableOpen: peer.reliable?.readyState === "open",
      movementOpen: peer.movement?.readyState === "open",
      voiceOpen: peer.voice?.readyState === "open",
    };
  }

  private emitPeer(peer: PeerRecord, reason?: string) {
    this.emit({ type: "peer", peer: this.peerInfo(peer), ...(reason ? { reason } : {}) });
  }

  private ensureOpen() {
    if (this.disposed || this.state === "closed") throw new MultiplayerProtocolError("Multiplayer session is closed");
  }

  private checkedId(prefix: string) {
    const value = this.randomId(prefix);
    if (!isId(value)) throw new MultiplayerProtocolError(`Generated ${prefix} ID is invalid`);
    return value;
  }

  private resolvePeer(peerIdOrToken: string) {
    const byToken = this.peers.get(peerIdOrToken);
    if (byToken) return byToken;
    for (const peer of this.peers.values()) if (peer.identity?.id === peerIdOrToken) return peer;
    return undefined;
  }

  private createPeer(token: string, identity: PeerIdentity | null, state: MultiplayerPeerState) {
    const connection = this.peerConnectionFactory(this.rtcConfiguration);
    const now = this.now();
    const peer: PeerRecord = {
      token,
      identity: identity ? copyIdentity(identity) : null,
      connection,
      reliable: null,
      movement: null,
      voice: null,
      state,
      createdAt: now,
      connectedAt: null,
      lastSeenAt: now,
      latencyMs: null,
      lastReliableSequence: -1,
      lastMovementSequence: -1,
      lastVoiceSequence: -1,
      protocolStrikes: 0,
      pendingHeartbeatNonce: null,
      pendingHeartbeatAt: 0,
      authorityCapabilities: Object.freeze([]),
      authorityGeneration: identity ? this.nextAuthorityGeneration(identity.id) : 0,
      authorityGrant: null,
      lastAgentGrant: null,
      authorityQueue: Promise.resolve(),
      acceptedAuthorityCommands: new Set(),
      deliveredAuthorityReceipts: new Set(),
      closed: false,
    };
    this.peers.set(token, peer);
    connection.onconnectionstatechange = () => this.handleConnectionState(peer);
    return peer;
  }

  private handleConnectionState(peer: PeerRecord) {
    if (peer.closed) return;
    const state = peer.connection.connectionState;
    if (state === "failed") { this.closePeer(peer, "connection-failed", "failed"); return; }
    if (state === "closed") { this.closePeer(peer, "connection-closed", "closed"); return; }
    if (state === "disconnected") {
      peer.state = "stale";
      this.emitPeer(peer, "connection-interrupted");
      return;
    }
    if (state === "connected") this.maybeMarkConnected(peer);
  }

  private bindChannel(peer: PeerRecord, channel: DataChannelLike, kind: MultiplayerChannelKind) {
    const expectedLabel = kind === "reliable" ? RELIABLE_CHANNEL_LABEL : kind === "movement" ? MOVEMENT_CHANNEL_LABEL : VOICE_CHANNEL_LABEL;
    const validOptions = kind === "reliable" ? channel.ordered : kind === "movement" ? !channel.ordered && channel.maxRetransmits === 0 : channel.ordered;
    const existing = kind === "reliable" ? peer.reliable : kind === "movement" ? peer.movement : peer.voice;
    if (channel.label !== expectedLabel || !validOptions || existing) {
      channel.close();
      this.protocolStrike(peer, `Rejected invalid or duplicate ${kind} channel`);
      return;
    }
    channel.binaryType = "arraybuffer";
    if (kind === "reliable") peer.reliable = channel;
    else if (kind === "movement") peer.movement = channel;
    else peer.voice = channel;
    channel.onopen = () => this.maybeMarkConnected(peer);
    channel.onmessage = (event) => this.handleChannelMessage(peer, kind, event.data);
    channel.onerror = () => this.emitError(new Error(`${kind} data channel error`), peer);
    channel.onclose = () => {
      if (!peer.closed) this.closePeer(peer, `${kind}-channel-closed`, "disconnected");
    };
    if (channel.readyState === "open") this.maybeMarkConnected(peer);
  }

  private maybeMarkConnected(peer: PeerRecord) {
    if (peer.closed || !peer.identity || peer.reliable?.readyState !== "open" || peer.movement?.readyState !== "open" || peer.voice?.readyState !== "open") return;
    const firstConnection = peer.connectedAt === null;
    peer.state = "connected";
    peer.connectedAt ??= this.now();
    peer.lastSeenAt = this.now();
    if (firstConnection) {
      this.emitPeer(peer, "connected");
      this.sendControl(peer, "hello", { identity: this.identity, role: this.role! });
    }
    this.recalculateSessionState();
  }

  private recalculateSessionState() {
    if (this.disposed) return;
    const connected = [...this.peers.values()].some((peer) => !peer.closed && peer.state === "connected");
    if (connected) this.setState("connected");
    else if (this.role === "host") this.setState("hosting");
    else if (this.role === "guest" && this.peers.size) this.setState("joining");
    else if (this.role === "guest") this.setState("disconnected");
  }

  private async waitForIceGathering(connection: PeerConnectionLike, isCancelled: () => boolean) {
    if (isCancelled()) throw new MultiplayerOperationCancelledError();
    if (connection.iceGatheringState === "complete") return;
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        clearInterval(poll);
        connection.onicegatheringstatechange = null;
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(finish, this.iceGatheringTimeoutMs);
      const check = () => {
        if (isCancelled()) finish(new MultiplayerOperationCancelledError());
        else if (connection.iceGatheringState === "complete") finish();
      };
      const poll = setInterval(check, 25);
      connection.onicegatheringstatechange = check;
      check();
    });
  }

  async createHostInvite() {
    this.ensureOpen();
    if (this.role === "guest") throw new MultiplayerProtocolError("A guest session cannot create host invites");
    if (this.authorityMode === "rust-authoritative" && this.guestAuthorityFactory) {
      throw new MultiplayerProtocolError("A guest authority factory cannot create host invites");
    }
    const runtime = this.authorityMode === "rust-authoritative" ? this.checkedRuntimeBinding().descriptor : null;
    if (!this.role) {
      this.role = "host";
      this.sessionId = this.preboundSessionId ?? this.checkedId("session");
      if (runtime && runtime.runtimeSessionId !== this.sessionId) {
        this.role = null;
        this.sessionId = null;
        throw new MultiplayerProtocolError("Host WebRTC session does not match its prebound Rust runtime session");
      }
      this.setState("hosting");
    }
    const token = this.checkedId("invite");
    if (this.peers.has(token)) throw new MultiplayerProtocolError("Duplicate invite token");
    const peer = this.createPeer(token, null, "invited");
    try {
      this.bindChannel(peer, peer.connection.createDataChannel(RELIABLE_CHANNEL_LABEL, { ordered: true }), "reliable");
      this.bindChannel(peer, peer.connection.createDataChannel(MOVEMENT_CHANNEL_LABEL, { ordered: false, maxRetransmits: 0 }), "movement");
      this.bindChannel(peer, peer.connection.createDataChannel(VOICE_CHANNEL_LABEL, { ordered: true }), "voice");
      const offer = await peer.connection.createOffer();
      if (!validateDescription(offer, "offer")) throw new MultiplayerProtocolError("Browser created an invalid WebRTC offer");
      await peer.connection.setLocalDescription(offer);
      await this.waitForIceGathering(peer.connection, () => this.disposed || peer.closed);
      if (this.disposed || peer.closed) throw new MultiplayerOperationCancelledError("Host invite setup was cancelled because the session changed");
      const signal: OfferSignal = {
        version: MULTIPLAYER_PROTOCOL_VERSION,
        protocol: MULTIPLAYER_PROTOCOL_NAME,
        kind: "offer",
        sessionId: this.sessionId!,
        token,
        identity: copyIdentity(this.identity),
        description: plainDescription(peer.connection.localDescription, "offer"),
        ...(this.authorityMode === "rust-authoritative" ? { authority: {
          schema: 1 as const,
          packet: bytesToBase64Url(this.authority().createHandshake({
            sessionId: this.sessionId!, peerId: this.identity.id,
            peerKind: this.identity.peerKind ?? "human", role: "host",
          })),
        }, runtime: runtime! } : {}),
      };
      this.emitPeer(peer, "invite-created");
      return { token, inviteCode: encodeInviteCode(signal) };
    } catch (error) {
      const normalized = this.disposed || peer.closed || isMultiplayerOperationCancellation(error)
        ? new MultiplayerOperationCancelledError("Host invite setup was cancelled because the session changed")
        : error;
      this.closePeer(peer, "invite-failed", "failed");
      if (!isMultiplayerOperationCancellation(normalized)) this.emitError(normalized, peer);
      throw normalized;
    }
  }

  async createGuestAnswer(inviteCode: string) {
    this.ensureOpen();
    if (this.role || this.peers.size || this.guestBootstrapController) throw new MultiplayerProtocolError("This session is already hosting or joining");
    const signal = decodeInviteCode(inviteCode);
    if (signal.kind !== "offer") throw new MultiplayerProtocolError("Expected a host offer code");
    if (signal.identity.id === this.identity.id) throw new MultiplayerProtocolError("Cannot join your own multiplayer invite");
    let runtime: RustMultiplayerRuntimeDescriptorV2 | null = null;
    if (this.authorityMode === "rust-authoritative") {
      if (!signal.authority || !signal.runtime) {
        throw new MultiplayerProtocolError("Host invite is missing its required Rust authority handshake or runtime descriptor");
      }
      try { runtime = parseRustMultiplayerRuntimeDescriptorV2(signal.runtime); }
      catch (error) { throw new MultiplayerProtocolError(error instanceof Error ? error.message : "Host runtime descriptor is invalid"); }
      if (runtime.runtimeSessionId !== signal.sessionId) throw new MultiplayerProtocolError("Host runtime and WebRTC session IDs differ");
      if (this.preboundSessionId && this.preboundSessionId !== signal.sessionId) {
        throw new MultiplayerProtocolError("Host offer belongs to a different prebound Rust runtime session");
      }
    } else if (signal.authority || signal.runtime) {
      throw new MultiplayerProtocolError("Legacy compatibility cannot accept a Rust-authoritative offer");
    }

    const controller = new AbortController();
    const generation = ++this.guestBootstrapGeneration;
    this.guestBootstrapController = controller;
    let peer: PeerRecord | null = null;
    try {
      if (runtime) await this.acquireGuestRuntime(runtime, controller, generation);
      if (this.disposed || controller.signal.aborted || generation !== this.guestBootstrapGeneration) {
        throw new MultiplayerOperationCancelledError("Guest answer setup was cancelled because the session changed");
      }
      this.role = "guest";
      this.sessionId = signal.sessionId;
      this.setState("joining");
      peer = this.createPeer(signal.token, signal.identity, "connecting");
      const activePeer = peer;
      activePeer.connection.ondatachannel = (event) => {
        const channel = event.channel as unknown as DataChannelLike;
        if (channel.label === RELIABLE_CHANNEL_LABEL) this.bindChannel(activePeer, channel, "reliable");
        else if (channel.label === MOVEMENT_CHANNEL_LABEL) this.bindChannel(activePeer, channel, "movement");
        else if (channel.label === VOICE_CHANNEL_LABEL) this.bindChannel(activePeer, channel, "voice");
        else channel.close();
      };
      let peerHandshake: Uint8Array | null = null;
      if (this.authorityMode === "rust-authoritative") {
        peerHandshake = this.authority().createHandshake({
          sessionId: signal.sessionId, peerId: this.identity.id,
          peerKind: this.identity.peerKind ?? "human", role: "guest",
        });
        const negotiated = await this.authorityDeadline(
          this.authority().negotiate(base64UrlToBytes(signal.authority!.packet), peerHandshake),
          "Rust authority handshake",
          controller.signal,
        );
        if (this.disposed || activePeer.closed || controller.signal.aborted) {
          throw new MultiplayerOperationCancelledError("Guest answer setup was cancelled because the session changed");
        }
        activePeer.authorityCapabilities = negotiated.capabilities;
        activePeer.authorityGrant = this.authorityPeer(activePeer, negotiated.capabilities);
        await this.authorityDeadline(this.authority().installPeer(activePeer.authorityGrant), "Rust peer grant", controller.signal);
        if (this.disposed || activePeer.closed || controller.signal.aborted) {
          throw new MultiplayerOperationCancelledError("Guest answer setup was cancelled because the session changed");
        }
      }
      await activePeer.connection.setRemoteDescription(signal.description);
      const answer = await activePeer.connection.createAnswer();
      if (!validateDescription(answer, "answer")) throw new MultiplayerProtocolError("Browser created an invalid WebRTC answer");
      await activePeer.connection.setLocalDescription(answer);
      await this.waitForIceGathering(activePeer.connection, () => this.disposed || activePeer.closed || controller.signal.aborted);
      if (this.disposed || activePeer.closed || controller.signal.aborted) throw new MultiplayerOperationCancelledError("Guest answer setup was cancelled because the session changed");
      const response: AnswerSignal = {
        version: MULTIPLAYER_PROTOCOL_VERSION,
        protocol: MULTIPLAYER_PROTOCOL_NAME,
        kind: "answer",
        sessionId: signal.sessionId,
        token: signal.token,
        identity: copyIdentity(this.identity),
        description: plainDescription(activePeer.connection.localDescription, "answer"),
        ...(peerHandshake ? {
          authority: { schema: 1 as const, packet: bytesToBase64Url(peerHandshake) },
          runtime: runtime!,
        } : {}),
      };
      return { host: copyIdentity(signal.identity), answerCode: encodeInviteCode(response) };
    } catch (error) {
      const normalized = this.disposed || controller.signal.aborted || peer?.closed || isMultiplayerOperationCancellation(error)
        ? new MultiplayerOperationCancelledError("Guest answer setup was cancelled because the session changed")
        : error;
      if (peer) this.closePeer(peer, "join-failed", "failed");
      this.role = null;
      this.sessionId = null;
      if (this.ownedGuestRuntimeShutdown) {
        try { await this.releaseOwnedGuestRuntime(); }
        catch (cleanupError) { if (!isMultiplayerOperationCancellation(normalized)) this.emitError(cleanupError, peer ?? undefined); }
      }
      if (!isMultiplayerOperationCancellation(normalized)) {
        this.setState("error");
        this.emitError(normalized, peer ?? undefined);
      }
      throw normalized;
    } finally {
      if (this.guestBootstrapController === controller) this.guestBootstrapController = null;
    }
  }

  async acceptGuestAnswer(answerCode: string) {
    this.ensureOpen();
    if (this.role !== "host" || !this.sessionId) throw new MultiplayerProtocolError("Only an active host can accept guest answers");
    const signal = decodeInviteCode(answerCode);
    if (signal.kind !== "answer") throw new MultiplayerProtocolError("Expected a guest answer code");
    if (signal.sessionId !== this.sessionId) throw new MultiplayerProtocolError("Answer belongs to a different session");
    if (this.authorityMode === "rust-authoritative") {
      if (!signal.authority || !signal.runtime) {
        throw new MultiplayerProtocolError("Guest answer is missing its Rust authority handshake or runtime descriptor");
      }
      let runtime: RustMultiplayerRuntimeDescriptorV2;
      try { runtime = parseRustMultiplayerRuntimeDescriptorV2(signal.runtime); }
      catch (error) { throw new MultiplayerProtocolError(error instanceof Error ? error.message : "Guest runtime descriptor is invalid"); }
      const expected = this.checkedRuntimeBinding().descriptor;
      if (!rustMultiplayerRuntimeDescriptorEqualsV2(runtime, expected)) {
        throw new MultiplayerProtocolError("Guest answer attests a different Rust runtime");
      }
    } else if (signal.authority || signal.runtime) {
      throw new MultiplayerProtocolError("Legacy compatibility cannot accept a Rust-authoritative answer");
    }
    const peer = this.peers.get(signal.token);
    if (!peer || peer.closed || peer.identity) throw new MultiplayerProtocolError("Answer token is unknown or already used");
    if (signal.identity.id === this.identity.id) throw new MultiplayerProtocolError("Host and guest identities must be different");
    for (const existing of this.peers.values()) {
      if (!existing.closed && existing !== peer && existing.identity?.id === signal.identity.id) throw new MultiplayerProtocolError("That guest identity is already connected");
    }
    peer.identity = copyIdentity(signal.identity);
    peer.authorityGeneration = this.nextAuthorityGeneration(signal.identity.id);
    peer.state = "connecting";
    try {
      if (this.authorityMode === "rust-authoritative") {
        const hostHandshake = this.authority().createHandshake({
          sessionId: this.sessionId, peerId: this.identity.id,
          peerKind: this.identity.peerKind ?? "human", role: "host",
        });
        const negotiated = await this.authorityDeadline(
          this.authority().negotiate(hostHandshake, base64UrlToBytes(signal.authority!.packet)),
          "Rust authority handshake",
        );
        peer.authorityCapabilities = negotiated.capabilities;
        peer.authorityGrant = this.authorityPeer(peer, negotiated.capabilities);
        await this.authorityDeadline(this.authority().installPeer(peer.authorityGrant), "Rust peer grant");
      }
      await peer.connection.setRemoteDescription(signal.description);
      this.emitPeer(peer, "answer-accepted");
      this.maybeMarkConnected(peer);
      return this.peerInfo(peer);
    } catch (error) {
      this.closePeer(peer, "answer-failed", "failed");
      this.emitError(error, peer);
      throw error;
    }
  }

  cancelInvite(token: string) {
    this.ensureOpen();
    if (this.role !== "host") return false;
    const peer = this.peers.get(token);
    if (!peer || peer.identity || peer.closed) return false;
    this.closePeer(peer, "invite-cancelled", "closed");
    return true;
  }

  private nextSequence(kind: MultiplayerChannelKind) {
    if (kind === "reliable") {
      if (this.reliableSequence >= Number.MAX_SAFE_INTEGER) throw new MultiplayerProtocolError("Reliable sequence space exhausted");
      return this.reliableSequence++;
    }
    if (kind === "movement") {
      if (this.movementSequence >= Number.MAX_SAFE_INTEGER) throw new MultiplayerProtocolError("Movement sequence space exhausted");
      return this.movementSequence++;
    }
    if (this.voiceSequence >= Number.MAX_SAFE_INTEGER) throw new MultiplayerProtocolError("Voice sequence space exhausted");
    return this.voiceSequence++;
  }

  private makeEnvelope<K extends MultiplayerMessageType>(type: K, payload: MultiplayerPayloadMap[K], kind: MultiplayerChannelKind): MultiplayerEnvelope<K> {
    if (!this.sessionId) throw new MultiplayerProtocolError("Multiplayer session has no session ID");
    const envelope: MultiplayerEnvelope<K> = {
      version: MULTIPLAYER_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      type,
      sequence: this.nextSequence(kind),
      sentAt: this.now(),
      from: this.identity.id,
      payload,
      ...(this.authorityMode === "rust-authoritative" ? { authority: this.authority().currentIdentity() } : {}),
      ...(this.authorityMode === "rust-authoritative" && this.role === "guest" && !CONTROL_TYPES.has(type)
        ? { authoritySequence: this.authorityCommandSequence++ }
        : {}),
    };
    if (!validateEnvelope(envelope)) throw new MultiplayerProtocolError(`Invalid ${type} payload`);
    return envelope;
  }

  private sendEncoded(peer: PeerRecord, kind: MultiplayerChannelKind, encoded: string) {
    if (peer.closed || peer.state !== "connected") return false;
    const channel = kind === "reliable" ? peer.reliable : kind === "movement" ? peer.movement : peer.voice;
    if (!channel || channel.readyState !== "open") return false;
    const bufferedLimit = kind === "reliable" ? MAX_RELIABLE_BUFFERED_BYTES : kind === "movement" ? MAX_MOVEMENT_BUFFERED_BYTES : MAX_VOICE_BUFFERED_BYTES;
    if (channel.bufferedAmount > bufferedLimit) {
      if (kind === "reliable") this.emitError(new Error("Reliable multiplayer channel is backpressured"), peer);
      return false;
    }
    const sendNow = () => {
      if (peer.closed || channel.readyState !== "open") return;
      try { channel.send(encoded); }
      catch (error) { this.emitError(error, peer); }
    };
    if (this.artificialLatencyMs) {
      const randomDelay = this.artificialLatencyMs.min
        + Math.random() * (this.artificialLatencyMs.max - this.artificialLatencyMs.min);
      const now = this.now();
      let sendAt = now + randomDelay;
      if (kind === "reliable") {
        sendAt = Math.max(sendAt, (this.nextReliableArtificialSendAt.get(peer.token) ?? now) + 1);
        this.nextReliableArtificialSendAt.set(peer.token, sendAt);
      } else if (kind === "voice") {
        sendAt = Math.max(sendAt, (this.nextVoiceArtificialSendAt.get(peer.token) ?? now) + 1);
        this.nextVoiceArtificialSendAt.set(peer.token, sendAt);
      }
      const timer = setTimeout(() => {
        this.artificialSendTimers.delete(timer);
        sendNow();
      }, Math.max(0, sendAt - now));
      this.artificialSendTimers.add(timer);
      return true;
    }
    try { channel.send(encoded); return true; }
    catch (error) { this.emitError(error, peer); return false; }
  }

  private sendControl<K extends "hello" | "heartbeat" | "goodbye">(peer: PeerRecord, type: K, payload: MultiplayerPayloadMap[K]) {
    if (!this.sessionId || !peer.reliable || peer.reliable.readyState !== "open") return false;
    const envelope = this.makeEnvelope(type, payload, "reliable") as MultiplayerEnvelope;
    const encoded = encodeEnvelope(envelope, MAX_RELIABLE_MESSAGE_BYTES);
    return this.sendEncoded(peer, "reliable", encoded);
  }

  private pruneResponseCache(at = this.now()) {
    if (this.authorityMode !== "legacy-compatibility") return;
    for (const [key, entry] of this.responseCache) if (entry.expiresAt <= at) this.responseCache.delete(key);
    while (this.responseCache.size > 1_024) {
      const oldest = this.responseCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.responseCache.delete(oldest);
    }
  }

  private cacheHostResponse(peer: PeerRecord, type: MultiplayerMessageType, payload: MultiplayerPayloadMap[MultiplayerMessageType]) {
    if (this.authorityMode !== "legacy-compatibility" || this.role !== "host" || !peer.identity || !isRecord(payload) || !("requestId" in payload) || !("status" in payload)) return;
    const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
    if (!requestId || (payload.status !== "accepted" && payload.status !== "rejected")) return;
    this.pruneResponseCache();
    const key = `${peer.identity.id}|${requestId}`;
    const existing = this.responseCache.get(key);
    const envelopes = existing?.envelopes.filter((entry) => entry.type !== type) ?? [];
    envelopes.push({ type, payload: structuredClone(payload) });
    this.responseCache.delete(key);
    this.responseCache.set(key, {
      peerId: peer.identity.id,
      requestId,
      expiresAt: this.now() + 20_000,
      envelopes,
    });
    const peerEntries = [...this.responseCache.entries()].filter(([, entry]) => entry.peerId === peer.identity!.id);
    for (let index = 0; index < Math.max(0, peerEntries.length - 256); index += 1) this.responseCache.delete(peerEntries[index][0]);
  }

  private replayCachedResponse(peer: PeerRecord, requestId: string) {
    if (this.authorityMode !== "legacy-compatibility") return false;
    if (!peer.identity) return false;
    this.pruneResponseCache();
    const cached = this.responseCache.get(`${peer.identity.id}|${requestId}`);
    if (!cached || !peer.reliable || peer.reliable.readyState !== "open") return false;
    let replayed = false;
    for (const response of cached.envelopes) {
      const envelope = this.makeEnvelope(response.type, response.payload, "reliable") as MultiplayerEnvelope;
      const encoded = encodeEnvelope(envelope, MAX_RELIABLE_MESSAGE_BYTES);
      replayed = this.sendEncoded(peer, "reliable", encoded) || replayed;
    }
    return replayed;
  }

  private completedAuthorityCommandId(payload: unknown) {
    if (!isRecord(payload)) return null;
    if (payload.terminal === true && typeof payload.commandId === "string") return payload.commandId;
    if ((payload.status === "accepted" || payload.status === "rejected") && typeof payload.requestId === "string") return payload.requestId;
    return null;
  }

  private releaseCompletedAuthorityCommand(peer: PeerRecord, payload: unknown) {
    const commandId = this.completedAuthorityCommandId(payload);
    if (!commandId || !peer.acceptedAuthorityCommands.delete(commandId)) return;
    void this.queuePeerAuthority(peer, async () => {
      await this.authorityDeadline(this.authority().releaseCommand(commandId), "command lease release");
    }).catch((error) => this.emitError(error, peer));
  }

  send<K extends Exclude<MultiplayerMessageType, "hello" | "heartbeat" | "goodbye">>(type: K, payload: MultiplayerPayloadMap[K], peerId?: string) {
    this.ensureOpen();
    if (!this.role || !this.sessionId) throw new MultiplayerProtocolError("Multiplayer session is not active");
    if (!validatePayload(type, payload)) throw new MultiplayerProtocolError(`Invalid ${type} payload`);
    if (this.role === "guest" && !GUEST_OUTBOUND_TYPES.has(type)) throw new MultiplayerProtocolError(`Guests cannot authoritatively send ${type}`);
    if (this.role === "guest") {
      const actorId = "actorId" in payload
        ? payload.actorId
        : "playerId" in payload
          ? payload.playerId
          : "agentId" in payload
            ? payload.agentId
            : "authorId" in payload
              ? payload.authorId
              : undefined;
      if (actorId && actorId !== this.identity.id) throw new MultiplayerProtocolError("Guest actions must use the local peer identity");
      if ("status" in payload && payload.status !== undefined && payload.status !== "request") throw new MultiplayerProtocolError("Guests can only send action requests");
    }
    // High-rate reconstructable world images belong on the unordered,
    // no-retransmit lane. A stale mob frame must never head-of-line block a
    // chest, placement, trade, or selected-slot acknowledgement.
    const kind: MultiplayerChannelKind = this.authorityMode === "rust-authoritative" && this.role === "guest"
      ? "reliable"
      : type === "voice-chunk"
      ? "voice"
      : type === "player-pose" || type === "mob-snapshot" || type === "drop-snapshot" || type === "time-weather"
        ? "movement"
        : "reliable";
    const recipients: PeerRecord[] = [];
    if (this.role === "host") {
      if (peerId) {
        const peer = this.resolvePeer(peerId);
        if (!peer) throw new MultiplayerProtocolError("Unknown multiplayer peer");
        recipients.push(peer);
      } else {
        for (const peer of this.peers.values()) if (peer.state === "connected") recipients.push(peer);
      }
    } else {
      const peer = [...this.peers.values()][0];
      if (!peer) throw new MultiplayerProtocolError("Host peer is unavailable");
      if (peerId && peer.identity?.id !== peerId && peer.token !== peerId) throw new MultiplayerProtocolError("A guest can only send to its host");
      recipients.push(peer);
    }
    if (!recipients.length) return 0;
    const authoritySequenceBefore = this.authorityCommandSequence;
    const envelope = this.makeEnvelope(type, payload, kind) as MultiplayerEnvelope;
    const encoded = encodeEnvelope(envelope, kind === "movement" ? MAX_MOVEMENT_MESSAGE_BYTES : kind === "voice" ? MAX_VOICE_MESSAGE_BYTES : MAX_RELIABLE_MESSAGE_BYTES);
    let sent = 0;
    for (const peer of recipients) {
      const delivered = this.sendEncoded(peer, kind, encoded);
      // Cache a final host decision even if the channel is momentarily under
      // backpressure. The mutation may already be committed; a retry must
      // replay the decision rather than execute it a second time.
      if (kind === "reliable") this.cacheHostResponse(peer, type, payload as MultiplayerPayloadMap[MultiplayerMessageType]);
      if (this.authorityMode === "rust-authoritative" && this.role === "host") this.releaseCompletedAuthorityCommand(peer, payload);
      if (delivered) sent += 1;
    }
    if (sent === 0 && this.authorityMode === "rust-authoritative" && this.role === "guest") {
      this.authorityCommandSequence = authoritySequenceBefore;
    }
    return sent;
  }

  sendSnapshot(payload: WorldSnapshot, peerId?: string) { return this.send("snapshot", payload, peerId); }
  sendPlayerPose(payload: PlayerPose, peerId?: string) { return this.send("player-pose", payload, peerId); }
  sendBlockAction(payload: BlockAction, peerId?: string) { return this.send("block-action", payload, peerId); }
  sendMobSnapshot(payload: MobSnapshot, peerId?: string) { return this.send("mob-snapshot", payload, peerId); }
  sendDropSnapshot(payload: DropSnapshot, peerId?: string) { return this.send("drop-snapshot", payload, peerId); }
  sendTombstones(payload: TombstoneBatch, peerId?: string) { return this.send("tombstones", payload, peerId); }
  sendTimeWeather(payload: TimeWeatherSnapshot, peerId?: string) { return this.send("time-weather", payload, peerId); }
  sendSleepVote(payload: SleepVote, peerId?: string) { return this.send("sleep-vote", payload, peerId); }
  sendInventoryAction(payload: InventoryAction, peerId?: string) { return this.send("inventory-action", payload, peerId); }
  sendContainerAction(payload: ContainerAction, peerId?: string) { return this.send("container-action", payload, peerId); }
  sendFacilityAction(payload: FacilityAction, peerId?: string) { return this.send("facility-action", payload, peerId); }
  sendPlayerState(payload: PlayerStateAction, peerId?: string) { return this.send("player-state", payload, peerId); }
  sendPlayerProgress(payload: PlayerProgressAction, peerId?: string) { return this.send("player-progress", payload, peerId); }
  sendBoatAction(payload: BoatAction, peerId?: string) { return this.send("boat-action", payload, peerId); }
  sendCombatAction(payload: CombatAction, peerId?: string) { return this.send("combat-action", payload, peerId); }
  sendCreatureAction(payload: CreatureAction, peerId?: string) { return this.send("creature-action", payload, peerId); }
  sendTcgAction(payload: TcgNetworkAction, peerId?: string) { return this.send("tcg-action", payload, peerId); }
  sendMapShare(payload: CartographyMapShare, peerId?: string) { return this.send("map-share", payload, peerId); }
  sendAgentCommand(payload: AgentCommandEnvelope, peerId?: string) { return this.send("agent-command", payload, peerId); }
  sendAgentResult(payload: AgentCommandResult, peerId?: string) { return this.send("agent-result", payload, peerId); }
  sendAgentObservation(payload: AgentObservationV1, peerId?: string) { return this.send("agent-observation", payload, peerId); }
  sendAgentCapabilities(payload: AgentCapabilityGrant, peerId?: string) {
    if (this.authorityMode === "legacy-compatibility") return this.send("agent-capabilities", payload, peerId);
    this.ensureOpen();
    if (this.role !== "host") throw new MultiplayerProtocolError("Only a Rust-authoritative host can grant agent capabilities");
    const peer = this.resolvePeer(peerId ?? payload.connectionId);
    if (!peer?.identity || peer.identity.id !== payload.agentId || peer.identity.peerKind !== "agent") {
      throw new MultiplayerProtocolError("Agent capability grant does not match an active agent peer");
    }
    if (!peer.authorityGrant) throw new MultiplayerProtocolError("Agent peer has no Rust authority grant");
    peer.lastAgentGrant = structuredClone(payload);
    const generation = peer.authorityGeneration;
    void this.queuePeerAuthority(peer, async () => {
      await this.authorityDeadline(this.authority().installAgentGrant(payload, peer.authorityGrant!), "agent grant install");
      if (peer.closed || peer.authorityGeneration !== generation || this.disposed) return;
      this.send("agent-capabilities", payload, peer.identity!.id);
    }).catch((error) => this.emitError(error, peer));
    return 1;
  }
  sendChat(payload: AgentChatMessage, peerId?: string) { return this.send("chat", payload, peerId); }
  sendVoiceChunk(payload: AgentVoiceChunk, peerId?: string) { return this.send("voice-chunk", payload, peerId); }

  /**
   * Build one interest-filtered Rust delta and transport it as bounded chunks.
   * The payload remains opaque to TypeScript; guests emit it only after the
   * integrated Rust receiver accepts its sequence, identity and keyframe.
   */
  async sendRustAuthorityDelta(
    value: Omit<RustIntegratedNetworkDeltaBuildRequestV1, "sessionId" | "peerId" | "from" | "interest">,
    peerId: string,
  ) {
    this.ensureOpen();
    if (this.authorityMode !== "rust-authoritative" || this.role !== "host" || !this.sessionId) {
      throw new MultiplayerProtocolError("Rust deltas require an active Rust-authoritative host");
    }
    const peer = this.resolvePeer(peerId);
    if (!peer?.identity || peer.closed || !peer.authorityGrant) throw new MultiplayerProtocolError("Rust delta peer is unavailable");
    const interest = peer.authorityGrant.interest;
    const result = await this.authorityDeadline(this.authority().buildDelta({
      ...value,
      sessionId: this.sessionId,
      peerId: peer.identity.id,
      from: this.authority().currentIdentity(),
      interest,
    }), "delta build");
    if (result.packet.byteLength < 1 || result.packet.byteLength > RUST_AUTHORITY_MAX_DELTA_BYTES) {
      throw new MultiplayerProtocolError("Rust authority delta exceeds the transport budget");
    }
    const transferId = this.checkedId("rust-delta");
    const packetHash = new TypeScriptCanonicalHasher("blockwild-multiplayer-delta-frame-v1").writeBytes(result.packet).finishHex();
    const chunkCount = Math.ceil(result.packet.byteLength / RUST_AUTHORITY_DELTA_CHUNK_BYTES);
    let sentChunks = 0;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const start = chunkIndex * RUST_AUTHORITY_DELTA_CHUNK_BYTES;
      const payload: RustAuthorityDeltaChunk = Object.freeze({
        schema: RUST_AUTHORITY_DELTA_SCHEMA,
        transferId,
        keyframe: value.keyframe,
        packetBytes: result.packet.byteLength,
        packetHash,
        chunkIndex,
        chunkCount,
        data: bytesToBase64Url(result.packet.subarray(start, start + RUST_AUTHORITY_DELTA_CHUNK_BYTES)),
        interest,
      });
      if (this.send("rust-authority-delta", payload, peer.identity.id) === 1) sentChunks += 1;
    }
    if (sentChunks !== chunkCount) throw new MultiplayerProtocolError(`Rust delta transport accepted ${sentChunks}/${chunkCount} chunks`);
    return Object.freeze({
      transferId,
      packetBytes: result.packet.byteLength,
      chunkCount,
      scopeProbes: result.scopeProbes,
      candidateRecords: result.candidateRecords,
      emittedRecords: result.emittedRecords,
    });
  }

  async refreshRustPeerGrant(peerId: string) {
    this.ensureOpen();
    if (this.authorityMode !== "rust-authoritative") throw new MultiplayerProtocolError("Legacy compatibility has no Rust peer grant");
    const peer = this.resolvePeer(peerId);
    if (!peer?.identity || peer.closed) throw new MultiplayerProtocolError("Rust authority peer is unavailable");
    const grant = this.authorityPeer(peer);
    peer.authorityGrant = grant;
    await this.queuePeerAuthority(peer, async () => {
      await this.authorityDeadline(this.authority().installPeer(grant), "peer grant refresh");
    });
  }

  private acceptRustDeltaChunk(peer: PeerRecord, envelope: MultiplayerEnvelope<"rust-authority-delta">) {
    const payload = envelope.payload;
    const key = `${peer.token}|${payload.transferId}`;
    let frame = this.rustDeltaReassemblies.get(key);
    if (!frame) {
      const activeForPeer = [...this.rustDeltaReassemblies.keys()].filter((candidate) => candidate.startsWith(`${peer.token}|`)).length;
      if (activeForPeer >= RUST_AUTHORITY_MAX_REASSEMBLIES_PER_PEER) {
        this.protocolStrike(peer, "Too many concurrent Rust delta reassemblies");
        return;
      }
      frame = {
        transferId: payload.transferId,
        keyframe: payload.keyframe,
        packetBytes: payload.packetBytes,
        packetHash: payload.packetHash,
        chunkCount: payload.chunkCount,
        interest: payload.interest,
        chunks: Array.from({ length: payload.chunkCount }, () => null),
        receivedBytes: 0,
        expiresAt: this.now() + RUST_AUTHORITY_REASSEMBLY_TIMEOUT_MS,
      };
      this.rustDeltaReassemblies.set(key, frame);
    } else if (frame.keyframe !== payload.keyframe || frame.packetBytes !== payload.packetBytes
      || frame.packetHash !== payload.packetHash || frame.chunkCount !== payload.chunkCount
      || frame.interest.interestHash !== payload.interest.interestHash) {
      this.rustDeltaReassemblies.delete(key);
      this.protocolStrike(peer, "Conflicting Rust delta transfer metadata");
      return;
    }
    let chunk: Uint8Array;
    try { chunk = base64UrlToBytes(payload.data); }
    catch (error) { this.protocolStrike(peer, error instanceof Error ? error.message : "Invalid Rust delta chunk"); return; }
    if (chunk.byteLength < 1 || chunk.byteLength > RUST_AUTHORITY_DELTA_CHUNK_BYTES) {
      this.protocolStrike(peer, "Rust delta chunk exceeds its decoded budget");
      return;
    }
    const existing = frame.chunks[payload.chunkIndex];
    if (existing) {
      const identical = existing.byteLength === chunk.byteLength && existing.every((value, index) => value === chunk[index]);
      if (!identical) this.protocolStrike(peer, "Conflicting duplicate Rust delta chunk");
      return;
    }
    frame.chunks[payload.chunkIndex] = chunk;
    frame.receivedBytes += chunk.byteLength;
    if (frame.receivedBytes > frame.packetBytes) {
      this.rustDeltaReassemblies.delete(key);
      this.protocolStrike(peer, "Rust delta chunks exceed the declared packet size");
      return;
    }
    if (frame.chunks.some((candidate) => candidate === null)) return;
    this.rustDeltaReassemblies.delete(key);
    if (frame.receivedBytes !== frame.packetBytes) { this.protocolStrike(peer, "Rust delta packet size mismatch"); return; }
    const packet = new Uint8Array(frame.packetBytes);
    let offset = 0;
    for (const candidate of frame.chunks) { packet.set(candidate!, offset); offset += candidate!.byteLength; }
    const packetHash = new TypeScriptCanonicalHasher("blockwild-multiplayer-delta-frame-v1").writeBytes(packet).finishHex();
    if (packetHash !== frame.packetHash) { this.protocolStrike(peer, "Rust delta packet hash mismatch"); return; }
    const generation = peer.authorityGeneration;
    void this.queuePeerAuthority(peer, async () => {
      const result = await this.authorityDeadline(this.authority().acceptDelta({
        sessionId: this.sessionId!,
        peerId: this.identity.id,
        connectionGeneration: generation,
        keyframe: frame!.keyframe,
        interest: frame!.interest,
        remoteIdentity: envelope.authority!,
        packet,
      }), "delta validation");
      if (peer.closed || peer.authorityGeneration !== generation || this.disposed) return;
      if (result.code === "applied") {
        this.emit({ type: "authority-delta", peer: this.peerInfo(peer), keyframe: frame!.keyframe, sequence: result.sequence, stateHash: result.stateHash, packet });
      } else if (result.code !== "duplicate") {
        this.emit({ type: "authority-resync", peer: this.peerInfo(peer), code: result.code });
      }
    }).catch((error) => {
      this.emitError(error, peer);
      if (!peer.closed) this.closePeer(peer, "rust-delta-validation-failed", "failed");
    });
  }

  private protocolStrike(peer: PeerRecord, message: string) {
    if (peer.closed) return;
    peer.protocolStrikes += 1;
    this.emitError(new MultiplayerProtocolError(message), peer);
    if (peer.protocolStrikes >= MAX_PROTOCOL_STRIKES) this.closePeer(peer, "protocol-violation", "failed");
  }

  private incomingTypeAllowed(type: MultiplayerMessageType) {
    if (CONTROL_TYPES.has(type)) return true;
    return this.role === "host" ? GUEST_OUTBOUND_TYPES.has(type) : true;
  }

  private acceptTransportSequence(peer: PeerRecord, kind: MultiplayerChannelKind, sequence: number) {
    const lastSequence = kind === "reliable" ? peer.lastReliableSequence : kind === "movement" ? peer.lastMovementSequence : peer.lastVoiceSequence;
    if (sequence <= lastSequence) return false;
    if (kind === "reliable") peer.lastReliableSequence = sequence;
    else if (kind === "movement") peer.lastMovementSequence = sequence;
    else peer.lastVoiceSequence = sequence;
    return true;
  }

  private envelopeActorId(peer: PeerRecord, envelope: MultiplayerEnvelope) {
    if (!isRecord(envelope.payload)) return peer.identity?.id ?? envelope.from;
    const payload = envelope.payload as Record<string, unknown>;
    for (const key of ["actorId", "playerId", "agentId", "authorId"] as const) {
      const value = payload[key];
      if (typeof value === "string") return value;
    }
    return peer.identity?.id ?? envelope.from;
  }

  private validateActorOwnership(peer: PeerRecord, envelope: MultiplayerEnvelope) {
    if (this.role !== "host" || !peer.identity) return true;
    if (peer.identity.peerKind === "agent" && !["hello", "heartbeat", "goodbye", "agent-command", "chat", "voice-chunk"].includes(envelope.type)) return false;
    const payload = envelope.payload as unknown;
    if (!isRecord(payload)) return false;
    if (envelope.type === "player-pose") return payload.playerId === peer.identity.id;
    if (envelope.type === "block-action" || envelope.type === "inventory-action" || envelope.type === "container-action" || envelope.type === "facility-action" || envelope.type === "player-state" || envelope.type === "player-progress" || envelope.type === "boat-action" || envelope.type === "combat-action" || envelope.type === "creature-action" || envelope.type === "tcg-action") {
      return payload.actorId === peer.identity.id && (payload.status === undefined || payload.status === "request");
    }
    if (envelope.type === "sleep-vote") return payload.actorId === peer.identity.id;
    if (envelope.type === "agent-command") return peer.identity.peerKind === "agent" && payload.agentId === peer.identity.id;
    if (envelope.type === "chat") return payload.authorId === peer.identity.id && payload.peerKind === (peer.identity.peerKind ?? "human");
    if (envelope.type === "voice-chunk") return peer.identity.peerKind === "agent" && payload.agentId === peer.identity.id;
    return true;
  }

  private authorizeRustInbound(peer: PeerRecord, kind: MultiplayerChannelKind, envelope: MultiplayerEnvelope, encodedEnvelope: string) {
    if (!peer.identity || !envelope.authority || !this.sessionId) return;
    const generation = peer.authorityGeneration;
    void this.queuePeerAuthority(peer, async () => {
      const authorization = this.authority().authorizeInbound({
        sessionId: this.sessionId!,
        peerId: peer.identity!.id,
        connectionId: peer.token,
        actorId: this.envelopeActorId(peer, envelope),
        peerKind: peer.identity!.peerKind ?? "human",
        messageType: envelope.type,
        sequence: envelope.authoritySequence!,
        sentAt: envelope.sentAt,
        expected: envelope.authority!,
        encodedEnvelope,
        payload: envelope.payload,
      });
      let settledOnTime = false;
      try {
        const decision = await this.authorityDeadline(authorization, `${envelope.type} authorization`);
        settledOnTime = true;
        if (!decision.accepted) {
          if (!peer.closed && peer.authorityGeneration === generation) {
            this.emit({ type: "authority-rejection", peer: this.peerInfo(peer), commandId: decision.commandId, code: decision.code });
          }
          return;
        }
        if (!decision.receiptHash) throw new MultiplayerProtocolError("Rust accepted a command without a canonical receipt hash");
        if (peer.closed || peer.authorityGeneration !== generation || this.disposed) {
          await this.authority().releaseCommand(decision.commandId);
          return;
        }
        if (peer.deliveredAuthorityReceipts.has(decision.receiptHash)) return;
        peer.deliveredAuthorityReceipts.add(decision.receiptHash);
        while (peer.deliveredAuthorityReceipts.size > 4_096) {
          const oldest = peer.deliveredAuthorityReceipts.values().next().value as string | undefined;
          if (!oldest) break;
          peer.deliveredAuthorityReceipts.delete(oldest);
        }
        if (!IMMEDIATE_AUTHORITY_RELEASE_TYPES.has(envelope.type)) peer.acceptedAuthorityCommands.add(decision.commandId);
        peer.lastSeenAt = this.now();
        peer.protocolStrikes = Math.max(0, peer.protocolStrikes - 1);
        this.emit({ type: "message", peer: this.peerInfo(peer), channel: kind, envelope });
        if (IMMEDIATE_AUTHORITY_RELEASE_TYPES.has(envelope.type)) await this.authority().releaseCommand(decision.commandId);
      } catch (error) {
        if (!settledOnTime) {
          void authorization.then((late) => late.accepted ? this.authority().releaseCommand(late.commandId) : undefined).catch(() => undefined);
        }
        this.emitError(error, peer);
        if (!peer.closed) this.closePeer(peer, "rust-authority-unavailable", "failed");
      }
    }).catch(() => undefined);
  }

  private handleChannelMessage(peer: PeerRecord, kind: MultiplayerChannelKind, data: unknown) {
    if (peer.closed) return;
    let envelope: MultiplayerEnvelope;
    let encodedEnvelope: string;
    try {
      const maxBytes = kind === "movement" ? MAX_MOVEMENT_MESSAGE_BYTES : kind === "voice" ? MAX_VOICE_MESSAGE_BYTES : MAX_RELIABLE_MESSAGE_BYTES;
      encodedEnvelope = decodeText(data, maxBytes);
      envelope = decodeEnvelope(encodedEnvelope, maxBytes);
    } catch (error) {
      this.protocolStrike(peer, error instanceof Error ? error.message : "Invalid multiplayer message");
      return;
    }
    const expectedKind: MultiplayerChannelKind = this.authorityMode === "rust-authoritative" && this.role === "host" && !CONTROL_TYPES.has(envelope.type)
      ? "reliable"
      : envelope.type === "voice-chunk"
      ? "voice"
      : envelope.type === "player-pose" || envelope.type === "mob-snapshot" || envelope.type === "drop-snapshot" || envelope.type === "time-weather"
        ? "movement"
        : "reliable";
    if (expectedKind !== kind) { this.protocolStrike(peer, `${envelope.type} arrived on the wrong channel`); return; }
    if (envelope.sessionId !== this.sessionId || envelope.from !== peer.identity?.id) {
      this.protocolStrike(peer, "Message identity or session mismatch");
      return;
    }
    if (this.authorityMode === "rust-authoritative") {
      if (!envelope.authority) { this.protocolStrike(peer, "Rust-authoritative envelope omitted its authority identity"); return; }
      if (this.role === "host" && !CONTROL_TYPES.has(envelope.type)
        && !isInteger(envelope.authoritySequence, 0, Number.MAX_SAFE_INTEGER)) {
        this.protocolStrike(peer, "Rust-authoritative guest command omitted its dense authority sequence");
        return;
      }
      if (this.role === "host" && !GUEST_OUTBOUND_TYPES.has(envelope.type)) {
        this.protocolStrike(peer, `Guest transport is not allowed to carry ${envelope.type}`);
        return;
      }
      if (this.role === "guest" && !CONTROL_TYPES.has(envelope.type) && !RUST_GUEST_PRESENTATION_TYPES.has(envelope.type)) {
        this.protocolStrike(peer, `Legacy authoritative ${envelope.type} is disabled after Rust promotion`);
        return;
      }
    } else {
      if (!this.incomingTypeAllowed(envelope.type)) {
        this.protocolStrike(peer, `Remote role is not allowed to send ${envelope.type}`);
        return;
      }
      if (!this.validateActorOwnership(peer, envelope)) {
        this.protocolStrike(peer, "Guest action attempted to impersonate another player");
        return;
      }
    }
    if ((CONTROL_TYPES.has(envelope.type) || this.role === "guest" || this.authorityMode === "legacy-compatibility")
      && !this.acceptTransportSequence(peer, kind, envelope.sequence)) return;
    peer.lastSeenAt = this.now();
    peer.protocolStrikes = Math.max(0, peer.protocolStrikes - 1);

    if (envelope.type === "hello") {
      const hello = envelope.payload as MultiplayerPayloadMap["hello"];
      const expectedRole: MultiplayerRole = this.role === "host" ? "guest" : "host";
      if (hello.role !== expectedRole || JSON.stringify(copyIdentity(hello.identity)) !== JSON.stringify(copyIdentity(peer.identity))) {
        this.protocolStrike(peer, "Peer hello does not match the manual invite identity");
        return;
      }
      this.emitPeer(peer, "hello-verified");
      return;
    }
    if (envelope.type === "heartbeat") {
      const heartbeat = envelope.payload as MultiplayerPayloadMap["heartbeat"];
      if (heartbeat.reply) {
        if (peer.pendingHeartbeatNonce === heartbeat.nonce) {
          peer.latencyMs = Math.max(0, this.now() - peer.pendingHeartbeatAt);
          peer.pendingHeartbeatNonce = null;
          this.emitPeer(peer, "heartbeat");
        }
      } else {
        this.sendControl(peer, "heartbeat", { nonce: heartbeat.nonce, reply: true });
      }
      return;
    }
    if (envelope.type === "goodbye") {
      this.closePeer(peer, (envelope.payload as MultiplayerPayloadMap["goodbye"]).reason || "remote-disconnect", "disconnected");
      return;
    }
    if (this.authorityMode === "rust-authoritative") {
      if (this.role === "host") {
        this.authorizeRustInbound(peer, kind, envelope, encodedEnvelope);
        return;
      }
      if (envelope.type === "rust-authority-delta") {
        this.acceptRustDeltaChunk(peer, envelope as MultiplayerEnvelope<"rust-authority-delta">);
        return;
      }
      this.emit({ type: "message", peer: this.peerInfo(peer), channel: kind, envelope });
      return;
    }
    if (this.role === "host" && isRecord(envelope.payload) && "requestId" in envelope.payload
      && typeof envelope.payload.requestId === "string"
      && (!("status" in envelope.payload) || envelope.payload.status === undefined || envelope.payload.status === "request")
      && this.replayCachedResponse(peer, envelope.payload.requestId)) return;
    this.emit({ type: "message", peer: this.peerInfo(peer), channel: kind, envelope });
  }

  startMaintenance() {
    this.ensureOpen();
    if (this.maintenanceTimer !== null) return;
    const interval = Math.max(250, Math.min(this.heartbeatIntervalMs, Math.floor(this.peerTimeoutMs / 3)));
    this.maintenanceTimer = setInterval(() => this.maintenanceTick(), interval);
  }

  stopMaintenance() {
    if (this.maintenanceTimer === null) return;
    clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
  }

  maintenanceTick(at = this.now()) {
    if (this.disposed) return;
    this.pruneResponseCache(at);
    for (const [key, frame] of this.rustDeltaReassemblies) {
      if (frame.expiresAt <= at) this.rustDeltaReassemblies.delete(key);
    }
    for (const peer of [...this.peers.values()]) {
      if (peer.closed) continue;
      if (peer.state !== "connected") {
        if (at - peer.createdAt > this.connectionTimeoutMs) this.closePeer(peer, "connection-timeout", "failed");
        continue;
      }
      if (at - peer.lastSeenAt > this.peerTimeoutMs) {
        this.closePeer(peer, "heartbeat-timeout", "failed");
        continue;
      }
      if (!peer.pendingHeartbeatNonce && at - peer.lastSeenAt >= this.heartbeatIntervalMs) {
        const nonce = this.checkedId("ping");
        peer.pendingHeartbeatNonce = nonce;
        peer.pendingHeartbeatAt = at;
        if (!this.sendControl(peer, "heartbeat", { nonce, reply: false })) peer.pendingHeartbeatNonce = null;
      }
    }
  }

  disconnectPeer(peerIdOrToken: string, reason = "host-disconnect") {
    this.ensureOpen();
    const peer = this.resolvePeer(peerIdOrToken);
    if (!peer) return false;
    this.sendControl(peer, "goodbye", { reason: isShortString(reason, 160, true) ? reason : "disconnect" });
    this.closePeer(peer, reason, "disconnected");
    return true;
  }

  disconnect(reason = "local-disconnect") {
    if (this.disposed) return;
    for (const peer of [...this.peers.values()]) {
      this.sendControl(peer, "goodbye", { reason: isShortString(reason, 160, true) ? reason : "disconnect" });
      this.closePeer(peer, reason, "disconnected");
    }
    if (this.role === "guest") this.setState("disconnected");
    else if (this.role === "host") this.setState("hosting");
  }

  private closePeer(peer: PeerRecord, reason: string, state: MultiplayerPeerState) {
    if (peer.closed) return;
    peer.closed = true;
    peer.state = state;
    if (peer.reliable) peer.reliable.onopen = peer.reliable.onclose = peer.reliable.onerror = peer.reliable.onmessage = null;
    if (peer.movement) peer.movement.onopen = peer.movement.onclose = peer.movement.onerror = peer.movement.onmessage = null;
    if (peer.voice) peer.voice.onopen = peer.voice.onclose = peer.voice.onerror = peer.voice.onmessage = null;
    peer.connection.onconnectionstatechange = null;
    peer.connection.ondatachannel = null;
    peer.connection.onicegatheringstatechange = null;
    try { peer.reliable?.close(); } catch { /* Already closed. */ }
    try { peer.movement?.close(); } catch { /* Already closed. */ }
    try { peer.voice?.close(); } catch { /* Already closed. */ }
    try { peer.connection.close(); } catch { /* Already closed. */ }
    this.peers.delete(peer.token);
    this.nextReliableArtificialSendAt.delete(peer.token);
    this.nextVoiceArtificialSendAt.delete(peer.token);
    for (const key of [...this.rustDeltaReassemblies.keys()]) {
      if (key.startsWith(`${peer.token}|`)) this.rustDeltaReassemblies.delete(key);
    }
    if (this.authorityMode === "rust-authoritative" && peer.identity && peer.authorityGrant) {
      const peerId = peer.identity.id;
      const accepted = [...peer.acceptedAuthorityCommands];
      peer.acceptedAuthorityCommands.clear();
      const disconnectedGrant = peer.lastAgentGrant
        ? Object.freeze({ ...peer.lastAgentGrant, status: "disconnected" as const, updatedAt: this.now() })
        : null;
      void this.queuePeerAuthority(peer, async () => {
        if (disconnectedGrant) await this.authorityDeadline(this.authority().installAgentGrant(disconnectedGrant, peer.authorityGrant!), "agent disconnect grant");
        for (const commandId of accepted) await this.authorityDeadline(this.authority().releaseCommand(commandId), "command lease release");
        await this.authorityDeadline(this.authority().releasePeer(peerId), "peer release");
      }).catch((error) => this.emitError(error, peer));
    }
    this.emitPeer(peer, reason);
    this.recalculateSessionState();
  }

  dispose(reason = "session-disposed") {
    if (this.disposed) return;
    this.stopMaintenance();
    this.disposed = true;
    this.guestBootstrapGeneration += 1;
    this.guestBootstrapController?.abort();
    for (const peer of [...this.peers.values()]) {
      this.sendControl(peer, "goodbye", { reason: isShortString(reason, 160, true) ? reason : "session-disposed" });
      this.closePeer(peer, reason, "closed");
    }
    this.setState("closed");
    for (const timer of this.artificialSendTimers) clearTimeout(timer);
    this.artificialSendTimers.clear();
    this.nextReliableArtificialSendAt.clear();
    this.nextVoiceArtificialSendAt.clear();
    this.rustDeltaReassemblies.clear();
    if (this.ownedGuestRuntimeShutdown) {
      void this.releaseOwnedGuestRuntime().catch(() => undefined);
    }
    this.listeners.clear();
  }
}
