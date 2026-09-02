#[allow(dead_code)]
#[path = "../examples/r5_simulation_wire_fixture.rs"]
mod emitter;

use blockwild_engine::*;
use blockwild_gameplay::ItemInstanceMetadataV1;
use blockwild_runtime_wire::wire_checksum_v1;
use blockwild_types::CanonicalHash;

fn reseal(bytes: &mut [u8]) {
    let checksum = wire_checksum_v1(&bytes[28..]);
    bytes[12..28].copy_from_slice(&checksum);
}

#[test]
fn all_registered_r5_families_match_checked_native_fixture() {
    let expected = std::fs::read_to_string(emitter::fixture_path()).expect("checked R5 fixture exists");
    assert_eq!(expected.replace("\r\n", "\n"), emitter::fixture());
    let vectors = emitter::vectors().unwrap();
    let mut expected: Vec<_> = INTEGRATED_RUNTIME_DOMAIN_WIRE_FAMILIES_V1
        .iter()
        .filter(|family| family.phase == "R5")
        .map(|family| family.id)
        .collect();
    let mut actual: Vec<_> = vectors.iter().map(|vector| vector.family).collect();
    expected.sort_unstable();
    actual.sort_unstable();
    assert_eq!(actual, expected);
    assert_eq!(actual.len(), 18);
}

#[test]
fn every_r5_family_rejects_truncation_trailing_bytes_and_wrong_header() {
    for vector in emitter::vectors().unwrap() {
        for length in 0..vector.bytes.len() {
            assert!(
                emitter::decode_reencode(vector.family, &vector.bytes[..length]).is_err(),
                "{} truncation {length}",
                vector.family
            );
        }
        let mut trailing = vector.bytes.clone();
        trailing.push(0);
        assert!(
            emitter::decode_reencode(vector.family, &trailing).is_err(),
            "{} trailing",
            vector.family
        );
        let mut magic = vector.bytes.clone();
        magic[0] ^= 1;
        assert!(
            emitter::decode_reencode(vector.family, &magic).is_err(),
            "{} magic",
            vector.family
        );
        let mut schema = vector.bytes.clone();
        schema[if vector.family.contains("final-receipt") { 4 } else { 6 }] ^= 0x80;
        assert!(
            emitter::decode_reencode(vector.family, &schema).is_err(),
            "{} schema",
            vector.family
        );
        if !vector.family.contains("final-receipt") {
            let mut version = vector.bytes.clone();
            version[4] ^= 0x80;
            assert!(emitter::decode_reencode(vector.family, &version).is_err());
            let mut length = vector.bytes.clone();
            length[8] ^= 1;
            assert!(emitter::decode_reencode(vector.family, &length).is_err());
            let mut checksum = vector.bytes.clone();
            checksum[12] ^= 1;
            assert!(
                emitter::decode_reencode(vector.family, &checksum).is_err(),
                "{} checksum",
                vector.family
            );
        }
    }
}

#[test]
fn player_status_rejects_resealed_invalid_continuity_and_geometry() {
    let vectors = emitter::vectors().unwrap();
    let packet = &vectors
        .iter()
        .find(|vector| vector.family == "player-bootstrap-status-receipt-v1")
        .unwrap()
        .bytes;
    let valid = decode_player_bootstrap_status_v1(packet).unwrap();
    let mut wrong = valid.clone();
    wrong.authoritative_flags = 0x80;
    assert!(encode_player_bootstrap_status_v1(&wrong).is_err());
    let mut wrong = valid.clone();
    wrong.next_input_sequence = Some(1);
    assert!(encode_player_bootstrap_status_v1(&wrong).is_err());
    let mut wrong = valid.clone();
    wrong.last_action_sequence = Some(0);
    wrong.next_action_sequence = Some(1);
    assert!(encode_player_bootstrap_status_v1(&wrong).is_err());
    let mut wrong = valid.clone();
    wrong.last_applied_input.as_mut().unwrap().sequence -= 1;
    assert!(encode_player_bootstrap_status_v1(&wrong).is_err());
    let mut wrong = valid;
    wrong.last_applied_input.as_mut().unwrap().selected_slot = 9;
    assert!(encode_player_bootstrap_status_v1(&wrong).is_err());
    // Offset derives from the checked layout: hash, three world cursors,
    // authority cursor, present next cursor, tick, monotonic clock, two cursor pairs.
    let flag_offset = 28 + 16 + 24 + 8 + 9 + 8 + 8 + 9 + 1 + 9 + 9;
    let mut wrong = packet.clone();
    wrong[flag_offset] = 0x80;
    reseal(&mut wrong);
    assert!(decode_player_bootstrap_status_v1(&wrong).is_err());
    let mut wrong = packet.clone();
    wrong[flag_offset + 2 + 28] = 9;
    reseal(&mut wrong);
    assert!(decode_player_bootstrap_status_v1(&wrong).is_err());
}

