#[allow(dead_code)]
#[path = "../examples/r7_gameplay_command_wire_fixture.rs"]
mod emitter;

use std::collections::{BTreeMap, BTreeSet};

use blockwild_engine::{
    decode_gameplay_actor_grant_v1, decode_gameplay_batch_v1, decode_gameplay_receipt_v1,
    encode_gameplay_actor_grant_v1, encode_gameplay_batch_v1, encode_gameplay_receipt_v1,
};
use blockwild_gameplay::*;
use blockwild_runtime_wire::{MAX_DOMAIN_PAYLOAD_BYTES, wire_checksum_v1};
use blockwild_types::CanonicalHash;

fn reseal(packet: &[u8], body: &[u8]) -> Vec<u8> {
    let mut result = packet[..28].to_vec();
    result[8..12].copy_from_slice(&(body.len() as u32).to_le_bytes());
    result[12..28].copy_from_slice(&wire_checksum_v1(body));
    result.extend_from_slice(body);
    result
}

fn skip_string(bytes: &[u8], offset: &mut usize) {
    let length = u32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap()) as usize;
    *offset += 4 + length;
}

fn command_offset(packet: &[u8]) -> usize {
    let mut offset = 28;
    for _ in 0..3 {
        skip_string(packet, &mut offset);
    }
    for _ in 0..2 {
        let present = packet[offset] != 0;
        offset += if present { 9 } else { 1 };
    }
    offset += 1;
    for _ in 0..2 {
        skip_string(packet, &mut offset);
    }
    offset + 4 + 6 * 8 + 16 + 4
}

fn vector(name: &str) -> GameplayBatch {
    emitter::vectors()
        .into_iter()
        .find(|vector| vector.name == name)
        .unwrap()
        .batch
}

fn assert_code(packet: &[u8], code: &str) {
    assert_eq!(decode_gameplay_batch_v1(packet).unwrap_err().code, code);
}

#[test]
fn checked_fixture_is_native_authored_and_byte_current() {
    let checked = std::fs::read_to_string(emitter::fixture_path()).expect("checked R7 fixture exists");
    assert_eq!(checked.replace("\r\n", "\n"), emitter::fixture());
    for vector in emitter::vectors() {
        let bytes = encode_gameplay_batch_v1(&vector.batch).unwrap();
        let decoded = decode_gameplay_batch_v1(&bytes).unwrap();
        assert_eq!(decoded, vector.batch, "{}", vector.name);
        assert_eq!(decoded.calculate_command_hash(), vector.batch.command_hash);
        assert_eq!(encode_gameplay_batch_v1(&decoded).unwrap(), bytes);
    }
}

#[test]
fn actor_optional_zero_ids_remain_present_in_batch_and_grant_transport() {
    let mut zero = vector("actor-zero-option-ids");
    let packet = encode_gameplay_batch_v1(&zero).unwrap();
    let decoded = decode_gameplay_batch_v1(&packet).unwrap();
    assert_eq!(decoded.actor.player_id.unwrap().packed(), 0);
    assert_eq!(decoded.actor.entity_id.unwrap().packed(), 0);
    assert_eq!(encode_gameplay_batch_v1(&decoded).unwrap(), packet);
    zero.actor.player_id = None;
    zero.actor.entity_id = None;
    let absent_packet = encode_gameplay_batch_v1(&zero).unwrap();
    assert_eq!(packet.len(), absent_packet.len() + 16);
    assert_eq!(decode_gameplay_batch_v1(&absent_packet).unwrap(), zero);
    assert_eq!(
        decoded.command_hash, zero.command_hash,
        "actor options are not command-hash input"
    );

    let grant = emitter::zero_actor_grant();
    let packet = encode_gameplay_actor_grant_v1("actor:zero-options", &grant).unwrap();
    let (actor_id, decoded) = decode_gameplay_actor_grant_v1(&packet).unwrap();
    assert_eq!(decoded, grant);
    assert_eq!(decoded.player_id.unwrap().packed(), 0);
    assert_eq!(decoded.entity_id.unwrap().packed(), 0);
    assert_eq!(encode_gameplay_actor_grant_v1(&actor_id, &decoded).unwrap(), packet);
    let mut absent = grant;
    absent.player_id = None;
    absent.entity_id = None;
    let absent_packet = encode_gameplay_actor_grant_v1(&actor_id, &absent).unwrap();
    assert_eq!(packet.len(), absent_packet.len() + 16);
    assert_eq!(decode_gameplay_actor_grant_v1(&absent_packet).unwrap().1, absent);
}

