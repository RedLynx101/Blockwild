use std::collections::{BTreeMap, BTreeSet};

use blockwild_types::{EntityId, LocationId};

use crate::*;

fn record(id: u32) -> EntityCompatibilityRecord {
    let mut record = EntityCompatibilityRecord::new(format!("entity-{id}"), format!("specimen-{id}"), "test-creature");
    record.location_id = LocationId::new(1, 1);
    record.position = Vec3::new(id as f32, 1.0, -(id as f32));
    record.maximum_health = 12.0;
    record.health = 9.0;
    record
}

fn assert_close(left: f32, right: f32) {
    assert!((left - right).abs() <= 1.0e-5, "{left} != {right}");
}

fn command(authority: &mut EntityAuthority, tick: u64, value: EntityCommand) -> EntityEvent {
    let revision = authority.revision();
    authority
        .apply_batch(&EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: revision + 1,
            expected_revision: revision,
            tick,
            commands: vec![value],
        })
        .expect("entity command")
        .events
        .into_iter()
        .next()
        .expect("entity event")
}

fn spawn(
    authority: &mut EntityAuthority,
    source: EntityCompatibilityRecord,
    residency: EntityResidency,
    tick: u64,
) -> EntityId {
    command(
        authority,
        tick,
        EntityCommand::Spawn {
            record: source,
            residency,
        },
    )
    .entity_id
}

fn despawn(authority: &mut EntityAuthority, id: EntityId, tick: u64) {
    command(
        authority,
        tick,
        EntityCommand::Despawn {
            id,
            reason: DespawnReason::Admin,
        },
    );
}

#[test]
fn compatibility_hash_is_map_order_independent_and_field_sensitive() {
    let mut first = record(1);
    first.equipment.insert("saddle".to_owned(), "reed-saddle".to_owned());
    first.equipment.insert("pack".to_owned(), "woven-pack".to_owned());
    first.research.insert("care".to_owned(), 2);
    let mut second = record(1);
    second.equipment.insert("pack".to_owned(), "woven-pack".to_owned());
    second.equipment.insert("saddle".to_owned(), "reed-saddle".to_owned());
    second.research.insert("care".to_owned(), 2);
    assert_eq!(first.canonical_hash(), second.canonical_hash());
    second.variant_key = Some("silver".to_owned());
    assert_ne!(first.canonical_hash(), second.canonical_hash());
}

#[test]
fn generation_reuse_invalidates_old_handles() {
    let mut authority = EntityAuthority::default();
    let old = spawn(&mut authority, record(1), EntityResidency::Hot, 0);
    despawn(&mut authority, old, 1);
    let new = spawn(&mut authority, record(2), EntityResidency::Hot, 2);
    assert_eq!(old.0.index(), new.0.index());
    assert_ne!(old.0.generation(), new.0.generation());
    assert!(!authority.contains(old));
    assert!(authority.contains(new));
}

#[test]
fn allocator_survives_repeated_sparse_reuse() {
    let mut authority = EntityAuthority::default();
    for round in 0..20 {
        let ids: Vec<_> = (0..80)
            .map(|index| {
                spawn(
                    &mut authority,
                    record(round * 100 + index),
                    EntityResidency::Hot,
                    round as u64,
                )
            })
            .collect();
        for id in ids.into_iter().step_by(2) {
            despawn(&mut authority, id, round as u64);
        }
    }
    let mut packed: Vec<_> = authority.hot().keys().map(|id| id.packed()).collect();
    packed.sort_unstable();
    packed.dedup();
    assert_eq!(packed.len(), authority.len());
}

#[test]
fn import_preserves_generational_identity_and_compatibility_fields() {
    let mut authority = EntityAuthority::default();
    let id = EntityId::new(42, 9);
    let mut imported = record(7);
    imported.variant_key = Some("prime".to_owned());
    imported.owner_id = Some("keeper".to_owned());
    imported.bond_points = 330;
    imported.bond_tier = "partnered".to_owned();
    imported
        .equipment
        .insert("saddle".to_owned(), "dragon-saddle".to_owned());
    imported.research.insert("ecology".to_owned(), 4);
    command(
        &mut authority,
        800,
        EntityCommand::SpawnAt {
            id,
            record: imported.clone(),
            residency: EntityResidency::Cold,
        },
    );
    assert_eq!(authority.cold()[&id].record, imported);
    assert_eq!(id.packed(), EntityId::new(42, 9).packed());
}

#[test]
fn revisioned_command_batch_is_atomic() {
    let mut authority = EntityAuthority::default();
    let missing = EntityId::new(88, 1);
    let bad = EntityCommandBatch {
        schema: ENTITY_COMMAND_SCHEMA,
        sequence: 1,
        expected_revision: 0,
        tick: 10,
        commands: vec![
            EntityCommand::Spawn {
                record: record(1),
                residency: EntityResidency::Hot,
            },
            EntityCommand::UpdateMotion {
                id: missing,
                position: Vec3::ZERO,
                yaw: 0.0,
                velocity: Vec3::ZERO,
            },
        ],
    };
    assert!(authority.apply_batch(&bad).is_err());
    assert!(authority.is_empty());
    assert_eq!(authority.revision(), 0);

    let good = EntityCommandBatch {
        commands: vec![EntityCommand::Spawn {
            record: record(1),
            residency: EntityResidency::Hot,
        }],
        ..bad
    };
    let events = authority.apply_batch(&good).expect("valid batch");
    assert_eq!(events.previous_revision, 0);
    assert_eq!(events.revision, 1);
    assert_eq!(events.events[0].command_index, 0);
    assert_eq!(authority.len(), 1);
}

