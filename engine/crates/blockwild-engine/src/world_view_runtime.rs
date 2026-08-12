//! Integrated-runtime boundary for renderer-neutral world-view authority.
//!
//! This module intentionally does not own a second runtime. It supplies the
//! validation, transaction staging, exact native-record, and extraction joins
//! used by [`crate::IntegratedRuntimeV2`] while that runtime owns exactly one
//! [`WorldViewAuthorityV1`]. All mutation helpers clone first and return a
//! staged authority, so a caller can commit world, R6 entity, gameplay, and
//! world-view domains together only after every cross-domain invariant passes.

use std::collections::BTreeMap;
use std::fmt;

use blockwild_entity::EntityAuthority;
use blockwild_gameplay::{
    AtmosphereGravityStateV1, CelestialSkyStateV1, ContainerKey, DroppedItemSpatialV1, EnvironmentLightingStateV1,
    GameplayActor, GameplayState, ItemStack, MachineSpatialAnchorV1, PlayerDropStageRequestV1,
    PlayerInventoryBindingV1, StagedPlayerDropV1, WORLD_VIEW_MAX_SNAPSHOT_EXTENSIONS_V1, WorldKey,
    WorldViewAcceptedReceiptV1, WorldViewAuthorityV1, WorldViewBatchV1, WorldViewCommandV1, WorldViewIdentityV1,
    WorldViewReceiptV1, WorldViewSnapshotErrorV1, WorldViewStateV1, decode_world_view_authority_snapshot_v1,
};
use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId};

/// Stable record identity used by the integrated native checkpoint/save set.
pub const INTEGRATED_RUNTIME_WORLD_VIEW_RECORD_ID_V1: &str = "rust-world-view-r7-v1";
/// The exact native body begins with the gameplay authority's BWVWSP magic.
pub const INTEGRATED_RUNTIME_WORLD_VIEW_BODY_MAGIC_V1: [u8; 8] = *b"BWVWSP\0\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorldViewRuntimeErrorCodeV1 {
    AuthorityRejected,
    EntityReferenceMissing,
    EntityReferenceConflict,
    SnapshotRejected,
    DropTransactionMismatch,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewRuntimeErrorV1 {
    pub code: WorldViewRuntimeErrorCodeV1,
    pub message: String,
}

