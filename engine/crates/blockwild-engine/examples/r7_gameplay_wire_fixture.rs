//! Independently authored native bytes for every registered R7 wire family.
//! This is family coverage, not exhaustive gameplay-command variant coverage.
use std::{collections::BTreeSet, env, fmt::Write as _, fs, path::PathBuf};

use blockwild_authority::{CellPositionV1, WorldAuthorityRevisionV1};
use blockwild_engine::*;
use blockwild_gameplay::*;
use blockwild_runtime_wire::wire_checksum_v1;
use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId, PlayerId};

const PATH: &str = "tests/fixtures/rust-engine/integrated-runtime-v1/r7-gameplay-wire-v1.json";
const DEATH_DROP_FIXTURE: &str =
    include_str!("../../../../tests/fixtures/rust-engine/integrated-runtime-v1/death-respawn-drop-wire-v1.json");

fn hash(byte: u8) -> CanonicalHash {
    CanonicalHash([byte; 16])
}

fn identity() -> IntegratedRuntimeIdentityV2 {
    IntegratedRuntimeIdentityV2 {
        schema_version: INTEGRATED_RUNTIME_SCHEMA_V2,
        universe_id: "universe:r7:水".into(),
        location_id: "surface:雪".into(),
        revision: IntegratedRuntimeRevisionV2 {
            epoch: 1,
            world: 2,
            entities: 3,
            gameplay: 4,
            persistence: 5,
            network: 6,
            simulation: 7,
        },
        tick: 81,
        state_hash: hash(0x11),
    }
}

fn gameplay_identities() -> (AuthorityIdentity, AuthorityIdentity) {
    let before = AuthorityIdentity {
        world: WorldKey::new("universe:r7:水", "surface:雪"),
        revision: GameplayRevision {
            epoch: 17,
            sequence: u64::MAX - 4,
            inventory: u64::MAX - 5,
            machines: 3,
            combat: 4,
            progression: 5,
            cardforge: 6,
        },
        state_hash: hash(0x21),
    };
    let mut after = before.clone();
    after.revision.sequence += 1;
    after.revision.inventory += 1;
    after.state_hash = hash(0x22);
    (before, after)
}

fn basic_dirt_receipt(request_hash: CanonicalHash) -> RuntimeBasicDirtActionProjectionReceiptWireV1 {
    let mut content = IntegratedRuntimeBasicDirtActionContentBindingV1 {
        manifest_hash: hash(0x31),
        installed_registry_hash: hash(0x32),
        catalog_schema_version: 2,
        catalog_content_version: 9,
        catalog_blob_hash: hash(0x33),
        action_report_hash: hash(0x34),
        subset_hash: hash(0),
    };
    content.subset_hash = content.calculate_subset_hash_v1();
    let mut value = RuntimeBasicDirtActionProjectionWireV1 {
        schema_version: 1,
        sequence: 5,
        origin_input_sequence: 41,
        completion_tick: 81,
        action: IntegratedRuntimeBasicDirtActionKindV1::Place,
        position: CellPositionV1 { x: -3, y: -64, z: 17 },
        prior_block_id: 0,
        replacement_block_id: 2,
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
        before_world_hash: hash(0x41),
        after_world_hash: hash(0x42),
        creative_mode: true,
        inventory: IntegratedRuntimeBasicDirtInventoryDeltaV1 {
            container: ContainerKey::player("player:r7:雪"),
            slot: 8,
            before_revision: u64::MAX - 2,
            after_revision: u64::MAX - 2,
            before_stack: Some(ItemStack::simple(2, 64)),
            after_stack: Some(ItemStack::simple(2, 64)),
        },
        generated_drops: vec![],
        content,
        receipt_hash: hash(0),
    };
    value.receipt_hash = value.native_receipt_v1().calculate_hash_v1();
    RuntimeBasicDirtActionProjectionReceiptWireV1 {
        request_payload_hash: request_hash,
        identity: identity(),
        cursor_after: 5,
        receipt: Some(value),
    }
}