#[test]
fn native_enum_coverage_is_complete_and_explicit_labels_cannot_hide_omissions() {
    let mut tags = BTreeMap::<u8, BTreeSet<u8>>::new();
    let mut labels = BTreeMap::<String, BTreeSet<String>>::new();
    let mut names = BTreeSet::new();
    let mut operations = BTreeSet::new();
    let mut resources = BTreeSet::new();
    let mut methods = BTreeSet::new();
    let mut content = BTreeSet::new();
    let mut actions = BTreeSet::new();
    for vector in emitter::vectors() {
        assert!(names.insert(vector.name));
        for label in vector.covers {
            let (group, branch) = label.split_once('.').unwrap();
            labels.entry(group.into()).or_default().insert(branch.into());
        }
        let bytes = encode_gameplay_batch_v1(&vector.batch).unwrap();
        let offset = command_offset(&bytes);
        let domain = bytes[offset];
        tags.entry(domain)
            .or_default()
            .insert(if domain == 5 { 0 } else { bytes[offset + 1] });
        match &vector.batch.commands[0] {
            GameplayCommand::Machine(MachineCommand::Operate { operation, .. }) => {
                operations.insert(match operation {
                    MachineOperation::Configure { .. } => 0,
                    MachineOperation::Activate => 1,
                    MachineOperation::Deactivate => 2,
                    MachineOperation::ClaimOutput { .. } => 3,
                });
            }
            GameplayCommand::Machine(MachineCommand::Transfer { resource, .. }) => {
                resources.insert(resource.kind as u8);
            }
            GameplayCommand::Combat(CombatCommand::Pacify { method, .. }) => {
                methods.insert(*method as u8);
            }
            GameplayCommand::Combat(CombatCommand::UseLinkedProjectile { content_domain, .. }) => {
                content.insert(*content_domain as u8);
            }
            GameplayCommand::Cardforge(CardforgeCommand::MatchAction { action, .. }) => {
                actions.insert(match action {
                    BattleAction::Draw => 0,
                    BattleAction::Play { .. } => 1,
                    BattleAction::AttackPlayer { .. } => 2,
                    BattleAction::EndTurn => 3,
                    BattleAction::Concede => 4,
                });
            }
            _ => {}
        }
    }
    for (domain, count, group) in [
        (0, 10, "inventory"),
        (1, 5, "machine"),
        (2, 11, "combat"),
        (3, 10, "progression"),
        (4, 7, "cardforge"),
        (5, 1, "command"),
    ] {
        assert_eq!(tags[&domain], (0..count).collect(), "{group}");
        assert_eq!(labels[group].len(), usize::from(count), "{group}");
    }
    assert_eq!(operations, (0..4).collect());
    assert_eq!(resources, (0..5).collect());
    assert_eq!(methods, (0..2).collect());
    assert_eq!(content, (0..11).collect());
    assert_eq!(actions, (0..5).collect());
    for (group, expected) in [
        ("container-kind", 6),
        ("actor-role", 4),
        ("machine-operation", 4),
        ("resource-kind", 5),
        ("pacify-method", 2),
        ("content-domain", 11),
        ("battle-action", 5),
    ] {
        assert_eq!(labels[group].len(), expected, "{group}");
    }
    for group in [
        "actor-player",
        "actor-entity",
        "transfer-expected",
        "slot-revision",
        "container-owner",
        "craft-station",
        "craft-source-revision",
        "craft-destination-revision",
        "furnace-fuel",
        "ingredient-metadata",
        "drop-expected",
        "player-back-slot",
        "import-slot",
        "import-metadata",
        "stack-durability",
        "block-expected-stack",
        "block-created-stack",
        "resource-item-code",
        "ability-projectile",
        "projectile-target",
        "linked-projectile-target",
        "summon-duration",
        "summon-grounding-item",
        "linked-summon-duration",
        "linked-summon-grounding-item",
        "progression-currency",
        "progression-payload",
        "deck-revision",
    ] {
        assert_eq!(labels[group], BTreeSet::from(["none".into(), "some".into()]), "{group}");
    }
}

