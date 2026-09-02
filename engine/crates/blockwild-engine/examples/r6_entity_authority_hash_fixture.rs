//! Complete native semantic-state vectors, including rich typed and allocator state.
use std::{collections::BTreeMap, env, fs, path::PathBuf};

use blockwild_engine::{
    EntityAuthorityImportReceiptWireV1, EntityAuthorityImportWireV2, encode_entity_authority_import_receipt_v1,
    encode_entity_authority_import_v2,
};
use blockwild_entity::*;
use blockwild_types::{EntityId, LocationId};

fn source(suffix: &str) -> EntityCompatibilityRecord {
    let mut record =
        EntityCompatibilityRecord::new(format!("entity:{suffix}:雪:🦀"), format!("specimen:{suffix}:Ω"), "wyrm");
    record.legacy_numeric_id = Some(u64::MAX);
    record.class = EntityClass::Sentient;
    record.variant_key = Some("\u{feff}variant:🌿".into());
    record.name = Some("\u{feff}".into());
    record.location_id = LocationId::new(u32::MAX, u32::MAX);
    record.position = Vec3::new(-0.0, f32::from_bits(1), f32::MAX);
    record.yaw = -0.75;
    record.velocity = Vec3::new(-0.0, 0.0, -0.125);
    record.health = 0.5;
    record.maximum_health = 1.5;
    record.age_ticks = u64::MAX;
    record.natural_spawned = true;
    record.ever_led = true;
    record.owner_id = Some("owner:雪".into());
    record.tamed = true;
    record.bond_points = u32::MAX;
    record.bond_tier = "bound".into();
    record.social_group_id = Some("group:Ω".into());
    record.faction_id = Some("faction:é".into());
    record.settlement_id = Some("settlement:🌿".into());
    record.equipment = BTreeMap::from([("crest".into(), "sky-crest".into())]);
    record.research = BTreeMap::from([("\u{e000}".into(), u32::MAX), ("\u{10000}".into(), 0)]);
    record.custom = BTreeMap::from([
        ("\u{e000}".into(), "\0\u{80}ÿ".into()),
        ("\u{feff}".into(), "\u{feff}snow:雪".into()),
        ("\u{10000}".into(), "snow:雪".into()),
    ]);
    record
}

