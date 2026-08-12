use std::collections::{BTreeMap, BTreeSet};

use blockwild_types::{CanonicalHash, EntityId, PlayerId};

use crate::*;

const ACTOR_ID: &str = "player-one";
const PLAYER_ID: PlayerId = PlayerId::new(11, 1);
const PLAYER_ENTITY_ID: EntityId = EntityId::new(21, 1);
const DROP_ENTITY_ID: EntityId = EntityId::new(31, 1);

fn fixture_gameplay() -> GameplayState {
    let mut state = GameplayState::new(WorldKey::new("universe-a", "surface"), 3);
    state
        .inventory
        .register_item(ItemDefinition {
            code: 42,
            content_id: "item.blockwild.crystal".into(),
            max_stack: 64,
            tags: BTreeSet::new(),
        })
        .unwrap();
    let mut inventory = Container::new(ContainerKey::player(ACTOR_ID), 4);
    inventory.slots[0] = Some(ItemStack::simple(42, 3));
    state.inventory.insert_container(inventory).unwrap();
    let equipment_key = ContainerKey {
        kind: ContainerKind::Equipment,
        id: "player-one-equipment".into(),
        owner_id: Some(ACTOR_ID.into()),
    };
    let mut equipment = Container::new(equipment_key, 2);
    equipment.equipment_tags[0] = Some("back".into());
    state.inventory.insert_container(equipment).unwrap();
    state
        .machines
        .insert_machine(MachineState {
            machine_id: "machine-lantern".into(),
            owner_id: Some(ACTOR_ID.into()),
            kind: MachineKind::Custom,
            revision: 0,
            active: true,
            recipe_id: None,
            progress_ticks: 0,
            last_tick: 0,
            ports: BTreeMap::new(),
            lease: None,
            settings: None,
        })
        .unwrap();
    state
}

fn fixture_gameplay_authority() -> GameplayAuthority {
    let mut authority = GameplayAuthority::new(fixture_gameplay());
    authority
        .grant_actor(ACTOR_ID, ActorGrant::host(PLAYER_ID, PLAYER_ENTITY_ID))
        .unwrap();
    authority.grant_actor("world-system", ActorGrant::system()).unwrap();
    authority
}

fn system_actor() -> GameplayActor {
    GameplayActor {
        actor_id: "world-system".into(),
        player_id: None,
        entity_id: None,
        role: ActorRole::System,
    }
}

fn player_actor() -> GameplayActor {
    GameplayActor {
        actor_id: ACTOR_ID.into(),
        player_id: Some(PLAYER_ID),
        entity_id: Some(PLAYER_ENTITY_ID),
        role: ActorRole::Host,
    }
}

fn binding(revision: u64) -> PlayerInventoryBindingV1 {
    PlayerInventoryBindingV1 {
        player_id: PLAYER_ID,
        revision,
        actor_id: ACTOR_ID.into(),
        entity_id: PLAYER_ENTITY_ID,
        inventory_container: ContainerKey::player(ACTOR_ID),
        equipment_container: ContainerKey {
            kind: ContainerKind::Equipment,
            id: "player-one-equipment".into(),
            owner_id: Some(ACTOR_ID.into()),
        },
        selected_slot: 0,
        back_slot: Some(0),
    }
}

fn anchor(revision: u64) -> MachineSpatialAnchorV1 {
    MachineSpatialAnchorV1 {
        machine_id: "machine-lantern".into(),
        revision,
        presentation_id: "machine.lantern.v1".into(),
        position: FixedWorldVec3V1 {
            x_milli: 1_500,
            y_milli: 64_000,
            z_milli: -2_500,
        },
        rotation: RotationMicroturnsV1 {
            yaw: 250_000,
            pitch: 0,
            roll: 0,
        },
        half_extents_milli: [500, 1_000, 500],
        light: Some(MachineLightProfileV1 {
            kind: MachineLightKindV1::Point,
            color: LinearRgbMillionthsV1 {
                red: 1_000_000,
                green: 700_000,
                blue: 300_000,
            },
            luminous_flux_millilumens: 900_000,
            range_milli: 12_000,
            inner_cone_microturns: 0,
            outer_cone_microturns: 0,
            casts_shadows: true,
            enabled: true,
        }),
    }
}

fn celestial(revision: u64, tick: u64) -> CelestialSkyStateV1 {
    let star = CelestialBodySkyV1 {
        body_id: "star-way".into(),
        parent_body_id: None,
        kind: CelestialBodyKindV1::Star,
        presentation_id: "celestial.waystar".into(),
        direction: FixedUnitVectorV1::UP,
        angular_radius_microdegrees: 250_000,
        illuminated_fraction_millionths: 1_000_000,
        phase_microturns: 0,
        tint: LinearRgbMillionthsV1::WHITE,
        radiance_millionths: 5_000_000,
        render_order: 0,
        occludes_stars: true,
    };
    CelestialSkyStateV1 {
        revision,
        ephemeris_tick: tick,
        starfield_seed: 0x1234,
        bodies: BTreeMap::from([(star.body_id.clone(), star)]),
    }
}