#[test]
fn all_vectors_reject_prefix_truncation_envelope_corruption_and_resealed_hash_tampering() {
    for vector in emitter::vectors() {
        let packet = encode_gameplay_batch_v1(&vector.batch).unwrap();
        for length in 0..packet.len() {
            assert!(
                decode_gameplay_batch_v1(&packet[..length]).is_err(),
                "{} length {length}",
                vector.name
            );
        }
        for offset in [0, 4, 6, 8, 12, packet.len() - 1] {
            let mut invalid = packet.clone();
            invalid[offset] ^= 0x80;
            assert!(
                decode_gameplay_batch_v1(&invalid).is_err(),
                "{} offset {offset}",
                vector.name
            );
        }
        let mut body = packet[28..].to_vec();
        *body.last_mut().unwrap() ^= 0x40;
        assert_code(&reseal(&packet, &body), "gameplay-hash");
        body.push(0);
        assert!(decode_gameplay_batch_v1(&reseal(&packet, &body)).is_err());
    }
}

#[test]
fn unsupported_domain_command_nested_enum_and_flag_tags_fail_closed() {
    for (name, code) in [
        ("inventory-transfer-none", "inventory-command"),
        ("machine-advance", "machine-command"),
        ("combat-advance", "combat-command"),
        ("progression-trade", "progression-action"),
        ("cardforge-open-pack", "cardforge-command"),
    ] {
        let packet = encode_gameplay_batch_v1(&vector(name)).unwrap();
        let offset = command_offset(&packet) - 28;
        let mut body = packet[28..].to_vec();
        body[offset + 1] = 255;
        assert_code(&reseal(&packet, &body), code);
        body[offset] = 255;
        assert_code(&reseal(&packet, &body), "gameplay-command");
    }
    let packet = encode_gameplay_batch_v1(&vector("inventory-transfer-none")).unwrap();
    let offset = command_offset(&packet) - 28;
    let mut body = packet[28..].to_vec();
    body[offset + 1] = 10;
    assert_code(&reseal(&packet, &body), "inventory-command-dedicated");
    body = packet[28..].to_vec();
    body[offset + 2] = 255;
    assert_code(&reseal(&packet, &body), "container-kind");
    body = packet[28..].to_vec();
    let mut owner_flag = offset + 3;
    skip_string(&body, &mut owner_flag);
    body[owner_flag] = 2;
    assert_code(&reseal(&packet, &body), "domain-flag");
    for (name, code, string_count, tail) in [
        ("machine-operate-activate", "machine-operation", 1, 8),
        ("combat-pacify-outmaneuver", "pacify-method", 2, 8),
        ("cardforge-match-action-draw", "cardforge-action", 2, 8),
    ] {
        let packet = encode_gameplay_batch_v1(&vector(name)).unwrap();
        let mut body = packet[28..].to_vec();
        let mut offset = command_offset(&packet) - 28 + 2;
        for _ in 0..string_count {
            skip_string(&body, &mut offset);
        }
        body[offset + tail] = 255;
        assert_code(&reseal(&packet, &body), code);
    }
}

#[test]
fn linked_entity_ids_and_content_domain_are_checked_independently_of_hashes() {
    for name in ["combat-use-linked-projectile-item", "combat-summon-linked-some"] {
        let mut batch = vector(name);
        let packet = encode_gameplay_batch_v1(&batch).unwrap();
        let mut body = packet[28..].to_vec();
        let mut offset = command_offset(&packet) - 28 + 2;
        skip_string(&body, &mut offset);
        if name.starts_with("combat-use") {
            offset += 8;
            skip_string(&body, &mut offset);
            offset += 8;
            skip_string(&body, &mut offset);
        }
        skip_string(&body, &mut offset);
        body[offset..offset + 8].fill(0);
        assert_code(&reseal(&packet, &body), "entity-id");
        body = packet[28..].to_vec();
        body[offset + 8] = 255;
        assert!(decode_gameplay_batch_v1(&reseal(&packet, &body)).is_err());
        match &mut batch.commands[0] {
            GameplayCommand::Combat(
                CombatCommand::UseLinkedProjectile { entity_id, .. } | CombatCommand::SummonLinked { entity_id, .. },
            ) => *entity_id = blockwild_types::EntityId::new(0, 0),
            _ => unreachable!(),
        }
        batch.command_hash = batch.calculate_command_hash();
        assert_eq!(encode_gameplay_batch_v1(&batch).unwrap_err().code, "entity-id");
    }
}