#[test]
fn stale_revision_and_sequence_are_rejected() {
    let mut authority = EntityAuthority::default();
    let batch = EntityCommandBatch {
        schema: ENTITY_COMMAND_SCHEMA,
        sequence: 7,
        expected_revision: 0,
        tick: 0,
        commands: Vec::new(),
    };
    authority.apply_batch(&batch).expect("first batch");
    assert!(matches!(
        authority.apply_batch(&batch),
        Err(EntityError::StaleRevision { .. })
    ));
    let stale_sequence = EntityCommandBatch {
        expected_revision: 1,
        ..batch
    };
    assert!(matches!(
        authority.apply_batch(&stale_sequence),
        Err(EntityError::StaleSequence { .. })
    ));
}

fn rich_components(source: &EntityCompatibilityRecord) -> EntityComponents {
    let mut components = EntityComponents::from_compatibility(
        source,
        ProtectionState::from_bits(ProtectionState::EVER_LED | ProtectionState::OWNED),
    );
    components.vitals.oxygen_milli = 7_500;
    components.vitals.temperature_milli = -125;
    components.locomotion.shape = BodyShape::Flying;
    components.locomotion.movement_mode = MovementMode::Fly;
    components.locomotion.action = ActionState {
        key: "spiral-strike".to_owned(),
        phase: 2,
        started_tick: 900,
        ends_tick: 960,
        target: Some(EntityId::new(77, 2)),
    };
    components.locomotion.cooldowns.insert("breath".to_owned(), 1_200);
    components.ai.intent = AiIntentKind::Pursue;
    components.ai.intent_key = "defend-nest".to_owned();
    components.ai.blackboard.insert(
        "rune-note".to_owned(),
        BlackboardValue::Text("Hrafn — 雪原 🐉".to_owned()),
    );
    components.ai.route_epoch = 12;
    components.ai.route_cursor = 1;
    components.ai.route = vec![Vec3::new(1.0, 2.0, 3.0), Vec3::new(4.0, 5.0, 6.0)];
    components.ai.threats = vec![ThreatMemory {
        entity: EntityId::new(88, 4),
        score_milli: 4_200,
        last_seen_tick: 940,
        last_known_cell: [-12, 4, 99],
    }];
    components.social.group_id = Some("群れ-α".to_owned());
    components.mount.seats = vec![
        MountSeat {
            index: 0,
            role: "rider".to_owned(),
            offset: Vec3::new(0.0, 1.1, 0.0),
            occupant: None,
            control_weight_milli: 1_000,
        },
        MountSeat {
            index: 1,
            role: "passenger".to_owned(),
            offset: Vec3::new(0.0, 1.1, 0.8),
            occupant: None,
            control_weight_milli: 0,
        },
    ];
    components.mount.accepts_riders = true;
    components.protection = ProtectionProvenance {
        flags: ProtectionState::from_bits(ProtectionState::EVER_LED | ProtectionState::OWNED),
        first_owned_tick: Some(10),
        first_led_tick: Some(20),
        enclosure_verified_tick: None,
        named_tick: Some(30),
        provenance_key: Some("legacy-import".to_owned()),
    };
    components.care = Some(CareState {
        stabilized: true,
        nourishment_milli: 8_000,
        trust_milli: 6_500,
        care_stage: 3,
        last_care_tick: 800,
    });
    components.husbandry = Some(HusbandryState {
        sex: 2,
        maturity_milli: 10_000,
        breed_cooldown_until_tick: 2_000,
        gestation_until_tick: 0,
        parent_specimen_ids: vec!["dam-β".to_owned(), "sire-γ".to_owned()],
    });
    components.work = Some(WorkState {
        task_key: "carry".to_owned(),
        progress_milli: 250,
        target_entity: None,
        target_cell: Some([-2, 7, 19]),
        carrying_item_key: Some("iron-ingot".to_owned()),
        due_tick: 980,
    });
    components.equipment.insert(
        "crest".to_owned(),
        EquipmentSlotState {
            item_key: "sky-龍-crest".to_owned(),
            count: 1,
            durability: 777,
            custom: BTreeMap::from([("patina".to_owned(), vec![0, 0x80, 0xff, 7])]),
        },
    );
    components.dragon = Some(DragonState {
        lineage_key: "golden".to_owned(),
        element_key: "solar".to_owned(),
        life_stage: 4,
        flight_stamina_milli: 9_000,
        breath_charge_milli: 8_500,
        egg_or_hatchling: false,
    });
    components.legendary = Some(LegendaryState {
        encounter_key: "sun-vault".to_owned(),
        phase: 2,
        defeated: false,
        capture_lock_until_tick: 4_000,
        world_flags: BTreeMap::from([("awakened".to_owned(), 1)]),
    });
    components.summon = Some(SummonState {
        origin_realm_key: "vellum-between".to_owned(),
        summoner_id: Some("mage-É".to_owned()),
        expires_tick: 8_000,
        grounded: true,
        grounding_item_key: Some("world-anchor".to_owned()),
    });
    components.sentient = Some(SentientState {
        faction_id: Some("high-elves".to_owned()),
        settlement_id: Some("ad-astra".to_owned()),
        occupation_key: "wayfinder".to_owned(),
        dialogue_state: BTreeMap::from([("greeting".to_owned(), 3)]),
        reputation_milli: 1_250,
    });
    components
        .unknown_extensions
        .insert("future:雪".to_owned(), vec![0, 1, 0x7f, 0x80, 0xfe, 0xff]);
    components
}