fn native_edit_receipt() -> IntegratedRuntimeNativeBlockEditReceiptV1 {
    let mut content = IntegratedRuntimeNativeBlockEditContentBindingV1 {
        block_id: 1,
        manifest_hash: hash(0x51),
        installed_registry_hash: hash(0x52),
        catalog_schema_version: 2,
        catalog_content_version: 9,
        catalog_blob_hash: hash(0x53),
        action_report_hash: hash(0x54),
        subset_hash: hash(0),
    };
    content.subset_hash = content.calculate_subset_hash_v1();
    let mut value = IntegratedRuntimeNativeBlockEditReceiptV1 {
        schema_version: 1,
        sequence: 5,
        origin_input_sequence: 41,
        completion_tick: 81,
        action: IntegratedRuntimeNativeBlockEditActionKindV1::Mine,
        position: CellPositionV1 { x: -3, y: 50, z: 17 },
        prior_block_id: 1,
        prior_facing: 0,
        replacement_block_id: 1,
        replacement_facing: 0,
        before_world_revision: WorldAuthorityRevisionV1 {
            epoch: 1,
            mutation: 9,
            residency: 3,
        },
        after_world_revision: WorldAuthorityRevisionV1 {
            epoch: 1,
            mutation: 9,
            residency: 3,
        },
        before_world_hash: hash(0x61),
        after_world_hash: hash(0x61),
        creative_mode: false,
        inventory: IntegratedRuntimeNativeBlockEditInventoryDeltaV1 {
            container: ContainerKey::player("player:r7:雪"),
            selected_slot: 8,
            before_revision: u64::MAX - 2,
            after_revision: u64::MAX - 1,
            before_stack: Some(ItemStack {
                item_code: 91,
                count: 1,
                durability_millionths: Some(750_000),
                metadata_hash: hash(0x62),
            }),
            after_stack: Some(ItemStack {
                item_code: 91,
                count: 1,
                durability_millionths: Some(650_000),
                metadata_hash: hash(0x62),
            }),
        },
        generated_drops: vec![],
        content,
        receipt_hash: hash(0),
    };
    value.receipt_hash = value.calculate_hash_v1();
    value
}

fn checked_drop_bytes(name: &str) -> Vec<u8> {
    let start = DEATH_DROP_FIXTURE
        .find(&format!("\"{name}\": {{"))
        .expect("checked drop vector");
    let tail = &DEATH_DROP_FIXTURE[start..];
    let marker = "\"hex\": \"";
    let tail = &tail[tail.find(marker).expect("checked drop hex") + marker.len()..];
    let value = &tail[..tail.find('"').expect("checked drop hex end")];
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).expect("hex ascii"), 16).expect("hex byte"))
        .collect()
}

pub struct Vector {
    pub family: &'static str,
    pub bytes: Vec<u8>,
    pub decode: fn(&[u8]) -> bool,
}

fn checked<T: PartialEq + std::fmt::Debug>(
    value: &T,
    encode: fn(&T) -> Result<Vec<u8>, blockwild_runtime_wire::WireError>,
    decode: fn(&[u8]) -> Result<T, blockwild_runtime_wire::WireError>,
) -> Vec<u8> {
    let bytes = encode(value).expect("native fixture encodes");
    let decoded = decode(&bytes).expect("native fixture decodes");
    assert_eq!(&decoded, value);
    assert_eq!(encode(&decoded).expect("native fixture re-encodes"), bytes);
    bytes
}