#[test]
fn batch_schema_hash_and_command_count_are_checked_before_encoding() {
    let mut batch = vector("schedule-advance");
    batch.schema_version = 2;
    assert_eq!(encode_gameplay_batch_v1(&batch).unwrap_err().code, "gameplay-schema");
    batch.schema_version = 1;
    batch.command_hash = CanonicalHash::default();
    assert_eq!(encode_gameplay_batch_v1(&batch).unwrap_err().code, "gameplay-hash");
    batch.commands.clear();
    batch.command_hash = batch.calculate_command_hash();
    assert_eq!(encode_gameplay_batch_v1(&batch).unwrap_err().code, "gameplay-count");
    let command = vector("schedule-advance").commands.remove(0);
    batch.commands = vec![command.clone(); MAX_COMMANDS_PER_BATCH];
    batch.command_hash = batch.calculate_command_hash();
    let packet = encode_gameplay_batch_v1(&batch).unwrap();
    assert_eq!(decode_gameplay_batch_v1(&packet).unwrap(), batch);
    batch.commands.push(command);
    batch.command_hash = batch.calculate_command_hash();
    assert_eq!(encode_gameplay_batch_v1(&batch).unwrap_err().code, "gameplay-count");
    let count_offset = command_offset(&packet) - 28 - 4;
    for count in [0_u32, 257, u32::MAX] {
        let mut body = packet[28..].to_vec();
        body[count_offset..count_offset + 4].copy_from_slice(&count.to_le_bytes());
        assert!(decode_gameplay_batch_v1(&reseal(&packet, &body)).is_err());
    }
}

#[test]
fn transport_strings_and_opaque_payloads_accept_endpoints_and_reject_overlimits() {
    let mut batch = vector("machine-operate-configure");
    batch.batch_id = format!("{}a", "水".repeat(5461));
    assert_eq!(batch.batch_id.len(), 16 * 1024);
    let packet = encode_gameplay_batch_v1(&batch).unwrap();
    assert_eq!(decode_gameplay_batch_v1(&packet).unwrap(), batch);
    batch.batch_id.push('a');
    assert_eq!(encode_gameplay_batch_v1(&batch).unwrap_err().code, "domain-string");
    // This string is not part of command_hash: recomputing the envelope must
    // not bypass the independent string bound.
    let old_length = 16 * 1024;
    let mut body = packet[28..].to_vec();
    body[..4].copy_from_slice(&((old_length + 1) as u32).to_le_bytes());
    body.insert(4 + old_length, b'a');
    assert!(decode_gameplay_batch_v1(&reseal(&packet, &body)).is_err());
    for value in ["", "a\0", "a\u{7f}", "a\u{85}"] {
        batch.batch_id = value.into();
        assert!(encode_gameplay_batch_v1(&batch).is_err());
    }
    for value in ["\u{feff}", "\u{feff}actor:雪"] {
        batch.batch_id = value.into();
        let bytes = encode_gameplay_batch_v1(&batch).unwrap();
        assert_eq!(decode_gameplay_batch_v1(&bytes).unwrap().batch_id, value);
    }
    batch.batch_id = "valid".into();
    if let GameplayCommand::Machine(MachineCommand::Operate {
        operation: MachineOperation::Configure { settings },
        ..
    }) = &mut batch.commands[0]
    {
        settings.bytes = vec![0xff; MAX_PAYLOAD_BYTES];
    }
    batch.command_hash = batch.calculate_command_hash();
    let packet = encode_gameplay_batch_v1(&batch).unwrap();
    let mut offset = command_offset(&packet) - 28 + 2;
    let mut body = packet[28..].to_vec();
    skip_string(&body, &mut offset);
    offset += 8 + 1;
    skip_string(&body, &mut offset);
    offset += 2;
    body[offset..offset + 4].copy_from_slice(&((MAX_PAYLOAD_BYTES + 1) as u32).to_le_bytes());
    assert_code(&reseal(&packet, &body), "domain-size");
    assert_eq!(
        decode_gameplay_batch_v1(&encode_gameplay_batch_v1(&batch).unwrap()).unwrap(),
        batch
    );
    if let GameplayCommand::Machine(MachineCommand::Operate {
        operation: MachineOperation::Configure { settings },
        ..
    }) = &mut batch.commands[0]
    {
        settings.bytes.push(0);
    }
    batch.command_hash = batch.calculate_command_hash();
    assert_eq!(encode_gameplay_batch_v1(&batch).unwrap_err().code, "domain-size");
    assert!(decode_gameplay_batch_v1(&vec![0; MAX_DOMAIN_PAYLOAD_BYTES + 1]).is_err());
}