#[test]
fn authority_snapshot_is_exact_complete_and_forward_compatible() {
    let mut authority = EntityAuthority::default();
    let mut source = record(90);
    source.external_entity_id = "mob-雪-🐉".to_owned();
    source.name = Some("Aurélia".to_owned());
    source.owner_id = Some("keeper-δ".to_owned());
    source.ever_led = true;
    source.social_group_id = Some("群れ-α".to_owned());
    source.equipment.insert("crest".to_owned(), "sky-龍-crest".to_owned());
    let components = rich_components(&source);
    let id = command(
        &mut authority,
        1_000,
        EntityCommand::SpawnTypedAt {
            id: EntityId::new(42, 9),
            record: source.clone(),
            components: components.clone(),
            residency: EntityResidency::Hot,
        },
    )
    .entity_id;
    command(&mut authority, 1_100, EntityCommand::Hibernate { id });
    let bytes = encode_entity_authority_snapshot(&authority).expect("snapshot encode");
    let restored = decode_entity_authority_snapshot(&bytes).expect("snapshot decode");
    assert_eq!(encode_entity_authority_snapshot(&restored).expect("re-encode"), bytes);
    assert_eq!(restored.cold()[&id].record, source);
    assert_eq!(restored.cold()[&id].components, components);
    assert_eq!(
        restored.cold()[&id].components.unknown_extensions["future:雪"],
        vec![0, 1, 0x7f, 0x80, 0xfe, 0xff]
    );
    assert_eq!(restored.canonical_hash(), authority.canonical_hash());
}

#[test]
fn compatibility_codec_is_byte_exact_for_legacy_high_bytes() {
    let mut source = record(4);
    source.name = Some("Þorn — 雪".to_owned());
    source.custom.insert("opaque".to_owned(), "\u{0000}ÿ".to_owned());
    let bytes = encode_compatibility_record(&source).expect("compatibility encode");
    let restored = decode_compatibility_record(&bytes).expect("compatibility decode");
    assert_eq!(restored, source);
    assert_eq!(
        encode_compatibility_record(&restored).expect("compatibility re-encode"),
        bytes
    );

    let mut invalid_utf8 = bytes.clone();
    // BWEC magic + compatibility schema + first string length.
    invalid_utf8[10] = 0xff;
    assert!(matches!(
        decode_compatibility_record(&invalid_utf8),
        Err(SnapshotError::InvalidUtf8)
    ));
    let mut oversized = bytes;
    oversized[6..10].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(matches!(
        decode_compatibility_record(&oversized),
        Err(SnapshotError::LimitExceeded("string"))
    ));
}

