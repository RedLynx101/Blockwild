//! Native-authored vectors for every R6 BWRQ/BWRS domain family.
//! This is codec evidence, not proof of normal-path authority promotion.
use std::{env, fs, path::PathBuf};

use blockwild_engine::*;
use blockwild_entity::{
    DespawnReason, DormantEntitySummary, EntityAuthority, EntityCommand, EntityCommandBatch, EntityCompatibilityRecord,
    EntityComponents, EntityEvent, EntityEventBatch, EntityEventKind, EntityResidency, ProtectionState, SimulationTier,
    Vec3, decode_compatibility_record, decode_entity_authority_snapshot, encode_compatibility_record,
    encode_entity_authority_snapshot,
};
use blockwild_runtime_wire::wire_checksum_v1;
use blockwild_types::{EntityId, LocationId};

const FIXTURE: &str = "tests/fixtures/rust-engine/integrated-runtime-v1/r6-entity-domain-wire-v1.json";

fn record() -> EntityCompatibilityRecord {
    let mut value = EntityCompatibilityRecord::new("entity:雪:🦀", "specimen:水:Ω", "wyrm");
    value.legacy_numeric_id = Some(u64::MAX);
    value.location_id = LocationId::new(u32::MAX, u32::MAX);
    value.position = Vec3::new(-125.5, 64.25, 1.5);
    value.velocity = Vec3::new(0.125, -0.25, 0.5);
    value.yaw = -0.75;
    value.health = 0.5;
    value.maximum_health = 1.0;
    value.age_ticks = u64::MAX - 1;
    value.name = Some("é:水:🐲".into());
    value.variant_key = Some("雪".into());
    value.research.insert("research:Ω".into(), u32::MAX);
    value.custom.insert("future:雪".into(), "\u{ff}:🦀".into());
    value
}

fn commands(record: &EntityCompatibilityRecord) -> EntityCommandBatch {
    let id = EntityId::new(u32::MAX, u32::MAX);
    let mut components = EntityComponents::from_compatibility(record, ProtectionState::from_bits(0x12));
    components
        .unknown_extensions
        .insert("future:雪".into(), vec![0, 0x80, 0xff]);
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
    EntityCommandBatch {
        schema: 1,
        sequence: u64::MAX,
        expected_revision: u64::MAX - 1,
        tick: u64::MAX - 2,
        commands: vec![
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
                position: record.position,
                yaw: record.yaw,
                velocity: record.velocity,
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
            EntityCommand::ReplaceCompatibilityRecord {
                id,
                value: record.clone(),
            },
            EntityCommand::SetRangeState {
                id,
                out_of_range_seconds: 12.5,
                last_simulated_tick: u64::MAX,
            },
            EntityCommand::SetDormantSummary { id, value: dormant },
        ],
    }
}

fn events() -> EntityEventBatch {
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
    EntityEventBatch {
        schema: 1,
        sequence: u64::MAX,
        previous_revision: u64::MAX - 1,
        revision: u64::MAX,
        events: kinds
            .into_iter()
            .enumerate()
            .map(|(index, kind)| EntityEvent {
                command_index: index as u32,
                entity_id: EntityId::new(index as u32 + 1, u32::MAX),
                previous_entity_revision: u64::MAX - 1,
                entity_revision: u64::MAX,
                kind,
            })
            .collect(),
    }
}

fn reseal(bytes: &mut [u8]) {
    let checksum = wire_checksum_v1(&bytes[28..]);
    bytes[12..28].copy_from_slice(&checksum);
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decodes(id: &str, bytes: &[u8]) -> bool {
    match id {
        "entity-authority-export-v1" => decode_entity_authority_export_v1(bytes).is_ok(),
        "entity-authority-import-v2" => decode_entity_authority_import_v2(bytes).is_ok(),
        "entity-compatibility-export-v1" => decode_entity_compatibility_export_v1(bytes).is_ok(),
        "entity-compatibility-import-v1" => decode_entity_compatibility_import_v1(bytes).is_ok(),
        "entity-command-v1" => decode_entity_command_batch_v1(bytes).is_ok(),
        "entity-authority-import-receipt-v1" => decode_entity_authority_import_receipt_v1(bytes).is_ok(),
        "entity-authority-snapshot-v2" => decode_entity_authority_snapshot(bytes).is_ok(),
        "entity-compatibility-record-v1" => decode_compatibility_record(bytes).is_ok(),
        "entity-receipt-v1" => decode_entity_event_batch_v1(bytes).is_ok(),
        _ => panic!("unregistered R6 family"),
    }
}

pub fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..").join(FIXTURE)
}

