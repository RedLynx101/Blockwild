//! Exact native codecs carried by the integrated BWRQ/BWRS domain envelope.
//!
//! These are deliberately boring, bounded little-endian codecs.  They are the
//! canonical source for native and Wasm execution; TypeScript implements the
//! same byte layout and is locked to the fixtures in this module.

use std::collections::{BTreeMap, BTreeSet};

use crate::runtime_domain_schema_generated::{
    BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_INNER_SCHEMA, BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_MAGIC,
    BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_TYPE_ID, BASIC_DIRT_ACTION_RECEIPT_V1_INNER_SCHEMA,
    BASIC_DIRT_ACTION_RECEIPT_V1_MAGIC, BASIC_DIRT_ACTION_RECEIPT_V1_TYPE_ID, CONTENT_INSTALL_PAGE_V1_INNER_SCHEMA,
    CONTENT_INSTALL_PAGE_V1_MAGIC, CONTENT_INSTALL_PAGE_V1_TYPE_ID, CONTENT_INSTALL_RECEIPT_V1_INNER_SCHEMA,
    CONTENT_INSTALL_RECEIPT_V1_MAGIC, CONTENT_INSTALL_RECEIPT_V1_TYPE_ID,
    CONTEXT_COMMAND_CONTINUITY_RECEIPT_V2_INNER_SCHEMA, CONTEXT_COMMAND_CONTINUITY_RECEIPT_V2_MAGIC,
    CONTEXT_COMMAND_CONTINUITY_RECEIPT_V2_TYPE_ID, CONTEXT_COMMAND_CONTINUITY_V2_INNER_SCHEMA,
    CONTEXT_COMMAND_CONTINUITY_V2_MAGIC, CONTEXT_COMMAND_CONTINUITY_V2_TYPE_ID,
    ENTITY_AUTHORITY_EXPORT_V1_INNER_SCHEMA, ENTITY_AUTHORITY_EXPORT_V1_MAGIC, ENTITY_AUTHORITY_EXPORT_V1_TYPE_ID,
    ENTITY_AUTHORITY_IMPORT_RECEIPT_V1_INNER_SCHEMA, ENTITY_AUTHORITY_IMPORT_RECEIPT_V1_MAGIC,
    ENTITY_AUTHORITY_IMPORT_RECEIPT_V1_TYPE_ID, ENTITY_AUTHORITY_IMPORT_V2_INNER_SCHEMA,
    ENTITY_AUTHORITY_IMPORT_V2_MAGIC, ENTITY_AUTHORITY_IMPORT_V2_TYPE_ID, ENTITY_AUTHORITY_SNAPSHOT_V2_TYPE_ID,
    ENTITY_COMMAND_V1_INNER_SCHEMA, ENTITY_COMMAND_V1_MAGIC, ENTITY_COMPATIBILITY_EXPORT_V1_INNER_SCHEMA,
    ENTITY_COMPATIBILITY_EXPORT_V1_MAGIC, ENTITY_COMPATIBILITY_EXPORT_V1_TYPE_ID,
    ENTITY_COMPATIBILITY_IMPORT_V1_INNER_SCHEMA, ENTITY_COMPATIBILITY_IMPORT_V1_MAGIC,
    ENTITY_COMPATIBILITY_IMPORT_V1_TYPE_ID, ENTITY_COMPATIBILITY_RECORD_V1_TYPE_ID, ENTITY_RECEIPT_V1_INNER_SCHEMA,
    ENTITY_RECEIPT_V1_MAGIC, GAMEPLAY_ACTOR_GRANT_V1_INNER_SCHEMA, GAMEPLAY_ACTOR_GRANT_V1_MAGIC,
    GAMEPLAY_COMMAND_V1_INNER_SCHEMA, GAMEPLAY_COMMAND_V1_MAGIC, GAMEPLAY_RECEIPT_V1_INNER_SCHEMA,
    GAMEPLAY_RECEIPT_V1_MAGIC, INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1,
    NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V1_INNER_SCHEMA, NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V1_MAGIC,
    NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V1_TYPE_ID, NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V2_INNER_SCHEMA,
    NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V2_MAGIC, NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V2_TYPE_ID,
    NATIVE_BLOCK_EDIT_RECEIPT_V1_INNER_SCHEMA, NATIVE_BLOCK_EDIT_RECEIPT_V1_MAGIC,
    NATIVE_BLOCK_EDIT_RECEIPT_V1_TYPE_ID, NATIVE_BLOCK_EDIT_RECEIPT_V2_INNER_SCHEMA,
    NATIVE_BLOCK_EDIT_RECEIPT_V2_MAGIC, NATIVE_BLOCK_EDIT_RECEIPT_V2_TYPE_ID,
    NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_V1_INNER_SCHEMA, NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_V1_MAGIC,
    NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_V1_TYPE_ID, NATIVE_DROP_PICKUP_RECEIPT_V1_INNER_SCHEMA,
    NATIVE_DROP_PICKUP_RECEIPT_V1_MAGIC, NATIVE_DROP_PICKUP_RECEIPT_V1_TYPE_ID,
    NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_V1_INNER_SCHEMA, NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_V1_MAGIC,
    NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_V1_TYPE_ID, NATIVE_PLAYER_DROP_RECEIPT_V1_INNER_SCHEMA,
    NATIVE_PLAYER_DROP_RECEIPT_V1_MAGIC, NATIVE_PLAYER_DROP_RECEIPT_V1_TYPE_ID, NETWORK_AGENT_GRANT_V1_INNER_SCHEMA,
    NETWORK_AGENT_GRANT_V1_MAGIC, NETWORK_COMMAND_RELEASE_V1_INNER_SCHEMA, NETWORK_COMMAND_RELEASE_V1_MAGIC,
    NETWORK_DELTA_BUILD_V1_INNER_SCHEMA, NETWORK_DELTA_BUILD_V1_MAGIC, NETWORK_PEER_GRANT_V1_INNER_SCHEMA,
    NETWORK_PEER_GRANT_V1_MAGIC, NETWORK_PEER_RELEASE_V1_INNER_SCHEMA, NETWORK_PEER_RELEASE_V1_MAGIC,
    NETWORK_RECONNECT_V1_INNER_SCHEMA, NETWORK_RECONNECT_V1_MAGIC, NETWORK_REPLICATION_UPSERT_V1_INNER_SCHEMA,
    NETWORK_REPLICATION_UPSERT_V1_MAGIC, PERSISTENCE_DISPATCH_RECEIPT_V1_INNER_SCHEMA,
    PERSISTENCE_DISPATCH_RECEIPT_V1_MAGIC, PERSISTENCE_DISPATCH_V1_INNER_SCHEMA, PERSISTENCE_DISPATCH_V1_MAGIC,
    PLAYER_BOOTSTRAP_STATUS_RECEIPT_V1_INNER_SCHEMA, PLAYER_BOOTSTRAP_STATUS_RECEIPT_V1_MAGIC,
    PLAYER_BOOTSTRAP_STATUS_RECEIPT_V1_TYPE_ID, PLAYER_BOOTSTRAP_STATUS_V1_INNER_SCHEMA,
    PLAYER_BOOTSTRAP_STATUS_V1_MAGIC, PLAYER_BOOTSTRAP_STATUS_V1_TYPE_ID,
    PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_V1_INNER_SCHEMA, PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_V1_MAGIC,
    PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_V1_TYPE_ID, PLAYER_COMBAT_BOOTSTRAP_STATUS_V1_INNER_SCHEMA,
    PLAYER_COMBAT_BOOTSTRAP_STATUS_V1_MAGIC, PLAYER_COMBAT_BOOTSTRAP_STATUS_V1_TYPE_ID,
    PLAYER_CREATIVE_SLOT_SET_RECEIPT_V1_INNER_SCHEMA, PLAYER_CREATIVE_SLOT_SET_RECEIPT_V1_MAGIC,
    PLAYER_CREATIVE_SLOT_SET_RECEIPT_V1_TYPE_ID, PLAYER_CREATIVE_SLOT_SET_V1_INNER_SCHEMA,
    PLAYER_CREATIVE_SLOT_SET_V1_MAGIC, PLAYER_CREATIVE_SLOT_SET_V1_TYPE_ID,
    PLAYER_GAME_MODE_SET_RECEIPT_V1_INNER_SCHEMA, PLAYER_GAME_MODE_SET_RECEIPT_V1_MAGIC,
    PLAYER_GAME_MODE_SET_RECEIPT_V1_TYPE_ID, PLAYER_GAME_MODE_SET_V1_INNER_SCHEMA, PLAYER_GAME_MODE_SET_V1_MAGIC,
    PLAYER_GAME_MODE_SET_V1_TYPE_ID, PLAYER_INVENTORY_IMPORT_RECEIPT_V1_INNER_SCHEMA,
    PLAYER_INVENTORY_IMPORT_RECEIPT_V1_MAGIC, PLAYER_INVENTORY_IMPORT_RECEIPT_V1_TYPE_ID,
    PLAYER_INVENTORY_IMPORT_V1_INNER_SCHEMA, PLAYER_INVENTORY_IMPORT_V1_MAGIC, PLAYER_INVENTORY_IMPORT_V1_TYPE_ID,
    PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_V1_INNER_SCHEMA, PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_V1_MAGIC,
    PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_V1_TYPE_ID, PLAYER_LOCATOR_ITEM_CONSUME_V1_INNER_SCHEMA,
    PLAYER_LOCATOR_ITEM_CONSUME_V1_MAGIC, PLAYER_LOCATOR_ITEM_CONSUME_V1_TYPE_ID,
    PLAYER_RESPAWN_RECEIPT_V1_INNER_SCHEMA, PLAYER_RESPAWN_RECEIPT_V1_MAGIC, PLAYER_RESPAWN_RECEIPT_V1_TYPE_ID,
    PLAYER_RESPAWN_V1_INNER_SCHEMA, PLAYER_RESPAWN_V1_MAGIC, PLAYER_RESPAWN_V1_TYPE_ID,
    SIMULATION_CAMERA_CONFIG_RECEIPT_V1_INNER_SCHEMA, SIMULATION_CAMERA_CONFIG_RECEIPT_V1_MAGIC,
    SIMULATION_CAMERA_CONFIG_RECEIPT_V1_TYPE_ID, SIMULATION_CAMERA_CONFIG_V1_INNER_SCHEMA,
    SIMULATION_CAMERA_CONFIG_V1_MAGIC, SIMULATION_CAMERA_CONFIG_V1_TYPE_ID,
    SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V3_TYPE_ID, SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V4_TYPE_ID,
    SIMULATION_PLAYER_BIND_RECEIPT_V2_INNER_SCHEMA, SIMULATION_PLAYER_BIND_RECEIPT_V2_MAGIC,
    SIMULATION_PLAYER_BIND_V2_INNER_SCHEMA, SIMULATION_PLAYER_BIND_V2_MAGIC, SIMULATION_PLAYER_BIND_V3_INNER_SCHEMA,
    SIMULATION_PLAYER_BIND_V3_MAGIC, SIMULATION_PLAYER_BIND_V3_TYPE_ID, SIMULATION_PLAYER_BIND_V4_INNER_SCHEMA,
    SIMULATION_PLAYER_BIND_V4_MAGIC, SIMULATION_PLAYER_BIND_V4_TYPE_ID,
};

use blockwild_authority::{
    DirtySubsystemSeedV1, WorldAddressV1 as AuthorityWorldAddressV1, WorldAuthorityRevisionV1, WorldSectionAddressV1,
};
use blockwild_entity::{
    DespawnReason, DormantEntitySummary, EntityAuthority, EntityClass, EntityCommand, EntityCommandBatch,
    EntityCompatibilityRecord, EntityComponents, EntityEventBatch, EntityEventKind, EntityResidency, ProtectionState,
    SimulationTier, Vec3 as EntityVec3, decode_compatibility_record, decode_entity_authority_snapshot,
    encode_compatibility_record, encode_entity_authority_snapshot,
};
use blockwild_gameplay::{
    ALL_CONTENT_DOMAINS, AcceptedReceipt, ActivityLease, ActorGrant, ApplyBlockActionV1, AuthorityIdentity,
    BattleAction, BlockActionLootCellV1, CardforgeCommand, CombatCommand, CombatVitalUnits, ConsumeInventoryUnitV1,
    ContentDomainDigest, CraftCommand, CreateDropCustodyCommand, CreateGeneratedDropCustodyV1,
    CreatePlayerCustodyCommand, Domain, ExpectedStack, FixedVec3, FixedWorldVec3V1, FurnaceAdvanceCommand,
    GAMEPLAY_COMMAND_ADVANCE_SCHEDULE_TAG_V1, GameplayEvent, GameplayReceipt, GameplayRevision,
    GameplayScheduleAdvanceV1, GeneratedDropProvenanceV1, INVENTORY_COMMAND_APPLY_BLOCK_ACTION_V1_TAG,
    INVENTORY_COMMAND_CONSUME_UNIT_V1_TAG, INVENTORY_COMMAND_CREATE_GENERATED_DROP_CUSTODY_V1_TAG,
    INVENTORY_COMMAND_IMPORT_PLAYER_V1_TAG, INVENTORY_COMMAND_SET_CREATIVE_SLOT_V1_TAG, Ingredient,
    ItemInstanceMetadataV1, MAX_ITEM_INSTANCE_METADATA_BYTES_V1, MAX_ITEM_INSTANCE_METADATA_EXTENSION_BYTES_V1,
    MachineCommand, MachineOperation, OpaquePayload, PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1, PacifyMethod,
    PlayerInventoryBindingV1, PrintingKey, ProgressionAction, ProgressionCommand, Rejection, RejectionCode,
    RemoveEmptyDropCustodyCommand, ResourceDelta, ResourceEndpoint, ResourceKey, ResourceKind, RotationMicroturnsV1,
    Scope, StatDelta, WorldKey, WorldViewRevisionV1,
};
pub use blockwild_gameplay::{
    ActorRole, ContainerKey, ContainerKind, ContentArtifact, ContentDomain, GameplayActor, GameplayBatch,
    GameplayCommand, ImportPlayerInventoryV1, InventoryCommand, ItemStack, PlayerDeathCustodyLaneV1, SlotRef,
    TransferCommand, compile_content_bundle,
};
use blockwild_network::{
    AgentCapabilityGrantV1, AgentCapabilityV1, AgentLifecycleStatusV1, InterestDeltaBuildSourceV1,
    NetworkAuthorityIdentityV1, NetworkAuthorityRevisionV1, NetworkCapabilityV1, NetworkDeltaRecordKindV1,
    NetworkDeltaRecordV1, NetworkInterestChunkV1, NetworkInterestSetV1, NetworkPeerGrantV1, NetworkPeerKindV1,
    NetworkPeerRoleV1, ReplicationScopeV1, ScopedDeltaRecordV1, WorldAddressV1 as NetworkWorldAddressV1,
};
use blockwild_runtime_wire::{
    MAX_DOMAIN_PAYLOAD_BYTES, MAX_SAFE_U64, RUNTIME_INPUT_FLAG_CREATIVE_V1, RUNTIME_INPUT_FLAG_FLYING_V1,
    RUNTIME_INPUT_FLAG_MASK_V1, RUNTIME_INPUT_FLAG_MOUNTED_V1, RuntimeInputFrameV1, WireError, wire_checksum_v1,
};
use blockwild_simulation::{
    CameraModeV1, CameraPoseInputV1, CameraProfileV1, Vec3 as SimulationVec3, derive_camera_pose_v1,
};
use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId, LocationId, PlayerId};

use crate::{
    INTEGRATED_RUNTIME_MAX_TERRAIN_RECONCILE_EVICTED_CHUNKS_V2, INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
    IntegratedRuntimeBasicDirtActionContentBindingV1, IntegratedRuntimeBasicDirtActionKindV1,
    IntegratedRuntimeBasicDirtActionReceiptV1, IntegratedRuntimeIdentityV2,
    IntegratedRuntimeNativeBlockEditActionKindV1, IntegratedRuntimeNativeBlockEditContentBindingV1,
    IntegratedRuntimeNativeBlockEditDirtyEvidenceV1, IntegratedRuntimeNativeBlockEditGeneratedDropV1,
    IntegratedRuntimeNativeBlockEditInventoryDeltaV1, IntegratedRuntimeNativeBlockEditReceiptV1,
    IntegratedRuntimeNativeDropPickupAuthorityEvidenceV1, IntegratedRuntimeNativeDropPickupOriginV1,
    IntegratedRuntimeNativeDropPickupReceiptV1, IntegratedRuntimeNativeDropPickupSlotDeltaV1,
    IntegratedRuntimeNativeDropPickupSourceV1, IntegratedRuntimeNativePlayerDropContentBindingV1,
    IntegratedRuntimeNativePlayerDropInventoryDeltaV1, IntegratedRuntimeNativePlayerDropReceiptV1,
    IntegratedRuntimeNativePlayerDropSpawnV1, IntegratedRuntimeRevisionV2, IntegratedTerrainChunkCoordinateV1,
    IntegratedTerrainResidencyBatchV1, IntegratedTerrainResidencyChunkReceiptV1, IntegratedTerrainResidencyReceiptV1,
    IntegratedTerrainResidencyReconcileBatchV2, IntegratedTerrainResidencyReconcileReceiptV2,
    IntegratedTerrainResidencyStatusV1, dirty_subsystem_from_tag_v1, dirty_subsystem_tag_v1,
    validate_canonical_generation_options_json_v1,
};

const DOMAIN_PROTOCOL_V1: u16 = INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1;
const DOMAIN_SCHEMA_V1: u16 = 1;
const DOMAIN_HEADER_BYTES: usize = 28;
const MAX_COLLECTION: usize = 65_536;
const MAX_MAP_ENTRIES: usize = 4_096;
const MAX_STRING_BYTES: usize = 16 * 1024;
const PERSISTENCE_STATUS_MAGIC: [u8; 4] = *b"BWS8";
const PERSISTENCE_STATUS_RECEIPT_MAGIC: [u8; 4] = *b"BWT8";
const TERRAIN_RESIDENCY_BATCH_MAGIC: [u8; 4] = *b"BWT4";
const TERRAIN_RESIDENCY_RECEIPT_MAGIC: [u8; 4] = *b"BWU4";
const TERRAIN_RESIDENCY_RECONCILE_BATCH_MAGIC: [u8; 4] = *b"BWT5";
const TERRAIN_RESIDENCY_RECONCILE_RECEIPT_MAGIC: [u8; 4] = *b"BWU5";
// BWZ7/BWY7 are reserved for the additive generic single-cell native block
// edit query/receipt lane. They intentionally do not alias BWQ7/BWR7, whose
// deployed byte shape remains Basic Dirt-only compatibility evidence.

pub const CONTENT_INSTALL_PAGE_TYPE_V1: &str = CONTENT_INSTALL_PAGE_V1_TYPE_ID;
pub const CONTENT_INSTALL_RECEIPT_TYPE_V1: &str = CONTENT_INSTALL_RECEIPT_V1_TYPE_ID;
pub const CONTENT_INSTALL_MAX_PAGES_V1: usize = 128;
pub const CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1: usize = 1_024;
pub const ENTITY_AUTHORITY_EXPORT_TYPE_V1: &str = ENTITY_AUTHORITY_EXPORT_V1_TYPE_ID;
pub const ENTITY_AUTHORITY_SNAPSHOT_TYPE_V2: &str = ENTITY_AUTHORITY_SNAPSHOT_V2_TYPE_ID;
pub const ENTITY_AUTHORITY_IMPORT_TYPE_V2: &str = ENTITY_AUTHORITY_IMPORT_V2_TYPE_ID;
pub const ENTITY_AUTHORITY_IMPORT_RECEIPT_TYPE_V1: &str = ENTITY_AUTHORITY_IMPORT_RECEIPT_V1_TYPE_ID;
pub const ENTITY_COMPATIBILITY_EXPORT_TYPE_V1: &str = ENTITY_COMPATIBILITY_EXPORT_V1_TYPE_ID;
pub const ENTITY_COMPATIBILITY_RECORD_TYPE_V1: &str = ENTITY_COMPATIBILITY_RECORD_V1_TYPE_ID;
pub const ENTITY_COMPATIBILITY_IMPORT_TYPE_V1: &str = ENTITY_COMPATIBILITY_IMPORT_V1_TYPE_ID;
pub const TERRAIN_RESIDENCY_BATCH_TYPE_V1: &str = "blockwild.world.terrain-residency.ensure.r4.v1";
pub const TERRAIN_RESIDENCY_RECEIPT_TYPE_V1: &str = "blockwild.world.terrain-residency-receipt.r4.v1";
pub const TERRAIN_RESIDENCY_RECONCILE_BATCH_TYPE_V2: &str = "blockwild.world.terrain-residency-reconcile.r4.v2";
pub const TERRAIN_RESIDENCY_RECONCILE_RECEIPT_TYPE_V2: &str =
    "blockwild.world.terrain-residency-reconcile-receipt.r4.v2";
pub const PLAYER_BOOTSTRAP_STATUS_TYPE_V1: &str = PLAYER_BOOTSTRAP_STATUS_V1_TYPE_ID;
pub const PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1: &str = PLAYER_BOOTSTRAP_STATUS_RECEIPT_V1_TYPE_ID;
pub const PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1: &str = PLAYER_COMBAT_BOOTSTRAP_STATUS_V1_TYPE_ID;
pub const PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1: &str = PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_V1_TYPE_ID;
pub const CONTEXT_COMMAND_CONTINUITY_TYPE_V2: &str = CONTEXT_COMMAND_CONTINUITY_V2_TYPE_ID;
pub const CONTEXT_COMMAND_CONTINUITY_RECEIPT_TYPE_V2: &str = CONTEXT_COMMAND_CONTINUITY_RECEIPT_V2_TYPE_ID;
pub const BASIC_DIRT_ACTION_RECEIPT_TYPE_V1: &str = BASIC_DIRT_ACTION_RECEIPT_V1_TYPE_ID;
pub const BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1: &str = BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_TYPE_ID;
pub const NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1: &str = NATIVE_BLOCK_EDIT_RECEIPT_V1_TYPE_ID;
pub const NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1: &str = NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V1_TYPE_ID;
pub const NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2: &str = NATIVE_BLOCK_EDIT_RECEIPT_V2_TYPE_ID;
pub const NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V2: &str = NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V2_TYPE_ID;
pub const NATIVE_DROP_PICKUP_RECEIPT_TYPE_V1: &str = NATIVE_DROP_PICKUP_RECEIPT_V1_TYPE_ID;
pub const NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1: &str = NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_V1_TYPE_ID;
pub const NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1: &str = NATIVE_PLAYER_DROP_RECEIPT_V1_TYPE_ID;
pub const NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1: &str = NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_V1_TYPE_ID;
pub const PLAYER_INVENTORY_IMPORT_TYPE_V1: &str = PLAYER_INVENTORY_IMPORT_V1_TYPE_ID;
pub const PLAYER_INVENTORY_IMPORT_RECEIPT_TYPE_V1: &str = PLAYER_INVENTORY_IMPORT_RECEIPT_V1_TYPE_ID;
pub const PLAYER_LOCATOR_ITEM_CONSUME_TYPE_V1: &str = PLAYER_LOCATOR_ITEM_CONSUME_V1_TYPE_ID;
pub const PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_TYPE_V1: &str = PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_V1_TYPE_ID;
pub const PLAYER_CREATIVE_SLOT_SET_TYPE_V1: &str = PLAYER_CREATIVE_SLOT_SET_V1_TYPE_ID;
pub const PLAYER_CREATIVE_SLOT_SET_RECEIPT_TYPE_V1: &str = PLAYER_CREATIVE_SLOT_SET_RECEIPT_V1_TYPE_ID;
pub const PLAYER_GAME_MODE_SET_TYPE_V1: &str = PLAYER_GAME_MODE_SET_V1_TYPE_ID;
pub const PLAYER_GAME_MODE_SET_RECEIPT_TYPE_V1: &str = PLAYER_GAME_MODE_SET_RECEIPT_V1_TYPE_ID;
pub const PLAYER_RESPAWN_TYPE_V1: &str = PLAYER_RESPAWN_V1_TYPE_ID;
pub const PLAYER_RESPAWN_RECEIPT_TYPE_V1: &str = PLAYER_RESPAWN_RECEIPT_V1_TYPE_ID;
pub const SIMULATION_PLAYER_BIND_TYPE_V3: &str = SIMULATION_PLAYER_BIND_V3_TYPE_ID;
pub const SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V3: &str = SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V3_TYPE_ID;
pub const SIMULATION_PLAYER_BIND_TYPE_V4: &str = SIMULATION_PLAYER_BIND_V4_TYPE_ID;
pub const SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V4: &str = SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V4_TYPE_ID;
pub const SIMULATION_CAMERA_CONFIG_TYPE_V1: &str = SIMULATION_CAMERA_CONFIG_V1_TYPE_ID;
pub const SIMULATION_CAMERA_CONFIG_RECEIPT_TYPE_V1: &str = SIMULATION_CAMERA_CONFIG_RECEIPT_V1_TYPE_ID;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RuntimeCameraConfigWireV1 {
    /// Compare-and-set seam. Zero denotes the initial camera configuration.
    pub expected_camera_revision: u64,
    pub mode: CameraModeV1,
    pub profile: CameraProfileV1,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RuntimeCameraConfigReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub previous_camera_revision: u64,
    pub resulting_camera_revision: u64,
    pub mode: CameraModeV1,
    pub profile: CameraProfileV1,
    pub camera_state_hash: CanonicalHash,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntityAuthorityExportWireV1 {
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EntityAuthorityImportWireV2 {
    pub expected_revision: u64,
    pub snapshot: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntityAuthorityImportReceiptWireV1 {
    pub previous_revision: u64,
    pub revision: u64,
    pub entity_count: u32,
    pub state_hash: CanonicalHash,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntityCompatibilityExportWireV1 {
    pub entity_id: EntityId,
    pub expected_entity_revision: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EntityCompatibilityImportWireV1 {
    pub sequence: u64,
    pub expected_revision: u64,
    pub tick: u64,
    pub desired_id: Option<EntityId>,
    pub residency: EntityResidency,
    pub record: EntityCompatibilityRecord,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerBootstrapStatusQueryWireV1 {
    pub external_entity_id: String,
    pub actor_id: String,
    pub player_id: PlayerId,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlayerBootstrapEntityWireV1 {
    pub entity_id: EntityId,
    pub entity_revision: u64,
    pub residency: EntityResidency,
    pub record: EntityCompatibilityRecord,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlayerBootstrapRuntimePlayerWireV1 {
    pub entity_id: EntityId,
    pub binding: RuntimePlayerBindingWireV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerBootstrapCustodyWireV1 {
    pub inventory_container: ContainerKey,
    pub inventory_revision: u64,
    pub inventory_slots: Vec<Option<ItemStack>>,
    pub equipment_container: ContainerKey,
    pub equipment_revision: u64,
    pub equipment_slots: Vec<Option<ItemStack>>,
    /// Exact metadata records referenced by non-zero hashes in `inventory_slots`,
    /// sorted by hash and including canonical and unknown-extension bytes.
    pub referenced_metadata: Vec<ItemInstanceMetadataV1>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlayerBootstrapStatusWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub world_authority_revision: WorldAuthorityRevisionV1,
    pub entity_authority_revision: u64,
    pub next_sequence: Option<u64>,
    pub tick: u64,
    pub last_monotonic_time_us: u64,
    pub last_input_sequence: Option<u64>,
    pub next_input_sequence: Option<u64>,
    pub last_action_sequence: Option<u64>,
    pub next_action_sequence: Option<u64>,
    pub authoritative_flags: u8,
    pub last_applied_input: Option<RuntimeInputFrameV1>,
    pub queued_inputs_empty: bool,
    pub entity: Option<PlayerBootstrapEntityWireV1>,
    pub runtime_player: Option<PlayerBootstrapRuntimePlayerWireV1>,
    pub world_view_binding: Option<PlayerInventoryBindingV1>,
    pub custody: Option<PlayerBootstrapCustodyWireV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum PlayerCombatBootstrapStatusV1 {
    Absent = 0,
    LegacyUnlinked = 1,
    ExactLinked = 2,
    Blocked = 3,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum PlayerCombatBootstrapBlockerV1 {
    LegacyUnlinkedRequiresExplicitMigration = 1,
    DuplicateCombatClaim = 2,
    MissingPlayerEntity = 3,
    IncompletePlayerBinding = 4,
    RecordIdentityConflict = 5,
    EntityLinkConflict = 6,
    OwnerConflict = 7,
    VitalUnitConflict = 8,
    VitalParityConflict = 9,
    InvalidEntityVitals = 10,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerCombatantBootstrapWireV1 {
    pub record_id: String,
    pub owner_id: Option<String>,
    pub revision: u64,
    pub entity_id: Option<EntityId>,
    pub vital_units: CombatVitalUnits,
    pub health: u32,
    pub max_health: u32,
    pub alive: bool,
    pub cross_domain_parity: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerCombatBootstrapStatusWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub entity_authority_revision: u64,
    pub gameplay_sequence: u64,
    pub gameplay_combat_revision: u64,
    pub gameplay_state_hash: CanonicalHash,
    pub status: PlayerCombatBootstrapStatusV1,
    pub blocker: Option<PlayerCombatBootstrapBlockerV1>,
    pub combatant: Option<PlayerCombatantBootstrapWireV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeContextCommandContinuityQueryWireV2 {
    pub expected: IntegratedRuntimeIdentityV2,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeContextCommandContinuityReceiptWireV2 {
    pub request_payload_hash: CanonicalHash,
    pub identity: IntegratedRuntimeIdentityV2,
    pub last_sequence: Option<u64>,
    pub next_sequence: Option<u64>,
    pub queued_commands_empty: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeBasicDirtActionReceiptQueryWireV1 {
    pub expected: IntegratedRuntimeIdentityV2,
    pub after_sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeBasicDirtGeneratedDropProjectionWireV1 {
    pub provenance: GeneratedDropProvenanceV1,
    pub entity_id: EntityId,
    pub stack: ItemStack,
    pub position: FixedWorldVec3V1,
    pub velocity_milli_per_second: FixedWorldVec3V1,
    pub rotation: RotationMicroturnsV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeBasicDirtActionProjectionWireV1 {
    pub schema_version: u16,
    pub sequence: u64,
    pub origin_input_sequence: u64,
    pub completion_tick: u64,
    pub action: IntegratedRuntimeBasicDirtActionKindV1,
    pub position: blockwild_authority::CellPositionV1,
    pub prior_block_id: u16,
    pub replacement_block_id: u16,
    pub before_world_revision: WorldAuthorityRevisionV1,
    pub after_world_revision: WorldAuthorityRevisionV1,
    pub before_world_hash: CanonicalHash,
    pub after_world_hash: CanonicalHash,
    pub creative_mode: bool,
    pub inventory: crate::IntegratedRuntimeBasicDirtInventoryDeltaV1,
    pub generated_drops: Vec<RuntimeBasicDirtGeneratedDropProjectionWireV1>,
    pub content: IntegratedRuntimeBasicDirtActionContentBindingV1,
    pub receipt_hash: CanonicalHash,
}

impl RuntimeBasicDirtActionProjectionWireV1 {
    #[must_use]
    pub fn native_receipt_v1(&self) -> IntegratedRuntimeBasicDirtActionReceiptV1 {
        IntegratedRuntimeBasicDirtActionReceiptV1 {
            schema_version: self.schema_version,
            sequence: self.sequence,
            origin_input_sequence: self.origin_input_sequence,
            completion_tick: self.completion_tick,
            action: self.action,
            position: self.position,
            prior_block_id: self.prior_block_id,
            replacement_block_id: self.replacement_block_id,
            before_world_revision: self.before_world_revision,
            after_world_revision: self.after_world_revision,
            before_world_hash: self.before_world_hash,
            after_world_hash: self.after_world_hash,
            creative_mode: self.creative_mode,
            inventory: self.inventory.clone(),
            generated_drops: self
                .generated_drops
                .iter()
                .map(|drop| crate::IntegratedRuntimeGeneratedDropReceiptV1 {
                    provenance: drop.provenance.clone(),
                    entity_id: drop.entity_id,
                })
                .collect(),
            content: self.content.clone(),
            receipt_hash: self.receipt_hash,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeBasicDirtActionProjectionReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub identity: IntegratedRuntimeIdentityV2,
    pub cursor_after: u64,
    pub receipt: Option<RuntimeBasicDirtActionProjectionWireV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeNativeBlockEditReceiptQueryWireV1 {
    pub expected: IntegratedRuntimeIdentityV2,
    pub after_sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeNativeBlockEditProjectionReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub identity: IntegratedRuntimeIdentityV2,
    pub cursor_after: u64,
    pub receipt: Option<IntegratedRuntimeNativeBlockEditReceiptV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeNativeBlockEditReceiptQueryWireV2 {
    pub expected: IntegratedRuntimeIdentityV2,
    pub after_sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeNativeBlockEditProjectionReceiptWireV2 {
    pub request_payload_hash: CanonicalHash,
    pub identity: IntegratedRuntimeIdentityV2,
    pub cursor_after: u64,
    pub receipt: Option<IntegratedRuntimeNativeBlockEditReceiptV1>,
    /// `None` is an explicit restored-V13 compatibility gap. A V14 no-op has
    /// `Some` evidence whose three dirty collections are empty.
    pub dirty_evidence: Option<IntegratedRuntimeNativeBlockEditDirtyEvidenceV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeNativeDropPickupReceiptQueryWireV1 {
    pub expected: IntegratedRuntimeIdentityV2,
    pub after_sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeNativeDropPickupProjectionReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub identity: IntegratedRuntimeIdentityV2,
    pub cursor_after: u64,
    pub receipt: Option<IntegratedRuntimeNativeDropPickupReceiptV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeNativePlayerDropReceiptQueryWireV1 {
    pub expected: IntegratedRuntimeIdentityV2,
    pub after_sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeNativePlayerDropProjectionReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub identity: IntegratedRuntimeIdentityV2,
    pub cursor_after: u64,
    pub receipt: Option<IntegratedRuntimeNativePlayerDropReceiptV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerInventoryImportWireV1 {
    pub import: ImportPlayerInventoryV1,
    pub selected_slot: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerInventoryImportReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub before: AuthorityIdentity,
    pub after: AuthorityIdentity,
    pub accepted_receipt_hash: CanonicalHash,
    pub inventory_revision: u64,
    pub selected_slot: u16,
    pub inventory_result_hash: CanonicalHash,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlayerLocatorItemPurposeV1 {
    SettlementChart,
    DragonLairCharter,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerLocatorItemConsumeWireV1 {
    pub inventory: ContainerKey,
    pub selected_slot: u16,
    pub expected_inventory_revision: u64,
    pub expected_stack: ItemStack,
    pub purpose: PlayerLocatorItemPurposeV1,
    pub locator_result_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerLocatorItemConsumeReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub purpose: PlayerLocatorItemPurposeV1,
    pub locator_result_hash: CanonicalHash,
    pub before: AuthorityIdentity,
    pub after: AuthorityIdentity,
    pub accepted_receipt_hash: CanonicalHash,
    pub inventory: ContainerKey,
    pub selected_slot: u16,
    pub previous_inventory_revision: u64,
    pub resulting_inventory_revision: u64,
    pub consumed_stack: ItemStack,
    pub remaining_stack: Option<ItemStack>,
    pub inventory_result_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerCreativeSlotSetWireV1 {
    pub inventory: ContainerKey,
    pub selected_slot: u16,
    pub expected_inventory_revision: u64,
    pub expected_stack: Option<ItemStack>,
    pub replacement_stack: ItemStack,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerCreativeSlotSetReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub before: AuthorityIdentity,
    pub after: AuthorityIdentity,
    pub accepted_receipt_hash: CanonicalHash,
    pub inventory: ContainerKey,
    pub selected_slot: u16,
    pub previous_inventory_revision: u64,
    pub resulting_inventory_revision: u64,
    pub prior_stack: Option<ItemStack>,
    pub replacement_stack: ItemStack,
    pub inventory_result_hash: CanonicalHash,
    pub receipt_hash: CanonicalHash,
}

/// Exact simulation-authority compare-and-set used when a saved world's mode
/// is changed outside the live input loop. The three identity fields bind the
/// request to one native player; the expected mode and flags make stale browser
/// documents fail before any state changes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerGameModeSetWireV1 {
    pub external_entity_id: String,
    pub actor_id: String,
    pub player_id: PlayerId,
    pub expected_creative_mode: bool,
    pub expected_flags: u8,
    pub requested_creative_mode: bool,
}

/// Sealed proof that exactly one outer simulation revision changed while all
/// other integrated authority lanes and the runtime tick stayed fixed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerGameModeSetReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub before: IntegratedRuntimeIdentityV2,
    pub after: IntegratedRuntimeIdentityV2,
    pub external_entity_id: String,
    pub actor_id: String,
    pub player_id: PlayerId,
    pub prior_creative_mode: bool,
    pub prior_flags: u8,
    pub resulting_creative_mode: bool,
    pub resulting_flags: u8,
    pub receipt_hash: CanonicalHash,
}

/// Exact cross-domain compare-and-set for one dead native player. The outer
/// integrated identity closes over every authority lane, while the explicit
/// entity/combat cursors make the R6/R7 dead state independently auditable.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerRespawnWireV1 {
    pub expected: IntegratedRuntimeIdentityV2,
    pub external_entity_id: String,
    pub actor_id: String,
    pub player_id: PlayerId,
    pub entity_id: EntityId,
    pub expected_entity_revision: u64,
    pub expected_gameplay_sequence: u64,
    pub expected_gameplay_combat_revision: u64,
    pub expected_combatant_revision: u64,
    pub expected_death_sequence: u64,
    pub expected_max_health: u32,
    pub respawn_position: FixedWorldVec3V1,
    pub keep_inventory: bool,
}

/// Canonical proof of the atomic R5 body, R6 entity/vitals, and R7 combatant
/// restoration. Inventory/equipment hashes and revisions attest the selected
/// policy without requiring the browser to trust an implicit default.
#[derive(Clone, Debug, PartialEq)]
pub struct PlayerRespawnReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub before: IntegratedRuntimeIdentityV2,
    pub after: IntegratedRuntimeIdentityV2,
    pub external_entity_id: String,
    pub actor_id: String,
    pub player_id: PlayerId,
    pub entity_id: EntityId,
    pub death_sequence: u64,
    pub prior_entity_revision: u64,
    pub resulting_entity_revision: u64,
    pub prior_gameplay_sequence: u64,
    pub resulting_gameplay_sequence: u64,
    pub prior_gameplay_combat_revision: u64,
    pub resulting_gameplay_combat_revision: u64,
    pub prior_combatant_revision: u64,
    pub resulting_combatant_revision: u64,
    pub maximum_health: u32,
    pub prior_health: u32,
    pub resulting_health: u32,
    pub prior_alive: bool,
    pub resulting_alive: bool,
    pub respawn_position: FixedWorldVec3V1,
    pub resulting_oxygen_seconds: f64,
    pub keep_inventory: bool,
    pub inventory_before_revision: u64,
    pub inventory_after_revision: u64,
    pub equipment_before_revision: u64,
    pub equipment_after_revision: u64,
    pub custody_before_hash: CanonicalHash,
    pub custody_after_hash: CanonicalHash,
    pub generated_drop_count: u32,
    pub receipt_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentInstallPageWireV1 {
    pub install_id: String,
    pub manifest_schema: u16,
    pub source_revision: String,
    pub manifest_hash: CanonicalHash,
    pub domains: BTreeMap<ContentDomain, ContentDomainDigest>,
    pub page_index: u32,
    pub page_count: u32,
    pub artifacts: Vec<ContentArtifact>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContentInstallReceiptStatusV1 {
    Staged,
    Installed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentInstallReceiptWireV1 {
    pub status: ContentInstallReceiptStatusV1,
    pub install_id: String,
    pub source_revision: String,
    pub manifest_hash: CanonicalHash,
    pub domains: BTreeMap<ContentDomain, ContentDomainDigest>,
    pub accepted_pages: u32,
    pub page_count: u32,
    pub accepted_entries: u32,
    pub installed_entries: u32,
    pub installed_bytes: u64,
}

/// Bounded control-plane requests that ask the Rust persistence dispatcher to
/// issue one complete BWPR. Large BWPR/BWPA packets themselves leave through
/// the detached bulk lane; this packet never changes the normal BWRQ ceiling.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimePersistenceDispatchWireV1 {
    Commit {
        browser_request: Vec<u8>,
    },
    Recover {
        world_id: String,
        checkpoint_id: Option<String>,
    },
    ReadRecoveryPage {
        world_id: String,
        checkpoint_id: String,
        start_record: u64,
        max_records: u32,
        max_bytes: u32,
    },
    Estimate {
        world_id: String,
    },
    Compact {
        world_id: String,
        checkpoint_id: String,
        expected_head_hash: CanonicalHash,
        retain_parent_count: u16,
    },
    Delete {
        world_id: String,
        expected_head_hash: Option<CanonicalHash>,
        tombstone: CanonicalHash,
    },
    PreserveLegacyBackupChunk {
        world_id: String,
        backup_id: String,
        offset: u64,
        total_bytes: u64,
        bytes: Vec<u8>,
    },
    ExportPage {
        world_id: String,
        checkpoint_id: String,
        cursor: u64,
        max_bytes: u32,
    },
    ImportChunk {
        world_id: String,
        import_id: String,
        offset: u64,
        total_bytes: u64,
        bytes: Vec<u8>,
    },
    FinalizeImport {
        world_id: String,
        import_id: String,
        archive_hash: CanonicalHash,
        total_bytes: u64,
    },
    Retry {
        previous_request_id: u64,
    },
    Close,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimePersistenceDispatchReceiptWireV1 {
    pub request_id: Option<u64>,
    pub persistence_revision: u64,
    pub pending: u32,
    pub queued_bytes: u64,
    pub state_hash: CanonicalHash,
    pub closed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimePersistenceTerminalCheckpointWireV1 {
    pub checkpoint_id: String,
    pub checkpoint_hash: CanonicalHash,
    pub journal_sequence: u64,
    pub record_count: u32,
    pub save_set_hash: CanonicalHash,
    pub manifest_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimePersistenceStatusReceiptWireV1 {
    pub persistence_revision: u64,
    pub pending: u32,
    pub queued_bytes: u64,
    pub dispatcher_state_hash: CanonicalHash,
    pub authority_state_hash: CanonicalHash,
    pub closed: bool,
    /// Present only when save-stage, dispatcher, retry, prepared-commit, and
    /// dirty-record custody are all terminal at this exact durable checkpoint.
    pub terminal_checkpoint: Option<RuntimePersistenceTerminalCheckpointWireV1>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimePlayerBindingWireV1 {
    pub external_entity_id: String,
    pub actor_id: String,
    pub player_id: PlayerId,
    pub creative_mode: bool,
    pub radius: f64,
    pub standing_height: f64,
    pub crouching_height: f64,
    pub mass: f64,
    pub walk_speed: f64,
    pub sprint_speed: f64,
    pub creative_flight_speed: f64,
    pub maximum_oxygen_seconds: f64,
}

impl RuntimePlayerBindingWireV1 {
    pub fn validate(&self) -> Result<(), WireError> {
        let values = [
            self.radius,
            self.standing_height,
            self.crouching_height,
            self.mass,
            self.walk_speed,
            self.sprint_speed,
            self.creative_flight_speed,
            self.maximum_oxygen_seconds,
        ];
        if self.external_entity_id.is_empty()
            || self.external_entity_id.len() > 512
            || self.external_entity_id.chars().any(char::is_control)
            || self.actor_id.is_empty()
            || self.actor_id.len() > 512
            || self.actor_id.chars().any(char::is_control)
            || self.player_id.packed() == 0
            || values.iter().any(|value| !value.is_finite() || *value <= 0.0)
            || !(0.1..=4.0).contains(&self.radius)
            || !(0.5..=8.0).contains(&self.standing_height)
            || self.crouching_height > self.standing_height
            || !(0.1..=100_000.0).contains(&self.mass)
            || !(0.1..=128.0).contains(&self.walk_speed)
            || self.sprint_speed < self.walk_speed
            || self.sprint_speed > 192.0
            || !(0.1..=256.0).contains(&self.creative_flight_speed)
            || self.maximum_oxygen_seconds > 3_600.0
        {
            return Err(WireError::new(
                "player-binding",
                "player binding contains an invalid identity or physical profile",
            ));
        }
        Ok(())
    }
}

fn runtime_player_binding_wire_v1() -> ([u8; 4], u16) {
    // Bind v2/v3/v4 deliberately share one BWB6 inner payload. Keep that
    // compatibility assumption coupled to the generated registry rather than
    // silently duplicating either layer of the contract here.
    debug_assert_eq!(SIMULATION_PLAYER_BIND_V2_MAGIC, SIMULATION_PLAYER_BIND_V3_MAGIC);
    debug_assert_eq!(SIMULATION_PLAYER_BIND_V2_MAGIC, SIMULATION_PLAYER_BIND_V4_MAGIC);
    debug_assert_eq!(SIMULATION_PLAYER_BIND_V2_MAGIC, SIMULATION_PLAYER_BIND_RECEIPT_V2_MAGIC);
    debug_assert_eq!(
        SIMULATION_PLAYER_BIND_V2_INNER_SCHEMA,
        SIMULATION_PLAYER_BIND_V3_INNER_SCHEMA
    );
    debug_assert_eq!(
        SIMULATION_PLAYER_BIND_V2_INNER_SCHEMA,
        SIMULATION_PLAYER_BIND_V4_INNER_SCHEMA
    );
    debug_assert_eq!(
        SIMULATION_PLAYER_BIND_V2_INNER_SCHEMA,
        SIMULATION_PLAYER_BIND_RECEIPT_V2_INNER_SCHEMA
    );
    (SIMULATION_PLAYER_BIND_V2_MAGIC, SIMULATION_PLAYER_BIND_V2_INNER_SCHEMA)
}

pub fn encode_runtime_player_binding_v1(value: &RuntimePlayerBindingWireV1) -> Result<Vec<u8>, WireError> {
    value.validate()?;
    let mut writer = Writer::default();
    writer.string(&value.external_entity_id)?;
    writer.string(&value.actor_id)?;
    writer.u64(value.player_id.packed());
    writer.u8(u8::from(value.creative_mode));
    writer.f64(value.radius);
    writer.f64(value.standing_height);
    writer.f64(value.crouching_height);
    writer.f64(value.mass);
    writer.f64(value.walk_speed);
    writer.f64(value.sprint_speed);
    writer.f64(value.creative_flight_speed);
    writer.f64(value.maximum_oxygen_seconds);
    let (magic, schema) = runtime_player_binding_wire_v1();
    wrap_schema(magic, schema, writer.finish())
}

pub fn decode_runtime_player_binding_v1(bytes: &[u8]) -> Result<RuntimePlayerBindingWireV1, WireError> {
    let (magic, schema) = runtime_player_binding_wire_v1();
    let mut reader = Reader::new(unwrap_schema(magic, schema, bytes)?);
    let value = RuntimePlayerBindingWireV1 {
        external_entity_id: reader.string()?,
        actor_id: reader.string()?,
        player_id: {
            let packed = reader.u64()?;
            PlayerId::new(packed as u32, (packed >> 32) as u32)
        },
        creative_mode: match reader.u8()? {
            0 => false,
            1 => true,
            _ => return Err(WireError::new("player-binding", "creative mode flag is not boolean")),
        },
        radius: reader.f64()?,
        standing_height: reader.f64()?,
        crouching_height: reader.f64()?,
        mass: reader.f64()?,
        walk_speed: reader.f64()?,
        sprint_speed: reader.f64()?,
        creative_flight_speed: reader.f64()?,
        maximum_oxygen_seconds: reader.f64()?,
    };
    reader.finish()?;
    value.validate()?;
    Ok(value)
}

fn camera_mode_tag_v1(value: CameraModeV1) -> u8 {
    match value {
        CameraModeV1::FirstPerson => 0,
        CameraModeV1::ThirdRear => 1,
        CameraModeV1::ThirdFront => 2,
    }
}

fn read_camera_mode_v1(reader: &mut Reader<'_>) -> Result<CameraModeV1, WireError> {
    match reader.u8()? {
        0 => Ok(CameraModeV1::FirstPerson),
        1 => Ok(CameraModeV1::ThirdRear),
        2 => Ok(CameraModeV1::ThirdFront),
        _ => Err(WireError::new("camera-mode", "camera configuration mode is unknown")),
    }
}

fn camera_profile_values_v1(value: CameraProfileV1) -> [f64; 12] {
    [
        value.eye_height,
        value.third_person_target_height,
        value.third_person_distance,
        value.third_person_pitch_scale,
        value.rear_shoulder_offset,
        value.collision_radius,
        value.collision_padding,
        value.minimum_distance,
        value.base_vertical_fov_radians,
        value.aim_vertical_fov_radians,
        value.near,
        value.far,
    ]
}

fn validate_camera_profile_v1(value: CameraProfileV1) -> Result<(), WireError> {
    derive_camera_pose_v1(
        None,
        CameraPoseInputV1 {
            body_position: SimulationVec3::new(0.0, 0.0, 0.0),
            look_yaw: 0.0,
            look_pitch: 0.0,
            mode: CameraModeV1::FirstPerson,
            aiming: false,
            viewport: [1, 1],
            profile: value,
        },
    )
    .map(|_| ())
    .map_err(|_| {
        WireError::new(
            "camera-profile",
            "camera configuration profile is outside the simulation contract",
        )
    })
}

fn write_camera_profile_v1(writer: &mut Writer, value: CameraProfileV1) {
    for field in camera_profile_values_v1(value) {
        writer.f64(field);
    }
}

fn read_camera_profile_v1(reader: &mut Reader<'_>) -> Result<CameraProfileV1, WireError> {
    let value = CameraProfileV1 {
        eye_height: reader.f64()?,
        third_person_target_height: reader.f64()?,
        third_person_distance: reader.f64()?,
        third_person_pitch_scale: reader.f64()?,
        rear_shoulder_offset: reader.f64()?,
        collision_radius: reader.f64()?,
        collision_padding: reader.f64()?,
        minimum_distance: reader.f64()?,
        base_vertical_fov_radians: reader.f64()?,
        aim_vertical_fov_radians: reader.f64()?,
        near: reader.f64()?,
        far: reader.f64()?,
    };
    validate_camera_profile_v1(value)?;
    Ok(value)
}

#[must_use]
pub fn runtime_camera_config_state_hash_v1(
    camera_revision: u64,
    mode: CameraModeV1,
    profile: CameraProfileV1,
) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-camera-config-state-v1");
    hasher.write_u16(1);
    hasher.write_u64(camera_revision);
    hasher.write_u16(u16::from(camera_mode_tag_v1(mode)));
    for field in camera_profile_values_v1(profile) {
        hasher.write_bytes(&field.to_le_bytes());
    }
    hasher.finish()
}

pub fn encode_runtime_camera_config_v1(value: &RuntimeCameraConfigWireV1) -> Result<Vec<u8>, WireError> {
    if value.expected_camera_revision > MAX_SAFE_U64 {
        return Err(WireError::new(
            "camera-revision",
            "expected camera revision exceeds JavaScript's safe integer range",
        ));
    }
    validate_camera_profile_v1(value.profile)?;
    let mut writer = Writer::default();
    writer.u64(value.expected_camera_revision);
    writer.u8(camera_mode_tag_v1(value.mode));
    write_camera_profile_v1(&mut writer, value.profile);
    wrap_schema(
        SIMULATION_CAMERA_CONFIG_V1_MAGIC,
        SIMULATION_CAMERA_CONFIG_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_camera_config_v1(bytes: &[u8]) -> Result<RuntimeCameraConfigWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        SIMULATION_CAMERA_CONFIG_V1_MAGIC,
        SIMULATION_CAMERA_CONFIG_V1_INNER_SCHEMA,
        bytes,
    )?);
    let expected_camera_revision = reader.u64()?;
    if expected_camera_revision > MAX_SAFE_U64 {
        return Err(WireError::new(
            "camera-revision",
            "expected camera revision exceeds JavaScript's safe integer range",
        ));
    }
    let mode = read_camera_mode_v1(&mut reader)?;
    let profile = read_camera_profile_v1(&mut reader)?;
    reader.finish()?;
    Ok(RuntimeCameraConfigWireV1 {
        expected_camera_revision,
        mode,
        profile,
    })
}

fn validate_camera_config_receipt_v1(value: &RuntimeCameraConfigReceiptWireV1) -> Result<(), WireError> {
    if value.previous_camera_revision > MAX_SAFE_U64
        || value.resulting_camera_revision > MAX_SAFE_U64
        || (value.resulting_camera_revision != value.previous_camera_revision
            && value.previous_camera_revision.checked_add(1) != Some(value.resulting_camera_revision))
    {
        return Err(WireError::new(
            "camera-revision",
            "camera receipt revision must stay unchanged or advance exactly once",
        ));
    }
    validate_camera_profile_v1(value.profile)?;
    if value.camera_state_hash
        != runtime_camera_config_state_hash_v1(value.resulting_camera_revision, value.mode, value.profile)
    {
        return Err(WireError::new(
            "camera-state-hash",
            "camera receipt terminal state hash is invalid",
        ));
    }
    Ok(())
}

pub fn encode_runtime_camera_config_receipt_v1(value: &RuntimeCameraConfigReceiptWireV1) -> Result<Vec<u8>, WireError> {
    validate_camera_config_receipt_v1(value)?;
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    writer.u64(value.previous_camera_revision);
    writer.u64(value.resulting_camera_revision);
    writer.u8(camera_mode_tag_v1(value.mode));
    write_camera_profile_v1(&mut writer, value.profile);
    writer.hash(value.camera_state_hash);
    wrap_schema(
        SIMULATION_CAMERA_CONFIG_RECEIPT_V1_MAGIC,
        SIMULATION_CAMERA_CONFIG_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_camera_config_receipt_v1(bytes: &[u8]) -> Result<RuntimeCameraConfigReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        SIMULATION_CAMERA_CONFIG_RECEIPT_V1_MAGIC,
        SIMULATION_CAMERA_CONFIG_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = RuntimeCameraConfigReceiptWireV1 {
        request_payload_hash: reader.hash()?,
        previous_camera_revision: reader.u64()?,
        resulting_camera_revision: reader.u64()?,
        mode: read_camera_mode_v1(&mut reader)?,
        profile: read_camera_profile_v1(&mut reader)?,
        camera_state_hash: reader.hash()?,
    };
    reader.finish()?;
    validate_camera_config_receipt_v1(&value)?;
    Ok(value)
}

pub fn encode_player_bootstrap_status_query_v1(value: &PlayerBootstrapStatusQueryWireV1) -> Result<Vec<u8>, WireError> {
    validate_player_bootstrap_target(value)?;
    let mut writer = Writer::default();
    writer.string(&value.external_entity_id)?;
    writer.string(&value.actor_id)?;
    writer.u64(value.player_id.packed());
    wrap_schema(
        PLAYER_BOOTSTRAP_STATUS_V1_MAGIC,
        PLAYER_BOOTSTRAP_STATUS_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_bootstrap_status_query_v1(bytes: &[u8]) -> Result<PlayerBootstrapStatusQueryWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_BOOTSTRAP_STATUS_V1_MAGIC,
        PLAYER_BOOTSTRAP_STATUS_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = PlayerBootstrapStatusQueryWireV1 {
        external_entity_id: reader.string()?,
        actor_id: reader.string()?,
        player_id: {
            let packed = reader.u64()?;
            PlayerId::new(packed as u32, (packed >> 32) as u32)
        },
    };
    reader.finish()?;
    validate_player_bootstrap_target(&value)?;
    Ok(value)
}

fn validate_player_bootstrap_target(value: &PlayerBootstrapStatusQueryWireV1) -> Result<(), WireError> {
    if value.player_id.packed() == 0 {
        return Err(WireError::new("player-bootstrap-target", "zero player id is reserved"));
    }
    let mut writer = Writer::default();
    writer.string(&value.external_entity_id)?;
    writer.string(&value.actor_id)?;
    Ok(())
}

fn validate_player_bootstrap_status_v1(value: &PlayerBootstrapStatusWireV1) -> Result<(), WireError> {
    let successor = |previous: Option<u64>| previous.map_or(Some(1), |sequence| sequence.checked_add(1));
    if value.next_input_sequence != successor(value.last_input_sequence)
        || value.next_action_sequence != successor(value.last_action_sequence)
        || value.last_action_sequence == Some(0)
    {
        return Err(WireError::new(
            "player-bootstrap-cursor",
            "player status continuation is discontinuous",
        ));
    }
    if value.authoritative_flags & !RUNTIME_INPUT_FLAG_MASK_V1 != 0
        || value.last_applied_input.is_some_and(|input| input.selected_slot >= 9)
    {
        return Err(WireError::new(
            "player-bootstrap-input",
            "player status input flags or slot are invalid",
        ));
    }
    let applied_sequence = value.last_applied_input.map(|input| input.sequence);
    if (value.queued_inputs_empty && applied_sequence != value.last_input_sequence)
        || (!value.queued_inputs_empty
            && applied_sequence
                .is_some_and(|applied| value.last_input_sequence.is_none_or(|accepted| applied > accepted)))
    {
        return Err(WireError::new(
            "player-bootstrap-cursor",
            "last applied input contradicts the accepted input cursor",
        ));
    }
    if value
        .entity
        .as_ref()
        .is_some_and(|entity| entity.entity_id.packed() == 0)
        || value
            .runtime_player
            .as_ref()
            .is_some_and(|player| player.entity_id.packed() == 0)
        || value.world_view_binding.as_ref().is_some_and(|binding| {
            binding.player_id.packed() == 0
                || binding.entity_id.packed() == 0
                || binding.selected_slot >= 9
                || binding.back_slot.is_some_and(|slot| slot >= 8)
        })
    {
        return Err(WireError::new(
            "player-bootstrap-binding",
            "player status binding identity or slot geometry is invalid",
        ));
    }
    Ok(())
}

pub fn encode_player_bootstrap_status_v1(value: &PlayerBootstrapStatusWireV1) -> Result<Vec<u8>, WireError> {
    validate_player_bootstrap_status_v1(value)?;
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    writer.u64(value.world_authority_revision.epoch);
    writer.u64(value.world_authority_revision.mutation);
    writer.u64(value.world_authority_revision.residency);
    writer.u64(value.entity_authority_revision);
    writer.option_u64(value.next_sequence);
    writer.u64(value.tick);
    writer.u64(value.last_monotonic_time_us);
    writer.option_u64(value.last_input_sequence);
    writer.option_u64(value.next_input_sequence);
    writer.option_u64(value.last_action_sequence);
    writer.option_u64(value.next_action_sequence);
    writer.u8(value.authoritative_flags);
    writer.flag(value.last_applied_input.is_some());
    if let Some(input) = value.last_applied_input {
        write_runtime_input_frame(&mut writer, input);
    }
    writer.flag(value.queued_inputs_empty);
    writer.flag(value.entity.is_some());
    if let Some(entity) = &value.entity {
        writer.u64(entity.entity_id.packed());
        writer.u64(entity.entity_revision);
        writer.u8(entity.residency as u8);
        let record = encode_compatibility_record(&entity.record)
            .map_err(|error| WireError::new("player-bootstrap-entity", error.to_string()))?;
        writer.bytes(
            &record,
            blockwild_entity::MAX_ENTITY_AUTHORITY_SNAPSHOT_BYTES,
            "player bootstrap compatibility record",
        )?;
    }
    writer.flag(value.runtime_player.is_some());
    if let Some(player) = &value.runtime_player {
        writer.u64(player.entity_id.packed());
        let binding = encode_runtime_player_binding_v1(&player.binding)?;
        writer.bytes(&binding, MAX_DOMAIN_PAYLOAD_BYTES, "player bootstrap runtime binding")?;
    }
    writer.flag(value.world_view_binding.is_some());
    if let Some(binding) = &value.world_view_binding {
        write_player_inventory_binding(&mut writer, binding)?;
    }
    writer.flag(value.custody.is_some());
    if let Some(custody) = &value.custody {
        write_player_bootstrap_custody(&mut writer, custody)?;
    }
    wrap_schema(
        PLAYER_BOOTSTRAP_STATUS_RECEIPT_V1_MAGIC,
        PLAYER_BOOTSTRAP_STATUS_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_bootstrap_status_v1(bytes: &[u8]) -> Result<PlayerBootstrapStatusWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_BOOTSTRAP_STATUS_RECEIPT_V1_MAGIC,
        PLAYER_BOOTSTRAP_STATUS_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let request_payload_hash = reader.hash()?;
    let world_authority_revision = WorldAuthorityRevisionV1 {
        epoch: reader.u64()?,
        mutation: reader.u64()?,
        residency: reader.u64()?,
    };
    let entity_authority_revision = reader.u64()?;
    let next_sequence = reader.option_u64()?;
    let tick = reader.u64()?;
    let last_monotonic_time_us = reader.u64()?;
    let last_input_sequence = reader.option_u64()?;
    let next_input_sequence = reader.option_u64()?;
    let last_action_sequence = reader.option_u64()?;
    let next_action_sequence = reader.option_u64()?;
    let authoritative_flags = reader.u8()?;
    let last_applied_input = if reader.flag()? {
        Some(read_runtime_input_frame(&mut reader)?)
    } else {
        None
    };
    let queued_inputs_empty = reader.flag()?;
    let entity = if reader.flag()? {
        let entity_id = unpack_entity_id(reader.u64()?)?;
        let entity_revision = reader.u64()?;
        let residency = read_residency(&mut reader)?;
        let record = decode_compatibility_record(&reader.bytes(
            blockwild_entity::MAX_ENTITY_AUTHORITY_SNAPSHOT_BYTES,
            "player bootstrap compatibility record",
        )?)
        .map_err(|error| WireError::new("player-bootstrap-entity", error.to_string()))?;
        Some(PlayerBootstrapEntityWireV1 {
            entity_id,
            entity_revision,
            residency,
            record,
        })
    } else {
        None
    };
    let runtime_player = if reader.flag()? {
        let entity_id = unpack_entity_id(reader.u64()?)?;
        let binding = decode_runtime_player_binding_v1(
            &reader.bytes(MAX_DOMAIN_PAYLOAD_BYTES, "player bootstrap runtime binding")?,
        )?;
        Some(PlayerBootstrapRuntimePlayerWireV1 { entity_id, binding })
    } else {
        None
    };
    let world_view_binding = if reader.flag()? {
        Some(read_player_inventory_binding(&mut reader)?)
    } else {
        None
    };
    let custody = if reader.flag()? {
        Some(read_player_bootstrap_custody(&mut reader)?)
    } else {
        None
    };
    reader.finish()?;
    let value = PlayerBootstrapStatusWireV1 {
        request_payload_hash,
        world_authority_revision,
        entity_authority_revision,
        next_sequence,
        tick,
        last_monotonic_time_us,
        last_input_sequence,
        next_input_sequence,
        last_action_sequence,
        next_action_sequence,
        authoritative_flags,
        last_applied_input,
        queued_inputs_empty,
        entity,
        runtime_player,
        world_view_binding,
        custody,
    };
    validate_player_bootstrap_status_v1(&value)?;
    Ok(value)
}

pub fn encode_player_combat_bootstrap_status_query_v1(
    value: &PlayerBootstrapStatusQueryWireV1,
) -> Result<Vec<u8>, WireError> {
    validate_player_bootstrap_target(value)?;
    let mut writer = Writer::default();
    writer.string(&value.external_entity_id)?;
    writer.string(&value.actor_id)?;
    writer.u64(value.player_id.packed());
    wrap_schema(
        PLAYER_COMBAT_BOOTSTRAP_STATUS_V1_MAGIC,
        PLAYER_COMBAT_BOOTSTRAP_STATUS_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_combat_bootstrap_status_query_v1(
    bytes: &[u8],
) -> Result<PlayerBootstrapStatusQueryWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_COMBAT_BOOTSTRAP_STATUS_V1_MAGIC,
        PLAYER_COMBAT_BOOTSTRAP_STATUS_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = PlayerBootstrapStatusQueryWireV1 {
        external_entity_id: reader.string()?,
        actor_id: reader.string()?,
        player_id: {
            let packed = reader.u64()?;
            PlayerId::new(packed as u32, (packed >> 32) as u32)
        },
    };
    reader.finish()?;
    validate_player_bootstrap_target(&value)?;
    Ok(value)
}

pub fn encode_player_combat_bootstrap_status_v1(
    value: &PlayerCombatBootstrapStatusWireV1,
) -> Result<Vec<u8>, WireError> {
    validate_player_combat_bootstrap_status_v1(value)?;
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    writer.u64(value.entity_authority_revision);
    writer.u64(value.gameplay_sequence);
    writer.u64(value.gameplay_combat_revision);
    writer.hash(value.gameplay_state_hash);
    writer.u8(value.status as u8);
    writer.flag(value.blocker.is_some());
    if let Some(blocker) = value.blocker {
        writer.u8(blocker as u8);
    }
    writer.flag(value.combatant.is_some());
    if let Some(combatant) = &value.combatant {
        writer.string(&combatant.record_id)?;
        writer.option_string(combatant.owner_id.as_deref())?;
        writer.u64(combatant.revision);
        writer.option_u64(combatant.entity_id.map(EntityId::packed));
        writer.u8(combatant.vital_units as u8);
        writer.u32(combatant.health);
        writer.u32(combatant.max_health);
        writer.flag(combatant.alive);
        writer.flag(combatant.cross_domain_parity);
    }
    wrap_schema(
        PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_V1_MAGIC,
        PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_combat_bootstrap_status_v1(bytes: &[u8]) -> Result<PlayerCombatBootstrapStatusWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_V1_MAGIC,
        PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let request_payload_hash = reader.hash()?;
    let entity_authority_revision = reader.u64()?;
    let gameplay_sequence = reader.u64()?;
    let gameplay_combat_revision = reader.u64()?;
    let gameplay_state_hash = reader.hash()?;
    let status = match reader.u8()? {
        0 => PlayerCombatBootstrapStatusV1::Absent,
        1 => PlayerCombatBootstrapStatusV1::LegacyUnlinked,
        2 => PlayerCombatBootstrapStatusV1::ExactLinked,
        3 => PlayerCombatBootstrapStatusV1::Blocked,
        _ => {
            return Err(WireError::new(
                "player-combat-status",
                "unknown combat bootstrap status",
            ));
        }
    };
    let blocker = if reader.flag()? {
        Some(match reader.u8()? {
            1 => PlayerCombatBootstrapBlockerV1::LegacyUnlinkedRequiresExplicitMigration,
            2 => PlayerCombatBootstrapBlockerV1::DuplicateCombatClaim,
            3 => PlayerCombatBootstrapBlockerV1::MissingPlayerEntity,
            4 => PlayerCombatBootstrapBlockerV1::IncompletePlayerBinding,
            5 => PlayerCombatBootstrapBlockerV1::RecordIdentityConflict,
            6 => PlayerCombatBootstrapBlockerV1::EntityLinkConflict,
            7 => PlayerCombatBootstrapBlockerV1::OwnerConflict,
            8 => PlayerCombatBootstrapBlockerV1::VitalUnitConflict,
            9 => PlayerCombatBootstrapBlockerV1::VitalParityConflict,
            10 => PlayerCombatBootstrapBlockerV1::InvalidEntityVitals,
            _ => {
                return Err(WireError::new(
                    "player-combat-status",
                    "unknown combat bootstrap blocker",
                ));
            }
        })
    } else {
        None
    };
    let combatant = if reader.flag()? {
        Some(PlayerCombatantBootstrapWireV1 {
            record_id: reader.string()?,
            owner_id: reader.option_string()?,
            revision: reader.u64()?,
            entity_id: reader.option_u64()?.map(unpack_entity_id).transpose()?,
            vital_units: match reader.u8()? {
                0 => CombatVitalUnits::LegacyWholeHeartsV1,
                1 => CombatVitalUnits::MilliheartsV1,
                _ => return Err(WireError::new("player-combat-status", "unknown combat vital unit")),
            },
            health: reader.u32()?,
            max_health: reader.u32()?,
            alive: reader.flag()?,
            cross_domain_parity: reader.flag()?,
        })
    } else {
        None
    };
    reader.finish()?;
    let value = PlayerCombatBootstrapStatusWireV1 {
        request_payload_hash,
        entity_authority_revision,
        gameplay_sequence,
        gameplay_combat_revision,
        gameplay_state_hash,
        status,
        blocker,
        combatant,
    };
    validate_player_combat_bootstrap_status_v1(&value)?;
    Ok(value)
}

fn validate_player_combat_bootstrap_status_v1(value: &PlayerCombatBootstrapStatusWireV1) -> Result<(), WireError> {
    match (value.status, value.blocker, value.combatant.as_ref()) {
        (PlayerCombatBootstrapStatusV1::Absent, None, None) => {}
        (
            PlayerCombatBootstrapStatusV1::LegacyUnlinked,
            Some(PlayerCombatBootstrapBlockerV1::LegacyUnlinkedRequiresExplicitMigration),
            Some(combatant),
        ) if combatant.entity_id.is_none()
            && combatant.vital_units == CombatVitalUnits::LegacyWholeHeartsV1
            && !combatant.cross_domain_parity => {}
        (PlayerCombatBootstrapStatusV1::ExactLinked, None, Some(combatant))
            if combatant.entity_id.is_some()
                && combatant.vital_units == CombatVitalUnits::MilliheartsV1
                && combatant.cross_domain_parity => {}
        (PlayerCombatBootstrapStatusV1::Blocked, Some(_), _) => {}
        _ => {
            return Err(WireError::new(
                "player-combat-status",
                "combat bootstrap status, blocker, and record are inconsistent",
            ));
        }
    }
    if let Some(combatant) = &value.combatant {
        let mut writer = Writer::default();
        writer.string(&combatant.record_id)?;
        writer.option_string(combatant.owner_id.as_deref())?;
        if combatant.max_health == 0
            || combatant.health > combatant.max_health
            || ((combatant.vital_units != CombatVitalUnits::LegacyWholeHeartsV1 || combatant.entity_id.is_some())
                && combatant.alive != (combatant.health > 0))
            || (combatant.cross_domain_parity
                && (combatant.entity_id.is_none() || combatant.vital_units != CombatVitalUnits::MilliheartsV1))
        {
            return Err(WireError::new(
                "player-combat-status",
                "combat bootstrap record has invalid vital or entity fields",
            ));
        }
    }
    Ok(())
}

fn write_integrated_runtime_identity_v2(
    writer: &mut Writer,
    value: &IntegratedRuntimeIdentityV2,
) -> Result<(), WireError> {
    if [
        value.revision.epoch,
        value.revision.world,
        value.revision.entities,
        value.revision.gameplay,
        value.revision.persistence,
        value.revision.network,
        value.revision.simulation,
        value.tick,
    ]
    .into_iter()
    .any(|field| field > MAX_SAFE_U64)
    {
        return Err(WireError::new(
            "context-continuity-u64",
            "context continuity identity exceeds the JavaScript-safe u64 range",
        ));
    }
    writer.u16(value.schema_version);
    writer.string(&value.universe_id)?;
    writer.string(&value.location_id)?;
    writer.u64(value.revision.epoch);
    writer.u64(value.revision.world);
    writer.u64(value.revision.entities);
    writer.u64(value.revision.gameplay);
    writer.u64(value.revision.persistence);
    writer.u64(value.revision.network);
    writer.u64(value.revision.simulation);
    writer.u64(value.tick);
    writer.hash(value.state_hash);
    Ok(())
}

fn read_integrated_runtime_identity_v2(reader: &mut Reader<'_>) -> Result<IntegratedRuntimeIdentityV2, WireError> {
    let schema_version = reader.u16()?;
    if schema_version != crate::INTEGRATED_RUNTIME_SCHEMA_V2 {
        return Err(WireError::new(
            "context-continuity-identity",
            "context continuity identity uses an unsupported runtime schema",
        ));
    }
    let value = IntegratedRuntimeIdentityV2 {
        schema_version,
        universe_id: reader.string()?,
        location_id: reader.string()?,
        revision: IntegratedRuntimeRevisionV2 {
            epoch: reader.u64()?,
            world: reader.u64()?,
            entities: reader.u64()?,
            gameplay: reader.u64()?,
            persistence: reader.u64()?,
            network: reader.u64()?,
            simulation: reader.u64()?,
        },
        tick: reader.u64()?,
        state_hash: reader.hash()?,
    };
    if [
        value.revision.epoch,
        value.revision.world,
        value.revision.entities,
        value.revision.gameplay,
        value.revision.persistence,
        value.revision.network,
        value.revision.simulation,
        value.tick,
    ]
    .into_iter()
    .any(|field| field > MAX_SAFE_U64)
    {
        return Err(WireError::new(
            "context-continuity-u64",
            "context continuity identity exceeds the JavaScript-safe u64 range",
        ));
    }
    Ok(value)
}

pub fn encode_runtime_context_command_continuity_query_v2(
    value: &RuntimeContextCommandContinuityQueryWireV2,
) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    write_integrated_runtime_identity_v2(&mut writer, &value.expected)?;
    wrap_schema(
        CONTEXT_COMMAND_CONTINUITY_V2_MAGIC,
        CONTEXT_COMMAND_CONTINUITY_V2_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_context_command_continuity_query_v2(
    bytes: &[u8],
) -> Result<RuntimeContextCommandContinuityQueryWireV2, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        CONTEXT_COMMAND_CONTINUITY_V2_MAGIC,
        CONTEXT_COMMAND_CONTINUITY_V2_INNER_SCHEMA,
        bytes,
    )?);
    let value = RuntimeContextCommandContinuityQueryWireV2 {
        expected: read_integrated_runtime_identity_v2(&mut reader)?,
    };
    reader.finish()?;
    Ok(value)
}

pub fn encode_runtime_context_command_continuity_receipt_v2(
    value: &RuntimeContextCommandContinuityReceiptWireV2,
) -> Result<Vec<u8>, WireError> {
    let expected_next = value.last_sequence.map_or(Some(1), |sequence| {
        sequence.checked_add(1).filter(|next| *next <= MAX_SAFE_U64)
    });
    if value.next_sequence != expected_next
        || value
            .last_sequence
            .is_some_and(|sequence| sequence == 0 || sequence > MAX_SAFE_U64)
    {
        return Err(WireError::new(
            "context-continuity-cursor",
            "context command continuity receipt is discontinuous",
        ));
    }
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    write_integrated_runtime_identity_v2(&mut writer, &value.identity)?;
    writer.option_u64(value.last_sequence);
    writer.option_u64(value.next_sequence);
    writer.flag(value.queued_commands_empty);
    wrap_schema(
        CONTEXT_COMMAND_CONTINUITY_RECEIPT_V2_MAGIC,
        CONTEXT_COMMAND_CONTINUITY_RECEIPT_V2_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_context_command_continuity_receipt_v2(
    bytes: &[u8],
) -> Result<RuntimeContextCommandContinuityReceiptWireV2, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        CONTEXT_COMMAND_CONTINUITY_RECEIPT_V2_MAGIC,
        CONTEXT_COMMAND_CONTINUITY_RECEIPT_V2_INNER_SCHEMA,
        bytes,
    )?);
    let value = RuntimeContextCommandContinuityReceiptWireV2 {
        request_payload_hash: reader.hash()?,
        identity: read_integrated_runtime_identity_v2(&mut reader)?,
        last_sequence: reader.option_u64()?,
        next_sequence: reader.option_u64()?,
        queued_commands_empty: reader.flag()?,
    };
    reader.finish()?;
    encode_runtime_context_command_continuity_receipt_v2(&value)?;
    Ok(value)
}

pub fn encode_runtime_basic_dirt_action_receipt_query_v1(
    value: &RuntimeBasicDirtActionReceiptQueryWireV1,
) -> Result<Vec<u8>, WireError> {
    if value.after_sequence > MAX_SAFE_U64 {
        return Err(WireError::new(
            "basic-dirt-action-query-cursor",
            "basic Dirt action query cursor exceeds the JavaScript-safe range",
        ));
    }
    let mut writer = Writer::default();
    write_integrated_runtime_identity_v2(&mut writer, &value.expected)?;
    writer.u64(value.after_sequence);
    wrap_schema(
        BASIC_DIRT_ACTION_RECEIPT_V1_MAGIC,
        BASIC_DIRT_ACTION_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_basic_dirt_action_receipt_query_v1(
    bytes: &[u8],
) -> Result<RuntimeBasicDirtActionReceiptQueryWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        BASIC_DIRT_ACTION_RECEIPT_V1_MAGIC,
        BASIC_DIRT_ACTION_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = RuntimeBasicDirtActionReceiptQueryWireV1 {
        expected: read_integrated_runtime_identity_v2(&mut reader)?,
        after_sequence: reader.u64()?,
    };
    reader.finish()?;
    if value.after_sequence > MAX_SAFE_U64 {
        return Err(WireError::new(
            "basic-dirt-action-query-cursor",
            "basic Dirt action query cursor exceeds the JavaScript-safe range",
        ));
    }
    Ok(value)
}

pub fn encode_runtime_basic_dirt_action_projection_receipt_v1(
    value: &RuntimeBasicDirtActionProjectionReceiptWireV1,
) -> Result<Vec<u8>, WireError> {
    validate_runtime_basic_dirt_action_projection_receipt_v1(value)?;
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    write_integrated_runtime_identity_v2(&mut writer, &value.identity)?;
    writer.u64(value.cursor_after);
    writer.flag(value.receipt.is_some());
    if let Some(receipt) = &value.receipt {
        write_runtime_basic_dirt_action_projection_v1(&mut writer, receipt)?;
    }
    wrap_schema(
        BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_MAGIC,
        BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_basic_dirt_action_projection_receipt_v1(
    bytes: &[u8],
) -> Result<RuntimeBasicDirtActionProjectionReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_MAGIC,
        BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let request_payload_hash = reader.hash()?;
    let identity = read_integrated_runtime_identity_v2(&mut reader)?;
    let cursor_after = reader.u64()?;
    let receipt = if reader.flag()? {
        Some(read_runtime_basic_dirt_action_projection_v1(&mut reader)?)
    } else {
        None
    };
    reader.finish()?;
    let value = RuntimeBasicDirtActionProjectionReceiptWireV1 {
        request_payload_hash,
        identity,
        cursor_after,
        receipt,
    };
    validate_runtime_basic_dirt_action_projection_receipt_v1(&value)?;
    Ok(value)
}

fn validate_runtime_basic_dirt_action_projection_receipt_v1(
    value: &RuntimeBasicDirtActionProjectionReceiptWireV1,
) -> Result<(), WireError> {
    if value.cursor_after > MAX_SAFE_U64 {
        return Err(WireError::new(
            "basic-dirt-action-projection-cursor",
            "basic Dirt action projection cursor exceeds the JavaScript-safe range",
        ));
    }
    if let Some(receipt) = &value.receipt {
        if receipt.sequence != value.cursor_after {
            return Err(WireError::new(
                "basic-dirt-action-projection-cursor",
                "basic Dirt action projection cursor does not equal its receipt sequence",
            ));
        }
        receipt
            .native_receipt_v1()
            .validate_shape_v1()
            .map_err(|error| WireError::new("basic-dirt-action-projection-native", error.message))?;
        for drop in &receipt.generated_drops {
            validate_runtime_basic_dirt_generated_drop_projection_v1(drop)?;
        }
    }
    Ok(())
}

fn validate_runtime_basic_dirt_generated_drop_projection_v1(
    value: &RuntimeBasicDirtGeneratedDropProjectionWireV1,
) -> Result<(), WireError> {
    value
        .provenance
        .validate_v1()
        .map_err(|error| WireError::new("basic-dirt-action-projection-provenance", error.message))?;
    if value.entity_id.packed() == 0
        || value.stack.item_code == 0
        || value.stack.count == 0
        || value.stack.count > blockwild_gameplay::MAX_ITEM_STACK
        || value
            .stack
            .durability_millionths
            .is_some_and(|durability| durability > 1_000_000)
    {
        return Err(WireError::new(
            "basic-dirt-action-projection-drop",
            "basic Dirt generated-drop projection has invalid identity or stack fields",
        ));
    }
    if [value.position.x_milli, value.position.y_milli, value.position.z_milli]
        .into_iter()
        .any(|component| component.unsigned_abs() > blockwild_gameplay::WORLD_VIEW_COORDINATE_LIMIT_MILLI_V1 as u64)
        || [
            value.velocity_milli_per_second.x_milli,
            value.velocity_milli_per_second.y_milli,
            value.velocity_milli_per_second.z_milli,
        ]
        .into_iter()
        .any(|component| {
            component.unsigned_abs() > blockwild_gameplay::WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND_V1 as u64
        })
        || [value.rotation.yaw, value.rotation.pitch, value.rotation.roll]
            .into_iter()
            .any(|component| component >= blockwild_gameplay::WORLD_VIEW_FRACTION_SCALE_V1)
    {
        return Err(WireError::new(
            "basic-dirt-action-projection-spatial",
            "basic Dirt generated-drop projection is outside fixed-point spatial bounds",
        ));
    }
    Ok(())
}

fn write_runtime_basic_dirt_action_projection_v1(
    writer: &mut Writer,
    value: &RuntimeBasicDirtActionProjectionWireV1,
) -> Result<(), WireError> {
    writer.u16(value.schema_version);
    writer.u64(value.sequence);
    writer.u64(value.origin_input_sequence);
    writer.u64(value.completion_tick);
    writer.u8(value.action as u8);
    writer.i32(value.position.x);
    writer.i32(value.position.y);
    writer.i32(value.position.z);
    writer.u16(value.prior_block_id);
    writer.u16(value.replacement_block_id);
    write_world_authority_revision_v1(writer, value.before_world_revision);
    write_world_authority_revision_v1(writer, value.after_world_revision);
    writer.hash(value.before_world_hash);
    writer.hash(value.after_world_hash);
    writer.flag(value.creative_mode);
    write_container_key(writer, &value.inventory.container)?;
    writer.u16(value.inventory.slot);
    writer.u64(value.inventory.before_revision);
    writer.u64(value.inventory.after_revision);
    write_optional_item_stack(writer, &value.inventory.before_stack);
    write_optional_item_stack(writer, &value.inventory.after_stack);
    writer.count(
        value.generated_drops.len(),
        blockwild_gameplay::MAX_BLOCK_ACTION_GENERATED_DROPS_V1,
        "basic Dirt generated-drop projection count",
    )?;
    for drop in &value.generated_drops {
        write_generated_drop_provenance_v1(writer, &drop.provenance);
        writer.u64(drop.entity_id.packed());
        write_item_stack(writer, &drop.stack);
        write_fixed_world_vec3_v1(writer, drop.position);
        write_fixed_world_vec3_v1(writer, drop.velocity_milli_per_second);
        writer.u32(drop.rotation.yaw);
        writer.u32(drop.rotation.pitch);
        writer.u32(drop.rotation.roll);
    }
    writer.hash(value.content.manifest_hash);
    writer.hash(value.content.installed_registry_hash);
    writer.u16(value.content.catalog_schema_version);
    writer.u32(value.content.catalog_content_version);
    writer.hash(value.content.catalog_blob_hash);
    writer.hash(value.content.action_report_hash);
    writer.hash(value.content.subset_hash);
    writer.hash(value.receipt_hash);
    Ok(())
}

fn read_runtime_basic_dirt_action_projection_v1(
    reader: &mut Reader<'_>,
) -> Result<RuntimeBasicDirtActionProjectionWireV1, WireError> {
    let schema_version = reader.u16()?;
    let sequence = reader.u64()?;
    let origin_input_sequence = reader.u64()?;
    let completion_tick = reader.u64()?;
    let action = match reader.u8()? {
        0 => IntegratedRuntimeBasicDirtActionKindV1::Mine,
        1 => IntegratedRuntimeBasicDirtActionKindV1::Place,
        _ => {
            return Err(WireError::new(
                "basic-dirt-action-projection-action",
                "basic Dirt action projection uses an unknown action tag",
            ));
        }
    };
    let position = blockwild_authority::CellPositionV1 {
        x: reader.i32()?,
        y: reader.i32()?,
        z: reader.i32()?,
    };
    let prior_block_id = reader.u16()?;
    let replacement_block_id = reader.u16()?;
    let before_world_revision = read_world_authority_revision_v1(reader)?;
    let after_world_revision = read_world_authority_revision_v1(reader)?;
    let before_world_hash = reader.hash()?;
    let after_world_hash = reader.hash()?;
    let creative_mode = reader.flag()?;
    let inventory = crate::IntegratedRuntimeBasicDirtInventoryDeltaV1 {
        container: read_container_key(reader)?,
        slot: reader.u16()?,
        before_revision: reader.u64()?,
        after_revision: reader.u64()?,
        before_stack: read_optional_item_stack(reader)?,
        after_stack: read_optional_item_stack(reader)?,
    };
    let drop_count = reader.count(
        blockwild_gameplay::MAX_BLOCK_ACTION_GENERATED_DROPS_V1,
        "basic Dirt generated-drop projection count",
    )?;
    let mut generated_drops = Vec::with_capacity(drop_count);
    for _ in 0..drop_count {
        generated_drops.push(RuntimeBasicDirtGeneratedDropProjectionWireV1 {
            provenance: read_generated_drop_provenance_v1(reader)?,
            entity_id: entity_id_from_packed(reader.u64()?),
            stack: read_item_stack(reader)?,
            position: read_fixed_world_vec3_v1(reader)?,
            velocity_milli_per_second: read_fixed_world_vec3_v1(reader)?,
            rotation: RotationMicroturnsV1 {
                yaw: reader.u32()?,
                pitch: reader.u32()?,
                roll: reader.u32()?,
            },
        });
    }
    Ok(RuntimeBasicDirtActionProjectionWireV1 {
        schema_version,
        sequence,
        origin_input_sequence,
        completion_tick,
        action,
        position,
        prior_block_id,
        replacement_block_id,
        before_world_revision,
        after_world_revision,
        before_world_hash,
        after_world_hash,
        creative_mode,
        inventory,
        generated_drops,
        content: IntegratedRuntimeBasicDirtActionContentBindingV1 {
            manifest_hash: reader.hash()?,
            installed_registry_hash: reader.hash()?,
            catalog_schema_version: reader.u16()?,
            catalog_content_version: reader.u32()?,
            catalog_blob_hash: reader.hash()?,
            action_report_hash: reader.hash()?,
            subset_hash: reader.hash()?,
        },
        receipt_hash: reader.hash()?,
    })
}

pub fn encode_runtime_native_block_edit_receipt_query_v1(
    value: &RuntimeNativeBlockEditReceiptQueryWireV1,
) -> Result<Vec<u8>, WireError> {
    if value.after_sequence > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-block-edit-query-cursor",
            "native block edit query cursor exceeds the JavaScript-safe range",
        ));
    }
    let mut writer = Writer::default();
    write_integrated_runtime_identity_v2(&mut writer, &value.expected)?;
    writer.u64(value.after_sequence);
    wrap_schema(
        NATIVE_BLOCK_EDIT_RECEIPT_V1_MAGIC,
        NATIVE_BLOCK_EDIT_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_native_block_edit_receipt_query_v1(
    bytes: &[u8],
) -> Result<RuntimeNativeBlockEditReceiptQueryWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NATIVE_BLOCK_EDIT_RECEIPT_V1_MAGIC,
        NATIVE_BLOCK_EDIT_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = RuntimeNativeBlockEditReceiptQueryWireV1 {
        expected: read_integrated_runtime_identity_v2(&mut reader)?,
        after_sequence: reader.u64()?,
    };
    reader.finish()?;
    if value.after_sequence > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-block-edit-query-cursor",
            "native block edit query cursor exceeds the JavaScript-safe range",
        ));
    }
    Ok(value)
}

pub fn encode_runtime_native_block_edit_projection_receipt_v1(
    value: &RuntimeNativeBlockEditProjectionReceiptWireV1,
) -> Result<Vec<u8>, WireError> {
    validate_runtime_native_block_edit_projection_receipt_v1(value)?;
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    write_integrated_runtime_identity_v2(&mut writer, &value.identity)?;
    writer.u64(value.cursor_after);
    writer.flag(value.receipt.is_some());
    if let Some(receipt) = &value.receipt {
        write_runtime_native_block_edit_receipt_v1(&mut writer, receipt)?;
    }
    wrap_schema(
        NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V1_MAGIC,
        NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_native_block_edit_projection_receipt_v1(
    bytes: &[u8],
) -> Result<RuntimeNativeBlockEditProjectionReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V1_MAGIC,
        NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let request_payload_hash = reader.hash()?;
    let identity = read_integrated_runtime_identity_v2(&mut reader)?;
    let cursor_after = reader.u64()?;
    let receipt = if reader.flag()? {
        Some(read_runtime_native_block_edit_receipt_v1(&mut reader)?)
    } else {
        None
    };
    reader.finish()?;
    let value = RuntimeNativeBlockEditProjectionReceiptWireV1 {
        request_payload_hash,
        identity,
        cursor_after,
        receipt,
    };
    validate_runtime_native_block_edit_projection_receipt_v1(&value)?;
    Ok(value)
}

fn validate_runtime_native_block_edit_projection_receipt_v1(
    value: &RuntimeNativeBlockEditProjectionReceiptWireV1,
) -> Result<(), WireError> {
    if value.cursor_after > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-block-edit-projection-cursor",
            "native block edit projection cursor exceeds the JavaScript-safe range",
        ));
    }
    if let Some(receipt) = &value.receipt {
        if receipt.sequence != value.cursor_after {
            return Err(WireError::new(
                "native-block-edit-projection-cursor",
                "native block edit projection cursor does not equal its receipt sequence",
            ));
        }
        receipt.validate_shape_v1().map_err(|error| {
            WireError::new(
                "native-block-edit-receipt",
                format!("{}: {}", error.code, error.message),
            )
        })?;
    }
    Ok(())
}

fn write_runtime_native_block_edit_receipt_v1(
    writer: &mut Writer,
    receipt: &IntegratedRuntimeNativeBlockEditReceiptV1,
) -> Result<(), WireError> {
    receipt.validate_shape_v1().map_err(|error| {
        WireError::new(
            "native-block-edit-receipt",
            format!("{}: {}", error.code, error.message),
        )
    })?;
    writer.u16(receipt.schema_version);
    writer.u64(receipt.sequence);
    writer.u64(receipt.origin_input_sequence);
    writer.u64(receipt.completion_tick);
    writer.u8(receipt.action as u8);
    writer.i32(receipt.position.x);
    writer.i32(receipt.position.y);
    writer.i32(receipt.position.z);
    writer.u16(receipt.prior_block_id);
    writer.u8(receipt.prior_facing);
    writer.u16(receipt.replacement_block_id);
    writer.u8(receipt.replacement_facing);
    write_world_authority_revision_v1(writer, receipt.before_world_revision);
    write_world_authority_revision_v1(writer, receipt.after_world_revision);
    writer.hash(receipt.before_world_hash);
    writer.hash(receipt.after_world_hash);
    writer.flag(receipt.creative_mode);
    write_container_key(writer, &receipt.inventory.container)?;
    writer.u16(receipt.inventory.selected_slot);
    writer.u64(receipt.inventory.before_revision);
    writer.u64(receipt.inventory.after_revision);
    write_optional_item_stack(writer, &receipt.inventory.before_stack);
    write_optional_item_stack(writer, &receipt.inventory.after_stack);
    writer.count(
        receipt.generated_drops.len(),
        blockwild_gameplay::MAX_BLOCK_ACTION_GENERATED_DROPS_V1,
        "native block edit generated-drop count",
    )?;
    for generated in &receipt.generated_drops {
        write_generated_drop_provenance_v1(writer, &generated.provenance);
        writer.u64(generated.entity_id.packed());
        write_item_stack(writer, &generated.stack);
        write_fixed_world_vec3_v1(writer, generated.position);
        write_fixed_world_vec3_v1(writer, generated.velocity_milli_per_second);
        writer.u32(generated.rotation.yaw);
        writer.u32(generated.rotation.pitch);
        writer.u32(generated.rotation.roll);
    }
    writer.u16(receipt.content.block_id);
    writer.hash(receipt.content.manifest_hash);
    writer.hash(receipt.content.installed_registry_hash);
    writer.u16(receipt.content.catalog_schema_version);
    writer.u32(receipt.content.catalog_content_version);
    writer.hash(receipt.content.catalog_blob_hash);
    writer.hash(receipt.content.action_report_hash);
    writer.hash(receipt.content.subset_hash);
    writer.hash(receipt.receipt_hash);
    Ok(())
}

fn read_runtime_native_block_edit_receipt_v1(
    reader: &mut Reader<'_>,
) -> Result<IntegratedRuntimeNativeBlockEditReceiptV1, WireError> {
    let schema_version = reader.u16()?;
    let sequence = reader.u64()?;
    let origin_input_sequence = reader.u64()?;
    let completion_tick = reader.u64()?;
    let action = match reader.u8()? {
        0 => IntegratedRuntimeNativeBlockEditActionKindV1::Mine,
        1 => IntegratedRuntimeNativeBlockEditActionKindV1::Place,
        _ => {
            return Err(WireError::new(
                "native-block-edit-action",
                "native block edit projection uses an unknown action tag",
            ));
        }
    };
    let position = blockwild_authority::CellPositionV1 {
        x: reader.i32()?,
        y: reader.i32()?,
        z: reader.i32()?,
    };
    let prior_block_id = reader.u16()?;
    let prior_facing = reader.u8()?;
    let replacement_block_id = reader.u16()?;
    let replacement_facing = reader.u8()?;
    let before_world_revision = read_world_authority_revision_v1(reader)?;
    let after_world_revision = read_world_authority_revision_v1(reader)?;
    let before_world_hash = reader.hash()?;
    let after_world_hash = reader.hash()?;
    let creative_mode = reader.flag()?;
    let inventory = IntegratedRuntimeNativeBlockEditInventoryDeltaV1 {
        container: read_container_key(reader)?,
        selected_slot: reader.u16()?,
        before_revision: reader.u64()?,
        after_revision: reader.u64()?,
        before_stack: read_optional_item_stack(reader)?,
        after_stack: read_optional_item_stack(reader)?,
    };
    let drop_count = reader.count(
        blockwild_gameplay::MAX_BLOCK_ACTION_GENERATED_DROPS_V1,
        "native block edit generated-drop count",
    )?;
    let mut generated_drops = Vec::with_capacity(drop_count);
    for _ in 0..drop_count {
        generated_drops.push(IntegratedRuntimeNativeBlockEditGeneratedDropV1 {
            provenance: read_generated_drop_provenance_v1(reader)?,
            entity_id: entity_id_from_packed(reader.u64()?),
            stack: read_item_stack(reader)?,
            position: read_fixed_world_vec3_v1(reader)?,
            velocity_milli_per_second: read_fixed_world_vec3_v1(reader)?,
            rotation: RotationMicroturnsV1 {
                yaw: reader.u32()?,
                pitch: reader.u32()?,
                roll: reader.u32()?,
            },
        });
    }
    let receipt = IntegratedRuntimeNativeBlockEditReceiptV1 {
        schema_version,
        sequence,
        origin_input_sequence,
        completion_tick,
        action,
        position,
        prior_block_id,
        prior_facing,
        replacement_block_id,
        replacement_facing,
        before_world_revision,
        after_world_revision,
        before_world_hash,
        after_world_hash,
        creative_mode,
        inventory,
        generated_drops,
        content: IntegratedRuntimeNativeBlockEditContentBindingV1 {
            block_id: reader.u16()?,
            manifest_hash: reader.hash()?,
            installed_registry_hash: reader.hash()?,
            catalog_schema_version: reader.u16()?,
            catalog_content_version: reader.u32()?,
            catalog_blob_hash: reader.hash()?,
            action_report_hash: reader.hash()?,
            subset_hash: reader.hash()?,
        },
        receipt_hash: reader.hash()?,
    };
    receipt.validate_shape_v1().map_err(|error| {
        WireError::new(
            "native-block-edit-receipt",
            format!("{}: {}", error.code, error.message),
        )
    })?;
    Ok(receipt)
}

pub fn encode_runtime_native_block_edit_receipt_query_v2(
    value: &RuntimeNativeBlockEditReceiptQueryWireV2,
) -> Result<Vec<u8>, WireError> {
    if value.after_sequence > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-block-edit-v2-query-cursor",
            "native block edit V2 query cursor exceeds the JavaScript-safe range",
        ));
    }
    let mut writer = Writer::default();
    write_integrated_runtime_identity_v2(&mut writer, &value.expected)?;
    writer.u64(value.after_sequence);
    wrap_schema(
        NATIVE_BLOCK_EDIT_RECEIPT_V2_MAGIC,
        NATIVE_BLOCK_EDIT_RECEIPT_V2_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_native_block_edit_receipt_query_v2(
    bytes: &[u8],
) -> Result<RuntimeNativeBlockEditReceiptQueryWireV2, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NATIVE_BLOCK_EDIT_RECEIPT_V2_MAGIC,
        NATIVE_BLOCK_EDIT_RECEIPT_V2_INNER_SCHEMA,
        bytes,
    )?);
    let value = RuntimeNativeBlockEditReceiptQueryWireV2 {
        expected: read_integrated_runtime_identity_v2(&mut reader)?,
        after_sequence: reader.u64()?,
    };
    reader.finish()?;
    if value.after_sequence > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-block-edit-v2-query-cursor",
            "native block edit V2 query cursor exceeds the JavaScript-safe range",
        ));
    }
    Ok(value)
}

pub fn encode_runtime_native_block_edit_projection_receipt_v2(
    value: &RuntimeNativeBlockEditProjectionReceiptWireV2,
) -> Result<Vec<u8>, WireError> {
    validate_runtime_native_block_edit_projection_receipt_v2(value)?;
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    write_integrated_runtime_identity_v2(&mut writer, &value.identity)?;
    writer.u64(value.cursor_after);
    writer.flag(value.receipt.is_some());
    if let Some(receipt) = &value.receipt {
        write_runtime_native_block_edit_receipt_v1(&mut writer, receipt)?;
    }
    writer.flag(value.dirty_evidence.is_some());
    if let Some(evidence) = &value.dirty_evidence {
        write_runtime_native_block_edit_dirty_evidence_v1(&mut writer, evidence)?;
    }
    wrap_schema(
        NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V2_MAGIC,
        NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V2_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_native_block_edit_projection_receipt_v2(
    bytes: &[u8],
) -> Result<RuntimeNativeBlockEditProjectionReceiptWireV2, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V2_MAGIC,
        NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V2_INNER_SCHEMA,
        bytes,
    )?);
    let request_payload_hash = reader.hash()?;
    let identity = read_integrated_runtime_identity_v2(&mut reader)?;
    let cursor_after = reader.u64()?;
    let receipt = if reader.flag()? {
        Some(read_runtime_native_block_edit_receipt_v1(&mut reader)?)
    } else {
        None
    };
    let dirty_evidence = if reader.flag()? {
        Some(read_runtime_native_block_edit_dirty_evidence_v1(&mut reader)?)
    } else {
        None
    };
    reader.finish()?;
    let value = RuntimeNativeBlockEditProjectionReceiptWireV2 {
        request_payload_hash,
        identity,
        cursor_after,
        receipt,
        dirty_evidence,
    };
    validate_runtime_native_block_edit_projection_receipt_v2(&value)?;
    Ok(value)
}

fn validate_runtime_native_block_edit_projection_receipt_v2(
    value: &RuntimeNativeBlockEditProjectionReceiptWireV2,
) -> Result<(), WireError> {
    if value.cursor_after > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-block-edit-v2-projection-cursor",
            "native block edit V2 projection cursor exceeds the JavaScript-safe range",
        ));
    }
    match (&value.receipt, &value.dirty_evidence) {
        (Some(receipt), dirty_evidence) => {
            if receipt.sequence != value.cursor_after {
                return Err(WireError::new(
                    "native-block-edit-v2-projection-cursor",
                    "native block edit V2 projection cursor does not equal its V1 receipt sequence",
                ));
            }
            receipt.validate_shape_v1().map_err(|error| {
                WireError::new(
                    "native-block-edit-v2-receipt",
                    format!("{}: {}", error.code, error.message),
                )
            })?;
            if let Some(evidence) = dirty_evidence {
                evidence.validate_shape_v1(receipt).map_err(|error| {
                    WireError::new(
                        "native-block-edit-v2-dirty-evidence",
                        format!("{}: {}", error.code, error.message),
                    )
                })?;
            }
        }
        (None, Some(_)) => {
            return Err(WireError::new(
                "native-block-edit-v2-dirty-orphan",
                "native block edit dirty evidence cannot be projected without its complete V1 receipt",
            ));
        }
        (None, None) => {}
    }
    Ok(())
}

fn write_runtime_native_block_edit_dirty_evidence_v1(
    writer: &mut Writer,
    evidence: &IntegratedRuntimeNativeBlockEditDirtyEvidenceV1,
) -> Result<(), WireError> {
    writer.u16(evidence.schema_version);
    writer.u64(evidence.sequence);
    writer.hash(evidence.receipt_hash);
    writer.count(evidence.sections.len(), 7, "native block edit dirty section count")?;
    for section in &evidence.sections {
        writer.string(&section.world.universe_id)?;
        writer.string(&section.world.location_id)?;
        writer.i32(section.chunk_x);
        writer.i32(section.chunk_z);
        writer.i16(section.section_y);
    }
    writer.count(evidence.columns.len(), 1, "native block edit dirty column count")?;
    for (x, z) in &evidence.columns {
        writer.i32(*x);
        writer.i32(*z);
    }
    writer.count(
        evidence.subsystem_seeds.len(),
        7,
        "native block edit dirty subsystem seed count",
    )?;
    for seed in &evidence.subsystem_seeds {
        writer.u8(dirty_subsystem_tag_v1(seed.subsystem) as u8);
        writer.string(&seed.seed)?;
    }
    writer.hash(evidence.evidence_hash);
    Ok(())
}

fn read_runtime_native_block_edit_dirty_evidence_v1(
    reader: &mut Reader<'_>,
) -> Result<IntegratedRuntimeNativeBlockEditDirtyEvidenceV1, WireError> {
    let schema_version = reader.u16()?;
    let sequence = reader.u64()?;
    let receipt_hash = reader.hash()?;
    let section_count = reader.count(7, "native block edit dirty section count")?;
    let mut sections = Vec::with_capacity(section_count);
    for _ in 0..section_count {
        let world = AuthorityWorldAddressV1::new(reader.string()?, reader.string()?)
            .map_err(|error| WireError::new(error.code, error.message))?;
        sections.push(WorldSectionAddressV1 {
            world,
            chunk_x: reader.i32()?,
            chunk_z: reader.i32()?,
            section_y: reader.i16()?,
        });
    }
    let column_count = reader.count(1, "native block edit dirty column count")?;
    let mut columns = Vec::with_capacity(column_count);
    for _ in 0..column_count {
        columns.push((reader.i32()?, reader.i32()?));
    }
    let seed_count = reader.count(7, "native block edit dirty subsystem seed count")?;
    let mut subsystem_seeds = Vec::with_capacity(seed_count);
    for _ in 0..seed_count {
        subsystem_seeds.push(DirtySubsystemSeedV1 {
            subsystem: dirty_subsystem_from_tag_v1(reader.u8()?)
                .map_err(|error| WireError::new("native-block-edit-dirty-subsystem-tag", error.message))?,
            seed: reader.string()?,
        });
    }
    Ok(IntegratedRuntimeNativeBlockEditDirtyEvidenceV1 {
        schema_version,
        sequence,
        receipt_hash,
        sections,
        columns,
        subsystem_seeds,
        evidence_hash: reader.hash()?,
    })
}

pub fn encode_runtime_native_player_drop_receipt_query_v1(
    value: &RuntimeNativePlayerDropReceiptQueryWireV1,
) -> Result<Vec<u8>, WireError> {
    if value.after_sequence > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-player-drop-query-cursor",
            "native player drop query cursor exceeds the JavaScript-safe range",
        ));
    }
    let mut writer = Writer::default();
    write_integrated_runtime_identity_v2(&mut writer, &value.expected)?;
    writer.u64(value.after_sequence);
    wrap_schema(
        NATIVE_PLAYER_DROP_RECEIPT_V1_MAGIC,
        NATIVE_PLAYER_DROP_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_native_player_drop_receipt_query_v1(
    bytes: &[u8],
) -> Result<RuntimeNativePlayerDropReceiptQueryWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NATIVE_PLAYER_DROP_RECEIPT_V1_MAGIC,
        NATIVE_PLAYER_DROP_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = RuntimeNativePlayerDropReceiptQueryWireV1 {
        expected: read_integrated_runtime_identity_v2(&mut reader)?,
        after_sequence: reader.u64()?,
    };
    reader.finish()?;
    if value.after_sequence > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-player-drop-query-cursor",
            "native player drop query cursor exceeds the JavaScript-safe range",
        ));
    }
    Ok(value)
}

pub fn encode_runtime_native_player_drop_projection_receipt_v1(
    value: &RuntimeNativePlayerDropProjectionReceiptWireV1,
) -> Result<Vec<u8>, WireError> {
    validate_runtime_native_player_drop_projection_receipt_v1(value)?;
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    write_integrated_runtime_identity_v2(&mut writer, &value.identity)?;
    writer.u64(value.cursor_after);
    writer.flag(value.receipt.is_some());
    if let Some(receipt) = &value.receipt {
        write_runtime_native_player_drop_receipt_v1(&mut writer, receipt)?;
    }
    wrap_schema(
        NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_V1_MAGIC,
        NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_native_player_drop_projection_receipt_v1(
    bytes: &[u8],
) -> Result<RuntimeNativePlayerDropProjectionReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_V1_MAGIC,
        NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let request_payload_hash = reader.hash()?;
    let identity = read_integrated_runtime_identity_v2(&mut reader)?;
    let cursor_after = reader.u64()?;
    let receipt = if reader.flag()? {
        Some(read_runtime_native_player_drop_receipt_v1(&mut reader)?)
    } else {
        None
    };
    reader.finish()?;
    let value = RuntimeNativePlayerDropProjectionReceiptWireV1 {
        request_payload_hash,
        identity,
        cursor_after,
        receipt,
    };
    validate_runtime_native_player_drop_projection_receipt_v1(&value)?;
    Ok(value)
}

fn validate_runtime_native_player_drop_projection_receipt_v1(
    value: &RuntimeNativePlayerDropProjectionReceiptWireV1,
) -> Result<(), WireError> {
    if value.cursor_after > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-player-drop-projection-cursor",
            "native player drop projection cursor exceeds the JavaScript-safe range",
        ));
    }
    if let Some(receipt) = &value.receipt {
        if receipt.sequence != value.cursor_after {
            return Err(WireError::new(
                "native-player-drop-projection-cursor",
                "native player drop projection cursor does not equal its receipt sequence",
            ));
        }
        receipt
            .validate_shape_v1()
            .map_err(|error| WireError::new("native-player-drop-projection-native", error.message))?;
    }
    Ok(())
}

fn write_runtime_native_player_drop_receipt_v1(
    writer: &mut Writer,
    receipt: &IntegratedRuntimeNativePlayerDropReceiptV1,
) -> Result<(), WireError> {
    writer.u16(receipt.schema_version);
    writer.u64(receipt.sequence);
    writer.u64(receipt.origin_input_sequence);
    writer.u64(receipt.completion_tick);
    writer.string(&receipt.world.universe)?;
    writer.string(&receipt.world.location)?;
    write_world_authority_revision_v1(writer, receipt.world_revision);
    writer.hash(receipt.world_state_hash);
    writer.u64(receipt.player_id.packed());
    writer.u64(receipt.player_entity_id.packed());
    write_container_key(writer, &receipt.inventory.container)?;
    writer.u16(receipt.inventory.selected_slot);
    writer.u64(receipt.inventory.before_revision);
    writer.u64(receipt.inventory.after_revision);
    write_optional_item_stack(writer, &receipt.inventory.before_stack);
    write_optional_item_stack(writer, &receipt.inventory.after_stack);
    writer.string(&receipt.drop.drop_id)?;
    writer.u64(receipt.drop.entity_id.packed());
    write_item_stack(writer, &receipt.drop.stack);
    write_container_key(writer, &receipt.drop.custody_container)?;
    writer.u16(receipt.drop.custody_slot);
    writer.u64(receipt.drop.custody_revision);
    writer.u64(receipt.drop.spatial_revision);
    write_fixed_world_vec3_v1(writer, receipt.drop.position);
    write_fixed_world_vec3_v1(writer, receipt.drop.velocity_milli_per_second);
    writer.u32(receipt.drop.rotation.yaw);
    writer.u32(receipt.drop.rotation.pitch);
    writer.u32(receipt.drop.rotation.roll);
    writer.u64(receipt.drop.created_tick);
    writer.option_u64(receipt.drop.expires_tick);
    writer.flag(receipt.drop.pickup_lock_actor_id.is_some());
    if let Some(actor_id) = &receipt.drop.pickup_lock_actor_id {
        writer.string(actor_id)?;
    }
    writer.u64(receipt.drop.pickup_unlock_tick);
    writer.hash(receipt.drop.origin_hash);
    write_gameplay_revision_v1(writer, receipt.authority.before_gameplay_revision);
    writer.hash(receipt.authority.before_gameplay_hash);
    write_gameplay_revision_v1(writer, receipt.authority.after_gameplay_revision);
    writer.hash(receipt.authority.after_gameplay_hash);
    writer.u64(receipt.authority.before_entity_revision);
    writer.hash(receipt.authority.before_entity_hash);
    writer.u64(receipt.authority.after_entity_revision);
    writer.hash(receipt.authority.after_entity_hash);
    write_world_view_revision_v1(writer, receipt.authority.before_world_view_revision);
    writer.hash(receipt.authority.before_world_view_hash);
    write_world_view_revision_v1(writer, receipt.authority.after_world_view_revision);
    writer.hash(receipt.authority.after_world_view_hash);
    writer.hash(receipt.content.configured_manifest_hash);
    writer.hash(receipt.content.installed_manifest_hash);
    writer.hash(receipt.content.installed_registry_hash);
    writer.hash(receipt.content.item_content_hash);
    writer.u32(receipt.content.item_content_version);
    writer.hash(receipt.receipt_hash);
    Ok(())
}

fn read_runtime_native_player_drop_receipt_v1(
    reader: &mut Reader<'_>,
) -> Result<IntegratedRuntimeNativePlayerDropReceiptV1, WireError> {
    let schema_version = reader.u16()?;
    let sequence = reader.u64()?;
    let origin_input_sequence = reader.u64()?;
    let completion_tick = reader.u64()?;
    let world = WorldKey::new(reader.string()?, reader.string()?);
    let world_revision = read_world_authority_revision_v1(reader)?;
    let world_state_hash = reader.hash()?;
    let player_packed = reader.u64()?;
    let player_entity_packed = reader.u64()?;
    let inventory = IntegratedRuntimeNativePlayerDropInventoryDeltaV1 {
        container: read_container_key(reader)?,
        selected_slot: reader.u16()?,
        before_revision: reader.u64()?,
        after_revision: reader.u64()?,
        before_stack: read_optional_item_stack(reader)?,
        after_stack: read_optional_item_stack(reader)?,
    };
    let drop_id = reader.string()?;
    let drop_entity_packed = reader.u64()?;
    let stack = read_item_stack(reader)?;
    let custody_container = read_container_key(reader)?;
    let custody_slot = reader.u16()?;
    let custody_revision = reader.u64()?;
    let spatial_revision = reader.u64()?;
    let position = read_fixed_world_vec3_v1(reader)?;
    let velocity_milli_per_second = read_fixed_world_vec3_v1(reader)?;
    let rotation = RotationMicroturnsV1 {
        yaw: reader.u32()?,
        pitch: reader.u32()?,
        roll: reader.u32()?,
    };
    let created_tick = reader.u64()?;
    let expires_tick = reader.option_u64()?;
    let pickup_lock_actor_id = if reader.flag()? { Some(reader.string()?) } else { None };
    let pickup_unlock_tick = reader.u64()?;
    let origin_hash = reader.hash()?;
    let authority = IntegratedRuntimeNativeDropPickupAuthorityEvidenceV1 {
        before_gameplay_revision: read_gameplay_revision_v1(reader)?,
        before_gameplay_hash: reader.hash()?,
        after_gameplay_revision: read_gameplay_revision_v1(reader)?,
        after_gameplay_hash: reader.hash()?,
        before_entity_revision: reader.u64()?,
        before_entity_hash: reader.hash()?,
        after_entity_revision: reader.u64()?,
        after_entity_hash: reader.hash()?,
        before_world_view_revision: read_world_view_revision_v1(reader)?,
        before_world_view_hash: reader.hash()?,
        after_world_view_revision: read_world_view_revision_v1(reader)?,
        after_world_view_hash: reader.hash()?,
    };
    let content = IntegratedRuntimeNativePlayerDropContentBindingV1 {
        configured_manifest_hash: reader.hash()?,
        installed_manifest_hash: reader.hash()?,
        installed_registry_hash: reader.hash()?,
        item_content_hash: reader.hash()?,
        item_content_version: reader.u32()?,
    };
    Ok(IntegratedRuntimeNativePlayerDropReceiptV1 {
        schema_version,
        sequence,
        origin_input_sequence,
        completion_tick,
        world,
        world_revision,
        world_state_hash,
        player_id: PlayerId::new(player_packed as u32, (player_packed >> 32) as u32),
        player_entity_id: entity_id_from_packed(player_entity_packed),
        inventory,
        drop: IntegratedRuntimeNativePlayerDropSpawnV1 {
            drop_id,
            entity_id: entity_id_from_packed(drop_entity_packed),
            stack,
            custody_container,
            custody_slot,
            custody_revision,
            spatial_revision,
            position,
            velocity_milli_per_second,
            rotation,
            created_tick,
            expires_tick,
            pickup_lock_actor_id,
            pickup_unlock_tick,
            origin_hash,
        },
        authority,
        content,
        receipt_hash: reader.hash()?,
    })
}

pub fn encode_runtime_native_drop_pickup_receipt_query_v1(
    value: &RuntimeNativeDropPickupReceiptQueryWireV1,
) -> Result<Vec<u8>, WireError> {
    if value.after_sequence > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-drop-pickup-query-cursor",
            "native drop pickup query cursor exceeds the JavaScript-safe range",
        ));
    }
    let mut writer = Writer::default();
    write_integrated_runtime_identity_v2(&mut writer, &value.expected)?;
    writer.u64(value.after_sequence);
    wrap_schema(
        NATIVE_DROP_PICKUP_RECEIPT_V1_MAGIC,
        NATIVE_DROP_PICKUP_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_native_drop_pickup_receipt_query_v1(
    bytes: &[u8],
) -> Result<RuntimeNativeDropPickupReceiptQueryWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NATIVE_DROP_PICKUP_RECEIPT_V1_MAGIC,
        NATIVE_DROP_PICKUP_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = RuntimeNativeDropPickupReceiptQueryWireV1 {
        expected: read_integrated_runtime_identity_v2(&mut reader)?,
        after_sequence: reader.u64()?,
    };
    reader.finish()?;
    if value.after_sequence > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-drop-pickup-query-cursor",
            "native drop pickup query cursor exceeds the JavaScript-safe range",
        ));
    }
    Ok(value)
}

pub fn encode_runtime_native_drop_pickup_projection_receipt_v1(
    value: &RuntimeNativeDropPickupProjectionReceiptWireV1,
) -> Result<Vec<u8>, WireError> {
    validate_runtime_native_drop_pickup_projection_receipt_v1(value)?;
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    write_integrated_runtime_identity_v2(&mut writer, &value.identity)?;
    writer.u64(value.cursor_after);
    writer.flag(value.receipt.is_some());
    if let Some(receipt) = &value.receipt {
        write_runtime_native_drop_pickup_receipt_v1(&mut writer, receipt)?;
    }
    wrap_schema(
        NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_V1_MAGIC,
        NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_native_drop_pickup_projection_receipt_v1(
    bytes: &[u8],
) -> Result<RuntimeNativeDropPickupProjectionReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_V1_MAGIC,
        NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let request_payload_hash = reader.hash()?;
    let identity = read_integrated_runtime_identity_v2(&mut reader)?;
    let cursor_after = reader.u64()?;
    let receipt = if reader.flag()? {
        Some(read_runtime_native_drop_pickup_receipt_v1(&mut reader)?)
    } else {
        None
    };
    reader.finish()?;
    let value = RuntimeNativeDropPickupProjectionReceiptWireV1 {
        request_payload_hash,
        identity,
        cursor_after,
        receipt,
    };
    validate_runtime_native_drop_pickup_projection_receipt_v1(&value)?;
    Ok(value)
}

fn validate_runtime_native_drop_pickup_projection_receipt_v1(
    value: &RuntimeNativeDropPickupProjectionReceiptWireV1,
) -> Result<(), WireError> {
    if value.cursor_after > MAX_SAFE_U64 {
        return Err(WireError::new(
            "native-drop-pickup-projection-cursor",
            "native drop pickup projection cursor exceeds the JavaScript-safe range",
        ));
    }
    if let Some(receipt) = &value.receipt {
        if receipt.sequence != value.cursor_after {
            return Err(WireError::new(
                "native-drop-pickup-projection-cursor",
                "native drop pickup projection cursor does not equal its receipt sequence",
            ));
        }
        receipt
            .validate_shape_v1()
            .map_err(|error| WireError::new("native-drop-pickup-projection-native", error.message))?;
    }
    Ok(())
}

fn write_runtime_native_drop_pickup_receipt_v1(
    writer: &mut Writer,
    value: &IntegratedRuntimeNativeDropPickupReceiptV1,
) -> Result<(), WireError> {
    writer.u16(value.schema_version);
    writer.u64(value.sequence);
    writer.u64(value.completion_tick);
    writer.string(&value.world.universe)?;
    writer.string(&value.world.location)?;
    write_world_authority_revision_v1(writer, value.world_revision);
    writer.hash(value.world_state_hash);
    writer.u64(value.player_id.packed());
    writer.u64(value.player_entity_id.packed());
    write_container_key(writer, &value.inventory_container)?;
    writer.u64(value.inventory_before_revision);
    writer.u64(value.inventory_after_revision);
    writer.count(
        value.affected_slots.len(),
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "native drop pickup affected slots",
    )?;
    for delta in &value.affected_slots {
        writer.u16(delta.slot);
        write_optional_item_stack(writer, &delta.before_stack);
        write_optional_item_stack(writer, &delta.after_stack);
    }
    writer.string(&value.source.drop_id)?;
    writer.u64(value.source.entity_id.packed());
    match &value.source.origin {
        IntegratedRuntimeNativeDropPickupOriginV1::GeneratedBlockAction(provenance) => {
            writer.u8(0);
            write_generated_drop_provenance_v1(writer, provenance);
        }
        IntegratedRuntimeNativeDropPickupOriginV1::PlayerDrop {
            player_drop_sequence,
            player_drop_receipt_hash,
        } => {
            writer.u8(1);
            writer.u64(*player_drop_sequence);
            writer.hash(*player_drop_receipt_hash);
        }
        IntegratedRuntimeNativeDropPickupOriginV1::PlayerDeathDrop {
            respawn_sequence,
            respawn_receipt_hash,
            source_lane,
            source_slot,
        } => {
            writer.u8(2);
            writer.u64(*respawn_sequence);
            writer.hash(*respawn_receipt_hash);
            writer.u16(match source_lane {
                PlayerDeathCustodyLaneV1::Inventory => 0,
                PlayerDeathCustodyLaneV1::Equipment => 1,
            });
            writer.u16(*source_slot);
        }
    }
    write_item_stack(writer, &value.source.stack);
    write_container_key(writer, &value.source.custody_container)?;
    writer.u16(value.source.custody_slot);
    writer.u64(value.source.custody_before_revision);
    writer.u64(value.source.custody_emptied_revision);
    writer.u64(value.source.spatial_revision);
    write_fixed_world_vec3_v1(writer, value.source.position);
    write_fixed_world_vec3_v1(writer, value.source.velocity_milli_per_second);
    writer.u32(value.source.rotation.yaw);
    writer.u32(value.source.rotation.pitch);
    writer.u32(value.source.rotation.roll);
    write_gameplay_revision_v1(writer, value.authority.before_gameplay_revision);
    writer.hash(value.authority.before_gameplay_hash);
    write_gameplay_revision_v1(writer, value.authority.after_gameplay_revision);
    writer.hash(value.authority.after_gameplay_hash);
    writer.u64(value.authority.before_entity_revision);
    writer.hash(value.authority.before_entity_hash);
    writer.u64(value.authority.after_entity_revision);
    writer.hash(value.authority.after_entity_hash);
    write_world_view_revision_v1(writer, value.authority.before_world_view_revision);
    writer.hash(value.authority.before_world_view_hash);
    write_world_view_revision_v1(writer, value.authority.after_world_view_revision);
    writer.hash(value.authority.after_world_view_hash);
    writer.hash(value.receipt_hash);
    Ok(())
}

fn read_runtime_native_drop_pickup_receipt_v1(
    reader: &mut Reader<'_>,
) -> Result<IntegratedRuntimeNativeDropPickupReceiptV1, WireError> {
    let schema_version = reader.u16()?;
    let sequence = reader.u64()?;
    let completion_tick = reader.u64()?;
    let world = WorldKey::new(reader.string()?, reader.string()?);
    let world_revision = read_world_authority_revision_v1(reader)?;
    let world_state_hash = reader.hash()?;
    let player_packed = reader.u64()?;
    let player_entity_packed = reader.u64()?;
    let inventory_container = read_container_key(reader)?;
    let inventory_before_revision = reader.u64()?;
    let inventory_after_revision = reader.u64()?;
    let slot_count = reader.count(
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "native drop pickup affected slots",
    )?;
    let mut affected_slots = Vec::with_capacity(slot_count);
    for _ in 0..slot_count {
        affected_slots.push(IntegratedRuntimeNativeDropPickupSlotDeltaV1 {
            slot: reader.u16()?,
            before_stack: read_optional_item_stack(reader)?,
            after_stack: read_optional_item_stack(reader)?,
        });
    }
    let source = IntegratedRuntimeNativeDropPickupSourceV1 {
        drop_id: reader.string()?,
        entity_id: entity_id_from_packed(reader.u64()?),
        origin: match reader.u8()? {
            0 => IntegratedRuntimeNativeDropPickupOriginV1::GeneratedBlockAction(read_generated_drop_provenance_v1(
                reader,
            )?),
            1 => IntegratedRuntimeNativeDropPickupOriginV1::PlayerDrop {
                player_drop_sequence: reader.u64()?,
                player_drop_receipt_hash: reader.hash()?,
            },
            2 => IntegratedRuntimeNativeDropPickupOriginV1::PlayerDeathDrop {
                respawn_sequence: reader.u64()?,
                respawn_receipt_hash: reader.hash()?,
                source_lane: match reader.u16()? {
                    0 => PlayerDeathCustodyLaneV1::Inventory,
                    1 => PlayerDeathCustodyLaneV1::Equipment,
                    _ => {
                        return Err(WireError::new(
                            "native-drop-pickup-origin-lane",
                            "native death-drop pickup receipt uses an unknown custody-lane tag",
                        ));
                    }
                },
                source_slot: reader.u16()?,
            },
            _ => {
                return Err(WireError::new(
                    "native-drop-pickup-origin",
                    "native drop pickup receipt uses an unknown origin tag",
                ));
            }
        },
        stack: read_item_stack(reader)?,
        custody_container: read_container_key(reader)?,
        custody_slot: reader.u16()?,
        custody_before_revision: reader.u64()?,
        custody_emptied_revision: reader.u64()?,
        spatial_revision: reader.u64()?,
        position: read_fixed_world_vec3_v1(reader)?,
        velocity_milli_per_second: read_fixed_world_vec3_v1(reader)?,
        rotation: RotationMicroturnsV1 {
            yaw: reader.u32()?,
            pitch: reader.u32()?,
            roll: reader.u32()?,
        },
    };
    let authority = IntegratedRuntimeNativeDropPickupAuthorityEvidenceV1 {
        before_gameplay_revision: read_gameplay_revision_v1(reader)?,
        before_gameplay_hash: reader.hash()?,
        after_gameplay_revision: read_gameplay_revision_v1(reader)?,
        after_gameplay_hash: reader.hash()?,
        before_entity_revision: reader.u64()?,
        before_entity_hash: reader.hash()?,
        after_entity_revision: reader.u64()?,
        after_entity_hash: reader.hash()?,
        before_world_view_revision: read_world_view_revision_v1(reader)?,
        before_world_view_hash: reader.hash()?,
        after_world_view_revision: read_world_view_revision_v1(reader)?,
        after_world_view_hash: reader.hash()?,
    };
    Ok(IntegratedRuntimeNativeDropPickupReceiptV1 {
        schema_version,
        sequence,
        completion_tick,
        world,
        world_revision,
        world_state_hash,
        player_id: PlayerId::new(player_packed as u32, (player_packed >> 32) as u32),
        player_entity_id: entity_id_from_packed(player_entity_packed),
        inventory_container,
        inventory_before_revision,
        inventory_after_revision,
        affected_slots,
        source,
        authority,
        receipt_hash: reader.hash()?,
    })
}

fn write_gameplay_revision_v1(writer: &mut Writer, value: GameplayRevision) {
    writer.u32(value.epoch);
    writer.u64(value.sequence);
    writer.u64(value.inventory);
    writer.u64(value.machines);
    writer.u64(value.combat);
    writer.u64(value.progression);
    writer.u64(value.cardforge);
}

fn read_gameplay_revision_v1(reader: &mut Reader<'_>) -> Result<GameplayRevision, WireError> {
    Ok(GameplayRevision {
        epoch: reader.u32()?,
        sequence: reader.u64()?,
        inventory: reader.u64()?,
        machines: reader.u64()?,
        combat: reader.u64()?,
        progression: reader.u64()?,
        cardforge: reader.u64()?,
    })
}

fn write_world_view_revision_v1(writer: &mut Writer, value: WorldViewRevisionV1) {
    writer.u32(value.epoch);
    writer.u64(value.sequence);
    writer.u64(value.clock);
    writer.u64(value.machine_anchors);
    writer.u64(value.dropped_items);
    writer.u64(value.player_bindings);
    writer.u64(value.environment);
    writer.u64(value.atmosphere_gravity);
    writer.u64(value.celestial);
}

fn read_world_view_revision_v1(reader: &mut Reader<'_>) -> Result<WorldViewRevisionV1, WireError> {
    Ok(WorldViewRevisionV1 {
        epoch: reader.u32()?,
        sequence: reader.u64()?,
        clock: reader.u64()?,
        machine_anchors: reader.u64()?,
        dropped_items: reader.u64()?,
        player_bindings: reader.u64()?,
        environment: reader.u64()?,
        atmosphere_gravity: reader.u64()?,
        celestial: reader.u64()?,
    })
}

fn write_world_authority_revision_v1(writer: &mut Writer, value: WorldAuthorityRevisionV1) {
    writer.u64(value.epoch);
    writer.u64(value.mutation);
    writer.u64(value.residency);
}

fn read_world_authority_revision_v1(reader: &mut Reader<'_>) -> Result<WorldAuthorityRevisionV1, WireError> {
    Ok(WorldAuthorityRevisionV1 {
        epoch: reader.u64()?,
        mutation: reader.u64()?,
        residency: reader.u64()?,
    })
}

fn write_fixed_world_vec3_v1(writer: &mut Writer, value: FixedWorldVec3V1) {
    writer.i64(value.x_milli);
    writer.i64(value.y_milli);
    writer.i64(value.z_milli);
}

fn read_fixed_world_vec3_v1(reader: &mut Reader<'_>) -> Result<FixedWorldVec3V1, WireError> {
    Ok(FixedWorldVec3V1 {
        x_milli: reader.i64()?,
        y_milli: reader.i64()?,
        z_milli: reader.i64()?,
    })
}

pub fn encode_player_inventory_import_v1(value: &PlayerInventoryImportWireV1) -> Result<Vec<u8>, WireError> {
    if value.selected_slot >= PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1 as u16 {
        return Err(WireError::new(
            "player-inventory-import",
            "selected slot is outside the imported inventory",
        ));
    }
    let mut writer = Writer::default();
    write_container_key(&mut writer, &value.import.inventory)?;
    writer.u64(value.import.expected_revision);
    writer.u16(value.selected_slot);
    write_player_inventory_import_contents(&mut writer, &value.import)?;
    wrap_schema(
        PLAYER_INVENTORY_IMPORT_V1_MAGIC,
        PLAYER_INVENTORY_IMPORT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_inventory_import_v1(bytes: &[u8]) -> Result<PlayerInventoryImportWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_INVENTORY_IMPORT_V1_MAGIC,
        PLAYER_INVENTORY_IMPORT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let inventory = read_container_key(&mut reader)?;
    let expected_revision = reader.u64()?;
    let selected_slot = reader.u16()?;
    let import = read_player_inventory_import_contents(&mut reader, inventory, expected_revision)?;
    reader.finish()?;
    if selected_slot >= PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1 as u16 {
        return Err(WireError::new(
            "player-inventory-import",
            "selected slot is outside the imported inventory",
        ));
    }
    Ok(PlayerInventoryImportWireV1 { import, selected_slot })
}

pub fn encode_player_inventory_import_receipt_v1(
    value: &PlayerInventoryImportReceiptWireV1,
) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    write_gameplay_identity(&mut writer, &value.before)?;
    write_gameplay_identity(&mut writer, &value.after)?;
    writer.hash(value.accepted_receipt_hash);
    writer.u64(value.inventory_revision);
    writer.u16(value.selected_slot);
    writer.hash(value.inventory_result_hash);
    wrap_schema(
        PLAYER_INVENTORY_IMPORT_RECEIPT_V1_MAGIC,
        PLAYER_INVENTORY_IMPORT_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_inventory_import_receipt_v1(
    bytes: &[u8],
) -> Result<PlayerInventoryImportReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_INVENTORY_IMPORT_RECEIPT_V1_MAGIC,
        PLAYER_INVENTORY_IMPORT_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = PlayerInventoryImportReceiptWireV1 {
        request_payload_hash: reader.hash()?,
        before: read_gameplay_identity(&mut reader)?,
        after: read_gameplay_identity(&mut reader)?,
        accepted_receipt_hash: reader.hash()?,
        inventory_revision: reader.u64()?,
        selected_slot: reader.u16()?,
        inventory_result_hash: reader.hash()?,
    };
    reader.finish()?;
    Ok(value)
}

pub fn encode_player_locator_item_consume_v1(value: &PlayerLocatorItemConsumeWireV1) -> Result<Vec<u8>, WireError> {
    validate_player_locator_item_consume_v1(value)?;
    let mut writer = Writer::default();
    write_container_key(&mut writer, &value.inventory)?;
    writer.u16(value.selected_slot);
    writer.u64(value.expected_inventory_revision);
    write_item_stack(&mut writer, &value.expected_stack);
    writer.u8(player_locator_item_purpose_tag_v1(value.purpose));
    writer.hash(value.locator_result_hash);
    wrap_schema(
        PLAYER_LOCATOR_ITEM_CONSUME_V1_MAGIC,
        PLAYER_LOCATOR_ITEM_CONSUME_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_locator_item_consume_v1(bytes: &[u8]) -> Result<PlayerLocatorItemConsumeWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_LOCATOR_ITEM_CONSUME_V1_MAGIC,
        PLAYER_LOCATOR_ITEM_CONSUME_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = PlayerLocatorItemConsumeWireV1 {
        inventory: read_container_key(&mut reader)?,
        selected_slot: reader.u16()?,
        expected_inventory_revision: reader.u64()?,
        expected_stack: read_item_stack(&mut reader)?,
        purpose: read_player_locator_item_purpose_v1(&mut reader)?,
        locator_result_hash: reader.hash()?,
    };
    reader.finish()?;
    validate_player_locator_item_consume_v1(&value)?;
    Ok(value)
}

pub fn encode_player_locator_item_consume_receipt_v1(
    value: &PlayerLocatorItemConsumeReceiptWireV1,
) -> Result<Vec<u8>, WireError> {
    validate_player_locator_item_consume_receipt_v1(value)?;
    let mut writer = Writer::default();
    writer.hash(value.request_payload_hash);
    writer.u8(player_locator_item_purpose_tag_v1(value.purpose));
    writer.hash(value.locator_result_hash);
    write_gameplay_identity(&mut writer, &value.before)?;
    write_gameplay_identity(&mut writer, &value.after)?;
    writer.hash(value.accepted_receipt_hash);
    write_container_key(&mut writer, &value.inventory)?;
    writer.u16(value.selected_slot);
    writer.u64(value.previous_inventory_revision);
    writer.u64(value.resulting_inventory_revision);
    write_item_stack(&mut writer, &value.consumed_stack);
    write_optional_item_stack(&mut writer, &value.remaining_stack);
    writer.hash(value.inventory_result_hash);
    wrap_schema(
        PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_V1_MAGIC,
        PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_locator_item_consume_receipt_v1(
    bytes: &[u8],
) -> Result<PlayerLocatorItemConsumeReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_V1_MAGIC,
        PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = PlayerLocatorItemConsumeReceiptWireV1 {
        request_payload_hash: reader.hash()?,
        purpose: read_player_locator_item_purpose_v1(&mut reader)?,
        locator_result_hash: reader.hash()?,
        before: read_gameplay_identity(&mut reader)?,
        after: read_gameplay_identity(&mut reader)?,
        accepted_receipt_hash: reader.hash()?,
        inventory: read_container_key(&mut reader)?,
        selected_slot: reader.u16()?,
        previous_inventory_revision: reader.u64()?,
        resulting_inventory_revision: reader.u64()?,
        consumed_stack: read_item_stack(&mut reader)?,
        remaining_stack: read_optional_item_stack(&mut reader)?,
        inventory_result_hash: reader.hash()?,
    };
    reader.finish()?;
    validate_player_locator_item_consume_receipt_v1(&value)?;
    Ok(value)
}

fn player_locator_item_purpose_tag_v1(value: PlayerLocatorItemPurposeV1) -> u8 {
    match value {
        PlayerLocatorItemPurposeV1::SettlementChart => 0,
        PlayerLocatorItemPurposeV1::DragonLairCharter => 1,
    }
}

fn read_player_locator_item_purpose_v1(reader: &mut Reader<'_>) -> Result<PlayerLocatorItemPurposeV1, WireError> {
    match reader.u8()? {
        0 => Ok(PlayerLocatorItemPurposeV1::SettlementChart),
        1 => Ok(PlayerLocatorItemPurposeV1::DragonLairCharter),
        _ => Err(WireError::new(
            "player-locator-item-purpose",
            "player locator item request uses an unknown purpose",
        )),
    }
}

fn validate_player_locator_item_consume_v1(value: &PlayerLocatorItemConsumeWireV1) -> Result<(), WireError> {
    let mut writer = Writer::default();
    write_container_key(&mut writer, &value.inventory)?;
    if value.inventory.kind != ContainerKind::Player || value.inventory.owner_id.is_none() {
        return Err(WireError::new(
            "player-locator-item-inventory",
            "player locator item consumption requires an owned player inventory",
        ));
    }
    if value.selected_slot >= PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1 as u16 {
        return Err(WireError::new(
            "player-locator-item-slot",
            "player locator item selected slot is outside the player inventory",
        ));
    }
    if value.expected_stack.item_code == 0 || value.expected_stack.count == 0 {
        return Err(WireError::new(
            "player-locator-item-stack",
            "player locator item expected stack must be non-empty",
        ));
    }
    value
        .expected_stack
        .validate(blockwild_gameplay::MAX_ITEM_STACK)
        .map_err(|error| WireError::new("player-locator-item-stack", error.message))?;
    if value.locator_result_hash == CanonicalHash::default() {
        return Err(WireError::new(
            "player-locator-item-result",
            "player locator item result hash must be non-zero",
        ));
    }
    Ok(())
}

fn validate_player_locator_item_consume_receipt_v1(
    value: &PlayerLocatorItemConsumeReceiptWireV1,
) -> Result<(), WireError> {
    let expected_revision = value
        .previous_inventory_revision
        .checked_add(1)
        .ok_or_else(|| WireError::new("player-locator-item-revision", "previous inventory revision overflow"))?;
    if value.resulting_inventory_revision != expected_revision {
        return Err(WireError::new(
            "player-locator-item-revision",
            "player locator item receipt must advance inventory revision exactly once",
        ));
    }
    let mut expected_stack = value.consumed_stack.clone();
    if let Some(remaining) = &value.remaining_stack {
        if !remaining.compatible_with(&value.consumed_stack) || remaining.count == 0 {
            return Err(WireError::new(
                "player-locator-item-remaining-stack",
                "player locator item receipt remaining stack is not a non-empty compatible stack",
            ));
        }
        expected_stack.count = remaining
            .count
            .checked_add(1)
            .ok_or_else(|| WireError::new("player-locator-item-stack", "expected stack count overflow"))?;
    }
    let request = PlayerLocatorItemConsumeWireV1 {
        inventory: value.inventory.clone(),
        selected_slot: value.selected_slot,
        expected_inventory_revision: value.previous_inventory_revision,
        expected_stack,
        purpose: value.purpose,
        locator_result_hash: value.locator_result_hash,
    };
    validate_player_locator_item_consume_v1(&request)?;
    if value.consumed_stack.count != 1 {
        return Err(WireError::new(
            "player-locator-item-consumed-stack",
            "player locator item receipt must attest exactly one consumed unit",
        ));
    }
    if value.request_payload_hash == CanonicalHash::default()
        || value.accepted_receipt_hash == CanonicalHash::default()
        || value.inventory_result_hash == CanonicalHash::default()
    {
        return Err(WireError::new(
            "player-locator-item-receipt-hash",
            "player locator item receipt hashes must be non-zero",
        ));
    }
    let expected_sequence = value
        .before
        .revision
        .sequence
        .checked_add(1)
        .ok_or_else(|| WireError::new("player-locator-item-gameplay", "gameplay sequence overflow"))?;
    let expected_inventory = value
        .before
        .revision
        .inventory
        .checked_add(1)
        .ok_or_else(|| WireError::new("player-locator-item-gameplay", "gameplay inventory revision overflow"))?;
    if value.before.world != value.after.world
        || value.before.revision.epoch != value.after.revision.epoch
        || value.after.revision.sequence != expected_sequence
        || value.after.revision.inventory != expected_inventory
        || value.before.revision.machines != value.after.revision.machines
        || value.before.revision.combat != value.after.revision.combat
        || value.before.revision.progression != value.after.revision.progression
        || value.before.revision.cardforge != value.after.revision.cardforge
        || value.before.state_hash == value.after.state_hash
    {
        return Err(WireError::new(
            "player-locator-item-gameplay",
            "player locator item receipt gameplay identities do not attest one inventory-only transition",
        ));
    }
    Ok(())
}

pub fn encode_player_creative_slot_set_v1(value: &PlayerCreativeSlotSetWireV1) -> Result<Vec<u8>, WireError> {
    validate_player_creative_slot_set_v1(value)?;
    let mut writer = Writer::default();
    write_container_key(&mut writer, &value.inventory)?;
    writer.u16(value.selected_slot);
    writer.u64(value.expected_inventory_revision);
    write_optional_item_stack(&mut writer, &value.expected_stack);
    write_item_stack(&mut writer, &value.replacement_stack);
    wrap_schema(
        PLAYER_CREATIVE_SLOT_SET_V1_MAGIC,
        PLAYER_CREATIVE_SLOT_SET_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_creative_slot_set_v1(bytes: &[u8]) -> Result<PlayerCreativeSlotSetWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_CREATIVE_SLOT_SET_V1_MAGIC,
        PLAYER_CREATIVE_SLOT_SET_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = PlayerCreativeSlotSetWireV1 {
        inventory: read_container_key(&mut reader)?,
        selected_slot: reader.u16()?,
        expected_inventory_revision: reader.u64()?,
        expected_stack: read_optional_item_stack(&mut reader)?,
        replacement_stack: read_item_stack(&mut reader)?,
    };
    reader.finish()?;
    validate_player_creative_slot_set_v1(&value)?;
    Ok(value)
}

pub fn player_creative_slot_set_receipt_hash_v1(
    value: &PlayerCreativeSlotSetReceiptWireV1,
) -> Result<CanonicalHash, WireError> {
    let mut writer = Writer::default();
    write_player_creative_slot_set_receipt_contents_v1(&mut writer, value)?;
    Ok(CanonicalHash(wire_checksum_v1(&writer.finish())))
}

pub fn encode_player_creative_slot_set_receipt_v1(
    value: &PlayerCreativeSlotSetReceiptWireV1,
) -> Result<Vec<u8>, WireError> {
    validate_player_creative_slot_set_receipt_v1(value)?;
    let mut writer = Writer::default();
    write_player_creative_slot_set_receipt_contents_v1(&mut writer, value)?;
    writer.hash(value.receipt_hash);
    wrap_schema(
        PLAYER_CREATIVE_SLOT_SET_RECEIPT_V1_MAGIC,
        PLAYER_CREATIVE_SLOT_SET_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_creative_slot_set_receipt_v1(
    bytes: &[u8],
) -> Result<PlayerCreativeSlotSetReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_CREATIVE_SLOT_SET_RECEIPT_V1_MAGIC,
        PLAYER_CREATIVE_SLOT_SET_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = PlayerCreativeSlotSetReceiptWireV1 {
        request_payload_hash: reader.hash()?,
        before: read_gameplay_identity(&mut reader)?,
        after: read_gameplay_identity(&mut reader)?,
        accepted_receipt_hash: reader.hash()?,
        inventory: read_container_key(&mut reader)?,
        selected_slot: reader.u16()?,
        previous_inventory_revision: reader.u64()?,
        resulting_inventory_revision: reader.u64()?,
        prior_stack: read_optional_item_stack(&mut reader)?,
        replacement_stack: read_item_stack(&mut reader)?,
        inventory_result_hash: reader.hash()?,
        receipt_hash: reader.hash()?,
    };
    reader.finish()?;
    validate_player_creative_slot_set_receipt_v1(&value)?;
    Ok(value)
}

fn write_player_creative_slot_set_receipt_contents_v1(
    writer: &mut Writer,
    value: &PlayerCreativeSlotSetReceiptWireV1,
) -> Result<(), WireError> {
    writer.hash(value.request_payload_hash);
    write_gameplay_identity(writer, &value.before)?;
    write_gameplay_identity(writer, &value.after)?;
    writer.hash(value.accepted_receipt_hash);
    write_container_key(writer, &value.inventory)?;
    writer.u16(value.selected_slot);
    writer.u64(value.previous_inventory_revision);
    writer.u64(value.resulting_inventory_revision);
    write_optional_item_stack(writer, &value.prior_stack);
    write_item_stack(writer, &value.replacement_stack);
    writer.hash(value.inventory_result_hash);
    Ok(())
}

fn validate_player_creative_slot_set_v1(value: &PlayerCreativeSlotSetWireV1) -> Result<(), WireError> {
    let mut writer = Writer::default();
    write_container_key(&mut writer, &value.inventory)?;
    if value.inventory.kind != ContainerKind::Player || value.inventory.owner_id.is_none() {
        return Err(WireError::new(
            "player-creative-slot-inventory",
            "Creative slot set requires an owned player inventory",
        ));
    }
    if value.selected_slot >= PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1 as u16 {
        return Err(WireError::new(
            "player-creative-slot-selected",
            "Creative slot set selected slot is outside the player inventory",
        ));
    }
    if let Some(expected) = &value.expected_stack {
        expected
            .validate(blockwild_gameplay::MAX_ITEM_STACK)
            .map_err(|error| WireError::new("player-creative-slot-stack", error.message))?;
    }
    value
        .replacement_stack
        .validate(blockwild_gameplay::MAX_ITEM_STACK)
        .map_err(|error| WireError::new("player-creative-slot-stack", error.message))?;
    Ok(())
}

fn validate_player_creative_slot_set_receipt_v1(value: &PlayerCreativeSlotSetReceiptWireV1) -> Result<(), WireError> {
    let request = PlayerCreativeSlotSetWireV1 {
        inventory: value.inventory.clone(),
        selected_slot: value.selected_slot,
        expected_inventory_revision: value.previous_inventory_revision,
        expected_stack: value.prior_stack.clone(),
        replacement_stack: value.replacement_stack.clone(),
    };
    validate_player_creative_slot_set_v1(&request)?;
    let request_bytes = encode_player_creative_slot_set_v1(&request)?;
    if value.request_payload_hash != CanonicalHash(wire_checksum_v1(&request_bytes)) {
        return Err(WireError::new(
            "player-creative-slot-request-hash",
            "Creative slot set receipt request hash does not match its canonical request",
        ));
    }
    if value.previous_inventory_revision.checked_add(1) != Some(value.resulting_inventory_revision) {
        return Err(WireError::new(
            "player-creative-slot-revision",
            "Creative slot set receipt must advance inventory revision exactly once",
        ));
    }
    if value.accepted_receipt_hash == CanonicalHash::default()
        || value.inventory_result_hash == CanonicalHash::default()
        || value.receipt_hash == CanonicalHash::default()
    {
        return Err(WireError::new(
            "player-creative-slot-receipt-hash",
            "Creative slot set receipt hashes must be non-zero",
        ));
    }
    let expected_sequence = value
        .before
        .revision
        .sequence
        .checked_add(1)
        .ok_or_else(|| WireError::new("player-creative-slot-gameplay", "gameplay sequence overflow"))?;
    let expected_inventory = value
        .before
        .revision
        .inventory
        .checked_add(1)
        .ok_or_else(|| WireError::new("player-creative-slot-gameplay", "gameplay inventory revision overflow"))?;
    if value.before.world != value.after.world
        || value.before.revision.epoch != value.after.revision.epoch
        || value.after.revision.sequence != expected_sequence
        || value.after.revision.inventory != expected_inventory
        || value.before.revision.machines != value.after.revision.machines
        || value.before.revision.combat != value.after.revision.combat
        || value.before.revision.progression != value.after.revision.progression
        || value.before.revision.cardforge != value.after.revision.cardforge
        || value.before.state_hash == value.after.state_hash
    {
        return Err(WireError::new(
            "player-creative-slot-gameplay",
            "Creative slot set receipt gameplay identities do not attest one inventory-only transition",
        ));
    }
    if player_creative_slot_set_receipt_hash_v1(value)? != value.receipt_hash {
        return Err(WireError::new(
            "player-creative-slot-receipt-hash",
            "Creative slot set receipt hash does not match its canonical fields",
        ));
    }
    Ok(())
}

pub fn encode_player_game_mode_set_v1(value: &PlayerGameModeSetWireV1) -> Result<Vec<u8>, WireError> {
    validate_player_game_mode_set_v1(value)?;
    let mut writer = Writer::default();
    writer.string(&value.external_entity_id)?;
    writer.string(&value.actor_id)?;
    writer.u64(value.player_id.packed());
    writer.flag(value.expected_creative_mode);
    writer.u8(value.expected_flags);
    writer.flag(value.requested_creative_mode);
    wrap_schema(
        PLAYER_GAME_MODE_SET_V1_MAGIC,
        PLAYER_GAME_MODE_SET_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_game_mode_set_v1(bytes: &[u8]) -> Result<PlayerGameModeSetWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_GAME_MODE_SET_V1_MAGIC,
        PLAYER_GAME_MODE_SET_V1_INNER_SCHEMA,
        bytes,
    )?);
    let external_entity_id = reader.string()?;
    let actor_id = reader.string()?;
    let player_packed = reader.u64()?;
    let value = PlayerGameModeSetWireV1 {
        external_entity_id,
        actor_id,
        player_id: PlayerId::new(player_packed as u32, (player_packed >> 32) as u32),
        expected_creative_mode: reader.flag()?,
        expected_flags: reader.u8()?,
        requested_creative_mode: reader.flag()?,
    };
    reader.finish()?;
    validate_player_game_mode_set_v1(&value)?;
    Ok(value)
}

pub fn player_game_mode_set_receipt_hash_v1(
    value: &PlayerGameModeSetReceiptWireV1,
) -> Result<CanonicalHash, WireError> {
    let mut writer = Writer::default();
    write_player_game_mode_set_receipt_contents_v1(&mut writer, value)?;
    Ok(CanonicalHash(wire_checksum_v1(&writer.finish())))
}

pub fn encode_player_game_mode_set_receipt_v1(value: &PlayerGameModeSetReceiptWireV1) -> Result<Vec<u8>, WireError> {
    validate_player_game_mode_set_receipt_v1(value)?;
    let mut writer = Writer::default();
    write_player_game_mode_set_receipt_contents_v1(&mut writer, value)?;
    writer.hash(value.receipt_hash);
    wrap_schema(
        PLAYER_GAME_MODE_SET_RECEIPT_V1_MAGIC,
        PLAYER_GAME_MODE_SET_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_game_mode_set_receipt_v1(bytes: &[u8]) -> Result<PlayerGameModeSetReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_GAME_MODE_SET_RECEIPT_V1_MAGIC,
        PLAYER_GAME_MODE_SET_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let request_payload_hash = reader.hash()?;
    let before = read_integrated_runtime_identity_v2(&mut reader)?;
    let after = read_integrated_runtime_identity_v2(&mut reader)?;
    let external_entity_id = reader.string()?;
    let actor_id = reader.string()?;
    let player_packed = reader.u64()?;
    let value = PlayerGameModeSetReceiptWireV1 {
        request_payload_hash,
        before,
        after,
        external_entity_id,
        actor_id,
        player_id: PlayerId::new(player_packed as u32, (player_packed >> 32) as u32),
        prior_creative_mode: reader.flag()?,
        prior_flags: reader.u8()?,
        resulting_creative_mode: reader.flag()?,
        resulting_flags: reader.u8()?,
        receipt_hash: reader.hash()?,
    };
    reader.finish()?;
    validate_player_game_mode_set_receipt_v1(&value)?;
    Ok(value)
}

fn write_player_game_mode_set_receipt_contents_v1(
    writer: &mut Writer,
    value: &PlayerGameModeSetReceiptWireV1,
) -> Result<(), WireError> {
    writer.hash(value.request_payload_hash);
    write_integrated_runtime_identity_v2(writer, &value.before)?;
    write_integrated_runtime_identity_v2(writer, &value.after)?;
    writer.string(&value.external_entity_id)?;
    writer.string(&value.actor_id)?;
    writer.u64(value.player_id.packed());
    writer.flag(value.prior_creative_mode);
    writer.u8(value.prior_flags);
    writer.flag(value.resulting_creative_mode);
    writer.u8(value.resulting_flags);
    Ok(())
}

fn validate_player_game_mode_set_v1(value: &PlayerGameModeSetWireV1) -> Result<(), WireError> {
    let mut writer = Writer::default();
    writer.string(&value.external_entity_id)?;
    writer.string(&value.actor_id)?;
    if value.external_entity_id.is_empty()
        || value.external_entity_id.len() > 512
        || value.external_entity_id.chars().any(char::is_control)
        || value.actor_id.is_empty()
        || value.actor_id.len() > 512
        || value.actor_id.chars().any(char::is_control)
        || value.player_id.packed() == 0
    {
        return Err(WireError::new(
            "player-game-mode-custody",
            "player game-mode set requires one non-empty actor/player/external-entity custody triple",
        ));
    }
    validate_player_game_mode_flags_v1(value.expected_creative_mode, value.expected_flags, "expected")?;
    if value.expected_creative_mode == value.requested_creative_mode {
        return Err(WireError::new(
            "player-game-mode-transition",
            "player game-mode set requires an actual Creative/Survival transition",
        ));
    }
    Ok(())
}

fn validate_player_game_mode_flags_v1(creative_mode: bool, flags: u8, field: &str) -> Result<(), WireError> {
    let creative_flag = flags & RUNTIME_INPUT_FLAG_CREATIVE_V1 != 0;
    let flying = flags & RUNTIME_INPUT_FLAG_FLYING_V1 != 0;
    let mounted = flags & RUNTIME_INPUT_FLAG_MOUNTED_V1 != 0;
    if flags & !RUNTIME_INPUT_FLAG_MASK_V1 != 0
        || creative_flag != creative_mode
        || (flying && (!creative_mode || mounted))
    {
        return Err(WireError::new(
            "player-game-mode-flags",
            format!("player game-mode {field} flags contradict their authoritative mode or contain invalid bits"),
        ));
    }
    Ok(())
}

pub(crate) fn player_game_mode_resulting_flags_v1(
    prior_creative_mode: bool,
    prior_flags: u8,
    requested_creative_mode: bool,
) -> Result<u8, WireError> {
    validate_player_game_mode_flags_v1(prior_creative_mode, prior_flags, "prior")?;
    let persistent = prior_flags & !(RUNTIME_INPUT_FLAG_CREATIVE_V1 | RUNTIME_INPUT_FLAG_FLYING_V1);
    let preserve_valid_flying =
        requested_creative_mode && prior_creative_mode && prior_flags & RUNTIME_INPUT_FLAG_FLYING_V1 != 0;
    Ok(persistent
        | (u8::from(requested_creative_mode) * RUNTIME_INPUT_FLAG_CREATIVE_V1)
        | (u8::from(preserve_valid_flying) * RUNTIME_INPUT_FLAG_FLYING_V1))
}

fn validate_player_game_mode_set_receipt_v1(value: &PlayerGameModeSetReceiptWireV1) -> Result<(), WireError> {
    let request = PlayerGameModeSetWireV1 {
        external_entity_id: value.external_entity_id.clone(),
        actor_id: value.actor_id.clone(),
        player_id: value.player_id,
        expected_creative_mode: value.prior_creative_mode,
        expected_flags: value.prior_flags,
        requested_creative_mode: value.resulting_creative_mode,
    };
    validate_player_game_mode_set_v1(&request)?;
    let request_bytes = encode_player_game_mode_set_v1(&request)?;
    if value.request_payload_hash == CanonicalHash::default()
        || value.request_payload_hash != CanonicalHash(wire_checksum_v1(&request_bytes))
    {
        return Err(WireError::new(
            "player-game-mode-request-hash",
            "player game-mode receipt request hash does not match its canonical request",
        ));
    }
    if value.before.schema_version != crate::INTEGRATED_RUNTIME_SCHEMA_V2
        || value.after.schema_version != crate::INTEGRATED_RUNTIME_SCHEMA_V2
        || value.before.universe_id.is_empty()
        || value.before.location_id.is_empty()
        || value.before.universe_id != value.after.universe_id
        || value.before.location_id != value.after.location_id
        || value.before.revision.epoch != value.after.revision.epoch
        || value.before.revision.world != value.after.revision.world
        || value.before.revision.entities != value.after.revision.entities
        || value.before.revision.gameplay != value.after.revision.gameplay
        || value.before.revision.persistence != value.after.revision.persistence
        || value.before.revision.network != value.after.revision.network
        || value.before.revision.simulation.checked_add(1) != Some(value.after.revision.simulation)
        || value.before.tick != value.after.tick
        || value.before.state_hash == CanonicalHash::default()
        || value.after.state_hash == CanonicalHash::default()
        || value.before.state_hash == value.after.state_hash
    {
        return Err(WireError::new(
            "player-game-mode-identity",
            "player game-mode receipt does not attest one exact simulation-only runtime transition",
        ));
    }
    let expected_resulting_flags = player_game_mode_resulting_flags_v1(
        value.prior_creative_mode,
        value.prior_flags,
        value.resulting_creative_mode,
    )?;
    validate_player_game_mode_flags_v1(value.resulting_creative_mode, value.resulting_flags, "resulting")?;
    if value.resulting_flags != expected_resulting_flags {
        return Err(WireError::new(
            "player-game-mode-result",
            "player game-mode receipt flags do not match the canonical transition semantics",
        ));
    }
    if value.receipt_hash == CanonicalHash::default()
        || player_game_mode_set_receipt_hash_v1(value)? != value.receipt_hash
    {
        return Err(WireError::new(
            "player-game-mode-receipt-hash",
            "player game-mode receipt hash does not match its canonical fields",
        ));
    }
    Ok(())
}

const PLAYER_RESPAWN_MAX_ABS_POSITION_MILLI_V1: i64 = 33_554_432_000;

pub fn encode_player_respawn_v1(value: &PlayerRespawnWireV1) -> Result<Vec<u8>, WireError> {
    validate_player_respawn_v1(value)?;
    let mut writer = Writer::default();
    write_player_respawn_contents_v1(&mut writer, value)?;
    wrap_schema(PLAYER_RESPAWN_V1_MAGIC, PLAYER_RESPAWN_V1_INNER_SCHEMA, writer.finish())
}

pub fn decode_player_respawn_v1(bytes: &[u8]) -> Result<PlayerRespawnWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_RESPAWN_V1_MAGIC,
        PLAYER_RESPAWN_V1_INNER_SCHEMA,
        bytes,
    )?);
    let expected = read_integrated_runtime_identity_v2(&mut reader)?;
    let external_entity_id = reader.string()?;
    let actor_id = reader.string()?;
    let player_packed = reader.u64()?;
    let entity_packed = reader.u64()?;
    let value = PlayerRespawnWireV1 {
        expected,
        external_entity_id,
        actor_id,
        player_id: PlayerId::new(player_packed as u32, (player_packed >> 32) as u32),
        entity_id: EntityId::new(entity_packed as u32, (entity_packed >> 32) as u32),
        expected_entity_revision: reader.u64()?,
        expected_gameplay_sequence: reader.u64()?,
        expected_gameplay_combat_revision: reader.u64()?,
        expected_combatant_revision: reader.u64()?,
        expected_death_sequence: reader.u64()?,
        expected_max_health: reader.u32()?,
        respawn_position: read_fixed_world_vec3_v1(&mut reader)?,
        keep_inventory: reader.flag()?,
    };
    reader.finish()?;
    validate_player_respawn_v1(&value)?;
    Ok(value)
}

fn write_player_respawn_contents_v1(writer: &mut Writer, value: &PlayerRespawnWireV1) -> Result<(), WireError> {
    write_integrated_runtime_identity_v2(writer, &value.expected)?;
    writer.string(&value.external_entity_id)?;
    writer.string(&value.actor_id)?;
    writer.u64(value.player_id.packed());
    writer.u64(value.entity_id.packed());
    writer.u64(value.expected_entity_revision);
    writer.u64(value.expected_gameplay_sequence);
    writer.u64(value.expected_gameplay_combat_revision);
    writer.u64(value.expected_combatant_revision);
    writer.u64(value.expected_death_sequence);
    writer.u32(value.expected_max_health);
    write_fixed_world_vec3_v1(writer, value.respawn_position);
    writer.flag(value.keep_inventory);
    Ok(())
}

fn validate_player_respawn_v1(value: &PlayerRespawnWireV1) -> Result<(), WireError> {
    if value.expected.schema_version != crate::INTEGRATED_RUNTIME_SCHEMA_V2
        || value.expected.universe_id.is_empty()
        || value.expected.location_id.is_empty()
        || value.expected.state_hash == CanonicalHash::default()
        || value.external_entity_id.is_empty()
        || value.external_entity_id.len() > 512
        || value.external_entity_id.chars().any(char::is_control)
        || value.actor_id.is_empty()
        || value.actor_id.len() > 512
        || value.actor_id.chars().any(char::is_control)
        || value.player_id.packed() == 0
        || value.entity_id.packed() == 0
        || value.expected_entity_revision == 0
        || value.expected_death_sequence == 0
        || value.expected_max_health == 0
    {
        return Err(WireError::new(
            "player-respawn-custody",
            "player respawn requires exact nonzero integrated, actor, player, entity, death, and vital identities",
        ));
    }
    if [
        value.expected_entity_revision,
        value.expected_gameplay_sequence,
        value.expected_gameplay_combat_revision,
        value.expected_combatant_revision,
        value.expected_death_sequence,
    ]
    .into_iter()
    .any(|field| field > MAX_SAFE_U64)
    {
        return Err(WireError::new(
            "player-respawn-u64",
            "player respawn compare-and-set cursors exceed the JavaScript-safe range",
        ));
    }
    if [
        value.respawn_position.x_milli,
        value.respawn_position.y_milli,
        value.respawn_position.z_milli,
    ]
    .into_iter()
    .any(|coordinate| coordinate.unsigned_abs() > PLAYER_RESPAWN_MAX_ABS_POSITION_MILLI_V1 as u64)
    {
        return Err(WireError::new(
            "player-respawn-position",
            "player respawn position exceeds the native fixed-point world bounds",
        ));
    }
    Ok(())
}

pub fn player_respawn_receipt_hash_v1(value: &PlayerRespawnReceiptWireV1) -> Result<CanonicalHash, WireError> {
    let mut writer = Writer::default();
    write_player_respawn_receipt_contents_v1(&mut writer, value)?;
    Ok(CanonicalHash(wire_checksum_v1(&writer.finish())))
}

pub fn encode_player_respawn_receipt_v1(value: &PlayerRespawnReceiptWireV1) -> Result<Vec<u8>, WireError> {
    validate_player_respawn_receipt_v1(value)?;
    let mut writer = Writer::default();
    write_player_respawn_receipt_contents_v1(&mut writer, value)?;
    writer.hash(value.receipt_hash);
    wrap_schema(
        PLAYER_RESPAWN_RECEIPT_V1_MAGIC,
        PLAYER_RESPAWN_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_player_respawn_receipt_v1(bytes: &[u8]) -> Result<PlayerRespawnReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PLAYER_RESPAWN_RECEIPT_V1_MAGIC,
        PLAYER_RESPAWN_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let request_payload_hash = reader.hash()?;
    let before = read_integrated_runtime_identity_v2(&mut reader)?;
    let after = read_integrated_runtime_identity_v2(&mut reader)?;
    let external_entity_id = reader.string()?;
    let actor_id = reader.string()?;
    let player_packed = reader.u64()?;
    let entity_packed = reader.u64()?;
    let value = PlayerRespawnReceiptWireV1 {
        request_payload_hash,
        before,
        after,
        external_entity_id,
        actor_id,
        player_id: PlayerId::new(player_packed as u32, (player_packed >> 32) as u32),
        entity_id: EntityId::new(entity_packed as u32, (entity_packed >> 32) as u32),
        death_sequence: reader.u64()?,
        prior_entity_revision: reader.u64()?,
        resulting_entity_revision: reader.u64()?,
        prior_gameplay_sequence: reader.u64()?,
        resulting_gameplay_sequence: reader.u64()?,
        prior_gameplay_combat_revision: reader.u64()?,
        resulting_gameplay_combat_revision: reader.u64()?,
        prior_combatant_revision: reader.u64()?,
        resulting_combatant_revision: reader.u64()?,
        maximum_health: reader.u32()?,
        prior_health: reader.u32()?,
        resulting_health: reader.u32()?,
        prior_alive: reader.flag()?,
        resulting_alive: reader.flag()?,
        respawn_position: read_fixed_world_vec3_v1(&mut reader)?,
        resulting_oxygen_seconds: reader.f64()?,
        keep_inventory: reader.flag()?,
        inventory_before_revision: reader.u64()?,
        inventory_after_revision: reader.u64()?,
        equipment_before_revision: reader.u64()?,
        equipment_after_revision: reader.u64()?,
        custody_before_hash: reader.hash()?,
        custody_after_hash: reader.hash()?,
        generated_drop_count: reader.u32()?,
        receipt_hash: reader.hash()?,
    };
    reader.finish()?;
    validate_player_respawn_receipt_v1(&value)?;
    Ok(value)
}

fn write_player_respawn_receipt_contents_v1(
    writer: &mut Writer,
    value: &PlayerRespawnReceiptWireV1,
) -> Result<(), WireError> {
    writer.hash(value.request_payload_hash);
    write_integrated_runtime_identity_v2(writer, &value.before)?;
    write_integrated_runtime_identity_v2(writer, &value.after)?;
    writer.string(&value.external_entity_id)?;
    writer.string(&value.actor_id)?;
    writer.u64(value.player_id.packed());
    writer.u64(value.entity_id.packed());
    writer.u64(value.death_sequence);
    writer.u64(value.prior_entity_revision);
    writer.u64(value.resulting_entity_revision);
    writer.u64(value.prior_gameplay_sequence);
    writer.u64(value.resulting_gameplay_sequence);
    writer.u64(value.prior_gameplay_combat_revision);
    writer.u64(value.resulting_gameplay_combat_revision);
    writer.u64(value.prior_combatant_revision);
    writer.u64(value.resulting_combatant_revision);
    writer.u32(value.maximum_health);
    writer.u32(value.prior_health);
    writer.u32(value.resulting_health);
    writer.flag(value.prior_alive);
    writer.flag(value.resulting_alive);
    write_fixed_world_vec3_v1(writer, value.respawn_position);
    writer.f64(value.resulting_oxygen_seconds);
    writer.flag(value.keep_inventory);
    writer.u64(value.inventory_before_revision);
    writer.u64(value.inventory_after_revision);
    writer.u64(value.equipment_before_revision);
    writer.u64(value.equipment_after_revision);
    writer.hash(value.custody_before_hash);
    writer.hash(value.custody_after_hash);
    writer.u32(value.generated_drop_count);
    Ok(())
}

fn validate_player_respawn_receipt_v1(value: &PlayerRespawnReceiptWireV1) -> Result<(), WireError> {
    let request = PlayerRespawnWireV1 {
        expected: value.before.clone(),
        external_entity_id: value.external_entity_id.clone(),
        actor_id: value.actor_id.clone(),
        player_id: value.player_id,
        entity_id: value.entity_id,
        expected_entity_revision: value.prior_entity_revision,
        expected_gameplay_sequence: value.prior_gameplay_sequence,
        expected_gameplay_combat_revision: value.prior_gameplay_combat_revision,
        expected_combatant_revision: value.prior_combatant_revision,
        expected_death_sequence: value.death_sequence,
        expected_max_health: value.maximum_health,
        respawn_position: value.respawn_position,
        keep_inventory: value.keep_inventory,
    };
    validate_player_respawn_v1(&request)?;
    let request_bytes = encode_player_respawn_v1(&request)?;
    if value.request_payload_hash == CanonicalHash::default()
        || value.request_payload_hash != CanonicalHash(wire_checksum_v1(&request_bytes))
    {
        return Err(WireError::new(
            "player-respawn-request-hash",
            "player respawn receipt request hash does not match its canonical request",
        ));
    }
    let integrated_gameplay_delta = if !value.keep_inventory && value.generated_drop_count > 0 {
        2
    } else {
        1
    };
    if value.before.universe_id != value.after.universe_id
        || value.before.location_id != value.after.location_id
        || value.before.revision.epoch != value.after.revision.epoch
        || value.before.revision.world != value.after.revision.world
        || value.before.revision.persistence != value.after.revision.persistence
        || value.before.revision.network != value.after.revision.network
        || value.before.revision.entities.checked_add(1) != Some(value.after.revision.entities)
        || value.before.revision.gameplay.checked_add(integrated_gameplay_delta) != Some(value.after.revision.gameplay)
        || value.before.revision.simulation.checked_add(1) != Some(value.after.revision.simulation)
        || value.before.tick != value.after.tick
        || value.before.state_hash == value.after.state_hash
    {
        return Err(WireError::new(
            "player-respawn-identity",
            "player respawn receipt does not attest one exact R5/R6/R7 transition",
        ));
    }
    if value.prior_entity_revision.checked_add(1) != Some(value.resulting_entity_revision)
        || value.prior_gameplay_sequence.checked_add(1) != Some(value.resulting_gameplay_sequence)
        || value.prior_gameplay_combat_revision.checked_add(1) != Some(value.resulting_gameplay_combat_revision)
        || value.prior_combatant_revision.checked_add(1) != Some(value.resulting_combatant_revision)
        || value.maximum_health == 0
        || value.prior_health != 0
        || value.prior_alive
        || value.resulting_health != value.maximum_health
        || !value.resulting_alive
        || !value.resulting_oxygen_seconds.is_finite()
        || value.resulting_oxygen_seconds <= 0.0
    {
        return Err(WireError::new(
            "player-respawn-result",
            "player respawn receipt contains contradictory dead/live revisions, vitals, or body reset",
        ));
    }
    let inventory_revision_delta = value
        .inventory_before_revision
        .checked_add(1)
        .is_some_and(|next| next == value.inventory_after_revision);
    let equipment_revision_delta = value
        .equipment_before_revision
        .checked_add(1)
        .is_some_and(|next| next == value.equipment_after_revision);
    let inventory_revision_stable = value.inventory_before_revision == value.inventory_after_revision;
    let equipment_revision_stable = value.equipment_before_revision == value.equipment_after_revision;
    let custody_hashes_nonzero =
        value.custody_before_hash != CanonicalHash::default() && value.custody_after_hash != CanonicalHash::default();
    let inventory_policy_valid = if value.keep_inventory {
        value.generated_drop_count == 0
            && inventory_revision_stable
            && equipment_revision_stable
            && value.custody_before_hash == value.custody_after_hash
    } else if value.generated_drop_count == 0 {
        inventory_revision_stable && equipment_revision_stable && value.custody_before_hash == value.custody_after_hash
    } else {
        value.generated_drop_count <= 17
            && (inventory_revision_stable || inventory_revision_delta)
            && (equipment_revision_stable || equipment_revision_delta)
            && (inventory_revision_delta || equipment_revision_delta)
            && value.custody_before_hash != value.custody_after_hash
    };
    if !custody_hashes_nonzero || !inventory_policy_valid {
        return Err(WireError::new(
            "player-respawn-inventory-policy",
            "player respawn receipt contains contradictory keep/drop custody revisions, hashes, or generated-drop count",
        ));
    }
    if value.receipt_hash == CanonicalHash::default() || player_respawn_receipt_hash_v1(value)? != value.receipt_hash {
        return Err(WireError::new(
            "player-respawn-receipt-hash",
            "player respawn receipt hash does not match its canonical fields",
        ));
    }
    Ok(())
}

pub fn encode_terrain_residency_batch_v1(value: &IntegratedTerrainResidencyBatchV1) -> Result<Vec<u8>, WireError> {
    validate_terrain_residency_wire_batch_v1(value)?;
    let mut writer = Writer::default();
    write_world_revision(&mut writer, value.expected_world_revision);
    writer.string(&value.generation_options_json)?;
    writer.count(
        value.chunks.len(),
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "terrain residency chunks",
    )?;
    for chunk in &value.chunks {
        writer.i32(chunk.chunk_x);
        writer.i32(chunk.chunk_z);
    }
    wrap(TERRAIN_RESIDENCY_BATCH_MAGIC, writer.finish())
}

pub fn decode_terrain_residency_batch_v1(bytes: &[u8]) -> Result<IntegratedTerrainResidencyBatchV1, WireError> {
    let mut reader = Reader::new(unwrap(TERRAIN_RESIDENCY_BATCH_MAGIC, bytes)?);
    let expected_world_revision = read_world_revision(&mut reader)?;
    let generation_options_json = reader.string()?;
    let count = reader.count(
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "terrain residency chunks",
    )?;
    let mut chunks = Vec::with_capacity(count);
    for _ in 0..count {
        chunks.push(IntegratedTerrainChunkCoordinateV1 {
            chunk_x: reader.i32()?,
            chunk_z: reader.i32()?,
        });
    }
    reader.finish()?;
    let value = IntegratedTerrainResidencyBatchV1 {
        expected_world_revision,
        generation_options_json,
        chunks,
    };
    validate_terrain_residency_wire_batch_v1(&value)?;
    Ok(value)
}

pub fn encode_terrain_residency_receipt_v1(value: &IntegratedTerrainResidencyReceiptV1) -> Result<Vec<u8>, WireError> {
    validate_terrain_residency_wire_receipt_v1(value)?;
    let mut writer = Writer::default();
    write_world_revision(&mut writer, value.previous_world_revision);
    write_world_revision(&mut writer, value.world_revision);
    writer.u32(value.requested_chunks);
    writer.u32(value.generated_chunks);
    writer.u32(value.already_resident_chunks);
    writer.u32(value.requested_resident_chunks);
    writer.u32(value.resident_sections);
    writer.count(
        value.chunks.len(),
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "terrain residency receipt chunks",
    )?;
    for chunk in &value.chunks {
        writer.i32(chunk.coordinate.chunk_x);
        writer.i32(chunk.coordinate.chunk_z);
        writer.u8(chunk.status as u8);
        writer.u16(chunk.resident_sections);
        writer.u32(chunk.edit_count);
        writer.u32(chunk.generation_revision);
        writer.hash(chunk.request_hash);
        writer.hash(chunk.source_hash);
        writer.hash(chunk.edit_hash);
        writer.hash(chunk.namespace_hash);
        writer.flag(chunk.cache_hit);
    }
    writer.hash(value.state_hash);
    wrap(TERRAIN_RESIDENCY_RECEIPT_MAGIC, writer.finish())
}

pub fn decode_terrain_residency_receipt_v1(bytes: &[u8]) -> Result<IntegratedTerrainResidencyReceiptV1, WireError> {
    let mut reader = Reader::new(unwrap(TERRAIN_RESIDENCY_RECEIPT_MAGIC, bytes)?);
    let previous_world_revision = read_world_revision(&mut reader)?;
    let world_revision = read_world_revision(&mut reader)?;
    let requested_chunks = reader.u32()?;
    let generated_chunks = reader.u32()?;
    let already_resident_chunks = reader.u32()?;
    let requested_resident_chunks = reader.u32()?;
    let resident_sections = reader.u32()?;
    let count = reader.count(
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "terrain residency receipt chunks",
    )?;
    let mut chunks = Vec::with_capacity(count);
    for _ in 0..count {
        chunks.push(IntegratedTerrainResidencyChunkReceiptV1 {
            coordinate: IntegratedTerrainChunkCoordinateV1 {
                chunk_x: reader.i32()?,
                chunk_z: reader.i32()?,
            },
            status: match reader.u8()? {
                0 => IntegratedTerrainResidencyStatusV1::AlreadyResident,
                1 => IntegratedTerrainResidencyStatusV1::Generated,
                _ => return Err(WireError::new("terrain-residency-status", "unknown residency status")),
            },
            resident_sections: reader.u16()?,
            edit_count: reader.u32()?,
            generation_revision: reader.u32()?,
            request_hash: reader.hash()?,
            source_hash: reader.hash()?,
            edit_hash: reader.hash()?,
            namespace_hash: reader.hash()?,
            cache_hit: reader.flag()?,
        });
    }
    let state_hash = reader.hash()?;
    reader.finish()?;
    let value = IntegratedTerrainResidencyReceiptV1 {
        previous_world_revision,
        world_revision,
        requested_chunks,
        generated_chunks,
        already_resident_chunks,
        requested_resident_chunks,
        resident_sections,
        chunks,
        state_hash,
    };
    validate_terrain_residency_wire_receipt_v1(&value)?;
    Ok(value)
}

pub fn encode_terrain_residency_reconcile_batch_v2(
    value: &IntegratedTerrainResidencyReconcileBatchV2,
) -> Result<Vec<u8>, WireError> {
    validate_terrain_residency_reconcile_wire_batch_v2(value)?;
    let mut writer = Writer::default();
    write_world_revision(&mut writer, value.expected_world_revision);
    writer.string(&value.generation_options_json)?;
    write_terrain_coordinate_list_v2(
        &mut writer,
        &value.desired_chunks,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "desired terrain chunks",
    )?;
    wrap_schema(TERRAIN_RESIDENCY_RECONCILE_BATCH_MAGIC, 2, writer.finish())
}

pub fn decode_terrain_residency_reconcile_batch_v2(
    bytes: &[u8],
) -> Result<IntegratedTerrainResidencyReconcileBatchV2, WireError> {
    let mut reader = Reader::new(unwrap_schema(TERRAIN_RESIDENCY_RECONCILE_BATCH_MAGIC, 2, bytes)?);
    let value = IntegratedTerrainResidencyReconcileBatchV2 {
        expected_world_revision: read_world_revision(&mut reader)?,
        generation_options_json: reader.string()?,
        desired_chunks: read_terrain_coordinate_list_v2(
            &mut reader,
            INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
            "desired terrain chunks",
        )?,
    };
    reader.finish()?;
    validate_terrain_residency_reconcile_wire_batch_v2(&value)?;
    Ok(value)
}

pub fn encode_terrain_residency_reconcile_receipt_v2(
    value: &IntegratedTerrainResidencyReconcileReceiptV2,
) -> Result<Vec<u8>, WireError> {
    validate_terrain_residency_reconcile_wire_receipt_v2(value)?;
    let mut writer = Writer::default();
    write_world_revision(&mut writer, value.previous_world_revision);
    write_world_revision(&mut writer, value.world_revision);
    writer.u32(value.desired_chunk_count);
    writer.u32(value.generated_chunk_count);
    writer.u32(value.retained_chunk_count);
    writer.u32(value.evicted_chunk_count);
    writer.u32(value.resident_sections);
    write_terrain_coordinate_list_v2(
        &mut writer,
        &value.desired_chunks,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "desired terrain chunks",
    )?;
    write_terrain_coordinate_list_v2(
        &mut writer,
        &value.generated_chunks,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "generated terrain chunks",
    )?;
    write_terrain_coordinate_list_v2(
        &mut writer,
        &value.retained_chunks,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "retained terrain chunks",
    )?;
    write_terrain_coordinate_list_v2(
        &mut writer,
        &value.evicted_chunks,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RECONCILE_EVICTED_CHUNKS_V2,
        "evicted terrain chunks",
    )?;
    writer.hash(value.state_hash);
    wrap_schema(TERRAIN_RESIDENCY_RECONCILE_RECEIPT_MAGIC, 2, writer.finish())
}

pub fn decode_terrain_residency_reconcile_receipt_v2(
    bytes: &[u8],
) -> Result<IntegratedTerrainResidencyReconcileReceiptV2, WireError> {
    let mut reader = Reader::new(unwrap_schema(TERRAIN_RESIDENCY_RECONCILE_RECEIPT_MAGIC, 2, bytes)?);
    let previous_world_revision = read_world_revision(&mut reader)?;
    let world_revision = read_world_revision(&mut reader)?;
    let desired_chunk_count = reader.u32()?;
    let generated_chunk_count = reader.u32()?;
    let retained_chunk_count = reader.u32()?;
    let evicted_chunk_count = reader.u32()?;
    let resident_sections = reader.u32()?;
    let desired_chunks = read_terrain_coordinate_list_v2(
        &mut reader,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "desired terrain chunks",
    )?;
    let generated_chunks = read_terrain_coordinate_list_v2(
        &mut reader,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "generated terrain chunks",
    )?;
    let retained_chunks = read_terrain_coordinate_list_v2(
        &mut reader,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        "retained terrain chunks",
    )?;
    let evicted_chunks = read_terrain_coordinate_list_v2(
        &mut reader,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RECONCILE_EVICTED_CHUNKS_V2,
        "evicted terrain chunks",
    )?;
    let state_hash = reader.hash()?;
    reader.finish()?;
    let value = IntegratedTerrainResidencyReconcileReceiptV2 {
        previous_world_revision,
        world_revision,
        desired_chunk_count,
        generated_chunk_count,
        retained_chunk_count,
        evicted_chunk_count,
        resident_sections,
        desired_chunks,
        generated_chunks,
        retained_chunks,
        evicted_chunks,
        state_hash,
    };
    validate_terrain_residency_reconcile_wire_receipt_v2(&value)?;
    Ok(value)
}

fn write_terrain_coordinate_list_v2(
    writer: &mut Writer,
    coordinates: &[IntegratedTerrainChunkCoordinateV1],
    maximum: usize,
    label: &'static str,
) -> Result<(), WireError> {
    writer.count(coordinates.len(), maximum, label)?;
    for coordinate in coordinates {
        writer.i32(coordinate.chunk_x);
        writer.i32(coordinate.chunk_z);
    }
    Ok(())
}

fn read_terrain_coordinate_list_v2(
    reader: &mut Reader<'_>,
    maximum: usize,
    label: &'static str,
) -> Result<Vec<IntegratedTerrainChunkCoordinateV1>, WireError> {
    let count = reader.count(maximum, label)?;
    let mut coordinates = Vec::with_capacity(count);
    for _ in 0..count {
        coordinates.push(IntegratedTerrainChunkCoordinateV1 {
            chunk_x: reader.i32()?,
            chunk_z: reader.i32()?,
        });
    }
    Ok(coordinates)
}

fn write_world_revision(writer: &mut Writer, value: WorldAuthorityRevisionV1) {
    writer.u64(value.epoch);
    writer.u64(value.mutation);
    writer.u64(value.residency);
}

fn read_world_revision(reader: &mut Reader<'_>) -> Result<WorldAuthorityRevisionV1, WireError> {
    let value = WorldAuthorityRevisionV1 {
        epoch: reader.u64()?,
        mutation: reader.u64()?,
        residency: reader.u64()?,
    };
    value
        .validate()
        .map_err(|error| WireError::new("terrain-residency-revision", error.to_string()))?;
    Ok(value)
}

fn validate_terrain_residency_wire_batch_v1(value: &IntegratedTerrainResidencyBatchV1) -> Result<(), WireError> {
    value
        .expected_world_revision
        .validate()
        .map_err(|error| WireError::new("terrain-residency-revision", error.to_string()))?;
    validate_canonical_generation_options_json_v1(&value.generation_options_json)
        .map_err(|error| WireError::new("invalid-generation-options", error.message))?;
    if value.chunks.is_empty()
        || value.chunks.len() > INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1
        || value.chunks.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err(WireError::new(
            "terrain-residency-batch",
            "terrain residency batch is malformed, unsorted, duplicated, or outside bounds",
        ));
    }
    Ok(())
}

fn validate_terrain_residency_wire_receipt_v1(value: &IntegratedTerrainResidencyReceiptV1) -> Result<(), WireError> {
    value
        .previous_world_revision
        .validate()
        .map_err(|error| WireError::new("terrain-residency-revision", error.to_string()))?;
    value
        .world_revision
        .validate()
        .map_err(|error| WireError::new("terrain-residency-revision", error.to_string()))?;
    let count = value.chunks.len() as u32;
    let generated = value
        .chunks
        .iter()
        .filter(|chunk| chunk.status == IntegratedTerrainResidencyStatusV1::Generated)
        .count() as u32;
    let already_resident = count.saturating_sub(generated);
    if value.chunks.is_empty()
        || value.chunks.len() > INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1
        || value.requested_chunks != count
        || value.requested_resident_chunks != count
        || value.generated_chunks.saturating_add(value.already_resident_chunks) != count
        || value.generated_chunks != generated
        || value.already_resident_chunks != already_resident
        || value
            .chunks
            .windows(2)
            .any(|pair| pair[0].coordinate >= pair[1].coordinate)
        || value
            .chunks
            .iter()
            .any(|chunk| chunk.resident_sections != 12 || chunk.generation_revision == 0)
    {
        return Err(WireError::new(
            "terrain-residency-receipt",
            "terrain residency receipt counters or chunk diagnostics are inconsistent",
        ));
    }
    Ok(())
}

fn validate_canonical_terrain_coordinates_v2(
    values: &[IntegratedTerrainChunkCoordinateV1],
    maximum: usize,
    allow_empty: bool,
) -> bool {
    (allow_empty || !values.is_empty()) && values.len() <= maximum && !values.windows(2).any(|pair| pair[0] >= pair[1])
}

fn validate_terrain_residency_reconcile_wire_batch_v2(
    value: &IntegratedTerrainResidencyReconcileBatchV2,
) -> Result<(), WireError> {
    value
        .expected_world_revision
        .validate()
        .map_err(|error| WireError::new("terrain-residency-revision", error.to_string()))?;
    validate_canonical_generation_options_json_v1(&value.generation_options_json)
        .map_err(|error| WireError::new("invalid-generation-options", error.message))?;
    if !validate_canonical_terrain_coordinates_v2(
        &value.desired_chunks,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        false,
    ) {
        return Err(WireError::new(
            "terrain-residency-reconcile-batch",
            "terrain residency reconcile desired set is empty, unsorted, duplicated, or outside bounds",
        ));
    }
    Ok(())
}

fn validate_terrain_residency_reconcile_wire_receipt_v2(
    value: &IntegratedTerrainResidencyReconcileReceiptV2,
) -> Result<(), WireError> {
    value
        .previous_world_revision
        .validate()
        .map_err(|error| WireError::new("terrain-residency-revision", error.to_string()))?;
    value
        .world_revision
        .validate()
        .map_err(|error| WireError::new("terrain-residency-revision", error.to_string()))?;
    let desired = value.desired_chunks.iter().copied().collect::<BTreeSet<_>>();
    let generated = value.generated_chunks.iter().copied().collect::<BTreeSet<_>>();
    let retained = value.retained_chunks.iter().copied().collect::<BTreeSet<_>>();
    let evicted = value.evicted_chunks.iter().copied().collect::<BTreeSet<_>>();
    let generated_or_retained = generated.union(&retained).copied().collect::<BTreeSet<_>>();
    if !validate_canonical_terrain_coordinates_v2(
        &value.desired_chunks,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        false,
    ) || !validate_canonical_terrain_coordinates_v2(
        &value.generated_chunks,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        true,
    ) || !validate_canonical_terrain_coordinates_v2(
        &value.retained_chunks,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1,
        true,
    ) || !validate_canonical_terrain_coordinates_v2(
        &value.evicted_chunks,
        INTEGRATED_RUNTIME_MAX_TERRAIN_RECONCILE_EVICTED_CHUNKS_V2,
        true,
    ) || value.desired_chunk_count as usize != value.desired_chunks.len()
        || value.generated_chunk_count as usize != value.generated_chunks.len()
        || value.retained_chunk_count as usize != value.retained_chunks.len()
        || value.evicted_chunk_count as usize != value.evicted_chunks.len()
        || value.resident_sections != value.desired_chunk_count.saturating_mul(12)
        || !generated.is_disjoint(&retained)
        || !desired.is_disjoint(&evicted)
        || desired != generated_or_retained
        || value.previous_world_revision.epoch != value.world_revision.epoch
        || value.previous_world_revision.mutation != value.world_revision.mutation
        || value.world_revision.residency < value.previous_world_revision.residency
    {
        return Err(WireError::new(
            "terrain-residency-reconcile-receipt",
            "terrain residency reconcile receipt lists, counters, partition, or final section count are inconsistent",
        ));
    }
    Ok(())
}

fn validate_persistence_dispatch_integers_v1(value: &RuntimePersistenceDispatchWireV1) -> Result<(), WireError> {
    use RuntimePersistenceDispatchWireV1::*;
    let values: &[u64] = match value {
        ReadRecoveryPage { start_record, .. } => &[*start_record],
        PreserveLegacyBackupChunk {
            offset, total_bytes, ..
        }
        | ImportChunk {
            offset, total_bytes, ..
        } => &[*offset, *total_bytes],
        ExportPage { cursor, .. } => &[*cursor],
        FinalizeImport { total_bytes, .. } => &[*total_bytes],
        Retry { previous_request_id } => &[*previous_request_id],
        _ => &[],
    };
    if values.iter().any(|value| *value > MAX_SAFE_U64) {
        return Err(WireError::new(
            "domain-number",
            "persistence u64 exceeds the JavaScript exact range",
        ));
    }
    Ok(())
}

fn validate_persistence_receipt_integers_v1(value: &RuntimePersistenceDispatchReceiptWireV1) -> Result<(), WireError> {
    if value.request_id.is_some_and(|id| id > MAX_SAFE_U64)
        || value.persistence_revision > MAX_SAFE_U64
        || value.queued_bytes > MAX_SAFE_U64
    {
        return Err(WireError::new(
            "domain-number",
            "persistence receipt u64 exceeds the JavaScript exact range",
        ));
    }
    Ok(())
}

pub fn encode_runtime_persistence_dispatch_v1(value: &RuntimePersistenceDispatchWireV1) -> Result<Vec<u8>, WireError> {
    validate_persistence_dispatch_integers_v1(value)?;
    let mut writer = Writer::default();
    match value {
        RuntimePersistenceDispatchWireV1::Commit { browser_request } => {
            writer.u8(1);
            writer.bytes(
                browser_request,
                MAX_DOMAIN_PAYLOAD_BYTES - DOMAIN_HEADER_BYTES,
                "persistence commit",
            )?;
        }
        RuntimePersistenceDispatchWireV1::Recover {
            world_id,
            checkpoint_id,
        } => {
            writer.u8(4);
            writer.string(world_id)?;
            writer.option_string(checkpoint_id.as_deref())?;
        }
        RuntimePersistenceDispatchWireV1::ReadRecoveryPage {
            world_id,
            checkpoint_id,
            start_record,
            max_records,
            max_bytes,
        } => {
            writer.u8(5);
            writer.string(world_id)?;
            writer.string(checkpoint_id)?;
            writer.u64(*start_record);
            writer.u32(*max_records);
            writer.u32(*max_bytes);
        }
        RuntimePersistenceDispatchWireV1::Estimate { world_id } => {
            writer.u8(6);
            writer.string(world_id)?;
        }
        RuntimePersistenceDispatchWireV1::Compact {
            world_id,
            checkpoint_id,
            expected_head_hash,
            retain_parent_count,
        } => {
            writer.u8(7);
            writer.string(world_id)?;
            writer.string(checkpoint_id)?;
            writer.hash(*expected_head_hash);
            writer.u16(*retain_parent_count);
        }
        RuntimePersistenceDispatchWireV1::Delete {
            world_id,
            expected_head_hash,
            tombstone,
        } => {
            writer.u8(8);
            writer.string(world_id)?;
            writer.flag(expected_head_hash.is_some());
            if let Some(hash) = expected_head_hash {
                writer.hash(*hash);
            }
            writer.hash(*tombstone);
        }
        RuntimePersistenceDispatchWireV1::PreserveLegacyBackupChunk {
            world_id,
            backup_id,
            offset,
            total_bytes,
            bytes,
        } => {
            writer.u8(9);
            writer.string(world_id)?;
            writer.string(backup_id)?;
            writer.u64(*offset);
            writer.u64(*total_bytes);
            writer.bytes(
                bytes,
                MAX_DOMAIN_PAYLOAD_BYTES - DOMAIN_HEADER_BYTES,
                "legacy backup chunk",
            )?;
        }
        RuntimePersistenceDispatchWireV1::ExportPage {
            world_id,
            checkpoint_id,
            cursor,
            max_bytes,
        } => {
            writer.u8(10);
            writer.string(world_id)?;
            writer.string(checkpoint_id)?;
            writer.u64(*cursor);
            writer.u32(*max_bytes);
        }
        RuntimePersistenceDispatchWireV1::ImportChunk {
            world_id,
            import_id,
            offset,
            total_bytes,
            bytes,
        } => {
            writer.u8(11);
            writer.string(world_id)?;
            writer.string(import_id)?;
            writer.u64(*offset);
            writer.u64(*total_bytes);
            writer.bytes(bytes, MAX_DOMAIN_PAYLOAD_BYTES - DOMAIN_HEADER_BYTES, "import chunk")?;
        }
        RuntimePersistenceDispatchWireV1::FinalizeImport {
            world_id,
            import_id,
            archive_hash,
            total_bytes,
        } => {
            writer.u8(12);
            writer.string(world_id)?;
            writer.string(import_id)?;
            writer.hash(*archive_hash);
            writer.u64(*total_bytes);
        }
        RuntimePersistenceDispatchWireV1::Retry { previous_request_id } => {
            writer.u8(13);
            writer.u64(*previous_request_id);
        }
        RuntimePersistenceDispatchWireV1::Close => writer.u8(14),
    }
    wrap_schema(
        PERSISTENCE_DISPATCH_V1_MAGIC,
        PERSISTENCE_DISPATCH_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_persistence_dispatch_v1(bytes: &[u8]) -> Result<RuntimePersistenceDispatchWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PERSISTENCE_DISPATCH_V1_MAGIC,
        PERSISTENCE_DISPATCH_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = match reader.u8()? {
        1 => RuntimePersistenceDispatchWireV1::Commit {
            browser_request: reader.bytes(MAX_DOMAIN_PAYLOAD_BYTES - DOMAIN_HEADER_BYTES, "persistence commit")?,
        },
        4 => RuntimePersistenceDispatchWireV1::Recover {
            world_id: reader.string()?,
            checkpoint_id: reader.option_string()?,
        },
        5 => RuntimePersistenceDispatchWireV1::ReadRecoveryPage {
            world_id: reader.string()?,
            checkpoint_id: reader.string()?,
            start_record: reader.u64()?,
            max_records: reader.u32()?,
            max_bytes: reader.u32()?,
        },
        6 => RuntimePersistenceDispatchWireV1::Estimate {
            world_id: reader.string()?,
        },
        7 => RuntimePersistenceDispatchWireV1::Compact {
            world_id: reader.string()?,
            checkpoint_id: reader.string()?,
            expected_head_hash: reader.hash()?,
            retain_parent_count: reader.u16()?,
        },
        8 => RuntimePersistenceDispatchWireV1::Delete {
            world_id: reader.string()?,
            expected_head_hash: if reader.flag()? { Some(reader.hash()?) } else { None },
            tombstone: reader.hash()?,
        },
        9 => RuntimePersistenceDispatchWireV1::PreserveLegacyBackupChunk {
            world_id: reader.string()?,
            backup_id: reader.string()?,
            offset: reader.u64()?,
            total_bytes: reader.u64()?,
            bytes: reader.bytes(MAX_DOMAIN_PAYLOAD_BYTES - DOMAIN_HEADER_BYTES, "legacy backup chunk")?,
        },
        10 => RuntimePersistenceDispatchWireV1::ExportPage {
            world_id: reader.string()?,
            checkpoint_id: reader.string()?,
            cursor: reader.u64()?,
            max_bytes: reader.u32()?,
        },
        11 => RuntimePersistenceDispatchWireV1::ImportChunk {
            world_id: reader.string()?,
            import_id: reader.string()?,
            offset: reader.u64()?,
            total_bytes: reader.u64()?,
            bytes: reader.bytes(MAX_DOMAIN_PAYLOAD_BYTES - DOMAIN_HEADER_BYTES, "import chunk")?,
        },
        12 => RuntimePersistenceDispatchWireV1::FinalizeImport {
            world_id: reader.string()?,
            import_id: reader.string()?,
            archive_hash: reader.hash()?,
            total_bytes: reader.u64()?,
        },
        13 => RuntimePersistenceDispatchWireV1::Retry {
            previous_request_id: reader.u64()?,
        },
        14 => RuntimePersistenceDispatchWireV1::Close,
        _ => {
            return Err(WireError::new(
                "persistence-operation",
                "unknown persistence dispatcher operation",
            ));
        }
    };
    reader.finish()?;
    validate_persistence_dispatch_integers_v1(&value)?;
    Ok(value)
}

pub fn encode_runtime_persistence_dispatch_receipt_v1(
    value: &RuntimePersistenceDispatchReceiptWireV1,
) -> Result<Vec<u8>, WireError> {
    validate_persistence_receipt_integers_v1(value)?;
    let mut writer = Writer::default();
    writer.flag(value.request_id.is_some());
    if let Some(request_id) = value.request_id {
        writer.u64(request_id);
    }
    writer.u64(value.persistence_revision);
    writer.u32(value.pending);
    writer.u64(value.queued_bytes);
    writer.hash(value.state_hash);
    writer.flag(value.closed);
    wrap_schema(
        PERSISTENCE_DISPATCH_RECEIPT_V1_MAGIC,
        PERSISTENCE_DISPATCH_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_runtime_persistence_dispatch_receipt_v1(
    bytes: &[u8],
) -> Result<RuntimePersistenceDispatchReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        PERSISTENCE_DISPATCH_RECEIPT_V1_MAGIC,
        PERSISTENCE_DISPATCH_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = RuntimePersistenceDispatchReceiptWireV1 {
        request_id: if reader.flag()? { Some(reader.u64()?) } else { None },
        persistence_revision: reader.u64()?,
        pending: reader.u32()?,
        queued_bytes: reader.u64()?,
        state_hash: reader.hash()?,
        closed: reader.flag()?,
    };
    reader.finish()?;
    validate_persistence_receipt_integers_v1(&value)?;
    Ok(value)
}

pub fn encode_runtime_persistence_status_query_v1() -> Result<Vec<u8>, WireError> {
    wrap(PERSISTENCE_STATUS_MAGIC, Vec::new())
}

pub fn decode_runtime_persistence_status_query_v1(bytes: &[u8]) -> Result<(), WireError> {
    let reader = Reader::new(unwrap(PERSISTENCE_STATUS_MAGIC, bytes)?);
    reader.finish()
}

pub fn encode_runtime_persistence_status_receipt_v1(
    value: &RuntimePersistenceStatusReceiptWireV1,
) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    writer.u64(value.persistence_revision);
    writer.u32(value.pending);
    writer.u64(value.queued_bytes);
    writer.hash(value.dispatcher_state_hash);
    writer.hash(value.authority_state_hash);
    writer.flag(value.closed);
    writer.flag(value.terminal_checkpoint.is_some());
    if let Some(checkpoint) = &value.terminal_checkpoint {
        writer.string(&checkpoint.checkpoint_id)?;
        writer.hash(checkpoint.checkpoint_hash);
        writer.u64(checkpoint.journal_sequence);
        writer.u32(checkpoint.record_count);
        writer.hash(checkpoint.save_set_hash);
        writer.hash(checkpoint.manifest_hash);
    }
    wrap(PERSISTENCE_STATUS_RECEIPT_MAGIC, writer.finish())
}

pub fn decode_runtime_persistence_status_receipt_v1(
    bytes: &[u8],
) -> Result<RuntimePersistenceStatusReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap(PERSISTENCE_STATUS_RECEIPT_MAGIC, bytes)?);
    let value = RuntimePersistenceStatusReceiptWireV1 {
        persistence_revision: reader.u64()?,
        pending: reader.u32()?,
        queued_bytes: reader.u64()?,
        dispatcher_state_hash: reader.hash()?,
        authority_state_hash: reader.hash()?,
        closed: reader.flag()?,
        terminal_checkpoint: if reader.flag()? {
            Some(RuntimePersistenceTerminalCheckpointWireV1 {
                checkpoint_id: reader.string()?,
                checkpoint_hash: reader.hash()?,
                journal_sequence: reader.u64()?,
                record_count: reader.u32()?,
                save_set_hash: reader.hash()?,
                manifest_hash: reader.hash()?,
            })
        } else {
            None
        },
    };
    reader.finish()?;
    Ok(value)
}

#[derive(Clone, Debug)]
pub struct NetworkDeltaBuildRequestWireV1 {
    pub source: InterestDeltaBuildSourceV1,
    pub interest: NetworkInterestSetV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkReconnectRequestWireV1 {
    pub session_id: String,
    pub peer_id: String,
    pub connection_generation: u64,
}

pub fn encode_network_replication_record_v1(value: &ScopedDeltaRecordV1) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    write_replication_scope(&mut writer, &value.scope)?;
    write_network_delta_record(&mut writer, &value.record)?;
    wrap_schema(
        NETWORK_REPLICATION_UPSERT_V1_MAGIC,
        NETWORK_REPLICATION_UPSERT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_network_replication_record_v1(bytes: &[u8]) -> Result<ScopedDeltaRecordV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NETWORK_REPLICATION_UPSERT_V1_MAGIC,
        NETWORK_REPLICATION_UPSERT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = ScopedDeltaRecordV1 {
        scope: read_replication_scope(&mut reader)?,
        record: read_network_delta_record(&mut reader)?,
    };
    reader.finish()?;
    value
        .scope
        .validate()
        .map_err(|error| WireError::new("network-replication", error.to_string()))?;
    Ok(value)
}

pub fn encode_network_delta_build_request_v1(value: &NetworkDeltaBuildRequestWireV1) -> Result<Vec<u8>, WireError> {
    value
        .interest
        .validate()
        .map_err(|error| WireError::new("network-delta", error.to_string()))?;
    let mut writer = Writer::default();
    writer.string(&value.source.session_id)?;
    writer.string(&value.source.delta_id)?;
    writer.string(&value.source.peer_id)?;
    writer.flag(value.source.keyframe);
    writer.u64(value.source.sequence);
    writer.u64(value.source.acknowledged_command_sequence);
    write_network_identity(&mut writer, &value.source.from)?;
    write_network_identity(&mut writer, &value.source.to)?;
    write_network_interest(&mut writer, &value.interest)?;
    wrap_schema(
        NETWORK_DELTA_BUILD_V1_MAGIC,
        NETWORK_DELTA_BUILD_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_network_delta_build_request_v1(bytes: &[u8]) -> Result<NetworkDeltaBuildRequestWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NETWORK_DELTA_BUILD_V1_MAGIC,
        NETWORK_DELTA_BUILD_V1_INNER_SCHEMA,
        bytes,
    )?);
    let source = InterestDeltaBuildSourceV1 {
        session_id: reader.string()?,
        delta_id: reader.string()?,
        peer_id: reader.string()?,
        keyframe: reader.flag()?,
        sequence: reader.u64()?,
        acknowledged_command_sequence: reader.u64()?,
        from: read_network_identity(&mut reader)?,
        to: read_network_identity(&mut reader)?,
    };
    let interest = read_network_interest(&mut reader)?;
    reader.finish()?;
    Ok(NetworkDeltaBuildRequestWireV1 { source, interest })
}

pub fn encode_network_reconnect_request_v1(value: &NetworkReconnectRequestWireV1) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    writer.string(&value.session_id)?;
    writer.string(&value.peer_id)?;
    writer.u64(value.connection_generation);
    wrap_schema(
        NETWORK_RECONNECT_V1_MAGIC,
        NETWORK_RECONNECT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_network_reconnect_request_v1(bytes: &[u8]) -> Result<NetworkReconnectRequestWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NETWORK_RECONNECT_V1_MAGIC,
        NETWORK_RECONNECT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = NetworkReconnectRequestWireV1 {
        session_id: reader.string()?,
        peer_id: reader.string()?,
        connection_generation: reader.u64()?,
    };
    reader.finish()?;
    Ok(value)
}

pub fn encode_network_peer_release_v1(peer_id: &str) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    writer.string(peer_id)?;
    wrap_schema(
        NETWORK_PEER_RELEASE_V1_MAGIC,
        NETWORK_PEER_RELEASE_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_network_peer_release_v1(bytes: &[u8]) -> Result<String, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NETWORK_PEER_RELEASE_V1_MAGIC,
        NETWORK_PEER_RELEASE_V1_INNER_SCHEMA,
        bytes,
    )?);
    let peer_id = reader.string()?;
    reader.finish()?;
    Ok(peer_id)
}

pub fn encode_network_command_release_v1(command_id: &str) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    writer.string(command_id)?;
    wrap_schema(
        NETWORK_COMMAND_RELEASE_V1_MAGIC,
        NETWORK_COMMAND_RELEASE_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_network_command_release_v1(bytes: &[u8]) -> Result<String, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NETWORK_COMMAND_RELEASE_V1_MAGIC,
        NETWORK_COMMAND_RELEASE_V1_INNER_SCHEMA,
        bytes,
    )?);
    let command_id = reader.string()?;
    reader.finish()?;
    Ok(command_id)
}

pub fn encode_network_peer_grant_v1(value: &NetworkPeerGrantV1) -> Result<Vec<u8>, WireError> {
    value
        .validate()
        .map_err(|error| WireError::new("network-grant", error.to_string()))?;
    let mut writer = Writer::default();
    writer.string(&value.session_id)?;
    writer.string(&value.peer_id)?;
    writer.string(&value.connection_id)?;
    writer.string(&value.actor_id)?;
    writer.u8(value.peer_kind as u8);
    writer.u8(value.role as u8);
    if value.capabilities.len() > 10 {
        return Err(WireError::new(
            "network-grant",
            "network capability count exceeds its budget",
        ));
    }
    writer.u8(value.capabilities.len() as u8);
    for capability in &value.capabilities {
        writer.u8(*capability as u8);
    }
    writer.u64(value.expires_at);
    writer.u64(value.next_sequence);
    write_network_interest(&mut writer, &value.interest)?;
    wrap_schema(
        NETWORK_PEER_GRANT_V1_MAGIC,
        NETWORK_PEER_GRANT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_network_peer_grant_v1(bytes: &[u8]) -> Result<NetworkPeerGrantV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NETWORK_PEER_GRANT_V1_MAGIC,
        NETWORK_PEER_GRANT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let session_id = reader.string()?;
    let peer_id = reader.string()?;
    let connection_id = reader.string()?;
    let actor_id = reader.string()?;
    let peer_kind = match reader.u8()? {
        0 => NetworkPeerKindV1::Human,
        1 => NetworkPeerKindV1::Agent,
        _ => return Err(WireError::new("network-grant", "unknown network peer kind")),
    };
    let role = match reader.u8()? {
        0 => NetworkPeerRoleV1::Host,
        1 => NetworkPeerRoleV1::Guest,
        _ => return Err(WireError::new("network-grant", "unknown network peer role")),
    };
    let capability_count = reader.u8()? as usize;
    if capability_count > 10 {
        return Err(WireError::new(
            "network-grant",
            "network capability count exceeds its budget",
        ));
    }
    let mut capabilities = Vec::with_capacity(capability_count);
    for _ in 0..capability_count {
        capabilities.push(network_capability(reader.u8()?)?);
    }
    let expires_at = reader.u64()?;
    let next_sequence = reader.u64()?;
    let interest = read_network_interest(&mut reader)?;
    reader.finish()?;
    let value = NetworkPeerGrantV1 {
        session_id,
        peer_id,
        connection_id,
        actor_id,
        peer_kind,
        role,
        capabilities,
        expires_at,
        next_sequence,
        interest,
    };
    value
        .validate()
        .map_err(|error| WireError::new("network-grant", error.to_string()))?;
    Ok(value)
}

pub fn encode_network_agent_grant_v1(value: &AgentCapabilityGrantV1) -> Result<Vec<u8>, WireError> {
    value
        .validate()
        .map_err(|error| WireError::new("agent-grant", error.to_string()))?;
    let mut writer = Writer::default();
    writer.string(&value.agent_id)?;
    writer.string(&value.peer_id)?;
    writer.string(&value.connection_id)?;
    writer.u8(agent_lifecycle_tag(value.status));
    write_agent_capabilities(&mut writer, &value.requested)?;
    write_agent_capabilities(&mut writer, &value.granted)?;
    writer.u64(value.expires_at);
    wrap_schema(
        NETWORK_AGENT_GRANT_V1_MAGIC,
        NETWORK_AGENT_GRANT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_network_agent_grant_v1(bytes: &[u8]) -> Result<AgentCapabilityGrantV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        NETWORK_AGENT_GRANT_V1_MAGIC,
        NETWORK_AGENT_GRANT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = AgentCapabilityGrantV1 {
        agent_id: reader.string()?,
        peer_id: reader.string()?,
        connection_id: reader.string()?,
        status: read_agent_lifecycle(&mut reader)?,
        requested: read_agent_capabilities(&mut reader)?,
        granted: read_agent_capabilities(&mut reader)?,
        expires_at: reader.u64()?,
    };
    reader.finish()?;
    value
        .validate()
        .map_err(|error| WireError::new("agent-grant", error.to_string()))?;
    Ok(value)
}

fn write_network_interest(writer: &mut Writer, value: &NetworkInterestSetV1) -> Result<(), WireError> {
    value
        .validate()
        .map_err(|error| WireError::new("network-interest", error.to_string()))?;
    writer.u64(value.sequence);
    writer.count(value.chunks.len(), 1_024, "network interest chunk count")?;
    for chunk in &value.chunks {
        writer.string(&chunk.address.universe_id)?;
        writer.string(&chunk.address.location_id)?;
        writer.i32(chunk.chunk_x);
        writer.i32(chunk.chunk_z);
    }
    writer.count(value.entity_ids.len(), 16_384, "network interest entity count")?;
    for entity_id in &value.entity_ids {
        writer.string(entity_id)?;
    }
    writer.hash(value.interest_hash);
    Ok(())
}

fn read_network_interest(reader: &mut Reader<'_>) -> Result<NetworkInterestSetV1, WireError> {
    let sequence = reader.u64()?;
    let chunk_count = reader.count(1_024, "network interest chunk count")?;
    let mut chunks = Vec::with_capacity(chunk_count);
    for _ in 0..chunk_count {
        chunks.push(NetworkInterestChunkV1 {
            address: NetworkWorldAddressV1 {
                universe_id: reader.string()?,
                location_id: reader.string()?,
            },
            chunk_x: reader.i32()?,
            chunk_z: reader.i32()?,
        });
    }
    let entity_count = reader.count(16_384, "network interest entity count")?;
    let mut entity_ids = Vec::with_capacity(entity_count);
    for _ in 0..entity_count {
        entity_ids.push(reader.string()?);
    }
    let interest_hash = reader.hash()?;
    let value = NetworkInterestSetV1 {
        sequence,
        chunks,
        entity_ids,
        interest_hash,
    };
    value
        .validate()
        .map_err(|error| WireError::new("network-interest", error.to_string()))?;
    Ok(value)
}

fn write_network_identity(writer: &mut Writer, value: &NetworkAuthorityIdentityV1) -> Result<(), WireError> {
    value
        .validate()
        .map_err(|error| WireError::new("network-identity", error.to_string()))?;
    writer.string(&value.address.universe_id)?;
    writer.string(&value.address.location_id)?;
    writer.u64(value.revision.epoch);
    writer.u64(value.revision.world);
    writer.u64(value.revision.entities);
    writer.u64(value.revision.gameplay);
    writer.u64(value.revision.persistence);
    writer.hash(value.state_hash);
    Ok(())
}

fn read_network_identity(reader: &mut Reader<'_>) -> Result<NetworkAuthorityIdentityV1, WireError> {
    let address = NetworkWorldAddressV1 {
        universe_id: reader.string()?,
        location_id: reader.string()?,
    };
    let revision = NetworkAuthorityRevisionV1 {
        epoch: reader.u64()?,
        world: reader.u64()?,
        entities: reader.u64()?,
        gameplay: reader.u64()?,
        persistence: reader.u64()?,
    };
    let state_hash = reader.hash()?;
    let value = NetworkAuthorityIdentityV1 {
        address,
        revision,
        state_hash,
    };
    value
        .validate()
        .map_err(|error| WireError::new("network-identity", error.to_string()))?;
    Ok(value)
}

fn write_replication_scope(writer: &mut Writer, value: &ReplicationScopeV1) -> Result<(), WireError> {
    value
        .validate()
        .map_err(|error| WireError::new("network-scope", error.to_string()))?;
    match value {
        ReplicationScopeV1::Global => writer.u8(0),
        ReplicationScopeV1::Location(address) => {
            writer.u8(1);
            writer.string(&address.universe_id)?;
            writer.string(&address.location_id)?;
        }
        ReplicationScopeV1::Chunk(chunk) => {
            writer.u8(2);
            writer.string(&chunk.address.universe_id)?;
            writer.string(&chunk.address.location_id)?;
            writer.i32(chunk.chunk_x);
            writer.i32(chunk.chunk_z);
        }
        ReplicationScopeV1::Entity(entity_id) => {
            writer.u8(3);
            writer.string(entity_id)?;
        }
    }
    Ok(())
}

fn read_replication_scope(reader: &mut Reader<'_>) -> Result<ReplicationScopeV1, WireError> {
    match reader.u8()? {
        0 => Ok(ReplicationScopeV1::Global),
        1 => Ok(ReplicationScopeV1::Location(NetworkWorldAddressV1 {
            universe_id: reader.string()?,
            location_id: reader.string()?,
        })),
        2 => Ok(ReplicationScopeV1::Chunk(NetworkInterestChunkV1 {
            address: NetworkWorldAddressV1 {
                universe_id: reader.string()?,
                location_id: reader.string()?,
            },
            chunk_x: reader.i32()?,
            chunk_z: reader.i32()?,
        })),
        3 => Ok(ReplicationScopeV1::Entity(reader.string()?)),
        _ => Err(WireError::new("network-scope", "unknown network replication scope")),
    }
}

fn write_network_delta_record(writer: &mut Writer, value: &NetworkDeltaRecordV1) -> Result<(), WireError> {
    let rebuilt = NetworkDeltaRecordV1::new(
        value.kind,
        value.record_id.clone(),
        value.revision,
        value.payload.clone(),
    )
    .map_err(|error| WireError::new("network-record", error.to_string()))?;
    if rebuilt != *value {
        return Err(WireError::new("network-record", "network record hash mismatch"));
    }
    writer.u8(value.kind as u8);
    writer.string(&value.record_id)?;
    writer.u64(value.revision);
    writer.bytes(&value.payload, MAX_DOMAIN_PAYLOAD_BYTES, "network record payload")?;
    writer.hash(value.payload_hash);
    Ok(())
}

fn read_network_delta_record(reader: &mut Reader<'_>) -> Result<NetworkDeltaRecordV1, WireError> {
    let kind = match reader.u8()? {
        0 => NetworkDeltaRecordKindV1::World,
        1 => NetworkDeltaRecordKindV1::Entity,
        2 => NetworkDeltaRecordKindV1::Gameplay,
        3 => NetworkDeltaRecordKindV1::Player,
        4 => NetworkDeltaRecordKindV1::Agent,
        5 => NetworkDeltaRecordKindV1::Tombstone,
        _ => return Err(WireError::new("network-record", "unknown network record kind")),
    };
    let record_id = reader.string()?;
    let revision = reader.u64()?;
    let payload = reader.bytes(MAX_DOMAIN_PAYLOAD_BYTES, "network record payload")?;
    let payload_hash = reader.hash()?;
    let value = NetworkDeltaRecordV1::new(kind, record_id, revision, payload)
        .map_err(|error| WireError::new("network-record", error.to_string()))?;
    if value.payload_hash != payload_hash {
        return Err(WireError::new("network-record", "network record hash mismatch"));
    }
    Ok(value)
}

fn network_capability(tag: u8) -> Result<NetworkCapabilityV1, WireError> {
    match tag {
        0 => Ok(NetworkCapabilityV1::Observe),
        1 => Ok(NetworkCapabilityV1::Chat),
        2 => Ok(NetworkCapabilityV1::Interact),
        3 => Ok(NetworkCapabilityV1::Inventory),
        4 => Ok(NetworkCapabilityV1::Build),
        5 => Ok(NetworkCapabilityV1::Combat),
        6 => Ok(NetworkCapabilityV1::CreatureCare),
        7 => Ok(NetworkCapabilityV1::Trade),
        8 => Ok(NetworkCapabilityV1::Travel),
        9 => Ok(NetworkCapabilityV1::AgentWork),
        _ => Err(WireError::new("network-grant", "unknown network capability")),
    }
}

fn agent_lifecycle_tag(value: AgentLifecycleStatusV1) -> u8 {
    match value {
        AgentLifecycleStatusV1::Pending => 0,
        AgentLifecycleStatusV1::Approved => 1,
        AgentLifecycleStatusV1::Paused => 2,
        AgentLifecycleStatusV1::Revoked => 3,
        AgentLifecycleStatusV1::Disconnected => 4,
    }
}

fn read_agent_lifecycle(reader: &mut Reader<'_>) -> Result<AgentLifecycleStatusV1, WireError> {
    match reader.u8()? {
        0 => Ok(AgentLifecycleStatusV1::Pending),
        1 => Ok(AgentLifecycleStatusV1::Approved),
        2 => Ok(AgentLifecycleStatusV1::Paused),
        3 => Ok(AgentLifecycleStatusV1::Revoked),
        4 => Ok(AgentLifecycleStatusV1::Disconnected),
        _ => Err(WireError::new("agent-grant", "unknown agent lifecycle status")),
    }
}

fn write_agent_capabilities(writer: &mut Writer, values: &[AgentCapabilityV1]) -> Result<(), WireError> {
    if values.len() > 15 {
        return Err(WireError::new(
            "agent-grant",
            "agent capability count exceeds its budget",
        ));
    }
    writer.u8(values.len() as u8);
    for value in values {
        writer.u8(*value as u8);
    }
    Ok(())
}

fn read_agent_capabilities(reader: &mut Reader<'_>) -> Result<Vec<AgentCapabilityV1>, WireError> {
    let count = reader.u8()? as usize;
    if count > 15 {
        return Err(WireError::new(
            "agent-grant",
            "agent capability count exceeds its budget",
        ));
    }
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        let tag = reader.u8()?;
        values.push(
            AgentCapabilityV1::from_wire(tag)
                .ok_or_else(|| WireError::new("agent-grant", "unknown agent capability"))?,
        );
    }
    Ok(values)
}

pub fn encode_gameplay_actor_grant_v1(actor_id: &str, grant: &ActorGrant) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    writer.string(actor_id)?;
    writer.option_player_id(grant.player_id);
    writer.option_entity_id(grant.entity_id);
    writer.u8(actor_role_tag(grant.role));
    writer.count(grant.scopes.len(), 16, "gameplay scope count")?;
    for scope in &grant.scopes {
        writer.u8(scope_tag(*scope));
    }
    wrap_schema(
        GAMEPLAY_ACTOR_GRANT_V1_MAGIC,
        GAMEPLAY_ACTOR_GRANT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_gameplay_actor_grant_v1(bytes: &[u8]) -> Result<(String, ActorGrant), WireError> {
    let mut reader = Reader::new(unwrap_schema(
        GAMEPLAY_ACTOR_GRANT_V1_MAGIC,
        GAMEPLAY_ACTOR_GRANT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let actor_id = reader.string()?;
    let player_id = reader.option_player_id()?;
    let entity_id = reader.option_entity_id()?;
    let role = read_actor_role(&mut reader)?;
    let count = reader.count(16, "gameplay scope count")?;
    let mut scopes = BTreeSet::new();
    for _ in 0..count {
        let scope = read_scope(&mut reader)?;
        if scopes.last().is_some_and(|previous| scope <= *previous) {
            return Err(WireError::new(
                "gameplay-grant",
                "gameplay grant scopes must be unique and canonically ordered",
            ));
        }
        scopes.insert(scope);
    }
    reader.finish()?;
    Ok((
        actor_id,
        ActorGrant {
            player_id,
            entity_id,
            role,
            scopes,
        },
    ))
}

pub fn encode_gameplay_batch_v1(value: &GameplayBatch) -> Result<Vec<u8>, WireError> {
    if value.schema_version != blockwild_gameplay::GAMEPLAY_SCHEMA_VERSION {
        return Err(WireError::new("gameplay-schema", "unsupported gameplay batch schema"));
    }
    if value.commands.is_empty() || value.commands.len() > blockwild_gameplay::MAX_COMMANDS_PER_BATCH {
        return Err(WireError::new(
            "gameplay-count",
            "gameplay command count must be between 1 and 256",
        ));
    }
    let mut writer = Writer::default();
    writer.string(&value.batch_id)?;
    writer.string(&value.idempotency_key)?;
    write_gameplay_actor(&mut writer, &value.actor)?;
    write_gameplay_identity(&mut writer, &value.identity)?;
    writer.count(
        value.commands.len(),
        blockwild_gameplay::MAX_COMMANDS_PER_BATCH,
        "gameplay command count",
    )?;
    for command in &value.commands {
        write_gameplay_command(&mut writer, command)?;
    }
    // Validate bounded field encodings before hashing potentially large input.
    if value.command_hash != value.calculate_command_hash() {
        return Err(WireError::new("gameplay-hash", "gameplay command hash mismatch"));
    }
    writer.hash(value.command_hash);
    wrap_schema(
        GAMEPLAY_COMMAND_V1_MAGIC,
        GAMEPLAY_COMMAND_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_gameplay_batch_v1(bytes: &[u8]) -> Result<GameplayBatch, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        GAMEPLAY_COMMAND_V1_MAGIC,
        GAMEPLAY_COMMAND_V1_INNER_SCHEMA,
        bytes,
    )?);
    let batch_id = reader.string()?;
    let idempotency_key = reader.string()?;
    let actor = read_gameplay_actor(&mut reader)?;
    let identity = read_gameplay_identity(&mut reader)?;
    let count = reader.count(blockwild_gameplay::MAX_COMMANDS_PER_BATCH, "gameplay command count")?;
    if count == 0 {
        return Err(WireError::new("gameplay-count", "gameplay batch cannot be empty"));
    }
    let mut commands = Vec::with_capacity(count);
    for _ in 0..count {
        commands.push(read_gameplay_command(&mut reader)?);
    }
    let command_hash = reader.hash()?;
    reader.finish()?;
    let value = GameplayBatch {
        schema_version: blockwild_gameplay::GAMEPLAY_SCHEMA_VERSION,
        batch_id,
        idempotency_key,
        actor,
        identity,
        commands,
        command_hash,
    };
    if value.command_hash != value.calculate_command_hash() {
        return Err(WireError::new("gameplay-hash", "gameplay command hash mismatch"));
    }
    Ok(value)
}

pub fn encode_gameplay_receipt_v1(value: &GameplayReceipt) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    match value {
        GameplayReceipt::Accepted(receipt) => {
            writer.u8(1);
            write_accepted_gameplay_receipt(&mut writer, receipt)?;
        }
        GameplayReceipt::Rejected {
            batch_id,
            identity,
            rejection,
        } => {
            writer.u8(0);
            writer.string(batch_id)?;
            write_gameplay_identity(&mut writer, identity)?;
            writer.u8(rejection_code_tag(rejection.code));
            writer.string(&rejection.message)?;
        }
    }
    wrap_schema(
        GAMEPLAY_RECEIPT_V1_MAGIC,
        GAMEPLAY_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_gameplay_receipt_v1(bytes: &[u8]) -> Result<GameplayReceipt, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        GAMEPLAY_RECEIPT_V1_MAGIC,
        GAMEPLAY_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let result = match reader.u8()? {
        0 => GameplayReceipt::Rejected {
            batch_id: reader.string()?,
            identity: read_gameplay_identity(&mut reader)?,
            rejection: Rejection {
                code: read_rejection_code(&mut reader)?,
                message: reader.string()?,
            },
        },
        1 => GameplayReceipt::Accepted(read_accepted_gameplay_receipt(&mut reader)?),
        _ => return Err(WireError::new("gameplay-receipt", "unknown gameplay receipt tag")),
    };
    reader.finish()?;
    Ok(result)
}

fn write_gameplay_actor(writer: &mut Writer, value: &GameplayActor) -> Result<(), WireError> {
    writer.string(&value.actor_id)?;
    writer.option_player_id(value.player_id);
    writer.option_entity_id(value.entity_id);
    writer.u8(actor_role_tag(value.role));
    Ok(())
}

fn read_gameplay_actor(reader: &mut Reader<'_>) -> Result<GameplayActor, WireError> {
    Ok(GameplayActor {
        actor_id: reader.string()?,
        player_id: reader.option_player_id()?,
        entity_id: reader.option_entity_id()?,
        role: read_actor_role(reader)?,
    })
}

fn write_gameplay_identity(writer: &mut Writer, value: &AuthorityIdentity) -> Result<(), WireError> {
    writer.string(&value.world.universe)?;
    writer.string(&value.world.location)?;
    writer.u32(value.revision.epoch);
    writer.u64(value.revision.sequence);
    writer.u64(value.revision.inventory);
    writer.u64(value.revision.machines);
    writer.u64(value.revision.combat);
    writer.u64(value.revision.progression);
    writer.u64(value.revision.cardforge);
    writer.hash(value.state_hash);
    Ok(())
}

fn read_gameplay_identity(reader: &mut Reader<'_>) -> Result<AuthorityIdentity, WireError> {
    Ok(AuthorityIdentity {
        world: WorldKey::new(reader.string()?, reader.string()?),
        revision: GameplayRevision {
            epoch: reader.u32()?,
            sequence: reader.u64()?,
            inventory: reader.u64()?,
            machines: reader.u64()?,
            combat: reader.u64()?,
            progression: reader.u64()?,
            cardforge: reader.u64()?,
        },
        state_hash: reader.hash()?,
    })
}

fn write_gameplay_command(writer: &mut Writer, value: &GameplayCommand) -> Result<(), WireError> {
    match value {
        GameplayCommand::Inventory(value) => {
            writer.u8(0);
            write_inventory_command(writer, value)?;
        }
        GameplayCommand::Machine(value) => {
            writer.u8(1);
            write_machine_command(writer, value)?;
        }
        GameplayCommand::Combat(value) => {
            writer.u8(2);
            write_combat_command(writer, value)?;
        }
        GameplayCommand::Progression(value) => {
            writer.u8(3);
            write_progression_command(writer, value)?;
        }
        GameplayCommand::Cardforge(value) => {
            writer.u8(4);
            write_cardforge_command(writer, value)?;
        }
        GameplayCommand::AdvanceSchedule(value) => {
            writer.u8(GAMEPLAY_COMMAND_ADVANCE_SCHEDULE_TAG_V1 as u8);
            writer.u64(value.expected_tick);
            writer.u64(value.to_tick);
            writer.u16(value.machine_budget);
        }
    }
    Ok(())
}

fn read_gameplay_command(reader: &mut Reader<'_>) -> Result<GameplayCommand, WireError> {
    match reader.u8()? {
        0 => Ok(GameplayCommand::Inventory(read_inventory_command(reader)?)),
        1 => Ok(GameplayCommand::Machine(read_machine_command(reader)?)),
        2 => Ok(GameplayCommand::Combat(read_combat_command(reader)?)),
        3 => Ok(GameplayCommand::Progression(read_progression_command(reader)?)),
        4 => Ok(GameplayCommand::Cardforge(read_cardforge_command(reader)?)),
        tag if u16::from(tag) == GAMEPLAY_COMMAND_ADVANCE_SCHEDULE_TAG_V1 => {
            Ok(GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
                expected_tick: reader.u64()?,
                to_tick: reader.u64()?,
                machine_budget: reader.u16()?,
            }))
        }
        _ => Err(WireError::new("gameplay-command", "unknown gameplay command domain")),
    }
}

fn write_inventory_command(writer: &mut Writer, value: &InventoryCommand) -> Result<(), WireError> {
    match value {
        InventoryCommand::Transfer(value) => {
            writer.u8(0);
            write_slot_ref(writer, &value.from)?;
            write_slot_ref(writer, &value.to)?;
            writer.u32(value.count);
            writer.flag(value.expected.is_some());
            if let Some(expected) = &value.expected {
                writer.u32(expected.item_code);
                writer.hash(expected.metadata_hash);
                writer.u32(expected.minimum_count);
            }
        }
        InventoryCommand::Craft(value) => {
            writer.u8(1);
            writer.string(&value.recipe_id)?;
            writer.u16(value.quantity);
            writer.option_string(value.station_id.as_deref())?;
            write_container_key(writer, &value.source)?;
            write_container_key(writer, &value.destination)?;
            writer.option_u64(value.expected_source_revision);
            writer.option_u64(value.expected_destination_revision);
        }
        InventoryCommand::AdvanceFurnace(value) => {
            writer.u8(2);
            writer.string(&value.furnace_id)?;
            writer.u64(value.expected_revision);
            writer.u64(value.to_tick);
            writer.flag(value.fuel_item.is_some());
            if let Some(ingredient) = &value.fuel_item {
                write_ingredient(writer, ingredient);
            }
            writer.u32(value.fuel_ticks_per_item);
        }
        InventoryCommand::CreateDropCustody(value) => {
            writer.u8(3);
            write_slot_ref(writer, &value.source)?;
            write_container_key(writer, &value.custody)?;
            writer.flag(value.expected.is_some());
            if let Some(expected) = &value.expected {
                writer.u32(expected.item_code);
                writer.hash(expected.metadata_hash);
                writer.u32(expected.minimum_count);
            }
            writer.hash(value.request_hash);
        }
        InventoryCommand::RemoveEmptyDropCustody(value) => {
            writer.u8(4);
            write_container_key(writer, &value.custody)?;
            writer.u64(value.expected_revision);
        }
        InventoryCommand::CreatePlayerCustody(value) => {
            writer.u8(5);
            write_container_key(writer, &value.inventory)?;
            writer.u16(value.inventory_slots);
            write_container_key(writer, &value.equipment)?;
            writer.u16(value.equipment_slots);
            writer.flag(value.back_slot.is_some());
            if let Some(back_slot) = value.back_slot {
                writer.u16(back_slot);
            }
        }
        InventoryCommand::ImportPlayerInventoryV1(value) => {
            writer.u8(INVENTORY_COMMAND_IMPORT_PLAYER_V1_TAG as u8);
            write_player_inventory_import(writer, value)?;
        }
        InventoryCommand::ApplyBlockActionV1(value) => {
            writer.u8(INVENTORY_COMMAND_APPLY_BLOCK_ACTION_V1_TAG as u8);
            write_container_key(writer, &value.inventory)?;
            writer.u16(value.slot);
            writer.u64(value.expected_container_revision);
            write_optional_item_stack(writer, &value.expected_stack);
            writer.u32(value.consume_count);
            writer.u32(value.durability_cost_millionths);
            write_optional_item_stack(writer, &value.created_stack);
            writer.string(&value.reason)?;
        }
        InventoryCommand::CreateGeneratedDropCustodyV1(value) => {
            writer.u8(INVENTORY_COMMAND_CREATE_GENERATED_DROP_CUSTODY_V1_TAG as u8);
            write_container_key(writer, &value.custody)?;
            write_item_stack(writer, &value.stack);
            write_generated_drop_provenance_v1(writer, &value.provenance);
            writer.hash(value.request_hash);
        }
        InventoryCommand::ConsumeInventoryUnitV1(value) => {
            writer.u8(INVENTORY_COMMAND_CONSUME_UNIT_V1_TAG as u8);
            write_container_key(writer, &value.inventory)?;
            writer.u16(value.slot);
            writer.u64(value.expected_container_revision);
            write_item_stack(writer, &value.expected_stack);
        }
        InventoryCommand::SetCreativeInventorySlotV1(_) => {
            return Err(WireError::new(
                "inventory-command-dedicated",
                "creative inventory slot mutation is only accepted through its dedicated wire operation",
            ));
        }
    }
    Ok(())
}

fn read_inventory_command(reader: &mut Reader<'_>) -> Result<InventoryCommand, WireError> {
    match reader.u8()? {
        0 => Ok(InventoryCommand::Transfer(TransferCommand {
            from: read_slot_ref(reader)?,
            to: read_slot_ref(reader)?,
            count: reader.u32()?,
            expected: if reader.flag()? {
                Some(ExpectedStack {
                    item_code: reader.u32()?,
                    metadata_hash: reader.hash()?,
                    minimum_count: reader.u32()?,
                })
            } else {
                None
            },
        })),
        4 => Ok(InventoryCommand::RemoveEmptyDropCustody(
            RemoveEmptyDropCustodyCommand {
                custody: read_container_key(reader)?,
                expected_revision: reader.u64()?,
            },
        )),
        5 => Ok(InventoryCommand::CreatePlayerCustody(CreatePlayerCustodyCommand {
            inventory: read_container_key(reader)?,
            inventory_slots: reader.u16()?,
            equipment: read_container_key(reader)?,
            equipment_slots: reader.u16()?,
            back_slot: if reader.flag()? { Some(reader.u16()?) } else { None },
        })),
        1 => Ok(InventoryCommand::Craft(CraftCommand {
            recipe_id: reader.string()?,
            quantity: reader.u16()?,
            station_id: reader.option_string()?,
            source: read_container_key(reader)?,
            destination: read_container_key(reader)?,
            expected_source_revision: reader.option_u64()?,
            expected_destination_revision: reader.option_u64()?,
        })),
        2 => Ok(InventoryCommand::AdvanceFurnace(FurnaceAdvanceCommand {
            furnace_id: reader.string()?,
            expected_revision: reader.u64()?,
            to_tick: reader.u64()?,
            fuel_item: if reader.flag()? {
                Some(read_ingredient(reader)?)
            } else {
                None
            },
            fuel_ticks_per_item: reader.u32()?,
        })),
        3 => Ok(InventoryCommand::CreateDropCustody(CreateDropCustodyCommand {
            source: read_slot_ref(reader)?,
            custody: read_container_key(reader)?,
            expected: if reader.flag()? {
                Some(ExpectedStack {
                    item_code: reader.u32()?,
                    metadata_hash: reader.hash()?,
                    minimum_count: reader.u32()?,
                })
            } else {
                None
            },
            request_hash: reader.hash()?,
        })),
        tag if u16::from(tag) == INVENTORY_COMMAND_IMPORT_PLAYER_V1_TAG => Ok(
            InventoryCommand::ImportPlayerInventoryV1(read_player_inventory_import(reader)?),
        ),
        tag if u16::from(tag) == INVENTORY_COMMAND_APPLY_BLOCK_ACTION_V1_TAG => {
            Ok(InventoryCommand::ApplyBlockActionV1(ApplyBlockActionV1 {
                inventory: read_container_key(reader)?,
                slot: reader.u16()?,
                expected_container_revision: reader.u64()?,
                expected_stack: read_optional_item_stack(reader)?,
                consume_count: reader.u32()?,
                durability_cost_millionths: reader.u32()?,
                created_stack: read_optional_item_stack(reader)?,
                reason: reader.string()?,
            }))
        }
        tag if u16::from(tag) == INVENTORY_COMMAND_CREATE_GENERATED_DROP_CUSTODY_V1_TAG => Ok(
            InventoryCommand::CreateGeneratedDropCustodyV1(CreateGeneratedDropCustodyV1 {
                custody: read_container_key(reader)?,
                stack: read_item_stack(reader)?,
                provenance: read_generated_drop_provenance_v1(reader)?,
                request_hash: reader.hash()?,
            }),
        ),
        tag if u16::from(tag) == INVENTORY_COMMAND_CONSUME_UNIT_V1_TAG => {
            Ok(InventoryCommand::ConsumeInventoryUnitV1(ConsumeInventoryUnitV1 {
                inventory: read_container_key(reader)?,
                slot: reader.u16()?,
                expected_container_revision: reader.u64()?,
                expected_stack: read_item_stack(reader)?,
            }))
        }
        tag if u16::from(tag) == INVENTORY_COMMAND_SET_CREATIVE_SLOT_V1_TAG => Err(WireError::new(
            "inventory-command-dedicated",
            "creative inventory slot mutation is only accepted through its dedicated wire operation",
        )),
        _ => Err(WireError::new("inventory-command", "unknown inventory command tag")),
    }
}

fn write_player_inventory_import(writer: &mut Writer, value: &ImportPlayerInventoryV1) -> Result<(), WireError> {
    write_container_key(writer, &value.inventory)?;
    writer.u64(value.expected_revision);
    write_player_inventory_import_contents(writer, value)
}

fn write_player_inventory_import_contents(
    writer: &mut Writer,
    value: &ImportPlayerInventoryV1,
) -> Result<(), WireError> {
    writer.count(
        value.slots.len(),
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "player inventory import slot count",
    )?;
    for slot in &value.slots {
        write_optional_item_stack(writer, slot);
    }
    writer.count(
        value.metadata.len(),
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "player inventory import metadata count",
    )?;
    for metadata in &value.metadata {
        write_item_instance_metadata(writer, metadata)?;
    }
    Ok(())
}

fn read_player_inventory_import(reader: &mut Reader<'_>) -> Result<ImportPlayerInventoryV1, WireError> {
    let inventory = read_container_key(reader)?;
    let expected_revision = reader.u64()?;
    read_player_inventory_import_contents(reader, inventory, expected_revision)
}

fn read_player_inventory_import_contents(
    reader: &mut Reader<'_>,
    inventory: ContainerKey,
    expected_revision: u64,
) -> Result<ImportPlayerInventoryV1, WireError> {
    let slot_count = reader.count(
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "player inventory import slot count",
    )?;
    let mut slots = Vec::with_capacity(slot_count);
    for _ in 0..slot_count {
        slots.push(read_optional_item_stack(reader)?);
    }
    let metadata_count = reader.count(
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "player inventory import metadata count",
    )?;
    let mut metadata = Vec::with_capacity(metadata_count);
    for _ in 0..metadata_count {
        metadata.push(read_item_instance_metadata(reader)?);
    }
    Ok(ImportPlayerInventoryV1 {
        inventory,
        expected_revision,
        slots,
        metadata,
    })
}

fn write_optional_item_stack(writer: &mut Writer, value: &Option<ItemStack>) {
    writer.flag(value.is_some());
    if let Some(stack) = value {
        writer.u32(stack.item_code);
        writer.u32(stack.count);
        writer.option_u32(stack.durability_millionths);
        writer.hash(stack.metadata_hash);
    }
}

fn write_item_stack(writer: &mut Writer, stack: &ItemStack) {
    writer.u32(stack.item_code);
    writer.u32(stack.count);
    writer.option_u32(stack.durability_millionths);
    writer.hash(stack.metadata_hash);
}

fn read_item_stack(reader: &mut Reader<'_>) -> Result<ItemStack, WireError> {
    Ok(ItemStack {
        item_code: reader.u32()?,
        count: reader.u32()?,
        durability_millionths: reader.option_u32()?,
        metadata_hash: reader.hash()?,
    })
}

fn write_generated_drop_provenance_v1(writer: &mut Writer, value: &GeneratedDropProvenanceV1) {
    writer.u16(value.schema_version);
    writer.hash(value.manifest_hash);
    writer.hash(value.installed_registry_hash);
    writer.hash(value.catalog_blob_hash);
    writer.hash(value.action_report_hash);
    writer.hash(value.rng_semantics_hash);
    writer.u64(value.block_action_sequence);
    writer.u64(value.origin_input_sequence);
    writer.u16(value.block_id);
    writer.i32(value.position.x);
    writer.i32(value.position.y);
    writer.i32(value.position.z);
    writer.hash(value.loot_plan_hash);
    writer.u16(value.group_ordinal);
}

fn read_generated_drop_provenance_v1(reader: &mut Reader<'_>) -> Result<GeneratedDropProvenanceV1, WireError> {
    Ok(GeneratedDropProvenanceV1 {
        schema_version: reader.u16()?,
        manifest_hash: reader.hash()?,
        installed_registry_hash: reader.hash()?,
        catalog_blob_hash: reader.hash()?,
        action_report_hash: reader.hash()?,
        rng_semantics_hash: reader.hash()?,
        block_action_sequence: reader.u64()?,
        origin_input_sequence: reader.u64()?,
        block_id: reader.u16()?,
        position: BlockActionLootCellV1 {
            x: reader.i32()?,
            y: reader.i32()?,
            z: reader.i32()?,
        },
        loot_plan_hash: reader.hash()?,
        group_ordinal: reader.u16()?,
    })
}

fn read_optional_item_stack(reader: &mut Reader<'_>) -> Result<Option<ItemStack>, WireError> {
    Ok(if reader.flag()? {
        Some(ItemStack {
            item_code: reader.u32()?,
            count: reader.u32()?,
            durability_millionths: reader.option_u32()?,
            metadata_hash: reader.hash()?,
        })
    } else {
        None
    })
}

fn write_item_instance_metadata(writer: &mut Writer, value: &ItemInstanceMetadataV1) -> Result<(), WireError> {
    writer.hash(value.hash);
    writer.string(&value.type_id)?;
    writer.string(&value.schema_id)?;
    writer.u16(value.schema_version);
    writer.u32(value.content_version);
    writer.bytes(
        &value.canonical_json_bytes,
        MAX_ITEM_INSTANCE_METADATA_BYTES_V1,
        "item instance metadata JSON",
    )?;
    writer.bytes(
        &value.unknown_extension_bytes,
        MAX_ITEM_INSTANCE_METADATA_EXTENSION_BYTES_V1,
        "item instance metadata extension",
    )
}

fn read_item_instance_metadata(reader: &mut Reader<'_>) -> Result<ItemInstanceMetadataV1, WireError> {
    Ok(ItemInstanceMetadataV1 {
        hash: reader.hash()?,
        type_id: reader.string()?,
        schema_id: reader.string()?,
        schema_version: reader.u16()?,
        content_version: reader.u32()?,
        canonical_json_bytes: reader.bytes(MAX_ITEM_INSTANCE_METADATA_BYTES_V1, "item instance metadata JSON")?,
        unknown_extension_bytes: reader.bytes(
            MAX_ITEM_INSTANCE_METADATA_EXTENSION_BYTES_V1,
            "item instance metadata extension",
        )?,
    })
}

fn write_container_key(writer: &mut Writer, value: &ContainerKey) -> Result<(), WireError> {
    writer.u8(container_kind_tag(value.kind));
    writer.string(&value.id)?;
    writer.option_string(value.owner_id.as_deref())
}

fn read_container_key(reader: &mut Reader<'_>) -> Result<ContainerKey, WireError> {
    Ok(ContainerKey {
        kind: read_container_kind(reader)?,
        id: reader.string()?,
        owner_id: reader.option_string()?,
    })
}

fn write_player_inventory_binding(writer: &mut Writer, value: &PlayerInventoryBindingV1) -> Result<(), WireError> {
    writer.u64(value.player_id.packed());
    writer.u64(value.revision);
    writer.string(&value.actor_id)?;
    writer.u64(value.entity_id.packed());
    write_container_key(writer, &value.inventory_container)?;
    write_container_key(writer, &value.equipment_container)?;
    writer.u16(value.selected_slot);
    writer.option_u16(value.back_slot);
    Ok(())
}

fn read_player_inventory_binding(reader: &mut Reader<'_>) -> Result<PlayerInventoryBindingV1, WireError> {
    let player_packed = reader.u64()?;
    let player_id = PlayerId::new(player_packed as u32, (player_packed >> 32) as u32);
    if player_id.packed() == 0 {
        return Err(WireError::new("player-bootstrap-binding", "zero player id is reserved"));
    }
    Ok(PlayerInventoryBindingV1 {
        player_id,
        revision: reader.u64()?,
        actor_id: reader.string()?,
        entity_id: unpack_entity_id(reader.u64()?)?,
        inventory_container: read_container_key(reader)?,
        equipment_container: read_container_key(reader)?,
        selected_slot: reader.u16()?,
        back_slot: reader.option_u16()?,
    })
}

fn write_player_bootstrap_custody(writer: &mut Writer, value: &PlayerBootstrapCustodyWireV1) -> Result<(), WireError> {
    validate_player_bootstrap_custody(value)?;
    write_container_key(writer, &value.inventory_container)?;
    writer.u64(value.inventory_revision);
    writer.count(
        value.inventory_slots.len(),
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "player bootstrap inventory slots",
    )?;
    for slot in &value.inventory_slots {
        write_optional_item_stack(writer, slot);
    }
    write_container_key(writer, &value.equipment_container)?;
    writer.u64(value.equipment_revision);
    writer.count(value.equipment_slots.len(), 8, "player bootstrap equipment slots")?;
    for slot in &value.equipment_slots {
        write_optional_item_stack(writer, slot);
    }
    writer.count(
        value.referenced_metadata.len(),
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "player bootstrap referenced metadata",
    )?;
    for metadata in &value.referenced_metadata {
        write_item_instance_metadata(writer, metadata)?;
    }
    Ok(())
}

fn read_player_bootstrap_custody(reader: &mut Reader<'_>) -> Result<PlayerBootstrapCustodyWireV1, WireError> {
    let inventory_container = read_container_key(reader)?;
    let inventory_revision = reader.u64()?;
    let inventory_count = reader.count(
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "player bootstrap inventory slots",
    )?;
    let mut inventory_slots = Vec::with_capacity(inventory_count);
    for _ in 0..inventory_count {
        inventory_slots.push(read_optional_item_stack(reader)?);
    }
    let equipment_container = read_container_key(reader)?;
    let equipment_revision = reader.u64()?;
    let equipment_count = reader.count(8, "player bootstrap equipment slots")?;
    let mut equipment_slots = Vec::with_capacity(equipment_count);
    for _ in 0..equipment_count {
        equipment_slots.push(read_optional_item_stack(reader)?);
    }
    let metadata_count = reader.count(
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "player bootstrap referenced metadata",
    )?;
    let mut referenced_metadata = Vec::with_capacity(metadata_count);
    for _ in 0..metadata_count {
        referenced_metadata.push(read_item_instance_metadata(reader)?);
    }
    let value = PlayerBootstrapCustodyWireV1 {
        inventory_container,
        inventory_revision,
        inventory_slots,
        equipment_container,
        equipment_revision,
        equipment_slots,
        referenced_metadata,
    };
    validate_player_bootstrap_custody(&value)?;
    Ok(value)
}

fn validate_player_bootstrap_custody(value: &PlayerBootstrapCustodyWireV1) -> Result<(), WireError> {
    if value.inventory_slots.len() != PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1 || value.equipment_slots.len() != 8 {
        return Err(WireError::new(
            "player-bootstrap-custody",
            "player custody must contain the exact nine inventory and eight equipment slots",
        ));
    }
    let metadata_bytes = value.referenced_metadata.iter().try_fold(0_usize, |total, metadata| {
        total
            .checked_add(metadata.canonical_json_bytes.len())
            .and_then(|bytes| bytes.checked_add(metadata.unknown_extension_bytes.len()))
    });
    if metadata_bytes.is_none_or(|bytes| bytes > blockwild_gameplay::MAX_PLAYER_INVENTORY_IMPORT_METADATA_BYTES_V1) {
        return Err(WireError::new(
            "player-bootstrap-metadata",
            "player custody metadata exceeds its aggregate byte bound",
        ));
    }
    let referenced = value
        .inventory_slots
        .iter()
        .flatten()
        .filter_map(|stack| (stack.metadata_hash != CanonicalHash::default()).then_some(stack.metadata_hash))
        .collect::<BTreeSet<_>>();
    let metadata_hashes = value
        .referenced_metadata
        .iter()
        .map(|metadata| metadata.hash)
        .collect::<Vec<_>>();
    if !metadata_hashes.windows(2).all(|pair| pair[0] < pair[1])
        || referenced.iter().copied().collect::<Vec<_>>() != metadata_hashes
    {
        return Err(WireError::new(
            "player-bootstrap-metadata",
            "player custody metadata must exactly and canonically cover referenced inventory hashes",
        ));
    }
    for metadata in &value.referenced_metadata {
        metadata
            .validate_wire()
            .map_err(|error| WireError::new("player-bootstrap-metadata", error.message))?;
    }
    Ok(())
}

fn write_runtime_input_frame(writer: &mut Writer, value: RuntimeInputFrameV1) {
    writer.u64(value.sequence);
    writer.u64(value.target_tick);
    writer.i16(value.move_x);
    writer.i16(value.move_z);
    writer.i16(value.look_yaw);
    writer.i16(value.look_pitch);
    writer.u32(value.buttons);
    writer.u8(value.selected_slot);
    writer.u8(value.flags);
    writer.u16(0);
}

fn read_runtime_input_frame(reader: &mut Reader<'_>) -> Result<RuntimeInputFrameV1, WireError> {
    let value = RuntimeInputFrameV1 {
        sequence: reader.u64()?,
        target_tick: reader.u64()?,
        move_x: reader.i16()?,
        move_z: reader.i16()?,
        look_yaw: reader.i16()?,
        look_pitch: reader.i16()?,
        buttons: reader.u32()?,
        selected_slot: reader.u8()?,
        flags: reader.u8()?,
    };
    if reader.u16()? != 0 {
        return Err(WireError::new(
            "player-bootstrap-input",
            "input frame reserved bits are not zero",
        ));
    }
    Ok(value)
}

/// TS-verifiable checksum of the exact resulting imported inventory state.
/// The selected slot is a world-view field and is attested separately in BWI7.
pub fn player_inventory_result_hash_v1(
    container: &blockwild_gameplay::Container,
    referenced_metadata: &[ItemInstanceMetadataV1],
) -> Result<CanonicalHash, WireError> {
    let custody = PlayerBootstrapCustodyWireV1 {
        inventory_container: container.key.clone(),
        inventory_revision: container.revision,
        inventory_slots: container.slots.clone(),
        equipment_container: ContainerKey {
            kind: ContainerKind::Equipment,
            id: "hash-placeholder:equipment".into(),
            owner_id: Some("hash-placeholder".into()),
        },
        equipment_revision: 0,
        equipment_slots: vec![None; 8],
        referenced_metadata: referenced_metadata.to_vec(),
    };
    validate_player_bootstrap_custody(&custody)?;
    let mut writer = Writer::default();
    writer.bytes.extend_from_slice(b"BIR7");
    writer.u16(1);
    write_container_key(&mut writer, &container.key)?;
    writer.u64(container.revision);
    writer.count(
        container.slots.len(),
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "player inventory result slots",
    )?;
    for slot in &container.slots {
        write_optional_item_stack(&mut writer, slot);
    }
    writer.count(
        referenced_metadata.len(),
        PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1,
        "player inventory result metadata",
    )?;
    for metadata in referenced_metadata {
        write_item_instance_metadata(&mut writer, metadata)?;
    }
    Ok(CanonicalHash(wire_checksum_v1(&writer.finish())))
}

fn write_slot_ref(writer: &mut Writer, value: &SlotRef) -> Result<(), WireError> {
    write_container_key(writer, &value.container)?;
    writer.u16(value.slot);
    writer.option_u64(value.expected_container_revision);
    Ok(())
}

fn read_slot_ref(reader: &mut Reader<'_>) -> Result<SlotRef, WireError> {
    Ok(SlotRef {
        container: read_container_key(reader)?,
        slot: reader.u16()?,
        expected_container_revision: reader.option_u64()?,
    })
}

fn write_ingredient(writer: &mut Writer, value: &Ingredient) {
    writer.u32(value.item_code);
    writer.flag(value.metadata_hash.is_some());
    if let Some(hash) = value.metadata_hash {
        writer.hash(hash);
    }
    writer.u32(value.count);
}

fn read_ingredient(reader: &mut Reader<'_>) -> Result<Ingredient, WireError> {
    Ok(Ingredient {
        item_code: reader.u32()?,
        metadata_hash: if reader.flag()? { Some(reader.hash()?) } else { None },
        count: reader.u32()?,
    })
}

fn write_machine_command(writer: &mut Writer, value: &MachineCommand) -> Result<(), WireError> {
    match value {
        MachineCommand::Operate {
            machine_id,
            expected_revision,
            operation,
        } => {
            writer.u8(0);
            writer.string(machine_id)?;
            writer.u64(*expected_revision);
            match operation {
                MachineOperation::Configure { settings } => {
                    writer.u8(0);
                    write_opaque(writer, settings)?;
                }
                MachineOperation::Activate => writer.u8(1),
                MachineOperation::Deactivate => writer.u8(2),
                MachineOperation::ClaimOutput {
                    port_id,
                    resource,
                    amount,
                } => {
                    writer.u8(3);
                    writer.string(port_id)?;
                    write_resource_key(writer, resource)?;
                    writer.u64(*amount);
                }
            }
        }
        MachineCommand::Transfer {
            from,
            to,
            resource,
            amount,
            expected_from_revision,
            expected_to_revision,
        } => {
            writer.u8(1);
            write_resource_endpoint(writer, from)?;
            write_resource_endpoint(writer, to)?;
            write_resource_key(writer, resource)?;
            writer.u64(*amount);
            writer.u64(*expected_from_revision);
            writer.u64(*expected_to_revision);
        }
        MachineCommand::Advance {
            machine_id,
            expected_revision,
            to_tick,
        } => {
            writer.u8(2);
            writer.string(machine_id)?;
            writer.u64(*expected_revision);
            writer.u64(*to_tick);
        }
        MachineCommand::GrantLease {
            machine_id,
            expected_revision,
            lease,
        } => {
            writer.u8(3);
            writer.string(machine_id)?;
            writer.u64(*expected_revision);
            writer.string(&lease.lease_id)?;
            writer.string(&lease.owner_id)?;
            writer.u64(lease.start_tick);
            writer.u64(lease.end_tick);
            writer.u32(lease.max_cycles);
        }
        MachineCommand::PowerTransfer {
            network_id,
            expected_revision,
            machine_id,
            amount,
        } => {
            writer.u8(4);
            writer.string(network_id)?;
            writer.u64(*expected_revision);
            writer.string(machine_id)?;
            writer.i64(*amount);
        }
    }
    Ok(())
}

fn read_machine_command(reader: &mut Reader<'_>) -> Result<MachineCommand, WireError> {
    match reader.u8()? {
        0 => {
            let machine_id = reader.string()?;
            let expected_revision = reader.u64()?;
            let operation = match reader.u8()? {
                0 => MachineOperation::Configure {
                    settings: read_opaque(reader)?,
                },
                1 => MachineOperation::Activate,
                2 => MachineOperation::Deactivate,
                3 => MachineOperation::ClaimOutput {
                    port_id: reader.string()?,
                    resource: read_resource_key(reader)?,
                    amount: reader.u64()?,
                },
                _ => return Err(WireError::new("machine-operation", "unknown machine operation tag")),
            };
            Ok(MachineCommand::Operate {
                machine_id,
                expected_revision,
                operation,
            })
        }
        1 => Ok(MachineCommand::Transfer {
            from: read_resource_endpoint(reader)?,
            to: read_resource_endpoint(reader)?,
            resource: read_resource_key(reader)?,
            amount: reader.u64()?,
            expected_from_revision: reader.u64()?,
            expected_to_revision: reader.u64()?,
        }),
        2 => Ok(MachineCommand::Advance {
            machine_id: reader.string()?,
            expected_revision: reader.u64()?,
            to_tick: reader.u64()?,
        }),
        3 => Ok(MachineCommand::GrantLease {
            machine_id: reader.string()?,
            expected_revision: reader.u64()?,
            lease: ActivityLease {
                lease_id: reader.string()?,
                owner_id: reader.string()?,
                start_tick: reader.u64()?,
                end_tick: reader.u64()?,
                max_cycles: reader.u32()?,
            },
        }),
        4 => Ok(MachineCommand::PowerTransfer {
            network_id: reader.string()?,
            expected_revision: reader.u64()?,
            machine_id: reader.string()?,
            amount: reader.i64()?,
        }),
        _ => Err(WireError::new("machine-command", "unknown machine command tag")),
    }
}

fn write_resource_endpoint(writer: &mut Writer, value: &ResourceEndpoint) -> Result<(), WireError> {
    writer.string(&value.machine_id)?;
    writer.string(&value.port_id)
}

fn read_resource_endpoint(reader: &mut Reader<'_>) -> Result<ResourceEndpoint, WireError> {
    Ok(ResourceEndpoint {
        machine_id: reader.string()?,
        port_id: reader.string()?,
    })
}

fn write_resource_key(writer: &mut Writer, value: &ResourceKey) -> Result<(), WireError> {
    writer.u8(resource_kind_tag(value.kind));
    writer.string(&value.content_id)?;
    writer.option_u32(value.item_code);
    writer.hash(value.metadata_hash);
    Ok(())
}

fn read_resource_key(reader: &mut Reader<'_>) -> Result<ResourceKey, WireError> {
    Ok(ResourceKey {
        kind: read_resource_kind(reader)?,
        content_id: reader.string()?,
        item_code: reader.option_u32()?,
        metadata_hash: reader.hash()?,
    })
}

fn write_combat_command(writer: &mut Writer, value: &CombatCommand) -> Result<(), WireError> {
    match value {
        CombatCommand::UseAbility {
            source_id,
            expected_source_revision,
            target_id,
            expected_target_revision,
            ability_id,
            projectile_id,
            aim,
            tick,
        } => {
            writer.u8(0);
            writer.string(source_id)?;
            writer.u64(*expected_source_revision);
            writer.string(target_id)?;
            writer.u64(*expected_target_revision);
            writer.string(ability_id)?;
            writer.option_string(projectile_id.as_deref())?;
            writer.fixed_vec3(*aim);
            writer.u64(*tick);
        }
        CombatCommand::UseLinkedProjectile {
            source_id,
            expected_source_revision,
            target_id,
            expected_target_revision,
            ability_id,
            projectile_id,
            entity_id,
            content_domain,
            content_id,
            presentation_id,
            aim,
            tick,
        } => {
            writer.u8(7);
            writer.string(source_id)?;
            writer.u64(*expected_source_revision);
            writer.string(target_id)?;
            writer.u64(*expected_target_revision);
            writer.string(ability_id)?;
            writer.string(projectile_id)?;
            unpack_entity_id(entity_id.packed())?;
            writer.u64(entity_id.packed());
            writer.u8(content_domain_tag(*content_domain));
            writer.string(content_id)?;
            writer.string(presentation_id)?;
            writer.fixed_vec3(*aim);
            writer.u64(*tick);
        }
        CombatCommand::ResolveProjectile {
            projectile_id,
            expected_revision,
            target_id,
            impact,
            tick,
        } => {
            writer.u8(1);
            writer.string(projectile_id)?;
            writer.u64(*expected_revision);
            writer.option_string(target_id.as_deref())?;
            writer.fixed_vec3(*impact);
            writer.u64(*tick);
        }
        CombatCommand::ResolveLinkedProjectile {
            projectile_id,
            expected_revision,
            target_id,
            impact,
            tick,
        } => {
            writer.u8(9);
            writer.string(projectile_id)?;
            writer.u64(*expected_revision);
            writer.option_string(target_id.as_deref())?;
            writer.fixed_vec3(*impact);
            writer.u64(*tick);
        }
        CombatCommand::AdvanceLinkedProjectile {
            projectile_id,
            expected_revision,
            position,
            tick,
        } => {
            writer.u8(10);
            writer.string(projectile_id)?;
            writer.u64(*expected_revision);
            writer.fixed_vec3(*position);
            writer.u64(*tick);
        }
        CombatCommand::Capture {
            source_id,
            creature_id,
            expected_creature_revision,
            orb_item_code,
            tick,
        } => {
            writer.u8(2);
            writer.string(source_id)?;
            writer.string(creature_id)?;
            writer.u64(*expected_creature_revision);
            writer.u32(*orb_item_code);
            writer.u64(*tick);
        }
        CombatCommand::Pacify {
            source_id,
            creature_id,
            expected_creature_revision,
            method,
            evidence,
            tick,
        } => {
            writer.u8(3);
            writer.string(source_id)?;
            writer.string(creature_id)?;
            writer.u64(*expected_creature_revision);
            writer.u8(match method {
                PacifyMethod::Outmaneuver => 0,
                PacifyMethod::LureAndCare => 1,
            });
            write_opaque(writer, evidence)?;
            writer.u64(*tick);
        }
        CombatCommand::Care {
            source_id,
            creature_id,
            expected_creature_revision,
            care_item_code,
            amount,
            tick,
        } => {
            writer.u8(4);
            writer.string(source_id)?;
            writer.string(creature_id)?;
            writer.u64(*expected_creature_revision);
            writer.u32(*care_item_code);
            writer.u16(*amount);
            writer.u64(*tick);
        }
        CombatCommand::Summon {
            source_id,
            summon_id,
            content_id,
            duration_ticks,
            grounding_item_code,
            tick,
        } => {
            writer.u8(5);
            writer.string(source_id)?;
            writer.string(summon_id)?;
            writer.string(content_id)?;
            writer.option_u32(*duration_ticks);
            writer.option_u32(*grounding_item_code);
            writer.u64(*tick);
        }
        CombatCommand::SummonLinked {
            source_id,
            summon_id,
            entity_id,
            content_domain,
            content_id,
            presentation_id,
            position,
            duration_ticks,
            grounding_item_code,
            tick,
        } => {
            writer.u8(8);
            writer.string(source_id)?;
            writer.string(summon_id)?;
            unpack_entity_id(entity_id.packed())?;
            writer.u64(entity_id.packed());
            writer.u8(content_domain_tag(*content_domain));
            writer.string(content_id)?;
            writer.string(presentation_id)?;
            writer.fixed_vec3(*position);
            writer.option_u32(*duration_ticks);
            writer.option_u32(*grounding_item_code);
            writer.u64(*tick);
        }
        CombatCommand::Advance { to_tick } => {
            writer.u8(6);
            writer.u64(*to_tick);
        }
    }
    Ok(())
}

fn read_combat_command(reader: &mut Reader<'_>) -> Result<CombatCommand, WireError> {
    match reader.u8()? {
        0 => Ok(CombatCommand::UseAbility {
            source_id: reader.string()?,
            expected_source_revision: reader.u64()?,
            target_id: reader.string()?,
            expected_target_revision: reader.u64()?,
            ability_id: reader.string()?,
            projectile_id: reader.option_string()?,
            aim: reader.fixed_vec3()?,
            tick: reader.u64()?,
        }),
        7 => Ok(CombatCommand::UseLinkedProjectile {
            source_id: reader.string()?,
            expected_source_revision: reader.u64()?,
            target_id: reader.string()?,
            expected_target_revision: reader.u64()?,
            ability_id: reader.string()?,
            projectile_id: reader.string()?,
            entity_id: unpack_entity_id(reader.u64()?)?,
            content_domain: read_content_domain(reader.u8()?)?,
            content_id: reader.string()?,
            presentation_id: reader.string()?,
            aim: reader.fixed_vec3()?,
            tick: reader.u64()?,
        }),
        1 => Ok(CombatCommand::ResolveProjectile {
            projectile_id: reader.string()?,
            expected_revision: reader.u64()?,
            target_id: reader.option_string()?,
            impact: reader.fixed_vec3()?,
            tick: reader.u64()?,
        }),
        9 => Ok(CombatCommand::ResolveLinkedProjectile {
            projectile_id: reader.string()?,
            expected_revision: reader.u64()?,
            target_id: reader.option_string()?,
            impact: reader.fixed_vec3()?,
            tick: reader.u64()?,
        }),
        10 => Ok(CombatCommand::AdvanceLinkedProjectile {
            projectile_id: reader.string()?,
            expected_revision: reader.u64()?,
            position: reader.fixed_vec3()?,
            tick: reader.u64()?,
        }),
        2 => Ok(CombatCommand::Capture {
            source_id: reader.string()?,
            creature_id: reader.string()?,
            expected_creature_revision: reader.u64()?,
            orb_item_code: reader.u32()?,
            tick: reader.u64()?,
        }),
        3 => Ok(CombatCommand::Pacify {
            source_id: reader.string()?,
            creature_id: reader.string()?,
            expected_creature_revision: reader.u64()?,
            method: match reader.u8()? {
                0 => PacifyMethod::Outmaneuver,
                1 => PacifyMethod::LureAndCare,
                _ => return Err(WireError::new("pacify-method", "unknown pacify method")),
            },
            evidence: read_opaque(reader)?,
            tick: reader.u64()?,
        }),
        4 => Ok(CombatCommand::Care {
            source_id: reader.string()?,
            creature_id: reader.string()?,
            expected_creature_revision: reader.u64()?,
            care_item_code: reader.u32()?,
            amount: reader.u16()?,
            tick: reader.u64()?,
        }),
        5 => Ok(CombatCommand::Summon {
            source_id: reader.string()?,
            summon_id: reader.string()?,
            content_id: reader.string()?,
            duration_ticks: reader.option_u32()?,
            grounding_item_code: reader.option_u32()?,
            tick: reader.u64()?,
        }),
        8 => Ok(CombatCommand::SummonLinked {
            source_id: reader.string()?,
            summon_id: reader.string()?,
            entity_id: unpack_entity_id(reader.u64()?)?,
            content_domain: read_content_domain(reader.u8()?)?,
            content_id: reader.string()?,
            presentation_id: reader.string()?,
            position: reader.fixed_vec3()?,
            duration_ticks: reader.option_u32()?,
            grounding_item_code: reader.option_u32()?,
            tick: reader.u64()?,
        }),
        6 => Ok(CombatCommand::Advance { to_tick: reader.u64()? }),
        _ => Err(WireError::new("combat-command", "unknown combat command tag")),
    }
}

fn write_progression_command(writer: &mut Writer, value: &ProgressionCommand) -> Result<(), WireError> {
    writer.u8(progression_action_tag(value.action));
    writer.string(&value.owner_id)?;
    writer.string(&value.record_id)?;
    writer.u64(value.expected_record_revision);
    writer.string(&value.option_id)?;
    writer.u32(value.quantity);
    writer.option_string(value.currency_id.as_deref())?;
    writer.flag(value.payload.is_some());
    if let Some(payload) = &value.payload {
        write_opaque(writer, payload)?;
    }
    Ok(())
}

fn read_progression_command(reader: &mut Reader<'_>) -> Result<ProgressionCommand, WireError> {
    Ok(ProgressionCommand {
        action: read_progression_action(reader)?,
        owner_id: reader.string()?,
        record_id: reader.string()?,
        expected_record_revision: reader.u64()?,
        option_id: reader.string()?,
        quantity: reader.u32()?,
        currency_id: reader.option_string()?,
        payload: if reader.flag()? {
            Some(read_opaque(reader)?)
        } else {
            None
        },
    })
}

fn write_cardforge_command(writer: &mut Writer, value: &CardforgeCommand) -> Result<(), WireError> {
    match value {
        CardforgeCommand::OpenPack {
            record_id,
            owner_id,
            expected_revision,
        } => {
            writer.u8(0);
            writer.string(record_id)?;
            writer.string(owner_id)?;
            writer.u64(*expected_revision);
        }
        CardforgeCommand::MoveCard {
            owner_id,
            printing,
            count,
            to_archive,
            expected_custody_revision,
        } => {
            writer.u8(1);
            writer.string(owner_id)?;
            write_printing(writer, printing)?;
            writer.u32(*count);
            writer.flag(*to_archive);
            writer.u64(*expected_custody_revision);
        }
        CardforgeCommand::ArchiveDuplicate {
            owner_id,
            printing,
            keep,
            expected_custody_revision,
        } => {
            writer.u8(2);
            writer.string(owner_id)?;
            write_printing(writer, printing)?;
            writer.u32(*keep);
            writer.u64(*expected_custody_revision);
        }
        CardforgeCommand::BuildDeck {
            deck_id,
            owner_id,
            rules_id,
            cards,
            expected_revision,
        } => {
            writer.u8(3);
            writer.string(deck_id)?;
            writer.string(owner_id)?;
            writer.string(rules_id)?;
            writer.count(cards.len(), MAX_COLLECTION, "deck card count")?;
            for (printing, count) in cards {
                write_printing(writer, printing)?;
                writer.u16(*count);
            }
            writer.option_u64(*expected_revision);
        }
        CardforgeCommand::StartMatch {
            match_id,
            player_one,
            deck_one,
            player_two,
            deck_two,
        } => {
            writer.u8(4);
            writer.string(match_id)?;
            writer.string(player_one)?;
            writer.string(deck_one)?;
            writer.string(player_two)?;
            writer.string(deck_two)?;
        }
        CardforgeCommand::MatchAction {
            match_id,
            owner_id,
            expected_revision,
            action,
        } => {
            writer.u8(5);
            writer.string(match_id)?;
            writer.string(owner_id)?;
            writer.u64(*expected_revision);
            match action {
                BattleAction::Draw => writer.u8(0),
                BattleAction::Play { hand_index } => {
                    writer.u8(1);
                    writer.u16(*hand_index);
                }
                BattleAction::AttackPlayer { board_index } => {
                    writer.u8(2);
                    writer.u16(*board_index);
                }
                BattleAction::EndTurn => writer.u8(3),
                BattleAction::Concede => writer.u8(4),
            }
        }
        CardforgeCommand::ClaimReward {
            owner_id,
            reward_id,
            expected_custody_revision,
        } => {
            writer.u8(6);
            writer.string(owner_id)?;
            writer.string(reward_id)?;
            writer.u64(*expected_custody_revision);
        }
    }
    Ok(())
}

fn read_cardforge_command(reader: &mut Reader<'_>) -> Result<CardforgeCommand, WireError> {
    match reader.u8()? {
        0 => Ok(CardforgeCommand::OpenPack {
            record_id: reader.string()?,
            owner_id: reader.string()?,
            expected_revision: reader.u64()?,
        }),
        1 => Ok(CardforgeCommand::MoveCard {
            owner_id: reader.string()?,
            printing: read_printing(reader)?,
            count: reader.u32()?,
            to_archive: reader.flag()?,
            expected_custody_revision: reader.u64()?,
        }),
        2 => Ok(CardforgeCommand::ArchiveDuplicate {
            owner_id: reader.string()?,
            printing: read_printing(reader)?,
            keep: reader.u32()?,
            expected_custody_revision: reader.u64()?,
        }),
        3 => {
            let deck_id = reader.string()?;
            let owner_id = reader.string()?;
            let rules_id = reader.string()?;
            let count = reader.count(MAX_COLLECTION, "deck card count")?;
            let mut cards = BTreeMap::new();
            for _ in 0..count {
                let printing = read_printing(reader)?;
                let amount = reader.u16()?;
                if cards.insert(printing, amount).is_some() {
                    return Err(WireError::new("cardforge-deck", "deck contains duplicate printing"));
                }
            }
            Ok(CardforgeCommand::BuildDeck {
                deck_id,
                owner_id,
                rules_id,
                cards,
                expected_revision: reader.option_u64()?,
            })
        }
        4 => Ok(CardforgeCommand::StartMatch {
            match_id: reader.string()?,
            player_one: reader.string()?,
            deck_one: reader.string()?,
            player_two: reader.string()?,
            deck_two: reader.string()?,
        }),
        5 => {
            let match_id = reader.string()?;
            let owner_id = reader.string()?;
            let expected_revision = reader.u64()?;
            let action = match reader.u8()? {
                0 => BattleAction::Draw,
                1 => BattleAction::Play {
                    hand_index: reader.u16()?,
                },
                2 => BattleAction::AttackPlayer {
                    board_index: reader.u16()?,
                },
                3 => BattleAction::EndTurn,
                4 => BattleAction::Concede,
                _ => return Err(WireError::new("cardforge-action", "unknown Cardforge action")),
            };
            Ok(CardforgeCommand::MatchAction {
                match_id,
                owner_id,
                expected_revision,
                action,
            })
        }
        6 => Ok(CardforgeCommand::ClaimReward {
            owner_id: reader.string()?,
            reward_id: reader.string()?,
            expected_custody_revision: reader.u64()?,
        }),
        _ => Err(WireError::new("cardforge-command", "unknown Cardforge command tag")),
    }
}

fn write_printing(writer: &mut Writer, value: &PrintingKey) -> Result<(), WireError> {
    writer.string(&value.card_id)?;
    writer.string(&value.variant_id)?;
    writer.string(&value.finish_id)
}

fn read_printing(reader: &mut Reader<'_>) -> Result<PrintingKey, WireError> {
    Ok(PrintingKey {
        card_id: reader.string()?,
        variant_id: reader.string()?,
        finish_id: reader.string()?,
    })
}

fn write_opaque(writer: &mut Writer, value: &OpaquePayload) -> Result<(), WireError> {
    writer.string(&value.type_id)?;
    writer.u16(value.schema);
    writer.bytes(
        &value.bytes,
        blockwild_gameplay::MAX_PAYLOAD_BYTES,
        "opaque gameplay payload",
    )
}

fn read_opaque(reader: &mut Reader<'_>) -> Result<OpaquePayload, WireError> {
    Ok(OpaquePayload {
        type_id: reader.string()?,
        schema: reader.u16()?,
        bytes: reader.bytes(blockwild_gameplay::MAX_PAYLOAD_BYTES, "opaque gameplay payload")?,
    })
}

fn write_accepted_gameplay_receipt(writer: &mut Writer, value: &AcceptedReceipt) -> Result<(), WireError> {
    writer.string(&value.batch_id)?;
    write_gameplay_identity(writer, &value.before)?;
    write_gameplay_identity(writer, &value.after)?;
    writer.count(value.touched_domains.len(), 5, "touched gameplay domains")?;
    for domain in &value.touched_domains {
        writer.u8(domain_tag(*domain));
    }
    writer.count(value.resource_deltas.len(), MAX_COLLECTION, "resource delta count")?;
    for delta in &value.resource_deltas {
        writer.u32(delta.item_code);
        writer.hash(delta.metadata_hash);
        writer.i64(delta.amount);
        writer.string(&delta.reason)?;
    }
    writer.count(value.stat_deltas.len(), MAX_COLLECTION, "stat delta count")?;
    for delta in &value.stat_deltas {
        writer.string(&delta.record_id)?;
        writer.string(&delta.stat_id)?;
        writer.i64(delta.amount);
    }
    writer.count(value.events.len(), MAX_COLLECTION, "gameplay event count")?;
    for event in &value.events {
        write_gameplay_event(writer, event)?;
    }
    if value.receipt_hash != value.calculate_hash() {
        return Err(WireError::new(
            "gameplay-receipt-hash",
            "gameplay receipt hash mismatch",
        ));
    }
    writer.hash(value.receipt_hash);
    Ok(())
}

fn read_accepted_gameplay_receipt(reader: &mut Reader<'_>) -> Result<AcceptedReceipt, WireError> {
    let batch_id = reader.string()?;
    let before = read_gameplay_identity(reader)?;
    let after = read_gameplay_identity(reader)?;
    let domain_count = reader.count(5, "touched gameplay domains")?;
    let mut touched_domains = BTreeSet::new();
    for _ in 0..domain_count {
        let domain = read_domain(reader)?;
        if touched_domains.last().is_some_and(|previous| domain <= *previous) {
            return Err(WireError::new(
                "gameplay-receipt",
                "touched domains must be unique and canonically ordered",
            ));
        }
        touched_domains.insert(domain);
    }
    let resource_count = reader.count(MAX_COLLECTION, "resource delta count")?;
    let mut resource_deltas = Vec::with_capacity(resource_count);
    for _ in 0..resource_count {
        resource_deltas.push(ResourceDelta {
            item_code: reader.u32()?,
            metadata_hash: reader.hash()?,
            amount: reader.i64()?,
            reason: reader.string()?,
        });
    }
    let stat_count = reader.count(MAX_COLLECTION, "stat delta count")?;
    let mut stat_deltas = Vec::with_capacity(stat_count);
    for _ in 0..stat_count {
        stat_deltas.push(StatDelta {
            record_id: reader.string()?,
            stat_id: reader.string()?,
            amount: reader.i64()?,
        });
    }
    let event_count = reader.count(MAX_COLLECTION, "gameplay event count")?;
    let mut events = Vec::with_capacity(event_count);
    for _ in 0..event_count {
        events.push(read_gameplay_event(reader)?);
    }
    let value = AcceptedReceipt {
        batch_id,
        before,
        after,
        touched_domains,
        resource_deltas,
        stat_deltas,
        events,
        receipt_hash: reader.hash()?,
    };
    if value.receipt_hash != value.calculate_hash() {
        return Err(WireError::new(
            "gameplay-receipt-hash",
            "gameplay receipt hash mismatch",
        ));
    }
    Ok(value)
}

fn write_gameplay_event(writer: &mut Writer, value: &GameplayEvent) -> Result<(), WireError> {
    writer.string(&value.event_id)?;
    writer.string(&value.kind)?;
    writer.string(&value.actor_id)?;
    writer.option_string(value.record_id.as_deref())?;
    write_opaque(writer, &value.payload)
}

fn read_gameplay_event(reader: &mut Reader<'_>) -> Result<GameplayEvent, WireError> {
    Ok(GameplayEvent {
        event_id: reader.string()?,
        kind: reader.string()?,
        actor_id: reader.string()?,
        record_id: reader.option_string()?,
        payload: read_opaque(reader)?,
    })
}

const fn actor_role_tag(value: ActorRole) -> u8 {
    match value {
        ActorRole::Host => 0,
        ActorRole::Guest => 1,
        ActorRole::Agent => 2,
        ActorRole::System => 3,
    }
}
fn read_actor_role(reader: &mut Reader<'_>) -> Result<ActorRole, WireError> {
    match reader.u8()? {
        0 => Ok(ActorRole::Host),
        1 => Ok(ActorRole::Guest),
        2 => Ok(ActorRole::Agent),
        3 => Ok(ActorRole::System),
        _ => Err(WireError::new("actor-role", "unknown gameplay actor role")),
    }
}
const fn scope_tag(value: Scope) -> u8 {
    match value {
        Scope::InventorySelf => 0,
        Scope::InventoryAny => 1,
        Scope::Machines => 2,
        Scope::CombatSelf => 3,
        Scope::CombatAny => 4,
        Scope::ProgressionSelf => 5,
        Scope::ProgressionAny => 6,
        Scope::CardforgeSelf => 7,
        Scope::CardforgeAny => 8,
        Scope::System => 9,
    }
}
fn read_scope(reader: &mut Reader<'_>) -> Result<Scope, WireError> {
    match reader.u8()? {
        0 => Ok(Scope::InventorySelf),
        1 => Ok(Scope::InventoryAny),
        2 => Ok(Scope::Machines),
        3 => Ok(Scope::CombatSelf),
        4 => Ok(Scope::CombatAny),
        5 => Ok(Scope::ProgressionSelf),
        6 => Ok(Scope::ProgressionAny),
        7 => Ok(Scope::CardforgeSelf),
        8 => Ok(Scope::CardforgeAny),
        9 => Ok(Scope::System),
        _ => Err(WireError::new("gameplay-scope", "unknown gameplay scope")),
    }
}
const fn container_kind_tag(value: ContainerKind) -> u8 {
    match value {
        ContainerKind::Player => 0,
        ContainerKind::Equipment => 1,
        ContainerKind::Container => 2,
        ContainerKind::Machine => 3,
        ContainerKind::Waygrid => 4,
        ContainerKind::CardforgeCase => 5,
    }
}
fn read_container_kind(reader: &mut Reader<'_>) -> Result<ContainerKind, WireError> {
    match reader.u8()? {
        0 => Ok(ContainerKind::Player),
        1 => Ok(ContainerKind::Equipment),
        2 => Ok(ContainerKind::Container),
        3 => Ok(ContainerKind::Machine),
        4 => Ok(ContainerKind::Waygrid),
        5 => Ok(ContainerKind::CardforgeCase),
        _ => Err(WireError::new("container-kind", "unknown container kind")),
    }
}
const fn resource_kind_tag(value: ResourceKind) -> u8 {
    match value {
        ResourceKind::Item => 0,
        ResourceKind::Liquid => 1,
        ResourceKind::Gas => 2,
        ResourceKind::Energy => 3,
        ResourceKind::Heat => 4,
    }
}
fn read_resource_kind(reader: &mut Reader<'_>) -> Result<ResourceKind, WireError> {
    match reader.u8()? {
        0 => Ok(ResourceKind::Item),
        1 => Ok(ResourceKind::Liquid),
        2 => Ok(ResourceKind::Gas),
        3 => Ok(ResourceKind::Energy),
        4 => Ok(ResourceKind::Heat),
        _ => Err(WireError::new("resource-kind", "unknown resource kind")),
    }
}
const fn progression_action_tag(value: ProgressionAction) -> u8 {
    match value {
        ProgressionAction::UnlockPerk => 0,
        ProgressionAction::QuestChoice => 1,
        ProgressionAction::FactionChoice => 2,
        ProgressionAction::GuildAction => 3,
        ProgressionAction::Trade => 4,
        ProgressionAction::FastTravel => 5,
        ProgressionAction::DialogueChoice => 6,
        ProgressionAction::DragonTraining => 7,
        ProgressionAction::SettlementAction => 8,
        ProgressionAction::LegendaryAction => 9,
    }
}
fn read_progression_action(reader: &mut Reader<'_>) -> Result<ProgressionAction, WireError> {
    match reader.u8()? {
        0 => Ok(ProgressionAction::UnlockPerk),
        1 => Ok(ProgressionAction::QuestChoice),
        2 => Ok(ProgressionAction::FactionChoice),
        3 => Ok(ProgressionAction::GuildAction),
        4 => Ok(ProgressionAction::Trade),
        5 => Ok(ProgressionAction::FastTravel),
        6 => Ok(ProgressionAction::DialogueChoice),
        7 => Ok(ProgressionAction::DragonTraining),
        8 => Ok(ProgressionAction::SettlementAction),
        9 => Ok(ProgressionAction::LegendaryAction),
        _ => Err(WireError::new("progression-action", "unknown progression action")),
    }
}
const fn domain_tag(value: Domain) -> u8 {
    match value {
        Domain::Inventory => 0,
        Domain::Machines => 1,
        Domain::Combat => 2,
        Domain::Progression => 3,
        Domain::Cardforge => 4,
    }
}
fn read_domain(reader: &mut Reader<'_>) -> Result<Domain, WireError> {
    match reader.u8()? {
        0 => Ok(Domain::Inventory),
        1 => Ok(Domain::Machines),
        2 => Ok(Domain::Combat),
        3 => Ok(Domain::Progression),
        4 => Ok(Domain::Cardforge),
        _ => Err(WireError::new("gameplay-domain", "unknown gameplay domain")),
    }
}
const fn rejection_code_tag(value: RejectionCode) -> u8 {
    match value {
        RejectionCode::WrongWorld => 0,
        RejectionCode::StaleRevision => 1,
        RejectionCode::Duplicate => 2,
        RejectionCode::Unauthorized => 3,
        RejectionCode::InvalidCommand => 4,
        RejectionCode::InsufficientResource => 5,
        RejectionCode::InvalidTarget => 6,
        RejectionCode::Cooldown => 7,
        RejectionCode::RulesRejected => 8,
        RejectionCode::Capacity => 9,
        RejectionCode::Conflict => 10,
    }
}
fn read_rejection_code(reader: &mut Reader<'_>) -> Result<RejectionCode, WireError> {
    match reader.u8()? {
        0 => Ok(RejectionCode::WrongWorld),
        1 => Ok(RejectionCode::StaleRevision),
        2 => Ok(RejectionCode::Duplicate),
        3 => Ok(RejectionCode::Unauthorized),
        4 => Ok(RejectionCode::InvalidCommand),
        5 => Ok(RejectionCode::InsufficientResource),
        6 => Ok(RejectionCode::InvalidTarget),
        7 => Ok(RejectionCode::Cooldown),
        8 => Ok(RejectionCode::RulesRejected),
        9 => Ok(RejectionCode::Capacity),
        10 => Ok(RejectionCode::Conflict),
        _ => Err(WireError::new("gameplay-rejection", "unknown gameplay rejection code")),
    }
}

pub fn encode_entity_authority_export_v1(value: EntityAuthorityExportWireV1) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    writer.u64(value.expected_revision);
    wrap_schema(
        ENTITY_AUTHORITY_EXPORT_V1_MAGIC,
        ENTITY_AUTHORITY_EXPORT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_entity_authority_export_v1(bytes: &[u8]) -> Result<EntityAuthorityExportWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        ENTITY_AUTHORITY_EXPORT_V1_MAGIC,
        ENTITY_AUTHORITY_EXPORT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = EntityAuthorityExportWireV1 {
        expected_revision: reader.u64()?,
    };
    reader.finish()?;
    Ok(value)
}

pub fn encode_entity_authority_import_v2(value: &EntityAuthorityImportWireV2) -> Result<Vec<u8>, WireError> {
    decode_entity_authority_snapshot(&value.snapshot)
        .map_err(|error| WireError::new("entity-authority-snapshot", error.to_string()))?;
    let mut writer = Writer::default();
    writer.u64(value.expected_revision);
    writer.bytes(
        &value.snapshot,
        blockwild_entity::MAX_ENTITY_AUTHORITY_SNAPSHOT_BYTES,
        "entity authority snapshot",
    )?;
    wrap_schema(
        ENTITY_AUTHORITY_IMPORT_V2_MAGIC,
        ENTITY_AUTHORITY_IMPORT_V2_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_entity_authority_import_v2(bytes: &[u8]) -> Result<EntityAuthorityImportWireV2, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        ENTITY_AUTHORITY_IMPORT_V2_MAGIC,
        ENTITY_AUTHORITY_IMPORT_V2_INNER_SCHEMA,
        bytes,
    )?);
    let value = EntityAuthorityImportWireV2 {
        expected_revision: reader.u64()?,
        snapshot: reader.bytes(
            blockwild_entity::MAX_ENTITY_AUTHORITY_SNAPSHOT_BYTES,
            "entity authority snapshot",
        )?,
    };
    reader.finish()?;
    decode_entity_authority_snapshot(&value.snapshot)
        .map_err(|error| WireError::new("entity-authority-snapshot", error.to_string()))?;
    Ok(value)
}

pub fn encode_entity_authority_import_receipt_v1(
    value: EntityAuthorityImportReceiptWireV1,
) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    writer.u64(value.previous_revision);
    writer.u64(value.revision);
    writer.u32(value.entity_count);
    writer.hash(value.state_hash);
    wrap_schema(
        ENTITY_AUTHORITY_IMPORT_RECEIPT_V1_MAGIC,
        ENTITY_AUTHORITY_IMPORT_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_entity_authority_import_receipt_v1(
    bytes: &[u8],
) -> Result<EntityAuthorityImportReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        ENTITY_AUTHORITY_IMPORT_RECEIPT_V1_MAGIC,
        ENTITY_AUTHORITY_IMPORT_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = EntityAuthorityImportReceiptWireV1 {
        previous_revision: reader.u64()?,
        revision: reader.u64()?,
        entity_count: reader.u32()?,
        state_hash: reader.hash()?,
    };
    reader.finish()?;
    Ok(value)
}

pub fn encode_entity_compatibility_export_v1(value: EntityCompatibilityExportWireV1) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    writer.u64(value.entity_id.packed());
    writer.u64(value.expected_entity_revision);
    wrap_schema(
        ENTITY_COMPATIBILITY_EXPORT_V1_MAGIC,
        ENTITY_COMPATIBILITY_EXPORT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_entity_compatibility_export_v1(bytes: &[u8]) -> Result<EntityCompatibilityExportWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        ENTITY_COMPATIBILITY_EXPORT_V1_MAGIC,
        ENTITY_COMPATIBILITY_EXPORT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let value = EntityCompatibilityExportWireV1 {
        entity_id: unpack_entity_id(reader.u64()?)?,
        expected_entity_revision: reader.u64()?,
    };
    reader.finish()?;
    Ok(value)
}

pub fn encode_entity_compatibility_import_v1(value: &EntityCompatibilityImportWireV1) -> Result<Vec<u8>, WireError> {
    let record = encode_compatibility_record(&value.record)
        .map_err(|error| WireError::new("entity-compatibility", error.to_string()))?;
    let mut writer = Writer::default();
    writer.u64(value.sequence);
    writer.u64(value.expected_revision);
    writer.u64(value.tick);
    writer.option_entity_id(value.desired_id);
    writer.u8(value.residency as u8);
    writer.bytes(
        &record,
        blockwild_entity::MAX_ENTITY_AUTHORITY_SNAPSHOT_BYTES,
        "entity compatibility record",
    )?;
    wrap_schema(
        ENTITY_COMPATIBILITY_IMPORT_V1_MAGIC,
        ENTITY_COMPATIBILITY_IMPORT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_entity_compatibility_import_v1(bytes: &[u8]) -> Result<EntityCompatibilityImportWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        ENTITY_COMPATIBILITY_IMPORT_V1_MAGIC,
        ENTITY_COMPATIBILITY_IMPORT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let sequence = reader.u64()?;
    let expected_revision = reader.u64()?;
    let tick = reader.u64()?;
    let desired_id = reader.option_entity_id()?;
    let residency = read_residency(&mut reader)?;
    let record_bytes = reader.bytes(
        blockwild_entity::MAX_ENTITY_AUTHORITY_SNAPSHOT_BYTES,
        "entity compatibility record",
    )?;
    reader.finish()?;
    let record = decode_compatibility_record(&record_bytes)
        .map_err(|error| WireError::new("entity-compatibility", error.to_string()))?;
    Ok(EntityCompatibilityImportWireV1 {
        sequence,
        expected_revision,
        tick,
        desired_id,
        residency,
        record,
    })
}

pub fn encode_entity_command_batch_v1(value: &EntityCommandBatch) -> Result<Vec<u8>, WireError> {
    if value.schema != blockwild_entity::ENTITY_COMMAND_SCHEMA {
        return Err(WireError::new(
            "entity-command-schema",
            "entity command batch uses an unsupported schema",
        ));
    }
    let mut writer = Writer::default();
    writer.u64(value.sequence);
    writer.u64(value.expected_revision);
    writer.u64(value.tick);
    writer.count(value.commands.len(), 256, "entity command count")?;
    for command in &value.commands {
        write_entity_command(&mut writer, command)?;
    }
    wrap_schema(ENTITY_COMMAND_V1_MAGIC, ENTITY_COMMAND_V1_INNER_SCHEMA, writer.finish())
}

pub fn decode_entity_command_batch_v1(bytes: &[u8]) -> Result<EntityCommandBatch, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        ENTITY_COMMAND_V1_MAGIC,
        ENTITY_COMMAND_V1_INNER_SCHEMA,
        bytes,
    )?);
    let sequence = reader.u64()?;
    let expected_revision = reader.u64()?;
    let tick = reader.u64()?;
    let count = reader.count(256, "entity command count")?;
    let mut commands = Vec::with_capacity(count);
    for _ in 0..count {
        commands.push(read_entity_command(&mut reader)?);
    }
    reader.finish()?;
    Ok(EntityCommandBatch {
        schema: blockwild_entity::ENTITY_COMMAND_SCHEMA,
        sequence,
        expected_revision,
        tick,
        commands,
    })
}

pub fn encode_entity_event_batch_v1(value: &EntityEventBatch) -> Result<Vec<u8>, WireError> {
    if value.schema != blockwild_entity::ENTITY_COMMAND_SCHEMA {
        return Err(WireError::new(
            "entity-event-schema",
            "entity event batch uses an unsupported schema",
        ));
    }
    let mut writer = Writer::default();
    writer.u64(value.sequence);
    writer.u64(value.previous_revision);
    writer.u64(value.revision);
    writer.count(value.events.len(), 256, "entity event count")?;
    for event in &value.events {
        writer.u32(event.command_index);
        writer.u64(event.entity_id.packed());
        writer.u64(event.previous_entity_revision);
        writer.u64(event.entity_revision);
        match event.kind {
            EntityEventKind::Spawned { residency } => {
                writer.u8(0);
                writer.u8(residency as u8);
            }
            EntityEventKind::Despawned { reason } => {
                writer.u8(1);
                writer.u8(reason as u8);
            }
            EntityEventKind::ResidencyChanged(residency) => {
                writer.u8(2);
                writer.u8(residency as u8);
            }
            EntityEventKind::MotionUpdated => writer.u8(3),
            EntityEventKind::TierChanged(tier) => {
                writer.u8(4);
                writer.u8(tier as u8);
            }
            EntityEventKind::ProtectionChanged => writer.u8(5),
            EntityEventKind::VitalsEnvironmentChanged => writer.u8(6),
            EntityEventKind::LocomotionChanged => writer.u8(7),
            EntityEventKind::AiChanged => writer.u8(8),
            EntityEventKind::SocialChanged => writer.u8(9),
            EntityEventKind::MountChanged => writer.u8(10),
            EntityEventKind::NetworkAuthorityChanged => writer.u8(11),
            EntityEventKind::CareChanged => writer.u8(12),
            EntityEventKind::HusbandryChanged => writer.u8(13),
            EntityEventKind::WorkChanged => writer.u8(14),
            EntityEventKind::EquipmentChanged => writer.u8(15),
            EntityEventKind::DragonChanged => writer.u8(16),
            EntityEventKind::LegendaryChanged => writer.u8(17),
            EntityEventKind::SummonChanged => writer.u8(18),
            EntityEventKind::SentientChanged => writer.u8(19),
            EntityEventKind::ComponentsReplaced => writer.u8(20),
            EntityEventKind::CompatibilityRecordChanged => writer.u8(21),
            EntityEventKind::RangeStateChanged => writer.u8(22),
            EntityEventKind::DormantSummaryChanged => writer.u8(23),
        }
    }
    wrap_schema(ENTITY_RECEIPT_V1_MAGIC, ENTITY_RECEIPT_V1_INNER_SCHEMA, writer.finish())
}

pub fn decode_entity_event_batch_v1(bytes: &[u8]) -> Result<EntityEventBatch, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        ENTITY_RECEIPT_V1_MAGIC,
        ENTITY_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let sequence = reader.u64()?;
    let previous_revision = reader.u64()?;
    let revision = reader.u64()?;
    let count = reader.count(256, "entity event count")?;
    let mut events = Vec::with_capacity(count);
    for _ in 0..count {
        let command_index = reader.u32()?;
        let entity_id = unpack_entity_id(reader.u64()?)?;
        let previous_entity_revision = reader.u64()?;
        let entity_revision = reader.u64()?;
        let kind = match reader.u8()? {
            0 => EntityEventKind::Spawned {
                residency: read_residency(&mut reader)?,
            },
            1 => EntityEventKind::Despawned {
                reason: read_despawn_reason(&mut reader)?,
            },
            2 => EntityEventKind::ResidencyChanged(read_residency(&mut reader)?),
            3 => EntityEventKind::MotionUpdated,
            4 => EntityEventKind::TierChanged(read_tier(&mut reader)?),
            5 => EntityEventKind::ProtectionChanged,
            6 => EntityEventKind::VitalsEnvironmentChanged,
            7 => EntityEventKind::LocomotionChanged,
            8 => EntityEventKind::AiChanged,
            9 => EntityEventKind::SocialChanged,
            10 => EntityEventKind::MountChanged,
            11 => EntityEventKind::NetworkAuthorityChanged,
            12 => EntityEventKind::CareChanged,
            13 => EntityEventKind::HusbandryChanged,
            14 => EntityEventKind::WorkChanged,
            15 => EntityEventKind::EquipmentChanged,
            16 => EntityEventKind::DragonChanged,
            17 => EntityEventKind::LegendaryChanged,
            18 => EntityEventKind::SummonChanged,
            19 => EntityEventKind::SentientChanged,
            20 => EntityEventKind::ComponentsReplaced,
            21 => EntityEventKind::CompatibilityRecordChanged,
            22 => EntityEventKind::RangeStateChanged,
            23 => EntityEventKind::DormantSummaryChanged,
            _ => return Err(WireError::new("entity-event", "unknown entity event tag")),
        };
        events.push(blockwild_entity::EntityEvent {
            command_index,
            entity_id,
            previous_entity_revision,
            entity_revision,
            kind,
        });
    }
    reader.finish()?;
    Ok(EntityEventBatch {
        schema: blockwild_entity::ENTITY_COMMAND_SCHEMA,
        sequence,
        previous_revision,
        revision,
        events,
    })
}

fn write_entity_command(writer: &mut Writer, command: &EntityCommand) -> Result<(), WireError> {
    match command {
        EntityCommand::Spawn { record, residency } => {
            writer.u8(0);
            write_entity_record(writer, record)?;
            writer.u8(*residency as u8);
        }
        EntityCommand::SpawnAt { id, record, residency } => {
            writer.u8(1);
            writer.u64(id.packed());
            write_entity_record(writer, record)?;
            writer.u8(*residency as u8);
        }
        EntityCommand::Despawn { id, reason } => {
            writer.u8(2);
            writer.u64(id.packed());
            writer.u8(*reason as u8);
        }
        EntityCommand::Hibernate { id } => {
            writer.u8(3);
            writer.u64(id.packed());
        }
        EntityCommand::Wake { id, tier } => {
            writer.u8(4);
            writer.u64(id.packed());
            writer.u8(*tier as u8);
        }
        EntityCommand::UpdateMotion {
            id,
            position,
            yaw,
            velocity,
        } => {
            writer.u8(5);
            writer.u64(id.packed());
            writer.entity_vec3(*position);
            writer.f32(*yaw);
            writer.entity_vec3(*velocity);
        }
        EntityCommand::SetSimulationTier { id, tier } => {
            writer.u8(6);
            writer.u64(id.packed());
            writer.u8(*tier as u8);
        }
        EntityCommand::SetProtection { id, protection } => {
            writer.u8(7);
            writer.u64(id.packed());
            writer.u64(protection.bits());
        }
        EntityCommand::SpawnTyped {
            record,
            components,
            residency,
        } => {
            writer.u8(8);
            write_entity_record(writer, record)?;
            write_entity_components(writer, components)?;
            writer.u8(*residency as u8);
        }
        EntityCommand::SpawnTypedAt {
            id,
            record,
            components,
            residency,
        } => {
            writer.u8(9);
            writer.u64(id.packed());
            write_entity_record(writer, record)?;
            write_entity_components(writer, components)?;
            writer.u8(*residency as u8);
        }
        EntityCommand::SetVitalsEnvironment { id, value } => {
            writer.u8(10);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.vitals = value.clone())?;
        }
        EntityCommand::SetLocomotionBody { id, value } => {
            writer.u8(11);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.locomotion = value.clone())?;
        }
        EntityCommand::SetAiState { id, value } => {
            writer.u8(12);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.ai = value.clone())?;
        }
        EntityCommand::SetSocialState { id, value } => {
            writer.u8(13);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.social = value.clone())?;
        }
        EntityCommand::SetMountState { id, value } => {
            writer.u8(14);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.mount = value.clone())?;
        }
        EntityCommand::SetProtectionProvenance { id, value } => {
            writer.u8(15);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.protection = value.clone())?;
        }
        EntityCommand::SetNetworkAuthority { id, value } => {
            writer.u8(16);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.network = value.clone())?;
        }
        EntityCommand::SetCareState { id, value } => {
            writer.u8(17);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.care = value.clone())?;
        }
        EntityCommand::SetHusbandryState { id, value } => {
            writer.u8(18);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.husbandry = value.clone())?;
        }
        EntityCommand::SetWorkState { id, value } => {
            writer.u8(19);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.work = value.clone())?;
        }
        EntityCommand::SetEquipment { id, value } => {
            writer.u8(20);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.equipment = value.clone())?;
        }
        EntityCommand::SetDragonState { id, value } => {
            writer.u8(21);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.dragon = value.clone())?;
        }
        EntityCommand::SetLegendaryState { id, value } => {
            writer.u8(22);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.legendary = value.clone())?;
        }
        EntityCommand::SetSummonState { id, value } => {
            writer.u8(23);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.summon = value.clone())?;
        }
        EntityCommand::SetSentientState { id, value } => {
            writer.u8(24);
            writer.u64(id.packed());
            write_component_projection(writer, |components| components.sentient = value.clone())?;
        }
        EntityCommand::ReplaceComponents { id, value } => {
            writer.u8(25);
            writer.u64(id.packed());
            write_entity_components(writer, value)?;
        }
        EntityCommand::ReplaceCompatibilityRecord { id, value } => {
            writer.u8(26);
            writer.u64(id.packed());
            write_entity_record(writer, value)?;
        }
        EntityCommand::SetRangeState {
            id,
            out_of_range_seconds,
            last_simulated_tick,
        } => {
            writer.u8(27);
            writer.u64(id.packed());
            writer.f32(*out_of_range_seconds);
            writer.u64(*last_simulated_tick);
        }
        EntityCommand::SetDormantSummary { id, value } => {
            writer.u8(28);
            writer.u64(id.packed());
            write_dormant_summary_projection(writer, value)?;
        }
    }
    Ok(())
}

fn read_entity_command(reader: &mut Reader<'_>) -> Result<EntityCommand, WireError> {
    match reader.u8()? {
        0 => Ok(EntityCommand::Spawn {
            record: read_entity_record(reader)?,
            residency: read_residency(reader)?,
        }),
        1 => Ok(EntityCommand::SpawnAt {
            id: unpack_entity_id(reader.u64()?)?,
            record: read_entity_record(reader)?,
            residency: read_residency(reader)?,
        }),
        2 => Ok(EntityCommand::Despawn {
            id: unpack_entity_id(reader.u64()?)?,
            reason: read_despawn_reason(reader)?,
        }),
        3 => Ok(EntityCommand::Hibernate {
            id: unpack_entity_id(reader.u64()?)?,
        }),
        4 => Ok(EntityCommand::Wake {
            id: unpack_entity_id(reader.u64()?)?,
            tier: read_tier(reader)?,
        }),
        5 => Ok(EntityCommand::UpdateMotion {
            id: unpack_entity_id(reader.u64()?)?,
            position: reader.entity_vec3()?,
            yaw: reader.f32()?,
            velocity: reader.entity_vec3()?,
        }),
        6 => Ok(EntityCommand::SetSimulationTier {
            id: unpack_entity_id(reader.u64()?)?,
            tier: read_tier(reader)?,
        }),
        7 => Ok(EntityCommand::SetProtection {
            id: unpack_entity_id(reader.u64()?)?,
            protection: ProtectionState::from_bits(reader.u64()?),
        }),
        8 => Ok(EntityCommand::SpawnTyped {
            record: read_entity_record(reader)?,
            components: read_entity_components(reader)?,
            residency: read_residency(reader)?,
        }),
        9 => Ok(EntityCommand::SpawnTypedAt {
            id: unpack_entity_id(reader.u64()?)?,
            record: read_entity_record(reader)?,
            components: read_entity_components(reader)?,
            residency: read_residency(reader)?,
        }),
        10 => Ok(EntityCommand::SetVitalsEnvironment {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.vitals,
        }),
        11 => Ok(EntityCommand::SetLocomotionBody {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.locomotion,
        }),
        12 => Ok(EntityCommand::SetAiState {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.ai,
        }),
        13 => Ok(EntityCommand::SetSocialState {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.social,
        }),
        14 => Ok(EntityCommand::SetMountState {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.mount,
        }),
        15 => Ok(EntityCommand::SetProtectionProvenance {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.protection,
        }),
        16 => Ok(EntityCommand::SetNetworkAuthority {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.network,
        }),
        17 => Ok(EntityCommand::SetCareState {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.care,
        }),
        18 => Ok(EntityCommand::SetHusbandryState {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.husbandry,
        }),
        19 => Ok(EntityCommand::SetWorkState {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.work,
        }),
        20 => Ok(EntityCommand::SetEquipment {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.equipment,
        }),
        21 => Ok(EntityCommand::SetDragonState {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.dragon,
        }),
        22 => Ok(EntityCommand::SetLegendaryState {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.legendary,
        }),
        23 => Ok(EntityCommand::SetSummonState {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.summon,
        }),
        24 => Ok(EntityCommand::SetSentientState {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?.sentient,
        }),
        25 => Ok(EntityCommand::ReplaceComponents {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_components(reader)?,
        }),
        26 => Ok(EntityCommand::ReplaceCompatibilityRecord {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_entity_record(reader)?,
        }),
        27 => Ok(EntityCommand::SetRangeState {
            id: unpack_entity_id(reader.u64()?)?,
            out_of_range_seconds: reader.f32()?,
            last_simulated_tick: reader.u64()?,
        }),
        28 => Ok(EntityCommand::SetDormantSummary {
            id: unpack_entity_id(reader.u64()?)?,
            value: read_dormant_summary_projection(reader)?,
        }),
        _ => Err(WireError::new("entity-command", "unknown entity command tag")),
    }
}

fn write_entity_components(writer: &mut Writer, value: &EntityComponents) -> Result<(), WireError> {
    value
        .validate()
        .map_err(|error| WireError::new("entity-components", error))?;
    // The BWEA projection validates the compatibility mirrors as well as the
    // typed component payload. Build a lossless shell from the component values
    // instead of relying on defaults, otherwise valid non-default vitals,
    // motion, social, or equipment state could not cross this wire.
    let mut record = EntityCompatibilityRecord::new("wire-components", "wire-components", "wire-components");
    record.health = value.vitals.health;
    record.maximum_health = value.vitals.maximum_health;
    record.velocity = value.locomotion.velocity;
    record.social_group_id = value.social.group_id.clone();
    record.equipment = value
        .equipment
        .iter()
        .map(|(slot, item)| (slot.clone(), item.item_key.clone()))
        .collect();
    let mut authority = EntityAuthority::default();
    authority
        .apply_batch(&EntityCommandBatch {
            schema: blockwild_entity::ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            commands: vec![EntityCommand::SpawnTypedAt {
                id: EntityId::new(1, 1),
                record,
                components: value.clone(),
                residency: EntityResidency::Hot,
            }],
        })
        .map_err(|error| WireError::new("entity-components", error.to_string()))?;
    let snapshot = encode_entity_authority_snapshot(&authority)
        .map_err(|error| WireError::new("entity-components", error.to_string()))?;
    writer.bytes(&snapshot, MAX_DOMAIN_PAYLOAD_BYTES, "entity component snapshot")
}

fn read_entity_components(reader: &mut Reader<'_>) -> Result<EntityComponents, WireError> {
    let snapshot = reader.bytes(MAX_DOMAIN_PAYLOAD_BYTES, "entity component snapshot")?;
    let authority = decode_entity_authority_snapshot(&snapshot)
        .map_err(|error| WireError::new("entity-components", error.to_string()))?;
    if authority.len() != 1 || !authority.cold().is_empty() {
        return Err(WireError::new(
            "entity-components",
            "entity component projection must contain exactly one hot entity",
        ));
    }
    authority
        .hot()
        .values()
        .next()
        .map(|entity| entity.components.clone())
        .ok_or_else(|| WireError::new("entity-components", "entity component projection is empty"))
}

fn write_component_projection(
    writer: &mut Writer,
    update: impl FnOnce(&mut EntityComponents),
) -> Result<(), WireError> {
    let record = EntityCompatibilityRecord::new("wire-components", "wire-components", "wire-components");
    let mut components = EntityComponents::from_compatibility(&record, ProtectionState::default());
    update(&mut components);
    write_entity_components(writer, &components)
}

fn write_dormant_summary_projection(writer: &mut Writer, value: &DormantEntitySummary) -> Result<(), WireError> {
    let record = EntityCompatibilityRecord::new("wire-dormant", "wire-dormant", "wire-dormant");
    let mut components = EntityComponents::from_compatibility(&record, ProtectionState::default());
    components.ai.route_epoch = value.route_epoch;
    let id = EntityId::new(1, 1);
    let mut authority = EntityAuthority::default();
    authority
        .apply_batch(&EntityCommandBatch {
            schema: blockwild_entity::ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: value.slept_at_tick,
            commands: vec![
                EntityCommand::SpawnTypedAt {
                    id,
                    record,
                    components,
                    residency: EntityResidency::Cold,
                },
                EntityCommand::SetDormantSummary {
                    id,
                    value: value.clone(),
                },
            ],
        })
        .map_err(|error| WireError::new("entity-dormant-summary", error.to_string()))?;
    let snapshot = encode_entity_authority_snapshot(&authority)
        .map_err(|error| WireError::new("entity-dormant-summary", error.to_string()))?;
    writer.bytes(&snapshot, MAX_DOMAIN_PAYLOAD_BYTES, "entity dormant summary snapshot")
}

fn read_dormant_summary_projection(reader: &mut Reader<'_>) -> Result<DormantEntitySummary, WireError> {
    let snapshot = reader.bytes(MAX_DOMAIN_PAYLOAD_BYTES, "entity dormant summary snapshot")?;
    let authority = decode_entity_authority_snapshot(&snapshot)
        .map_err(|error| WireError::new("entity-dormant-summary", error.to_string()))?;
    if authority.len() != 1 || !authority.hot().is_empty() {
        return Err(WireError::new(
            "entity-dormant-summary",
            "entity dormant summary projection must contain exactly one cold entity",
        ));
    }
    authority
        .cold()
        .values()
        .next()
        .map(|entity| entity.summary.clone())
        .ok_or_else(|| WireError::new("entity-dormant-summary", "entity dormant summary projection is empty"))
}

fn write_entity_record(writer: &mut Writer, value: &EntityCompatibilityRecord) -> Result<(), WireError> {
    value
        .validate()
        .map_err(|error| WireError::new("entity-record", error.to_string()))?;
    writer.string(&value.external_entity_id)?;
    writer.option_u64(value.legacy_numeric_id);
    writer.string(&value.specimen_id)?;
    writer.string(&value.kind_key)?;
    writer.u8(value.class as u8);
    writer.option_string(value.variant_key.as_deref())?;
    writer.option_string(value.name.as_deref())?;
    writer.u64(value.location_id.packed());
    writer.entity_vec3(value.position);
    writer.f32(value.yaw);
    writer.entity_vec3(value.velocity);
    writer.f32(value.health);
    writer.f32(value.maximum_health);
    writer.u64(value.age_ticks);
    writer.flag(value.natural_spawned);
    writer.flag(value.ever_led);
    writer.option_string(value.owner_id.as_deref())?;
    writer.flag(value.tamed);
    writer.u32(value.bond_points);
    writer.string(&value.bond_tier)?;
    writer.option_string(value.social_group_id.as_deref())?;
    writer.option_string(value.faction_id.as_deref())?;
    writer.option_string(value.settlement_id.as_deref())?;
    writer.string_map(&value.equipment)?;
    writer.u32_map(&value.research)?;
    writer.string_map(&value.custom)
}

fn read_entity_record(reader: &mut Reader<'_>) -> Result<EntityCompatibilityRecord, WireError> {
    let external_entity_id = reader.string()?;
    let legacy_numeric_id = reader.option_u64()?;
    let specimen_id = reader.string()?;
    let kind_key = reader.string()?;
    let class = match reader.u8()? {
        0 => EntityClass::Creature,
        1 => EntityClass::Player,
        2 => EntityClass::Sentient,
        3 => EntityClass::Construct,
        4 => EntityClass::Projectile,
        5 => EntityClass::Vehicle,
        _ => return Err(WireError::new("entity-class", "unknown entity class")),
    };
    let variant_key = reader.option_string()?;
    let name = reader.option_string()?;
    let location_id = unpack_location_id(reader.u64()?)?;
    let position = reader.entity_vec3()?;
    let yaw = reader.f32()?;
    let velocity = reader.entity_vec3()?;
    let health = reader.f32()?;
    let maximum_health = reader.f32()?;
    let age_ticks = reader.u64()?;
    let natural_spawned = reader.flag()?;
    let ever_led = reader.flag()?;
    let owner_id = reader.option_string()?;
    let tamed = reader.flag()?;
    let bond_points = reader.u32()?;
    let bond_tier = reader.string()?;
    let social_group_id = reader.option_string()?;
    let faction_id = reader.option_string()?;
    let settlement_id = reader.option_string()?;
    let equipment = reader.string_map()?;
    let research = reader.u32_map()?;
    let custom = reader.string_map()?;
    let value = EntityCompatibilityRecord {
        schema: blockwild_entity::ENTITY_COMPATIBILITY_SCHEMA,
        external_entity_id,
        legacy_numeric_id,
        specimen_id,
        kind_key,
        class,
        variant_key,
        name,
        location_id,
        position,
        yaw,
        velocity,
        health,
        maximum_health,
        age_ticks,
        natural_spawned,
        ever_led,
        owner_id,
        tamed,
        bond_points,
        bond_tier,
        social_group_id,
        faction_id,
        settlement_id,
        equipment,
        research,
        custom,
    };
    value
        .validate()
        .map_err(|error| WireError::new("entity-record", error.to_string()))?;
    Ok(value)
}

fn read_residency(reader: &mut Reader<'_>) -> Result<EntityResidency, WireError> {
    match reader.u8()? {
        0 => Ok(EntityResidency::Hot),
        1 => Ok(EntityResidency::Cold),
        _ => Err(WireError::new("entity-residency", "unknown entity residency")),
    }
}

fn read_tier(reader: &mut Reader<'_>) -> Result<SimulationTier, WireError> {
    match reader.u8()? {
        0 => Ok(SimulationTier::Hero),
        1 => Ok(SimulationTier::Nearby),
        2 => Ok(SimulationTier::Coarse),
        3 => Ok(SimulationTier::Dormant),
        _ => Err(WireError::new("entity-tier", "unknown simulation tier")),
    }
}

fn read_despawn_reason(reader: &mut Reader<'_>) -> Result<DespawnReason, WireError> {
    match reader.u8()? {
        0 => Ok(DespawnReason::NaturalRange),
        1 => Ok(DespawnReason::Defeated),
        2 => Ok(DespawnReason::Captured),
        3 => Ok(DespawnReason::Released),
        4 => Ok(DespawnReason::Admin),
        _ => Err(WireError::new("entity-despawn", "unknown despawn reason")),
    }
}

fn unpack_entity_id(value: u64) -> Result<EntityId, WireError> {
    let result = EntityId::new(value as u32, (value >> 32) as u32);
    if result.packed() == 0 {
        Err(WireError::new("entity-id", "zero entity id is reserved"))
    } else {
        Ok(result)
    }
}

fn unpack_location_id(value: u64) -> Result<LocationId, WireError> {
    let result = LocationId::new(value as u32, (value >> 32) as u32);
    if result.packed() == 0 {
        Err(WireError::new("location-id", "zero location id is reserved"))
    } else {
        Ok(result)
    }
}

fn wrap(magic: [u8; 4], body: Vec<u8>) -> Result<Vec<u8>, WireError> {
    wrap_schema(magic, DOMAIN_SCHEMA_V1, body)
}

fn wrap_schema(magic: [u8; 4], schema: u16, body: Vec<u8>) -> Result<Vec<u8>, WireError> {
    if body.len() > MAX_DOMAIN_PAYLOAD_BYTES.saturating_sub(DOMAIN_HEADER_BYTES) {
        return Err(WireError::new(
            "domain-size",
            "native domain payload exceeds its byte budget",
        ));
    }
    let mut output = Vec::with_capacity(DOMAIN_HEADER_BYTES + body.len());
    output.extend_from_slice(&magic);
    output.extend_from_slice(&DOMAIN_PROTOCOL_V1.to_le_bytes());
    output.extend_from_slice(&schema.to_le_bytes());
    output.extend_from_slice(&(body.len() as u32).to_le_bytes());
    output.extend_from_slice(&wire_checksum_v1(&body));
    output.extend_from_slice(&body);
    Ok(output)
}

fn unwrap(magic: [u8; 4], bytes: &[u8]) -> Result<&[u8], WireError> {
    unwrap_schema(magic, DOMAIN_SCHEMA_V1, bytes)
}

fn unwrap_schema(magic: [u8; 4], schema: u16, bytes: &[u8]) -> Result<&[u8], WireError> {
    if bytes.len() < DOMAIN_HEADER_BYTES || bytes.len() > MAX_DOMAIN_PAYLOAD_BYTES {
        return Err(WireError::new(
            "domain-size",
            "native domain packet is outside its byte budget",
        ));
    }
    if bytes[..4] != magic {
        return Err(WireError::new("domain-magic", "native domain packet magic mismatch"));
    }
    if u16::from_le_bytes(bytes[4..6].try_into().expect("fixed slice")) != DOMAIN_PROTOCOL_V1
        || u16::from_le_bytes(bytes[6..8].try_into().expect("fixed slice")) != schema
    {
        return Err(WireError::new(
            "domain-version",
            "unsupported native domain packet version",
        ));
    }
    let length = u32::from_le_bytes(bytes[8..12].try_into().expect("fixed slice")) as usize;
    if length != bytes.len() - DOMAIN_HEADER_BYTES {
        return Err(WireError::new("domain-length", "native domain packet length mismatch"));
    }
    let body = &bytes[DOMAIN_HEADER_BYTES..];
    if bytes[12..28] != wire_checksum_v1(body) {
        return Err(WireError::new(
            "domain-checksum",
            "native domain packet checksum mismatch",
        ));
    }
    Ok(body)
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }
    fn flag(&mut self, value: bool) {
        self.u8(u8::from(value));
    }
    fn u16(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn i16(&mut self, value: i16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn i32(&mut self, value: i32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn i64(&mut self, value: i64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn f32(&mut self, value: f32) {
        self.u32(value.to_bits());
    }
    fn f64(&mut self, value: f64) {
        self.u64(value.to_bits());
    }
    fn hash(&mut self, value: CanonicalHash) {
        self.bytes.extend_from_slice(value.as_bytes());
    }
    fn bytes(&mut self, value: &[u8], maximum: usize, label: &str) -> Result<(), WireError> {
        if value.len() > maximum || value.len() > u32::MAX as usize {
            return Err(WireError::new(
                "domain-size",
                format!("{label} exceeds its byte budget"),
            ));
        }
        self.u32(value.len() as u32);
        self.bytes.extend_from_slice(value);
        Ok(())
    }
    fn string(&mut self, value: &str) -> Result<(), WireError> {
        if value.is_empty() || value.len() > MAX_STRING_BYTES || value.chars().any(char::is_control) {
            return Err(WireError::new("domain-string", "native domain string is malformed"));
        }
        self.bytes(value.as_bytes(), MAX_STRING_BYTES, "domain string")
    }
    fn option_string(&mut self, value: Option<&str>) -> Result<(), WireError> {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.string(value)?;
        }
        Ok(())
    }
    fn option_u32(&mut self, value: Option<u32>) {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.u32(value);
        }
    }
    fn option_u16(&mut self, value: Option<u16>) {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.u16(value);
        }
    }
    fn option_u64(&mut self, value: Option<u64>) {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.u64(value);
        }
    }
    fn option_player_id(&mut self, value: Option<PlayerId>) {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.u64(value.packed());
        }
    }
    fn option_entity_id(&mut self, value: Option<EntityId>) {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.u64(value.packed());
        }
    }
    fn count(&mut self, count: usize, maximum: usize, label: &str) -> Result<(), WireError> {
        if count > maximum || count > u32::MAX as usize {
            return Err(WireError::new("domain-count", format!("{label} exceeds its budget")));
        }
        self.u32(count as u32);
        Ok(())
    }
    fn entity_vec3(&mut self, value: EntityVec3) {
        self.f32(value.x);
        self.f32(value.y);
        self.f32(value.z);
    }
    fn fixed_vec3(&mut self, value: FixedVec3) {
        self.i32(value.x_milli);
        self.i32(value.y_milli);
        self.i32(value.z_milli);
    }
    fn string_map(&mut self, values: &BTreeMap<String, String>) -> Result<(), WireError> {
        self.count(values.len(), MAX_MAP_ENTRIES, "string map")?;
        for (key, value) in values {
            self.string(key)?;
            self.string(value)?;
        }
        Ok(())
    }
    fn u32_map(&mut self, values: &BTreeMap<String, u32>) -> Result<(), WireError> {
        self.count(values.len(), MAX_MAP_ENTRIES, "integer map")?;
        for (key, value) in values {
            self.string(key)?;
            self.u32(*value);
        }
        Ok(())
    }
    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8], WireError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| WireError::new("domain-truncated", "native domain offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| WireError::new("domain-truncated", "native domain packet is truncated"))?;
        self.offset = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, WireError> {
        Ok(self.take(1)?[0])
    }
    fn flag(&mut self) -> Result<bool, WireError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(WireError::new("domain-flag", "native domain flag is not boolean")),
        }
    }
    fn u16(&mut self) -> Result<u16, WireError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("fixed slice")))
    }
    fn i16(&mut self) -> Result<i16, WireError> {
        Ok(i16::from_le_bytes(self.take(2)?.try_into().expect("fixed slice")))
    }
    fn u32(&mut self) -> Result<u32, WireError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }
    fn u64(&mut self) -> Result<u64, WireError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().expect("fixed slice")))
    }
    fn i32(&mut self) -> Result<i32, WireError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }
    fn i64(&mut self) -> Result<i64, WireError> {
        Ok(i64::from_le_bytes(self.take(8)?.try_into().expect("fixed slice")))
    }
    fn f32(&mut self) -> Result<f32, WireError> {
        let value = f32::from_bits(self.u32()?);
        if !value.is_finite() {
            return Err(WireError::new("domain-number", "native domain f32 is not finite"));
        }
        Ok(value)
    }
    fn f64(&mut self) -> Result<f64, WireError> {
        let value = f64::from_bits(self.u64()?);
        if !value.is_finite() {
            return Err(WireError::new("domain-number", "native domain f64 is not finite"));
        }
        Ok(value)
    }
    fn hash(&mut self) -> Result<CanonicalHash, WireError> {
        Ok(CanonicalHash(self.take(16)?.try_into().expect("fixed slice")))
    }
    fn bytes(&mut self, maximum: usize, label: &str) -> Result<Vec<u8>, WireError> {
        let length = self.u32()? as usize;
        if length > maximum {
            return Err(WireError::new(
                "domain-size",
                format!("{label} exceeds its byte budget"),
            ));
        }
        Ok(self.take(length)?.to_vec())
    }
    fn string(&mut self) -> Result<String, WireError> {
        let value = String::from_utf8(self.bytes(MAX_STRING_BYTES, "domain string")?)
            .map_err(|_| WireError::new("domain-utf8", "native domain string is not UTF-8"))?;
        if value.is_empty() || value.chars().any(char::is_control) {
            return Err(WireError::new("domain-string", "native domain string is malformed"));
        }
        Ok(value)
    }
    fn option_string(&mut self) -> Result<Option<String>, WireError> {
        if self.flag()? {
            Ok(Some(self.string()?))
        } else {
            Ok(None)
        }
    }
    fn option_u32(&mut self) -> Result<Option<u32>, WireError> {
        if self.flag()? { Ok(Some(self.u32()?)) } else { Ok(None) }
    }
    fn option_u16(&mut self) -> Result<Option<u16>, WireError> {
        Ok(if self.flag()? { Some(self.u16()?) } else { None })
    }
    fn option_u64(&mut self) -> Result<Option<u64>, WireError> {
        if self.flag()? { Ok(Some(self.u64()?)) } else { Ok(None) }
    }
    fn option_player_id(&mut self) -> Result<Option<PlayerId>, WireError> {
        if self.flag()? {
            Ok(Some(player_id_from_packed(self.u64()?)))
        } else {
            Ok(None)
        }
    }
    fn option_entity_id(&mut self) -> Result<Option<EntityId>, WireError> {
        if self.flag()? {
            Ok(Some(entity_id_from_packed(self.u64()?)))
        } else {
            Ok(None)
        }
    }
    fn count(&mut self, maximum: usize, label: &str) -> Result<usize, WireError> {
        let count = self.u32()? as usize;
        if count > maximum {
            return Err(WireError::new("domain-count", format!("{label} exceeds its budget")));
        }
        Ok(count)
    }
    fn entity_vec3(&mut self) -> Result<EntityVec3, WireError> {
        Ok(EntityVec3::new(self.f32()?, self.f32()?, self.f32()?))
    }
    fn fixed_vec3(&mut self) -> Result<FixedVec3, WireError> {
        Ok(FixedVec3 {
            x_milli: self.i32()?,
            y_milli: self.i32()?,
            z_milli: self.i32()?,
        })
    }
    fn string_map(&mut self) -> Result<BTreeMap<String, String>, WireError> {
        let count = self.count(MAX_MAP_ENTRIES, "string map")?;
        let mut result = BTreeMap::new();
        for _ in 0..count {
            let key = self.string()?;
            let value = self.string()?;
            if result.insert(key, value).is_some() {
                return Err(WireError::new("domain-map", "native domain map contains duplicate key"));
            }
        }
        Ok(result)
    }
    fn u32_map(&mut self) -> Result<BTreeMap<String, u32>, WireError> {
        let count = self.count(MAX_MAP_ENTRIES, "integer map")?;
        let mut result = BTreeMap::new();
        for _ in 0..count {
            let key = self.string()?;
            let value = self.u32()?;
            if result.insert(key, value).is_some() {
                return Err(WireError::new("domain-map", "native domain map contains duplicate key"));
            }
        }
        Ok(result)
    }
    fn finish(&self) -> Result<(), WireError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(WireError::new(
                "domain-trailing",
                "native domain packet has trailing bytes",
            ))
        }
    }
}

fn player_id_from_packed(value: u64) -> PlayerId {
    PlayerId::new(value as u32, (value >> 32) as u32)
}

fn entity_id_from_packed(value: u64) -> EntityId {
    EntityId::new(value as u32, (value >> 32) as u32)
}

pub fn encode_content_install_page_v1(value: &ContentInstallPageWireV1) -> Result<Vec<u8>, WireError> {
    validate_content_page_shape(value)?;
    let mut writer = Writer::default();
    writer.string(&value.install_id)?;
    writer.u16(value.manifest_schema);
    writer.string(&value.source_revision)?;
    writer.hash(value.manifest_hash);
    write_content_domains(&mut writer, &value.domains)?;
    writer.u32(value.page_index);
    writer.u32(value.page_count);
    writer.count(
        value.artifacts.len(),
        CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1,
        "content artifact count",
    )?;
    for artifact in &value.artifacts {
        writer.u8(content_domain_tag(artifact.domain));
        writer.string(&artifact.id)?;
        writer.string(&artifact.schema_id)?;
        writer.u16(artifact.schema_version);
        writer.u32(artifact.content_version);
        writer.count(
            artifact.aliases.len(),
            blockwild_gameplay::MAX_METADATA_ALIASES,
            "content alias count",
        )?;
        for alias in &artifact.aliases {
            writer.string(alias)?;
        }
        writer.bytes(
            &artifact.canonical_bytes,
            blockwild_gameplay::MAX_METADATA_BLOB_BYTES,
            "content canonical bytes",
        )?;
        writer.bytes(
            &artifact.unknown_extension_bytes,
            blockwild_gameplay::MAX_METADATA_EXTENSION_BYTES,
            "content extension bytes",
        )?;
    }
    wrap_schema(
        CONTENT_INSTALL_PAGE_V1_MAGIC,
        CONTENT_INSTALL_PAGE_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_content_install_page_v1(bytes: &[u8]) -> Result<ContentInstallPageWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        CONTENT_INSTALL_PAGE_V1_MAGIC,
        CONTENT_INSTALL_PAGE_V1_INNER_SCHEMA,
        bytes,
    )?);
    let install_id = reader.string()?;
    let manifest_schema = reader.u16()?;
    let source_revision = reader.string()?;
    let manifest_hash = reader.hash()?;
    let domains = read_content_domains(&mut reader)?;
    let page_index = reader.u32()?;
    let page_count = reader.u32()?;
    let count = reader.count(CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1, "content artifact count")?;
    let mut artifacts = Vec::with_capacity(count);
    for _ in 0..count {
        let domain = read_content_domain(reader.u8()?)?;
        let id = reader.string()?;
        let schema_id = reader.string()?;
        let schema_version = reader.u16()?;
        let content_version = reader.u32()?;
        let alias_count = reader.count(blockwild_gameplay::MAX_METADATA_ALIASES, "content alias count")?;
        let mut aliases = Vec::with_capacity(alias_count);
        for _ in 0..alias_count {
            aliases.push(reader.string()?);
        }
        artifacts.push(ContentArtifact {
            domain,
            id,
            schema_id,
            schema_version,
            content_version,
            aliases,
            canonical_bytes: reader.bytes(blockwild_gameplay::MAX_METADATA_BLOB_BYTES, "content canonical bytes")?,
            unknown_extension_bytes: reader.bytes(
                blockwild_gameplay::MAX_METADATA_EXTENSION_BYTES,
                "content extension bytes",
            )?,
        });
    }
    reader.finish()?;
    let value = ContentInstallPageWireV1 {
        install_id,
        manifest_schema,
        source_revision,
        manifest_hash,
        domains,
        page_index,
        page_count,
        artifacts,
    };
    validate_content_page_shape(&value)?;
    Ok(value)
}

pub fn encode_content_install_receipt_v1(value: &ContentInstallReceiptWireV1) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::default();
    writer.u8(match value.status {
        ContentInstallReceiptStatusV1::Staged => 0,
        ContentInstallReceiptStatusV1::Installed => 1,
    });
    writer.string(&value.install_id)?;
    writer.string(&value.source_revision)?;
    writer.hash(value.manifest_hash);
    write_content_domains(&mut writer, &value.domains)?;
    writer.u32(value.accepted_pages);
    writer.u32(value.page_count);
    writer.u32(value.accepted_entries);
    writer.u32(value.installed_entries);
    writer.u64(value.installed_bytes);
    wrap_schema(
        CONTENT_INSTALL_RECEIPT_V1_MAGIC,
        CONTENT_INSTALL_RECEIPT_V1_INNER_SCHEMA,
        writer.finish(),
    )
}

pub fn decode_content_install_receipt_v1(bytes: &[u8]) -> Result<ContentInstallReceiptWireV1, WireError> {
    let mut reader = Reader::new(unwrap_schema(
        CONTENT_INSTALL_RECEIPT_V1_MAGIC,
        CONTENT_INSTALL_RECEIPT_V1_INNER_SCHEMA,
        bytes,
    )?);
    let status = match reader.u8()? {
        0 => ContentInstallReceiptStatusV1::Staged,
        1 => ContentInstallReceiptStatusV1::Installed,
        _ => {
            return Err(WireError::new(
                "content-status",
                "unknown content install receipt status",
            ));
        }
    };
    let value = ContentInstallReceiptWireV1 {
        status,
        install_id: reader.string()?,
        source_revision: reader.string()?,
        manifest_hash: reader.hash()?,
        domains: read_content_domains(&mut reader)?,
        accepted_pages: reader.u32()?,
        page_count: reader.u32()?,
        accepted_entries: reader.u32()?,
        installed_entries: reader.u32()?,
        installed_bytes: reader.u64()?,
    };
    reader.finish()?;
    if value.page_count == 0
        || value.page_count as usize > CONTENT_INSTALL_MAX_PAGES_V1
        || value.accepted_pages > value.page_count
        || (value.status == ContentInstallReceiptStatusV1::Installed
            && (value.accepted_pages != value.page_count || value.installed_entries != value.accepted_entries))
    {
        return Err(WireError::new(
            "content-receipt",
            "content install receipt counters are inconsistent",
        ));
    }
    Ok(value)
}

fn validate_content_page_shape(value: &ContentInstallPageWireV1) -> Result<(), WireError> {
    if value.manifest_schema != blockwild_gameplay::CONTENT_MANIFEST_SCHEMA_VERSION {
        return Err(WireError::new(
            "content-schema",
            "content manifest schema is unsupported",
        ));
    }
    if value.page_count == 0
        || value.page_count as usize > CONTENT_INSTALL_MAX_PAGES_V1
        || value.page_index >= value.page_count
        || value.artifacts.is_empty()
        || value.artifacts.len() > CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1
    {
        return Err(WireError::new(
            "content-page",
            "content install page is outside its bounds",
        ));
    }
    if value.domains.len() != ALL_CONTENT_DOMAINS.len()
        || ALL_CONTENT_DOMAINS
            .iter()
            .any(|domain| !value.domains.contains_key(domain))
    {
        return Err(WireError::new(
            "content-domains",
            "content install expectation is incomplete",
        ));
    }
    Ok(())
}

fn write_content_domains(
    writer: &mut Writer,
    values: &BTreeMap<ContentDomain, ContentDomainDigest>,
) -> Result<(), WireError> {
    if values.len() != ALL_CONTENT_DOMAINS.len() {
        return Err(WireError::new(
            "content-domains",
            "content domain expectation is incomplete",
        ));
    }
    writer.u16(ALL_CONTENT_DOMAINS.len() as u16);
    for domain in ALL_CONTENT_DOMAINS {
        let value = values
            .get(&domain)
            .ok_or_else(|| WireError::new("content-domains", "content domain expectation is incomplete"))?;
        writer.u8(content_domain_tag(domain));
        writer.u32(value.count);
        writer.hash(value.hash);
    }
    Ok(())
}

fn read_content_domains(reader: &mut Reader<'_>) -> Result<BTreeMap<ContentDomain, ContentDomainDigest>, WireError> {
    if reader.u16()? as usize != ALL_CONTENT_DOMAINS.len() {
        return Err(WireError::new(
            "content-domains",
            "content domain expectation count is invalid",
        ));
    }
    let mut values = BTreeMap::new();
    for expected in ALL_CONTENT_DOMAINS {
        let domain = read_content_domain(reader.u8()?)?;
        if domain != expected || values.contains_key(&domain) {
            return Err(WireError::new(
                "content-domain-order",
                "content domains are not in canonical order",
            ));
        }
        values.insert(
            domain,
            ContentDomainDigest {
                count: reader.u32()?,
                hash: reader.hash()?,
            },
        );
    }
    Ok(values)
}

const fn content_domain_tag(value: ContentDomain) -> u8 {
    match value {
        ContentDomain::Item => 0,
        ContentDomain::CraftingRecipe => 1,
        ContentDomain::MachineRecipe => 2,
        ContentDomain::MachineProfile => 3,
        ContentDomain::AbilitySpell => 4,
        ContentDomain::CreatureProfile => 5,
        ContentDomain::CreatureTypeChart => 6,
        ContentDomain::QuestGuild => 7,
        ContentDomain::Economy => 8,
        ContentDomain::CardforgeCard => 9,
        ContentDomain::CardforgePack => 10,
    }
}

fn read_content_domain(value: u8) -> Result<ContentDomain, WireError> {
    ALL_CONTENT_DOMAINS
        .get(value as usize)
        .copied()
        .ok_or_else(|| WireError::new("content-domain", "unknown content domain tag"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CROSS_LANGUAGE_FIXTURES: &str =
        include_str!("../../../../tests/fixtures/rust-engine/integrated-runtime-v1/wire-fixtures.json");

    fn fixture_hex_v1(name: &str) -> Vec<u8> {
        let name_marker = format!("\"name\": \"{name}\"");
        let start = CROSS_LANGUAGE_FIXTURES
            .find(&name_marker)
            .unwrap_or_else(|| panic!("missing fixture {name}"));
        let key_marker = "\"hex\": \"";
        let value_start = CROSS_LANGUAGE_FIXTURES[start..]
            .find(key_marker)
            .map(|offset| start + offset + key_marker.len())
            .unwrap_or_else(|| panic!("missing hex for fixture {name}"));
        let value_end = CROSS_LANGUAGE_FIXTURES[value_start..]
            .find('"')
            .map(|offset| value_start + offset)
            .unwrap_or_else(|| panic!("unterminated fixture {name}"));
        let value = &CROSS_LANGUAGE_FIXTURES[value_start..value_end];
        assert_eq!(value.len() % 2, 0);
        (0..value.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&value[index..index + 2], 16).expect("fixture hex"))
            .collect()
    }

    fn camera_profile_fixture_v1() -> CameraProfileV1 {
        CameraProfileV1::default()
    }

    fn basic_dirt_projection_fixture_v1() -> RuntimeBasicDirtActionProjectionReceiptWireV1 {
        let identity = IntegratedRuntimeIdentityV2 {
            schema_version: crate::INTEGRATED_RUNTIME_SCHEMA_V2,
            universe_id: "universe:receipt".into(),
            location_id: "surface".into(),
            revision: IntegratedRuntimeRevisionV2 {
                epoch: 1,
                world: 2,
                entities: 3,
                gameplay: 4,
                persistence: 5,
                network: 6,
                simulation: 7,
            },
            tick: 8,
            state_hash: CanonicalHash([0x11; 16]),
        };
        let mut content = IntegratedRuntimeBasicDirtActionContentBindingV1 {
            manifest_hash: CanonicalHash([0x21; 16]),
            installed_registry_hash: CanonicalHash([0x22; 16]),
            catalog_schema_version: 2,
            catalog_content_version: 9,
            catalog_blob_hash: CanonicalHash([0x23; 16]),
            action_report_hash: CanonicalHash([0x24; 16]),
            subset_hash: CanonicalHash::default(),
        };
        content.subset_hash = content.calculate_subset_hash_v1();
        let provenance = GeneratedDropProvenanceV1 {
            schema_version: blockwild_gameplay::BLOCK_ACTION_GENERATED_DROP_PROVENANCE_SCHEMA_VERSION_V1,
            manifest_hash: content.manifest_hash,
            installed_registry_hash: content.installed_registry_hash,
            catalog_blob_hash: content.catalog_blob_hash,
            action_report_hash: content.action_report_hash,
            rng_semantics_hash: CanonicalHash([0x25; 16]),
            block_action_sequence: 12,
            origin_input_sequence: 41,
            block_id: crate::INTEGRATED_RUNTIME_BASIC_DIRT_BLOCK_ID_V1,
            position: BlockActionLootCellV1 { x: -2, y: 43, z: 5 },
            loot_plan_hash: CanonicalHash([0x26; 16]),
            group_ordinal: 0,
        };
        let entity_id = EntityId::new(7, 3);
        let native_drop = crate::IntegratedRuntimeGeneratedDropReceiptV1 {
            provenance: provenance.clone(),
            entity_id,
        };
        let mut native = IntegratedRuntimeBasicDirtActionReceiptV1 {
            schema_version: crate::INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_SCHEMA_V1,
            sequence: 5,
            origin_input_sequence: 41,
            completion_tick: 81,
            action: IntegratedRuntimeBasicDirtActionKindV1::Mine,
            position: blockwild_authority::CellPositionV1 { x: -2, y: 43, z: 5 },
            prior_block_id: crate::INTEGRATED_RUNTIME_BASIC_DIRT_BLOCK_ID_V1,
            replacement_block_id: blockwild_authority::WORLD_AIR_BLOCK_ID_V1,
            before_world_revision: WorldAuthorityRevisionV1 {
                epoch: 1,
                mutation: 9,
                residency: 3,
            },
            after_world_revision: WorldAuthorityRevisionV1 {
                epoch: 1,
                mutation: 10,
                residency: 3,
            },
            before_world_hash: CanonicalHash([0x31; 16]),
            after_world_hash: CanonicalHash([0x32; 16]),
            creative_mode: false,
            inventory: crate::IntegratedRuntimeBasicDirtInventoryDeltaV1 {
                container: ContainerKey::player("actor:receipt"),
                slot: 2,
                before_revision: 4,
                after_revision: 4,
                before_stack: Some(ItemStack {
                    item_code: 91,
                    count: 1,
                    durability_millionths: Some(750_000),
                    metadata_hash: CanonicalHash([0x41; 16]),
                }),
                after_stack: Some(ItemStack {
                    item_code: 91,
                    count: 1,
                    durability_millionths: Some(750_000),
                    metadata_hash: CanonicalHash([0x41; 16]),
                }),
            },
            generated_drops: vec![native_drop],
            content: content.clone(),
            receipt_hash: CanonicalHash::default(),
        };
        native.receipt_hash = native.calculate_hash_v1();
        RuntimeBasicDirtActionProjectionReceiptWireV1 {
            request_payload_hash: CanonicalHash([0x51; 16]),
            identity,
            cursor_after: native.sequence,
            receipt: Some(RuntimeBasicDirtActionProjectionWireV1 {
                schema_version: native.schema_version,
                sequence: native.sequence,
                origin_input_sequence: native.origin_input_sequence,
                completion_tick: native.completion_tick,
                action: native.action,
                position: native.position,
                prior_block_id: native.prior_block_id,
                replacement_block_id: native.replacement_block_id,
                before_world_revision: native.before_world_revision,
                after_world_revision: native.after_world_revision,
                before_world_hash: native.before_world_hash,
                after_world_hash: native.after_world_hash,
                creative_mode: native.creative_mode,
                inventory: native.inventory,
                generated_drops: vec![RuntimeBasicDirtGeneratedDropProjectionWireV1 {
                    provenance,
                    entity_id,
                    stack: ItemStack {
                        item_code: 2,
                        count: 1,
                        durability_millionths: None,
                        metadata_hash: CanonicalHash([0x52; 16]),
                    },
                    position: FixedWorldVec3V1 {
                        x_milli: -1_750,
                        y_milli: 43_500,
                        z_milli: 5_250,
                    },
                    velocity_milli_per_second: FixedWorldVec3V1 {
                        x_milli: 125,
                        y_milli: 450,
                        z_milli: -75,
                    },
                    rotation: RotationMicroturnsV1 {
                        yaw: 750_000,
                        pitch: 0,
                        roll: 0,
                    },
                }],
                content,
                receipt_hash: native.receipt_hash,
            }),
        }
    }

    fn native_block_edit_projection_fixture_v1() -> RuntimeNativeBlockEditProjectionReceiptWireV1 {
        let identity = IntegratedRuntimeIdentityV2 {
            schema_version: crate::INTEGRATED_RUNTIME_SCHEMA_V2,
            universe_id: "universe:native-block-edit".into(),
            location_id: "surface".into(),
            revision: IntegratedRuntimeRevisionV2 {
                epoch: 1,
                world: 9,
                entities: 10,
                gameplay: 11,
                persistence: 12,
                network: 13,
                simulation: 14,
            },
            tick: 81,
            state_hash: CanonicalHash([0x61; 16]),
        };
        let mut content = IntegratedRuntimeNativeBlockEditContentBindingV1 {
            block_id: 1,
            manifest_hash: CanonicalHash([0x21; 16]),
            installed_registry_hash: CanonicalHash([0x22; 16]),
            catalog_schema_version: 2,
            catalog_content_version: 9,
            catalog_blob_hash: CanonicalHash([0x23; 16]),
            action_report_hash: CanonicalHash([0x24; 16]),
            subset_hash: CanonicalHash::default(),
        };
        content.subset_hash = content.calculate_subset_hash_v1();
        let provenance = GeneratedDropProvenanceV1 {
            schema_version: blockwild_gameplay::BLOCK_ACTION_GENERATED_DROP_PROVENANCE_SCHEMA_VERSION_V1,
            manifest_hash: content.manifest_hash,
            installed_registry_hash: content.installed_registry_hash,
            catalog_blob_hash: content.catalog_blob_hash,
            action_report_hash: content.action_report_hash,
            rng_semantics_hash: CanonicalHash([0x25; 16]),
            block_action_sequence: u64::MAX - 3,
            origin_input_sequence: 41,
            block_id: 1,
            position: BlockActionLootCellV1 { x: -4, y: 50, z: 7 },
            loot_plan_hash: CanonicalHash([0x26; 16]),
            group_ordinal: 2,
        };
        let (position, velocity_milli_per_second, rotation) = crate::runtime::generated_drop_transform_v9(&provenance);
        let mut receipt = IntegratedRuntimeNativeBlockEditReceiptV1 {
            schema_version: crate::INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_SCHEMA_V1,
            sequence: 5,
            origin_input_sequence: 41,
            completion_tick: 81,
            action: IntegratedRuntimeNativeBlockEditActionKindV1::Mine,
            position: blockwild_authority::CellPositionV1 { x: -4, y: 50, z: 7 },
            prior_block_id: 1,
            prior_facing: 0,
            replacement_block_id: 1,
            replacement_facing: 0,
            before_world_revision: WorldAuthorityRevisionV1 {
                epoch: 2,
                mutation: 17,
                residency: 4,
            },
            after_world_revision: WorldAuthorityRevisionV1 {
                epoch: 2,
                mutation: 17,
                residency: 4,
            },
            before_world_hash: CanonicalHash([0x31; 16]),
            after_world_hash: CanonicalHash([0x31; 16]),
            creative_mode: false,
            inventory: IntegratedRuntimeNativeBlockEditInventoryDeltaV1 {
                container: ContainerKey::player("actor:native-block-edit"),
                selected_slot: 2,
                before_revision: 4,
                after_revision: 5,
                before_stack: Some(ItemStack {
                    item_code: 91,
                    count: 1,
                    durability_millionths: Some(750_000),
                    metadata_hash: CanonicalHash([0x41; 16]),
                }),
                after_stack: Some(ItemStack {
                    item_code: 91,
                    count: 1,
                    durability_millionths: Some(650_000),
                    metadata_hash: CanonicalHash([0x41; 16]),
                }),
            },
            generated_drops: vec![IntegratedRuntimeNativeBlockEditGeneratedDropV1 {
                provenance,
                entity_id: EntityId::new(7, 3),
                stack: ItemStack {
                    item_code: 1,
                    count: 3,
                    durability_millionths: None,
                    metadata_hash: CanonicalHash([0x52; 16]),
                },
                position,
                velocity_milli_per_second,
                rotation,
            }],
            content,
            receipt_hash: CanonicalHash::default(),
        };
        receipt.receipt_hash = receipt.calculate_hash_v1();
        RuntimeNativeBlockEditProjectionReceiptWireV1 {
            request_payload_hash: CanonicalHash([0x51; 16]),
            identity,
            cursor_after: receipt.sequence,
            receipt: Some(receipt),
        }
    }

    fn native_block_edit_projection_fixture_v2() -> RuntimeNativeBlockEditProjectionReceiptWireV2 {
        let legacy = native_block_edit_projection_fixture_v1();
        let receipt = legacy.receipt.expect("fixture has one complete V1 receipt");
        let mut dirty_evidence = IntegratedRuntimeNativeBlockEditDirtyEvidenceV1 {
            schema_version: crate::INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_EVIDENCE_SCHEMA_V1,
            sequence: receipt.sequence,
            receipt_hash: receipt.receipt_hash,
            sections: Vec::new(),
            columns: Vec::new(),
            subsystem_seeds: Vec::new(),
            evidence_hash: CanonicalHash::default(),
        };
        dirty_evidence.evidence_hash = dirty_evidence.calculate_hash_v1();
        RuntimeNativeBlockEditProjectionReceiptWireV2 {
            request_payload_hash: legacy.request_payload_hash,
            identity: legacy.identity,
            cursor_after: legacy.cursor_after,
            receipt: Some(receipt),
            dirty_evidence: Some(dirty_evidence),
        }
    }

    fn native_drop_pickup_projection_fixture_v1() -> RuntimeNativeDropPickupProjectionReceiptWireV1 {
        let identity = IntegratedRuntimeIdentityV2 {
            schema_version: crate::INTEGRATED_RUNTIME_SCHEMA_V2,
            universe_id: "universe:native-pickup".into(),
            location_id: "surface".into(),
            revision: IntegratedRuntimeRevisionV2 {
                epoch: 4,
                world: 19,
                entities: 21,
                gameplay: 71,
                persistence: 6,
                network: 7,
                simulation: 8,
            },
            tick: 99,
            state_hash: CanonicalHash([0xa1; 16]),
        };
        let provenance = GeneratedDropProvenanceV1 {
            schema_version: blockwild_gameplay::BLOCK_ACTION_GENERATED_DROP_PROVENANCE_SCHEMA_VERSION_V1,
            manifest_hash: CanonicalHash([0x11; 16]),
            installed_registry_hash: CanonicalHash([0x12; 16]),
            catalog_blob_hash: CanonicalHash([0x13; 16]),
            action_report_hash: CanonicalHash([0x14; 16]),
            rng_semantics_hash: CanonicalHash([0x15; 16]),
            block_action_sequence: 9,
            origin_input_sequence: 44,
            block_id: crate::INTEGRATED_RUNTIME_BASIC_DIRT_BLOCK_ID_V1,
            position: BlockActionLootCellV1 { x: -7, y: 64, z: 12 },
            loot_plan_hash: CanonicalHash([0x16; 16]),
            group_ordinal: 1,
        };
        let source_stack = ItemStack {
            item_code: 2,
            count: 5,
            durability_millionths: None,
            metadata_hash: CanonicalHash([0x33; 16]),
        };
        let mut receipt = IntegratedRuntimeNativeDropPickupReceiptV1 {
            schema_version: crate::INTEGRATED_RUNTIME_NATIVE_DROP_PICKUP_RECEIPT_SCHEMA_V1,
            sequence: 17,
            completion_tick: 99,
            world: WorldKey::new("universe:native-pickup", "surface"),
            world_revision: WorldAuthorityRevisionV1 {
                epoch: 2,
                mutation: 19,
                residency: 5,
            },
            world_state_hash: CanonicalHash([0x21; 16]),
            player_id: PlayerId::new(3, 1),
            player_entity_id: EntityId::new(11, 4),
            inventory_container: ContainerKey::player("player:fixture"),
            inventory_before_revision: 50,
            inventory_after_revision: 52,
            affected_slots: vec![
                IntegratedRuntimeNativeDropPickupSlotDeltaV1 {
                    slot: 0,
                    before_stack: Some(ItemStack {
                        count: 60,
                        ..source_stack.clone()
                    }),
                    after_stack: Some(ItemStack {
                        count: 64,
                        ..source_stack.clone()
                    }),
                },
                IntegratedRuntimeNativeDropPickupSlotDeltaV1 {
                    slot: 4,
                    before_stack: None,
                    after_stack: Some(ItemStack {
                        count: 1,
                        ..source_stack.clone()
                    }),
                },
            ],
            source: IntegratedRuntimeNativeDropPickupSourceV1 {
                drop_id: provenance.drop_id_v1(),
                entity_id: EntityId::new(13, 5),
                origin: IntegratedRuntimeNativeDropPickupOriginV1::GeneratedBlockAction(provenance.clone()),
                custody_container: ContainerKey {
                    kind: ContainerKind::Container,
                    id: provenance.custody_id_v1(),
                    owner_id: None,
                },
                stack: source_stack,
                custody_slot: 0,
                custody_before_revision: 8,
                custody_emptied_revision: 10,
                spatial_revision: 15,
                position: FixedWorldVec3V1 {
                    x_milli: -6_750,
                    y_milli: 64_500,
                    z_milli: 12_125,
                },
                velocity_milli_per_second: FixedWorldVec3V1 {
                    x_milli: -125,
                    y_milli: 375,
                    z_milli: 50,
                },
                rotation: RotationMicroturnsV1 {
                    yaw: 750_000,
                    pitch: 125_000,
                    roll: 0,
                },
            },
            authority: IntegratedRuntimeNativeDropPickupAuthorityEvidenceV1 {
                before_gameplay_revision: GameplayRevision {
                    epoch: 2,
                    sequence: 70,
                    inventory: 50,
                    machines: 8,
                    combat: 9,
                    progression: 10,
                    cardforge: 11,
                },
                before_gameplay_hash: CanonicalHash([0x41; 16]),
                after_gameplay_revision: GameplayRevision {
                    epoch: 2,
                    sequence: 71,
                    inventory: 51,
                    machines: 8,
                    combat: 9,
                    progression: 10,
                    cardforge: 11,
                },
                after_gameplay_hash: CanonicalHash([0x42; 16]),
                before_entity_revision: 20,
                before_entity_hash: CanonicalHash([0x43; 16]),
                after_entity_revision: 21,
                after_entity_hash: CanonicalHash([0x44; 16]),
                before_world_view_revision: WorldViewRevisionV1 {
                    epoch: 3,
                    sequence: 80,
                    clock: 81,
                    machine_anchors: 82,
                    dropped_items: 83,
                    player_bindings: 84,
                    environment: 85,
                    atmosphere_gravity: 86,
                    celestial: 87,
                },
                before_world_view_hash: CanonicalHash([0x45; 16]),
                after_world_view_revision: WorldViewRevisionV1 {
                    epoch: 3,
                    sequence: 81,
                    clock: 81,
                    machine_anchors: 82,
                    dropped_items: 84,
                    player_bindings: 84,
                    environment: 85,
                    atmosphere_gravity: 86,
                    celestial: 87,
                },
                after_world_view_hash: CanonicalHash([0x46; 16]),
            },
            receipt_hash: CanonicalHash::default(),
        };
        receipt.receipt_hash = receipt.calculate_hash_v1();
        RuntimeNativeDropPickupProjectionReceiptWireV1 {
            request_payload_hash: CanonicalHash([0x51; 16]),
            identity,
            cursor_after: receipt.sequence,
            receipt: Some(receipt),
        }
    }

    fn native_player_drop_projection_fixture_v1() -> RuntimeNativePlayerDropProjectionReceiptWireV1 {
        let identity = IntegratedRuntimeIdentityV2 {
            schema_version: crate::INTEGRATED_RUNTIME_SCHEMA_V2,
            universe_id: "universe:native-player-drop".into(),
            location_id: "surface".into(),
            revision: IntegratedRuntimeRevisionV2 {
                epoch: 5,
                world: 17,
                entities: 23,
                gameplay: 31,
                persistence: 7,
                network: 8,
                simulation: 9,
            },
            tick: 9,
            state_hash: CanonicalHash([0x61; 16]),
        };
        let stack = ItemStack {
            item_code: 42,
            count: 2,
            durability_millionths: Some(875_000),
            metadata_hash: CanonicalHash([0x62; 16]),
        };
        let mut receipt = IntegratedRuntimeNativePlayerDropReceiptV1 {
            schema_version: crate::INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_SCHEMA_V1,
            sequence: 6,
            origin_input_sequence: 41,
            completion_tick: 9,
            world: WorldKey::new("universe:native-player-drop", "surface"),
            world_revision: WorldAuthorityRevisionV1 {
                epoch: 2,
                mutation: 14,
                residency: 4,
            },
            world_state_hash: CanonicalHash([0x63; 16]),
            player_id: PlayerId::new(7, 3),
            player_entity_id: EntityId::new(9, 4),
            inventory: IntegratedRuntimeNativePlayerDropInventoryDeltaV1 {
                container: ContainerKey::player("actor:native-player-drop"),
                selected_slot: 2,
                before_revision: 12,
                after_revision: 13,
                before_stack: Some(stack.clone()),
                after_stack: Some(ItemStack {
                    count: 1,
                    ..stack.clone()
                }),
            },
            drop: IntegratedRuntimeNativePlayerDropSpawnV1 {
                drop_id: "drop:41:6".into(),
                entity_id: EntityId::new(10, 4),
                stack: ItemStack { count: 1, ..stack },
                custody_container: ContainerKey {
                    kind: ContainerKind::Container,
                    id: "drop-custody:41:6".into(),
                    owner_id: None,
                },
                custody_slot: 0,
                custody_revision: 0,
                spatial_revision: 0,
                position: FixedWorldVec3V1 {
                    x_milli: -1_250,
                    y_milli: 65_750,
                    z_milli: 2_500,
                },
                velocity_milli_per_second: FixedWorldVec3V1 {
                    x_milli: -350,
                    y_milli: 1_250,
                    z_milli: 75,
                },
                rotation: RotationMicroturnsV1 {
                    yaw: 875_000,
                    pitch: 125_000,
                    roll: 0,
                },
                created_tick: 8,
                expires_tick: None,
                pickup_lock_actor_id: None,
                pickup_unlock_tick: 15,
                origin_hash: CanonicalHash::default(),
            },
            authority: IntegratedRuntimeNativeDropPickupAuthorityEvidenceV1 {
                before_gameplay_revision: GameplayRevision {
                    epoch: 3,
                    sequence: 30,
                    inventory: 20,
                    machines: 4,
                    combat: 5,
                    progression: 6,
                    cardforge: 7,
                },
                before_gameplay_hash: CanonicalHash([0x64; 16]),
                after_gameplay_revision: GameplayRevision {
                    epoch: 3,
                    sequence: 31,
                    inventory: 21,
                    machines: 4,
                    combat: 5,
                    progression: 6,
                    cardforge: 7,
                },
                after_gameplay_hash: CanonicalHash([0x65; 16]),
                before_entity_revision: 22,
                before_entity_hash: CanonicalHash([0x66; 16]),
                after_entity_revision: 23,
                after_entity_hash: CanonicalHash([0x67; 16]),
                before_world_view_revision: WorldViewRevisionV1 {
                    epoch: 4,
                    sequence: 40,
                    clock: 41,
                    machine_anchors: 42,
                    dropped_items: 43,
                    player_bindings: 44,
                    environment: 45,
                    atmosphere_gravity: 46,
                    celestial: 47,
                },
                before_world_view_hash: CanonicalHash([0x68; 16]),
                after_world_view_revision: WorldViewRevisionV1 {
                    epoch: 4,
                    sequence: 41,
                    clock: 41,
                    machine_anchors: 42,
                    dropped_items: 44,
                    player_bindings: 44,
                    environment: 45,
                    atmosphere_gravity: 46,
                    celestial: 47,
                },
                after_world_view_hash: CanonicalHash([0x69; 16]),
            },
            content: IntegratedRuntimeNativePlayerDropContentBindingV1 {
                configured_manifest_hash: CanonicalHash([0x71; 16]),
                installed_manifest_hash: CanonicalHash([0x71; 16]),
                installed_registry_hash: CanonicalHash([0x72; 16]),
                item_content_hash: CanonicalHash([0x73; 16]),
                item_content_version: 11,
            },
            receipt_hash: CanonicalHash::default(),
        };
        receipt.drop.origin_hash = receipt.calculate_origin_hash_v1();
        receipt.receipt_hash = receipt.calculate_hash_v1();
        RuntimeNativePlayerDropProjectionReceiptWireV1 {
            request_payload_hash: CanonicalHash([0x74; 16]),
            identity,
            cursor_after: receipt.sequence,
            receipt: Some(receipt),
        }
    }

    #[test]
    fn camera_config_wire_is_absolute_exact_and_hash_attested() {
        let config = RuntimeCameraConfigWireV1 {
            expected_camera_revision: 7,
            mode: CameraModeV1::ThirdRear,
            profile: camera_profile_fixture_v1(),
        };
        let bytes = encode_runtime_camera_config_v1(&config).unwrap();
        assert_eq!(&bytes[..8], b"BWC5\x01\0\x01\0");
        assert_eq!(bytes, fixture_hex_v1("camera-config-bwc5-third-rear"));
        assert_eq!(decode_runtime_camera_config_v1(&bytes).unwrap(), config);

        let receipt = RuntimeCameraConfigReceiptWireV1 {
            request_payload_hash: CanonicalHash(wire_checksum_v1(&bytes)),
            previous_camera_revision: 7,
            resulting_camera_revision: 8,
            mode: config.mode,
            profile: config.profile,
            camera_state_hash: runtime_camera_config_state_hash_v1(8, config.mode, config.profile),
        };
        let receipt_bytes = encode_runtime_camera_config_receipt_v1(&receipt).unwrap();
        assert_eq!(&receipt_bytes[..8], b"BWR5\x01\0\x01\0");
        assert_eq!(receipt_bytes, fixture_hex_v1("camera-config-receipt-bwr5-changed"));
        assert_eq!(
            decode_runtime_camera_config_receipt_v1(&receipt_bytes).unwrap(),
            receipt
        );

        let idempotent = RuntimeCameraConfigReceiptWireV1 {
            previous_camera_revision: 8,
            ..receipt
        };
        assert_eq!(
            decode_runtime_camera_config_receipt_v1(&encode_runtime_camera_config_receipt_v1(&idempotent).unwrap())
                .unwrap(),
            idempotent
        );
    }

    #[test]
    fn camera_config_wire_rejects_malformed_revision_profile_hash_and_trailing_bytes() {
        let config = RuntimeCameraConfigWireV1 {
            expected_camera_revision: MAX_SAFE_U64 + 1,
            mode: CameraModeV1::FirstPerson,
            profile: camera_profile_fixture_v1(),
        };
        assert_eq!(
            encode_runtime_camera_config_v1(&config).unwrap_err().code,
            "camera-revision"
        );
        let config = RuntimeCameraConfigWireV1 {
            expected_camera_revision: 0,
            mode: CameraModeV1::FirstPerson,
            profile: CameraProfileV1 {
                far: 0.01,
                ..camera_profile_fixture_v1()
            },
        };
        assert_eq!(
            encode_runtime_camera_config_v1(&config).unwrap_err().code,
            "camera-profile"
        );

        let config = RuntimeCameraConfigWireV1 {
            expected_camera_revision: 1,
            mode: CameraModeV1::FirstPerson,
            profile: camera_profile_fixture_v1(),
        };
        let mut unknown_mode = encode_runtime_camera_config_v1(&config).unwrap();
        unknown_mode[DOMAIN_HEADER_BYTES + 8] = u8::MAX;
        let checksum = wire_checksum_v1(&unknown_mode[DOMAIN_HEADER_BYTES..]);
        unknown_mode[12..28].copy_from_slice(&checksum);
        assert_eq!(
            decode_runtime_camera_config_v1(&unknown_mode).unwrap_err().code,
            "camera-mode"
        );

        let mut unsafe_revision = encode_runtime_camera_config_v1(&config).unwrap();
        unsafe_revision[DOMAIN_HEADER_BYTES..DOMAIN_HEADER_BYTES + 8]
            .copy_from_slice(&(MAX_SAFE_U64 + 1).to_le_bytes());
        let checksum = wire_checksum_v1(&unsafe_revision[DOMAIN_HEADER_BYTES..]);
        unsafe_revision[12..28].copy_from_slice(&checksum);
        assert_eq!(
            decode_runtime_camera_config_v1(&unsafe_revision).unwrap_err().code,
            "camera-revision"
        );

        let mut trailing = encode_runtime_camera_config_v1(&config).unwrap();
        trailing.push(0xaa);
        let body_length = (trailing.len() - DOMAIN_HEADER_BYTES) as u32;
        trailing[8..12].copy_from_slice(&body_length.to_le_bytes());
        let checksum = wire_checksum_v1(&trailing[DOMAIN_HEADER_BYTES..]);
        trailing[12..28].copy_from_slice(&checksum);
        assert_eq!(
            decode_runtime_camera_config_v1(&trailing).unwrap_err().code,
            "domain-trailing"
        );

        let invalid = RuntimeCameraConfigReceiptWireV1 {
            request_payload_hash: CanonicalHash::default(),
            previous_camera_revision: 1,
            resulting_camera_revision: 3,
            mode: config.mode,
            profile: config.profile,
            camera_state_hash: runtime_camera_config_state_hash_v1(3, config.mode, config.profile),
        };
        assert_eq!(
            encode_runtime_camera_config_receipt_v1(&invalid).unwrap_err().code,
            "camera-revision"
        );
        let invalid = RuntimeCameraConfigReceiptWireV1 {
            resulting_camera_revision: 2,
            camera_state_hash: CanonicalHash::default(),
            ..invalid
        };
        assert_eq!(
            encode_runtime_camera_config_receipt_v1(&invalid).unwrap_err().code,
            "camera-state-hash"
        );
    }

    #[test]
    fn gameplay_schedule_command_wire_uses_frozen_tag_and_rejects_unknown_tags() {
        let state = blockwild_gameplay::GameplayState::new(WorldKey::new("universe", "surface"), 1);
        let batch = GameplayBatch::new(
            "schedule:8",
            "schedule:8",
            GameplayActor {
                actor_id: "gameplay-scheduler".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            state.identity(),
            vec![GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
                expected_tick: 7,
                to_tick: 8,
                machine_budget: blockwild_gameplay::MAX_SCHEDULE_MACHINE_ADVANCES_V1,
            })],
        );
        let encoded = encode_gameplay_batch_v1(&batch).unwrap();
        assert_eq!(decode_gameplay_batch_v1(&encoded).unwrap(), batch);

        let mut writer = Writer::default();
        writer.u8(u8::MAX);
        let unknown_command = writer.finish();
        let mut reader = Reader::new(&unknown_command);
        assert_eq!(read_gameplay_command(&mut reader).unwrap_err().code, "gameplay-command");
    }

    #[test]
    fn locator_item_wire_uses_frozen_tag9_bwv7_bwx7_and_round_trips_exactly() {
        let inventory = ContainerKey::player("player:locator-wire");
        let expected_stack = ItemStack {
            item_code: 603,
            count: 2,
            durability_millionths: None,
            metadata_hash: CanonicalHash([0x33; 16]),
        };
        let command = InventoryCommand::ConsumeInventoryUnitV1(ConsumeInventoryUnitV1 {
            inventory: inventory.clone(),
            slot: 5,
            expected_container_revision: 9,
            expected_stack: expected_stack.clone(),
        });
        let state = blockwild_gameplay::GameplayState::new(WorldKey::new("universe", "surface"), 1);
        let batch = GameplayBatch::new(
            "locator-wire",
            "locator-wire",
            GameplayActor {
                actor_id: "player:locator-wire".into(),
                player_id: Some(PlayerId::new(7, 1)),
                entity_id: Some(EntityId::new(9, 1)),
                role: ActorRole::Host,
            },
            state.identity(),
            vec![GameplayCommand::Inventory(command)],
        );
        let gameplay_bytes = encode_gameplay_batch_v1(&batch).unwrap();
        assert_eq!(decode_gameplay_batch_v1(&gameplay_bytes).unwrap(), batch);
        assert!(gameplay_bytes.contains(&(INVENTORY_COMMAND_CONSUME_UNIT_V1_TAG as u8)));

        let request = PlayerLocatorItemConsumeWireV1 {
            inventory: inventory.clone(),
            selected_slot: 5,
            expected_inventory_revision: 9,
            expected_stack: expected_stack.clone(),
            purpose: PlayerLocatorItemPurposeV1::SettlementChart,
            locator_result_hash: CanonicalHash([0x55; 16]),
        };
        let request_bytes = encode_player_locator_item_consume_v1(&request).unwrap();
        assert_eq!(&request_bytes[..8], b"BWV7\x01\0\x01\0");
        assert_eq!(decode_player_locator_item_consume_v1(&request_bytes).unwrap(), request);

        let before = state.identity();
        let mut after = before.clone();
        after.revision.sequence = 1;
        after.revision.inventory = 1;
        after.state_hash = CanonicalHash([0x66; 16]);
        let mut consumed_stack = expected_stack.clone();
        consumed_stack.count = 1;
        let mut remaining_stack = expected_stack;
        remaining_stack.count = 1;
        let receipt = PlayerLocatorItemConsumeReceiptWireV1 {
            request_payload_hash: CanonicalHash(wire_checksum_v1(&request_bytes)),
            purpose: request.purpose,
            locator_result_hash: request.locator_result_hash,
            before,
            after,
            accepted_receipt_hash: CanonicalHash([0x77; 16]),
            inventory,
            selected_slot: 5,
            previous_inventory_revision: 9,
            resulting_inventory_revision: 10,
            consumed_stack,
            remaining_stack: Some(remaining_stack),
            inventory_result_hash: CanonicalHash([0x88; 16]),
        };
        let receipt_bytes = encode_player_locator_item_consume_receipt_v1(&receipt).unwrap();
        assert_eq!(&receipt_bytes[..8], b"BWX7\x01\0\x01\0");
        assert_eq!(
            decode_player_locator_item_consume_receipt_v1(&receipt_bytes).unwrap(),
            receipt
        );
    }

    #[test]
    fn locator_item_wire_rejects_zero_result_unknown_purpose_and_bad_receipt_shape() {
        let request = PlayerLocatorItemConsumeWireV1 {
            inventory: ContainerKey::player("player:locator-wire-invalid"),
            selected_slot: 0,
            expected_inventory_revision: 0,
            expected_stack: ItemStack::simple(603, 1),
            purpose: PlayerLocatorItemPurposeV1::DragonLairCharter,
            locator_result_hash: CanonicalHash::default(),
        };
        assert_eq!(
            encode_player_locator_item_consume_v1(&request).unwrap_err().code,
            "player-locator-item-result"
        );
        let mut valid = request;
        valid.locator_result_hash = CanonicalHash([1; 16]);
        let valid_bytes = encode_player_locator_item_consume_v1(&valid).unwrap();
        let mut reader = Reader::new(
            unwrap_schema(
                PLAYER_LOCATOR_ITEM_CONSUME_V1_MAGIC,
                PLAYER_LOCATOR_ITEM_CONSUME_V1_INNER_SCHEMA,
                &valid_bytes,
            )
            .unwrap(),
        );
        read_container_key(&mut reader).unwrap();
        reader.u16().unwrap();
        reader.u64().unwrap();
        read_item_stack(&mut reader).unwrap();
        let purpose_offset = DOMAIN_HEADER_BYTES + reader.offset;
        let mut unknown = valid_bytes;
        unknown[purpose_offset] = u8::MAX;
        let checksum = wire_checksum_v1(&unknown[DOMAIN_HEADER_BYTES..]);
        unknown[12..28].copy_from_slice(&checksum);
        assert_eq!(
            decode_player_locator_item_consume_v1(&unknown).unwrap_err().code,
            "player-locator-item-purpose"
        );
    }

    #[test]
    fn creative_slot_is_dedicated_bwf7_bwh7_and_rejects_generic_wire_or_receipt_tamper() {
        let inventory = ContainerKey::player("player:creative-wire");
        let prior = Some(ItemStack::simple(42, 2));
        let replacement = ItemStack::simple(43, 64);
        let command = InventoryCommand::SetCreativeInventorySlotV1(blockwild_gameplay::SetCreativeInventorySlotV1 {
            inventory: inventory.clone(),
            slot: 3,
            expected_container_revision: 7,
            expected_stack: prior.clone(),
            replacement_stack: replacement.clone(),
        });
        let state = blockwild_gameplay::GameplayState::new(WorldKey::new("universe", "surface"), 1);
        let batch = GameplayBatch::new(
            "creative-slot-wire",
            "creative-slot-wire",
            GameplayActor {
                actor_id: "player:creative-wire".into(),
                player_id: Some(PlayerId::new(7, 1)),
                entity_id: Some(EntityId::new(9, 1)),
                role: ActorRole::Host,
            },
            state.identity(),
            vec![GameplayCommand::Inventory(command)],
        );
        assert_eq!(
            encode_gameplay_batch_v1(&batch).unwrap_err().code,
            "inventory-command-dedicated"
        );
        assert_eq!(
            read_inventory_command(&mut Reader::new(&[INVENTORY_COMMAND_SET_CREATIVE_SLOT_V1_TAG as u8]))
                .unwrap_err()
                .code,
            "inventory-command-dedicated"
        );

        let request = PlayerCreativeSlotSetWireV1 {
            inventory: inventory.clone(),
            selected_slot: 3,
            expected_inventory_revision: 7,
            expected_stack: prior.clone(),
            replacement_stack: replacement.clone(),
        };
        let request_bytes = encode_player_creative_slot_set_v1(&request).unwrap();
        assert_eq!(&request_bytes[..8], b"BWF7\x01\0\x01\0");
        assert_eq!(decode_player_creative_slot_set_v1(&request_bytes).unwrap(), request);

        let before = state.identity();
        let mut after = before.clone();
        after.revision.sequence = 1;
        after.revision.inventory = 1;
        after.state_hash = CanonicalHash([0x62; 16]);
        let mut receipt = PlayerCreativeSlotSetReceiptWireV1 {
            request_payload_hash: CanonicalHash(wire_checksum_v1(&request_bytes)),
            before,
            after,
            accepted_receipt_hash: CanonicalHash([0x73; 16]),
            inventory,
            selected_slot: 3,
            previous_inventory_revision: 7,
            resulting_inventory_revision: 8,
            prior_stack: prior,
            replacement_stack: replacement,
            inventory_result_hash: CanonicalHash([0x84; 16]),
            receipt_hash: CanonicalHash::default(),
        };
        receipt.receipt_hash = player_creative_slot_set_receipt_hash_v1(&receipt).unwrap();
        let receipt_bytes = encode_player_creative_slot_set_receipt_v1(&receipt).unwrap();
        assert_eq!(&receipt_bytes[..8], b"BWH7\x01\0\x01\0");
        assert_eq!(
            decode_player_creative_slot_set_receipt_v1(&receipt_bytes).unwrap(),
            receipt
        );

        let mut tampered = receipt;
        tampered.inventory_result_hash = CanonicalHash([0x85; 16]);
        assert_eq!(
            encode_player_creative_slot_set_receipt_v1(&tampered).unwrap_err().code,
            "player-creative-slot-receipt-hash"
        );
    }

    #[test]
    fn player_game_mode_is_dedicated_bwm7_bwn7_and_seals_one_simulation_transition() {
        let request = PlayerGameModeSetWireV1 {
            external_entity_id: "player:mode-wire:\u{6a21}\u{5f0f}:\u{1f600}".into(),
            actor_id: "actor:mode-wire:\u{6a21}\u{5f0f}:\u{1f600}".into(),
            player_id: PlayerId::new(7, 3),
            expected_creative_mode: true,
            expected_flags: RUNTIME_INPUT_FLAG_CREATIVE_V1 | RUNTIME_INPUT_FLAG_FLYING_V1,
            requested_creative_mode: false,
        };
        let request_bytes = encode_player_game_mode_set_v1(&request).unwrap();
        assert_eq!(&request_bytes[..8], b"BWM7\x01\0\x01\0");
        assert_eq!(decode_player_game_mode_set_v1(&request_bytes).unwrap(), request);
        assert!(decode_gameplay_batch_v1(&request_bytes).is_err());
        let mut overlong = request.clone();
        overlong.external_entity_id = "x".repeat(513);
        assert_eq!(
            encode_player_game_mode_set_v1(&overlong).unwrap_err().code,
            "player-game-mode-custody"
        );
        let mut controlled = request.clone();
        controlled.actor_id = "actor:mode\nwire".into();
        assert_eq!(
            encode_player_game_mode_set_v1(&controlled).unwrap_err().code,
            "domain-string"
        );

        let before = IntegratedRuntimeIdentityV2 {
            schema_version: crate::INTEGRATED_RUNTIME_SCHEMA_V2,
            universe_id: "universe".into(),
            location_id: "surface".into(),
            revision: IntegratedRuntimeRevisionV2 {
                epoch: 2,
                world: 3,
                entities: 4,
                gameplay: 5,
                persistence: 6,
                network: 7,
                simulation: 8,
            },
            tick: 9,
            state_hash: CanonicalHash([0x31; 16]),
        };
        let mut after = before.clone();
        after.revision.simulation = 9;
        after.state_hash = CanonicalHash([0x32; 16]);
        let mut receipt = PlayerGameModeSetReceiptWireV1 {
            request_payload_hash: CanonicalHash(wire_checksum_v1(&request_bytes)),
            before,
            after,
            external_entity_id: request.external_entity_id,
            actor_id: request.actor_id,
            player_id: request.player_id,
            prior_creative_mode: request.expected_creative_mode,
            prior_flags: request.expected_flags,
            resulting_creative_mode: request.requested_creative_mode,
            resulting_flags: 0,
            receipt_hash: CanonicalHash::default(),
        };
        receipt.receipt_hash = player_game_mode_set_receipt_hash_v1(&receipt).unwrap();
        let receipt_bytes = encode_player_game_mode_set_receipt_v1(&receipt).unwrap();
        assert_eq!(&receipt_bytes[..8], b"BWN7\x01\0\x01\0");
        assert_eq!(decode_player_game_mode_set_receipt_v1(&receipt_bytes).unwrap(), receipt);

        let mut tampered = receipt;
        tampered.resulting_flags = RUNTIME_INPUT_FLAG_CREATIVE_V1;
        assert_eq!(
            encode_player_game_mode_set_receipt_v1(&tampered).unwrap_err().code,
            "player-game-mode-flags"
        );
    }

    #[test]
    fn player_respawn_wire_seals_exact_r5_r6_r7_restore_and_inventory_policy() {
        let before = IntegratedRuntimeIdentityV2 {
            schema_version: crate::INTEGRATED_RUNTIME_SCHEMA_V2,
            universe_id: "universe:respawn".into(),
            location_id: "surface".into(),
            revision: IntegratedRuntimeRevisionV2 {
                epoch: 2,
                world: 3,
                entities: 20,
                gameplay: 30,
                persistence: 6,
                network: 7,
                simulation: 40,
            },
            tick: 55,
            state_hash: CanonicalHash([0x41; 16]),
        };
        let request = PlayerRespawnWireV1 {
            expected: before.clone(),
            external_entity_id: "player:respawn:\u{6c34}".into(),
            actor_id: "actor:respawn:\u{6c34}".into(),
            player_id: PlayerId::new(7, 3),
            entity_id: EntityId::new(8, 4),
            expected_entity_revision: 12,
            expected_gameplay_sequence: 28,
            expected_gameplay_combat_revision: 9,
            expected_combatant_revision: 6,
            expected_death_sequence: 3,
            expected_max_health: 20_000,
            respawn_position: FixedWorldVec3V1 {
                x_milli: -12_500,
                y_milli: 64_250,
                z_milli: 8_000,
            },
            keep_inventory: true,
        };
        let request_bytes = encode_player_respawn_v1(&request).unwrap();
        assert_eq!(&request_bytes[..8], b"BWD7\x01\0\x01\0");
        assert_eq!(decode_player_respawn_v1(&request_bytes).unwrap(), request);
        assert!(decode_gameplay_batch_v1(&request_bytes).is_err());

        let mut after = before.clone();
        after.revision.entities += 1;
        after.revision.gameplay += 1;
        after.revision.simulation += 1;
        after.state_hash = CanonicalHash([0x42; 16]);
        let mut receipt = PlayerRespawnReceiptWireV1 {
            request_payload_hash: CanonicalHash(wire_checksum_v1(&request_bytes)),
            before,
            after,
            external_entity_id: request.external_entity_id.clone(),
            actor_id: request.actor_id.clone(),
            player_id: request.player_id,
            entity_id: request.entity_id,
            death_sequence: request.expected_death_sequence,
            prior_entity_revision: request.expected_entity_revision,
            resulting_entity_revision: request.expected_entity_revision + 1,
            prior_gameplay_sequence: request.expected_gameplay_sequence,
            resulting_gameplay_sequence: request.expected_gameplay_sequence + 1,
            prior_gameplay_combat_revision: request.expected_gameplay_combat_revision,
            resulting_gameplay_combat_revision: request.expected_gameplay_combat_revision + 1,
            prior_combatant_revision: request.expected_combatant_revision,
            resulting_combatant_revision: request.expected_combatant_revision + 1,
            maximum_health: request.expected_max_health,
            prior_health: 0,
            resulting_health: request.expected_max_health,
            prior_alive: false,
            resulting_alive: true,
            respawn_position: request.respawn_position,
            resulting_oxygen_seconds: 15.0,
            keep_inventory: true,
            inventory_before_revision: 4,
            inventory_after_revision: 4,
            equipment_before_revision: 2,
            equipment_after_revision: 2,
            custody_before_hash: CanonicalHash([0x43; 16]),
            custody_after_hash: CanonicalHash([0x43; 16]),
            generated_drop_count: 0,
            receipt_hash: CanonicalHash::default(),
        };
        receipt.receipt_hash = player_respawn_receipt_hash_v1(&receipt).unwrap();
        let receipt_bytes = encode_player_respawn_receipt_v1(&receipt).unwrap();
        assert_eq!(&receipt_bytes[..8], b"BWE7\x01\0\x01\0");
        assert_eq!(decode_player_respawn_receipt_v1(&receipt_bytes).unwrap(), receipt);

        let mut stale = request.clone();
        stale.respawn_position.x_milli = i64::MIN;
        assert_eq!(
            encode_player_respawn_v1(&stale).unwrap_err().code,
            "player-respawn-position"
        );
        let mut tampered = receipt.clone();
        tampered.inventory_after_revision += 1;
        assert_eq!(
            encode_player_respawn_receipt_v1(&tampered).unwrap_err().code,
            "player-respawn-inventory-policy"
        );

        let seal_receipt = |value: &mut PlayerRespawnReceiptWireV1| {
            let request = PlayerRespawnWireV1 {
                expected: value.before.clone(),
                external_entity_id: value.external_entity_id.clone(),
                actor_id: value.actor_id.clone(),
                player_id: value.player_id,
                entity_id: value.entity_id,
                expected_entity_revision: value.prior_entity_revision,
                expected_gameplay_sequence: value.prior_gameplay_sequence,
                expected_gameplay_combat_revision: value.prior_gameplay_combat_revision,
                expected_combatant_revision: value.prior_combatant_revision,
                expected_death_sequence: value.death_sequence,
                expected_max_health: value.maximum_health,
                respawn_position: value.respawn_position,
                keep_inventory: value.keep_inventory,
            };
            value.request_payload_hash = CanonicalHash(wire_checksum_v1(&encode_player_respawn_v1(&request).unwrap()));
            value.receipt_hash = CanonicalHash::default();
            value.receipt_hash = player_respawn_receipt_hash_v1(value).unwrap();
        };

        let mut empty_drop = receipt.clone();
        empty_drop.keep_inventory = false;
        seal_receipt(&mut empty_drop);
        let empty_drop_bytes = encode_player_respawn_receipt_v1(&empty_drop).unwrap();
        assert_eq!(&empty_drop_bytes[..8], b"BWE7\x01\0\x01\0");
        assert_eq!(decode_player_respawn_receipt_v1(&empty_drop_bytes).unwrap(), empty_drop);

        let mut inventory_only = empty_drop.clone();
        inventory_only.after.revision.gameplay += 1;
        inventory_only.inventory_after_revision += 1;
        inventory_only.custody_after_hash = CanonicalHash([0x44; 16]);
        inventory_only.generated_drop_count = 9;
        seal_receipt(&mut inventory_only);
        let inventory_only_bytes = encode_player_respawn_receipt_v1(&inventory_only).unwrap();
        assert_eq!(
            decode_player_respawn_receipt_v1(&inventory_only_bytes).unwrap(),
            inventory_only
        );

        let mut equipment_only = empty_drop.clone();
        equipment_only.after.revision.gameplay += 1;
        equipment_only.equipment_after_revision += 1;
        equipment_only.custody_after_hash = CanonicalHash([0x45; 16]);
        equipment_only.generated_drop_count = 8;
        seal_receipt(&mut equipment_only);
        let equipment_only_bytes = encode_player_respawn_receipt_v1(&equipment_only).unwrap();
        assert_eq!(
            decode_player_respawn_receipt_v1(&equipment_only_bytes).unwrap(),
            equipment_only
        );

        let mut both_lanes = empty_drop.clone();
        both_lanes.after.revision.gameplay += 1;
        both_lanes.inventory_after_revision += 1;
        both_lanes.equipment_after_revision += 1;
        both_lanes.custody_after_hash = CanonicalHash([0x46; 16]);
        both_lanes.generated_drop_count = 17;
        seal_receipt(&mut both_lanes);
        let both_lanes_bytes = encode_player_respawn_receipt_v1(&both_lanes).unwrap();
        assert_eq!(decode_player_respawn_receipt_v1(&both_lanes_bytes).unwrap(), both_lanes);

        let mut bad_integrated_delta = inventory_only.clone();
        bad_integrated_delta.after.revision.gameplay -= 1;
        seal_receipt(&mut bad_integrated_delta);
        assert_eq!(
            encode_player_respawn_receipt_v1(&bad_integrated_delta)
                .unwrap_err()
                .code,
            "player-respawn-identity"
        );

        let mut bad_empty_delta = empty_drop.clone();
        bad_empty_delta.after.revision.gameplay += 1;
        seal_receipt(&mut bad_empty_delta);
        assert_eq!(
            encode_player_respawn_receipt_v1(&bad_empty_delta).unwrap_err().code,
            "player-respawn-identity"
        );

        let mut bad_empty_lane_delta = empty_drop.clone();
        bad_empty_lane_delta.inventory_after_revision += 1;
        seal_receipt(&mut bad_empty_lane_delta);
        assert_eq!(
            encode_player_respawn_receipt_v1(&bad_empty_lane_delta)
                .unwrap_err()
                .code,
            "player-respawn-inventory-policy"
        );

        let mut bad_empty_custody_hash = empty_drop.clone();
        bad_empty_custody_hash.custody_after_hash = CanonicalHash([0x47; 16]);
        seal_receipt(&mut bad_empty_custody_hash);
        assert_eq!(
            encode_player_respawn_receipt_v1(&bad_empty_custody_hash)
                .unwrap_err()
                .code,
            "player-respawn-inventory-policy"
        );

        let mut bad_lane_delta = inventory_only.clone();
        bad_lane_delta.inventory_after_revision += 1;
        seal_receipt(&mut bad_lane_delta);
        assert_eq!(
            encode_player_respawn_receipt_v1(&bad_lane_delta).unwrap_err().code,
            "player-respawn-inventory-policy"
        );

        let mut bad_stable_lanes = inventory_only.clone();
        bad_stable_lanes.inventory_after_revision = bad_stable_lanes.inventory_before_revision;
        seal_receipt(&mut bad_stable_lanes);
        assert_eq!(
            encode_player_respawn_receipt_v1(&bad_stable_lanes).unwrap_err().code,
            "player-respawn-inventory-policy"
        );

        let mut bad_custody_hash = inventory_only.clone();
        bad_custody_hash.custody_after_hash = bad_custody_hash.custody_before_hash;
        seal_receipt(&mut bad_custody_hash);
        assert_eq!(
            encode_player_respawn_receipt_v1(&bad_custody_hash).unwrap_err().code,
            "player-respawn-inventory-policy"
        );

        let mut bad_drop_count = both_lanes;
        bad_drop_count.generated_drop_count = 18;
        seal_receipt(&mut bad_drop_count);
        assert_eq!(
            encode_player_respawn_receipt_v1(&bad_drop_count).unwrap_err().code,
            "player-respawn-inventory-policy"
        );
    }

    #[test]
    fn linked_combat_wire_preserves_high_u64_unicode_and_every_system_transition() {
        let state = blockwild_gameplay::GameplayState::new(WorldKey::new("universe", "surface"), 1);
        let entity_id = EntityId::new(u32::MAX - 1, u32::MAX);
        let batch = GameplayBatch::new(
            "combat:水",
            "combat:key:🏹",
            GameplayActor {
                actor_id: "gameplay-scheduler:水".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            state.identity(),
            vec![
                GameplayCommand::Combat(CombatCommand::UseLinkedProjectile {
                    source_id: "source:水".into(),
                    expected_source_revision: MAX_SAFE_U64,
                    target_id: "target:🐉".into(),
                    expected_target_revision: MAX_SAFE_U64 - 1,
                    ability_id: "ability:水".into(),
                    projectile_id: "projectile:🏹".into(),
                    entity_id,
                    content_domain: ContentDomain::Item,
                    content_id: "202".into(),
                    presentation_id: "projectile:水".into(),
                    aim: FixedVec3 {
                        x_milli: i32::MAX,
                        y_milli: i32::MIN,
                        z_milli: -1,
                    },
                    tick: MAX_SAFE_U64,
                }),
                GameplayCommand::Combat(CombatCommand::AdvanceLinkedProjectile {
                    projectile_id: "projectile:🏹".into(),
                    expected_revision: MAX_SAFE_U64 - 2,
                    position: FixedVec3 {
                        x_milli: -1,
                        y_milli: 0,
                        z_milli: 1,
                    },
                    tick: MAX_SAFE_U64,
                }),
                GameplayCommand::Combat(CombatCommand::ResolveLinkedProjectile {
                    projectile_id: "projectile:🏹".into(),
                    expected_revision: MAX_SAFE_U64 - 1,
                    target_id: Some("target:🐉".into()),
                    impact: FixedVec3::default(),
                    tick: MAX_SAFE_U64,
                }),
                GameplayCommand::Combat(CombatCommand::SummonLinked {
                    source_id: "source:水".into(),
                    summon_id: "summon:🐉".into(),
                    entity_id: EntityId::new(u32::MAX - 2, u32::MAX),
                    content_domain: ContentDomain::CreatureProfile,
                    content_id: "asterjaw".into(),
                    presentation_id: "summon:asterjaw:水".into(),
                    position: FixedVec3::default(),
                    duration_ticks: Some(u32::MAX),
                    grounding_item_code: Some(u32::MAX),
                    tick: MAX_SAFE_U64,
                }),
            ],
        );
        let encoded = encode_gameplay_batch_v1(&batch).unwrap();
        assert_eq!(decode_gameplay_batch_v1(&encoded).unwrap(), batch);
        let mut corrupt = encoded;
        corrupt.push(0xff);
        assert!(decode_gameplay_batch_v1(&corrupt).is_err());
    }

    #[test]
    fn player_inventory_import_wire_round_trips_and_enforces_bounds() {
        let mut metadata = ItemInstanceMetadataV1 {
            hash: CanonicalHash::default(),
            type_id: "legacy-item-instance".into(),
            schema_id: "legacy-item-instance-v1".into(),
            schema_version: 1,
            content_version: 3,
            canonical_json_bytes: br#"{"name":"Explorer's Compass"}"#.to_vec(),
            unknown_extension_bytes: vec![0, 0x80, 0xff],
        };
        metadata.hash = metadata.calculate_hash();
        let mut slots = vec![None; PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1];
        slots[0] = Some(ItemStack {
            item_code: 17,
            count: 2,
            durability_millionths: Some(750_000),
            metadata_hash: metadata.hash,
        });
        let command = InventoryCommand::ImportPlayerInventoryV1(ImportPlayerInventoryV1 {
            inventory: ContainerKey::player("player:inventory-wire"),
            expected_revision: 0,
            slots,
            metadata: vec![metadata],
        });
        let state = blockwild_gameplay::GameplayState::new(WorldKey::new("universe", "surface"), 1);
        let batch = GameplayBatch::new(
            "inventory-import:1",
            "inventory-import:1",
            GameplayActor {
                actor_id: "inventory-migrator".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            state.identity(),
            vec![GameplayCommand::Inventory(command)],
        );
        let encoded = encode_gameplay_batch_v1(&batch).unwrap();
        assert_eq!(decode_gameplay_batch_v1(&encoded).unwrap(), batch);

        let mut over_bound = batch;
        let GameplayCommand::Inventory(InventoryCommand::ImportPlayerInventoryV1(command)) =
            &mut over_bound.commands[0]
        else {
            unreachable!("fixture contains the import command")
        };
        command.slots.push(None);
        assert_eq!(encode_gameplay_batch_v1(&over_bound).unwrap_err().code, "domain-count");
    }

    #[test]
    fn block_action_inventory_command_wire_round_trips_exactly() {
        let command = InventoryCommand::ApplyBlockActionV1(ApplyBlockActionV1 {
            inventory: ContainerKey::player("player:block-action-wire"),
            slot: 8,
            expected_container_revision: u64::MAX,
            expected_stack: Some(ItemStack {
                item_code: 17,
                count: 1,
                durability_millionths: Some(750_000),
                metadata_hash: CanonicalHash([0x80; 16]),
            }),
            consume_count: 0,
            durability_cost_millionths: 25_000,
            created_stack: Some(ItemStack::simple(19, 2)),
            reason: "block-break-wire".into(),
        });
        let state = blockwild_gameplay::GameplayState::new(WorldKey::new("universe", "surface"), 1);
        let batch = GameplayBatch::new(
            "block-action:1",
            "block-action:1",
            GameplayActor {
                actor_id: "player:block-action-wire".into(),
                player_id: Some(PlayerId::new(1, 1)),
                entity_id: Some(EntityId::new(2, 1)),
                role: ActorRole::Host,
            },
            state.identity(),
            vec![GameplayCommand::Inventory(command)],
        );
        let encoded = encode_gameplay_batch_v1(&batch).unwrap();
        assert_eq!(decode_gameplay_batch_v1(&encoded).unwrap(), batch);
    }

    #[test]
    fn generated_drop_custody_inventory_command_wire_preserves_provenance_and_request_hash() {
        let provenance = GeneratedDropProvenanceV1 {
            schema_version: blockwild_gameplay::BLOCK_ACTION_GENERATED_DROP_PROVENANCE_SCHEMA_VERSION_V1,
            manifest_hash: CanonicalHash([1; 16]),
            installed_registry_hash: CanonicalHash([2; 16]),
            catalog_blob_hash: CanonicalHash([3; 16]),
            action_report_hash: CanonicalHash([4; 16]),
            rng_semantics_hash: CanonicalHash([5; 16]),
            block_action_sequence: u64::MAX,
            origin_input_sequence: MAX_SAFE_U64,
            block_id: u16::MAX,
            position: BlockActionLootCellV1 {
                x: i32::MIN,
                y: 319,
                z: i32::MAX,
            },
            loot_plan_hash: CanonicalHash([6; 16]),
            group_ordinal: 3,
        };
        let command = CreateGeneratedDropCustodyV1::new(
            ContainerKey {
                kind: ContainerKind::Container,
                id: provenance.custody_id_v1(),
                owner_id: None,
            },
            ItemStack {
                item_code: u32::MAX,
                count: 64,
                durability_millionths: Some(1_000_000),
                metadata_hash: CanonicalHash([0x80; 16]),
            },
            provenance,
        );
        let state = blockwild_gameplay::GameplayState::new(WorldKey::new("universe", "surface"), 1);
        let batch = GameplayBatch::new(
            "generated-drop:1",
            "generated-drop:1",
            GameplayActor {
                actor_id: "block-action-authority".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            state.identity(),
            vec![GameplayCommand::Inventory(
                InventoryCommand::CreateGeneratedDropCustodyV1(command),
            )],
        );
        let encoded = encode_gameplay_batch_v1(&batch).unwrap();
        assert_eq!(decode_gameplay_batch_v1(&encoded).unwrap(), batch);
    }

    #[test]
    fn context_continuity_v2_wire_is_narrow_safe_and_terminal_cursor_exact() {
        let identity = IntegratedRuntimeIdentityV2 {
            schema_version: crate::INTEGRATED_RUNTIME_SCHEMA_V2,
            universe_id: "universe:\u{6c34}".into(),
            location_id: "surface".into(),
            revision: IntegratedRuntimeRevisionV2 {
                epoch: MAX_SAFE_U64,
                world: MAX_SAFE_U64 - 1,
                entities: 3,
                gameplay: 4,
                persistence: 5,
                network: 6,
                simulation: 7,
            },
            tick: MAX_SAFE_U64 - 2,
            state_hash: CanonicalHash([0xab; 16]),
        };
        let query = RuntimeContextCommandContinuityQueryWireV2 {
            expected: identity.clone(),
        };
        let encoded_query = encode_runtime_context_command_continuity_query_v2(&query).unwrap();
        assert_eq!(&encoded_query[..4], b"BWS6");
        assert_eq!(
            encoded_query
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            "42575336010002006d000000a7ca767bd713f3caf8045bb005c23c8502000c000000756e6976657273653ae6b0b40700000073757266616365ffffffffffff1f00feffffffffff1f0003000000000000000400000000000000050000000000000006000000000000000700000000000000fdffffffffff1f00abababababababababababababababab"
        );
        assert_eq!(
            decode_runtime_context_command_continuity_query_v2(&encoded_query).unwrap(),
            query
        );

        let receipt = RuntimeContextCommandContinuityReceiptWireV2 {
            request_payload_hash: CanonicalHash([0xcd; 16]),
            identity,
            last_sequence: Some(MAX_SAFE_U64),
            next_sequence: None,
            queued_commands_empty: true,
        };
        let encoded_receipt = encode_runtime_context_command_continuity_receipt_v2(&receipt).unwrap();
        assert_eq!(&encoded_receipt[..4], b"BWO6");
        assert_eq!(
            encoded_receipt
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            "42574f360100020088000000e97f975e578f8aa4d81b3bf9853fa17ecdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd02000c000000756e6976657273653ae6b0b40700000073757266616365ffffffffffff1f00feffffffffff1f0003000000000000000400000000000000050000000000000006000000000000000700000000000000fdffffffffff1f00abababababababababababababababab01ffffffffffff1f000001"
        );
        assert_eq!(
            decode_runtime_context_command_continuity_receipt_v2(&encoded_receipt).unwrap(),
            receipt
        );

        let mut unsafe_identity = query;
        unsafe_identity.expected.tick = MAX_SAFE_U64 + 1;
        assert_eq!(
            encode_runtime_context_command_continuity_query_v2(&unsafe_identity)
                .unwrap_err()
                .code,
            "context-continuity-u64"
        );
        let unsafe_cursor = RuntimeContextCommandContinuityReceiptWireV2 {
            last_sequence: Some(MAX_SAFE_U64 + 1),
            next_sequence: None,
            ..receipt
        };
        assert_eq!(
            encode_runtime_context_command_continuity_receipt_v2(&unsafe_cursor)
                .unwrap_err()
                .code,
            "context-continuity-cursor"
        );
    }

    #[test]
    fn basic_dirt_projection_wire_round_trips_every_native_and_spatial_field() {
        let receipt = basic_dirt_projection_fixture_v1();
        let query = RuntimeBasicDirtActionReceiptQueryWireV1 {
            expected: receipt.identity.clone(),
            after_sequence: receipt.cursor_after - 1,
        };
        let query_bytes = encode_runtime_basic_dirt_action_receipt_query_v1(&query).unwrap();
        assert_eq!(&query_bytes[..8], b"BWQ7\x01\0\x01\0");
        assert_eq!(
            decode_runtime_basic_dirt_action_receipt_query_v1(&query_bytes).unwrap(),
            query
        );

        let bytes = encode_runtime_basic_dirt_action_projection_receipt_v1(&receipt).unwrap();
        assert_eq!(&bytes[..8], b"BWR7\x01\0\x01\0");
        assert!(bytes.len() < MAX_DOMAIN_PAYLOAD_BYTES);
        let decoded = decode_runtime_basic_dirt_action_projection_receipt_v1(&bytes).unwrap();
        assert_eq!(decoded, receipt);
        let projected = decoded.receipt.unwrap();
        assert_eq!(projected.native_receipt_v1().receipt_hash, projected.receipt_hash);
        assert_eq!(projected.generated_drops[0].entity_id, EntityId::new(7, 3));
        assert_eq!(
            projected.generated_drops[0].stack.metadata_hash,
            CanonicalHash([0x52; 16])
        );
        assert_eq!(projected.generated_drops[0].position.y_milli, 43_500);
        assert_eq!(projected.generated_drops[0].velocity_milli_per_second.z_milli, -75);
        assert_eq!(projected.generated_drops[0].rotation.yaw, 750_000);

        let empty = RuntimeBasicDirtActionProjectionReceiptWireV1 {
            request_payload_hash: CanonicalHash([0x61; 16]),
            identity: query.expected,
            cursor_after: MAX_SAFE_U64,
            receipt: None,
        };
        assert_eq!(
            decode_runtime_basic_dirt_action_projection_receipt_v1(
                &encode_runtime_basic_dirt_action_projection_receipt_v1(&empty).unwrap()
            )
            .unwrap(),
            empty
        );
    }

    #[test]
    fn native_block_edit_projection_wire_round_trips_full_generated_evidence_and_rejects_tamper() {
        let projection = native_block_edit_projection_fixture_v1();
        let query = RuntimeNativeBlockEditReceiptQueryWireV1 {
            expected: projection.identity.clone(),
            after_sequence: projection.cursor_after - 1,
        };
        let query_bytes = encode_runtime_native_block_edit_receipt_query_v1(&query).unwrap();
        assert_eq!(&query_bytes[..8], b"BWZ7\x01\0\x01\0");
        assert_eq!(
            decode_runtime_native_block_edit_receipt_query_v1(&query_bytes).unwrap(),
            query
        );

        let bytes = encode_runtime_native_block_edit_projection_receipt_v1(&projection).unwrap();
        assert_eq!(&bytes[..8], b"BWY7\x01\0\x01\0");
        assert!(bytes.len() < MAX_DOMAIN_PAYLOAD_BYTES);
        let decoded = decode_runtime_native_block_edit_projection_receipt_v1(&bytes).unwrap();
        assert_eq!(decoded, projection);
        let generated = &decoded.receipt.as_ref().unwrap().generated_drops[0];
        assert_eq!(generated.provenance.block_action_sequence, u64::MAX - 3);
        assert_eq!(generated.stack.count, 3);
        assert_eq!(
            (
                generated.position,
                generated.velocity_milli_per_second,
                generated.rotation
            ),
            crate::runtime::generated_drop_transform_v9(&generated.provenance)
        );

        assert_eq!(
            encode_runtime_native_block_edit_receipt_query_v1(&RuntimeNativeBlockEditReceiptQueryWireV1 {
                expected: projection.identity.clone(),
                after_sequence: MAX_SAFE_U64 + 1,
            })
            .unwrap_err()
            .code,
            "native-block-edit-query-cursor"
        );
        let mut bad_cursor = projection.clone();
        bad_cursor.cursor_after += 1;
        assert_eq!(
            encode_runtime_native_block_edit_projection_receipt_v1(&bad_cursor)
                .unwrap_err()
                .code,
            "native-block-edit-projection-cursor"
        );
        let mut bad_facing = projection.clone();
        let native = bad_facing.receipt.as_mut().unwrap();
        native.prior_facing = 4;
        native.receipt_hash = native.calculate_hash_v1();
        assert_eq!(
            encode_runtime_native_block_edit_projection_receipt_v1(&bad_facing)
                .unwrap_err()
                .code,
            "native-block-edit-receipt"
        );
        let mut aliased_mutation = projection.clone();
        let native = aliased_mutation.receipt.as_mut().unwrap();
        native.after_world_revision.mutation += 1;
        native.receipt_hash = native.calculate_hash_v1();
        assert_eq!(
            encode_runtime_native_block_edit_projection_receipt_v1(&aliased_mutation)
                .unwrap_err()
                .code,
            "native-block-edit-receipt"
        );
        let mut tampered = bytes;
        *tampered.last_mut().unwrap() ^= 1;
        let checksum = wire_checksum_v1(&tampered[DOMAIN_HEADER_BYTES..]);
        tampered[12..28].copy_from_slice(&checksum);
        assert_eq!(
            decode_runtime_native_block_edit_projection_receipt_v1(&tampered)
                .unwrap_err()
                .code,
            "native-block-edit-receipt"
        );

        let empty = RuntimeNativeBlockEditProjectionReceiptWireV1 {
            request_payload_hash: CanonicalHash([0x71; 16]),
            identity: query.expected,
            cursor_after: MAX_SAFE_U64,
            receipt: None,
        };
        assert_eq!(
            decode_runtime_native_block_edit_projection_receipt_v1(
                &encode_runtime_native_block_edit_projection_receipt_v1(&empty).unwrap()
            )
            .unwrap(),
            empty
        );
    }

    #[test]
    fn native_block_edit_v2_wire_round_trips_present_empty_dirty_evidence_and_legacy_gap() {
        let projection = native_block_edit_projection_fixture_v2();
        let query = RuntimeNativeBlockEditReceiptQueryWireV2 {
            expected: projection.identity.clone(),
            after_sequence: projection.cursor_after - 1,
        };
        let query_bytes = encode_runtime_native_block_edit_receipt_query_v2(&query).unwrap();
        assert_eq!(&query_bytes[..8], b"BWZ8\x01\0\x01\0");
        assert_eq!(
            decode_runtime_native_block_edit_receipt_query_v2(&query_bytes).unwrap(),
            query
        );

        let bytes = encode_runtime_native_block_edit_projection_receipt_v2(&projection).unwrap();
        assert_eq!(&bytes[..8], b"BWY8\x01\0\x01\0");
        assert_eq!(bytes.len(), 822);
        let decoded = decode_runtime_native_block_edit_projection_receipt_v2(&bytes).unwrap();
        assert_eq!(decoded, projection);
        let evidence = decoded.dirty_evidence.as_ref().unwrap();
        assert!(evidence.sections.is_empty());
        assert!(evidence.columns.is_empty());
        assert!(evidence.subsystem_seeds.is_empty());
        assert_eq!(
            evidence.evidence_hash,
            CanonicalHash([
                0x5a, 0xe8, 0xa3, 0x38, 0x3d, 0xf4, 0xd3, 0xfc, 0xc8, 0x3a, 0x57, 0x1e, 0x90, 0x7d, 0x25, 0x03,
            ])
        );

        let mut legacy = projection.clone();
        legacy.dirty_evidence = None;
        assert_eq!(
            decode_runtime_native_block_edit_projection_receipt_v2(
                &encode_runtime_native_block_edit_projection_receipt_v2(&legacy).unwrap()
            )
            .unwrap(),
            legacy
        );
        let mut orphan = legacy.clone();
        orphan.receipt = None;
        orphan.dirty_evidence = projection.dirty_evidence.clone();
        assert_eq!(
            encode_runtime_native_block_edit_projection_receipt_v2(&orphan)
                .unwrap_err()
                .code,
            "native-block-edit-v2-dirty-orphan"
        );

        let mut tampered_shape = projection.clone();
        tampered_shape.dirty_evidence.as_mut().unwrap().sequence += 1;
        assert_eq!(
            encode_runtime_native_block_edit_projection_receipt_v2(&tampered_shape)
                .unwrap_err()
                .code,
            "native-block-edit-v2-dirty-evidence"
        );
        let mut tampered_bytes = bytes;
        *tampered_bytes.last_mut().unwrap() ^= 1;
        let checksum = wire_checksum_v1(&tampered_bytes[DOMAIN_HEADER_BYTES..]);
        tampered_bytes[12..28].copy_from_slice(&checksum);
        assert_eq!(
            decode_runtime_native_block_edit_projection_receipt_v2(&tampered_bytes)
                .unwrap_err()
                .code,
            "native-block-edit-v2-dirty-evidence"
        );

        let empty = RuntimeNativeBlockEditProjectionReceiptWireV2 {
            request_payload_hash: CanonicalHash([0x72; 16]),
            identity: query.expected,
            cursor_after: MAX_SAFE_U64,
            receipt: None,
            dirty_evidence: None,
        };
        let empty_bytes = encode_runtime_native_block_edit_projection_receipt_v2(&empty).unwrap();
        assert_eq!(&empty_bytes[empty_bytes.len() - 2..], &[0, 0]);
        assert_eq!(
            decode_runtime_native_block_edit_projection_receipt_v2(&empty_bytes).unwrap(),
            empty
        );
    }

    #[test]
    fn native_drop_pickup_projection_wire_round_trips_every_exact_field() {
        let projection = native_drop_pickup_projection_fixture_v1();
        let native = projection.receipt.as_ref().unwrap();
        native.validate_shape_v1().unwrap();
        let query = RuntimeNativeDropPickupReceiptQueryWireV1 {
            expected: projection.identity.clone(),
            after_sequence: native.sequence - 1,
        };
        let query_bytes = encode_runtime_native_drop_pickup_receipt_query_v1(&query).unwrap();
        assert_eq!(&query_bytes[..8], b"BWQ8\x01\0\x01\0");
        assert_eq!(
            decode_runtime_native_drop_pickup_receipt_query_v1(&query_bytes).unwrap(),
            query
        );

        let bytes = encode_runtime_native_drop_pickup_projection_receipt_v1(&projection).unwrap();
        assert_eq!(&bytes[..8], b"BWR8\x01\0\x01\0");
        assert!(bytes.len() < MAX_DOMAIN_PAYLOAD_BYTES);
        let decoded = decode_runtime_native_drop_pickup_projection_receipt_v1(&bytes).unwrap();
        assert_eq!(decoded, projection);
        let native = decoded.receipt.unwrap();
        assert_eq!(native.affected_slots.len(), 2);
        assert_eq!(native.affected_slots[0].after_stack.as_ref().unwrap().count, 64);
        assert_eq!(native.affected_slots[1].after_stack.as_ref().unwrap().count, 1);
        assert_eq!(native.source.drop_id, "block-loot-v1:9:1");
        assert_eq!(native.source.custody_container.id, "block-loot-custody-v1:9:1");
        assert_eq!(native.source.custody_slot, 0);
        assert_eq!(native.source.position.x_milli, -6_750);
        assert_eq!(native.source.velocity_milli_per_second.x_milli, -125);
        assert_eq!(native.authority.before_gameplay_revision.sequence, 70);
        assert_eq!(native.authority.after_world_view_revision.dropped_items, 84);
        assert_eq!(
            native.receipt_hash,
            CanonicalHash([
                0xf0, 0x45, 0x2e, 0x86, 0x9a, 0x4a, 0x2c, 0xa3, 0x60, 0x25, 0xb4, 0x97, 0xd0, 0xaa, 0xd8, 0x64,
            ])
        );

        let empty = RuntimeNativeDropPickupProjectionReceiptWireV1 {
            request_payload_hash: CanonicalHash([0x61; 16]),
            identity: query.expected,
            cursor_after: MAX_SAFE_U64,
            receipt: None,
        };
        assert_eq!(
            decode_runtime_native_drop_pickup_projection_receipt_v1(
                &encode_runtime_native_drop_pickup_projection_receipt_v1(&empty).unwrap()
            )
            .unwrap(),
            empty
        );

        let mut player_origin = projection;
        let player_receipt = player_origin.receipt.as_mut().unwrap();
        player_receipt.source.origin = IntegratedRuntimeNativeDropPickupOriginV1::PlayerDrop {
            player_drop_sequence: 6,
            player_drop_receipt_hash: CanonicalHash([0xab; 16]),
        };
        player_receipt.receipt_hash = player_receipt.calculate_hash_v1();
        let player_bytes = encode_runtime_native_drop_pickup_projection_receipt_v1(&player_origin).unwrap();
        assert_eq!(&player_bytes[..8], b"BWR8\x01\0\x01\0");
        assert_eq!(
            decode_runtime_native_drop_pickup_projection_receipt_v1(&player_bytes).unwrap(),
            player_origin
        );

        let mut death_origin = player_origin;
        let death_receipt = death_origin.receipt.as_mut().unwrap();
        death_receipt.source.origin = IntegratedRuntimeNativeDropPickupOriginV1::PlayerDeathDrop {
            respawn_sequence: 7,
            respawn_receipt_hash: CanonicalHash([0xac; 16]),
            source_lane: PlayerDeathCustodyLaneV1::Equipment,
            source_slot: 3,
        };
        death_receipt.receipt_hash = death_receipt.calculate_hash_v1();
        let death_bytes = encode_runtime_native_drop_pickup_projection_receipt_v1(&death_origin).unwrap();
        assert_eq!(&death_bytes[..8], b"BWR8\x01\0\x01\0");
        let decoded_death = decode_runtime_native_drop_pickup_projection_receipt_v1(&death_bytes).unwrap();
        assert_eq!(
            decoded_death.receipt.as_ref().unwrap().source.custody_slot,
            death_origin.receipt.as_ref().unwrap().source.custody_slot
        );
        assert_eq!(decoded_death, death_origin);
    }

    #[test]
    fn native_player_drop_projection_wire_round_trips_and_rejects_cursor_origin_and_hash_tamper() {
        let projection = native_player_drop_projection_fixture_v1();
        let native = projection.receipt.as_ref().unwrap();
        native.validate_shape_v1().unwrap();
        assert_eq!(
            native.drop.origin_hash,
            CanonicalHash([
                0xac, 0xc3, 0xc2, 0x6b, 0xf1, 0x40, 0x31, 0xc7, 0xc8, 0x1a, 0xbd, 0xd6, 0x5b, 0x26, 0x47, 0x46,
            ])
        );
        assert_eq!(
            native.receipt_hash,
            CanonicalHash([
                0xa1, 0xbc, 0xe5, 0x13, 0x66, 0xae, 0xae, 0x31, 0x10, 0xdf, 0xa6, 0x18, 0x35, 0x4e, 0x39, 0x45,
            ])
        );
        let query = RuntimeNativePlayerDropReceiptQueryWireV1 {
            expected: projection.identity.clone(),
            after_sequence: native.sequence - 1,
        };
        let query_bytes = encode_runtime_native_player_drop_receipt_query_v1(&query).unwrap();
        assert_eq!(&query_bytes[..8], b"BWQ9\x01\0\x01\0");
        assert_eq!(
            decode_runtime_native_player_drop_receipt_query_v1(&query_bytes).unwrap(),
            query
        );
        let bytes = encode_runtime_native_player_drop_projection_receipt_v1(&projection).unwrap();
        assert_eq!(&bytes[..8], b"BWS9\x01\0\x01\0");
        assert!(bytes.len() < MAX_DOMAIN_PAYLOAD_BYTES);
        assert_eq!(
            decode_runtime_native_player_drop_projection_receipt_v1(&bytes).unwrap(),
            projection
        );

        assert_eq!(
            encode_runtime_native_player_drop_receipt_query_v1(&RuntimeNativePlayerDropReceiptQueryWireV1 {
                expected: projection.identity.clone(),
                after_sequence: MAX_SAFE_U64 + 1,
            })
            .unwrap_err()
            .code,
            "native-player-drop-query-cursor"
        );
        let mut bad_cursor = projection.clone();
        bad_cursor.cursor_after += 1;
        assert_eq!(
            encode_runtime_native_player_drop_projection_receipt_v1(&bad_cursor)
                .unwrap_err()
                .code,
            "native-player-drop-projection-cursor"
        );
        let mut bad_origin = projection.clone();
        bad_origin.receipt.as_mut().unwrap().drop.origin_hash = CanonicalHash([0xee; 16]);
        assert_eq!(
            encode_runtime_native_player_drop_projection_receipt_v1(&bad_origin)
                .unwrap_err()
                .code,
            "native-player-drop-projection-native"
        );
        let mut bad_hash = projection;
        bad_hash.receipt.as_mut().unwrap().receipt_hash = CanonicalHash([0xef; 16]);
        assert_eq!(
            encode_runtime_native_player_drop_projection_receipt_v1(&bad_hash)
                .unwrap_err()
                .code,
            "native-player-drop-projection-native"
        );
    }

    #[test]
    fn native_drop_pickup_projection_wire_rejects_unsafe_cursors_and_tamper() {
        let mut projection = native_drop_pickup_projection_fixture_v1();
        assert_eq!(
            encode_runtime_native_drop_pickup_receipt_query_v1(&RuntimeNativeDropPickupReceiptQueryWireV1 {
                expected: projection.identity.clone(),
                after_sequence: MAX_SAFE_U64 + 1,
            })
            .unwrap_err()
            .code,
            "native-drop-pickup-query-cursor"
        );

        projection.cursor_after += 1;
        assert_eq!(
            encode_runtime_native_drop_pickup_projection_receipt_v1(&projection)
                .unwrap_err()
                .code,
            "native-drop-pickup-projection-cursor"
        );
        projection.cursor_after -= 1;
        projection.receipt.as_mut().unwrap().source.stack.count += 1;
        assert_eq!(
            encode_runtime_native_drop_pickup_projection_receipt_v1(&projection)
                .unwrap_err()
                .code,
            "native-drop-pickup-projection-native"
        );

        let projection = native_drop_pickup_projection_fixture_v1();
        let mut bytes = encode_runtime_native_drop_pickup_projection_receipt_v1(&projection).unwrap();
        *bytes.last_mut().unwrap() ^= 1;
        let checksum = wire_checksum_v1(&bytes[DOMAIN_HEADER_BYTES..]);
        bytes[12..28].copy_from_slice(&checksum);
        assert_eq!(
            decode_runtime_native_drop_pickup_projection_receipt_v1(&bytes)
                .unwrap_err()
                .code,
            "native-drop-pickup-projection-native"
        );
    }

    #[test]
    fn basic_dirt_projection_wire_rejects_unsafe_cursors_tamper_and_bounds() {
        let mut receipt = basic_dirt_projection_fixture_v1();
        assert_eq!(
            encode_runtime_basic_dirt_action_receipt_query_v1(&RuntimeBasicDirtActionReceiptQueryWireV1 {
                expected: receipt.identity.clone(),
                after_sequence: MAX_SAFE_U64 + 1,
            })
            .unwrap_err()
            .code,
            "basic-dirt-action-query-cursor"
        );

        receipt.cursor_after += 1;
        assert_eq!(
            encode_runtime_basic_dirt_action_projection_receipt_v1(&receipt)
                .unwrap_err()
                .code,
            "basic-dirt-action-projection-cursor"
        );
        receipt.cursor_after -= 1;
        receipt.receipt.as_mut().unwrap().receipt_hash = CanonicalHash([0xee; 16]);
        assert_eq!(
            encode_runtime_basic_dirt_action_projection_receipt_v1(&receipt)
                .unwrap_err()
                .code,
            "basic-dirt-action-projection-native"
        );

        let mut receipt = basic_dirt_projection_fixture_v1();
        receipt.receipt.as_mut().unwrap().generated_drops[0].position.x_milli =
            blockwild_gameplay::WORLD_VIEW_COORDINATE_LIMIT_MILLI_V1 + 1;
        assert_eq!(
            encode_runtime_basic_dirt_action_projection_receipt_v1(&receipt)
                .unwrap_err()
                .code,
            "basic-dirt-action-projection-spatial"
        );

        let mut receipt = basic_dirt_projection_fixture_v1();
        receipt.receipt.as_mut().unwrap().generated_drops[0].stack.count = 0;
        assert_eq!(
            encode_runtime_basic_dirt_action_projection_receipt_v1(&receipt)
                .unwrap_err()
                .code,
            "basic-dirt-action-projection-drop"
        );

        let receipt = basic_dirt_projection_fixture_v1();
        let mut bytes = encode_runtime_basic_dirt_action_projection_receipt_v1(&receipt).unwrap();
        let body = unwrap_schema(
            BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_MAGIC,
            BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_INNER_SCHEMA,
            &bytes,
        )
        .unwrap();
        let mut reader = Reader::new(body);
        let _ = reader.hash().unwrap();
        let _ = read_integrated_runtime_identity_v2(&mut reader).unwrap();
        let _ = reader.u64().unwrap();
        assert!(reader.flag().unwrap());
        let _ = reader.u16().unwrap();
        let _ = reader.u64().unwrap();
        let _ = reader.u64().unwrap();
        let _ = reader.u64().unwrap();
        let action_body_offset = reader.offset;
        bytes[DOMAIN_HEADER_BYTES + action_body_offset] = 0xff;
        let checksum = wire_checksum_v1(&bytes[DOMAIN_HEADER_BYTES..]);
        bytes[12..28].copy_from_slice(&checksum);
        assert_eq!(
            decode_runtime_basic_dirt_action_projection_receipt_v1(&bytes)
                .unwrap_err()
                .code,
            "basic-dirt-action-projection-action"
        );

        let mut trailing = encode_runtime_basic_dirt_action_projection_receipt_v1(&receipt).unwrap();
        trailing.push(0xaa);
        let body_length = u32::try_from(trailing.len() - DOMAIN_HEADER_BYTES).unwrap();
        trailing[8..12].copy_from_slice(&body_length.to_le_bytes());
        let checksum = wire_checksum_v1(&trailing[DOMAIN_HEADER_BYTES..]);
        trailing[12..28].copy_from_slice(&checksum);
        assert_eq!(
            decode_runtime_basic_dirt_action_projection_receipt_v1(&trailing)
                .unwrap_err()
                .code,
            "domain-trailing"
        );
    }

    #[test]
    fn dedicated_player_bootstrap_status_wire_preserves_full_u64_and_high_utf8() {
        let query = PlayerBootstrapStatusQueryWireV1 {
            external_entity_id: "player:\u{6c34}".into(),
            actor_id: "actor:\u{6c34}".into(),
            player_id: PlayerId::new(0x89ab_cdef, 0xfedc_ba98),
        };
        let query_bytes = encode_player_bootstrap_status_query_v1(&query).unwrap();
        assert_eq!(
            query_bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "425753350100010023000000561cf3bf7e4449d32832401580cdddef0a000000706c617965723ae6b0b4090000006163746f723ae6b0b4efcdab8998badcfe"
        );
        assert_eq!(decode_player_bootstrap_status_query_v1(&query_bytes).unwrap(), query);
        assert!(query_bytes.iter().any(|byte| *byte >= 0x80));

        let status = PlayerBootstrapStatusWireV1 {
            request_payload_hash: CanonicalHash([0x80; 16]),
            world_authority_revision: WorldAuthorityRevisionV1 {
                epoch: u64::MAX,
                mutation: u64::MAX,
                residency: u64::MAX,
            },
            entity_authority_revision: u64::MAX,
            next_sequence: None,
            tick: u64::MAX,
            last_monotonic_time_us: u64::MAX,
            last_input_sequence: Some(u64::MAX),
            next_input_sequence: None,
            last_action_sequence: Some(u64::MAX - 1),
            next_action_sequence: Some(u64::MAX),
            authoritative_flags: 0b111,
            last_applied_input: Some(RuntimeInputFrameV1 {
                sequence: u64::MAX,
                target_tick: u64::MAX,
                move_x: i16::MIN,
                move_z: i16::MAX,
                look_yaw: -1,
                look_pitch: 1,
                buttons: u32::MAX,
                selected_slot: 8,
                flags: 0b111,
            }),
            queued_inputs_empty: true,
            entity: None,
            runtime_player: None,
            world_view_binding: None,
            custody: None,
        };
        let status_bytes = encode_player_bootstrap_status_v1(&status).unwrap();
        assert_eq!(
            status_bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            "42574f350100010084000000d3289bf01939dc61c83aa8c6b3c7e1c280808080808080808080808080808080ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00ffffffffffffffffffffffffffffffff01ffffffffffffffff0001feffffffffffffff01ffffffffffffffff0701ffffffffffffffffffffffffffffffff0080ff7fffff0100ffffffff080700000100000000"
        );
        assert_eq!(decode_player_bootstrap_status_v1(&status_bytes).unwrap(), status);
        let mut corrupt = status_bytes;
        *corrupt.last_mut().unwrap() ^= 0x80;
        assert_eq!(
            decode_player_bootstrap_status_v1(&corrupt).unwrap_err().code,
            "domain-checksum"
        );
    }

    #[test]
    fn dedicated_player_combat_bootstrap_status_is_additive_and_explicit() {
        let query = PlayerBootstrapStatusQueryWireV1 {
            external_entity_id: "player:\u{6c34}".into(),
            actor_id: "actor:\u{6c34}".into(),
            player_id: PlayerId::new(0x89ab_cdef, 0xfedc_ba98),
        };
        let query_bytes = encode_player_combat_bootstrap_status_query_v1(&query).unwrap();
        assert_eq!(
            query_bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "425753370100010023000000561cf3bf7e4449d32832401580cdddef0a000000706c617965723ae6b0b4090000006163746f723ae6b0b4efcdab8998badcfe"
        );
        assert_eq!(
            decode_player_combat_bootstrap_status_query_v1(&query_bytes).unwrap(),
            query
        );

        let linked = PlayerCombatBootstrapStatusWireV1 {
            request_payload_hash: CanonicalHash([0x90; 16]),
            entity_authority_revision: 7,
            gameplay_sequence: 8,
            gameplay_combat_revision: 9,
            gameplay_state_hash: CanonicalHash([0x91; 16]),
            status: PlayerCombatBootstrapStatusV1::ExactLinked,
            blocker: None,
            combatant: Some(PlayerCombatantBootstrapWireV1 {
                record_id: "actor:\u{6c34}".into(),
                owner_id: Some("actor:\u{6c34}".into()),
                revision: 4,
                entity_id: Some(EntityId::new(5, 2)),
                vital_units: CombatVitalUnits::MilliheartsV1,
                health: 9_500,
                max_health: 10_000,
                alive: true,
                cross_domain_parity: true,
            }),
        };
        let linked_bytes = encode_player_combat_bootstrap_status_v1(&linked).unwrap();
        assert_eq!(
            linked_bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            "42574f370100010072000000490f1e0fa01d246758cc66aa3975fa289090909090909090909090909090909007000000000000000800000000000000090000000000000091919191919191919191919191919191020001090000006163746f723ae6b0b401090000006163746f723ae6b0b40400000000000000010500000002000000011c250000102700000101"
        );
        assert_eq!(&linked_bytes[..4], b"BWO7");
        assert_eq!(decode_player_combat_bootstrap_status_v1(&linked_bytes).unwrap(), linked);

        let legacy = PlayerCombatBootstrapStatusWireV1 {
            status: PlayerCombatBootstrapStatusV1::LegacyUnlinked,
            blocker: Some(PlayerCombatBootstrapBlockerV1::LegacyUnlinkedRequiresExplicitMigration),
            combatant: Some(PlayerCombatantBootstrapWireV1 {
                record_id: "actor:legacy".into(),
                owner_id: None,
                revision: 0,
                entity_id: None,
                vital_units: CombatVitalUnits::LegacyWholeHeartsV1,
                health: 10,
                max_health: 10,
                alive: true,
                cross_domain_parity: false,
            }),
            ..linked
        };
        let legacy_bytes = encode_player_combat_bootstrap_status_v1(&legacy).unwrap();
        assert_eq!(decode_player_combat_bootstrap_status_v1(&legacy_bytes).unwrap(), legacy);

        let invalid = PlayerCombatBootstrapStatusWireV1 {
            status: PlayerCombatBootstrapStatusV1::ExactLinked,
            blocker: Some(PlayerCombatBootstrapBlockerV1::VitalParityConflict),
            ..legacy
        };
        assert_eq!(
            encode_player_combat_bootstrap_status_v1(&invalid).unwrap_err().code,
            "player-combat-status"
        );
    }

    #[test]
    fn dedicated_inventory_import_and_receipt_wire_are_exact_and_bounded() {
        let mut metadata = ItemInstanceMetadataV1 {
            hash: CanonicalHash::default(),
            type_id: "legacy:\u{6c34}".into(),
            schema_id: "legacy-player-item-v1".into(),
            schema_version: 1,
            content_version: u32::MAX,
            canonical_json_bytes: "{\"name\":\"\u{6c34}\"}".as_bytes().to_vec(),
            unknown_extension_bytes: vec![0, 0x80, 0xff],
        };
        metadata.hash = metadata.calculate_hash();
        let mut slots = vec![None; 9];
        slots[8] = Some(ItemStack {
            item_code: u32::MAX,
            count: u32::MAX,
            durability_millionths: Some(1_000_000),
            metadata_hash: metadata.hash,
        });
        let request = PlayerInventoryImportWireV1 {
            import: ImportPlayerInventoryV1 {
                inventory: ContainerKey::player("actor:\u{6c34}"),
                expected_revision: 0,
                slots: slots.clone(),
                metadata: vec![metadata.clone()],
            },
            selected_slot: 8,
        };
        let bytes = encode_player_inventory_import_v1(&request).unwrap();
        assert_eq!(
            bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "4257503701000100aa000000bb993e07f9f486bd38b55f7d5a206b5200090000006163746f723ae6b0b401090000006163746f723ae6b0b40000000000000000080009000000000000000000000001ffffffffffffffff0140420f00882e9e6aeccf42c3f0de791eecf30a2e01000000882e9e6aeccf42c3f0de791eecf30a2e0a0000006c65676163793ae6b0b4150000006c65676163792d706c617965722d6974656d2d76310100ffffffff0e0000007b226e616d65223a22e6b0b4227d030000000080ff"
        );
        assert_eq!(decode_player_inventory_import_v1(&bytes).unwrap(), request);
        assert!(bytes.iter().any(|byte| *byte >= 0x80));

        let mut container = blockwild_gameplay::Container::new(request.import.inventory.clone(), 9);
        container.revision = 1;
        container.slots = slots;
        let result_hash = player_inventory_result_hash_v1(&container, &[metadata]).unwrap();
        assert_ne!(result_hash, CanonicalHash::default());
        let before =
            blockwild_gameplay::GameplayState::new(WorldKey::new("universe:\u{6c34}", "surface"), 1).identity();
        let mut after = before.clone();
        after.revision.sequence = u64::MAX;
        after.revision.inventory = u64::MAX;
        after.state_hash = CanonicalHash([0xff; 16]);
        let receipt = PlayerInventoryImportReceiptWireV1 {
            request_payload_hash: CanonicalHash(wire_checksum_v1(&bytes)),
            before,
            after,
            accepted_receipt_hash: CanonicalHash([0x81; 16]),
            inventory_revision: 1,
            selected_slot: 8,
            inventory_result_hash: result_hash,
        };
        let receipt_bytes = encode_player_inventory_import_receipt_v1(&receipt).unwrap();
        assert_eq!(
            receipt_bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            "4257493701000100f80000008116c5e70a08f7876835250c5b163328a82a5446608b477238b55f7d5a206b520c000000756e6976657273653ae6b0b4070000007375726661636501000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f79d45c28f5c7ef3c83a571e907d25030c000000756e6976657273653ae6b0b4070000007375726661636501000000ffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffff8181818181818181818181818181818101000000000000000800213d5b06a014aa2038b55f7d5a206b52"
        );
        assert_eq!(
            decode_player_inventory_import_receipt_v1(&receipt_bytes).unwrap(),
            receipt
        );
    }

    #[test]
    fn entity_wire_round_trips_high_bytes_and_rejects_corruption() {
        let mut record = EntityCompatibilityRecord::new("mob:é߿", "specimen:1", "frostquill");
        record.location_id = LocationId::new(1, 1);
        record.variant_key = Some("aurora".into());
        record.custom.insert("binary-label".into(), "é��".into());
        let batch = EntityCommandBatch {
            schema: blockwild_entity::ENTITY_COMMAND_SCHEMA,
            sequence: 7,
            expected_revision: 0,
            tick: 11,
            commands: vec![EntityCommand::Spawn {
                record,
                residency: EntityResidency::Hot,
            }],
        };
        let encoded = encode_entity_command_batch_v1(&batch).unwrap();
        assert_eq!(decode_entity_command_batch_v1(&encoded).unwrap(), batch);
        assert!(encoded.iter().any(|byte| *byte >= 0x80));
        let mut corrupt = encoded;
        *corrupt.last_mut().unwrap() ^= 0x80;
        assert_eq!(
            decode_entity_command_batch_v1(&corrupt).unwrap_err().code,
            "domain-checksum"
        );
    }

    #[test]
    fn every_r6_entity_command_and_event_round_trips_with_revisions() {
        let id = EntityId::new(7, 3);
        let mut record = EntityCompatibilityRecord::new("mob:\u{6c34}", "specimen:\u{03b4}", "wyrm");
        record.location_id = LocationId::new(2, 1);
        record.custom.insert("opaque".into(), "\u{00ff}\u{6c34}".into());
        let mut components = EntityComponents::from_compatibility(&record, ProtectionState::from_bits(0x12));
        components
            .unknown_extensions
            .insert("future:\u{96ea}".into(), vec![0, 0x80, 0xff]);
        components.care = Some(blockwild_entity::CareState {
            stabilized: true,
            nourishment_milli: 9_000,
            trust_milli: 3_000,
            care_stage: 2,
            last_care_tick: 44,
        });
        components.dragon = Some(blockwild_entity::DragonState {
            lineage_key: "golden".into(),
            element_key: "sun".into(),
            life_stage: 3,
            flight_stamina_milli: 8_000,
            breath_charge_milli: 7_000,
            egg_or_hatchling: false,
        });
        let dormant = DormantEntitySummary {
            slept_at_tick: 10,
            last_advanced_tick: 20,
            care_cycles: 1,
            breeding_cycles: 2,
            work_cycles: 3,
            next_care_tick: 30,
            next_breeding_tick: 40,
            next_work_tick: 50,
            next_ecology_tick: 60,
            route_epoch: components.ai.route_epoch,
            population_cost_quarters: 4,
        };
        let commands = vec![
            EntityCommand::Spawn {
                record: record.clone(),
                residency: EntityResidency::Hot,
            },
            EntityCommand::SpawnAt {
                id,
                record: record.clone(),
                residency: EntityResidency::Cold,
            },
            EntityCommand::Despawn {
                id,
                reason: DespawnReason::Captured,
            },
            EntityCommand::Hibernate { id },
            EntityCommand::Wake {
                id,
                tier: SimulationTier::Hero,
            },
            EntityCommand::UpdateMotion {
                id,
                position: EntityVec3::new(1.0, 2.0, 3.0),
                yaw: 0.5,
                velocity: EntityVec3::new(4.0, 5.0, 6.0),
            },
            EntityCommand::SetSimulationTier {
                id,
                tier: SimulationTier::Coarse,
            },
            EntityCommand::SetProtection {
                id,
                protection: ProtectionState::from_bits(0x55),
            },
            EntityCommand::SpawnTyped {
                record: record.clone(),
                components: components.clone(),
                residency: EntityResidency::Hot,
            },
            EntityCommand::SpawnTypedAt {
                id,
                record: record.clone(),
                components: components.clone(),
                residency: EntityResidency::Cold,
            },
            EntityCommand::SetVitalsEnvironment {
                id,
                value: components.vitals.clone(),
            },
            EntityCommand::SetLocomotionBody {
                id,
                value: components.locomotion.clone(),
            },
            EntityCommand::SetAiState {
                id,
                value: components.ai.clone(),
            },
            EntityCommand::SetSocialState {
                id,
                value: components.social.clone(),
            },
            EntityCommand::SetMountState {
                id,
                value: components.mount.clone(),
            },
            EntityCommand::SetProtectionProvenance {
                id,
                value: components.protection.clone(),
            },
            EntityCommand::SetNetworkAuthority {
                id,
                value: components.network.clone(),
            },
            EntityCommand::SetCareState {
                id,
                value: components.care.clone(),
            },
            EntityCommand::SetHusbandryState {
                id,
                value: components.husbandry.clone(),
            },
            EntityCommand::SetWorkState {
                id,
                value: components.work.clone(),
            },
            EntityCommand::SetEquipment {
                id,
                value: components.equipment.clone(),
            },
            EntityCommand::SetDragonState {
                id,
                value: components.dragon.clone(),
            },
            EntityCommand::SetLegendaryState {
                id,
                value: components.legendary.clone(),
            },
            EntityCommand::SetSummonState {
                id,
                value: components.summon.clone(),
            },
            EntityCommand::SetSentientState {
                id,
                value: components.sentient.clone(),
            },
            EntityCommand::ReplaceComponents { id, value: components },
            EntityCommand::ReplaceCompatibilityRecord { id, value: record },
            EntityCommand::SetRangeState {
                id,
                out_of_range_seconds: 12.5,
                last_simulated_tick: 99,
            },
            EntityCommand::SetDormantSummary { id, value: dormant },
        ];
        let batch = EntityCommandBatch {
            schema: blockwild_entity::ENTITY_COMMAND_SCHEMA,
            sequence: 8,
            expected_revision: 7,
            tick: 100,
            commands,
        };
        let encoded = encode_entity_command_batch_v1(&batch).unwrap();
        assert_eq!(decode_entity_command_batch_v1(&encoded).unwrap(), batch);
        assert!(encoded.windows(3).any(|bytes| bytes == [0, 0x80, 0xff]));

        let kinds = vec![
            EntityEventKind::Spawned {
                residency: EntityResidency::Hot,
            },
            EntityEventKind::Despawned {
                reason: DespawnReason::Defeated,
            },
            EntityEventKind::ResidencyChanged(EntityResidency::Cold),
            EntityEventKind::MotionUpdated,
            EntityEventKind::TierChanged(SimulationTier::Nearby),
            EntityEventKind::ProtectionChanged,
            EntityEventKind::VitalsEnvironmentChanged,
            EntityEventKind::LocomotionChanged,
            EntityEventKind::AiChanged,
            EntityEventKind::SocialChanged,
            EntityEventKind::MountChanged,
            EntityEventKind::NetworkAuthorityChanged,
            EntityEventKind::CareChanged,
            EntityEventKind::HusbandryChanged,
            EntityEventKind::WorkChanged,
            EntityEventKind::EquipmentChanged,
            EntityEventKind::DragonChanged,
            EntityEventKind::LegendaryChanged,
            EntityEventKind::SummonChanged,
            EntityEventKind::SentientChanged,
            EntityEventKind::ComponentsReplaced,
            EntityEventKind::CompatibilityRecordChanged,
            EntityEventKind::RangeStateChanged,
            EntityEventKind::DormantSummaryChanged,
        ];
        let events = EntityEventBatch {
            schema: blockwild_entity::ENTITY_COMMAND_SCHEMA,
            sequence: 9,
            previous_revision: 11,
            revision: 12,
            events: kinds
                .into_iter()
                .enumerate()
                .map(|(index, kind)| blockwild_entity::EntityEvent {
                    command_index: index as u32,
                    entity_id: EntityId::new(index as u32 + 1, 2),
                    previous_entity_revision: index as u64 + 20,
                    entity_revision: index as u64 + 21,
                    kind,
                })
                .collect(),
        };
        let encoded = encode_entity_event_batch_v1(&events).unwrap();
        assert_eq!(decode_entity_event_batch_v1(&encoded).unwrap(), events);
    }

    #[test]
    fn r6_snapshot_and_compatibility_operation_wires_are_exact_and_fail_closed() {
        let mut authority = EntityAuthority::default();
        let record = EntityCompatibilityRecord::new("entity:\u{96ea}", "specimen:\u{6c34}", "wyrm");
        authority
            .apply_batch(&EntityCommandBatch {
                schema: blockwild_entity::ENTITY_COMMAND_SCHEMA,
                sequence: 4,
                expected_revision: 0,
                tick: 9,
                commands: vec![EntityCommand::SpawnAt {
                    id: EntityId::new(3, 2),
                    record: record.clone(),
                    residency: EntityResidency::Hot,
                }],
            })
            .unwrap();
        let snapshot = encode_entity_authority_snapshot(&authority).unwrap();
        let import = EntityAuthorityImportWireV2 {
            expected_revision: 0,
            snapshot: snapshot.clone(),
        };
        let encoded = encode_entity_authority_import_v2(&import).unwrap();
        assert_eq!(decode_entity_authority_import_v2(&encoded).unwrap(), import);
        let export = EntityAuthorityExportWireV1 { expected_revision: 1 };
        assert_eq!(
            decode_entity_authority_export_v1(&encode_entity_authority_export_v1(export).unwrap()).unwrap(),
            export
        );
        let compatibility = EntityCompatibilityImportWireV1 {
            sequence: 5,
            expected_revision: 1,
            tick: 10,
            desired_id: Some(EntityId::new(4, 2)),
            residency: EntityResidency::Cold,
            record,
        };
        let encoded = encode_entity_compatibility_import_v1(&compatibility).unwrap();
        assert_eq!(decode_entity_compatibility_import_v1(&encoded).unwrap(), compatibility);
        let mut corrupt = encoded;
        *corrupt.last_mut().unwrap() ^= 0x80;
        assert_eq!(
            decode_entity_compatibility_import_v1(&corrupt).unwrap_err().code,
            "domain-checksum"
        );
        let receipt = EntityAuthorityImportReceiptWireV1 {
            previous_revision: 0,
            revision: authority.revision(),
            entity_count: authority.len() as u32,
            state_hash: authority.canonical_hash(),
        };
        assert_eq!(
            decode_entity_authority_import_receipt_v1(&encode_entity_authority_import_receipt_v1(receipt).unwrap())
                .unwrap(),
            receipt
        );
    }

    #[test]
    fn player_binding_preserves_full_u64_player_identity() {
        let binding = RuntimePlayerBindingWireV1 {
            external_entity_id: "player:wide".into(),
            actor_id: "actor:wide".into(),
            player_id: PlayerId::new(0x1234_5678, 0xfedc_ba98),
            creative_mode: true,
            radius: 0.35,
            standing_height: 1.8,
            crouching_height: 1.35,
            mass: 80.0,
            walk_speed: 4.3,
            sprint_speed: 6.2,
            creative_flight_speed: 8.0,
            maximum_oxygen_seconds: 15.0,
        };

        let encoded = encode_runtime_player_binding_v1(&binding).unwrap();

        assert!(binding.player_id.packed() > 9_007_199_254_740_991);
        assert_eq!(
            encoded.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "425742360100010066000000da0d6d9fc18becf9c8d1481e3c51c6c70b000000706c617965723a776964650a0000006163746f723a776964657856341298badcfe01666666666666d63fcdccccccccccfc3f9a9999999999f53f00000000000054403333333333331140cdcccccccccc184000000000000020400000000000002e40"
        );
        assert_eq!(decode_runtime_player_binding_v1(&encoded).unwrap(), binding);
    }

    #[test]
    fn terrain_residency_wire_is_golden_bounded_and_fail_closed() {
        let batch = IntegratedTerrainResidencyBatchV1 {
            expected_world_revision: WorldAuthorityRevisionV1 {
                epoch: 7,
                mutation: 11,
                residency: 13,
            },
            generation_options_json: crate::runtime::DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
            chunks: vec![
                IntegratedTerrainChunkCoordinateV1 {
                    chunk_x: -2,
                    chunk_z: 3,
                },
                IntegratedTerrainChunkCoordinateV1 {
                    chunk_x: 4,
                    chunk_z: -5,
                },
            ],
        };
        let encoded = encode_terrain_residency_batch_v1(&batch).unwrap();
        assert_eq!(decode_terrain_residency_batch_v1(&encoded).unwrap(), batch);
        assert_eq!(
            encoded.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "425754340100010088010000de1f6d729fdb3858b8c5c4571516987007000000000000000b000000000000000d00000000000000580100007b2262696f6d655363616c65223a312e33352c22636176654672657175656e6379223a312c22656e61626c656446616374696f6e73223a5b22686f6262697473222c22676f626c696e73222c2261746c616e7469616e73222c227375676172636f757274222c22776f6f642d656c766573222c2264776172766573225d2c226c61726765546f776e4672657175656e6379223a2262616c616e636564222c2270726f66696c65223a22776f726c642d62656c6f772d763135222c227265736f757263654162756e64616e6365223a312c22726f6164436f766572616765223a22726567696f6e616c222c22736574746c656d656e74436c7573746572696e67223a22726567696f6e616c222c22736574746c656d656e7444656e73697479223a312c22736574746c656d656e745061747465726e223a2268656172746c616e64732d7632222c2273747275637475726573223a747275657d02000000feffffff0300000004000000fbffffff"
        );
        let mut corrupt = encoded;
        *corrupt.last_mut().unwrap() ^= 0x80;
        assert_eq!(
            decode_terrain_residency_batch_v1(&corrupt).unwrap_err().code,
            "domain-checksum"
        );

        let receipt = IntegratedTerrainResidencyReceiptV1 {
            previous_world_revision: batch.expected_world_revision,
            world_revision: WorldAuthorityRevisionV1 {
                epoch: 7,
                mutation: 11,
                residency: 37,
            },
            requested_chunks: 2,
            generated_chunks: 1,
            already_resident_chunks: 1,
            requested_resident_chunks: 2,
            resident_sections: 24,
            chunks: vec![
                IntegratedTerrainResidencyChunkReceiptV1 {
                    coordinate: batch.chunks[0],
                    status: IntegratedTerrainResidencyStatusV1::Generated,
                    resident_sections: 12,
                    edit_count: 1,
                    generation_revision: 17,
                    request_hash: CanonicalHash([1; 16]),
                    source_hash: CanonicalHash([2; 16]),
                    edit_hash: CanonicalHash([3; 16]),
                    namespace_hash: CanonicalHash([4; 16]),
                    cache_hit: false,
                },
                IntegratedTerrainResidencyChunkReceiptV1 {
                    coordinate: batch.chunks[1],
                    status: IntegratedTerrainResidencyStatusV1::AlreadyResident,
                    resident_sections: 12,
                    edit_count: 0,
                    generation_revision: 19,
                    request_hash: CanonicalHash([5; 16]),
                    source_hash: CanonicalHash([6; 16]),
                    edit_hash: CanonicalHash([7; 16]),
                    namespace_hash: CanonicalHash([8; 16]),
                    cache_hit: true,
                },
            ],
            state_hash: CanonicalHash([9; 16]),
        };
        let receipt_bytes = encode_terrain_residency_receipt_v1(&receipt).unwrap();
        assert_eq!(decode_terrain_residency_receipt_v1(&receipt_bytes).unwrap(), receipt);
        assert_eq!(
            receipt_bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            "42575534010001000001000060614df5f7d98929d8039275ae9f18b307000000000000000b000000000000000d0000000000000007000000000000000b000000000000002500000000000000020000000100000001000000020000001800000002000000feffffff03000000010c000100000011000000010101010101010101010101010101010202020202020202020202020202020203030303030303030303030303030303040404040404040404040404040404040004000000fbffffff000c000000000013000000050505050505050505050505050505050606060606060606060606060606060607070707070707070707070707070707080808080808080808080808080808080109090909090909090909090909090909"
        );
        let mut inconsistent = receipt;
        inconsistent.generated_chunks = 2;
        inconsistent.already_resident_chunks = 0;
        assert_eq!(
            encode_terrain_residency_receipt_v1(&inconsistent).unwrap_err().code,
            "terrain-residency-receipt"
        );
    }

    #[test]
    fn terrain_residency_reconcile_wire_is_versioned_exact_and_fail_closed() {
        let request = IntegratedTerrainResidencyReconcileBatchV2 {
            expected_world_revision: WorldAuthorityRevisionV1 {
                epoch: 7,
                mutation: 11,
                residency: 37,
            },
            generation_options_json: crate::runtime::DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
            desired_chunks: vec![
                IntegratedTerrainChunkCoordinateV1 {
                    chunk_x: -2,
                    chunk_z: 3,
                },
                IntegratedTerrainChunkCoordinateV1 {
                    chunk_x: 4,
                    chunk_z: -5,
                },
            ],
        };
        let encoded = encode_terrain_residency_reconcile_batch_v2(&request).unwrap();
        assert_eq!(&encoded[..8], b"BWT5\x01\x00\x02\x00");
        assert_eq!(
            encoded.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "4257543501000200880100009609110496e9e746b8c5c4571516987007000000000000000b000000000000002500000000000000580100007b2262696f6d655363616c65223a312e33352c22636176654672657175656e6379223a312c22656e61626c656446616374696f6e73223a5b22686f6262697473222c22676f626c696e73222c2261746c616e7469616e73222c227375676172636f757274222c22776f6f642d656c766573222c2264776172766573225d2c226c61726765546f776e4672657175656e6379223a2262616c616e636564222c2270726f66696c65223a22776f726c642d62656c6f772d763135222c227265736f757263654162756e64616e6365223a312c22726f6164436f766572616765223a22726567696f6e616c222c22736574746c656d656e74436c7573746572696e67223a22726567696f6e616c222c22736574746c656d656e7444656e73697479223a312c22736574746c656d656e745061747465726e223a2268656172746c616e64732d7632222c2273747275637475726573223a747275657d02000000feffffff0300000004000000fbffffff"
        );
        assert_eq!(decode_terrain_residency_reconcile_batch_v2(&encoded).unwrap(), request);
        let mut corrupt = encoded;
        *corrupt.last_mut().unwrap() ^= 0x80;
        assert_eq!(
            decode_terrain_residency_reconcile_batch_v2(&corrupt).unwrap_err().code,
            "domain-checksum"
        );

        let receipt = IntegratedTerrainResidencyReconcileReceiptV2 {
            previous_world_revision: request.expected_world_revision,
            world_revision: WorldAuthorityRevisionV1 {
                residency: 74,
                ..request.expected_world_revision
            },
            desired_chunk_count: 2,
            generated_chunk_count: 1,
            retained_chunk_count: 1,
            evicted_chunk_count: 2,
            resident_sections: 24,
            desired_chunks: request.desired_chunks.clone(),
            generated_chunks: vec![request.desired_chunks[0]],
            retained_chunks: vec![request.desired_chunks[1]],
            evicted_chunks: vec![
                IntegratedTerrainChunkCoordinateV1 {
                    chunk_x: -8,
                    chunk_z: 1,
                },
                IntegratedTerrainChunkCoordinateV1 { chunk_x: 9, chunk_z: 2 },
            ],
            state_hash: CanonicalHash([9; 16]),
        };
        let encoded = encode_terrain_residency_reconcile_receipt_v2(&receipt).unwrap();
        assert_eq!(&encoded[..8], b"BWU5\x01\x00\x02\x00");
        assert_eq!(
            decode_terrain_residency_reconcile_receipt_v2(&encoded).unwrap(),
            receipt
        );
        let mut inconsistent = receipt;
        inconsistent.retained_chunks = inconsistent.generated_chunks.clone();
        assert_eq!(
            encode_terrain_residency_reconcile_receipt_v2(&inconsistent)
                .unwrap_err()
                .code,
            "terrain-residency-reconcile-receipt"
        );
    }

    #[test]
    fn persistence_dispatch_wire_round_trips_high_utf8_and_rejects_corruption() {
        let command = RuntimePersistenceDispatchWireV1::Estimate {
            world_id: "wørld".into(),
        };
        let encoded = encode_runtime_persistence_dispatch_v1(&command).unwrap();
        assert_eq!(
            encoded.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "42574438010001000b0000005df174d7207aef3588f6935cac2b6c8e060600000077c3b8726c64",
        );
        assert!(encoded.iter().any(|byte| *byte >= 0x80));
        assert_eq!(decode_runtime_persistence_dispatch_v1(&encoded).unwrap(), command);
        let mut corrupt = encoded;
        *corrupt.last_mut().unwrap() ^= 0x80;
        assert_eq!(
            decode_runtime_persistence_dispatch_v1(&corrupt).unwrap_err().code,
            "domain-checksum"
        );
    }

    #[test]
    fn persistence_terminal_status_is_append_only_and_attests_one_exact_checkpoint() {
        let query = encode_runtime_persistence_status_query_v1().unwrap();
        assert_eq!(&query[..8], b"BWS8\x01\x00\x01\x00");
        decode_runtime_persistence_status_query_v1(&query).unwrap();

        let receipt = RuntimePersistenceStatusReceiptWireV1 {
            persistence_revision: 9,
            pending: 0,
            queued_bytes: 0,
            dispatcher_state_hash: CanonicalHash([1; 16]),
            authority_state_hash: CanonicalHash([2; 16]),
            closed: false,
            terminal_checkpoint: Some(RuntimePersistenceTerminalCheckpointWireV1 {
                checkpoint_id: "checkpoint:水".into(),
                checkpoint_hash: CanonicalHash([3; 16]),
                journal_sequence: 7,
                record_count: 6,
                save_set_hash: CanonicalHash([4; 16]),
                manifest_hash: CanonicalHash([5; 16]),
            }),
        };
        let encoded = encode_runtime_persistence_status_receipt_v1(&receipt).unwrap();
        assert_eq!(&encoded[..8], b"BWT8\x01\x00\x01\x00");
        assert_eq!(
            encoded.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "425754380100010084000000f3e4b66006cdcf7c18da4b682f8cb46a0900000000000000000000000000000000000000010101010101010101010101010101010202020202020202020202020202020200010e000000636865636b706f696e743ae6b0b4030303030303030303030303030303030700000000000000060000000404040404040404040404040404040405050505050505050505050505050505"
        );
        assert_eq!(decode_runtime_persistence_status_receipt_v1(&encoded).unwrap(), receipt);
    }

    #[test]
    fn content_page_wire_preserves_unicode_high_bytes_and_domains() {
        let bundle = blockwild_gameplay::compile_content_bundle(
            "content-\u{6c34}-1",
            vec![ContentArtifact {
                domain: ContentDomain::Item,
                id: "orb:\u{6c34}".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 9,
                aliases: vec!["item:orb-\u{6c34}".into(), "item:orb:\u{6c34}".into()],
                canonical_bytes: "{\"name\":\"Mizu \u{6c34}\"}".as_bytes().to_vec(),
                unknown_extension_bytes: vec![0, 0x80, 0xff],
            }],
        )
        .unwrap();
        let page = ContentInstallPageWireV1 {
            install_id: format!("install:{}", bundle.manifest.manifest_hash.to_hex()),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision.clone(),
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains.clone(),
            page_index: 0,
            page_count: 1,
            artifacts: bundle.artifacts,
        };
        let encoded = encode_content_install_page_v1(&page).unwrap();
        assert_eq!(
            bundle.manifest.manifest_hash.to_hex(),
            "2bbeaab8b5f3691230252027558e948f"
        );
        assert_eq!(
            encoded.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "4257433701000100ab010000009477ab704087d238b55f7d5a2a31e528000000696e7374616c6c3a326262656161623862356633363931323330323532303237353538653934386601000d000000636f6e74656e742de6b0b42d312bbeaab8b5f3691230252027558e948f0b00000100000002859f5276f16bedc87a01591faa188b0100000000adf4e63002272ee2c83a57a61812458f0200000000a10cf256ba7281bac83a57a61812417b0300000000efe23061189c39a0c83a57a67211d5ea040000000045af961395cd5b99c83a5716c2882d30050000000078e14c613113a899c83a57a67211d5c006000000002fe966db6f45b565c83a57969fa148f607000000007a00de9183d68586c83a5796090d490a0800000000462f9f6d667aac6ac83a5766dfaead27090000000091e7b6db86082917c83a579650a7b4dd0a00000000a21d2c4d687bc6c2c83a5786670accc300000000010000000100000000070000006f72623ae6b0b40f0000006974656d2d646566696e6974696f6e010009000000020000000c0000006974656d3a6f72622de6b0b40c0000006974656d3a6f72623ae6b0b4130000007b226e616d65223a224d697a7520e6b0b4227d030000000080ff"
        );
        assert_eq!(decode_content_install_page_v1(&encoded).unwrap(), page);
        assert!(encoded.iter().any(|byte| *byte >= 0x80));
        let mut corrupt = encoded;
        *corrupt.last_mut().unwrap() ^= 0x80;
        assert_eq!(
            decode_content_install_page_v1(&corrupt).unwrap_err().code,
            "domain-checksum"
        );
    }
}