#[test]
fn snapshot_rejects_truncation_trailing_bytes_and_tombstone_corruption() {
    let mut authority = EntityAuthority::default();
    spawn(&mut authority, record(1), EntityResidency::Hot, 1);
    let bytes = encode_entity_authority_snapshot(&authority).expect("snapshot");
    for length in 0..bytes.len() {
        assert!(
            decode_entity_authority_snapshot(&bytes[..length]).is_err(),
            "accepted prefix {length}"
        );
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(matches!(
        decode_entity_authority_snapshot(&trailing),
        Err(SnapshotError::TrailingBytes)
    ));
    let mut bad_magic = bytes.clone();
    bad_magic[0] ^= 0xff;
    assert!(matches!(
        decode_entity_authority_snapshot(&bad_magic),
        Err(SnapshotError::InvalidMagic)
    ));
    let mut bad_reserved = bytes;
    // Header is magic(4), schema(2), revision(8), optional-sequence flag/value(9), slot count(4).
    bad_reserved[27] = 1;
    assert!(matches!(
        decode_entity_authority_snapshot(&bad_reserved),
        Err(SnapshotError::InvalidData("reserved slot is not canonical"))
    ));

    let mut oversized_slots = encode_entity_authority_snapshot(&authority).expect("snapshot");
    oversized_slots[23..27].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(matches!(
        decode_entity_authority_snapshot(&oversized_slots),
        Err(SnapshotError::LimitExceeded("slot count"))
    ));
}

#[test]
fn stale_scheduler_ecology_and_path_results_are_rejected() {
    let id = EntityId::new(5, 3);
    let mut scheduler = EntityScheduler::default();
    scheduler.upsert(id, SimulationTier::Nearby, 7, 100);
    let token = scheduler.due_jobs(102, 1)[0];
    assert_eq!(
        scheduler.complete(token, 8, 102),
        Err(ScheduleCompletionError::StaleEntityRevision)
    );
    scheduler.upsert(id, SimulationTier::Nearby, 8, 102);
    assert_eq!(
        scheduler.complete(token, 7, 102),
        Err(ScheduleCompletionError::StaleEntityRevision)
    );

    let mut ecology = EcologyJobQueue::default();
    let ecology_token = ecology.schedule([-1, 4], 12, 200).expect("ecology schedule");
    ecology.schedule([-1, 4], 13, 200).expect("ecology reschedule");
    assert_eq!(
        ecology.complete(ecology_token, 12, 200, 400),
        Err(WorkTokenError::StaleRevision)
    );

    let mut paths = PathJobQueue::default();
    let path_token = paths
        .submit(PathJobSubmission {
            id,
            entity_revision: 9,
            route_epoch: 2,
            due_tick: 300,
            priority: 7,
            origin: Vec3::ZERO,
            goal: Vec3::new(8.0, 0.0, 2.0),
        })
        .expect("path schedule");
    assert_eq!(
        paths.accept(path_token, EntityId::new(5, 4), 9, 2, vec![Vec3::ZERO]),
        Err(WorkTokenError::StaleGenerationOrIdentity)
    );
    assert_eq!(
        paths.accept(path_token, id, 10, 2, vec![Vec3::ZERO]),
        Err(WorkTokenError::StaleRevision)
    );
    let accepted = paths
        .accept(path_token, id, 9, 2, vec![Vec3::ZERO, Vec3::new(8.0, 0.0, 2.0)])
        .expect("fresh path result");
    assert_eq!(accepted.points.len(), 2);
}

#[test]
fn typed_component_command_failure_is_atomic() {
    let mut authority = EntityAuthority::default();
    let id = spawn(&mut authority, record(1), EntityResidency::Hot, 0);
    let before = encode_entity_authority_snapshot(&authority).expect("before");
    let mut invalid = authority.components(id).expect("components").clone();
    invalid.locomotion.radius = f32::NAN;
    let batch = EntityCommandBatch {
        schema: ENTITY_COMMAND_SCHEMA,
        sequence: authority.revision() + 1,
        expected_revision: authority.revision(),
        tick: 10,
        commands: vec![
            EntityCommand::SetCareState {
                id,
                value: Some(CareState {
                    stabilized: true,
                    nourishment_milli: 1,
                    trust_milli: 2,
                    care_stage: 1,
                    last_care_tick: 10,
                }),
            },
            EntityCommand::ReplaceComponents { id, value: invalid },
        ],
    };
    assert!(authority.apply_batch(&batch).is_err());
    assert_eq!(encode_entity_authority_snapshot(&authority).expect("after"), before);
}

#[test]
fn compatibility_physics_initializes_and_replaces_typed_locomotion() {
    let mut authority = EntityAuthority::default();
    let mut source = record(2);
    source.custom.insert("physics.grounded".to_owned(), "false".to_owned());
    source.custom.insert("physics.inLiquid".to_owned(), "true".to_owned());
    let id = spawn(&mut authority, source, EntityResidency::Hot, 0);

    let initial = authority.components(id).expect("initial typed components");
    assert!(!initial.locomotion.grounded);
    assert!(initial.locomotion.submerged);

    let mut replacement = authority.hot()[&id].record.clone();
    replacement
        .custom
        .insert("physics.grounded".to_owned(), "true".to_owned());
    replacement
        .custom
        .insert("physics.inLiquid".to_owned(), "false".to_owned());
    command(
        &mut authority,
        1,
        EntityCommand::ReplaceCompatibilityRecord {
            id,
            value: replacement.clone(),
        },
    );

    let replaced = authority.components(id).expect("replaced typed components");
    assert!(replaced.locomotion.grounded);
    assert!(!replaced.locomotion.submerged);

    replacement.custom.remove("physics.grounded");
    replacement.custom.remove("physics.inLiquid");
    command(
        &mut authority,
        2,
        EntityCommand::ReplaceCompatibilityRecord { id, value: replacement },
    );
    let preserved = authority.components(id).expect("preserved typed components");
    assert!(preserved.locomotion.grounded);
    assert!(!preserved.locomotion.submerged);

    replacement = authority.hot()[&id].record.clone();
    replacement
        .custom
        .insert("physics.grounded".to_owned(), "not-a-bool".to_owned());
    replacement.custom.insert("physics.inLiquid".to_owned(), "1".to_owned());
    command(
        &mut authority,
        3,
        EntityCommand::ReplaceCompatibilityRecord { id, value: replacement },
    );
    let malformed = authority
        .components(id)
        .expect("malformed values preserve typed components");
    assert!(malformed.locomotion.grounded);
    assert!(!malformed.locomotion.submerged);
}

#[test]
fn one_hundred_legacy_records_round_trip_without_remap_or_reroll() {
    let mut authority = EntityAuthority::default();
    let records: Vec<_> = (1..=100)
        .map(|index| {
            let mut value = record(index);
            value.external_entity_id = format!("legacy-雪-{index}");
            value.specimen_id = format!("specimen-α-{index}");
            value.variant_key = (index % 3 == 0).then(|| "silver".to_owned());
            value.owner_id = (index % 7 == 0).then(|| format!("keeper-{index}"));
            value.custom.insert("opaque".to_owned(), format!("v\u{0000}{index}"));
            value
        })
        .collect();
    let commands: Vec<_> = records
        .iter()
        .enumerate()
        .map(|(offset, record)| EntityCommand::SpawnAt {
            id: EntityId::new(offset as u32 + 11, (offset % 5) as u32 + 1),
            record: record.clone(),
            residency: if offset % 9 == 0 {
                EntityResidency::Cold
            } else {
                EntityResidency::Hot
            },
        })
        .collect();
    authority
        .apply_batch(&EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 1_200,
            commands,
        })
        .expect("100-record import");
    let first = encode_entity_authority_snapshot(&authority).expect("first snapshot");
    let second = encode_entity_authority_snapshot(&authority).expect("second snapshot");
    assert_eq!(first, second);
    let restored = decode_entity_authority_snapshot(&first).expect("100-record restore");
    assert_eq!(
        encode_entity_authority_snapshot(&restored).expect("100-record re-encode"),
        first
    );
    for (offset, expected) in records.iter().enumerate() {
        let id = EntityId::new(offset as u32 + 11, (offset % 5) as u32 + 1);
        assert_eq!(restored.compatibility_record(id), Some(expected));
        let legacy = encode_compatibility_record(expected).expect("legacy export");
        assert_eq!(decode_compatibility_record(&legacy).expect("legacy import"), *expected);
    }
}