fn accepted(receipt: WorldViewReceiptV1) -> WorldViewAcceptedReceiptV1 {
    match receipt {
        WorldViewReceiptV1::Accepted(receipt) => receipt,
        WorldViewReceiptV1::Rejected { rejection, .. } => panic!("world-view batch rejected: {rejection:?}"),
    }
}

fn create_authority(gameplay: &GameplayState) -> WorldViewAuthorityV1 {
    let mut authority = WorldViewAuthorityV1::new(WorldViewStateV1::new(gameplay.world.clone(), 9));
    authority
        .grant_actor("world-system", WorldViewActorGrantV1::system())
        .unwrap();
    authority
        .grant_actor(ACTOR_ID, WorldViewActorGrantV1::player(PLAYER_ID, PLAYER_ENTITY_ID))
        .unwrap();
    let commands = vec![
        WorldViewCommandV1::UpsertPlayerBinding {
            expected_revision: None,
            binding: binding(0),
        },
        WorldViewCommandV1::UpsertMachineAnchor {
            expected_revision: None,
            anchor: anchor(0),
        },
        WorldViewCommandV1::SetCelestialSky {
            expected_revision: 0,
            celestial: celestial(1, 0),
        },
    ];
    let batch = WorldViewBatchV1::new(
        "bootstrap",
        "bootstrap-key",
        system_actor(),
        authority.state.identity(),
        commands,
    );
    accepted(authority.apply_batch(&batch, gameplay));
    authority
}

#[test]
fn world_view_authority_commits_revisioned_renderer_neutral_records() {
    let gameplay = fixture_gameplay();
    let authority = create_authority(&gameplay);
    assert_eq!(authority.state.revision.sequence, 1);
    assert_eq!(authority.state.revision.player_bindings, 1);
    assert_eq!(authority.state.revision.machine_anchors, 1);
    assert_eq!(authority.state.revision.celestial, 1);
    assert_eq!(authority.state.player_binding(PLAYER_ID), Some(&binding(0)));
    assert_eq!(
        authority.state.player_binding_by_entity(PLAYER_ENTITY_ID),
        Some(&binding(0))
    );
    assert_eq!(
        authority.state.held_stack(&gameplay, PLAYER_ID).unwrap().unwrap().count,
        3
    );
    assert!(authority.state.atmosphere_gravity.is_human_breathable());
}

#[test]
fn player_custody_bootstrap_is_replay_safe_and_binding_ready() {
    let mut gameplay = GameplayAuthority::new(GameplayState::new(WorldKey::new("universe-a", "surface"), 3));
    gameplay
        .grant_actor(ACTOR_ID, ActorGrant::host(PLAYER_ID, PLAYER_ENTITY_ID))
        .unwrap();
    let inventory = ContainerKey::player(ACTOR_ID);
    let equipment = ContainerKey {
        kind: ContainerKind::Equipment,
        id: "player-one-equipment".into(),
        owner_id: Some(ACTOR_ID.into()),
    };
    let batch = GameplayBatch::new(
        "create-player-custody",
        "create-player-custody-key",
        player_actor(),
        gameplay.state.identity(),
        vec![GameplayCommand::Inventory(InventoryCommand::CreatePlayerCustody(
            CreatePlayerCustodyCommand {
                inventory: inventory.clone(),
                inventory_slots: 36,
                equipment: equipment.clone(),
                equipment_slots: 8,
                back_slot: Some(7),
            },
        ))],
    );
    let first = match gameplay.apply_batch(&batch) {
        GameplayReceipt::Accepted(receipt) => receipt,
        receipt => panic!("custody bootstrap rejected: {receipt:?}"),
    };
    assert_eq!(gameplay.state.inventory.containers[&inventory].slots.len(), 36);
    assert_eq!(
        gameplay.state.inventory.containers[&equipment].equipment_tags[7].as_deref(),
        Some("back")
    );
    assert_eq!(gameplay.replay().len(), 1);
    assert_eq!(gameplay.apply_batch(&batch), GameplayReceipt::Accepted(first));
    assert_eq!(gameplay.replay().len(), 1);
    let snapshot = gameplay.encode_snapshot(&[]).unwrap();
    let restored = decode_gameplay_authority_snapshot(&snapshot).unwrap().authority;
    assert_eq!(restored.state, gameplay.state);
    assert_eq!(restored.replay_hash(), gameplay.replay_hash());
    let binding = PlayerInventoryBindingV1 {
        player_id: PLAYER_ID,
        revision: 0,
        actor_id: ACTOR_ID.into(),
        entity_id: PLAYER_ENTITY_ID,
        inventory_container: inventory,
        equipment_container: equipment,
        selected_slot: 0,
        back_slot: Some(7),
    };
    let mut view = WorldViewAuthorityV1::new(WorldViewStateV1::new(restored.state.world.clone(), 1));
    view.grant_actor("world-system", WorldViewActorGrantV1::system())
        .unwrap();
    let bind = WorldViewBatchV1::new(
        "bind-created-player",
        "bind-created-player-key",
        system_actor(),
        view.state.identity(),
        vec![WorldViewCommandV1::UpsertPlayerBinding {
            expected_revision: None,
            binding,
        }],
    );
    accepted(view.apply_batch(&bind, &restored.state));
}