#[test]
fn maximum_packet_budget_is_independent_of_each_opaque_field_budget() {
    let configure = |length: usize| {
        GameplayCommand::Machine(MachineCommand::Operate {
            machine_id: "m".into(),
            expected_revision: 0,
            operation: MachineOperation::Configure {
                settings: OpaquePayload {
                    type_id: "p".into(),
                    schema: 1,
                    bytes: vec![0x81; length],
                },
            },
        })
    };
    let baseline = emitter::batch("packet-budget", vec![configure(0); 4]);
    let overhead = encode_gameplay_batch_v1(&baseline).unwrap().len();
    let remainder = MAX_DOMAIN_PAYLOAD_BYTES - overhead - 3 * MAX_PAYLOAD_BYTES;
    assert!(remainder < MAX_PAYLOAD_BYTES);
    let mut batch = emitter::batch(
        "packet-budget",
        vec![
            configure(MAX_PAYLOAD_BYTES),
            configure(MAX_PAYLOAD_BYTES),
            configure(MAX_PAYLOAD_BYTES),
            configure(remainder),
        ],
    );
    let packet = encode_gameplay_batch_v1(&batch).unwrap();
    assert_eq!(packet.len(), MAX_DOMAIN_PAYLOAD_BYTES);
    assert_eq!(decode_gameplay_batch_v1(&packet).unwrap(), batch);
    batch.commands[3] = configure(remainder + 1);
    batch.command_hash = batch.calculate_command_hash();
    assert_eq!(encode_gameplay_batch_v1(&batch).unwrap_err().code, "domain-size");
    let mut body = packet[28..].to_vec();
    body.push(0);
    assert_code(&reseal(&packet, &body), "domain-size");
}