#[test]
fn hibernate_and_wake_preserve_exact_record() {
    let mut authority = EntityAuthority::default();
    let mut source = record(1);
    source.custom.insert("dragon-stage".to_owned(), "3".to_owned());
    let id = spawn(&mut authority, source.clone(), EntityResidency::Hot, 10);
    command(&mut authority, 20, EntityCommand::Hibernate { id });
    assert_eq!(authority.cold()[&id].record, source);
    assert_eq!(authority.cold()[&id].summary.slept_at_tick, 20);
    command(
        &mut authority,
        30,
        EntityCommand::Wake {
            id,
            tier: SimulationTier::Hero,
        },
    );
    assert_eq!(authority.hot()[&id].record, source);
    assert_eq!(authority.hot()[&id].tier, SimulationTier::Hero);
}

#[test]
fn broadphase_is_insertion_order_independent_at_cell_edges() {
    let entries = [
        EntityBroadphaseEntry {
            id: EntityId::new(7, 1),
            center: Vec3::new(7.9, 0.0, 0.0),
            radius: 0.4,
            half_height: 0.7,
        },
        EntityBroadphaseEntry {
            id: EntityId::new(2, 1),
            center: Vec3::new(8.3, 0.0, 0.0),
            radius: 0.4,
            half_height: 0.7,
        },
    ];
    let mut first = EntityBroadphase::new(8.0).expect("index");
    first.rebuild(entries).expect("rebuild");
    let mut second = EntityBroadphase::new(8.0).expect("index");
    second.rebuild(entries.into_iter().rev()).expect("rebuild");
    let expected = vec![EntityId::new(2, 1), EntityId::new(7, 1)];
    assert_eq!(first.query_xz_overlap(Vec3::new(8.1, 0.0, 0.0), 0.05), expected);
    assert_eq!(second.query_xz_overlap(Vec3::new(8.1, 0.0, 0.0), 0.05), expected);
}

#[test]
fn broadphase_3d_queries_respect_height() {
    let id = EntityId::new(1, 1);
    let mut index = EntityBroadphase::new(4.0).expect("index");
    index
        .upsert(EntityBroadphaseEntry {
            id,
            center: Vec3::new(0.0, 10.0, 0.0),
            radius: 0.5,
            half_height: 1.0,
        })
        .expect("entry");
    assert_eq!(index.query_xz_overlap(Vec3::ZERO, 0.1), vec![id]);
    assert!(index.query_sphere(Vec3::ZERO, 1.0).is_empty());
    assert_eq!(index.query_sphere(Vec3::new(0.0, 8.6, 0.0), 0.5), vec![id]);
}

#[test]
fn broadphase_matches_brute_force_for_deterministic_corpus() {
    let mut index = EntityBroadphase::new(5.0).expect("index");
    let entries: Vec<_> = (1..=200)
        .map(|raw| {
            let x = ((raw * 37) % 113) as f32 - 56.0;
            let z = ((raw * 71) % 127) as f32 - 63.0;
            EntityBroadphaseEntry {
                id: EntityId::new(raw, 1),
                center: Vec3::new(x, 0.0, z),
                radius: 0.2 + (raw % 5) as f32 * 0.13,
                half_height: 0.7,
            }
        })
        .collect();
    index.rebuild(entries.iter().copied()).expect("rebuild");
    for query in 0..40 {
        let center = Vec3::new(query as f32 * 2.3 - 40.0, 0.0, query as f32 * -1.7 + 32.0);
        let radius = 3.0 + (query % 7) as f32;
        let expected: Vec<_> = entries
            .iter()
            .filter(|entry| {
                let dx = entry.center.x - center.x;
                let dz = entry.center.z - center.z;
                dx.mul_add(dx, dz * dz) <= (radius + entry.radius).powi(2)
            })
            .map(|entry| entry.id)
            .collect();
        assert_eq!(index.query_xz_overlap(center, radius), expected);
    }
}