#[test]
fn stale_batch_rolls_back_every_world_view_domain() {
    let gameplay = fixture_gameplay();
    let mut authority = create_authority(&gameplay);
    let before = authority.state.clone();
    let mut stale = authority.state.identity();
    stale.revision.sequence -= 1;
    let batch = WorldViewBatchV1::new(
        "stale",
        "stale-key",
        system_actor(),
        stale,
        vec![WorldViewCommandV1::RemoveMachineAnchor {
            machine_id: "machine-lantern".into(),
            expected_revision: 0,
        }],
    );
    assert!(matches!(
        authority.apply_batch(&batch, &gameplay),
        WorldViewReceiptV1::Rejected {
            rejection: Rejection {
                code: RejectionCode::StaleRevision,
                ..
            },
            ..
        }
    ));
    assert_eq!(authority.state, before);
}

#[test]
fn world_view_tick_advance_is_system_only_even_with_environment_scope() {
    let gameplay = fixture_gameplay();
    let mut authority = create_authority(&gameplay);
    let actor = GameplayActor {
        actor_id: "environment-operator".into(),
        player_id: Some(PLAYER_ID),
        entity_id: Some(PLAYER_ENTITY_ID),
        role: ActorRole::Host,
    };
    authority
        .grant_actor(
            actor.actor_id.clone(),
            WorldViewActorGrantV1 {
                player_id: actor.player_id,
                entity_id: actor.entity_id,
                role: actor.role,
                scopes: BTreeSet::from([WorldViewScopeV1::Environment]),
            },
        )
        .unwrap();
    let before = authority.state.clone();
    let replay_before = authority.replay().clone();
    let batch = WorldViewBatchV1::new(
        "player-clock",
        "player-clock-key",
        actor,
        authority.state.identity(),
        vec![WorldViewCommandV1::AdvanceTick {
            expected_tick: 0,
            to_tick: 1,
        }],
    );

    assert!(matches!(
        authority.apply_batch(&batch, &gameplay),
        WorldViewReceiptV1::Rejected {
            rejection: Rejection {
                code: RejectionCode::Unauthorized,
                ..
            },
            ..
        }
    ));
    assert_eq!(authority.state, before);
    assert_eq!(authority.replay(), &replay_before);
}

#[test]
fn world_view_tick_rejects_equal_and_stale_batches_with_atomic_rollback() {
    let gameplay = fixture_gameplay();
    let mut authority = create_authority(&gameplay);
    let before = authority.state.clone();
    let replay_before = authority.replay().clone();
    let equal_after_valid = WorldViewBatchV1::new(
        "clock-rollback",
        "clock-rollback-key",
        system_actor(),
        authority.state.identity(),
        vec![
            WorldViewCommandV1::AdvanceTick {
                expected_tick: 0,
                to_tick: 1,
            },
            WorldViewCommandV1::AdvanceTick {
                expected_tick: 1,
                to_tick: 1,
            },
        ],
    );
    assert!(matches!(
        authority.apply_batch(&equal_after_valid, &gameplay),
        WorldViewReceiptV1::Rejected {
            rejection: Rejection {
                code: RejectionCode::InvalidCommand,
                ..
            },
            ..
        }
    ));
    assert_eq!(authority.state, before);
    assert_eq!(authority.replay(), &replay_before);

    let stale = WorldViewBatchV1::new(
        "clock-stale",
        "clock-stale-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::AdvanceTick {
            expected_tick: 1,
            to_tick: 2,
        }],
    );
    assert!(matches!(
        authority.apply_batch(&stale, &gameplay),
        WorldViewReceiptV1::Rejected {
            rejection: Rejection {
                code: RejectionCode::StaleRevision,
                ..
            },
            ..
        }
    ));
    assert_eq!(authority.state, before);
    assert_eq!(authority.replay(), &replay_before);

    let future = WorldViewBatchV1::new(
        "clock-future",
        "clock-future-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::AdvanceTick {
            expected_tick: 0,
            to_tick: 1,
        }],
    );
    let receipt = accepted(authority.apply_batch(&future, &gameplay));
    assert_eq!(authority.state.tick, 1);
    assert_eq!(authority.state.revision.clock, before.revision.clock + 1);
    assert_eq!(receipt.touched_domains, BTreeSet::from([WorldViewDomainV1::Clock]));
}