fn components(record: &EntityCompatibilityRecord) -> EntityComponents {
    let mut value = EntityComponents::from_compatibility(record, ProtectionState::from_bits(u64::MAX));
    value.vitals.hunger_milli = 9_999;
    value.vitals.saturation_milli = 4_321;
    value.vitals.oxygen_milli = 1;
    value.vitals.temperature_milli = i16::MIN;
    value.vitals.wetness_milli = 8_765;
    value.vitals.environment_flags = u32::MAX;
    value.vitals.last_damage_tick = u64::MAX;
    value.vitals.last_breath_tick = u64::MAX - 1;
    value.locomotion.shape = BodyShape::Aquatic;
    value.locomotion.radius = 0.625;
    value.locomotion.half_height = 1.25;
    value.locomotion.mass = 1_024.5;
    value.locomotion.step_height = -0.0;
    // Native Vec3 mirrors allow different zero signs but the hash retains both.
    value.locomotion.velocity = Vec3::new(0.0, -0.0, -0.125);
    value.locomotion.desired_velocity = Vec3::new(f32::from_bits(1), -f32::from_bits(1), 0.5);
    value.locomotion.grounded = true;
    value.locomotion.submerged = true;
    value.locomotion.movement_mode = MovementMode::Mounted;
    value.locomotion.action = ActionState {
        key: "action:雪".into(),
        phase: u16::MAX,
        started_tick: u64::MAX - 9,
        ends_tick: u64::MAX,
        target: Some(EntityId::new(9, 2)),
    };
    value.locomotion.cooldowns = BTreeMap::from([("\u{e000}".into(), u64::MAX), ("\u{10000}".into(), 0)]);
    value.ai.intent = AiIntentKind::Scripted;
    value.ai.intent_key = "intent:Ω".into();
    value.ai.target = Some(EntityId::new(11, 3));
    value.ai.home = Vec3::new(-0.0, -2.25, 8.5);
    value.ai.blackboard = BTreeMap::from([
        ("\u{e000}".into(), BlackboardValue::Bool(true)),
        ("\u{10000}".into(), BlackboardValue::Signed(i64::MIN)),
        ("unsigned".into(), BlackboardValue::Unsigned(u64::MAX)),
        ("fixed".into(), BlackboardValue::FixedMilli(i64::MAX)),
        ("text".into(), BlackboardValue::Text("雪:🦀".into())),
        (
            "entity".into(),
            BlackboardValue::Entity(EntityId::new(u32::MAX, u32::MAX)),
        ),
        ("bytes".into(), BlackboardValue::Bytes(vec![0, 127, 128, 255])),
    ]);
    value.ai.route_epoch = u64::MAX;
    value.ai.route_cursor = 1;
    value.ai.route = vec![Vec3::new(-0.0, 1.25, -3.5), Vec3::new(4.0, 5.5, 6.25)];
    value.ai.threats = vec![ThreatMemory {
        entity: EntityId::new(1, 1),
        score_milli: u32::MAX,
        last_seen_tick: u64::MAX,
        last_known_cell: [i32::MIN, 0, i32::MAX],
    }];
    value.ai.decision_due_tick = u64::MAX - 5;
    value.social.leader = Some(EntityId::new(2, 1));
    value.social.following = Some(EntityId::new(3, 1));
    value.social.herd_rank = i16::MIN;
    value.social.disposition_milli = i16::MAX;
    value.social.preferred_separation = -0.0;
    value.social.last_social_tick = u64::MAX - 2;
    value.mount.parent_mount = Some(EntityId::new(8, 3));
    value.mount.occupied_seat = Some(1);
    value.mount.seats = vec![
        MountSeat {
            index: 0,
            role: "pilot".into(),
            offset: Vec3::new(-0.0, 1.25, 0.0),
            occupant: None,
            control_weight_milli: 0,
        },
        MountSeat {
            index: 1,
            role: "passenger".into(),
            offset: Vec3::new(0.0, 2.5, -1.0),
            occupant: Some(EntityId::new(7, 4)),
            control_weight_milli: u16::MAX,
        },
    ];
    value.mount.saddle_key = Some("saddle:雪".into());
    value.mount.accepts_riders = true;
    value.protection.first_owned_tick = Some(0);
    value.protection.first_led_tick = Some(u64::MAX);
    value.protection.enclosure_verified_tick = Some(u64::MAX - 1);
    value.protection.named_tick = Some(9);
    value.protection.provenance_key = Some("provenance:Ω".into());
    value.network.owner_peer_id = Some("peer:雪".into());
    value.network.last_command_sequence = u64::MAX;
    value.network.last_command_tick = u64::MAX - 1;
    value.network.lease_epoch = u64::MAX - 2;
    value.network.lease_expires_tick = u64::MAX - 3;
    value.care = Some(CareState {
        stabilized: true,
        nourishment_milli: 9_999,
        trust_milli: 8_888,
        care_stage: u16::MAX,
        last_care_tick: u64::MAX,
    });
    value.husbandry = Some(HusbandryState {
        sex: 2,
        maturity_milli: 10_000,
        breed_cooldown_until_tick: u64::MAX,
        gestation_until_tick: u64::MAX - 1,
        parent_specimen_ids: vec!["parent:Ω".into(), "parent:雪".into()],
    });
    value.work = Some(WorkState {
        task_key: "work:Ω".into(),
        progress_milli: 1_234,
        target_entity: Some(EntityId::new(8, 2)),
        target_cell: Some([i32::MIN, i32::MAX, -1]),
        carrying_item_key: Some("item:雪".into()),
        due_tick: u64::MAX,
    });
    value.equipment = BTreeMap::from([(
        "crest".into(),
        EquipmentSlotState {
            item_key: "sky-crest".into(),
            count: u16::MAX,
            durability: u32::MAX,
            custom: BTreeMap::from([("\u{e000}".into(), vec![0, 128, 255]), ("\u{10000}".into(), vec![])]),
        },
    )]);
    value.dragon = Some(DragonState {
        lineage_key: "lineage:Ω".into(),
        element_key: "element:雪".into(),
        life_stage: u16::MAX,
        flight_stamina_milli: 9_999,
        breath_charge_milli: 8_888,
        egg_or_hatchling: true,
    });
    value.legendary = Some(LegendaryState {
        encounter_key: "encounter:雪".into(),
        phase: u16::MAX,
        defeated: true,
        capture_lock_until_tick: u64::MAX,
        world_flags: BTreeMap::from([("\u{e000}".into(), u64::MAX), ("\u{10000}".into(), 1)]),
    });
    value.summon = Some(SummonState {
        origin_realm_key: "realm:Ω".into(),
        summoner_id: Some("summoner:雪".into()),
        expires_tick: u64::MAX,
        grounded: true,
        grounding_item_key: Some("anchor:é".into()),
    });
    value.sentient = Some(SentientState {
        faction_id: Some("faction:Ω".into()),
        settlement_id: Some("settlement:雪".into()),
        occupation_key: "occupation:é".into(),
        dialogue_state: BTreeMap::from([("\u{e000}".into(), u32::MAX), ("\u{10000}".into(), 1)]),
        reputation_milli: i32::MIN,
    });
    value.unknown_extensions = BTreeMap::from([
        ("\u{e000}".into(), vec![0, 127, 128, 254, 255]),
        ("\u{10000}".into(), vec![]),
    ]);
    value
}