#[test]
fn scheduler_staggers_and_orders_due_work() {
    let mut scheduler = EntityScheduler::default();
    for raw in [9, 2, 7, 1] {
        scheduler.upsert(EntityId::new(raw, 1), SimulationTier::Nearby, 1, 100);
    }
    scheduler.upsert(EntityId::new(3, 1), SimulationTier::Dormant, 1, 100);
    let due = scheduler.due_jobs(101, 3);
    assert_eq!(
        due.iter().map(|job| job.id).collect::<Vec<_>>(),
        vec![EntityId::new(2, 1), EntityId::new(1, 1), EntityId::new(7, 1)]
    );
    for job in due {
        scheduler.complete(job, 1, 101).expect("fresh schedule token");
        assert_eq!(scheduler.state(job.id).expect("state").next_due_tick, 103);
    }
}

#[test]
fn inverse_mass_separation_conserves_total_penetration() {
    let share = split_separation(1.5, 1.0, 3.0);
    assert_close(share.first, 1.125);
    assert_close(share.second, 0.375);
    assert_close(share.first + share.second, 1.5);
    assert!(
        creature_body_mass(BodyMassProfile {
            size: CreatureSizeClass::Large,
            radius: 0.9,
            height: 2.1,
        }) > creature_body_mass(BodyMassProfile {
            size: CreatureSizeClass::Small,
            radius: 0.2,
            height: 0.4,
        })
    );
}

#[test]
fn coincident_separation_is_stable_and_finite() {
    let body = CircleBody {
        x: 2.0,
        z: 2.0,
        radius: 0.5,
    };
    let first = separate_circles(body, body, 0.06, 17).expect("overlap");
    let second = separate_circles(body, body, 0.06, 17).expect("overlap");
    assert_eq!(first, second);
    assert!(first.dx.is_finite() && first.dz.is_finite());
    assert_close(first.dx.hypot(first.dz), first.overlap);
}

#[test]
fn separation_batch_is_pairwise_and_order_independent() {
    let first = EntityId::new(1, 1);
    let second = EntityId::new(2, 1);
    let third = EntityId::new(3, 1);
    let bodies = BTreeMap::from([
        (
            third,
            (
                CircleBody {
                    x: 0.7,
                    z: 0.0,
                    radius: 0.5,
                },
                2.0,
            ),
        ),
        (
            first,
            (
                CircleBody {
                    x: 0.0,
                    z: 0.0,
                    radius: 0.5,
                },
                1.0,
            ),
        ),
        (
            second,
            (
                CircleBody {
                    x: 0.35,
                    z: 0.0,
                    radius: 0.5,
                },
                1.0,
            ),
        ),
    ]);
    let corrections = resolve_separation_batch(&bodies, 0.0);
    assert_eq!(corrections.len(), 3);
    assert!(corrections.values().all(|value| value.is_finite()));
}

#[test]
fn social_motion_and_sensing_are_stably_ordered() {
    let members = [
        SocialMember {
            id: EntityId::new(9, 1),
            position: Vec3::new(2.0, 0.0, 0.0),
            velocity: Vec3::new(1.0, 0.0, 0.0),
        },
        SocialMember {
            id: EntityId::new(2, 1),
            position: Vec3::new(0.0, 0.0, 0.0),
            velocity: Vec3::new(0.0, 0.0, 1.0),
        },
        SocialMember {
            id: EntityId::new(5, 1),
            position: Vec3::new(1.0, 0.0, 1.0),
            velocity: Vec3::new(-1.0, 0.0, 0.0),
        },
    ];
    let first = plan_social_motion(&members, SocialMode::Herd);
    let second = plan_social_motion(&members.into_iter().rev().collect::<Vec<_>>(), SocialMode::Herd);
    assert_eq!(first, second);
    assert!(first.windows(2).all(|pair| pair[0].id < pair[1].id));

    let targets = [
        SenseTarget {
            id: EntityId::new(8, 1),
            position: Vec3::new(1.0, 0.0, 0.0),
            detectable: true,
            priority: 0,
        },
        SenseTarget {
            id: EntityId::new(3, 1),
            position: Vec3::new(2.0, 0.0, 0.0),
            detectable: true,
            priority: 4,
        },
        SenseTarget {
            id: EntityId::new(1, 1),
            position: Vec3::new(0.5, 0.0, 0.0),
            detectable: false,
            priority: 9,
        },
    ];
    let hits = sense_targets(Vec3::ZERO, 3.0, &targets, 2);
    assert_eq!(
        hits.iter().map(|hit| hit.id).collect::<Vec<_>>(),
        vec![EntityId::new(3, 1), EntityId::new(8, 1)]
    );
}

#[test]
fn follower_formation_does_not_depend_on_input_order() {
    let members = [
        FollowerMember {
            id: EntityId::new(8, 1),
            radius: 0.8,
        },
        FollowerMember {
            id: EntityId::new(1, 1),
            radius: 0.3,
        },
        FollowerMember {
            id: EntityId::new(4, 1),
            radius: 0.5,
        },
    ];
    let first = plan_follower_formation(Vec3::new(4.0, 0.0, -3.0), 0.7, &members);
    let second = plan_follower_formation(
        Vec3::new(4.0, 0.0, -3.0),
        0.7,
        &members.into_iter().rev().collect::<Vec<_>>(),
    );
    assert_eq!(first, second);
    assert!(first.iter().all(|target| target.arrival_radius >= 0.42));
}