#[test]
fn world_view_tick_retry_and_snapshot_restore_preserve_forward_clock_semantics() {
    let gameplay = fixture_gameplay();
    let mut authority = create_authority(&gameplay);
    let advance = WorldViewBatchV1::new(
        "clock-one",
        "clock-one-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::AdvanceTick {
            expected_tick: 0,
            to_tick: 1,
        }],
    );
    let first = accepted(authority.apply_batch(&advance, &gameplay));
    let replay_len = authority.replay().len();
    assert_eq!(accepted(authority.apply_batch(&advance, &gameplay)), first);
    assert_eq!(authority.state.tick, 1);
    assert_eq!(authority.replay().len(), replay_len);

    let bytes = authority.encode_snapshot_v1(&gameplay, &[0x57, 0x56]).unwrap();
    let decoded = decode_world_view_authority_snapshot_v1(&bytes, &gameplay).unwrap();
    assert_eq!(decoded.authority.state, authority.state);
    assert_eq!(decoded.authority.replay_hash(), authority.replay_hash());
    assert_eq!(decoded.unknown_extension_bytes, vec![0x57, 0x56]);
    assert_eq!(
        decoded.authority.encode_snapshot_v1(&gameplay, &[0x57, 0x56]).unwrap(),
        bytes
    );

    let mut restored = decoded.authority;
    assert_eq!(accepted(restored.apply_batch(&advance, &gameplay)), first);
    assert_eq!(restored.replay().len(), replay_len);
    let advance_again = WorldViewBatchV1::new(
        "clock-two",
        "clock-two-key",
        system_actor(),
        restored.state.identity(),
        vec![WorldViewCommandV1::AdvanceTick {
            expected_tick: 1,
            to_tick: 2,
        }],
    );
    accepted(restored.apply_batch(&advance_again, &gameplay));
    assert_eq!(restored.state.tick, 2);
    assert_eq!(restored.state.revision.clock, 2);

    let second_bytes = restored.encode_snapshot_v1(&gameplay, &[]).unwrap();
    let restored_again = decode_world_view_authority_snapshot_v1(&second_bytes, &gameplay).unwrap();
    assert_eq!(restored_again.authority.state.tick, 2);
    assert_eq!(restored_again.authority.state, restored.state);
    assert_eq!(restored_again.authority.replay_hash(), restored.replay_hash());
}

#[test]
fn retry_is_idempotent_and_command_reuse_fails_closed() {
    let gameplay = fixture_gameplay();
    let mut authority = create_authority(&gameplay);
    let batch = WorldViewBatchV1::new(
        "select",
        "select-key",
        player_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::SelectPlayerSlot {
            player_id: PLAYER_ID,
            expected_revision: 0,
            selected_slot: 1,
        }],
    );
    let first = accepted(authority.apply_batch(&batch, &gameplay));
    let retry = accepted(authority.apply_batch(&batch, &gameplay));
    assert_eq!(first, retry);
    assert_eq!(authority.replay().len(), 2);

    let conflict = WorldViewBatchV1::new(
        "conflict",
        "select-key",
        player_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::SelectPlayerSlot {
            player_id: PLAYER_ID,
            expected_revision: 1,
            selected_slot: 2,
        }],
    );
    assert!(matches!(
        authority.apply_batch(&conflict, &gameplay),
        WorldViewReceiptV1::Rejected {
            rejection: Rejection {
                code: RejectionCode::Conflict,
                ..
            },
            ..
        }
    ));
}

#[test]
fn player_cannot_mutate_another_player_or_environment() {
    let gameplay = fixture_gameplay();
    let mut authority = create_authority(&gameplay);
    let before = authority.state.clone();
    let environment = EnvironmentLightingStateV1 {
        revision: 1,
        ..EnvironmentLightingStateV1::default()
    };
    let batch = WorldViewBatchV1::new(
        "unauthorized-weather",
        "unauthorized-weather-key",
        player_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::SetEnvironment {
            expected_revision: 0,
            environment,
        }],
    );
    assert!(matches!(
        authority.apply_batch(&batch, &gameplay),
        WorldViewReceiptV1::Rejected {
            rejection: Rejection {
                code: RejectionCode::Unauthorized,
                ..
            },
            ..
        }
    ));
    assert_eq!(authority.state, before);
}