#[test]
fn physical_profiles_and_camera_hashes_fail_closed_after_resealing() {
    let mut binding = emitter::binding();
    binding.radius = f64::NAN;
    assert!(encode_runtime_player_binding_v1(&binding).is_err());
    let mut binding = emitter::binding();
    binding.sprint_speed = binding.walk_speed - 0.5;
    assert!(encode_runtime_player_binding_v1(&binding).is_err());
    let vectors = emitter::vectors().unwrap();
    let mut camera = vectors
        .iter()
        .find(|vector| vector.family == "simulation-camera-config-v1")
        .unwrap()
        .bytes
        .clone();
    camera[28..36].copy_from_slice(&9_007_199_254_740_992_u64.to_le_bytes());
    reseal(&mut camera);
    assert!(decode_runtime_camera_config_v1(&camera).is_err());
    let mut camera = vectors
        .iter()
        .find(|vector| vector.family == "simulation-camera-config-receipt-v1")
        .unwrap()
        .bytes
        .clone();
    let last = camera.len() - 1;
    camera[last] ^= 1;
    reseal(&mut camera);
    assert!(decode_runtime_camera_config_receipt_v1(&camera).is_err());
}

#[test]
fn final_bind_hashes_are_structural_and_require_outer_attestation() {
    for version in [
        RuntimePlayerFinalBindVersionV1::InventoryV3,
        RuntimePlayerFinalBindVersionV1::CombatV4,
    ] {
        let expected = RuntimePlayerFinalBindReceiptWireV1 {
            request_payload_hash: blockwild_types::CanonicalHash([0x11; 16]),
            terminal_state_hash: blockwild_types::CanonicalHash([0x22; 16]),
        };
        let mut bytes = encode_runtime_player_final_bind_receipt_v1(version, expected);
        assert_eq!(
            decode_runtime_player_final_bind_receipt_v1(version, &bytes).unwrap(),
            expected
        );
        bytes[6] ^= 1;
        assert_ne!(
            decode_runtime_player_final_bind_receipt_v1(version, &bytes).unwrap(),
            expected
        );
    }
}

fn metadata(index: u8, extension_bytes: usize) -> ItemInstanceMetadataV1 {
    let mut value = ItemInstanceMetadataV1 {
        hash: CanonicalHash::default(),
        type_id: format!("item:wire:{index}"),
        schema_id: "item:wire:schema".into(),
        schema_version: 1,
        content_version: 0,
        canonical_json_bytes: b"{}".to_vec(),
        unknown_extension_bytes: vec![index; extension_bytes],
    };
    value.hash = value.calculate_hash();
    value
}

fn status_with_metadata(mut records: Vec<ItemInstanceMetadataV1>) -> PlayerBootstrapStatusWireV1 {
    let vectors = emitter::vectors().unwrap();
    let packet = &vectors
        .iter()
        .find(|vector| vector.family == "player-bootstrap-status-receipt-v1")
        .unwrap()
        .bytes;
    let mut status = decode_player_bootstrap_status_v1(packet).unwrap();
    for record in &mut records {
        record.hash = record.calculate_hash();
    }
    records.sort_by_key(|record| record.hash);
    let mut inventory_slots = vec![None; 9];
    for (slot, record) in inventory_slots.iter_mut().zip(&records) {
        *slot = Some(ItemStack {
            metadata_hash: record.hash,
            ..ItemStack::simple(1, 1)
        });
    }
    status.custody = Some(PlayerBootstrapCustodyWireV1 {
        inventory_container: ContainerKey::player("actor:雪"),
        inventory_revision: 7,
        inventory_slots,
        equipment_container: ContainerKey {
            kind: ContainerKind::Equipment,
            id: "actor:雪:equipment".into(),
            owner_id: Some("actor:雪".into()),
        },
        equipment_revision: 8,
        equipment_slots: vec![None; 8],
        referenced_metadata: records,
    });
    status
}