#[test]
fn protection_lifecycle_matches_lead_fence_and_natural_rules() {
    let active = range_lifecycle(RangeLifecycleInput {
        protection: ProtectionState::default(),
        distance: 10.0,
        simulation_radius: 32.0,
        out_of_range_seconds: 20.0,
        elapsed_seconds: 1.0,
    });
    assert_eq!(active.action, RangeAction::Active);
    let natural = range_lifecycle(RangeLifecycleInput {
        distance: 80.0,
        simulation_radius: 32.0,
        out_of_range_seconds: 44.5,
        elapsed_seconds: 0.5,
        ..RangeLifecycleInput {
            protection: ProtectionState::default(),
            distance: 0.0,
            simulation_radius: 0.0,
            out_of_range_seconds: 0.0,
            elapsed_seconds: 0.0,
        }
    });
    assert_eq!(natural.action, RangeAction::Despawn);
    let protected = range_lifecycle(RangeLifecycleInput {
        protection: ProtectionState::from_bits(ProtectionState::EVER_LED),
        distance: 80.0,
        simulation_radius: 32.0,
        out_of_range_seconds: 100.0,
        elapsed_seconds: 10.0,
    });
    assert_eq!(protected.action, RangeAction::Sleep);
    assert_close(protected.out_of_range_seconds, 0.0);
}

#[test]
fn population_budgets_and_spawn_admission_honor_ceilings() {
    let budgets = natural_pool_budgets(false, 1.0);
    assert_close(budgets[&NaturalPool::SurfaceAnimal].target, 12.0);
    assert_close(global_natural_cost_ceiling(false, 1.0, 4), 184.0);
    let mut snapshot = PopulationSnapshot::default();
    snapshot.add(NaturalPool::SurfaceAnimal, 16.0, 16);
    let candidates = [SpawnCandidate {
        candidate_id: 1,
        kind_key: "woolhorn".to_owned(),
        pool: NaturalPool::SurfaceAnimal,
        center: Vec3::ZERO,
        creature_cost: 1.0,
        requested_count: 4,
        eligibility_roll: 0.1,
        spawn_probability: 1.0,
        priority: 1,
    }];
    assert!(admit_spawns(&candidates, &snapshot, &budgets, 92.0, 4).is_empty());

    let admissions = admit_spawns(&candidates, &PopulationSnapshot::default(), &budgets, 2.0, 4);
    assert_eq!(admissions[0].count, 2);
    assert_close(admissions[0].admitted_cost, 2.0);
}

#[test]
fn ecology_pressure_recovers_over_days() {
    let sector = EcologySector::default().record_kill("woolhorn", 2.0, 0);
    assert!(sector.species_spawn_multiplier("woolhorn", 0) < 1.0);
    let recovered = sector.species_spawn_multiplier("woolhorn", TICKS_PER_DAY * 3);
    assert_close(recovered, 1.0);
    assert_eq!(ecology_sector_key(-1, -65), [-1, -2]);
}

fn enclosure_ring() -> BTreeSet<EnclosureCell> {
    let mut barriers = BTreeSet::new();
    for coordinate in -2..=2 {
        barriers.insert(EnclosureCell { x: coordinate, z: -2 });
        barriers.insert(EnclosureCell { x: coordinate, z: 2 });
        barriers.insert(EnclosureCell { x: -2, z: coordinate });
        barriers.insert(EnclosureCell { x: 2, z: coordinate });
    }
    barriers
}

#[test]
fn crafted_enclosure_requires_a_closed_bounded_ring() {
    let barriers = enclosure_ring();
    let closed = scan_crafted_enclosure(EnclosureCell { x: 0, z: 0 }, &barriers, EnclosureOptions::default());
    assert!(closed.enclosed);
    assert_eq!(closed.interior.len(), 9);
    let mut open = barriers;
    open.remove(&EnclosureCell { x: 0, z: 2 });
    let open_scan = scan_crafted_enclosure(EnclosureCell { x: 0, z: 0 }, &open, EnclosureOptions::default());
    assert!(!open_scan.enclosed);
}

#[test]
fn breeding_pair_selection_is_stable_and_species_safe() {
    let candidates = [
        BreedingCandidate {
            id: EntityId::new(8, 1),
            kind_key: "woolhorn".to_owned(),
            sex: CreatureSex::Male,
            position: Vec3::new(1.0, 0.0, 0.0),
            adult: true,
            bonded: true,
            well_fed: true,
            cooldown_until_tick: 0,
        },
        BreedingCandidate {
            id: EntityId::new(2, 1),
            kind_key: "woolhorn".to_owned(),
            sex: CreatureSex::Female,
            position: Vec3::ZERO,
            adult: true,
            bonded: true,
            well_fed: true,
            cooldown_until_tick: 0,
        },
        BreedingCandidate {
            id: EntityId::new(3, 1),
            kind_key: "petalfox".to_owned(),
            sex: CreatureSex::Female,
            position: Vec3::ZERO,
            adult: true,
            bonded: true,
            well_fed: true,
            cooldown_until_tick: 0,
        },
    ];
    let first = plan_breeding_pairs(&candidates, 1_000, 4.0);
    let second = plan_breeding_pairs(&candidates.into_iter().rev().collect::<Vec<_>>(), 1_000, 4.0);
    assert_eq!(first, second);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].kind_key, "woolhorn");
}