#[test]
fn staged_player_drop_conserves_items_and_creates_explicit_custody() {
    let gameplay = fixture_gameplay_authority();
    let authority = create_authority(&gameplay.state);
    let request = PlayerDropStageRequestV1 {
        batch_id: "drop-crystal-gameplay".into(),
        idempotency_key: "drop-crystal-gameplay-key".into(),
        actor: player_actor(),
        expected_gameplay_identity: gameplay.state.identity(),
        expected_world_view_identity: authority.state.identity(),
        player_id: PLAYER_ID,
        expected_binding_revision: 0,
        expected_source_container_revision: 0,
        expected_stack: ExpectedStack {
            item_code: 42,
            metadata_hash: CanonicalHash::default(),
            minimum_count: 1,
        },
        drop_id: "drop-crystal-1".into(),
        drop_entity_id: DROP_ENTITY_ID,
        custody_container_id: "drop-custody-crystal-1".into(),
        position: FixedWorldVec3V1 {
            x_milli: 2_000,
            y_milli: 65_000,
            z_milli: -3_000,
        },
        velocity_milli_per_second: FixedWorldVec3V1 {
            x_milli: 250,
            y_milli: 1_500,
            z_milli: 0,
        },
        rotation: RotationMicroturnsV1::default(),
        expires_tick: Some(1_200),
        pickup_lock_actor_id: Some(ACTOR_ID.into()),
        pickup_unlock_tick: 0,
    };
    let first = stage_player_drop_v1(&gameplay, &authority.state, &request).unwrap();
    let second = stage_player_drop_v1(&gameplay, &authority.state, &request).unwrap();
    assert_eq!(
        format!(
            "schema=1\nplayer_drop_transaction_hash={}\n",
            first.transaction_hash.to_hex()
        ),
        include_str!("../fixtures/world-view-player-drop-v1.txt")
    );
    assert_eq!(first.transaction_hash, second.transaction_hash);
    assert_eq!(first.stack.count, 1);
    assert_eq!(
        first.gameplay.state.inventory.containers[&ContainerKey::player(ACTOR_ID)].slots[0]
            .as_ref()
            .unwrap()
            .count,
        2
    );
    assert_eq!(
        first.gameplay.state.inventory.containers[&first.custody_container].slots[0],
        Some(first.stack.clone())
    );
    assert_eq!(
        first.gameplay.state.revision.sequence,
        gameplay.state.revision.sequence + 1
    );
    assert_eq!(
        first.gameplay.state.revision.inventory,
        gameplay.state.revision.inventory + 1
    );
    assert_eq!(first.gameplay.replay().len(), gameplay.replay().len() + 1);
    assert_eq!(first.gameplay_receipt.after, first.after_gameplay_identity);
    let gameplay_snapshot = first.gameplay.encode_snapshot(&[]).unwrap();
    let restored_gameplay = decode_gameplay_authority_snapshot(&gameplay_snapshot)
        .unwrap()
        .authority;
    assert_eq!(restored_gameplay.state, first.gameplay.state);
    assert_eq!(restored_gameplay.replay_hash(), first.gameplay.replay_hash());

    let retry = stage_player_drop_v1(&first.gameplay, &authority.state, &request).unwrap();
    assert_eq!(retry.gameplay_receipt, first.gameplay_receipt);
    assert_eq!(retry.gameplay.replay().len(), first.gameplay.replay().len());
    assert_eq!(retry.transaction_hash, first.transaction_hash);
    let mut changed = request.clone();
    changed.position.x_milli += 1;
    assert_eq!(
        stage_player_drop_v1(&first.gameplay, &authority.state, &changed)
            .unwrap_err()
            .code,
        RejectionCode::Conflict,
        "the gameplay idempotency record binds spatial request hash too"
    );
    assert_eq!(
        authority.state.dropped_items.len(),
        0,
        "staging cannot partially commit spatial ownership"
    );

    let mut staged_authority = authority.clone();
    let register = WorldViewBatchV1::new(
        "register-drop",
        "register-drop-key",
        system_actor(),
        staged_authority.state.identity(),
        vec![WorldViewCommandV1::RegisterDrop {
            drop: first.drop.clone(),
        }],
    );
    accepted(staged_authority.apply_batch(&register, &first.gameplay.state));
    assert_eq!(
        staged_authority
            .state
            .dropped_stack(&first.gameplay.state, "drop-crystal-1")
            .unwrap(),
        &first.stack
    );
}

#[test]
fn staged_player_drop_rejects_stale_or_duplicate_ownership_without_mutation() {
    let gameplay = fixture_gameplay_authority();
    let authority = create_authority(&gameplay.state);
    let mut request = PlayerDropStageRequestV1 {
        batch_id: "drop-stale-gameplay".into(),
        idempotency_key: "drop-stale-gameplay-key".into(),
        actor: player_actor(),
        expected_gameplay_identity: gameplay.state.identity(),
        expected_world_view_identity: authority.state.identity(),
        player_id: PLAYER_ID,
        expected_binding_revision: 0,
        expected_source_container_revision: 99,
        expected_stack: ExpectedStack {
            item_code: 42,
            metadata_hash: CanonicalHash::default(),
            minimum_count: 1,
        },
        drop_id: "drop-stale".into(),
        drop_entity_id: DROP_ENTITY_ID,
        custody_container_id: "drop-stale-custody".into(),
        position: FixedWorldVec3V1::default(),
        velocity_milli_per_second: FixedWorldVec3V1::default(),
        rotation: RotationMicroturnsV1::default(),
        expires_tick: None,
        pickup_lock_actor_id: None,
        pickup_unlock_tick: 0,
    };
    assert_eq!(
        stage_player_drop_v1(&gameplay, &authority.state, &request)
            .unwrap_err()
            .code,
        RejectionCode::StaleRevision
    );
    request.expected_source_container_revision = 0;
    request.drop_entity_id = EntityId::default();
    assert_eq!(
        stage_player_drop_v1(&gameplay, &authority.state, &request)
            .unwrap_err()
            .code,
        RejectionCode::InvalidCommand
    );
    assert_eq!(
        gameplay.state.inventory.containers[&ContainerKey::player(ACTOR_ID)].slots[0]
            .as_ref()
            .unwrap()
            .count,
        3
    );
}