pub fn vectors() -> Vec<Vector> {
    let mut out = vec![];
    macro_rules! add {
        ($family:literal, $value:expr, $encode:path, $decode:path) => {{
            let bytes = checked(&$value, $encode, $decode);
            out.push(Vector {
                family: $family,
                bytes: bytes.clone(),
                decode: |bytes| $decode(bytes).is_ok(),
            });
            bytes
        }};
    }
    let query = add!(
        "basic-dirt-action-receipt-v1",
        RuntimeBasicDirtActionReceiptQueryWireV1 {
            expected: identity(),
            after_sequence: 4,
        },
        encode_runtime_basic_dirt_action_receipt_query_v1,
        decode_runtime_basic_dirt_action_receipt_query_v1
    );
    add!(
        "basic-dirt-action-projection-receipt-v1",
        basic_dirt_receipt(CanonicalHash(wire_checksum_v1(&query))),
        encode_runtime_basic_dirt_action_projection_receipt_v1,
        decode_runtime_basic_dirt_action_projection_receipt_v1
    );

    let bundle = compile_content_bundle(
        "source:r7:水",
        vec![ContentArtifact {
            domain: ContentDomain::Item,
            id: "orb:水".into(),
            schema_id: "item-definition".into(),
            schema_version: 1,
            content_version: 9,
            aliases: vec!["item:orb-水".into()],
            canonical_bytes: "{\"name\":\"Mizu 水\"}".as_bytes().to_vec(),
            unknown_extension_bytes: vec![0, 128, 255],
        }],
    )
    .expect("canonical content bundle");
    let page = ContentInstallPageWireV1 {
        install_id: "install:r7:水".into(),
        manifest_schema: bundle.manifest.schema_version,
        source_revision: bundle.manifest.source_revision.clone(),
        manifest_hash: bundle.manifest.manifest_hash,
        domains: bundle.manifest.domains.clone(),
        page_index: 0,
        page_count: 1,
        artifacts: bundle.artifacts,
    };
    add!(
        "content-install-page-v1",
        page.clone(),
        encode_content_install_page_v1,
        decode_content_install_page_v1
    );
    add!(
        "content-install-receipt-v1",
        ContentInstallReceiptWireV1 {
            status: ContentInstallReceiptStatusV1::Installed,
            install_id: page.install_id,
            source_revision: page.source_revision,
            manifest_hash: page.manifest_hash,
            domains: page.domains,
            accepted_pages: 1,
            page_count: 1,
            accepted_entries: 1,
            installed_entries: 1,
            installed_bytes: 23,
        },
        encode_content_install_receipt_v1,
        decode_content_install_receipt_v1
    );

    let grant = ActorGrant::host(
        PlayerId::new(0xffff_fffe, 0x8000_0001),
        EntityId::new(0x8765_4321, 0xfedc_ba98),
    );
    let grant_bytes = encode_gameplay_actor_grant_v1("actor:r7:雪", &grant).expect("native actor grant");
    assert_eq!(
        decode_gameplay_actor_grant_v1(&grant_bytes).unwrap(),
        ("actor:r7:雪".into(), grant)
    );
    let mut ack = b"BWK7\x01\0".to_vec();
    ack.extend_from_slice(&wire_checksum_v1(&grant_bytes));
    ack.extend_from_slice(hash(0x71).as_bytes());
    out.push(Vector {
        family: "gameplay-actor-grant-v1",
        bytes: grant_bytes,
        decode: |bytes| decode_gameplay_actor_grant_v1(bytes).is_ok(),
    });
    out.push(Vector {
        family: "gameplay-actor-grant-receipt-v1",
        bytes: ack,
        decode: |bytes| bytes.len() == 38 && &bytes[..6] == b"BWK7\x01\0",
    });

    let (before, after) = gameplay_identities();
    let batch = GameplayBatch::new(
        "batch:r7:水",
        "idem:r7:雪",
        GameplayActor {
            actor_id: "scheduler:r7".into(),
            player_id: None,
            entity_id: None,
            role: ActorRole::System,
        },
        before.clone(),
        vec![GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
            expected_tick: u64::MAX - 2,
            to_tick: u64::MAX - 1,
            machine_budget: 64,
        })],
    );
    add!(
        "gameplay-command-v1",
        batch,
        encode_gameplay_batch_v1,
        decode_gameplay_batch_v1
    );
    let mut accepted = AcceptedReceipt {
        batch_id: "batch:r7:水".into(),
        before: before.clone(),
        after: after.clone(),
        touched_domains: BTreeSet::from([Domain::Inventory, Domain::Progression]),
        resource_deltas: vec![ResourceDelta {
            item_code: 42,
            metadata_hash: hash(0x72),
            amount: i64::MIN + 3,
            reason: "consume:水".into(),
        }],
        stat_deltas: vec![StatDelta {
            record_id: "record:雪".into(),
            stat_id: "xp".into(),
            amount: i64::MAX - 3,
        }],
        events: vec![GameplayEvent {
            event_id: "event:r7".into(),
            kind: "inventory:changed".into(),
            actor_id: "actor:r7:雪".into(),
            record_id: Some("record:雪".into()),
            payload: OpaquePayload {
                type_id: "event:metadata".into(),
                schema: 2,
                bytes: vec![0, 128, 255],
            },
        }],
        receipt_hash: hash(0),
    };
    // This follows the native authority receipt hash, independently of the TS codec.
    let mut h = CanonicalHasher::new("blockwild.gameplay.receipt.v1");
    h.write_str(&accepted.batch_id);
    h.write_bytes(before.state_hash.as_bytes());
    h.write_bytes(after.state_hash.as_bytes());
    for domain in &accepted.touched_domains {
        h.write_u16(*domain as u16);
    }
    for delta in &accepted.resource_deltas {
        h.write_u32(delta.item_code);
        h.write_bytes(delta.metadata_hash.as_bytes());
        h.write_u64(delta.amount as u64);
        h.write_str(&delta.reason);
    }
    for delta in &accepted.stat_deltas {
        h.write_str(&delta.record_id);
        h.write_str(&delta.stat_id);
        h.write_u64(delta.amount as u64);
    }
    for event in &accepted.events {
        h.write_str(&event.event_id);
        h.write_str(&event.kind);
        h.write_str(&event.actor_id);
        if let Some(record) = &event.record_id {
            h.write_u16(1);
            h.write_str(record);
        } else {
            h.write_u16(0);
        }
        h.write_str(&event.payload.type_id);
        h.write_u16(event.payload.schema);
        h.write_bytes(&event.payload.bytes);
    }
    accepted.receipt_hash = h.finish();
    add!(
        "gameplay-receipt-v1",
        GameplayReceipt::Accepted(accepted),
        encode_gameplay_receipt_v1,
        decode_gameplay_receipt_v1
    );

    let query = add!(
        "native-block-edit-receipt-v1",
        RuntimeNativeBlockEditReceiptQueryWireV1 {
            expected: identity(),
            after_sequence: 4
        },
        encode_runtime_native_block_edit_receipt_query_v1,
        decode_runtime_native_block_edit_receipt_query_v1
    );
    add!(
        "native-block-edit-projection-receipt-v1",
        RuntimeNativeBlockEditProjectionReceiptWireV1 {
            request_payload_hash: CanonicalHash(wire_checksum_v1(&query)),
            identity: identity(),
            cursor_after: 5,
            receipt: Some(native_edit_receipt()),
        },
        encode_runtime_native_block_edit_projection_receipt_v1,
        decode_runtime_native_block_edit_projection_receipt_v1
    );
    let query = add!(
        "native-block-edit-receipt-v2",
        RuntimeNativeBlockEditReceiptQueryWireV2 {
            expected: identity(),
            after_sequence: 4
        },
        encode_runtime_native_block_edit_receipt_query_v2,
        decode_runtime_native_block_edit_receipt_query_v2
    );
    let native = native_edit_receipt();
    let mut dirty = IntegratedRuntimeNativeBlockEditDirtyEvidenceV1 {
        schema_version: 1,
        sequence: native.sequence,
        receipt_hash: native.receipt_hash,
        sections: vec![],
        columns: vec![],
        subsystem_seeds: vec![],
        evidence_hash: hash(0),
    };
    dirty.evidence_hash = dirty.calculate_hash_v1();
    add!(
        "native-block-edit-projection-receipt-v2",
        RuntimeNativeBlockEditProjectionReceiptWireV2 {
            request_payload_hash: CanonicalHash(wire_checksum_v1(&query)),
            identity: identity(),
            cursor_after: 5,
            receipt: Some(native),
            dirty_evidence: Some(dirty),
        },
        encode_runtime_native_block_edit_projection_receipt_v2,
        decode_runtime_native_block_edit_projection_receipt_v2
    );

    // Reuse independently authored rich player/death-drop vectors, including high-u64 custody and fixed-point fields.
    add!(
        "native-drop-pickup-receipt-v1",
        decode_runtime_native_drop_pickup_receipt_query_v1(&checked_drop_bytes("bwq8-request")).unwrap(),
        encode_runtime_native_drop_pickup_receipt_query_v1,
        decode_runtime_native_drop_pickup_receipt_query_v1
    );
    add!(
        "native-drop-pickup-projection-receipt-v1",
        decode_runtime_native_drop_pickup_projection_receipt_v1(&checked_drop_bytes("bwr8-receipt")).unwrap(),
        encode_runtime_native_drop_pickup_projection_receipt_v1,
        decode_runtime_native_drop_pickup_projection_receipt_v1
    );
    add!(
        "native-player-drop-receipt-v1",
        decode_runtime_native_player_drop_receipt_query_v1(&checked_drop_bytes("bwq9-request")).unwrap(),
        encode_runtime_native_player_drop_receipt_query_v1,
        decode_runtime_native_player_drop_receipt_query_v1
    );
    add!(
        "native-player-drop-projection-receipt-v1",
        decode_runtime_native_player_drop_projection_receipt_v1(&checked_drop_bytes("bws9-receipt")).unwrap(),
        encode_runtime_native_player_drop_projection_receipt_v1,
        decode_runtime_native_player_drop_projection_receipt_v1
    );

    let creative = PlayerCreativeSlotSetWireV1 {
        inventory: ContainerKey::player("player:r7:雪"),
        selected_slot: 8,
        expected_inventory_revision: u64::MAX - 2,
        expected_stack: Some(ItemStack::simple(42, 2)),
        replacement_stack: ItemStack::simple(43, 64),
    };
    let query = add!(
        "player-creative-slot-set-v1",
        creative.clone(),
        encode_player_creative_slot_set_v1,
        decode_player_creative_slot_set_v1
    );
    let mut receipt = PlayerCreativeSlotSetReceiptWireV1 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(&query)),
        before: before.clone(),
        after: after.clone(),
        accepted_receipt_hash: hash(0x81),
        inventory: creative.inventory,
        selected_slot: creative.selected_slot,
        previous_inventory_revision: creative.expected_inventory_revision,
        resulting_inventory_revision: creative.expected_inventory_revision + 1,
        prior_stack: creative.expected_stack,
        replacement_stack: creative.replacement_stack,
        inventory_result_hash: hash(0x82),
        receipt_hash: hash(0),
    };
    receipt.receipt_hash = player_creative_slot_set_receipt_hash_v1(&receipt).unwrap();
    add!(
        "player-creative-slot-set-receipt-v1",
        receipt,
        encode_player_creative_slot_set_receipt_v1,
        decode_player_creative_slot_set_receipt_v1
    );

    let mut slots = vec![None; 9];
    slots[8] = Some(ItemStack::simple(43, 64));
    let import = PlayerInventoryImportWireV1 {
        import: ImportPlayerInventoryV1 {
            inventory: ContainerKey::player("player:r7:雪"),
            expected_revision: 0,
            slots,
            metadata: vec![],
        },
        selected_slot: 8,
    };
    let query = add!(
        "player-inventory-import-v1",
        import,
        encode_player_inventory_import_v1,
        decode_player_inventory_import_v1
    );
    add!(
        "player-inventory-import-receipt-v1",
        PlayerInventoryImportReceiptWireV1 {
            request_payload_hash: CanonicalHash(wire_checksum_v1(&query)),
            before: before.clone(),
            after: after.clone(),
            accepted_receipt_hash: hash(0x91),
            inventory_revision: 1,
            selected_slot: 8,
            inventory_result_hash: hash(0x92),
        },
        encode_player_inventory_import_receipt_v1,
        decode_player_inventory_import_receipt_v1
    );
    let locator = PlayerLocatorItemConsumeWireV1 {
        inventory: ContainerKey::player("player:r7:雪"),
        selected_slot: 8,
        expected_inventory_revision: u64::MAX - 2,
        expected_stack: ItemStack::simple(603, 2),
        purpose: PlayerLocatorItemPurposeV1::SettlementChart,
        locator_result_hash: hash(0xa1),
    };
    let query = add!(
        "player-locator-item-consume-v1",
        locator.clone(),
        encode_player_locator_item_consume_v1,
        decode_player_locator_item_consume_v1
    );
    add!(
        "player-locator-item-consume-receipt-v1",
        PlayerLocatorItemConsumeReceiptWireV1 {
            request_payload_hash: CanonicalHash(wire_checksum_v1(&query)),
            purpose: locator.purpose,
            locator_result_hash: locator.locator_result_hash,
            before,
            after,
            accepted_receipt_hash: hash(0xa2),
            inventory: locator.inventory,
            selected_slot: locator.selected_slot,
            previous_inventory_revision: locator.expected_inventory_revision,
            resulting_inventory_revision: locator.expected_inventory_revision + 1,
            consumed_stack: ItemStack::simple(603, 1),
            remaining_stack: Some(ItemStack::simple(603, 1)),
            inventory_result_hash: hash(0xa3),
        },
        encode_player_locator_item_consume_receipt_v1,
        decode_player_locator_item_consume_receipt_v1
    );
    out.sort_by_key(|vector| vector.family);
    out
}