impl WorldViewRuntimeErrorV1 {
    fn new(code: WorldViewRuntimeErrorCodeV1, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn authority(message: impl Into<String>) -> Self {
        Self::new(WorldViewRuntimeErrorCodeV1::AuthorityRejected, message)
    }
}

impl fmt::Display for WorldViewRuntimeErrorV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for WorldViewRuntimeErrorV1 {}

impl From<WorldViewSnapshotErrorV1> for WorldViewRuntimeErrorV1 {
    fn from(error: WorldViewSnapshotErrorV1) -> Self {
        Self::new(
            WorldViewRuntimeErrorCodeV1::SnapshotRejected,
            format!(
                "world-view snapshot {:?} at byte {}: {}",
                error.code, error.offset, error.message
            ),
        )
    }
}

/// Construct the sole runtime-owned authority and install its durable system
/// grant before any commands are accepted.
pub fn initialize_world_view_authority_v1(
    world: WorldKey,
    epoch: u32,
    system_actor_id: &str,
) -> Result<WorldViewAuthorityV1, WorldViewRuntimeErrorV1> {
    let mut authority = WorldViewAuthorityV1::new(WorldViewStateV1::new(world, epoch));
    authority
        .grant_actor(system_actor_id, blockwild_gameplay::WorldViewActorGrantV1::system())
        .map_err(|rejection| {
            WorldViewRuntimeErrorV1::authority(format!(
                "world-view system grant rejected ({:?}): {}",
                rejection.code, rejection.message
            ))
        })?;
    Ok(authority)
}

/// Validate that every R7 spatial owner resolves to one live generational R6
/// entity and that a player entity cannot simultaneously represent a drop.
pub fn validate_world_view_entity_links_v1(
    state: &WorldViewStateV1,
    entities: &EntityAuthority,
) -> Result<(), WorldViewRuntimeErrorV1> {
    let mut claims = BTreeMap::<EntityId, &'static str>::new();
    for binding in state.player_bindings.values() {
        require_live_entity(entities, binding.entity_id, "player binding")?;
        if let Some(previous) = claims.insert(binding.entity_id, "player binding") {
            return Err(entity_conflict(binding.entity_id, previous, "player binding"));
        }
    }
    for drop in state.dropped_items.values() {
        require_live_entity(entities, drop.entity_id, "dropped item")?;
        if let Some(previous) = claims.insert(drop.entity_id, "dropped item") {
            return Err(entity_conflict(drop.entity_id, previous, "dropped item"));
        }
    }
    Ok(())
}

/// Validate all gameplay custody links and all R6 entity links at the same
/// staged boundary. This must run after every integrated multi-domain batch,
/// even when that batch has no world-view commands, because another domain may
/// have removed a referenced container or entity.
pub fn validate_world_view_runtime_links_v1(
    state: &WorldViewStateV1,
    gameplay: &GameplayState,
    entities: &EntityAuthority,
) -> Result<(), WorldViewRuntimeErrorV1> {
    state.validate_against_gameplay(gameplay).map_err(|rejection| {
        WorldViewRuntimeErrorV1::authority(format!(
            "world-view gameplay link rejected ({:?}): {}",
            rejection.code, rejection.message
        ))
    })?;
    validate_world_view_entity_links_v1(state, entities)
}

fn require_live_entity(
    entities: &EntityAuthority,
    entity_id: EntityId,
    claim: &'static str,
) -> Result<(), WorldViewRuntimeErrorV1> {
    if entities.contains(entity_id) {
        return Ok(());
    }
    Err(WorldViewRuntimeErrorV1::new(
        WorldViewRuntimeErrorCodeV1::EntityReferenceMissing,
        format!(
            "world-view {claim} references absent or stale R6 entity {}",
            entity_id.packed()
        ),
    ))
}

fn entity_conflict(entity_id: EntityId, previous: &str, next: &str) -> WorldViewRuntimeErrorV1 {
    WorldViewRuntimeErrorV1::new(
        WorldViewRuntimeErrorCodeV1::EntityReferenceConflict,
        format!(
            "R6 entity {} is claimed by both world-view {previous} and {next}",
            entity_id.packed()
        ),
    )
}

#[derive(Clone, Debug)]
pub struct StagedWorldViewBatchesV1 {
    pub authority: WorldViewAuthorityV1,
    pub before: WorldViewIdentityV1,
    pub after: WorldViewIdentityV1,
    pub receipts: Vec<WorldViewAcceptedReceiptV1>,
}

/// Apply ordered world-view command batches to a clone, then validate the
/// complete staged gameplay/entity graph. No input authority is mutated.
pub fn stage_world_view_batches_v1(
    authority: &WorldViewAuthorityV1,
    gameplay: &GameplayState,
    entities: &EntityAuthority,
    batches: &[WorldViewBatchV1],
) -> Result<StagedWorldViewBatchesV1, WorldViewRuntimeErrorV1> {
    let before = authority.state.identity();
    let mut staged = authority.clone();
    let mut receipts = Vec::with_capacity(batches.len());
    for batch in batches {
        match staged.apply_batch(batch, gameplay) {
            WorldViewReceiptV1::Accepted(receipt) => receipts.push(receipt),
            WorldViewReceiptV1::Rejected { rejection, .. } => {
                return Err(WorldViewRuntimeErrorV1::authority(format!(
                    "world-view batch {} rejected ({:?}): {}",
                    batch.batch_id, rejection.code, rejection.message
                )));
            }
        }
    }
    validate_world_view_runtime_links_v1(&staged.state, gameplay, entities)?;
    let after = staged.state.identity();
    Ok(StagedWorldViewBatchesV1 {
        authority: staged,
        before,
        after,
        receipts,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerBindingStageRequestV1 {
    pub batch_id: String,
    pub idempotency_key: String,
    pub actor: GameplayActor,
    pub expected_world_view_identity: WorldViewIdentityV1,
    pub expected_binding_revision: Option<u64>,
    pub binding: PlayerInventoryBindingV1,
}

/// Build and stage the canonical one-command player binding transaction.
pub fn stage_player_binding_v1(
    authority: &WorldViewAuthorityV1,
    gameplay: &GameplayState,
    entities: &EntityAuthority,
    request: &PlayerBindingStageRequestV1,
) -> Result<StagedWorldViewBatchesV1, WorldViewRuntimeErrorV1> {
    if authority.state.identity() != request.expected_world_view_identity {
        return Err(WorldViewRuntimeErrorV1::authority(
            "player binding request targets a stale world-view identity",
        ));
    }
    let batch = WorldViewBatchV1::new(
        &request.batch_id,
        &request.idempotency_key,
        request.actor.clone(),
        request.expected_world_view_identity.clone(),
        vec![WorldViewCommandV1::UpsertPlayerBinding {
            expected_revision: request.expected_binding_revision,
            binding: request.binding.clone(),
        }],
    );
    stage_world_view_batches_v1(authority, gameplay, entities, &[batch])
}

#[derive(Clone, Debug)]
pub struct StagedWorldViewPlayerDropV1 {
    pub authority: WorldViewAuthorityV1,
    pub receipt: WorldViewAcceptedReceiptV1,
    pub transaction_hash: CanonicalHash,
}

/// Stage the spatial half of a player drop after gameplay custody and the exact
/// requested R6 entity spawn have both been staged. The caller commits all
/// three returned/staged authorities together or none of them.
pub fn stage_registered_player_drop_v1(
    authority: &WorldViewAuthorityV1,
    staged_drop: &StagedPlayerDropV1,
    staged_entities: &EntityAuthority,
    request: &PlayerDropStageRequestV1,
) -> Result<StagedWorldViewPlayerDropV1, WorldViewRuntimeErrorV1> {
    if authority.state.identity() != request.expected_world_view_identity
        || staged_drop.before_gameplay_identity != request.expected_gameplay_identity
        || staged_drop.drop.drop_id != request.drop_id
        || staged_drop.drop.entity_id != request.drop_entity_id
        || staged_drop.custody_container.id != request.custody_container_id
    {
        return Err(WorldViewRuntimeErrorV1::new(
            WorldViewRuntimeErrorCodeV1::DropTransactionMismatch,
            "staged drop does not match its authoritative request",
        ));
    }
    require_live_entity(staged_entities, request.drop_entity_id, "dropped item")?;
    let batch = WorldViewBatchV1::new(
        &request.batch_id,
        &request.idempotency_key,
        request.actor.clone(),
        request.expected_world_view_identity.clone(),
        vec![WorldViewCommandV1::RegisterDrop {
            drop: staged_drop.drop.clone(),
        }],
    );
    let staged = stage_world_view_batches_v1(authority, &staged_drop.gameplay.state, staged_entities, &[batch])?;
    let receipt = staged
        .receipts
        .first()
        .cloned()
        .expect("one drop registration batch produces one receipt");
    let mut hasher = CanonicalHasher::new("blockwild.integrated.world-view.player-drop.v1");
    hasher.write_bytes(staged_drop.transaction_hash.as_bytes());
    hasher.write_bytes(staged_entities.canonical_hash().as_bytes());
    hasher.write_bytes(receipt.receipt_hash.as_bytes());
    hasher.write_bytes(staged.after.state_hash.as_bytes());
    Ok(StagedWorldViewPlayerDropV1 {
        authority: staged.authority,
        receipt,
        transaction_hash: hasher.finish(),
    })
}

#[derive(Clone, Debug)]
pub struct DecodedWorldViewNativeRecordV1 {
    pub authority: WorldViewAuthorityV1,
    pub unknown_extension_bytes: Vec<u8>,
    pub snapshot_hash: CanonicalHash,
}

/// Encode the exact BWVWSP native body after validating both linked domains.
pub fn encode_world_view_native_record_v1(
    authority: &WorldViewAuthorityV1,
    gameplay: &GameplayState,
    entities: &EntityAuthority,
    unknown_extension_bytes: &[u8],
) -> Result<Vec<u8>, WorldViewRuntimeErrorV1> {
    validate_world_view_runtime_links_v1(&authority.state, gameplay, entities)?;
    if unknown_extension_bytes.len() > WORLD_VIEW_MAX_SNAPSHOT_EXTENSIONS_V1 {
        return Err(WorldViewRuntimeErrorV1::new(
            WorldViewRuntimeErrorCodeV1::SnapshotRejected,
            "world-view native extension exceeds its bound",
        ));
    }
    let bytes = authority.encode_snapshot_v1(gameplay, unknown_extension_bytes)?;
    if !bytes.starts_with(&INTEGRATED_RUNTIME_WORLD_VIEW_BODY_MAGIC_V1) {
        return Err(WorldViewRuntimeErrorV1::new(
            WorldViewRuntimeErrorCodeV1::SnapshotRejected,
            "world-view encoder did not produce an exact BWVWSP record",
        ));
    }
    Ok(bytes)
}

/// Decode an exact BWVWSP native body and reject restore if any generational
/// R6 reference is absent from the staged entity snapshot.
pub fn decode_world_view_native_record_v1(
    bytes: &[u8],
    gameplay: &GameplayState,
    entities: &EntityAuthority,
) -> Result<DecodedWorldViewNativeRecordV1, WorldViewRuntimeErrorV1> {
    if !bytes.starts_with(&INTEGRATED_RUNTIME_WORLD_VIEW_BODY_MAGIC_V1) {
        return Err(WorldViewRuntimeErrorV1::new(
            WorldViewRuntimeErrorCodeV1::SnapshotRejected,
            "world-view native record is not an exact BWVWSP body",
        ));
    }
    let decoded = decode_world_view_authority_snapshot_v1(bytes, gameplay)?;
    validate_world_view_entity_links_v1(&decoded.authority.state, entities)?;
    Ok(DecodedWorldViewNativeRecordV1 {
        authority: decoded.authority,
        unknown_extension_bytes: decoded.unknown_extension_bytes,
        snapshot_hash: decoded.snapshot_hash,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewMachineExtractionV1 {
    pub anchor: MachineSpatialAnchorV1,
    pub gameplay_revision: u64,
    pub active: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewDropExtractionV1 {
    pub spatial: DroppedItemSpatialV1,
    pub stack: ItemStack,
    pub entity_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewPlayerExtractionV1 {
    pub binding: PlayerInventoryBindingV1,
    pub inventory_container_revision: u64,
    pub equipment_container_revision: u64,
    pub held_stack: Option<ItemStack>,
    pub entity_revision: u64,
}

/// Complete renderer-neutral input for the BWX0 world-view rows. Vec order is
/// canonical because every source map is a BTreeMap.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewExtractionInputV1 {
    pub identity: WorldViewIdentityV1,
    pub gameplay_state_hash: CanonicalHash,
    pub entity_state_hash: CanonicalHash,
    pub machines: Vec<WorldViewMachineExtractionV1>,
    pub dropped_items: Vec<WorldViewDropExtractionV1>,
    pub players: Vec<WorldViewPlayerExtractionV1>,
    pub environment: EnvironmentLightingStateV1,
    pub atmosphere_gravity: AtmosphereGravityStateV1,
    pub celestial: CelestialSkyStateV1,
    pub extraction_hash: CanonicalHash,
}

pub fn collect_world_view_extraction_v1(
    state: &WorldViewStateV1,
    gameplay: &GameplayState,
    entities: &EntityAuthority,
) -> Result<WorldViewExtractionInputV1, WorldViewRuntimeErrorV1> {
    validate_world_view_runtime_links_v1(state, gameplay, entities)?;
    let machines = state
        .machine_anchors
        .values()
        .map(|anchor| {
            let machine = gameplay
                .machines
                .machines
                .get(&anchor.machine_id)
                .expect("validated machine anchor resolves in gameplay");
            WorldViewMachineExtractionV1 {
                anchor: anchor.clone(),
                gameplay_revision: machine.revision,
                active: machine.active,
            }
        })
        .collect();
    let dropped_items = state
        .dropped_items
        .values()
        .map(|spatial| {
            Ok(WorldViewDropExtractionV1 {
                spatial: spatial.clone(),
                stack: state
                    .dropped_stack(gameplay, &spatial.drop_id)
                    .map_err(|rejection| {
                        WorldViewRuntimeErrorV1::authority(format!(
                            "world-view drop extraction rejected ({:?}): {}",
                            rejection.code, rejection.message
                        ))
                    })?
                    .clone(),
                entity_revision: entities
                    .entity_revision(spatial.entity_id)
                    .expect("validated drop entity is live"),
            })
        })
        .collect::<Result<Vec<_>, WorldViewRuntimeErrorV1>>()?;
    let players = state
        .player_bindings
        .values()
        .map(|binding| {
            let inventory = gameplay
                .inventory
                .containers
                .get(&binding.inventory_container)
                .expect("validated player inventory resolves");
            let equipment = gameplay
                .inventory
                .containers
                .get(&binding.equipment_container)
                .expect("validated player equipment resolves");
            Ok(WorldViewPlayerExtractionV1 {
                binding: binding.clone(),
                inventory_container_revision: inventory.revision,
                equipment_container_revision: equipment.revision,
                held_stack: state
                    .held_stack(gameplay, binding.player_id)
                    .map_err(|rejection| {
                        WorldViewRuntimeErrorV1::authority(format!(
                            "world-view held-stack extraction rejected ({:?}): {}",
                            rejection.code, rejection.message
                        ))
                    })?
                    .cloned(),
                entity_revision: entities
                    .entity_revision(binding.entity_id)
                    .expect("validated player entity is live"),
            })
        })
        .collect::<Result<Vec<_>, WorldViewRuntimeErrorV1>>()?;
    let identity = state.identity();
    let gameplay_state_hash = gameplay.state_hash();
    let entity_state_hash = entities.canonical_hash();
    let mut hasher = CanonicalHasher::new("blockwild.integrated.world-view.extraction-input.v1");
    hasher.write_bytes(identity.state_hash.as_bytes());
    hasher.write_bytes(gameplay_state_hash.as_bytes());
    hasher.write_bytes(entity_state_hash.as_bytes());
    hasher.write_u64(state.machine_anchors.len() as u64);
    hasher.write_u64(state.dropped_items.len() as u64);
    hasher.write_u64(state.player_bindings.len() as u64);
    let extraction_hash = hasher.finish();
    Ok(WorldViewExtractionInputV1 {
        identity,
        gameplay_state_hash,
        entity_state_hash,
        machines,
        dropped_items,
        players,
        environment: state.environment.clone(),
        atmosphere_gravity: state.atmosphere_gravity.clone(),
        celestial: state.celestial.clone(),
        extraction_hash,
    })
}

/// Helper used by runtime persistence record descriptors.
#[must_use]
pub fn world_view_native_record_dependencies_v1() -> [&'static str; 2] {
    ["rust-entity-r6-v2", "rust-gameplay-r7-v1"]
}

/// Expose the linked container keys without copying inventory state. This is
/// useful for bounded checkpoint audits and deterministic reference reporting.
#[must_use]
pub fn world_view_linked_containers_v1(state: &WorldViewStateV1) -> Vec<ContainerKey> {
    let mut containers = state
        .dropped_items
        .values()
        .map(|drop| drop.container.clone())
        .chain(
            state
                .player_bindings
                .values()
                .flat_map(|binding| [binding.inventory_container.clone(), binding.equipment_container.clone()]),
        )
        .collect::<Vec<_>>();
    containers.sort();
    containers.dedup();
    containers
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use blockwild_entity::{
        ENTITY_COMMAND_SCHEMA, EntityCommand, EntityCommandBatch, EntityCompatibilityRecord, EntityResidency,
    };
    use blockwild_gameplay::{
        ActorGrant, ActorRole, Container, ContainerKind, FixedWorldVec3V1, GameplayAuthority, ItemDefinition,
        LinearRgbMillionthsV1, MachineKind, MachineLightKindV1, MachineLightProfileV1, MachineState,
        PlayerInventoryBindingV1, RotationMicroturnsV1, Scope, WorldViewActorGrantV1, WorldViewScopeV1,
    };
    use blockwild_types::PlayerId;

    use super::*;

    const PLAYER_ENTITY: EntityId = EntityId::new(11, 1);
    const DROP_ENTITY: EntityId = EntityId::new(12, 1);
    const PLAYER_ID: PlayerId = PlayerId::new(7, 1);

    struct Fixture {
        gameplay: GameplayAuthority,
        world_view: WorldViewAuthorityV1,
        entities: EntityAuthority,
        inventory: ContainerKey,
        equipment: ContainerKey,
        drop_container: ContainerKey,
    }

    fn actor() -> GameplayActor {
        GameplayActor {
            actor_id: "player-seven".into(),
            player_id: Some(PLAYER_ID),
            entity_id: Some(PLAYER_ENTITY),
            role: ActorRole::Host,
        }
    }

    fn entity_batch(sequence: u64, expected_revision: u64, commands: Vec<EntityCommand>) -> EntityCommandBatch {
        EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence,
            expected_revision,
            tick: sequence,
            commands,
        }
    }

    fn spawn_at(entities: &mut EntityAuthority, id: EntityId, external: &str) {
        let mut record = EntityCompatibilityRecord::new(external, external, "test-entity");
        record.class = if id == PLAYER_ENTITY {
            blockwild_entity::EntityClass::Player
        } else {
            blockwild_entity::EntityClass::Construct
        };
        let sequence = entities.revision().saturating_add(1);
        entities
            .apply_batch(&entity_batch(
                sequence,
                entities.revision(),
                vec![EntityCommand::SpawnAt {
                    id,
                    record,
                    residency: EntityResidency::Hot,
                }],
            ))
            .expect("fixture entity spawn");
    }

    fn fixture(include_drop: bool) -> Fixture {
        let world = WorldKey::new("universe", "surface");
        let mut gameplay = GameplayAuthority::new(GameplayState::new(world.clone(), 1));
        gameplay
            .state
            .inventory
            .register_item(ItemDefinition {
                code: 1,
                content_id: "stone".into(),
                max_stack: 64,
                tags: BTreeSet::new(),
            })
            .unwrap();
        let inventory = ContainerKey::player("player-seven");
        let equipment = ContainerKey {
            kind: ContainerKind::Equipment,
            id: "player-seven-equipment".into(),
            owner_id: Some("player-seven".into()),
        };
        let drop_container = ContainerKey {
            kind: ContainerKind::Container,
            id: "drop-custody".into(),
            owner_id: None,
        };
        let mut inventory_record = Container::new(inventory.clone(), 9);
        inventory_record.slots[0] = Some(ItemStack::simple(1, 4));
        gameplay.state.inventory.insert_container(inventory_record).unwrap();
        let mut equipment_record = Container::new(equipment.clone(), 3);
        equipment_record.equipment_tags[2] = Some("back".into());
        gameplay.state.inventory.insert_container(equipment_record).unwrap();
        if include_drop {
            let mut custody = Container::new(drop_container.clone(), 1);
            custody.slots[0] = Some(ItemStack::simple(1, 1));
            gameplay.state.inventory.insert_container(custody).unwrap();
        }
        gameplay
            .grant_actor(
                "player-seven",
                ActorGrant {
                    player_id: Some(PLAYER_ID),
                    entity_id: Some(PLAYER_ENTITY),
                    role: ActorRole::Host,
                    scopes: BTreeSet::from([Scope::InventorySelf]),
                },
            )
            .unwrap();

        let mut state = WorldViewStateV1::new(world, 1);
        state.player_bindings.insert(
            PLAYER_ID,
            PlayerInventoryBindingV1 {
                player_id: PLAYER_ID,
                revision: 0,
                actor_id: "player-seven".into(),
                entity_id: PLAYER_ENTITY,
                inventory_container: inventory.clone(),
                equipment_container: equipment.clone(),
                selected_slot: 0,
                back_slot: Some(2),
            },
        );
        if include_drop {
            state.dropped_items.insert(
                "drop-one".into(),
                DroppedItemSpatialV1 {
                    drop_id: "drop-one".into(),
                    revision: 0,
                    entity_id: DROP_ENTITY,
                    container: drop_container.clone(),
                    slot: 0,
                    bound_container_revision: 0,
                    position: FixedWorldVec3V1 {
                        x_milli: 2_000,
                        y_milli: 3_000,
                        z_milli: 4_000,
                    },
                    velocity_milli_per_second: FixedWorldVec3V1::default(),
                    rotation: RotationMicroturnsV1::default(),
                    created_tick: 0,
                    expires_tick: Some(200),
                    pickup_lock_actor_id: None,
                    pickup_unlock_tick: 0,
                },
            );
        }
        let mut world_view = WorldViewAuthorityV1::new(state);
        world_view
            .grant_actor("system", WorldViewActorGrantV1::system())
            .unwrap();
        world_view
            .grant_actor(
                "player-seven",
                WorldViewActorGrantV1 {
                    player_id: Some(PLAYER_ID),
                    entity_id: Some(PLAYER_ENTITY),
                    role: ActorRole::Host,
                    scopes: BTreeSet::from([WorldViewScopeV1::PlayerBindingSelf, WorldViewScopeV1::DroppedItems]),
                },
            )
            .unwrap();
        let mut entities = EntityAuthority::default();
        spawn_at(&mut entities, PLAYER_ENTITY, "player-seven");
        if include_drop {
            spawn_at(&mut entities, DROP_ENTITY, "drop-one");
        }
        Fixture {
            gameplay,
            world_view,
            entities,
            inventory,
            equipment,
            drop_container,
        }
    }

    #[test]
    fn entity_links_reject_missing_and_cross_kind_aliases() {
        let fixture = fixture(true);
        validate_world_view_runtime_links_v1(&fixture.world_view.state, &fixture.gameplay.state, &fixture.entities)
            .unwrap();

        let mut missing = fixture.entities.clone();
        missing
            .apply_batch(&entity_batch(
                3,
                missing.revision(),
                vec![EntityCommand::Despawn {
                    id: DROP_ENTITY,
                    reason: blockwild_entity::DespawnReason::Admin,
                }],
            ))
            .unwrap();
        let error = validate_world_view_entity_links_v1(&fixture.world_view.state, &missing).unwrap_err();
        assert_eq!(error.code, WorldViewRuntimeErrorCodeV1::EntityReferenceMissing);

        let mut aliased = fixture.world_view.state.clone();
        aliased.dropped_items.get_mut("drop-one").unwrap().entity_id = PLAYER_ENTITY;
        let error = validate_world_view_entity_links_v1(&aliased, &fixture.entities).unwrap_err();
        assert_eq!(error.code, WorldViewRuntimeErrorCodeV1::EntityReferenceConflict);
    }

    #[test]
    fn batch_staging_is_atomic_replay_safe_and_cross_domain_checked() {
        let fixture = fixture(false);
        let mut environment = fixture.world_view.state.environment.clone();
        environment.revision = 1;
        environment.weather_seed = 77;
        let batch = WorldViewBatchV1::new(
            "environment-one",
            "environment-once",
            GameplayActor {
                actor_id: "system".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            fixture.world_view.state.identity(),
            vec![WorldViewCommandV1::SetEnvironment {
                expected_revision: 0,
                environment,
            }],
        );
        let staged = stage_world_view_batches_v1(
            &fixture.world_view,
            &fixture.gameplay.state,
            &fixture.entities,
            std::slice::from_ref(&batch),
        )
        .unwrap();
        assert_eq!(fixture.world_view.state.environment.revision, 0);
        assert_eq!(staged.authority.state.environment.revision, 1);
        let replayed =
            stage_world_view_batches_v1(&staged.authority, &fixture.gameplay.state, &fixture.entities, &[batch])
                .unwrap();
        assert_eq!(replayed.after, staged.after);
        assert_eq!(replayed.receipts[0], staged.receipts[0]);

        let mut invalid_state = fixture.world_view.state.clone();
        invalid_state.dropped_items.insert(
            "unspawned".into(),
            DroppedItemSpatialV1 {
                drop_id: "unspawned".into(),
                revision: 0,
                entity_id: DROP_ENTITY,
                container: fixture.inventory.clone(),
                slot: 0,
                bound_container_revision: 0,
                position: FixedWorldVec3V1::default(),
                velocity_milli_per_second: FixedWorldVec3V1::default(),
                rotation: RotationMicroturnsV1::default(),
                created_tick: 0,
                expires_tick: None,
                pickup_lock_actor_id: None,
                pickup_unlock_tick: 0,
            },
        );
        let invalid = WorldViewAuthorityV1::new(invalid_state);
        let before = invalid.state.state_hash();
        assert!(stage_world_view_batches_v1(&invalid, &fixture.gameplay.state, &fixture.entities, &[]).is_err());
        assert_eq!(invalid.state.state_hash(), before);
        assert!(invalid.replay().is_empty());
    }

    #[test]
    fn native_record_is_exact_and_roundtrips_extensions_and_replay() {
        let mut fixture = fixture(true);
        let mut environment = fixture.world_view.state.environment.clone();
        environment.revision = 1;
        environment.weather_seed = 7_777;
        let batch = WorldViewBatchV1::new(
            "persist-environment",
            "persist-environment-once",
            GameplayActor {
                actor_id: "system".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            fixture.world_view.state.identity(),
            vec![WorldViewCommandV1::SetEnvironment {
                expected_revision: 0,
                environment,
            }],
        );
        let accepted = match fixture.world_view.apply_batch(&batch, &fixture.gameplay.state) {
            WorldViewReceiptV1::Accepted(receipt) => receipt,
            WorldViewReceiptV1::Rejected { rejection, .. } => {
                panic!("fixture world-view batch rejected: {rejection:?}")
            }
        };
        let bytes = encode_world_view_native_record_v1(
            &fixture.world_view,
            &fixture.gameplay.state,
            &fixture.entities,
            b"future-fields",
        )
        .unwrap();
        assert!(bytes.starts_with(b"BWVWSP\0\0"));
        let decoded = decode_world_view_native_record_v1(&bytes, &fixture.gameplay.state, &fixture.entities).unwrap();
        assert_eq!(decoded.unknown_extension_bytes, b"future-fields");
        assert_eq!(decoded.authority.state.identity(), fixture.world_view.state.identity());
        assert_eq!(decoded.authority.replay().len(), 1);
        let mut replayed = decoded.authority.clone();
        assert_eq!(
            replayed.apply_batch(&batch, &fixture.gameplay.state),
            WorldViewReceiptV1::Accepted(accepted)
        );
        assert_eq!(replayed.state.identity(), decoded.authority.state.identity());
        let encoded_again = encode_world_view_native_record_v1(
            &decoded.authority,
            &fixture.gameplay.state,
            &fixture.entities,
            &decoded.unknown_extension_bytes,
        )
        .unwrap();
        assert_eq!(encoded_again, bytes);

        let missing_entities = EntityAuthority::default();
        let error = decode_world_view_native_record_v1(&bytes, &fixture.gameplay.state, &missing_entities).unwrap_err();
        assert_eq!(error.code, WorldViewRuntimeErrorCodeV1::EntityReferenceMissing);
    }

    #[test]
    fn extraction_joins_all_world_view_inputs_in_canonical_order() {
        let mut fixture = fixture(true);
        fixture.gameplay.state.machines.machines.insert(
            "lamp".into(),
            MachineState {
                machine_id: "lamp".into(),
                owner_id: None,
                kind: MachineKind::Generator,
                revision: 4,
                active: true,
                recipe_id: None,
                progress_ticks: 0,
                last_tick: 0,
                ports: BTreeMap::new(),
                lease: None,
                settings: None,
            },
        );
        fixture.world_view.state.machine_anchors.insert(
            "lamp".into(),
            MachineSpatialAnchorV1 {
                machine_id: "lamp".into(),
                revision: 0,
                presentation_id: "machine-lamp".into(),
                position: FixedWorldVec3V1::default(),
                rotation: RotationMicroturnsV1::default(),
                half_extents_milli: [500, 500, 500],
                light: Some(MachineLightProfileV1 {
                    kind: MachineLightKindV1::Point,
                    color: LinearRgbMillionthsV1::WHITE,
                    luminous_flux_millilumens: 80_000,
                    range_milli: 12_000,
                    inner_cone_microturns: 0,
                    outer_cone_microturns: 0,
                    casts_shadows: true,
                    enabled: true,
                }),
            },
        );
        fixture.world_view.state.environment.weather_seed = 99;
        fixture.world_view.state.celestial.starfield_seed = 123;
        let first =
            collect_world_view_extraction_v1(&fixture.world_view.state, &fixture.gameplay.state, &fixture.entities)
                .unwrap();
        let second =
            collect_world_view_extraction_v1(&fixture.world_view.state, &fixture.gameplay.state, &fixture.entities)
                .unwrap();
        assert_eq!(first, second);
        assert_eq!(first.machines.len(), 1);
        assert_eq!(first.machines[0].gameplay_revision, 4);
        assert_eq!(first.dropped_items.len(), 1);
        assert_eq!(first.dropped_items[0].stack, ItemStack::simple(1, 1));
        assert_eq!(first.players.len(), 1);
        assert_eq!(first.players[0].held_stack, Some(ItemStack::simple(1, 4)));
        assert_eq!(first.environment.weather_seed, 99);
        assert_eq!(first.celestial.starfield_seed, 123);
    }

    #[test]
    fn player_drop_registration_requires_matching_staged_r6_spawn() {
        let mut fixture = fixture(false);
        let request = PlayerDropStageRequestV1 {
            batch_id: "drop-one".into(),
            idempotency_key: "drop-one-once".into(),
            actor: actor(),
            expected_gameplay_identity: fixture.gameplay.state.identity(),
            expected_world_view_identity: fixture.world_view.state.identity(),
            player_id: PLAYER_ID,
            expected_binding_revision: 0,
            expected_source_container_revision: 0,
            expected_stack: blockwild_gameplay::ExpectedStack {
                item_code: 1,
                metadata_hash: CanonicalHash::default(),
                minimum_count: 1,
            },
            drop_id: "drop-one".into(),
            drop_entity_id: DROP_ENTITY,
            custody_container_id: "drop-custody".into(),
            position: FixedWorldVec3V1::default(),
            velocity_milli_per_second: FixedWorldVec3V1::default(),
            rotation: RotationMicroturnsV1::default(),
            expires_tick: Some(200),
            pickup_lock_actor_id: None,
            pickup_unlock_tick: 0,
        };
        let staged_drop =
            blockwild_gameplay::stage_player_drop_v1(&fixture.gameplay, &fixture.world_view.state, &request).unwrap();
        let error = stage_registered_player_drop_v1(&fixture.world_view, &staged_drop, &fixture.entities, &request)
            .unwrap_err();
        assert_eq!(error.code, WorldViewRuntimeErrorCodeV1::EntityReferenceMissing);

        spawn_at(&mut fixture.entities, DROP_ENTITY, "drop-one");
        let staged =
            stage_registered_player_drop_v1(&fixture.world_view, &staged_drop, &fixture.entities, &request).unwrap();
        assert!(staged.authority.state.dropped_items.contains_key("drop-one"));
        assert_ne!(staged.transaction_hash, CanonicalHash::default());
        assert!(!fixture.world_view.state.dropped_items.contains_key("drop-one"));
    }

    #[test]
    fn player_binding_helper_rejects_unspawned_entity_without_mutation() {
        let fixture = fixture(false);
        let mut state = fixture.world_view.state.clone();
        state.player_bindings.clear();
        let mut authority = WorldViewAuthorityV1::new(state);
        authority
            .grant_actor("system", WorldViewActorGrantV1::system())
            .unwrap();
        let binding = fixture.world_view.state.player_bindings[&PLAYER_ID].clone();
        let request = PlayerBindingStageRequestV1 {
            batch_id: "bind-player".into(),
            idempotency_key: "bind-player-once".into(),
            actor: GameplayActor {
                actor_id: "system".into(),
                player_id: None,
                entity_id: None,
                role: ActorRole::System,
            },
            expected_world_view_identity: authority.state.identity(),
            expected_binding_revision: None,
            binding,
        };
        let empty_entities = EntityAuthority::default();
        let before = authority.state.state_hash();
        let error =
            stage_player_binding_v1(&authority, &fixture.gameplay.state, &empty_entities, &request).unwrap_err();
        assert_eq!(error.code, WorldViewRuntimeErrorCodeV1::EntityReferenceMissing);
        assert_eq!(authority.state.state_hash(), before);
        assert!(authority.replay().is_empty());
    }

    #[test]
    fn helper_reports_stable_record_dependencies_and_container_set() {
        let fixture = fixture(true);
        assert_eq!(
            world_view_native_record_dependencies_v1(),
            ["rust-entity-r6-v2", "rust-gameplay-r7-v1"]
        );
        assert_eq!(
            world_view_linked_containers_v1(&fixture.world_view.state),
            vec![fixture.inventory, fixture.equipment, fixture.drop_container]
        );
    }
}