#[test]
fn drop_spatial_ownership_cannot_outlive_nonempty_custody() {
    let gameplay = fixture_gameplay_authority();
    let mut authority = create_authority(&gameplay.state);
    let staged = stage_player_drop_v1(
        &gameplay,
        &authority.state,
        &PlayerDropStageRequestV1 {
            batch_id: "drop-protected-gameplay".into(),
            idempotency_key: "drop-protected-gameplay-key".into(),
            actor: player_actor(),
            expected_gameplay_identity: gameplay.state.identity(),
            expected_world_view_identity: authority.state.identity(),
            player_id: PLAYER_ID,
            expected_binding_revision: 0,
            expected_source_container_revision: 0,
            expected_stack: ExpectedStack {
                item_code: 42,
                metadata_hash: CanonicalHash::default(),
                minimum_count: 1,
            },
            drop_id: "drop-protected".into(),
            drop_entity_id: DROP_ENTITY_ID,
            custody_container_id: "drop-protected-custody".into(),
            position: FixedWorldVec3V1::default(),
            velocity_milli_per_second: FixedWorldVec3V1::default(),
            rotation: RotationMicroturnsV1::default(),
            expires_tick: None,
            pickup_lock_actor_id: None,
            pickup_unlock_tick: 0,
        },
    )
    .unwrap();
    let register = WorldViewBatchV1::new(
        "register-protected",
        "register-protected-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::RegisterDrop { drop: staged.drop }],
    );
    accepted(authority.apply_batch(&register, &staged.gameplay.state));
    let before = authority.state.clone();
    let remove = WorldViewBatchV1::new(
        "remove-protected",
        "remove-protected-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::RemoveDrop {
            drop_id: "drop-protected".into(),
            expected_revision: 0,
            reason: DropRemovalReasonV1::PickedUp,
        }],
    );
    assert!(matches!(
        authority.apply_batch(&remove, &staged.gameplay.state),
        WorldViewReceiptV1::Rejected {
            rejection: Rejection {
                code: RejectionCode::Conflict,
                ..
            },
            ..
        }
    ));
    assert_eq!(authority.state, before);

    let container_removed = WorldViewBatchV1::new(
        "remove-protected-container",
        "remove-protected-container-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::RemoveDrop {
            drop_id: "drop-protected".into(),
            expected_revision: 0,
            reason: DropRemovalReasonV1::ContainerRemoved,
        }],
    );
    assert!(matches!(
        authority.apply_batch(&container_removed, &staged.gameplay.state),
        WorldViewReceiptV1::Rejected {
            rejection: Rejection {
                code: RejectionCode::Conflict,
                ..
            },
            ..
        }
    ));
    assert_eq!(authority.state, before);

    let mut without_custody = staged.gameplay.clone();
    let pickup = GameplayBatch::new(
        "pickup-custody",
        "pickup-custody-key",
        system_actor(),
        without_custody.state.identity(),
        vec![
            GameplayCommand::Inventory(InventoryCommand::Transfer(TransferCommand {
                from: SlotRef {
                    container: staged.custody_container.clone(),
                    slot: 0,
                    expected_container_revision: Some(0),
                },
                to: SlotRef {
                    container: ContainerKey::player(ACTOR_ID),
                    slot: 1,
                    expected_container_revision: Some(1),
                },
                count: 1,
                expected: Some(ExpectedStack {
                    item_code: 42,
                    metadata_hash: CanonicalHash::default(),
                    minimum_count: 1,
                }),
            })),
            GameplayCommand::Inventory(InventoryCommand::RemoveEmptyDropCustody(
                RemoveEmptyDropCustodyCommand {
                    custody: staged.custody_container.clone(),
                    expected_revision: 1,
                },
            )),
        ],
    );
    assert!(matches!(
        without_custody.apply_batch(&pickup),
        GameplayReceipt::Accepted(_)
    ));
    assert!(
        !without_custody
            .state
            .inventory
            .containers
            .contains_key(&staged.custody_container)
    );
    accepted(authority.apply_batch(&container_removed, &without_custody.state));
    assert!(!authority.state.dropped_items.contains_key("drop-protected"));
}

#[test]
fn atmosphere_weather_and_celestial_validation_fail_closed() {
    let gameplay = fixture_gameplay();
    let mut authority = create_authority(&gameplay);
    let before = authority.state.clone();
    let bad_atmosphere = AtmosphereGravityStateV1 {
        revision: 1,
        pressure_millipascals: 101_325_000,
        temperature_millikelvin: 288_150,
        composition: GasCompositionMillionthsV1 {
            oxygen: 1_000_000,
            nitrogen: 1,
            ..GasCompositionMillionthsV1::default()
        },
        optical_extinction_millionths: 0,
        gravity: GravityStateV1::default(),
    };
    let batch = WorldViewBatchV1::new(
        "bad-atmosphere",
        "bad-atmosphere-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::SetAtmosphereGravity {
            expected_revision: 0,
            atmosphere_gravity: bad_atmosphere,
        }],
    );
    assert!(matches!(
        authority.apply_batch(&batch, &gameplay),
        WorldViewReceiptV1::Rejected { .. }
    ));
    assert_eq!(authority.state, before);

    let mut cycle = celestial(2, 0);
    cycle.bodies.insert(
        "moon-a".into(),
        CelestialBodySkyV1 {
            body_id: "moon-a".into(),
            parent_body_id: Some("moon-b".into()),
            kind: CelestialBodyKindV1::Moon,
            presentation_id: "moon.a".into(),
            direction: FixedUnitVectorV1::UP,
            angular_radius_microdegrees: 100,
            illuminated_fraction_millionths: 500_000,
            phase_microturns: 0,
            tint: LinearRgbMillionthsV1::WHITE,
            radiance_millionths: 10,
            render_order: 1,
            occludes_stars: true,
        },
    );
    let mut moon_b = cycle.bodies["moon-a"].clone();
    moon_b.body_id = "moon-b".into();
    moon_b.parent_body_id = Some("moon-a".into());
    cycle.bodies.insert("moon-b".into(), moon_b);
    let batch = WorldViewBatchV1::new(
        "bad-celestial",
        "bad-celestial-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::SetCelestialSky {
            expected_revision: 1,
            celestial: cycle,
        }],
    );
    assert!(matches!(
        authority.apply_batch(&batch, &gameplay),
        WorldViewReceiptV1::Rejected { .. }
    ));
    assert_eq!(authority.state, before);
}