pub fn fixture() -> String {
    let vectors = vectors();
    assert_eq!(vectors.len(), 22);
    let mut out = String::from(
        "{\n  \"schema\": 1,\n  \"producer\": \"blockwild-engine/r7_gameplay_wire_fixture\",\n  \"coverage\": \"all 22 registered R7 families; gameplay commands: advance-schedule only\",\n  \"vectors\": [\n",
    );
    for (index, vector) in vectors.iter().enumerate() {
        let hex: String = vector.bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        writeln!(
            out,
            "    {{\"family\": \"{}\", \"hex\": \"{}\"}}{}",
            vector.family,
            hex,
            if index + 1 == vectors.len() { "" } else { "," }
        )
        .unwrap();
    }
    out.push_str("  ],\n  \"rejectedReceipts\": [\n");
    let rejected = rejected_receipts();
    for (index, bytes) in rejected.iter().enumerate() {
        let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        writeln!(
            out,
            "    \"{}\"{}",
            hex,
            if index + 1 == rejected.len() { "" } else { "," }
        )
        .unwrap();
    }
    out.push_str("  ]\n}\n");
    out
}

/// All frozen rejection tags are distinct from the accepted receipt body.
pub fn rejected_receipts() -> Vec<Vec<u8>> {
    [
        RejectionCode::WrongWorld,
        RejectionCode::StaleRevision,
        RejectionCode::Duplicate,
        RejectionCode::Unauthorized,
        RejectionCode::InvalidCommand,
        RejectionCode::InsufficientResource,
        RejectionCode::InvalidTarget,
        RejectionCode::Cooldown,
        RejectionCode::RulesRejected,
        RejectionCode::Capacity,
        RejectionCode::Conflict,
    ]
    .into_iter()
    .map(|code| {
        checked(
            &GameplayReceipt::Rejected {
                batch_id: "rejected:r7:水".into(),
                identity: gameplay_identities().0,
                rejection: Rejection::new(code, "blocked:雪"),
            },
            encode_gameplay_receipt_v1,
            decode_gameplay_receipt_v1,
        )
    })
    .collect()
}

pub fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..").join(PATH)
}

fn main() {
    let rendered = fixture();
    if env::args().any(|argument| argument == "--check") {
        assert_eq!(
            fs::read_to_string(fixture_path())
                .expect("checked R7 fixture")
                .replace("\r\n", "\n"),
            rendered
        );
        println!("r7-gameplay-wire-fixture=ok");
    } else {
        print!("{rendered}");
    }
}