#[test]
fn dormant_ecology_is_bounded_and_never_kills_protected_population() {
    let summary = DormantPopulationSummary {
        last_updated_tick: 0,
        population_by_kind: BTreeMap::from([("petalfox".to_owned(), 10)]),
        protected_by_kind: BTreeMap::from([("petalfox".to_owned(), 4)]),
        births: 0,
        deaths: 0,
    };
    let policy = DormantAdvancePolicy {
        carrying_capacity: 12,
        births_per_thousand_per_day: 200,
        deaths_per_thousand_per_day: 500,
        maximum_days_per_advance: 2,
    };
    let advanced = advance_dormant_population(&summary, TICKS_PER_DAY * 100, policy);
    assert_eq!(advanced.last_updated_tick, TICKS_PER_DAY * 2);
    assert!(advanced.population_by_kind["petalfox"] >= 4);
    assert!(advanced.population_by_kind["petalfox"] <= 12);
}

#[test]
fn model_graph_validates_connected_authored_parts_and_hashes_stably() {
    let graph = fixture_model_graph();
    graph.validate().expect("fixture graph");
    assert_eq!(graph.canonical_hash(), fixture_model_graph().canonical_hash());
    let mut broken = graph;
    broken.nodes[1].parent = Some(4);
    assert!(matches!(broken.validate(), Err(ModelError::InvalidParent(1))));
}

#[test]
fn model_registry_rejects_duplicates_and_bad_animation() {
    let mut registry = ModelRegistry::default();
    registry.insert(fixture_model_graph()).expect("first");
    assert!(matches!(
        registry.insert(fixture_model_graph()),
        Err(ModelError::DuplicateModel(_))
    ));
    let mut bad = fixture_model_graph();
    bad.key = "bad-animation".to_owned();
    bad.animations[0].channels[0].keyframes[1].time_millis = 0;
    assert_eq!(bad.validate(), Err(ModelError::InvalidAnimation));
}

#[test]
fn render_admission_is_bounded_stable_and_keeps_critical_heroes() {
    let candidates: Vec<_> = (1..=100)
        .map(|raw| RenderCandidate {
            id: EntityId::new(raw, 1),
            distance: raw as f32,
            projected_size: 1.0 / raw as f32,
            in_frustum: raw % 3 != 0,
            critical: raw == 100,
            important: raw % 17 == 0,
            engaged: raw % 23 == 0,
        })
        .collect();
    let mut controller = RenderAdmissionController::default();
    let diagnostics = controller.evaluate(
        &candidates,
        RenderPressure {
            average_frame_milliseconds: 42.0,
            draw_calls: 800,
            low_resource_mode: true,
        },
        2_000,
    );
    assert_eq!(diagnostics.hero_budget, 4);
    assert_eq!(controller.tier_for(EntityId::new(100, 1)), RenderTier::Hero);
    let heroes = candidates
        .iter()
        .filter(|candidate| controller.tier_for(candidate.id) == RenderTier::Hero)
        .count();
    assert!(heroes >= 1);
    assert!(
        heroes <= 6,
        "critical heroes may exceed the normal budget, but not this corpus"
    );
}

#[test]
fn render_extraction_preserves_tiers_models_and_stable_id_order() {
    let mut registry = ModelRegistry::default();
    registry.insert(fixture_model_graph()).expect("model");
    let input = |raw, tier| RenderEntityInput {
        id: EntityId::new(raw, 1),
        kind_key: "fixture".to_owned(),
        model_key: "fixture:block-creature".to_owned(),
        transform: Transform {
            translation: Vec3::new(raw as f32, 0.0, 0.0),
            ..Transform::IDENTITY
        },
        tier,
        pose: PoseParameters::default(),
        primary_color: ColorRgba8::WHITE,
        accent_color: ColorRgba8::WHITE,
        visible: true,
    };
    let frame = extract_render_frame(
        12,
        &[
            input(8, RenderTier::Silhouette),
            input(1, RenderTier::Hero),
            input(4, RenderTier::Articulated),
            input(2, RenderTier::Hidden),
        ],
        &registry,
    )
    .expect("extract");
    assert_eq!(frame.heroes[0].id, EntityId::new(1, 1));
    assert_eq!(frame.articulated[0].id, EntityId::new(4, 1));
    assert_eq!(frame.articulated[0].node_indices, vec![0, 1, 2, 3, 4, 5]);
    assert_eq!(frame.silhouettes[0].id, EntityId::new(8, 1));
    assert_eq!(frame.hidden_count, 1);
}

#[test]
fn canonical_entity_fixture_is_repeatable_at_one_hundred_creatures() {
    let first = run_entity_fixture(100).expect("fixture");
    let second = run_entity_fixture(100).expect("fixture");
    assert_eq!(first, second);
    assert_eq!(first.hot_count, 88);
    assert_eq!(first.cold_count, 12);
    assert_eq!(first.entity_count, 100);
    assert_eq!(
        first.hero_count + first.articulated_count + first.silhouette_count + first.hidden_count,
        100
    );
    assert_eq!(
        first.canonical_summary(),
        include_str!("../fixtures/entity-100-v1.txt").trim()
    );
}

#[test]
fn native_workload_hook_returns_a_stable_checksum() {
    let first = run_entity_workload(32, 3).expect("workload");
    let second = run_entity_workload(32, 3).expect("workload");
    assert_eq!(first, second);
    assert_ne!(first.checksum.to_hex(), "00000000000000000000000000000000");
}