#[test]
fn snapshot_roundtrip_preserves_authority_retry_replay_and_extensions() {
    let gameplay = fixture_gameplay();
    let mut authority = create_authority(&gameplay);
    let select = WorldViewBatchV1::new(
        "snapshot-select",
        "snapshot-select-key",
        player_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::SelectPlayerSlot {
            player_id: PLAYER_ID,
            expected_revision: 0,
            selected_slot: 1,
        }],
    );
    let expected_receipt = accepted(authority.apply_batch(&select, &gameplay));
    let bytes = authority.encode_snapshot_v1(&gameplay, &[0, 0x80, 0xff]).unwrap();
    assert_eq!(u16::from_le_bytes([bytes[8], bytes[9]]), 1);
    assert_eq!(
        format!(
            "schema=1\nstate_hash={}\nreplay_hash={}\nsnapshot_hash={}\nsnapshot_bytes={}\n",
            authority.state.state_hash().to_hex(),
            authority.replay_hash().to_hex(),
            canonical_world_view_snapshot_hash_v1(&bytes).to_hex(),
            bytes.len()
        ),
        include_str!("../fixtures/world-view-snapshot-v1.txt")
    );
    let decoded = decode_world_view_authority_snapshot_v1(&bytes, &gameplay).unwrap();
    assert_eq!(decoded.schema_version, WORLD_VIEW_SNAPSHOT_SCHEMA_VERSION_V1);
    assert_eq!(decoded.authority.state, authority.state);
    assert_eq!(decoded.authority.replay_hash(), authority.replay_hash());
    assert_eq!(decoded.unknown_extension_bytes, vec![0, 0x80, 0xff]);
    assert_eq!(decoded.snapshot_hash, canonical_world_view_snapshot_hash_v1(&bytes));
    assert_eq!(
        accepted(decoded.authority.clone().apply_batch(&select, &gameplay)),
        expected_receipt
    );
    assert_eq!(
        decoded
            .authority
            .encode_snapshot_v1(&gameplay, &[0, 0x80, 0xff])
            .unwrap(),
        bytes
    );
}

#[test]
fn delayed_pickup_deadline_uses_v2_and_restores_exact_replay() {
    let gameplay = fixture_gameplay_authority();
    let mut authority = create_authority(&gameplay.state);
    let request = PlayerDropStageRequestV1 {
        batch_id: "drop-v2-gameplay".into(),
        idempotency_key: "drop-v2-gameplay-key".into(),
        actor: player_actor(),
        expected_gameplay_identity: gameplay.state.identity(),
        expected_world_view_identity: authority.state.identity(),
        player_id: PLAYER_ID,
        expected_binding_revision: 0,
        expected_source_container_revision: 0,
        expected_stack: ExpectedStack {
            item_code: 42,
            metadata_hash: CanonicalHash::default(),
            minimum_count: 1,
        },
        drop_id: "drop-v2".into(),
        drop_entity_id: DROP_ENTITY_ID,
        custody_container_id: "drop-v2-custody".into(),
        position: FixedWorldVec3V1::default(),
        velocity_milli_per_second: FixedWorldVec3V1::default(),
        rotation: RotationMicroturnsV1::default(),
        expires_tick: Some(200),
        pickup_lock_actor_id: Some(ACTOR_ID.into()),
        pickup_unlock_tick: 7,
    };
    let staged = stage_player_drop_v1(&gameplay, &authority.state, &request).unwrap();
    let register = WorldViewBatchV1::new(
        "register-v2",
        "register-v2-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::RegisterDrop {
            drop: staged.drop.clone(),
        }],
    );
    let accepted_register = accepted(authority.apply_batch(&register, &staged.gameplay.state));
    let bytes = authority
        .encode_snapshot_v1(&staged.gameplay.state, &[0x80, 0xff, 2])
        .unwrap();
    assert_eq!(u16::from_le_bytes([bytes[8], bytes[9]]), 2);
    let decoded = decode_world_view_authority_snapshot_v1(&bytes, &staged.gameplay.state).unwrap();
    assert_eq!(decoded.schema_version, WORLD_VIEW_SNAPSHOT_SCHEMA_VERSION_V2);
    assert_eq!(decoded.authority.state, authority.state);
    assert_eq!(decoded.authority.replay_hash(), authority.replay_hash());
    assert_eq!(decoded.authority.state.dropped_items["drop-v2"].pickup_unlock_tick, 7);
    assert_eq!(
        accepted(decoded.authority.clone().apply_batch(&register, &staged.gameplay.state)),
        accepted_register
    );
    assert_eq!(
        decoded
            .authority
            .encode_snapshot_v1(&staged.gameplay.state, &[0x80, 0xff, 2])
            .unwrap(),
        bytes
    );
}