#[test]
fn import_counts_metadata_byte_limits_and_deck_duplicate_keys_are_enforced() {
    let mut import = ImportPlayerInventoryV1 {
        inventory: emitter::container(ContainerKind::Player, true),
        expected_revision: 0,
        slots: vec![None; 9],
        metadata: vec![emitter::metadata(); 9],
    };
    for descriptor in &mut import.metadata[..1] {
        descriptor.canonical_json_bytes = vec![b' '; MAX_ITEM_INSTANCE_METADATA_BYTES_V1];
        descriptor.unknown_extension_bytes = vec![0xff; MAX_ITEM_INSTANCE_METADATA_EXTENSION_BYTES_V1];
        descriptor.hash = descriptor.calculate_hash();
    }
    // BWG7 is structural: canonical JSON, hash/stack references and aggregate
    // inventory metadata semantics belong to GameplayAuthority at application.
    let make = |value: ImportPlayerInventoryV1| {
        emitter::batch(
            "import-bounds",
            vec![GameplayCommand::Inventory(InventoryCommand::ImportPlayerInventoryV1(
                value,
            ))],
        )
    };
    let batch = make(import.clone());
    let import_packet = encode_gameplay_batch_v1(&batch).unwrap();
    let import_body = import_packet[28..].to_vec();
    let mut offset = command_offset(&import_packet) - 28 + 2 + 1;
    skip_string(&import_body, &mut offset);
    offset += 1;
    skip_string(&import_body, &mut offset);
    offset += 8;
    let slots_count_offset = offset;
    offset += 4 + 9;
    let metadata_count_offset = offset;
    offset += 4 + 16;
    skip_string(&import_body, &mut offset);
    skip_string(&import_body, &mut offset);
    offset += 2 + 4;
    let json_length_offset = offset;
    let extension_length_offset = offset + 4 + MAX_ITEM_INSTANCE_METADATA_BYTES_V1;
    for (offset, value, code) in [
        (slots_count_offset, 10_u32, "domain-count"),
        (metadata_count_offset, 10, "domain-count"),
        (
            json_length_offset,
            (MAX_ITEM_INSTANCE_METADATA_BYTES_V1 + 1) as u32,
            "domain-size",
        ),
        (
            extension_length_offset,
            (MAX_ITEM_INSTANCE_METADATA_EXTENSION_BYTES_V1 + 1) as u32,
            "domain-size",
        ),
    ] {
        let mut body = import_body.clone();
        body[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        assert_code(&reseal(&import_packet, &body), code);
    }
    assert_eq!(
        decode_gameplay_batch_v1(&encode_gameplay_batch_v1(&batch).unwrap()).unwrap(),
        batch
    );
    let mut outer_overflow = import.clone();
    outer_overflow.metadata = vec![import.metadata[0].clone(); 9];
    assert_eq!(
        encode_gameplay_batch_v1(&make(outer_overflow)).unwrap_err().code,
        "domain-size"
    );
    import.slots.push(None);
    assert_eq!(
        encode_gameplay_batch_v1(&make(import.clone())).unwrap_err().code,
        "domain-count"
    );
    import.slots.pop();
    import.metadata.push(emitter::metadata());
    assert_eq!(
        encode_gameplay_batch_v1(&make(import.clone())).unwrap_err().code,
        "domain-count"
    );
    import.metadata.pop();
    for extension in [false, true] {
        let mut invalid = import.clone();
        if extension {
            invalid.metadata[0].unknown_extension_bytes.push(0);
        } else {
            invalid.metadata[0].canonical_json_bytes.push(b' ');
        }
        assert_eq!(
            encode_gameplay_batch_v1(&make(invalid)).unwrap_err().code,
            "domain-size"
        );
    }
    let packet = encode_gameplay_batch_v1(&vector("cardforge-build-deck-some")).unwrap();
    let mut body = packet[28..].to_vec();
    let mut offset = command_offset(&packet) - 28 + 2;
    for _ in 0..3 {
        skip_string(&body, &mut offset);
    }
    let mut oversized = body.clone();
    oversized[offset..offset + 4].copy_from_slice(&65_537_u32.to_le_bytes());
    assert_code(&reseal(&packet, &oversized), "domain-count");
    offset += 4;
    let first_start = offset;
    for _ in 0..3 {
        skip_string(&body, &mut offset);
    }
    offset += 2;
    let first = body[first_start..offset].to_vec();
    let second_start = offset;
    for _ in 0..3 {
        skip_string(&body, &mut offset);
    }
    offset += 2;
    body.splice(second_start..offset, first);
    assert_code(&reseal(&packet, &body), "cardforge-deck");
}

#[test]
fn browser_lifecycle_is_an_accepted_native_nonschedule_command() {
    let (batch, receipt) = emitter::browser_lifecycle();
    assert_eq!(
        batch.identity,
        GameplayState::new(WorldKey::new("schema-browser", "surface"), 1).identity()
    );
    let mut authority = GameplayAuthority::new(GameplayState::new(WorldKey::new("schema-browser", "surface"), 1));
    authority.grant_actor("schema:system", ActorGrant::system()).unwrap();
    let decoded = decode_gameplay_batch_v1(&encode_gameplay_batch_v1(&batch).unwrap()).unwrap();
    assert_eq!(authority.apply_batch(&decoded), receipt);
    let bytes = encode_gameplay_receipt_v1(&receipt).unwrap();
    assert_eq!(decode_gameplay_receipt_v1(&bytes).unwrap(), receipt);
    assert_eq!(authority.state.inventory.containers.len(), 2);
    let GameplayReceipt::Accepted(accepted) = receipt else {
        panic!("native custody creation rejected");
    };
    assert_eq!(accepted.after.revision.sequence, 1);
    assert_eq!(accepted.after.revision.inventory, 1);
    assert_eq!(accepted.touched_domains, BTreeSet::from([Domain::Inventory]));
}