pub fn rich_authority() -> EntityAuthority {
    let mut authority = EntityAuthority::default();
    let hot_id = EntityId::new(6, u32::MAX);
    let cold_id = EntityId::new(2, 5);
    let removed_id = EntityId::new(4, 2);
    let hot_record = source("hot");
    let cold_record = source("cold");
    authority
        .apply_batch(&EntityCommandBatch {
            schema: 1,
            sequence: 1,
            expected_revision: 0,
            tick: 900,
            commands: vec![
                EntityCommand::SpawnTypedAt {
                    id: hot_id,
                    components: components(&hot_record),
                    record: hot_record,
                    residency: EntityResidency::Hot,
                },
                EntityCommand::SpawnTypedAt {
                    id: cold_id,
                    components: components(&cold_record),
                    record: cold_record,
                    residency: EntityResidency::Cold,
                },
                EntityCommand::SpawnAt {
                    id: removed_id,
                    record: EntityCompatibilityRecord::new("removed", "removed", "wyrm"),
                    residency: EntityResidency::Hot,
                },
                EntityCommand::Despawn {
                    id: removed_id,
                    reason: DespawnReason::Admin,
                },
                EntityCommand::SetRangeState {
                    id: hot_id,
                    out_of_range_seconds: -0.0,
                    last_simulated_tick: u64::MAX,
                },
                EntityCommand::SetSimulationTier {
                    id: hot_id,
                    tier: SimulationTier::Hero,
                },
                EntityCommand::SetDormantSummary {
                    id: cold_id,
                    value: DormantEntitySummary {
                        slept_at_tick: u64::MAX - 10,
                        last_advanced_tick: u64::MAX,
                        care_cycles: u32::MAX,
                        breeding_cycles: u32::MAX - 1,
                        work_cycles: u32::MAX - 2,
                        next_care_tick: u64::MAX - 1,
                        next_breeding_tick: u64::MAX - 2,
                        next_work_tick: u64::MAX - 3,
                        next_ecology_tick: u64::MAX - 4,
                        route_epoch: u64::MAX,
                        population_cost_quarters: u32::MAX,
                    },
                },
            ],
        })
        .unwrap();
    authority
}