#[test]
fn custody_metadata_accepts_exact_aggregate_limit_and_rejects_one_byte_over() {
    let status = status_with_metadata((1..=4).map(|index| metadata(index, 65_534)).collect());
    let bytes = encode_player_bootstrap_status_v1(&status).unwrap();
    assert_eq!(decode_player_bootstrap_status_v1(&bytes).unwrap(), status);
    let mut records = status.custody.unwrap().referenced_metadata;
    records.last_mut().unwrap().unknown_extension_bytes.push(0);
    assert!(encode_player_bootstrap_status_v1(&status_with_metadata(records.clone())).is_err());

    // Forge a still individually bounded final extension; repair descriptor and
    // packet checksums so only the aggregate budget can reject it.
    let last = records.last_mut().unwrap();
    let old_hash = last.hash;
    last.hash = last.calculate_hash();
    let mut forged = bytes;
    for offset in (0..=forged.len() - 16).rev() {
        if forged[offset..offset + 16] == old_hash.0 {
            forged[offset..offset + 16].copy_from_slice(last.hash.as_bytes());
        }
    }
    let extension_length_offset = forged.len() - 65_534 - 4;
    forged[extension_length_offset..extension_length_offset + 4].copy_from_slice(&65_535_u32.to_le_bytes());
    forged.push(0);
    let body_length = u32::try_from(forged.len() - 28).unwrap();
    forged[8..12].copy_from_slice(&body_length.to_le_bytes());
    reseal(&mut forged);
    assert_eq!(
        decode_player_bootstrap_status_v1(&forged).unwrap_err().code,
        "player-bootstrap-metadata"
    );
}

#[test]
fn custody_metadata_reuses_canonical_validation_even_when_hashes_are_resealed() {
    let valid = metadata(1, 3);
    assert!(valid.validate_wire().is_ok());
    for bad_json in [b"{ }".as_slice(), b"no".as_slice(), b"\xff".as_slice()] {
        let mut record = valid.clone();
        record.canonical_json_bytes = bad_json.to_vec();
        record.hash = record.calculate_hash();
        assert!(record.validate_wire().is_err());
        assert!(encode_player_bootstrap_status_v1(&status_with_metadata(vec![record])).is_err());
    }
    let mut record = valid.clone();
    record.schema_version = 0;
    record.hash = record.calculate_hash();
    assert!(record.validate_wire().is_err());
    assert!(encode_player_bootstrap_status_v1(&status_with_metadata(vec![record])).is_err());

    let status = status_with_metadata(vec![valid.clone()]);
    let bytes = encode_player_bootstrap_status_v1(&status).unwrap();
    let metadata_offset = bytes
        .windows(16)
        .rposition(|window| window == valid.hash.as_bytes())
        .unwrap();
    let schema_offset = metadata_offset + 16 + 4 + valid.type_id.len() + 4 + valid.schema_id.len();
    let json_offset = schema_offset + 2 + 4 + 4;
    for mutate_schema in [false, true] {
        let mut invalid = valid.clone();
        if mutate_schema {
            invalid.schema_version = 0;
        } else {
            invalid.canonical_json_bytes = b"{ ".to_vec();
        }
        invalid.hash = invalid.calculate_hash();
        let mut forged = bytes.clone();
        for offset in (0..=forged.len() - 16).rev() {
            if forged[offset..offset + 16] == valid.hash.0 {
                forged[offset..offset + 16].copy_from_slice(invalid.hash.as_bytes());
            }
        }
        if mutate_schema {
            forged[schema_offset..schema_offset + 2].fill(0);
        } else {
            forged[json_offset + 1] = b' ';
        }
        reseal(&mut forged);
        assert_eq!(
            decode_player_bootstrap_status_v1(&forged).unwrap_err().code,
            "player-bootstrap-metadata"
        );
    }
}