pub fn fixture() -> String {
    let record = record();
    let mut authority = EntityAuthority::default();
    authority
        .apply_batch(&EntityCommandBatch {
            schema: 1,
            sequence: u64::MAX,
            expected_revision: 0,
            tick: u64::MAX - 2,
            commands: vec![EntityCommand::SpawnAt {
                id: EntityId::new(3, u32::MAX),
                record: record.clone(),
                residency: EntityResidency::Hot,
            }],
        })
        .expect("native fixture authority");
    let snapshot = encode_entity_authority_snapshot(&authority).unwrap();
    let compatibility = encode_compatibility_record(&record).unwrap();
    let export = EntityAuthorityExportWireV1 {
        expected_revision: u64::MAX,
    };
    let import = EntityAuthorityImportWireV2 {
        expected_revision: u64::MAX - 1,
        snapshot: snapshot.clone(),
    };
    let import_receipt = EntityAuthorityImportReceiptWireV1 {
        previous_revision: import.expected_revision,
        revision: authority.revision(),
        entity_count: authority.len() as u32,
        state_hash: authority.canonical_hash(),
    };
    let compat_export = EntityCompatibilityExportWireV1 {
        entity_id: EntityId::new(u32::MAX, u32::MAX),
        expected_entity_revision: u64::MAX,
    };
    let compat_import = EntityCompatibilityImportWireV1 {
        sequence: u64::MAX,
        expected_revision: u64::MAX - 1,
        tick: u64::MAX - 2,
        desired_id: Some(EntityId::new(u32::MAX, u32::MAX)),
        residency: EntityResidency::Cold,
        record: record.clone(),
    };
    let batch = commands(&record);
    let event_batch = events();
    let command_bytes = encode_entity_command_batch_v1(&batch).unwrap();
    let event_bytes = encode_entity_event_batch_v1(&event_batch).unwrap();
    assert_eq!(decode_entity_command_batch_v1(&command_bytes).unwrap(), batch);
    assert_eq!(decode_entity_event_batch_v1(&event_bytes).unwrap(), event_batch);
    assert_eq!(
        decode_entity_authority_snapshot(&snapshot).unwrap().canonical_hash(),
        authority.canonical_hash()
    );
    assert_eq!(decode_compatibility_record(&compatibility).unwrap(), record);

    let packets: Vec<(&str, Vec<u8>)> = vec![
        (
            "entity-authority-export-v1",
            encode_entity_authority_export_v1(export).unwrap(),
        ),
        (
            "entity-authority-import-v2",
            encode_entity_authority_import_v2(&import).unwrap(),
        ),
        (
            "entity-compatibility-export-v1",
            encode_entity_compatibility_export_v1(compat_export).unwrap(),
        ),
        (
            "entity-compatibility-import-v1",
            encode_entity_compatibility_import_v1(&compat_import).unwrap(),
        ),
        ("entity-command-v1", command_bytes.clone()),
        (
            "entity-authority-import-receipt-v1",
            encode_entity_authority_import_receipt_v1(import_receipt).unwrap(),
        ),
        ("entity-authority-snapshot-v2", snapshot.clone()),
        ("entity-compatibility-record-v1", compatibility),
        ("entity-receipt-v1", event_bytes.clone()),
    ];
    assert_eq!(decode_entity_authority_export_v1(&packets[0].1).unwrap(), export);
    assert_eq!(decode_entity_authority_import_v2(&packets[1].1).unwrap(), import);
    assert_eq!(
        decode_entity_compatibility_export_v1(&packets[2].1).unwrap(),
        compat_export
    );
    assert_eq!(
        decode_entity_compatibility_import_v1(&packets[3].1).unwrap(),
        compat_import
    );
    assert_eq!(
        decode_entity_authority_import_receipt_v1(&packets[5].1).unwrap(),
        import_receipt
    );
    for (index, (id, packet)) in packets.iter().enumerate() {
        let raw = index == 6 || index == 7;
        for offset in [0, if raw { 4 } else { 6 }] {
            let mut malformed = packet.clone();
            malformed[offset] ^= 0x7f;
            assert!(!decodes(id, &malformed), "{id} must reject header/schema tamper");
        }
        assert!(!decodes(id, &packet[..packet.len() - 1]), "{id} must reject truncation");
        let mut trailing = packet.clone();
        trailing.push(0);
        assert!(!decodes(id, &trailing), "{id} must reject trailing bytes");
        if !raw {
            assert_eq!(&packet[12..28], &wire_checksum_v1(&packet[28..]));
            for offset in [4, 8, 12, packet.len() - 1] {
                let mut malformed = packet.clone();
                malformed[offset] ^= 1;
                assert!(
                    !decodes(id, &malformed),
                    "{id} must reject length/protocol/checksum tamper"
                );
            }
        }
    }
    let mut malformed = command_bytes.clone();
    malformed[52..56].copy_from_slice(&257_u32.to_le_bytes());
    reseal(&mut malformed);
    assert!(decode_entity_command_batch_v1(&malformed).is_err());
    let mut malformed = command_bytes.clone();
    malformed[56] = 255;
    reseal(&mut malformed);
    assert!(decode_entity_command_batch_v1(&malformed).is_err());
    let mut malformed = event_bytes.clone();
    malformed[52..56].copy_from_slice(&257_u32.to_le_bytes());
    reseal(&mut malformed);
    assert!(decode_entity_event_batch_v1(&malformed).is_err());
    let mut malformed = command_bytes.clone();
    malformed[61] = 0;
    reseal(&mut malformed);
    assert!(
        decode_entity_command_batch_v1(&malformed).is_err(),
        "BWE6 strings reject controls"
    );
    let mut motion = batch.clone();
    motion.commands = vec![batch.commands[5].clone()];
    let mut malformed = encode_entity_command_batch_v1(&motion).unwrap();
    malformed[65..69].copy_from_slice(&f32::INFINITY.to_bits().to_le_bytes());
    reseal(&mut malformed);
    assert!(
        decode_entity_command_batch_v1(&malformed).is_err(),
        "motion rejects nonfinite f32"
    );
    let mut malformed = packets[1].1.clone();
    malformed[44] = 3;
    reseal(&mut malformed);
    assert!(
        decode_entity_authority_import_v2(&malformed).is_err(),
        "nested schema must be checked after outer checksum reseal"
    );
    let mut boundary = batch.clone();
    boundary.commands = vec![
        EntityCommand::Hibernate {
            id: EntityId::new(1, 1)
        };
        256
    ];
    assert_eq!(
        decode_entity_command_batch_v1(&encode_entity_command_batch_v1(&boundary).unwrap()).unwrap(),
        boundary
    );
    boundary.commands.push(EntityCommand::Hibernate {
        id: EntityId::new(1, 1),
    });
    assert!(encode_entity_command_batch_v1(&boundary).is_err());
    let mut event_boundary = event_batch.clone();
    event_boundary.events = vec![event_batch.events[0].clone(); 256];
    assert_eq!(
        decode_entity_event_batch_v1(&encode_entity_event_batch_v1(&event_boundary).unwrap()).unwrap(),
        event_boundary,
    );
    event_boundary.events.push(event_batch.events[0].clone());
    assert!(encode_entity_event_batch_v1(&event_boundary).is_err());

    let mut result = format!(
        concat!(
            "{{\n  \"schema\": 1,\n  \"producer\": \"blockwild-engine/r6_entity_domain_wire_fixture\",\n",
            "  \"schemaFingerprint\": \"{}\",\n  \"nativeAuthorityHash\": \"{}\",\n",
            "  \"commandTags\": 29,\n  \"eventTags\": 24,\n",
            "  \"hashAssurance\": \"Native authority hash is independently recomputed in TS from fully decoded canonical BWEA state; attested import receipts bind that hash to their requested snapshot.\",\n",
            "  \"families\": [\n"
        ),
        INTEGRATED_RUNTIME_DOMAIN_SCHEMA_FINGERPRINT_V1,
        authority.canonical_hash().to_hex()
    );
    for (index, (id, bytes)) in packets.iter().enumerate() {
        let family = INTEGRATED_RUNTIME_DOMAIN_WIRE_FAMILIES_V1
            .iter()
            .find(|family| family.id == *id)
            .unwrap();
        result.push_str(&format!(
            "    {{\"id\":\"{}\",\"direction\":\"{}\",\"typeId\":\"{}\",\"operationSchema\":{},\"innerSchema\":{},\"payloadHash\":\"{}\",\"hex\":\"{}\"}}{}\n",
            id, family.direction, family.type_id, family.operation_schema, family.inner_schema,
            hex(&wire_checksum_v1(bytes)), hex(bytes), if index + 1 == packets.len() { "" } else { "," },
        ));
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
            println!("r6-entity-domain-wire-fixture=ok");
        }
        Some("--write") => fs::write(fixture_path(), rendered).unwrap(),
        None => print!("{rendered}"),
        _ => panic!("usage: r6_entity_domain_wire_fixture [--check|--write]"),
    }
}