fn header_variant(authority: &EntityAuthority, revision: u64, sequence: Option<u64>) -> EntityAuthority {
    let bytes = encode_entity_authority_snapshot(authority).unwrap();
    let tail = if bytes[14] == 1 { 23 } else { 15 };
    let mut changed = bytes[..6].to_vec();
    changed.extend_from_slice(&revision.to_le_bytes());
    changed.push(u8::from(sequence.is_some()));
    if let Some(sequence) = sequence {
        changed.extend_from_slice(&sequence.to_le_bytes());
    }
    changed.extend_from_slice(&bytes[tail..]);
    decode_entity_authority_snapshot(&changed).unwrap()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join("tests/fixtures/rust-engine/r6/entity-authority-hashes-v2.json")
}

pub fn fixture() -> String {
    let empty = EntityAuthority::default();
    let rich = rich_authority();
    let mut plain = EntityAuthority::default();
    let mut plain_record = EntityCompatibilityRecord::new("plain", "plain", "wyrm");
    // A compatibility bond tier is bounded text, not a required identity key.
    plain_record.bond_tier.clear();
    plain
        .apply_batch(&EntityCommandBatch {
            schema: 1,
            sequence: 1,
            expected_revision: 0,
            tick: 1,
            commands: vec![EntityCommand::Spawn {
                record: plain_record,
                residency: EntityResidency::Hot,
            }],
        })
        .unwrap();
    let vectors = [
        ("empty-none", empty.clone()),
        ("empty-some-zero", header_variant(&empty, 0, Some(0))),
        ("plain-optionals-absent", plain),
        ("rich-mixed-residency", rich.clone()),
        ("rich-max-cursors", header_variant(&rich, u64::MAX, Some(u64::MAX))),
        ("rich-no-sequence", header_variant(&rich, 1, None)),
    ];
    let mut result = String::from(
        "{\n  \"schema\": 2,\n  \"producer\": \"blockwild-engine/r6_entity_authority_hash_fixture\",\n  \"domain\": \"blockwild.entity.authority.v2\",\n  \"vectors\": [\n",
    );
    for (index, (name, authority)) in vectors.iter().enumerate() {
        let snapshot = encode_entity_authority_snapshot(authority).unwrap();
        let restored = decode_entity_authority_snapshot(&snapshot).unwrap();
        assert_eq!(restored.canonical_hash(), authority.canonical_hash());
        assert_eq!(encode_entity_authority_snapshot(&restored).unwrap(), snapshot);
        let request = encode_entity_authority_import_v2(&EntityAuthorityImportWireV2 {
            expected_revision: 0,
            snapshot: snapshot.clone(),
        })
        .unwrap();
        let receipt = encode_entity_authority_import_receipt_v1(EntityAuthorityImportReceiptWireV1 {
            previous_revision: 0,
            revision: authority.revision(),
            entity_count: authority.len() as u32,
            state_hash: authority.canonical_hash(),
        })
        .unwrap();
        result.push_str(&format!("    {{\"name\":\"{name}\",\"hash\":\"{}\",\"snapshotHex\":\"{}\",\"requestHex\":\"{}\",\"receiptHex\":\"{}\"}}{}\n",
            authority.canonical_hash().to_hex(), hex(&snapshot), hex(&request), hex(&receipt), if index + 1 == vectors.len() { "" } else { "," }));
    }
    result.push_str("  ]\n}\n");
    result
}

fn main() {
    let rendered = fixture();
    match env::args().nth(1).as_deref() {
        Some("--check") => {
            assert_eq!(
                fs::read_to_string(fixture_path()).unwrap().replace("\r\n", "\n"),
                rendered
            );
            println!("r6-entity-authority-hashes=ok");
        }
        Some("--write") => fs::write(fixture_path(), rendered).unwrap(),
        None => print!("{rendered}"),
        _ => panic!("usage: r6_entity_authority_hash_fixture [--check|--write]"),
    }
}