#[test]
fn snapshot_corruption_truncation_and_wrong_gameplay_leave_target_untouched() {
    let gameplay = fixture_gameplay();
    let authority = create_authority(&gameplay);
    let bytes = authority.encode_snapshot_v1(&gameplay, &[]).unwrap();
    let mut target = WorldViewAuthorityV1::new(WorldViewStateV1::new(gameplay.world.clone(), 44));
    let before = target.state.clone();

    let mut corrupt = bytes.clone();
    let last = corrupt.len() - 1;
    corrupt[last] ^= 0x80;
    assert_eq!(
        target.install_snapshot_v1(&corrupt, &gameplay).unwrap_err().code,
        WorldViewSnapshotErrorCodeV1::Corrupt
    );
    assert_eq!(target.state, before);
    assert_eq!(
        target.install_snapshot_v1(&bytes[..40], &gameplay).unwrap_err().code,
        WorldViewSnapshotErrorCodeV1::Truncated
    );
    assert_eq!(target.state, before);
    let wrong_gameplay = GameplayState::new(WorldKey::new("universe-b", "orbit"), 3);
    assert_eq!(
        target.install_snapshot_v1(&bytes, &wrong_gameplay).unwrap_err().code,
        WorldViewSnapshotErrorCodeV1::AuthorityRejected
    );
    assert_eq!(target.state, before);
}

#[test]
fn deterministic_property_stream_roundtrips_every_revision() {
    let gameplay = fixture_gameplay();
    let mut left = create_authority(&gameplay);
    let mut right = create_authority(&gameplay);
    for index in 0_u16..128 {
        let selected_slot = index % 4;
        let left_binding_revision = left.state.player_bindings[&PLAYER_ID].revision;
        let right_binding_revision = right.state.player_bindings[&PLAYER_ID].revision;
        let left_batch = WorldViewBatchV1::new(
            format!("property-{index}"),
            format!("property-key-{index}"),
            player_actor(),
            left.state.identity(),
            vec![WorldViewCommandV1::SelectPlayerSlot {
                player_id: PLAYER_ID,
                expected_revision: left_binding_revision,
                selected_slot,
            }],
        );
        let right_batch = WorldViewBatchV1::new(
            format!("property-{index}"),
            format!("property-key-{index}"),
            player_actor(),
            right.state.identity(),
            vec![WorldViewCommandV1::SelectPlayerSlot {
                player_id: PLAYER_ID,
                expected_revision: right_binding_revision,
                selected_slot,
            }],
        );
        assert_eq!(
            accepted(left.apply_batch(&left_batch, &gameplay)),
            accepted(right.apply_batch(&right_batch, &gameplay))
        );
        assert_eq!(left.state.state_hash(), right.state.state_hash());
        assert_eq!(left.replay_hash(), right.replay_hash());
        let bytes = left.encode_snapshot_v1(&gameplay, &[]).unwrap();
        left = decode_world_view_authority_snapshot_v1(&bytes, &gameplay)
            .unwrap()
            .authority;
    }
    assert_eq!(left.state, right.state);
    assert_eq!(left.replay_hash(), right.replay_hash());
}

#[test]
fn malformed_command_hash_and_record_successor_revisions_are_rejected() {
    let gameplay = fixture_gameplay();
    let mut authority = create_authority(&gameplay);
    let before = authority.state.clone();
    let mut bad_hash = WorldViewBatchV1::new(
        "bad-hash",
        "bad-hash-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::UpsertMachineAnchor {
            expected_revision: Some(0),
            anchor: anchor(1),
        }],
    );
    bad_hash.command_hash = CanonicalHash([7; 16]);
    assert!(matches!(
        authority.apply_batch(&bad_hash, &gameplay),
        WorldViewReceiptV1::Rejected { .. }
    ));
    assert_eq!(authority.state, before);

    let batch = WorldViewBatchV1::new(
        "bad-successor",
        "bad-successor-key",
        system_actor(),
        authority.state.identity(),
        vec![WorldViewCommandV1::UpsertMachineAnchor {
            expected_revision: Some(0),
            anchor: anchor(7),
        }],
    );
    assert!(matches!(
        authority.apply_batch(&batch, &gameplay),
        WorldViewReceiptV1::Rejected { .. }
    ));
    assert_eq!(authority.state, before);
}
