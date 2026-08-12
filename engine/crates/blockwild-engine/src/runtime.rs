//! Integrated renderer-independent authority assembled during the R4-R9 cutover.
//!
//! This module deliberately keeps the original R0 `Engine` facade intact while
//! the browser adapters are promoted.  Unlike the R0 shadow facade, this runtime
//! owns the canonical world, entity, gameplay, persistence, simulation-job, and
//! network-authority boundaries in one coarse-grained handle.

use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;
use std::sync::Arc;

use blockwild_authority::{
    BlockCatalogV1, CellPositionV1, ChunkAuxiliaryDataV1, LiquidMetadataV1, ReadOriginV1, ReadSizeV1, SectionInstallV1,
    WORLD_AIR_BLOCK_ID_V1, WORLD_BEDROCK_BLOCK_ID_V1, WORLD_MAX_Y_V1, WORLD_MIN_Y_V1, WORLD_READ_WINDOW_MAX_CELLS_V1,
    WORLD_SECTION_CELL_COUNT_V1, WorldAddressV1 as AuthorityWorldAddressV1, WorldAuthorityRevisionV1,
    WorldAuthorityStoreR4V1, WorldCellReadV1, WorldCellV1, WorldChunkAddressV1 as AuthorityChunkAddressV1,
    WorldLiquidKindV1, WorldMutationBatchR4V1, WorldMutationCommandR4V1, WorldMutationReceiptR4V1, WorldReadPageV1,
    WorldSectionAddressV1, decode_compatibility_save_binary_v1, decode_world_authority_snapshot_r4_v1,
    encode_world_authority_snapshot_r4_v1,
};
use blockwild_entity::{
    ActionState, DespawnReason, ENTITY_COMMAND_SCHEMA, EcologyJobQueue, EntityAuthority, EntityClass, EntityCommand,
    EntityCommandBatch, EntityCompatibilityRecord, EntityEventBatch, EntityResidency, EntityScheduler, MovementMode,
    PathJobQueue, PathJobSubmission, SimulationTier, Vec3 as EntityVec3, decode_compatibility_record,
    decode_entity_authority_snapshot, ecology_sector_key, encode_compatibility_record,
    encode_entity_authority_snapshot,
};
use blockwild_gameplay::{
    ActorGrant, ActorRole, ApplyBlockActionV1, BlockActionGeneratedStackV1, BlockActionLootBindingV1,
    BlockActionLootCellV1, BlockActionLootContextV1, BlockActionLootPlanV1, BlockActionLootRngCursorV1,
    BlockActionLootRuleOutcomeV1, BlockActionRngDrawPurposeV1, BlockActionRngDrawV1, CombatCommand, CombatVitalUnits,
    CombatantState, ContainerKey, ContainerKind, ContentActionPromotionBlockerRecordV1,
    ContentActionPromotionSupportLevelV1, ContentActionToolKind, ContentArtifact, ContentBlockBreakReplacement,
    ContentBlockContextualOverride, ContentBlockDurabilityCost, ContentDomain, ContentDomainDigest, ContentItemUseKind,
    ContentRenderPresentationBinding, ContentRenderPresentationRole, ContentRuntimeRegistry, ContentSchema,
    CreateGeneratedDropCustodyV1, CreatePlayerCustodyCommand, DropRemovalReasonV1, DroppedItemSpatialV1, ExpectedStack,
    FixedVec3, FixedWorldVec3V1, GameplayActor, GameplayAuthority, GameplayBatch, GameplayCommand, GameplayReceipt,
    GameplayScheduleAdvanceV1, GameplayState, GeneratedDropProvenanceV1, InventoryCommand, ItemDefinition,
    ItemInstanceMetadataV1, ItemStack, MetadataBlobStore, PlayerDropStageRequestV1, PlayerInventoryBindingV1,
    RejectionCode, RemoveEmptyDropCustodyCommand, RotationMicroturnsV1, SlotRef, TransferCommand, WorldKey,
    WorldViewAcceptedReceiptV1, WorldViewAuthorityV1, WorldViewBatchV1, WorldViewCommandV1, WorldViewReceiptV1,
    advance_projectile_position_v1, compile_content_bundle, decode_gameplay_authority_snapshot,
    evaluate_block_action_loot_v1, install_content_bundle, materialize_content_runtime,
    replay_verify_block_action_loot_plan_v1, stage_player_drop_v1,
};
use blockwild_generation::{
    Block as GeneratedBlock, ChunkPayloadV2, GENERATOR_VERSION, GenerateChunkRequestV2, GenerationDiagnostics,
    GenerationOutcome, GenerationService, PROTOCOL_VERSION as GENERATION_PROTOCOL_VERSION_V2,
    REQUEST_SCHEMA_VERSION as GENERATION_REQUEST_SCHEMA_VERSION_V2,
};
use blockwild_network::{
    AgentCapabilityGrantV1, InterestDeltaBuildSourceV1, InterestIndexV1, InterestSelectionStatsV1,
    NetworkAuthorityIdentityV1, NetworkAuthorityRevisionV1, NetworkBrowserAuthorityRuntimeV1, NetworkDeltaRecordV1,
    NetworkDeltaV1, NetworkInterestSetV1, NetworkPeerGrantV1, NetworkReconnectCheckpointV1, ScopedDeltaRecordV1,
    WorldAddressV1 as NetworkWorldAddressV1,
};
use blockwild_persistence::{
    COMPATIBILITY_RECORD_PREFIX_V1, CanonicalWorldSaveSetV1, Checkpoint, JournalCommitReceipt, JournalState,
    NormalizedStateRecordV1, PagedRecoveryAssemblerV1, PagedRecoveryCompleteV1, PersistenceAuthorityV1,
    PersistenceBrowserRequestV1, PersistenceDispatchOutcomeV1, PersistenceDispatchPacketV1,
    PersistenceDispatchStatusV1, PersistenceDispatcherLimitsV1, PersistenceDispatcherV1,
    PersistencePlatformOperationV1, PersistenceWireRecord, PreparedAuthorityCommitV1, RecordAddress, RecordDescriptor,
    RecordKind, Transaction, WORLD_SAVE_MANIFEST_RECORD_ID_V1, decode_paged_recovery_head_v1,
    decode_paged_recovery_page_v1, decode_persistence_browser_request_v1, decode_record, decode_world_save_manifest_v1,
    encode_checkpoint,
};
use blockwild_runtime_wire::{
    MAX_CONTEXT_COMMANDS_V2, MAX_INPUT_FRAMES, MAX_SAFE_U64, MAX_WIRE_BYTES, RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1,
    RUNTIME_BULK_MAX_SAVE_CHUNKS_V1, RUNTIME_BULK_SAVE_CHUNK_BYTES_V1, RUNTIME_INPUT_BUTTON_ASCEND_V1,
    RUNTIME_INPUT_BUTTON_CREATIVE_FLIGHT_TOGGLE_V1, RUNTIME_INPUT_BUTTON_CROUCH_V1, RUNTIME_INPUT_BUTTON_DESCEND_V1,
    RUNTIME_INPUT_BUTTON_DROP_V1, RUNTIME_INPUT_BUTTON_INTERACT_V1, RUNTIME_INPUT_BUTTON_JUMP_V1,
    RUNTIME_INPUT_BUTTON_MASK_V1, RUNTIME_INPUT_BUTTON_MOUNT_TOGGLE_V1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1,
    RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1, RUNTIME_INPUT_BUTTON_SPRINT_V1, RUNTIME_INPUT_FLAG_CREATIVE_V1,
    RUNTIME_INPUT_FLAG_FLYING_V1, RUNTIME_INPUT_FLAG_MASK_V1, RUNTIME_INPUT_FLAG_MOUNTED_V1, RuntimeCommandReceiptV1,
    RuntimeContainerKeyV2, RuntimeContainerKindV2, RuntimeContextCommandActionV2, RuntimeContextCommandV2,
    RuntimeInputActionKindV1, RuntimeInputActionOutcomeV1, RuntimeInputActionReceiptV1, RuntimeInputFrameV1,
    RuntimeSemanticActionOutcomeV2, RuntimeSemanticActionReasonV2, RuntimeSemanticActionReceiptV2,
    RuntimeSemanticActionResolutionV2, WireHash, context_command_hash_v2, decode_command_receipt_v1,
    encode_command_receipt_v1, validate_command_receipt_hash_v1,
};
use blockwild_simulation::{
    AabbV1, ActionRayEntityTargetV1, ActionRayTargetV1, AirZoneTopologyJobV1, AirZoneTopologyResultV1,
    CAMERA_MAX_VIEWPORT_V1, CameraModeV1, CameraPoseInputV1, CameraPoseV1, CameraProfileV1, ContractError,
    GravityProfileV1, LiquidFrontierResultV1, LiquidFrontierStepV1, PHYSICS_CONTACT_HEAD_SUBMERGED,
    PHYSICS_CONTACT_IN_LIQUID, PHYSICS_CONTROL_CROUCH, PHYSICS_CONTROL_JUMP, PHYSICS_CONTROL_SPRINT, PathJobResultV1,
    PathJobV1, PhysicsBodyV1, PhysicsControlsV1, PhysicsEventKindV1, PhysicsStepInputV1, PhysicsStepResultV1,
    PhysicsSwimProfileV1, ProjectileContactKindV1, ProjectileSweepV1, RAYCAST_MAX_VISITED_CELLS_V1,
    SimulationJobIdentityV1, SweepTargetV1, Vec3 as SimulationVec3, VoxelRayHitKindV1, VoxelRaycastQueryV1,
    WorldAddressV1 as SimulationWorldAddressV1, WorldIdentityV1, WorldReadWindowV1, WorldRevisionV1,
    derive_camera_pose_v1, find_path, raycast_action_target, solve_air_zones, step_liquid_frontier, step_physics,
    sweep_projectile_contacts_batch,
};
use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId, PlayerId, seed_stream};

use crate::{
    ContentInstallPageWireV1, ContentInstallReceiptStatusV1, ContentInstallReceiptWireV1,
    EntityAuthorityImportReceiptWireV1, EntityCompatibilityImportWireV1, PlayerBindingStageRequestV1,
    PlayerBootstrapCustodyWireV1, PlayerBootstrapEntityWireV1, PlayerBootstrapRuntimePlayerWireV1,
    PlayerBootstrapStatusQueryWireV1, PlayerBootstrapStatusWireV1, PlayerCombatBootstrapBlockerV1,
    PlayerCombatBootstrapStatusV1, PlayerCombatBootstrapStatusWireV1, PlayerCombatantBootstrapWireV1,
    PlayerInventoryImportReceiptWireV1, PlayerInventoryImportWireV1, RuntimeCameraConfigReceiptWireV1,
    RuntimeCameraConfigWireV1, RuntimeContextCommandContinuityQueryWireV2,
    RuntimeContextCommandContinuityReceiptWireV2, RuntimePersistenceDispatchReceiptWireV1,
    RuntimePersistenceDispatchWireV1, RuntimePlayerBindingWireV1, WorldViewExtractionInputV1,
    collect_world_view_extraction_v1, decode_world_view_native_record_v1, encode_world_view_native_record_v1,
    initialize_world_view_authority_v1, player_inventory_result_hash_v1, runtime_camera_config_state_hash_v1,
    stage_player_binding_v1, stage_world_view_batches_v1, validate_world_view_runtime_links_v1,
};

pub const INTEGRATED_RUNTIME_SCHEMA_V2: u16 = 2;
pub const INTEGRATED_RUNTIME_FIXED_STEP_US: u64 = 50_000;
pub const INTEGRATED_RUNTIME_MAX_QUEUED_BATCHES: usize = 128;
pub const INTEGRATED_RUNTIME_MAX_BATCHES_PER_STEP: usize = 32;
pub const INTEGRATED_RUNTIME_MAX_DOMAIN_BATCHES: usize = 256;
pub const INTEGRATED_RUNTIME_MAX_REPLAY_ENTRIES: usize = 8_192;
pub const INTEGRATED_RUNTIME_MAX_IDEMPOTENCY_RECEIPTS: usize = 4_096;
pub const INTEGRATED_RUNTIME_MAX_COMMAND_RECEIPT_CACHE_BYTES_V1: usize = 4 * 1024 * 1024;
pub const INTEGRATED_RUNTIME_MAX_INPUT_LEAD_TICKS: u64 = 256;
pub const INTEGRATED_RUNTIME_MAX_CONTEXT_COMMAND_LEAD_TICKS_V2: u64 = INTEGRATED_RUNTIME_MAX_INPUT_LEAD_TICKS;
pub const INTEGRATED_RUNTIME_MAX_EFFECT_EVENTS: usize = 256;
pub const INTEGRATED_RUNTIME_MAX_MACHINES_PER_STEP: usize = 64;
pub const INTEGRATED_RUNTIME_PERSISTENCE_MAX_PENDING: usize = 32;
pub const INTEGRATED_RUNTIME_PERSISTENCE_MAX_QUEUED_BYTES: usize = 64 * 1024 * 1024;
pub const INTEGRATED_RUNTIME_PERSISTENCE_MAX_PACKET_BYTES: usize = 8 * 1024 * 1024;
pub const INTEGRATED_RUNTIME_PERSISTENCE_MAX_COMMIT_PAYLOAD_BYTES: usize = 6 * 1024 * 1024;
pub const INTEGRATED_RUNTIME_PERSISTENCE_MAX_COMPLETED: usize = 256;
pub const INTEGRATED_RUNTIME_PERSISTENCE_MAX_RETRIES: u8 = 3;
pub const INTEGRATED_RUNTIME_MAX_SAVE_STAGES: usize = 1;
pub const INTEGRATED_RUNTIME_MAX_RECOVERY_ASSEMBLERS: usize = 2;
pub const INTEGRATED_RUNTIME_MAX_HYDRATED_EXPORTS: usize = 2;
pub const INTEGRATED_RUNTIME_CONTENT_MAX_ENTRIES_V1: usize = blockwild_gameplay::MAX_CONTENT_ENTRIES;
pub const INTEGRATED_RUNTIME_MAX_ENTITY_SCHEDULE_JOBS_V1: usize = 256;

type CombatScheduleCommandsV1 = (Vec<GameplayCommand>, Vec<EntityCommand>, BTreeMap<EntityId, String>);
pub const INTEGRATED_RUNTIME_MAX_ECOLOGY_SCHEDULE_JOBS_V1: usize = 64;
pub const INTEGRATED_RUNTIME_MAX_PATH_SCHEDULE_JOBS_V1: usize = 64;
pub const INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1: usize = 25;
pub const INTEGRATED_RUNTIME_MAX_TERRAIN_RECONCILE_EVICTED_CHUNKS_V2: usize = 65_536;
pub const INTEGRATED_RUNTIME_ECOLOGY_CADENCE_TICKS_V1: u64 = 20;
pub const INTEGRATED_RUNTIME_DROP_PICKUP_DELAY_TICKS_V1: u64 = 7;
pub const INTEGRATED_RUNTIME_MAX_DROP_MOTION_PER_STEP_V1: usize = 128;
pub const INTEGRATED_RUNTIME_MAX_DROP_PICKUPS_PER_STEP_V1: usize = 16;
pub const INTEGRATED_RUNTIME_DROP_PICKUP_RADIUS_MILLI_V1: i64 = 1_450;
const INTEGRATED_RUNTIME_DROP_RADIUS_MILLI_V1: i64 = 150;
const INTEGRATED_RUNTIME_DROP_GRAVITY_PER_STEP_V1: i64 = 600;
const INTEGRATED_RUNTIME_DROP_TERMINAL_VELOCITY_MILLI_V1: i64 = -30_000;
const INTEGRATED_RUNTIME_DROP_ROTATION_MICROTURNS_PER_STEP_V1: u32 = 19_894;
pub const INTEGRATED_RUNTIME_NATIVE_DOMAIN_COUNT_V1: u16 = 6;
const NATIVE_WORLD_RECORD_ID_V1: &str = "rust-world-r4-v1";
const NATIVE_ENTITY_RECORD_ID_V2: &str = "rust-entity-r6-v2";
const NATIVE_GAMEPLAY_RECORD_ID_V1: &str = "rust-gameplay-r7-v1";
const NATIVE_RUNTIME_RECORD_ID_V1: &str = "rust-runtime-core-v2";
const NATIVE_CONTENT_RECORD_ID_V1: &str = "rust-content-registry-v1";
const NATIVE_RECORD_MAGIC_V1: &[u8; 4] = b"BWNR";
const NATIVE_RECORD_SCHEMA_V1: u16 = 1;
const NATIVE_RUNTIME_MAGIC_V1: &[u8; 4] = b"BWRC";
const NATIVE_RUNTIME_CORE_SCHEMA_V2: u16 = 2;
const NATIVE_RUNTIME_CORE_SCHEMA_V3: u16 = 3;
const NATIVE_RUNTIME_CORE_SCHEMA_V4: u16 = 4;
const NATIVE_RUNTIME_CORE_SCHEMA_V5: u16 = 5;
const NATIVE_RUNTIME_CORE_SCHEMA_V6: u16 = 6;
const NATIVE_RUNTIME_CORE_SCHEMA_V7: u16 = 7;
const NATIVE_RUNTIME_CORE_SCHEMA_V8: u16 = 8;
const NATIVE_RUNTIME_CORE_SCHEMA_V9: u16 = 9;
const DURABLE_SESSION_NEUTRAL_ID_V1: &str = "blockwild-durable-session-neutral-v1";
const DEFAULT_TERRAIN_CONTENT_HASH_V2: CanonicalHash = CanonicalHash([
    0xcc, 0x59, 0x90, 0x3b, 0xe7, 0x7d, 0xfe, 0x30, 0x10, 0x9d, 0x15, 0xbf, 0xaf, 0x0e, 0x30, 0x22,
]);
pub(crate) const DEFAULT_GENERATION_OPTIONS_JSON_V1: &str = concat!(
    "{\"biomeScale\":1.35,\"caveFrequency\":1,\"enabledFactions\":[\"hobbits\",\"goblins\",",
    "\"atlantians\",\"sugarcourt\",\"wood-elves\",\"dwarves\"],\"largeTownFrequency\":\"balanced\",",
    "\"profile\":\"world-below-v15\",\"resourceAbundance\":1,",
    "\"roadCoverage\":\"regional\",\"settlementClustering\":\"regional\",\"settlementDensity\":1,",
    "\"settlementPattern\":\"heartlands-v2\",\"structures\":true}",
);
const NATIVE_CONTENT_MAGIC_V1: &[u8; 4] = b"BWCT";
const NATIVE_CHECKPOINT_MAGIC_V1: &[u8; 4] = b"BWCK";
const NATIVE_CHECKPOINT_SCHEMA_V1: u16 = 1;
const NATIVE_RECORD_MAX_BYTES_V1: usize = 64 * 1024 * 1024;
// The synchronous Worker control ABI is capped at 8 MiB. Leave room for the
// versioned response envelope and identity fields; larger durable saves use
// the chunked persistence lane instead of allocating an unusable checkpoint.
const NATIVE_CHECKPOINT_MAX_BYTES_V1: usize = 8 * 1024 * 1024 - 1024;
const NATIVE_EXTENSION_MAX_BYTES_V1: usize = 64 * 1024;
const NATIVE_CHECKPOINT_MAX_RECORDS_V1: usize = 8;
const HYDRATION_TRANSFER_TOKEN_BASE_V1: u64 = 4_500_000_000_000_000;
const GAMEPLAY_SCHEDULER_ACTOR_ID_V1: &str = "gameplay-scheduler";
pub const INTEGRATED_RUNTIME_MAX_BLOCK_ACTION_RECEIPTS_V1: usize = 256;
pub const INTEGRATED_RUNTIME_BLOCK_ACTION_RECEIPT_SCHEMA_V1: u16 = 1;
const AUTHORITATIVE_RNG_CONTEXT_UNBOUND_V1: &str = "authoritative-rng-context-unbound";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum IntegratedRuntimeEffectKindV2 {
    Jump = 0,
    Land = 1,
    FallDamage = 2,
    DrownDamage = 3,
    LiquidEnter = 4,
    LiquidExit = 5,
    ShoreExit = 6,
}

#[derive(Clone, Debug, PartialEq)]
pub struct IntegratedRuntimeEffectEventV2 {
    pub sequence: u64,
    pub tick: u64,
    pub entity_external_id: String,
    pub kind: IntegratedRuntimeEffectKindV2,
    pub amount: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct IntegratedRuntimePlayerStateV2 {
    pub binding: RuntimePlayerBindingWireV1,
    pub entity_id: EntityId,
    pub body: PhysicsBodyV1,
    pub contact_flags: u16,
    pub selected_slot: u8,
    pub look_pitch: i16,
    pub buttons: u32,
    pub flags: u8,
    pub last_input_sequence: u64,
}

/// Persistent renderer-neutral camera authority. The revision is the
/// compare-and-set cursor for absolute mode/profile configuration only; look
/// values are replaced by every applied absolute input frame without making
/// browser configuration race the fixed-step input cadence.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IntegratedRuntimeCameraStateV1 {
    pub revision: u64,
    pub mode: CameraModeV1,
    pub profile: CameraProfileV1,
    pub look_yaw: i16,
    pub look_pitch: i16,
}

impl Default for IntegratedRuntimeCameraStateV1 {
    fn default() -> Self {
        Self {
            revision: 0,
            mode: CameraModeV1::FirstPerson,
            profile: CameraProfileV1::default(),
            look_yaw: 0,
            look_pitch: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum IntegratedRuntimeActionTargetV1 {
    Entity(EntityId),
    Block { position: CellPositionV1, normal: [i8; 3] },
    Unloaded,
    None,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum IntegratedRuntimeBlockActionRouteV1 {
    LegacySchema1,
    GeneratedLootV9,
    Blocked,
}

#[derive(Clone, Debug)]
struct IntegratedRuntimeMiningToolV1 {
    held_stack: Option<ItemStack>,
    tool_kind: ContentActionToolKind,
    scythe: bool,
    tier: u16,
    speed_millionths: u64,
    durability_cost_millionths: u32,
    profile_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeMiningStateV1 {
    pub player_entity_id: u64,
    pub target: CellPositionV1,
    pub target_block_id: u16,
    pub world_revision: WorldAuthorityRevisionV1,
    pub selected_slot: u8,
    pub held_item_code: u32,
    pub held_metadata_hash: CanonicalHash,
    pub held_durability_millionths: Option<u32>,
    pub tool_profile_hash: CanonicalHash,
    pub progress_millionths: u64,
    pub required_work_millionths: u64,
    pub started_tick: u64,
    pub last_advanced_tick: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeGeneratedDropReceiptV1 {
    pub provenance: GeneratedDropProvenanceV1,
    pub entity_id: EntityId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeBlockActionReceiptV1 {
    pub schema_version: u16,
    pub plan: BlockActionLootPlanV1,
    pub generated_drops: Vec<IntegratedRuntimeGeneratedDropReceiptV1>,
    pub receipt_hash: CanonicalHash,
}

impl IntegratedRuntimeBlockActionReceiptV1 {
    #[must_use]
    pub fn calculate_hash_v1(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.integrated.block-action-receipt.v1");
        hasher.write_u16(self.schema_version);
        hasher.write_bytes(self.plan.plan_hash.as_bytes());
        hasher.write_u64(self.generated_drops.len() as u64);
        for generated in &self.generated_drops {
            hasher.write_bytes(generated.provenance.canonical_hash_v1().as_bytes());
            hasher.write_u64(generated.entity_id.packed());
        }
        hasher.finish()
    }

    fn validate_shape_v1(&self) -> Result<(), IntegratedRuntimeError> {
        if self.schema_version != INTEGRATED_RUNTIME_BLOCK_ACTION_RECEIPT_SCHEMA_V1
            || self.generated_drops.len() != self.plan.stacks.len()
            || self.generated_drops.len() > blockwild_gameplay::MAX_BLOCK_ACTION_GENERATED_DROPS_V1
        {
            return Err(IntegratedRuntimeError::new(
                "block-action-receipt-shape",
                "block-action receipt schema or generated-drop cardinality is invalid",
            ));
        }
        self.plan
            .validate_hash_v1()
            .map_err(|error| IntegratedRuntimeError::new("block-action-receipt-plan", error.message))?;
        let mut entity_ids = BTreeSet::new();
        for (stack, generated) in self.plan.stacks.iter().zip(&self.generated_drops) {
            generated
                .provenance
                .validate_v1()
                .map_err(|error| IntegratedRuntimeError::new("block-action-receipt-provenance", error.message))?;
            let provenance = &generated.provenance;
            if generated.entity_id.packed() == 0
                || !entity_ids.insert(generated.entity_id)
                || provenance.manifest_hash != self.plan.binding.manifest_hash
                || provenance.installed_registry_hash != self.plan.binding.installed_registry_hash
                || provenance.catalog_blob_hash != self.plan.binding.catalog_blob_hash
                || provenance.action_report_hash != self.plan.binding.action_report_hash
                || provenance.rng_semantics_hash != self.plan.binding.rng_semantics_hash
                || provenance.block_action_sequence != self.plan.context.block_action_sequence
                || provenance.origin_input_sequence != self.plan.context.origin_input_sequence
                || provenance.block_id != self.plan.context.block_id
                || provenance.position != self.plan.context.position
                || provenance.loot_plan_hash != self.plan.plan_hash
                || provenance.group_ordinal != stack.group_ordinal
            {
                return Err(IntegratedRuntimeError::new(
                    "block-action-receipt-provenance",
                    "generated-drop receipt does not exactly derive from its deterministic loot plan",
                ));
            }
        }
        if self.receipt_hash == CanonicalHash::default() || self.receipt_hash != self.calculate_hash_v1() {
            return Err(IntegratedRuntimeError::new(
                "block-action-receipt-hash",
                "block-action receipt hash does not match its canonical fields",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeActionPromotionAssessmentV1 {
    pub installed_report_hash: CanonicalHash,
    pub closed_blockers: Vec<ContentActionPromotionBlockerRecordV1>,
    pub remaining_blockers: Vec<ContentActionPromotionBlockerRecordV1>,
    pub remaining_support_level: ContentActionPromotionSupportLevelV1,
    /// Runtime V9 evidence is deliberately not a production-promotion switch.
    pub capability_authorized: bool,
    pub assessment_hash: CanonicalHash,
}

impl IntegratedRuntimeActionPromotionAssessmentV1 {
    #[must_use]
    pub fn calculate_hash_v1(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.integrated.block-action-promotion-assessment.v1");
        hasher.write_u16(1);
        hasher.write_bytes(self.installed_report_hash.as_bytes());
        hash_action_promotion_blockers_v1(&mut hasher, &self.closed_blockers);
        hash_action_promotion_blockers_v1(&mut hasher, &self.remaining_blockers);
        hasher.write_u16(match self.remaining_support_level {
            ContentActionPromotionSupportLevelV1::LegacyUnproven => 0,
            ContentActionPromotionSupportLevelV1::DeclaredBlocked => 1,
            ContentActionPromotionSupportLevelV1::DeclaredReady => 2,
        });
        hasher.write_u16(u16::from(self.capability_authorized));
        hasher.finish()
    }

    fn with_calculated_hash_v1(mut self) -> Self {
        self.assessment_hash = self.calculate_hash_v1();
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeConfigV2 {
    pub world_seed: String,
    pub universe_id: String,
    pub location_id: String,
    pub session_id: String,
    /// Terrain parity identity is intentionally distinct from the complete
    /// production content manifest used by gameplay/content installation.
    pub terrain_content_hash: CanonicalHash,
    /// Stable-key canonical JSON sealed at runtime creation and checkpointed.
    pub generation_options_json: String,
    pub content_hash: CanonicalHash,
    pub generator_hash: CanonicalHash,
    pub block_catalog: BlockCatalogV1,
}

impl Default for IntegratedRuntimeConfigV2 {
    fn default() -> Self {
        Self {
            world_seed: "blockwild-integrated-runtime".into(),
            universe_id: "1".into(),
            location_id: "blockwild".into(),
            session_id: "local-host".into(),
            terrain_content_hash: DEFAULT_TERRAIN_CONTENT_HASH_V2,
            generation_options_json: DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
            content_hash: CanonicalHash::default(),
            generator_hash: CanonicalHash::default(),
            block_catalog: BlockCatalogV1::default(),
        }
    }
}

impl IntegratedRuntimeConfigV2 {
    fn validate(&self) -> Result<(), IntegratedRuntimeError> {
        if self.world_seed.encode_utf16().count() > 512 {
            return Err(IntegratedRuntimeError::new(
                "invalid-seed",
                "world seed exceeds 512 UTF-16 code units",
            ));
        }
        validate_canonical_generation_options_json_v1(&self.generation_options_json)?;
        AuthorityWorldAddressV1::new(&self.universe_id, &self.location_id)
            .map_err(|error| IntegratedRuntimeError::domain("world", error))?;
        NetworkBrowserAuthorityRuntimeV1::new(self.session_id.clone())
            .map_err(|error| IntegratedRuntimeError::domain("network", error))?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct IntegratedRuntimeRevisionV2 {
    pub epoch: u64,
    pub world: u64,
    pub entities: u64,
    pub gameplay: u64,
    pub persistence: u64,
    pub network: u64,
    pub simulation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeIdentityV2 {
    pub schema_version: u16,
    pub universe_id: String,
    pub location_id: String,
    pub revision: IntegratedRuntimeRevisionV2,
    pub tick: u64,
    pub state_hash: CanonicalHash,
}

#[derive(Clone, Debug)]
pub struct IntegratedRuntimeBatchV2 {
    pub schema_version: u16,
    pub batch_id: String,
    pub expected: IntegratedRuntimeIdentityV2,
    pub world: Vec<WorldMutationBatchR4V1>,
    pub entities: Vec<EntityCommandBatch>,
    pub gameplay: Vec<GameplayBatch>,
    pub world_view: Vec<WorldViewBatchV1>,
    pub persistence: Vec<Transaction>,
    /** Present on every BWRQ command; legacy native callers remain explicit. */
    pub reliability: Option<IntegratedRuntimeReliabilityV2>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeReliabilityV2 {
    pub actor_id: String,
    pub idempotency_key: String,
    /** Exact `blockwild.integrated.wire.checksum.v1` command-body checksum. */
    pub command_hash: [u8; 16],
}

impl IntegratedRuntimeBatchV2 {
    #[must_use]
    pub fn empty(batch_id: impl Into<String>, expected: IntegratedRuntimeIdentityV2) -> Self {
        Self {
            schema_version: INTEGRATED_RUNTIME_SCHEMA_V2,
            batch_id: batch_id.into(),
            expected,
            world: Vec::new(),
            entities: Vec::new(),
            gameplay: Vec::new(),
            world_view: Vec::new(),
            persistence: Vec::new(),
            reliability: None,
        }
    }

    #[must_use]
    pub fn with_reliability(
        mut self,
        actor_id: impl Into<String>,
        idempotency_key: impl Into<String>,
        command_hash: [u8; 16],
    ) -> Self {
        self.reliability = Some(IntegratedRuntimeReliabilityV2 {
            actor_id: actor_id.into(),
            idempotency_key: idempotency_key.into(),
            command_hash,
        });
        self
    }

    fn validate(&self) -> Result<(), IntegratedRuntimeError> {
        if self.schema_version != INTEGRATED_RUNTIME_SCHEMA_V2 {
            return Err(IntegratedRuntimeError::new(
                "schema-mismatch",
                "integrated runtime batch uses an unsupported schema",
            ));
        }
        validate_label(&self.batch_id, "batch id")?;
        if let Some(reliability) = &self.reliability {
            validate_label(&reliability.actor_id, "actor id")?;
            validate_label(&reliability.idempotency_key, "idempotency key")?;
        }
        let count = self.world.len()
            + self.entities.len()
            + self.gameplay.len()
            + self.world_view.len()
            + self.persistence.len();
        if count == 0 || count > INTEGRATED_RUNTIME_MAX_DOMAIN_BATCHES {
            return Err(IntegratedRuntimeError::new(
                "batch-shape",
                format!("integrated batch must contain 1..{INTEGRATED_RUNTIME_MAX_DOMAIN_BATCHES} domain batches"),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct IntegratedRuntimeAcceptedV2 {
    pub batch_id: String,
    pub before: IntegratedRuntimeIdentityV2,
    pub after: IntegratedRuntimeIdentityV2,
    pub world: Vec<WorldMutationReceiptR4V1>,
    pub entities: Vec<EntityEventBatch>,
    pub gameplay: Vec<GameplayReceipt>,
    pub world_view: Vec<WorldViewAcceptedReceiptV1>,
    pub persistence: Vec<JournalCommitReceipt>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeRejectionV2 {
    pub batch_id: String,
    pub code: String,
    pub message: String,
    pub current: IntegratedRuntimeIdentityV2,
}

#[derive(Clone, Debug)]
pub enum IntegratedRuntimeReceiptV2 {
    Accepted(Box<IntegratedRuntimeAcceptedV2>),
    Rejected(IntegratedRuntimeRejectionV2),
}

#[derive(Clone, Debug)]
struct IntegratedRuntimeIdempotencyEntryV2 {
    command_hash: [u8; 16],
    receipt: IntegratedRuntimeReceiptV2,
}

impl IntegratedRuntimeReceiptV2 {
    #[must_use]
    pub const fn accepted(&self) -> bool {
        matches!(self, Self::Accepted(_))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeReplayEntryV2 {
    pub sequence: u64,
    pub batch_id: String,
    pub before_hash: CanonicalHash,
    pub after_hash: CanonicalHash,
    pub receipt_hash: CanonicalHash,
}

#[derive(Clone, Copy, Debug, Default)]
struct IntegratedReplayDigestV2 {
    sum_low: u64,
    sum_high: u64,
    xor_low: u64,
    xor_high: u64,
}

impl IntegratedReplayDigestV2 {
    fn add(&mut self, hash: CanonicalHash) {
        let (low, high) = canonical_hash_lanes(hash);
        self.sum_low = self.sum_low.wrapping_add(low);
        self.sum_high = self.sum_high.wrapping_add(high);
        self.xor_low ^= low;
        self.xor_high ^= high;
    }

    fn remove(&mut self, hash: CanonicalHash) {
        let (low, high) = canonical_hash_lanes(hash);
        self.sum_low = self.sum_low.wrapping_sub(low);
        self.sum_high = self.sum_high.wrapping_sub(high);
        self.xor_low ^= low;
        self.xor_high ^= high;
    }

    fn write_hash(self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.sum_low);
        hasher.write_u64(self.sum_high);
        hasher.write_u64(self.xor_low);
        hasher.write_u64(self.xor_high);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeStepSummaryV2 {
    pub tick: u64,
    pub fixed_steps: u32,
    pub processed_batches: u32,
    pub accepted_batches: u32,
    pub inputs_applied: u32,
    pub action_receipts: Vec<RuntimeInputActionReceiptV1>,
    /// Unsealed semantic receipts. The Wasm boundary seals these only after it
    /// has the exact post-step identity and replay hash carried by StepV2.
    pub semantic_receipts: Vec<RuntimeSemanticActionReceiptV2>,
    pub state_hash: CanonicalHash,
    pub replay_hash: CanonicalHash,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GeneratedChunkInstallSummaryV2 {
    pub chunk_x: i32,
    pub chunk_z: i32,
    pub sections_installed: u16,
    pub markers_installed: u32,
    pub cache_hit: bool,
    pub state_hash: CanonicalHash,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct IntegratedTerrainChunkCoordinateV1 {
    pub chunk_x: i32,
    pub chunk_z: i32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedTerrainResidencyBatchV1 {
    pub expected_world_revision: WorldAuthorityRevisionV1,
    pub generation_options_json: String,
    /// Exact explicit chunk set in `(chunk_x, chunk_z)` canonical order.
    pub chunks: Vec<IntegratedTerrainChunkCoordinateV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum IntegratedTerrainResidencyStatusV1 {
    AlreadyResident = 0,
    Generated = 1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedTerrainResidencyChunkReceiptV1 {
    pub coordinate: IntegratedTerrainChunkCoordinateV1,
    pub status: IntegratedTerrainResidencyStatusV1,
    pub resident_sections: u16,
    pub edit_count: u32,
    pub generation_revision: u32,
    pub request_hash: CanonicalHash,
    pub source_hash: CanonicalHash,
    pub edit_hash: CanonicalHash,
    pub namespace_hash: CanonicalHash,
    pub cache_hit: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedTerrainResidencyReceiptV1 {
    pub previous_world_revision: WorldAuthorityRevisionV1,
    pub world_revision: WorldAuthorityRevisionV1,
    pub requested_chunks: u32,
    pub generated_chunks: u32,
    pub already_resident_chunks: u32,
    pub requested_resident_chunks: u32,
    pub resident_sections: u32,
    pub chunks: Vec<IntegratedTerrainResidencyChunkReceiptV1>,
    pub state_hash: CanonicalHash,
}

struct PreparedTerrainResidencyChunkV1 {
    coordinate: IntegratedTerrainChunkCoordinateV1,
    generation_request: GenerateChunkRequestV2,
    chunk: ChunkPayloadV2,
    cache_hit: bool,
    already_resident: bool,
    edit_hash: CanonicalHash,
    namespace_hash: CanonicalHash,
}

struct PreparedTerrainResidencyV1 {
    previous_world_revision: WorldAuthorityRevisionV1,
    chunks: Vec<PreparedTerrainResidencyChunkV1>,
}

struct AppliedTerrainResidencyV1 {
    previous_world_revision: WorldAuthorityRevisionV1,
    world_revision: WorldAuthorityRevisionV1,
    generated_chunks: u32,
    already_resident_chunks: u32,
    resident_sections: u32,
    chunks: Vec<IntegratedTerrainResidencyChunkReceiptV1>,
}

struct PreparedTerrainResidencyReconcileV2 {
    previous_world_revision: WorldAuthorityRevisionV1,
    desired_set: BTreeSet<(i32, i32)>,
    evicted_chunks: Vec<IntegratedTerrainChunkCoordinateV1>,
}

/// Exact bounded active-ring reconcile. Unlike the additive V1 ensure, this
/// request declares the complete desired resident chunk set.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedTerrainResidencyReconcileBatchV2 {
    pub expected_world_revision: WorldAuthorityRevisionV1,
    pub generation_options_json: String,
    /// Complete desired set in canonical `(chunk_x, chunk_z)` order.
    pub desired_chunks: Vec<IntegratedTerrainChunkCoordinateV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedTerrainResidencyReconcileReceiptV2 {
    pub previous_world_revision: WorldAuthorityRevisionV1,
    pub world_revision: WorldAuthorityRevisionV1,
    pub desired_chunk_count: u32,
    pub generated_chunk_count: u32,
    pub retained_chunk_count: u32,
    pub evicted_chunk_count: u32,
    pub resident_sections: u32,
    pub desired_chunks: Vec<IntegratedTerrainChunkCoordinateV1>,
    pub generated_chunks: Vec<IntegratedTerrainChunkCoordinateV1>,
    pub retained_chunks: Vec<IntegratedTerrainChunkCoordinateV1>,
    pub evicted_chunks: Vec<IntegratedTerrainChunkCoordinateV1>,
    pub state_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeSaveProgressV1 {
    pub stage_id: String,
    pub received_chunks: u32,
    pub chunk_count: u32,
    pub received_bytes: u64,
    pub set_hash: CanonicalHash,
    pub manifest_hash: CanonicalHash,
    pub dispatcher_request_id: Option<u64>,
    pub remaining_dirty_records: u32,
}

pub const INTEGRATED_RUNTIME_LEGACY_MIGRATION_SCHEMA_V1: u16 = 1;
pub const LEGACY_STATE_ENTITIES_V1: u16 = 1 << 0;
pub const LEGACY_STATE_PLAYER_V1: u16 = 1 << 1;
pub const LEGACY_STATE_RUNTIME_CLOCKS_V1: u16 = 1 << 2;
pub const LEGACY_STATE_GAMEPLAY_V1: u16 = 1 << 3;
pub const LEGACY_STATE_MACHINES_V1: u16 = 1 << 4;
pub const LEGACY_STATE_MAP_V1: u16 = 1 << 5;
pub const LEGACY_STATE_NETWORK_V1: u16 = 1 << 6;
pub const LEGACY_STATE_UNKNOWN_V1: u16 = 1 << 15;

/// Deliberately narrow one-time bridge for legacy worlds that contain only an
/// R4-compatible edited-world projection. Any declared richer state blocks
/// migration so the caller can retain the legacy source under its TS owner.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeLegacyMigrationV1 {
    pub schema_version: u16,
    pub migration_id: String,
    pub source_stage_id: String,
    pub created_at: u64,
    pub legacy_non_world_state_flags: u16,
    pub world_projection: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeHydrationSummaryV1 {
    pub recovery_id: String,
    pub native_domains: u16,
    pub chunk_count: u32,
    pub total_bytes: u64,
    pub compatibility_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeHydrationChunkV1 {
    pub transfer_token: u64,
    pub chunk_index: u32,
    pub chunk_count: u32,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct IntegratedRuntimeSaveStageV1 {
    stage_id: String,
    chunk_count: u32,
    total_bytes: u64,
    chunks: BTreeMap<u32, Vec<u8>>,
    chunk_hashes: BTreeMap<u32, CanonicalHash>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct IntegratedRuntimeHydratedExportV1 {
    chunks: Vec<Vec<u8>>,
    total_bytes: u64,
    compatibility_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeContentAttestationV1 {
    pub install_id: String,
    pub source_revision: String,
    pub manifest_hash: CanonicalHash,
    pub domains: BTreeMap<ContentDomain, ContentDomainDigest>,
    pub installed_entries: u32,
    pub installed_bytes: u64,
    pub page_hashes: Vec<CanonicalHash>,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
enum IntegratedRuntimeNativeRecordKindV1 {
    World = 1,
    Entities = 2,
    Gameplay = 3,
    Runtime = 4,
    Content = 5,
    WorldView = 6,
}

impl IntegratedRuntimeNativeRecordKindV1 {
    const ALL: [Self; INTEGRATED_RUNTIME_NATIVE_DOMAIN_COUNT_V1 as usize] = [
        Self::World,
        Self::Entities,
        Self::Gameplay,
        Self::Runtime,
        Self::Content,
        Self::WorldView,
    ];

    fn from_tag(tag: u8) -> Result<Self, IntegratedRuntimeError> {
        match tag {
            1 => Ok(Self::World),
            2 => Ok(Self::Entities),
            3 => Ok(Self::Gameplay),
            4 => Ok(Self::Runtime),
            5 => Ok(Self::Content),
            6 => Ok(Self::WorldView),
            _ => Err(IntegratedRuntimeError::new(
                "native-record-kind",
                "native save record kind is unknown",
            )),
        }
    }

    const fn address(self) -> (RecordKind, &'static str) {
        match self {
            Self::World => (RecordKind::ChunkEdits, NATIVE_WORLD_RECORD_ID_V1),
            Self::Entities => (RecordKind::Entity, NATIVE_ENTITY_RECORD_ID_V2),
            Self::Gameplay => (RecordKind::ActorDigest, NATIVE_GAMEPLAY_RECORD_ID_V1),
            Self::Runtime => (RecordKind::Player, NATIVE_RUNTIME_RECORD_ID_V1),
            Self::Content => (RecordKind::SettingsReference, NATIVE_CONTENT_RECORD_ID_V1),
            Self::WorldView => (
                RecordKind::MapKnowledge,
                crate::INTEGRATED_RUNTIME_WORLD_VIEW_RECORD_ID_V1,
            ),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct IntegratedRuntimeNativeEnvelopeV1 {
    kind: IntegratedRuntimeNativeRecordKindV1,
    universe_id: String,
    location_id: String,
    generator_hash: CanonicalHash,
    content_hash: CanonicalHash,
    bundle_hash: CanonicalHash,
    body: Vec<u8>,
}

#[derive(Clone, Debug)]
struct IntegratedRuntimeContentSnapshotV1 {
    attestation: Option<IntegratedRuntimeContentAttestationV1>,
    artifacts: Vec<ContentArtifact>,
    unknown_extension_bytes: Vec<u8>,
}

type RuntimeContentIndexV1 = BTreeMap<(ContentDomain, String), CanonicalHash>;

#[derive(Clone, Debug, Eq, PartialEq)]
struct IntegratedRuntimeCommandReceiptCacheEntryV1 {
    command_hash: WireHash,
    receipt: RuntimeCommandReceiptV1,
    encoded_receipt: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimeCommandCacheLookupV1 {
    Miss,
    Exact(Box<RuntimeCommandReceiptV1>),
    Conflict,
}

/// Exact renderer-facing ownership for one role-specific presentation binding.
///
/// The hash and revision identify the distinct render-presentation content
/// record. `model_id` identifies the pinned BWM2 model inside that record's
/// catalog; neither field borrows creature-profile identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IntegratedRuntimeRenderPresentationBindingV1<'a> {
    Exact {
        profile_id: &'a str,
        model_id: &'a str,
        content_hash: CanonicalHash,
        content_version: u32,
    },
    Missing {
        blocker_id: &'a str,
    },
    Unmapped,
}

#[derive(Clone, Debug)]
struct IntegratedRuntimeCoreSnapshotV1 {
    schema: u16,
    config: IntegratedRuntimeConfigV2,
    expected_revision: IntegratedRuntimeRevisionV2,
    tick: u64,
    last_monotonic_time_us: u64,
    accumulator_us: u64,
    rng_state: u32,
    network_revision: u64,
    simulation_revision: u64,
    gameplay_authority_revision: u64,
    entity_command_sequence: u64,
    camera: IntegratedRuntimeCameraStateV1,
    player: Option<IntegratedRuntimePlayerStateV2>,
    effect_events: VecDeque<IntegratedRuntimeEffectEventV2>,
    next_effect_sequence: u64,
    queued_inputs: VecDeque<RuntimeInputFrameV1>,
    last_input_sequence: Option<u64>,
    last_applied_input: Option<RuntimeInputFrameV1>,
    next_action_sequence: u64,
    queued_context_commands: VecDeque<RuntimeContextCommandV2>,
    next_context_command_sequence: Option<u64>,
    mining_state: Option<IntegratedRuntimeMiningStateV1>,
    block_action_loot_rng: BlockActionLootRngCursorV1,
    next_block_action_sequence: Option<u64>,
    block_action_receipts: VecDeque<IntegratedRuntimeBlockActionReceiptV1>,
    replay: VecDeque<IntegratedRuntimeReplayEntryV2>,
    command_receipts: BTreeMap<(String, String), IntegratedRuntimeCommandReceiptCacheEntryV1>,
    command_receipt_order: VecDeque<(String, String)>,
    command_receipt_bytes: usize,
    compatibility_journal: JournalState,
    durable_network_drained_proof: Option<CanonicalHash>,
    durable_state_proof: Option<CanonicalHash>,
    durable_replay_proof: Option<CanonicalHash>,
    unknown_extension_bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
struct IntegratedRuntimeNativeBundleV1 {
    bundle_hash: CanonicalHash,
    envelopes: BTreeMap<IntegratedRuntimeNativeRecordKindV1, IntegratedRuntimeNativeEnvelopeV1>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct IntegratedRuntimeEntityScheduleDiagnosticsV1 {
    pub entity_jobs_completed: u64,
    pub entity_jobs_rejected_stale: u64,
    pub ecology_jobs_completed: u64,
    pub ecology_jobs_rejected_stale: u64,
    pub path_jobs_completed: u64,
    pub path_jobs_rejected_stale: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct IntegratedRuntimeContentStageV1 {
    install_id: String,
    source_revision: String,
    manifest_hash: CanonicalHash,
    domains: BTreeMap<ContentDomain, ContentDomainDigest>,
    page_count: u32,
    page_hashes: Vec<CanonicalHash>,
    artifacts: Vec<ContentArtifact>,
}

#[derive(Clone)]
pub struct IntegratedRuntimeV2 {
    config: IntegratedRuntimeConfigV2,
    world: WorldAuthorityStoreR4V1,
    generation: Arc<GenerationService>,
    entities: EntityAuthority,
    gameplay: GameplayAuthority,
    world_view: WorldViewAuthorityV1,
    gameplay_content_store: MetadataBlobStore,
    gameplay_content_index: RuntimeContentIndexV1,
    gameplay_content_runtime: ContentRuntimeRegistry,
    content_stage: Option<IntegratedRuntimeContentStageV1>,
    content_attestation: Option<IntegratedRuntimeContentAttestationV1>,
    native_world_extension_bytes: Vec<u8>,
    native_runtime_extension_bytes: Vec<u8>,
    native_content_extension_bytes: Vec<u8>,
    native_gameplay_extension_bytes: Vec<u8>,
    native_world_view_extension_bytes: Vec<u8>,
    persistence: JournalState,
    persistence_authority: PersistenceAuthorityV1,
    persistence_dispatcher: PersistenceDispatcherV1,
    save_stages: BTreeMap<String, IntegratedRuntimeSaveStageV1>,
    prepared_persistence_commits: BTreeMap<u64, PreparedAuthorityCommitV1>,
    latest_commit_created_at: u64,
    recovery_assemblers: BTreeMap<String, PagedRecoveryAssemblerV1>,
    recovered_save_sets: BTreeMap<String, PagedRecoveryCompleteV1>,
    hydrated_exports: BTreeMap<String, IntegratedRuntimeHydratedExportV1>,
    next_hydration_transfer_token: u64,
    network: NetworkBrowserAuthorityRuntimeV1,
    /// True only while no network/grant/receiver mutation has occurred since
    /// construction or a native hydrate reset. It is deliberately
    /// conservative: once network authority has been exercised the runtime
    /// must start a fresh session before emitting a session-rebindable save.
    durable_network_state_pristine: bool,
    replication: InterestIndexV1,
    replication_record_hashes: BTreeMap<String, CanonicalHash>,
    tick: u64,
    last_monotonic_time_us: u64,
    accumulator_us: u64,
    rng_state: u32,
    network_revision: u64,
    simulation_revision: u64,
    gameplay_authority_revision: u64,
    entity_command_sequence: u64,
    entity_scheduler: EntityScheduler,
    entity_ecology_jobs: EcologyJobQueue,
    entity_ecology_revisions: BTreeMap<[i32; 2], u64>,
    entity_sectors: BTreeMap<EntityId, [i32; 2]>,
    entity_sector_counts: BTreeMap<[i32; 2], u32>,
    entity_path_jobs: PathJobQueue,
    entity_schedule_diagnostics: IntegratedRuntimeEntityScheduleDiagnosticsV1,
    camera: IntegratedRuntimeCameraStateV1,
    player: Option<IntegratedRuntimePlayerStateV2>,
    effect_events: VecDeque<IntegratedRuntimeEffectEventV2>,
    next_effect_sequence: u64,
    queued_inputs: VecDeque<RuntimeInputFrameV1>,
    last_input_sequence: Option<u64>,
    last_applied_input: Option<RuntimeInputFrameV1>,
    next_action_sequence: u64,
    queued_context_commands: VecDeque<RuntimeContextCommandV2>,
    next_context_command_sequence: Option<u64>,
    mining_state: Option<IntegratedRuntimeMiningStateV1>,
    block_action_loot_rng: BlockActionLootRngCursorV1,
    next_block_action_sequence: Option<u64>,
    block_action_receipts: VecDeque<IntegratedRuntimeBlockActionReceiptV1>,
    command_receipts: BTreeMap<(String, String), IntegratedRuntimeCommandReceiptCacheEntryV1>,
    command_receipt_order: VecDeque<(String, String)>,
    command_receipt_bytes: usize,
    queued: VecDeque<IntegratedRuntimeBatchV2>,
    receipts: VecDeque<IntegratedRuntimeReceiptV2>,
    replay: VecDeque<IntegratedRuntimeReplayEntryV2>,
    replay_digest: IntegratedReplayDigestV2,
    idempotency: BTreeMap<String, IntegratedRuntimeIdempotencyEntryV2>,
    idempotency_order: VecDeque<String>,
    state_hash_cache: Cell<Option<CanonicalHash>>,
    stopped: bool,
}

impl IntegratedRuntimeV2 {
    pub fn new(config: IntegratedRuntimeConfigV2) -> Result<Self, IntegratedRuntimeError> {
        config.validate()?;
        let address = AuthorityWorldAddressV1::new(&config.universe_id, &config.location_id)
            .map_err(|error| IntegratedRuntimeError::domain("world", error))?;
        let world = WorldAuthorityStoreR4V1::new(address, config.block_catalog.clone())
            .map_err(|error| IntegratedRuntimeError::domain("world", error))?;
        let mut gameplay = GameplayAuthority::new(GameplayState::new(
            WorldKey::new(&config.universe_id, &config.location_id),
            1,
        ));
        gameplay
            .grant_actor(GAMEPLAY_SCHEDULER_ACTOR_ID_V1, ActorGrant::system())
            .map_err(|error| IntegratedRuntimeError::new("gameplay-scheduler-grant", error.message))?;
        let world_view =
            initialize_world_view_authority_v1(WorldKey::new(&config.universe_id, &config.location_id), 1, "system")
                .map_err(|error| IntegratedRuntimeError::new("world-view-init", error.to_string()))?;
        let network = NetworkBrowserAuthorityRuntimeV1::new(config.session_id.clone())
            .map_err(|error| IntegratedRuntimeError::domain("network", error))?;
        let persistence_dispatcher = PersistenceDispatcherV1::new(PersistenceDispatcherLimitsV1 {
            max_pending: INTEGRATED_RUNTIME_PERSISTENCE_MAX_PENDING,
            max_queued_bytes: INTEGRATED_RUNTIME_PERSISTENCE_MAX_QUEUED_BYTES,
            max_packet_bytes: INTEGRATED_RUNTIME_PERSISTENCE_MAX_PACKET_BYTES,
            max_completed: INTEGRATED_RUNTIME_PERSISTENCE_MAX_COMPLETED,
            max_retries: INTEGRATED_RUNTIME_PERSISTENCE_MAX_RETRIES,
        })
        .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatcher", error))?;
        let persistence_authority = PersistenceAuthorityV1::empty(
            format!("{}@{}", config.universe_id, config.location_id),
            config.generator_hash,
            config.content_hash,
        )
        .map_err(|error| IntegratedRuntimeError::domain("persistence-authority", error))?;
        let rng_state = seed_stream(&config.world_seed, "integrated-runtime-v2");
        let block_action_loot_rng = BlockActionLootRngCursorV1::from_seed_v1(&config.world_seed);
        Ok(Self {
            config,
            world,
            generation: Arc::new(GenerationService::default()),
            entities: EntityAuthority::default(),
            gameplay,
            world_view,
            gameplay_content_store: MetadataBlobStore::default(),
            gameplay_content_index: BTreeMap::new(),
            gameplay_content_runtime: ContentRuntimeRegistry::default(),
            content_stage: None,
            content_attestation: None,
            native_world_extension_bytes: Vec::new(),
            native_runtime_extension_bytes: Vec::new(),
            native_content_extension_bytes: Vec::new(),
            native_gameplay_extension_bytes: Vec::new(),
            native_world_view_extension_bytes: Vec::new(),
            persistence: JournalState::default(),
            persistence_authority,
            persistence_dispatcher,
            save_stages: BTreeMap::new(),
            prepared_persistence_commits: BTreeMap::new(),
            latest_commit_created_at: 0,
            recovery_assemblers: BTreeMap::new(),
            recovered_save_sets: BTreeMap::new(),
            hydrated_exports: BTreeMap::new(),
            next_hydration_transfer_token: HYDRATION_TRANSFER_TOKEN_BASE_V1,
            network,
            durable_network_state_pristine: true,
            replication: InterestIndexV1::default(),
            replication_record_hashes: BTreeMap::new(),
            tick: 0,
            last_monotonic_time_us: 0,
            accumulator_us: 0,
            rng_state,
            network_revision: 0,
            simulation_revision: 0,
            gameplay_authority_revision: 0,
            entity_command_sequence: 0,
            entity_scheduler: EntityScheduler::default(),
            entity_ecology_jobs: EcologyJobQueue::default(),
            entity_ecology_revisions: BTreeMap::new(),
            entity_sectors: BTreeMap::new(),
            entity_sector_counts: BTreeMap::new(),
            entity_path_jobs: PathJobQueue::default(),
            entity_schedule_diagnostics: IntegratedRuntimeEntityScheduleDiagnosticsV1::default(),
            camera: IntegratedRuntimeCameraStateV1::default(),
            player: None,
            effect_events: VecDeque::new(),
            next_effect_sequence: 1,
            queued_inputs: VecDeque::new(),
            last_input_sequence: None,
            last_applied_input: None,
            next_action_sequence: 1,
            queued_context_commands: VecDeque::new(),
            next_context_command_sequence: Some(1),
            mining_state: None,
            block_action_loot_rng,
            next_block_action_sequence: Some(1),
            block_action_receipts: VecDeque::new(),
            command_receipts: BTreeMap::new(),
            command_receipt_order: VecDeque::new(),
            command_receipt_bytes: 0,
            queued: VecDeque::new(),
            receipts: VecDeque::new(),
            replay: VecDeque::new(),
            replay_digest: IntegratedReplayDigestV2::default(),
            idempotency: BTreeMap::new(),
            idempotency_order: VecDeque::new(),
            state_hash_cache: Cell::new(None),
            stopped: false,
        })
    }

    #[must_use]
    pub const fn config(&self) -> &IntegratedRuntimeConfigV2 {
        &self.config
    }

    #[must_use]
    pub fn world(&self) -> &WorldAuthorityStoreR4V1 {
        &self.world
    }

    pub fn world_mut_for_platform_install(&mut self) -> &mut WorldAuthorityStoreR4V1 {
        self.invalidate_state_hash();
        &mut self.world
    }

    #[must_use]
    pub fn entities(&self) -> &EntityAuthority {
        &self.entities
    }

    #[must_use]
    pub const fn world_view(&self) -> &WorldViewAuthorityV1 {
        &self.world_view
    }

    pub fn world_view_extraction(&self) -> Result<WorldViewExtractionInputV1, IntegratedRuntimeError> {
        collect_world_view_extraction_v1(&self.world_view.state, &self.gameplay.state, &self.entities)
            .map_err(|error| IntegratedRuntimeError::new("world-view-extraction", error.to_string()))
    }

    #[must_use]
    pub const fn entity_schedule_diagnostics(&self) -> IntegratedRuntimeEntityScheduleDiagnosticsV1 {
        self.entity_schedule_diagnostics
    }

    pub fn export_entity_authority_snapshot(&self, expected_revision: u64) -> Result<Vec<u8>, IntegratedRuntimeError> {
        self.ensure_running()?;
        if expected_revision != self.entities.revision() {
            return Err(IntegratedRuntimeError::new(
                "entity-snapshot-stale",
                "entity authority export references a stale revision",
            ));
        }
        encode_entity_authority_snapshot(&self.entities)
            .map_err(|error| IntegratedRuntimeError::new("entity-snapshot", error.to_string()))
    }

    pub fn import_entity_authority_snapshot(
        &mut self,
        expected_revision: u64,
        snapshot: &[u8],
    ) -> Result<EntityAuthorityImportReceiptWireV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        let previous_revision = self.entities.revision();
        if expected_revision != previous_revision {
            return Err(IntegratedRuntimeError::new(
                "entity-snapshot-stale",
                "entity authority import references a stale revision",
            ));
        }
        let imported = decode_entity_authority_snapshot(snapshot)
            .map_err(|error| IntegratedRuntimeError::new("entity-snapshot", error.to_string()))?;
        if !self.entities.is_empty() && imported.revision() < previous_revision {
            return Err(IntegratedRuntimeError::new(
                "entity-snapshot-rollback",
                "a live non-empty authority cannot be replaced by an older snapshot",
            ));
        }
        let last_sequence = entity_snapshot_last_sequence(snapshot)?;
        let mut candidate = self.clone();
        candidate.entities = imported;
        candidate.entity_command_sequence = last_sequence.unwrap_or_default();
        candidate.rebuild_entity_schedules()?;
        candidate
            .validate_runtime_cross_domain_links_v1()
            .map_err(|error| IntegratedRuntimeError::new("entity-snapshot-world-view", error.message))?;
        if candidate
            .player
            .as_ref()
            .is_some_and(|player| !candidate.entities.contains(player.entity_id))
        {
            return Err(IntegratedRuntimeError::new(
                "entity-snapshot-player",
                "entity snapshot would orphan the bound authoritative player",
            ));
        }
        candidate.invalidate_state_hash();
        let receipt = EntityAuthorityImportReceiptWireV1 {
            previous_revision,
            revision: candidate.entities.revision(),
            entity_count: candidate.entities.len() as u32,
            state_hash: candidate.entities.canonical_hash(),
        };
        *self = candidate;
        Ok(receipt)
    }

    pub fn export_entity_compatibility_record(
        &self,
        id: EntityId,
        expected_entity_revision: u64,
    ) -> Result<Vec<u8>, IntegratedRuntimeError> {
        self.ensure_running()?;
        if self.entities.entity_revision(id) != Some(expected_entity_revision) {
            return Err(IntegratedRuntimeError::new(
                "entity-compatibility-stale",
                "entity compatibility export references a stale entity revision",
            ));
        }
        let record = self.entities.compatibility_record(id).ok_or_else(|| {
            IntegratedRuntimeError::new(
                "entity-compatibility-missing",
                "entity compatibility export target is missing",
            )
        })?;
        encode_compatibility_record(record)
            .map_err(|error| IntegratedRuntimeError::new("entity-compatibility", error.to_string()))
    }

    pub fn import_entity_compatibility_record(
        &mut self,
        import: EntityCompatibilityImportWireV1,
    ) -> Result<EntityEventBatch, IntegratedRuntimeError> {
        self.ensure_running()?;
        let record_bytes = encode_compatibility_record(&import.record)
            .map_err(|error| IntegratedRuntimeError::new("entity-compatibility", error.to_string()))?;
        let record = decode_compatibility_record(&record_bytes)
            .map_err(|error| IntegratedRuntimeError::new("entity-compatibility", error.to_string()))?;
        let command = match import.desired_id {
            None => EntityCommand::Spawn {
                record,
                residency: import.residency,
            },
            Some(id) => EntityCommand::SpawnAt {
                id,
                record,
                residency: import.residency,
            },
        };
        let receipt = self
            .entities
            .apply_batch(&EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence: import.sequence,
                expected_revision: import.expected_revision,
                tick: import.tick,
                commands: vec![command],
            })
            .map_err(|error| IntegratedRuntimeError::new("entity-compatibility", error.to_string()))?;
        self.entity_command_sequence = self.entity_command_sequence.max(receipt.sequence);
        self.sync_entity_schedules(std::slice::from_ref(&receipt))?;
        self.invalidate_state_hash();
        Ok(receipt)
    }

    #[must_use]
    pub fn gameplay(&self) -> &GameplayAuthority {
        &self.gameplay
    }

    #[must_use]
    pub fn content_attestation(&self) -> Option<&IntegratedRuntimeContentAttestationV1> {
        self.content_attestation.as_ref()
    }

    #[must_use]
    pub const fn content_ready(&self) -> bool {
        self.content_attestation.is_some()
    }

    /// Returns the manifest fingerprint the runtime was created to execute.
    ///
    /// This remains available before content installation so extraction clients
    /// can reject assets compiled for a different manifest. `content_ready`
    /// distinguishes an installed/attested manifest from the configured target.
    #[must_use]
    pub const fn content_manifest_hash(&self) -> CanonicalHash {
        self.config.content_hash
    }

    #[must_use]
    pub const fn block_action_loot_rng_v1(&self) -> BlockActionLootRngCursorV1 {
        self.block_action_loot_rng
    }

    #[must_use]
    pub const fn next_block_action_sequence_v1(&self) -> Option<u64> {
        self.next_block_action_sequence
    }

    #[must_use]
    pub const fn block_action_receipts_v1(&self) -> &VecDeque<IntegratedRuntimeBlockActionReceiptV1> {
        &self.block_action_receipts
    }

    pub fn block_action_promotion_assessment_v1(
        &self,
    ) -> Result<Option<IntegratedRuntimeActionPromotionAssessmentV1>, IntegratedRuntimeError> {
        let Some(report) = self
            .gameplay_content_runtime
            .action_promotion_report_v1()
            .map_err(|errors| {
                IntegratedRuntimeError::new(
                    "block-action-promotion-report",
                    format!(
                        "installed action-promotion report has {} validation error(s)",
                        errors.len()
                    ),
                )
            })?
        else {
            return Ok(None);
        };
        if report.block_action_catalog_schema_version != 2 {
            return Ok(Some(
                IntegratedRuntimeActionPromotionAssessmentV1 {
                    installed_report_hash: report.report_hash,
                    closed_blockers: Vec::new(),
                    remaining_blockers: report.blockers,
                    remaining_support_level: ContentActionPromotionSupportLevelV1::LegacyUnproven,
                    capability_authorized: false,
                    assessment_hash: CanonicalHash::default(),
                }
                .with_calculated_hash_v1(),
            ));
        }
        let (closed_blockers, remaining_blockers): (Vec<_>, Vec<_>) = report
            .blockers
            .into_iter()
            .partition(|blocker| blocker.blocker_id == AUTHORITATIVE_RNG_CONTEXT_UNBOUND_V1);
        let remaining_support_level = if remaining_blockers.is_empty() {
            ContentActionPromotionSupportLevelV1::DeclaredReady
        } else {
            ContentActionPromotionSupportLevelV1::DeclaredBlocked
        };
        Ok(Some(
            IntegratedRuntimeActionPromotionAssessmentV1 {
                installed_report_hash: report.report_hash,
                closed_blockers,
                remaining_blockers,
                remaining_support_level,
                capability_authorized: false,
                assessment_hash: CanonicalHash::default(),
            }
            .with_calculated_hash_v1(),
        ))
    }

    /// Resolves the installed creature-profile blob that owns a render model.
    ///
    /// Authored content currently keys creature profiles by either the explicit
    /// model key or the creature kind. Missing content is represented by `None`;
    /// callers must not fabricate a revision or hash for an unresolved model.
    #[must_use]
    pub fn entity_model_content_identity(&self, model_key: &str, kind_key: &str) -> Option<(CanonicalHash, u32)> {
        [model_key, kind_key].into_iter().find_map(|key| {
            let hash = self
                .gameplay_content_index
                .get(&(ContentDomain::CreatureProfile, key.to_owned()))?;
            let blob = self.gameplay_content_store.get(*hash)?;
            Some((blob.hash, blob.content_version))
        })
    }

    /// Resolves a dropped stack through the installed role-specific
    /// presentation catalog. Missing and unmapped items remain distinguishable
    /// so extraction callers can fail closed without borrowing creature model
    /// identity or inventing a fallback.
    #[must_use]
    pub fn dropped_item_render_presentation_binding_v1(
        &self,
        item_code: u32,
    ) -> IntegratedRuntimeRenderPresentationBindingV1<'_> {
        let item_id = item_code.to_string();
        self.render_presentation_binding_v1(
            ContentRenderPresentationRole::DroppedItem,
            ContentDomain::Item,
            &item_id,
        )
    }

    /// Resolves one role/content-reference binding from the installed immutable
    /// presentation catalog. Callers must still choose the authoritative role;
    /// this method never crosses roles or falls back through creature content.
    #[must_use]
    pub fn render_presentation_binding_v1(
        &self,
        role: ContentRenderPresentationRole,
        domain: ContentDomain,
        id: &str,
    ) -> IntegratedRuntimeRenderPresentationBindingV1<'_> {
        Self::integrated_render_presentation_binding_v1(
            self.gameplay_content_runtime
                .render_presentation_binding(role, domain, id),
        )
    }

    /// Resolves a persisted presentation profile id for an authoritative role.
    /// The id is deliberately not reinterpreted as a content-ref or BWM2 model.
    #[must_use]
    pub fn render_presentation_profile_binding_v1(
        &self,
        role: ContentRenderPresentationRole,
        presentation_id: &str,
    ) -> IntegratedRuntimeRenderPresentationBindingV1<'_> {
        Self::integrated_render_presentation_binding_v1(
            self.gameplay_content_runtime
                .render_presentation_profile_binding(role, presentation_id),
        )
    }

    #[must_use]
    pub fn machine_anchor_render_presentation_binding_v1(
        &self,
        presentation_id: &str,
    ) -> IntegratedRuntimeRenderPresentationBindingV1<'_> {
        self.render_presentation_profile_binding_v1(ContentRenderPresentationRole::Machine, presentation_id)
    }

    /// Resolve a combat role by its persisted profile id, then require that
    /// the command's explicit primary content ref belongs to that exact
    /// profile. This prevents a valid profile id from being paired with a
    /// different item/creature and avoids ambiguous ref-first summon lookup.
    #[must_use]
    pub fn combat_render_presentation_binding_v1(
        &self,
        role: ContentRenderPresentationRole,
        presentation_id: &str,
        domain: ContentDomain,
        content_id: &str,
    ) -> IntegratedRuntimeRenderPresentationBindingV1<'_> {
        match self
            .gameplay_content_runtime
            .render_presentation_profile_binding(role, presentation_id)
        {
            ContentRenderPresentationBinding::Exact { catalog, profile }
                if profile
                    .content_refs
                    .iter()
                    .any(|reference| reference.domain == domain && reference.id == content_id) =>
            {
                if role == ContentRenderPresentationRole::Summon
                    && !profile
                        .content_refs
                        .iter()
                        .any(|reference| reference.domain == ContentDomain::AbilitySpell)
                {
                    return IntegratedRuntimeRenderPresentationBindingV1::Unmapped;
                }
                Self::integrated_render_presentation_binding_v1(ContentRenderPresentationBinding::Exact {
                    catalog,
                    profile,
                })
            }
            ContentRenderPresentationBinding::Exact { .. } => IntegratedRuntimeRenderPresentationBindingV1::Unmapped,
            ContentRenderPresentationBinding::Missing { catalog, blocker }
                if blocker
                    .content_refs
                    .iter()
                    .any(|reference| reference.domain == domain && reference.id == content_id) =>
            {
                if role == ContentRenderPresentationRole::Summon
                    && !blocker
                        .content_refs
                        .iter()
                        .any(|reference| reference.domain == ContentDomain::AbilitySpell)
                {
                    return IntegratedRuntimeRenderPresentationBindingV1::Unmapped;
                }
                Self::integrated_render_presentation_binding_v1(ContentRenderPresentationBinding::Missing {
                    catalog,
                    blocker,
                })
            }
            ContentRenderPresentationBinding::Missing { .. } => IntegratedRuntimeRenderPresentationBindingV1::Unmapped,
            binding => Self::integrated_render_presentation_binding_v1(binding),
        }
    }

    #[must_use]
    pub fn projectile_render_presentation_binding_v1(
        &self,
        presentation_id: &str,
        domain: ContentDomain,
        content_id: &str,
    ) -> IntegratedRuntimeRenderPresentationBindingV1<'_> {
        self.combat_render_presentation_binding_v1(
            ContentRenderPresentationRole::Projectile,
            presentation_id,
            domain,
            content_id,
        )
    }

    #[must_use]
    pub fn summon_render_presentation_binding_v1(
        &self,
        presentation_id: &str,
        domain: ContentDomain,
        content_id: &str,
    ) -> IntegratedRuntimeRenderPresentationBindingV1<'_> {
        self.combat_render_presentation_binding_v1(
            ContentRenderPresentationRole::Summon,
            presentation_id,
            domain,
            content_id,
        )
    }

    fn validate_combat_presentation_bindings_v1(&self) -> Result<(), IntegratedRuntimeError> {
        for projectile in self.gameplay.state.combat.projectiles.values() {
            let Some(link) = &projectile.presentation else {
                continue;
            };
            if link.content_domain != ContentDomain::Item
                || matches!(
                    self.combat_render_presentation_binding_v1(
                        ContentRenderPresentationRole::Projectile,
                        &link.presentation_id,
                        link.content_domain,
                        &link.content_id,
                    ),
                    IntegratedRuntimeRenderPresentationBindingV1::Unmapped
                )
            {
                return Err(IntegratedRuntimeError::new(
                    "combat-projectile-presentation",
                    "projectile presentation id and primary content ref do not identify one authored role profile",
                ));
            }
        }
        for summon in self.gameplay.state.combat.summons.values() {
            let Some(link) = &summon.presentation else {
                continue;
            };
            if link.content_domain != ContentDomain::CreatureProfile
                || summon.content_id != link.content_id
                || matches!(
                    self.combat_render_presentation_binding_v1(
                        ContentRenderPresentationRole::Summon,
                        &link.presentation_id,
                        link.content_domain,
                        &link.content_id,
                    ),
                    IntegratedRuntimeRenderPresentationBindingV1::Unmapped
                )
            {
                return Err(IntegratedRuntimeError::new(
                    "combat-summon-presentation",
                    "summon presentation id and creature content ref do not identify one authored role profile",
                ));
            }
        }
        Ok(())
    }

    fn validate_runtime_cross_domain_links_v1(&self) -> Result<(), IntegratedRuntimeError> {
        validate_world_view_runtime_links_v1(&self.world_view.state, &self.gameplay.state, &self.entities)
            .map_err(|error| IntegratedRuntimeError::new("runtime-cross-domain-links", error.to_string()))?;
        let linked_player_combatant = self.gameplay.state.combat.combatants.values().find(|combatant| {
            combatant.entity_id.is_some()
                && self.world_view.state.player_bindings.values().any(|binding| {
                    binding.actor_id == combatant.record_id || Some(binding.entity_id) == combatant.entity_id
                })
        });
        let Some(linked_player_combatant) = linked_player_combatant else {
            return Ok(());
        };
        let Some(player) = &self.player else {
            return Err(IntegratedRuntimeError::new(
                "runtime-player-combat-link",
                "player-bound R7 combatant exists without the runtime player authority",
            ));
        };
        let binding = self
            .world_view
            .state
            .player_binding(player.binding.player_id)
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "runtime-player-link",
                    "bound runtime player has no matching world-view player binding",
                )
            })?;
        let entity = self.entities.hot().get(&player.entity_id).ok_or_else(|| {
            IntegratedRuntimeError::new(
                "runtime-player-link",
                "bound runtime player references an absent, stale, or cold R6 entity",
            )
        })?;
        if binding.actor_id != player.binding.actor_id
            || binding.player_id != player.binding.player_id
            || binding.entity_id != player.entity_id
            || entity.record.class != EntityClass::Player
            || entity.record.external_entity_id != player.binding.external_entity_id
        {
            return Err(IntegratedRuntimeError::new(
                "runtime-player-link",
                "runtime player, world-view binding, and R6 player entity disagree",
            ));
        }
        if linked_player_combatant.record_id != binding.actor_id
            || linked_player_combatant.owner_id.as_deref() != Some(binding.actor_id.as_str())
            || linked_player_combatant.entity_id != Some(binding.entity_id)
        {
            return Err(IntegratedRuntimeError::new(
                "runtime-player-combat-link",
                "linked player combatant disagrees with runtime and world-view player authority",
            ));
        }
        Ok(())
    }

    /// Creation is stricter than restore: an installed blocker may keep an
    /// already-persisted link loadable and extraction-blocked, but new linked
    /// authority can only be created from an exact authored profile.
    fn validate_new_combat_presentation_commands_v1(
        &self,
        batch: &GameplayBatch,
    ) -> Result<(), IntegratedRuntimeError> {
        for command in &batch.commands {
            let GameplayCommand::Combat(command) = command else {
                continue;
            };
            let (role, presentation_id, domain, content_id, error_code) = match command {
                CombatCommand::UseLinkedProjectile {
                    presentation_id,
                    content_domain,
                    content_id,
                    ..
                } => (
                    ContentRenderPresentationRole::Projectile,
                    presentation_id,
                    *content_domain,
                    content_id,
                    "combat-projectile-presentation",
                ),
                CombatCommand::SummonLinked {
                    presentation_id,
                    content_domain,
                    content_id,
                    ..
                } => (
                    ContentRenderPresentationRole::Summon,
                    presentation_id,
                    *content_domain,
                    content_id,
                    "combat-summon-presentation",
                ),
                _ => continue,
            };
            let role_domain_is_exact = match role {
                ContentRenderPresentationRole::Projectile => domain == ContentDomain::Item,
                ContentRenderPresentationRole::Summon => domain == ContentDomain::CreatureProfile,
                _ => false,
            };
            if !role_domain_is_exact
                || !matches!(
                    self.combat_render_presentation_binding_v1(role, presentation_id, domain, content_id),
                    IntegratedRuntimeRenderPresentationBindingV1::Exact { .. }
                )
            {
                return Err(IntegratedRuntimeError::new(
                    error_code,
                    "new linked combat authority requires one exact authored role profile and primary content ref",
                ));
            }
        }
        Ok(())
    }

    fn integrated_render_presentation_binding_v1<'a>(
        binding: ContentRenderPresentationBinding<'a>,
    ) -> IntegratedRuntimeRenderPresentationBindingV1<'a> {
        match binding {
            ContentRenderPresentationBinding::Exact { catalog, profile } => {
                IntegratedRuntimeRenderPresentationBindingV1::Exact {
                    profile_id: &profile.id,
                    model_id: &profile.model.model_id,
                    content_hash: catalog.core.blob_hash,
                    content_version: catalog.core.content_version,
                }
            }
            ContentRenderPresentationBinding::Missing { blocker, .. } => {
                IntegratedRuntimeRenderPresentationBindingV1::Missing {
                    blocker_id: &blocker.id,
                }
            }
            ContentRenderPresentationBinding::Unmapped => IntegratedRuntimeRenderPresentationBindingV1::Unmapped,
        }
    }

    #[must_use]
    pub fn gameplay_content_store(&self) -> &MetadataBlobStore {
        &self.gameplay_content_store
    }

    #[must_use]
    pub fn gameplay_content_registry_len(&self) -> usize {
        self.gameplay_content_index.len()
    }

    /// True only when the six native R4/R6/R7/world-view/runtime/content records can be
    /// built from one immutable authority generation. A partially delivered
    /// content installation is deliberately not checkpointable.
    #[must_use]
    pub fn native_save_ready(&self) -> bool {
        self.native_save_prerequisites_ready()
            && self.durable_network_save_boundary_proof().is_ok()
            && self.build_native_state_records().is_ok()
    }

    /// Exports one bounded, self-verifying in-memory checkpoint for Worker
    /// replacement. Durable browser saves continue to use the chunked BWPR
    /// journal lane; this control-plane checkpoint is intentionally rejected
    /// while platform or command work is in flight.
    pub fn export_runtime_checkpoint(&self) -> Result<Vec<u8>, IntegratedRuntimeError> {
        self.ensure_running()?;
        if !self.native_save_prerequisites_ready() {
            return Err(IntegratedRuntimeError::new(
                "native-save-incomplete",
                "runtime cannot checkpoint while content installation is incomplete",
            ));
        }
        if !self.queued_context_commands.is_empty() {
            return Err(IntegratedRuntimeError::new(
                "checkpoint-context-pending",
                "runtime checkpoint requires the semantic context command queue to drain",
            ));
        }
        if !self.queued.is_empty()
            || !self.receipts.is_empty()
            || !self.save_stages.is_empty()
            || !self.prepared_persistence_commits.is_empty()
            || !self.persistence_authority.dirty_records().is_empty()
            || self.persistence_authority.diagnostics().commit_in_flight
            || !self.persistence_dispatcher.is_idle()
        {
            return Err(IntegratedRuntimeError::new(
                "checkpoint-busy",
                "runtime checkpoint requires drained commands and a durable, idle persistence boundary",
            ));
        }
        let empty_network = NetworkBrowserAuthorityRuntimeV1::new(self.config.session_id.clone())
            .map_err(|error| IntegratedRuntimeError::domain("checkpoint-network", error))?;
        if self.network.authority_fingerprint() != empty_network.authority_fingerprint()
            || !self.replication_record_hashes.is_empty()
        {
            return Err(IntegratedRuntimeError::new(
                "checkpoint-network-active",
                "network grants and replication leases must drain before a single-player checkpoint",
            ));
        }

        let bundle = self.build_native_bundle()?;
        let dispatcher = self.persistence_dispatcher_checkpoint()?;
        let expected_state_hash = self.state_hash();
        let expected_replay_hash = self.replay_hash();
        let mut writer = NativeWriterV1::default();
        writer.raw(NATIVE_CHECKPOINT_MAGIC_V1);
        writer.u16(NATIVE_CHECKPOINT_SCHEMA_V1);
        writer.hash(bundle.bundle_hash);
        writer.hash(expected_state_hash);
        writer.hash(expected_replay_hash);
        writer.u32(bundle.envelopes.len() as u32);
        for kind in IntegratedRuntimeNativeRecordKindV1::ALL {
            let envelope = bundle
                .envelopes
                .get(&kind)
                .expect("complete native bundle contains every required record");
            writer.u8(kind as u8);
            writer.bytes(&encode_native_record_envelope_v1(envelope)?)?;
        }
        match self.persistence_authority.checkpoint() {
            Some(checkpoint) => {
                writer.bool(true);
                writer.bytes(&encode_checkpoint(checkpoint))?;
                writer.u32(self.persistence_authority.records().len() as u32);
                for descriptor in &checkpoint.records {
                    let record = self
                        .persistence_authority
                        .records()
                        .get(&descriptor.address)
                        .ok_or_else(|| {
                            IntegratedRuntimeError::new(
                                "checkpoint-incomplete",
                                "durable checkpoint is missing a declared record",
                            )
                        })?;
                    writer.address(&descriptor.address)?;
                    writer.bytes(&record.payload)?;
                }
            }
            None => {
                if !self.persistence_authority.records().is_empty() {
                    return Err(IntegratedRuntimeError::new(
                        "checkpoint-incomplete",
                        "durable records exist without a checkpoint head",
                    ));
                }
                writer.bool(false);
            }
        }
        writer.bytes(&dispatcher)?;
        let body = writer.finish();
        if body.len().saturating_add(20) > NATIVE_CHECKPOINT_MAX_BYTES_V1 {
            return Err(IntegratedRuntimeError::new(
                "checkpoint-control-capacity",
                "exact checkpoint exceeds the bounded Worker control lane; use the durable bulk save lane",
            ));
        }
        let hash = runtime_checkpoint_hash_v1(&body);
        let mut output = NativeWriterV1::default();
        output.bytes(&body)?;
        output.hash(hash);
        Ok(output.finish())
    }

    /// Restores a control-plane checkpoint into temporary domain authorities
    /// and returns it only after the complete integrated identity and replay
    /// hashes agree. No caller-visible partial runtime can escape this method.
    pub fn restore_runtime_checkpoint(
        checkpoint_bytes: &[u8],
        expected_checkpoint_hash: CanonicalHash,
    ) -> Result<Self, IntegratedRuntimeError> {
        if checkpoint_bytes.len() > NATIVE_CHECKPOINT_MAX_BYTES_V1 {
            return Err(IntegratedRuntimeError::new(
                "checkpoint-control-capacity",
                "runtime checkpoint exceeds the bounded Worker control lane",
            ));
        }
        if runtime_checkpoint_hash_v1(checkpoint_bytes) != expected_checkpoint_hash {
            return Err(IntegratedRuntimeError::new(
                "checkpoint-hash",
                "runtime checkpoint bytes do not match the requested hash",
            ));
        }
        let mut outer = NativeReaderV1::new(checkpoint_bytes);
        let body = outer.bytes(NATIVE_RECORD_MAX_BYTES_V1)?;
        let stored_outer_hash = outer.hash()?;
        outer.finish()?;
        if runtime_checkpoint_hash_v1(&body) != stored_outer_hash {
            return Err(IntegratedRuntimeError::new(
                "checkpoint-corrupt",
                "runtime checkpoint outer checksum does not match",
            ));
        }
        let mut reader = NativeReaderV1::new(&body);
        reader.magic(NATIVE_CHECKPOINT_MAGIC_V1)?;
        if reader.u16()? != NATIVE_CHECKPOINT_SCHEMA_V1 {
            return Err(IntegratedRuntimeError::new(
                "checkpoint-schema",
                "runtime checkpoint schema is unsupported",
            ));
        }
        let bundle_hash = reader.hash()?;
        let expected_state_hash = reader.hash()?;
        let expected_replay_hash = reader.hash()?;
        let record_count = reader.count(NATIVE_CHECKPOINT_MAX_RECORDS_V1, "checkpoint records")?;
        if record_count != IntegratedRuntimeNativeRecordKindV1::ALL.len() {
            return Err(IntegratedRuntimeError::new(
                "checkpoint-incomplete",
                "runtime checkpoint does not contain exactly six native records",
            ));
        }
        let mut envelopes = BTreeMap::new();
        for _ in 0..record_count {
            let declared_kind = IntegratedRuntimeNativeRecordKindV1::from_tag(reader.u8()?)?;
            let envelope = decode_native_record_envelope_v1(&reader.bytes(NATIVE_RECORD_MAX_BYTES_V1)?)?;
            if declared_kind != envelope.kind || envelopes.insert(declared_kind, envelope).is_some() {
                return Err(IntegratedRuntimeError::new(
                    "checkpoint-duplicate",
                    "runtime checkpoint contains a duplicate or mistagged native record",
                ));
            }
        }
        let durable = if reader.bool()? {
            let checkpoint_wire = reader.bytes(NATIVE_RECORD_MAX_BYTES_V1)?;
            let PersistenceWireRecord::Checkpoint(checkpoint) = decode_record(&checkpoint_wire)
                .map_err(|error| IntegratedRuntimeError::domain("checkpoint-persistence", error))?
            else {
                return Err(IntegratedRuntimeError::new(
                    "checkpoint-persistence",
                    "runtime checkpoint durable head has the wrong record kind",
                ));
            };
            let count = reader.count(NATIVE_CHECKPOINT_MAX_RECORDS_V1 * 1024, "durable records")?;
            let mut payloads = BTreeMap::new();
            for _ in 0..count {
                let address = reader.address()?;
                let payload = reader.bytes(NATIVE_RECORD_MAX_BYTES_V1)?;
                if payloads.insert(address, payload).is_some() {
                    return Err(IntegratedRuntimeError::new(
                        "checkpoint-duplicate",
                        "runtime checkpoint repeats a durable record address",
                    ));
                }
            }
            Some((checkpoint, payloads))
        } else {
            None
        };
        let dispatcher = reader.bytes(NATIVE_RECORD_MAX_BYTES_V1)?;
        reader.finish()?;
        let bundle = IntegratedRuntimeNativeBundleV1 { bundle_hash, envelopes };
        let core = decode_and_validate_native_bundle_v1(&bundle)?;
        let checkpoint_core = core.clone();
        let mut candidate = Self::new(core.config.clone())?;
        candidate.install_native_bundle(&bundle, Some(core))?;
        candidate.persistence_authority = match durable {
            Some((checkpoint, payloads)) => PersistenceAuthorityV1::recover(checkpoint, payloads)
                .map_err(|error| IntegratedRuntimeError::domain("checkpoint-persistence", error))?,
            None => PersistenceAuthorityV1::empty(
                format!("{}@{}", candidate.config.universe_id, candidate.config.location_id),
                candidate.config.generator_hash,
                candidate.config.content_hash,
            )
            .map_err(|error| IntegratedRuntimeError::domain("checkpoint-persistence", error))?,
        };
        candidate.persistence_dispatcher = PersistenceDispatcherV1::restore_state(&dispatcher)
            .map_err(|error| IntegratedRuntimeError::domain("checkpoint-dispatcher", error))?;
        candidate.invalidate_state_hash();
        let actual_state_hash = candidate.state_hash();
        let actual_replay_hash = candidate.replay_hash();
        if actual_state_hash != expected_state_hash || actual_replay_hash != expected_replay_hash {
            return Err(IntegratedRuntimeError::new(
                "checkpoint-state-drift",
                format!(
                    "restored runtime authority or replay hash differs: state {} expected {}, replay {} expected {}, revision {:?} expected {:?}, player_equal={}, world={}, entities={}, gameplay={}, journal={}, authority={}, dispatcher={}, effects={}, next_effect={}, inputs={}, last_sequence={:?}, last_applied={:?}",
                    actual_state_hash.to_hex(),
                    expected_state_hash.to_hex(),
                    actual_replay_hash.to_hex(),
                    expected_replay_hash.to_hex(),
                    candidate.revision(),
                    checkpoint_core.expected_revision,
                    candidate.player == checkpoint_core.player,
                    candidate.world.canonical_state_hash().to_hex(),
                    candidate.entities.canonical_hash().to_hex(),
                    candidate.gameplay.state.state_hash().to_hex(),
                    candidate.persistence.state_hash().to_hex(),
                    candidate.persistence_authority.state_hash().to_hex(),
                    candidate.persistence_dispatcher.state_hash().to_hex(),
                    candidate.effect_events.len(),
                    candidate.next_effect_sequence,
                    candidate.queued_inputs.len(),
                    candidate.last_input_sequence,
                    candidate.last_applied_input
                ),
            ));
        }
        Ok(candidate)
    }

    pub fn install_content_page(
        &mut self,
        page: ContentInstallPageWireV1,
        page_hash: CanonicalHash,
    ) -> Result<ContentInstallReceiptWireV1, IntegratedRuntimeError> {
        let mut candidate = self.clone();
        let receipt = candidate.install_content_page_inner(page, page_hash)?;
        *self = candidate;
        Ok(receipt)
    }

    fn install_content_page_inner(
        &mut self,
        page: ContentInstallPageWireV1,
        page_hash: CanonicalHash,
    ) -> Result<ContentInstallReceiptWireV1, IntegratedRuntimeError> {
        if self.stopped {
            return Err(IntegratedRuntimeError::new(
                "engine-stopped",
                "integrated runtime is stopped",
            ));
        }
        if page.manifest_hash != self.config.content_hash {
            return Err(IntegratedRuntimeError::new(
                "content-manifest-mismatch",
                "content bundle does not match the runtime's configured content hash",
            ));
        }
        let expected_entries = page
            .domains
            .values()
            .try_fold(0_u64, |total, domain| total.checked_add(u64::from(domain.count)));
        if expected_entries.is_none_or(|count| count == 0 || count > INTEGRATED_RUNTIME_CONTENT_MAX_ENTRIES_V1 as u64) {
            return Err(IntegratedRuntimeError::new(
                "content-capacity",
                "content manifest entry count is outside the runtime budget",
            ));
        }

        if let Some(installed) = &self.content_attestation {
            if installed.install_id != page.install_id
                || installed.source_revision != page.source_revision
                || installed.manifest_hash != page.manifest_hash
                || installed.domains != page.domains
                || installed.page_hashes.len() != page.page_count as usize
            {
                return Err(IntegratedRuntimeError::new(
                    "content-install-conflict",
                    "runtime already owns a different immutable content bundle",
                ));
            }
            let expected_hash = installed.page_hashes.get(page.page_index as usize).ok_or_else(|| {
                IntegratedRuntimeError::new("content-page-missing", "content retry references an unknown page")
            })?;
            if *expected_hash != page_hash {
                return Err(IntegratedRuntimeError::new(
                    "content-page-conflict",
                    "content page retry bytes differ from the installed bundle",
                ));
            }
            return Ok(content_install_receipt(installed, page.page_count));
        }

        if self.content_stage.is_none() {
            if page.page_index != 0 {
                return Err(IntegratedRuntimeError::new(
                    "content-page-missing",
                    "content installation must begin with page zero",
                ));
            }
            self.content_stage = Some(IntegratedRuntimeContentStageV1 {
                install_id: page.install_id.clone(),
                source_revision: page.source_revision.clone(),
                manifest_hash: page.manifest_hash,
                domains: page.domains.clone(),
                page_count: page.page_count,
                page_hashes: Vec::with_capacity(page.page_count as usize),
                artifacts: Vec::with_capacity(expected_entries.unwrap_or_default() as usize),
            });
        }

        let stage = self.content_stage.as_ref().expect("content stage initialized");
        if stage.install_id != page.install_id
            || stage.source_revision != page.source_revision
            || stage.manifest_hash != page.manifest_hash
            || stage.domains != page.domains
            || stage.page_count != page.page_count
        {
            return Err(IntegratedRuntimeError::new(
                "content-install-conflict",
                "content page header conflicts with the active installation",
            ));
        }
        let next_page = stage.page_hashes.len() as u32;
        if page.page_index < next_page {
            if stage.page_hashes[page.page_index as usize] != page_hash {
                return Err(IntegratedRuntimeError::new(
                    "content-page-conflict",
                    "content page retry bytes differ from the accepted page",
                ));
            }
            return Ok(content_stage_receipt(stage));
        }
        if page.page_index > next_page {
            return Err(IntegratedRuntimeError::new(
                "content-page-reordered",
                "content pages must be delivered exactly once in ascending order",
            ));
        }

        let previous_key = stage
            .artifacts
            .last()
            .map(|artifact| (artifact.domain, artifact.id.as_str()));
        let mut last_key = previous_key;
        for artifact in &page.artifacts {
            let key = (artifact.domain, artifact.id.as_str());
            if last_key.is_some_and(|previous| previous >= key) {
                return Err(IntegratedRuntimeError::new(
                    "content-artifact-order",
                    "content artifacts are not globally unique and canonically ordered",
                ));
            }
            last_key = Some(key);
        }
        if stage.artifacts.len().saturating_add(page.artifacts.len()) > INTEGRATED_RUNTIME_CONTENT_MAX_ENTRIES_V1 {
            return Err(IntegratedRuntimeError::new(
                "content-capacity",
                "content installation exceeds the runtime entry budget",
            ));
        }

        let mut candidate_stage = stage.clone();
        candidate_stage.page_hashes.push(page_hash);
        candidate_stage.artifacts.extend(page.artifacts);
        if candidate_stage.page_hashes.len() < candidate_stage.page_count as usize {
            self.content_stage = Some(candidate_stage);
            self.gameplay_authority_revision = self.gameplay_authority_revision.saturating_add(1);
            self.invalidate_state_hash();
            return Ok(content_stage_receipt(
                self.content_stage.as_ref().expect("staged page retained"),
            ));
        }

        let compiled = compile_content_bundle(
            candidate_stage.source_revision.clone(),
            candidate_stage.artifacts.clone(),
        )
        .map_err(|blockers| content_blocker_error(&blockers))?;
        if compiled.manifest.manifest_hash != candidate_stage.manifest_hash
            || compiled.manifest.domains != candidate_stage.domains
            || compiled.manifest.schema_version != page.manifest_schema
        {
            return Err(IntegratedRuntimeError::new(
                "content-attestation-drift",
                "compiled content does not match the declared manifest hash and domain digests",
            ));
        }
        let mut candidate_store = self.gameplay_content_store.clone();
        let report = install_content_bundle(&compiled, &mut candidate_store)
            .map_err(|blockers| content_blocker_error(&blockers))?;
        let (runtime_registry, runtime_report) = materialize_content_runtime(&compiled.manifest, &candidate_store)
            .map_err(|blockers| content_runtime_blocker_error(&blockers))?;
        if runtime_report.manifest_hash != report.manifest_hash
            || runtime_report.installed_entries != report.installed_entries
            || runtime_report
                .executable_bytes
                .checked_add(runtime_report.opaque_extension_bytes)
                != Some(report.installed_bytes)
        {
            return Err(IntegratedRuntimeError::new(
                "content-runtime-drift",
                "typed content materialization disagrees with the installed metadata bundle",
            ));
        }
        let item_definitions = item_definitions_from_runtime_registry(&runtime_registry)?;
        let mut candidate_gameplay = self.gameplay.clone();
        install_content_item_definitions(&mut candidate_gameplay, &item_definitions)?;
        let candidate_index = compiled
            .manifest
            .entries
            .iter()
            .map(|entry| ((entry.domain, entry.id.clone()), entry.blob_hash))
            .collect::<BTreeMap<_, _>>();
        if candidate_index.len() != report.installed_entries as usize {
            return Err(IntegratedRuntimeError::new(
                "content-registry-drift",
                "gameplay content registry did not retain every installed artifact",
            ));
        }
        let attestation = IntegratedRuntimeContentAttestationV1 {
            install_id: candidate_stage.install_id,
            source_revision: candidate_stage.source_revision,
            manifest_hash: report.manifest_hash,
            domains: candidate_stage.domains,
            installed_entries: report.installed_entries,
            installed_bytes: report.installed_bytes,
            page_hashes: candidate_stage.page_hashes,
        };
        self.gameplay_content_store = candidate_store;
        self.gameplay_content_index = candidate_index;
        self.gameplay_content_runtime = runtime_registry;
        self.gameplay = candidate_gameplay;
        self.content_stage = None;
        self.content_attestation = Some(attestation);
        self.mining_state = None;
        self.gameplay_authority_revision = self.gameplay_authority_revision.saturating_add(1);
        self.network_revision = self.network_revision.saturating_add(1);
        self.invalidate_state_hash();
        Ok(content_install_receipt(
            self.content_attestation
                .as_ref()
                .expect("content attestation installed"),
            page.page_count,
        ))
    }

    #[must_use]
    pub fn player(&self) -> Option<&IntegratedRuntimePlayerStateV2> {
        self.player.as_ref()
    }

    #[must_use]
    pub const fn camera_state(&self) -> &IntegratedRuntimeCameraStateV1 {
        &self.camera
    }

    /// Applies one absolute renderer-neutral camera configuration through a
    /// staged compare-and-set boundary. Input-owned look values are not part
    /// of this CAS cursor and remain untouched by configuration changes.
    pub fn apply_camera_config(
        &mut self,
        request: RuntimeCameraConfigWireV1,
        request_payload_hash: CanonicalHash,
    ) -> Result<RuntimeCameraConfigReceiptWireV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        validate_runtime_camera_profile_bounds_v1(request.profile)?;
        let previous_camera_revision = self.camera.revision;
        if request.expected_camera_revision != previous_camera_revision {
            return Err(IntegratedRuntimeError::new(
                "camera-revision-conflict",
                "camera configuration expected revision is stale",
            ));
        }
        let unchanged =
            request.mode == self.camera.mode && camera_profile_bits_equal_v1(request.profile, self.camera.profile);
        if unchanged {
            return Ok(RuntimeCameraConfigReceiptWireV1 {
                request_payload_hash,
                previous_camera_revision,
                resulting_camera_revision: previous_camera_revision,
                mode: self.camera.mode,
                profile: self.camera.profile,
                camera_state_hash: runtime_camera_config_state_hash_v1(
                    self.camera.revision,
                    self.camera.mode,
                    self.camera.profile,
                ),
            });
        }
        let resulting_camera_revision = previous_camera_revision
            .checked_add(1)
            .filter(|revision| *revision <= MAX_SAFE_U64)
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "camera-revision-exhausted",
                    "camera configuration revision cannot advance within the browser-safe range",
                )
            })?;
        let mut candidate = self.clone();
        candidate.camera.revision = resulting_camera_revision;
        candidate.camera.mode = request.mode;
        candidate.camera.profile = request.profile;
        candidate.simulation_revision = candidate.simulation_revision.checked_add(1).ok_or_else(|| {
            IntegratedRuntimeError::new(
                "camera-simulation-revision-exhausted",
                "simulation revision is exhausted while staging camera configuration",
            )
        })?;
        candidate.invalidate_state_hash();
        let receipt = RuntimeCameraConfigReceiptWireV1 {
            request_payload_hash,
            previous_camera_revision,
            resulting_camera_revision,
            mode: candidate.camera.mode,
            profile: candidate.camera.profile,
            camera_state_hash: runtime_camera_config_state_hash_v1(
                candidate.camera.revision,
                candidate.camera.mode,
                candidate.camera.profile,
            ),
        };
        *self = candidate;
        Ok(receipt)
    }

    /// Derives a deterministic renderer-neutral pose from persistent camera
    /// configuration, the exact hot player body, absolute look input, and one
    /// ephemeral browser viewport. Viewport dimensions never mutate authority
    /// state or checkpoint bytes.
    pub fn camera_pose(&self, viewport: [u32; 2]) -> Result<CameraPoseV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        if viewport
            .iter()
            .any(|value| *value == 0 || *value > CAMERA_MAX_VIEWPORT_V1)
        {
            return Err(IntegratedRuntimeError::new(
                "camera-viewport",
                "camera viewport dimensions are outside the bounded browser contract",
            ));
        }
        let player = self.player.as_ref().ok_or_else(|| {
            IntegratedRuntimeError::new(
                "camera-player-binding",
                "camera pose requires a complete authoritative player binding",
            )
        })?;
        self.entities
            .hot()
            .get(&player.entity_id)
            .filter(|entity| {
                entity.record.class == EntityClass::Player
                    && entity.record.external_entity_id == player.binding.external_entity_id
            })
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "camera-player-residency",
                    "camera pose requires the exact bound player to remain hot and generationally valid",
                )
            })?;
        let body_height_scale = player.body.height / player.binding.standing_height;
        if !body_height_scale.is_finite() || body_height_scale <= 0.0 {
            return Err(IntegratedRuntimeError::new(
                "camera-body-height",
                "authoritative player body height cannot produce a finite camera scale",
            ));
        }
        let mut profile = self.camera.profile;
        profile.eye_height *= body_height_scale;
        profile.third_person_target_height *= body_height_scale;
        let input = CameraPoseInputV1 {
            body_position: player.body.position,
            look_yaw: normalized_i16(self.camera.look_yaw) * std::f64::consts::PI,
            look_pitch: normalized_i16(self.camera.look_pitch) * std::f64::consts::FRAC_PI_2,
            mode: self.camera.mode,
            aiming: self.camera_aiming(),
            viewport,
            profile,
        };
        let window = if input.mode == CameraModeV1::FirstPerson {
            None
        } else {
            Some(self.capture_camera_collision_window_v1(input)?)
        };
        derive_camera_pose_v1(window.as_ref(), input)
            .map_err(|error| IntegratedRuntimeError::new("camera-pose", error.to_string()))
    }

    /// Returns the exact native aiming presentation bit. It is true only while
    /// secondary input is held and the selected installed item has the typed
    /// ranged-weapon action; callers must not infer it from equal FOV values.
    #[must_use]
    pub fn camera_aiming(&self) -> bool {
        let Some(player) = self.player.as_ref() else {
            return false;
        };
        if player.buttons & RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1 == 0 {
            return false;
        }
        let Some((_, _, Some(held))) = self.held_stack_and_binding() else {
            return false;
        };
        self.gameplay_content_runtime
            .items
            .values()
            .find(|item| item.item_code == held.item_code)
            .is_some_and(|item| item.action.use_kind == Some(ContentItemUseKind::RangedWeapon))
    }

    fn capture_camera_collision_window_v1(
        &self,
        input: CameraPoseInputV1,
    ) -> Result<WorldReadWindowV1, IntegratedRuntimeError> {
        let (origin, end) = camera_collision_segment_v1(input)?;
        let radius = input.profile.collision_radius;
        let minimum = SimulationVec3::new(
            origin.x.min(end.x) - radius,
            origin.y.min(end.y) - radius,
            origin.z.min(end.z) - radius,
        );
        let maximum = SimulationVec3::new(
            origin.x.max(end.x) + radius,
            origin.y.max(end.y) + radius,
            origin.z.max(end.z) + radius,
        );
        let low = [
            camera_ray_cell_component_v1(minimum.x)?,
            camera_ray_cell_component_v1(minimum.y)?,
            camera_ray_cell_component_v1(minimum.z)?,
        ];
        let high = [
            camera_ray_cell_component_v1(maximum.x)?,
            camera_ray_cell_component_v1(maximum.y)?,
            camera_ray_cell_component_v1(maximum.z)?,
        ];
        let mut dimensions = [0_u16; 3];
        let mut cell_count = 1_usize;
        for index in 0..3 {
            let span = high[index]
                .checked_sub(low[index])
                .and_then(|value| value.checked_add(1))
                .and_then(|value| u16::try_from(value).ok())
                .ok_or_else(|| {
                    IntegratedRuntimeError::new("camera-capture-overflow", "camera collision capture bounds overflowed")
                })?;
            dimensions[index] = span;
            cell_count = cell_count.checked_mul(usize::from(span)).ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "camera-capture-overflow",
                    "camera collision capture cell count overflowed",
                )
            })?;
        }
        let maximum_cells = WORLD_READ_WINDOW_MAX_CELLS_V1.min(RAYCAST_MAX_VISITED_CELLS_V1);
        if cell_count > maximum_cells {
            return Err(IntegratedRuntimeError::new(
                "camera-capture-capacity",
                "camera collision capture exceeds the shared R4/raycast cell budget",
            ));
        }
        self.capture_simulation_window(
            ReadOriginV1 {
                x: low[0],
                y: low[1],
                z: low[2],
            },
            ReadSizeV1 {
                x: dimensions[0],
                y: dimensions[1],
                z: dimensions[2],
            },
        )
    }

    #[must_use]
    pub fn effect_events(&self) -> &VecDeque<IntegratedRuntimeEffectEventV2> {
        &self.effect_events
    }

    #[must_use]
    pub fn persistence(&self) -> &JournalState {
        &self.persistence
    }

    #[must_use]
    pub fn persistence_dispatcher(&self) -> &PersistenceDispatcherV1 {
        &self.persistence_dispatcher
    }

    #[must_use]
    pub fn persistence_authority(&self) -> &PersistenceAuthorityV1 {
        &self.persistence_authority
    }

    fn build_native_bundle(&self) -> Result<IntegratedRuntimeNativeBundleV1, IntegratedRuntimeError> {
        if !self.native_save_prerequisites_ready() {
            return Err(IntegratedRuntimeError::new(
                "native-save-incomplete",
                "native save records cannot be built from partial content state",
            ));
        }
        if !self.queued_context_commands.is_empty() {
            return Err(IntegratedRuntimeError::new(
                "native-save-context-pending",
                "durable native save requires the semantic context command queue to drain",
            ));
        }
        self.build_native_bundle_unchecked()
    }

    fn native_save_prerequisites_ready(&self) -> bool {
        !self.stopped && self.content_stage.is_none()
    }

    fn durable_network_save_boundary_proof(&self) -> Result<CanonicalHash, IntegratedRuntimeError> {
        let empty_network = NetworkBrowserAuthorityRuntimeV1::new(self.config.session_id.clone())
            .map_err(|error| IntegratedRuntimeError::domain("native-save-network", error))?;
        if !self.durable_network_state_pristine
            || self.network.authority_fingerprint() != empty_network.authority_fingerprint()
            || self.replication.record_count() != 0
            || !self.replication_record_hashes.is_empty()
        {
            return Err(IntegratedRuntimeError::new(
                "native-save-network-active",
                "durable native saves require a provably unused, empty network/grant/replication session",
            ));
        }
        Ok(durable_network_drained_proof_v1())
    }

    fn build_native_bundle_unchecked(&self) -> Result<IntegratedRuntimeNativeBundleV1, IntegratedRuntimeError> {
        let mut bodies = BTreeMap::new();
        bodies.insert(
            IntegratedRuntimeNativeRecordKindV1::World,
            encode_world_authority_snapshot_r4_v1(&self.world, &self.native_world_extension_bytes)
                .map_err(|error| IntegratedRuntimeError::domain("native-world", error))?,
        );
        bodies.insert(
            IntegratedRuntimeNativeRecordKindV1::Entities,
            encode_entity_authority_snapshot(&self.entities)
                .map_err(|error| IntegratedRuntimeError::new("native-entities", error.to_string()))?,
        );
        bodies.insert(
            IntegratedRuntimeNativeRecordKindV1::Gameplay,
            self.gameplay
                .encode_snapshot(&self.native_gameplay_extension_bytes)
                .map_err(|error| IntegratedRuntimeError::new("native-gameplay", error.to_string()))?,
        );
        bodies.insert(
            IntegratedRuntimeNativeRecordKindV1::Runtime,
            encode_runtime_core_snapshot_v1(self)?,
        );
        bodies.insert(
            IntegratedRuntimeNativeRecordKindV1::Content,
            encode_runtime_content_snapshot_v1(self)?,
        );
        bodies.insert(
            IntegratedRuntimeNativeRecordKindV1::WorldView,
            encode_world_view_native_record_v1(
                &self.world_view,
                &self.gameplay.state,
                &self.entities,
                &self.native_world_view_extension_bytes,
            )
            .map_err(|error| IntegratedRuntimeError::new("native-world-view", error.to_string()))?,
        );
        let bundle_hash = native_bundle_hash_v1(
            &self.config.universe_id,
            &self.config.location_id,
            self.config.generator_hash,
            self.config.content_hash,
            &bodies,
        );
        let envelopes = bodies
            .into_iter()
            .map(|(kind, body)| {
                (
                    kind,
                    IntegratedRuntimeNativeEnvelopeV1 {
                        kind,
                        universe_id: self.config.universe_id.clone(),
                        location_id: self.config.location_id.clone(),
                        generator_hash: self.config.generator_hash,
                        content_hash: self.config.content_hash,
                        bundle_hash,
                        body,
                    },
                )
            })
            .collect();
        Ok(IntegratedRuntimeNativeBundleV1 { bundle_hash, envelopes })
    }

    fn build_native_state_records(&self) -> Result<Vec<NormalizedStateRecordV1>, IntegratedRuntimeError> {
        self.durable_network_save_boundary_proof()?;
        let bundle = self.build_native_bundle()?;
        let mut records = Vec::with_capacity(bundle.envelopes.len() + 16);
        let mut owned_addresses = BTreeSet::new();
        for kind in IntegratedRuntimeNativeRecordKindV1::ALL {
            let (record_kind, record_id) = kind.address();
            let address = RecordAddress::new(
                &self.config.universe_id,
                &self.config.location_id,
                record_kind,
                record_id,
            )
            .map_err(|error| IntegratedRuntimeError::domain("native-record-address", error))?;
            owned_addresses.insert(address.clone());
            records.push(NormalizedStateRecordV1 {
                address,
                payload: encode_native_record_envelope_v1(
                    bundle
                        .envelopes
                        .get(&kind)
                        .expect("complete native bundle contains every record"),
                )?,
            });
        }
        for (address, record) in self.persistence_authority.records() {
            let reserved_manifest =
                address.kind == RecordKind::LocationManifest && address.record_id == WORLD_SAVE_MANIFEST_RECORD_ID_V1;
            let reserved_compatibility = address.kind == RecordKind::SettingsReference
                && address.record_id.starts_with(COMPATIBILITY_RECORD_PREFIX_V1);
            if !reserved_manifest && !reserved_compatibility && !owned_addresses.contains(address) {
                records.push(NormalizedStateRecordV1 {
                    address: address.clone(),
                    payload: record.payload.clone(),
                });
            }
        }
        Ok(records)
    }

    fn install_native_bundle(
        &mut self,
        bundle: &IntegratedRuntimeNativeBundleV1,
        decoded_core: Option<IntegratedRuntimeCoreSnapshotV1>,
    ) -> Result<(), IntegratedRuntimeError> {
        let core = match decoded_core {
            Some(core) => core,
            None => decode_and_validate_native_bundle_v1(bundle)?,
        };
        if core.config != self.config {
            return Err(IntegratedRuntimeError::new(
                "recovery-config",
                "native runtime record does not match the target runtime configuration",
            ));
        }
        let world_record = native_bundle_body_v1(bundle, IntegratedRuntimeNativeRecordKindV1::World)?;
        let entity_record = native_bundle_body_v1(bundle, IntegratedRuntimeNativeRecordKindV1::Entities)?;
        let gameplay_record = native_bundle_body_v1(bundle, IntegratedRuntimeNativeRecordKindV1::Gameplay)?;
        let content_record = native_bundle_body_v1(bundle, IntegratedRuntimeNativeRecordKindV1::Content)?;
        let world_view_record = native_bundle_body_v1(bundle, IntegratedRuntimeNativeRecordKindV1::WorldView)?;

        let decoded_world = decode_world_authority_snapshot_r4_v1(world_record)
            .map_err(|error| IntegratedRuntimeError::domain("recovery-native-world", error))?;
        let expected_world = AuthorityWorldAddressV1::new(&self.config.universe_id, &self.config.location_id)
            .map_err(|error| IntegratedRuntimeError::domain("recovery-native-world", error))?;
        if decoded_world.authority.active_address() != &expected_world
            || decoded_world.authority.block_catalog() != &self.config.block_catalog
        {
            return Err(IntegratedRuntimeError::new(
                "recovery-world-identity",
                "native R4 authority belongs to a different world address or block catalog",
            ));
        }
        let entities = decode_entity_authority_snapshot(entity_record)
            .map_err(|error| IntegratedRuntimeError::new("recovery-native-entities", error.to_string()))?;
        let decoded_gameplay = decode_gameplay_authority_snapshot(gameplay_record)
            .map_err(|error| IntegratedRuntimeError::new("recovery-native-gameplay", error.to_string()))?;
        if decoded_gameplay.authority.state.world != WorldKey::new(&self.config.universe_id, &self.config.location_id) {
            return Err(IntegratedRuntimeError::new(
                "recovery-gameplay-world",
                "gameplay authority belongs to a different world address",
            ));
        }
        let decoded_world_view =
            decode_world_view_native_record_v1(world_view_record, &decoded_gameplay.authority.state, &entities)
                .map_err(|error| IntegratedRuntimeError::new("recovery-native-world-view", error.to_string()))?;
        let content = decode_runtime_content_snapshot_v1(content_record)?;
        let (content_store, content_index, content_runtime, content_item_definitions) =
            install_runtime_content_snapshot_v1(&self.config, &content)?;
        if decoded_gameplay.authority.state.inventory.items != content_item_definitions {
            return Err(IntegratedRuntimeError::new(
                "recovery-content-item-definitions",
                "restored gameplay item definitions do not exactly match the typed installed content registry",
            ));
        }

        let mut candidate = self.clone();
        candidate.world = decoded_world.authority;
        candidate.native_world_extension_bytes = decoded_world.unknown_extension_bytes;
        candidate.entities = entities;
        candidate.gameplay = decoded_gameplay.authority;
        candidate.native_gameplay_extension_bytes = decoded_gameplay.unknown_extension_bytes;
        candidate.world_view = decoded_world_view.authority;
        candidate.native_world_view_extension_bytes = decoded_world_view.unknown_extension_bytes;
        candidate.gameplay_content_store = content_store;
        candidate.gameplay_content_index = content_index;
        candidate.gameplay_content_runtime = content_runtime;
        candidate.content_stage = None;
        candidate.content_attestation = content.attestation;
        candidate.native_content_extension_bytes = content.unknown_extension_bytes;
        candidate.tick = core.tick;
        candidate.last_monotonic_time_us = core.last_monotonic_time_us;
        candidate.accumulator_us = core.accumulator_us;
        candidate.rng_state = core.rng_state;
        candidate.network_revision = core.network_revision;
        candidate.simulation_revision = core.simulation_revision;
        candidate.gameplay_authority_revision = core.gameplay_authority_revision;
        candidate.entity_command_sequence = core.entity_command_sequence;
        candidate.camera = core.camera;
        candidate.player = core.player;
        candidate.effect_events = core.effect_events;
        candidate.next_effect_sequence = core.next_effect_sequence;
        candidate.queued_inputs = core.queued_inputs;
        candidate.last_input_sequence = core.last_input_sequence;
        candidate.last_applied_input = core.last_applied_input;
        candidate.next_action_sequence = core.next_action_sequence;
        candidate.queued_context_commands = core.queued_context_commands;
        candidate.next_context_command_sequence = core.next_context_command_sequence;
        candidate.mining_state = core.mining_state;
        candidate.block_action_loot_rng = core.block_action_loot_rng;
        candidate.next_block_action_sequence = core.next_block_action_sequence;
        candidate.block_action_receipts = core.block_action_receipts;
        candidate.command_receipts = core.command_receipts;
        candidate.command_receipt_order = core.command_receipt_order;
        candidate.command_receipt_bytes = core.command_receipt_bytes;
        candidate.replay = core.replay;
        candidate.replay_digest = IntegratedReplayDigestV2::default();
        for entry in &candidate.replay {
            candidate.replay_digest.add(hash_runtime_replay_entry(entry));
        }
        candidate.persistence = core.compatibility_journal;
        candidate.native_runtime_extension_bytes = core.unknown_extension_bytes;
        candidate.queued.clear();
        candidate.receipts.clear();
        candidate.idempotency.clear();
        candidate.idempotency_order.clear();
        candidate.replication = InterestIndexV1::default();
        candidate.replication_record_hashes.clear();
        candidate.network = NetworkBrowserAuthorityRuntimeV1::new(candidate.config.session_id.clone())
            .map_err(|error| IntegratedRuntimeError::domain("recovery-network", error))?;
        candidate.durable_network_state_pristine = true;
        candidate.rebuild_entity_schedules()?;
        candidate
            .validate_runtime_cross_domain_links_v1()
            .map_err(|error| IntegratedRuntimeError::new("recovery-world-view", error.message))?;
        candidate.validate_block_action_history_v1()?;
        candidate.validate_combat_presentation_bindings_v1()?;
        if candidate
            .player
            .as_ref()
            .is_some_and(|player| !candidate.entities.contains(player.entity_id))
        {
            return Err(IntegratedRuntimeError::new(
                "recovery-player-entity",
                "bound player record references an entity absent from the R6 snapshot",
            ));
        }
        if candidate.mining_state.is_some() && !candidate.mining_state_is_current_v1() {
            candidate.mining_state = None;
        }
        let revision = candidate.revision();
        if revision.epoch != core.expected_revision.epoch
            || revision.world != core.expected_revision.world
            || revision.entities != core.expected_revision.entities
            || revision.gameplay != core.expected_revision.gameplay
            || revision.network != core.expected_revision.network
            || revision.simulation != core.expected_revision.simulation
        {
            return Err(IntegratedRuntimeError::new(
                "recovery-revision-drift",
                format!(
                    "native records do not reproduce their shared authority revisions: expected {:?}, actual {:?}",
                    core.expected_revision, revision
                ),
            ));
        }
        candidate.invalidate_state_hash();
        *self = candidate;
        Ok(())
    }

    fn validate_block_action_history_v1(&self) -> Result<(), IntegratedRuntimeError> {
        self.block_action_loot_rng
            .validate_v1()
            .map_err(|error| IntegratedRuntimeError::new("block-action-rng", error.message))?;
        if self.block_action_receipts.len() > INTEGRATED_RUNTIME_MAX_BLOCK_ACTION_RECEIPTS_V1 {
            return Err(IntegratedRuntimeError::new(
                "block-action-receipt-capacity",
                "block-action receipt history exceeds its durable bound",
            ));
        }
        if self.block_action_receipts.is_empty() {
            if self.block_action_loot_rng != BlockActionLootRngCursorV1::from_seed_v1(&self.config.world_seed)
                || self.next_block_action_sequence != Some(1)
            {
                return Err(IntegratedRuntimeError::new(
                    "block-action-history-gap",
                    "empty block-action history contradicts its RNG or sequence cursor",
                ));
            }
            return Ok(());
        }
        let report = self
            .gameplay_content_runtime
            .action_promotion_report_v1()
            .map_err(|errors| {
                IntegratedRuntimeError::new(
                    "block-action-content",
                    format!("installed action report has {} validation error(s)", errors.len()),
                )
            })?
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "block-action-content",
                    "persisted block-action history requires an installed action catalog",
                )
            })?;
        let binding = BlockActionLootBindingV1::from_installed_content_v1(&self.gameplay_content_runtime, &report)
            .map_err(|error| IntegratedRuntimeError::new("block-action-content", error.message))?;
        let item_max_stacks = block_action_item_max_stacks_v1(&self.gameplay_content_runtime)?;
        let mut previous_sequence: Option<u64> = None;
        let mut previous_rng_after: Option<BlockActionLootRngCursorV1> = None;
        let mut retained_drop_ids = BTreeSet::new();
        let mut retained_custodies = BTreeSet::new();
        let mut retained_entities = BTreeSet::new();
        for receipt in &self.block_action_receipts {
            receipt.validate_shape_v1()?;
            if receipt.plan.binding != binding {
                return Err(IntegratedRuntimeError::new(
                    "block-action-content-drift",
                    "persisted block-action receipt binding differs from installed content",
                ));
            }
            let sequence = receipt.plan.context.block_action_sequence;
            if previous_sequence.is_some_and(|previous| previous.checked_add(1) != Some(sequence)) {
                return Err(IntegratedRuntimeError::new(
                    "block-action-receipt-order",
                    "retained block-action receipts are not one contiguous canonical tail",
                ));
            }
            if previous_rng_after.is_some_and(|cursor| cursor != receipt.plan.rng_before) {
                return Err(IntegratedRuntimeError::new(
                    "block-action-receipt-rng-chain",
                    "retained block-action receipts do not form one RNG cursor chain",
                ));
            }
            previous_sequence = Some(sequence);
            previous_rng_after = Some(receipt.plan.rng_after);
            let profile = self
                .gameplay_content_runtime
                .block_action(receipt.plan.context.block_id)
                .ok_or_else(|| {
                    IntegratedRuntimeError::new(
                        "block-action-content-drift",
                        "persisted block-action receipt references a missing profile",
                    )
                })?;
            replay_verify_block_action_loot_plan_v1(&receipt.plan, profile, &item_max_stacks)
                .map_err(|error| IntegratedRuntimeError::new("block-action-replay", error.message))?;
            for (stack, generated) in receipt.plan.stacks.iter().zip(&receipt.generated_drops) {
                let drop_id = generated.provenance.drop_id_v1();
                let custody = ContainerKey {
                    kind: ContainerKind::Container,
                    id: generated.provenance.custody_id_v1(),
                    owner_id: None,
                };
                if !retained_drop_ids.insert(drop_id.clone())
                    || !retained_custodies.insert(custody.clone())
                    || !retained_entities.insert(generated.entity_id)
                {
                    return Err(IntegratedRuntimeError::new(
                        "block-action-receipt-duplicate",
                        "retained block-action receipts derive duplicate live identities",
                    ));
                }
                let drop = self.world_view.state.dropped_items.get(&drop_id);
                let container = self.gameplay.state.inventory.containers.get(&custody);
                let entity = self.entities.compatibility_record(generated.entity_id);
                match (drop, container, entity) {
                    (None, None, None) => {}
                    (Some(drop), Some(container), Some(entity)) => {
                        if drop.entity_id != generated.entity_id
                            || drop.container != custody
                            || drop.slot != 0
                            || drop.bound_container_revision != container.revision
                            || container.slots.as_slice()
                                != [Some(ItemStack {
                                    item_code: stack.item_code,
                                    count: stack.count,
                                    durability_millionths: None,
                                    metadata_hash: stack.metadata_hash,
                                })]
                            || entity.external_entity_id != drop_id
                            || entity.kind_key != "dropped-item"
                            || entity.custom.get("blockLoot.provenanceHash")
                                != Some(&generated.provenance.canonical_hash_v1().to_hex())
                        {
                            return Err(IntegratedRuntimeError::new(
                                "block-action-drop-link",
                                "live generated drop differs from its retained receipt",
                            ));
                        }
                        self.validate_drop_runtime_link_v1(drop)?;
                    }
                    _ => {
                        return Err(IntegratedRuntimeError::new(
                            "block-action-drop-orphan",
                            "generated drop entity, custody, and spatial record must coexist or be absent together",
                        ));
                    }
                }
            }
        }
        let last = self
            .block_action_receipts
            .back()
            .expect("nonempty history has a final receipt");
        if self.block_action_loot_rng != last.plan.rng_after
            || self.next_block_action_sequence != last.plan.context.block_action_sequence.checked_add(1)
        {
            return Err(IntegratedRuntimeError::new(
                "block-action-history-cursor",
                "block-action RNG or sequence cursor does not follow the final retained receipt",
            ));
        }
        for (key, container) in &self.gameplay.state.inventory.containers {
            if key.id.starts_with("block-loot-custody-v1:")
                && (!retained_custodies.contains(key) || container.slots.iter().flatten().count() != 1)
            {
                return Err(IntegratedRuntimeError::new(
                    "block-action-custody-orphan",
                    "generated-drop custody is not covered by retained deterministic evidence",
                ));
            }
        }
        for drop_id in self
            .world_view
            .state
            .dropped_items
            .keys()
            .filter(|drop_id| drop_id.starts_with("block-loot-v1:"))
        {
            if !retained_drop_ids.contains(drop_id) {
                return Err(IntegratedRuntimeError::new(
                    "block-action-spatial-orphan",
                    "generated-drop spatial record is not covered by retained deterministic evidence",
                ));
            }
        }
        for (entity_id, entity) in self.entities.hot() {
            if entity.record.external_entity_id.starts_with("block-loot-v1:") && !retained_entities.contains(entity_id)
            {
                return Err(IntegratedRuntimeError::new(
                    "block-action-entity-orphan",
                    "generated-drop entity is not covered by retained deterministic evidence",
                ));
            }
        }
        Ok(())
    }

    /// Accepts one ordered compatibility-save chunk. Exact duplicate retries
    /// are idempotent; conflicting duplicates and reordered chunks fail before
    /// any stage state changes.
    pub fn stage_compatibility_save_chunk(
        &mut self,
        stage_id: &str,
        chunk_index: u32,
        chunk_count: u32,
        total_bytes: u64,
        bytes: &[u8],
    ) -> Result<IntegratedRuntimeSaveProgressV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        validate_label(stage_id, "stage_id")?;
        if chunk_count == 0
            || chunk_count > RUNTIME_BULK_MAX_SAVE_CHUNKS_V1
            || chunk_index >= chunk_count
            || bytes.is_empty()
            || bytes.len() > RUNTIME_BULK_SAVE_CHUNK_BYTES_V1
            || total_bytes == 0
            || total_bytes > RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1 as u64
        {
            return Err(IntegratedRuntimeError::new(
                "save-stage-capacity",
                "compatibility save chunk metadata exceeds its bounded lane",
            ));
        }
        if !self.save_stages.contains_key(stage_id) {
            if self.save_stages.len() >= INTEGRATED_RUNTIME_MAX_SAVE_STAGES {
                return Err(IntegratedRuntimeError::new(
                    "save-stage-capacity",
                    "one compatibility save stage is already active for this world",
                ));
            }
            self.save_stages.insert(
                stage_id.to_owned(),
                IntegratedRuntimeSaveStageV1 {
                    stage_id: stage_id.to_owned(),
                    chunk_count,
                    total_bytes,
                    chunks: BTreeMap::new(),
                    chunk_hashes: BTreeMap::new(),
                },
            );
        }
        let stage = self.save_stages.get_mut(stage_id).expect("stage was inserted");
        if stage.chunk_count != chunk_count || stage.total_bytes != total_bytes {
            return Err(IntegratedRuntimeError::new(
                "save-stage-conflict",
                "save stage metadata conflicts with the existing generation",
            ));
        }
        if let Some(existing) = stage.chunks.get(&chunk_index) {
            if existing != bytes {
                return Err(IntegratedRuntimeError::new(
                    "save-stage-conflict",
                    "save stage received conflicting bytes for an existing chunk",
                ));
            }
            return Ok(save_stage_progress(stage));
        }
        if chunk_index as usize != stage.chunks.len() {
            return Err(IntegratedRuntimeError::new(
                "save-stage-order",
                "save chunks must arrive contiguously from index zero",
            ));
        }
        let received = stage.chunks.values().fold(bytes.len() as u64, |total, chunk| {
            total.saturating_add(chunk.len() as u64)
        });
        if received > total_bytes || (chunk_index + 1 == chunk_count && received != total_bytes) {
            return Err(IntegratedRuntimeError::new(
                "save-stage-length",
                "save chunk totals disagree with the declared compatibility byte length",
            ));
        }
        let mut hasher = CanonicalHasher::new("blockwild-persistence-stage-chunk-v1");
        hasher.write_u32(chunk_index);
        hasher.write_bytes(bytes);
        stage.chunks.insert(chunk_index, bytes.to_vec());
        stage.chunk_hashes.insert(chunk_index, hasher.finish());
        let progress = save_stage_progress(stage);
        self.invalidate_state_hash();
        Ok(progress)
    }

    /// Builds the canonical save set and lets PersistenceAuthorityV1 choose
    /// the first bounded transaction. Browser code never shards or journals.
    pub fn finalize_compatibility_save(
        &mut self,
        stage_id: &str,
        created_at: u64,
    ) -> Result<IntegratedRuntimeSaveProgressV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        let stage = self.save_stages.get(stage_id).cloned().ok_or_else(|| {
            IntegratedRuntimeError::new("save-stage-stale", "save stage is unknown or already finalized")
        })?;
        if stage.chunks.len() != stage.chunk_count as usize
            || stage.chunks.values().map(Vec::len).sum::<usize>() as u64 != stage.total_bytes
        {
            return Err(IntegratedRuntimeError::new(
                "save-stage-incomplete",
                "save stage cannot finalize until every declared chunk is present",
            ));
        }
        let native_records = self.build_native_state_records()?;
        let save = CanonicalWorldSaveSetV1::build(
            self.persistence_authority.world_id(),
            &self.config.universe_id,
            &self.config.location_id,
            self.config.generator_hash,
            self.config.content_hash,
            stage.chunks.values().cloned(),
            native_records,
        )
        .map_err(|error| IntegratedRuntimeError::domain("persistence-save", error))?;

        let mut candidate = self.clone();
        candidate
            .persistence_authority
            .stage_complete_save_set(&save)
            .map_err(|error| IntegratedRuntimeError::domain("persistence-save", error))?;
        candidate.latest_commit_created_at = candidate.latest_commit_created_at.max(created_at);
        let dispatcher_request_id = candidate.prepare_next_authority_commit()?;
        candidate.save_stages.remove(stage_id);
        candidate.invalidate_state_hash();
        let remaining_dirty_records = u32::try_from(candidate.persistence_authority.dirty_records().len())
            .map_err(|_| IntegratedRuntimeError::new("save-stage-capacity", "dirty record count exceeds u32"))?;
        let progress = IntegratedRuntimeSaveProgressV1 {
            stage_id: stage.stage_id,
            received_chunks: stage.chunk_count,
            chunk_count: stage.chunk_count,
            received_bytes: stage.total_bytes,
            set_hash: save.set_hash,
            manifest_hash: save.manifest.manifest_hash,
            dispatcher_request_id,
            remaining_dirty_records,
        };
        *self = candidate;
        Ok(progress)
    }

    /// Creates or advances a native-only save set for a world that has never
    /// had a legacy compatibility owner. Once a save contains compatibility
    /// source bytes this entrypoint fails closed so a later native save cannot
    /// silently delete the migration backup.
    pub fn finalize_native_save(
        &mut self,
        save_id: &str,
        created_at: u64,
    ) -> Result<IntegratedRuntimeSaveProgressV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        validate_label(save_id, "save_id")?;
        if !self.save_stages.is_empty() {
            return Err(IntegratedRuntimeError::new(
                "native-save-stage-active",
                "native-only save cannot bypass an active compatibility source stage",
            ));
        }
        let manifest = self
            .persistence_authority
            .records()
            .iter()
            .find(|(address, _)| {
                address.kind == RecordKind::LocationManifest && address.record_id == WORLD_SAVE_MANIFEST_RECORD_ID_V1
            })
            .map(|(_, record)| {
                decode_world_save_manifest_v1(&record.payload)
                    .map_err(|error| IntegratedRuntimeError::domain("native-save-manifest", error))
            })
            .transpose()?;
        if manifest
            .as_ref()
            .is_some_and(|manifest| manifest.compatibility_chunks != 0 || manifest.compatibility_byte_length != 0)
        {
            return Err(IntegratedRuntimeError::new(
                "native-save-compatibility-owner",
                "save contains a legacy compatibility source that must remain preserved",
            ));
        }
        if manifest.is_none() && !self.persistence_authority.records().is_empty() {
            return Err(IntegratedRuntimeError::new(
                "native-save-manifest",
                "durable records exist without a canonical save manifest",
            ));
        }

        let native_records = self.build_native_state_records()?;
        let save = CanonicalWorldSaveSetV1::build(
            self.persistence_authority.world_id(),
            &self.config.universe_id,
            &self.config.location_id,
            self.config.generator_hash,
            self.config.content_hash,
            std::iter::empty::<Vec<u8>>(),
            native_records,
        )
        .map_err(|error| IntegratedRuntimeError::domain("native-save", error))?;
        let mut candidate = self.clone();
        candidate
            .persistence_authority
            .stage_complete_save_set(&save)
            .map_err(|error| IntegratedRuntimeError::domain("native-save", error))?;
        candidate.latest_commit_created_at = candidate.latest_commit_created_at.max(created_at);
        let dispatcher_request_id = candidate.prepare_next_authority_commit()?;
        candidate.invalidate_state_hash();
        let remaining_dirty_records = u32::try_from(candidate.persistence_authority.dirty_records().len())
            .map_err(|_| IntegratedRuntimeError::new("native-save-capacity", "dirty record count exceeds u32"))?;
        let progress = IntegratedRuntimeSaveProgressV1 {
            stage_id: save_id.to_owned(),
            received_chunks: 0,
            chunk_count: 0,
            received_bytes: 0,
            set_hash: save.set_hash,
            manifest_hash: save.manifest.manifest_hash,
            dispatcher_request_id,
            remaining_dirty_records,
        };
        *self = candidate;
        Ok(progress)
    }

    /// One-time fail-closed migration for a provably world-only legacy save.
    ///
    /// The exact legacy source must already be staged through the bounded save
    /// chunk lane. `world_projection` is a validated BWAS projection used only
    /// to initialize R4; it does not replace the source backup. Rich saves must
    /// remain under the legacy owner until explicit R6/R7/runtime adapters can
    /// supply their non-world authority.
    pub fn migrate_pristine_legacy_world(
        &mut self,
        migration: IntegratedRuntimeLegacyMigrationV1,
    ) -> Result<IntegratedRuntimeSaveProgressV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        if migration.schema_version != INTEGRATED_RUNTIME_LEGACY_MIGRATION_SCHEMA_V1 {
            return Err(IntegratedRuntimeError::new(
                "legacy-migration-schema",
                "legacy migration projection schema is unsupported",
            ));
        }
        validate_label(&migration.migration_id, "migration_id")?;
        validate_label(&migration.source_stage_id, "source_stage_id")?;
        if migration.legacy_non_world_state_flags != 0 {
            return Err(IntegratedRuntimeError::new(
                "legacy-migration-rich-save",
                format!(
                    "legacy save retains unsupported native domains: {}",
                    legacy_state_flag_names(migration.legacy_non_world_state_flags).join(", ")
                ),
            ));
        }
        let stage = self
            .save_stages
            .get(&migration.source_stage_id)
            .cloned()
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "legacy-migration-source",
                    "exact legacy source backup is not fully staged",
                )
            })?;
        if self.save_stages.len() != 1
            || stage.chunks.len() != stage.chunk_count as usize
            || stage.chunks.values().map(Vec::len).sum::<usize>() as u64 != stage.total_bytes
        {
            return Err(IntegratedRuntimeError::new(
                "legacy-migration-source",
                "legacy migration requires one complete, bounded source-backup stage",
            ));
        }
        let empty_gameplay = GameplayAuthority::new(GameplayState::new(
            WorldKey::new(&self.config.universe_id, &self.config.location_id),
            1,
        ));
        let empty_network = NetworkBrowserAuthorityRuntimeV1::new(self.config.session_id.clone())
            .map_err(|error| IntegratedRuntimeError::domain("legacy-migration-network", error))?;
        if !self.entities.is_empty()
            || self.player.is_some()
            || self.tick != 0
            || self.accumulator_us != 0
            || self.simulation_revision != 0
            || self.gameplay_authority_revision != 0
            || self.entity_command_sequence != 0
            || self.gameplay.state.state_hash() != empty_gameplay.state.state_hash()
            || !self.effect_events.is_empty()
            || !self.queued_inputs.is_empty()
            || self.last_input_sequence.is_some()
            || self.last_applied_input.is_some()
            || self.next_action_sequence != 1
            || !self.queued_context_commands.is_empty()
            || self.next_context_command_sequence != Some(1)
            || !self.replay.is_empty()
            || !self.command_receipts.is_empty()
            || !self.command_receipt_order.is_empty()
            || self.command_receipt_bytes != 0
            || !self.persistence_authority.records().is_empty()
            || self.persistence_authority.checkpoint().is_some()
            || !self.persistence_authority.dirty_records().is_empty()
            || !self.persistence_dispatcher.is_idle()
            || !self.prepared_persistence_commits.is_empty()
            || self.network.authority_fingerprint() != empty_network.authority_fingerprint()
            || !self.replication_record_hashes.is_empty()
            || self.world.revision().mutation != 0
            || !self.world.edit_journal().is_empty()
        {
            return Err(IntegratedRuntimeError::new(
                "legacy-migration-not-pristine",
                "target runtime already owns non-default state and cannot safely infer a legacy migration",
            ));
        }

        let projection = decode_compatibility_save_binary_v1(&migration.world_projection)
            .map_err(|error| IntegratedRuntimeError::domain("legacy-migration-world", error))?;
        let expected_address = AuthorityWorldAddressV1::new(&self.config.universe_id, &self.config.location_id)
            .map_err(|error| IntegratedRuntimeError::domain("legacy-migration-world", error))?;
        if projection.address != expected_address {
            return Err(IntegratedRuntimeError::new(
                "legacy-migration-world",
                "legacy world projection belongs to another universe or location",
            ));
        }
        let mut migrated_world = WorldAuthorityStoreR4V1::new(expected_address, self.config.block_catalog.clone())
            .map_err(|error| IntegratedRuntimeError::domain("legacy-migration-world", error))?;
        migrated_world
            .import_compatibility_save(&projection, true)
            .map_err(|error| IntegratedRuntimeError::domain("legacy-migration-world", error))?;

        let mut candidate = self.clone();
        candidate.world = migrated_world;
        candidate.native_world_extension_bytes.clear();
        candidate.save_stages.remove(&migration.source_stage_id);
        let native_records = candidate.build_native_state_records()?;
        let save = CanonicalWorldSaveSetV1::build(
            candidate.persistence_authority.world_id(),
            &candidate.config.universe_id,
            &candidate.config.location_id,
            candidate.config.generator_hash,
            candidate.config.content_hash,
            stage.chunks.values().cloned(),
            native_records,
        )
        .map_err(|error| IntegratedRuntimeError::domain("legacy-migration-save", error))?;
        candidate
            .persistence_authority
            .stage_complete_save_set(&save)
            .map_err(|error| IntegratedRuntimeError::domain("legacy-migration-save", error))?;
        candidate.latest_commit_created_at = candidate.latest_commit_created_at.max(migration.created_at);
        let dispatcher_request_id = candidate.prepare_next_authority_commit()?;
        candidate.invalidate_state_hash();
        let remaining_dirty_records = u32::try_from(candidate.persistence_authority.dirty_records().len())
            .map_err(|_| IntegratedRuntimeError::new("legacy-migration-capacity", "dirty record count exceeds u32"))?;
        let progress = IntegratedRuntimeSaveProgressV1 {
            stage_id: migration.migration_id,
            received_chunks: stage.chunk_count,
            chunk_count: stage.chunk_count,
            received_bytes: stage.total_bytes,
            set_hash: save.set_hash,
            manifest_hash: save.manifest.manifest_hash,
            dispatcher_request_id,
            remaining_dirty_records,
        };
        *self = candidate;
        Ok(progress)
    }

    pub fn cancel_compatibility_save_stage(
        &mut self,
        stage_id: &str,
    ) -> Result<IntegratedRuntimeSaveProgressV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        let stage = self.save_stages.remove(stage_id).ok_or_else(|| {
            IntegratedRuntimeError::new("save-stage-stale", "save stage is unknown or already closed")
        })?;
        let progress = save_stage_progress(&stage);
        self.invalidate_state_hash();
        Ok(progress)
    }

    /// Atomically installs one fully assembled, checkpoint-verified recovery.
    /// Compatibility bytes remain an export shell and never substitute for a
    /// successfully decoded native authority record.
    pub fn hydrate_recovery(
        &mut self,
        recovery_id: &str,
    ) -> Result<IntegratedRuntimeHydrationSummaryV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        let complete = self.recovered_save_sets.get(recovery_id).cloned().ok_or_else(|| {
            IntegratedRuntimeError::new("recovery-incomplete", "recovery is not fully assembled and verified")
        })?;
        if !complete.missing_record_keys.is_empty() {
            return Err(IntegratedRuntimeError::new(
                "recovery-incomplete",
                "recovery is missing one or more required record payloads",
            ));
        }
        if complete.checkpoint.world_id != self.persistence_authority.world_id()
            || complete.checkpoint.generator_hash != self.config.generator_hash
            || complete.checkpoint.content_hash != self.config.content_hash
        {
            return Err(IntegratedRuntimeError::new(
                "recovery-fingerprint",
                "recovery checkpoint does not match this runtime's world fingerprints",
            ));
        }
        let manifest_payload = complete
            .payloads
            .iter()
            .find(|(address, _)| {
                address.kind == RecordKind::LocationManifest && address.record_id == WORLD_SAVE_MANIFEST_RECORD_ID_V1
            })
            .map(|(_, payload)| payload)
            .ok_or_else(|| IntegratedRuntimeError::new("recovery-manifest", "recovery manifest record is missing"))?;
        let manifest = decode_world_save_manifest_v1(manifest_payload)
            .map_err(|error| IntegratedRuntimeError::domain("recovery-manifest", error))?;
        if manifest.world_id != complete.checkpoint.world_id
            || manifest.universe_id != self.config.universe_id
            || manifest.location_id != self.config.location_id
            || manifest.generator_hash != self.config.generator_hash
            || manifest.content_hash != self.config.content_hash
        {
            return Err(IntegratedRuntimeError::new(
                "recovery-manifest",
                "recovery manifest does not match the active runtime identity",
            ));
        }
        let mut chunks = Vec::with_capacity(manifest.compatibility_chunks as usize);
        let mut compatibility_hasher = CanonicalHasher::new("blockwild-persistence-compatibility-stream-v1");
        let mut total_bytes = 0_u64;
        for index in 0..manifest.compatibility_chunks {
            let record_id = format!("{COMPATIBILITY_RECORD_PREFIX_V1}{index:08x}");
            let payload = complete
                .payloads
                .iter()
                .find(|(address, _)| address.kind == RecordKind::SettingsReference && address.record_id == record_id)
                .map(|(_, payload)| payload)
                .ok_or_else(|| {
                    IntegratedRuntimeError::new("recovery-compatibility", "compatibility recovery chunk is missing")
                })?;
            total_bytes = total_bytes.saturating_add(payload.len() as u64);
            compatibility_hasher.write_u32(index);
            compatibility_hasher.write_bytes(payload);
            chunks.push(payload.clone());
        }
        let compatibility_hash = compatibility_hasher.finish();
        if total_bytes != manifest.compatibility_byte_length || compatibility_hash != manifest.compatibility_hash {
            return Err(IntegratedRuntimeError::new(
                "recovery-compatibility",
                "compatibility recovery stream failed its manifest proof",
            ));
        }
        let mut envelopes = BTreeMap::new();
        for (address, payload) in &complete.payloads {
            if !payload.starts_with(NATIVE_RECORD_MAGIC_V1) {
                continue;
            }
            let envelope = decode_native_record_envelope_v1(payload)?;
            let (expected_record_kind, expected_record_id) = envelope.kind.address();
            if address.kind != expected_record_kind || address.record_id != expected_record_id {
                return Err(IntegratedRuntimeError::new(
                    "recovery-native-duplicate",
                    "native save contains a duplicate or address-mistagged authority record",
                ));
            }
            let envelope_kind = envelope.kind;
            if envelopes.insert(envelope_kind, envelope).is_some() {
                return Err(IntegratedRuntimeError::new(
                    "recovery-native-duplicate",
                    "native save contains a duplicate authority record",
                ));
            }
        }
        for expected_kind in IntegratedRuntimeNativeRecordKindV1::ALL {
            if !envelopes.contains_key(&expected_kind) {
                let (_, record_id) = expected_kind.address();
                return Err(IntegratedRuntimeError::new(
                    "recovery-native-missing",
                    format!("required native record {record_id} is missing"),
                ));
            }
        }
        let bundle_hash = envelopes
            .values()
            .next()
            .map(|envelope| envelope.bundle_hash)
            .ok_or_else(|| IntegratedRuntimeError::new("recovery-native-missing", "native record set is empty"))?;
        let bundle = IntegratedRuntimeNativeBundleV1 { bundle_hash, envelopes };
        let core = decode_and_validate_native_bundle_v1(&bundle)?;
        let proof_count = usize::from(core.durable_network_drained_proof.is_some())
            + usize::from(core.durable_state_proof.is_some())
            + usize::from(core.durable_replay_proof.is_some());
        let (rebound_core, durable_proofs) = if core.schema >= NATIVE_RUNTIME_CORE_SCHEMA_V5 {
            if proof_count != 3 {
                return Err(IntegratedRuntimeError::new(
                    "recovery-proof-incomplete",
                    "schema-v5 durable recovery requires network, state, and replay proofs together",
                ));
            }
            let expected_network_proof = core.durable_network_drained_proof.expect("complete proof set");
            if expected_network_proof != durable_network_drained_proof_v1() {
                return Err(IntegratedRuntimeError::new(
                    "recovery-network-proof",
                    "durable recovery network-drain proof is invalid",
                ));
            }
            let expected_state_proof = core.durable_state_proof.expect("complete proof set");
            let expected_replay_proof = core.durable_replay_proof.expect("complete proof set");
            let mut rebound_config = core.config.clone();
            rebound_config.session_id.clone_from(&self.config.session_id);
            if rebound_config != self.config {
                return Err(IntegratedRuntimeError::new(
                    "recovery-config",
                    "native runtime record does not match the target immutable world configuration",
                ));
            }
            let mut rebound = core;
            rebound.config = rebound_config;
            if durable_runtime_core_state_proof_v1(&rebound)? != expected_state_proof
                || durable_runtime_replay_proof_v1(&rebound) != expected_replay_proof
            {
                return Err(IntegratedRuntimeError::new(
                    "recovery-session-proof",
                    "session rebind changed durable state or replay identity",
                ));
            }
            (
                rebound,
                Some((expected_network_proof, expected_state_proof, expected_replay_proof)),
            )
        } else {
            if proof_count != 0 || core.config != self.config {
                return Err(IntegratedRuntimeError::new(
                    "recovery-config",
                    "legacy native recovery requires an exact target configuration including session",
                ));
            }
            (core, None)
        };

        let mut candidate = self.clone();
        candidate.install_native_bundle(&bundle, Some(rebound_core.clone()))?;
        if let Some((expected_network_proof, expected_state_proof, expected_replay_proof)) = durable_proofs {
            let mut installed_core = runtime_core_snapshot_from_runtime_v1(&candidate);
            // Persistence transport/head revision is recovered from the verified
            // BWPR checkpoint below. The native record owns every other revision.
            installed_core.expected_revision.persistence = rebound_core.expected_revision.persistence;
            if durable_runtime_core_state_proof_v1(&installed_core)? != expected_state_proof
                || durable_runtime_replay_proof_v1(&installed_core) != expected_replay_proof
            {
                return Err(IntegratedRuntimeError::new(
                    "recovery-state-drift",
                    "installed durable authorities do not reproduce the saved state and replay proofs",
                ));
            }
            if !candidate.durable_network_state_pristine
                || candidate.replication.record_count() != 0
                || !candidate.replication_record_hashes.is_empty()
                || candidate.durable_network_save_boundary_proof()? != expected_network_proof
            {
                return Err(IntegratedRuntimeError::new(
                    "recovery-network-active",
                    "recovered runtime did not reset network/grant/replication authority",
                ));
            }
        }
        candidate.persistence_authority =
            PersistenceAuthorityV1::recover(complete.checkpoint.clone(), complete.payloads.clone())
                .map_err(|error| IntegratedRuntimeError::domain("recovery-authority", error))?;
        while candidate.hydrated_exports.len() >= INTEGRATED_RUNTIME_MAX_HYDRATED_EXPORTS
            && !candidate.hydrated_exports.contains_key(recovery_id)
        {
            if let Some(expired) = candidate.hydrated_exports.keys().next().cloned() {
                candidate.hydrated_exports.remove(&expired);
            }
        }
        candidate.hydrated_exports.insert(
            recovery_id.to_owned(),
            IntegratedRuntimeHydratedExportV1 {
                chunks,
                total_bytes,
                compatibility_hash,
            },
        );
        candidate.recovered_save_sets.remove(recovery_id);
        candidate.invalidate_state_hash();
        let summary = IntegratedRuntimeHydrationSummaryV1 {
            recovery_id: recovery_id.to_owned(),
            native_domains: INTEGRATED_RUNTIME_NATIVE_DOMAIN_COUNT_V1,
            chunk_count: manifest.compatibility_chunks,
            total_bytes,
            compatibility_hash,
        };
        *self = candidate;
        Ok(summary)
    }

    pub fn read_hydrated_compatibility_chunk(
        &mut self,
        recovery_id: &str,
        chunk_index: u32,
    ) -> Result<IntegratedRuntimeHydrationChunkV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        let export = self.hydrated_exports.get(recovery_id).ok_or_else(|| {
            IntegratedRuntimeError::new("hydration-export", "hydrated compatibility export is unavailable")
        })?;
        let bytes = export.chunks.get(chunk_index as usize).cloned().ok_or_else(|| {
            IntegratedRuntimeError::new("hydration-export", "hydrated compatibility chunk index is out of range")
        })?;
        let transfer_token = self.next_hydration_transfer_token;
        self.next_hydration_transfer_token = self
            .next_hydration_transfer_token
            .checked_add(1)
            .ok_or_else(|| IntegratedRuntimeError::new("hydration-token", "hydration token space exhausted"))?;
        Ok(IntegratedRuntimeHydrationChunkV1 {
            transfer_token,
            chunk_index,
            chunk_count: export.chunks.len() as u32,
            bytes,
        })
    }

    /// Queues one Rust-selected persistence platform operation. The returned
    /// request identity becomes a complete BWPR only when the detached bulk
    /// lane polls it; no browser mutation occurs in this call.
    pub fn dispatch_persistence(
        &mut self,
        command: RuntimePersistenceDispatchWireV1,
    ) -> Result<RuntimePersistenceDispatchReceiptWireV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        let request_id = match command {
            RuntimePersistenceDispatchWireV1::Commit { browser_request } => {
                let decoded = decode_persistence_browser_request_v1(&browser_request)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?;
                let PersistenceBrowserRequestV1::Commit {
                    transaction,
                    checkpoint,
                    ..
                } = decoded
                else {
                    return Err(IntegratedRuntimeError::new(
                        "persistence-operation",
                        "commit dispatch requires one complete operation-1 BWPR",
                    ));
                };
                Some(
                    self.persistence_dispatcher
                        .prepare_commit(&transaction, &checkpoint)
                        .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
                )
            }
            RuntimePersistenceDispatchWireV1::Recover {
                world_id,
                checkpoint_id,
            } => Some(
                self.persistence_dispatcher
                    .recover(&world_id, checkpoint_id.as_deref())
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
            ),
            RuntimePersistenceDispatchWireV1::ReadRecoveryPage {
                world_id,
                checkpoint_id,
                start_record,
                max_records,
                max_bytes,
            } => Some(
                self.persistence_dispatcher
                    .read_recovery_page(&world_id, &checkpoint_id, start_record, max_records, max_bytes)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
            ),
            RuntimePersistenceDispatchWireV1::Estimate { world_id } => Some(
                self.persistence_dispatcher
                    .estimate(&world_id)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
            ),
            RuntimePersistenceDispatchWireV1::Compact {
                world_id,
                checkpoint_id,
                expected_head_hash,
                retain_parent_count,
            } => Some(
                self.persistence_dispatcher
                    .compact(&world_id, &checkpoint_id, expected_head_hash, retain_parent_count)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
            ),
            RuntimePersistenceDispatchWireV1::Delete {
                world_id,
                expected_head_hash,
                tombstone,
            } => Some(
                self.persistence_dispatcher
                    .delete(&world_id, expected_head_hash, tombstone)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
            ),
            RuntimePersistenceDispatchWireV1::PreserveLegacyBackupChunk {
                world_id,
                backup_id,
                offset,
                total_bytes,
                bytes,
            } => Some(
                self.persistence_dispatcher
                    .preserve_legacy_backup_chunk(&world_id, &backup_id, offset, total_bytes, bytes)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
            ),
            RuntimePersistenceDispatchWireV1::ExportPage {
                world_id,
                checkpoint_id,
                cursor,
                max_bytes,
            } => Some(
                self.persistence_dispatcher
                    .export_page(&world_id, &checkpoint_id, cursor, max_bytes)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
            ),
            RuntimePersistenceDispatchWireV1::ImportChunk {
                world_id,
                import_id,
                offset,
                total_bytes,
                bytes,
            } => Some(
                self.persistence_dispatcher
                    .import_chunk(&world_id, &import_id, offset, total_bytes, bytes)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
            ),
            RuntimePersistenceDispatchWireV1::FinalizeImport {
                world_id,
                import_id,
                archive_hash,
                total_bytes,
            } => Some(
                self.persistence_dispatcher
                    .finalize_import(&world_id, &import_id, archive_hash, total_bytes)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
            ),
            RuntimePersistenceDispatchWireV1::Retry { previous_request_id } => Some(
                self.persistence_dispatcher
                    .retry(previous_request_id)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?,
            ),
            RuntimePersistenceDispatchWireV1::Close => {
                self.persistence_dispatcher.close();
                None
            }
        };
        self.invalidate_state_hash();
        Ok(self.persistence_dispatch_receipt(request_id))
    }

    pub fn poll_persistence_platform(
        &mut self,
        max_bytes: usize,
    ) -> Result<Option<PersistenceDispatchPacketV1>, IntegratedRuntimeError> {
        self.ensure_running()?;
        let packet = self
            .persistence_dispatcher
            .poll(max_bytes)
            .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?;
        if packet.is_some() {
            self.invalidate_state_hash();
        }
        Ok(packet)
    }

    pub fn complete_persistence_platform(
        &mut self,
        transfer_token: u64,
        response: &[u8],
    ) -> Result<PersistenceDispatchOutcomeV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        let mut candidate = self.clone();
        let outcome = candidate
            .persistence_dispatcher
            .complete(transfer_token, response)
            .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?;
        if let Some(durable) = &outcome.durable_commit {
            if let Some(prepared) = candidate.prepared_persistence_commits.remove(&outcome.request_id) {
                candidate
                    .persistence_authority
                    .accept_durable_commit(&prepared, durable)
                    .map_err(|error| IntegratedRuntimeError::domain("persistence-authority", error))?;
                candidate.prepare_next_authority_commit()?;
            }
        } else if outcome.operation.is_none()
            && outcome.status == PersistenceDispatchStatusV1::Rejected
            && let Some(prepared) = candidate.prepared_persistence_commits.remove(&outcome.request_id)
        {
            candidate
                .persistence_authority
                .reject_or_abandon_commit(&prepared)
                .map_err(|error| IntegratedRuntimeError::domain("persistence-authority", error))?;
        }
        if outcome.status == PersistenceDispatchStatusV1::Accepted {
            match outcome.operation {
                Some(PersistencePlatformOperationV1::RecoverHead) => {
                    let head = decode_paged_recovery_head_v1(&outcome.payload)
                        .map_err(|error| IntegratedRuntimeError::domain("persistence-recovery", error))?;
                    if !candidate.recovery_assemblers.contains_key(&head.checkpoint_id)
                        && candidate.recovery_assemblers.len() >= INTEGRATED_RUNTIME_MAX_RECOVERY_ASSEMBLERS
                    {
                        return Err(IntegratedRuntimeError::new(
                            "recovery-capacity",
                            "recovery assembler capacity is exhausted",
                        ));
                    }
                    candidate
                        .recovery_assemblers
                        .entry(head.checkpoint_id.clone())
                        .or_insert_with(|| PagedRecoveryAssemblerV1::new(head));
                }
                Some(PersistencePlatformOperationV1::ReadRecoveryPage) => {
                    let page = decode_paged_recovery_page_v1(&outcome.payload)
                        .map_err(|error| IntegratedRuntimeError::domain("persistence-recovery", error))?;
                    let recovery_id = page.checkpoint_id.clone();
                    let assembler = candidate.recovery_assemblers.get_mut(&recovery_id).ok_or_else(|| {
                        IntegratedRuntimeError::new(
                            "recovery-page-order",
                            "recovery page arrived before its verified head",
                        )
                    })?;
                    if let Some(complete) = assembler
                        .accept_page(page)
                        .map_err(|error| IntegratedRuntimeError::domain("persistence-recovery", error))?
                    {
                        candidate.recovery_assemblers.remove(&recovery_id);
                        candidate.recovered_save_sets.insert(recovery_id, complete);
                    }
                }
                _ => {}
            }
        }
        candidate.invalidate_state_hash();
        *self = candidate;
        Ok(outcome)
    }

    /// Recovery-shell state only. It preserves in-flight BWPR tokens and retry
    /// policy across a Worker crash; it is deliberately not a world/gameplay
    /// checkpoint and must never be passed to RuntimeRequestV1::Restore.
    pub fn persistence_dispatcher_checkpoint(&self) -> Result<Vec<u8>, IntegratedRuntimeError> {
        self.persistence_dispatcher
            .checkpoint_state()
            .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))
    }

    pub fn restore_persistence_dispatcher_checkpoint(
        &mut self,
        checkpoint: &[u8],
    ) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        self.persistence_dispatcher = PersistenceDispatcherV1::restore_state(checkpoint)
            .map_err(|error| IntegratedRuntimeError::domain("persistence-dispatch", error))?;
        self.invalidate_state_hash();
        Ok(())
    }

    fn persistence_dispatch_receipt(&self, request_id: Option<u64>) -> RuntimePersistenceDispatchReceiptWireV1 {
        let diagnostics = self.persistence_dispatcher.diagnostics();
        RuntimePersistenceDispatchReceiptWireV1 {
            request_id,
            persistence_revision: diagnostics.persistence_revision,
            pending: u32::try_from(diagnostics.queued.saturating_add(diagnostics.in_flight))
                .expect("dispatcher pending count is bounded"),
            queued_bytes: diagnostics.queued_bytes as u64,
            state_hash: diagnostics.state_hash,
            closed: diagnostics.closed,
        }
    }

    fn prepare_next_authority_commit(&mut self) -> Result<Option<u64>, IntegratedRuntimeError> {
        if !self.prepared_persistence_commits.is_empty() || self.persistence_authority.dirty_records().is_empty() {
            return Ok(None);
        }
        let prepared = self
            .persistence_authority
            .prepare_commit_with_max_bytes(
                self.latest_commit_created_at,
                INTEGRATED_RUNTIME_PERSISTENCE_MAX_COMMIT_PAYLOAD_BYTES,
            )
            .map_err(|error| IntegratedRuntimeError::domain("persistence-authority", error))?;
        let request_id = match self
            .persistence_dispatcher
            .prepare_commit(&prepared.transaction, &prepared.checkpoint)
        {
            Ok(request_id) => request_id,
            Err(error) => {
                self.persistence_authority
                    .reject_or_abandon_commit(&prepared)
                    .map_err(|abandon| IntegratedRuntimeError::domain("persistence-authority", abandon))?;
                return Err(IntegratedRuntimeError::domain("persistence-dispatch", error));
            }
        };
        self.prepared_persistence_commits.insert(request_id, prepared);
        Ok(Some(request_id))
    }

    #[must_use]
    pub fn network(&self) -> &NetworkBrowserAuthorityRuntimeV1 {
        &self.network
    }

    #[must_use]
    pub fn generation_diagnostics(&self) -> GenerationDiagnostics {
        self.generation.diagnostics()
    }

    #[must_use]
    pub const fn tick(&self) -> u64 {
        self.tick
    }

    #[must_use]
    pub const fn is_stopped(&self) -> bool {
        self.stopped
    }

    #[must_use]
    pub fn revision(&self) -> IntegratedRuntimeRevisionV2 {
        let world_revision = self.world.revision();
        IntegratedRuntimeRevisionV2 {
            epoch: world_revision.epoch,
            world: world_revision.mutation.saturating_add(world_revision.residency),
            entities: self.entities.revision(),
            gameplay: self
                .gameplay
                .state
                .revision
                .sequence
                .saturating_add(self.gameplay_authority_revision)
                .saturating_add(self.world_view.state.revision.sequence),
            persistence: self
                .persistence
                .sequence()
                .saturating_add(self.persistence_dispatcher.persistence_revision())
                .saturating_add(self.persistence_authority.persistence_revision()),
            network: self.network_revision,
            simulation: self.simulation_revision,
        }
    }

    #[must_use]
    pub fn identity(&self) -> IntegratedRuntimeIdentityV2 {
        IntegratedRuntimeIdentityV2 {
            schema_version: INTEGRATED_RUNTIME_SCHEMA_V2,
            universe_id: self.config.universe_id.clone(),
            location_id: self.config.location_id.clone(),
            revision: self.revision(),
            tick: self.tick,
            state_hash: self.state_hash(),
        }
    }

    #[must_use]
    pub fn state_hash(&self) -> CanonicalHash {
        if let Some(hash) = self.state_hash_cache.get() {
            return hash;
        }
        let mut hasher = CanonicalHasher::new("blockwild-integrated-authority-v2");
        hasher.write_u16(INTEGRATED_RUNTIME_SCHEMA_V2);
        hasher.write_str(&self.config.world_seed);
        hasher.write_str(&self.config.universe_id);
        hasher.write_str(&self.config.location_id);
        hasher.write_bytes(self.config.content_hash.as_bytes());
        hasher.write_bytes(self.config.generator_hash.as_bytes());
        hasher.write_bytes(self.config.terrain_content_hash.as_bytes());
        hasher.write_str(&self.config.generation_options_json);
        match (&self.content_stage, &self.content_attestation) {
            (Some(stage), None) => {
                hasher.write_u16(1);
                hasher.write_str(&stage.install_id);
                hasher.write_str(&stage.source_revision);
                hasher.write_bytes(stage.manifest_hash.as_bytes());
                write_content_domain_digests(&mut hasher, &stage.domains);
                hasher.write_u32(stage.page_count);
                hasher.write_u32(stage.page_hashes.len() as u32);
                for page_hash in &stage.page_hashes {
                    hasher.write_bytes(page_hash.as_bytes());
                }
                hasher.write_u32(stage.artifacts.len() as u32);
            }
            (None, Some(attestation)) => {
                hasher.write_u16(2);
                hasher.write_str(&attestation.install_id);
                hasher.write_str(&attestation.source_revision);
                hasher.write_bytes(attestation.manifest_hash.as_bytes());
                write_content_domain_digests(&mut hasher, &attestation.domains);
                hasher.write_u32(attestation.installed_entries);
                hasher.write_u64(attestation.installed_bytes);
                hasher.write_u32(attestation.page_hashes.len() as u32);
                for page_hash in &attestation.page_hashes {
                    hasher.write_bytes(page_hash.as_bytes());
                }
            }
            (None, None) => hasher.write_u16(0),
            (Some(_), Some(_)) => unreachable!("content installation is either staged or installed"),
        }
        hasher.write_bytes(self.gameplay_content_runtime.registry_hash.as_bytes());
        hasher.write_u64(self.tick);
        hasher.write_u64(self.accumulator_us);
        hasher.write_u32(self.rng_state);
        let revision = self.revision();
        write_runtime_revision(&mut hasher, revision);
        hasher.write_bytes(self.world.canonical_state_hash().as_bytes());
        hasher.write_bytes(self.entities.canonical_hash().as_bytes());
        hasher.write_u64(self.entity_command_sequence);
        write_camera_state_v1(&mut hasher, self.camera);
        if let Some(player) = &self.player {
            hasher.write_u16(1);
            write_player_state(&mut hasher, player);
        } else {
            hasher.write_u16(0);
        }
        hasher.write_u32(self.effect_events.len() as u32);
        for event in &self.effect_events {
            write_effect_event(&mut hasher, event);
        }
        hasher.write_u64(self.next_effect_sequence);
        hasher.write_bytes(self.gameplay.state.state_hash().as_bytes());
        hasher.write_u64(self.gameplay_authority_revision);
        hasher.write_bytes(self.world_view.state.state_hash().as_bytes());
        hasher.write_bytes(self.persistence.state_hash().as_bytes());
        hasher.write_bytes(self.persistence_authority.state_hash().as_bytes());
        hasher.write_bytes(self.persistence_dispatcher.state_hash().as_bytes());
        hasher.write_u32(self.save_stages.len() as u32);
        for (stage_id, stage) in &self.save_stages {
            hasher.write_str(stage_id);
            hasher.write_u32(stage.chunk_count);
            hasher.write_u64(stage.total_bytes);
            hasher.write_u32(stage.chunks.len() as u32);
            for (index, chunk) in &stage.chunks {
                hasher.write_u32(*index);
                hasher.write_u64(chunk.len() as u64);
                hasher.write_bytes(
                    stage
                        .chunk_hashes
                        .get(index)
                        .expect("save-stage chunk hash accompanies every chunk")
                        .as_bytes(),
                );
            }
        }
        hasher.write_u32(self.prepared_persistence_commits.len() as u32);
        for (request_id, prepared) in &self.prepared_persistence_commits {
            hasher.write_u64(*request_id);
            hasher.write_str(&prepared.transaction.transaction_id);
            hasher.write_bytes(prepared.checkpoint.checkpoint_hash.as_bytes());
        }
        hasher.write_bytes(self.network.authority_fingerprint().as_bytes());
        hasher.write_u32(self.replication_record_hashes.len() as u32);
        for (key, hash) in &self.replication_record_hashes {
            hasher.write_str(key);
            hasher.write_bytes(hash.as_bytes());
        }
        hasher.write_u64(self.last_input_sequence.unwrap_or_default());
        hasher.write_u32(self.queued_inputs.len() as u32);
        for input in &self.queued_inputs {
            write_runtime_input(&mut hasher, input);
        }
        if let Some(input) = &self.last_applied_input {
            hasher.write_u16(1);
            write_runtime_input(&mut hasher, input);
        } else {
            hasher.write_u16(0);
        }
        hasher.write_u64(self.next_action_sequence);
        hasher.write_u16(u16::from(self.next_context_command_sequence.is_some()));
        hasher.write_u64(self.next_context_command_sequence.unwrap_or_default());
        hasher.write_u32(self.queued_context_commands.len() as u32);
        for command in &self.queued_context_commands {
            hasher.write_bytes(&command.command_hash.0);
        }
        match &self.mining_state {
            Some(mining) => {
                hasher.write_u16(1);
                write_mining_state_v1(&mut hasher, mining);
            }
            None => hasher.write_u16(0),
        }
        hasher.write_u32(self.block_action_loot_rng.state);
        hasher.write_u64(self.block_action_loot_rng.draw_count);
        hasher.write_u16(u16::from(self.next_block_action_sequence.is_some()));
        hasher.write_u64(self.next_block_action_sequence.unwrap_or_default());
        hasher.write_u64(self.block_action_receipts.len() as u64);
        for receipt in &self.block_action_receipts {
            hasher.write_bytes(receipt.receipt_hash.as_bytes());
        }
        let hash = hasher.finish();
        self.state_hash_cache.set(Some(hash));
        hash
    }

    #[must_use]
    pub fn replay_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild-integrated-replay-v2");
        hasher.write_u64(self.replay.len() as u64);
        self.replay_digest.write_hash(&mut hasher);
        hasher.finish()
    }

    pub fn enqueue(&mut self, batch: IntegratedRuntimeBatchV2) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        batch.validate()?;
        if self.queued.len() >= INTEGRATED_RUNTIME_MAX_QUEUED_BATCHES {
            return Err(IntegratedRuntimeError::new(
                "queue-capacity",
                "integrated command queue is full",
            ));
        }
        self.queued.push_back(batch);
        Ok(())
    }

    pub fn commit(&mut self, batch: IntegratedRuntimeBatchV2) -> IntegratedRuntimeReceiptV2 {
        let current = self.identity();
        if self.stopped {
            return reject_batch(
                &batch.batch_id,
                "engine-stopped",
                "integrated runtime is stopped",
                current,
            );
        }
        if let Err(error) = batch.validate() {
            return reject_batch(&batch.batch_id, error.code, &error.message, current);
        }
        let idempotency_key = batch
            .reliability
            .as_ref()
            .map(|reliability| format!("{}\0{}", reliability.actor_id, reliability.idempotency_key));
        if let (Some(key), Some(reliability)) = (idempotency_key.as_ref(), batch.reliability.as_ref())
            && let Some(cached) = self.idempotency.get(key)
        {
            if cached.command_hash == reliability.command_hash {
                return cached.receipt.clone();
            }
            return reject_batch(
                &batch.batch_id,
                "idempotency-conflict",
                "idempotency key was reused for different command bytes",
                current,
            );
        }
        let receipt = self.commit_uncached(batch.clone());
        self.cache_idempotent_receipt(&batch, idempotency_key, &receipt);
        receipt
    }

    fn commit_uncached(&mut self, batch: IntegratedRuntimeBatchV2) -> IntegratedRuntimeReceiptV2 {
        let current = self.identity();
        if batch.expected != current {
            return reject_batch(
                &batch.batch_id,
                "stale-runtime",
                "integrated batch was authored against a stale authority identity",
                current,
            );
        }

        let before = current;
        let mut world_receipts = Vec::with_capacity(batch.world.len());
        let mut entity_receipts = Vec::with_capacity(batch.entities.len());
        let mut gameplay_receipts = Vec::with_capacity(batch.gameplay.len());
        let mut persistence_receipts = Vec::with_capacity(batch.persistence.len());
        let mut staged_world = self.world.clone();
        let mut staged_entities = self.entities.clone();
        let mut staged_gameplay = self.gameplay.clone();
        let mut staged_persistence = self.persistence.clone();

        for command in &batch.world {
            let receipt = staged_world.apply_mutation_batch(command.clone());
            if let WorldMutationReceiptR4V1::Rejected { code, message, .. } = &receipt {
                return reject_batch(
                    &batch.batch_id,
                    "world-rejected",
                    &format!("{code:?}: {message}"),
                    before,
                );
            }
            world_receipts.push(receipt);
        }
        for command in &batch.entities {
            match staged_entities.apply_batch(command) {
                Ok(receipt) => entity_receipts.push(receipt),
                Err(error) => {
                    return reject_batch(&batch.batch_id, "entity-rejected", &format!("{error:?}"), before);
                }
            }
        }
        for command in &batch.gameplay {
            if let Err(error) = self.validate_new_combat_presentation_commands_v1(command) {
                return reject_batch(&batch.batch_id, error.code, &error.message, before);
            }
            let receipt = staged_gameplay.apply_batch(command);
            if let GameplayReceipt::Rejected { rejection, .. } = &receipt {
                return reject_batch(
                    &batch.batch_id,
                    "gameplay-rejected",
                    &format!("{:?}: {}", rejection.code, rejection.message),
                    before,
                );
            }
            gameplay_receipts.push(receipt);
        }
        for command in &batch.persistence {
            match staged_persistence.apply(command) {
                Ok(receipt) => persistence_receipts.push(receipt),
                Err(error) => {
                    return reject_batch(&batch.batch_id, "persistence-rejected", &error.to_string(), before);
                }
            }
        }
        let staged_world_view = match stage_world_view_batches_v1(
            &self.world_view,
            &staged_gameplay.state,
            &staged_entities,
            &batch.world_view,
        ) {
            Ok(staged) => staged,
            Err(error) => return reject_batch(&batch.batch_id, "world-view-rejected", &error.to_string(), before),
        };
        let world_view_receipts = staged_world_view.receipts;
        let mut staged_runtime = self.clone();
        staged_runtime.world = staged_world;
        staged_runtime.entities = staged_entities;
        staged_runtime.gameplay = staged_gameplay;
        staged_runtime.world_view = staged_world_view.authority;
        staged_runtime.persistence = staged_persistence;
        if staged_runtime.world.revision() != self.world.revision() {
            staged_runtime.mining_state = None;
        }
        staged_runtime.entity_command_sequence = entity_receipts
            .iter()
            .fold(staged_runtime.entity_command_sequence, |sequence, receipt| {
                sequence.max(receipt.sequence)
            });
        if let Err(error) = staged_runtime.sync_entity_schedules(&entity_receipts) {
            return reject_batch(&batch.batch_id, error.code, &error.message, before);
        }
        if let Err(error) = staged_runtime.validate_runtime_cross_domain_links_v1() {
            return reject_batch(&batch.batch_id, error.code, &error.message, before);
        }
        if let Err(error) = staged_runtime.validate_combat_presentation_bindings_v1() {
            return reject_batch(&batch.batch_id, error.code, &error.message, before);
        }
        *self = staged_runtime;
        self.invalidate_state_hash();
        let after = self.identity();
        let receipt_hash = hash_runtime_receipt(&batch.batch_id, &before, &after);
        let sequence = self.replay.back().map_or(1, |entry| entry.sequence.saturating_add(1));
        let replay_entry = IntegratedRuntimeReplayEntryV2 {
            sequence,
            batch_id: batch.batch_id.clone(),
            before_hash: before.state_hash,
            after_hash: after.state_hash,
            receipt_hash,
        };
        self.replay_digest.add(hash_runtime_replay_entry(&replay_entry));
        self.replay.push_back(replay_entry);
        while self.replay.len() > INTEGRATED_RUNTIME_MAX_REPLAY_ENTRIES {
            if let Some(removed) = self.replay.pop_front() {
                self.replay_digest.remove(hash_runtime_replay_entry(&removed));
            }
        }
        IntegratedRuntimeReceiptV2::Accepted(Box::new(IntegratedRuntimeAcceptedV2 {
            batch_id: batch.batch_id.clone(),
            before,
            after,
            world: world_receipts,
            entities: entity_receipts,
            gameplay: gameplay_receipts,
            world_view: world_view_receipts,
            persistence: persistence_receipts,
        }))
    }

    pub fn step(
        &mut self,
        monotonic_time_us: u64,
        budget_us: u32,
    ) -> Result<IntegratedRuntimeStepSummaryV2, IntegratedRuntimeError> {
        if !self.queued_context_commands.is_empty() {
            return Err(IntegratedRuntimeError::new(
                "context-command-pending",
                "schema-2 StepV1 cannot cross a queued schema-6 context command",
            ));
        }
        let mut candidate = self.clone();
        let summary = candidate.step_staged(monotonic_time_us, budget_us, false)?;
        *self = candidate;
        Ok(summary)
    }

    /// Atomically accepts one schema-6 input/context batch and advances the
    /// fixed-step clock. Any validation or simulation failure leaves the
    /// complete runtime untouched.
    pub fn step_context_v2(
        &mut self,
        monotonic_time_us: u64,
        budget_us: u32,
        inputs: &[RuntimeInputFrameV1],
        context_commands: &[RuntimeContextCommandV2],
    ) -> Result<IntegratedRuntimeStepSummaryV2, IntegratedRuntimeError> {
        let mut candidate = self.clone();
        candidate.accept_inputs(inputs)?;
        candidate.accept_context_commands_v2(context_commands)?;
        let summary = candidate.step_staged(monotonic_time_us, budget_us, true)?;
        *self = candidate;
        Ok(summary)
    }

    fn step_staged(
        &mut self,
        monotonic_time_us: u64,
        budget_us: u32,
        context_lane_enabled: bool,
    ) -> Result<IntegratedRuntimeStepSummaryV2, IntegratedRuntimeError> {
        self.ensure_running()?;
        if !context_lane_enabled && !self.queued_context_commands.is_empty() {
            return Err(IntegratedRuntimeError::new(
                "context-command-pending",
                "schema-2 StepV1 cannot cross a queued schema-6 context command",
            ));
        }
        if monotonic_time_us < self.last_monotonic_time_us {
            return Err(IntegratedRuntimeError::new(
                "monotonic-time-regression",
                "runtime step monotonic time cannot move backward",
            ));
        }
        self.invalidate_state_hash();
        let delta = if self.last_monotonic_time_us == 0 {
            0
        } else {
            monotonic_time_us
                .saturating_sub(self.last_monotonic_time_us)
                .min(250_000)
        };
        self.last_monotonic_time_us = monotonic_time_us;
        self.accumulator_us = self.accumulator_us.saturating_add(delta);
        let maximum_steps = (u64::from(budget_us) / 250).clamp(1, 8) as u32;
        let due_steps = (self.accumulator_us / INTEGRATED_RUNTIME_FIXED_STEP_US).min(u64::from(maximum_steps)) as u32;
        let mut inputs_applied = 0_u32;
        let mut action_receipts = Vec::new();
        let mut semantic_receipts = Vec::new();
        for _ in 0..due_steps {
            self.tick = self.tick.saturating_add(1);
            self.rng_state = super::xorshift32(self.rng_state);
            self.accumulator_us -= INTEGRATED_RUNTIME_FIXED_STEP_US;
            let mut fixed_input = self.last_applied_input.unwrap_or_default();
            while self
                .queued_inputs
                .front()
                .is_some_and(|input| input.target_tick <= self.tick)
            {
                let input = self.queued_inputs.pop_front().expect("due input exists");
                let previous_buttons = self.last_applied_input.map_or(0, |value| value.buttons);
                self.apply_selected_slot(input)?;
                action_receipts.extend(self.dispatch_input_edges(input, previous_buttons)?);
                self.last_applied_input = Some(input);
                fixed_input = input;
                inputs_applied = inputs_applied.saturating_add(1);
            }
            if context_lane_enabled {
                semantic_receipts.extend(self.dispatch_due_context_commands_v2());
            }
            self.advance_authoritative_fixed_step(fixed_input)?;
        }

        let command_budget =
            (usize::try_from(budget_us).unwrap_or(usize::MAX) / 200).clamp(1, INTEGRATED_RUNTIME_MAX_BATCHES_PER_STEP);
        let mut processed = 0_u32;
        let mut accepted = 0_u32;
        for _ in 0..command_budget {
            let Some(batch) = self.queued.pop_front() else {
                break;
            };
            let receipt = self.commit(batch);
            processed += 1;
            accepted += u32::from(receipt.accepted());
            self.receipts.push_back(receipt);
        }
        Ok(IntegratedRuntimeStepSummaryV2 {
            tick: self.tick,
            fixed_steps: due_steps,
            processed_batches: processed,
            accepted_batches: accepted,
            inputs_applied,
            action_receipts,
            semantic_receipts,
            state_hash: self.state_hash(),
            replay_hash: self.replay_hash(),
        })
    }

    pub fn take_receipts(&mut self) -> Vec<IntegratedRuntimeReceiptV2> {
        self.receipts.drain(..).collect()
    }

    #[must_use]
    pub fn lookup_runtime_command_receipt(
        &self,
        actor_id: &str,
        idempotency_key: &str,
        command_hash: WireHash,
    ) -> RuntimeCommandCacheLookupV1 {
        let key = (actor_id.to_owned(), idempotency_key.to_owned());
        match self.command_receipts.get(&key) {
            None => RuntimeCommandCacheLookupV1::Miss,
            Some(entry) if entry.command_hash == command_hash => {
                RuntimeCommandCacheLookupV1::Exact(Box::new(entry.receipt.clone()))
            }
            Some(_) => RuntimeCommandCacheLookupV1::Conflict,
        }
    }

    /// Caches one exact BWRQ command receipt without changing authority
    /// identity. Reliability metadata is checkpoint-owned but is deliberately
    /// excluded from runtime revisions and state hashes.
    pub fn cache_runtime_command_receipt(
        &mut self,
        actor_id: &str,
        idempotency_key: &str,
        command_hash: WireHash,
        receipt: RuntimeCommandReceiptV1,
    ) -> Result<(), IntegratedRuntimeError> {
        if actor_id.is_empty() || actor_id.len() > 160 || idempotency_key.is_empty() || idempotency_key.len() > 256 {
            return Err(IntegratedRuntimeError::new(
                "idempotency-receipt-key",
                "command receipt cache key is outside BWRQ label bounds",
            ));
        }
        let (receipt_key, receipt_hash) = runtime_command_receipt_key_hash_v1(&receipt);
        if receipt_key != idempotency_key || receipt_hash != command_hash {
            return Err(IntegratedRuntimeError::new(
                "idempotency-receipt-mismatch",
                "cached receipt does not match its idempotency key and command hash",
            ));
        }
        validate_command_receipt_hash_v1(&receipt)
            .map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
        let encoded_receipt = encode_command_receipt_v1(&receipt)
            .map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
        let entry_bytes =
            runtime_command_receipt_cache_entry_bytes_v1(actor_id, idempotency_key, encoded_receipt.len());
        if encoded_receipt.len() > MAX_WIRE_BYTES || entry_bytes > INTEGRATED_RUNTIME_MAX_COMMAND_RECEIPT_CACHE_BYTES_V1
        {
            return Err(IntegratedRuntimeError::new(
                "idempotency-receipt-capacity",
                "exact command receipt exceeds the durable reliability cache byte budget",
            ));
        }
        let key = (actor_id.to_owned(), idempotency_key.to_owned());
        if let Some(existing) = self.command_receipts.get(&key) {
            if existing.command_hash == command_hash && existing.encoded_receipt == encoded_receipt {
                return Ok(());
            }
            return Err(IntegratedRuntimeError::new(
                "idempotency-receipt-conflict",
                "command receipt cache key already contains different exact bytes",
            ));
        }
        while self.command_receipt_order.len() >= INTEGRATED_RUNTIME_MAX_IDEMPOTENCY_RECEIPTS
            || self.command_receipt_bytes.saturating_add(entry_bytes)
                > INTEGRATED_RUNTIME_MAX_COMMAND_RECEIPT_CACHE_BYTES_V1
        {
            let Some(expired) = self.command_receipt_order.pop_front() else {
                return Err(IntegratedRuntimeError::new(
                    "idempotency-receipt-capacity",
                    "durable reliability cache cannot admit the exact receipt",
                ));
            };
            if let Some(entry) = self.command_receipts.remove(&expired) {
                self.command_receipt_bytes =
                    self.command_receipt_bytes
                        .saturating_sub(runtime_command_receipt_cache_entry_bytes_v1(
                            &expired.0,
                            &expired.1,
                            entry.encoded_receipt.len(),
                        ));
            }
        }
        self.command_receipt_bytes = self.command_receipt_bytes.saturating_add(entry_bytes);
        self.command_receipt_order.push_back(key.clone());
        self.command_receipts.insert(
            key,
            IntegratedRuntimeCommandReceiptCacheEntryV1 {
                command_hash,
                receipt,
                encoded_receipt,
            },
        );
        Ok(())
    }

    pub fn player_bootstrap_status(
        &self,
        query: &PlayerBootstrapStatusQueryWireV1,
        request_payload_hash: CanonicalHash,
    ) -> Result<PlayerBootstrapStatusWireV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        let mut matching_entities = Vec::new();
        for (entity_id, entity) in self.entities.hot() {
            if entity.record.external_entity_id == query.external_entity_id {
                matching_entities.push(PlayerBootstrapEntityWireV1 {
                    entity_id: *entity_id,
                    entity_revision: entity.entity_revision,
                    residency: EntityResidency::Hot,
                    record: entity.record.clone(),
                });
            }
        }
        for (entity_id, entity) in self.entities.cold() {
            if entity.record.external_entity_id == query.external_entity_id {
                matching_entities.push(PlayerBootstrapEntityWireV1 {
                    entity_id: *entity_id,
                    entity_revision: entity.entity_revision,
                    residency: EntityResidency::Cold,
                    record: entity.record.clone(),
                });
            }
        }
        if matching_entities.len() > 1 {
            return Err(IntegratedRuntimeError::new(
                "player-bootstrap-duplicate-entity",
                "multiple authoritative entities use the requested external player identity",
            ));
        }
        let entity = matching_entities.pop();
        if entity
            .as_ref()
            .is_some_and(|entity| entity.record.class != EntityClass::Player)
        {
            return Err(IntegratedRuntimeError::new(
                "player-bootstrap-entity-class",
                "requested external player identity belongs to a non-player entity",
            ));
        }
        let target_entity_id = entity.as_ref().map(|entity| entity.entity_id);

        let runtime_player = match &self.player {
            Some(player) => {
                let touches_target = player.binding.external_entity_id == query.external_entity_id
                    || player.binding.actor_id == query.actor_id
                    || player.binding.player_id == query.player_id
                    || target_entity_id == Some(player.entity_id);
                if !touches_target {
                    return Err(IntegratedRuntimeError::new(
                        "player-bootstrap-runtime-conflict",
                        "runtime already owns a different complete player binding",
                    ));
                }
                if player.binding.external_entity_id != query.external_entity_id
                    || player.binding.actor_id != query.actor_id
                    || player.binding.player_id != query.player_id
                    || target_entity_id != Some(player.entity_id)
                {
                    return Err(IntegratedRuntimeError::new(
                        "player-bootstrap-runtime-partial",
                        "runtime player identity only partially matches the requested target",
                    ));
                }
                Some(PlayerBootstrapRuntimePlayerWireV1 {
                    entity_id: player.entity_id,
                    binding: player.binding.clone(),
                })
            }
            None => None,
        };

        let mut world_view_matches = self
            .world_view
            .state
            .player_bindings
            .values()
            .filter(|binding| {
                binding.player_id == query.player_id
                    || binding.actor_id == query.actor_id
                    || target_entity_id == Some(binding.entity_id)
            })
            .cloned()
            .collect::<Vec<_>>();
        if world_view_matches.len() > 1 {
            return Err(IntegratedRuntimeError::new(
                "player-bootstrap-duplicate-binding",
                "multiple world-view player bindings match the requested player, actor, or entity",
            ));
        }
        let world_view_binding = world_view_matches.pop();
        if let Some(binding) = &world_view_binding
            && (binding.player_id != query.player_id
                || binding.actor_id != query.actor_id
                || target_entity_id != Some(binding.entity_id))
        {
            return Err(IntegratedRuntimeError::new(
                "player-bootstrap-world-view-partial",
                "world-view binding only partially matches the requested target",
            ));
        }

        let expected_inventory = ContainerKey::player(query.actor_id.clone());
        let expected_equipment = ContainerKey {
            kind: ContainerKind::Equipment,
            id: format!("{}:equipment", query.actor_id),
            owner_id: Some(query.actor_id.clone()),
        };
        let actor_custodies = self
            .gameplay
            .state
            .inventory
            .containers
            .values()
            .filter(|container| {
                container.key.owner_id.as_deref() == Some(query.actor_id.as_str())
                    && matches!(container.key.kind, ContainerKind::Player | ContainerKind::Equipment)
            })
            .collect::<Vec<_>>();
        let custody = if let Some(binding) = &world_view_binding {
            if binding.inventory_container != expected_inventory
                || binding.equipment_container != expected_equipment
                || binding.selected_slot >= 9
                || binding.back_slot != Some(7)
                || actor_custodies.len() != 2
            {
                return Err(IntegratedRuntimeError::new(
                    "player-bootstrap-custody-partial",
                    "world-view player binding contradicts the canonical player custody layout",
                ));
            }
            let inventory = self
                .gameplay
                .state
                .inventory
                .containers
                .get(&binding.inventory_container)
                .ok_or_else(|| {
                    IntegratedRuntimeError::new(
                        "player-bootstrap-custody-partial",
                        "bound player inventory container is absent",
                    )
                })?;
            let equipment = self
                .gameplay
                .state
                .inventory
                .containers
                .get(&binding.equipment_container)
                .ok_or_else(|| {
                    IntegratedRuntimeError::new(
                        "player-bootstrap-custody-partial",
                        "bound player equipment container is absent",
                    )
                })?;
            if inventory.slots.len() != 9 || equipment.slots.len() != 8 {
                return Err(IntegratedRuntimeError::new(
                    "player-bootstrap-custody-slots",
                    "bound player custody does not have the exact nine/eight slot layout",
                ));
            }
            let referenced_metadata = referenced_inventory_metadata(&self.gameplay.state, &inventory.slots)?;
            Some(PlayerBootstrapCustodyWireV1 {
                inventory_container: inventory.key.clone(),
                inventory_revision: inventory.revision,
                inventory_slots: inventory.slots.clone(),
                equipment_container: equipment.key.clone(),
                equipment_revision: equipment.revision,
                equipment_slots: equipment.slots.clone(),
                referenced_metadata,
            })
        } else {
            if !actor_custodies.is_empty() {
                return Err(IntegratedRuntimeError::new(
                    "player-bootstrap-custody-partial",
                    "player custody exists without its world-view binding",
                ));
            }
            None
        };
        let bound = runtime_player.is_some();
        if bound != world_view_binding.is_some() || bound != custody.is_some() || (bound && entity.is_none()) {
            return Err(IntegratedRuntimeError::new(
                "player-bootstrap-partial",
                "runtime, entity, world-view, and custody player authority are only partially installed",
            ));
        }
        if let (Some(player), Some(binding)) = (&self.player, &world_view_binding)
            && (u16::from(player.selected_slot) != binding.selected_slot
                || player.last_input_sequence != self.last_applied_input.map_or(0, |input| input.sequence))
        {
            return Err(IntegratedRuntimeError::new(
                "player-bootstrap-runtime-continuity",
                "runtime player continuation contradicts world-view or last-applied input state",
            ));
        }
        if self.queued_inputs.is_empty()
            && self.last_input_sequence != self.last_applied_input.map(|input| input.sequence)
        {
            return Err(IntegratedRuntimeError::new(
                "player-bootstrap-input-continuity",
                "accepted input cursor contradicts the last-applied frame",
            ));
        }
        if self.next_action_sequence == 0 {
            return Err(IntegratedRuntimeError::new(
                "player-bootstrap-action-continuity",
                "action receipt sequence cursor uses the reserved zero value",
            ));
        }
        let next_input_sequence = match self.last_input_sequence {
            Some(sequence) => sequence.checked_add(1),
            None => Some(1),
        };
        let last_action_sequence = self.next_action_sequence.checked_sub(1).filter(|value| *value != 0);
        let authoritative_flags = self.player.as_ref().map_or(0, |player| player.flags);
        if authoritative_flags & !RUNTIME_INPUT_FLAG_MASK_V1 != 0 {
            return Err(IntegratedRuntimeError::new(
                "player-bootstrap-flags",
                "runtime player contains unregistered authoritative flags",
            ));
        }
        Ok(PlayerBootstrapStatusWireV1 {
            request_payload_hash,
            world_authority_revision: self.world.revision(),
            entity_authority_revision: self.entities.revision(),
            next_sequence: self.entity_command_sequence.checked_add(1),
            tick: self.tick,
            last_monotonic_time_us: self.last_monotonic_time_us,
            last_input_sequence: self.last_input_sequence,
            next_input_sequence,
            last_action_sequence,
            next_action_sequence: Some(self.next_action_sequence),
            authoritative_flags,
            last_applied_input: self.last_applied_input,
            queued_inputs_empty: self.queued_inputs.is_empty(),
            entity,
            runtime_player,
            world_view_binding,
            custody,
        })
    }

    /// Installs the native player combat record from the fully staged outer
    /// transaction candidate. Callers must invoke this only after all domain
    /// operations, including inventory import, have succeeded.
    pub fn install_bound_player_combatant_v1(&mut self) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        let player = self.player.clone().ok_or_else(|| {
            IntegratedRuntimeError::new(
                "player-combat-binding",
                "player combat install requires a complete runtime player binding",
            )
        })?;
        let entity = self.entities.hot().get(&player.entity_id).cloned().ok_or_else(|| {
            IntegratedRuntimeError::new(
                "player-combat-entity",
                "player combat install requires the bound hot R6 entity",
            )
        })?;
        if entity.record.class != EntityClass::Player
            || entity.record.external_entity_id != player.binding.external_entity_id
            || entity.record.health.to_bits() != entity.components.vitals.health.to_bits()
            || entity.record.maximum_health.to_bits() != entity.components.vitals.maximum_health.to_bits()
        {
            return Err(IntegratedRuntimeError::new(
                "player-combat-entity",
                "bound R6 player identity or component vitals are inconsistent",
            ));
        }
        let binding = self
            .world_view
            .state
            .player_binding(player.binding.player_id)
            .cloned()
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "player-combat-binding",
                    "player combat install requires the world-view player binding",
                )
            })?;
        if binding.actor_id != player.binding.actor_id
            || binding.entity_id != player.entity_id
            || usize::from(binding.selected_slot) != usize::from(player.selected_slot)
        {
            return Err(IntegratedRuntimeError::new(
                "player-combat-binding",
                "runtime and world-view player bindings disagree",
            ));
        }
        let inventory = self
            .gameplay
            .state
            .inventory
            .containers
            .get(&binding.inventory_container)
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "player-combat-inventory",
                    "player combat install requires imported inventory custody",
                )
            })?;
        let equipment = self
            .gameplay
            .state
            .inventory
            .containers
            .get(&binding.equipment_container)
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "player-combat-inventory",
                    "player combat install requires equipment custody",
                )
            })?;
        if inventory.revision == 0
            || usize::from(binding.selected_slot) >= inventory.slots.len()
            || equipment.slots.is_empty()
        {
            return Err(IntegratedRuntimeError::new(
                "player-combat-inventory",
                "player combat install requires a completed native inventory import candidate",
            ));
        }
        let health = quantize_player_vital_millihearts_v1(entity.record.health, "health")?;
        let max_health = quantize_player_vital_millihearts_v1(entity.record.maximum_health, "maximum health")?;
        if max_health == 0 || health > max_health {
            return Err(IntegratedRuntimeError::new(
                "player-combat-vitals",
                "quantized R6 player vitals are outside their native bounds",
            ));
        }
        let combatant = CombatantState {
            record_id: player.binding.actor_id.clone(),
            owner_id: Some(player.binding.actor_id.clone()),
            revision: 0,
            position: FixedVec3 {
                x_milli: quantize_player_position_millimeters_v1(entity.record.position.x, "x")?,
                y_milli: quantize_player_position_millimeters_v1(entity.record.position.y, "y")?,
                z_milli: quantize_player_position_millimeters_v1(entity.record.position.z, "z")?,
            },
            health,
            max_health,
            stamina: 0,
            mana: 0,
            armor: 0,
            resist_per_mille: BTreeMap::new(),
            statuses: BTreeMap::new(),
            cooldown_until: BTreeMap::new(),
            alive: health > 0,
            vital_units: CombatVitalUnits::MilliheartsV1,
            entity_id: Some(player.entity_id),
        };
        self.gameplay
            .install_linked_combatant_v1(combatant)
            .map_err(|error| IntegratedRuntimeError::new("player-combat-install", error.message))?;
        self.invalidate_state_hash();
        Ok(())
    }

    /// Returns an explicit native combat bootstrap classification. Legacy
    /// records remain visibly unlinked; this read never upgrades or fabricates
    /// an R6 entity link.
    pub fn player_combat_bootstrap_status_v1(
        &self,
        query: &PlayerBootstrapStatusQueryWireV1,
        request_payload_hash: CanonicalHash,
    ) -> Result<PlayerCombatBootstrapStatusWireV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        let mut matching_entities = self
            .entities
            .hot()
            .iter()
            .filter(|(_, entity)| entity.record.external_entity_id == query.external_entity_id)
            .map(|(entity_id, entity)| (*entity_id, entity.record.clone(), true))
            .chain(
                self.entities
                    .cold()
                    .iter()
                    .filter(|(_, entity)| entity.record.external_entity_id == query.external_entity_id)
                    .map(|(entity_id, entity)| (*entity_id, entity.record.clone(), false)),
            )
            .collect::<Vec<_>>();
        if matching_entities.len() > 1 {
            return Err(IntegratedRuntimeError::new(
                "player-combat-duplicate-entity",
                "multiple R6 entities use the requested external player identity",
            ));
        }
        let target = matching_entities.pop();
        let target_entity_id = target.as_ref().map(|(entity_id, _, _)| *entity_id);
        let matching_combatants = self
            .gameplay
            .state
            .combat
            .combatants
            .values()
            .filter(|combatant| {
                combatant.record_id == query.actor_id
                    || target_entity_id.is_some_and(|entity_id| combatant.entity_id == Some(entity_id))
            })
            .collect::<Vec<_>>();
        let base = |status, blocker, combatant| PlayerCombatBootstrapStatusWireV1 {
            request_payload_hash,
            entity_authority_revision: self.entities.revision(),
            gameplay_sequence: self.gameplay.state.revision.sequence,
            gameplay_combat_revision: self.gameplay.state.revision.combat,
            gameplay_state_hash: self.gameplay.state.state_hash(),
            status,
            blocker,
            combatant,
        };
        if matching_combatants.is_empty() {
            return Ok(base(PlayerCombatBootstrapStatusV1::Absent, None, None));
        }
        if matching_combatants.len() > 1 {
            return Ok(base(
                PlayerCombatBootstrapStatusV1::Blocked,
                Some(PlayerCombatBootstrapBlockerV1::DuplicateCombatClaim),
                None,
            ));
        }
        let combatant = matching_combatants[0];
        let attestation = |cross_domain_parity| PlayerCombatantBootstrapWireV1 {
            record_id: combatant.record_id.clone(),
            owner_id: combatant.owner_id.clone(),
            revision: combatant.revision,
            entity_id: combatant.entity_id,
            vital_units: combatant.vital_units,
            health: combatant.health,
            max_health: combatant.max_health,
            alive: combatant.alive,
            cross_domain_parity,
        };
        if combatant.record_id == query.actor_id
            && combatant.entity_id.is_none()
            && combatant.vital_units == CombatVitalUnits::LegacyWholeHeartsV1
        {
            return Ok(base(
                PlayerCombatBootstrapStatusV1::LegacyUnlinked,
                Some(PlayerCombatBootstrapBlockerV1::LegacyUnlinkedRequiresExplicitMigration),
                Some(attestation(false)),
            ));
        }
        let blocked = |blocker| {
            base(
                PlayerCombatBootstrapStatusV1::Blocked,
                Some(blocker),
                Some(attestation(false)),
            )
        };
        let Some((entity_id, record, hot)) = target else {
            return Ok(blocked(PlayerCombatBootstrapBlockerV1::MissingPlayerEntity));
        };
        let world_view_binding = self.world_view.state.player_binding(query.player_id);
        let binding_complete =
            hot && self.player.as_ref().is_some_and(|player| {
                player.entity_id == entity_id
                    && player.binding.external_entity_id == query.external_entity_id
                    && player.binding.actor_id == query.actor_id
                    && player.binding.player_id == query.player_id
            }) && world_view_binding.is_some_and(|binding| {
                binding.entity_id == entity_id
                    && binding.actor_id == query.actor_id
                    && self
                        .gameplay
                        .state
                        .inventory
                        .containers
                        .get(&binding.inventory_container)
                        .is_some_and(|inventory| {
                            inventory.revision > 0 && usize::from(binding.selected_slot) < inventory.slots.len()
                        })
                    && self
                        .gameplay
                        .state
                        .inventory
                        .containers
                        .contains_key(&binding.equipment_container)
            });
        if !binding_complete {
            return Ok(blocked(PlayerCombatBootstrapBlockerV1::IncompletePlayerBinding));
        }
        if combatant.record_id != query.actor_id {
            return Ok(blocked(PlayerCombatBootstrapBlockerV1::RecordIdentityConflict));
        }
        if combatant.entity_id != Some(entity_id) {
            return Ok(blocked(PlayerCombatBootstrapBlockerV1::EntityLinkConflict));
        }
        if combatant.owner_id.as_deref() != Some(query.actor_id.as_str()) {
            return Ok(blocked(PlayerCombatBootstrapBlockerV1::OwnerConflict));
        }
        if combatant.vital_units != CombatVitalUnits::MilliheartsV1 {
            return Ok(blocked(PlayerCombatBootstrapBlockerV1::VitalUnitConflict));
        }
        let Ok(health) = quantize_player_vital_millihearts_v1(record.health, "health") else {
            return Ok(blocked(PlayerCombatBootstrapBlockerV1::InvalidEntityVitals));
        };
        let Ok(max_health) = quantize_player_vital_millihearts_v1(record.maximum_health, "maximum health") else {
            return Ok(blocked(PlayerCombatBootstrapBlockerV1::InvalidEntityVitals));
        };
        if max_health == 0
            || health > max_health
            || combatant.health != health
            || combatant.max_health != max_health
            || combatant.alive != (health > 0)
        {
            return Ok(blocked(PlayerCombatBootstrapBlockerV1::VitalParityConflict));
        }
        Ok(base(
            PlayerCombatBootstrapStatusV1::ExactLinked,
            None,
            Some(attestation(true)),
        ))
    }

    pub fn context_command_continuity_status_v2(
        &self,
        query: &RuntimeContextCommandContinuityQueryWireV2,
        request_payload_hash: CanonicalHash,
    ) -> Result<RuntimeContextCommandContinuityReceiptWireV2, IntegratedRuntimeError> {
        self.ensure_running()?;
        let identity = self.identity();
        if query.expected != identity {
            return Err(IntegratedRuntimeError::new(
                "context-continuity-stale",
                "context command continuity query references obsolete runtime authority",
            ));
        }
        Ok(RuntimeContextCommandContinuityReceiptWireV2 {
            request_payload_hash,
            identity,
            last_sequence: self
                .next_context_command_sequence
                .map_or(Some(MAX_SAFE_U64), |sequence| {
                    sequence.checked_sub(1).filter(|value| *value != 0)
                }),
            next_sequence: self.next_context_command_sequence,
            queued_commands_empty: self.queued_context_commands.is_empty(),
        })
    }

    pub fn import_player_inventory(
        &mut self,
        request: PlayerInventoryImportWireV1,
        request_payload_hash: CanonicalHash,
    ) -> Result<PlayerInventoryImportReceiptWireV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        let player = self.player.as_ref().ok_or_else(|| {
            IntegratedRuntimeError::new(
                "player-inventory-import-binding",
                "player inventory import requires a complete runtime player binding",
            )
        })?;
        let binding = self
            .world_view
            .state
            .player_binding(player.binding.player_id)
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "player-inventory-import-binding",
                    "player inventory import requires a world-view player binding",
                )
            })?
            .clone();
        if binding.actor_id != player.binding.actor_id
            || binding.entity_id != player.entity_id
            || binding.inventory_container != request.import.inventory
            || usize::from(request.selected_slot) >= request.import.slots.len()
        {
            return Err(IntegratedRuntimeError::new(
                "player-inventory-import-binding",
                "inventory import target or selected slot contradicts the bound authoritative player",
            ));
        }
        let gameplay_system_actor = GameplayActor {
            actor_id: GAMEPLAY_SCHEDULER_ACTOR_ID_V1.into(),
            player_id: None,
            entity_id: None,
            role: ActorRole::System,
        };
        let key = request_payload_hash.to_hex();
        let gameplay_batch = GameplayBatch::new(
            format!("player-inventory-import:{key}"),
            format!("player-inventory-import:{key}"),
            gameplay_system_actor,
            self.gameplay.state.identity(),
            vec![GameplayCommand::Inventory(InventoryCommand::ImportPlayerInventoryV1(
                request.import.clone(),
            ))],
        );
        let mut candidate = self.clone();
        let accepted = match candidate.gameplay.apply_batch(&gameplay_batch) {
            GameplayReceipt::Accepted(receipt) => receipt,
            GameplayReceipt::Rejected { rejection, .. } => {
                return Err(IntegratedRuntimeError::new(
                    "player-inventory-import-rejected",
                    format!("{:?}: {}", rejection.code, rejection.message),
                ));
            }
        };
        let world_view_batch = WorldViewBatchV1::new(
            format!("player-inventory-select:{key}"),
            format!("player-inventory-select:{key}"),
            GameplayActor {
                actor_id: "system".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            candidate.world_view.state.identity(),
            vec![WorldViewCommandV1::SelectPlayerSlot {
                player_id: player.binding.player_id,
                expected_revision: binding.revision,
                selected_slot: request.selected_slot,
            }],
        );
        let staged_world_view = stage_world_view_batches_v1(
            &candidate.world_view,
            &candidate.gameplay.state,
            &candidate.entities,
            &[world_view_batch],
        )
        .map_err(|error| IntegratedRuntimeError::new("player-inventory-import-world-view", error.to_string()))?;
        candidate.world_view = staged_world_view.authority;
        candidate
            .player
            .as_mut()
            .expect("validated player remains present in cloned candidate")
            .selected_slot = request.selected_slot as u8;
        candidate.simulation_revision = candidate.simulation_revision.checked_add(1).ok_or_else(|| {
            IntegratedRuntimeError::new(
                "player-inventory-import-revision",
                "simulation revision is exhausted while selecting the imported slot",
            )
        })?;
        candidate
            .validate_runtime_cross_domain_links_v1()
            .map_err(|error| IntegratedRuntimeError::new("player-inventory-import-links", error.message))?;
        let inventory = candidate
            .gameplay
            .state
            .inventory
            .containers
            .get(&request.import.inventory)
            .expect("accepted inventory import retains its target");
        let referenced_metadata = referenced_inventory_metadata(&candidate.gameplay.state, &inventory.slots)?;
        let inventory_result_hash = player_inventory_result_hash_v1(inventory, &referenced_metadata)
            .map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
        let receipt = PlayerInventoryImportReceiptWireV1 {
            request_payload_hash,
            before: accepted.before,
            after: accepted.after,
            accepted_receipt_hash: accepted.receipt_hash,
            inventory_revision: inventory.revision,
            selected_slot: request.selected_slot,
            inventory_result_hash,
        };
        candidate.invalidate_state_hash();
        *self = candidate;
        Ok(receipt)
    }

    pub fn bind_player(&mut self, binding: RuntimePlayerBindingWireV1) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        binding
            .validate()
            .map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
        let (entity_id, record) = self
            .entities
            .hot()
            .iter()
            .find(|(_, entity)| entity.record.external_entity_id == binding.external_entity_id)
            .map(|(id, entity)| (*id, entity.record.clone()))
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "player-binding-missing",
                    "player binding requires a resident hot entity with the requested external id",
                )
            })?;
        if record.class != EntityClass::Player {
            return Err(IntegratedRuntimeError::new(
                "player-binding-class",
                "player binding target is not an authoritative player entity",
            ));
        }
        let existing = match self.player.as_ref() {
            Some(player)
                if player.binding.external_entity_id == binding.external_entity_id
                    && player.binding.actor_id == binding.actor_id
                    && player.binding.player_id == binding.player_id
                    && player.entity_id == entity_id =>
            {
                Some(player)
            }
            Some(_) => {
                return Err(IntegratedRuntimeError::new(
                    "player-binding-conflict",
                    "the runtime already owns a different authoritative player binding",
                ));
            }
            None => None,
        };
        let install_player_grant = existing.is_none();
        let body = PhysicsBodyV1 {
            handle: binding.external_entity_id.clone(),
            position: SimulationVec3::new(
                f64::from(record.position.x),
                f64::from(record.position.y),
                f64::from(record.position.z),
            ),
            velocity: SimulationVec3::new(
                f64::from(record.velocity.x),
                f64::from(record.velocity.y),
                f64::from(record.velocity.z),
            ),
            radius: binding.radius,
            height: binding.standing_height,
            mass: binding.mass,
            grounded: existing.map_or_else(
                || parse_custom_bool(&record.custom, "physics.grounded", false),
                |player| player.body.grounded,
            ),
            crouching: false,
            fall_distance: existing.map_or(0.0, |player| player.body.fall_distance),
            oxygen_seconds: existing.map_or(binding.maximum_oxygen_seconds, |player| {
                player.body.oxygen_seconds.min(binding.maximum_oxygen_seconds)
            }),
            drowning_accumulator: existing.map_or(0.0, |player| player.body.drowning_accumulator),
            swim_entry_momentum_speed: existing.map_or(0.0, |player| player.body.swim_entry_momentum_speed),
            swim_surface_breach_ready: existing.is_some_and(|player| player.body.swim_surface_breach_ready),
            swim_surface_breach_seconds: existing.map_or(0.0, |player| player.body.swim_surface_breach_seconds),
            swim_stroke_cooldown_seconds: existing.map_or(0.0, |player| player.body.swim_stroke_cooldown_seconds),
            swim_surface_bob_active: existing.is_some_and(|player| player.body.swim_surface_bob_active),
        };
        let flags = existing.map_or_else(
            || u8::from(binding.creative_mode) * RUNTIME_INPUT_FLAG_CREATIVE_V1,
            |player| player.flags,
        );
        let actor = GameplayActor {
            actor_id: binding.actor_id.clone(),
            player_id: Some(binding.player_id),
            entity_id: Some(entity_id),
            role: ActorRole::Host,
        };
        let mut staged_gameplay = self.gameplay.clone();
        if install_player_grant {
            staged_gameplay
                .grant_actor(binding.actor_id.clone(), ActorGrant::host(binding.player_id, entity_id))
                .map_err(|error| IntegratedRuntimeError::new("player-binding-grant", error.message))?;
        }
        let mut staged_world_view = self.world_view.clone();
        let selected_slot = if let Some(existing_binding) = staged_world_view.state.player_binding(binding.player_id) {
            if existing_binding.actor_id != binding.actor_id || existing_binding.entity_id != entity_id {
                return Err(IntegratedRuntimeError::new(
                    "player-binding-conflict",
                    "existing world-view player binding belongs to another actor or entity",
                ));
            }
            existing_binding.selected_slot
        } else {
            let inventory = ContainerKey::player(binding.actor_id.clone());
            let equipment = ContainerKey {
                kind: ContainerKind::Equipment,
                id: format!("{}:equipment", binding.actor_id),
                owner_id: Some(binding.actor_id.clone()),
            };
            let custody_batch = GameplayBatch::new(
                format!("player-custody:{}", binding.player_id.packed()),
                format!("player-custody:{}", binding.player_id.packed()),
                actor.clone(),
                staged_gameplay.state.identity(),
                vec![GameplayCommand::Inventory(InventoryCommand::CreatePlayerCustody(
                    CreatePlayerCustodyCommand {
                        inventory: inventory.clone(),
                        inventory_slots: 9,
                        equipment: equipment.clone(),
                        equipment_slots: 8,
                        back_slot: Some(7),
                    },
                ))],
            );
            match staged_gameplay.apply_batch(&custody_batch) {
                GameplayReceipt::Accepted(_) => {}
                GameplayReceipt::Rejected { rejection, .. } => {
                    return Err(IntegratedRuntimeError::new("player-custody", rejection.message));
                }
            }
            let staged_binding = stage_player_binding_v1(
                &staged_world_view,
                &staged_gameplay.state,
                &self.entities,
                &PlayerBindingStageRequestV1 {
                    batch_id: format!("player-binding:{}", binding.player_id.packed()),
                    idempotency_key: format!("player-binding:{}", binding.player_id.packed()),
                    actor: GameplayActor {
                        actor_id: "system".into(),
                        player_id: None,
                        entity_id: None,
                        role: ActorRole::System,
                    },
                    expected_world_view_identity: staged_world_view.state.identity(),
                    expected_binding_revision: None,
                    binding: PlayerInventoryBindingV1 {
                        player_id: binding.player_id,
                        revision: 0,
                        actor_id: binding.actor_id.clone(),
                        entity_id,
                        inventory_container: inventory,
                        equipment_container: equipment,
                        selected_slot: 0,
                        back_slot: Some(7),
                    },
                },
            )
            .map_err(|error| IntegratedRuntimeError::new("player-binding", error.to_string()))?;
            staged_world_view = staged_binding.authority;
            0
        };
        validate_world_view_runtime_links_v1(&staged_world_view.state, &staged_gameplay.state, &self.entities)
            .map_err(|error| IntegratedRuntimeError::new("player-binding", error.to_string()))?;
        self.gameplay = staged_gameplay;
        self.world_view = staged_world_view;
        if install_player_grant {
            self.gameplay_authority_revision = self.gameplay_authority_revision.saturating_add(1);
        }
        self.player = Some(IntegratedRuntimePlayerStateV2 {
            binding,
            entity_id,
            body,
            contact_flags: existing.map_or(0, |player| player.contact_flags),
            selected_slot: existing.map_or(selected_slot as u8, |player| player.selected_slot),
            look_pitch: existing.map_or(self.camera.look_pitch, |player| player.look_pitch),
            buttons: existing.map_or(0, |player| player.buttons),
            flags,
            last_input_sequence: existing.map_or(0, |player| player.last_input_sequence),
        });
        self.mining_state = None;
        self.simulation_revision = self.simulation_revision.saturating_add(1);
        self.invalidate_state_hash();
        Ok(())
    }

    fn advance_authoritative_fixed_step(&mut self, input: RuntimeInputFrameV1) -> Result<(), IntegratedRuntimeError> {
        if self.player.is_none() && self.last_applied_input.is_some() {
            return Err(IntegratedRuntimeError::new(
                "player-binding-required",
                "fixed-step player input cannot execute before a hot player entity is explicitly bound",
            ));
        }
        if self.player.is_some() {
            self.advance_held_primary_mining(input)?;
            self.advance_bound_player(input)?;
        }
        self.advance_dropped_items_v1()?;
        self.advance_entity_and_gameplay_schedules()?;
        self.simulation_revision = self.simulation_revision.saturating_add(1);
        self.invalidate_state_hash();
        Ok(())
    }

    fn apply_selected_slot(&mut self, input: RuntimeInputFrameV1) -> Result<(), IntegratedRuntimeError> {
        let Some(player) = self.player.as_ref() else {
            return Ok(());
        };
        let binding = self
            .world_view
            .state
            .player_binding(player.binding.player_id)
            .ok_or_else(|| IntegratedRuntimeError::new("input-binding", "bound player has no inventory binding"))?;
        if binding.selected_slot == u16::from(input.selected_slot) {
            return Ok(());
        }
        let identity = self.world_view.state.identity();
        let batch = WorldViewBatchV1::new(
            format!("input-slot:{}", input.sequence),
            format!("input-slot:{}", input.sequence),
            GameplayActor {
                actor_id: "system".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            identity,
            vec![WorldViewCommandV1::SelectPlayerSlot {
                player_id: player.binding.player_id,
                expected_revision: binding.revision,
                selected_slot: u16::from(input.selected_slot),
            }],
        );
        let staged = stage_world_view_batches_v1(&self.world_view, &self.gameplay.state, &self.entities, &[batch])
            .map_err(|error| IntegratedRuntimeError::new("input-slot", error.to_string()))?;
        self.world_view = staged.authority;
        self.mining_state = None;
        Ok(())
    }

    fn dispatch_input_edges(
        &mut self,
        input: RuntimeInputFrameV1,
        previous_buttons: u32,
    ) -> Result<Vec<RuntimeInputActionReceiptV1>, IntegratedRuntimeError> {
        let rising = input.buttons & !previous_buttons;
        let Some(player) = self.player.as_ref() else {
            if rising != 0 {
                return Err(IntegratedRuntimeError::new(
                    "player-binding-required",
                    "fixed-step actions cannot execute before a hot player entity is explicitly bound",
                ));
            }
            return Ok(Vec::new());
        };
        let creative = player.binding.creative_mode;
        let mut mounted = player.flags & RUNTIME_INPUT_FLAG_MOUNTED_V1 != 0;
        let mut flying = player.flags & RUNTIME_INPUT_FLAG_FLYING_V1 != 0;
        let selected_slot = input.selected_slot;
        let mut receipts = Vec::new();
        for (button, kind) in [
            (
                RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1,
                RuntimeInputActionKindV1::PrimaryAttack,
            ),
            (
                RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1,
                RuntimeInputActionKindV1::SecondaryUse,
            ),
            (RUNTIME_INPUT_BUTTON_INTERACT_V1, RuntimeInputActionKindV1::Interact),
            (
                RUNTIME_INPUT_BUTTON_MOUNT_TOGGLE_V1,
                RuntimeInputActionKindV1::MountToggle,
            ),
            (
                RUNTIME_INPUT_BUTTON_CREATIVE_FLIGHT_TOGGLE_V1,
                RuntimeInputActionKindV1::CreativeFlightToggle,
            ),
            (RUNTIME_INPUT_BUTTON_DROP_V1, RuntimeInputActionKindV1::Drop),
        ] {
            if rising & button == 0 {
                continue;
            }
            let (outcome, target_entity_id) = match kind {
                RuntimeInputActionKindV1::CreativeFlightToggle if creative && !mounted => {
                    flying = !flying;
                    (RuntimeInputActionOutcomeV1::Applied, 0)
                }
                RuntimeInputActionKindV1::CreativeFlightToggle => (RuntimeInputActionOutcomeV1::Ineligible, 0),
                RuntimeInputActionKindV1::PrimaryAttack => self.apply_primary_attack(input)?,
                RuntimeInputActionKindV1::SecondaryUse => self.apply_targeted_action(input, "secondary-use")?,
                RuntimeInputActionKindV1::Interact => self.apply_targeted_action(input, "interact")?,
                RuntimeInputActionKindV1::MountToggle => {
                    let result = self.apply_mount_toggle(input)?;
                    if result.0 == RuntimeInputActionOutcomeV1::Applied {
                        mounted = !mounted;
                        if mounted {
                            flying = false;
                        }
                    }
                    result
                }
                RuntimeInputActionKindV1::Drop => self.apply_player_drop(input)?,
            };
            let authoritative_flags = (u8::from(creative) * RUNTIME_INPUT_FLAG_CREATIVE_V1)
                | (u8::from(flying) * RUNTIME_INPUT_FLAG_FLYING_V1)
                | (u8::from(mounted) * RUNTIME_INPUT_FLAG_MOUNTED_V1);
            let mut hasher = CanonicalHasher::new("blockwild-runtime-input-action-v1");
            hasher.write_u64(self.next_action_sequence);
            hasher.write_u64(input.sequence);
            hasher.write_u64(self.tick);
            hasher.write_u16(kind as u16);
            hasher.write_u16(outcome as u16);
            hasher.write_u16(u16::from(selected_slot));
            hasher.write_u16(u16::from(authoritative_flags));
            hasher.write_u64(target_entity_id);
            hasher.write_bytes(self.entities.canonical_hash().as_bytes());
            hasher.write_bytes(self.gameplay.state.state_hash().as_bytes());
            hasher.write_bytes(self.world_view.state.state_hash().as_bytes());
            receipts.push(RuntimeInputActionReceiptV1 {
                sequence: self.next_action_sequence,
                input_sequence: input.sequence,
                tick: self.tick,
                kind,
                outcome,
                selected_slot,
                authoritative_flags,
                target_entity_id,
                effect_hash: WireHash(*hasher.finish().as_bytes()),
            });
            self.next_action_sequence = self.next_action_sequence.saturating_add(1);
        }
        if let Some(player) = self.player.as_mut() {
            player.flags = (u8::from(creative) * RUNTIME_INPUT_FLAG_CREATIVE_V1)
                | (u8::from(flying) * RUNTIME_INPUT_FLAG_FLYING_V1)
                | (u8::from(mounted) * RUNTIME_INPUT_FLAG_MOUNTED_V1);
        }
        Ok(receipts)
    }

    fn apply_primary_attack(
        &mut self,
        input: RuntimeInputFrameV1,
    ) -> Result<(RuntimeInputActionOutcomeV1, u64), IntegratedRuntimeError> {
        match self.raycast_action_target(input, 4.5)? {
            IntegratedRuntimeActionTargetV1::Entity(target) => {
                self.mining_state = None;
                let player = self.player.as_ref().expect("action dispatch checked player");
                let actor_id = player.binding.actor_id.clone();
                let target_record = self
                    .entities
                    .compatibility_record(target)
                    .ok_or_else(|| IntegratedRuntimeError::new("input-action-target", "attack target disappeared"))?;
                let target_id = target_record.external_entity_id.clone();
                let Some(source) = self.gameplay.state.combat.combatants.get(&actor_id) else {
                    return Ok((RuntimeInputActionOutcomeV1::Blocked, target.packed()));
                };
                let Some(target_combatant) = self.gameplay.state.combat.combatants.get(&target_id) else {
                    return Ok((RuntimeInputActionOutcomeV1::Blocked, target.packed()));
                };
                if !source.alive || !target_combatant.alive {
                    return Ok((RuntimeInputActionOutcomeV1::Ineligible, target.packed()));
                }
                let Some(ability_id) = ["basic-melee", "primary-attack"]
                    .into_iter()
                    .find(|ability| self.gameplay.state.combat.abilities.contains_key(*ability))
                else {
                    return Ok((RuntimeInputActionOutcomeV1::Blocked, target.packed()));
                };
                let source_revision = source.revision;
                let target_revision = target_combatant.revision;
                let target_position = target_record.position;
                let actor = GameplayActor {
                    actor_id: actor_id.clone(),
                    player_id: Some(player.binding.player_id),
                    entity_id: Some(player.entity_id),
                    role: ActorRole::Host,
                };
                let batch_id = format!("input-attack:{}:{}", input.sequence, self.next_action_sequence);
                let batch = GameplayBatch::new(
                    &batch_id,
                    &batch_id,
                    actor,
                    self.gameplay.state.identity(),
                    vec![GameplayCommand::Combat(CombatCommand::UseAbility {
                        source_id: actor_id,
                        expected_source_revision: source_revision,
                        target_id,
                        expected_target_revision: target_revision,
                        ability_id: ability_id.into(),
                        projectile_id: None,
                        aim: FixedVec3 {
                            x_milli: (f64::from(target_position.x) * 1_000.0).round() as i32,
                            y_milli: (f64::from(target_position.y) * 1_000.0).round() as i32,
                            z_milli: (f64::from(target_position.z) * 1_000.0).round() as i32,
                        },
                        tick: self.tick,
                    })],
                );
                let mut staged = self.gameplay.clone();
                match staged.apply_batch(&batch) {
                    GameplayReceipt::Accepted(_) => self.gameplay = staged,
                    GameplayReceipt::Rejected { .. } => {
                        return Ok((RuntimeInputActionOutcomeV1::Blocked, target.packed()));
                    }
                }
                Ok((RuntimeInputActionOutcomeV1::Applied, target.packed()))
            }
            IntegratedRuntimeActionTargetV1::Block { position, .. } => {
                let outcome = self.begin_or_reset_mining(input, position)?;
                Ok((outcome, 0))
            }
            IntegratedRuntimeActionTargetV1::Unloaded => {
                self.mining_state = None;
                Ok((RuntimeInputActionOutcomeV1::Blocked, 0))
            }
            IntegratedRuntimeActionTargetV1::None => {
                self.mining_state = None;
                Ok((RuntimeInputActionOutcomeV1::NoTarget, 0))
            }
        }
    }

    fn apply_targeted_action(
        &mut self,
        input: RuntimeInputFrameV1,
        action_key: &'static str,
    ) -> Result<(RuntimeInputActionOutcomeV1, u64), IntegratedRuntimeError> {
        match self.raycast_action_target(input, 5.0)? {
            IntegratedRuntimeActionTargetV1::Entity(target) => {
                Ok((RuntimeInputActionOutcomeV1::Blocked, target.packed()))
            }
            IntegratedRuntimeActionTargetV1::Block { position, normal } if action_key == "secondary-use" => {
                Ok((self.apply_basic_block_placement(input, position, normal)?, 0))
            }
            IntegratedRuntimeActionTargetV1::Block { .. } => Ok((RuntimeInputActionOutcomeV1::Blocked, 0)),
            IntegratedRuntimeActionTargetV1::Unloaded => Ok((RuntimeInputActionOutcomeV1::Blocked, 0)),
            IntegratedRuntimeActionTargetV1::None => Ok((RuntimeInputActionOutcomeV1::NoTarget, 0)),
        }
    }

    fn apply_mount_toggle(
        &mut self,
        input: RuntimeInputFrameV1,
    ) -> Result<(RuntimeInputActionOutcomeV1, u64), IntegratedRuntimeError> {
        let player_id = self
            .player
            .as_ref()
            .ok_or_else(|| IntegratedRuntimeError::new("player-binding-required", "mount toggle requires a player"))?
            .entity_id;
        let mut player_components = self
            .entities
            .components(player_id)
            .ok_or_else(|| IntegratedRuntimeError::new("input-action-target", "bound player lost components"))?
            .clone();
        if let Some(parent_id) = player_components.mount.parent_mount {
            let mut commands = Vec::with_capacity(3);
            if let Some(mut parent_components) = self.entities.components(parent_id).cloned() {
                for seat in &mut parent_components.mount.seats {
                    if seat.occupant == Some(player_id) {
                        seat.occupant = None;
                    }
                }
                commands.push(EntityCommand::SetMountState {
                    id: parent_id,
                    value: parent_components.mount,
                });
            }
            player_components.mount.parent_mount = None;
            player_components.mount.occupied_seat = None;
            player_components.locomotion.movement_mode = MovementMode::Ground;
            player_components.locomotion.action = ActionState {
                key: "dismount".into(),
                phase: 0,
                started_tick: self.tick,
                ends_tick: self.tick.saturating_add(1),
                target: Some(parent_id),
            };
            commands.push(EntityCommand::SetMountState {
                id: player_id,
                value: player_components.mount,
            });
            commands.push(EntityCommand::SetLocomotionBody {
                id: player_id,
                value: player_components.locomotion,
            });
            self.apply_internal_entity_commands("input-dismount", commands)?;
            return Ok((RuntimeInputActionOutcomeV1::Applied, parent_id.packed()));
        }

        let target_id = match self.raycast_action_target(input, 4.5)? {
            IntegratedRuntimeActionTargetV1::Entity(target) => target,
            IntegratedRuntimeActionTargetV1::Unloaded => {
                return Ok((RuntimeInputActionOutcomeV1::Blocked, 0));
            }
            _ => return Ok((RuntimeInputActionOutcomeV1::NoTarget, 0)),
        };
        let mut mount_components = self
            .entities
            .components(target_id)
            .ok_or_else(|| IntegratedRuntimeError::new("input-action-target", "mount target lost components"))?
            .clone();
        if !mount_components.mount.accepts_riders {
            return Ok((RuntimeInputActionOutcomeV1::Ineligible, target_id.packed()));
        }
        let Some(seat) = mount_components
            .mount
            .seats
            .iter_mut()
            .find(|seat| seat.occupant.is_none())
        else {
            return Ok((RuntimeInputActionOutcomeV1::Ineligible, target_id.packed()));
        };
        seat.occupant = Some(player_id);
        player_components.mount.parent_mount = Some(target_id);
        // The authoritative seat index is owned by the mount's seat/occupant
        // relation. `occupied_seat` describes an entity's own seat table and
        // therefore cannot point into the parent mount's table.
        player_components.mount.occupied_seat = None;
        player_components.locomotion.movement_mode = MovementMode::Mounted;
        player_components.locomotion.action = ActionState {
            key: "mount".into(),
            phase: 0,
            started_tick: self.tick,
            ends_tick: self.tick.saturating_add(1),
            target: Some(target_id),
        };
        self.apply_internal_entity_commands(
            "input-mount",
            vec![
                EntityCommand::SetMountState {
                    id: target_id,
                    value: mount_components.mount,
                },
                EntityCommand::SetMountState {
                    id: player_id,
                    value: player_components.mount,
                },
                EntityCommand::SetLocomotionBody {
                    id: player_id,
                    value: player_components.locomotion,
                },
            ],
        )?;
        Ok((RuntimeInputActionOutcomeV1::Applied, target_id.packed()))
    }

    fn apply_player_drop(
        &mut self,
        input: RuntimeInputFrameV1,
    ) -> Result<(RuntimeInputActionOutcomeV1, u64), IntegratedRuntimeError> {
        let player = self
            .player
            .as_ref()
            .ok_or_else(|| IntegratedRuntimeError::new("player-binding-required", "drop requires a bound player"))?
            .clone();
        let binding = self
            .world_view
            .state
            .player_binding(player.binding.player_id)
            .ok_or_else(|| IntegratedRuntimeError::new("input-drop-binding", "bound player has no inventory binding"))?
            .clone();
        let held_stack = self
            .world_view
            .state
            .held_stack(&self.gameplay.state, player.binding.player_id)
            .map_err(|error| {
                IntegratedRuntimeError::new("input-drop-binding", format!("{:?}: {}", error.code, error.message))
            })?
            .cloned();
        let Some(held_stack) = held_stack else {
            return Ok((RuntimeInputActionOutcomeV1::EmptySlot, 0));
        };
        let source_container_revision = self
            .gameplay
            .state
            .inventory
            .containers
            .get(&binding.inventory_container)
            .ok_or_else(|| IntegratedRuntimeError::new("input-drop-binding", "player inventory container disappeared"))?
            .revision;

        let yaw = normalized_i16(input.look_yaw) * std::f64::consts::PI;
        let pitch = normalized_i16(input.look_pitch) * std::f64::consts::FRAC_PI_2;
        let horizontal = pitch.cos();
        let direction = SimulationVec3::new(-yaw.sin() * horizontal, pitch.sin(), -yaw.cos() * horizontal);
        let position = SimulationVec3::new(
            player.body.position.x + direction.x * 0.6,
            player.body.position.y + player.body.height * 0.72 + direction.y * 0.6,
            player.body.position.z + direction.z * 0.6,
        );
        let velocity = SimulationVec3::new(
            player.body.velocity.x + direction.x * 3.0,
            player.body.velocity.y + direction.y * 3.0 + 0.15,
            player.body.velocity.z + direction.z * 3.0,
        );
        let drop_id = format!("drop:{}:{}", input.sequence, self.next_action_sequence);
        let custody_container_id = format!("drop-custody:{}:{}", input.sequence, self.next_action_sequence);
        let mut drop_record = EntityCompatibilityRecord::new(&drop_id, &drop_id, "dropped-item");
        drop_record.class = EntityClass::Construct;
        drop_record.position = EntityVec3::new(position.x as f32, position.y as f32, position.z as f32);
        drop_record.velocity = EntityVec3::new(velocity.x as f32, velocity.y as f32, velocity.z as f32);
        drop_record.yaw = yaw as f32;
        drop_record
            .custom
            .insert("item.code".into(), held_stack.item_code.to_string());
        drop_record
            .custom
            .insert("item.metadataHash".into(), held_stack.metadata_hash.to_hex());

        let entity_sequence = self.entity_command_sequence.saturating_add(1).max(1);
        let mut staged_entities = self.entities.clone();
        let entity_receipt = staged_entities
            .apply_batch(&EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence: entity_sequence,
                expected_revision: staged_entities.revision(),
                tick: self.tick,
                commands: vec![EntityCommand::Spawn {
                    record: drop_record,
                    residency: EntityResidency::Hot,
                }],
            })
            .map_err(|error| IntegratedRuntimeError::new("input-drop-entity", error.to_string()))?;
        let drop_entity_id = entity_receipt
            .events
            .first()
            .map(|event| event.entity_id)
            .ok_or_else(|| IntegratedRuntimeError::new("input-drop-entity", "drop spawn emitted no entity event"))?;
        let to_milli = |value: f64| (value * 1_000.0).round() as i64;
        let to_microturns = |turns: f64| (turns.rem_euclid(1.0) * 1_000_000.0).round() as u32 % 1_000_000;
        let request = PlayerDropStageRequestV1 {
            batch_id: format!("input-drop:{}:{}", input.sequence, self.next_action_sequence),
            idempotency_key: format!("input-drop:{}:{}", input.sequence, self.next_action_sequence),
            actor: GameplayActor {
                actor_id: player.binding.actor_id.clone(),
                player_id: Some(player.binding.player_id),
                entity_id: Some(player.entity_id),
                role: ActorRole::Host,
            },
            expected_gameplay_identity: self.gameplay.state.identity(),
            expected_world_view_identity: self.world_view.state.identity(),
            player_id: player.binding.player_id,
            expected_binding_revision: binding.revision,
            expected_source_container_revision: source_container_revision,
            expected_stack: ExpectedStack {
                item_code: held_stack.item_code,
                metadata_hash: held_stack.metadata_hash,
                minimum_count: 1,
            },
            drop_id: drop_id.clone(),
            drop_entity_id,
            custody_container_id,
            position: FixedWorldVec3V1 {
                x_milli: to_milli(position.x),
                y_milli: to_milli(position.y),
                z_milli: to_milli(position.z),
            },
            velocity_milli_per_second: FixedWorldVec3V1 {
                x_milli: to_milli(velocity.x),
                y_milli: to_milli(velocity.y),
                z_milli: to_milli(velocity.z),
            },
            rotation: RotationMicroturnsV1 {
                yaw: to_microturns(yaw / std::f64::consts::TAU),
                pitch: to_microturns(pitch / std::f64::consts::TAU),
                roll: 0,
            },
            expires_tick: None,
            // Native drops use a global pickup delay. The actor field remains
            // only for exact legacy snapshot compatibility and is never an
            // eligibility capability in this runtime.
            pickup_lock_actor_id: None,
            pickup_unlock_tick: self
                .world_view
                .state
                .tick
                .saturating_add(INTEGRATED_RUNTIME_DROP_PICKUP_DELAY_TICKS_V1),
        };
        let staged_drop = stage_player_drop_v1(&self.gameplay, &self.world_view.state, &request).map_err(|error| {
            IntegratedRuntimeError::new("input-drop-custody", format!("{:?}: {}", error.code, error.message))
        })?;
        let world_view_batch = WorldViewBatchV1::new(
            format!("input-drop-register:{}:{}", input.sequence, self.next_action_sequence),
            format!("input-drop-register:{}:{}", input.sequence, self.next_action_sequence),
            GameplayActor {
                actor_id: "system".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            self.world_view.state.identity(),
            vec![WorldViewCommandV1::RegisterDrop { drop: staged_drop.drop }],
        );
        let staged_world_view = stage_world_view_batches_v1(
            &self.world_view,
            &staged_drop.gameplay.state,
            &staged_entities,
            &[world_view_batch],
        )
        .map_err(|error| IntegratedRuntimeError::new("input-drop-world-view", error.to_string()))?;

        let mut staged_runtime = self.clone();
        staged_runtime.entities = staged_entities;
        staged_runtime.gameplay = staged_drop.gameplay;
        staged_runtime.world_view = staged_world_view.authority;
        staged_runtime.entity_command_sequence = entity_sequence;
        staged_runtime.sync_entity_schedules(std::slice::from_ref(&entity_receipt))?;
        validate_world_view_runtime_links_v1(
            &staged_runtime.world_view.state,
            &staged_runtime.gameplay.state,
            &staged_runtime.entities,
        )
        .map_err(|error| IntegratedRuntimeError::new("input-drop-transaction", error.to_string()))?;
        *self = staged_runtime;
        Ok((RuntimeInputActionOutcomeV1::Applied, drop_entity_id.packed()))
    }

    fn raycast_action_target(
        &self,
        input: RuntimeInputFrameV1,
        maximum_distance: f64,
    ) -> Result<IntegratedRuntimeActionTargetV1, IntegratedRuntimeError> {
        let player = self
            .player
            .as_ref()
            .ok_or_else(|| IntegratedRuntimeError::new("player-binding-required", "target query requires a player"))?;
        let eye = self.action_eye_v1(player);
        let yaw = normalized_i16(input.look_yaw) * std::f64::consts::PI;
        let pitch = normalized_i16(input.look_pitch) * std::f64::consts::FRAC_PI_2;
        let horizontal = pitch.cos();
        let direction = SimulationVec3::new(-yaw.sin() * horizontal, pitch.sin(), -yaw.cos() * horizontal);
        let end = eye + direction * maximum_distance;
        let minimum = |left: f64, right: f64| floor_i32(left.min(right) + 0.5).map(|value| value.saturating_sub(1));
        let maximum = |left: f64, right: f64| floor_i32(left.max(right) + 0.5).map(|value| value.saturating_add(1));
        let origin = ReadOriginV1 {
            x: minimum(eye.x, end.x)?,
            y: minimum(eye.y, end.y)?,
            z: minimum(eye.z, end.z)?,
        };
        let high = [maximum(eye.x, end.x)?, maximum(eye.y, end.y)?, maximum(eye.z, end.z)?];
        let size = |low: i32, high: i32| {
            high.checked_sub(low)
                .and_then(|span| span.checked_add(1))
                .and_then(|span| u16::try_from(span).ok())
                .ok_or_else(|| IntegratedRuntimeError::new("input-action-window", "action ray window overflowed"))
        };
        let window = self.capture_simulation_window(
            origin,
            ReadSizeV1 {
                x: size(origin.x, high[0])?,
                y: size(origin.y, high[1])?,
                z: size(origin.z, high[2])?,
            },
        )?;
        let mut targets = Vec::with_capacity(self.entities.hot().len());
        for (id, entity) in self.entities.hot() {
            if *id == player.entity_id || entity.record.health <= 0.0 {
                continue;
            }
            let components = &entity.components;
            let center = SimulationVec3::new(
                f64::from(entity.record.position.x),
                f64::from(entity.record.position.y),
                f64::from(entity.record.position.z),
            );
            let radius = f64::from(components.locomotion.radius);
            let half_height = f64::from(components.locomotion.half_height);
            targets.push(ActionRayEntityTargetV1 {
                entity_id: id.packed(),
                bounds: AabbV1::new(
                    SimulationVec3::new(center.x - radius, center.y - half_height, center.z - radius),
                    SimulationVec3::new(center.x + radius, center.y + half_height, center.z + radius),
                ),
            });
        }
        let result = raycast_action_target(
            &window,
            VoxelRaycastQueryV1 {
                query_id: input.sequence,
                origin: eye,
                direction,
                maximum_distance,
                maximum_visited_cells: 128,
                hit_liquids: false,
            },
            &targets,
        )
        .map_err(|error| IntegratedRuntimeError::new("input-action-raycast", error.to_string()))?;
        match result.target {
            Some(ActionRayTargetV1::Entity { entity_id, .. }) => Ok(IntegratedRuntimeActionTargetV1::Entity(
                EntityId::new(entity_id as u32, (entity_id >> 32) as u32),
            )),
            Some(ActionRayTargetV1::Voxel(hit)) if hit.kind == VoxelRayHitKindV1::Solid => {
                Ok(IntegratedRuntimeActionTargetV1::Block {
                    position: CellPositionV1 {
                        x: hit.cell.x,
                        y: hit.cell.y,
                        z: hit.cell.z,
                    },
                    normal: [
                        ray_normal_i8(hit.normal.x),
                        ray_normal_i8(hit.normal.y),
                        ray_normal_i8(hit.normal.z),
                    ],
                })
            }
            Some(ActionRayTargetV1::Voxel(_)) | None if result.budget_exhausted => {
                Ok(IntegratedRuntimeActionTargetV1::Unloaded)
            }
            Some(ActionRayTargetV1::Voxel(_)) => Ok(IntegratedRuntimeActionTargetV1::Unloaded),
            None => Ok(IntegratedRuntimeActionTargetV1::None),
        }
    }

    fn action_eye_v1(&self, player: &IntegratedRuntimePlayerStateV2) -> SimulationVec3 {
        SimulationVec3::new(
            player.body.position.x,
            player.body.position.y + player.body.height * 0.82,
            player.body.position.z,
        )
    }

    fn held_stack_and_binding(&self) -> Option<(PlayerInventoryBindingV1, u64, Option<ItemStack>)> {
        let player = self.player.as_ref()?;
        let binding = self.world_view.state.player_binding(player.binding.player_id)?.clone();
        let inventory = self
            .gameplay
            .state
            .inventory
            .containers
            .get(&binding.inventory_container)?;
        let held = inventory.slots.get(usize::from(binding.selected_slot))?.clone();
        Some((binding, inventory.revision, held))
    }

    fn mining_tool_v1(&self, block_preferred_tool: ContentActionToolKind) -> Option<IntegratedRuntimeMiningToolV1> {
        let player = self.player.as_ref()?;
        let (_, _, held_stack) = self.held_stack_and_binding()?;
        let item = held_stack.as_ref().and_then(|stack| {
            self.gameplay_content_runtime
                .items
                .values()
                .find(|item| item.item_code == stack.item_code)
        });
        let action = item.map(|item| &item.action);
        let scythe = action.and_then(|action| action.use_kind) == Some(ContentItemUseKind::Scythe);
        if player.binding.creative_mode {
            let mut hasher = CanonicalHasher::new("blockwild-runtime-mining-tool-v1");
            hasher.write_u16(1);
            hasher.write_bytes(self.gameplay_content_runtime.registry_hash.as_bytes());
            hasher.write_u16(u16::from(scythe));
            return Some(IntegratedRuntimeMiningToolV1 {
                held_stack,
                tool_kind: ContentActionToolKind::Hand,
                scythe,
                tier: u16::MAX,
                speed_millionths: 8_000_000,
                durability_cost_millionths: 0,
                profile_hash: hasher.finish(),
            });
        }
        if let (Some(stack), Some(action)) = (&held_stack, action)
            && action.max_durability.is_some()
            && action.infinite_durability != Some(true)
            && (stack.count != 1 || stack.durability_millionths.is_none())
        {
            return None;
        }
        let tool_kind = action
            .and_then(|action| action.tool_kind)
            .unwrap_or(ContentActionToolKind::Hand);
        let tier = action.and_then(|action| action.tier).unwrap_or(0);
        let speed_millionths = if tool_kind == block_preferred_tool {
            action
                .and_then(|action| action.mining_speed_millionths)
                .unwrap_or(1_000_000)
        } else if block_preferred_tool == ContentActionToolKind::Hand {
            1_100_000
        } else {
            480_000
        };
        let durability_cost_millionths = action
            .and_then(|action| action.max_durability)
            .filter(|_| action.and_then(|action| action.infinite_durability) != Some(true))
            .map(|maximum| u32::try_from(1_000_000_u64.div_ceil(u64::from(maximum))).unwrap_or(1))
            .unwrap_or(0);
        let mut hasher = CanonicalHasher::new("blockwild-runtime-mining-tool-v1");
        hasher.write_bytes(self.gameplay_content_runtime.registry_hash.as_bytes());
        hasher.write_u16(tool_kind as u16);
        hasher.write_u16(u16::from(scythe));
        hasher.write_u16(tier);
        hasher.write_u64(speed_millionths);
        hasher.write_u32(durability_cost_millionths);
        match &held_stack {
            Some(stack) => {
                hasher.write_u16(1);
                write_item_stack_hash_v1(&mut hasher, stack);
            }
            None => hasher.write_u16(0),
        }
        Some(IntegratedRuntimeMiningToolV1 {
            held_stack,
            tool_kind,
            scythe,
            tier,
            speed_millionths,
            durability_cost_millionths,
            profile_hash: hasher.finish(),
        })
    }

    fn mining_state_is_current_v1(&self) -> bool {
        let Some(state) = self.mining_state.as_ref() else {
            return true;
        };
        let Some(player) = self.player.as_ref() else {
            return false;
        };
        let Some((binding, _, held_stack)) = self.held_stack_and_binding() else {
            return false;
        };
        let WorldCellReadV1::Loaded { cell, .. } = self.world.read_cell(state.target) else {
            return false;
        };
        let Some(profile) = self.gameplay_content_runtime.block_action(cell.block_id) else {
            return false;
        };
        if cell.block_id == WORLD_AIR_BLOCK_ID_V1
            || runtime_block_action_route_v1(&self.gameplay_content_runtime, profile)
                == IntegratedRuntimeBlockActionRouteV1::Blocked
        {
            return false;
        }
        let Some(tool) = self.mining_tool_v1(profile.preferred_tool) else {
            return false;
        };
        let held = held_stack.as_ref();
        state.player_entity_id == player.entity_id.packed()
            && state.target_block_id == cell.block_id
            && state.world_revision == self.world.revision()
            && state.selected_slot == u8::try_from(binding.selected_slot).unwrap_or(u8::MAX)
            && state.held_item_code == held.map_or(0, |stack| stack.item_code)
            && state.held_metadata_hash == held.map_or(CanonicalHash::default(), |stack| stack.metadata_hash)
            && state.held_durability_millionths == held.and_then(|stack| stack.durability_millionths)
            && state.tool_profile_hash == tool.profile_hash
    }

    fn begin_or_reset_mining(
        &mut self,
        input: RuntimeInputFrameV1,
        position: CellPositionV1,
    ) -> Result<RuntimeInputActionOutcomeV1, IntegratedRuntimeError> {
        let player = self.player.as_ref().expect("action dispatch checked player");
        let value = match self.world.read_cell(position) {
            WorldCellReadV1::Loaded { cell, .. } if cell.block_id != WORLD_AIR_BLOCK_ID_V1 => cell,
            WorldCellReadV1::Loaded { .. } => {
                self.mining_state = None;
                return Ok(RuntimeInputActionOutcomeV1::NoTarget);
            }
            WorldCellReadV1::Unloaded { .. } => {
                self.mining_state = None;
                return Ok(RuntimeInputActionOutcomeV1::Blocked);
            }
        };
        let Some(profile) = self.gameplay_content_runtime.block_action(value.block_id).cloned() else {
            self.mining_state = None;
            return Ok(RuntimeInputActionOutcomeV1::Blocked);
        };
        if runtime_block_action_route_v1(&self.gameplay_content_runtime, &profile)
            == IntegratedRuntimeBlockActionRouteV1::Blocked
        {
            self.mining_state = None;
            return Ok(RuntimeInputActionOutcomeV1::Blocked);
        }
        let Some(tool) = self.mining_tool_v1(profile.preferred_tool) else {
            self.mining_state = None;
            return Ok(RuntimeInputActionOutcomeV1::Ineligible);
        };
        let held = tool.held_stack.as_ref();
        self.mining_state = Some(IntegratedRuntimeMiningStateV1 {
            player_entity_id: player.entity_id.packed(),
            target: position,
            target_block_id: value.block_id,
            world_revision: self.world.revision(),
            selected_slot: input.selected_slot,
            held_item_code: held.map_or(0, |stack| stack.item_code),
            held_metadata_hash: held.map_or(CanonicalHash::default(), |stack| stack.metadata_hash),
            held_durability_millionths: held.and_then(|stack| stack.durability_millionths),
            tool_profile_hash: tool.profile_hash,
            progress_millionths: 0,
            required_work_millionths: 1_000_000,
            started_tick: self.tick,
            last_advanced_tick: self.tick,
        });
        self.invalidate_state_hash();
        Ok(RuntimeInputActionOutcomeV1::Applied)
    }

    fn advance_held_primary_mining(&mut self, input: RuntimeInputFrameV1) -> Result<(), IntegratedRuntimeError> {
        if input.buttons & RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1 == 0 {
            if self.mining_state.take().is_some() {
                self.invalidate_state_hash();
            }
            return Ok(());
        }
        let position = match self.raycast_action_target(input, 4.5)? {
            IntegratedRuntimeActionTargetV1::Block { position, .. } => position,
            _ => {
                if self.mining_state.take().is_some() {
                    self.invalidate_state_hash();
                }
                return Ok(());
            }
        };
        let value = match self.world.read_cell(position) {
            WorldCellReadV1::Loaded { cell, .. } if cell.block_id != WORLD_AIR_BLOCK_ID_V1 => cell,
            _ => {
                self.mining_state = None;
                self.invalidate_state_hash();
                return Ok(());
            }
        };
        let Some(profile) = self.gameplay_content_runtime.block_action(value.block_id).cloned() else {
            self.mining_state = None;
            self.invalidate_state_hash();
            return Ok(());
        };
        if runtime_block_action_route_v1(&self.gameplay_content_runtime, &profile)
            == IntegratedRuntimeBlockActionRouteV1::Blocked
        {
            self.mining_state = None;
            self.invalidate_state_hash();
            return Ok(());
        }
        let Some(tool) = self.mining_tool_v1(profile.preferred_tool) else {
            self.mining_state = None;
            self.invalidate_state_hash();
            return Ok(());
        };
        let player_id = self.player.as_ref().expect("held mining has player").entity_id.packed();
        let held = tool.held_stack.as_ref();
        let signature_matches = self.mining_state.as_ref().is_some_and(|state| {
            state.player_entity_id == player_id
                && state.target == position
                && state.target_block_id == value.block_id
                && state.world_revision == self.world.revision()
                && state.selected_slot == input.selected_slot
                && state.held_item_code == held.map_or(0, |stack| stack.item_code)
                && state.held_metadata_hash == held.map_or(CanonicalHash::default(), |stack| stack.metadata_hash)
                && state.held_durability_millionths == held.and_then(|stack| stack.durability_millionths)
                && state.tool_profile_hash == tool.profile_hash
        });
        if !signature_matches {
            let _ = self.begin_or_reset_mining(input, position)?;
            return Ok(());
        }
        if self
            .mining_state
            .as_ref()
            .is_some_and(|state| self.tick <= state.last_advanced_tick || self.tick <= state.started_tick)
        {
            return Ok(());
        }
        let hardness = profile.hardness_millionths.max(120_000);
        let increment = ((u128::from(INTEGRATED_RUNTIME_FIXED_STEP_US) * u128::from(tool.speed_millionths))
            / u128::from(hardness))
        .min(u128::from(u64::MAX)) as u64;
        let complete = {
            let state = self.mining_state.as_mut().expect("mining signature matched");
            state.progress_millionths = state.progress_millionths.saturating_add(increment);
            state.last_advanced_tick = self.tick;
            state.progress_millionths >= state.required_work_millionths
        };
        self.invalidate_state_hash();
        if complete {
            self.complete_basic_block_break(input, position, &profile, &tool)?;
        }
        Ok(())
    }

    fn complete_basic_block_break(
        &mut self,
        input: RuntimeInputFrameV1,
        position: CellPositionV1,
        profile: &blockwild_gameplay::ContentBlockActionProfile,
        tool: &IntegratedRuntimeMiningToolV1,
    ) -> Result<(), IntegratedRuntimeError> {
        let player = self.player.as_ref().expect("mining completion has player").clone();
        let harvested = profile.required_tier == 0
            || (tool.tool_kind == profile.preferred_tool && tool.tier >= profile.required_tier);
        if runtime_block_action_route_v1(&self.gameplay_content_runtime, profile)
            == IntegratedRuntimeBlockActionRouteV1::GeneratedLootV9
        {
            let committed = self.complete_generated_block_break_v9(input, position, profile, tool, harvested)?;
            if !committed && let Some(state) = self.mining_state.as_mut() {
                state.progress_millionths = state.required_work_millionths.saturating_sub(1);
                state.last_advanced_tick = self.tick;
                self.invalidate_state_hash();
            }
            return Ok(());
        }
        let created_stack = (!player.binding.creative_mode && harvested)
            .then(|| {
                profile
                    .mapped_item_code
                    .map(|item_code| ItemStack::simple(item_code, 1))
            })
            .flatten();
        let (_, inventory_revision, _) = self
            .held_stack_and_binding()
            .ok_or_else(|| IntegratedRuntimeError::new("input-break-binding", "bound inventory disappeared"))?;
        let inventory_command = (created_stack.is_some() || tool.durability_cost_millionths > 0).then(|| {
            let binding = self
                .world_view
                .state
                .player_binding(player.binding.player_id)
                .expect("bound inventory was checked");
            InventoryCommand::ApplyBlockActionV1(ApplyBlockActionV1 {
                inventory: binding.inventory_container.clone(),
                slot: u16::from(input.selected_slot),
                expected_container_revision: inventory_revision,
                expected_stack: tool.held_stack.clone(),
                consume_count: 0,
                durability_cost_millionths: tool.durability_cost_millionths,
                created_stack,
                reason: "block-break-v1".into(),
            })
        });
        let batch_id = format!("input-break:{}:{}", input.sequence, self.next_action_sequence);
        let committed = self.commit_basic_block_transaction(
            &batch_id,
            &player,
            position,
            WORLD_AIR_BLOCK_ID_V1,
            inventory_command,
        )?;
        if committed {
            self.mining_state = None;
            self.invalidate_state_hash();
        } else if let Some(state) = self.mining_state.as_mut() {
            state.progress_millionths = state.required_work_millionths.saturating_sub(1);
            state.last_advanced_tick = self.tick;
            self.invalidate_state_hash();
        }
        Ok(())
    }

    fn complete_generated_block_break_v9(
        &mut self,
        input: RuntimeInputFrameV1,
        position: CellPositionV1,
        profile: &blockwild_gameplay::ContentBlockActionProfile,
        tool: &IntegratedRuntimeMiningToolV1,
        harvested: bool,
    ) -> Result<bool, IntegratedRuntimeError> {
        let Some(block_action_sequence) = self.next_block_action_sequence else {
            return Ok(false);
        };
        let report = self
            .gameplay_content_runtime
            .action_promotion_report_v1()
            .map_err(|errors| {
                IntegratedRuntimeError::new(
                    "block-action-content",
                    format!("installed action report has {} validation error(s)", errors.len()),
                )
            })?
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "block-action-content",
                    "schema-2 generated loot requires an installed action report",
                )
            })?;
        let binding = BlockActionLootBindingV1::from_installed_content_v1(&self.gameplay_content_runtime, &report)
            .map_err(|error| IntegratedRuntimeError::new("block-action-content", error.message))?;
        let item_max_stacks = block_action_item_max_stacks_v1(&self.gameplay_content_runtime)?;
        let player = self.player.as_ref().expect("mining completion has player").clone();
        let context = BlockActionLootContextV1 {
            block_action_sequence,
            origin_input_sequence: input.sequence,
            block_id: profile.block_id,
            position: BlockActionLootCellV1 {
                x: position.x,
                y: position.y,
                z: position.z,
            },
            harvested,
            creative_mode: player.binding.creative_mode,
            scythe: tool.scythe,
        };
        let plan = match evaluate_block_action_loot_v1(
            &binding,
            profile,
            &item_max_stacks,
            &context,
            self.block_action_loot_rng,
        ) {
            Ok(plan) => plan,
            // In particular, luck-adjusted profiles stop here before their
            // first draw until a progression-owned luck context exists.
            Err(_) => return Ok(false),
        };
        let replacement = profile
            .harvest_intent
            .as_ref()
            .map(|harvest| {
                if tool.scythe {
                    harvest.replacement_with_scythe
                } else {
                    harvest.replacement_without_scythe
                }
            })
            .unwrap_or(WORLD_AIR_BLOCK_ID_V1);
        let wear_cost = profile
            .break_profile
            .as_ref()
            .map_or(0, |action| match action.durability_cost {
                ContentBlockDurabilityCost::None => 0,
                ContentBlockDurabilityCost::Constant(_) => tool.durability_cost_millionths,
                ContentBlockDurabilityCost::RootedTreeLogCount { .. } => 0,
            });
        self.commit_generated_block_action_v9(&player, input, position, replacement, wear_cost, plan)
    }

    fn commit_generated_block_action_v9(
        &mut self,
        player: &IntegratedRuntimePlayerStateV2,
        input: RuntimeInputFrameV1,
        position: CellPositionV1,
        replacement_block_id: u16,
        durability_cost_millionths: u32,
        plan: BlockActionLootPlanV1,
    ) -> Result<bool, IntegratedRuntimeError> {
        if plan.context.origin_input_sequence != input.sequence
            || plan.context.position
                != (BlockActionLootCellV1 {
                    x: position.x,
                    y: position.y,
                    z: position.z,
                })
            || plan.rng_before != self.block_action_loot_rng
            || Some(plan.context.block_action_sequence) != self.next_block_action_sequence
        {
            return Err(IntegratedRuntimeError::new(
                "block-action-plan-context",
                "generated-loot plan is stale against the runtime action context",
            ));
        }
        match self.world.read_cell(position) {
            WorldCellReadV1::Loaded { cell, .. } if cell.block_id == plan.context.block_id => {}
            WorldCellReadV1::Loaded { .. } => {
                return Err(IntegratedRuntimeError::new(
                    "block-action-target-drift",
                    "generated-loot target block changed before the atomic commit",
                ));
            }
            WorldCellReadV1::Unloaded { .. } => {
                return Err(IntegratedRuntimeError::new(
                    "block-action-target-unloaded",
                    "generated-loot target became unloaded before the atomic commit",
                ));
            }
        }
        let profile = self
            .gameplay_content_runtime
            .block_action(plan.context.block_id)
            .ok_or_else(|| IntegratedRuntimeError::new("block-action-profile", "loot profile disappeared"))?;
        let item_max_stacks = block_action_item_max_stacks_v1(&self.gameplay_content_runtime)?;
        replay_verify_block_action_loot_plan_v1(&plan, profile, &item_max_stacks)
            .map_err(|error| IntegratedRuntimeError::new("block-action-replay", error.message))?;

        let mut retained_receipts = self.block_action_receipts.clone();
        while retained_receipts.len() >= INTEGRATED_RUNTIME_MAX_BLOCK_ACTION_RECEIPTS_V1 {
            let Some(oldest) = retained_receipts.front() else {
                break;
            };
            let all_released = oldest.generated_drops.iter().all(|generated| {
                let drop_id = generated.provenance.drop_id_v1();
                let custody = ContainerKey {
                    kind: ContainerKind::Container,
                    id: generated.provenance.custody_id_v1(),
                    owner_id: None,
                };
                !self.world_view.state.dropped_items.contains_key(&drop_id)
                    && !self.gameplay.state.inventory.containers.contains_key(&custody)
                    && !self.entities.contains(generated.entity_id)
            });
            if !all_released {
                return Ok(false);
            }
            retained_receipts.pop_front();
        }

        let batch_id = format!("block-loot-v9:{}", plan.context.block_action_sequence);
        let before = self.identity();
        let mut staged_world = self.world.clone();
        let world_receipt = staged_world.apply_mutation_batch(WorldMutationBatchR4V1 {
            schema_version: blockwild_authority::WORLD_AUTHORITY_SCHEMA_V1,
            batch_id: batch_id.clone(),
            authority_id: player.binding.actor_id.clone(),
            address: self.world.active_address().clone(),
            expected_revision: self.world.revision(),
            commands: vec![WorldMutationCommandR4V1::SetBlock {
                position,
                block_id: replacement_block_id,
                facing: None,
            }],
        });
        if matches!(world_receipt, WorldMutationReceiptR4V1::Rejected { .. }) {
            return Ok(false);
        }

        let generated_specs = plan
            .stacks
            .iter()
            .map(|stack| {
                let provenance = GeneratedDropProvenanceV1 {
                    schema_version: blockwild_gameplay::BLOCK_ACTION_GENERATED_DROP_PROVENANCE_SCHEMA_VERSION_V1,
                    manifest_hash: plan.binding.manifest_hash,
                    installed_registry_hash: plan.binding.installed_registry_hash,
                    catalog_blob_hash: plan.binding.catalog_blob_hash,
                    action_report_hash: plan.binding.action_report_hash,
                    rng_semantics_hash: plan.binding.rng_semantics_hash,
                    block_action_sequence: plan.context.block_action_sequence,
                    origin_input_sequence: plan.context.origin_input_sequence,
                    block_id: plan.context.block_id,
                    position: plan.context.position,
                    loot_plan_hash: plan.plan_hash,
                    group_ordinal: stack.group_ordinal,
                };
                let (position, velocity, rotation) = generated_drop_transform_v9(&provenance);
                (stack.clone(), provenance, position, velocity, rotation)
            })
            .collect::<Vec<_>>();

        let entity_receipt = if generated_specs.is_empty() {
            None
        } else {
            let sequence = self.entity_command_sequence.checked_add(1).ok_or_else(|| {
                IntegratedRuntimeError::new("block-action-entity-sequence", "entity command sequence is exhausted")
            })?;
            let commands = generated_specs
                .iter()
                .map(|(stack, provenance, position, velocity, rotation)| {
                    let drop_id = provenance.drop_id_v1();
                    let mut record = EntityCompatibilityRecord::new(&drop_id, &drop_id, "dropped-item");
                    record.class = EntityClass::Construct;
                    record.position = drop_position_to_entity_v1(*position);
                    record.velocity = drop_position_to_entity_v1(*velocity);
                    record.yaw = drop_yaw_to_radians_v1(rotation.yaw);
                    record.custom.insert("item.code".into(), stack.item_code.to_string());
                    record.custom.insert("item.count".into(), stack.count.to_string());
                    record
                        .custom
                        .insert("item.metadataHash".into(), stack.metadata_hash.to_hex());
                    record.custom.insert(
                        "blockLoot.provenanceHash".into(),
                        provenance.canonical_hash_v1().to_hex(),
                    );
                    EntityCommand::Spawn {
                        record,
                        residency: EntityResidency::Hot,
                    }
                })
                .collect();
            let mut preview = self.entities.clone();
            match preview.apply_batch(&EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence,
                expected_revision: self.entities.revision(),
                tick: self.tick,
                commands,
            }) {
                Ok(receipt) => Some((preview, receipt)),
                Err(_) => return Ok(false),
            }
        };
        let generated_entity_ids = entity_receipt
            .as_ref()
            .map(|(_, receipt)| receipt.events.iter().map(|event| event.entity_id).collect::<Vec<_>>())
            .unwrap_or_default();
        if generated_entity_ids.len() != generated_specs.len() {
            return Err(IntegratedRuntimeError::new(
                "block-action-entity-preview",
                "entity preview did not allocate exactly one identity per generated stack",
            ));
        }

        let mut staged_gameplay = self.gameplay.clone();
        if durability_cost_millionths > 0 {
            let (binding, inventory_revision, _) = self
                .held_stack_and_binding()
                .ok_or_else(|| IntegratedRuntimeError::new("block-action-inventory", "player inventory disappeared"))?;
            let wear_batch = GameplayBatch::new(
                format!("{batch_id}:wear"),
                format!("{batch_id}:wear"),
                GameplayActor {
                    actor_id: player.binding.actor_id.clone(),
                    player_id: Some(player.binding.player_id),
                    entity_id: Some(player.entity_id),
                    role: ActorRole::Host,
                },
                staged_gameplay.state.identity(),
                vec![GameplayCommand::Inventory(InventoryCommand::ApplyBlockActionV1(
                    ApplyBlockActionV1 {
                        inventory: binding.inventory_container,
                        slot: u16::from(input.selected_slot),
                        expected_container_revision: inventory_revision,
                        expected_stack: self.held_stack_and_binding().and_then(|(_, _, stack)| stack),
                        consume_count: 0,
                        durability_cost_millionths,
                        created_stack: None,
                        reason: "block-break-v9".into(),
                    },
                ))],
            );
            if matches!(
                staged_gameplay.apply_batch(&wear_batch),
                GameplayReceipt::Rejected { .. }
            ) {
                return Ok(false);
            }
        }
        if !generated_specs.is_empty() {
            let commands = generated_specs
                .iter()
                .map(|(stack, provenance, _, _, _)| {
                    GameplayCommand::Inventory(InventoryCommand::CreateGeneratedDropCustodyV1(
                        CreateGeneratedDropCustodyV1::new(
                            ContainerKey {
                                kind: ContainerKind::Container,
                                id: provenance.custody_id_v1(),
                                owner_id: None,
                            },
                            ItemStack {
                                item_code: stack.item_code,
                                count: stack.count,
                                durability_millionths: None,
                                metadata_hash: stack.metadata_hash,
                            },
                            provenance.clone(),
                        ),
                    ))
                })
                .collect();
            let custody_batch = GameplayBatch::new(
                format!("{batch_id}:custody"),
                format!("{batch_id}:custody"),
                system_gameplay_actor_v1(),
                staged_gameplay.state.identity(),
                commands,
            );
            if matches!(
                staged_gameplay.apply_batch(&custody_batch),
                GameplayReceipt::Rejected { .. }
            ) {
                return Ok(false);
            }
        }

        let staged_entities = entity_receipt
            .as_ref()
            .map_or_else(|| self.entities.clone(), |(authority, _)| authority.clone());
        let world_view_commands = generated_specs
            .iter()
            .zip(&generated_entity_ids)
            .map(
                |((_, provenance, position, velocity, rotation), entity_id)| WorldViewCommandV1::RegisterDrop {
                    drop: DroppedItemSpatialV1 {
                        drop_id: provenance.drop_id_v1(),
                        revision: 0,
                        entity_id: *entity_id,
                        container: ContainerKey {
                            kind: ContainerKind::Container,
                            id: provenance.custody_id_v1(),
                            owner_id: None,
                        },
                        slot: 0,
                        bound_container_revision: 0,
                        position: *position,
                        velocity_milli_per_second: *velocity,
                        rotation: *rotation,
                        created_tick: self.world_view.state.tick,
                        expires_tick: None,
                        pickup_lock_actor_id: None,
                        pickup_unlock_tick: self
                            .world_view
                            .state
                            .tick
                            .saturating_add(INTEGRATED_RUNTIME_DROP_PICKUP_DELAY_TICKS_V1),
                    },
                },
            )
            .collect::<Vec<_>>();
        let staged_world_view = if world_view_commands.is_empty() {
            self.world_view.clone()
        } else {
            let batch = WorldViewBatchV1::new(
                format!("{batch_id}:spatial"),
                format!("{batch_id}:spatial"),
                system_world_view_actor_v1(),
                self.world_view.state.identity(),
                world_view_commands,
            );
            match stage_world_view_batches_v1(&self.world_view, &staged_gameplay.state, &staged_entities, &[batch]) {
                Ok(staged) => staged.authority,
                Err(_) => return Ok(false),
            }
        };

        let generated_drops = generated_specs
            .iter()
            .zip(generated_entity_ids)
            .map(
                |((_, provenance, _, _, _), entity_id)| IntegratedRuntimeGeneratedDropReceiptV1 {
                    provenance: provenance.clone(),
                    entity_id,
                },
            )
            .collect::<Vec<_>>();
        let mut receipt = IntegratedRuntimeBlockActionReceiptV1 {
            schema_version: INTEGRATED_RUNTIME_BLOCK_ACTION_RECEIPT_SCHEMA_V1,
            plan,
            generated_drops,
            receipt_hash: CanonicalHash::default(),
        };
        receipt.receipt_hash = receipt.calculate_hash_v1();
        receipt.validate_shape_v1()?;
        retained_receipts.push_back(receipt);

        let mut candidate = self.clone();
        candidate.world = staged_world;
        candidate.entities = staged_entities;
        candidate.gameplay = staged_gameplay;
        candidate.world_view = staged_world_view;
        if let Some((_, entity_receipt)) = &entity_receipt {
            candidate.entity_command_sequence = entity_receipt.sequence;
            candidate.sync_entity_schedules(std::slice::from_ref(entity_receipt))?;
        }
        candidate.block_action_loot_rng = retained_receipts
            .back()
            .expect("new receipt was retained")
            .plan
            .rng_after;
        candidate.next_block_action_sequence = retained_receipts
            .back()
            .expect("new receipt was retained")
            .plan
            .context
            .block_action_sequence
            .checked_add(1);
        candidate.block_action_receipts = retained_receipts;
        candidate.mining_state = None;
        candidate.invalidate_state_hash();
        validate_world_view_runtime_links_v1(
            &candidate.world_view.state,
            &candidate.gameplay.state,
            &candidate.entities,
        )
        .map_err(|error| IntegratedRuntimeError::new("block-action-transaction", error.to_string()))?;
        candidate.validate_block_action_history_v1()?;
        let after = candidate.identity();
        let receipt_hash = hash_runtime_receipt(&batch_id, &before, &after);
        let sequence = candidate
            .replay
            .back()
            .map_or(1, |entry| entry.sequence.saturating_add(1));
        let replay_entry = IntegratedRuntimeReplayEntryV2 {
            sequence,
            batch_id,
            before_hash: before.state_hash,
            after_hash: after.state_hash,
            receipt_hash,
        };
        candidate.replay_digest.add(hash_runtime_replay_entry(&replay_entry));
        candidate.replay.push_back(replay_entry);
        while candidate.replay.len() > INTEGRATED_RUNTIME_MAX_REPLAY_ENTRIES {
            if let Some(removed) = candidate.replay.pop_front() {
                candidate.replay_digest.remove(hash_runtime_replay_entry(&removed));
            }
        }
        *self = candidate;
        Ok(true)
    }

    fn apply_basic_block_placement(
        &mut self,
        input: RuntimeInputFrameV1,
        hit: CellPositionV1,
        normal: [i8; 3],
    ) -> Result<RuntimeInputActionOutcomeV1, IntegratedRuntimeError> {
        let player = self.player.as_ref().expect("action dispatch checked player").clone();
        let Some((binding, inventory_revision, held)) = self.held_stack_and_binding() else {
            return Ok(RuntimeInputActionOutcomeV1::Blocked);
        };
        let Some(held) = held else {
            return Ok(RuntimeInputActionOutcomeV1::EmptySlot);
        };
        let Some(item) = self
            .gameplay_content_runtime
            .items
            .values()
            .find(|item| item.item_code == held.item_code)
        else {
            return Ok(RuntimeInputActionOutcomeV1::Blocked);
        };
        let Some(block_id) = item.action.place_block else {
            return Ok(RuntimeInputActionOutcomeV1::Ineligible);
        };
        let Some(placed_profile) = self.gameplay_content_runtime.block_action(block_id) else {
            return Ok(RuntimeInputActionOutcomeV1::Blocked);
        };
        if !basic_single_cell_block_action_v1(placed_profile) {
            return Ok(RuntimeInputActionOutcomeV1::Blocked);
        }
        let hit_cell = match self.world.read_cell(hit) {
            WorldCellReadV1::Loaded { cell, .. } => cell,
            WorldCellReadV1::Unloaded { .. } => return Ok(RuntimeInputActionOutcomeV1::Blocked),
        };
        let hit_profile = self.gameplay_content_runtime.block_action(hit_cell.block_id);
        if hit_cell.block_id != WORLD_AIR_BLOCK_ID_V1
            && hit_profile.is_none_or(|profile| !basic_single_cell_block_action_v1(profile))
        {
            return Ok(RuntimeInputActionOutcomeV1::Blocked);
        }
        let target = if hit_profile.is_some_and(|profile| profile.replaceable) {
            hit
        } else {
            if normal.iter().map(|value| value.unsigned_abs()).sum::<u8>() != 1 {
                return Ok(RuntimeInputActionOutcomeV1::Blocked);
            }
            let Some(x) = hit.x.checked_add(i32::from(normal[0])) else {
                return Ok(RuntimeInputActionOutcomeV1::Blocked);
            };
            let Some(y) = hit.y.checked_add(i32::from(normal[1])) else {
                return Ok(RuntimeInputActionOutcomeV1::Blocked);
            };
            let Some(z) = hit.z.checked_add(i32::from(normal[2])) else {
                return Ok(RuntimeInputActionOutcomeV1::Blocked);
            };
            CellPositionV1 { x, y, z }
        };
        if !(WORLD_MIN_Y_V1..=WORLD_MAX_Y_V1).contains(&target.y) {
            return Ok(RuntimeInputActionOutcomeV1::Blocked);
        }
        let target_cell = match self.world.read_cell(target) {
            WorldCellReadV1::Loaded { cell, .. } => cell,
            WorldCellReadV1::Unloaded { .. } => return Ok(RuntimeInputActionOutcomeV1::Blocked),
        };
        if target_cell.liquid.kind != WorldLiquidKindV1::None
            || (target_cell.block_id != WORLD_AIR_BLOCK_ID_V1
                && self
                    .gameplay_content_runtime
                    .block_action(target_cell.block_id)
                    .is_none_or(|profile| !profile.replaceable || !basic_single_cell_block_action_v1(profile)))
        {
            return Ok(RuntimeInputActionOutcomeV1::Blocked);
        }
        if placed_profile.solid && player_intersects_block_v1(&player.body, target) {
            return Ok(RuntimeInputActionOutcomeV1::Blocked);
        }
        let inventory_command = (!player.binding.creative_mode).then(|| {
            InventoryCommand::ApplyBlockActionV1(ApplyBlockActionV1 {
                inventory: binding.inventory_container,
                slot: u16::from(input.selected_slot),
                expected_container_revision: inventory_revision,
                expected_stack: Some(held),
                consume_count: 1,
                durability_cost_millionths: 0,
                created_stack: None,
                reason: "block-place-v1".into(),
            })
        });
        let batch_id = format!("input-place:{}:{}", input.sequence, self.next_action_sequence);
        Ok(
            if self.commit_basic_block_transaction(&batch_id, &player, target, block_id, inventory_command)? {
                RuntimeInputActionOutcomeV1::Applied
            } else {
                RuntimeInputActionOutcomeV1::Blocked
            },
        )
    }

    fn commit_basic_block_transaction(
        &mut self,
        batch_id: &str,
        player: &IntegratedRuntimePlayerStateV2,
        position: CellPositionV1,
        block_id: u16,
        inventory: Option<InventoryCommand>,
    ) -> Result<bool, IntegratedRuntimeError> {
        let mut batch = IntegratedRuntimeBatchV2::empty(batch_id, self.identity());
        batch.world.push(WorldMutationBatchR4V1 {
            schema_version: blockwild_authority::WORLD_AUTHORITY_SCHEMA_V1,
            batch_id: batch_id.into(),
            authority_id: player.binding.actor_id.clone(),
            address: self.world.active_address().clone(),
            expected_revision: self.world.revision(),
            commands: vec![WorldMutationCommandR4V1::SetBlock {
                position,
                block_id,
                facing: None,
            }],
        });
        if let Some(inventory) = inventory {
            batch.gameplay.push(GameplayBatch::new(
                batch_id,
                batch_id,
                GameplayActor {
                    actor_id: player.binding.actor_id.clone(),
                    player_id: Some(player.binding.player_id),
                    entity_id: Some(player.entity_id),
                    role: ActorRole::Host,
                },
                self.gameplay.state.identity(),
                vec![GameplayCommand::Inventory(inventory)],
            ));
        }
        let mut candidate = self.clone();
        match candidate.commit(batch) {
            IntegratedRuntimeReceiptV2::Accepted(_) => {
                *self = candidate;
                Ok(true)
            }
            IntegratedRuntimeReceiptV2::Rejected(_) => Ok(false),
        }
    }

    fn advance_bound_player(&mut self, input: RuntimeInputFrameV1) -> Result<(), IntegratedRuntimeError> {
        let player = self.player.as_ref().expect("player binding was checked").clone();
        let resident = self
            .entities
            .hot()
            .get(&player.entity_id)
            .filter(|entity| {
                entity.record.class == EntityClass::Player
                    && entity.record.external_entity_id == player.binding.external_entity_id
            })
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "player-binding-stale",
                    "bound player entity is no longer resident with the same generational identity",
                )
            })?;
        let mut resident_record = resident.record.clone();
        let out_of_range_seconds = resident.out_of_range_seconds;
        let last_simulated_tick = resident.last_simulated_tick;
        let mut body = player.body.clone();
        // External entity commands may teleport the player between fixed steps.
        if resident.record.position
            != EntityVec3::new(body.position.x as f32, body.position.y as f32, body.position.z as f32)
        {
            body.position = SimulationVec3::new(
                f64::from(resident.record.position.x),
                f64::from(resident.record.position.y),
                f64::from(resident.record.position.z),
            );
            body.velocity = SimulationVec3::new(
                f64::from(resident.record.velocity.x),
                f64::from(resident.record.velocity.y),
                f64::from(resident.record.velocity.z),
            );
        }
        let crouching = input.buttons & (RUNTIME_INPUT_BUTTON_CROUCH_V1 | RUNTIME_INPUT_BUTTON_DESCEND_V1) != 0;
        body.crouching = crouching;
        body.height = if crouching {
            player.binding.crouching_height
        } else {
            player.binding.standing_height
        };
        let origin = ReadOriginV1 {
            x: floor_i32(body.position.x)?.saturating_sub(3),
            y: floor_i32(body.position.y)?.saturating_sub(2),
            z: floor_i32(body.position.z)?.saturating_sub(3),
        };
        let window = self.capture_simulation_window(origin, ReadSizeV1 { x: 7, y: 10, z: 7 })?;
        let yaw = normalized_i16(input.look_yaw) * std::f64::consts::PI;
        let creative_flying = player.flags & (RUNTIME_INPUT_FLAG_CREATIVE_V1 | RUNTIME_INPUT_FLAG_FLYING_V1)
            == (RUNTIME_INPUT_FLAG_CREATIVE_V1 | RUNTIME_INPUT_FLAG_FLYING_V1);
        let sprinting = input.buttons & RUNTIME_INPUT_BUTTON_SPRINT_V1 != 0;
        let mut controls_flags = 0_u16;
        if input.buttons & (RUNTIME_INPUT_BUTTON_JUMP_V1 | RUNTIME_INPUT_BUTTON_ASCEND_V1) != 0 {
            controls_flags |= PHYSICS_CONTROL_JUMP;
        }
        if crouching {
            controls_flags |= PHYSICS_CONTROL_CROUCH;
        }
        if sprinting {
            controls_flags |= PHYSICS_CONTROL_SPRINT;
        }
        if creative_flying {
            let vertical = f64::from(input.buttons & RUNTIME_INPUT_BUTTON_ASCEND_V1 != 0)
                - f64::from(input.buttons & RUNTIME_INPUT_BUTTON_DESCEND_V1 != 0);
            body.velocity.y = vertical * player.binding.creative_flight_speed;
            body.grounded = false;
        }
        let identity = SimulationJobIdentityV1 {
            job_id: format!("player:{}:{}", player.binding.external_entity_id, self.tick),
            sequence: self.tick as u32,
            world: window.identity.clone(),
            source_snapshot_hash: window.snapshot_hash,
        };
        let physics = PhysicsStepInputV1 {
            identity,
            fixed_delta_micros: INTEGRATED_RUNTIME_FIXED_STEP_US as u32,
            window,
            body,
            controls: PhysicsControlsV1 {
                flags: controls_flags,
                forward: normalized_i16(input.move_z),
                strafe: normalized_i16(input.move_x),
                yaw,
                desired_speed: if creative_flying {
                    player.binding.creative_flight_speed
                } else if sprinting {
                    player.binding.sprint_speed
                } else {
                    player.binding.walk_speed
                },
            },
            gravity: if creative_flying {
                GravityProfileV1::scaled(0.0)
            } else {
                GravityProfileV1::default()
            },
            swimming: PhysicsSwimProfileV1 {
                // Creative eligibility is Rust-owned and includes damage/
                // oxygen immunity even while the player elects to walk.
                enabled: !player.binding.creative_mode,
                max_oxygen_seconds: player.binding.maximum_oxygen_seconds,
                ..PhysicsSwimProfileV1::default()
            },
            external_impulses: Vec::new(),
            input_hash: CanonicalHash::default(),
        }
        .seal();
        let result = self.run_physics(&physics)?;
        let damage = if player.binding.creative_mode {
            0.0
        } else {
            result
                .events
                .iter()
                .filter(|event| {
                    matches!(
                        event.kind,
                        PhysicsEventKindV1::FallDamage | PhysicsEventKindV1::DrownDamage
                    )
                })
                .map(|event| event.amount)
                .sum::<f64>() as f32
        };
        resident_record.position = EntityVec3::new(
            result.body.position.x as f32,
            result.body.position.y as f32,
            result.body.position.z as f32,
        );
        resident_record.yaw = yaw as f32;
        resident_record.velocity = EntityVec3::new(
            result.body.velocity.x as f32,
            result.body.velocity.y as f32,
            result.body.velocity.z as f32,
        );
        resident_record.age_ticks = resident_record
            .age_ticks
            .saturating_add(self.tick.saturating_sub(last_simulated_tick).max(1));
        resident_record.health = (resident_record.health - damage).max(0.0);
        resident_record
            .custom
            .insert("physics.grounded".into(), result.body.grounded.to_string());
        resident_record.custom.insert(
            "physics.inLiquid".into(),
            (result.contact_flags & PHYSICS_CONTACT_IN_LIQUID != 0).to_string(),
        );
        resident_record.custom.insert(
            "physics.headSubmerged".into(),
            (result.contact_flags & PHYSICS_CONTACT_HEAD_SUBMERGED != 0).to_string(),
        );
        resident_record.custom.insert(
            "physics.oxygenSeconds".into(),
            format!("{:.6}", result.body.oxygen_seconds),
        );
        self.apply_internal_entity_commands(
            "player-motion",
            vec![
                EntityCommand::ReplaceCompatibilityRecord {
                    id: player.entity_id,
                    value: resident_record,
                },
                EntityCommand::SetRangeState {
                    id: player.entity_id,
                    out_of_range_seconds,
                    last_simulated_tick: self.tick,
                },
            ],
        )?;
        let binding_id = player.binding.external_entity_id.clone();
        for event in &result.events {
            if player.binding.creative_mode
                && matches!(
                    event.kind,
                    PhysicsEventKindV1::FallDamage | PhysicsEventKindV1::DrownDamage
                )
            {
                continue;
            }
            self.push_effect_event(&binding_id, event.kind, event.amount);
        }
        self.camera.look_yaw = input.look_yaw;
        self.camera.look_pitch = input.look_pitch;
        self.player = Some(IntegratedRuntimePlayerStateV2 {
            binding: player.binding,
            entity_id: player.entity_id,
            body: result.body,
            contact_flags: result.contact_flags,
            selected_slot: input.selected_slot,
            look_pitch: input.look_pitch,
            buttons: input.buttons,
            flags: player.flags,
            last_input_sequence: input.sequence,
        });
        Ok(())
    }

    fn apply_internal_entity_commands(
        &mut self,
        code: &'static str,
        commands: Vec<EntityCommand>,
    ) -> Result<EntityEventBatch, IntegratedRuntimeError> {
        if commands.is_empty() {
            return Err(IntegratedRuntimeError::new(
                code,
                "internal entity command batch is empty",
            ));
        }
        let sequence = self.entity_command_sequence.saturating_add(1).max(1);
        let mut staged = self.clone();
        let receipt = staged
            .entities
            .apply_batch(&EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence,
                expected_revision: staged.entities.revision(),
                tick: self.tick,
                commands,
            })
            .map_err(|error| IntegratedRuntimeError::new(code, error.to_string()))?;
        validate_world_view_runtime_links_v1(&staged.world_view.state, &staged.gameplay.state, &staged.entities)
            .map_err(|error| IntegratedRuntimeError::new(code, error.to_string()))?;
        staged.entity_command_sequence = staged.entity_command_sequence.max(receipt.sequence);
        staged.sync_entity_schedules(std::slice::from_ref(&receipt))?;
        staged.invalidate_state_hash();
        *self = staged;
        Ok(receipt)
    }

    fn advance_entity_scheduler(&mut self) -> Result<(), IntegratedRuntimeError> {
        let due = self
            .entity_scheduler
            .due_jobs(self.tick, INTEGRATED_RUNTIME_MAX_ENTITY_SCHEDULE_JOBS_V1);
        if due.is_empty() {
            return Ok(());
        }
        let mut candidate_scheduler = self.entity_scheduler.clone();
        let mut commands = Vec::with_capacity(due.len().saturating_mul(2));
        let combat_entity_ids = self
            .gameplay
            .state
            .combat
            .projectiles
            .values()
            .filter_map(|projectile| projectile.presentation.as_ref().map(|link| link.entity_id))
            .chain(
                self.gameplay
                    .state
                    .combat
                    .summons
                    .values()
                    .filter_map(|summon| summon.presentation.as_ref().map(|link| link.entity_id)),
            )
            .collect::<BTreeSet<_>>();
        for token in due {
            if combat_entity_ids.contains(&token.id) {
                // R6 combat presentation entities advance only in the atomic
                // R7/R6 combat transaction below. The receipt synchronizer may
                // schedule them again, but each due token is removed here
                // before any generic aging/range mutation can race that lane.
                candidate_scheduler.remove(token.id);
                continue;
            }
            let Some(current_revision) = self.entities.entity_revision(token.id) else {
                candidate_scheduler.remove(token.id);
                self.entity_schedule_diagnostics.entity_jobs_rejected_stale = self
                    .entity_schedule_diagnostics
                    .entity_jobs_rejected_stale
                    .saturating_add(1);
                continue;
            };
            if candidate_scheduler
                .complete(token, current_revision, self.tick)
                .is_err()
            {
                self.entity_schedule_diagnostics.entity_jobs_rejected_stale = self
                    .entity_schedule_diagnostics
                    .entity_jobs_rejected_stale
                    .saturating_add(1);
                if let Some(entity) = self.entities.hot().get(&token.id) {
                    candidate_scheduler.upsert(token.id, entity.tier, entity.entity_revision, self.tick);
                } else {
                    candidate_scheduler.remove(token.id);
                }
                continue;
            }
            let Some(entity) = self.entities.hot().get(&token.id) else {
                candidate_scheduler.remove(token.id);
                continue;
            };
            let mut record = entity.record.clone();
            record.age_ticks = record
                .age_ticks
                .saturating_add(self.tick.saturating_sub(entity.last_simulated_tick).max(1));
            commands.push(EntityCommand::ReplaceCompatibilityRecord {
                id: token.id,
                value: record,
            });
            commands.push(EntityCommand::SetRangeState {
                id: token.id,
                out_of_range_seconds: entity.out_of_range_seconds,
                last_simulated_tick: self.tick,
            });
            self.entity_schedule_diagnostics.entity_jobs_completed =
                self.entity_schedule_diagnostics.entity_jobs_completed.saturating_add(1);
        }
        if commands.is_empty() {
            self.entity_scheduler = candidate_scheduler;
            return Ok(());
        }
        let previous_scheduler = std::mem::replace(&mut self.entity_scheduler, candidate_scheduler);
        if let Err(error) = self.apply_internal_entity_commands("entity-schedule", commands) {
            self.entity_scheduler = previous_scheduler;
            return Err(error);
        }
        Ok(())
    }

    fn advance_ecology_scheduler(&mut self) {
        let due = self
            .entity_ecology_jobs
            .due(self.tick, INTEGRATED_RUNTIME_MAX_ECOLOGY_SCHEDULE_JOBS_V1);
        for token in due {
            let Some(current_revision) = self.entity_ecology_revisions.get(&token.sector).copied() else {
                self.entity_ecology_jobs.remove(token.sector);
                self.entity_schedule_diagnostics.ecology_jobs_rejected_stale = self
                    .entity_schedule_diagnostics
                    .ecology_jobs_rejected_stale
                    .saturating_add(1);
                continue;
            };
            match self.entity_ecology_jobs.complete(
                token,
                current_revision,
                self.tick,
                self.tick.saturating_add(INTEGRATED_RUNTIME_ECOLOGY_CADENCE_TICKS_V1),
            ) {
                Ok(()) => {
                    self.entity_ecology_revisions
                        .insert(token.sector, current_revision.wrapping_add(1));
                    self.entity_schedule_diagnostics.ecology_jobs_completed = self
                        .entity_schedule_diagnostics
                        .ecology_jobs_completed
                        .saturating_add(1);
                }
                Err(_) => {
                    self.entity_schedule_diagnostics.ecology_jobs_rejected_stale = self
                        .entity_schedule_diagnostics
                        .ecology_jobs_rejected_stale
                        .saturating_add(1);
                    let _ = self
                        .entity_ecology_jobs
                        .schedule(token.sector, current_revision, self.tick);
                }
            }
        }
    }

    fn advance_path_scheduler(&mut self) {
        let due = self
            .entity_path_jobs
            .due(self.tick, INTEGRATED_RUNTIME_MAX_PATH_SCHEDULE_JOBS_V1);
        for token in due {
            let current = self.entities.hot().get(&token.id).map(|entity| {
                (
                    entity.entity_revision,
                    entity.components.ai.route_epoch,
                    entity.components.ai.route.clone(),
                    entity.record.position,
                    entity.tier,
                )
            });
            let Some((entity_revision, route_epoch, points, origin, tier)) = current else {
                self.entity_path_jobs.cancel(token.id);
                self.entity_schedule_diagnostics.path_jobs_rejected_stale = self
                    .entity_schedule_diagnostics
                    .path_jobs_rejected_stale
                    .saturating_add(1);
                continue;
            };
            match self
                .entity_path_jobs
                .accept(token, token.id, entity_revision, route_epoch, points.clone())
            {
                Ok(_) => {
                    self.entity_schedule_diagnostics.path_jobs_completed =
                        self.entity_schedule_diagnostics.path_jobs_completed.saturating_add(1);
                }
                Err(_) => {
                    self.entity_path_jobs.cancel(token.id);
                    self.entity_schedule_diagnostics.path_jobs_rejected_stale = self
                        .entity_schedule_diagnostics
                        .path_jobs_rejected_stale
                        .saturating_add(1);
                    if let Some(goal) = points.last().copied() {
                        let _ = self.entity_path_jobs.submit(PathJobSubmission {
                            id: token.id,
                            entity_revision,
                            route_epoch,
                            due_tick: self.tick.saturating_add(tier.cadence_ticks().unwrap_or(10)),
                            priority: entity_path_priority(tier),
                            origin,
                            goal,
                        });
                    }
                }
            }
        }
    }

    fn sync_entity_schedules(&mut self, receipts: &[EntityEventBatch]) -> Result<(), IntegratedRuntimeError> {
        let ids = receipts
            .iter()
            .flat_map(|receipt| receipt.events.iter().map(|event| event.entity_id))
            .collect::<BTreeSet<_>>();
        for id in ids {
            self.sync_entity_schedule(id);
        }
        Ok(())
    }

    fn sync_entity_schedule(&mut self, id: EntityId) {
        let residency = self.entities.residency(id);
        let new_sector = self
            .entities
            .compatibility_record(id)
            .map(|record| entity_ecology_sector(record.position));
        let old_sector = self.entity_sectors.get(&id).copied();
        if old_sector != new_sector {
            if let Some(sector) = old_sector {
                let remove_sector = self.entity_sector_counts.get_mut(&sector).is_some_and(|count| {
                    *count = count.saturating_sub(1);
                    *count == 0
                });
                if remove_sector {
                    self.entity_sector_counts.remove(&sector);
                    self.entity_ecology_revisions.remove(&sector);
                    self.entity_ecology_jobs.remove(sector);
                }
            }
            self.entity_sectors.remove(&id);
            if let Some(sector) = new_sector {
                self.entity_sectors.insert(id, sector);
                let count = self.entity_sector_counts.entry(sector).or_default();
                let new_sector = *count == 0;
                *count = count.saturating_add(1);
                if new_sector {
                    let revision = *self.entity_ecology_revisions.entry(sector).or_insert(1);
                    let _ = self.entity_ecology_jobs.schedule(
                        sector,
                        revision,
                        self.tick.saturating_add(INTEGRATED_RUNTIME_ECOLOGY_CADENCE_TICKS_V1),
                    );
                }
            }
        }

        match residency {
            Some(EntityResidency::Hot) => {
                let entity = self.entities.hot().get(&id).expect("hot residency has a hot entity");
                self.entity_scheduler
                    .upsert(id, entity.tier, entity.entity_revision, self.tick);
                self.entity_path_jobs.cancel(id);
                if let Some(goal) = entity.components.ai.route.last().copied() {
                    let _ = self.entity_path_jobs.submit(PathJobSubmission {
                        id,
                        entity_revision: entity.entity_revision,
                        route_epoch: entity.components.ai.route_epoch,
                        due_tick: self.tick.saturating_add(entity.tier.cadence_ticks().unwrap_or(10)),
                        priority: entity_path_priority(entity.tier),
                        origin: entity.record.position,
                        goal,
                    });
                }
            }
            Some(EntityResidency::Cold) | None => {
                self.entity_scheduler.remove(id);
                self.entity_path_jobs.cancel(id);
            }
        }
    }

    fn rebuild_entity_schedules(&mut self) -> Result<(), IntegratedRuntimeError> {
        self.entity_scheduler = EntityScheduler::default();
        self.entity_ecology_jobs = EcologyJobQueue::default();
        self.entity_ecology_revisions.clear();
        self.entity_sectors.clear();
        self.entity_sector_counts.clear();
        self.entity_path_jobs = PathJobQueue::default();
        let ids = self
            .entities
            .hot()
            .keys()
            .chain(self.entities.cold().keys())
            .copied()
            .collect::<Vec<_>>();
        for id in ids {
            self.sync_entity_schedule(id);
        }
        Ok(())
    }

    fn advance_entity_and_gameplay_schedules(&mut self) -> Result<(), IntegratedRuntimeError> {
        // Complete path tokens against the revision they were submitted for
        // before routine entity aging advances that revision and schedules the
        // next token. Reversing this order can starve every continuously active
        // entity by invalidating its path at exactly the same cadence.
        self.advance_path_scheduler();
        self.advance_entity_scheduler()?;
        self.advance_ecology_scheduler();

        let (combat_commands, mut combat_entity_commands, combat_health_syncs) = self.combat_schedule_commands_v1()?;

        let expected_tick = self.gameplay.state.tick;
        let expected_world_view_tick = self.world_view.state.tick;
        if self.tick <= expected_tick || self.tick <= expected_world_view_tick {
            return Err(IntegratedRuntimeError::new(
                "gameplay-schedule-clock",
                "fixed-step runtime tick did not advance beyond gameplay and world-view authority",
            ));
        }
        let batch_id = format!("gameplay-schedule:{}", self.tick);
        let mut gameplay_commands = combat_commands;
        gameplay_commands.push(GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
            expected_tick,
            to_tick: self.tick,
            machine_budget: INTEGRATED_RUNTIME_MAX_MACHINES_PER_STEP as u16,
        }));
        let batch = GameplayBatch::new(
            &batch_id,
            &batch_id,
            GameplayActor {
                actor_id: GAMEPLAY_SCHEDULER_ACTOR_ID_V1.into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            self.gameplay.state.identity(),
            gameplay_commands,
        );
        let mut staged_gameplay = self.gameplay.clone();
        match staged_gameplay.apply_batch(&batch) {
            GameplayReceipt::Accepted(_) => {}
            GameplayReceipt::Rejected { rejection, .. } => {
                return Err(IntegratedRuntimeError::new(
                    "gameplay-schedule",
                    format!("{:?}: {}", rejection.code, rejection.message),
                ));
            }
        }
        let combat_health_expectations = combat_health_syncs.clone();
        let mut combat_health_commands = Vec::with_capacity(combat_health_syncs.len());
        for (target_entity_id, target_record_id) in combat_health_syncs {
            let combatant = staged_gameplay
                .state
                .combat
                .combatants
                .get(&target_record_id)
                .ok_or_else(|| {
                    IntegratedRuntimeError::new(
                        "combat-target-health",
                        "projectile target combatant disappeared before R6 health synchronization",
                    )
                })?;
            let entity = self.entities.hot().get(&target_entity_id).ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "combat-target-health",
                    "projectile target R6 entity disappeared before health synchronization",
                )
            })?;
            let mut record = entity.record.clone();
            record.health = combatant.health as f32;
            record.maximum_health = combatant.max_health as f32;
            combat_health_commands.push(EntityCommand::ReplaceCompatibilityRecord {
                id: target_entity_id,
                value: record,
            });
        }
        combat_health_commands.append(&mut combat_entity_commands);
        combat_entity_commands = combat_health_commands;
        let mut staged_entities = self.entities.clone();
        let entity_receipt = if combat_entity_commands.is_empty() {
            None
        } else {
            let sequence = self.entity_command_sequence.saturating_add(1).max(1);
            Some(
                staged_entities
                    .apply_batch(&EntityCommandBatch {
                        schema: ENTITY_COMMAND_SCHEMA,
                        sequence,
                        expected_revision: staged_entities.revision(),
                        tick: self.tick,
                        commands: combat_entity_commands,
                    })
                    .map_err(|error| IntegratedRuntimeError::new("combat-entity-schedule", error.to_string()))?,
            )
        };
        for (target_entity_id, target_record_id) in &combat_health_expectations {
            let combatant = staged_gameplay
                .state
                .combat
                .combatants
                .get(target_record_id)
                .expect("health synchronization retained its combatant");
            let record = staged_entities.compatibility_record(*target_entity_id).ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "combat-target-health",
                    "projectile target R6 entity disappeared during health synchronization",
                )
            })?;
            if record.health != combatant.health as f32 || record.maximum_health != combatant.max_health as f32 {
                return Err(IntegratedRuntimeError::new(
                    "combat-target-health",
                    "linked projectile target R7 and R6 health did not commit exactly",
                ));
            }
        }
        let world_view_batch_id = format!("world-view-schedule:{}", self.tick);
        let world_view_batch = WorldViewBatchV1::new(
            &world_view_batch_id,
            &world_view_batch_id,
            GameplayActor {
                actor_id: "system".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            self.world_view.state.identity(),
            vec![WorldViewCommandV1::AdvanceTick {
                expected_tick: expected_world_view_tick,
                to_tick: self.tick,
            }],
        );
        let mut staged_world_view = self.world_view.clone();
        match staged_world_view.apply_batch(&world_view_batch, &staged_gameplay.state) {
            WorldViewReceiptV1::Accepted(_) => {}
            WorldViewReceiptV1::Rejected { rejection, .. } => {
                return Err(IntegratedRuntimeError::new(
                    "world-view-schedule",
                    format!("{:?}: {}", rejection.code, rejection.message),
                ));
            }
        }
        validate_world_view_runtime_links_v1(&staged_world_view.state, &staged_gameplay.state, &staged_entities)
            .map_err(|error| IntegratedRuntimeError::new("world-view-schedule", error.to_string()))?;
        self.gameplay = staged_gameplay;
        self.entities = staged_entities;
        self.world_view = staged_world_view;
        if let Some(receipt) = entity_receipt {
            self.entity_command_sequence = self.entity_command_sequence.max(receipt.sequence);
            self.sync_entity_schedules(std::slice::from_ref(&receipt))?;
        }
        self.validate_combat_presentation_bindings_v1()?;
        Ok(())
    }

    fn combat_schedule_commands_v1(&self) -> Result<CombatScheduleCommandsV1, IntegratedRuntimeError> {
        let mut gameplay_commands = Vec::new();
        let mut entity_commands = Vec::new();
        let mut health_syncs = BTreeMap::new();
        for projectile in self.gameplay.state.combat.projectiles.values() {
            let Some(link) = &projectile.presentation else {
                continue;
            };
            let entity = self.entities.hot().get(&link.entity_id).ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "combat-projectile-residency",
                    "linked projectile must remain a hot R6 entity",
                )
            })?;
            let origin = SimulationVec3::new(
                f64::from(projectile.position.x_milli) / 1_000.0,
                f64::from(projectile.position.y_milli) / 1_000.0,
                f64::from(projectile.position.z_milli) / 1_000.0,
            );
            let end_fixed =
                advance_projectile_position_v1(projectile.position, projectile.velocity, projectile.revision, 1)
                    .map_err(|error| IntegratedRuntimeError::new("combat-projectile-motion", error.message))?;
            let end = SimulationVec3::new(
                f64::from(end_fixed.x_milli) / 1_000.0,
                f64::from(end_fixed.y_milli) / 1_000.0,
                f64::from(end_fixed.z_milli) / 1_000.0,
            );
            let displacement = end - origin;
            let radius = f64::from(entity.components.locomotion.radius);
            let lower = SimulationVec3::new(
                origin.x.min(end.x) - radius,
                origin.y.min(end.y) - radius,
                origin.z.min(end.z) - radius,
            );
            let upper = SimulationVec3::new(
                origin.x.max(end.x) + radius,
                origin.y.max(end.y) + radius,
                origin.z.max(end.z) + radius,
            );
            let low = [
                floor_i32(lower.x + 0.5)?,
                floor_i32(lower.y + 0.5)?,
                floor_i32(lower.z + 0.5)?,
            ];
            let high = [
                floor_i32(upper.x + 0.5)?,
                floor_i32(upper.y + 0.5)?,
                floor_i32(upper.z + 0.5)?,
            ];
            let span = |axis: usize| {
                high[axis]
                    .checked_sub(low[axis])
                    .and_then(|value| value.checked_add(1))
                    .and_then(|value| u16::try_from(value).ok())
                    .ok_or_else(|| {
                        IntegratedRuntimeError::new(
                            "combat-projectile-window",
                            "projectile sweep exceeds the bounded R4 read window",
                        )
                    })
            };
            let window = self.capture_simulation_window(
                ReadOriginV1 {
                    x: low[0],
                    y: low[1],
                    z: low[2],
                },
                ReadSizeV1 {
                    x: span(0)?,
                    y: span(1)?,
                    z: span(2)?,
                },
            )?;
            let targets = self
                .entities
                .hot()
                .iter()
                .filter(|(entity_id, candidate)| {
                    **entity_id != link.entity_id
                        && candidate.record.external_entity_id != projectile.source_id
                        && candidate.record.health > 0.0
                        && self
                            .gameplay
                            .state
                            .combat
                            .combatants
                            .contains_key(&candidate.record.external_entity_id)
                })
                .map(|(entity_id, candidate)| {
                    let center = SimulationVec3::new(
                        f64::from(candidate.record.position.x),
                        f64::from(candidate.record.position.y),
                        f64::from(candidate.record.position.z),
                    );
                    let body_radius = f64::from(candidate.components.locomotion.radius);
                    let half_height = f64::from(candidate.components.locomotion.half_height);
                    SweepTargetV1 {
                        target_id: entity_id.packed(),
                        bounds: AabbV1::new(
                            SimulationVec3::new(center.x - body_radius, center.y - half_height, center.z - body_radius),
                            SimulationVec3::new(center.x + body_radius, center.y + half_height, center.z + body_radius),
                        ),
                    }
                })
                .collect::<Vec<_>>();
            let sweep = ProjectileSweepV1 {
                projectile_id: link.entity_id.packed(),
                origin,
                displacement,
                radius,
            };
            let contact = sweep_projectile_contacts_batch(&window, &[sweep], &targets)
                .map_err(|error| IntegratedRuntimeError::new("combat-projectile-sweep", error.to_string()))?
                .into_iter()
                .next();
            if let Some(contact) = contact {
                let target_id = match (contact.kind, contact.target_id) {
                    (ProjectileContactKindV1::Target, Some(target)) => {
                        let target_entity_id = EntityId::new(target as u32, (target >> 32) as u32);
                        self.entities.compatibility_record(target_entity_id).map(|record| {
                            health_syncs.insert(target_entity_id, record.external_entity_id.clone());
                            record.external_entity_id.clone()
                        })
                    }
                    _ => None,
                };
                gameplay_commands.push(GameplayCommand::Combat(CombatCommand::ResolveLinkedProjectile {
                    projectile_id: projectile.projectile_id.clone(),
                    expected_revision: projectile.revision,
                    target_id,
                    impact: simulation_position_to_fixed_v1(contact.hit.point)?,
                    tick: self.tick,
                }));
                entity_commands.push(EntityCommand::Despawn {
                    id: link.entity_id,
                    reason: DespawnReason::NaturalRange,
                });
            } else {
                gameplay_commands.push(GameplayCommand::Combat(CombatCommand::AdvanceLinkedProjectile {
                    projectile_id: projectile.projectile_id.clone(),
                    expected_revision: projectile.revision,
                    position: end_fixed,
                    tick: self.tick,
                }));
                if projectile.expires_tick <= self.tick {
                    entity_commands.push(EntityCommand::Despawn {
                        id: link.entity_id,
                        reason: DespawnReason::NaturalRange,
                    });
                } else {
                    entity_commands.push(EntityCommand::UpdateMotion {
                        id: link.entity_id,
                        position: EntityVec3::new(end.x as f32, end.y as f32, end.z as f32),
                        yaw: entity.record.yaw,
                        velocity: EntityVec3::new(
                            projectile.velocity.x_milli as f32 / 1_000.0,
                            projectile.velocity.y_milli as f32 / 1_000.0,
                            projectile.velocity.z_milli as f32 / 1_000.0,
                        ),
                    });
                }
            }
        }
        for summon in self.gameplay.state.combat.summons.values() {
            if summon
                .expires_tick
                .is_some_and(|expires_tick| expires_tick <= self.tick)
                && let Some(link) = &summon.presentation
            {
                entity_commands.push(EntityCommand::Despawn {
                    id: link.entity_id,
                    reason: DespawnReason::NaturalRange,
                });
            }
        }
        Ok((gameplay_commands, entity_commands, health_syncs))
    }

    /// Advance the bounded canonical prefix of dropped items and resolve
    /// pickups on the already-private candidate owned by [`Self::step`]. A
    /// corrupt link, stale revision, or R4 read failure rejects that candidate,
    /// so this path does not need another full runtime clone every 50 ms.
    fn advance_dropped_items_v1(&mut self) -> Result<(), IntegratedRuntimeError> {
        if self.world_view.state.dropped_items.is_empty() {
            return Ok(());
        }
        let drop_ids = self.canonical_drop_scan_v1();
        let mut entity_commands = Vec::with_capacity(drop_ids.len());
        let mut world_view_commands = Vec::with_capacity(drop_ids.len());
        for drop_id in &drop_ids {
            let drop = self
                .world_view
                .state
                .dropped_items
                .get(drop_id)
                .expect("canonical drop key remains present")
                .clone();
            self.validate_drop_runtime_link_v1(&drop)?;
            let (position, velocity, rotation) = self.integrate_drop_motion_v1(&drop)?;
            if position == drop.position && velocity == drop.velocity_milli_per_second && rotation == drop.rotation {
                continue;
            }
            world_view_commands.push(WorldViewCommandV1::UpdateDropTransform {
                drop_id: drop.drop_id.clone(),
                expected_revision: drop.revision,
                position,
                velocity_milli_per_second: velocity,
                rotation,
            });
            entity_commands.push(EntityCommand::UpdateMotion {
                id: drop.entity_id,
                position: drop_position_to_entity_v1(position),
                yaw: drop_yaw_to_radians_v1(rotation.yaw),
                velocity: drop_position_to_entity_v1(velocity),
            });
        }
        self.apply_drop_transform_batch_v1(entity_commands, world_view_commands)?;

        // Scan after motion so pickup reach is evaluated against the exact
        // transform presented by both R6 and world-view in this tick.
        let pickup_drop_ids = drop_ids;
        let player_bindings = self
            .world_view
            .state
            .player_bindings
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut pickups = 0_usize;
        for drop_id in pickup_drop_ids {
            if pickups >= INTEGRATED_RUNTIME_MAX_DROP_PICKUPS_PER_STEP_V1 {
                break;
            }
            let Some(mut drop) = self.world_view.state.dropped_items.get(&drop_id).cloned() else {
                continue;
            };
            self.validate_drop_runtime_link_v1(&drop)?;
            if drop.expires_tick.is_some_and(|expires_tick| self.tick >= expires_tick) {
                // Expiry is a policy hint, never authority to delete nonempty
                // custody. Stop motion but keep every ownership link intact.
                self.freeze_expired_drop_v1(&drop)?;
                drop = self
                    .world_view
                    .state
                    .dropped_items
                    .get(&drop_id)
                    .expect("expired custody remains spatially owned")
                    .clone();
            }
            if self.tick < drop.pickup_unlock_tick {
                continue;
            }
            for binding in &player_bindings {
                let Some(player_record) = self.entities.hot().get(&binding.entity_id).map(|entity| &entity.record)
                else {
                    return Err(IntegratedRuntimeError::new(
                        "drop-player-orphan",
                        "world-view pickup binding must reference a hot R6 player entity",
                    ));
                };
                if !drop_within_pickup_radius_v1(drop.position, player_record.position) {
                    continue;
                }
                match self.pickup_drop_for_player_v1(&drop, binding) {
                    Ok(true) => {
                        pickups = pickups.saturating_add(1);
                        break;
                    }
                    Ok(false) => continue,
                    Err(error) => return Err(error),
                }
            }
        }
        validate_world_view_runtime_links_v1(&self.world_view.state, &self.gameplay.state, &self.entities)
            .map_err(|error| IntegratedRuntimeError::new("drop-step-links", error.to_string()))?;
        Ok(())
    }

    fn canonical_drop_scan_v1(&self) -> Vec<String> {
        let count = self.world_view.state.dropped_items.len();
        if count <= INTEGRATED_RUNTIME_MAX_DROP_MOTION_PER_STEP_V1 {
            return self.world_view.state.dropped_items.keys().cloned().collect();
        }
        // Advance by one full budget through the sorted ring each tick. Using
        // the exact item count (rather than page count) keeps a short final
        // page from biasing the lowest IDs while remaining replay-stable.
        let start = usize::try_from(
            u128::from(self.tick.saturating_sub(1))
                .saturating_mul(INTEGRATED_RUNTIME_MAX_DROP_MOTION_PER_STEP_V1 as u128)
                % count as u128,
        )
        .expect("drop scan offset is bounded by the in-memory item count");
        self.world_view
            .state
            .dropped_items
            .keys()
            .skip(start)
            .chain(self.world_view.state.dropped_items.keys().take(start))
            .take(INTEGRATED_RUNTIME_MAX_DROP_MOTION_PER_STEP_V1)
            .cloned()
            .collect()
    }

    fn validate_drop_runtime_link_v1(&self, drop: &DroppedItemSpatialV1) -> Result<(), IntegratedRuntimeError> {
        let record = self
            .entities
            .hot()
            .get(&drop.entity_id)
            .map(|entity| &entity.record)
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "drop-entity-orphan",
                    "world-view dropped item must reference a hot R6 entity",
                )
            })?;
        if record.class != EntityClass::Construct || record.kind_key != "dropped-item" {
            return Err(IntegratedRuntimeError::new(
                "drop-entity-kind",
                "world-view dropped item references an R6 entity of another kind",
            ));
        }
        let custody = self
            .gameplay
            .state
            .inventory
            .containers
            .get(&drop.container)
            .ok_or_else(|| IntegratedRuntimeError::new("drop-custody-orphan", "drop custody container is absent"))?;
        if custody.revision != drop.bound_container_revision
            || custody.slots.get(usize::from(drop.slot)).is_none_or(Option::is_none)
            || custody.slots.iter().flatten().count() != 1
        {
            return Err(IntegratedRuntimeError::new(
                "drop-custody-link",
                "drop custody revision or one-item slot invariant is stale",
            ));
        }
        if !drop_entity_transform_matches_v1(drop, record) {
            return Err(IntegratedRuntimeError::new(
                "drop-transform-link",
                "world-view and R6 dropped-item transforms disagree",
            ));
        }
        Ok(())
    }

    fn integrate_drop_motion_v1(
        &self,
        drop: &DroppedItemSpatialV1,
    ) -> Result<(FixedWorldVec3V1, FixedWorldVec3V1, RotationMicroturnsV1), IntegratedRuntimeError> {
        if drop.expires_tick.is_some_and(|expires_tick| self.tick >= expires_tick) {
            return Ok((drop.position, FixedWorldVec3V1::default(), drop.rotation));
        }
        let mut velocity = drop.velocity_milli_per_second;
        velocity.y_milli = velocity
            .y_milli
            .saturating_sub(INTEGRATED_RUNTIME_DROP_GRAVITY_PER_STEP_V1)
            .max(INTEGRATED_RUNTIME_DROP_TERMINAL_VELOCITY_MILLI_V1);
        let displacement = |component: i64| component / 20;
        let mut position = drop.position;
        let mut horizontal_collision = false;
        for (axis, delta) in [
            (0_u8, displacement(velocity.x_milli)),
            (1_u8, displacement(velocity.y_milli)),
            (2_u8, displacement(velocity.z_milli)),
        ] {
            if delta == 0 {
                continue;
            }
            let mut candidate = position;
            match axis {
                0 => candidate.x_milli = candidate.x_milli.saturating_add(delta),
                1 => candidate.y_milli = candidate.y_milli.saturating_add(delta),
                _ => candidate.z_milli = candidate.z_milli.saturating_add(delta),
            }
            if self.drop_position_collides_v1(candidate)? {
                match axis {
                    0 => {
                        velocity.x_milli = -(velocity.x_milli * 28 / 100);
                        horizontal_collision = true;
                    }
                    1 => {
                        velocity.y_milli = if velocity.y_milli < 0 {
                            -(velocity.y_milli * 28 / 100)
                        } else {
                            0
                        };
                        velocity.x_milli = velocity.x_milli * 72 / 100;
                        velocity.z_milli = velocity.z_milli * 72 / 100;
                    }
                    _ => {
                        velocity.z_milli = -(velocity.z_milli * 28 / 100);
                        horizontal_collision = true;
                    }
                }
            } else {
                position = candidate;
            }
        }
        if horizontal_collision {
            velocity.y_milli = velocity.y_milli * 90 / 100;
        }
        let mut rotation = drop.rotation;
        rotation.yaw = rotation
            .yaw
            .wrapping_add(INTEGRATED_RUNTIME_DROP_ROTATION_MICROTURNS_PER_STEP_V1)
            % 1_000_000;
        Ok((position, velocity, rotation))
    }

    fn drop_position_collides_v1(&self, position: FixedWorldVec3V1) -> Result<bool, IntegratedRuntimeError> {
        let coordinate = |milli: i64| -> Result<i32, IntegratedRuntimeError> {
            let rounded = milli.saturating_add(500).div_euclid(1_000);
            i32::try_from(rounded).map_err(|_| {
                IntegratedRuntimeError::new("drop-position", "dropped item left the supported R4 coordinate range")
            })
        };
        for (x_offset, y_offset, z_offset) in [
            (0_i64, -INTEGRATED_RUNTIME_DROP_RADIUS_MILLI_V1, 0_i64),
            (INTEGRATED_RUNTIME_DROP_RADIUS_MILLI_V1, 0, 0),
            (-INTEGRATED_RUNTIME_DROP_RADIUS_MILLI_V1, 0, 0),
            (0, 0, INTEGRATED_RUNTIME_DROP_RADIUS_MILLI_V1),
            (0, 0, -INTEGRATED_RUNTIME_DROP_RADIUS_MILLI_V1),
        ] {
            let cell_position = CellPositionV1 {
                x: coordinate(position.x_milli.saturating_add(x_offset))?,
                y: coordinate(position.y_milli.saturating_add(y_offset))?,
                z: coordinate(position.z_milli.saturating_add(z_offset))?,
            };
            let cell = match self.world.read_cell(cell_position) {
                WorldCellReadV1::Unloaded { .. } => return Ok(true),
                WorldCellReadV1::Loaded { cell, .. } => cell,
            };
            if cell.block_id == WORLD_AIR_BLOCK_ID_V1 {
                continue;
            }
            let solid = self.gameplay_content_runtime.block_action(cell.block_id).map_or_else(
                || {
                    cell.block_id != self.world.block_catalog().water_block_id
                        && cell.liquid.kind == WorldLiquidKindV1::None
                },
                |profile| profile.solid,
            );
            if solid {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn apply_drop_transform_batch_v1(
        &mut self,
        entity_commands: Vec<EntityCommand>,
        world_view_commands: Vec<WorldViewCommandV1>,
    ) -> Result<(), IntegratedRuntimeError> {
        if entity_commands.is_empty() {
            return Ok(());
        }
        let entity_sequence = self.entity_command_sequence.saturating_add(1).max(1);
        let entity_receipt = self
            .entities
            .apply_batch(&EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence: entity_sequence,
                expected_revision: self.entities.revision(),
                tick: self.tick,
                commands: entity_commands,
            })
            .map_err(|error| IntegratedRuntimeError::new("drop-motion-entity", error.to_string()))?;
        let batch_id = format!("drop-motion:{}:{}", self.tick, self.world_view.state.revision.sequence);
        let world_view_batch = WorldViewBatchV1::new(
            &batch_id,
            &batch_id,
            system_world_view_actor_v1(),
            self.world_view.state.identity(),
            world_view_commands,
        );
        match self.world_view.apply_batch(&world_view_batch, &self.gameplay.state) {
            WorldViewReceiptV1::Accepted(_) => {}
            WorldViewReceiptV1::Rejected { rejection, .. } => {
                return Err(IntegratedRuntimeError::new(
                    "drop-motion-world-view",
                    format!("{:?}: {}", rejection.code, rejection.message),
                ));
            }
        }
        self.entity_command_sequence = entity_sequence;
        self.sync_entity_schedules(std::slice::from_ref(&entity_receipt))?;
        Ok(())
    }

    fn freeze_expired_drop_v1(&mut self, drop: &DroppedItemSpatialV1) -> Result<(), IntegratedRuntimeError> {
        if drop.velocity_milli_per_second == FixedWorldVec3V1::default() {
            return Ok(());
        }
        self.apply_drop_transform_batch_v1(
            vec![EntityCommand::UpdateMotion {
                id: drop.entity_id,
                position: drop_position_to_entity_v1(drop.position),
                yaw: drop_yaw_to_radians_v1(drop.rotation.yaw),
                velocity: EntityVec3::ZERO,
            }],
            vec![WorldViewCommandV1::UpdateDropTransform {
                drop_id: drop.drop_id.clone(),
                expected_revision: drop.revision,
                position: drop.position,
                velocity_milli_per_second: FixedWorldVec3V1::default(),
                rotation: drop.rotation,
            }],
        )
    }

    fn pickup_drop_for_player_v1(
        &mut self,
        drop: &DroppedItemSpatialV1,
        binding: &PlayerInventoryBindingV1,
    ) -> Result<bool, IntegratedRuntimeError> {
        let custody = self
            .gameplay
            .state
            .inventory
            .containers
            .get(&drop.container)
            .ok_or_else(|| IntegratedRuntimeError::new("drop-pickup-custody", "drop custody disappeared"))?;
        if custody.revision != drop.bound_container_revision {
            return Err(IntegratedRuntimeError::new(
                "drop-pickup-custody",
                "drop custody revision changed before pickup",
            ));
        }
        let stack = custody
            .slots
            .get(usize::from(drop.slot))
            .and_then(Option::as_ref)
            .cloned()
            .ok_or_else(|| IntegratedRuntimeError::new("drop-pickup-custody", "drop custody became empty"))?;
        let transfers = self
            .gameplay
            .state
            .inventory
            .canonical_pickup_transfers_v1(
                &SlotRef {
                    container: drop.container.clone(),
                    slot: drop.slot,
                    expected_container_revision: Some(drop.bound_container_revision),
                },
                &binding.inventory_container,
            )
            .map_err(|error| {
                IntegratedRuntimeError::new(
                    "drop-pickup-destination",
                    format!("{:?}: {}", error.code, error.message),
                )
            })?;
        let Some(transfers) = transfers else {
            return Ok(false);
        };
        let destination_revision = self
            .gameplay
            .state
            .inventory
            .containers
            .get(&binding.inventory_container)
            .ok_or_else(|| IntegratedRuntimeError::new("drop-pickup-player", "player inventory disappeared"))?
            .revision;
        let batch_id = format!(
            "drop-pickup:{}:{}:{}",
            self.tick,
            drop.drop_id,
            binding.player_id.packed()
        );
        let mut inventory_commands = Vec::with_capacity(transfers.len().saturating_add(1));
        let mut remaining = stack.count;
        for (transfer_index, (destination_slot, count)) in transfers.iter().copied().enumerate() {
            let revision_offset = u64::try_from(transfer_index).map_err(|_| {
                IntegratedRuntimeError::new("drop-pickup-capacity", "pickup transfer count exceeds u64")
            })?;
            let source_revision = drop
                .bound_container_revision
                .checked_add(revision_offset)
                .ok_or_else(|| {
                    IntegratedRuntimeError::new("drop-pickup-revision", "drop custody revision would overflow")
                })?;
            let destination_revision = destination_revision.checked_add(revision_offset).ok_or_else(|| {
                IntegratedRuntimeError::new("drop-pickup-revision", "player inventory revision would overflow")
            })?;
            inventory_commands.push(GameplayCommand::Inventory(InventoryCommand::Transfer(
                TransferCommand {
                    from: SlotRef {
                        container: drop.container.clone(),
                        slot: drop.slot,
                        expected_container_revision: Some(source_revision),
                    },
                    to: SlotRef {
                        container: binding.inventory_container.clone(),
                        slot: destination_slot,
                        expected_container_revision: Some(destination_revision),
                    },
                    count,
                    expected: Some(ExpectedStack {
                        item_code: stack.item_code,
                        metadata_hash: stack.metadata_hash,
                        minimum_count: remaining,
                    }),
                },
            )));
            remaining = remaining.checked_sub(count).ok_or_else(|| {
                IntegratedRuntimeError::new("drop-pickup-plan", "pickup plan exceeds the custody stack")
            })?;
        }
        debug_assert_eq!(
            remaining, 0,
            "canonical pickup plan transfers the complete custody stack"
        );
        if remaining != 0 {
            return Err(IntegratedRuntimeError::new(
                "drop-pickup-plan",
                "pickup plan does not transfer the complete custody stack",
            ));
        }
        let transfer_count = u64::try_from(transfers.len())
            .map_err(|_| IntegratedRuntimeError::new("drop-pickup-capacity", "pickup transfer count exceeds u64"))?;
        let emptied_custody_revision = drop
            .bound_container_revision
            .checked_add(transfer_count)
            .ok_or_else(|| {
                IntegratedRuntimeError::new("drop-pickup-revision", "drop custody removal revision would overflow")
            })?;
        inventory_commands.push(GameplayCommand::Inventory(InventoryCommand::RemoveEmptyDropCustody(
            RemoveEmptyDropCustodyCommand {
                custody: drop.container.clone(),
                expected_revision: emptied_custody_revision,
            },
        )));
        let batch = GameplayBatch::new(
            &batch_id,
            &batch_id,
            system_gameplay_actor_v1(),
            self.gameplay.state.identity(),
            inventory_commands,
        );
        let mut staged_gameplay = self.gameplay.clone();
        match staged_gameplay.apply_batch(&batch) {
            GameplayReceipt::Accepted(_) => {}
            GameplayReceipt::Rejected { rejection, .. }
                if matches!(
                    rejection.code,
                    RejectionCode::Capacity | RejectionCode::RulesRejected | RejectionCode::InsufficientResource
                ) =>
            {
                return Ok(false);
            }
            GameplayReceipt::Rejected { rejection, .. } => {
                return Err(IntegratedRuntimeError::new(
                    "drop-pickup-gameplay",
                    format!("{:?}: {}", rejection.code, rejection.message),
                ));
            }
        }
        let entity_sequence = self.entity_command_sequence.saturating_add(1).max(1);
        let mut staged_entities = self.entities.clone();
        let entity_receipt = staged_entities
            .apply_batch(&EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence: entity_sequence,
                expected_revision: staged_entities.revision(),
                tick: self.tick,
                commands: vec![EntityCommand::Despawn {
                    id: drop.entity_id,
                    // R6's frozen despawn ABI has no pickup variant. `Admin`
                    // is its generic authority-directed removal reason; R7's
                    // canonical lifecycle reason remains `PickedUp` below.
                    reason: DespawnReason::Admin,
                }],
            })
            .map_err(|error| IntegratedRuntimeError::new("drop-pickup-despawn", error.to_string()))?;
        let world_view_batch = WorldViewBatchV1::new(
            format!("{batch_id}:world-view"),
            format!("{batch_id}:world-view"),
            system_world_view_actor_v1(),
            self.world_view.state.identity(),
            vec![WorldViewCommandV1::RemoveDrop {
                drop_id: drop.drop_id.clone(),
                expected_revision: drop.revision,
                reason: DropRemovalReasonV1::PickedUp,
            }],
        );
        let staged_world_view = stage_world_view_batches_v1(
            &self.world_view,
            &staged_gameplay.state,
            &staged_entities,
            &[world_view_batch],
        )
        .map_err(|error| IntegratedRuntimeError::new("drop-pickup-world-view", error.to_string()))?;
        validate_world_view_runtime_links_v1(
            &staged_world_view.authority.state,
            &staged_gameplay.state,
            &staged_entities,
        )
        .map_err(|error| IntegratedRuntimeError::new("drop-pickup-links", error.to_string()))?;
        self.gameplay = staged_gameplay;
        self.world_view = staged_world_view.authority;
        self.entities = staged_entities;
        self.entity_command_sequence = entity_sequence;
        self.sync_entity_schedules(std::slice::from_ref(&entity_receipt))?;
        Ok(true)
    }

    fn push_effect_event(&mut self, entity_external_id: &str, kind: PhysicsEventKindV1, amount: f64) {
        let kind = match kind {
            PhysicsEventKindV1::Jump => IntegratedRuntimeEffectKindV2::Jump,
            PhysicsEventKindV1::Land => IntegratedRuntimeEffectKindV2::Land,
            PhysicsEventKindV1::FallDamage => IntegratedRuntimeEffectKindV2::FallDamage,
            PhysicsEventKindV1::DrownDamage => IntegratedRuntimeEffectKindV2::DrownDamage,
            PhysicsEventKindV1::LiquidEnter => IntegratedRuntimeEffectKindV2::LiquidEnter,
            PhysicsEventKindV1::LiquidExit => IntegratedRuntimeEffectKindV2::LiquidExit,
            PhysicsEventKindV1::ShoreExit => IntegratedRuntimeEffectKindV2::ShoreExit,
        };
        self.effect_events.push_back(IntegratedRuntimeEffectEventV2 {
            sequence: self.next_effect_sequence,
            tick: self.tick,
            entity_external_id: entity_external_id.to_owned(),
            kind,
            amount,
        });
        self.next_effect_sequence = self.next_effect_sequence.saturating_add(1);
        while self.effect_events.len() > INTEGRATED_RUNTIME_MAX_EFFECT_EVENTS {
            self.effect_events.pop_front();
        }
    }

    pub fn accept_inputs(&mut self, inputs: &[RuntimeInputFrameV1]) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        if inputs.len() > MAX_INPUT_FRAMES || self.queued_inputs.len().saturating_add(inputs.len()) > MAX_INPUT_FRAMES {
            return Err(IntegratedRuntimeError::new(
                "input-capacity",
                "fixed-step input queue exceeds its bounded capacity",
            ));
        }
        let mut previous = self
            .queued_inputs
            .back()
            .map(|input| input.sequence)
            .or(self.last_input_sequence);
        for input in inputs {
            if input.sequence == 0 || previous.is_some_and(|sequence| input.sequence <= sequence) {
                return Err(IntegratedRuntimeError::new(
                    "input-sequence",
                    "fixed-step input sequences must be nonzero and strictly increasing",
                ));
            }
            if input.target_tick < self.tick
                || input.target_tick > self.tick.saturating_add(INTEGRATED_RUNTIME_MAX_INPUT_LEAD_TICKS)
            {
                return Err(IntegratedRuntimeError::new(
                    "input-target",
                    "fixed-step input target is stale or exceeds the bounded prediction horizon",
                ));
            }
            if input.selected_slot > 8 {
                return Err(IntegratedRuntimeError::new(
                    "input-slot",
                    "fixed-step input selected slot must be in 0..=8",
                ));
            }
            if input.buttons & !RUNTIME_INPUT_BUTTON_MASK_V1 != 0 || input.flags & !RUNTIME_INPUT_FLAG_MASK_V1 != 0 {
                return Err(IntegratedRuntimeError::new(
                    "input-bits",
                    "fixed-step input contains an unregistered button or state flag",
                ));
            }
            // Flags are a browser observation, never an authority input.  In
            // particular, a single queued batch may contain the edge that
            // changes flight/mount state and later frames sampled after that
            // edge.  Requiring every sample to equal the state at queue time
            // would make that deterministic batch impossible to submit.  The
            // fixed-step simulation reads only `player.flags`, and receipts
            // return the resulting authoritative value.
            previous = Some(input.sequence);
        }
        self.queued_inputs.extend(inputs.iter().copied());
        if let Some(sequence) = previous {
            self.last_input_sequence = Some(sequence);
        }
        self.invalidate_state_hash();
        Ok(())
    }

    /// Accepts a bounded, exactly contiguous schema-6 command tail. Sequence
    /// ownership transfers at enqueue time; a later semantic rejection still
    /// consumes that sequence, while a new duplicate submission fails before
    /// mutating any authority state.
    pub fn accept_context_commands_v2(
        &mut self,
        commands: &[RuntimeContextCommandV2],
    ) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        if commands.len() > MAX_CONTEXT_COMMANDS_V2
            || self.queued_context_commands.len().saturating_add(commands.len()) > MAX_CONTEXT_COMMANDS_V2
        {
            return Err(IntegratedRuntimeError::new(
                "context-command-capacity",
                "semantic context command queue exceeds its bounded capacity",
            ));
        }
        let mut next_sequence = self.next_context_command_sequence;
        let mut previous_target = self.queued_context_commands.back().map(|command| command.target_tick);
        for command in commands {
            let expected_sequence = next_sequence.ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "context-command-sequence-exhausted",
                    "semantic context command sequence is exhausted",
                )
            })?;
            if command.sequence != expected_sequence {
                return Err(IntegratedRuntimeError::new(
                    "context-command-sequence",
                    "semantic context command sequence is not the exact next authoritative cursor",
                ));
            }
            let expected_hash = context_command_hash_v2(command)
                .map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
            if command.command_hash != expected_hash {
                return Err(IntegratedRuntimeError::new(
                    "context-command-hash",
                    "semantic context command hash does not match its canonical bytes",
                ));
            }
            if command.target_tick <= self.tick
                || command.target_tick
                    > self
                        .tick
                        .saturating_add(INTEGRATED_RUNTIME_MAX_CONTEXT_COMMAND_LEAD_TICKS_V2)
            {
                return Err(IntegratedRuntimeError::new(
                    "context-command-target",
                    "semantic context command target is stale or exceeds the bounded prediction horizon",
                ));
            }
            if previous_target.is_some_and(|target| target > command.target_tick) {
                return Err(IntegratedRuntimeError::new(
                    "context-command-order",
                    "semantic context commands must be ordered by target tick and sequence",
                ));
            }
            next_sequence = command.sequence.checked_add(1).filter(|value| *value <= MAX_SAFE_U64);
            previous_target = Some(command.target_tick);
        }
        if commands.is_empty() {
            return Ok(());
        }
        self.queued_context_commands.extend(commands.iter().cloned());
        self.next_context_command_sequence = next_sequence;
        self.invalidate_state_hash();
        Ok(())
    }

    #[must_use]
    pub const fn next_context_command_sequence_v2(&self) -> Option<u64> {
        self.next_context_command_sequence
    }

    #[must_use]
    pub fn queued_context_commands_empty_v2(&self) -> bool {
        self.queued_context_commands.is_empty()
    }

    fn dispatch_due_context_commands_v2(&mut self) -> Vec<RuntimeSemanticActionReceiptV2> {
        let mut receipts = Vec::new();
        while self
            .queued_context_commands
            .front()
            .is_some_and(|command| command.target_tick <= self.tick)
        {
            let command = self
                .queued_context_commands
                .pop_front()
                .expect("due context command exists");
            // No cast, reload, or mounted-ability executor is currently bound
            // to exact R7/R6 authority. These values therefore echo only the
            // request-attested revisions and never claim a resolved target.
            let resolution = match command.action {
                RuntimeContextCommandActionV2::Cast {
                    loadout_revision,
                    learned_revision,
                    ..
                } => RuntimeSemanticActionResolutionV2::Cast {
                    loadout_revision,
                    learned_revision,
                },
                RuntimeContextCommandActionV2::Reload { container_revision, .. } => {
                    RuntimeSemanticActionResolutionV2::Reload { container_revision }
                }
                RuntimeContextCommandActionV2::MountedAbility {
                    mount_entity_revision, ..
                } => RuntimeSemanticActionResolutionV2::MountedAbility { mount_entity_revision },
            };
            receipts.push(RuntimeSemanticActionReceiptV2 {
                command_sequence: command.sequence,
                target_tick: command.target_tick,
                applied_tick: self.tick,
                command_hash: command.command_hash,
                outcome: RuntimeSemanticActionOutcomeV2::Rejected,
                reason: RuntimeSemanticActionReasonV2::Blocked,
                resolved_entity: None,
                resolved_block: None,
                session: None,
                effect: None,
                resolution,
                receipt_hash: WireHash::default(),
            });
        }
        if !receipts.is_empty() {
            self.invalidate_state_hash();
        }
        receipts
    }

    #[must_use]
    pub const fn last_applied_input(&self) -> Option<RuntimeInputFrameV1> {
        self.last_applied_input
    }

    pub fn process_network_browser_packet(&mut self, packet: &[u8]) -> Result<Vec<u8>, IntegratedRuntimeError> {
        self.ensure_running()?;
        let response = self
            .network
            .process(packet)
            .map_err(|error| IntegratedRuntimeError::domain("network", error))?;
        self.durable_network_state_pristine = false;
        self.network_revision = self.network_revision.saturating_add(1);
        self.invalidate_state_hash();
        Ok(response)
    }

    pub fn grant_gameplay_actor(
        &mut self,
        actor_id: impl Into<String>,
        grant: blockwild_gameplay::ActorGrant,
    ) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        self.gameplay
            .grant_actor(actor_id, grant)
            .map_err(|error| IntegratedRuntimeError::new("gameplay-grant", error.message))?;
        self.gameplay_authority_revision = self.gameplay_authority_revision.saturating_add(1);
        self.invalidate_state_hash();
        Ok(())
    }

    pub fn upsert_network_peer_grant(&mut self, grant: NetworkPeerGrantV1) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        grant
            .validate()
            .map_err(|error| IntegratedRuntimeError::domain("network-grant", error))?;
        self.network
            .upsert_peer_grant(grant)
            .map_err(|error| IntegratedRuntimeError::domain("network-grant", error))?;
        self.durable_network_state_pristine = false;
        self.network_revision = self.network_revision.saturating_add(1);
        self.invalidate_state_hash();
        Ok(())
    }

    pub fn upsert_network_agent_grant(&mut self, grant: AgentCapabilityGrantV1) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        grant
            .validate()
            .map_err(|error| IntegratedRuntimeError::domain("agent-grant", error))?;
        self.network
            .upsert_agent_grant(grant)
            .map_err(|error| IntegratedRuntimeError::domain("agent-grant", error))?;
        self.durable_network_state_pristine = false;
        self.network_revision = self.network_revision.saturating_add(1);
        self.invalidate_state_hash();
        Ok(())
    }

    pub fn upsert_network_replication_record(
        &mut self,
        value: ScopedDeltaRecordV1,
    ) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        let key = value.record.key();
        let hash = value.record.payload_hash;
        self.replication
            .upsert(value)
            .map_err(|error| IntegratedRuntimeError::domain("network-replication", error))?;
        self.replication_record_hashes.insert(key, hash);
        self.durable_network_state_pristine = false;
        self.network_revision = self.network_revision.saturating_add(1);
        self.invalidate_state_hash();
        Ok(())
    }

    pub fn remove_network_replication_record(&mut self, value: &NetworkDeltaRecordV1) -> bool {
        let key = value.key();
        let removed = self.replication.remove(value);
        if removed {
            self.replication_record_hashes.remove(&key);
            self.durable_network_state_pristine = false;
            self.network_revision = self.network_revision.saturating_add(1);
            self.invalidate_state_hash();
        }
        removed
    }

    pub fn build_network_delta(
        &self,
        source: InterestDeltaBuildSourceV1,
        interest: &NetworkInterestSetV1,
    ) -> Result<(NetworkDeltaV1, InterestSelectionStatsV1), IntegratedRuntimeError> {
        self.replication
            .build_delta(source, interest)
            .map_err(|error| IntegratedRuntimeError::domain("network-delta", error))
    }

    pub fn network_reconnect_checkpoint(
        &self,
        session_id: &str,
        peer_id: &str,
        connection_generation: u64,
    ) -> Result<Option<NetworkReconnectCheckpointV1>, IntegratedRuntimeError> {
        self.network
            .reconnect_checkpoint(session_id, peer_id, connection_generation)
            .map_err(|error| IntegratedRuntimeError::domain("network-reconnect", error))
    }

    pub fn release_network_peer(&mut self, peer_id: &str) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        self.network.release_peer(peer_id);
        self.durable_network_state_pristine = false;
        self.network_revision = self.network_revision.saturating_add(1);
        self.invalidate_state_hash();
        Ok(())
    }

    pub fn release_network_command(&mut self, command_id: &str) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        self.network.release_command(command_id);
        self.durable_network_state_pristine = false;
        self.network_revision = self.network_revision.saturating_add(1);
        self.invalidate_state_hash();
        Ok(())
    }

    pub fn capture_simulation_window(
        &self,
        origin: ReadOriginV1,
        size: ReadSizeV1,
    ) -> Result<WorldReadWindowV1, IntegratedRuntimeError> {
        let page = WorldReadPageV1::capture(&self.world, origin, size)
            .map_err(|error| IntegratedRuntimeError::domain("world-read", error))?;
        page_to_simulation_window(&page)
    }

    pub fn generate_and_install_chunk(
        &mut self,
        request: &GenerateChunkRequestV2,
    ) -> Result<GeneratedChunkInstallSummaryV2, IntegratedRuntimeError> {
        self.ensure_running()?;
        let previous_world_revision = self.world.revision();
        let (chunk, cache_hit) = self.generate_chunk(request)?;
        let mut summary = self.install_generated_chunk(request, chunk, cache_hit)?;
        if self.world.revision() != previous_world_revision {
            self.mining_state = None;
            self.invalidate_state_hash();
            summary.state_hash = self.state_hash();
        }
        Ok(summary)
    }

    /// Ensures a bounded explicit chunk set is resident through one atomic
    /// Rust-owned control operation. All generation results are validated
    /// before the cloned authority candidate receives its first install.
    pub fn ensure_terrain_residency(
        &mut self,
        request: &IntegratedTerrainResidencyBatchV1,
    ) -> Result<IntegratedTerrainResidencyReceiptV1, IntegratedRuntimeError> {
        let prepared = self.prepare_terrain_residency(request)?;
        let mut candidate = self.clone();
        let applied = candidate.apply_prepared_terrain_residency(prepared)?;
        if applied.world_revision != applied.previous_world_revision {
            candidate.mining_state = None;
            candidate.invalidate_state_hash();
        }
        let state_hash = candidate.state_hash();
        *self = candidate;
        Ok(IntegratedTerrainResidencyReceiptV1 {
            previous_world_revision: applied.previous_world_revision,
            world_revision: applied.world_revision,
            requested_chunks: applied.chunks.len() as u32,
            generated_chunks: applied.generated_chunks,
            already_resident_chunks: applied.already_resident_chunks,
            requested_resident_chunks: applied.chunks.len() as u32,
            resident_sections: applied.resident_sections,
            chunks: applied.chunks,
            state_hash,
        })
    }

    fn prepare_terrain_residency(
        &self,
        request: &IntegratedTerrainResidencyBatchV1,
    ) -> Result<PreparedTerrainResidencyV1, IntegratedRuntimeError> {
        self.ensure_running()?;
        validate_terrain_residency_batch_v1(request)?;
        let previous_world_revision = self.world.revision();
        if request.expected_world_revision != previous_world_revision {
            return Err(IntegratedRuntimeError::new(
                "terrain-residency-stale",
                "terrain residency batch expected an obsolete world authority revision",
            ));
        }
        if request.generation_options_json != self.config.generation_options_json {
            return Err(IntegratedRuntimeError::new(
                "terrain-generation-options",
                "terrain residency batch does not match the immutable runtime generation options",
            ));
        }

        let edit_save = self.world.export_compatibility_save();
        let edits_by_chunk = edit_save
            .edits
            .into_iter()
            .map(|chunk| ((chunk.chunk_x, chunk.chunk_z), chunk.entries))
            .collect::<BTreeMap<_, _>>();
        let generation_epoch = terrain_generation_epoch_v1(&self.config);
        let mut prepared_requests = Vec::with_capacity(request.chunks.len());
        for coordinate in &request.chunks {
            // Namespace construction reads a one-chunk edit halo. Rejecting
            // coordinate overflow before any generation keeps every invalid
            // batch free of cache and diagnostics side effects as well.
            validate_terrain_halo_coordinate_v1(*coordinate)?;
            let edits = edits_by_chunk
                .get(&(coordinate.chunk_x, coordinate.chunk_z))
                .cloned()
                .unwrap_or_default();
            let edit_hash = terrain_edit_hash_v1(*coordinate, &edits);
            let namespace = terrain_namespace_v1(
                &self.config.world_seed,
                &self.config.generation_options_json,
                *coordinate,
                &edits_by_chunk,
            )?;
            let namespace_hash = terrain_namespace_hash_v1(&namespace);
            let generation_revision = terrain_generation_revision_v1(edit_hash, namespace_hash);
            let task_id = terrain_generation_task_id_v1(&self.config, *coordinate, edit_hash, namespace_hash);
            let mut generation_request = GenerateChunkRequestV2 {
                protocol_version: GENERATION_PROTOCOL_VERSION_V2,
                schema_version: GENERATION_REQUEST_SCHEMA_VERSION_V2,
                epoch: generation_epoch,
                task_id,
                revision: generation_revision,
                namespace,
                content_hash: self.config.terrain_content_hash.to_hex(),
                generator_hash: self.config.generator_hash.to_hex(),
                seed_text: self.config.world_seed.clone(),
                generation_options_json: self.config.generation_options_json.clone(),
                key: format!("{},{}", coordinate.chunk_x, coordinate.chunk_z),
                cx: coordinate.chunk_x,
                cz: coordinate.chunk_z,
                edits,
                request_hash: String::new(),
            };
            generation_request.request_hash = generation_request.canonical_hash().to_hex();
            self.validate_generation_request(&generation_request)?;
            prepared_requests.push((*coordinate, generation_request, edit_hash, namespace_hash));
        }

        let mut chunks = Vec::with_capacity(prepared_requests.len());
        for (coordinate, generation_request, edit_hash, namespace_hash) in prepared_requests {
            let (chunk, cache_hit) = self.generate_chunk(&generation_request)?;
            let already_resident = terrain_chunk_is_exactly_resident_v1(&self.world, &chunk);
            chunks.push(PreparedTerrainResidencyChunkV1 {
                coordinate,
                generation_request,
                chunk,
                cache_hit,
                already_resident,
                edit_hash,
                namespace_hash,
            });
        }
        Ok(PreparedTerrainResidencyV1 {
            previous_world_revision,
            chunks,
        })
    }

    fn apply_prepared_terrain_residency(
        &mut self,
        prepared: PreparedTerrainResidencyV1,
    ) -> Result<AppliedTerrainResidencyV1, IntegratedRuntimeError> {
        let mut chunks = Vec::with_capacity(prepared.chunks.len());
        let mut generated_chunks = 0_u32;
        let mut already_resident_chunks = 0_u32;
        for prepared_chunk in prepared.chunks {
            let PreparedTerrainResidencyChunkV1 {
                coordinate,
                generation_request,
                chunk,
                cache_hit,
                already_resident,
                edit_hash,
                namespace_hash,
            } = prepared_chunk;
            let source_hash = parse_canonical_hash(&chunk.chunk_hash)?;
            let request_hash = parse_canonical_hash(&generation_request.request_hash)?;
            let status = if already_resident {
                already_resident_chunks = already_resident_chunks.saturating_add(1);
                IntegratedTerrainResidencyStatusV1::AlreadyResident
            } else {
                self.install_generated_chunk(&generation_request, chunk, cache_hit)?;
                generated_chunks = generated_chunks.saturating_add(1);
                IntegratedTerrainResidencyStatusV1::Generated
            };
            chunks.push(IntegratedTerrainResidencyChunkReceiptV1 {
                coordinate,
                status,
                resident_sections: 12,
                edit_count: generation_request.edits.len() as u32,
                generation_revision: generation_request.revision,
                request_hash,
                source_hash,
                edit_hash,
                namespace_hash,
                cache_hit,
            });
        }
        let world_revision = self.world.revision();
        let resident_sections = u32::try_from(self.world.resident_section_count()).map_err(|_| {
            IntegratedRuntimeError::new(
                "terrain-residency-count",
                "resident section count exceeds the diagnostics wire range",
            )
        })?;
        Ok(AppliedTerrainResidencyV1 {
            previous_world_revision: prepared.previous_world_revision,
            world_revision,
            generated_chunks,
            already_resident_chunks,
            resident_sections,
            chunks,
        })
    }

    /// Atomically reconciles the complete active terrain residency set. The
    /// public native entry point owns exactly one transaction candidate; Wasm
    /// dispatch uses `reconcile_terrain_residency_on_transaction_candidate`
    /// because its command batch already owns that candidate.
    pub fn reconcile_terrain_residency(
        &mut self,
        request: &IntegratedTerrainResidencyReconcileBatchV2,
    ) -> Result<IntegratedTerrainResidencyReconcileReceiptV2, IntegratedRuntimeError> {
        let prepared = self.prepare_terrain_residency_reconcile(request)?;
        let mut candidate = self.clone();
        let receipt = candidate.apply_prepared_terrain_residency_reconcile(request, prepared)?;
        *self = candidate;
        Ok(receipt)
    }

    /// Applies reconcile to a caller-owned transaction candidate without an
    /// additional full-runtime clone. The caller must discard `self` on error;
    /// integrated Wasm command dispatch provides exactly that boundary.
    pub fn reconcile_terrain_residency_on_transaction_candidate(
        &mut self,
        request: &IntegratedTerrainResidencyReconcileBatchV2,
    ) -> Result<IntegratedTerrainResidencyReconcileReceiptV2, IntegratedRuntimeError> {
        let prepared = self.prepare_terrain_residency_reconcile(request)?;
        self.apply_prepared_terrain_residency_reconcile(request, prepared)
    }

    fn prepare_terrain_residency_reconcile(
        &self,
        request: &IntegratedTerrainResidencyReconcileBatchV2,
    ) -> Result<PreparedTerrainResidencyReconcileV2, IntegratedRuntimeError> {
        self.ensure_running()?;
        validate_terrain_residency_reconcile_batch_v2(request)?;
        let previous_world_revision = self.world.revision();
        if request.expected_world_revision != previous_world_revision {
            return Err(IntegratedRuntimeError::new(
                "terrain-residency-reconcile-stale",
                "terrain residency reconcile expected an obsolete world authority revision",
            ));
        }
        if request.generation_options_json != self.config.generation_options_json {
            return Err(IntegratedRuntimeError::new(
                "terrain-generation-options",
                "terrain residency reconcile does not match the immutable runtime generation options",
            ));
        }

        let desired_set = request
            .desired_chunks
            .iter()
            .map(|coordinate| (coordinate.chunk_x, coordinate.chunk_z))
            .collect::<BTreeSet<_>>();
        let maximum_state_chunks = INTEGRATED_RUNTIME_MAX_TERRAIN_RECONCILE_EVICTED_CHUNKS_V2
            .checked_add(desired_set.len())
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "terrain-residency-reconcile-count",
                    "terrain residency reconcile state bound overflowed",
                )
            })?;
        let state_chunks = self
            .world
            .disposable_residency_chunk_coordinates_bounded(maximum_state_chunks)
            .ok_or_else(|| {
                IntegratedRuntimeError::new(
                    "terrain-residency-reconcile-count",
                    "terrain residency reconcile exceeds its bounded legacy-eviction recovery limit",
                )
            })?;
        let evicted_chunks = state_chunks
            .into_iter()
            .filter(|coordinate| !desired_set.contains(coordinate))
            .map(|(chunk_x, chunk_z)| IntegratedTerrainChunkCoordinateV1 { chunk_x, chunk_z })
            .collect::<Vec<_>>();
        if evicted_chunks.len() > INTEGRATED_RUNTIME_MAX_TERRAIN_RECONCILE_EVICTED_CHUNKS_V2 {
            return Err(IntegratedRuntimeError::new(
                "terrain-residency-reconcile-count",
                "terrain residency reconcile exceeds its bounded legacy-eviction recovery limit",
            ));
        }
        Ok(PreparedTerrainResidencyReconcileV2 {
            previous_world_revision,
            desired_set,
            evicted_chunks,
        })
    }

    fn apply_prepared_terrain_residency_reconcile(
        &mut self,
        request: &IntegratedTerrainResidencyReconcileBatchV2,
        prepared_reconcile: PreparedTerrainResidencyReconcileV2,
    ) -> Result<IntegratedTerrainResidencyReconcileReceiptV2, IntegratedRuntimeError> {
        let prepared_residency = self.prepare_terrain_residency(&IntegratedTerrainResidencyBatchV1 {
            expected_world_revision: prepared_reconcile.previous_world_revision,
            generation_options_json: request.generation_options_json.clone(),
            chunks: request.desired_chunks.clone(),
        })?;
        let ensured = self.apply_prepared_terrain_residency(prepared_residency)?;
        let mut generated_chunks = Vec::new();
        let mut retained_chunks = Vec::new();
        for chunk in ensured.chunks {
            match chunk.status {
                IntegratedTerrainResidencyStatusV1::Generated => generated_chunks.push(chunk.coordinate),
                IntegratedTerrainResidencyStatusV1::AlreadyResident => retained_chunks.push(chunk.coordinate),
            }
        }
        let address = self.world.active_address().clone();
        for coordinate in &prepared_reconcile.evicted_chunks {
            let removed_sections = self.world.evict_chunk(&AuthorityChunkAddressV1 {
                world: address.clone(),
                chunk_x: coordinate.chunk_x,
                chunk_z: coordinate.chunk_z,
            });
            if removed_sections > 12 {
                return Err(IntegratedRuntimeError::new(
                    "terrain-residency-reconcile-eviction",
                    "terrain residency reconcile observed an impossible section count",
                ));
            }
        }

        let final_chunks = self.world.resident_chunk_coordinates();
        let desired_coordinates = request
            .desired_chunks
            .iter()
            .map(|coordinate| (coordinate.chunk_x, coordinate.chunk_z))
            .collect::<Vec<_>>();
        let expected_sections = request.desired_chunks.len().checked_mul(12).ok_or_else(|| {
            IntegratedRuntimeError::new(
                "terrain-residency-reconcile-count",
                "terrain residency reconcile section count overflowed",
            )
        })?;
        let final_disposable_chunks = self
            .world
            .disposable_residency_chunk_coordinates_bounded(request.desired_chunks.len());
        if final_chunks != desired_coordinates
            || final_disposable_chunks.as_deref() != Some(desired_coordinates.as_slice())
            || self.world.resident_section_count() != expected_sections
            || !self.world.scheduler_jobs_within_chunks(&prepared_reconcile.desired_set)
        {
            return Err(IntegratedRuntimeError::new(
                "terrain-residency-reconcile-incomplete",
                "terrain residency reconcile did not produce the exact desired resident and scheduler set",
            ));
        }

        self.invalidate_state_hash();
        let world_revision = self.world.revision();
        if world_revision != prepared_reconcile.previous_world_revision {
            self.mining_state = None;
            self.invalidate_state_hash();
        }
        let resident_sections = u32::try_from(self.world.resident_section_count()).map_err(|_| {
            IntegratedRuntimeError::new(
                "terrain-residency-reconcile-count",
                "resident section count exceeds the diagnostics wire range",
            )
        })?;
        let state_hash = self.state_hash();
        Ok(IntegratedTerrainResidencyReconcileReceiptV2 {
            previous_world_revision: prepared_reconcile.previous_world_revision,
            world_revision,
            desired_chunk_count: request.desired_chunks.len() as u32,
            generated_chunk_count: generated_chunks.len() as u32,
            retained_chunk_count: retained_chunks.len() as u32,
            evicted_chunk_count: prepared_reconcile.evicted_chunks.len() as u32,
            resident_sections,
            desired_chunks: request.desired_chunks.clone(),
            generated_chunks,
            retained_chunks,
            evicted_chunks: prepared_reconcile.evicted_chunks,
            state_hash,
        })
    }

    fn generate_chunk(
        &self,
        request: &GenerateChunkRequestV2,
    ) -> Result<(ChunkPayloadV2, bool), IntegratedRuntimeError> {
        self.validate_generation_request(request)?;
        let cancellation = blockwild_generation::CancellationToken::default();
        let outcome = self
            .generation
            .generate(request, &cancellation, || request.epoch, || Some(request.revision))
            .map_err(|error| IntegratedRuntimeError::domain("generation", error))?;
        let GenerationOutcome::Ready { chunk, cache_hit } = outcome else {
            return Err(IntegratedRuntimeError::new(
                "stale-generation",
                "generation result became stale before authority installation",
            ));
        };
        chunk
            .validate(request)
            .map_err(|error| IntegratedRuntimeError::domain("generation-result", error))?;
        Ok((*chunk, cache_hit))
    }

    fn validate_generation_request(&self, request: &GenerateChunkRequestV2) -> Result<(), IntegratedRuntimeError> {
        request
            .validate()
            .map_err(|error| IntegratedRuntimeError::domain("generation", error))?;
        if request.seed_text != self.config.world_seed
            || request.content_hash != self.config.terrain_content_hash.to_hex()
            || request.generator_hash != self.config.generator_hash.to_hex()
            || request.generation_options_json != self.config.generation_options_json
        {
            return Err(IntegratedRuntimeError::new(
                "generation-identity",
                "generation request does not match the integrated runtime terrain identity",
            ));
        }
        Ok(())
    }

    fn install_generated_chunk(
        &mut self,
        request: &GenerateChunkRequestV2,
        chunk: ChunkPayloadV2,
        cache_hit: bool,
    ) -> Result<GeneratedChunkInstallSummaryV2, IntegratedRuntimeError> {
        chunk
            .validate(request)
            .map_err(|error| IntegratedRuntimeError::domain("generation-result", error))?;
        let address = self.world.active_address().clone();
        let mut installs = Vec::with_capacity(12);
        for section_y in 0_i16..12_i16 {
            let offset = section_y as usize * WORLD_SECTION_CELL_COUNT_V1;
            let cells = chunk.blocks[offset..offset + WORLD_SECTION_CELL_COUNT_V1]
                .iter()
                .map(|block_id| generated_cell(*block_id))
                .collect();
            let install = SectionInstallV1 {
                address: WorldSectionAddressV1 {
                    world: address.clone(),
                    chunk_x: chunk.cx,
                    chunk_z: chunk.cz,
                    section_y,
                },
                cells,
                source_revision: u64::from(chunk.revision),
                source_hash: chunk.chunk_hash.clone(),
            };
            install
                .validate()
                .map_err(|error| IntegratedRuntimeError::domain("world-install", error))?;
            installs.push(install);
        }
        let markers = chunk
            .markers
            .iter()
            .map(|marker| (marker.key.clone(), marker.canonical_json.clone()))
            .collect::<Vec<_>>();
        let marker_count = markers.len() as u32;
        let auxiliary = ChunkAuxiliaryDataV1 {
            address: AuthorityChunkAddressV1 {
                world: address,
                chunk_x: chunk.cx,
                chunk_z: chunk.cz,
            },
            source_revision: u64::from(chunk.revision),
            source_hash: chunk.chunk_hash,
            heightmap: chunk.heightmap,
            biomes: chunk.biomes,
            section_block_counts: chunk.section_block_counts,
            sky_tops: chunk.sky_tops,
            light: chunk.light,
            light_indices: chunk.light_indices,
            leaf_indices: chunk.leaf_indices,
            markers,
        };
        auxiliary
            .validate()
            .map_err(|error| IntegratedRuntimeError::domain("world-install", error))?;

        // Every fallible content/address validation completed before the first
        // authoritative write. These installs cannot fail without an internal
        // contract regression, so a whole-world clone is unnecessary.
        for install in installs {
            self.world
                .install_section_for_residency_replay(install)
                .expect("prevalidated generated section install");
        }
        self.world
            .install_chunk_auxiliary(auxiliary)
            .expect("prevalidated generated chunk metadata install");
        self.invalidate_state_hash();
        Ok(GeneratedChunkInstallSummaryV2 {
            chunk_x: request.cx,
            chunk_z: request.cz,
            sections_installed: 12,
            markers_installed: marker_count,
            cache_hit,
            state_hash: self.state_hash(),
        })
    }

    pub fn run_physics(&self, input: &PhysicsStepInputV1) -> Result<PhysicsStepResultV1, IntegratedRuntimeError> {
        self.ensure_current_simulation_identity(&input.identity.world)?;
        step_physics(input).map_err(|error| IntegratedRuntimeError::domain("physics", error))
    }

    pub fn run_liquids(&self, input: &LiquidFrontierStepV1) -> Result<LiquidFrontierResultV1, IntegratedRuntimeError> {
        self.ensure_current_simulation_identity(&input.identity.world)?;
        step_liquid_frontier(input).map_err(|error| IntegratedRuntimeError::domain("liquids", error))
    }

    pub fn run_path(&self, input: &PathJobV1) -> Result<PathJobResultV1, IntegratedRuntimeError> {
        self.ensure_current_simulation_identity(&input.identity.world)?;
        find_path(input).map_err(|error| IntegratedRuntimeError::domain("path", error))
    }

    pub fn run_air_zones(
        &self,
        input: &AirZoneTopologyJobV1,
    ) -> Result<AirZoneTopologyResultV1, IntegratedRuntimeError> {
        self.ensure_current_simulation_identity(&input.identity.world)?;
        solve_air_zones(input).map_err(|error| IntegratedRuntimeError::domain("air", error))
    }

    fn ensure_current_simulation_identity(&self, identity: &WorldIdentityV1) -> Result<(), IntegratedRuntimeError> {
        let current = self.simulation_identity()?;
        if identity != &current {
            return Err(IntegratedRuntimeError::new(
                "stale-simulation",
                "simulation job references an obsolete world snapshot",
            ));
        }
        Ok(())
    }

    pub fn simulation_identity(&self) -> Result<WorldIdentityV1, IntegratedRuntimeError> {
        let identity = self.world.identity();
        Ok(WorldIdentityV1 {
            address: SimulationWorldAddressV1 {
                universe_id: identity.address.universe_id,
                location_id: identity.address.location_id,
            },
            revision: WorldRevisionV1 {
                epoch: identity.revision.epoch,
                mutation: identity.revision.mutation,
                residency: identity.revision.residency,
            },
            state_hash: parse_canonical_hash(&identity.state_hash)?,
        })
    }

    pub fn network_identity(&self) -> Result<NetworkAuthorityIdentityV1, IntegratedRuntimeError> {
        let revision = self.revision();
        NetworkAuthorityIdentityV1::new(
            NetworkWorldAddressV1 {
                universe_id: self.config.universe_id.clone(),
                location_id: self.config.location_id.clone(),
            },
            NetworkAuthorityRevisionV1 {
                epoch: revision.epoch,
                world: revision.world,
                entities: revision.entities,
                gameplay: revision.gameplay,
                persistence: revision.persistence,
            },
        )
        .map_err(|error| IntegratedRuntimeError::domain("network-identity", error))
    }

    pub fn shutdown(&mut self) {
        self.persistence_dispatcher.close();
        self.save_stages.clear();
        self.prepared_persistence_commits.clear();
        self.recovery_assemblers.clear();
        self.recovered_save_sets.clear();
        self.hydrated_exports.clear();
        self.content_stage = None;
        self.queued.clear();
        self.receipts.clear();
        self.idempotency.clear();
        self.idempotency_order.clear();
        self.command_receipts.clear();
        self.command_receipt_order.clear();
        self.command_receipt_bytes = 0;
        self.queued_inputs.clear();
        self.entity_scheduler = EntityScheduler::default();
        self.entity_ecology_jobs = EcologyJobQueue::default();
        self.entity_ecology_revisions.clear();
        self.entity_sectors.clear();
        self.entity_sector_counts.clear();
        self.entity_path_jobs = PathJobQueue::default();
        self.stopped = true;
    }

    fn cache_idempotent_receipt(
        &mut self,
        batch: &IntegratedRuntimeBatchV2,
        key: Option<String>,
        receipt: &IntegratedRuntimeReceiptV2,
    ) {
        let (Some(key), Some(reliability)) = (key, batch.reliability.as_ref()) else {
            return;
        };
        self.idempotency.insert(
            key.clone(),
            IntegratedRuntimeIdempotencyEntryV2 {
                command_hash: reliability.command_hash,
                receipt: receipt.clone(),
            },
        );
        self.idempotency_order.push_back(key);
        while self.idempotency_order.len() > INTEGRATED_RUNTIME_MAX_IDEMPOTENCY_RECEIPTS {
            if let Some(expired) = self.idempotency_order.pop_front() {
                self.idempotency.remove(&expired);
            }
        }
    }

    fn ensure_running(&self) -> Result<(), IntegratedRuntimeError> {
        if self.stopped {
            Err(IntegratedRuntimeError::new(
                "engine-stopped",
                "integrated runtime is stopped",
            ))
        } else {
            Ok(())
        }
    }

    fn invalidate_state_hash(&self) {
        self.state_hash_cache.set(None);
    }
}

fn entity_snapshot_last_sequence(snapshot: &[u8]) -> Result<Option<u64>, IntegratedRuntimeError> {
    const LAST_SEQUENCE_FLAG_OFFSET: usize = 4 + 2 + 8;
    let flag = *snapshot.get(LAST_SEQUENCE_FLAG_OFFSET).ok_or_else(|| {
        IntegratedRuntimeError::new("entity-snapshot", "entity authority snapshot header is truncated")
    })?;
    match flag {
        0 => Ok(None),
        1 => {
            let start = LAST_SEQUENCE_FLAG_OFFSET + 1;
            let bytes = snapshot.get(start..start + 8).ok_or_else(|| {
                IntegratedRuntimeError::new("entity-snapshot", "entity authority snapshot sequence is truncated")
            })?;
            Ok(Some(u64::from_le_bytes(
                bytes.try_into().expect("checked entity sequence width"),
            )))
        }
        _ => Err(IntegratedRuntimeError::new(
            "entity-snapshot",
            "entity authority snapshot sequence option is invalid",
        )),
    }
}

fn entity_ecology_sector(position: EntityVec3) -> [i32; 2] {
    ecology_sector_key(position.x.floor() as i32, position.z.floor() as i32)
}

const fn entity_path_priority(tier: SimulationTier) -> i16 {
    match tier {
        SimulationTier::Hero => 300,
        SimulationTier::Nearby => 200,
        SimulationTier::Coarse => 100,
        SimulationTier::Dormant => 0,
    }
}

fn content_stage_receipt(stage: &IntegratedRuntimeContentStageV1) -> ContentInstallReceiptWireV1 {
    ContentInstallReceiptWireV1 {
        status: ContentInstallReceiptStatusV1::Staged,
        install_id: stage.install_id.clone(),
        source_revision: stage.source_revision.clone(),
        manifest_hash: stage.manifest_hash,
        domains: stage.domains.clone(),
        accepted_pages: stage.page_hashes.len() as u32,
        page_count: stage.page_count,
        accepted_entries: stage.artifacts.len() as u32,
        installed_entries: 0,
        installed_bytes: 0,
    }
}

fn content_install_receipt(
    installed: &IntegratedRuntimeContentAttestationV1,
    page_count: u32,
) -> ContentInstallReceiptWireV1 {
    ContentInstallReceiptWireV1 {
        status: ContentInstallReceiptStatusV1::Installed,
        install_id: installed.install_id.clone(),
        source_revision: installed.source_revision.clone(),
        manifest_hash: installed.manifest_hash,
        domains: installed.domains.clone(),
        accepted_pages: installed.page_hashes.len() as u32,
        page_count,
        accepted_entries: installed.installed_entries,
        installed_entries: installed.installed_entries,
        installed_bytes: installed.installed_bytes,
    }
}

fn content_blocker_error(blockers: &[blockwild_gameplay::ContentBlocker]) -> IntegratedRuntimeError {
    let message = blockers.first().map_or_else(
        || "content bundle failed validation without a structured blocker".to_owned(),
        |blocker| {
            format!(
                "content blocker {:?} domain={:?} id={:?} expected={:?} actual={:?}",
                blocker.code, blocker.domain, blocker.id, blocker.expected, blocker.actual
            )
        },
    );
    IntegratedRuntimeError::new("content-bundle-rejected", message)
}

fn content_runtime_blocker_error(blockers: &[blockwild_gameplay::ContentRuntimeBlocker]) -> IntegratedRuntimeError {
    let message = blockers.first().map_or_else(
        || "typed content materialization failed without a structured blocker".to_owned(),
        |blocker| {
            format!(
                "content runtime blocker {:?} stage={:?} domain={:?} id={:?} path={} expected={:?} actual={:?}",
                blocker.code, blocker.stage, blocker.domain, blocker.id, blocker.path, blocker.expected, blocker.actual
            )
        },
    );
    IntegratedRuntimeError::new("content-runtime-rejected", message)
}

fn item_definitions_from_runtime_registry(
    registry: &blockwild_gameplay::ContentRuntimeRegistry,
) -> Result<BTreeMap<u32, ItemDefinition>, IntegratedRuntimeError> {
    let mut definitions = BTreeMap::new();
    for record in registry.items.values() {
        let definition = ItemDefinition {
            code: record.item_code,
            content_id: record.core.id.clone(),
            max_stack: record.max_stack,
            tags: BTreeSet::new(),
        };
        definition
            .validate()
            .map_err(|error| IntegratedRuntimeError::new("content-item-definition", error.message))?;
        if definitions.insert(definition.code, definition).is_some() {
            return Err(IntegratedRuntimeError::new(
                "content-item-definition",
                "typed content registry repeats an inventory item code",
            ));
        }
    }
    Ok(definitions)
}

fn block_action_item_max_stacks_v1(
    registry: &ContentRuntimeRegistry,
) -> Result<BTreeMap<u32, u32>, IntegratedRuntimeError> {
    let mut limits = BTreeMap::new();
    for item in registry.items.values() {
        if item.item_code == 0 || item.max_stack == 0 || limits.insert(item.item_code, item.max_stack).is_some() {
            return Err(IntegratedRuntimeError::new(
                "block-action-item-definition",
                "installed block-action item stack limits are zero or duplicated",
            ));
        }
    }
    Ok(limits)
}

fn install_content_item_definitions(
    gameplay: &mut GameplayAuthority,
    definitions: &BTreeMap<u32, ItemDefinition>,
) -> Result<(), IntegratedRuntimeError> {
    if gameplay.state.inventory.items == *definitions {
        return Ok(());
    }
    if !gameplay.state.inventory.items.is_empty() {
        return Err(IntegratedRuntimeError::new(
            "content-item-definition-conflict",
            "gameplay authority already owns item definitions that differ from installed content",
        ));
    }
    let next_sequence = gameplay.state.revision.sequence.checked_add(1).ok_or_else(|| {
        IntegratedRuntimeError::new(
            "content-item-definition-revision",
            "gameplay sequence is exhausted while installing content item definitions",
        )
    })?;
    let next_inventory = gameplay.state.revision.inventory.checked_add(1).ok_or_else(|| {
        IntegratedRuntimeError::new(
            "content-item-definition-revision",
            "gameplay inventory revision is exhausted while installing content item definitions",
        )
    })?;
    for definition in definitions.values().cloned() {
        gameplay
            .state
            .inventory
            .register_item(definition)
            .map_err(|error| IntegratedRuntimeError::new("content-item-definition", error.message))?;
    }
    if !definitions.is_empty() {
        gameplay.state.revision.sequence = next_sequence;
        gameplay.state.revision.inventory = next_inventory;
    }
    Ok(())
}

fn referenced_inventory_metadata(
    gameplay: &GameplayState,
    slots: &[Option<blockwild_gameplay::ItemStack>],
) -> Result<Vec<ItemInstanceMetadataV1>, IntegratedRuntimeError> {
    let hashes = slots
        .iter()
        .flatten()
        .filter_map(|stack| (stack.metadata_hash != CanonicalHash::default()).then_some(stack.metadata_hash))
        .collect::<BTreeSet<_>>();
    hashes
        .into_iter()
        .map(|hash| {
            gameplay
                .inventory
                .item_instance_metadata
                .get(&hash)
                .cloned()
                .ok_or_else(|| {
                    IntegratedRuntimeError::new(
                        "player-inventory-metadata",
                        "inventory stack references metadata absent from the canonical gameplay store",
                    )
                })
        })
        .collect()
}

fn write_content_domain_digests(hasher: &mut CanonicalHasher, domains: &BTreeMap<ContentDomain, ContentDomainDigest>) {
    hasher.write_u32(domains.len() as u32);
    for (domain, digest) in domains {
        hasher.write_str(domain.as_id());
        hasher.write_u32(digest.count);
        hasher.write_bytes(digest.hash.as_bytes());
    }
}

fn hash_action_promotion_blockers_v1(hasher: &mut CanonicalHasher, blockers: &[ContentActionPromotionBlockerRecordV1]) {
    hasher.write_u64(blockers.len() as u64);
    for blocker in blockers {
        hasher.write_u16(match blocker.scope {
            blockwild_gameplay::ContentActionPromotionBlockerScopeV1::Global => 0,
            blockwild_gameplay::ContentActionPromotionBlockerScopeV1::Profile => 1,
        });
        hasher.write_str(&blocker.blocker_id);
        hasher.write_u16(match blocker.disposition {
            blockwild_gameplay::ContentActionPromotionDispositionV1::ImplementationGap => 0,
            blockwild_gameplay::ContentActionPromotionDispositionV1::ContentUnresolved => 1,
            blockwild_gameplay::ContentActionPromotionDispositionV1::RuntimeContext => 2,
            blockwild_gameplay::ContentActionPromotionDispositionV1::Transient => 3,
        });
        hasher.write_u32(blocker.affected_block_count);
        hasher.write_u64(blocker.affected_block_ids.len() as u64);
        for block_id in &blocker.affected_block_ids {
            hasher.write_u16(*block_id);
        }
    }
}

fn validate_terrain_residency_batch_v1(
    request: &IntegratedTerrainResidencyBatchV1,
) -> Result<(), IntegratedRuntimeError> {
    request
        .expected_world_revision
        .validate()
        .map_err(|error| IntegratedRuntimeError::domain("terrain-residency-revision", error))?;
    validate_canonical_generation_options_json_v1(&request.generation_options_json)?;
    if request.chunks.is_empty() || request.chunks.len() > INTEGRATED_RUNTIME_MAX_TERRAIN_RESIDENCY_CHUNKS_V1 {
        return Err(IntegratedRuntimeError::new(
            "terrain-residency-count",
            "terrain residency batch is empty or exceeds its chunk bound",
        ));
    }
    for pair in request.chunks.windows(2) {
        if pair[0] >= pair[1] {
            return Err(IntegratedRuntimeError::new(
                "terrain-residency-order",
                "terrain residency chunks must be sorted and unique by chunk_x then chunk_z",
            ));
        }
    }
    Ok(())
}

fn validate_terrain_residency_reconcile_batch_v2(
    request: &IntegratedTerrainResidencyReconcileBatchV2,
) -> Result<(), IntegratedRuntimeError> {
    validate_terrain_residency_batch_v1(&IntegratedTerrainResidencyBatchV1 {
        expected_world_revision: request.expected_world_revision,
        generation_options_json: request.generation_options_json.clone(),
        chunks: request.desired_chunks.clone(),
    })?;
    for coordinate in &request.desired_chunks {
        validate_terrain_halo_coordinate_v1(*coordinate)?;
    }
    Ok(())
}

pub(crate) fn validate_canonical_generation_options_json_v1(value: &str) -> Result<(), IntegratedRuntimeError> {
    if value.is_empty() || value.len() > 16 * 1024 || value.chars().any(char::is_control) {
        return Err(invalid_generation_options_v1());
    }
    let mut remaining = value;
    consume_generation_literal_v1(&mut remaining, "{\"biomeScale\":")?;
    consume_generation_number_v1(&mut remaining, 0.25, 4.0, ",\"caveFrequency\":")?;
    consume_generation_number_v1(&mut remaining, 0.0, 3.0, ",\"enabledFactions\":[")?;
    let faction_end = remaining.find(']').ok_or_else(invalid_generation_options_v1)?;
    let factions = &remaining[..faction_end];
    let allowed_factions = [
        "hobbits",
        "goblins",
        "atlantians",
        "sugarcourt",
        "wood-elves",
        "dwarves",
    ];
    let mut previous_rank = None;
    if !factions.is_empty() {
        for faction in factions.split(',') {
            if faction.len() < 3 || !faction.starts_with('"') || !faction.ends_with('"') {
                return Err(invalid_generation_options_v1());
            }
            let faction = &faction[1..faction.len() - 1];
            let rank = allowed_factions
                .iter()
                .position(|allowed| *allowed == faction)
                .ok_or_else(invalid_generation_options_v1)?;
            if previous_rank.is_some_and(|previous| rank <= previous) {
                return Err(invalid_generation_options_v1());
            }
            previous_rank = Some(rank);
        }
    }
    remaining = &remaining[faction_end + 1..];
    consume_generation_literal_v1(&mut remaining, ",\"largeTownFrequency\":\"")?;
    consume_generation_enum_v1(&mut remaining, &["rare", "balanced", "frequent"], "\",\"profile\":\"")?;
    consume_generation_enum_v1(
        &mut remaining,
        &["legacy-v14", "world-below-v15"],
        "\",\"resourceAbundance\":",
    )?;
    consume_generation_number_v1(&mut remaining, 0.25, 4.0, ",\"roadCoverage\":\"")?;
    consume_generation_enum_v1(
        &mut remaining,
        &["none", "local", "regional", "dense"],
        "\",\"settlementClustering\":\"",
    )?;
    consume_generation_enum_v1(
        &mut remaining,
        &["even", "regional", "strong"],
        "\",\"settlementDensity\":",
    )?;
    consume_generation_number_v1(&mut remaining, 0.0, 3.0, ",\"settlementPattern\":\"")?;
    consume_generation_enum_v1(
        &mut remaining,
        &["legacy-scattered-v1", "heartlands-v2"],
        "\",\"structures\":",
    )?;
    if remaining != "true}" && remaining != "false}" {
        return Err(invalid_generation_options_v1());
    }
    Ok(())
}

fn invalid_generation_options_v1() -> IntegratedRuntimeError {
    IntegratedRuntimeError::new(
        "invalid-generation-options",
        "generation options must contain only normalized chunk-affecting fields in canonical JSON order",
    )
}

fn consume_generation_literal_v1(remaining: &mut &str, literal: &str) -> Result<(), IntegratedRuntimeError> {
    *remaining = remaining
        .strip_prefix(literal)
        .ok_or_else(invalid_generation_options_v1)?;
    Ok(())
}

fn consume_generation_enum_v1(
    remaining: &mut &str,
    allowed: &[&str],
    delimiter: &str,
) -> Result<(), IntegratedRuntimeError> {
    let end = remaining.find(delimiter).ok_or_else(invalid_generation_options_v1)?;
    if !allowed.contains(&&remaining[..end]) {
        return Err(invalid_generation_options_v1());
    }
    *remaining = &remaining[end + delimiter.len()..];
    Ok(())
}

fn consume_generation_number_v1(
    remaining: &mut &str,
    minimum: f64,
    maximum: f64,
    delimiter: &str,
) -> Result<(), IntegratedRuntimeError> {
    let end = remaining.find(delimiter).ok_or_else(invalid_generation_options_v1)?;
    let token = &remaining[..end];
    let value = token.parse::<f64>().map_err(|_| invalid_generation_options_v1())?;
    let normalized = (value.clamp(minimum, maximum) * 100.0).round() / 100.0;
    let canonical = if normalized == 0.0 {
        "0".into()
    } else {
        normalized.to_string()
    };
    if !value.is_finite() || value != normalized || token != canonical {
        return Err(invalid_generation_options_v1());
    }
    *remaining = &remaining[end + delimiter.len()..];
    Ok(())
}

fn validate_terrain_halo_coordinate_v1(
    coordinate: IntegratedTerrainChunkCoordinateV1,
) -> Result<(), IntegratedRuntimeError> {
    for delta in [-1_i32, 0, 1] {
        coordinate.chunk_x.checked_add(delta).ok_or_else(|| {
            IntegratedRuntimeError::new(
                "terrain-residency-coordinate",
                "terrain residency edit halo overflows chunk_x",
            )
        })?;
        coordinate.chunk_z.checked_add(delta).ok_or_else(|| {
            IntegratedRuntimeError::new(
                "terrain-residency-coordinate",
                "terrain residency edit halo overflows chunk_z",
            )
        })?;
    }
    Ok(())
}

fn terrain_edit_hash_v1(coordinate: IntegratedTerrainChunkCoordinateV1, edits: &[(u32, u16)]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild.integrated.terrain-edits.r4.v1");
    hasher.write_i32(coordinate.chunk_x);
    hasher.write_i32(coordinate.chunk_z);
    hasher.write_u32(edits.len() as u32);
    for (index, block_id) in edits {
        hasher.write_u32(*index);
        hasher.write_u16(*block_id);
    }
    hasher.finish()
}

fn terrain_namespace_hash_v1(namespace: &str) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild.integrated.terrain-namespace.r4.v1");
    hasher.write_str(namespace);
    hasher.finish()
}

fn terrain_generation_epoch_v1(config: &IntegratedRuntimeConfigV2) -> u32 {
    let mut hasher = CanonicalHasher::new("blockwild.integrated.terrain-epoch.r4.v1");
    hasher.write_str(&config.universe_id);
    hasher.write_str(&config.location_id);
    hasher.write_str(&config.world_seed);
    hasher.write_bytes(config.terrain_content_hash.as_bytes());
    hasher.write_bytes(config.generator_hash.as_bytes());
    hasher.write_str(&config.generation_options_json);
    nonzero_hash_u32_v1(hasher.finish())
}

fn terrain_generation_revision_v1(edit_hash: CanonicalHash, namespace_hash: CanonicalHash) -> u32 {
    let mut hasher = CanonicalHasher::new("blockwild.integrated.terrain-revision.r4.v1");
    hasher.write_bytes(edit_hash.as_bytes());
    hasher.write_bytes(namespace_hash.as_bytes());
    nonzero_hash_u32_v1(hasher.finish())
}

fn terrain_generation_task_id_v1(
    config: &IntegratedRuntimeConfigV2,
    coordinate: IntegratedTerrainChunkCoordinateV1,
    edit_hash: CanonicalHash,
    namespace_hash: CanonicalHash,
) -> u32 {
    let mut hasher = CanonicalHasher::new("blockwild.integrated.terrain-task.r4.v1");
    hasher.write_str(&config.universe_id);
    hasher.write_str(&config.location_id);
    hasher.write_i32(coordinate.chunk_x);
    hasher.write_i32(coordinate.chunk_z);
    hasher.write_bytes(edit_hash.as_bytes());
    hasher.write_bytes(namespace_hash.as_bytes());
    nonzero_hash_u32_v1(hasher.finish())
}

fn nonzero_hash_u32_v1(hash: CanonicalHash) -> u32 {
    let value = u32::from_le_bytes(hash.as_bytes()[..4].try_into().expect("fixed hash prefix"));
    value.max(1)
}

fn terrain_namespace_v1(
    seed: &str,
    generation_options_json: &str,
    coordinate: IntegratedTerrainChunkCoordinateV1,
    edits_by_chunk: &BTreeMap<(i32, i32), Vec<(u32, u16)>>,
) -> Result<String, IntegratedRuntimeError> {
    let mut halo = Vec::with_capacity(9);
    for delta_z in [-1_i32, 0, 1] {
        for delta_x in [-1_i32, 0, 1] {
            let chunk_x = coordinate.chunk_x.checked_add(delta_x).ok_or_else(|| {
                IntegratedRuntimeError::new("terrain-residency-coordinate", "terrain edit halo overflows chunk_x")
            })?;
            let chunk_z = coordinate.chunk_z.checked_add(delta_z).ok_or_else(|| {
                IntegratedRuntimeError::new("terrain-residency-coordinate", "terrain edit halo overflows chunk_z")
            })?;
            halo.push(terrain_edit_signature_v1(
                edits_by_chunk
                    .get(&(chunk_x, chunk_z))
                    .map(Vec::as_slice)
                    .unwrap_or_default(),
            ));
        }
    }
    Ok(format!(
        "terrain-v5|g{GENERATOR_VERSION}|{seed}|{generation_options_json}|{},{}|{}",
        coordinate.chunk_x,
        coordinate.chunk_z,
        halo.join(".")
    ))
}

fn terrain_edit_signature_v1(edits: &[(u32, u16)]) -> String {
    if edits.is_empty() {
        return "0".into();
    }
    let mut hash = blockwild_types::FNV1A_32_OFFSET;
    for (index, block_id) in edits {
        hash = (hash ^ *index).wrapping_mul(blockwild_types::FNV1A_32_PRIME);
        hash = (hash ^ u32::from(*block_id)).wrapping_mul(blockwild_types::FNV1A_32_PRIME);
    }
    base36_u32_v1(hash)
}

fn base36_u32_v1(mut value: u32) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".into();
    }
    let mut reversed = [0_u8; 7];
    let mut length = 0_usize;
    while value != 0 {
        reversed[length] = DIGITS[(value % 36) as usize];
        length += 1;
        value /= 36;
    }
    reversed[..length].reverse();
    String::from_utf8(reversed[..length].to_vec()).expect("base36 digits are UTF-8")
}

fn terrain_chunk_is_exactly_resident_v1(world: &WorldAuthorityStoreR4V1, chunk: &ChunkPayloadV2) -> bool {
    let address = AuthorityChunkAddressV1 {
        world: world.active_address().clone(),
        chunk_x: chunk.cx,
        chunk_z: chunk.cz,
    };
    let Some(auxiliary) = world.chunk_auxiliary(&address) else {
        return false;
    };
    if auxiliary.source_revision != u64::from(chunk.revision) || auxiliary.source_hash != chunk.chunk_hash {
        return false;
    }
    (0_i16..12_i16).all(|section_y| {
        let section = WorldSectionAddressV1 {
            world: world.active_address().clone(),
            chunk_x: chunk.cx,
            chunk_z: chunk.cz,
            section_y,
        };
        world.section_source_identity(&section) == Some((u64::from(chunk.revision), chunk.chunk_hash.as_str()))
    })
}

fn page_to_simulation_window(page: &WorldReadPageV1) -> Result<WorldReadWindowV1, IntegratedRuntimeError> {
    // Authority pages and simulation windows intentionally use distinct hash
    // domains. Seal once after the zero-copy stream conversion; reusing the
    // authority page hash here would make every native simulation job reject.
    Ok(WorldReadWindowV1 {
        address: SimulationWorldAddressV1 {
            universe_id: page.address.universe_id.clone(),
            location_id: page.address.location_id.clone(),
        },
        origin: blockwild_simulation::CellPos::new(page.origin.x, page.origin.y, page.origin.z),
        size: [u32::from(page.size.x), u32::from(page.size.y), u32::from(page.size.z)],
        identity: WorldIdentityV1 {
            address: SimulationWorldAddressV1 {
                universe_id: page.identity.address.universe_id.clone(),
                location_id: page.identity.address.location_id.clone(),
            },
            revision: WorldRevisionV1 {
                epoch: page.identity.revision.epoch,
                mutation: page.identity.revision.mutation,
                residency: page.identity.revision.residency,
            },
            state_hash: parse_canonical_hash(&page.identity.state_hash)?,
        },
        loaded_mask: page.streams.loaded_mask.to_vec(),
        boundary: page.streams.boundary.to_vec(),
        blocks: page.streams.blocks.to_vec(),
        facing: page.streams.facing.to_vec(),
        liquid_kind: page.streams.liquid_kind.to_vec(),
        liquid_level: page.streams.liquid_level.to_vec(),
        flags: page.streams.flags.to_vec(),
        snapshot_hash: CanonicalHash::default(),
    }
    .seal())
}

fn save_stage_progress(stage: &IntegratedRuntimeSaveStageV1) -> IntegratedRuntimeSaveProgressV1 {
    IntegratedRuntimeSaveProgressV1 {
        stage_id: stage.stage_id.clone(),
        received_chunks: stage.chunks.len() as u32,
        chunk_count: stage.chunk_count,
        received_bytes: stage.chunks.values().map(Vec::len).sum::<usize>() as u64,
        set_hash: CanonicalHash::default(),
        manifest_hash: CanonicalHash::default(),
        dispatcher_request_id: None,
        remaining_dirty_records: 0,
    }
}

fn generated_cell(block_id: u16) -> WorldCellV1 {
    let liquid = match block_id {
        GeneratedBlock::WATER => LiquidMetadataV1 {
            kind: WorldLiquidKindV1::Water,
            level: 0,
            source: true,
            falling: false,
            contains_water: true,
            waterlogged: false,
        },
        GeneratedBlock::LAVA => LiquidMetadataV1 {
            kind: WorldLiquidKindV1::Lava,
            level: 0,
            source: true,
            falling: false,
            contains_water: false,
            waterlogged: false,
        },
        _ => LiquidMetadataV1::default(),
    };
    WorldCellV1 {
        block_id,
        facing: 0,
        liquid,
    }
}

fn parse_canonical_hash(value: &str) -> Result<CanonicalHash, IntegratedRuntimeError> {
    if value.len() != 32 {
        return Err(IntegratedRuntimeError::new(
            "canonical-hash",
            "canonical hash must contain 32 hexadecimal characters",
        ));
    }
    let mut bytes = [0_u8; 16];
    for (index, target) in bytes.iter_mut().enumerate() {
        let offset = index * 2;
        *target = u8::from_str_radix(&value[offset..offset + 2], 16).map_err(|_| {
            IntegratedRuntimeError::new("canonical-hash", "canonical hash contains non-hexadecimal bytes")
        })?;
    }
    Ok(CanonicalHash(bytes))
}

fn write_runtime_revision(hasher: &mut CanonicalHasher, revision: IntegratedRuntimeRevisionV2) {
    hasher.write_u64(revision.epoch);
    hasher.write_u64(revision.world);
    hasher.write_u64(revision.entities);
    hasher.write_u64(revision.gameplay);
    hasher.write_u64(revision.persistence);
    hasher.write_u64(revision.network);
    hasher.write_u64(revision.simulation);
}

fn write_runtime_input(hasher: &mut CanonicalHasher, input: &RuntimeInputFrameV1) {
    hasher.write_u64(input.sequence);
    hasher.write_u64(input.target_tick);
    hasher.write_i32(i32::from(input.move_x));
    hasher.write_i32(i32::from(input.move_z));
    hasher.write_i32(i32::from(input.look_yaw));
    hasher.write_i32(i32::from(input.look_pitch));
    hasher.write_u32(input.buttons);
    hasher.write_u16(u16::from(input.selected_slot));
    hasher.write_u16(u16::from(input.flags));
}

fn write_item_stack_hash_v1(hasher: &mut CanonicalHasher, stack: &ItemStack) {
    hasher.write_u32(stack.item_code);
    hasher.write_u32(stack.count);
    match stack.durability_millionths {
        Some(value) => {
            hasher.write_u16(1);
            hasher.write_u32(value);
        }
        None => hasher.write_u16(0),
    }
    hasher.write_bytes(stack.metadata_hash.as_bytes());
}

fn write_mining_state_v1(hasher: &mut CanonicalHasher, state: &IntegratedRuntimeMiningStateV1) {
    hasher.write_u64(state.player_entity_id);
    hasher.write_i32(state.target.x);
    hasher.write_i32(state.target.y);
    hasher.write_i32(state.target.z);
    hasher.write_u16(state.target_block_id);
    hasher.write_u64(state.world_revision.epoch);
    hasher.write_u64(state.world_revision.mutation);
    hasher.write_u64(state.world_revision.residency);
    hasher.write_u16(u16::from(state.selected_slot));
    hasher.write_u32(state.held_item_code);
    hasher.write_bytes(state.held_metadata_hash.as_bytes());
    match state.held_durability_millionths {
        Some(value) => {
            hasher.write_u16(1);
            hasher.write_u32(value);
        }
        None => hasher.write_u16(0),
    }
    hasher.write_bytes(state.tool_profile_hash.as_bytes());
    hasher.write_u64(state.progress_millionths);
    hasher.write_u64(state.required_work_millionths);
    hasher.write_u64(state.started_tick);
    hasher.write_u64(state.last_advanced_tick);
}

fn write_player_state(hasher: &mut CanonicalHasher, player: &IntegratedRuntimePlayerStateV2) {
    let binding = &player.binding;
    hasher.write_str(&binding.external_entity_id);
    hasher.write_str(&binding.actor_id);
    hasher.write_u64(binding.player_id.packed());
    hasher.write_u16(u16::from(binding.creative_mode));
    for value in [
        binding.radius,
        binding.standing_height,
        binding.crouching_height,
        binding.mass,
        binding.walk_speed,
        binding.sprint_speed,
        binding.creative_flight_speed,
        binding.maximum_oxygen_seconds,
        player.body.position.x,
        player.body.position.y,
        player.body.position.z,
        player.body.velocity.x,
        player.body.velocity.y,
        player.body.velocity.z,
        player.body.radius,
        player.body.height,
        player.body.mass,
        player.body.fall_distance,
        player.body.oxygen_seconds,
        player.body.drowning_accumulator,
        player.body.swim_entry_momentum_speed,
        player.body.swim_surface_breach_seconds,
        player.body.swim_stroke_cooldown_seconds,
    ] {
        hasher.write_u64(value.to_bits());
    }
    hasher.write_u64(player.entity_id.packed());
    hasher.write_u16(u16::from(player.body.grounded));
    hasher.write_u16(u16::from(player.body.crouching));
    hasher.write_u16(u16::from(player.body.swim_surface_breach_ready));
    hasher.write_u16(u16::from(player.body.swim_surface_bob_active));
    hasher.write_u16(player.contact_flags);
    hasher.write_u16(u16::from(player.selected_slot));
    hasher.write_i32(i32::from(player.look_pitch));
    hasher.write_u32(player.buttons);
    hasher.write_u16(u16::from(player.flags));
    hasher.write_u64(player.last_input_sequence);
}

fn write_camera_state_v1(hasher: &mut CanonicalHasher, camera: IntegratedRuntimeCameraStateV1) {
    hasher.write_u64(camera.revision);
    hasher.write_u16(match camera.mode {
        CameraModeV1::FirstPerson => 0,
        CameraModeV1::ThirdRear => 1,
        CameraModeV1::ThirdFront => 2,
    });
    for value in camera_profile_values_v1(camera.profile) {
        hasher.write_u64(value.to_bits());
    }
    hasher.write_i32(i32::from(camera.look_yaw));
    hasher.write_i32(i32::from(camera.look_pitch));
}

fn write_effect_event(hasher: &mut CanonicalHasher, event: &IntegratedRuntimeEffectEventV2) {
    hasher.write_u64(event.sequence);
    hasher.write_u64(event.tick);
    hasher.write_str(&event.entity_external_id);
    hasher.write_u16(event.kind as u16);
    hasher.write_u64(event.amount.to_bits());
}

fn normalized_i16(value: i16) -> f64 {
    (f64::from(value) / 32_767.0).clamp(-1.0, 1.0)
}

fn camera_profile_values_v1(profile: CameraProfileV1) -> [f64; 12] {
    [
        profile.eye_height,
        profile.third_person_target_height,
        profile.third_person_distance,
        profile.third_person_pitch_scale,
        profile.rear_shoulder_offset,
        profile.collision_radius,
        profile.collision_padding,
        profile.minimum_distance,
        profile.base_vertical_fov_radians,
        profile.aim_vertical_fov_radians,
        profile.near,
        profile.far,
    ]
}

fn camera_profile_bits_equal_v1(left: CameraProfileV1, right: CameraProfileV1) -> bool {
    camera_profile_values_v1(left)
        .into_iter()
        .zip(camera_profile_values_v1(right))
        .all(|(left, right)| left.to_bits() == right.to_bits())
}

fn validate_runtime_camera_profile_bounds_v1(profile: CameraProfileV1) -> Result<(), IntegratedRuntimeError> {
    derive_camera_pose_v1(
        None,
        CameraPoseInputV1 {
            body_position: SimulationVec3::new(0.0, 0.0, 0.0),
            look_yaw: 0.0,
            look_pitch: 0.0,
            mode: CameraModeV1::FirstPerson,
            aiming: false,
            viewport: [1, 1],
            profile,
        },
    )
    .map_err(|error| IntegratedRuntimeError::new("camera-profile", error.to_string()))?;

    // Prove a conservative upper bound for every legal yaw and clamped
    // third-person pitch before accepting the profile. Each horizontal axis
    // is bounded by the complete horizontal offset magnitude; this is more
    // conservative than any one orientation but cannot under-count cells.
    let horizontal_displacement = profile.third_person_distance.hypot(profile.rear_shoulder_offset.abs());
    let vertical_displacement = profile.third_person_distance * 0.78_f64.sin();
    let span_bound = |displacement: f64| -> Result<usize, IntegratedRuntimeError> {
        let span = (displacement + profile.collision_radius * 2.0).ceil() + 2.0;
        if !span.is_finite() || !(1.0..=256.0).contains(&span) {
            return Err(IntegratedRuntimeError::new(
                "camera-profile-capacity",
                "camera profile can exceed one bounded capture dimension",
            ));
        }
        Ok(span as usize)
    };
    let horizontal_span = span_bound(horizontal_displacement)?;
    let vertical_span = span_bound(vertical_displacement)?;
    let maximum_cells = WORLD_READ_WINDOW_MAX_CELLS_V1.min(RAYCAST_MAX_VISITED_CELLS_V1);
    let cells = horizontal_span
        .checked_mul(horizontal_span)
        .and_then(|value| value.checked_mul(vertical_span))
        .ok_or_else(|| {
            IntegratedRuntimeError::new("camera-profile-capacity", "camera profile capture bound overflowed")
        })?;
    if cells > maximum_cells {
        return Err(IntegratedRuntimeError::new(
            "camera-profile-capacity",
            "camera profile can exceed the shared R4/raycast capture budget",
        ));
    }
    Ok(())
}

fn camera_collision_segment_v1(
    input: CameraPoseInputV1,
) -> Result<(SimulationVec3, SimulationVec3), IntegratedRuntimeError> {
    if input.mode == CameraModeV1::FirstPerson {
        return Err(IntegratedRuntimeError::new(
            "camera-capture-mode",
            "first-person camera does not require a collision capture",
        ));
    }
    let target = input.body_position + SimulationVec3::new(0.0, input.profile.third_person_target_height, 0.0);
    let pitch = (-input.look_pitch * input.profile.third_person_pitch_scale).clamp(-0.78, 0.78);
    let forward = SimulationVec3::new(-input.look_yaw.sin(), 0.0, -input.look_yaw.cos());
    let outward = if input.mode == CameraModeV1::ThirdRear {
        forward * -1.0
    } else {
        forward
    };
    let shoulder = if input.mode == CameraModeV1::ThirdRear {
        input.profile.rear_shoulder_offset
    } else {
        0.0
    };
    let right = SimulationVec3::new(input.look_yaw.cos(), 0.0, -input.look_yaw.sin());
    let offset = outward * (pitch.cos() * input.profile.third_person_distance)
        + SimulationVec3::new(0.0, pitch.sin() * input.profile.third_person_distance, 0.0)
        + right * shoulder;
    if ![target.x, target.y, target.z, offset.x, offset.y, offset.z]
        .iter()
        .all(|value| value.is_finite())
        || offset.length() == 0.0
    {
        return Err(IntegratedRuntimeError::new(
            "camera-capture-number",
            "camera collision segment is not finite",
        ));
    }
    Ok((target, target + offset))
}

fn camera_ray_cell_component_v1(value: f64) -> Result<i32, IntegratedRuntimeError> {
    let cell = (value + 0.5).floor();
    if !cell.is_finite() || cell < f64::from(i32::MIN) || cell > f64::from(i32::MAX) {
        return Err(IntegratedRuntimeError::new(
            "camera-capture-coordinate",
            "camera collision capture lies outside the R4 coordinate range",
        ));
    }
    Ok(cell as i32)
}

fn system_gameplay_actor_v1() -> GameplayActor {
    GameplayActor {
        actor_id: GAMEPLAY_SCHEDULER_ACTOR_ID_V1.into(),
        player_id: None,
        entity_id: None,
        role: ActorRole::System,
    }
}

fn system_world_view_actor_v1() -> GameplayActor {
    GameplayActor {
        actor_id: "system".into(),
        player_id: None,
        entity_id: None,
        role: ActorRole::System,
    }
}

fn drop_position_to_entity_v1(value: FixedWorldVec3V1) -> EntityVec3 {
    EntityVec3::new(
        value.x_milli as f32 / 1_000.0,
        value.y_milli as f32 / 1_000.0,
        value.z_milli as f32 / 1_000.0,
    )
}

fn drop_yaw_to_radians_v1(yaw_microturns: u32) -> f32 {
    (yaw_microturns as f32 / 1_000_000.0) * std::f32::consts::TAU
}

fn entity_component_to_milli_v1(value: f32) -> Option<i64> {
    let scaled = f64::from(value) * 1_000.0;
    if !scaled.is_finite() || scaled <= i64::MIN as f64 || scaled >= i64::MAX as f64 {
        return None;
    }
    Some(scaled.round() as i64)
}

fn quantize_player_vital_millihearts_v1(value: f32, label: &str) -> Result<u32, IntegratedRuntimeError> {
    if !value.is_finite() || value.is_sign_negative() {
        return Err(IntegratedRuntimeError::new(
            "player-combat-vitals",
            format!("R6 player {label} is not a finite nonnegative f32"),
        ));
    }
    let scaled = f64::from(value) * 1_000.0;
    let rounded = scaled.round();
    if !rounded.is_finite() || rounded < 0.0 || rounded > f64::from(u32::MAX) {
        return Err(IntegratedRuntimeError::new(
            "player-combat-vitals",
            format!("R6 player {label} exceeds the milliheart range"),
        ));
    }
    let millihearts = rounded as u32;
    let roundtrip = millihearts as f32 / 1_000.0;
    if roundtrip.to_bits() != value.to_bits() {
        return Err(IntegratedRuntimeError::new(
            "player-combat-vitals",
            format!("R6 player {label} is not canonically representable in millihearts"),
        ));
    }
    Ok(millihearts)
}

fn quantize_player_position_millimeters_v1(value: f32, axis: &str) -> Result<i32, IntegratedRuntimeError> {
    let scaled = f64::from(value) * 1_000.0;
    let rounded = scaled.round();
    if !rounded.is_finite() || rounded < f64::from(i32::MIN) || rounded > f64::from(i32::MAX) {
        return Err(IntegratedRuntimeError::new(
            "player-combat-position",
            format!("R6 player {axis} position exceeds the fixed combat range"),
        ));
    }
    Ok(rounded as i32)
}

fn drop_entity_transform_matches_v1(drop: &DroppedItemSpatialV1, record: &EntityCompatibilityRecord) -> bool {
    let position_matches = [
        (drop.position.x_milli, record.position.x),
        (drop.position.y_milli, record.position.y),
        (drop.position.z_milli, record.position.z),
    ]
    .into_iter()
    .all(|(expected, actual)| entity_component_to_milli_v1(actual) == Some(expected));
    let velocity_matches = [
        (drop.velocity_milli_per_second.x_milli, record.velocity.x),
        (drop.velocity_milli_per_second.y_milli, record.velocity.y),
        (drop.velocity_milli_per_second.z_milli, record.velocity.z),
    ]
    .into_iter()
    .all(|(expected, actual)| entity_component_to_milli_v1(actual) == Some(expected));
    let expected_yaw = drop_yaw_to_radians_v1(drop.rotation.yaw);
    position_matches && velocity_matches && (record.yaw - expected_yaw).abs() <= 1.0e-5
}

fn drop_within_pickup_radius_v1(position: FixedWorldVec3V1, player_position: EntityVec3) -> bool {
    let Some(player_x) = entity_component_to_milli_v1(player_position.x) else {
        return false;
    };
    let Some(player_y) = entity_component_to_milli_v1(player_position.y) else {
        return false;
    };
    let Some(player_z) = entity_component_to_milli_v1(player_position.z) else {
        return false;
    };
    let dx = i128::from(position.x_milli.saturating_sub(player_x));
    let dy = i128::from(position.y_milli.saturating_sub(player_y.saturating_add(800)));
    let dz = i128::from(position.z_milli.saturating_sub(player_z));
    let radius = i128::from(INTEGRATED_RUNTIME_DROP_PICKUP_RADIUS_MILLI_V1);
    dx * dx + dy * dy + dz * dz < radius * radius
}

fn ray_normal_i8(value: f64) -> i8 {
    if value > 0.5 {
        1
    } else if value < -0.5 {
        -1
    } else {
        0
    }
}

fn basic_single_cell_block_action_v1(profile: &blockwild_gameplay::ContentBlockActionProfile) -> bool {
    profile.block_id != WORLD_BEDROCK_BLOCK_ID_V1
        && profile.topology_flags == 0
        && profile.shape.is_none()
        && profile.collision_height_millionths.is_none()
        && profile.vertical_connect_group.is_none()
        && profile.connect_group.is_none()
        && profile.liquid.is_none()
}

fn runtime_block_action_route_v1(
    registry: &ContentRuntimeRegistry,
    profile: &blockwild_gameplay::ContentBlockActionProfile,
) -> IntegratedRuntimeBlockActionRouteV1 {
    if !basic_single_cell_block_action_v1(profile) {
        return IntegratedRuntimeBlockActionRouteV1::Blocked;
    }
    let Some(catalog) = registry
        .block_action_catalogs
        .get(blockwild_gameplay::BLOCK_ACTION_CATALOG_ID)
    else {
        return IntegratedRuntimeBlockActionRouteV1::Blocked;
    };
    match catalog.core.schema {
        ContentSchema::BlockActionCatalog => {
            if profile.mapped_item_code.is_some() {
                IntegratedRuntimeBlockActionRouteV1::LegacySchema1
            } else {
                IntegratedRuntimeBlockActionRouteV1::Blocked
            }
        }
        ContentSchema::BlockActionCatalogV2 => {
            let Some(action) = &profile.break_profile else {
                return IntegratedRuntimeBlockActionRouteV1::Blocked;
            };
            let supported_blockers = profile.authority_blockers.iter().all(|blocker| {
                blocker == AUTHORITATIVE_RNG_CONTEXT_UNBOUND_V1 || blocker == "player-luck-context-runtime"
            });
            if supported_blockers
                && action.replacement == ContentBlockBreakReplacement::Air
                && action.contextual_override == ContentBlockContextualOverride::None
                && matches!(
                    action.durability_cost,
                    ContentBlockDurabilityCost::None | ContentBlockDurabilityCost::Constant(_)
                )
            {
                IntegratedRuntimeBlockActionRouteV1::GeneratedLootV9
            } else {
                IntegratedRuntimeBlockActionRouteV1::Blocked
            }
        }
        _ => IntegratedRuntimeBlockActionRouteV1::Blocked,
    }
}

fn generated_drop_transform_v9(
    provenance: &GeneratedDropProvenanceV1,
) -> (FixedWorldVec3V1, FixedWorldVec3V1, RotationMicroturnsV1) {
    let hash = provenance.canonical_hash_v1();
    let bytes = hash.as_bytes();
    let signed_offset = |first: u8, second: u8| i64::from(u16::from_le_bytes([first, second]) % 401) - 200;
    let position = FixedWorldVec3V1 {
        x_milli: i64::from(provenance.position.x)
            .saturating_mul(1_000)
            .saturating_add(signed_offset(bytes[0], bytes[1])),
        y_milli: i64::from(provenance.position.y)
            .saturating_mul(1_000)
            .saturating_add(350),
        z_milli: i64::from(provenance.position.z)
            .saturating_mul(1_000)
            .saturating_add(signed_offset(bytes[2], bytes[3])),
    };
    let velocity = FixedWorldVec3V1 {
        x_milli: signed_offset(bytes[4], bytes[5]).saturating_mul(2),
        y_milli: 1_200 + i64::from(u16::from_le_bytes([bytes[6], bytes[7]]) % 401),
        z_milli: signed_offset(bytes[8], bytes[9]).saturating_mul(2),
    };
    let rotation = RotationMicroturnsV1 {
        yaw: u32::from_le_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]) % 1_000_000,
        pitch: 0,
        roll: 0,
    };
    (position, velocity, rotation)
}

fn player_intersects_block_v1(body: &PhysicsBodyV1, position: CellPositionV1) -> bool {
    let block_min_x = f64::from(position.x) - 0.5;
    let block_max_x = block_min_x + 1.0;
    let block_min_y = f64::from(position.y) - 0.5;
    let block_max_y = block_min_y + 1.0;
    let block_min_z = f64::from(position.z) - 0.5;
    let block_max_z = block_min_z + 1.0;
    body.position.x + body.radius > block_min_x
        && body.position.x - body.radius < block_max_x
        && body.position.y + body.height > block_min_y
        && body.position.y < block_max_y
        && body.position.z + body.radius > block_min_z
        && body.position.z - body.radius < block_max_z
}

fn floor_i32(value: f64) -> Result<i32, IntegratedRuntimeError> {
    let value = value.floor();
    if !value.is_finite() || value < f64::from(i32::MIN) || value > f64::from(i32::MAX) {
        Err(IntegratedRuntimeError::new(
            "player-position",
            "bound player position is outside the simulation coordinate range",
        ))
    } else {
        Ok(value as i32)
    }
}

fn simulation_position_to_fixed_v1(value: SimulationVec3) -> Result<FixedVec3, IntegratedRuntimeError> {
    let component = |value: f64| {
        let value = (value * 1_000.0).round();
        if !value.is_finite() || value < f64::from(i32::MIN) || value > f64::from(i32::MAX) {
            Err(IntegratedRuntimeError::new(
                "combat-projectile-impact",
                "projectile contact is outside fixed-point coordinate bounds",
            ))
        } else {
            Ok(value as i32)
        }
    };
    Ok(FixedVec3 {
        x_milli: component(value.x)?,
        y_milli: component(value.y)?,
        z_milli: component(value.z)?,
    })
}

fn parse_custom_bool(values: &BTreeMap<String, String>, key: &str, fallback: bool) -> bool {
    values
        .get(key)
        .and_then(|value| value.parse::<bool>().ok())
        .unwrap_or(fallback)
}

fn hash_runtime_receipt(
    batch_id: &str,
    before: &IntegratedRuntimeIdentityV2,
    after: &IntegratedRuntimeIdentityV2,
) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-integrated-receipt-v2");
    hasher.write_str(batch_id);
    hasher.write_bytes(before.state_hash.as_bytes());
    hasher.write_bytes(after.state_hash.as_bytes());
    write_runtime_revision(&mut hasher, after.revision);
    hasher.finish()
}

fn hash_runtime_replay_entry(entry: &IntegratedRuntimeReplayEntryV2) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-integrated-replay-entry-v2");
    hasher.write_u64(entry.sequence);
    hasher.write_str(&entry.batch_id);
    hasher.write_bytes(entry.before_hash.as_bytes());
    hasher.write_bytes(entry.after_hash.as_bytes());
    hasher.write_bytes(entry.receipt_hash.as_bytes());
    hasher.finish()
}

fn canonical_hash_lanes(hash: CanonicalHash) -> (u64, u64) {
    let bytes = hash.as_bytes();
    (
        u64::from_le_bytes(bytes[..8].try_into().expect("canonical hash low lane")),
        u64::from_le_bytes(bytes[8..].try_into().expect("canonical hash high lane")),
    )
}

fn legacy_state_flag_names(flags: u16) -> Vec<&'static str> {
    let mut names = Vec::new();
    for (flag, name) in [
        (LEGACY_STATE_ENTITIES_V1, "entities"),
        (LEGACY_STATE_PLAYER_V1, "player"),
        (LEGACY_STATE_RUNTIME_CLOCKS_V1, "runtime clocks"),
        (LEGACY_STATE_GAMEPLAY_V1, "gameplay"),
        (LEGACY_STATE_MACHINES_V1, "machines"),
        (LEGACY_STATE_MAP_V1, "map"),
        (LEGACY_STATE_NETWORK_V1, "network"),
        (LEGACY_STATE_UNKNOWN_V1, "unknown legacy fields"),
    ] {
        if flags & flag != 0 {
            names.push(name);
        }
    }
    let known = LEGACY_STATE_ENTITIES_V1
        | LEGACY_STATE_PLAYER_V1
        | LEGACY_STATE_RUNTIME_CLOCKS_V1
        | LEGACY_STATE_GAMEPLAY_V1
        | LEGACY_STATE_MACHINES_V1
        | LEGACY_STATE_MAP_V1
        | LEGACY_STATE_NETWORK_V1
        | LEGACY_STATE_UNKNOWN_V1;
    if flags & !known != 0 {
        names.push("unrecognized state flags");
    }
    names
}

fn validate_label(value: &str, label: &str) -> Result<(), IntegratedRuntimeError> {
    let length = value.encode_utf16().count();
    if length == 0 || length > 180 || value.chars().any(char::is_control) {
        return Err(IntegratedRuntimeError::new(
            "invalid-label",
            format!("{label} must contain 1..180 visible UTF-16 code units"),
        ));
    }
    Ok(())
}

fn reject_batch(
    batch_id: &str,
    code: impl Into<String>,
    message: &str,
    current: IntegratedRuntimeIdentityV2,
) -> IntegratedRuntimeReceiptV2 {
    IntegratedRuntimeReceiptV2::Rejected(IntegratedRuntimeRejectionV2 {
        batch_id: batch_id.to_owned(),
        code: code.into(),
        message: message.to_owned(),
        current,
    })
}

fn runtime_command_receipt_key_hash_v1(receipt: &RuntimeCommandReceiptV1) -> (&str, WireHash) {
    match receipt {
        RuntimeCommandReceiptV1::Accepted {
            idempotency_key,
            command_hash,
            ..
        }
        | RuntimeCommandReceiptV1::Rejected {
            idempotency_key,
            command_hash,
            ..
        } => (idempotency_key, *command_hash),
    }
}

fn runtime_command_receipt_cache_entry_bytes_v1(actor_id: &str, idempotency_key: &str, receipt_bytes: usize) -> usize {
    // Two u32 string lengths, the exact labels, the command hash, and one u32
    // receipt length are all included in the durable aggregate bound.
    4_usize
        .saturating_add(actor_id.len())
        .saturating_add(4)
        .saturating_add(idempotency_key.len())
        .saturating_add(16)
        .saturating_add(4)
        .saturating_add(receipt_bytes)
}

fn validate_runtime_command_receipt_cache_v1(
    entries: &BTreeMap<(String, String), IntegratedRuntimeCommandReceiptCacheEntryV1>,
    order: &VecDeque<(String, String)>,
    expected_bytes: usize,
) -> Result<(), IntegratedRuntimeError> {
    if entries.len() != order.len() || entries.len() > INTEGRATED_RUNTIME_MAX_IDEMPOTENCY_RECEIPTS {
        return Err(IntegratedRuntimeError::new(
            "native-command-receipt-order",
            "command receipt cache map and insertion order are inconsistent",
        ));
    }
    let mut seen = BTreeSet::new();
    let mut total = 0_usize;
    for key in order {
        if !seen.insert(key.clone()) {
            return Err(IntegratedRuntimeError::new(
                "native-command-receipt-duplicate",
                "command receipt cache insertion order repeats a key",
            ));
        }
        let entry = entries.get(key).ok_or_else(|| {
            IntegratedRuntimeError::new(
                "native-command-receipt-order",
                "command receipt cache insertion order references a missing entry",
            )
        })?;
        let canonical = encode_command_receipt_v1(&entry.receipt)
            .map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
        let (receipt_key, receipt_hash) = runtime_command_receipt_key_hash_v1(&entry.receipt);
        if key.0.is_empty()
            || key.0.len() > 160
            || key.1.is_empty()
            || key.1.len() > 256
            || receipt_key != key.1
            || receipt_hash != entry.command_hash
            || canonical != entry.encoded_receipt
        {
            return Err(IntegratedRuntimeError::new(
                "native-command-receipt-mismatch",
                "command receipt cache entry is not canonical for its key and hash",
            ));
        }
        validate_command_receipt_hash_v1(&entry.receipt)
            .map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
        total = total.saturating_add(runtime_command_receipt_cache_entry_bytes_v1(
            &key.0,
            &key.1,
            entry.encoded_receipt.len(),
        ));
    }
    if total != expected_bytes || total > INTEGRATED_RUNTIME_MAX_COMMAND_RECEIPT_CACHE_BYTES_V1 {
        return Err(IntegratedRuntimeError::new(
            "native-command-receipt-capacity",
            "command receipt cache aggregate byte accounting is invalid",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegratedRuntimeError {
    pub code: String,
    pub message: String,
}

impl IntegratedRuntimeError {
    #[must_use]
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn domain(domain: &str, error: impl fmt::Display) -> Self {
        Self::new(format!("{domain}-error"), error.to_string())
    }
}

impl fmt::Display for IntegratedRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for IntegratedRuntimeError {}

impl From<ContractError> for IntegratedRuntimeError {
    fn from(error: ContractError) -> Self {
        Self::domain("simulation", error)
    }
}

#[derive(Default)]
struct NativeWriterV1 {
    bytes: Vec<u8>,
}

impl NativeWriterV1 {
    fn raw(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }

    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn bool(&mut self, value: bool) {
        self.u8(u8::from(value));
    }

    fn u16(&mut self, value: u16) {
        self.raw(&value.to_le_bytes());
    }

    fn i16(&mut self, value: i16) {
        self.raw(&value.to_le_bytes());
    }

    fn u32(&mut self, value: u32) {
        self.raw(&value.to_le_bytes());
    }

    fn i32(&mut self, value: i32) {
        self.raw(&value.to_le_bytes());
    }

    fn u64(&mut self, value: u64) {
        self.raw(&value.to_le_bytes());
    }

    fn f64(&mut self, value: f64) {
        self.u64(value.to_bits());
    }

    fn hash(&mut self, value: CanonicalHash) {
        self.raw(value.as_bytes());
    }

    fn string(&mut self, value: &str) -> Result<(), IntegratedRuntimeError> {
        if value.len() > 16 * 1024 {
            return Err(IntegratedRuntimeError::new(
                "native-string-capacity",
                "native save string exceeds 16 KiB",
            ));
        }
        self.u32(u32::try_from(value.len()).map_err(|_| {
            IntegratedRuntimeError::new("native-string-capacity", "native save string length exceeds u32")
        })?);
        self.raw(value.as_bytes());
        Ok(())
    }

    fn bytes(&mut self, value: &[u8]) -> Result<(), IntegratedRuntimeError> {
        if value.len() > NATIVE_RECORD_MAX_BYTES_V1 {
            return Err(IntegratedRuntimeError::new(
                "native-record-capacity",
                "native save field exceeds 64 MiB",
            ));
        }
        self.u32(u32::try_from(value.len()).map_err(|_| {
            IntegratedRuntimeError::new("native-record-capacity", "native save field length exceeds u32")
        })?);
        self.raw(value);
        Ok(())
    }

    fn address(&mut self, value: &RecordAddress) -> Result<(), IntegratedRuntimeError> {
        self.string(&value.universe_id)?;
        self.string(&value.location_id)?;
        self.u8(value.kind as u8);
        self.string(&value.record_id)
    }

    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

struct NativeReaderV1<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> NativeReaderV1<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], IntegratedRuntimeError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| IntegratedRuntimeError::new("native-record-overflow", "native save offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| IntegratedRuntimeError::new("native-record-truncated", "native save record is truncated"))?;
        self.offset = end;
        Ok(value)
    }

    fn magic(&mut self, expected: &[u8]) -> Result<(), IntegratedRuntimeError> {
        if self.take(expected.len())? != expected {
            return Err(IntegratedRuntimeError::new(
                "native-record-magic",
                "native save record magic does not match",
            ));
        }
        Ok(())
    }

    fn u8(&mut self) -> Result<u8, IntegratedRuntimeError> {
        Ok(self.take(1)?[0])
    }

    fn bool(&mut self) -> Result<bool, IntegratedRuntimeError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(IntegratedRuntimeError::new(
                "native-record-flag",
                "native save boolean flag is invalid",
            )),
        }
    }

    fn u16(&mut self) -> Result<u16, IntegratedRuntimeError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("fixed slice")))
    }

    fn i16(&mut self) -> Result<i16, IntegratedRuntimeError> {
        Ok(i16::from_le_bytes(self.take(2)?.try_into().expect("fixed slice")))
    }

    fn u32(&mut self) -> Result<u32, IntegratedRuntimeError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }

    fn i32(&mut self) -> Result<i32, IntegratedRuntimeError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }

    fn u64(&mut self) -> Result<u64, IntegratedRuntimeError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().expect("fixed slice")))
    }

    fn f64(&mut self) -> Result<f64, IntegratedRuntimeError> {
        let value = f64::from_bits(self.u64()?);
        if !value.is_finite() {
            return Err(IntegratedRuntimeError::new(
                "native-record-number",
                "native save contains a non-finite number",
            ));
        }
        Ok(value)
    }

    fn hash(&mut self) -> Result<CanonicalHash, IntegratedRuntimeError> {
        Ok(CanonicalHash(self.take(16)?.try_into().expect("fixed slice")))
    }

    fn string(&mut self) -> Result<String, IntegratedRuntimeError> {
        let length = self.u32()? as usize;
        if length > 16 * 1024 {
            return Err(IntegratedRuntimeError::new(
                "native-string-capacity",
                "native save string exceeds 16 KiB",
            ));
        }
        String::from_utf8(self.take(length)?.to_vec())
            .map_err(|_| IntegratedRuntimeError::new("native-record-utf8", "native save string is not valid UTF-8"))
    }

    fn bytes(&mut self, maximum: usize) -> Result<Vec<u8>, IntegratedRuntimeError> {
        let length = self.u32()? as usize;
        if length > maximum {
            return Err(IntegratedRuntimeError::new(
                "native-record-capacity",
                "native save byte field exceeds its bound",
            ));
        }
        Ok(self.take(length)?.to_vec())
    }

    fn count(&mut self, maximum: usize, label: &str) -> Result<usize, IntegratedRuntimeError> {
        let value = self.u32()? as usize;
        if value > maximum {
            return Err(IntegratedRuntimeError::new(
                "native-record-capacity",
                format!("native save {label} count exceeds its bound"),
            ));
        }
        Ok(value)
    }

    fn address(&mut self) -> Result<RecordAddress, IntegratedRuntimeError> {
        let universe_id = self.string()?;
        let location_id = self.string()?;
        let kind = RecordKind::from_tag(self.u8()?)
            .map_err(|error| IntegratedRuntimeError::domain("native-record-address", error))?;
        let record_id = self.string()?;
        RecordAddress::new(universe_id, location_id, kind, record_id)
            .map_err(|error| IntegratedRuntimeError::domain("native-record-address", error))
    }

    fn finish(&self) -> Result<(), IntegratedRuntimeError> {
        if self.offset != self.bytes.len() {
            return Err(IntegratedRuntimeError::new(
                "native-record-trailing",
                "native save record contains trailing bytes",
            ));
        }
        Ok(())
    }
}

fn runtime_checkpoint_hash_v1(bytes: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-integrated-runtime-checkpoint-v1");
    hasher.write_bytes(bytes);
    hasher.finish()
}

fn native_persistence_payload_hash_v1(bytes: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-persistence-record-v1");
    hasher.write_bytes(bytes);
    hasher.finish()
}

pub fn integrated_runtime_checkpoint_hash_v1(bytes: &[u8]) -> CanonicalHash {
    runtime_checkpoint_hash_v1(bytes)
}

fn native_bundle_hash_v1(
    universe_id: &str,
    location_id: &str,
    generator_hash: CanonicalHash,
    content_hash: CanonicalHash,
    bodies: &BTreeMap<IntegratedRuntimeNativeRecordKindV1, Vec<u8>>,
) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-integrated-native-save-bundle-v1");
    hasher.write_str(universe_id);
    hasher.write_str(location_id);
    hasher.write_bytes(generator_hash.as_bytes());
    hasher.write_bytes(content_hash.as_bytes());
    hasher.write_u32(bodies.len() as u32);
    for (kind, body) in bodies {
        hasher.write_u16(*kind as u16);
        hasher.write_bytes(body);
    }
    hasher.finish()
}

fn encode_native_record_envelope_v1(
    value: &IntegratedRuntimeNativeEnvelopeV1,
) -> Result<Vec<u8>, IntegratedRuntimeError> {
    if value.body.len() > NATIVE_RECORD_MAX_BYTES_V1 {
        return Err(IntegratedRuntimeError::new(
            "native-record-capacity",
            "native authority record exceeds 64 MiB",
        ));
    }
    let mut writer = NativeWriterV1::default();
    writer.raw(NATIVE_RECORD_MAGIC_V1);
    writer.u16(NATIVE_RECORD_SCHEMA_V1);
    writer.u8(value.kind as u8);
    writer.string(&value.universe_id)?;
    writer.string(&value.location_id)?;
    writer.hash(value.generator_hash);
    writer.hash(value.content_hash);
    writer.hash(value.bundle_hash);
    writer.hash(native_persistence_payload_hash_v1(&value.body));
    writer.bytes(&value.body)?;
    let encoded = writer.finish();
    if encoded.len() > NATIVE_RECORD_MAX_BYTES_V1 {
        return Err(IntegratedRuntimeError::new(
            "native-record-capacity",
            "native authority envelope exceeds the 64 MiB persistence record lane",
        ));
    }
    Ok(encoded)
}

fn decode_native_record_envelope_v1(bytes: &[u8]) -> Result<IntegratedRuntimeNativeEnvelopeV1, IntegratedRuntimeError> {
    if bytes.len() > NATIVE_RECORD_MAX_BYTES_V1 {
        return Err(IntegratedRuntimeError::new(
            "native-record-capacity",
            "native authority record exceeds 64 MiB",
        ));
    }
    let mut reader = NativeReaderV1::new(bytes);
    reader.magic(NATIVE_RECORD_MAGIC_V1)?;
    if reader.u16()? != NATIVE_RECORD_SCHEMA_V1 {
        return Err(IntegratedRuntimeError::new(
            "native-record-schema",
            "native authority record schema is unsupported",
        ));
    }
    let kind = IntegratedRuntimeNativeRecordKindV1::from_tag(reader.u8()?)?;
    let universe_id = reader.string()?;
    let location_id = reader.string()?;
    let generator_hash = reader.hash()?;
    let content_hash = reader.hash()?;
    let bundle_hash = reader.hash()?;
    let expected_body_hash = reader.hash()?;
    let body = reader.bytes(NATIVE_RECORD_MAX_BYTES_V1)?;
    reader.finish()?;
    if native_persistence_payload_hash_v1(&body) != expected_body_hash {
        return Err(IntegratedRuntimeError::new(
            "native-record-corrupt",
            "native authority record payload hash does not match",
        ));
    }
    Ok(IntegratedRuntimeNativeEnvelopeV1 {
        kind,
        universe_id,
        location_id,
        generator_hash,
        content_hash,
        bundle_hash,
        body,
    })
}

fn native_bundle_body_v1(
    bundle: &IntegratedRuntimeNativeBundleV1,
    kind: IntegratedRuntimeNativeRecordKindV1,
) -> Result<&[u8], IntegratedRuntimeError> {
    bundle
        .envelopes
        .get(&kind)
        .map(|envelope| envelope.body.as_slice())
        .ok_or_else(|| {
            IntegratedRuntimeError::new(
                "recovery-native-missing",
                "native authority bundle is missing a required record",
            )
        })
}

fn decode_and_validate_native_bundle_v1(
    bundle: &IntegratedRuntimeNativeBundleV1,
) -> Result<IntegratedRuntimeCoreSnapshotV1, IntegratedRuntimeError> {
    if bundle.envelopes.len() != IntegratedRuntimeNativeRecordKindV1::ALL.len() {
        return Err(IntegratedRuntimeError::new(
            "recovery-native-missing",
            "native authority bundle does not contain exactly six required records",
        ));
    }
    let first =
        bundle.envelopes.values().next().ok_or_else(|| {
            IntegratedRuntimeError::new("recovery-native-missing", "native authority bundle is empty")
        })?;
    let mut bodies = BTreeMap::new();
    for kind in IntegratedRuntimeNativeRecordKindV1::ALL {
        let envelope = bundle.envelopes.get(&kind).ok_or_else(|| {
            IntegratedRuntimeError::new("recovery-native-missing", "native authority record is missing")
        })?;
        if envelope.kind != kind
            || envelope.universe_id != first.universe_id
            || envelope.location_id != first.location_id
            || envelope.generator_hash != first.generator_hash
            || envelope.content_hash != first.content_hash
            || envelope.bundle_hash != bundle.bundle_hash
        {
            return Err(IntegratedRuntimeError::new(
                "recovery-native-identity",
                "native authority records do not share one world/content/generator identity",
            ));
        }
        bodies.insert(kind, envelope.body.clone());
    }
    if native_bundle_hash_v1(
        &first.universe_id,
        &first.location_id,
        first.generator_hash,
        first.content_hash,
        &bodies,
    ) != bundle.bundle_hash
    {
        return Err(IntegratedRuntimeError::new(
            "recovery-native-corrupt",
            "native authority bundle root hash does not match its records",
        ));
    }
    let core = decode_runtime_core_snapshot_v1(native_bundle_body_v1(
        bundle,
        IntegratedRuntimeNativeRecordKindV1::Runtime,
    )?)?;
    if core.config.universe_id != first.universe_id
        || core.config.location_id != first.location_id
        || core.config.generator_hash != first.generator_hash
        || core.config.content_hash != first.content_hash
    {
        return Err(IntegratedRuntimeError::new(
            "recovery-native-config",
            "runtime core configuration does not match the native record envelope",
        ));
    }
    Ok(core)
}

fn write_runtime_config_v1(
    writer: &mut NativeWriterV1,
    config: &IntegratedRuntimeConfigV2,
    schema: u16,
) -> Result<(), IntegratedRuntimeError> {
    writer.string(&config.world_seed)?;
    writer.string(&config.universe_id)?;
    writer.string(&config.location_id)?;
    writer.string(&config.session_id)?;
    writer.hash(config.content_hash);
    writer.hash(config.generator_hash);
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V4 {
        writer.hash(config.terrain_content_hash);
        writer.string(&config.generation_options_json)?;
    }
    writer.u16(config.block_catalog.water_block_id);
    writer.u32(config.block_catalog.directional_blocks.len() as u32);
    for value in &config.block_catalog.directional_blocks {
        writer.u16(*value);
    }
    writer.u32(config.block_catalog.waterlogged_blocks.len() as u32);
    for value in &config.block_catalog.waterlogged_blocks {
        writer.u16(*value);
    }
    Ok(())
}

fn read_runtime_config_v1(
    reader: &mut NativeReaderV1<'_>,
    schema: u16,
) -> Result<IntegratedRuntimeConfigV2, IntegratedRuntimeError> {
    let world_seed = reader.string()?;
    let universe_id = reader.string()?;
    let location_id = reader.string()?;
    let session_id = reader.string()?;
    let content_hash = reader.hash()?;
    let generator_hash = reader.hash()?;
    let terrain_content_hash = if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V4 {
        reader.hash()?
    } else {
        DEFAULT_TERRAIN_CONTENT_HASH_V2
    };
    let generation_options_json = if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V4 {
        reader.string()?
    } else {
        DEFAULT_GENERATION_OPTIONS_JSON_V1.into()
    };
    let water_block_id = reader.u16()?;
    let directional_count = reader.count(u16::MAX as usize + 1, "directional blocks")?;
    let mut directional_blocks = BTreeSet::new();
    for _ in 0..directional_count {
        if !directional_blocks.insert(reader.u16()?) {
            return Err(IntegratedRuntimeError::new(
                "native-record-duplicate",
                "runtime block catalog repeats a directional block",
            ));
        }
    }
    let waterlogged_count = reader.count(u16::MAX as usize + 1, "waterlogged blocks")?;
    let mut waterlogged_blocks = BTreeSet::new();
    for _ in 0..waterlogged_count {
        if !waterlogged_blocks.insert(reader.u16()?) {
            return Err(IntegratedRuntimeError::new(
                "native-record-duplicate",
                "runtime block catalog repeats a waterlogged block",
            ));
        }
    }
    let config = IntegratedRuntimeConfigV2 {
        world_seed,
        universe_id,
        location_id,
        session_id,
        terrain_content_hash,
        generation_options_json,
        content_hash,
        generator_hash,
        block_catalog: BlockCatalogV1 {
            directional_blocks,
            waterlogged_blocks,
            water_block_id,
        },
    };
    config.validate()?;
    Ok(config)
}

fn write_runtime_revision_v1(writer: &mut NativeWriterV1, revision: IntegratedRuntimeRevisionV2) {
    for value in [
        revision.epoch,
        revision.world,
        revision.entities,
        revision.gameplay,
        revision.persistence,
        revision.network,
        revision.simulation,
    ] {
        writer.u64(value);
    }
}

fn read_runtime_revision_v1(
    reader: &mut NativeReaderV1<'_>,
) -> Result<IntegratedRuntimeRevisionV2, IntegratedRuntimeError> {
    Ok(IntegratedRuntimeRevisionV2 {
        epoch: reader.u64()?,
        world: reader.u64()?,
        entities: reader.u64()?,
        gameplay: reader.u64()?,
        persistence: reader.u64()?,
        network: reader.u64()?,
        simulation: reader.u64()?,
    })
}

fn write_runtime_input_v1(writer: &mut NativeWriterV1, value: RuntimeInputFrameV1) {
    writer.u64(value.sequence);
    writer.u64(value.target_tick);
    writer.i16(value.move_x);
    writer.i16(value.move_z);
    writer.i16(value.look_yaw);
    writer.i16(value.look_pitch);
    writer.u32(value.buttons);
    writer.u8(value.selected_slot);
    writer.u8(value.flags);
}

fn read_runtime_input_v1(reader: &mut NativeReaderV1<'_>) -> Result<RuntimeInputFrameV1, IntegratedRuntimeError> {
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
    if value.buttons & !RUNTIME_INPUT_BUTTON_MASK_V1 != 0 || value.flags & !RUNTIME_INPUT_FLAG_MASK_V1 != 0 {
        return Err(IntegratedRuntimeError::new(
            "native-input-flags",
            "runtime checkpoint contains unsupported input flags",
        ));
    }
    Ok(value)
}

fn write_mining_state_native_v1(writer: &mut NativeWriterV1, state: &IntegratedRuntimeMiningStateV1) {
    writer.u64(state.player_entity_id);
    writer.i32(state.target.x);
    writer.i32(state.target.y);
    writer.i32(state.target.z);
    writer.u16(state.target_block_id);
    writer.u64(state.world_revision.epoch);
    writer.u64(state.world_revision.mutation);
    writer.u64(state.world_revision.residency);
    writer.u8(state.selected_slot);
    writer.u32(state.held_item_code);
    writer.hash(state.held_metadata_hash);
    writer.bool(state.held_durability_millionths.is_some());
    if let Some(value) = state.held_durability_millionths {
        writer.u32(value);
    }
    writer.hash(state.tool_profile_hash);
    writer.u64(state.progress_millionths);
    writer.u64(state.required_work_millionths);
    writer.u64(state.started_tick);
    writer.u64(state.last_advanced_tick);
}

fn read_mining_state_native_v1(
    reader: &mut NativeReaderV1<'_>,
    tick: u64,
    player: Option<&IntegratedRuntimePlayerStateV2>,
) -> Result<IntegratedRuntimeMiningStateV1, IntegratedRuntimeError> {
    let state = IntegratedRuntimeMiningStateV1 {
        player_entity_id: reader.u64()?,
        target: CellPositionV1 {
            x: reader.i32()?,
            y: reader.i32()?,
            z: reader.i32()?,
        },
        target_block_id: reader.u16()?,
        world_revision: WorldAuthorityRevisionV1 {
            epoch: reader.u64()?,
            mutation: reader.u64()?,
            residency: reader.u64()?,
        },
        selected_slot: reader.u8()?,
        held_item_code: reader.u32()?,
        held_metadata_hash: reader.hash()?,
        held_durability_millionths: if reader.bool()? { Some(reader.u32()?) } else { None },
        tool_profile_hash: reader.hash()?,
        progress_millionths: reader.u64()?,
        required_work_millionths: reader.u64()?,
        started_tick: reader.u64()?,
        last_advanced_tick: reader.u64()?,
    };
    if state.player_entity_id == 0
        || player.is_none_or(|player| player.entity_id.packed() != state.player_entity_id)
        || state.target_block_id == WORLD_AIR_BLOCK_ID_V1
        || state.target.y < WORLD_MIN_Y_V1
        || state.target.y > WORLD_MAX_Y_V1
        || state.selected_slot > 8
        || state.held_durability_millionths.is_some_and(|value| value > 1_000_000)
        || state.tool_profile_hash == CanonicalHash::default()
        || state.required_work_millionths == 0
        || state.progress_millionths >= state.required_work_millionths
        || state.started_tick > state.last_advanced_tick
        || state.last_advanced_tick > tick
    {
        return Err(IntegratedRuntimeError::new(
            "native-mining-state",
            "runtime checkpoint mining state is invalid or unbounded",
        ));
    }
    state
        .world_revision
        .validate()
        .map_err(|error| IntegratedRuntimeError::domain("native-mining-state", error))?;
    Ok(state)
}

fn write_block_action_rng_cursor_native_v1(writer: &mut NativeWriterV1, cursor: BlockActionLootRngCursorV1) {
    writer.u32(cursor.state);
    writer.u64(cursor.draw_count);
}

fn read_block_action_rng_cursor_native_v1(
    reader: &mut NativeReaderV1<'_>,
) -> Result<BlockActionLootRngCursorV1, IntegratedRuntimeError> {
    let cursor = BlockActionLootRngCursorV1 {
        state: reader.u32()?,
        draw_count: reader.u64()?,
    };
    cursor
        .validate_v1()
        .map_err(|error| IntegratedRuntimeError::new("native-block-action-rng", error.message))?;
    Ok(cursor)
}

fn write_block_action_binding_native_v1(
    writer: &mut NativeWriterV1,
    binding: &BlockActionLootBindingV1,
) -> Result<(), IntegratedRuntimeError> {
    writer.hash(binding.manifest_hash);
    writer.hash(binding.installed_registry_hash);
    writer.u16(binding.catalog_schema_version);
    writer.u32(binding.catalog_content_version);
    writer.hash(binding.catalog_blob_hash);
    writer.hash(binding.action_report_hash);
    writer.string(&binding.rng_semantics_version_id)?;
    writer.hash(binding.rng_semantics_hash);
    writer.string(&binding.implementation_version_id)?;
    writer.hash(binding.implementation_hash);
    Ok(())
}

fn read_block_action_binding_native_v1(
    reader: &mut NativeReaderV1<'_>,
) -> Result<BlockActionLootBindingV1, IntegratedRuntimeError> {
    let binding = BlockActionLootBindingV1 {
        manifest_hash: reader.hash()?,
        installed_registry_hash: reader.hash()?,
        catalog_schema_version: reader.u16()?,
        catalog_content_version: reader.u32()?,
        catalog_blob_hash: reader.hash()?,
        action_report_hash: reader.hash()?,
        rng_semantics_version_id: reader.string()?,
        rng_semantics_hash: reader.hash()?,
        implementation_version_id: reader.string()?,
        implementation_hash: reader.hash()?,
    };
    binding
        .validate_v1()
        .map_err(|error| IntegratedRuntimeError::new("native-block-action-binding", error.message))?;
    Ok(binding)
}

fn write_block_action_plan_native_v1(
    writer: &mut NativeWriterV1,
    plan: &BlockActionLootPlanV1,
) -> Result<(), IntegratedRuntimeError> {
    plan.validate_hash_v1()
        .map_err(|error| IntegratedRuntimeError::new("native-block-action-plan", error.message))?;
    writer.u16(plan.schema_version);
    write_block_action_binding_native_v1(writer, &plan.binding)?;
    writer.u64(plan.context.block_action_sequence);
    writer.u64(plan.context.origin_input_sequence);
    writer.u16(plan.context.block_id);
    writer.i32(plan.context.position.x);
    writer.i32(plan.context.position.y);
    writer.i32(plan.context.position.z);
    writer.bool(plan.context.harvested);
    writer.bool(plan.context.creative_mode);
    writer.bool(plan.context.scythe);
    write_block_action_rng_cursor_native_v1(writer, plan.rng_before);
    writer.u32(plan.draws.len() as u32);
    for draw in &plan.draws {
        writer.u16(draw.index);
        writer.bool(draw.rule_ordinal.is_some());
        if let Some(ordinal) = draw.rule_ordinal {
            writer.u16(ordinal);
        }
        writer.u8(match draw.purpose {
            BlockActionRngDrawPurposeV1::RandomGate => 0,
            BlockActionRngDrawPurposeV1::RandomCount => 1,
            BlockActionRngDrawPurposeV1::SharedExclusive => 2,
            BlockActionRngDrawPurposeV1::SharedPlantYield => 3,
        });
        writer.u32(draw.value);
    }
    writer.u32(plan.outcomes.len() as u32);
    for outcome in &plan.outcomes {
        writer.u16(outcome.ordinal);
        writer.string(&outcome.rule_id)?;
        writer.u32(outcome.item_code);
        writer.bool(outcome.selected);
        writer.u32(outcome.count);
        writer.bool(outcome.gate_draw_index.is_some());
        if let Some(index) = outcome.gate_draw_index {
            writer.u16(index);
        }
        writer.bool(outcome.count_draw_index.is_some());
        if let Some(index) = outcome.count_draw_index {
            writer.u16(index);
        }
    }
    writer.u32(plan.stacks.len() as u32);
    for stack in &plan.stacks {
        writer.u16(stack.group_ordinal);
        writer.u32(stack.item_code);
        writer.hash(stack.metadata_hash);
        writer.u32(stack.count);
    }
    write_block_action_rng_cursor_native_v1(writer, plan.rng_after);
    writer.hash(plan.plan_hash);
    Ok(())
}

fn read_block_action_plan_native_v1(
    reader: &mut NativeReaderV1<'_>,
) -> Result<BlockActionLootPlanV1, IntegratedRuntimeError> {
    let schema_version = reader.u16()?;
    let binding = read_block_action_binding_native_v1(reader)?;
    let context = BlockActionLootContextV1 {
        block_action_sequence: reader.u64()?,
        origin_input_sequence: reader.u64()?,
        block_id: reader.u16()?,
        position: BlockActionLootCellV1 {
            x: reader.i32()?,
            y: reader.i32()?,
            z: reader.i32()?,
        },
        harvested: reader.bool()?,
        creative_mode: reader.bool()?,
        scythe: reader.bool()?,
    };
    context
        .validate_v1()
        .map_err(|error| IntegratedRuntimeError::new("native-block-action-context", error.message))?;
    let rng_before = read_block_action_rng_cursor_native_v1(reader)?;
    let draw_count = reader.count(blockwild_gameplay::MAX_BLOCK_ACTION_LOOT_DRAWS_V1, "block-action draws")?;
    let mut draws = Vec::with_capacity(draw_count);
    for _ in 0..draw_count {
        let index = reader.u16()?;
        let rule_ordinal = if reader.bool()? { Some(reader.u16()?) } else { None };
        let purpose = match reader.u8()? {
            0 => BlockActionRngDrawPurposeV1::RandomGate,
            1 => BlockActionRngDrawPurposeV1::RandomCount,
            2 => BlockActionRngDrawPurposeV1::SharedExclusive,
            3 => BlockActionRngDrawPurposeV1::SharedPlantYield,
            _ => {
                return Err(IntegratedRuntimeError::new(
                    "native-block-action-draw",
                    "block-action receipt contains an unknown RNG draw purpose",
                ));
            }
        };
        draws.push(BlockActionRngDrawV1 {
            index,
            rule_ordinal,
            purpose,
            value: reader.u32()?,
        });
    }
    let outcome_count = reader.count(blockwild_gameplay::MAX_BLOCK_LOOT_RULES, "block-action outcomes")?;
    let mut outcomes = Vec::with_capacity(outcome_count);
    for _ in 0..outcome_count {
        outcomes.push(BlockActionLootRuleOutcomeV1 {
            ordinal: reader.u16()?,
            rule_id: reader.string()?,
            item_code: reader.u32()?,
            selected: reader.bool()?,
            count: reader.u32()?,
            gate_draw_index: if reader.bool()? { Some(reader.u16()?) } else { None },
            count_draw_index: if reader.bool()? { Some(reader.u16()?) } else { None },
        });
    }
    let stack_count = reader.count(
        blockwild_gameplay::MAX_BLOCK_ACTION_GENERATED_DROPS_V1,
        "block-action generated stacks",
    )?;
    let mut stacks = Vec::with_capacity(stack_count);
    for _ in 0..stack_count {
        stacks.push(BlockActionGeneratedStackV1 {
            group_ordinal: reader.u16()?,
            item_code: reader.u32()?,
            metadata_hash: reader.hash()?,
            count: reader.u32()?,
        });
    }
    let plan = BlockActionLootPlanV1 {
        schema_version,
        binding,
        context,
        rng_before,
        draws,
        outcomes,
        stacks,
        rng_after: read_block_action_rng_cursor_native_v1(reader)?,
        plan_hash: reader.hash()?,
    };
    plan.validate_hash_v1()
        .map_err(|error| IntegratedRuntimeError::new("native-block-action-plan", error.message))?;
    Ok(plan)
}

fn write_block_action_receipt_native_v1(
    writer: &mut NativeWriterV1,
    receipt: &IntegratedRuntimeBlockActionReceiptV1,
) -> Result<(), IntegratedRuntimeError> {
    receipt.validate_shape_v1()?;
    writer.u16(receipt.schema_version);
    write_block_action_plan_native_v1(writer, &receipt.plan)?;
    writer.u32(receipt.generated_drops.len() as u32);
    for generated in &receipt.generated_drops {
        let provenance = &generated.provenance;
        writer.u16(provenance.schema_version);
        writer.hash(provenance.manifest_hash);
        writer.hash(provenance.installed_registry_hash);
        writer.hash(provenance.catalog_blob_hash);
        writer.hash(provenance.action_report_hash);
        writer.hash(provenance.rng_semantics_hash);
        writer.u64(provenance.block_action_sequence);
        writer.u64(provenance.origin_input_sequence);
        writer.u16(provenance.block_id);
        writer.i32(provenance.position.x);
        writer.i32(provenance.position.y);
        writer.i32(provenance.position.z);
        writer.hash(provenance.loot_plan_hash);
        writer.u16(provenance.group_ordinal);
        writer.u64(generated.entity_id.packed());
    }
    writer.hash(receipt.receipt_hash);
    Ok(())
}

fn read_block_action_receipt_native_v1(
    reader: &mut NativeReaderV1<'_>,
) -> Result<IntegratedRuntimeBlockActionReceiptV1, IntegratedRuntimeError> {
    let schema_version = reader.u16()?;
    let plan = read_block_action_plan_native_v1(reader)?;
    let count = reader.count(
        blockwild_gameplay::MAX_BLOCK_ACTION_GENERATED_DROPS_V1,
        "block-action generated-drop receipts",
    )?;
    let mut generated_drops = Vec::with_capacity(count);
    for _ in 0..count {
        let provenance = GeneratedDropProvenanceV1 {
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
        };
        let packed = reader.u64()?;
        generated_drops.push(IntegratedRuntimeGeneratedDropReceiptV1 {
            provenance,
            entity_id: EntityId::new(packed as u32, (packed >> 32) as u32),
        });
    }
    let receipt = IntegratedRuntimeBlockActionReceiptV1 {
        schema_version,
        plan,
        generated_drops,
        receipt_hash: reader.hash()?,
    };
    receipt.validate_shape_v1()?;
    Ok(receipt)
}

fn write_camera_state_native_v1(
    writer: &mut NativeWriterV1,
    camera: IntegratedRuntimeCameraStateV1,
) -> Result<(), IntegratedRuntimeError> {
    if camera.revision > MAX_SAFE_U64 {
        return Err(IntegratedRuntimeError::new(
            "native-camera-revision",
            "camera configuration revision exceeds the browser-safe range",
        ));
    }
    validate_runtime_camera_profile_bounds_v1(camera.profile)?;
    writer.u64(camera.revision);
    writer.u8(match camera.mode {
        CameraModeV1::FirstPerson => 0,
        CameraModeV1::ThirdRear => 1,
        CameraModeV1::ThirdFront => 2,
    });
    for value in camera_profile_values_v1(camera.profile) {
        writer.f64(value);
    }
    writer.i16(camera.look_yaw);
    writer.i16(camera.look_pitch);
    Ok(())
}

fn read_camera_state_native_v1(
    reader: &mut NativeReaderV1<'_>,
) -> Result<IntegratedRuntimeCameraStateV1, IntegratedRuntimeError> {
    let revision = reader.u64()?;
    if revision > MAX_SAFE_U64 {
        return Err(IntegratedRuntimeError::new(
            "native-camera-revision",
            "camera configuration revision exceeds the browser-safe range",
        ));
    }
    let mode = match reader.u8()? {
        0 => CameraModeV1::FirstPerson,
        1 => CameraModeV1::ThirdRear,
        2 => CameraModeV1::ThirdFront,
        _ => {
            return Err(IntegratedRuntimeError::new(
                "native-camera-mode",
                "runtime core contains an unknown camera mode",
            ));
        }
    };
    let profile = CameraProfileV1 {
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
    validate_runtime_camera_profile_bounds_v1(profile)?;
    Ok(IntegratedRuntimeCameraStateV1 {
        revision,
        mode,
        profile,
        look_yaw: reader.i16()?,
        look_pitch: reader.i16()?,
    })
}

fn write_runtime_player_v1(
    writer: &mut NativeWriterV1,
    player: &IntegratedRuntimePlayerStateV2,
    schema: u16,
) -> Result<(), IntegratedRuntimeError> {
    let binding = &player.binding;
    writer.string(&binding.external_entity_id)?;
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V2 {
        writer.string(&binding.actor_id)?;
        writer.u64(binding.player_id.packed());
        writer.bool(binding.creative_mode);
    }
    for value in [
        binding.radius,
        binding.standing_height,
        binding.crouching_height,
        binding.mass,
        binding.walk_speed,
        binding.sprint_speed,
        binding.creative_flight_speed,
        binding.maximum_oxygen_seconds,
    ] {
        writer.f64(value);
    }
    writer.u64(player.entity_id.packed());
    let body = &player.body;
    writer.string(&body.handle)?;
    for value in [
        body.position.x,
        body.position.y,
        body.position.z,
        body.velocity.x,
        body.velocity.y,
        body.velocity.z,
        body.radius,
        body.height,
        body.mass,
        body.fall_distance,
        body.oxygen_seconds,
        body.drowning_accumulator,
        body.swim_entry_momentum_speed,
        body.swim_surface_breach_seconds,
        body.swim_stroke_cooldown_seconds,
    ] {
        writer.f64(value);
    }
    writer.bool(body.grounded);
    writer.bool(body.crouching);
    writer.bool(body.swim_surface_breach_ready);
    writer.bool(body.swim_surface_bob_active);
    writer.u16(player.contact_flags);
    writer.u8(player.selected_slot);
    writer.i16(player.look_pitch);
    writer.u32(player.buttons);
    writer.u8(player.flags);
    writer.u64(player.last_input_sequence);
    Ok(())
}

fn read_runtime_player_v1(
    reader: &mut NativeReaderV1<'_>,
    schema: u16,
) -> Result<IntegratedRuntimePlayerStateV2, IntegratedRuntimeError> {
    let external_entity_id = reader.string()?;
    let authority = if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V2 {
        let actor_id = reader.string()?;
        let packed = reader.u64()?;
        Some((
            actor_id,
            PlayerId::new(packed as u32, (packed >> 32) as u32),
            reader.bool()?,
        ))
    } else {
        None
    };
    let binding = RuntimePlayerBindingWireV1 {
        external_entity_id,
        actor_id: authority
            .as_ref()
            .map_or_else(String::new, |(actor_id, _, _)| actor_id.clone()),
        player_id: authority
            .as_ref()
            .map_or_else(PlayerId::default, |(_, player_id, _)| *player_id),
        creative_mode: authority.as_ref().is_some_and(|(_, _, creative)| *creative),
        radius: reader.f64()?,
        standing_height: reader.f64()?,
        crouching_height: reader.f64()?,
        mass: reader.f64()?,
        walk_speed: reader.f64()?,
        sprint_speed: reader.f64()?,
        creative_flight_speed: reader.f64()?,
        maximum_oxygen_seconds: reader.f64()?,
    };
    let packed_id = reader.u64()?;
    let entity_id = EntityId::new(packed_id as u32, (packed_id >> 32) as u32);
    let binding = if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V2 {
        binding
    } else {
        RuntimePlayerBindingWireV1 {
            actor_id: binding.external_entity_id.clone(),
            player_id: PlayerId::new(entity_id.0.index(), entity_id.0.generation()),
            ..binding
        }
    };
    binding
        .validate()
        .map_err(|error| IntegratedRuntimeError::new("native-player-binding", error.message))?;
    let body = PhysicsBodyV1 {
        handle: reader.string()?,
        position: SimulationVec3::new(reader.f64()?, reader.f64()?, reader.f64()?),
        velocity: SimulationVec3::new(reader.f64()?, reader.f64()?, reader.f64()?),
        radius: reader.f64()?,
        height: reader.f64()?,
        mass: reader.f64()?,
        fall_distance: reader.f64()?,
        oxygen_seconds: reader.f64()?,
        drowning_accumulator: reader.f64()?,
        swim_entry_momentum_speed: reader.f64()?,
        swim_surface_breach_seconds: reader.f64()?,
        swim_stroke_cooldown_seconds: reader.f64()?,
        grounded: reader.bool()?,
        crouching: reader.bool()?,
        swim_surface_breach_ready: reader.bool()?,
        swim_surface_bob_active: reader.bool()?,
    };
    if body.handle != binding.external_entity_id
        || body.radius <= 0.0
        || body.height <= 0.0
        || body.mass <= 0.0
        || body.fall_distance < 0.0
        || body.oxygen_seconds < 0.0
        || body.drowning_accumulator < 0.0
    {
        return Err(IntegratedRuntimeError::new(
            "native-player-state",
            "runtime checkpoint contains an invalid player body",
        ));
    }
    let contact_flags = reader.u16()?;
    let selected_slot = reader.u8()?;
    let look_pitch = reader.i16()?;
    let buttons = reader.u32()?;
    let flags = reader.u8()?;
    if buttons & !RUNTIME_INPUT_BUTTON_MASK_V1 != 0 || flags & !RUNTIME_INPUT_FLAG_MASK_V1 != 0 {
        return Err(IntegratedRuntimeError::new(
            "native-player-flags",
            "runtime checkpoint contains unsupported player flags",
        ));
    }
    Ok(IntegratedRuntimePlayerStateV2 {
        binding,
        entity_id,
        body,
        contact_flags,
        selected_slot,
        look_pitch,
        buttons,
        flags,
        last_input_sequence: reader.u64()?,
    })
}

fn write_compatibility_journal_v1(
    writer: &mut NativeWriterV1,
    journal: &JournalState,
) -> Result<(), IntegratedRuntimeError> {
    writer.u64(journal.sequence());
    writer.u32(journal.records().len() as u32);
    for (address, record) in journal.records() {
        writer.address(address)?;
        writer.u64(record.revision);
        writer.bytes(&record.payload)?;
    }
    Ok(())
}

fn read_compatibility_journal_v1(
    reader: &mut NativeReaderV1<'_>,
    config: &IntegratedRuntimeConfigV2,
) -> Result<JournalState, IntegratedRuntimeError> {
    let sequence = reader.u64()?;
    let count = reader.count(1_000_000, "compatibility journal records")?;
    let mut descriptors = Vec::with_capacity(count);
    let mut payloads = BTreeMap::new();
    for _ in 0..count {
        let address = reader.address()?;
        let revision = reader.u64()?;
        if revision == 0 {
            return Err(IntegratedRuntimeError::new(
                "native-journal-revision",
                "compatibility journal record revision must be non-zero",
            ));
        }
        let payload = reader.bytes(NATIVE_RECORD_MAX_BYTES_V1)?;
        let descriptor = RecordDescriptor {
            address: address.clone(),
            revision,
            byte_length: payload.len() as u32,
            payload_hash: native_persistence_payload_hash_v1(&payload),
        };
        if payloads.insert(address, payload).is_some() {
            return Err(IntegratedRuntimeError::new(
                "native-record-duplicate",
                "compatibility journal repeats a record address",
            ));
        }
        descriptors.push(descriptor);
    }
    let checkpoint = Checkpoint::new(
        format!("runtime-journal-{sequence}"),
        None,
        format!("{}@{}", config.universe_id, config.location_id),
        sequence,
        config.generator_hash,
        config.content_hash,
        0,
        descriptors,
    )
    .map_err(|error| IntegratedRuntimeError::domain("native-journal", error))?;
    JournalState::from_checkpoint(&checkpoint, &payloads)
        .map_err(|error| IntegratedRuntimeError::domain("native-journal", error))
}

fn runtime_core_snapshot_from_runtime_v1(runtime: &IntegratedRuntimeV2) -> IntegratedRuntimeCoreSnapshotV1 {
    IntegratedRuntimeCoreSnapshotV1 {
        schema: NATIVE_RUNTIME_CORE_SCHEMA_V9,
        config: runtime.config.clone(),
        expected_revision: runtime.revision(),
        tick: runtime.tick,
        last_monotonic_time_us: runtime.last_monotonic_time_us,
        accumulator_us: runtime.accumulator_us,
        rng_state: runtime.rng_state,
        network_revision: runtime.network_revision,
        simulation_revision: runtime.simulation_revision,
        gameplay_authority_revision: runtime.gameplay_authority_revision,
        entity_command_sequence: runtime.entity_command_sequence,
        camera: runtime.camera,
        player: runtime.player.clone(),
        effect_events: runtime.effect_events.clone(),
        next_effect_sequence: runtime.next_effect_sequence,
        queued_inputs: runtime.queued_inputs.clone(),
        last_input_sequence: runtime.last_input_sequence,
        last_applied_input: runtime.last_applied_input,
        next_action_sequence: runtime.next_action_sequence,
        queued_context_commands: runtime.queued_context_commands.clone(),
        next_context_command_sequence: runtime.next_context_command_sequence,
        mining_state: runtime.mining_state.clone(),
        block_action_loot_rng: runtime.block_action_loot_rng,
        next_block_action_sequence: runtime.next_block_action_sequence,
        block_action_receipts: runtime.block_action_receipts.clone(),
        replay: runtime.replay.clone(),
        command_receipts: runtime.command_receipts.clone(),
        command_receipt_order: runtime.command_receipt_order.clone(),
        command_receipt_bytes: runtime.command_receipt_bytes,
        compatibility_journal: runtime.persistence.clone(),
        durable_network_drained_proof: None,
        durable_state_proof: None,
        durable_replay_proof: None,
        unknown_extension_bytes: runtime.native_runtime_extension_bytes.clone(),
    }
}

fn validate_context_command_checkpoint_v2(
    commands: &VecDeque<RuntimeContextCommandV2>,
    next_sequence: Option<u64>,
    tick: u64,
) -> Result<(), IntegratedRuntimeError> {
    if next_sequence.is_some_and(|sequence| sequence == 0 || sequence > MAX_SAFE_U64)
        || commands.len() > MAX_CONTEXT_COMMANDS_V2
    {
        return Err(IntegratedRuntimeError::new(
            "native-context-command-cursor",
            "runtime context command cursor or queue is outside its bound",
        ));
    }
    let mut previous_sequence = None;
    let mut previous_target = None;
    for command in commands {
        if command.sequence == 0
            || command.sequence > MAX_SAFE_U64
            || command.target_tick <= tick
            || previous_sequence.is_some_and(|sequence: u64| sequence.checked_add(1) != Some(command.sequence))
            || previous_target.is_some_and(|target| target > command.target_tick)
        {
            return Err(IntegratedRuntimeError::new(
                "native-context-command-order",
                "runtime context command checkpoint is not one contiguous ordered tail",
            ));
        }
        let expected_hash =
            context_command_hash_v2(command).map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
        if command.command_hash != expected_hash {
            return Err(IntegratedRuntimeError::new(
                "native-context-command-hash",
                "runtime context command checkpoint contains a non-canonical hash",
            ));
        }
        previous_sequence = Some(command.sequence);
        previous_target = Some(command.target_tick);
    }
    if commands
        .back()
        .is_some_and(|command| command.sequence.checked_add(1).filter(|value| *value <= MAX_SAFE_U64) != next_sequence)
    {
        return Err(IntegratedRuntimeError::new(
            "native-context-command-cursor",
            "runtime context command queue does not end at its next cursor",
        ));
    }
    Ok(())
}

fn write_context_command_native_v2(
    writer: &mut NativeWriterV1,
    command: &RuntimeContextCommandV2,
) -> Result<(), IntegratedRuntimeError> {
    writer.u64(command.sequence);
    writer.u64(command.target_tick);
    writer.u8(command.action.kind() as u8);
    match &command.action {
        RuntimeContextCommandActionV2::Cast {
            spell_id,
            loadout_revision,
            learned_revision,
        } => {
            writer.string(spell_id)?;
            writer.u64(*loadout_revision);
            writer.u64(*learned_revision);
        }
        RuntimeContextCommandActionV2::Reload {
            container,
            selected_slot,
            container_revision,
        } => {
            writer.u8(container.kind as u8);
            writer.string(&container.id)?;
            writer.bool(container.owner_id.is_some());
            if let Some(owner_id) = &container.owner_id {
                writer.string(owner_id)?;
            }
            writer.u8(*selected_slot);
            writer.u64(*container_revision);
        }
        RuntimeContextCommandActionV2::MountedAbility {
            mount_entity_id,
            mount_entity_revision,
            seat_index,
            ability_slot,
        } => {
            writer.u64(*mount_entity_id);
            writer.u64(*mount_entity_revision);
            writer.u8(*seat_index);
            writer.u8(*ability_slot);
        }
    }
    writer.raw(&command.command_hash.0);
    Ok(())
}

fn read_context_command_native_v2(
    reader: &mut NativeReaderV1<'_>,
) -> Result<RuntimeContextCommandV2, IntegratedRuntimeError> {
    let sequence = reader.u64()?;
    let target_tick = reader.u64()?;
    let action = match reader.u8()? {
        0 => RuntimeContextCommandActionV2::Cast {
            spell_id: reader.string()?,
            loadout_revision: reader.u64()?,
            learned_revision: reader.u64()?,
        },
        1 => {
            let kind = RuntimeContainerKindV2::from_code(reader.u8()?)
                .map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
            let id = reader.string()?;
            let owner_id = if reader.bool()? { Some(reader.string()?) } else { None };
            RuntimeContextCommandActionV2::Reload {
                container: RuntimeContainerKeyV2 { kind, id, owner_id },
                selected_slot: reader.u8()?,
                container_revision: reader.u64()?,
            }
        }
        2 => RuntimeContextCommandActionV2::MountedAbility {
            mount_entity_id: reader.u64()?,
            mount_entity_revision: reader.u64()?,
            seat_index: reader.u8()?,
            ability_slot: reader.u8()?,
        },
        _ => {
            return Err(IntegratedRuntimeError::new(
                "native-context-command-kind",
                "runtime context command checkpoint contains an unknown action kind",
            ));
        }
    };
    let command = RuntimeContextCommandV2 {
        sequence,
        target_tick,
        action,
        command_hash: WireHash(reader.take(16)?.try_into().expect("fixed context command hash")),
    };
    let expected_hash =
        context_command_hash_v2(&command).map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
    if command.command_hash != expected_hash {
        return Err(IntegratedRuntimeError::new(
            "native-context-command-hash",
            "runtime context command checkpoint contains a non-canonical hash",
        ));
    }
    Ok(command)
}

fn encode_runtime_core_snapshot_body_v1(
    core: &IntegratedRuntimeCoreSnapshotV1,
    schema: u16,
) -> Result<Vec<u8>, IntegratedRuntimeError> {
    if core.unknown_extension_bytes.len() > NATIVE_EXTENSION_MAX_BYTES_V1
        || core.effect_events.len() > INTEGRATED_RUNTIME_MAX_EFFECT_EVENTS
        || core.queued_inputs.len() > MAX_INPUT_FRAMES
        || core.queued_context_commands.len() > MAX_CONTEXT_COMMANDS_V2
        || core.block_action_receipts.len() > INTEGRATED_RUNTIME_MAX_BLOCK_ACTION_RECEIPTS_V1
        || core.replay.len() > INTEGRATED_RUNTIME_MAX_REPLAY_ENTRIES
    {
        return Err(IntegratedRuntimeError::new(
            "native-runtime-capacity",
            "runtime core state exceeds its checkpoint bounds",
        ));
    }
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V7
        && core
            .player
            .as_ref()
            .is_some_and(|player| player.look_pitch != core.camera.look_pitch)
    {
        return Err(IntegratedRuntimeError::new(
            "native-camera-look-projection",
            "legacy player pitch projection contradicts authoritative camera look state",
        ));
    }
    validate_runtime_command_receipt_cache_v1(
        &core.command_receipts,
        &core.command_receipt_order,
        core.command_receipt_bytes,
    )?;
    validate_context_command_checkpoint_v2(
        &core.queued_context_commands,
        core.next_context_command_sequence,
        core.tick,
    )?;
    core.block_action_loot_rng
        .validate_v1()
        .map_err(|error| IntegratedRuntimeError::new("native-block-action-rng", error.message))?;
    for receipt in &core.block_action_receipts {
        receipt.validate_shape_v1()?;
    }
    let mut writer = NativeWriterV1::default();
    writer.raw(NATIVE_RUNTIME_MAGIC_V1);
    writer.u16(schema);
    write_runtime_config_v1(&mut writer, &core.config, schema)?;
    write_runtime_revision_v1(&mut writer, core.expected_revision);
    writer.u64(core.tick);
    writer.u64(core.last_monotonic_time_us);
    writer.u64(core.accumulator_us);
    writer.u32(core.rng_state);
    writer.u64(core.network_revision);
    writer.u64(core.simulation_revision);
    writer.u64(core.gameplay_authority_revision);
    writer.u64(core.entity_command_sequence);
    writer.bool(core.player.is_some());
    if let Some(player) = &core.player {
        write_runtime_player_v1(&mut writer, player, schema)?;
    }
    writer.u32(core.effect_events.len() as u32);
    for event in &core.effect_events {
        writer.u64(event.sequence);
        writer.u64(event.tick);
        writer.string(&event.entity_external_id)?;
        writer.u8(event.kind as u8);
        writer.f64(event.amount);
    }
    writer.u64(core.next_effect_sequence);
    writer.u32(core.queued_inputs.len() as u32);
    for input in &core.queued_inputs {
        write_runtime_input_v1(&mut writer, *input);
    }
    writer.bool(core.last_input_sequence.is_some());
    if let Some(sequence) = core.last_input_sequence {
        writer.u64(sequence);
    }
    writer.bool(core.last_applied_input.is_some());
    if let Some(input) = core.last_applied_input {
        write_runtime_input_v1(&mut writer, input);
    }
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V2 {
        writer.u64(core.next_action_sequence);
    }
    writer.u32(core.replay.len() as u32);
    for entry in &core.replay {
        writer.u64(entry.sequence);
        writer.string(&entry.batch_id)?;
        writer.hash(entry.before_hash);
        writer.hash(entry.after_hash);
        writer.hash(entry.receipt_hash);
    }
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V3 {
        writer.u32(core.command_receipt_order.len() as u32);
        for key in &core.command_receipt_order {
            let entry = core
                .command_receipts
                .get(key)
                .expect("validated command receipt order contains every cache key");
            writer.string(&key.0)?;
            writer.string(&key.1)?;
            writer.raw(&entry.command_hash.0);
            writer.bytes(&entry.encoded_receipt)?;
        }
    }
    write_compatibility_journal_v1(&mut writer, &core.compatibility_journal)?;
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V5 {
        writer.bool(core.durable_network_drained_proof.is_some());
        if let Some(proof) = core.durable_network_drained_proof {
            writer.hash(proof);
        }
        writer.hash(core.durable_state_proof.ok_or_else(|| {
            IntegratedRuntimeError::new("native-runtime-proof", "runtime core durable state proof is missing")
        })?);
        writer.hash(core.durable_replay_proof.ok_or_else(|| {
            IntegratedRuntimeError::new("native-runtime-proof", "runtime core durable replay proof is missing")
        })?);
    }
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V6 {
        writer.bool(core.mining_state.is_some());
        if let Some(state) = &core.mining_state {
            write_mining_state_native_v1(&mut writer, state);
        }
    }
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V7 {
        write_camera_state_native_v1(&mut writer, core.camera)?;
    }
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V8 {
        writer.bool(core.next_context_command_sequence.is_some());
        if let Some(sequence) = core.next_context_command_sequence {
            writer.u64(sequence);
        }
        writer.u32(core.queued_context_commands.len() as u32);
        for command in &core.queued_context_commands {
            write_context_command_native_v2(&mut writer, command)?;
        }
    }
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V9 {
        write_block_action_rng_cursor_native_v1(&mut writer, core.block_action_loot_rng);
        writer.bool(core.next_block_action_sequence.is_some());
        if let Some(sequence) = core.next_block_action_sequence {
            writer.u64(sequence);
        }
        writer.u32(core.block_action_receipts.len() as u32);
        for receipt in &core.block_action_receipts {
            write_block_action_receipt_native_v1(&mut writer, receipt)?;
        }
    }
    writer.bytes(&core.unknown_extension_bytes)?;
    Ok(writer.finish())
}

fn durable_network_drained_proof_v1() -> CanonicalHash {
    CanonicalHasher::new("blockwild-durable-network-drained-v1").finish()
}

fn durable_runtime_core_state_proof_v1(
    core: &IntegratedRuntimeCoreSnapshotV1,
) -> Result<CanonicalHash, IntegratedRuntimeError> {
    let mut normalized = core.clone();
    normalized.config.session_id = DURABLE_SESSION_NEUTRAL_ID_V1.into();
    normalized.durable_network_drained_proof = None;
    let proof_schema = if core.schema >= NATIVE_RUNTIME_CORE_SCHEMA_V9 {
        normalized.schema = NATIVE_RUNTIME_CORE_SCHEMA_V9;
        normalized.durable_state_proof = Some(CanonicalHash::default());
        normalized.durable_replay_proof = Some(CanonicalHash::default());
        NATIVE_RUNTIME_CORE_SCHEMA_V9
    } else if core.schema >= NATIVE_RUNTIME_CORE_SCHEMA_V8 {
        normalized.schema = NATIVE_RUNTIME_CORE_SCHEMA_V8;
        normalized.durable_state_proof = Some(CanonicalHash::default());
        normalized.durable_replay_proof = Some(CanonicalHash::default());
        NATIVE_RUNTIME_CORE_SCHEMA_V8
    } else if core.schema >= NATIVE_RUNTIME_CORE_SCHEMA_V7 {
        normalized.schema = NATIVE_RUNTIME_CORE_SCHEMA_V7;
        normalized.durable_state_proof = Some(CanonicalHash::default());
        normalized.durable_replay_proof = Some(CanonicalHash::default());
        NATIVE_RUNTIME_CORE_SCHEMA_V7
    } else if core.schema >= NATIVE_RUNTIME_CORE_SCHEMA_V6 {
        normalized.schema = NATIVE_RUNTIME_CORE_SCHEMA_V6;
        normalized.durable_state_proof = Some(CanonicalHash::default());
        normalized.durable_replay_proof = Some(CanonicalHash::default());
        NATIVE_RUNTIME_CORE_SCHEMA_V6
    } else {
        normalized.schema = NATIVE_RUNTIME_CORE_SCHEMA_V4;
        normalized.durable_state_proof = None;
        normalized.durable_replay_proof = None;
        NATIVE_RUNTIME_CORE_SCHEMA_V4
    };
    let bytes = encode_runtime_core_snapshot_body_v1(&normalized, proof_schema)?;
    let mut hasher = CanonicalHasher::new("blockwild-durable-runtime-core-state-v1");
    hasher.write_bytes(&bytes);
    Ok(hasher.finish())
}

fn durable_runtime_replay_proof_v1(core: &IntegratedRuntimeCoreSnapshotV1) -> CanonicalHash {
    let mut digest = IntegratedReplayDigestV2::default();
    for entry in &core.replay {
        digest.add(hash_runtime_replay_entry(entry));
    }
    let mut hasher = CanonicalHasher::new("blockwild-integrated-replay-v2");
    hasher.write_u64(core.replay.len() as u64);
    digest.write_hash(&mut hasher);
    hasher.finish()
}

fn encode_runtime_core_snapshot_v1(runtime: &IntegratedRuntimeV2) -> Result<Vec<u8>, IntegratedRuntimeError> {
    let mut core = runtime_core_snapshot_from_runtime_v1(runtime);
    core.durable_network_drained_proof = runtime.durable_network_save_boundary_proof().ok();
    core.durable_state_proof = Some(durable_runtime_core_state_proof_v1(&core)?);
    core.durable_replay_proof = Some(durable_runtime_replay_proof_v1(&core));
    encode_runtime_core_snapshot_body_v1(&core, NATIVE_RUNTIME_CORE_SCHEMA_V9)
}

fn decode_runtime_core_snapshot_v1(bytes: &[u8]) -> Result<IntegratedRuntimeCoreSnapshotV1, IntegratedRuntimeError> {
    let mut reader = NativeReaderV1::new(bytes);
    reader.magic(NATIVE_RUNTIME_MAGIC_V1)?;
    let schema = reader.u16()?;
    if schema != NATIVE_RECORD_SCHEMA_V1
        && schema != NATIVE_RUNTIME_CORE_SCHEMA_V2
        && schema != NATIVE_RUNTIME_CORE_SCHEMA_V3
        && schema != NATIVE_RUNTIME_CORE_SCHEMA_V4
        && schema != NATIVE_RUNTIME_CORE_SCHEMA_V5
        && schema != NATIVE_RUNTIME_CORE_SCHEMA_V6
        && schema != NATIVE_RUNTIME_CORE_SCHEMA_V7
        && schema != NATIVE_RUNTIME_CORE_SCHEMA_V8
        && schema != NATIVE_RUNTIME_CORE_SCHEMA_V9
    {
        return Err(IntegratedRuntimeError::new(
            "native-runtime-schema",
            "runtime core snapshot schema is unsupported",
        ));
    }
    let config = read_runtime_config_v1(&mut reader, schema)?;
    let expected_revision = read_runtime_revision_v1(&mut reader)?;
    let tick = reader.u64()?;
    let last_monotonic_time_us = reader.u64()?;
    let accumulator_us = reader.u64()?;
    if accumulator_us >= INTEGRATED_RUNTIME_FIXED_STEP_US {
        return Err(IntegratedRuntimeError::new(
            "native-runtime-clock",
            "runtime accumulator exceeds one fixed step",
        ));
    }
    let rng_state = reader.u32()?;
    let network_revision = reader.u64()?;
    let simulation_revision = reader.u64()?;
    let gameplay_authority_revision = reader.u64()?;
    let entity_command_sequence = reader.u64()?;
    let player = if reader.bool()? {
        Some(read_runtime_player_v1(&mut reader, schema)?)
    } else {
        None
    };
    let effect_count = reader.count(INTEGRATED_RUNTIME_MAX_EFFECT_EVENTS, "effect events")?;
    let mut effect_events = VecDeque::with_capacity(effect_count);
    let mut previous_effect_sequence = 0_u64;
    for _ in 0..effect_count {
        let sequence = reader.u64()?;
        if sequence == 0 || sequence <= previous_effect_sequence {
            return Err(IntegratedRuntimeError::new(
                "native-effect-order",
                "runtime effect sequences are not strictly increasing",
            ));
        }
        previous_effect_sequence = sequence;
        let event_tick = reader.u64()?;
        let entity_external_id = reader.string()?;
        let kind = match reader.u8()? {
            0 => IntegratedRuntimeEffectKindV2::Jump,
            1 => IntegratedRuntimeEffectKindV2::Land,
            2 => IntegratedRuntimeEffectKindV2::FallDamage,
            3 => IntegratedRuntimeEffectKindV2::DrownDamage,
            4 => IntegratedRuntimeEffectKindV2::LiquidEnter,
            5 => IntegratedRuntimeEffectKindV2::LiquidExit,
            6 => IntegratedRuntimeEffectKindV2::ShoreExit,
            _ => {
                return Err(IntegratedRuntimeError::new(
                    "native-effect-kind",
                    "runtime effect kind is unknown",
                ));
            }
        };
        effect_events.push_back(IntegratedRuntimeEffectEventV2 {
            sequence,
            tick: event_tick,
            entity_external_id,
            kind,
            amount: reader.f64()?,
        });
    }
    let next_effect_sequence = reader.u64()?;
    if next_effect_sequence == 0 || next_effect_sequence <= previous_effect_sequence {
        return Err(IntegratedRuntimeError::new(
            "native-effect-order",
            "runtime next effect sequence does not follow retained events",
        ));
    }
    let input_count = reader.count(MAX_INPUT_FRAMES, "queued inputs")?;
    let mut queued_inputs = VecDeque::with_capacity(input_count);
    let mut previous_input_sequence = 0_u64;
    for _ in 0..input_count {
        let input = read_runtime_input_v1(&mut reader)?;
        if input.sequence == 0 || input.sequence <= previous_input_sequence {
            return Err(IntegratedRuntimeError::new(
                "native-input-order",
                "runtime queued input sequences are not strictly increasing",
            ));
        }
        previous_input_sequence = input.sequence;
        queued_inputs.push_back(input);
    }
    let last_input_sequence = if reader.bool()? { Some(reader.u64()?) } else { None };
    let last_applied_input = if reader.bool()? {
        Some(read_runtime_input_v1(&mut reader)?)
    } else {
        None
    };
    let next_action_sequence = if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V2 {
        reader.u64()?
    } else {
        1
    };
    if next_action_sequence == 0 {
        return Err(IntegratedRuntimeError::new(
            "native-action-order",
            "runtime next action sequence is reserved",
        ));
    }
    if last_input_sequence.is_some_and(|sequence| sequence < previous_input_sequence) {
        return Err(IntegratedRuntimeError::new(
            "native-input-order",
            "runtime last input sequence precedes a queued input",
        ));
    }
    let replay_count = reader.count(INTEGRATED_RUNTIME_MAX_REPLAY_ENTRIES, "replay entries")?;
    let mut replay = VecDeque::with_capacity(replay_count);
    let mut previous_replay_sequence = 0_u64;
    for _ in 0..replay_count {
        let sequence = reader.u64()?;
        if sequence == 0 || sequence <= previous_replay_sequence {
            return Err(IntegratedRuntimeError::new(
                "native-replay-order",
                "runtime replay sequences are not strictly increasing",
            ));
        }
        previous_replay_sequence = sequence;
        replay.push_back(IntegratedRuntimeReplayEntryV2 {
            sequence,
            batch_id: reader.string()?,
            before_hash: reader.hash()?,
            after_hash: reader.hash()?,
            receipt_hash: reader.hash()?,
        });
    }
    let mut command_receipts = BTreeMap::new();
    let mut command_receipt_order = VecDeque::new();
    let mut command_receipt_bytes = 0_usize;
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V3 {
        let receipt_count = reader.count(
            INTEGRATED_RUNTIME_MAX_IDEMPOTENCY_RECEIPTS,
            "command receipt cache entries",
        )?;
        for _ in 0..receipt_count {
            let actor_id = reader.string()?;
            let idempotency_key = reader.string()?;
            if actor_id.is_empty() || actor_id.len() > 160 || idempotency_key.is_empty() || idempotency_key.len() > 256
            {
                return Err(IntegratedRuntimeError::new(
                    "native-command-receipt-key",
                    "checkpoint command receipt cache key is outside BWRQ label bounds",
                ));
            }
            let command_hash = WireHash(reader.take(16)?.try_into().expect("fixed slice"));
            let encoded_receipt = reader.bytes(MAX_WIRE_BYTES)?;
            command_receipt_bytes = command_receipt_bytes.saturating_add(runtime_command_receipt_cache_entry_bytes_v1(
                &actor_id,
                &idempotency_key,
                encoded_receipt.len(),
            ));
            if command_receipt_bytes > INTEGRATED_RUNTIME_MAX_COMMAND_RECEIPT_CACHE_BYTES_V1 {
                return Err(IntegratedRuntimeError::new(
                    "native-command-receipt-capacity",
                    "checkpoint command receipt cache exceeds its aggregate byte budget",
                ));
            }
            let receipt = decode_command_receipt_v1(&encoded_receipt)
                .map_err(|error| IntegratedRuntimeError::new(error.code, error.message))?;
            let key = (actor_id, idempotency_key);
            let (receipt_key, receipt_hash) = runtime_command_receipt_key_hash_v1(&receipt);
            if receipt_key != key.1 || receipt_hash != command_hash {
                return Err(IntegratedRuntimeError::new(
                    "native-command-receipt-mismatch",
                    "checkpoint command receipt bytes do not match their cache key and hash",
                ));
            }
            if command_receipts
                .insert(
                    key.clone(),
                    IntegratedRuntimeCommandReceiptCacheEntryV1 {
                        command_hash,
                        receipt,
                        encoded_receipt,
                    },
                )
                .is_some()
            {
                return Err(IntegratedRuntimeError::new(
                    "native-command-receipt-duplicate",
                    "checkpoint command receipt cache repeats an actor and idempotency key",
                ));
            }
            command_receipt_order.push_back(key);
        }
    }
    validate_runtime_command_receipt_cache_v1(&command_receipts, &command_receipt_order, command_receipt_bytes)?;
    let compatibility_journal = read_compatibility_journal_v1(&mut reader, &config)?;
    let (durable_network_drained_proof, durable_state_proof, durable_replay_proof) =
        if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V5 {
            let network_proof = if reader.bool()? { Some(reader.hash()?) } else { None };
            (network_proof, Some(reader.hash()?), Some(reader.hash()?))
        } else {
            (None, None, None)
        };
    let mining_state = if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V6 && reader.bool()? {
        Some(read_mining_state_native_v1(&mut reader, tick, player.as_ref())?)
    } else {
        None
    };
    let camera = if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V7 {
        read_camera_state_native_v1(&mut reader)?
    } else {
        IntegratedRuntimeCameraStateV1::default()
    };
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V7
        && player
            .as_ref()
            .is_some_and(|player| player.look_pitch != camera.look_pitch)
    {
        return Err(IntegratedRuntimeError::new(
            "native-camera-look-projection",
            "legacy player pitch projection contradicts authoritative camera look state",
        ));
    }
    let (next_context_command_sequence, queued_context_commands) = if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V8 {
        let next_sequence = if reader.bool()? { Some(reader.u64()?) } else { None };
        let count = reader.count(MAX_CONTEXT_COMMANDS_V2, "queued context commands")?;
        let mut commands = VecDeque::with_capacity(count);
        for _ in 0..count {
            commands.push_back(read_context_command_native_v2(&mut reader)?);
        }
        (next_sequence, commands)
    } else {
        (Some(1), VecDeque::new())
    };
    validate_context_command_checkpoint_v2(&queued_context_commands, next_context_command_sequence, tick)?;
    let (block_action_loot_rng, next_block_action_sequence, block_action_receipts) =
        if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V9 {
            let cursor = read_block_action_rng_cursor_native_v1(&mut reader)?;
            let next_sequence = if reader.bool()? { Some(reader.u64()?) } else { None };
            let count = reader.count(INTEGRATED_RUNTIME_MAX_BLOCK_ACTION_RECEIPTS_V1, "block-action receipts")?;
            let mut receipts = VecDeque::with_capacity(count);
            for _ in 0..count {
                receipts.push_back(read_block_action_receipt_native_v1(&mut reader)?);
            }
            (cursor, next_sequence, receipts)
        } else {
            (
                BlockActionLootRngCursorV1::from_seed_v1(&config.world_seed),
                Some(1),
                VecDeque::new(),
            )
        };
    let unknown_extension_bytes = reader.bytes(NATIVE_EXTENSION_MAX_BYTES_V1)?;
    reader.finish()?;
    let core = IntegratedRuntimeCoreSnapshotV1 {
        schema,
        config,
        expected_revision,
        tick,
        last_monotonic_time_us,
        accumulator_us,
        rng_state,
        network_revision,
        simulation_revision,
        gameplay_authority_revision,
        entity_command_sequence,
        camera,
        player,
        effect_events,
        next_effect_sequence,
        queued_inputs,
        last_input_sequence,
        last_applied_input,
        next_action_sequence,
        queued_context_commands,
        next_context_command_sequence,
        mining_state,
        block_action_loot_rng,
        next_block_action_sequence,
        block_action_receipts,
        replay,
        command_receipts,
        command_receipt_order,
        command_receipt_bytes,
        compatibility_journal,
        durable_network_drained_proof,
        durable_state_proof,
        durable_replay_proof,
        unknown_extension_bytes,
    };
    if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V5 {
        if core
            .durable_network_drained_proof
            .is_some_and(|proof| proof != durable_network_drained_proof_v1())
        {
            return Err(IntegratedRuntimeError::new(
                "native-runtime-network-proof",
                "runtime core durable network-drain proof is invalid",
            ));
        }
        if core.durable_state_proof != Some(durable_runtime_core_state_proof_v1(&core)?) {
            return Err(IntegratedRuntimeError::new(
                "native-runtime-state-proof",
                "runtime core session-neutral durable state proof does not match",
            ));
        }
        if core.durable_replay_proof != Some(durable_runtime_replay_proof_v1(&core)) {
            return Err(IntegratedRuntimeError::new(
                "native-runtime-replay-proof",
                "runtime core durable replay proof does not match",
            ));
        }
    }
    Ok(core)
}

fn content_domain_tag_v1(domain: ContentDomain) -> u8 {
    match domain {
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

fn content_domain_from_tag_v1(tag: u8) -> Result<ContentDomain, IntegratedRuntimeError> {
    match tag {
        0 => Ok(ContentDomain::Item),
        1 => Ok(ContentDomain::CraftingRecipe),
        2 => Ok(ContentDomain::MachineRecipe),
        3 => Ok(ContentDomain::MachineProfile),
        4 => Ok(ContentDomain::AbilitySpell),
        5 => Ok(ContentDomain::CreatureProfile),
        6 => Ok(ContentDomain::CreatureTypeChart),
        7 => Ok(ContentDomain::QuestGuild),
        8 => Ok(ContentDomain::Economy),
        9 => Ok(ContentDomain::CardforgeCard),
        10 => Ok(ContentDomain::CardforgePack),
        _ => Err(IntegratedRuntimeError::new(
            "native-content-domain",
            "native content record contains an unknown domain",
        )),
    }
}

fn write_content_domains_v1(writer: &mut NativeWriterV1, domains: &BTreeMap<ContentDomain, ContentDomainDigest>) {
    writer.u32(domains.len() as u32);
    for (domain, digest) in domains {
        writer.u8(content_domain_tag_v1(*domain));
        writer.u32(digest.count);
        writer.hash(digest.hash);
    }
}

fn read_content_domains_v1(
    reader: &mut NativeReaderV1<'_>,
) -> Result<BTreeMap<ContentDomain, ContentDomainDigest>, IntegratedRuntimeError> {
    let count = reader.count(32, "content domains")?;
    let mut domains = BTreeMap::new();
    for _ in 0..count {
        let domain = content_domain_from_tag_v1(reader.u8()?)?;
        let digest = ContentDomainDigest {
            count: reader.u32()?,
            hash: reader.hash()?,
        };
        if domains.insert(domain, digest).is_some() {
            return Err(IntegratedRuntimeError::new(
                "native-content-domain",
                "native content domain is duplicated",
            ));
        }
    }
    Ok(domains)
}

fn write_content_artifact_v1(
    writer: &mut NativeWriterV1,
    artifact: &ContentArtifact,
) -> Result<(), IntegratedRuntimeError> {
    writer.u8(content_domain_tag_v1(artifact.domain));
    writer.string(&artifact.id)?;
    writer.string(&artifact.schema_id)?;
    writer.u16(artifact.schema_version);
    writer.u32(artifact.content_version);
    writer.u32(artifact.aliases.len() as u32);
    for alias in &artifact.aliases {
        writer.string(alias)?;
    }
    writer.bytes(&artifact.canonical_bytes)?;
    writer.bytes(&artifact.unknown_extension_bytes)?;
    Ok(())
}

fn read_content_artifact_v1(reader: &mut NativeReaderV1<'_>) -> Result<ContentArtifact, IntegratedRuntimeError> {
    let domain = content_domain_from_tag_v1(reader.u8()?)?;
    let id = reader.string()?;
    let schema_id = reader.string()?;
    let schema_version = reader.u16()?;
    let content_version = reader.u32()?;
    let alias_count = reader.count(16, "content aliases")?;
    let mut aliases = Vec::with_capacity(alias_count);
    let mut seen = BTreeSet::new();
    for _ in 0..alias_count {
        let alias = reader.string()?;
        if !seen.insert(alias.clone()) {
            return Err(IntegratedRuntimeError::new(
                "native-content-alias",
                "native content artifact repeats an alias",
            ));
        }
        aliases.push(alias);
    }
    Ok(ContentArtifact {
        domain,
        id,
        schema_id,
        schema_version,
        content_version,
        aliases,
        canonical_bytes: reader.bytes(256 * 1024)?,
        unknown_extension_bytes: reader.bytes(64 * 1024)?,
    })
}

fn encode_runtime_content_snapshot_v1(runtime: &IntegratedRuntimeV2) -> Result<Vec<u8>, IntegratedRuntimeError> {
    if runtime.native_content_extension_bytes.len() > NATIVE_EXTENSION_MAX_BYTES_V1 {
        return Err(IntegratedRuntimeError::new(
            "native-content-capacity",
            "native content extension exceeds 64 KiB",
        ));
    }
    let mut artifacts = Vec::with_capacity(runtime.gameplay_content_index.len());
    for ((domain, id), hash) in &runtime.gameplay_content_index {
        let blob = runtime.gameplay_content_store.get(*hash).ok_or_else(|| {
            IntegratedRuntimeError::new(
                "native-content-registry",
                "content index references a missing metadata blob",
            )
        })?;
        artifacts.push(ContentArtifact {
            domain: *domain,
            id: id.clone(),
            schema_id: blob.schema_id.clone(),
            schema_version: blob.schema_version,
            content_version: blob.content_version,
            aliases: blob.aliases.clone(),
            canonical_bytes: blob.bytes.clone(),
            unknown_extension_bytes: blob.unknown_extension_bytes.clone(),
        });
    }
    if runtime.content_attestation.is_none() && (!artifacts.is_empty() || !runtime.gameplay_content_store.is_empty()) {
        return Err(IntegratedRuntimeError::new(
            "native-content-incomplete",
            "metadata registry exists without an installed content attestation",
        ));
    }
    let mut writer = NativeWriterV1::default();
    writer.raw(NATIVE_CONTENT_MAGIC_V1);
    writer.u16(NATIVE_RECORD_SCHEMA_V1);
    writer.bool(runtime.content_attestation.is_some());
    if let Some(attestation) = &runtime.content_attestation {
        writer.string(&attestation.install_id)?;
        writer.string(&attestation.source_revision)?;
        writer.hash(attestation.manifest_hash);
        write_content_domains_v1(&mut writer, &attestation.domains);
        writer.u32(attestation.installed_entries);
        writer.u64(attestation.installed_bytes);
        writer.u32(attestation.page_hashes.len() as u32);
        for hash in &attestation.page_hashes {
            writer.hash(*hash);
        }
    }
    writer.u32(artifacts.len() as u32);
    for artifact in &artifacts {
        write_content_artifact_v1(&mut writer, artifact)?;
    }
    writer.bytes(&runtime.native_content_extension_bytes)?;
    Ok(writer.finish())
}

fn decode_runtime_content_snapshot_v1(
    bytes: &[u8],
) -> Result<IntegratedRuntimeContentSnapshotV1, IntegratedRuntimeError> {
    let mut reader = NativeReaderV1::new(bytes);
    reader.magic(NATIVE_CONTENT_MAGIC_V1)?;
    if reader.u16()? != NATIVE_RECORD_SCHEMA_V1 {
        return Err(IntegratedRuntimeError::new(
            "native-content-schema",
            "native content snapshot schema is unsupported",
        ));
    }
    let attestation = if reader.bool()? {
        let install_id = reader.string()?;
        let source_revision = reader.string()?;
        let manifest_hash = reader.hash()?;
        let domains = read_content_domains_v1(&mut reader)?;
        let installed_entries = reader.u32()?;
        let installed_bytes = reader.u64()?;
        let page_count = reader.count(128, "content pages")?;
        if page_count == 0 {
            return Err(IntegratedRuntimeError::new(
                "native-content-pages",
                "installed content attestation has no source pages",
            ));
        }
        let mut page_hashes = Vec::with_capacity(page_count);
        for _ in 0..page_count {
            page_hashes.push(reader.hash()?);
        }
        Some(IntegratedRuntimeContentAttestationV1 {
            install_id,
            source_revision,
            manifest_hash,
            domains,
            installed_entries,
            installed_bytes,
            page_hashes,
        })
    } else {
        None
    };
    let artifact_count = reader.count(INTEGRATED_RUNTIME_CONTENT_MAX_ENTRIES_V1, "content artifacts")?;
    let mut artifacts = Vec::with_capacity(artifact_count);
    let mut previous: Option<(ContentDomain, String)> = None;
    for _ in 0..artifact_count {
        let artifact = read_content_artifact_v1(&mut reader)?;
        let key = (artifact.domain, artifact.id.clone());
        if previous.as_ref().is_some_and(|previous| previous >= &key) {
            return Err(IntegratedRuntimeError::new(
                "native-content-order",
                "native content artifacts are not uniquely sorted",
            ));
        }
        previous = Some(key);
        artifacts.push(artifact);
    }
    let unknown_extension_bytes = reader.bytes(NATIVE_EXTENSION_MAX_BYTES_V1)?;
    reader.finish()?;
    if attestation.is_none() && !artifacts.is_empty() {
        return Err(IntegratedRuntimeError::new(
            "native-content-incomplete",
            "native content artifacts exist without an attestation",
        ));
    }
    Ok(IntegratedRuntimeContentSnapshotV1 {
        attestation,
        artifacts,
        unknown_extension_bytes,
    })
}

fn install_runtime_content_snapshot_v1(
    config: &IntegratedRuntimeConfigV2,
    content: &IntegratedRuntimeContentSnapshotV1,
) -> Result<
    (
        MetadataBlobStore,
        RuntimeContentIndexV1,
        ContentRuntimeRegistry,
        BTreeMap<u32, ItemDefinition>,
    ),
    IntegratedRuntimeError,
> {
    let Some(attestation) = &content.attestation else {
        if !content.artifacts.is_empty() {
            return Err(IntegratedRuntimeError::new(
                "native-content-incomplete",
                "unattested native content cannot be installed",
            ));
        }
        return Ok((
            MetadataBlobStore::default(),
            BTreeMap::new(),
            ContentRuntimeRegistry::default(),
            BTreeMap::new(),
        ));
    };
    if attestation.manifest_hash != config.content_hash {
        return Err(IntegratedRuntimeError::new(
            "native-content-fingerprint",
            "installed content manifest does not match the runtime content hash",
        ));
    }
    let compiled = compile_content_bundle(attestation.source_revision.clone(), content.artifacts.clone())
        .map_err(|blockers| content_blocker_error(&blockers))?;
    if compiled.manifest.manifest_hash != attestation.manifest_hash
        || compiled.manifest.domains != attestation.domains
        || compiled.manifest.entries.len() != attestation.installed_entries as usize
    {
        return Err(IntegratedRuntimeError::new(
            "native-content-attestation",
            "native content bytes do not reproduce their manifest attestation",
        ));
    }
    let mut store = MetadataBlobStore::default();
    let report = install_content_bundle(&compiled, &mut store).map_err(|blockers| content_blocker_error(&blockers))?;
    if report.manifest_hash != attestation.manifest_hash
        || report.installed_entries != attestation.installed_entries
        || report.installed_bytes != attestation.installed_bytes
    {
        return Err(IntegratedRuntimeError::new(
            "native-content-attestation",
            "restored metadata store differs from its content attestation",
        ));
    }
    let index = compiled
        .manifest
        .entries
        .iter()
        .map(|entry| ((entry.domain, entry.id.clone()), entry.blob_hash))
        .collect::<BTreeMap<_, _>>();
    let (registry, runtime_report) = materialize_content_runtime(&compiled.manifest, &store)
        .map_err(|blockers| content_runtime_blocker_error(&blockers))?;
    if runtime_report.manifest_hash != report.manifest_hash
        || runtime_report.installed_entries != report.installed_entries
        || runtime_report
            .executable_bytes
            .checked_add(runtime_report.opaque_extension_bytes)
            != Some(report.installed_bytes)
    {
        return Err(IntegratedRuntimeError::new(
            "native-content-runtime-drift",
            "restored typed content registry disagrees with its installed metadata bundle",
        ));
    }
    let item_definitions = item_definitions_from_runtime_registry(&registry)?;
    Ok((store, index, registry, item_definitions))
}

#[cfg(test)]
mod tests {
    use blockwild_authority::{
        CellPositionV1, SectionInstallV1, WORLD_SECTION_CELL_COUNT_V1, WorldCellV1, WorldSectionAddressV1,
    };
    use blockwild_entity::{
        ENTITY_COMMAND_SCHEMA, EntityCommand, EntityCompatibilityRecord, EntityResidency, MountSeat, MountState,
    };
    use blockwild_gameplay::{AbilitySpec, CombatantState, DamageKind, ItemDefinition, ItemStack};
    use blockwild_network::{NetworkCapabilityV1, NetworkPeerKindV1, NetworkPeerRoleV1};

    use super::*;

    #[test]
    fn player_vital_milliheart_quantization_is_checked_and_canonical() {
        assert_eq!(quantize_player_vital_millihearts_v1(10.0, "health").unwrap(), 10_000);
        assert_eq!(quantize_player_vital_millihearts_v1(9.5, "health").unwrap(), 9_500);
        assert_eq!(quantize_player_vital_millihearts_v1(0.0, "health").unwrap(), 0);
        for value in [-0.0, f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 1.0 / 3.0, 4_294_968.0] {
            assert!(
                quantize_player_vital_millihearts_v1(value, "health").is_err(),
                "unexpectedly accepted {value:?}"
            );
        }
    }

    #[test]
    fn player_combat_status_distinguishes_absent_legacy_and_exact_linked() {
        let query = PlayerBootstrapStatusQueryWireV1 {
            external_entity_id: "player:one".into(),
            actor_id: "player:one".into(),
            player_id: PlayerId::new(1, 1),
        };
        let absent = runtime_with_bound_player();
        let status = absent
            .player_combat_bootstrap_status_v1(&query, CanonicalHash([1; 16]))
            .unwrap();
        assert_eq!(status.status, PlayerCombatBootstrapStatusV1::Absent);
        assert!(status.blocker.is_none() && status.combatant.is_none());

        let mut legacy = runtime_with_bound_player();
        legacy.gameplay.state.combat.combatants.insert(
            "player:one".into(),
            CombatantState {
                record_id: "player:one".into(),
                owner_id: Some("player:one".into()),
                revision: 0,
                position: FixedVec3::default(),
                health: 20,
                max_health: 20,
                stamina: 100,
                mana: 100,
                armor: 0,
                resist_per_mille: BTreeMap::new(),
                statuses: BTreeMap::new(),
                cooldown_until: BTreeMap::new(),
                alive: true,
                vital_units: CombatVitalUnits::LegacyWholeHeartsV1,
                entity_id: None,
            },
        );
        legacy.invalidate_state_hash();
        let status = legacy
            .player_combat_bootstrap_status_v1(&query, CanonicalHash([2; 16]))
            .unwrap();
        assert_eq!(status.status, PlayerCombatBootstrapStatusV1::LegacyUnlinked);
        assert_eq!(
            status.blocker,
            Some(PlayerCombatBootstrapBlockerV1::LegacyUnlinkedRequiresExplicitMigration)
        );
        assert_eq!(status.combatant.unwrap().entity_id, None);

        let mut linked = runtime_with_bound_player();
        linked
            .import_player_inventory(
                PlayerInventoryImportWireV1 {
                    import: blockwild_gameplay::ImportPlayerInventoryV1 {
                        inventory: ContainerKey::player("player:one"),
                        expected_revision: 0,
                        slots: vec![None; 9],
                        metadata: Vec::new(),
                    },
                    selected_slot: 0,
                },
                CanonicalHash([3; 16]),
            )
            .unwrap();
        let before_combat_hash = linked.state_hash();
        linked.install_bound_player_combatant_v1().unwrap();
        let installed_hash = linked.state_hash();
        assert_ne!(
            installed_hash, before_combat_hash,
            "combat install must invalidate the cached runtime hash"
        );
        let status = linked
            .player_combat_bootstrap_status_v1(&query, CanonicalHash([4; 16]))
            .unwrap();
        assert_eq!(status.status, PlayerCombatBootstrapStatusV1::ExactLinked);
        assert!(status.blocker.is_none());
        let combatant = status.combatant.unwrap();
        assert_eq!(combatant.vital_units, CombatVitalUnits::MilliheartsV1);
        assert_eq!((combatant.health, combatant.max_health), (20_000, 20_000));
        assert!(combatant.cross_domain_parity);
        assert!(linked.gameplay.state.combat.abilities.is_empty());

        let evolved = linked.gameplay.state.combat.combatants.get_mut("player:one").unwrap();
        evolved.revision = 4;
        evolved.position.x_milli = 9_250;
        evolved.stamina = 55;
        evolved.mana = 34;
        linked.invalidate_state_hash();
        let evolved_hash = linked.state_hash();
        linked.install_bound_player_combatant_v1().unwrap();
        assert_eq!(
            linked.state_hash(),
            evolved_hash,
            "exact V4 replay must not reset evolved combat state"
        );
        let replayed = &linked.gameplay.state.combat.combatants["player:one"];
        assert_eq!(replayed.revision, 4);
        assert_eq!(replayed.position.x_milli, 9_250);
        assert_eq!((replayed.stamina, replayed.mana), (55, 34));
    }

    #[test]
    fn linked_player_combat_restore_import_and_outer_transaction_reject_cross_domain_drift_atomically() {
        let mut runtime = runtime_with_linked_player_combat();
        let player_entity_id = runtime.player.as_ref().unwrap().entity_id;

        let mut other = EntityCompatibilityRecord::new("construct:other", "construct:other", "construct");
        other.class = EntityClass::Construct;
        let mut replay_anchor =
            EntityCompatibilityRecord::new("construct:replay-anchor", "construct:replay-anchor", "construct");
        replay_anchor.class = EntityClass::Construct;
        commit_entity_commands(
            &mut runtime,
            "spawn-other-linked-candidate",
            vec![
                EntityCommand::Spawn {
                    record: other,
                    residency: EntityResidency::Hot,
                },
                EntityCommand::Spawn {
                    record: replay_anchor,
                    residency: EntityResidency::Hot,
                },
            ],
        );
        let other_entity_id = runtime
            .entities
            .hot()
            .iter()
            .find(|(_, entity)| entity.record.external_entity_id == "construct:other")
            .map(|(entity_id, _)| *entity_id)
            .unwrap();
        let replay_anchor_entity_id = runtime
            .entities
            .hot()
            .iter()
            .find(|(_, entity)| entity.record.external_entity_id == "construct:replay-anchor")
            .map(|(entity_id, _)| *entity_id)
            .unwrap();
        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert!(
            restored.gameplay.state.combat.combatants["legacy-unlinked"]
                .entity_id
                .is_none()
        );

        let wrong_link = rewrite_checkpoint_cross_domain_records(&checkpoint, |gameplay, _, _| {
            gameplay
                .state
                .combat
                .combatants
                .get_mut("player:one")
                .unwrap()
                .entity_id = Some(other_entity_id);
            gameplay
                .install_linked_combatant_v1(CombatantState {
                    record_id: "replay-anchor".into(),
                    owner_id: None,
                    revision: 0,
                    position: FixedVec3::default(),
                    health: 1_000,
                    max_health: 1_000,
                    stamina: 0,
                    mana: 0,
                    armor: 0,
                    resist_per_mille: BTreeMap::new(),
                    statuses: BTreeMap::new(),
                    cooldown_until: BTreeMap::new(),
                    alive: true,
                    vital_units: CombatVitalUnits::MilliheartsV1,
                    entity_id: Some(replay_anchor_entity_id),
                })
                .unwrap();
        });
        let wrong_link_error = match IntegratedRuntimeV2::restore_runtime_checkpoint(
            &wrong_link,
            integrated_runtime_checkpoint_hash_v1(&wrong_link),
        ) {
            Ok(_) => panic!("checkpoint with a cross-linked player combatant unexpectedly restored"),
            Err(error) => error,
        };
        assert_eq!(wrong_link_error.code, "recovery-world-view");
        assert!(
            wrong_link_error
                .message
                .contains("R7 player combatant player:one disagrees with bound R6 entity")
        );

        let missing_runtime_player = rewrite_checkpoint_cross_domain_records(&checkpoint, |_, core, _| {
            core.player = None;
        });
        let missing_runtime_error = match IntegratedRuntimeV2::restore_runtime_checkpoint(
            &missing_runtime_player,
            integrated_runtime_checkpoint_hash_v1(&missing_runtime_player),
        ) {
            Ok(_) => panic!("checkpoint with linked player combat but no runtime player unexpectedly restored"),
            Err(error) => error,
        };
        assert_eq!(missing_runtime_error.code, "recovery-world-view");
        assert!(
            missing_runtime_error
                .message
                .contains("player-bound R7 combatant exists without the runtime player authority")
        );

        let wrong_external_restore = rewrite_checkpoint_cross_domain_records(&checkpoint, |_, _, entities| {
            let mut record = entities.compatibility_record(player_entity_id).unwrap().clone();
            record.external_entity_id = "player:wrong-external".into();
            entities
                .apply_batch(&EntityCommandBatch {
                    schema: ENTITY_COMMAND_SCHEMA,
                    sequence: runtime.entity_command_sequence.saturating_add(1),
                    expected_revision: entities.revision(),
                    tick: runtime.tick,
                    commands: vec![EntityCommand::ReplaceCompatibilityRecord {
                        id: player_entity_id,
                        value: record,
                    }],
                })
                .unwrap();
        });
        let wrong_external_restore_error = match IntegratedRuntimeV2::restore_runtime_checkpoint(
            &wrong_external_restore,
            integrated_runtime_checkpoint_hash_v1(&wrong_external_restore),
        ) {
            Ok(_) => panic!("checkpoint with drifted R6 player external identity unexpectedly restored"),
            Err(error) => error,
        };
        assert_eq!(wrong_external_restore_error.code, "recovery-world-view");
        assert!(
            wrong_external_restore_error
                .message
                .contains("runtime player, world-view binding, and R6 player entity disagree")
        );

        let mut imported_entities = runtime.entities.clone();
        let mut wrong_external = imported_entities
            .compatibility_record(player_entity_id)
            .unwrap()
            .clone();
        wrong_external.external_entity_id = "player:wrong-external".into();
        imported_entities
            .apply_batch(&EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence: runtime.entity_command_sequence.saturating_add(1),
                expected_revision: imported_entities.revision(),
                tick: runtime.tick,
                commands: vec![EntityCommand::ReplaceCompatibilityRecord {
                    id: player_entity_id,
                    value: wrong_external,
                }],
            })
            .unwrap();
        let imported_snapshot = encode_entity_authority_snapshot(&imported_entities).unwrap();
        let before_import = runtime.identity();
        let wrong_external_import_error = runtime
            .import_entity_authority_snapshot(runtime.entities.revision(), &imported_snapshot)
            .unwrap_err();
        assert_eq!(wrong_external_import_error.code, "entity-snapshot-world-view");
        assert!(
            wrong_external_import_error
                .message
                .contains("runtime player, world-view binding, and R6 player entity disagree")
        );
        assert_eq!(runtime.identity(), before_import);
        assert_eq!(
            runtime
                .entities
                .compatibility_record(player_entity_id)
                .unwrap()
                .external_entity_id,
            "player:one"
        );

        let mut wrong_class = runtime.entities.compatibility_record(player_entity_id).unwrap().clone();
        wrong_class.class = EntityClass::Construct;
        let mut batch = IntegratedRuntimeBatchV2::empty("combat-link-transaction-rollback", runtime.identity());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: runtime.entity_command_sequence.saturating_add(1),
            expected_revision: runtime.entities.revision(),
            tick: runtime.tick,
            commands: vec![EntityCommand::ReplaceCompatibilityRecord {
                id: player_entity_id,
                value: wrong_class,
            }],
        });
        let before_transaction = runtime.identity();
        let IntegratedRuntimeReceiptV2::Rejected(rejection) = runtime.commit(batch) else {
            panic!("outer transaction that invalidates linked player combat unexpectedly committed");
        };
        assert_eq!(rejection.code, "world-view-rejected");
        assert_eq!(runtime.identity(), before_transaction);
        assert_eq!(
            runtime.entities.compatibility_record(player_entity_id).unwrap().class,
            EntityClass::Player
        );
        assert_eq!(
            runtime.gameplay.state.combat.combatants["player:one"].entity_id,
            Some(player_entity_id)
        );
    }

    fn runtime_with_section() -> IntegratedRuntimeV2 {
        runtime_with_section_config(IntegratedRuntimeConfigV2::default())
    }

    fn runtime_with_section_config(config: IntegratedRuntimeConfigV2) -> IntegratedRuntimeV2 {
        let mut runtime = IntegratedRuntimeV2::new(config).unwrap();
        let address = runtime.world().active_address().clone();
        for section_y in [4_i16, 7_i16, 8_i16] {
            let mut cells = vec![WorldCellV1::default(); WORLD_SECTION_CELL_COUNT_V1];
            if section_y == 7 {
                for z in 0..16 {
                    for x in 0..16 {
                        cells[x + 16 * (z + 16 * 15)] = WorldCellV1 {
                            block_id: 1,
                            ..WorldCellV1::default()
                        };
                    }
                }
            }
            runtime
                .world_mut_for_platform_install()
                .install_section_for_replay(SectionInstallV1 {
                    address: WorldSectionAddressV1 {
                        world: address.clone(),
                        chunk_x: 0,
                        chunk_z: 0,
                        section_y,
                    },
                    cells,
                    source_revision: u64::from(section_y as u16),
                    source_hash: format!("{section_y:032x}"),
                })
                .unwrap();
        }
        runtime
    }

    fn runtime_with_bound_player() -> IntegratedRuntimeV2 {
        runtime_with_bound_player_config(IntegratedRuntimeConfigV2::default())
    }

    fn runtime_with_linked_player_combat() -> IntegratedRuntimeV2 {
        let mut runtime = runtime_with_bound_player();
        runtime.gameplay.state.combat.combatants.insert(
            "legacy-unlinked".into(),
            CombatantState {
                record_id: "legacy-unlinked".into(),
                owner_id: None,
                revision: 0,
                position: FixedVec3::default(),
                health: 10,
                max_health: 20,
                stamina: 0,
                mana: 0,
                armor: 0,
                resist_per_mille: BTreeMap::new(),
                statuses: BTreeMap::new(),
                cooldown_until: BTreeMap::new(),
                alive: true,
                vital_units: CombatVitalUnits::LegacyWholeHeartsV1,
                entity_id: None,
            },
        );
        runtime
            .import_player_inventory(
                PlayerInventoryImportWireV1 {
                    import: blockwild_gameplay::ImportPlayerInventoryV1 {
                        inventory: ContainerKey::player("player:one"),
                        expected_revision: 0,
                        slots: vec![None; 9],
                        metadata: Vec::new(),
                    },
                    selected_slot: 0,
                },
                CanonicalHash([0x91; 16]),
            )
            .unwrap();
        runtime.install_bound_player_combatant_v1().unwrap();
        runtime
    }

    fn runtime_with_bound_player_config(config: IntegratedRuntimeConfigV2) -> IntegratedRuntimeV2 {
        let mut runtime = runtime_with_section_config(config);
        let mut record = EntityCompatibilityRecord::new("player:one", "player:one", "player");
        record.class = EntityClass::Player;
        record.position = EntityVec3::new(8.0, 63.5, 8.0);
        record.health = 20.0;
        record.maximum_health = 20.0;
        record.custom.insert("physics.grounded".into(), "true".into());
        let mut batch = IntegratedRuntimeBatchV2::empty("spawn-player", runtime.identity());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            commands: vec![EntityCommand::Spawn {
                record,
                residency: EntityResidency::Hot,
            }],
        });
        let receipt = runtime.commit(batch);
        assert!(receipt.accepted(), "unexpected entity command rejection: {receipt:?}");
        runtime
            .bind_player(RuntimePlayerBindingWireV1 {
                external_entity_id: "player:one".into(),
                actor_id: "player:one".into(),
                player_id: PlayerId::new(1, 1),
                creative_mode: true,
                radius: 0.35,
                standing_height: 1.8,
                crouching_height: 1.35,
                mass: 80.0,
                walk_speed: 4.3,
                sprint_speed: 6.2,
                creative_flight_speed: 8.0,
                maximum_oxygen_seconds: 15.0,
            })
            .unwrap();
        runtime
    }

    fn linked_projectile_runtime_v1(speed_milli_per_second: u32, aim_x_milli: i32) -> IntegratedRuntimeV2 {
        let item = ContentArtifact {
            domain: ContentDomain::Item,
            id: "202".into(),
            schema_id: "item-definition".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["item:202".into()],
            canonical_bytes: br#"{"id":202,"maxStack":64,"name":"Linked Arrow"}"#.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let missing_item = ContentArtifact {
            domain: ContentDomain::Item,
            id: "377".into(),
            schema_id: "item-definition".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["item:377".into()],
            canonical_bytes: br#"{"id":377,"maxStack":64,"name":"Missing Linked Bolt"}"#.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let summon_spell = ContentArtifact {
            domain: ContentDomain::AbilitySpell,
            id: "move:summon-test".into(),
            schema_id: "creature-move".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["ability-spell:move:summon-test".into()],
            canonical_bytes: br#"{"activeSeconds":0.1,"channel":"physical","cooldownSeconds":1,"exertionCost":0,"id":"summon-test","name":"Summon Test","packets":[{"share":1,"type":"wild"}],"power":1,"radius":1,"range":2,"recoverySeconds":0.2,"shape":"contact","target":"hostile","type":"wild","verticalTolerance":1,"windupSeconds":0.2,"worldImpact":"visual"}"#.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let summon_creature = ContentArtifact {
            domain: ContentDomain::CreatureProfile,
            id: "summon-test".into(),
            schema_id: "creature-profile".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["creature-profile:summon-test".into()],
            canonical_bytes: br#"{"captureProfile":"gentle","kind":"summon-test","moves":{"basicMoveId":"summon-test","unlocks":[{"level":1,"moveId":"summon-test"}]},"naturalTypes":["wild"],"stats":{"maximumLevel":50}}"#.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let wild_type = ContentArtifact {
            domain: ContentDomain::CreatureTypeChart,
            id: "type:wild".into(),
            schema_id: "creature-type".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["creature-type-chart:type:wild".into()],
            canonical_bytes: br##"{"color":"#5a9d55","glyph":"W","id":"wild","name":"Wild"}"##.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let presentation = ContentArtifact {
            domain: ContentDomain::MachineProfile,
            id: blockwild_gameplay::RENDER_PRESENTATION_CATALOG_ID.into(),
            schema_id: "render-presentation-catalog".into(),
            schema_version: 1,
            content_version: 7,
            aliases: vec!["machine-profile:render-presentations".into()],
            canonical_bytes: br#"{"catalog":{"byteLength":1,"canonicalHash":"11111111111111111111111111111111","format":"blockwild-compiled-model-catalog-v2","modelCount":2,"nodeCount":2,"revision":1,"schema":2,"sha256":"1111111111111111111111111111111111111111111111111111111111111111","source":"linked combat test"},"integrationBlockers":["combat-general-r7-r6-health-parity-not-authoritative"],"missingProfiles":[{"contentRefs":[{"domain":"item","id":"377"}],"id":"missing:projectile:test","reason":"Fixture intentionally has no exact projectile model.","role":"projectile","sourcePresentationIds":["fixture:missing-projectile"]}],"profiles":[{"contentRefs":[{"domain":"item","id":"202"}],"id":"projectile:test","model":{"category":4,"groundYBits":null,"id":"test-arrow-model","label":"Test Arrow","nodeCount":1},"role":"projectile"},{"contentRefs":[{"domain":"ability-spell","id":"move:summon-test"},{"domain":"creature-profile","id":"summon-test"}],"id":"summon:test","model":{"category":1,"groundYBits":0,"id":"test-summon-model","label":"Test Summon","nodeCount":1},"role":"summon"}],"schema":1}"#.to_vec(),
            unknown_extension_bytes: vec![0x80, 0xff, 7],
        };
        let artifacts = vec![
            item,
            missing_item,
            summon_spell,
            summon_creature,
            wild_type,
            presentation,
        ];
        let bundle = compile_content_bundle("linked-combat-test-v1", artifacts.clone()).unwrap();
        let mut runtime = runtime_with_section_config(IntegratedRuntimeConfigV2 {
            content_hash: bundle.manifest.manifest_hash,
            ..IntegratedRuntimeConfigV2::default()
        });
        let page = ContentInstallPageWireV1 {
            install_id: "linked-combat-content".into(),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision,
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains,
            page_index: 0,
            page_count: 1,
            artifacts: bundle.artifacts.clone(),
        };
        let page_bytes = crate::encode_content_install_page_v1(&page).unwrap();
        runtime
            .install_content_page(
                page,
                CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&page_bytes)),
            )
            .unwrap();

        let mut state = runtime.gameplay.state.clone();
        state.combat.abilities.insert(
            "ability:linked-arrow".into(),
            AbilitySpec {
                ability_id: "ability:linked-arrow".into(),
                damage_kind: DamageKind::Physical,
                base_damage: 5,
                range_milli: 10_000,
                cooldown_ticks: 1,
                stamina_cost: 0,
                mana_cost: 0,
                projectile_speed_milli: Some(speed_milli_per_second),
                status: None,
            },
        );
        for (record_id, x_milli) in [("source:水", 8_000), ("target:水", aim_x_milli)] {
            state.combat.combatants.insert(
                record_id.into(),
                CombatantState {
                    record_id: record_id.into(),
                    owner_id: None,
                    vital_units: blockwild_gameplay::CombatVitalUnits::LegacyWholeHeartsV1,
                    entity_id: None,
                    revision: 0,
                    position: FixedVec3 {
                        x_milli,
                        y_milli: 70_000,
                        z_milli: 8_000,
                    },
                    health: 20,
                    max_health: 20,
                    stamina: 20,
                    mana: 20,
                    armor: 0,
                    resist_per_mille: BTreeMap::new(),
                    statuses: BTreeMap::new(),
                    cooldown_until: BTreeMap::new(),
                    alive: true,
                },
            );
        }
        state.revision.sequence = state.revision.sequence.saturating_add(1);
        state.revision.combat = state.revision.combat.saturating_add(1);
        runtime.gameplay = GameplayAuthority::new(state);
        runtime
            .gameplay
            .grant_actor(GAMEPLAY_SCHEDULER_ACTOR_ID_V1, ActorGrant::system())
            .unwrap();

        let entity_id = EntityId::new(3, 0xffff_fffe);
        let direction = if aim_x_milli >= 8_000 { 1.0 } else { -1.0 };
        let mut record = EntityCompatibilityRecord::new("projectile:水", "projectile:水", "202");
        record.class = EntityClass::Projectile;
        record.position = EntityVec3::new(8.0, 70.0, 8.0);
        record.velocity = EntityVec3::new(direction * speed_milli_per_second as f32 / 1_000.0, 0.0, 0.0);
        let mut batch = IntegratedRuntimeBatchV2::empty("spawn-linked-projectile", runtime.identity());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: runtime.entity_command_sequence.saturating_add(1),
            expected_revision: runtime.entities.revision(),
            tick: 0,
            commands: vec![EntityCommand::SpawnAt {
                id: entity_id,
                record,
                residency: EntityResidency::Hot,
            }],
        });
        batch.gameplay.push(GameplayBatch::new(
            "spawn-linked-projectile",
            "spawn-linked-projectile",
            GameplayActor {
                actor_id: GAMEPLAY_SCHEDULER_ACTOR_ID_V1.into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            runtime.gameplay.state.identity(),
            vec![GameplayCommand::Combat(CombatCommand::UseLinkedProjectile {
                source_id: "source:水".into(),
                expected_source_revision: 0,
                target_id: "target:水".into(),
                expected_target_revision: 0,
                ability_id: "ability:linked-arrow".into(),
                projectile_id: "projectile:水".into(),
                entity_id,
                content_domain: ContentDomain::Item,
                content_id: "202".into(),
                presentation_id: "projectile:test".into(),
                aim: FixedVec3 {
                    x_milli: aim_x_milli,
                    y_milli: 70_000,
                    z_milli: 8_000,
                },
                tick: 0,
            })],
        ));
        let receipt = runtime.commit(batch);
        assert!(receipt.accepted(), "linked projectile spawn rejected: {receipt:?}");
        runtime
    }

    fn spawn_linked_projectile_target_entity_v1(runtime: &mut IntegratedRuntimeV2) -> EntityId {
        let id = EntityId::new(4, 0xffff_fffd);
        let mut record = EntityCompatibilityRecord::new("target:水", "target:水", "target-creature");
        record.class = EntityClass::Creature;
        record.position = EntityVec3::new(9.0, 70.0, 8.0);
        record.health = 20.0;
        record.maximum_health = 20.0;
        let mut batch = IntegratedRuntimeBatchV2::empty("spawn-linked-target", runtime.identity());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: runtime.entity_command_sequence.saturating_add(1),
            expected_revision: runtime.entities.revision(),
            tick: runtime.tick,
            commands: vec![EntityCommand::SpawnAt {
                id,
                record,
                residency: EntityResidency::Hot,
            }],
        });
        let receipt = runtime.commit(batch);
        assert!(
            receipt.accepted(),
            "linked projectile target spawn rejected: {receipt:?}"
        );
        id
    }

    #[test]
    fn linked_projectile_fixed_steps_keep_signed_r7_r6_motion_exact_and_restore() {
        for (aim_x_milli, expected_twenty, expected_twenty_one) in [(9_000, 8_001, 8_001), (7_000, 7_999, 7_999)] {
            let mut runtime = linked_projectile_runtime_v1(1, aim_x_milli);
            let projectile = runtime.gameplay.state.combat.projectiles.get("projectile:水").unwrap();
            let entity_id = projectile.presentation.as_ref().unwrap().entity_id;
            let mut timestamp = 1_000_000_u64;
            runtime.step(timestamp, 8_000).unwrap();
            let mut previous_entity_revision = runtime.entities.entity_revision(entity_id).unwrap();
            for tick in 1..=21 {
                timestamp += INTEGRATED_RUNTIME_FIXED_STEP_US;
                assert_eq!(runtime.step(timestamp, 8_000).unwrap().fixed_steps, 1);
                assert_eq!(runtime.tick, tick);
                let projectile = runtime.gameplay.state.combat.projectiles.get("projectile:水").unwrap();
                let entity = runtime.entities.hot().get(&entity_id).unwrap();
                assert_eq!(
                    runtime.entities.entity_revision(entity_id).unwrap(),
                    previous_entity_revision + 1
                );
                previous_entity_revision += 1;
                assert_eq!(
                    (entity.record.position.x * 1_000.0).round() as i32,
                    projectile.position.x_milli
                );
                if tick == 19 {
                    assert_eq!(projectile.position.x_milli, 8_000);
                } else if tick == 20 {
                    assert_eq!(projectile.position.x_milli, expected_twenty);
                } else if tick == 21 {
                    assert_eq!(projectile.position.x_milli, expected_twenty_one);
                }
            }
            let checkpoint = runtime.export_runtime_checkpoint().unwrap();
            let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
                &checkpoint,
                integrated_runtime_checkpoint_hash_v1(&checkpoint),
            )
            .unwrap();
            assert_eq!(restored.identity(), runtime.identity());
            assert_eq!(
                restored.gameplay.state.combat.projectiles["projectile:水"],
                runtime.gameplay.state.combat.projectiles["projectile:水"]
            );
        }
    }

    #[test]
    fn linked_projectile_hit_commits_exact_target_health_or_rolls_back_every_domain() {
        let mut runtime = linked_projectile_runtime_v1(20_000, 9_000);
        let target_id = spawn_linked_projectile_target_entity_v1(&mut runtime);
        runtime.tick = 1;
        runtime.advance_entity_and_gameplay_schedules().unwrap();
        assert_eq!(runtime.gameplay.state.combat.combatants["target:水"].health, 15);
        assert_eq!(runtime.entities.compatibility_record(target_id).unwrap().health, 15.0);
        assert!(!runtime.gameplay.state.combat.projectiles.contains_key("projectile:水"));

        let mut rejected = linked_projectile_runtime_v1(20_000, 9_000);
        spawn_linked_projectile_target_entity_v1(&mut rejected);
        rejected
            .gameplay
            .state
            .combat
            .combatants
            .get_mut("target:水")
            .unwrap()
            .max_health = 0;
        rejected.step(1_000_000, 8_000).unwrap();
        let before_step = rejected.identity();
        let error = rejected.step(1_050_000, 8_000).unwrap_err();
        assert_eq!(error.code, "combat-entity-schedule");
        assert_eq!(rejected.identity(), before_step);
        assert_eq!(rejected.gameplay.state.combat.combatants["target:水"].health, 20);
        assert!(rejected.gameplay.state.combat.projectiles.contains_key("projectile:水"));
    }

    #[test]
    fn missing_linked_projectile_is_loadable_but_new_creation_fails_atomically() {
        let mut runtime = linked_projectile_runtime_v1(20_000, 9_000);
        assert!(matches!(
            runtime.projectile_render_presentation_binding_v1("missing:projectile:test", ContentDomain::Item, "377",),
            IntegratedRuntimeRenderPresentationBindingV1::Missing {
                blocker_id: "missing:projectile:test",
            }
        ));

        let before = runtime.identity();
        let before_entity_sequence = runtime.entity_command_sequence;
        let entity_id = EntityId::new(9, 0xffff_fffc);
        let mut record = EntityCompatibilityRecord::new("projectile:missing:水", "projectile:missing:水", "377");
        record.class = EntityClass::Projectile;
        record.position = EntityVec3::new(8.0, 70.0, 8.0);
        record.velocity = EntityVec3::new(20.0, 0.0, 0.0);
        let mut batch = IntegratedRuntimeBatchV2::empty("spawn-missing-linked-projectile", runtime.identity());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: before_entity_sequence.saturating_add(1),
            expected_revision: runtime.entities.revision(),
            tick: runtime.tick,
            commands: vec![EntityCommand::SpawnAt {
                id: entity_id,
                record,
                residency: EntityResidency::Hot,
            }],
        });
        batch.gameplay.push(GameplayBatch::new(
            "spawn-missing-linked-projectile",
            "spawn-missing-linked-projectile",
            GameplayActor {
                actor_id: GAMEPLAY_SCHEDULER_ACTOR_ID_V1.into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            runtime.gameplay.state.identity(),
            vec![GameplayCommand::Combat(CombatCommand::UseLinkedProjectile {
                source_id: "source:水".into(),
                expected_source_revision: 1,
                target_id: "target:水".into(),
                expected_target_revision: 0,
                ability_id: "ability:linked-arrow".into(),
                projectile_id: "projectile:missing:水".into(),
                entity_id,
                content_domain: ContentDomain::Item,
                content_id: "377".into(),
                presentation_id: "missing:projectile:test".into(),
                aim: FixedVec3 {
                    x_milli: 9_000,
                    y_milli: 70_000,
                    z_milli: 8_000,
                },
                tick: runtime.gameplay.state.combat.tick,
            })],
        ));
        let receipt = runtime.commit(batch);
        assert!(!receipt.accepted());
        assert_eq!(runtime.identity(), before);
        assert_eq!(runtime.entity_command_sequence, before_entity_sequence);
        assert!(runtime.entities.residency(entity_id).is_none());
        assert!(
            !runtime
                .gameplay
                .state
                .combat
                .projectiles
                .contains_key("projectile:missing:水")
        );

        let linked_entity_id = runtime.gameplay.state.combat.projectiles["projectile:水"]
            .presentation
            .as_ref()
            .expect("exact linked projectile")
            .entity_id;
        let mut missing_record = runtime
            .entities
            .compatibility_record(linked_entity_id)
            .expect("exact linked R6 entity")
            .clone();
        missing_record.kind_key = "377".into();
        let link = runtime
            .gameplay
            .state
            .combat
            .projectiles
            .get_mut("projectile:水")
            .expect("exact linked projectile")
            .presentation
            .as_mut()
            .expect("exact link");
        link.content_id = "377".into();
        link.presentation_id = "missing:projectile:test".into();
        // This branch models a persisted V3 state whose exact catalog entry
        // became Missing after authoring. Rebuild the authority around that
        // state so the test does not retain an unrelated Exact-spawn replay
        // tail while proving decode/restore remains fail-closed and loadable.
        runtime.gameplay = GameplayAuthority::new(runtime.gameplay.state.clone());
        runtime
            .gameplay
            .grant_actor(GAMEPLAY_SCHEDULER_ACTOR_ID_V1, ActorGrant::system())
            .unwrap();
        runtime.gameplay_authority_revision = runtime.gameplay_authority_revision.saturating_add(1);
        let mut rebind = IntegratedRuntimeBatchV2::empty("restore-missing-linked-projectile", runtime.identity());
        rebind.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: runtime.entity_command_sequence.saturating_add(1),
            expected_revision: runtime.entities.revision(),
            tick: runtime.tick,
            commands: vec![EntityCommand::ReplaceCompatibilityRecord {
                id: linked_entity_id,
                value: missing_record,
            }],
        });
        let receipt = runtime.commit(rebind);
        assert!(receipt.accepted(), "missing linked restore setup rejected: {receipt:?}");
        runtime.validate_combat_presentation_bindings_v1().unwrap();
        let gameplay_snapshot = runtime.gameplay.encode_snapshot(&[0x80, 0xff]).unwrap();
        let decoded = decode_gameplay_authority_snapshot(&gameplay_snapshot)
            .expect("persisted missing link remains loadable and extraction-blocked");
        assert_eq!(decoded.authority.state, runtime.gameplay.state);
        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .expect("missing linked runtime checkpoint restores exactly");
        assert_eq!(restored.identity(), runtime.identity());
        assert!(matches!(
            restored.projectile_render_presentation_binding_v1("missing:projectile:test", ContentDomain::Item, "377",),
            IntegratedRuntimeRenderPresentationBindingV1::Missing { .. }
        ));
    }

    #[test]
    fn linked_summon_spawn_restore_expiry_and_cross_domain_rollback_are_exact() {
        let mut runtime = linked_projectile_runtime_v1(1, 9_000);
        let summon_batch = |runtime: &IntegratedRuntimeV2,
                            batch_id: &str,
                            summon_id: &str,
                            entity_id: EntityId,
                            entity_expires_tick: u64| {
            let position = FixedVec3 {
                x_milli: 12_000,
                y_milli: 70_000,
                z_milli: 8_000,
            };
            let mut record = EntityCompatibilityRecord::new(summon_id, summon_id, "summon-test");
            record.class = EntityClass::Creature;
            record.position = EntityVec3::new(12.0, 70.0, 8.0);
            let mut batch = IntegratedRuntimeBatchV2::empty(batch_id, runtime.identity());
            batch.entities.push(EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence: runtime.entity_command_sequence.saturating_add(1),
                expected_revision: runtime.entities.revision(),
                tick: runtime.tick,
                commands: vec![
                    EntityCommand::SpawnAt {
                        id: entity_id,
                        record,
                        residency: EntityResidency::Hot,
                    },
                    EntityCommand::SetSummonState {
                        id: entity_id,
                        value: Some(blockwild_entity::SummonState {
                            origin_realm_key: "fixture-realm".into(),
                            summoner_id: Some("summoner:水".into()),
                            expires_tick: entity_expires_tick,
                            grounded: false,
                            grounding_item_key: None,
                        }),
                    },
                ],
            });
            batch.gameplay.push(GameplayBatch::new(
                batch_id,
                batch_id,
                GameplayActor {
                    actor_id: GAMEPLAY_SCHEDULER_ACTOR_ID_V1.into(),
                    player_id: None,
                    entity_id: None,
                    role: ActorRole::System,
                },
                runtime.gameplay.state.identity(),
                vec![GameplayCommand::Combat(CombatCommand::SummonLinked {
                    source_id: "summoner:水".into(),
                    summon_id: summon_id.into(),
                    entity_id,
                    content_domain: ContentDomain::CreatureProfile,
                    content_id: "summon-test".into(),
                    presentation_id: "summon:test".into(),
                    position,
                    duration_ticks: Some(2),
                    grounding_item_code: None,
                    tick: runtime.gameplay.state.combat.tick,
                })],
            ));
            batch
        };

        let summon_entity_id = EntityId::new(10, 0xffff_fffb);
        let receipt = runtime.commit(summon_batch(
            &runtime,
            "spawn-linked-summon",
            "summon:水",
            summon_entity_id,
            2,
        ));
        assert!(receipt.accepted(), "linked summon spawn rejected: {receipt:?}");
        assert!(runtime.gameplay.state.combat.summons.contains_key("summon:水"));
        assert_eq!(runtime.entities.residency(summon_entity_id), Some(EntityResidency::Hot));

        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert_eq!(restored.identity(), runtime.identity());
        assert_eq!(
            restored.gameplay.state.combat.summons["summon:水"],
            runtime.gameplay.state.combat.summons["summon:水"]
        );

        let before_rejected = runtime.identity();
        let invalid_entity_id = EntityId::new(11, 0xffff_fffa);
        let rejected = runtime.commit(summon_batch(
            &runtime,
            "reject-mismatched-linked-summon",
            "summon:bad:水",
            invalid_entity_id,
            99,
        ));
        assert!(!rejected.accepted());
        assert_eq!(runtime.identity(), before_rejected);
        assert!(runtime.entities.residency(invalid_entity_id).is_none());
        assert!(!runtime.gameplay.state.combat.summons.contains_key("summon:bad:水"));

        runtime.step(1_000_000, 8_000).unwrap();
        runtime.step(1_050_000, 8_000).unwrap();
        assert!(runtime.gameplay.state.combat.summons.contains_key("summon:水"));
        assert_eq!(runtime.entities.residency(summon_entity_id), Some(EntityResidency::Hot));
        runtime.step(1_100_000, 8_000).unwrap();
        assert!(!runtime.gameplay.state.combat.summons.contains_key("summon:水"));
        assert!(runtime.entities.residency(summon_entity_id).is_none());
    }

    fn player_one_bootstrap_query() -> PlayerBootstrapStatusQueryWireV1 {
        PlayerBootstrapStatusQueryWireV1 {
            external_entity_id: "player:one".into(),
            actor_id: "player:one".into(),
            player_id: PlayerId::new(1, 1),
        }
    }

    #[test]
    fn player_bootstrap_status_is_identity_neutral_pristine_bound_restored_and_exhausted() {
        let mut pristine = runtime_with_section();
        let high_byte_query = PlayerBootstrapStatusQueryWireV1 {
            external_entity_id: "player:\u{6c34}".into(),
            actor_id: "actor:\u{6c34}".into(),
            player_id: PlayerId::new(0x89ab_cdef, 0xfedc_ba98),
        };
        let before = pristine.identity();
        let status = pristine
            .player_bootstrap_status(&high_byte_query, CanonicalHash([0x80; 16]))
            .unwrap();
        assert_eq!(pristine.identity(), before);
        assert_eq!(status.request_payload_hash, CanonicalHash([0x80; 16]));
        assert_eq!(status.next_sequence, Some(1));
        assert_eq!(status.last_input_sequence, None);
        assert_eq!(status.next_input_sequence, Some(1));
        assert_eq!(status.last_action_sequence, None);
        assert_eq!(status.next_action_sequence, Some(1));
        assert!(status.queued_inputs_empty);
        assert!(status.entity.is_none());
        assert!(status.runtime_player.is_none());
        assert!(status.world_view_binding.is_none());
        assert!(status.custody.is_none());

        pristine.entity_command_sequence = u64::MAX;
        assert_eq!(
            pristine
                .player_bootstrap_status(&high_byte_query, CanonicalHash([0x81; 16]))
                .unwrap()
                .next_sequence,
            None
        );

        let mut bound = runtime_with_bound_player();
        let before = bound.identity();
        let expected = bound
            .player_bootstrap_status(&player_one_bootstrap_query(), CanonicalHash([0x82; 16]))
            .unwrap();
        assert_eq!(bound.identity(), before);
        assert_eq!(expected.next_sequence, Some(2));
        assert_eq!(
            expected.runtime_player.as_ref().unwrap().entity_id,
            expected.entity.as_ref().unwrap().entity_id
        );
        assert_eq!(expected.world_view_binding.as_ref().unwrap().selected_slot, 0);
        assert_eq!(expected.custody.as_ref().unwrap().inventory_slots.len(), 9);
        assert_eq!(expected.custody.as_ref().unwrap().equipment_slots.len(), 8);
        assert_eq!(expected.world_authority_revision, bound.world.revision());

        bound
            .accept_inputs(&[RuntimeInputFrameV1 {
                sequence: u64::MAX,
                target_tick: 0,
                selected_slot: 0,
                ..RuntimeInputFrameV1::default()
            }])
            .unwrap();
        let queued = bound
            .player_bootstrap_status(&player_one_bootstrap_query(), CanonicalHash([0x83; 16]))
            .unwrap();
        assert_eq!(queued.last_input_sequence, Some(u64::MAX));
        assert_eq!(queued.next_input_sequence, None);
        assert!(!queued.queued_inputs_empty);
        assert!(queued.last_applied_input.is_none());
        bound.step(1_000_000, 8_000).unwrap();
        bound.step(1_050_000, 8_000).unwrap();
        let applied = bound
            .player_bootstrap_status(&player_one_bootstrap_query(), CanonicalHash([0x84; 16]))
            .unwrap();
        assert_eq!(applied.last_monotonic_time_us, 1_050_000);
        assert_eq!(applied.last_applied_input.unwrap().sequence, u64::MAX);
        assert!(applied.queued_inputs_empty);

        let checkpoint = bound.export_runtime_checkpoint().unwrap();
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert_eq!(
            restored
                .player_bootstrap_status(&player_one_bootstrap_query(), CanonicalHash([0x84; 16]))
                .unwrap(),
            applied
        );
    }

    #[test]
    fn camera_config_cas_is_stale_first_idempotent_and_capacity_bounded() {
        let mut runtime = runtime_with_bound_player();
        let initial_identity = runtime.identity();
        let initial_simulation_revision = runtime.simulation_revision;
        let initial_profile = CameraProfileV1::default();

        let unchanged = runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 0,
                    mode: CameraModeV1::FirstPerson,
                    profile: initial_profile,
                },
                CanonicalHash([0x11; 16]),
            )
            .unwrap();
        assert_eq!(unchanged.previous_camera_revision, 0);
        assert_eq!(unchanged.resulting_camera_revision, 0);
        assert_eq!(runtime.identity(), initial_identity);
        assert_eq!(runtime.simulation_revision, initial_simulation_revision);

        let changed = runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 0,
                    mode: CameraModeV1::ThirdRear,
                    profile: initial_profile,
                },
                CanonicalHash([0x12; 16]),
            )
            .unwrap();
        assert_eq!(changed.previous_camera_revision, 0);
        assert_eq!(changed.resulting_camera_revision, 1);
        assert_eq!(runtime.camera.revision, 1);
        assert_eq!(runtime.simulation_revision, initial_simulation_revision + 1);
        assert_ne!(runtime.state_hash(), initial_identity.state_hash);

        let changed_identity = runtime.identity();
        let stale = runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 0,
                    mode: CameraModeV1::ThirdRear,
                    profile: initial_profile,
                },
                CanonicalHash([0x13; 16]),
            )
            .unwrap_err();
        assert_eq!(stale.code, "camera-revision-conflict");
        assert_eq!(runtime.identity(), changed_identity);

        let idempotent = runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 1,
                    mode: CameraModeV1::ThirdRear,
                    profile: initial_profile,
                },
                CanonicalHash([0x14; 16]),
            )
            .unwrap();
        assert_eq!(idempotent.previous_camera_revision, 1);
        assert_eq!(idempotent.resulting_camera_revision, 1);
        assert_eq!(runtime.identity(), changed_identity);

        let mut near_capacity = initial_profile;
        near_capacity.third_person_distance = 32.0;
        near_capacity.rear_shoulder_offset = 4.0;
        near_capacity.collision_radius = 4.0;
        validate_runtime_camera_profile_bounds_v1(near_capacity).unwrap();
        let accepted = runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 1,
                    mode: CameraModeV1::ThirdRear,
                    profile: near_capacity,
                },
                CanonicalHash([0x15; 16]),
            )
            .unwrap();
        assert_eq!(accepted.resulting_camera_revision, 2);
        let profile_identity = runtime.identity();

        let mut over_capacity = near_capacity;
        over_capacity.third_person_distance = 33.0;
        let rejected = runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 2,
                    mode: CameraModeV1::ThirdRear,
                    profile: over_capacity,
                },
                CanonicalHash([0x16; 16]),
            )
            .unwrap_err();
        assert_eq!(rejected.code, "camera-profile-capacity");
        assert_eq!(runtime.identity(), profile_identity);
    }

    #[test]
    fn camera_pose_covers_modes_look_crouch_collision_unloaded_and_negative_states() {
        let mut runtime = runtime_with_bound_player();
        runtime.camera.look_yaw = i16::MAX;
        runtime.camera.look_pitch = i16::MIN;
        runtime.player.as_mut().unwrap().body.crouching = true;
        runtime.player.as_mut().unwrap().body.height = runtime.player.as_ref().unwrap().binding.crouching_height;
        runtime.player.as_mut().unwrap().look_pitch = i16::MIN;
        runtime.invalidate_state_hash();
        let body = runtime.player.as_ref().unwrap().body.clone();
        let first = runtime.camera_pose([1_280, 720]).unwrap();
        let crouch_scale = body.height / runtime.player.as_ref().unwrap().binding.standing_height;
        assert_eq!(first.position.x, body.position.x);
        assert_eq!(
            first.position.y,
            body.position.y + CameraProfileV1::default().eye_height * crouch_scale
        );
        assert_eq!(first.position.z, body.position.z);
        assert!(!first.collided);
        assert_eq!(first.resolved_distance, 0.0);

        runtime.player.as_mut().unwrap().body.crouching = false;
        runtime.player.as_mut().unwrap().body.height = runtime.player.as_ref().unwrap().binding.standing_height;
        runtime.camera.look_yaw = 0;
        runtime.camera.look_pitch = 0;
        runtime.player.as_mut().unwrap().look_pitch = 0;
        runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 0,
                    mode: CameraModeV1::ThirdRear,
                    profile: CameraProfileV1::default(),
                },
                CanonicalHash([0x21; 16]),
            )
            .unwrap();
        set_loaded_block(
            &mut runtime,
            "camera-rear-obstruction",
            CellPositionV1 { x: 8, y: 65, z: 10 },
            1,
        );
        let rear = runtime.camera_pose([800, 600]).unwrap();
        assert!(rear.collided);
        assert!(rear.resolved_distance < CameraProfileV1::default().third_person_distance);

        runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 1,
                    mode: CameraModeV1::ThirdFront,
                    profile: CameraProfileV1::default(),
                },
                CanonicalHash([0x22; 16]),
            )
            .unwrap();
        let front = runtime.camera_pose([800, 600]).unwrap();
        assert!(!front.collided);
        assert!(front.position.z < runtime.player.as_ref().unwrap().body.position.z);

        runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 2,
                    mode: CameraModeV1::ThirdRear,
                    profile: CameraProfileV1::default(),
                },
                CanonicalHash([0x23; 16]),
            )
            .unwrap();
        runtime.camera.look_yaw = i16::MAX / 2;
        runtime.player.as_mut().unwrap().look_pitch = runtime.camera.look_pitch;
        runtime.player.as_mut().unwrap().body.position.x = 15.0;
        let unloaded = runtime.camera_pose([800, 600]).unwrap();
        assert!(
            unloaded.collided,
            "unknown residency must shorten the camera fail closed"
        );

        for look_yaw in [i16::MIN + 1, -16_384, 0, 16_384, i16::MAX] {
            for look_pitch in [i16::MIN, -16_384, 0, 16_384, i16::MAX] {
                runtime.camera.look_yaw = look_yaw;
                runtime.camera.look_pitch = look_pitch;
                runtime.player.as_mut().unwrap().look_pitch = look_pitch;
                assert!(runtime.camera_pose([16_384, 16_384]).is_ok());
            }
        }
        assert_eq!(runtime.camera_pose([0, 600]).unwrap_err().code, "camera-viewport");
        assert_eq!(runtime.camera_pose([16_385, 600]).unwrap_err().code, "camera-viewport");

        let mut cold = runtime.clone();
        cold.entities
            .apply_batch(&EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence: cold.entity_command_sequence.saturating_add(1),
                expected_revision: cold.entities.revision(),
                tick: cold.tick,
                commands: vec![EntityCommand::Hibernate {
                    id: cold.player.as_ref().unwrap().entity_id,
                }],
            })
            .unwrap();
        assert_eq!(
            cold.camera_pose([800, 600]).unwrap_err().code,
            "camera-player-residency"
        );

        let mut unbound = runtime_with_section();
        assert_eq!(
            unbound.camera_pose([800, 600]).unwrap_err().code,
            "camera-player-binding"
        );
        unbound.stopped = true;
        assert_eq!(unbound.camera_pose([800, 600]).unwrap_err().code, "engine-stopped");
    }

    #[test]
    fn dedicated_player_inventory_import_is_atomic_and_attests_selected_slot() {
        let mut runtime = runtime_with_bound_player();
        let inventory = ContainerKey::player("player:one");
        let request = PlayerInventoryImportWireV1 {
            import: blockwild_gameplay::ImportPlayerInventoryV1 {
                inventory: inventory.clone(),
                expected_revision: 0,
                slots: vec![None; 9],
                metadata: Vec::new(),
            },
            selected_slot: 8,
        };
        let receipt = runtime
            .import_player_inventory(request.clone(), CanonicalHash([0x93; 16]))
            .unwrap();
        assert_eq!(receipt.request_payload_hash, CanonicalHash([0x93; 16]));
        assert_eq!(receipt.inventory_revision, 1);
        assert_eq!(receipt.selected_slot, 8);
        assert_ne!(receipt.before, receipt.after);
        assert_eq!(
            runtime
                .world_view
                .state
                .player_binding(PlayerId::new(1, 1))
                .unwrap()
                .selected_slot,
            8
        );
        assert_eq!(runtime.player().unwrap().selected_slot, 8);
        let after = runtime.identity();
        assert_eq!(
            runtime
                .import_player_inventory(request, CanonicalHash([0x94; 16]))
                .unwrap_err()
                .code,
            "player-inventory-import-rejected"
        );
        assert_eq!(runtime.identity(), after);
    }

    fn runtime_with_bound_player_item(count: u32) -> IntegratedRuntimeV2 {
        let item = ContentArtifact {
            domain: ContentDomain::Item,
            id: "42".into(),
            schema_id: "item-definition".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["item:42".into()],
            canonical_bytes: br#"{"id":42,"maxStack":64,"name":"Test Drop"}"#.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let missing_item = ContentArtifact {
            domain: ContentDomain::Item,
            id: "43".into(),
            schema_id: "item-definition".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["item:43".into()],
            canonical_bytes: br#"{"id":43,"maxStack":64,"name":"Missing Test Drop"}"#.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let unmapped_item = ContentArtifact {
            domain: ContentDomain::Item,
            id: "44".into(),
            schema_id: "item-definition".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["item:44".into()],
            canonical_bytes: br#"{"id":44,"maxStack":64,"name":"Unmapped Test Drop"}"#.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let machine_profile = ContentArtifact {
            domain: ContentDomain::MachineProfile,
            id: "machine-test".into(),
            schema_id: "machine-profile".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["machine-profile:machine-test".into()],
            canonical_bytes: br#"{"inputItemIds":[42]}"#.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let presentation = ContentArtifact {
            domain: ContentDomain::MachineProfile,
            id: blockwild_gameplay::RENDER_PRESENTATION_CATALOG_ID.into(),
            schema_id: "render-presentation-catalog".into(),
            schema_version: 1,
            content_version: 7,
            aliases: vec!["machine-profile:render-presentations".into()],
            canonical_bytes: br#"{"catalog":{"byteLength":785824,"canonicalHash":"52fd4aebb0c457f3c83af79af6b83c93","format":"blockwild-compiled-model-catalog-v2","modelCount":252,"nodeCount":13121,"revision":1,"schema":2,"sha256":"12c522f880e94c1ae527de701ae3e710fee13701d66fbb0a4ad24895557011b4","source":"renderer-neutral test catalog"},"integrationBlockers":["dropped-item-r6-model-binding-runtime","machine-world-view-presentation-binding-runtime"],"missingProfiles":[{"contentRefs":[{"domain":"item","id":"43"}],"id":"missing:dropped-item:test-missing","reason":"Fixture intentionally has no exact BWM2 identity.","role":"dropped-item","sourcePresentationIds":["fixture:test-missing"]},{"contentRefs":[],"id":"missing:machine:test-missing","reason":"Fixture intentionally has no exact machine BWM2 identity.","role":"machine","sourcePresentationIds":["machine.test-missing.v1"]}],"profiles":[{"contentRefs":[{"domain":"item","id":"42"}],"id":"drop:test","model":{"category":4,"groundYBits":null,"id":"test-drop-model","label":"Test Drop Model","nodeCount":3},"role":"dropped-item"},{"contentRefs":[{"domain":"machine-profile","id":"machine-test"}],"id":"machine:test","model":{"category":4,"groundYBits":null,"id":"test-machine-model","label":"Test Machine Model","nodeCount":4},"role":"machine"}],"schema":1}"#.to_vec(),
            unknown_extension_bytes: vec![0, 0x80, 0xff, 17],
        };
        let artifacts = vec![item, missing_item, unmapped_item, machine_profile, presentation];
        let bundle = compile_content_bundle("test-drop-content-v1", artifacts.clone()).unwrap();
        let mut runtime = runtime_with_bound_player_config(IntegratedRuntimeConfigV2 {
            content_hash: bundle.manifest.manifest_hash,
            ..IntegratedRuntimeConfigV2::default()
        });
        let page = ContentInstallPageWireV1 {
            install_id: "test-drop-content-install".into(),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision,
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains,
            page_index: 0,
            page_count: 1,
            artifacts,
        };
        let page_bytes = crate::encode_content_install_page_v1(&page).unwrap();
        runtime
            .install_content_page(
                page,
                CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&page_bytes)),
            )
            .unwrap();
        let player_id = runtime.player().unwrap().binding.player_id;
        let player_entity_id = runtime.player().unwrap().entity_id;
        let actor_id = runtime.player().unwrap().binding.actor_id.clone();
        let inventory_key = runtime
            .world_view()
            .state
            .player_binding(player_id)
            .unwrap()
            .inventory_container
            .clone();
        let mut state = runtime.gameplay().state.clone();
        state.inventory.containers.get_mut(&inventory_key).unwrap().slots[0] =
            (count > 0).then(|| ItemStack::simple(42, count));
        state.revision.sequence = state.revision.sequence.saturating_add(1);
        state.revision.inventory = state.revision.inventory.saturating_add(1);
        runtime.gameplay = GameplayAuthority::new(state);
        runtime
            .gameplay
            .grant_actor(actor_id.clone(), ActorGrant::host(player_id, player_entity_id))
            .unwrap();
        runtime
            .gameplay
            .grant_actor(GAMEPLAY_SCHEDULER_ACTOR_ID_V1, ActorGrant::system())
            .unwrap();
        validate_world_view_runtime_links_v1(&runtime.world_view.state, &runtime.gameplay.state, &runtime.entities)
            .unwrap();
        runtime.invalidate_state_hash();
        runtime
    }

    fn create_metadata_fixture_v1() -> ItemInstanceMetadataV1 {
        let mut metadata = ItemInstanceMetadataV1 {
            hash: CanonicalHash::default(),
            type_id: "blockwild.item.instance".into(),
            schema_id: "pickup-specimen".into(),
            schema_version: 1,
            content_version: 3,
            canonical_json_bytes: br#"{"name":"Mizu","traits":["swift"]}"#.to_vec(),
            unknown_extension_bytes: vec![0, 0x80, 0xff],
        };
        metadata.hash = metadata.calculate_hash();
        metadata
    }

    fn trigger_one_player_drop_v1(runtime: &mut IntegratedRuntimeV2) -> (u64, RuntimeInputActionReceiptV1) {
        runtime
            .accept_inputs(&[RuntimeInputFrameV1 {
                sequence: 1,
                target_tick: 1,
                buttons: RUNTIME_INPUT_BUTTON_DROP_V1,
                ..RuntimeInputFrameV1::default()
            }])
            .unwrap();
        runtime.step(1_000_000, 8_000).unwrap();
        let timestamp = 1_050_000;
        let summary = runtime.step(timestamp, 8_000).unwrap();
        let receipt = summary
            .action_receipts
            .into_iter()
            .find(|receipt| receipt.kind == RuntimeInputActionKindV1::Drop)
            .expect("drop rising edge emits one receipt");
        assert_eq!(receipt.outcome, RuntimeInputActionOutcomeV1::Applied);
        (timestamp, receipt)
    }

    fn advance_one_fixed_step_v1(runtime: &mut IntegratedRuntimeV2, timestamp: &mut u64) {
        *timestamp = timestamp.saturating_add(INTEGRATED_RUNTIME_FIXED_STEP_US);
        let summary = runtime.step(*timestamp, 8_000).unwrap();
        assert_eq!(summary.fixed_steps, 1);
    }

    fn set_drop_unlock_v1(runtime: &mut IntegratedRuntimeV2, unlock_tick: u64) {
        let drop = runtime.world_view.state.dropped_items.values().next().unwrap().clone();
        let batch_id = format!("test-drop-lock-{unlock_tick}");
        let batch = WorldViewBatchV1::new(
            &batch_id,
            &batch_id,
            system_world_view_actor_v1(),
            runtime.world_view.state.identity(),
            vec![WorldViewCommandV1::SetDropPickupLock {
                drop_id: drop.drop_id,
                expected_revision: drop.revision,
                pickup_lock_actor_id: None,
                pickup_unlock_tick: unlock_tick,
            }],
        );
        assert!(matches!(
            runtime.world_view.apply_batch(&batch, &runtime.gameplay.state),
            WorldViewReceiptV1::Accepted(_)
        ));
        runtime.invalidate_state_hash();
    }

    fn park_drop_at_player_v1(runtime: &mut IntegratedRuntimeV2) {
        let drop = runtime.world_view.state.dropped_items.values().next().unwrap().clone();
        let player = runtime.player.as_ref().unwrap();
        let position = FixedWorldVec3V1 {
            x_milli: (player.body.position.x * 1_000.0).round() as i64,
            y_milli: ((player.body.position.y + 0.8) * 1_000.0).round() as i64,
            z_milli: (player.body.position.z * 1_000.0).round() as i64,
        };
        runtime
            .apply_drop_transform_batch_v1(
                vec![EntityCommand::UpdateMotion {
                    id: drop.entity_id,
                    position: drop_position_to_entity_v1(position),
                    yaw: drop_yaw_to_radians_v1(drop.rotation.yaw),
                    velocity: EntityVec3::ZERO,
                }],
                vec![WorldViewCommandV1::UpdateDropTransform {
                    drop_id: drop.drop_id,
                    expected_revision: drop.revision,
                    position,
                    velocity_milli_per_second: FixedWorldVec3V1::default(),
                    rotation: drop.rotation,
                }],
            )
            .unwrap();
        runtime.invalidate_state_hash();
    }

    fn move_bound_player_for_drop_test_v1(runtime: &mut IntegratedRuntimeV2, position: SimulationVec3) {
        let player_id = runtime.player.as_ref().unwrap().entity_id;
        let mut body = runtime.player.as_ref().unwrap().body.clone();
        body.position = position;
        body.velocity = SimulationVec3::new(0.0, 0.0, 0.0);
        runtime.player.as_mut().unwrap().body = body;
        let mut record = runtime.entities.compatibility_record(player_id).unwrap().clone();
        record.position = EntityVec3::new(position.x as f32, position.y as f32, position.z as f32);
        record.velocity = EntityVec3::ZERO;
        let sequence = runtime.entity_command_sequence.saturating_add(1).max(1);
        let receipt = runtime
            .entities
            .apply_batch(&EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence,
                expected_revision: runtime.entities.revision(),
                tick: runtime.tick,
                commands: vec![EntityCommand::ReplaceCompatibilityRecord {
                    id: player_id,
                    value: record,
                }],
            })
            .unwrap();
        runtime.entity_command_sequence = sequence;
        runtime.sync_entity_schedules(&[receipt]).unwrap();
        runtime.invalidate_state_hash();
    }

    fn replace_gameplay_state_for_drop_test_v1(runtime: &mut IntegratedRuntimeV2, state: GameplayState) {
        let player = runtime.player.as_ref().unwrap();
        runtime.gameplay = GameplayAuthority::new(state);
        runtime
            .gameplay
            .grant_actor(
                player.binding.actor_id.clone(),
                ActorGrant::host(player.binding.player_id, player.entity_id),
            )
            .unwrap();
        runtime
            .gameplay
            .grant_actor(GAMEPLAY_SCHEDULER_ACTOR_ID_V1, ActorGrant::system())
            .unwrap();
        runtime.invalidate_state_hash();
    }

    fn runtime_with_action_content(creative_mode: bool, held: Option<ItemStack>) -> IntegratedRuntimeV2 {
        let artifacts = vec![
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "10".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["item:10".into()],
                canonical_bytes: br#"{"id":10,"maxDurability":10,"maxStack":1,"miningSpeed":10,"name":"Test Pick","tier":2,"toolKind":"pickaxe"}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "20".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["item:20".into()],
                canonical_bytes: br#"{"id":20,"maxStack":64,"name":"Test Stone","placeBlock":1}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "30".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["item:30".into()],
                canonical_bytes: br#"{"id":30,"maxStack":64,"name":"Filler"}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "40".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["item:40".into()],
                canonical_bytes: br#"{"ammoItem":30,"damage":7,"id":40,"magazineSize":1,"maxDurability":50,"maxStack":1,"name":"Test Bow","toolKind":"bow","useKind":"ranged-weapon"}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
            ContentArtifact {
                domain: ContentDomain::Item,
                id: blockwild_gameplay::BLOCK_ACTION_CATALOG_ID.into(),
                schema_id: "block-action-catalog".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["item:block-actions".into()],
                canonical_bytes: br#"{"profiles":[{"hardness":0,"id":0,"preferredTool":"hand","replaceable":true,"requiredTier":0,"solid":false,"topologyFlags":[]},{"hardness":1,"id":1,"item":20,"preferredTool":"pickaxe","replaceable":false,"requiredTier":2,"solid":true,"topologyFlags":[]},{"hardness":1,"id":2,"item":20,"preferredTool":"pickaxe","replaceable":false,"requiredTier":2,"shape":"door","solid":true,"topologyFlags":["paired"]},{"hardness":9999,"id":14,"item":20,"preferredTool":"pickaxe","replaceable":false,"requiredTier":99,"solid":true,"topologyFlags":[]}],"schema":1}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
        ];
        let bundle = compile_content_bundle("runtime-actions-v1", artifacts.clone()).unwrap();
        let mut runtime = runtime_with_bound_player_config(IntegratedRuntimeConfigV2 {
            content_hash: bundle.manifest.manifest_hash,
            ..IntegratedRuntimeConfigV2::default()
        });
        let page = ContentInstallPageWireV1 {
            install_id: "runtime-actions-install".into(),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision,
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains,
            page_index: 0,
            page_count: 1,
            artifacts,
        };
        let bytes = crate::encode_content_install_page_v1(&page).unwrap();
        runtime
            .install_content_page(page, CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&bytes)))
            .unwrap();
        runtime.player.as_mut().unwrap().binding.creative_mode = creative_mode;
        runtime.player.as_mut().unwrap().flags = u8::from(creative_mode) * RUNTIME_INPUT_FLAG_CREATIVE_V1;
        let player_id = runtime.player.as_ref().unwrap().binding.player_id;
        let player_entity_id = runtime.player.as_ref().unwrap().entity_id;
        let actor_id = runtime.player.as_ref().unwrap().binding.actor_id.clone();
        let inventory_key = runtime
            .world_view
            .state
            .player_binding(player_id)
            .unwrap()
            .inventory_container
            .clone();
        let mut state = runtime.gameplay.state.clone();
        state.inventory.containers.get_mut(&inventory_key).unwrap().slots[0] = held;
        state.revision.sequence = state.revision.sequence.saturating_add(1);
        state.revision.inventory = state.revision.inventory.saturating_add(1);
        runtime.gameplay = GameplayAuthority::new(state);
        runtime
            .gameplay
            .grant_actor(actor_id, ActorGrant::host(player_id, player_entity_id))
            .unwrap();
        runtime
            .gameplay
            .grant_actor(GAMEPLAY_SCHEDULER_ACTOR_ID_V1, ActorGrant::system())
            .unwrap();
        runtime.invalidate_state_hash();
        runtime
    }

    fn runtime_with_generated_action_content(creative_mode: bool, held: Option<ItemStack>) -> IntegratedRuntimeV2 {
        let mut artifacts = vec![
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "1".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["item:1".into()],
                canonical_bytes: br#"{"id":1,"maxStack":1,"name":"Generated Produce","placeBlock":1}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "2".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["item:2".into()],
                canonical_bytes: br#"{"id":2,"maxStack":1,"name":"Generated Seed","placeBlock":1,"useKind":"plant"}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "10".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["item:10".into()],
                canonical_bytes: br#"{"id":10,"maxDurability":10,"maxStack":1,"miningSpeed":10,"name":"Generated Pick","tier":2,"toolKind":"pickaxe"}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "30".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["item:30".into()],
                canonical_bytes: br#"{"id":30,"maxStack":64,"name":"Inventory Filler"}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
            ContentArtifact {
                domain: ContentDomain::Item,
                id: blockwild_gameplay::BLOCK_ACTION_CATALOG_ID.into(),
                schema_id: "block-action-catalog".into(),
                schema_version: 2,
                content_version: 2,
                aliases: vec!["item:block-actions".into()],
                canonical_bytes: br#"{"authorityBlockers":["authoritative-rng-context-unbound","dynamic-session-dispatch-runtime","game-mode-host-custody-runtime","legacy-computed-loot-source-runtime","world-support-collision-runtime"],"profiles":[{"breakProfile":{"contextualOverride":"none","durabilityCost":{"kind":"none"},"loot":{"mode":"none","rules":[],"selfDropMode":"absent","silkTouch":"not-authored"},"replacement":"blocked","wrongTool":"break-no-loot"},"hardness":0,"id":0,"placementIntent":"none","preferredTool":"hand","replaceable":true,"requiredTier":0,"solid":false,"topologyFlags":[]},{"authorityBlockers":["authoritative-rng-context-unbound"],"breakProfile":{"contextualOverride":"none","durabilityCost":{"amount":1,"kind":"constant"},"loot":{"mode":"all","rules":[{"chanceMillionths":1000000,"chanceModifier":"none","count":{"base":2,"floorRollMultiplier":2,"kind":"shared-roll-formula","scytheBonus":1,"thresholdBonuses":[{"aboveMillionths":560000,"amount":1,"scytheOnly":false}]},"id":"produce","item":1,"ordinal":0,"rollScope":"shared-plant-yield"},{"chanceMillionths":1000000,"chanceModifier":"none","count":{"kind":"constant","value":1},"id":"seed","item":2,"ordinal":1,"rollScope":"shared-plant-yield"}],"selfDropMode":"contextual","silkTouch":"not-authored"},"replacement":"air","wrongTool":"break-no-loot"},"hardness":0.5,"harvestIntent":{"preserveCultivated":true,"replacementWithScythe":1,"replacementWithoutScythe":1,"replantedWithScythe":true,"replantedWithoutScythe":true,"scytheDurabilityCost":1},"id":1,"interactionIntents":["harvest","plant"],"item":1,"placementIntent":"direct","placementItems":[1,2],"plantingRules":[{"above":"air","item":2,"resultBlock":1}],"preferredTool":"pickaxe","replaceable":false,"requiredTier":2,"solid":true,"topologyFlags":[]},{"authorityBlockers":["authoritative-rng-context-unbound","player-luck-context-runtime"],"breakProfile":{"contextualOverride":"none","durabilityCost":{"amount":1,"kind":"constant"},"loot":{"mode":"all","rules":[{"chanceMillionths":220000,"chanceModifier":"luck-adjusted-v1","count":{"kind":"uniform-inclusive","maximum":2,"minimum":1},"id":"fiber","item":1,"ordinal":0,"rollScope":"random-drop-v1"}],"selfDropMode":"contextual","silkTouch":"not-authored"},"replacement":"air","wrongTool":"break-no-loot"},"hardness":0.1,"id":2,"placementIntent":"none","preferredTool":"hand","replaceable":true,"requiredTier":0,"solid":false,"topologyFlags":[]},{"authorityBlockers":["authoritative-rng-context-unbound"],"breakProfile":{"contextualOverride":"none","durabilityCost":{"amount":1,"kind":"constant"},"loot":{"mode":"exclusive","rules":[{"chanceMillionths":160000,"chanceModifier":"none","count":{"kind":"constant","value":1},"id":"first","item":1,"ordinal":0,"rollScope":"shared-exclusive"},{"chanceMillionths":840000,"chanceModifier":"none","count":{"kind":"constant","value":1},"id":"second","item":2,"ordinal":1,"rollScope":"shared-exclusive"}],"selfDropMode":"contextual","silkTouch":"not-authored"},"replacement":"air","wrongTool":"break-no-loot"},"hardness":0.2,"id":3,"placementIntent":"none","preferredTool":"hand","replaceable":true,"requiredTier":0,"solid":false,"topologyFlags":[]},{"authorityBlockers":["authoritative-rng-context-unbound"],"breakProfile":{"contextualOverride":"none","durabilityCost":{"amount":1,"kind":"constant"},"loot":{"mode":"none","rules":[],"selfDropMode":"absent","silkTouch":"not-authored"},"replacement":"air","wrongTool":"break-no-loot"},"hardness":0.2,"id":4,"placementIntent":"none","preferredTool":"hand","replaceable":true,"requiredTier":0,"solid":false,"topologyFlags":[]}],"rngSemantics":{"algorithm":"xorshift32","exclusiveSelection":"less-than-cumulative-v1","ordering":"stable-profile-rule-order-v1","plantYieldClampMaximumMillionths":999900,"randomDropGate":"less-than-or-equal-v1","seedDerivation":"blockwild-seed-stream-v1","stream":"block-action-loot-v1","unit":"u32-open-upper-v1"},"schema":2}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
        ];
        artifacts.sort_by(|left, right| (left.domain, left.id.as_str()).cmp(&(right.domain, right.id.as_str())));
        let bundle = compile_content_bundle("runtime-actions-v2", artifacts.clone()).unwrap();
        let mut runtime = runtime_with_bound_player_config(IntegratedRuntimeConfigV2 {
            content_hash: bundle.manifest.manifest_hash,
            ..IntegratedRuntimeConfigV2::default()
        });
        let page = ContentInstallPageWireV1 {
            install_id: "runtime-actions-v2-install".into(),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision,
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains,
            page_index: 0,
            page_count: 1,
            artifacts,
        };
        let bytes = crate::encode_content_install_page_v1(&page).unwrap();
        runtime
            .install_content_page(page, CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&bytes)))
            .unwrap();
        runtime.player.as_mut().unwrap().binding.creative_mode = creative_mode;
        runtime.player.as_mut().unwrap().flags = u8::from(creative_mode) * RUNTIME_INPUT_FLAG_CREATIVE_V1;
        let player_id = runtime.player.as_ref().unwrap().binding.player_id;
        let player_entity_id = runtime.player.as_ref().unwrap().entity_id;
        let actor_id = runtime.player.as_ref().unwrap().binding.actor_id.clone();
        let inventory_key = runtime
            .world_view
            .state
            .player_binding(player_id)
            .unwrap()
            .inventory_container
            .clone();
        let mut state = runtime.gameplay.state.clone();
        state.inventory.containers.get_mut(&inventory_key).unwrap().slots[0] = held;
        state.revision.sequence = state.revision.sequence.saturating_add(1);
        state.revision.inventory = state.revision.inventory.saturating_add(1);
        runtime.gameplay = GameplayAuthority::new(state);
        runtime
            .gameplay
            .grant_actor(actor_id, ActorGrant::host(player_id, player_entity_id))
            .unwrap();
        runtime
            .gameplay
            .grant_actor(GAMEPLAY_SCHEDULER_ACTOR_ID_V1, ActorGrant::system())
            .unwrap();
        runtime.invalidate_state_hash();
        runtime
    }

    fn complete_generated_break_v9(
        runtime: &mut IntegratedRuntimeV2,
        input_sequence: u64,
        position: CellPositionV1,
        block_id: u16,
    ) -> bool {
        set_loaded_block(
            runtime,
            &format!("generated-block-{input_sequence}"),
            position,
            block_id,
        );
        complete_loaded_generated_break_v9(runtime, input_sequence, position, block_id)
    }

    fn complete_loaded_generated_break_v9(
        runtime: &mut IntegratedRuntimeV2,
        input_sequence: u64,
        position: CellPositionV1,
        block_id: u16,
    ) -> bool {
        let profile = runtime.gameplay_content_runtime.block_action(block_id).unwrap().clone();
        let tool = runtime.mining_tool_v1(profile.preferred_tool).unwrap();
        let harvested = profile.required_tier == 0
            || (tool.tool_kind == profile.preferred_tool && tool.tier >= profile.required_tier);
        runtime
            .complete_generated_block_break_v9(
                action_input(input_sequence, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1),
                position,
                &profile,
                &tool,
                harvested,
            )
            .unwrap()
    }

    fn generated_plan_v9(
        runtime: &IntegratedRuntimeV2,
        input_sequence: u64,
        position: CellPositionV1,
        block_id: u16,
    ) -> BlockActionLootPlanV1 {
        let profile = runtime.gameplay_content_runtime.block_action(block_id).unwrap();
        let tool = runtime.mining_tool_v1(profile.preferred_tool).unwrap();
        let harvested = profile.required_tier == 0
            || (tool.tool_kind == profile.preferred_tool && tool.tier >= profile.required_tier);
        let report = runtime
            .gameplay_content_runtime
            .action_promotion_report_v1()
            .unwrap()
            .unwrap();
        let binding =
            BlockActionLootBindingV1::from_installed_content_v1(&runtime.gameplay_content_runtime, &report).unwrap();
        evaluate_block_action_loot_v1(
            &binding,
            profile,
            &block_action_item_max_stacks_v1(&runtime.gameplay_content_runtime).unwrap(),
            &BlockActionLootContextV1 {
                block_action_sequence: runtime.next_block_action_sequence.unwrap(),
                origin_input_sequence: input_sequence,
                block_id,
                position: BlockActionLootCellV1 {
                    x: position.x,
                    y: position.y,
                    z: position.z,
                },
                harvested,
                creative_mode: runtime.player.as_ref().unwrap().binding.creative_mode,
                scythe: tool.scythe,
            },
            runtime.block_action_loot_rng,
        )
        .unwrap()
    }

    fn generated_action_domain_fingerprint_v9(
        runtime: &IntegratedRuntimeV2,
    ) -> (
        CanonicalHash,
        CanonicalHash,
        CanonicalHash,
        CanonicalHash,
        BlockActionLootRngCursorV1,
        Option<u64>,
        usize,
        CanonicalHash,
    ) {
        (
            runtime.world.canonical_state_hash(),
            runtime.entities.canonical_hash(),
            runtime.gameplay.state.state_hash(),
            runtime.world_view.state.identity().state_hash,
            runtime.block_action_loot_rng,
            runtime.next_block_action_sequence,
            runtime.block_action_receipts.len(),
            runtime.replay_hash(),
        )
    }

    fn action_input(sequence: u64, buttons: u32) -> RuntimeInputFrameV1 {
        RuntimeInputFrameV1 {
            sequence,
            target_tick: sequence,
            buttons,
            selected_slot: 0,
            ..RuntimeInputFrameV1::default()
        }
    }

    fn set_loaded_block(runtime: &mut IntegratedRuntimeV2, batch_id: &str, position: CellPositionV1, block_id: u16) {
        let mut batch = IntegratedRuntimeBatchV2::empty(batch_id, runtime.identity());
        batch.world.push(WorldMutationBatchR4V1 {
            schema_version: blockwild_authority::WORLD_AUTHORITY_SCHEMA_V1,
            batch_id: batch_id.into(),
            authority_id: "test".into(),
            address: runtime.world.active_address().clone(),
            expected_revision: runtime.world.revision(),
            commands: vec![WorldMutationCommandR4V1::SetBlock {
                position,
                block_id,
                facing: None,
            }],
        });
        assert!(runtime.commit(batch).accepted());
    }

    fn action_target_position() -> CellPositionV1 {
        CellPositionV1 { x: 8, y: 65, z: 5 }
    }

    fn test_pick(tier_durability_millionths: u32) -> ItemStack {
        ItemStack {
            item_code: 10,
            count: 1,
            durability_millionths: Some(tier_durability_millionths),
            metadata_hash: CanonicalHash::default(),
        }
    }

    #[test]
    fn generated_loot_v9_is_deterministic_multistack_and_ignores_player_inventory_capacity() {
        let mut first = runtime_with_generated_action_content(false, Some(test_pick(1_000_000)));
        let mut second = first.clone();
        for runtime in [&mut first, &mut second] {
            let player_id = runtime.player.as_ref().unwrap().binding.player_id;
            let inventory = runtime
                .world_view
                .state
                .player_binding(player_id)
                .unwrap()
                .inventory_container
                .clone();
            let mut state = runtime.gameplay.state.clone();
            let slots = &mut state.inventory.containers.get_mut(&inventory).unwrap().slots;
            for slot in slots.iter_mut().skip(1) {
                *slot = Some(ItemStack::simple(30, 64));
            }
            state.revision.sequence = state.revision.sequence.saturating_add(1);
            state.revision.inventory = state.revision.inventory.saturating_add(1);
            replace_gameplay_state_for_drop_test_v1(runtime, state);
        }
        let target = action_target_position();
        assert!(complete_generated_break_v9(&mut first, 1, target, 1));
        assert!(complete_generated_break_v9(&mut second, 1, target, 1));

        assert_eq!(first.identity(), second.identity());
        assert_eq!(first.block_action_receipts, second.block_action_receipts);
        let receipt = first.block_action_receipts.back().unwrap();
        assert_eq!(receipt.plan.draws.len(), 1);
        assert!(
            receipt.plan.stacks.len() >= 3,
            "one-count item limits must produce a multi-stack drop set"
        );
        assert_eq!(receipt.plan.stacks.len(), receipt.generated_drops.len());
        assert_eq!(
            loaded_block_id(&first, target),
            1,
            "harvest intent deterministically replants"
        );
        for generated in &receipt.generated_drops {
            let drop_id = generated.provenance.drop_id_v1();
            let custody = ContainerKey {
                kind: ContainerKind::Container,
                id: generated.provenance.custody_id_v1(),
                owner_id: None,
            };
            assert!(first.entities.contains(generated.entity_id));
            assert!(first.world_view.state.dropped_items.contains_key(&drop_id));
            assert!(first.gameplay.state.inventory.containers.contains_key(&custody));
        }
        assert_eq!(first.block_action_loot_rng, receipt.plan.rng_after);
        assert_eq!(first.next_block_action_sequence, Some(2));
        first.validate_block_action_history_v1().unwrap();
    }

    #[test]
    fn generated_loot_v9_creative_wrong_tier_luck_and_capacity_paths_are_predraw_exact() {
        let target = action_target_position();

        let mut creative = runtime_with_generated_action_content(true, Some(ItemStack::simple(30, 1)));
        set_loaded_block(&mut creative, "generated-creative", target, 3);
        let before_creative_world = creative.world.canonical_state_hash();
        let before_creative_entities = creative.entities.canonical_hash();
        let before_creative_gameplay = creative.gameplay.state.state_hash();
        let before_creative_view = creative.world_view.state.identity();
        let before_creative_rng = creative.block_action_loot_rng;
        assert!(complete_loaded_generated_break_v9(&mut creative, 1, target, 3));
        assert_ne!(creative.world.canonical_state_hash(), before_creative_world);
        assert_eq!(creative.entities.canonical_hash(), before_creative_entities);
        assert_eq!(creative.gameplay.state.state_hash(), before_creative_gameplay);
        assert_eq!(creative.world_view.state.identity(), before_creative_view);
        assert_eq!(creative.block_action_loot_rng, before_creative_rng);
        assert_eq!(loaded_block_id(&creative, target), WORLD_AIR_BLOCK_ID_V1);
        assert!(creative.block_action_receipts.back().unwrap().plan.stacks.is_empty());

        let mut wrong_tier = runtime_with_generated_action_content(false, None);
        set_loaded_block(&mut wrong_tier, "generated-wrong-tier", target, 1);
        let wrong_tier_rng = wrong_tier.block_action_loot_rng;
        assert!(complete_loaded_generated_break_v9(&mut wrong_tier, 1, target, 1));
        let wrong_plan = &wrong_tier.block_action_receipts.back().unwrap().plan;
        assert!(!wrong_plan.context.harvested);
        assert!(wrong_plan.draws.is_empty());
        assert!(wrong_plan.stacks.is_empty());
        assert_eq!(wrong_tier.block_action_loot_rng, wrong_tier_rng);

        let mut zero_loot = runtime_with_generated_action_content(false, None);
        let zero_rng = zero_loot.block_action_loot_rng;
        assert!(complete_generated_break_v9(&mut zero_loot, 1, target, 4));
        assert!(zero_loot.block_action_receipts.back().unwrap().plan.draws.is_empty());
        assert!(zero_loot.block_action_receipts.back().unwrap().plan.stacks.is_empty());
        assert_eq!(zero_loot.block_action_loot_rng, zero_rng);

        let blocked_id = 2_u16;
        let mut blocked = runtime_with_generated_action_content(false, None);
        set_loaded_block(
            &mut blocked,
            &format!("generated-predraw-{blocked_id}"),
            target,
            blocked_id,
        );
        let before = generated_action_domain_fingerprint_v9(&blocked);
        assert!(!complete_loaded_generated_break_v9(&mut blocked, 1, target, blocked_id));
        assert_eq!(generated_action_domain_fingerprint_v9(&blocked), before);
        assert_eq!(loaded_block_id(&blocked, target), blocked_id);
        assert!(blocked.block_action_receipts.is_empty());
    }

    #[test]
    fn generated_loot_v9_promotion_assessment_closes_only_rng_and_never_authorizes_capability() {
        let runtime = runtime_with_generated_action_content(false, None);
        let assessment = runtime.block_action_promotion_assessment_v1().unwrap().unwrap();
        assert!(!assessment.closed_blockers.is_empty());
        assert!(
            assessment
                .closed_blockers
                .iter()
                .all(|blocker| blocker.blocker_id == AUTHORITATIVE_RNG_CONTEXT_UNBOUND_V1)
        );
        assert!(
            assessment
                .remaining_blockers
                .iter()
                .all(|blocker| blocker.blocker_id != AUTHORITATIVE_RNG_CONTEXT_UNBOUND_V1)
        );
        assert_eq!(
            assessment.remaining_support_level,
            ContentActionPromotionSupportLevelV1::DeclaredBlocked
        );
        assert!(!assessment.capability_authorized);
        assert_eq!(assessment.assessment_hash, assessment.calculate_hash_v1());
    }

    #[test]
    fn schema1_block_break_does_not_touch_v9_rng_sequence_or_receipts() {
        let mut runtime = runtime_with_action_content(false, Some(test_pick(1_000_000)));
        let target = action_target_position();
        let before_rng = runtime.block_action_loot_rng;
        let before_sequence = runtime.next_block_action_sequence;
        set_loaded_block(&mut runtime, "schema1-v9-isolation", target, 1);
        let profile = runtime.gameplay_content_runtime.block_action(1).unwrap().clone();
        let tool = runtime.mining_tool_v1(profile.preferred_tool).unwrap();
        runtime
            .complete_basic_block_break(
                action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1),
                target,
                &profile,
                &tool,
            )
            .unwrap();
        assert_eq!(loaded_block_id(&runtime, target), WORLD_AIR_BLOCK_ID_V1);
        assert_eq!(runtime.block_action_loot_rng, before_rng);
        assert_eq!(runtime.next_block_action_sequence, before_sequence);
        assert!(runtime.block_action_receipts.is_empty());
    }

    #[test]
    fn generated_loot_v9_rolls_back_r4_r6_r7_and_world_view_failures_exactly() {
        let target = action_target_position();
        let mut base = runtime_with_generated_action_content(false, None);
        set_loaded_block(&mut base, "generated-rollback-base", target, 3);
        let input = action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1);
        let plan = generated_plan_v9(&base, input.sequence, target, 3);

        let mut probe = base.clone();
        assert!(complete_loaded_generated_break_v9(
            &mut probe,
            input.sequence,
            target,
            3
        ));
        let generated = probe.block_action_receipts.back().unwrap().generated_drops[0].clone();
        let drop_id = generated.provenance.drop_id_v1();
        let custody = ContainerKey {
            kind: ContainerKind::Container,
            id: generated.provenance.custody_id_v1(),
            owner_id: None,
        };
        let probe_record = probe
            .entities
            .compatibility_record(generated.entity_id)
            .unwrap()
            .clone();
        let probe_container = probe.gameplay.state.inventory.containers.get(&custody).unwrap().clone();
        let probe_drop = probe.world_view.state.dropped_items.get(&drop_id).unwrap().clone();

        let mut r4 = base.clone();
        let r4_before = generated_action_domain_fingerprint_v9(&r4);
        let r4_player = r4.player.as_ref().unwrap().clone();
        assert!(
            !r4.commit_generated_block_action_v9(&r4_player, input, target, u16::MAX, 0, plan.clone())
                .unwrap()
        );
        assert_eq!(generated_action_domain_fingerprint_v9(&r4), r4_before);

        let mut r6 = base.clone();
        commit_entity_commands(
            &mut r6,
            "generated-r6-collision",
            vec![EntityCommand::Spawn {
                record: probe_record,
                residency: EntityResidency::Hot,
            }],
        );
        let r6_before = generated_action_domain_fingerprint_v9(&r6);
        let r6_player = r6.player.as_ref().unwrap().clone();
        assert!(
            !r6.commit_generated_block_action_v9(&r6_player, input, target, WORLD_AIR_BLOCK_ID_V1, 0, plan.clone(),)
                .unwrap()
        );
        assert_eq!(generated_action_domain_fingerprint_v9(&r6), r6_before);

        let mut r7 = base.clone();
        let mut gameplay = r7.gameplay.state.clone();
        gameplay.inventory.containers.insert(custody.clone(), probe_container);
        gameplay.revision.sequence = gameplay.revision.sequence.saturating_add(1);
        gameplay.revision.inventory = gameplay.revision.inventory.saturating_add(1);
        replace_gameplay_state_for_drop_test_v1(&mut r7, gameplay);
        let r7_before = generated_action_domain_fingerprint_v9(&r7);
        let r7_player = r7.player.as_ref().unwrap().clone();
        assert!(
            !r7.commit_generated_block_action_v9(&r7_player, input, target, WORLD_AIR_BLOCK_ID_V1, 0, plan.clone(),)
                .unwrap()
        );
        assert_eq!(generated_action_domain_fingerprint_v9(&r7), r7_before);

        let mut world_view = base;
        world_view.world_view.state.dropped_items.insert(drop_id, probe_drop);
        world_view.invalidate_state_hash();
        let world_view_before = generated_action_domain_fingerprint_v9(&world_view);
        let world_view_player = world_view.player.as_ref().unwrap().clone();
        assert!(
            !world_view
                .commit_generated_block_action_v9(&world_view_player, input, target, WORLD_AIR_BLOCK_ID_V1, 0, plan,)
                .unwrap()
        );
        assert_eq!(generated_action_domain_fingerprint_v9(&world_view), world_view_before);
    }

    #[test]
    fn generated_loot_v9_rejects_target_drift_before_world_or_loot_mutation() {
        let target = action_target_position();
        let mut runtime = runtime_with_generated_action_content(false, None);
        set_loaded_block(&mut runtime, "generated-target-plan", target, 3);
        let input = action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1);
        let plan = generated_plan_v9(&runtime, input.sequence, target, 3);

        set_loaded_block(&mut runtime, "generated-target-drift", target, 4);
        let before = generated_action_domain_fingerprint_v9(&runtime);
        let player = runtime.player.as_ref().unwrap().clone();
        let error = runtime
            .commit_generated_block_action_v9(&player, input, target, WORLD_AIR_BLOCK_ID_V1, 0, plan)
            .unwrap_err();

        assert_eq!(error.code, "block-action-target-drift");
        assert_eq!(loaded_block_id(&runtime, target), 4);
        assert_eq!(generated_action_domain_fingerprint_v9(&runtime), before);
    }

    #[test]
    fn generated_loot_v9_defense_in_depth_rejects_over_32_stacks_before_runtime_rng() {
        let mut runtime = runtime_with_generated_action_content(false, Some(test_pick(1_000_000)));
        let target = action_target_position();
        set_loaded_block(&mut runtime, "generated-capacity-defense", target, 1);
        let catalog = runtime
            .gameplay_content_runtime
            .block_action_catalogs
            .get_mut(blockwild_gameplay::BLOCK_ACTION_CATALOG_ID)
            .unwrap();
        let count = &mut catalog
            .profiles
            .get_mut(&1)
            .unwrap()
            .break_profile
            .as_mut()
            .unwrap()
            .loot
            .rules[0]
            .count;
        *count = blockwild_gameplay::ContentBlockLootCount::Constant(33);
        let before = generated_action_domain_fingerprint_v9(&runtime);
        assert!(!complete_loaded_generated_break_v9(&mut runtime, 1, target, 1));
        assert_eq!(generated_action_domain_fingerprint_v9(&runtime), before);
        assert_eq!(loaded_block_id(&runtime, target), 1);
    }

    #[test]
    fn generated_loot_v9_detects_a_single_orphan_in_a_multistack_receipt() {
        let mut runtime = runtime_with_generated_action_content(false, Some(test_pick(1_000_000)));
        let target = action_target_position();
        assert!(complete_generated_break_v9(&mut runtime, 1, target, 1));
        let generated = runtime.block_action_receipts.back().unwrap().generated_drops[1].clone();
        runtime
            .world_view
            .state
            .dropped_items
            .remove(&generated.provenance.drop_id_v1());
        assert_eq!(
            runtime.validate_block_action_history_v1().unwrap_err().code,
            "block-action-drop-orphan"
        );
    }

    #[test]
    fn generated_loot_v9_receipt_eviction_waits_for_live_drop_then_retry_is_stale_safe() {
        let mut runtime = runtime_with_generated_action_content(false, None);
        let target = action_target_position();
        assert!(complete_generated_break_v9(&mut runtime, 1, target, 3));
        let oldest_drop = runtime.block_action_receipts.front().unwrap().generated_drops[0].clone();
        for sequence in 2..=INTEGRATED_RUNTIME_MAX_BLOCK_ACTION_RECEIPTS_V1 as u64 {
            assert!(complete_generated_break_v9(&mut runtime, sequence, target, 4));
        }
        assert_eq!(
            runtime.block_action_receipts.len(),
            INTEGRATED_RUNTIME_MAX_BLOCK_ACTION_RECEIPTS_V1
        );
        assert_eq!(
            runtime
                .block_action_receipts
                .front()
                .unwrap()
                .plan
                .context
                .block_action_sequence,
            1
        );

        set_loaded_block(&mut runtime, "generated-eviction-blocked", target, 4);
        let blocked_plan = generated_plan_v9(&runtime, 257, target, 4);
        let before_blocked = generated_action_domain_fingerprint_v9(&runtime);
        assert!(!complete_loaded_generated_break_v9(&mut runtime, 257, target, 4));
        assert_eq!(generated_action_domain_fingerprint_v9(&runtime), before_blocked);

        set_drop_unlock_v1(&mut runtime, 0);
        park_drop_at_player_v1(&mut runtime);
        let mut timestamp = 1_000_000;
        runtime.step(timestamp, 8_000).unwrap();
        advance_one_fixed_step_v1(&mut runtime, &mut timestamp);
        assert!(!runtime.entities.contains(oldest_drop.entity_id));
        assert!(
            !runtime
                .world_view
                .state
                .dropped_items
                .contains_key(&oldest_drop.provenance.drop_id_v1())
        );
        assert!(
            !runtime.gameplay.state.inventory.containers.contains_key(&ContainerKey {
                kind: ContainerKind::Container,
                id: oldest_drop.provenance.custody_id_v1(),
                owner_id: None,
            })
        );

        assert!(complete_loaded_generated_break_v9(&mut runtime, 257, target, 4));
        assert_eq!(
            runtime.block_action_receipts.len(),
            INTEGRATED_RUNTIME_MAX_BLOCK_ACTION_RECEIPTS_V1
        );
        assert_eq!(
            runtime
                .block_action_receipts
                .front()
                .unwrap()
                .plan
                .context
                .block_action_sequence,
            2
        );
        assert_eq!(
            runtime
                .block_action_receipts
                .back()
                .unwrap()
                .plan
                .context
                .block_action_sequence,
            257
        );
        let after_success = generated_action_domain_fingerprint_v9(&runtime);
        let player = runtime.player.as_ref().unwrap().clone();
        assert_eq!(
            runtime
                .commit_generated_block_action_v9(
                    &player,
                    action_input(257, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1),
                    target,
                    WORLD_AIR_BLOCK_ID_V1,
                    0,
                    blocked_plan,
                )
                .unwrap_err()
                .code,
            "block-action-plan-context"
        );
        assert_eq!(generated_action_domain_fingerprint_v9(&runtime), after_success);
        runtime.validate_block_action_history_v1().unwrap();
    }

    #[test]
    fn generated_loot_v9_terminal_sequence_persists_none_and_rejects_future_actions_atomically() {
        let mut runtime = runtime_with_generated_action_content(false, None);
        runtime.next_block_action_sequence = Some(u64::MAX);
        let target = action_target_position();
        assert!(complete_generated_break_v9(&mut runtime, 1, target, 4));
        assert_eq!(
            runtime
                .block_action_receipts
                .back()
                .unwrap()
                .plan
                .context
                .block_action_sequence,
            u64::MAX
        );
        assert_eq!(runtime.next_block_action_sequence, None);
        let core = decode_runtime_core_snapshot_v1(&encode_runtime_core_snapshot_v1(&runtime).unwrap()).unwrap();
        assert_eq!(core.next_block_action_sequence, None);
        assert_eq!(core.block_action_receipts, runtime.block_action_receipts);
        set_loaded_block(&mut runtime, "generated-sequence-exhausted", target, 4);
        let before = generated_action_domain_fingerprint_v9(&runtime);
        assert!(!complete_loaded_generated_break_v9(&mut runtime, 2, target, 4));
        assert_eq!(generated_action_domain_fingerprint_v9(&runtime), before);
    }

    #[test]
    fn generated_loot_v9_checkpoint_restores_motion_then_pickup_and_absent_links() {
        let mut runtime = runtime_with_generated_action_content(false, None);
        let target = action_target_position();
        assert!(complete_generated_break_v9(&mut runtime, 1, target, 3));
        let generated = runtime.block_action_receipts.back().unwrap().generated_drops[0].clone();
        let drop_id = generated.provenance.drop_id_v1();
        let start_position = runtime.world_view.state.dropped_items.get(&drop_id).unwrap().position;
        accept_all_authority_commits(&mut runtime);
        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let mut restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert_eq!(restored.identity(), runtime.identity());
        assert_eq!(restored.block_action_receipts, runtime.block_action_receipts);

        let mut timestamp = 1_000_000;
        restored.step(timestamp, 8_000).unwrap();
        advance_one_fixed_step_v1(&mut restored, &mut timestamp);
        assert_ne!(
            restored.world_view.state.dropped_items.get(&drop_id).unwrap().position,
            start_position
        );
        let unlock_tick = restored.tick;
        set_drop_unlock_v1(&mut restored, unlock_tick);
        park_drop_at_player_v1(&mut restored);
        advance_one_fixed_step_v1(&mut restored, &mut timestamp);
        assert!(!restored.entities.contains(generated.entity_id));
        assert!(!restored.world_view.state.dropped_items.contains_key(&drop_id));
        assert!(
            !restored
                .gameplay
                .state
                .inventory
                .containers
                .contains_key(&ContainerKey {
                    kind: ContainerKind::Container,
                    id: generated.provenance.custody_id_v1(),
                    owner_id: None,
                })
        );
        restored.validate_block_action_history_v1().unwrap();
        accept_all_authority_commits(&mut restored);
        let picked_checkpoint = restored.export_runtime_checkpoint().unwrap();
        let picked = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &picked_checkpoint,
            integrated_runtime_checkpoint_hash_v1(&picked_checkpoint),
        )
        .unwrap();
        assert_eq!(picked.identity(), restored.identity());
        assert_eq!(picked.block_action_receipts, restored.block_action_receipts);
        picked.validate_block_action_history_v1().unwrap();
    }

    #[test]
    fn generated_loot_v9_codec_rejects_receipt_tamper_and_recovery_rejects_content_drift() {
        let mut runtime = runtime_with_generated_action_content(false, None);
        let target = action_target_position();
        assert!(complete_generated_break_v9(&mut runtime, 1, target, 3));
        let valid_core = encode_runtime_core_snapshot_v1(&runtime).unwrap();
        let receipt = runtime.block_action_receipts.back().unwrap();
        let mut receipt_writer = NativeWriterV1::default();
        write_block_action_receipt_native_v1(&mut receipt_writer, receipt).unwrap();
        let receipt_bytes = receipt_writer.finish();
        let offset = valid_core
            .windows(receipt_bytes.len())
            .position(|window| window == receipt_bytes)
            .expect("receipt encoding is present in the V9 runtime core");
        let mut tampered = valid_core;
        tampered[offset + receipt_bytes.len() - 1] ^= 1;
        assert_eq!(
            decode_runtime_core_snapshot_v1(&tampered).unwrap_err().code,
            "block-action-receipt-hash"
        );

        let mut recovered = force_unattested_native_recovery(&mut runtime);
        rewrite_recovery_runtime_core(&mut recovered, |core| {
            let receipt = core.block_action_receipts.back_mut().unwrap();
            receipt.plan.binding.catalog_content_version =
                receipt.plan.binding.catalog_content_version.saturating_add(1);
            receipt.plan.plan_hash = receipt.plan.calculate_hash_v1();
            for generated in &mut receipt.generated_drops {
                generated.provenance.loot_plan_hash = receipt.plan.plan_hash;
            }
            receipt.receipt_hash = receipt.calculate_hash_v1();
            core.durable_state_proof = Some(durable_runtime_core_state_proof_v1(core).unwrap());
        });
        let mut target_runtime = IntegratedRuntimeV2::new(runtime.config.clone()).unwrap();
        target_runtime
            .recovered_save_sets
            .insert("generated-content-drift".into(), recovered);
        let before = target_runtime.identity();
        assert_eq!(
            target_runtime
                .hydrate_recovery("generated-content-drift")
                .unwrap_err()
                .code,
            "block-action-content-drift"
        );
        assert_eq!(target_runtime.identity(), before);
    }

    #[test]
    fn camera_aiming_requires_exact_selected_ranged_action_and_held_secondary_input() {
        let ranged = ItemStack {
            item_code: 40,
            count: 1,
            durability_millionths: Some(1_000_000),
            metadata_hash: CanonicalHash::default(),
        };
        let mut runtime = runtime_with_action_content(false, Some(ranged));
        let profile = runtime.camera.profile;
        let base = runtime.camera_pose([1_920, 1_080]).unwrap();
        assert_eq!(base.vertical_fov_radians, profile.base_vertical_fov_radians);

        runtime.player.as_mut().unwrap().buttons = RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1;
        let aimed = runtime.camera_pose([1_920, 1_080]).unwrap();
        assert_eq!(aimed.vertical_fov_radians, profile.aim_vertical_fov_radians);
        assert_ne!(aimed.pose_hash, base.pose_hash);

        let mut ordinary = runtime_with_action_content(false, Some(ItemStack::simple(30, 1)));
        ordinary.player.as_mut().unwrap().buttons = RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1;
        let ordinary_pose = ordinary.camera_pose([1_920, 1_080]).unwrap();
        assert_eq!(ordinary_pose.vertical_fov_radians, profile.base_vertical_fov_radians);
    }

    #[test]
    fn camera_profile_sweep_stays_inside_shared_capture_and_raycast_caps() {
        let mut runtime = runtime_with_bound_player();
        let profile = CameraProfileV1 {
            third_person_distance: 32.0,
            rear_shoulder_offset: 4.0,
            collision_radius: 4.0,
            ..CameraProfileV1::default()
        };
        runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 0,
                    mode: CameraModeV1::ThirdRear,
                    profile,
                },
                CanonicalHash([0x31; 16]),
            )
            .unwrap();
        let maximum_cells = WORLD_READ_WINDOW_MAX_CELLS_V1.min(RAYCAST_MAX_VISITED_CELLS_V1);
        for mode in [CameraModeV1::ThirdRear, CameraModeV1::ThirdFront] {
            for look_yaw in [
                -std::f64::consts::PI,
                -std::f64::consts::FRAC_PI_2,
                0.0,
                std::f64::consts::FRAC_PI_2,
                std::f64::consts::PI,
            ] {
                for look_pitch in [
                    -std::f64::consts::FRAC_PI_2,
                    -std::f64::consts::FRAC_PI_4,
                    0.0,
                    std::f64::consts::FRAC_PI_4,
                    std::f64::consts::FRAC_PI_2,
                ] {
                    let input = CameraPoseInputV1 {
                        body_position: runtime.player.as_ref().unwrap().body.position,
                        look_yaw,
                        look_pitch,
                        mode,
                        aiming: false,
                        viewport: [800, 600],
                        profile,
                    };
                    let window = runtime.capture_camera_collision_window_v1(input).unwrap();
                    assert!(window.blocks.len() <= maximum_cells);
                    assert!(derive_camera_pose_v1(Some(&window), input).is_ok());
                }
            }
        }
    }

    #[test]
    fn camera_v7_checkpoint_round_trip_is_exact_and_viewport_is_ephemeral() {
        let mut runtime = runtime_with_bound_player();
        runtime
            .apply_camera_config(
                RuntimeCameraConfigWireV1 {
                    expected_camera_revision: 0,
                    mode: CameraModeV1::ThirdRear,
                    profile: CameraProfileV1::default(),
                },
                CanonicalHash([0x41; 16]),
            )
            .unwrap();
        runtime
            .accept_inputs(&[RuntimeInputFrameV1 {
                sequence: 1,
                target_tick: 1,
                look_yaw: 12_345,
                look_pitch: -6_789,
                ..RuntimeInputFrameV1::default()
            }])
            .unwrap();
        runtime.step(1_000_000, 8_000).unwrap();
        runtime.step(1_050_000, 8_000).unwrap();
        assert_eq!(
            runtime.camera.revision, 1,
            "fixed-step look must not advance config CAS"
        );
        assert_eq!(runtime.camera.look_yaw, 12_345);
        assert_eq!(runtime.camera.look_pitch, -6_789);
        assert_eq!(runtime.player.as_ref().unwrap().look_pitch, -6_789);

        accept_all_authority_commits(&mut runtime);
        let authority_hash = runtime.state_hash();
        let checkpoint_before = runtime.export_runtime_checkpoint().unwrap();
        let pose_wide = runtime.camera_pose([1_920, 1_080]).unwrap();
        let pose_tall = runtime.camera_pose([800, 1_200]).unwrap();
        assert_ne!(pose_wide.pose_hash, pose_tall.pose_hash);
        assert_eq!(runtime.state_hash(), authority_hash);
        assert_eq!(runtime.export_runtime_checkpoint().unwrap(), checkpoint_before);

        let core_bytes = encode_runtime_core_snapshot_v1(&runtime).unwrap();
        let decoded_core = decode_runtime_core_snapshot_v1(&core_bytes).unwrap();
        assert_eq!(decoded_core.schema, NATIVE_RUNTIME_CORE_SCHEMA_V9);
        assert_eq!(decoded_core.camera, runtime.camera);
        let mut contradictory = runtime_core_snapshot_from_runtime_v1(&runtime);
        contradictory.camera.look_pitch = contradictory.camera.look_pitch.saturating_add(1);
        assert_eq!(
            encode_runtime_core_snapshot_body_v1(&contradictory, NATIVE_RUNTIME_CORE_SCHEMA_V7)
                .unwrap_err()
                .code,
            "native-camera-look-projection"
        );

        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint_before,
            integrated_runtime_checkpoint_hash_v1(&checkpoint_before),
        )
        .unwrap();
        assert_eq!(restored.camera, runtime.camera);
        assert_eq!(restored.state_hash(), authority_hash);
        assert_eq!(restored.camera_pose([1_920, 1_080]).unwrap(), pose_wide);
        assert_eq!(restored.export_runtime_checkpoint().unwrap(), checkpoint_before);
    }

    #[test]
    fn action_raycast_voxel_and_unknown_occlude_exact_entity_bounds() {
        let mut runtime = runtime_with_action_content(true, None);
        let voxel = action_target_position();
        set_loaded_block(&mut runtime, "ray-voxel", voxel, 1);
        let mut record = EntityCompatibilityRecord::new("entity:behind", "entity:behind", "test");
        record.position = EntityVec3::new(8.0, 65.0, 4.0);
        record.health = 10.0;
        record.maximum_health = 10.0;
        commit_entity_commands(
            &mut runtime,
            "ray-entity",
            vec![EntityCommand::Spawn {
                record,
                residency: EntityResidency::Hot,
            }],
        );
        assert!(matches!(
            runtime.raycast_action_target(action_input(1, 0), 4.5).unwrap(),
            IntegratedRuntimeActionTargetV1::Block { position, .. } if position == voxel
        ));

        let mut unknown = runtime_with_action_content(true, None);
        let player = unknown.player.as_mut().unwrap();
        player.body.position = SimulationVec3::new(15.0, 65.0, 8.0);
        let toward_unloaded = RuntimeInputFrameV1 {
            look_yaw: i16::MIN / 2,
            ..action_input(2, 0)
        };
        assert_eq!(
            unknown.raycast_action_target(toward_unloaded, 4.5).unwrap(),
            IntegratedRuntimeActionTargetV1::Unloaded
        );
    }

    #[test]
    fn mining_edge_does_not_progress_and_release_target_or_revision_changes_reset() {
        let mut runtime = runtime_with_action_content(false, Some(test_pick(1_000_000)));
        let target = action_target_position();
        set_loaded_block(&mut runtime, "mining-target", target, 1);
        let held = action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1);
        assert_eq!(
            runtime.apply_primary_attack(held).unwrap().0,
            RuntimeInputActionOutcomeV1::Applied
        );
        runtime.advance_held_primary_mining(held).unwrap();
        assert_eq!(runtime.mining_state.as_ref().unwrap().progress_millionths, 0);

        runtime.tick += 1;
        runtime.advance_held_primary_mining(held).unwrap();
        assert!(runtime.mining_state.as_ref().unwrap().progress_millionths > 0);
        runtime.advance_held_primary_mining(action_input(2, 0)).unwrap();
        assert!(runtime.mining_state.is_none());

        let held = action_input(3, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1);
        runtime.begin_or_reset_mining(held, target).unwrap();
        set_loaded_block(
            &mut runtime,
            "other-world-mutation",
            CellPositionV1 { x: 9, y: 65, z: 5 },
            1,
        );
        assert!(runtime.mining_state.is_none(), "every R4 mutation invalidates mining");

        runtime.begin_or_reset_mining(held, target).unwrap();
        let look_away = RuntimeInputFrameV1 {
            look_yaw: i16::MAX,
            ..held
        };
        runtime.tick += 1;
        runtime.advance_held_primary_mining(look_away).unwrap();
        assert!(runtime.mining_state.is_none());
    }

    #[test]
    fn bedrock_and_special_topology_fail_closed_for_creative_and_survival() {
        let target = action_target_position();
        for creative in [false, true] {
            let held = (!creative).then(|| test_pick(1_000_000));
            let mut runtime = runtime_with_action_content(creative, held);
            set_loaded_block(
                &mut runtime,
                &format!("bedrock-{creative}"),
                target,
                WORLD_BEDROCK_BLOCK_ID_V1,
            );
            assert_eq!(
                runtime
                    .begin_or_reset_mining(action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1), target)
                    .unwrap(),
                RuntimeInputActionOutcomeV1::Blocked
            );
            assert!(runtime.mining_state.is_none());
            assert_eq!(loaded_block_id(&runtime, target), WORLD_BEDROCK_BLOCK_ID_V1);
        }

        let mut special = runtime_with_action_content(false, Some(test_pick(1_000_000)));
        set_loaded_block(&mut special, "special-paired", target, 2);
        assert_eq!(
            special
                .begin_or_reset_mining(action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1), target)
                .unwrap(),
            RuntimeInputActionOutcomeV1::Blocked
        );
        assert_eq!(loaded_block_id(&special, target), 2);
    }

    #[test]
    fn wrong_tier_breaks_without_loot_and_only_real_tools_wear() {
        let target = action_target_position();
        let mut hand = runtime_with_action_content(false, None);
        set_loaded_block(&mut hand, "wrong-tier-hand", target, 1);
        let input = action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1);
        hand.begin_or_reset_mining(input, target).unwrap();
        let profile = hand.gameplay_content_runtime.block_action(1).unwrap().clone();
        let tool = hand.mining_tool_v1(profile.preferred_tool).unwrap();
        hand.complete_basic_block_break(input, target, &profile, &tool).unwrap();
        assert_eq!(loaded_block_id(&hand, target), WORLD_AIR_BLOCK_ID_V1);
        assert!(hand.held_stack_and_binding().unwrap().2.is_none());

        let mut under_tier = runtime_with_action_content(false, Some(test_pick(1_000_000)));
        under_tier
            .gameplay_content_runtime
            .items
            .get_mut("10")
            .unwrap()
            .action
            .tier = Some(1);
        set_loaded_block(&mut under_tier, "wrong-tier-tool", target, 1);
        under_tier.begin_or_reset_mining(input, target).unwrap();
        let profile = under_tier.gameplay_content_runtime.block_action(1).unwrap().clone();
        let tool = under_tier.mining_tool_v1(profile.preferred_tool).unwrap();
        under_tier
            .complete_basic_block_break(input, target, &profile, &tool)
            .unwrap();
        assert_eq!(loaded_block_id(&under_tier, target), WORLD_AIR_BLOCK_ID_V1);
        let held = under_tier.held_stack_and_binding().unwrap().2.unwrap();
        assert_eq!(held.item_code, 10);
        assert_eq!(held.durability_millionths, Some(900_000));
        assert!(
            !under_tier
                .gameplay
                .state
                .inventory
                .containers
                .values()
                .flat_map(|container| container.slots.iter().flatten())
                .any(|stack| stack.item_code == 20)
        );
    }

    #[test]
    fn creative_basic_break_clears_world_without_loot_or_inventory_mutation() {
        let target = action_target_position();
        let mut runtime = runtime_with_action_content(true, Some(ItemStack::simple(20, 64)));
        set_loaded_block(&mut runtime, "creative-break-target", target, 1);
        let input = action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1);
        runtime.begin_or_reset_mining(input, target).unwrap();
        let profile = runtime.gameplay_content_runtime.block_action(1).unwrap().clone();
        let tool = runtime.mining_tool_v1(profile.preferred_tool).unwrap();
        let before_inventory = runtime.gameplay.state.inventory.clone();
        runtime
            .complete_basic_block_break(input, target, &profile, &tool)
            .unwrap();
        assert_eq!(loaded_block_id(&runtime, target), WORLD_AIR_BLOCK_ID_V1);
        assert_eq!(runtime.gameplay.state.inventory, before_inventory);
    }

    #[test]
    fn break_capacity_failure_rolls_back_world_tool_and_loot_then_can_retry() {
        let target = action_target_position();
        let mut runtime = runtime_with_action_content(false, Some(test_pick(1_000_000)));
        set_loaded_block(&mut runtime, "rollback-target", target, 1);
        let key = runtime.held_stack_and_binding().unwrap().0.inventory_container;
        for slot in 1..9 {
            runtime.gameplay.state.inventory.containers.get_mut(&key).unwrap().slots[slot] =
                Some(ItemStack::simple(30, 64));
        }
        let input = action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1);
        runtime.begin_or_reset_mining(input, target).unwrap();
        let profile = runtime.gameplay_content_runtime.block_action(1).unwrap().clone();
        let tool = runtime.mining_tool_v1(profile.preferred_tool).unwrap();
        let before_world = runtime.world.canonical_state_hash();
        let before_inventory = runtime.gameplay.state.inventory.clone();
        runtime
            .complete_basic_block_break(input, target, &profile, &tool)
            .unwrap();
        assert_eq!(runtime.world.canonical_state_hash(), before_world);
        assert_eq!(runtime.gameplay.state.inventory, before_inventory);
        assert_eq!(loaded_block_id(&runtime, target), 1);
        let mining = runtime.mining_state.as_ref().unwrap();
        assert_eq!(mining.progress_millionths, mining.required_work_millionths - 1);

        runtime.gameplay.state.inventory.containers.get_mut(&key).unwrap().slots[8] = None;
        let (_, inventory_revision, _) = runtime.held_stack_and_binding().unwrap();
        runtime
            .gameplay
            .state
            .inventory
            .containers
            .get_mut(&key)
            .unwrap()
            .revision = inventory_revision + 1;
        runtime.begin_or_reset_mining(input, target).unwrap();
        let tool = runtime.mining_tool_v1(profile.preferred_tool).unwrap();
        runtime
            .complete_basic_block_break(input, target, &profile, &tool)
            .unwrap();
        assert_eq!(loaded_block_id(&runtime, target), WORLD_AIR_BLOCK_ID_V1);
    }

    #[test]
    fn placement_collision_and_capacity_failure_leave_world_and_inventory_exact() {
        let mut runtime = runtime_with_action_content(false, Some(ItemStack::simple(20, 1)));
        let hit = CellPositionV1 { x: 8, y: 65, z: 7 };
        set_loaded_block(&mut runtime, "place-hit", hit, 1);
        assert!(player_intersects_block_v1(
            &runtime.player.as_ref().unwrap().body,
            CellPositionV1 {
                x: hit.x,
                y: hit.y,
                z: hit.z + 1
            }
        ));
        let before_world = runtime.world.canonical_state_hash();
        let before_inventory = runtime.gameplay.state.inventory.clone();
        assert_eq!(
            runtime
                .apply_basic_block_placement(action_input(1, RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1), hit, [0, 0, 1])
                .unwrap(),
            RuntimeInputActionOutcomeV1::Blocked
        );
        assert_eq!(runtime.world.canonical_state_hash(), before_world);
        assert_eq!(runtime.gameplay.state.inventory, before_inventory);

        let missing = CellPositionV1 { x: 15, y: 65, z: 5 };
        set_loaded_block(&mut runtime, "place-boundary-hit", missing, 1);
        let before_world = runtime.world.canonical_state_hash();
        let before_inventory = runtime.gameplay.state.inventory.clone();
        assert_eq!(
            runtime
                .apply_basic_block_placement(
                    action_input(2, RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1),
                    missing,
                    [1, 0, 0]
                )
                .unwrap(),
            RuntimeInputActionOutcomeV1::Blocked
        );
        assert_eq!(runtime.world.canonical_state_hash(), before_world);
        assert_eq!(runtime.gameplay.state.inventory, before_inventory);
    }

    #[test]
    fn v6_mining_checkpoint_restores_exactly_and_advances_only_on_a_future_tick() {
        let mut runtime = runtime_with_action_content(false, Some(test_pick(1_000_000)));
        let target = action_target_position();
        set_loaded_block(&mut runtime, "checkpoint-mining-target", target, 1);
        let input = action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1);
        runtime.begin_or_reset_mining(input, target).unwrap();
        runtime.tick += 1;
        runtime.advance_held_primary_mining(input).unwrap();
        let saved = runtime.mining_state.clone().unwrap();
        assert!(saved.progress_millionths > 0);

        accept_all_authority_commits(&mut runtime);
        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let mut restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert_eq!(restored.mining_state, Some(saved.clone()));
        assert_eq!(restored.gameplay_content_runtime, runtime.gameplay_content_runtime);
        restored.advance_held_primary_mining(input).unwrap();
        assert_eq!(
            restored.mining_state,
            Some(saved.clone()),
            "same tick cannot double-progress"
        );
        restored.tick += 1;
        restored.advance_held_primary_mining(input).unwrap();
        match restored.mining_state.as_ref() {
            Some(state) => assert!(state.progress_millionths > saved.progress_millionths),
            None => assert_eq!(
                loaded_block_id(&restored, target),
                WORLD_AIR_BLOCK_ID_V1,
                "a future fixed tick may complete the restored action, but not discard it"
            ),
        }
    }

    #[test]
    fn runtime_core_v1_through_v8_decode_with_canonical_camera_mining_context_and_loot_defaults() {
        let runtime = runtime_with_bound_player();
        for schema in [
            NATIVE_RECORD_SCHEMA_V1,
            NATIVE_RUNTIME_CORE_SCHEMA_V2,
            NATIVE_RUNTIME_CORE_SCHEMA_V3,
            NATIVE_RUNTIME_CORE_SCHEMA_V4,
            NATIVE_RUNTIME_CORE_SCHEMA_V5,
            NATIVE_RUNTIME_CORE_SCHEMA_V6,
            NATIVE_RUNTIME_CORE_SCHEMA_V7,
            NATIVE_RUNTIME_CORE_SCHEMA_V8,
        ] {
            let mut core = runtime_core_snapshot_from_runtime_v1(&runtime);
            core.schema = schema;
            core.mining_state = None;
            core.command_receipts.clear();
            core.command_receipt_order.clear();
            core.command_receipt_bytes = 0;
            core.durable_network_drained_proof = None;
            core.durable_state_proof = None;
            core.durable_replay_proof = None;
            if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V5 {
                core.durable_state_proof = Some(durable_runtime_core_state_proof_v1(&core).unwrap());
                core.durable_replay_proof = Some(durable_runtime_replay_proof_v1(&core));
            }
            let bytes = encode_runtime_core_snapshot_body_v1(&core, schema).unwrap();
            let decoded = decode_runtime_core_snapshot_v1(&bytes).unwrap();
            assert_eq!(decoded.schema, schema);
            assert!(decoded.mining_state.is_none(), "schema {schema} must default mining");
            assert_eq!(
                decoded.camera,
                if schema >= NATIVE_RUNTIME_CORE_SCHEMA_V7 {
                    runtime.camera
                } else {
                    IntegratedRuntimeCameraStateV1::default()
                },
                "schema {schema} must default camera authority"
            );
            assert_eq!(decoded.next_context_command_sequence, Some(1));
            assert!(decoded.queued_context_commands.is_empty());
            assert_eq!(
                decoded.block_action_loot_rng,
                BlockActionLootRngCursorV1::from_seed_v1(&decoded.config.world_seed)
            );
            assert_eq!(decoded.next_block_action_sequence, Some(1));
            assert!(decoded.block_action_receipts.is_empty());
        }
    }

    #[test]
    fn terrain_reconcile_revision_change_clears_mining_state() {
        let fixture = blockwild_generation::fixture_request("mining-residency-reset", 0, 0, 1);
        let config = IntegratedRuntimeConfigV2 {
            world_seed: fixture.seed_text,
            terrain_content_hash: parse_canonical_hash(&fixture.content_hash).unwrap(),
            generator_hash: parse_canonical_hash(&fixture.generator_hash).unwrap(),
            ..IntegratedRuntimeConfigV2::default()
        };
        let mut runtime = runtime_with_action_content(false, Some(test_pick(1_000_000)));
        runtime.config.world_seed = config.world_seed;
        runtime.config.terrain_content_hash = config.terrain_content_hash;
        runtime.config.generator_hash = config.generator_hash;
        let target = action_target_position();
        set_loaded_block(&mut runtime, "residency-mining-target", target, 1);
        runtime
            .begin_or_reset_mining(action_input(1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1), target)
            .unwrap();
        assert!(runtime.mining_state.is_some());
        let previous = runtime.world.revision();
        let receipt = runtime
            .reconcile_terrain_residency(&IntegratedTerrainResidencyReconcileBatchV2 {
                expected_world_revision: previous,
                generation_options_json: runtime.config.generation_options_json.clone(),
                desired_chunks: vec![IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 }],
            })
            .unwrap();
        assert_ne!(receipt.world_revision, previous);
        assert!(runtime.mining_state.is_none());
    }

    fn accept_next_authority_commit(runtime: &mut IntegratedRuntimeV2) {
        let packet = runtime
            .poll_persistence_platform(INTEGRATED_RUNTIME_PERSISTENCE_MAX_PACKET_BYTES)
            .unwrap()
            .expect("authority commit platform packet");
        let request = blockwild_persistence::decode_persistence_browser_request_v1(&packet.bytes)
            .expect("decode authority commit");
        let blockwild_persistence::PersistenceBrowserRequestV1::Commit {
            request_id,
            transaction,
            checkpoint,
        } = request
        else {
            panic!("expected authority commit request")
        };
        let response = blockwild_persistence::encode_persistence_browser_response_v1(
            &blockwild_persistence::PersistenceBrowserResponseV1::Commit(
                blockwild_persistence::PersistenceBrowserCommitResultV1 {
                    request_id,
                    code: blockwild_persistence::PersistenceBrowserCommitCodeV1::Committed,
                    transaction_id: transaction.transaction_id.clone(),
                    journal_sequence: transaction.next_journal_sequence,
                    durable_hash: CanonicalHash([0x77; 16]),
                    checkpoint_hash: checkpoint.checkpoint_hash,
                    verified_readback: true,
                    message: "durable fixture".into(),
                },
            ),
        )
        .expect("encode durable authority receipt");
        let outcome = runtime
            .complete_persistence_platform(packet.transfer_token, &response)
            .expect("accept durable authority receipt");
        assert_eq!(outcome.status, PersistenceDispatchStatusV1::Accepted);
    }

    fn accept_all_authority_commits(runtime: &mut IntegratedRuntimeV2) {
        for _ in 0..64 {
            let diagnostics = runtime.persistence_authority().diagnostics();
            if diagnostics.dirty_records == 0
                && !diagnostics.commit_in_flight
                && runtime.persistence_dispatcher().is_idle()
            {
                return;
            }
            accept_next_authority_commit(runtime);
        }
        panic!("authority commit fixture did not reach a durable idle boundary");
    }

    fn recovered_authority_save(runtime: &IntegratedRuntimeV2) -> PagedRecoveryCompleteV1 {
        PagedRecoveryCompleteV1 {
            checkpoint: runtime
                .persistence_authority()
                .checkpoint()
                .expect("durable checkpoint")
                .clone(),
            payloads: runtime
                .persistence_authority()
                .records()
                .iter()
                .map(|(address, record)| (address.clone(), record.payload.clone()))
                .collect(),
            missing_record_keys: Vec::new(),
        }
    }

    fn force_unattested_native_recovery(runtime: &mut IntegratedRuntimeV2) -> PagedRecoveryCompleteV1 {
        let bundle = runtime.build_native_bundle().expect("control-style native bundle");
        let records = IntegratedRuntimeNativeRecordKindV1::ALL
            .into_iter()
            .map(|kind| {
                let (record_kind, record_id) = kind.address();
                Ok(NormalizedStateRecordV1 {
                    address: RecordAddress::new(
                        &runtime.config.universe_id,
                        &runtime.config.location_id,
                        record_kind,
                        record_id,
                    )
                    .map_err(|error| IntegratedRuntimeError::domain("fixture-address", error))?,
                    payload: encode_native_record_envelope_v1(
                        bundle.envelopes.get(&kind).expect("complete fixture bundle"),
                    )?,
                })
            })
            .collect::<Result<Vec<_>, IntegratedRuntimeError>>()
            .unwrap();
        let save = CanonicalWorldSaveSetV1::build(
            runtime.persistence_authority.world_id(),
            &runtime.config.universe_id,
            &runtime.config.location_id,
            runtime.config.generator_hash,
            runtime.config.content_hash,
            std::iter::empty::<Vec<u8>>(),
            records,
        )
        .unwrap();
        runtime.persistence_authority.stage_complete_save_set(&save).unwrap();
        runtime.prepare_next_authority_commit().unwrap();
        accept_all_authority_commits(runtime);
        recovered_authority_save(runtime)
    }

    fn rewrite_recovery_runtime_core(
        recovered: &mut PagedRecoveryCompleteV1,
        mut rewrite: impl FnMut(&mut IntegratedRuntimeCoreSnapshotV1),
    ) {
        let runtime_address = recovered
            .payloads
            .keys()
            .find(|address| address.kind == RecordKind::Player && address.record_id == NATIVE_RUNTIME_RECORD_ID_V1)
            .cloned()
            .expect("runtime native record");
        let mut envelopes = BTreeMap::new();
        for (address, payload) in &recovered.payloads {
            if payload.starts_with(NATIVE_RECORD_MAGIC_V1) {
                let envelope = decode_native_record_envelope_v1(payload).unwrap();
                let (kind, record_id) = envelope.kind.address();
                assert_eq!((address.kind, address.record_id.as_str()), (kind, record_id));
                envelopes.insert(envelope.kind, envelope);
            }
        }
        let runtime_envelope = envelopes
            .get_mut(&IntegratedRuntimeNativeRecordKindV1::Runtime)
            .expect("runtime envelope");
        let mut core = decode_runtime_core_snapshot_v1(&runtime_envelope.body).unwrap();
        rewrite(&mut core);
        runtime_envelope.body = encode_runtime_core_snapshot_body_v1(&core, core.schema).unwrap();
        let bodies = envelopes
            .iter()
            .map(|(kind, envelope)| (*kind, envelope.body.clone()))
            .collect::<BTreeMap<_, _>>();
        let first = envelopes.values().next().unwrap();
        let bundle_hash = native_bundle_hash_v1(
            &first.universe_id,
            &first.location_id,
            first.generator_hash,
            first.content_hash,
            &bodies,
        );
        for envelope in envelopes.values_mut() {
            envelope.bundle_hash = bundle_hash;
        }
        for envelope in envelopes.values() {
            let (_, record_id) = envelope.kind.address();
            let address = recovered
                .payloads
                .keys()
                .find(|address| address.record_id == record_id)
                .cloned()
                .unwrap();
            recovered
                .payloads
                .insert(address, encode_native_record_envelope_v1(envelope).unwrap());
        }
        assert!(recovered.payloads.contains_key(&runtime_address));
        let descriptors = recovered
            .checkpoint
            .records
            .iter()
            .map(|descriptor| {
                let payload = recovered.payloads.get(&descriptor.address).unwrap();
                RecordDescriptor {
                    address: descriptor.address.clone(),
                    revision: descriptor.revision,
                    byte_length: payload.len() as u32,
                    payload_hash: native_persistence_payload_hash_v1(payload),
                }
            })
            .collect();
        recovered.checkpoint = Checkpoint::new(
            recovered.checkpoint.checkpoint_id.clone(),
            recovered.checkpoint.parent_checkpoint_id.clone(),
            recovered.checkpoint.world_id.clone(),
            recovered.checkpoint.journal_sequence,
            recovered.checkpoint.generator_hash,
            recovered.checkpoint.content_hash,
            recovered.checkpoint.created_at,
            descriptors,
        )
        .unwrap();
    }

    fn rewrite_checkpoint_cross_domain_records(
        checkpoint: &[u8],
        mut rewrite: impl FnMut(&mut GameplayAuthority, &mut IntegratedRuntimeCoreSnapshotV1, &mut EntityAuthority),
    ) -> Vec<u8> {
        let mut outer = NativeReaderV1::new(checkpoint);
        let body = outer.bytes(NATIVE_RECORD_MAX_BYTES_V1).unwrap();
        let stored_outer_hash = outer.hash().unwrap();
        outer.finish().unwrap();
        assert_eq!(runtime_checkpoint_hash_v1(&body), stored_outer_hash);

        let mut reader = NativeReaderV1::new(&body);
        reader.magic(NATIVE_CHECKPOINT_MAGIC_V1).unwrap();
        assert_eq!(reader.u16().unwrap(), NATIVE_CHECKPOINT_SCHEMA_V1);
        let _old_bundle_hash = reader.hash().unwrap();
        let expected_state_hash = reader.hash().unwrap();
        let expected_replay_hash = reader.hash().unwrap();
        let record_count = reader
            .count(NATIVE_CHECKPOINT_MAX_RECORDS_V1, "checkpoint records")
            .unwrap();
        let mut envelopes = BTreeMap::new();
        for _ in 0..record_count {
            let kind = IntegratedRuntimeNativeRecordKindV1::from_tag(reader.u8().unwrap()).unwrap();
            let envelope =
                decode_native_record_envelope_v1(&reader.bytes(NATIVE_RECORD_MAX_BYTES_V1).unwrap()).unwrap();
            assert_eq!(kind, envelope.kind);
            envelopes.insert(kind, envelope);
        }
        assert!(
            !reader.bool().unwrap(),
            "fixture checkpoint unexpectedly has a durable head"
        );
        let dispatcher = reader.bytes(NATIVE_RECORD_MAX_BYTES_V1).unwrap();
        reader.finish().unwrap();

        let mut decoded =
            decode_gameplay_authority_snapshot(&envelopes[&IntegratedRuntimeNativeRecordKindV1::Gameplay].body)
                .unwrap();
        let runtime = envelopes
            .get(&IntegratedRuntimeNativeRecordKindV1::Runtime)
            .expect("runtime checkpoint envelope");
        let mut core = decode_runtime_core_snapshot_v1(&runtime.body).unwrap();
        let mut entities =
            decode_entity_authority_snapshot(&envelopes[&IntegratedRuntimeNativeRecordKindV1::Entities].body).unwrap();
        rewrite(&mut decoded.authority, &mut core, &mut entities);
        if core.schema >= NATIVE_RUNTIME_CORE_SCHEMA_V5 {
            core.durable_state_proof = Some(durable_runtime_core_state_proof_v1(&core).unwrap());
            core.durable_replay_proof = Some(durable_runtime_replay_proof_v1(&core));
        }
        envelopes
            .get_mut(&IntegratedRuntimeNativeRecordKindV1::Gameplay)
            .expect("gameplay checkpoint envelope")
            .body = decoded
            .authority
            .encode_snapshot(&decoded.unknown_extension_bytes)
            .unwrap();
        envelopes
            .get_mut(&IntegratedRuntimeNativeRecordKindV1::Runtime)
            .expect("runtime checkpoint envelope")
            .body = encode_runtime_core_snapshot_body_v1(&core, core.schema).unwrap();
        envelopes
            .get_mut(&IntegratedRuntimeNativeRecordKindV1::Entities)
            .expect("entity checkpoint envelope")
            .body = encode_entity_authority_snapshot(&entities).unwrap();
        let bodies = envelopes
            .iter()
            .map(|(kind, envelope)| (*kind, envelope.body.clone()))
            .collect::<BTreeMap<_, _>>();
        let first = envelopes.values().next().unwrap();
        let bundle_hash = native_bundle_hash_v1(
            &first.universe_id,
            &first.location_id,
            first.generator_hash,
            first.content_hash,
            &bodies,
        );
        for envelope in envelopes.values_mut() {
            envelope.bundle_hash = bundle_hash;
        }

        let mut writer = NativeWriterV1::default();
        writer.raw(NATIVE_CHECKPOINT_MAGIC_V1);
        writer.u16(NATIVE_CHECKPOINT_SCHEMA_V1);
        writer.hash(bundle_hash);
        writer.hash(expected_state_hash);
        writer.hash(expected_replay_hash);
        writer.u32(record_count as u32);
        for kind in IntegratedRuntimeNativeRecordKindV1::ALL {
            writer.u8(kind as u8);
            writer
                .bytes(&encode_native_record_envelope_v1(&envelopes[&kind]).unwrap())
                .unwrap();
        }
        writer.bool(false);
        writer.bytes(&dispatcher).unwrap();
        let body = writer.finish();
        let mut output = NativeWriterV1::default();
        output.bytes(&body).unwrap();
        output.hash(runtime_checkpoint_hash_v1(&body));
        output.finish()
    }

    fn activate_fixture_network_grant(runtime: &mut IntegratedRuntimeV2) {
        runtime
            .upsert_network_peer_grant(NetworkPeerGrantV1 {
                session_id: runtime.config.session_id.clone(),
                peer_id: "peer:durable-fixture".into(),
                connection_id: "connection:durable-fixture".into(),
                actor_id: "actor:durable-fixture".into(),
                peer_kind: NetworkPeerKindV1::Human,
                role: NetworkPeerRoleV1::Guest,
                capabilities: vec![NetworkCapabilityV1::Observe],
                expires_at: 10_000,
                next_sequence: 0,
                interest: NetworkInterestSetV1::new(0, Vec::new(), Vec::new()).unwrap(),
            })
            .unwrap();
    }

    fn loaded_block_id(runtime: &IntegratedRuntimeV2, position: CellPositionV1) -> u16 {
        let blockwild_authority::WorldCellReadV1::Loaded { cell, .. } = runtime.world().read_cell(position) else {
            panic!("fixture cell must be loaded")
        };
        cell.block_id
    }

    fn commit_entity_commands(runtime: &mut IntegratedRuntimeV2, batch_id: &str, commands: Vec<EntityCommand>) {
        let mut batch = IntegratedRuntimeBatchV2::empty(batch_id, runtime.identity());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: runtime.entity_command_sequence.saturating_add(1).max(1),
            expected_revision: runtime.entities().revision(),
            tick: runtime.tick(),
            commands,
        });
        let receipt = runtime.commit(batch);
        assert!(receipt.accepted(), "unexpected entity command rejection: {receipt:?}");
    }

    #[test]
    fn integrated_identity_is_stable_for_equal_runtime_state() {
        let first = runtime_with_section();
        let second = runtime_with_section();
        assert_eq!(first.identity(), second.identity());
        assert_eq!(first.network_identity().unwrap(), second.network_identity().unwrap());
    }

    #[test]
    fn canonical_high_byte_fixture_matches_the_typescript_oracle() {
        let mut hasher = CanonicalHasher::new("legacy-binary");
        hasher.write_bytes(&[0x80, 0xff]);
        assert_eq!(hasher.finish().to_hex(), "1077e0e354d95fe1f0fc9f1ea3ffc021");
    }

    fn command_cache_identity(state_hash_byte: u8) -> blockwild_runtime_wire::RuntimeIdentityV1 {
        blockwild_runtime_wire::RuntimeIdentityV1 {
            universe_id: "1".into(),
            location_id: "blockwild".into(),
            revision: blockwild_runtime_wire::RuntimeRevisionV1 {
                epoch: 1,
                world: 2,
                entities: 3,
                gameplay: 4,
                persistence: 5,
                network: 6,
                simulation: 7,
            },
            tick: 8,
            state_hash: WireHash([state_hash_byte; 16]),
        }
    }

    fn accepted_command_cache_receipt(
        idempotency_key: &str,
        command_hash: WireHash,
        domain_receipts: Vec<blockwild_runtime_wire::RuntimeDomainOperationV1>,
    ) -> RuntimeCommandReceiptV1 {
        let mut receipt = RuntimeCommandReceiptV1::Accepted {
            command_id: "command:cached".into(),
            idempotency_key: idempotency_key.into(),
            command_hash,
            before: command_cache_identity(0x11),
            after: command_cache_identity(0x22),
            domain_receipts,
            receipt_hash: WireHash::default(),
        };
        let hash = blockwild_runtime_wire::command_receipt_hash_v1(&receipt);
        let RuntimeCommandReceiptV1::Accepted { receipt_hash, .. } = &mut receipt else {
            unreachable!()
        };
        *receipt_hash = hash;
        receipt
    }

    #[test]
    fn command_receipt_cache_is_identity_neutral_checkpointed_and_capacity_atomic() {
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let command_hash = WireHash([0x33; 16]);
        let receipt = accepted_command_cache_receipt("key:cached", command_hash, Vec::new());
        let before_identity = runtime.identity();
        runtime
            .cache_runtime_command_receipt("actor:cached", "key:cached", command_hash, receipt.clone())
            .unwrap();
        assert_eq!(
            runtime.identity(),
            before_identity,
            "reliability metadata is identity-neutral"
        );

        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert_eq!(restored.identity(), before_identity);
        assert_eq!(
            restored.lookup_runtime_command_receipt("actor:cached", "key:cached", command_hash),
            RuntimeCommandCacheLookupV1::Exact(Box::new(receipt))
        );
        assert_eq!(
            restored.lookup_runtime_command_receipt("actor:cached", "key:cached", WireHash([0x44; 16])),
            RuntimeCommandCacheLookupV1::Conflict
        );

        let large_receipts = (0..5)
            .map(|index| {
                let payload = vec![index as u8; 900_000];
                blockwild_runtime_wire::RuntimeDomainOperationV1 {
                    domain: blockwild_runtime_wire::RuntimeDomainV1::World,
                    type_id: format!("large:{index}"),
                    schema: 1,
                    payload_hash: WireHash(blockwild_runtime_wire::wire_checksum_v1(&payload)),
                    payload,
                }
            })
            .collect();
        let large_hash = WireHash([0x55; 16]);
        let large = accepted_command_cache_receipt("key:large", large_hash, large_receipts);
        let before_large = restored.identity();
        let mut capacity_candidate = restored.clone();
        assert_eq!(
            capacity_candidate
                .cache_runtime_command_receipt("actor:large", "key:large", large_hash, large)
                .unwrap_err()
                .code,
            "idempotency-receipt-capacity"
        );
        assert_eq!(capacity_candidate.identity(), before_large);
        assert_eq!(
            capacity_candidate.lookup_runtime_command_receipt("actor:large", "key:large", large_hash),
            RuntimeCommandCacheLookupV1::Miss
        );
    }

    #[test]
    fn command_receipt_cache_rejects_tampered_hash_duplicate_order_and_bad_byte_accounting() {
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let command_hash = WireHash([0x66; 16]);
        let receipt = accepted_command_cache_receipt("key:tamper", command_hash, Vec::new());
        runtime
            .cache_runtime_command_receipt("actor:tamper", "key:tamper", command_hash, receipt.clone())
            .unwrap();
        let mut core = encode_runtime_core_snapshot_v1(&runtime).unwrap();
        let embedded_hash = match receipt {
            RuntimeCommandReceiptV1::Accepted { receipt_hash, .. } => receipt_hash.0,
            RuntimeCommandReceiptV1::Rejected { .. } => unreachable!(),
        };
        let offset = core
            .windows(embedded_hash.len())
            .rposition(|window| window == embedded_hash)
            .expect("focused receipt hash is embedded in schema-3 core");
        core[offset] ^= 0xff;
        assert_eq!(decode_runtime_core_snapshot_v1(&core).unwrap_err().code, "receipt-hash");

        let key = ("actor:tamper".to_owned(), "key:tamper".to_owned());
        let mut duplicate_order = runtime.command_receipt_order.clone();
        duplicate_order.push_back(key);
        assert_eq!(
            validate_runtime_command_receipt_cache_v1(
                &runtime.command_receipts,
                &duplicate_order,
                runtime.command_receipt_bytes,
            )
            .unwrap_err()
            .code,
            "native-command-receipt-order"
        );
        assert_eq!(
            validate_runtime_command_receipt_cache_v1(
                &runtime.command_receipts,
                &runtime.command_receipt_order,
                INTEGRATED_RUNTIME_MAX_COMMAND_RECEIPT_CACHE_BYTES_V1 + 1,
            )
            .unwrap_err()
            .code,
            "native-command-receipt-capacity"
        );
    }

    #[test]
    fn player_rebind_rejects_changed_actor_or_player_without_mutation() {
        let mut runtime = runtime_with_bound_player();
        let before_identity = runtime.identity();
        let before_gameplay = runtime.gameplay.state.identity();
        let before_world_view = runtime.world_view.state.identity();
        let mut changed = runtime.player().unwrap().binding.clone();
        changed.actor_id = "player:impostor".into();
        changed.player_id = PlayerId::new(2, 1);

        let error = runtime.bind_player(changed).unwrap_err();

        assert_eq!(error.code, "player-binding-conflict");
        assert_eq!(runtime.identity(), before_identity);
        assert_eq!(runtime.gameplay.state.identity(), before_gameplay);
        assert_eq!(runtime.world_view.state.identity(), before_world_view);
        assert_eq!(runtime.player().unwrap().binding.actor_id, "player:one");
        assert_eq!(runtime.player().unwrap().binding.player_id, PlayerId::new(1, 1));
    }

    #[test]
    fn fixed_step_input_moves_the_bound_authoritative_player_and_updates_vitals() {
        let mut runtime = runtime_with_bound_player();
        let before = runtime.player().unwrap().body.position;
        runtime
            .accept_inputs(&[RuntimeInputFrameV1 {
                sequence: 1,
                target_tick: 1,
                move_z: 32_767,
                selected_slot: 4,
                ..RuntimeInputFrameV1::default()
            }])
            .unwrap();
        runtime.step(1_000_000, 8_000).unwrap();
        let summary = runtime.step(1_050_000, 8_000).unwrap();
        let player = runtime.player().unwrap();
        assert_eq!(summary.fixed_steps, 1);
        assert_eq!(summary.inputs_applied, 1);
        assert_ne!(player.body.position, before);
        assert_eq!(player.selected_slot, 4);
        let entity = runtime.entities().hot().get(&player.entity_id).unwrap();
        assert!((f64::from(entity.record.position.z) - player.body.position.z).abs() < 1.0e-5);
        assert_eq!(entity.record.age_ticks, 1);
        assert_eq!(runtime.gameplay().state.tick, 1);
        assert_eq!(runtime.gameplay().state.combat.tick, 1);
        assert_eq!(runtime.world_view().state.tick, 1);
    }

    fn sealed_context_command_v2(
        sequence: u64,
        target_tick: u64,
        action: RuntimeContextCommandActionV2,
    ) -> RuntimeContextCommandV2 {
        blockwild_runtime_wire::seal_context_command_v2(RuntimeContextCommandV2 {
            sequence,
            target_tick,
            action,
            command_hash: WireHash::default(),
        })
        .expect("test context command seals")
    }

    #[test]
    fn context_commands_enqueue_on_zero_step_reject_new_duplicates_and_dispatch_once_in_order() {
        let mut runtime = runtime_with_bound_player();
        let commands = [
            sealed_context_command_v2(
                1,
                1,
                RuntimeContextCommandActionV2::Cast {
                    spell_id: "spell:test".into(),
                    loadout_revision: 7,
                    learned_revision: 11,
                },
            ),
            sealed_context_command_v2(
                2,
                3,
                RuntimeContextCommandActionV2::Reload {
                    container: RuntimeContainerKeyV2 {
                        kind: RuntimeContainerKindV2::Equipment,
                        id: "actor:test:equipment".into(),
                        owner_id: Some("actor:test".into()),
                    },
                    selected_slot: 4,
                    container_revision: 13,
                },
            ),
        ];

        let primed = runtime.step_context_v2(1_000_000, 8_000, &[], &commands).unwrap();
        assert_eq!(primed.fixed_steps, 0);
        assert!(primed.semantic_receipts.is_empty());
        assert_eq!(runtime.next_context_command_sequence_v2(), Some(3));
        assert!(!runtime.queued_context_commands_empty_v2());

        let after_enqueue = runtime.identity();
        let duplicate = runtime
            .step_context_v2(1_000_001, 8_000, &[], &commands[..1])
            .unwrap_err();
        assert_eq!(duplicate.code, "context-command-sequence");
        assert_eq!(runtime.identity(), after_enqueue, "duplicate rejection is atomic");

        let crossed = runtime.step_context_v2(1_150_000, 8_000, &[], &[]).unwrap();
        assert_eq!(crossed.fixed_steps, 3);
        assert_eq!(
            crossed
                .semantic_receipts
                .iter()
                .map(|receipt| (receipt.target_tick, receipt.command_sequence))
                .collect::<Vec<_>>(),
            vec![(1, 1), (3, 2)],
        );
        assert!(crossed.semantic_receipts.iter().all(|receipt| {
            receipt.outcome == RuntimeSemanticActionOutcomeV2::Rejected
                && receipt.reason == RuntimeSemanticActionReasonV2::Blocked
                && receipt.resolved_entity.is_none()
                && receipt.resolved_block.is_none()
                && receipt.session.is_none()
                && receipt.effect.is_none()
        }));
        assert!(runtime.queued_context_commands_empty_v2());
        let later = runtime.step_context_v2(1_200_000, 8_000, &[], &[]).unwrap();
        assert!(later.semantic_receipts.is_empty(), "dispatched commands cannot replay");
    }

    #[test]
    fn terminal_context_cursor_and_full_width_entity_id_survive_checkpoint_restore() {
        let mut runtime = runtime_with_bound_player();
        runtime.next_context_command_sequence = Some(MAX_SAFE_U64);
        let command = sealed_context_command_v2(
            MAX_SAFE_U64,
            1,
            RuntimeContextCommandActionV2::MountedAbility {
                mount_entity_id: u64::MAX,
                mount_entity_revision: 19,
                seat_index: 1,
                ability_slot: 2,
            },
        );
        let primed = runtime
            .step_context_v2(1_000_000, 8_000, &[], std::slice::from_ref(&command))
            .unwrap();
        assert_eq!(primed.fixed_steps, 0);
        assert_eq!(runtime.next_context_command_sequence_v2(), None);
        assert!(!runtime.queued_context_commands_empty_v2());

        assert_eq!(
            runtime.export_runtime_checkpoint().unwrap_err().code,
            "checkpoint-context-pending"
        );
        assert_eq!(
            runtime.build_native_bundle().unwrap_err().code,
            "native-save-context-pending"
        );
        assert!(!runtime.native_save_ready());
        let mut core = runtime_core_snapshot_from_runtime_v1(&runtime);
        core.schema = NATIVE_RUNTIME_CORE_SCHEMA_V8;
        core.block_action_loot_rng = BlockActionLootRngCursorV1::from_seed_v1(&core.config.world_seed);
        core.next_block_action_sequence = Some(1);
        core.block_action_receipts.clear();
        core.durable_state_proof = Some(durable_runtime_core_state_proof_v1(&core).unwrap());
        core.durable_replay_proof = Some(durable_runtime_replay_proof_v1(&core));
        let core_bytes = encode_runtime_core_snapshot_body_v1(&core, NATIVE_RUNTIME_CORE_SCHEMA_V8).unwrap();
        let decoded = decode_runtime_core_snapshot_v1(&core_bytes).unwrap();
        assert_eq!(decoded.next_context_command_sequence, None);
        assert_eq!(decoded.queued_context_commands, VecDeque::from([command.clone()]));

        let dispatched = runtime.step_context_v2(1_050_000, 8_000, &[], &[]).unwrap();
        assert_eq!(dispatched.semantic_receipts.len(), 1);
        let receipt = &dispatched.semantic_receipts[0];
        assert_eq!(receipt.command_sequence, MAX_SAFE_U64);
        assert_eq!(receipt.command_hash, command.command_hash);
        assert_eq!(receipt.reason, RuntimeSemanticActionReasonV2::Blocked);
        assert!(
            receipt.resolved_entity.is_none(),
            "unsupported mounted authority must not fabricate a target"
        );
        assert!(runtime.queued_context_commands_empty_v2());
        assert_eq!(runtime.next_context_command_sequence_v2(), None);

        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let checkpoint_hash = integrated_runtime_checkpoint_hash_v1(&checkpoint);
        let mut restored = IntegratedRuntimeV2::restore_runtime_checkpoint(&checkpoint, checkpoint_hash).unwrap();
        assert_eq!(restored.identity(), runtime.identity());
        assert_eq!(restored.next_context_command_sequence_v2(), None);
        assert!(restored.queued_context_commands_empty_v2());

        let before = restored.identity();
        let exhausted = restored.accept_context_commands_v2(&[command]).unwrap_err();
        assert_eq!(exhausted.code, "context-command-sequence-exhausted");
        assert_eq!(restored.identity(), before);
    }

    #[test]
    fn invalid_context_batches_and_step_v1_pending_rejection_are_atomic() {
        let base = sealed_context_command_v2(
            1,
            1,
            RuntimeContextCommandActionV2::Cast {
                spell_id: "spell:atomic".into(),
                loadout_revision: 1,
                learned_revision: 1,
            },
        );
        let mut runtime = runtime_with_bound_player();

        for (expected_code, commands) in [
            (
                "context-command-target",
                vec![sealed_context_command_v2(1, 0, base.action.clone())],
            ),
            (
                "context-command-target",
                vec![sealed_context_command_v2(
                    1,
                    INTEGRATED_RUNTIME_MAX_CONTEXT_COMMAND_LEAD_TICKS_V2 + 1,
                    base.action.clone(),
                )],
            ),
            (
                "context-command-order",
                vec![
                    sealed_context_command_v2(1, 2, base.action.clone()),
                    sealed_context_command_v2(2, 1, base.action.clone()),
                ],
            ),
        ] {
            let before = runtime.identity();
            assert_eq!(
                runtime.accept_context_commands_v2(&commands).unwrap_err().code,
                expected_code
            );
            assert_eq!(runtime.identity(), before);
            assert_eq!(runtime.next_context_command_sequence_v2(), Some(1));
        }

        let mut bad_hash = base.clone();
        bad_hash.command_hash = WireHash([0xaa; 16]);
        let before = runtime.identity();
        assert_eq!(
            runtime.accept_context_commands_v2(&[bad_hash]).unwrap_err().code,
            "context-command-hash"
        );
        assert_eq!(runtime.identity(), before);

        let capacity = (1..=MAX_CONTEXT_COMMANDS_V2 as u64 + 1)
            .map(|sequence| sealed_context_command_v2(sequence, 1, base.action.clone()))
            .collect::<Vec<_>>();
        assert_eq!(
            runtime.accept_context_commands_v2(&capacity).unwrap_err().code,
            "context-command-capacity"
        );
        assert_eq!(runtime.next_context_command_sequence_v2(), Some(1));

        runtime.step_context_v2(1_000_000, 8_000, &[], &[base]).unwrap();
        let before_v1 = runtime.identity();
        assert_eq!(
            runtime.step(1_050_000, 8_000).unwrap_err().code,
            "context-command-pending"
        );
        assert_eq!(runtime.identity(), before_v1);
        assert!(!runtime.queued_context_commands_empty_v2());
    }

    #[test]
    fn schema_v8_decode_rejects_noncanonical_queue_order_and_next_cursor() {
        let runtime = runtime_with_bound_player();
        let first = sealed_context_command_v2(
            1,
            2,
            RuntimeContextCommandActionV2::Cast {
                spell_id: "spell:checkpoint".into(),
                loadout_revision: 1,
                learned_revision: 2,
            },
        );
        let second = sealed_context_command_v2(2, 3, first.action.clone());
        let mut core = runtime_core_snapshot_from_runtime_v1(&runtime);
        core.schema = NATIVE_RUNTIME_CORE_SCHEMA_V8;
        core.block_action_loot_rng = BlockActionLootRngCursorV1::from_seed_v1(&core.config.world_seed);
        core.next_block_action_sequence = Some(1);
        core.block_action_receipts.clear();
        core.queued_context_commands = VecDeque::from([first.clone(), second.clone()]);
        core.next_context_command_sequence = Some(3);
        core.durable_state_proof = Some(durable_runtime_core_state_proof_v1(&core).unwrap());
        core.durable_replay_proof = Some(durable_runtime_replay_proof_v1(&core));
        let encoded = encode_runtime_core_snapshot_body_v1(&core, NATIVE_RUNTIME_CORE_SCHEMA_V8).unwrap();
        assert!(decode_runtime_core_snapshot_v1(&encoded).is_ok());

        let command_bytes = |command: &RuntimeContextCommandV2| {
            let mut writer = NativeWriterV1::default();
            write_context_command_native_v2(&mut writer, command).unwrap();
            writer.finish()
        };
        let first_bytes = command_bytes(&first);
        let second_bytes = command_bytes(&second);
        let first_offset = encoded
            .windows(first_bytes.len())
            .position(|window| window == first_bytes)
            .expect("first context command bytes are unique in the core snapshot");
        let second_offset = encoded
            .windows(second_bytes.len())
            .position(|window| window == second_bytes)
            .expect("second context command bytes are unique in the core snapshot");

        let reordered = sealed_context_command_v2(2, 1, second.action.clone());
        let reordered_bytes = command_bytes(&reordered);
        assert_eq!(reordered_bytes.len(), second_bytes.len());
        let mut invalid_order = encoded.clone();
        invalid_order[second_offset..second_offset + second_bytes.len()].copy_from_slice(&reordered_bytes);
        assert_eq!(
            decode_runtime_core_snapshot_v1(&invalid_order).unwrap_err().code,
            "native-context-command-order"
        );

        let mut invalid_cursor = encoded;
        let next_offset = first_offset
            .checked_sub(12)
            .expect("schema8 context prefix precedes queue");
        invalid_cursor[next_offset..next_offset + 8].copy_from_slice(&4_u64.to_le_bytes());
        assert_eq!(
            decode_runtime_core_snapshot_v1(&invalid_cursor).unwrap_err().code,
            "native-context-command-cursor"
        );
    }

    #[test]
    fn semantic_dispatch_rolls_back_with_the_crossed_fixed_step() {
        let mut runtime = runtime_with_bound_player();
        runtime.world_view = WorldViewAuthorityV1::new(runtime.world_view.state.clone());
        let command = sealed_context_command_v2(
            1,
            1,
            RuntimeContextCommandActionV2::Reload {
                container: RuntimeContainerKeyV2 {
                    kind: RuntimeContainerKindV2::Equipment,
                    id: "actor:test:equipment".into(),
                    owner_id: Some("actor:test".into()),
                },
                selected_slot: 0,
                container_revision: 1,
            },
        );
        runtime.step_context_v2(1_000_000, 8_000, &[], &[command]).unwrap();
        let before = runtime.identity();
        let error = runtime.step_context_v2(1_050_000, 8_000, &[], &[]).unwrap_err();
        assert_eq!(error.code, "world-view-schedule");
        assert_eq!(runtime.identity(), before);
        assert!(!runtime.queued_context_commands_empty_v2());
        assert_eq!(runtime.next_context_command_sequence_v2(), Some(2));
    }

    #[test]
    fn monotonic_time_regression_is_atomic_for_step_v1_and_step_v2() {
        let mut step_v1_runtime = runtime_with_bound_player();
        step_v1_runtime.step(1_000_000, 8_000).unwrap();
        let step_v1_before = step_v1_runtime.identity();
        assert_eq!(
            step_v1_runtime.step(999_999, 8_000).unwrap_err().code,
            "monotonic-time-regression"
        );
        assert_eq!(step_v1_runtime.identity(), step_v1_before);
        assert_eq!(step_v1_runtime.last_monotonic_time_us, 1_000_000);

        let mut step_v2_runtime = runtime_with_bound_player();
        let command = sealed_context_command_v2(
            1,
            1,
            RuntimeContextCommandActionV2::Cast {
                spell_id: "spell:monotonic-rollback".into(),
                loadout_revision: 1,
                learned_revision: 2,
            },
        );
        step_v2_runtime
            .step_context_v2(1_000_000, 8_000, &[], &[command])
            .unwrap();
        let step_v2_before = step_v2_runtime.identity();
        let queued_before = step_v2_runtime.queued_context_commands.clone();
        assert_eq!(
            step_v2_runtime
                .step_context_v2(999_999, 8_000, &[], &[])
                .unwrap_err()
                .code,
            "monotonic-time-regression"
        );
        assert_eq!(step_v2_runtime.identity(), step_v2_before);
        assert_eq!(step_v2_runtime.last_monotonic_time_us, 1_000_000);
        assert_eq!(step_v2_runtime.queued_context_commands, queued_before);
        assert_eq!(step_v2_runtime.next_context_command_sequence_v2(), Some(2));
    }

    #[test]
    fn context_continuity_query_is_exact_nonmutating_and_rejects_stale_identity() {
        let runtime = runtime_with_bound_player();
        let expected = runtime.identity();
        let request_hash = CanonicalHash([0x61; 16]);
        let receipt = runtime
            .context_command_continuity_status_v2(
                &RuntimeContextCommandContinuityQueryWireV2 {
                    expected: expected.clone(),
                },
                request_hash,
            )
            .unwrap();
        assert_eq!(receipt.request_payload_hash, request_hash);
        assert_eq!(receipt.identity, expected);
        assert_eq!(receipt.last_sequence, None);
        assert_eq!(receipt.next_sequence, Some(1));
        assert!(receipt.queued_commands_empty);
        assert_eq!(runtime.identity(), expected);

        let mut stale = expected.clone();
        stale.tick += 1;
        assert_eq!(
            runtime
                .context_command_continuity_status_v2(
                    &RuntimeContextCommandContinuityQueryWireV2 { expected: stale },
                    request_hash,
                )
                .unwrap_err()
                .code,
            "context-continuity-stale"
        );
        assert_eq!(runtime.identity(), expected);
    }

    #[test]
    fn fixed_step_replay_is_equivalent_at_30_60_and_120_hz() {
        fn run(refresh_hz: u64) -> (CanonicalHash, SimulationVec3, u64) {
            let mut runtime = runtime_with_bound_player();
            runtime
                .accept_inputs(&[RuntimeInputFrameV1 {
                    sequence: 1,
                    target_tick: 1,
                    move_x: 8_192,
                    move_z: 32_767,
                    buttons: RUNTIME_INPUT_BUTTON_SPRINT_V1,
                    ..RuntimeInputFrameV1::default()
                }])
                .unwrap();
            let start = 1_000_000_u64;
            runtime.step(start, 8_000).unwrap();
            for frame in 1..=refresh_hz {
                let timestamp = start + frame * 1_000_000 / refresh_hz;
                runtime.step(timestamp, 8_000).unwrap();
            }
            (
                runtime.state_hash(),
                runtime.player().unwrap().body.position,
                runtime.tick(),
            )
        }
        let at_30 = run(30);
        let at_60 = run(60);
        let at_120 = run(120);
        assert_eq!(at_30, at_60);
        assert_eq!(at_60, at_120);
        assert_eq!(at_120.2, 20);
    }

    #[test]
    fn fixed_step_rolls_back_gameplay_when_world_view_clock_rejects() {
        let mut runtime = runtime_with_bound_player();
        runtime.world_view = WorldViewAuthorityV1::new(runtime.world_view.state.clone());
        runtime.step(1_000_000, 8_000).unwrap();
        let before = runtime.identity();
        let before_gameplay = runtime.gameplay().state.identity();
        let before_world_view = runtime.world_view().state.identity();
        let error = runtime.step(1_050_000, 8_000).unwrap_err();
        assert_eq!(error.code, "world-view-schedule");
        assert_eq!(runtime.identity(), before);
        assert_eq!(runtime.gameplay().state.identity(), before_gameplay);
        assert_eq!(runtime.world_view().state.identity(), before_world_view);
    }

    #[test]
    fn rising_edge_actions_are_consumed_once_and_return_authoritative_receipts() {
        let mut runtime = runtime_with_bound_player();
        runtime
            .accept_inputs(&[RuntimeInputFrameV1 {
                sequence: 1,
                target_tick: 1,
                buttons: RUNTIME_INPUT_BUTTON_INTERACT_V1 | RUNTIME_INPUT_BUTTON_CREATIVE_FLIGHT_TOGGLE_V1,
                ..RuntimeInputFrameV1::default()
            }])
            .unwrap();
        runtime.step(1_000_000, 8_000).unwrap();
        let first = runtime.step(1_050_000, 8_000).unwrap();
        assert_eq!(first.action_receipts.len(), 2);
        assert_eq!(first.action_receipts[0].kind, RuntimeInputActionKindV1::Interact);
        assert_eq!(
            first.action_receipts[1].kind,
            RuntimeInputActionKindV1::CreativeFlightToggle
        );
        assert_eq!(first.action_receipts[1].outcome, RuntimeInputActionOutcomeV1::Applied);
        assert_ne!(
            first.action_receipts[1].authoritative_flags & RUNTIME_INPUT_FLAG_FLYING_V1,
            0
        );
        let held = runtime.step(1_100_000, 8_000).unwrap();
        assert!(
            held.action_receipts.is_empty(),
            "a held sampled button is not a second rising edge"
        );
    }

    #[test]
    fn player_drop_atomically_moves_one_item_spawns_entity_and_round_trips() {
        let mut runtime = runtime_with_bound_player_item(2);
        runtime.native_world_view_extension_bytes = vec![0x80, 0xff, 7];
        runtime
            .accept_inputs(&[RuntimeInputFrameV1 {
                sequence: 1,
                target_tick: 1,
                buttons: RUNTIME_INPUT_BUTTON_DROP_V1,
                ..RuntimeInputFrameV1::default()
            }])
            .unwrap();
        runtime.step(1_000_000, 8_000).unwrap();
        let summary = runtime.step(1_050_000, 8_000).unwrap();
        assert_eq!(summary.action_receipts.len(), 1);
        let action = &summary.action_receipts[0];
        assert_eq!(action.kind, RuntimeInputActionKindV1::Drop);
        assert_eq!(action.outcome, RuntimeInputActionOutcomeV1::Applied);
        let drop_entity_id = EntityId::new(action.target_entity_id as u32, (action.target_entity_id >> 32) as u32);
        assert!(runtime.entities().contains(drop_entity_id));
        assert_eq!(runtime.world_view().state.dropped_items.len(), 1);
        let drop = runtime.world_view().state.dropped_items.values().next().unwrap();
        assert_eq!(drop.entity_id, drop_entity_id);
        assert_eq!(
            runtime
                .world_view()
                .state
                .dropped_stack(&runtime.gameplay().state, &drop.drop_id)
                .unwrap()
                .count,
            1
        );
        let player_id = runtime.player().unwrap().binding.player_id;
        assert_eq!(
            runtime
                .world_view()
                .state
                .held_stack(&runtime.gameplay().state, player_id)
                .unwrap()
                .unwrap()
                .count,
            1
        );
        let drop_id = drop.drop_id.clone();
        assert!(runtime.step(1_100_000, 8_000).unwrap().action_receipts.is_empty());
        let extraction = runtime.world_view_extraction().unwrap();
        assert_eq!(extraction.dropped_items.len(), 1);

        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let checkpoint_hash = integrated_runtime_checkpoint_hash_v1(&checkpoint);
        let mut restored = IntegratedRuntimeV2::restore_runtime_checkpoint(&checkpoint, checkpoint_hash).unwrap();
        assert_eq!(restored.identity(), runtime.identity());
        assert_eq!(restored.world_view_extraction().unwrap(), extraction);
        assert_eq!(restored.native_world_view_extension_bytes, vec![0x80, 0xff, 7]);

        let future = restored.step(1_150_000, 8_000).unwrap();
        assert_eq!(future.fixed_steps, 1);
        assert_eq!(restored.tick(), restored.gameplay().state.tick);
        assert_eq!(restored.tick(), restored.gameplay().state.combat.tick);
        assert_eq!(restored.tick(), restored.world_view().state.tick);
        let future_identity = restored.identity();
        let future_checkpoint = restored.export_runtime_checkpoint().unwrap();
        let future_restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &future_checkpoint,
            integrated_runtime_checkpoint_hash_v1(&future_checkpoint),
        )
        .unwrap();
        assert_eq!(future_restored.identity(), future_identity);
        assert_eq!(future_restored.tick(), future_restored.gameplay().state.tick);
        assert_eq!(future_restored.tick(), future_restored.world_view().state.tick);
        let future_extraction = future_restored.world_view_extraction().unwrap();
        assert_eq!(future_extraction.dropped_items.len(), 1);
        assert_eq!(future_extraction.dropped_items[0].spatial.drop_id, drop_id);
        assert_eq!(future_extraction.dropped_items[0].stack.count, 1);
        assert_eq!(future_extraction.players[0].held_stack.as_ref().unwrap().count, 1);
    }

    #[test]
    fn dropped_item_presentation_resolver_is_role_specific_and_checkpoint_stable() {
        let runtime = runtime_with_bound_player_item(1);
        let expected_hash = *runtime
            .gameplay_content_index
            .get(&(
                ContentDomain::MachineProfile,
                blockwild_gameplay::RENDER_PRESENTATION_CATALOG_ID.into(),
            ))
            .unwrap();
        assert_eq!(
            runtime.dropped_item_render_presentation_binding_v1(42),
            IntegratedRuntimeRenderPresentationBindingV1::Exact {
                profile_id: "drop:test",
                model_id: "test-drop-model",
                content_hash: expected_hash,
                content_version: 7,
            }
        );
        assert_eq!(
            runtime.dropped_item_render_presentation_binding_v1(43),
            IntegratedRuntimeRenderPresentationBindingV1::Missing {
                blocker_id: "missing:dropped-item:test-missing",
            }
        );
        assert_eq!(
            runtime.dropped_item_render_presentation_binding_v1(44),
            IntegratedRuntimeRenderPresentationBindingV1::Unmapped
        );
        assert_eq!(
            runtime.entity_model_content_identity("test-drop-model", "dropped-item"),
            None,
            "dropped presentation identity must not leak through creature-profile lookup"
        );
        assert_eq!(
            runtime.machine_anchor_render_presentation_binding_v1("machine:test"),
            IntegratedRuntimeRenderPresentationBindingV1::Exact {
                profile_id: "machine:test",
                model_id: "test-machine-model",
                content_hash: expected_hash,
                content_version: 7,
            }
        );
        assert_eq!(
            runtime.machine_anchor_render_presentation_binding_v1("missing:machine:test-missing"),
            IntegratedRuntimeRenderPresentationBindingV1::Missing {
                blocker_id: "missing:machine:test-missing",
            }
        );
        assert_eq!(
            runtime.machine_anchor_render_presentation_binding_v1("test-machine-model"),
            IntegratedRuntimeRenderPresentationBindingV1::Unmapped,
            "machine model ids are never reinterpreted as presentation ids"
        );
        assert_eq!(
            runtime.render_presentation_profile_binding_v1(ContentRenderPresentationRole::WorldProp, "machine:test",),
            IntegratedRuntimeRenderPresentationBindingV1::Unmapped,
            "profile ids cannot cross presentation roles"
        );

        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert_eq!(
            restored.dropped_item_render_presentation_binding_v1(42),
            runtime.dropped_item_render_presentation_binding_v1(42)
        );
        assert_eq!(
            restored.machine_anchor_render_presentation_binding_v1("machine:test"),
            runtime.machine_anchor_render_presentation_binding_v1("machine:test")
        );
        assert_eq!(
            restored
                .gameplay_content_store()
                .get_by_alias("machine-profile:render-presentations")
                .unwrap()
                .exact_bytes()
                .1,
            [0, 0x80, 0xff, 17]
        );
    }

    #[test]
    fn player_drop_rolls_back_entity_and_custody_when_spatial_registration_rejects() {
        let mut runtime = runtime_with_bound_player_item(1);
        runtime.world_view = WorldViewAuthorityV1::new(runtime.world_view.state.clone());
        let before_entities = runtime.entities.canonical_hash();
        let before_gameplay = runtime.gameplay.state.state_hash();
        let before_world_view = runtime.world_view.state.state_hash();
        let before_held = runtime
            .world_view
            .state
            .held_stack(&runtime.gameplay.state, runtime.player().unwrap().binding.player_id)
            .unwrap()
            .cloned();
        let error = runtime
            .apply_player_drop(RuntimeInputFrameV1 {
                sequence: 1,
                target_tick: 1,
                buttons: RUNTIME_INPUT_BUTTON_DROP_V1,
                ..RuntimeInputFrameV1::default()
            })
            .unwrap_err();
        assert_eq!(error.code, "input-drop-world-view");
        assert_eq!(runtime.entities.canonical_hash(), before_entities);
        assert_eq!(runtime.gameplay.state.state_hash(), before_gameplay);
        assert_eq!(runtime.world_view.state.state_hash(), before_world_view);
        assert_eq!(
            runtime
                .world_view
                .state
                .held_stack(&runtime.gameplay.state, runtime.player().unwrap().binding.player_id)
                .unwrap()
                .cloned(),
            before_held
        );
    }

    #[test]
    fn dropped_item_lock_is_exact_and_pickup_commits_all_domains_once() {
        let mut runtime = runtime_with_bound_player_item(2);
        let (mut timestamp, action) = trigger_one_player_drop_v1(&mut runtime);
        park_drop_at_player_v1(&mut runtime);
        let drop = runtime.world_view.state.dropped_items.values().next().unwrap().clone();
        assert_eq!(
            drop.pickup_lock_actor_id, None,
            "new native drops use a global deadline"
        );
        let inventory_key = runtime
            .world_view
            .state
            .player_binding(PlayerId::new(1, 1))
            .unwrap()
            .inventory_container
            .clone();
        assert_eq!(drop.created_tick, 0);
        assert_eq!(drop.pickup_unlock_tick, INTEGRATED_RUNTIME_DROP_PICKUP_DELAY_TICKS_V1);
        assert_eq!(runtime.tick(), 1);
        assert_eq!(
            runtime.gameplay.state.inventory.containers[&inventory_key].slots[0]
                .as_ref()
                .unwrap()
                .count,
            1
        );

        while runtime.tick() < drop.pickup_unlock_tick.saturating_sub(1) {
            advance_one_fixed_step_v1(&mut runtime, &mut timestamp);
            assert!(runtime.world_view.state.dropped_items.contains_key(&drop.drop_id));
            assert!(runtime.entities.hot().contains_key(&drop.entity_id));
            assert!(
                runtime
                    .gameplay
                    .state
                    .inventory
                    .containers
                    .contains_key(&drop.container)
            );
        }
        assert_eq!(runtime.tick(), drop.pickup_unlock_tick.saturating_sub(1));
        advance_one_fixed_step_v1(&mut runtime, &mut timestamp);
        assert_eq!(runtime.tick(), drop.pickup_unlock_tick);
        assert!(!runtime.world_view.state.dropped_items.contains_key(&drop.drop_id));
        assert!(!runtime.entities.contains(drop.entity_id));
        assert!(
            !runtime
                .gameplay
                .state
                .inventory
                .containers
                .contains_key(&drop.container)
        );
        assert_eq!(
            runtime.gameplay.state.inventory.containers[&inventory_key].slots[0]
                .as_ref()
                .unwrap()
                .count,
            2
        );
        assert_eq!(action.target_entity_id, drop.entity_id.packed());

        let after = runtime.identity();
        advance_one_fixed_step_v1(&mut runtime, &mut timestamp);
        assert_eq!(
            runtime.gameplay.state.inventory.containers[&inventory_key].slots[0]
                .as_ref()
                .unwrap()
                .count,
            2,
            "a removed drop cannot be picked twice"
        );
        assert_ne!(runtime.identity(), after, "the fixed-step clocks still advance");
    }

    #[test]
    fn dropped_item_motion_and_collision_are_refresh_cadence_equivalent() {
        fn run(refresh_hz: u64) -> (DroppedItemSpatialV1, CanonicalHash, u64) {
            let mut runtime = runtime_with_bound_player_item(1);
            let (start, _) = trigger_one_player_drop_v1(&mut runtime);
            set_drop_unlock_v1(&mut runtime, 100);
            move_bound_player_for_drop_test_v1(&mut runtime, SimulationVec3::new(0.0, 63.5, 0.0));
            for frame in 1..=refresh_hz {
                let timestamp = start + frame * 1_000_000 / refresh_hz;
                runtime.step(timestamp, 8_000).unwrap();
            }
            let drop = runtime.world_view.state.dropped_items.values().next().unwrap().clone();
            assert!(!runtime.drop_position_collides_v1(drop.position).unwrap());
            assert!(
                runtime
                    .drop_position_collides_v1(FixedWorldVec3V1 {
                        x_milli: 1_000_000_000,
                        y_milli: 64_000,
                        z_milli: 1_000_000_000,
                    })
                    .unwrap(),
                "unloaded terrain is a deterministic solid boundary"
            );
            (drop, runtime.state_hash(), runtime.tick())
        }

        let at_30 = run(30);
        let at_60 = run(60);
        let at_120 = run(120);
        assert_eq!(at_30, at_60);
        assert_eq!(at_60, at_120);
        assert_eq!(at_120.2, 21);
    }

    #[test]
    fn full_pickup_rolls_back_and_retries_after_capacity_is_available() {
        let mut runtime = runtime_with_bound_player_item(1);
        let (mut timestamp, _) = trigger_one_player_drop_v1(&mut runtime);
        park_drop_at_player_v1(&mut runtime);
        let drop = runtime.world_view.state.dropped_items.values().next().unwrap().clone();
        let inventory_key = runtime
            .world_view
            .state
            .player_binding(PlayerId::new(1, 1))
            .unwrap()
            .inventory_container
            .clone();
        let mut state = runtime.gameplay.state.clone();
        let inventory = state.inventory.containers.get_mut(&inventory_key).unwrap();
        inventory.slots.fill_with(|| Some(ItemStack::simple(42, 64)));
        inventory.revision = inventory.revision.checked_add(1).unwrap();
        state.revision.sequence = state.revision.sequence.checked_add(1).unwrap();
        state.revision.inventory = state.revision.inventory.checked_add(1).unwrap();
        replace_gameplay_state_for_drop_test_v1(&mut runtime, state);

        while runtime.tick() < drop.pickup_unlock_tick {
            advance_one_fixed_step_v1(&mut runtime, &mut timestamp);
        }
        let blocked_custody = runtime.gameplay.state.inventory.containers[&drop.container].clone();
        let blocked_drop = runtime.world_view.state.dropped_items[&drop.drop_id].clone();
        assert!(runtime.entities.hot().contains_key(&drop.entity_id));
        assert_eq!(blocked_custody.slots[usize::from(drop.slot)].as_ref().unwrap().count, 1);

        let mut state = runtime.gameplay.state.clone();
        let inventory = state.inventory.containers.get_mut(&inventory_key).unwrap();
        inventory.slots[8] = None;
        inventory.revision = inventory.revision.checked_add(1).unwrap();
        state.revision.sequence = state.revision.sequence.checked_add(1).unwrap();
        state.revision.inventory = state.revision.inventory.checked_add(1).unwrap();
        replace_gameplay_state_for_drop_test_v1(&mut runtime, state);
        advance_one_fixed_step_v1(&mut runtime, &mut timestamp);
        assert!(
            !runtime
                .gameplay
                .state
                .inventory
                .containers
                .contains_key(&drop.container)
        );
        assert!(!runtime.world_view.state.dropped_items.contains_key(&drop.drop_id));
        assert!(!runtime.entities.contains(drop.entity_id));
        assert_eq!(
            runtime.gameplay.state.inventory.containers[&inventory_key].slots[8]
                .as_ref()
                .unwrap(),
            &ItemStack::simple(42, 1)
        );
        assert!(
            blocked_drop.revision > drop.revision,
            "failed capacity only allows motion revisions"
        );
    }

    #[test]
    fn metadata_bearing_pickup_preserves_exact_stack_and_descriptor() {
        let mut runtime = runtime_with_bound_player_item(0);
        let metadata = create_metadata_fixture_v1();
        let stack = ItemStack {
            item_code: 42,
            count: 1,
            durability_millionths: Some(345_678),
            metadata_hash: metadata.hash,
        };
        let inventory_key = runtime
            .world_view
            .state
            .player_binding(PlayerId::new(1, 1))
            .unwrap()
            .inventory_container
            .clone();
        runtime
            .import_player_inventory(
                PlayerInventoryImportWireV1 {
                    import: blockwild_gameplay::ImportPlayerInventoryV1 {
                        inventory: inventory_key.clone(),
                        expected_revision: 0,
                        slots: std::iter::once(Some(stack.clone()))
                            .chain(std::iter::repeat_n(None, 8))
                            .collect(),
                        metadata: vec![metadata.clone()],
                    },
                    selected_slot: 0,
                },
                CanonicalHash([0xa5; 16]),
            )
            .unwrap();
        let (mut timestamp, _) = trigger_one_player_drop_v1(&mut runtime);
        park_drop_at_player_v1(&mut runtime);
        let drop = runtime.world_view.state.dropped_items.values().next().unwrap().clone();
        while runtime.tick() < drop.pickup_unlock_tick {
            advance_one_fixed_step_v1(&mut runtime, &mut timestamp);
        }
        assert_eq!(
            runtime.gameplay.state.inventory.containers[&inventory_key].slots[0]
                .as_ref()
                .unwrap(),
            &stack
        );
        assert_eq!(
            runtime.gameplay.state.inventory.item_instance_metadata[&metadata.hash],
            metadata
        );
        assert!(
            !runtime
                .gameplay
                .state
                .inventory
                .containers
                .contains_key(&drop.container)
        );
        assert!(!runtime.entities.contains(drop.entity_id));
    }

    #[test]
    fn expired_nonempty_drop_is_retained_and_frozen() {
        let mut runtime = runtime_with_bound_player_item(1);
        let (mut timestamp, _) = trigger_one_player_drop_v1(&mut runtime);
        move_bound_player_for_drop_test_v1(&mut runtime, SimulationVec3::new(0.0, 63.5, 0.0));
        let drop_id = runtime.world_view.state.dropped_items.keys().next().unwrap().clone();
        let expiry = runtime.world_view.state.dropped_items[&drop_id].pickup_unlock_tick;
        runtime
            .world_view
            .state
            .dropped_items
            .get_mut(&drop_id)
            .unwrap()
            .expires_tick = Some(expiry);
        runtime.invalidate_state_hash();
        while runtime.tick() <= expiry {
            advance_one_fixed_step_v1(&mut runtime, &mut timestamp);
        }
        let drop = runtime.world_view.state.dropped_items[&drop_id].clone();
        assert_eq!(drop.velocity_milli_per_second, FixedWorldVec3V1::default());
        assert!(
            runtime
                .gameplay
                .state
                .inventory
                .containers
                .contains_key(&drop.container)
        );
        assert!(runtime.entities.hot().contains_key(&drop.entity_id));
        assert_eq!(
            runtime.gameplay.state.inventory.containers[&drop.container].slots[usize::from(drop.slot)]
                .as_ref()
                .unwrap()
                .count,
            1
        );
    }

    #[test]
    fn canonical_drop_scan_is_bounded_and_rotates_without_prefix_bias() {
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        for index in 0..130_u32 {
            let drop_id = format!("drop-{index:03}");
            runtime.world_view.state.dropped_items.insert(
                drop_id.clone(),
                DroppedItemSpatialV1 {
                    drop_id,
                    revision: 1,
                    entity_id: EntityId::new(index.saturating_add(1), 1),
                    container: ContainerKey {
                        kind: ContainerKind::Container,
                        id: format!("custody-{index:03}"),
                        owner_id: None,
                    },
                    slot: 0,
                    bound_container_revision: 1,
                    position: FixedWorldVec3V1::default(),
                    velocity_milli_per_second: FixedWorldVec3V1::default(),
                    rotation: RotationMicroturnsV1::default(),
                    created_tick: 0,
                    expires_tick: None,
                    pickup_lock_actor_id: None,
                    pickup_unlock_tick: 0,
                },
            );
        }
        runtime.tick = 1;
        let first = runtime.canonical_drop_scan_v1();
        assert_eq!(first.len(), INTEGRATED_RUNTIME_MAX_DROP_MOTION_PER_STEP_V1);
        assert_eq!(first.first().unwrap(), "drop-000");
        assert_eq!(first.last().unwrap(), "drop-127");
        runtime.tick = 2;
        let second = runtime.canonical_drop_scan_v1();
        assert_eq!(second.len(), INTEGRATED_RUNTIME_MAX_DROP_MOTION_PER_STEP_V1);
        assert_eq!(&second[..4], ["drop-128", "drop-129", "drop-000", "drop-001"]);
        runtime.tick = 3;
        let third = runtime.canonical_drop_scan_v1();
        assert_eq!(third.first().unwrap(), "drop-126");
        assert!(
            first
                .into_iter()
                .chain(second)
                .chain(third)
                .collect::<BTreeSet<_>>()
                .len()
                == 130
        );
    }

    #[test]
    fn one_thousand_drop_scan_work_remains_strictly_bounded() {
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        for index in 0..1_000_u32 {
            let drop_id = format!("drop-{index:04}");
            runtime.world_view.state.dropped_items.insert(
                drop_id.clone(),
                DroppedItemSpatialV1 {
                    drop_id,
                    revision: 1,
                    entity_id: EntityId::new(index.saturating_add(1), 1),
                    container: ContainerKey {
                        kind: ContainerKind::Container,
                        id: format!("custody-{index:04}"),
                        owner_id: None,
                    },
                    slot: 0,
                    bound_container_revision: 1,
                    position: FixedWorldVec3V1::default(),
                    velocity_milli_per_second: FixedWorldVec3V1::default(),
                    rotation: RotationMicroturnsV1::default(),
                    created_tick: 0,
                    expires_tick: None,
                    pickup_lock_actor_id: None,
                    pickup_unlock_tick: 0,
                },
            );
        }
        let mut visited = BTreeSet::new();
        for tick in 1..=8 {
            runtime.tick = tick;
            let scan = runtime.canonical_drop_scan_v1();
            assert_eq!(scan.len(), INTEGRATED_RUNTIME_MAX_DROP_MOTION_PER_STEP_V1);
            visited.extend(scan);
        }
        assert_eq!(
            visited.len(),
            1_000,
            "eight bounded pages cover the complete sorted ring"
        );
    }

    #[test]
    fn multiple_pickups_follow_canonical_order_and_respect_the_per_step_budget() {
        let mut runtime = runtime_with_bound_player_item(17);
        for sequence in 1..=17_u64 {
            let outcome = runtime
                .apply_player_drop(RuntimeInputFrameV1 {
                    sequence,
                    target_tick: 0,
                    buttons: RUNTIME_INPUT_BUTTON_DROP_V1,
                    ..RuntimeInputFrameV1::default()
                })
                .unwrap();
            assert_eq!(outcome.0, RuntimeInputActionOutcomeV1::Applied);
        }
        let canonical_ids = runtime
            .world_view
            .state
            .dropped_items
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(canonical_ids.len(), 17);
        let commands = runtime
            .world_view
            .state
            .dropped_items
            .values()
            .map(|drop| WorldViewCommandV1::SetDropPickupLock {
                drop_id: drop.drop_id.clone(),
                expected_revision: drop.revision,
                pickup_lock_actor_id: None,
                pickup_unlock_tick: 0,
            })
            .collect();
        let batch = WorldViewBatchV1::new(
            "unlock-pickup-budget-fixture",
            "unlock-pickup-budget-fixture",
            system_world_view_actor_v1(),
            runtime.world_view.state.identity(),
            commands,
        );
        assert!(matches!(
            runtime.world_view.apply_batch(&batch, &runtime.gameplay.state),
            WorldViewReceiptV1::Accepted(_)
        ));
        runtime.invalidate_state_hash();

        runtime.advance_dropped_items_v1().unwrap();
        assert_eq!(runtime.world_view.state.dropped_items.len(), 1);
        assert_eq!(
            runtime.world_view.state.dropped_items.keys().next().unwrap(),
            canonical_ids.last().unwrap(),
            "the first sixteen canonical IDs are picked up before the budget stops the scan"
        );
        let inventory_key = runtime
            .world_view
            .state
            .player_binding(PlayerId::new(1, 1))
            .unwrap()
            .inventory_container
            .clone();
        assert_eq!(
            runtime.gameplay.state.inventory.containers[&inventory_key].slots[0]
                .as_ref()
                .unwrap()
                .count,
            INTEGRATED_RUNTIME_MAX_DROP_PICKUPS_PER_STEP_V1 as u32
        );
    }

    #[test]
    fn delayed_drop_checkpoint_restores_exactly_and_replays_future_pickup() {
        let mut original = runtime_with_bound_player_item(2);
        let (mut timestamp, _) = trigger_one_player_drop_v1(&mut original);
        park_drop_at_player_v1(&mut original);
        let expected_unlock = original
            .world_view
            .state
            .dropped_items
            .values()
            .next()
            .unwrap()
            .pickup_unlock_tick;
        let checkpoint = original.export_runtime_checkpoint().unwrap();
        let mut restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert_eq!(restored.identity(), original.identity());
        assert_eq!(
            restored
                .world_view
                .state
                .dropped_items
                .values()
                .next()
                .unwrap()
                .pickup_unlock_tick,
            expected_unlock
        );
        while original.tick() <= expected_unlock {
            timestamp = timestamp.saturating_add(INTEGRATED_RUNTIME_FIXED_STEP_US);
            let first = original.step(timestamp, 8_000).unwrap();
            let second = restored.step(timestamp, 8_000).unwrap();
            assert_eq!(first, second);
            assert_eq!(original.identity(), restored.identity());
        }
        assert!(original.world_view.state.dropped_items.is_empty());
        assert_eq!(restored.identity(), original.identity());
        let future_checkpoint = restored.export_runtime_checkpoint().unwrap();
        let future = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &future_checkpoint,
            integrated_runtime_checkpoint_hash_v1(&future_checkpoint),
        )
        .unwrap();
        assert_eq!(future.identity(), restored.identity());
    }

    #[test]
    fn stale_drop_links_and_cold_players_fail_closed_with_whole_step_rollback() {
        let mut transform_runtime = runtime_with_bound_player_item(1);
        let (mut timestamp, _) = trigger_one_player_drop_v1(&mut transform_runtime);
        let drop = transform_runtime
            .world_view
            .state
            .dropped_items
            .values()
            .next()
            .unwrap()
            .clone();
        commit_entity_commands(
            &mut transform_runtime,
            "corrupt-drop-transform",
            vec![EntityCommand::UpdateMotion {
                id: drop.entity_id,
                position: EntityVec3::new(9.0, 65.0, 9.0),
                yaw: 0.0,
                velocity: EntityVec3::ZERO,
            }],
        );
        let before = transform_runtime.identity();
        timestamp = timestamp.saturating_add(INTEGRATED_RUNTIME_FIXED_STEP_US);
        assert_eq!(
            transform_runtime.step(timestamp, 8_000).unwrap_err().code,
            "drop-transform-link"
        );
        assert_eq!(transform_runtime.identity(), before);

        let mut custody_runtime = runtime_with_bound_player_item(1);
        let (mut timestamp, _) = trigger_one_player_drop_v1(&mut custody_runtime);
        let drop = custody_runtime
            .world_view
            .state
            .dropped_items
            .values()
            .next()
            .unwrap()
            .clone();
        custody_runtime
            .gameplay
            .state
            .inventory
            .containers
            .get_mut(&drop.container)
            .unwrap()
            .revision += 1;
        custody_runtime.invalidate_state_hash();
        let before = custody_runtime.identity();
        timestamp = timestamp.saturating_add(INTEGRATED_RUNTIME_FIXED_STEP_US);
        let error = custody_runtime.step(timestamp, 8_000).unwrap_err();
        assert!(
            matches!(error.code.as_str(), "drop-custody-link" | "player-motion"),
            "cross-domain validation may reject the stale custody at the first scheduled domain boundary: {error:?}"
        );
        assert_eq!(custody_runtime.identity(), before);

        let mut cold_player_runtime = runtime_with_bound_player_item(1);
        let (_timestamp, _) = trigger_one_player_drop_v1(&mut cold_player_runtime);
        let player_id = cold_player_runtime.player.as_ref().unwrap().entity_id;
        commit_entity_commands(
            &mut cold_player_runtime,
            "hibernate-pickup-player",
            vec![EntityCommand::Hibernate { id: player_id }],
        );
        let current_tick = cold_player_runtime.tick();
        set_drop_unlock_v1(&mut cold_player_runtime, current_tick);
        let before = cold_player_runtime.identity();
        let mut candidate = cold_player_runtime.clone();
        assert_eq!(
            candidate.advance_dropped_items_v1().unwrap_err().code,
            "drop-player-orphan"
        );
        assert_eq!(cold_player_runtime.identity(), before);
    }

    #[test]
    fn mount_toggle_updates_r6_seats_and_player_flags_on_each_rising_edge() {
        let mut runtime = runtime_with_bound_player();
        let mut mount = EntityCompatibilityRecord::new("mount:test", "mount:test", "test-mount");
        mount.class = EntityClass::Vehicle;
        mount.position = EntityVec3::new(8.0, 64.25, 5.5);
        commit_entity_commands(
            &mut runtime,
            "spawn-test-mount",
            vec![EntityCommand::Spawn {
                record: mount,
                residency: EntityResidency::Hot,
            }],
        );
        let player_entity_id = runtime.player().unwrap().entity_id;
        let mount_id = runtime
            .entities()
            .hot()
            .keys()
            .copied()
            .find(|id| *id != player_entity_id)
            .unwrap();
        commit_entity_commands(
            &mut runtime,
            "configure-test-mount",
            vec![EntityCommand::SetMountState {
                id: mount_id,
                value: MountState {
                    parent_mount: None,
                    occupied_seat: None,
                    seats: vec![MountSeat {
                        index: 0,
                        role: "driver".into(),
                        offset: EntityVec3::ZERO,
                        occupant: None,
                        control_weight_milli: 1_000,
                    }],
                    saddle_key: Some("test-saddle".into()),
                    accepts_riders: true,
                },
            }],
        );
        let mounted = runtime
            .dispatch_input_edges(
                RuntimeInputFrameV1 {
                    sequence: 1,
                    buttons: RUNTIME_INPUT_BUTTON_MOUNT_TOGGLE_V1,
                    look_pitch: -2_048,
                    ..RuntimeInputFrameV1::default()
                },
                0,
            )
            .unwrap();
        assert_eq!(mounted[0].outcome, RuntimeInputActionOutcomeV1::Applied);
        assert_eq!(mounted[0].target_entity_id, mount_id.packed());
        assert_ne!(runtime.player().unwrap().flags & RUNTIME_INPUT_FLAG_MOUNTED_V1, 0);
        assert_eq!(
            runtime
                .entities()
                .components(player_entity_id)
                .unwrap()
                .mount
                .parent_mount,
            Some(mount_id)
        );
        assert_eq!(
            runtime.entities().components(mount_id).unwrap().mount.seats[0].occupant,
            Some(player_entity_id)
        );

        let dismounted = runtime
            .dispatch_input_edges(
                RuntimeInputFrameV1 {
                    sequence: 2,
                    buttons: RUNTIME_INPUT_BUTTON_MOUNT_TOGGLE_V1,
                    ..RuntimeInputFrameV1::default()
                },
                0,
            )
            .unwrap();
        assert_eq!(dismounted[0].outcome, RuntimeInputActionOutcomeV1::Applied);
        assert_eq!(runtime.player().unwrap().flags & RUNTIME_INPUT_FLAG_MOUNTED_V1, 0);
        assert_eq!(
            runtime
                .entities()
                .components(player_entity_id)
                .unwrap()
                .mount
                .parent_mount,
            None
        );
        assert_eq!(
            runtime.entities().components(mount_id).unwrap().mount.seats[0].occupant,
            None
        );
    }

    #[test]
    fn input_sequence_staleness_and_unloaded_action_boundaries_fail_closed() {
        let mut runtime = runtime_with_bound_player();
        runtime
            .accept_inputs(&[RuntimeInputFrameV1 {
                sequence: 1,
                target_tick: 0,
                ..RuntimeInputFrameV1::default()
            }])
            .unwrap();
        assert_eq!(
            runtime
                .accept_inputs(&[RuntimeInputFrameV1 {
                    sequence: 1,
                    target_tick: 0,
                    ..RuntimeInputFrameV1::default()
                }])
                .unwrap_err()
                .code,
            "input-sequence"
        );
        runtime.step(1_000_000, 8_000).unwrap();
        runtime.step(1_050_000, 8_000).unwrap();
        assert_eq!(
            runtime
                .accept_inputs(&[RuntimeInputFrameV1 {
                    sequence: 2,
                    target_tick: 0,
                    ..RuntimeInputFrameV1::default()
                }])
                .unwrap_err()
                .code,
            "input-target"
        );

        runtime.player.as_mut().unwrap().body.position.x = 15.9;
        let outcome = runtime
            .apply_primary_attack(RuntimeInputFrameV1 {
                sequence: 3,
                look_yaw: -16_384,
                buttons: RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1,
                ..RuntimeInputFrameV1::default()
            })
            .unwrap();
        assert_eq!(outcome, (RuntimeInputActionOutcomeV1::Blocked, 0));
    }

    #[test]
    fn browser_state_flags_cannot_grant_creative_flight_authority() {
        let mut runtime = runtime_with_bound_player();
        runtime.player.as_mut().unwrap().binding.creative_mode = false;
        runtime.player.as_mut().unwrap().flags = 0;
        runtime
            .accept_inputs(&[RuntimeInputFrameV1 {
                sequence: 1,
                target_tick: 1,
                flags: RUNTIME_INPUT_FLAG_CREATIVE_V1 | RUNTIME_INPUT_FLAG_FLYING_V1,
                buttons: RUNTIME_INPUT_BUTTON_CREATIVE_FLIGHT_TOGGLE_V1,
                ..RuntimeInputFrameV1::default()
            }])
            .unwrap();
        runtime.step(1_000_000, 8_000).unwrap();
        let summary = runtime.step(1_050_000, 8_000).unwrap();
        assert_eq!(summary.action_receipts.len(), 1);
        assert_eq!(
            summary.action_receipts[0].outcome,
            RuntimeInputActionOutcomeV1::Ineligible
        );
        assert_eq!(summary.action_receipts[0].authoritative_flags, 0);
        assert_eq!(runtime.player().unwrap().flags, 0);
    }

    #[test]
    fn persistence_dispatcher_owns_tokens_completion_and_recovery_shell_state() {
        let mut runtime = runtime_with_section();
        let receipt = runtime
            .dispatch_persistence(RuntimePersistenceDispatchWireV1::Estimate {
                world_id: "world:runtime".into(),
            })
            .unwrap();
        assert_eq!(receipt.request_id, Some(1));
        assert_eq!(receipt.pending, 1);
        let packet = runtime
            .poll_persistence_platform(INTEGRATED_RUNTIME_PERSISTENCE_MAX_PACKET_BYTES)
            .unwrap()
            .unwrap();
        assert_eq!(packet.request_id, 1);
        let request = blockwild_persistence::decode_persistence_platform_request_v1(&packet.bytes).unwrap();
        let response = blockwild_persistence::encode_persistence_platform_response_v1(
            &blockwild_persistence::PersistencePlatformResponseV1 {
                request_id: request.request_id,
                operation: request.operation,
                code: blockwild_persistence::PersistencePlatformResultCodeV1::Accepted,
                storage_revision: 9,
                durable_hash: CanonicalHash([7; 16]),
                next_cursor: None,
                payload: Vec::new(),
                message: "estimated".into(),
            },
        )
        .unwrap();
        let in_flight_hash = runtime.persistence_dispatcher().state_hash();
        let in_flight_checkpoint = runtime.persistence_dispatcher_checkpoint().unwrap();
        runtime.shutdown();
        let mut restored = runtime_with_section();
        restored
            .restore_persistence_dispatcher_checkpoint(&in_flight_checkpoint)
            .unwrap();
        assert_eq!(restored.persistence_dispatcher().state_hash(), in_flight_hash);
        let outcome = restored
            .complete_persistence_platform(packet.transfer_token, &response)
            .unwrap();
        assert_eq!(
            outcome.status,
            blockwild_persistence::PersistenceDispatchStatusV1::Accepted
        );
        assert!(restored.persistence_dispatcher().is_idle());
        let checkpoint = restored.persistence_dispatcher_checkpoint().unwrap();
        let mut second_restore = runtime_with_section();
        second_restore
            .restore_persistence_dispatcher_checkpoint(&checkpoint)
            .unwrap();
        assert_eq!(
            second_restore.persistence_dispatcher().state_hash(),
            restored.persistence_dispatcher().state_hash(),
        );
        second_restore
            .dispatch_persistence(RuntimePersistenceDispatchWireV1::Close)
            .unwrap();
        assert!(second_restore.persistence_dispatcher().is_closed());
    }

    #[test]
    fn compatibility_save_staging_is_bounded_idempotent_and_cancellable() {
        let mut runtime = runtime_with_section();
        let first = vec![0x80, 0xff, 0, 0x7f];
        let staged = runtime
            .stage_compatibility_save_chunk("sävë-一-🌿", 0, 2, 7, &first)
            .unwrap();
        assert_eq!(staged.received_chunks, 1);
        let identity_after_first = runtime.identity();
        assert_eq!(
            runtime
                .stage_compatibility_save_chunk("sävë-一-🌿", 0, 2, 7, &first)
                .unwrap(),
            staged,
            "an identical retry is idempotent",
        );
        assert_eq!(runtime.identity(), identity_after_first);
        let conflict = runtime
            .stage_compatibility_save_chunk("sävë-一-🌿", 0, 2, 7, &[0x80, 0xfe, 0, 0x7f])
            .unwrap_err();
        assert_eq!(conflict.code, "save-stage-conflict");
        assert_eq!(runtime.identity(), identity_after_first);
        let second_stage = runtime
            .stage_compatibility_save_chunk("another", 0, 1, 1, &[1])
            .unwrap_err();
        assert_eq!(second_stage.code, "save-stage-capacity");
        let cancelled = runtime.cancel_compatibility_save_stage("sävë-一-🌿").unwrap();
        assert_eq!(cancelled.received_chunks, 1);
        assert_eq!(
            runtime.cancel_compatibility_save_stage("sävë-一-🌿").unwrap_err().code,
            "save-stage-stale",
        );
        runtime
            .stage_compatibility_save_chunk("after-cancel", 0, 1, 2, &[1, 2])
            .unwrap();
        runtime.shutdown();
        assert_eq!(
            runtime
                .cancel_compatibility_save_stage("after-cancel")
                .unwrap_err()
                .code,
            "engine-stopped",
            "forced close makes every staged generation terminal",
        );
    }

    #[test]
    fn durable_receipt_alone_advances_persistence_and_racing_dirty_save_survives() {
        let mut runtime = runtime_with_section();
        runtime
            .stage_compatibility_save_chunk("first", 0, 1, 4, &[0x80, 0xff, 1, 2])
            .unwrap();
        let finalized = runtime.finalize_compatibility_save("first", 10).unwrap();
        assert_eq!(finalized.dispatcher_request_id, Some(1));
        assert_eq!(runtime.persistence_authority().persistence_revision(), 0);
        assert!(runtime.persistence_authority().diagnostics().commit_in_flight);

        runtime
            .stage_compatibility_save_chunk("racing", 0, 1, 4, &[0x80, 0xff, 9, 2])
            .unwrap();
        let racing = runtime.finalize_compatibility_save("racing", 11).unwrap();
        assert_eq!(racing.dispatcher_request_id, None);
        assert!(racing.remaining_dirty_records > 0);

        accept_next_authority_commit(&mut runtime);
        assert_eq!(runtime.persistence_authority().persistence_revision(), 1);
        assert!(
            !runtime.persistence_authority().dirty_records().is_empty(),
            "dirty signatures changed during the in-flight commit and must remain queued",
        );
        assert!(runtime.persistence_authority().diagnostics().commit_in_flight);
        assert_eq!(runtime.persistence_dispatcher().diagnostics().queued, 1);
    }

    #[test]
    fn runtime_checkpoint_round_trip_restores_exact_authority_replay_and_extensions() {
        let mut source = runtime_with_bound_player();
        source.native_world_extension_bytes = vec![0xff, 1, 0x80, 0];
        source.native_runtime_extension_bytes = vec![0, 0x80, 0xff, 7];
        source.native_content_extension_bytes = vec![0xff, 0x80, 0];
        source.native_gameplay_extension_bytes = vec![0x80, 0, 0xff];
        let expected_identity = source.identity();
        let expected_replay = source.replay_hash();
        let checkpoint = source.export_runtime_checkpoint().unwrap();
        let checkpoint_hash = integrated_runtime_checkpoint_hash_v1(&checkpoint);

        source.shutdown();
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(&checkpoint, checkpoint_hash).unwrap();
        assert_eq!(restored.identity(), expected_identity);
        assert_eq!(restored.replay_hash(), expected_replay);
        assert_eq!(restored.native_world_extension_bytes, vec![0xff, 1, 0x80, 0]);
        assert_eq!(restored.native_runtime_extension_bytes, vec![0, 0x80, 0xff, 7]);
        assert_eq!(restored.native_content_extension_bytes, vec![0xff, 0x80, 0]);
        assert_eq!(restored.native_gameplay_extension_bytes, vec![0x80, 0, 0xff]);
        assert_eq!(restored.player(), source.player());

        let before = restored.identity();
        let mut corrupt = checkpoint.clone();
        let middle = corrupt.len() / 2;
        corrupt[middle] ^= 0x5a;
        assert_eq!(
            IntegratedRuntimeV2::restore_runtime_checkpoint(&corrupt, checkpoint_hash)
                .err()
                .expect("corrupt checkpoint rejects")
                .code,
            "checkpoint-hash"
        );
        assert_eq!(restored.identity(), before);
    }

    #[test]
    fn durable_native_save_checkpoint_destroy_and_fresh_restore_are_exact() {
        let mut source = runtime_with_bound_player();
        let legacy_bytes = b"legacy-world-source-backup\x00\x80\xff";
        source
            .stage_compatibility_save_chunk("durable", 0, 1, legacy_bytes.len() as u64, legacy_bytes)
            .unwrap();
        source.finalize_compatibility_save("durable", 70).unwrap();
        accept_all_authority_commits(&mut source);

        let expected_identity = source.identity();
        let expected_replay = source.replay_hash();
        let expected_authority = source.persistence_authority().state_hash();
        let expected_head = source
            .persistence_authority()
            .checkpoint()
            .expect("durable native checkpoint")
            .checkpoint_hash;
        let checkpoint = source.export_runtime_checkpoint().unwrap();
        let checkpoint_hash = integrated_runtime_checkpoint_hash_v1(&checkpoint);
        source.shutdown();

        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(&checkpoint, checkpoint_hash).unwrap();
        assert_eq!(restored.identity(), expected_identity);
        assert_eq!(restored.replay_hash(), expected_replay);
        assert_eq!(restored.persistence_authority().state_hash(), expected_authority);
        assert_eq!(
            restored
                .persistence_authority()
                .checkpoint()
                .expect("restored durable head")
                .checkpoint_hash,
            expected_head,
        );
    }

    #[test]
    fn durable_native_hydration_rebinds_only_session_and_preserves_authority_proofs() {
        let source_config = IntegratedRuntimeConfigV2 {
            world_seed: "durable-session-rebind-world".into(),
            session_id: "durable-session-a".into(),
            ..IntegratedRuntimeConfigV2::default()
        };
        let mut source = runtime_with_bound_player_config(source_config.clone());
        source.native_world_extension_bytes = vec![0x80, 1, 0xff];
        source.native_runtime_extension_bytes = vec![0xff, 2, 0x80];
        source.native_gameplay_extension_bytes = vec![3, 0x80, 0xff];
        source.native_world_view_extension_bytes = vec![0, 4, 0xff];
        let edit_position = CellPositionV1 { x: 2, y: 1, z: 2 };
        let mut edit = IntegratedRuntimeBatchV2::empty("durable-rebind-edit", source.identity());
        edit.world.push(WorldMutationBatchR4V1 {
            schema_version: blockwild_authority::WORLD_AUTHORITY_SCHEMA_V1,
            batch_id: "durable-rebind-edit".into(),
            authority_id: "fixture".into(),
            address: source.world().active_address().clone(),
            expected_revision: source.world().revision(),
            commands: vec![blockwild_authority::WorldMutationCommandR4V1::SetBlock {
                position: edit_position,
                block_id: 1,
                facing: None,
            }],
        });
        assert!(source.commit(edit).accepted());
        source.finalize_native_save("session-a-save", 101).unwrap();
        accept_all_authority_commits(&mut source);
        let recovered = recovered_authority_save(&source);

        let expected_world = source.world().canonical_state_hash();
        let expected_entities = source.entities().canonical_hash();
        let expected_gameplay = source.gameplay().state.state_hash();
        let expected_world_view = source.world_view().state.state_hash();
        let expected_journal = source.persistence().state_hash();
        let expected_authority = source.persistence_authority().state_hash();
        let expected_player = source.player().cloned();
        let expected_replay = source.replay_hash();

        let mut target_config = source_config;
        target_config.session_id = "durable-session-b".into();
        let mut target = IntegratedRuntimeV2::new(target_config).unwrap();
        target.recovered_save_sets.insert("session-rebind".into(), recovered);
        target.hydrate_recovery("session-rebind").unwrap();

        assert_eq!(target.config.session_id, "durable-session-b");
        assert_eq!(target.world().canonical_state_hash(), expected_world);
        assert_eq!(target.entities().canonical_hash(), expected_entities);
        assert_eq!(target.gameplay().state.state_hash(), expected_gameplay);
        assert_eq!(target.world_view().state.state_hash(), expected_world_view);
        assert_eq!(target.persistence().state_hash(), expected_journal);
        assert_eq!(target.persistence_authority().state_hash(), expected_authority);
        assert_eq!(target.player(), expected_player.as_ref());
        assert_eq!(target.replay_hash(), expected_replay);
        assert_eq!(target.native_world_extension_bytes, vec![0x80, 1, 0xff]);
        assert_eq!(target.native_runtime_extension_bytes, vec![0xff, 2, 0x80]);
        assert_eq!(target.native_gameplay_extension_bytes, vec![3, 0x80, 0xff]);
        assert_eq!(target.native_world_view_extension_bytes, vec![0, 4, 0xff]);
        assert!(target.durable_network_state_pristine);
        assert_eq!(target.replication.record_count(), 0);
        assert!(target.replication_record_hashes.is_empty());
        assert_eq!(
            target.network.authority_fingerprint(),
            NetworkBrowserAuthorityRuntimeV1::new("durable-session-b".into())
                .unwrap()
                .authority_fingerprint(),
        );

        let expected_control_identity = source.identity();
        let control = source.export_runtime_checkpoint().unwrap();
        let control_restored =
            IntegratedRuntimeV2::restore_runtime_checkpoint(&control, integrated_runtime_checkpoint_hash_v1(&control))
                .unwrap();
        assert_eq!(control_restored.config.session_id, "durable-session-a");
        assert_eq!(control_restored.identity(), expected_control_identity);
    }

    #[test]
    fn durable_session_rebind_rejects_every_immutable_config_mismatch_atomically() {
        let source_config = IntegratedRuntimeConfigV2 {
            world_seed: "durable-mismatch-source".into(),
            session_id: "durable-mismatch-a".into(),
            content_hash: CanonicalHash([0x11; 16]),
            generator_hash: CanonicalHash([0x22; 16]),
            ..IntegratedRuntimeConfigV2::default()
        };
        let mut source = runtime_with_section_config(source_config.clone());
        source.finalize_native_save("mismatch-source", 102).unwrap();
        accept_all_authority_commits(&mut source);
        let recovered = recovered_authority_save(&source);

        let mut base = source_config;
        base.session_id = "durable-mismatch-b".into();
        let mut cases = Vec::new();
        let mut seed = base.clone();
        seed.world_seed = "different-seed".into();
        cases.push(("seed", seed, "recovery-config"));
        let mut terrain = base.clone();
        terrain.terrain_content_hash = CanonicalHash([0x33; 16]);
        cases.push(("terrain", terrain, "recovery-config"));
        let mut options = base.clone();
        options.generation_options_json = options
            .generation_options_json
            .replace("\"biomeScale\":1.35", "\"biomeScale\":1.25");
        cases.push(("options", options, "recovery-config"));
        let mut catalog = base.clone();
        catalog.block_catalog.water_block_id = catalog.block_catalog.water_block_id.saturating_add(1);
        cases.push(("catalog", catalog, "recovery-config"));
        let mut content = base.clone();
        content.content_hash = CanonicalHash([0x44; 16]);
        cases.push(("content", content, "recovery-fingerprint"));
        let mut generator = base.clone();
        generator.generator_hash = CanonicalHash([0x55; 16]);
        cases.push(("generator", generator, "recovery-fingerprint"));
        let mut address = base;
        address.location_id = "different-location".into();
        cases.push(("address", address, "recovery-fingerprint"));

        for (label, config, expected_code) in cases {
            let mut target = IntegratedRuntimeV2::new(config).unwrap();
            target.recovered_save_sets.insert(label.into(), recovered.clone());
            let before = target.identity();
            assert_eq!(
                target.hydrate_recovery(label).unwrap_err().code,
                expected_code,
                "{label}"
            );
            assert_eq!(target.identity(), before, "{label}");
            assert!(target.recovered_save_sets.contains_key(label), "{label}");
        }
    }

    #[test]
    fn legacy_durable_core_requires_exact_session_and_v5_proofs_are_all_or_nothing() {
        let source_config = IntegratedRuntimeConfigV2 {
            world_seed: "legacy-durable-session".into(),
            session_id: "legacy-durable-session-a".into(),
            ..IntegratedRuntimeConfigV2::default()
        };
        let mut source = runtime_with_section_config(source_config.clone());
        source.finalize_native_save("legacy-session", 104).unwrap();
        accept_all_authority_commits(&mut source);
        let mut legacy = recovered_authority_save(&source);
        rewrite_recovery_runtime_core(&mut legacy, |core| {
            core.schema = NATIVE_RUNTIME_CORE_SCHEMA_V4;
            core.durable_network_drained_proof = None;
            core.durable_state_proof = None;
            core.durable_replay_proof = None;
        });

        let mut same_session = IntegratedRuntimeV2::new(source_config.clone()).unwrap();
        same_session
            .recovered_save_sets
            .insert("legacy-same".into(), legacy.clone());
        same_session.hydrate_recovery("legacy-same").unwrap();
        assert_eq!(
            same_session.world().canonical_state_hash(),
            source.world().canonical_state_hash()
        );

        let mut other_config = source_config;
        other_config.session_id = "legacy-durable-session-b".into();
        let mut different_session = IntegratedRuntimeV2::new(other_config).unwrap();
        different_session
            .recovered_save_sets
            .insert("legacy-different".into(), legacy);
        let before = different_session.identity();
        assert_eq!(
            different_session.hydrate_recovery("legacy-different").unwrap_err().code,
            "recovery-config"
        );
        assert_eq!(different_session.identity(), before);

        let mut partial = recovered_authority_save(&source);
        rewrite_recovery_runtime_core(&mut partial, |core| {
            core.durable_network_drained_proof = None;
        });
        let mut partial_target = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
            world_seed: "legacy-durable-session".into(),
            session_id: "legacy-durable-session-c".into(),
            ..IntegratedRuntimeConfigV2::default()
        })
        .unwrap();
        partial_target.recovered_save_sets.insert("partial-v5".into(), partial);
        let before = partial_target.identity();
        assert_eq!(
            partial_target.hydrate_recovery("partial-v5").unwrap_err().code,
            "recovery-proof-incomplete"
        );
        assert_eq!(partial_target.identity(), before);
        assert!(partial_target.recovered_save_sets.contains_key("partial-v5"));
    }

    #[test]
    fn active_network_authority_cannot_emit_or_rebind_a_durable_native_save() {
        let source_config = IntegratedRuntimeConfigV2 {
            world_seed: "network-active-durable-source".into(),
            session_id: "network-active-session-a".into(),
            ..IntegratedRuntimeConfigV2::default()
        };
        let mut source = runtime_with_section_config(source_config.clone());
        activate_fixture_network_grant(&mut source);
        let before_save = source.identity();
        assert_eq!(
            source.finalize_native_save("network-active", 103).unwrap_err().code,
            "native-save-network-active"
        );
        assert_eq!(source.identity(), before_save);

        // A control-style bundle deliberately has no durable drain proof when
        // network authority has been exercised. Even if wrapped in a valid
        // persistence checkpoint, durable hydration must reject it atomically.
        let unproven = force_unattested_native_recovery(&mut source);
        let mut target_config = source_config;
        target_config.session_id = "network-active-session-b".into();
        let mut target = IntegratedRuntimeV2::new(target_config).unwrap();
        target.recovered_save_sets.insert("unproven-network".into(), unproven);
        let before_hydrate = target.identity();
        assert_eq!(
            target.hydrate_recovery("unproven-network").unwrap_err().code,
            "recovery-proof-incomplete"
        );
        assert_eq!(target.identity(), before_hydrate);
        assert!(target.recovered_save_sets.contains_key("unproven-network"));
    }

    #[test]
    fn recovery_hydration_is_atomic_and_compatibility_bytes_are_export_only() {
        let mut source = runtime_with_section();
        let position = CellPositionV1 { x: 1, y: 1, z: 1 };
        let expected = source.world().identity();
        let mut batch = IntegratedRuntimeBatchV2::empty("saved-world-edit", source.identity());
        batch.world.push(WorldMutationBatchR4V1 {
            schema_version: blockwild_authority::WORLD_AUTHORITY_SCHEMA_V1,
            batch_id: "saved-world-edit".into(),
            authority_id: "fixture".into(),
            address: expected.address,
            expected_revision: expected.revision,
            commands: vec![blockwild_authority::WorldMutationCommandR4V1::SetBlock {
                position,
                block_id: 1,
                facing: None,
            }],
        });
        assert!(source.commit(batch).accepted());
        let compatibility = "compatibility-shell-🌿".as_bytes();
        source
            .stage_compatibility_save_chunk("source", 0, 1, compatibility.len() as u64, compatibility)
            .unwrap();
        source.finalize_compatibility_save("source", 12).unwrap();
        accept_next_authority_commit(&mut source);
        let recovered = recovered_authority_save(&source);

        let recovered_legacy = recovered
            .payloads
            .iter()
            .filter(|(address, _)| {
                address.kind == RecordKind::SettingsReference
                    && address.record_id.starts_with(COMPATIBILITY_RECORD_PREFIX_V1)
            })
            .map(|(_, payload)| payload.as_slice())
            .collect::<Vec<_>>()
            .concat();
        assert_eq!(recovered_legacy, compatibility, "legacy source bytes remain exact");

        let mut target = runtime_with_section();
        assert_eq!(loaded_block_id(&target, position), 0);
        let mut mismatched = recovered.clone();
        mismatched.checkpoint.content_hash = CanonicalHash([0x44; 16]);
        target.recovered_save_sets.insert("mismatch".into(), mismatched);
        let before_mismatch = target.identity();
        assert_eq!(
            target.hydrate_recovery("mismatch").unwrap_err().code,
            "recovery-fingerprint"
        );
        assert_eq!(target.identity(), before_mismatch);
        assert_eq!(loaded_block_id(&target, position), 0);

        let mut wrong_content = recovered.clone();
        let content_address = wrong_content
            .payloads
            .keys()
            .find(|address| {
                address.kind == RecordKind::SettingsReference && address.record_id == NATIVE_CONTENT_RECORD_ID_V1
            })
            .cloned()
            .expect("content native record");
        let mut wrong_content_envelope = decode_native_record_envelope_v1(
            wrong_content
                .payloads
                .get(&content_address)
                .expect("content native record"),
        )
        .unwrap();
        wrong_content_envelope.content_hash = CanonicalHash([0x55; 16]);
        wrong_content.payloads.insert(
            content_address,
            encode_native_record_envelope_v1(&wrong_content_envelope).unwrap(),
        );
        target
            .recovered_save_sets
            .insert("wrong-content-native".into(), wrong_content);
        assert_eq!(
            target.hydrate_recovery("wrong-content-native").unwrap_err().code,
            "recovery-native-identity"
        );
        assert_eq!(target.identity(), before_mismatch);

        let mut missing = recovered.clone();
        let missing_address = missing
            .payloads
            .keys()
            .find(|address| address.kind == RecordKind::Entity && address.record_id == NATIVE_ENTITY_RECORD_ID_V2)
            .cloned()
            .expect("entity native record");
        missing.payloads.remove(&missing_address);
        target.recovered_save_sets.insert("missing-native".into(), missing);
        assert_eq!(
            target.hydrate_recovery("missing-native").unwrap_err().code,
            "recovery-native-missing"
        );
        assert_eq!(target.identity(), before_mismatch);

        let mut duplicate = recovered.clone();
        let duplicate_payload = duplicate
            .payloads
            .get(&missing_address)
            .expect("entity native record")
            .clone();
        let duplicate_address = RecordAddress::new(
            target.config.universe_id.clone(),
            target.config.location_id.clone(),
            RecordKind::SettingsReference,
            "duplicate-native-envelope",
        )
        .unwrap();
        duplicate.payloads.insert(duplicate_address, duplicate_payload);
        target.recovered_save_sets.insert("duplicate-native".into(), duplicate);
        assert_eq!(
            target.hydrate_recovery("duplicate-native").unwrap_err().code,
            "recovery-native-duplicate"
        );
        assert_eq!(target.identity(), before_mismatch);

        target.recovered_save_sets.insert("ready".into(), recovered);
        let summary = target.hydrate_recovery("ready").unwrap();
        assert_eq!(summary.native_domains, INTEGRATED_RUNTIME_NATIVE_DOMAIN_COUNT_V1);
        assert_eq!(
            target.world().edit_journal().get(&position).map(|cell| cell.block_id),
            Some(1)
        );
        let chunk = target.read_hydrated_compatibility_chunk("ready", 0).unwrap();
        assert_eq!(chunk.bytes, compatibility);
        assert_eq!(chunk.chunk_count, 1);
        assert_eq!(
            target.read_hydrated_compatibility_chunk("missing", 0).unwrap_err().code,
            "hydration-export",
        );
    }

    #[test]
    fn new_world_native_save_initializes_without_a_legacy_source_and_cannot_drop_one_later() {
        let mut native = runtime_with_section();
        let expected_world = native.world().canonical_state_hash();
        let progress = native.finalize_native_save("new-world", 88).unwrap();
        assert_eq!(progress.chunk_count, 0);
        assert_eq!(progress.received_bytes, 0);
        accept_all_authority_commits(&mut native);
        let recovered = recovered_authority_save(&native);
        let manifest_payload = recovered
            .payloads
            .iter()
            .find(|(address, _)| {
                address.kind == RecordKind::LocationManifest && address.record_id == WORLD_SAVE_MANIFEST_RECORD_ID_V1
            })
            .map(|(_, payload)| payload)
            .expect("native save manifest");
        let manifest = decode_world_save_manifest_v1(manifest_payload).unwrap();
        assert_eq!(manifest.compatibility_chunks, 0);
        assert_eq!(manifest.compatibility_byte_length, 0);

        let mut restored = runtime_with_section();
        restored.recovered_save_sets.insert("native".into(), recovered);
        let summary = restored.hydrate_recovery("native").unwrap();
        assert_eq!(summary.chunk_count, 0);
        assert_eq!(restored.world().canonical_state_hash(), expected_world);
        restored.finalize_native_save("second-native-save", 89).unwrap();

        let mut legacy_owned = runtime_with_section();
        legacy_owned
            .stage_compatibility_save_chunk("legacy", 0, 1, 3, b"old")
            .unwrap();
        legacy_owned.finalize_compatibility_save("legacy", 90).unwrap();
        accept_all_authority_commits(&mut legacy_owned);
        let before = legacy_owned.identity();
        assert_eq!(
            legacy_owned
                .finalize_native_save("must-not-drop-source", 91)
                .unwrap_err()
                .code,
            "native-save-compatibility-owner"
        );
        assert_eq!(legacy_owned.identity(), before);
    }

    #[test]
    fn pristine_world_only_legacy_migration_builds_all_native_records_and_preserves_source() {
        let mut legacy_projection_source = runtime_with_section();
        let position = CellPositionV1 { x: 2, y: 1, z: 2 };
        let identity = legacy_projection_source.world().identity();
        let mut edit = IntegratedRuntimeBatchV2::empty("legacy-edit", legacy_projection_source.identity());
        edit.world.push(WorldMutationBatchR4V1 {
            schema_version: blockwild_authority::WORLD_AUTHORITY_SCHEMA_V1,
            batch_id: "legacy-edit".into(),
            authority_id: "legacy".into(),
            address: identity.address,
            expected_revision: identity.revision,
            commands: vec![blockwild_authority::WorldMutationCommandR4V1::SetBlock {
                position,
                block_id: 1,
                facing: None,
            }],
        });
        assert!(legacy_projection_source.commit(edit).accepted());
        let projection = blockwild_authority::encode_compatibility_save_binary_v1(
            &legacy_projection_source.world().export_compatibility_save(),
        )
        .unwrap();
        let source_backup = br#"{"schema":6,"blocks":{"2,1,2":1},"legacy":"exact"}"#;

        let mut target = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        target
            .stage_compatibility_save_chunk("legacy-source", 0, 1, source_backup.len() as u64, source_backup)
            .unwrap();
        let before_blocker = target.identity();
        let blocked = target
            .migrate_pristine_legacy_world(IntegratedRuntimeLegacyMigrationV1 {
                schema_version: INTEGRATED_RUNTIME_LEGACY_MIGRATION_SCHEMA_V1,
                migration_id: "legacy-migration".into(),
                source_stage_id: "legacy-source".into(),
                created_at: 90,
                legacy_non_world_state_flags: LEGACY_STATE_PLAYER_V1 | LEGACY_STATE_MACHINES_V1,
                world_projection: projection.clone(),
            })
            .unwrap_err();
        assert_eq!(blocked.code, "legacy-migration-rich-save");
        assert!(blocked.message.contains("player"));
        assert!(blocked.message.contains("machines"));
        assert_eq!(target.identity(), before_blocker);

        let progress = target
            .migrate_pristine_legacy_world(IntegratedRuntimeLegacyMigrationV1 {
                schema_version: INTEGRATED_RUNTIME_LEGACY_MIGRATION_SCHEMA_V1,
                migration_id: "legacy-migration".into(),
                source_stage_id: "legacy-source".into(),
                created_at: 90,
                legacy_non_world_state_flags: 0,
                world_projection: projection,
            })
            .unwrap();
        assert!(progress.dispatcher_request_id.is_some());
        let migrated_world_hash = target.world().canonical_state_hash();
        assert_eq!(
            target.world().edit_journal().get(&position).map(|cell| cell.block_id),
            Some(1)
        );
        accept_all_authority_commits(&mut target);
        let recovered = recovered_authority_save(&target);
        for kind in IntegratedRuntimeNativeRecordKindV1::ALL {
            let (record_kind, record_id) = kind.address();
            assert!(
                recovered
                    .payloads
                    .keys()
                    .any(|address| address.kind == record_kind && address.record_id == record_id)
            );
        }
        let preserved_source = recovered
            .payloads
            .iter()
            .filter(|(address, _)| {
                address.kind == RecordKind::SettingsReference
                    && address.record_id.starts_with(COMPATIBILITY_RECORD_PREFIX_V1)
            })
            .map(|(_, payload)| payload.as_slice())
            .collect::<Vec<_>>()
            .concat();
        assert_eq!(preserved_source, source_backup);

        let mut restored = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        restored.recovered_save_sets.insert("migrated".into(), recovered);
        restored.hydrate_recovery("migrated").unwrap();
        assert_eq!(restored.world().canonical_state_hash(), migrated_world_hash);
        assert_eq!(
            restored.world().edit_journal().get(&position).map(|cell| cell.block_id),
            Some(1)
        );
    }

    #[test]
    fn large_compatibility_stream_stages_in_order_and_commits_without_copy_loss() {
        let mut runtime = runtime_with_section();
        let first = vec![0x80; RUNTIME_BULK_SAVE_CHUNK_BYTES_V1];
        let second = vec![0x5a; RUNTIME_BULK_SAVE_CHUNK_BYTES_V1];
        let third = vec![0xff; 17];
        let total = first.len() + second.len() + third.len();
        runtime
            .stage_compatibility_save_chunk("large", 0, 3, total as u64, &first)
            .unwrap();
        runtime
            .stage_compatibility_save_chunk("large", 1, 3, total as u64, &second)
            .unwrap();
        let progress = runtime
            .stage_compatibility_save_chunk("large", 2, 3, total as u64, &third)
            .unwrap();
        assert_eq!(progress.received_bytes, total as u64);
        runtime.finalize_compatibility_save("large", 71).unwrap();
        accept_all_authority_commits(&mut runtime);
        let recovered = recovered_authority_save(&runtime);
        let restored_stream = recovered
            .payloads
            .iter()
            .filter(|(address, _)| {
                address.kind == RecordKind::SettingsReference
                    && address.record_id.starts_with(COMPATIBILITY_RECORD_PREFIX_V1)
            })
            .map(|(_, payload)| payload.as_slice())
            .collect::<Vec<_>>()
            .concat();
        assert_eq!(restored_stream.len(), total);
        assert_eq!(&restored_stream[..first.len()], first.as_slice());
        assert_eq!(
            &restored_stream[first.len()..first.len() + second.len()],
            second.as_slice()
        );
        assert_eq!(&restored_stream[first.len() + second.len()..], third.as_slice());
        assert_eq!(
            runtime.export_runtime_checkpoint().unwrap_err().code,
            "checkpoint-control-capacity",
            "large saves remain durable but cannot overflow the synchronous Worker control lane",
        );
    }

    #[test]
    fn cross_domain_batch_is_atomic_on_rejection() {
        let mut runtime = runtime_with_section();
        let before = runtime.identity();
        let mut batch = IntegratedRuntimeBatchV2::empty("atomic-reject", before.clone());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 1,
            commands: vec![EntityCommand::Spawn {
                record: EntityCompatibilityRecord::new("mob:1", "specimen:1", "frostquill"),
                residency: EntityResidency::Hot,
            }],
        });
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 2,
            expected_revision: 99,
            tick: 1,
            commands: Vec::new(),
        });
        let receipt = runtime.commit(batch);
        assert!(!receipt.accepted());
        assert_eq!(runtime.identity(), before);
        assert!(runtime.entities().is_empty());
    }

    #[test]
    fn accepted_entity_batch_advances_root_and_replay() {
        let mut runtime = runtime_with_section();
        let before = runtime.identity();
        let mut batch = IntegratedRuntimeBatchV2::empty("spawn", before.clone());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 1,
            commands: vec![EntityCommand::Spawn {
                record: EntityCompatibilityRecord::new("mob:1", "specimen:1", "frostquill"),
                residency: EntityResidency::Hot,
            }],
        });
        let receipt = runtime.commit(batch);
        assert!(receipt.accepted());
        assert_eq!(runtime.entities().len(), 1);
        assert_ne!(runtime.state_hash(), before.state_hash);
        assert_ne!(runtime.replay_hash(), CanonicalHash::default());
    }

    #[test]
    fn wire_reliability_returns_cached_receipt_without_reapplying_and_rejects_conflicts() {
        let mut runtime = runtime_with_section();
        let before = runtime.identity();
        let mut batch = IntegratedRuntimeBatchV2::empty("reliable-spawn", before).with_reliability(
            "player-one",
            "spawn:1",
            [0x80, 0xff, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        );
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 1,
            commands: vec![EntityCommand::Spawn {
                record: EntityCompatibilityRecord::new("mob:reliable", "specimen:reliable", "frostquill"),
                residency: EntityResidency::Hot,
            }],
        });
        let retry = batch.clone();
        assert!(runtime.commit(batch).accepted());
        let after = runtime.identity();
        let replay = runtime.replay_hash();
        assert!(runtime.commit(retry.clone()).accepted());
        assert_eq!(runtime.identity(), after);
        assert_eq!(runtime.replay_hash(), replay);
        assert_eq!(runtime.entities().len(), 1);

        let mut conflict = retry;
        conflict.reliability.as_mut().expect("reliability").command_hash[0] ^= 0xff;
        let receipt = runtime.commit(conflict);
        let IntegratedRuntimeReceiptV2::Rejected(rejection) = receipt else {
            panic!("conflicting command bytes must reject")
        };
        assert_eq!(rejection.code, "idempotency-conflict");
        assert_eq!(runtime.identity(), after);
    }

    #[test]
    fn stale_batch_is_rejected_without_mutation() {
        let mut runtime = runtime_with_section();
        let stale = runtime.identity();
        runtime.step(1_000_000, 1_000).unwrap();
        runtime.step(1_050_000, 1_000).unwrap();
        let mut batch = IntegratedRuntimeBatchV2::empty("stale", stale);
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 1,
            commands: Vec::new(),
        });
        assert!(!runtime.commit(batch).accepted());
        assert!(runtime.entities().is_empty());
    }

    #[test]
    fn read_page_converts_to_current_simulation_window() {
        let runtime = runtime_with_section();
        let window = runtime
            .capture_simulation_window(ReadOriginV1 { x: 0, y: 0, z: 0 }, ReadSizeV1 { x: 4, y: 4, z: 4 })
            .unwrap();
        assert_eq!(window.identity, runtime.simulation_identity().unwrap());
        assert_eq!(window.blocks.len(), 64);
        window.validate().unwrap();
    }

    #[test]
    fn shutdown_clears_work_and_is_terminal() {
        let mut runtime = runtime_with_section();
        let mut batch = IntegratedRuntimeBatchV2::empty("queued", runtime.identity());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 1,
            commands: Vec::new(),
        });
        runtime.enqueue(batch).unwrap();
        runtime.shutdown();
        assert!(runtime.is_stopped());
        assert!(runtime.step(1, 1).is_err());
        assert!(runtime.take_receipts().is_empty());
    }

    #[test]
    fn world_edit_journal_changes_root_hash() {
        let mut runtime = runtime_with_section();
        let before = runtime.state_hash();
        let position = CellPositionV1 { x: 1, y: 0, z: 1 };
        let expected = runtime.world().identity();
        let batch = WorldMutationBatchR4V1 {
            schema_version: blockwild_authority::WORLD_AUTHORITY_SCHEMA_V1,
            batch_id: "world-edit".into(),
            authority_id: "player:1".into(),
            address: expected.address.clone(),
            expected_revision: expected.revision,
            commands: vec![blockwild_authority::WorldMutationCommandR4V1::SetBlock {
                position,
                block_id: 1,
                facing: None,
            }],
        };
        let mut integrated = IntegratedRuntimeBatchV2::empty("integrated-edit", runtime.identity());
        integrated.world.push(batch);
        assert!(runtime.commit(integrated).accepted());
        assert_ne!(runtime.state_hash(), before);
        assert_eq!(runtime.world().edit_journal().get(&position).unwrap().block_id, 1);
    }

    #[test]
    fn generated_chunk_installs_all_authority_and_auxiliary_streams_atomically() {
        let mut request = blockwild_generation::fixture_request("integrated-generation", 0, 0, 1);
        request.generation_options_json = DEFAULT_GENERATION_OPTIONS_JSON_V1.into();
        request.namespace = format!(
            "terrain-v5|g{GENERATOR_VERSION}|{}|{}|0,0|0.0.0.0.0.0.0.0.0",
            request.seed_text, request.generation_options_json
        );
        request.request_hash = request.canonical_hash().to_hex();
        let mut config = IntegratedRuntimeConfigV2 {
            world_seed: request.seed_text.clone(),
            terrain_content_hash: parse_canonical_hash(&request.content_hash).unwrap(),
            generation_options_json: request.generation_options_json.clone(),
            generator_hash: parse_canonical_hash(&request.generator_hash).unwrap(),
            ..IntegratedRuntimeConfigV2::default()
        };
        config.block_catalog.water_block_id = GeneratedBlock::WATER;
        let mut runtime = IntegratedRuntimeV2::new(config).unwrap();
        let before = runtime.state_hash();
        let installed = runtime.generate_and_install_chunk(&request).unwrap();
        assert_eq!(installed.sections_installed, 12);
        assert_ne!(installed.state_hash, before);
        assert_eq!(runtime.world().resident_section_count(), 12);
        let auxiliary = runtime
            .world()
            .chunk_auxiliary(&AuthorityChunkAddressV1 {
                world: runtime.world().active_address().clone(),
                chunk_x: 0,
                chunk_z: 0,
            })
            .expect("chunk auxiliary data");
        assert_eq!(auxiliary.heightmap.len(), 256);
        assert_eq!(auxiliary.light.len(), 49_152);
        assert_eq!(runtime.generation_diagnostics().completed, 1);
    }

    #[test]
    fn terrain_residency_batch_is_atomic_deterministic_and_idempotent() {
        let fixture = blockwild_generation::fixture_request("integrated-residency", 0, 0, 1);
        let mut config = IntegratedRuntimeConfigV2 {
            world_seed: fixture.seed_text,
            terrain_content_hash: parse_canonical_hash(&fixture.content_hash).unwrap(),
            generator_hash: parse_canonical_hash(&fixture.generator_hash).unwrap(),
            ..IntegratedRuntimeConfigV2::default()
        };
        config.block_catalog.water_block_id = GeneratedBlock::WATER;
        let mut runtime = IntegratedRuntimeV2::new(config.clone()).unwrap();
        let batch = IntegratedTerrainResidencyBatchV1 {
            expected_world_revision: runtime.world().revision(),
            generation_options_json: config.generation_options_json.clone(),
            chunks: vec![
                IntegratedTerrainChunkCoordinateV1 {
                    chunk_x: -1,
                    chunk_z: 0,
                },
                IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 },
            ],
        };
        let first = runtime.ensure_terrain_residency(&batch).unwrap();
        assert_eq!(first.generated_chunks, 2);
        assert_eq!(first.already_resident_chunks, 0);
        assert_eq!(first.resident_sections, 24);
        assert_eq!(runtime.world().resident_section_count(), 24);
        let state_after_first = runtime.state_hash();
        let revision_after_first = runtime.world().revision();

        let repeat = IntegratedTerrainResidencyBatchV1 {
            expected_world_revision: revision_after_first,
            ..batch.clone()
        };
        let second = runtime.ensure_terrain_residency(&repeat).unwrap();
        assert_eq!(second.generated_chunks, 0);
        assert_eq!(second.already_resident_chunks, 2);
        assert_eq!(second.world_revision, revision_after_first);
        assert_eq!(runtime.state_hash(), state_after_first);

        let mut independent = IntegratedRuntimeV2::new(config).unwrap();
        let independently_generated = independent.ensure_terrain_residency(&batch).unwrap();
        assert_eq!(independently_generated.chunks, first.chunks);
        assert_eq!(
            independent.world().canonical_state_hash(),
            runtime.world().canonical_state_hash()
        );

        let pristine_neighbor_namespace = second.chunks[0].namespace_hash;
        let edited_position = CellPositionV1 { x: 1, y: 100, z: 1 };
        let world_mutation = WorldMutationBatchR4V1 {
            schema_version: blockwild_authority::WORLD_AUTHORITY_SCHEMA_V1,
            batch_id: "terrain-residency-local-edit".into(),
            authority_id: "player:terrain-test".into(),
            address: runtime.world().active_address().clone(),
            expected_revision: runtime.world().revision(),
            commands: vec![blockwild_authority::WorldMutationCommandR4V1::SetBlock {
                position: edited_position,
                block_id: 254,
                facing: None,
            }],
        };
        let mut root = IntegratedRuntimeBatchV2::empty("terrain-residency-local-edit", runtime.identity());
        root.world.push(world_mutation);
        assert!(runtime.commit(root).accepted());

        let edit_receipt = runtime
            .ensure_terrain_residency(&IntegratedTerrainResidencyBatchV1 {
                expected_world_revision: runtime.world().revision(),
                ..batch
            })
            .unwrap();
        assert_eq!(
            edit_receipt.generated_chunks, 2,
            "the edited chunk and its halo neighbor regenerate"
        );
        assert_eq!(edit_receipt.chunks[0].edit_count, 0);
        assert_eq!(edit_receipt.chunks[1].edit_count, 1);
        assert_ne!(edit_receipt.chunks[0].namespace_hash, pristine_neighbor_namespace);
        let WorldCellReadV1::Loaded { cell, .. } = runtime.world().read_cell(edited_position) else {
            panic!("regenerated edited cell must remain resident")
        };
        assert_eq!(
            cell.block_id, 254,
            "the exact authority edit journal wins over generated bytes"
        );
    }

    #[test]
    fn terrain_residency_rejection_rolls_back_every_chunk() {
        let fixture = blockwild_generation::fixture_request("integrated-residency-rollback", 0, 0, 1);
        let mut config = IntegratedRuntimeConfigV2 {
            world_seed: fixture.seed_text,
            terrain_content_hash: parse_canonical_hash(&fixture.content_hash).unwrap(),
            generator_hash: parse_canonical_hash(&fixture.generator_hash).unwrap(),
            ..IntegratedRuntimeConfigV2::default()
        };
        config.block_catalog.water_block_id = GeneratedBlock::WATER;
        let mut runtime = IntegratedRuntimeV2::new(config).unwrap();
        let before_hash = runtime.state_hash();
        let before_revision = runtime.world().revision();
        let before_generation_diagnostics = runtime.generation_diagnostics();
        let invalid = IntegratedTerrainResidencyBatchV1 {
            expected_world_revision: before_revision,
            generation_options_json: runtime.config().generation_options_json.clone(),
            chunks: vec![
                IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 },
                IntegratedTerrainChunkCoordinateV1 {
                    chunk_x: i32::MAX,
                    chunk_z: 0,
                },
            ],
        };
        assert_eq!(
            runtime.ensure_terrain_residency(&invalid).unwrap_err().code,
            "terrain-residency-coordinate"
        );
        assert_eq!(runtime.world().resident_section_count(), 0);
        assert_eq!(runtime.world().revision(), before_revision);
        assert_eq!(runtime.state_hash(), before_hash);
        assert_eq!(runtime.generation_diagnostics(), before_generation_diagnostics);

        let different_options = IntegratedTerrainResidencyBatchV1 {
            expected_world_revision: before_revision,
            generation_options_json: runtime
                .config()
                .generation_options_json
                .replace("\"structures\":true", "\"structures\":false"),
            chunks: vec![IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 }],
        };
        assert_eq!(
            runtime.ensure_terrain_residency(&different_options).unwrap_err().code,
            "terrain-generation-options"
        );
        assert_eq!(runtime.state_hash(), before_hash);
        assert_eq!(runtime.generation_diagnostics(), before_generation_diagnostics);

        let stale = IntegratedTerrainResidencyBatchV1 {
            expected_world_revision: WorldAuthorityRevisionV1 {
                residency: before_revision.residency.saturating_add(1),
                ..before_revision
            },
            generation_options_json: runtime.config().generation_options_json.clone(),
            chunks: vec![IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 }],
        };
        assert_eq!(
            runtime.ensure_terrain_residency(&stale).unwrap_err().code,
            "terrain-residency-stale"
        );
        assert_eq!(runtime.state_hash(), before_hash);
        assert_eq!(runtime.generation_diagnostics(), before_generation_diagnostics);
    }

    #[test]
    fn exact_terrain_reconcile_bounds_long_travel_and_restores_edited_revisits() {
        let fixture = blockwild_generation::fixture_request("integrated-residency-reconcile", 0, 0, 1);
        let mut config = IntegratedRuntimeConfigV2 {
            world_seed: fixture.seed_text,
            terrain_content_hash: parse_canonical_hash(&fixture.content_hash).unwrap(),
            generator_hash: parse_canonical_hash(&fixture.generator_hash).unwrap(),
            ..IntegratedRuntimeConfigV2::default()
        };
        config.block_catalog.water_block_id = GeneratedBlock::WATER;
        let mut runtime = IntegratedRuntimeV2::new(config).unwrap();
        let ring = |center_x: i32, center_z: i32| {
            let mut chunks = Vec::new();
            for chunk_x in center_x - 2..=center_x + 2 {
                for chunk_z in center_z - 2..=center_z + 2 {
                    chunks.push(IntegratedTerrainChunkCoordinateV1 { chunk_x, chunk_z });
                }
            }
            chunks
        };
        let reconcile = |runtime: &mut IntegratedRuntimeV2, chunks| {
            runtime.reconcile_terrain_residency(&IntegratedTerrainResidencyReconcileBatchV2 {
                expected_world_revision: runtime.world().revision(),
                generation_options_json: runtime.config().generation_options_json.clone(),
                desired_chunks: chunks,
            })
        };

        let initial = reconcile(&mut runtime, ring(0, 0)).unwrap();
        assert_eq!((initial.generated_chunk_count, initial.retained_chunk_count), (25, 0));
        assert_eq!(initial.resident_sections, 300);
        let edited_position = CellPositionV1 { x: 1, y: 100, z: 1 };
        let mut edit = IntegratedRuntimeBatchV2::empty("reconcile-edit", runtime.identity());
        edit.world.push(WorldMutationBatchR4V1 {
            schema_version: blockwild_authority::WORLD_AUTHORITY_SCHEMA_V1,
            batch_id: "reconcile-edit".into(),
            authority_id: "player:terrain-test".into(),
            address: runtime.world().active_address().clone(),
            expected_revision: runtime.world().revision(),
            commands: vec![blockwild_authority::WorldMutationCommandR4V1::SetBlock {
                position: edited_position,
                block_id: 254,
                facing: None,
            }],
        });
        assert!(runtime.commit(edit).accepted());

        for step in 1..=8 {
            let receipt = reconcile(&mut runtime, ring(step * 5, step * -3)).unwrap();
            assert_eq!(receipt.desired_chunk_count, 25);
            assert_eq!(receipt.resident_sections, 300);
            assert_eq!(runtime.world().resident_chunk_coordinates().len(), 25);
            assert_eq!(runtime.world().resident_section_count(), 300);
        }
        assert!(matches!(
            runtime.world().read_cell(edited_position),
            WorldCellReadV1::Unloaded { .. }
        ));

        let revisit = reconcile(&mut runtime, ring(0, 0)).unwrap();
        assert_eq!(revisit.generated_chunk_count, 25);
        assert_eq!(revisit.evicted_chunk_count, 25);
        assert!(matches!(
            runtime.world().read_cell(edited_position),
            WorldCellReadV1::Loaded { cell, .. } if cell.block_id == 254
        ));
        let idempotent = reconcile(&mut runtime, ring(0, 0)).unwrap();
        assert_eq!(idempotent.generated_chunk_count, 0);
        assert_eq!(idempotent.retained_chunk_count, 25);
        assert_eq!(idempotent.evicted_chunk_count, 0);
        assert_eq!(idempotent.previous_world_revision, idempotent.world_revision);
    }

    #[test]
    fn exact_terrain_reconcile_rejects_stale_invalid_and_partial_work_atomically() {
        let fixture = blockwild_generation::fixture_request("integrated-residency-reconcile-reject", 0, 0, 1);
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
            world_seed: fixture.seed_text,
            terrain_content_hash: parse_canonical_hash(&fixture.content_hash).unwrap(),
            generator_hash: parse_canonical_hash(&fixture.generator_hash).unwrap(),
            ..IntegratedRuntimeConfigV2::default()
        })
        .unwrap();
        let valid = IntegratedTerrainResidencyReconcileBatchV2 {
            expected_world_revision: runtime.world().revision(),
            generation_options_json: runtime.config().generation_options_json.clone(),
            desired_chunks: vec![IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 }],
        };
        runtime.reconcile_terrain_residency(&valid).unwrap();
        let before_hash = runtime.state_hash();
        let before_revision = runtime.world().revision();
        let before_diagnostics = runtime.generation_diagnostics();
        let stale = IntegratedTerrainResidencyReconcileBatchV2 {
            expected_world_revision: valid.expected_world_revision,
            desired_chunks: vec![IntegratedTerrainChunkCoordinateV1 { chunk_x: 1, chunk_z: 0 }],
            ..valid.clone()
        };
        assert_eq!(
            runtime.reconcile_terrain_residency(&stale).unwrap_err().code,
            "terrain-residency-reconcile-stale"
        );
        let invalid = IntegratedTerrainResidencyReconcileBatchV2 {
            expected_world_revision: before_revision,
            desired_chunks: vec![
                IntegratedTerrainChunkCoordinateV1 { chunk_x: 1, chunk_z: 0 },
                IntegratedTerrainChunkCoordinateV1 {
                    chunk_x: i32::MAX,
                    chunk_z: 0,
                },
            ],
            ..valid
        };
        assert_eq!(
            runtime.reconcile_terrain_residency(&invalid).unwrap_err().code,
            "terrain-residency-coordinate"
        );
        assert_eq!(runtime.state_hash(), before_hash);
        assert_eq!(runtime.world().revision(), before_revision);
        assert_eq!(runtime.world().resident_chunk_coordinates(), vec![(0, 0)]);
        assert_eq!(runtime.generation_diagnostics(), before_diagnostics);
    }

    #[test]
    fn exact_terrain_reconcile_removes_scheduler_only_chunks_and_active_cancellations() {
        let fixture = blockwild_generation::fixture_request("integrated-reconcile-scheduler", 0, 0, 1);
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
            world_seed: fixture.seed_text,
            terrain_content_hash: parse_canonical_hash(&fixture.content_hash).unwrap(),
            generator_hash: parse_canonical_hash(&fixture.generator_hash).unwrap(),
            ..IntegratedRuntimeConfigV2::default()
        })
        .unwrap();
        let world = runtime.world().active_address().clone();
        let authority_revision = runtime.world().revision();
        let request = |request_id, chunk_x, sequence| blockwild_authority::ResidencyRequestV1 {
            request_id,
            epoch: authority_revision.epoch,
            address: WorldSectionAddressV1 {
                world: world.clone(),
                chunk_x,
                chunk_z: 0,
                section_y: 0,
            },
            class: blockwild_authority::ResidencyPriorityClassV1::OccupiedSupport,
            purpose: blockwild_authority::ResidencyPurposeV1::Generate,
            distance_squared: 0,
            direction_penalty: 0,
            sequence,
        };
        {
            let scheduler = runtime.world_mut_for_platform_install().scheduler_mut();
            scheduler.submit(request(1, 9, 1)).unwrap();
            scheduler.submit(request(2, 9, 2)).unwrap();
            scheduler.submit(request(3, 0, 3)).unwrap();
        }
        let active = runtime
            .world_mut_for_platform_install()
            .scheduler_mut()
            .start_next(authority_revision, fixture.content_hash)
            .unwrap()
            .unwrap();
        assert!(runtime.world_mut_for_platform_install().scheduler_mut().cancel(1));

        let receipt = runtime
            .reconcile_terrain_residency(&IntegratedTerrainResidencyReconcileBatchV2 {
                expected_world_revision: authority_revision,
                generation_options_json: runtime.config().generation_options_json.clone(),
                desired_chunks: vec![IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 }],
            })
            .unwrap();
        assert_eq!(
            receipt.evicted_chunks,
            vec![IntegratedTerrainChunkCoordinateV1 { chunk_x: 9, chunk_z: 0 }]
        );
        let scheduler = runtime.world_mut_for_platform_install().scheduler_mut();
        let scheduler_snapshot = scheduler.exact_snapshot();
        assert_eq!(scheduler_snapshot.queued.len(), 1);
        assert_eq!(scheduler_snapshot.queued[0].request_id, 3);
        assert!(scheduler_snapshot.active.is_empty());
        assert!(scheduler_snapshot.cancelled.is_empty());
        assert_eq!(
            scheduler.finish(&active, receipt.world_revision),
            blockwild_authority::ResidencyCompletionV1::UnknownJob
        );
    }

    #[test]
    fn exact_terrain_reconcile_generation_failure_leaves_authority_unmodified() {
        let fixture = blockwild_generation::fixture_request("integrated-reconcile-generation-failure", 0, 0, 1);
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
            world_seed: fixture.seed_text,
            terrain_content_hash: parse_canonical_hash(&fixture.content_hash).unwrap(),
            generator_hash: parse_canonical_hash(&fixture.generator_hash).unwrap(),
            ..IntegratedRuntimeConfigV2::default()
        })
        .unwrap();
        runtime
            .reconcile_terrain_residency(&IntegratedTerrainResidencyReconcileBatchV2 {
                expected_world_revision: runtime.world().revision(),
                generation_options_json: runtime.config().generation_options_json.clone(),
                desired_chunks: vec![IntegratedTerrainChunkCoordinateV1 { chunk_x: 1, chunk_z: 0 }],
            })
            .unwrap();
        let edited = CellPositionV1 { x: 17, y: 100, z: 1 };
        let mut edit = IntegratedRuntimeBatchV2::empty("generation-failure-edit", runtime.identity());
        edit.world.push(WorldMutationBatchR4V1 {
            schema_version: blockwild_authority::WORLD_AUTHORITY_SCHEMA_V1,
            batch_id: "generation-failure-edit".into(),
            authority_id: "player:terrain-test".into(),
            address: runtime.world().active_address().clone(),
            expected_revision: runtime.world().revision(),
            commands: vec![blockwild_authority::WorldMutationCommandR4V1::SetBlock {
                position: edited,
                block_id: 254,
                facing: None,
            }],
        });
        assert!(runtime.commit(edit).accepted());
        runtime.generation = Arc::new(GenerationService::new(blockwild_generation::GenerationServiceConfig {
            cache_entries: 4,
            maximum_edits: 0,
        }));
        let before_hash = runtime.state_hash();
        let before_world_hash = runtime.world().canonical_state_hash();
        let before_revision = runtime.world().revision();
        let error = runtime
            .reconcile_terrain_residency(&IntegratedTerrainResidencyReconcileBatchV2 {
                expected_world_revision: before_revision,
                generation_options_json: runtime.config().generation_options_json.clone(),
                desired_chunks: vec![
                    IntegratedTerrainChunkCoordinateV1 {
                        chunk_x: -1,
                        chunk_z: 0,
                    },
                    IntegratedTerrainChunkCoordinateV1 { chunk_x: 1, chunk_z: 0 },
                ],
            })
            .unwrap_err();
        assert_eq!(error.code, "generation-error");
        assert_eq!(runtime.state_hash(), before_hash);
        assert_eq!(runtime.world().canonical_state_hash(), before_world_hash);
        assert_eq!(runtime.world().revision(), before_revision);
        assert_eq!(runtime.world().resident_chunk_coordinates(), vec![(1, 0)]);
        assert!(matches!(
            runtime.world().read_cell(edited),
            WorldCellReadV1::Loaded { cell, .. } if cell.block_id == 254
        ));
    }

    #[test]
    fn terrain_options_exclude_spawn_origin_and_require_exact_normalized_fields() {
        assert!(validate_canonical_generation_options_json_v1(DEFAULT_GENERATION_OPTIONS_JSON_V1).is_ok());
        assert!(!DEFAULT_GENERATION_OPTIONS_JSON_V1.contains("origin"));
        for invalid in [
            "{}",
            "{\"origin\":{\"mode\":\"wilderness\"}}",
            &DEFAULT_GENERATION_OPTIONS_JSON_V1.replace("\"structures\":true", "\"structures\":true,\"origin\":{}"),
            &DEFAULT_GENERATION_OPTIONS_JSON_V1.replace("\"caveFrequency\":1", "\"caveFrequency\":1.001"),
            &DEFAULT_GENERATION_OPTIONS_JSON_V1.replace("\"hobbits\",\"goblins\"", "\"goblins\",\"hobbits\""),
        ] {
            assert_eq!(
                validate_canonical_generation_options_json_v1(invalid).unwrap_err().code,
                "invalid-generation-options"
            );
        }
    }

    #[test]
    fn legacy_runtime_core_configs_restore_default_terrain_identity() {
        let mut legacy = IntegratedRuntimeConfigV2 {
            world_seed: "legacy-core-config".into(),
            universe_id: "legacy-universe".into(),
            location_id: "legacy-location".into(),
            session_id: "legacy-session".into(),
            content_hash: CanonicalHash([1; 16]),
            generator_hash: CanonicalHash([2; 16]),
            terrain_content_hash: CanonicalHash([3; 16]),
            generation_options_json: DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
            block_catalog: BlockCatalogV1::default(),
        };
        legacy.block_catalog.water_block_id = 7;
        legacy.block_catalog.directional_blocks.extend([8, 9]);
        legacy.block_catalog.waterlogged_blocks.insert(10);

        // Schemas 1..=3 ended the immutable config after generatorHash and
        // therefore have no terrain identity bytes to consume here.
        let mut writer = NativeWriterV1::default();
        writer.string(&legacy.world_seed).unwrap();
        writer.string(&legacy.universe_id).unwrap();
        writer.string(&legacy.location_id).unwrap();
        writer.string(&legacy.session_id).unwrap();
        writer.hash(legacy.content_hash);
        writer.hash(legacy.generator_hash);
        writer.u16(legacy.block_catalog.water_block_id);
        writer.u32(legacy.block_catalog.directional_blocks.len() as u32);
        for block_id in &legacy.block_catalog.directional_blocks {
            writer.u16(*block_id);
        }
        writer.u32(legacy.block_catalog.waterlogged_blocks.len() as u32);
        for block_id in &legacy.block_catalog.waterlogged_blocks {
            writer.u16(*block_id);
        }
        let bytes = writer.finish();

        for schema in [
            NATIVE_RECORD_SCHEMA_V1,
            NATIVE_RUNTIME_CORE_SCHEMA_V2,
            NATIVE_RUNTIME_CORE_SCHEMA_V3,
        ] {
            let mut reader = NativeReaderV1::new(&bytes);
            let restored = read_runtime_config_v1(&mut reader, schema).unwrap();
            reader.finish().unwrap();
            assert_eq!(restored.world_seed, legacy.world_seed);
            assert_eq!(restored.content_hash, legacy.content_hash);
            assert_eq!(restored.generator_hash, legacy.generator_hash);
            assert_eq!(restored.terrain_content_hash, DEFAULT_TERRAIN_CONTENT_HASH_V2);
            assert_eq!(restored.generation_options_json, DEFAULT_GENERATION_OPTIONS_JSON_V1);
            assert_eq!(restored.block_catalog, legacy.block_catalog);
        }
    }

    #[test]
    fn content_install_is_paged_transactional_and_idempotent() {
        let artifacts = vec![
            ContentArtifact {
                domain: ContentDomain::CardforgePack,
                id: "pack:\u{6c34}-wilds".into(),
                schema_id: "tcg-pack".into(),
                schema_version: 1,
                content_version: 7,
                aliases: vec!["cardforge-pack:pack:\u{6c34}-wilds".into()],
                canonical_bytes: "{\"id\":\"\u{6c34}-wilds\",\"name\":\"Water Wilds\",\"retailPrice\":4,\"setIds\":[]}"
                    .as_bytes()
                    .to_vec(),
                unknown_extension_bytes: vec![0x80, 0xff],
            },
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "603".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 3,
                aliases: vec!["item:603".into()],
                canonical_bytes: "{\"id\":603,\"maxStack\":64,\"name\":\"Mizu \u{6c34}\"}"
                    .as_bytes()
                    .to_vec(),
                unknown_extension_bytes: vec![0, 0x80, 0xff, 7],
            },
        ];
        let bundle = compile_content_bundle("production-\u{6c34}-7", artifacts).expect("fixture content");
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
            content_hash: bundle.manifest.manifest_hash,
            ..IntegratedRuntimeConfigV2::default()
        })
        .unwrap();
        let page = |index: u32, artifact: ContentArtifact| ContentInstallPageWireV1 {
            install_id: format!("install:{}", bundle.manifest.manifest_hash.to_hex()),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision.clone(),
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains.clone(),
            page_index: index,
            page_count: 2,
            artifacts: vec![artifact],
        };
        let first = page(0, bundle.artifacts[0].clone());
        let second = page(1, bundle.artifacts[1].clone());
        let first_bytes = crate::encode_content_install_page_v1(&first).unwrap();
        let second_bytes = crate::encode_content_install_page_v1(&second).unwrap();
        let first_hash = CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&first_bytes));
        let second_hash = CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&second_bytes));

        assert_eq!(
            runtime
                .install_content_page(second.clone(), second_hash)
                .unwrap_err()
                .code,
            "content-page-missing"
        );
        let before = runtime.state_hash();
        let staged = runtime.install_content_page(first.clone(), first_hash).unwrap();
        assert_eq!(staged.status, ContentInstallReceiptStatusV1::Staged);
        assert_eq!(staged.accepted_pages, 1);
        assert!(!runtime.native_save_ready());
        assert_ne!(runtime.state_hash(), before);
        assert_eq!(runtime.install_content_page(first.clone(), first_hash).unwrap(), staged);

        let mut conflicting = first;
        conflicting.artifacts[0].unknown_extension_bytes.push(9);
        let conflicting_bytes = crate::encode_content_install_page_v1(&conflicting).unwrap();
        let conflicting_hash = CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&conflicting_bytes));
        let before_conflict = runtime.identity();
        assert_eq!(
            runtime
                .install_content_page(conflicting, conflicting_hash)
                .unwrap_err()
                .code,
            "content-page-conflict"
        );
        assert_eq!(runtime.identity(), before_conflict);

        let installed = runtime.install_content_page(second.clone(), second_hash).unwrap();
        assert_eq!(installed.status, ContentInstallReceiptStatusV1::Installed);
        assert_eq!(installed.installed_entries, 2);
        assert!(runtime.content_ready());
        assert!(runtime.native_save_ready());
        assert_eq!(runtime.gameplay_content_registry_len(), 2);
        assert_eq!(
            runtime.gameplay.state.inventory.items.get(&603),
            Some(&ItemDefinition {
                code: 603,
                content_id: "603".into(),
                max_stack: 64,
                tags: BTreeSet::new(),
            })
        );
        assert_eq!(
            runtime
                .gameplay_content_store()
                .get_by_alias("cardforge-pack:pack:\u{6c34}-wilds")
                .unwrap()
                .exact_bytes()
                .1,
            [0x80, 0xff]
        );
        assert_eq!(runtime.install_content_page(second, second_hash).unwrap(), installed);

        let expected_identity = runtime.identity();
        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert_eq!(restored.identity(), expected_identity);
        assert!(restored.content_ready());
        assert_eq!(restored.gameplay_content_registry_len(), 2);
        assert_eq!(
            restored.gameplay.state.inventory.items,
            runtime.gameplay.state.inventory.items
        );
        assert_eq!(
            restored
                .gameplay_content_store()
                .get_by_alias("cardforge-pack:pack:\u{6c34}-wilds")
                .unwrap()
                .exact_bytes()
                .1,
            [0x80, 0xff]
        );
        let mut contradictory = runtime.clone();
        contradictory
            .gameplay
            .state
            .inventory
            .items
            .get_mut(&603)
            .unwrap()
            .max_stack = 63;
        contradictory.invalidate_state_hash();
        let contradictory_checkpoint = contradictory.export_runtime_checkpoint().unwrap();
        let contradictory_error = match IntegratedRuntimeV2::restore_runtime_checkpoint(
            &contradictory_checkpoint,
            integrated_runtime_checkpoint_hash_v1(&contradictory_checkpoint),
        ) {
            Ok(_) => panic!("contradictory gameplay/content restore must reject"),
            Err(error) => error,
        };
        assert_eq!(contradictory_error.code, "recovery-content-item-definitions");

        let mut reordered_runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
            content_hash: bundle.manifest.manifest_hash,
            ..IntegratedRuntimeConfigV2::default()
        })
        .unwrap();
        let mut page_zero = page(0, bundle.artifacts[0].clone());
        page_zero.page_count = 3;
        let page_zero_bytes = crate::encode_content_install_page_v1(&page_zero).unwrap();
        reordered_runtime
            .install_content_page(
                page_zero,
                CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&page_zero_bytes)),
            )
            .unwrap();
        let mut page_two = page(2, bundle.artifacts[1].clone());
        page_two.page_count = 3;
        let page_two_bytes = crate::encode_content_install_page_v1(&page_two).unwrap();
        assert_eq!(
            reordered_runtime
                .install_content_page(
                    page_two,
                    CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&page_two_bytes)),
                )
                .unwrap_err()
                .code,
            "content-page-reordered"
        );
    }

    #[test]
    fn final_content_materialization_failure_is_atomic() {
        let artifact = ContentArtifact {
            domain: ContentDomain::Item,
            id: "77".into(),
            schema_id: "item-definition".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["item:77".into()],
            // Bundle compilation authenticates opaque bytes; typed install must
            // reject the missing id/maxStack without leaking the final page.
            canonical_bytes: br#"{"name":"Incomplete"}"#.to_vec(),
            unknown_extension_bytes: vec![0x80, 0xff],
        };
        let bundle = compile_content_bundle("invalid-typed-content", vec![artifact.clone()]).unwrap();
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
            content_hash: bundle.manifest.manifest_hash,
            ..IntegratedRuntimeConfigV2::default()
        })
        .unwrap();
        let page = ContentInstallPageWireV1 {
            install_id: "invalid-typed-content-install".into(),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision,
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains,
            page_index: 0,
            page_count: 1,
            artifacts: vec![artifact],
        };
        let page_bytes = crate::encode_content_install_page_v1(&page).unwrap();
        let before = runtime.identity();
        assert_eq!(
            runtime
                .install_content_page(
                    page,
                    CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&page_bytes)),
                )
                .unwrap_err()
                .code,
            "content-runtime-rejected"
        );
        assert_eq!(runtime.identity(), before);
        assert!(!runtime.content_ready());
        assert!(runtime.gameplay.state.inventory.items.is_empty());
    }

    #[test]
    fn installed_creature_profile_resolves_renderer_model_identity() {
        let artifacts = vec![
            ContentArtifact {
                domain: ContentDomain::CreatureProfile,
                id: "model:asterjaw".into(),
                schema_id: "creature-profile".into(),
                schema_version: 1,
                content_version: 42,
                aliases: vec!["creature-profile:model:asterjaw".into()],
                canonical_bytes: br#"{"captureProfile":"gentle","kind":"model:asterjaw","moves":{"unlocks":[]},"naturalTypes":["wild"],"stats":{"maximumLevel":50}}"#.to_vec(),
                unknown_extension_bytes: vec![0x80, 0xff],
            },
            ContentArtifact {
                domain: ContentDomain::CreatureTypeChart,
                id: "type:wild".into(),
                schema_id: "creature-type".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["creature-type-chart:type:wild".into()],
                canonical_bytes: br##"{"color":"#5a9d55","glyph":"W","id":"wild","name":"Wild"}"##.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
        ];
        let bundle = compile_content_bundle("models-42", artifacts.clone()).unwrap();
        let expected_hash = bundle
            .manifest
            .entries
            .iter()
            .find(|entry| entry.domain == ContentDomain::CreatureProfile)
            .unwrap()
            .blob_hash;
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
            content_hash: bundle.manifest.manifest_hash,
            ..IntegratedRuntimeConfigV2::default()
        })
        .unwrap();
        assert_eq!(
            runtime.entity_model_content_identity("model:asterjaw", "asterjaw"),
            None
        );
        let page = ContentInstallPageWireV1 {
            install_id: "models-install".into(),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision,
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains,
            page_index: 0,
            page_count: 1,
            artifacts: bundle.artifacts,
        };
        let page_bytes = crate::encode_content_install_page_v1(&page).unwrap();
        runtime
            .install_content_page(
                page,
                CanonicalHash(blockwild_runtime_wire::wire_checksum_v1(&page_bytes)),
            )
            .unwrap();
        assert_eq!(
            runtime.entity_model_content_identity("model:asterjaw", "asterjaw"),
            Some((expected_hash, 42))
        );
        assert_eq!(runtime.content_manifest_hash(), bundle.manifest.manifest_hash);
        assert!(runtime.content_ready());
    }

    #[test]
    fn entity_authority_snapshot_hydrates_exact_slots_extensions_and_sequence() {
        let mut runtime = runtime_with_section();
        let mut first = EntityCompatibilityRecord::new("creature:first", "specimen:\u{6c34}", "river-spirit");
        first.custom.insert("high-byte-label".into(), "\u{80}\u{ff}".into());
        let second = EntityCompatibilityRecord::new("creature:second", "specimen:second", "ridgeback");
        commit_entity_commands(
            &mut runtime,
            "snapshot-spawn",
            vec![
                EntityCommand::Spawn {
                    record: first,
                    residency: EntityResidency::Hot,
                },
                EntityCommand::Spawn {
                    record: second,
                    residency: EntityResidency::Cold,
                },
            ],
        );
        let old_revision = runtime.entities().revision();
        let old_snapshot = runtime.export_entity_authority_snapshot(old_revision).unwrap();
        let first_id = *runtime.entities().hot().keys().next().unwrap();
        let second_id = *runtime.entities().cold().keys().next().unwrap();
        let mut components = runtime.entities().components(second_id).unwrap().clone();
        components
            .unknown_extensions
            .insert("future:\u{6c34}".into(), vec![0, 0x80, 0xff, 7]);
        commit_entity_commands(
            &mut runtime,
            "snapshot-mutate",
            vec![
                EntityCommand::Despawn {
                    id: first_id,
                    reason: blockwild_entity::DespawnReason::Admin,
                },
                EntityCommand::ReplaceComponents {
                    id: second_id,
                    value: components,
                },
            ],
        );

        let revision = runtime.entities().revision();
        let snapshot = runtime.export_entity_authority_snapshot(revision).unwrap();
        let entity_hash = runtime.entities().canonical_hash();
        let command_sequence = runtime.entity_command_sequence;
        let mut restored = runtime_with_section();
        let receipt = restored.import_entity_authority_snapshot(0, &snapshot).unwrap();
        assert_eq!(receipt.previous_revision, 0);
        assert_eq!(receipt.revision, revision);
        assert_eq!(receipt.entity_count, 1);
        assert_eq!(receipt.state_hash, entity_hash);
        assert_eq!(restored.entities().canonical_hash(), entity_hash);
        assert_eq!(restored.entity_command_sequence, command_sequence);
        assert_eq!(restored.export_entity_authority_snapshot(revision).unwrap(), snapshot);
        assert_eq!(
            restored.entities().components(second_id).unwrap().unknown_extensions["future:\u{6c34}"],
            [0, 0x80, 0xff, 7]
        );

        let before_rejection = runtime.identity();
        assert_eq!(
            runtime
                .import_entity_authority_snapshot(revision.saturating_sub(1), &snapshot)
                .unwrap_err()
                .code,
            "entity-snapshot-stale"
        );
        assert_eq!(runtime.identity(), before_rejection);
        assert_eq!(
            runtime
                .import_entity_authority_snapshot(revision, &old_snapshot)
                .unwrap_err()
                .code,
            "entity-snapshot-rollback"
        );
        assert_eq!(runtime.identity(), before_rejection);
        let mut corrupted = snapshot;
        corrupted.pop();
        assert_eq!(
            runtime
                .import_entity_authority_snapshot(revision, &corrupted)
                .unwrap_err()
                .code,
            "entity-snapshot"
        );
        assert_eq!(runtime.identity(), before_rejection);
    }

    #[test]
    fn compatibility_bridge_is_revisioned_and_preserves_legacy_authority() {
        let mut source = runtime_with_section();
        let mut record = EntityCompatibilityRecord::new("creature:\u{6c34}", "specimen:\u{1f40b}", "tide-whale");
        record.research.insert("ecology:\u{6c34}".into(), 9);
        record.equipment.insert("saddle".into(), "item:\u{ff}".into());
        record.custom.insert("opaque".into(), "\u{80}\u{ff}".into());
        commit_entity_commands(
            &mut source,
            "compatibility-spawn",
            vec![EntityCommand::Spawn {
                record: record.clone(),
                residency: EntityResidency::Cold,
            }],
        );
        let id = *source.entities().cold().keys().next().unwrap();
        let entity_revision = source.entities().entity_revision(id).unwrap();
        let exported = source.export_entity_compatibility_record(id, entity_revision).unwrap();
        assert_eq!(decode_compatibility_record(&exported).unwrap(), record);
        assert_eq!(
            source
                .export_entity_compatibility_record(id, entity_revision.wrapping_add(1))
                .unwrap_err()
                .code,
            "entity-compatibility-stale"
        );

        let mut imported = runtime_with_section();
        let receipt = imported
            .import_entity_compatibility_record(EntityCompatibilityImportWireV1 {
                sequence: 1,
                expected_revision: 0,
                tick: 0,
                desired_id: None,
                residency: EntityResidency::Cold,
                record: record.clone(),
            })
            .unwrap();
        assert_eq!(receipt.previous_revision, 0);
        assert_eq!(receipt.revision, 1);
        assert_eq!(imported.entities().cold().values().next().unwrap().record, record);
        let before = imported.identity();
        let error = imported
            .import_entity_compatibility_record(EntityCompatibilityImportWireV1 {
                sequence: 2,
                expected_revision: 0,
                tick: 0,
                desired_id: None,
                residency: EntityResidency::Hot,
                record: EntityCompatibilityRecord::new("stale", "stale", "stale"),
            })
            .unwrap_err();
        assert_eq!(error.code, "entity-compatibility");
        assert_eq!(imported.identity(), before);
    }

    #[test]
    fn fixed_step_entity_ecology_and_path_jobs_complete_and_reject_stale_tokens() {
        let mut runtime = runtime_with_section();
        let mut record = EntityCompatibilityRecord::new("creature:scheduler", "specimen:scheduler", "courser");
        record.position = EntityVec3::new(8.0, 64.0, 8.0);
        commit_entity_commands(
            &mut runtime,
            "scheduler-spawn",
            vec![EntityCommand::Spawn {
                record,
                residency: EntityResidency::Hot,
            }],
        );
        let id = *runtime.entities().hot().keys().next().unwrap();
        let mut ai = runtime.entities().components(id).unwrap().ai.clone();
        ai.route_epoch = 7;
        ai.route = vec![EntityVec3::new(9.0, 64.0, 9.0)];
        commit_entity_commands(
            &mut runtime,
            "scheduler-route",
            vec![EntityCommand::SetAiState { id, value: ai }],
        );
        runtime.tick = INTEGRATED_RUNTIME_ECOLOGY_CADENCE_TICKS_V1;
        runtime.advance_entity_and_gameplay_schedules().unwrap();
        let completed = runtime.entity_schedule_diagnostics();
        assert!(completed.entity_jobs_completed >= 1);
        assert!(completed.ecology_jobs_completed >= 1);
        assert!(completed.path_jobs_completed >= 1);

        let current_revision = runtime.entities().entity_revision(id).unwrap();
        let stale_revision = current_revision.saturating_sub(1);
        runtime
            .entity_scheduler
            .upsert(id, SimulationTier::Hero, stale_revision, runtime.tick);
        let sector = runtime.entity_sectors[&id];
        let ecology_revision = runtime.entity_ecology_revisions[&sector];
        runtime
            .entity_ecology_jobs
            .schedule(sector, ecology_revision.saturating_sub(1), runtime.tick)
            .unwrap();
        let (route_epoch, origin, goal) = {
            let entity = runtime.entities().hot().get(&id).unwrap();
            (
                entity.components.ai.route_epoch,
                entity.record.position,
                *entity.components.ai.route.last().unwrap(),
            )
        };
        runtime.entity_path_jobs.cancel(id);
        runtime
            .entity_path_jobs
            .submit(PathJobSubmission {
                id,
                entity_revision: stale_revision,
                route_epoch,
                due_tick: runtime.tick,
                priority: 0,
                origin,
                goal,
            })
            .unwrap();
        runtime.tick = runtime.tick.saturating_add(1);
        runtime.advance_entity_and_gameplay_schedules().unwrap();
        let rejected = runtime.entity_schedule_diagnostics();
        assert!(rejected.entity_jobs_rejected_stale > completed.entity_jobs_rejected_stale);
        assert!(rejected.ecology_jobs_rejected_stale > completed.ecology_jobs_rejected_stale);
        assert!(rejected.path_jobs_rejected_stale > completed.path_jobs_rejected_stale);
        assert!(runtime.entities().contains(id));
    }
}
