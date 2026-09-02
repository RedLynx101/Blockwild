use std::{env, fs, path::PathBuf};

use blockwild_authority::WorldAuthorityRevisionV1;
use blockwild_engine::{
    INTEGRATED_RUNTIME_NATIVE_DROP_PICKUP_RECEIPT_SCHEMA_V1, INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_SCHEMA_V1,
    INTEGRATED_RUNTIME_SCHEMA_V2, IntegratedRuntimeIdentityV2, IntegratedRuntimeNativeDropPickupAuthorityEvidenceV1,
    IntegratedRuntimeNativeDropPickupOriginV1, IntegratedRuntimeNativeDropPickupReceiptV1,
    IntegratedRuntimeNativeDropPickupSlotDeltaV1, IntegratedRuntimeNativeDropPickupSourceV1,
    IntegratedRuntimeNativePlayerDropContentBindingV1, IntegratedRuntimeNativePlayerDropInventoryDeltaV1,
    IntegratedRuntimeNativePlayerDropReceiptV1, IntegratedRuntimeNativePlayerDropSpawnV1, IntegratedRuntimeRevisionV2,
    PlayerDeathCustodyLaneV1, PlayerRespawnReceiptWireV1, PlayerRespawnWireV1,
    RuntimeNativeDropPickupProjectionReceiptWireV1, RuntimeNativeDropPickupReceiptQueryWireV1,
    RuntimeNativePlayerDropProjectionReceiptWireV1, RuntimeNativePlayerDropReceiptQueryWireV1,
    decode_player_respawn_receipt_v1, decode_player_respawn_v1,
    decode_runtime_native_drop_pickup_projection_receipt_v1, decode_runtime_native_drop_pickup_receipt_query_v1,
    decode_runtime_native_player_drop_projection_receipt_v1, decode_runtime_native_player_drop_receipt_query_v1,
    encode_player_respawn_receipt_v1, encode_player_respawn_v1,
    encode_runtime_native_drop_pickup_projection_receipt_v1, encode_runtime_native_drop_pickup_receipt_query_v1,
    encode_runtime_native_player_drop_projection_receipt_v1, encode_runtime_native_player_drop_receipt_query_v1,
    player_respawn_receipt_hash_v1,
};
use blockwild_gameplay::{
    ContainerKey, ContainerKind, FixedWorldVec3V1, GameplayRevision, ItemStack, RotationMicroturnsV1, WorldKey,
    WorldViewRevisionV1,
};
use blockwild_runtime_wire::wire_checksum_v1;
use blockwild_types::{CanonicalHash, EntityId, PlayerId};

const FIXTURE_RELATIVE_PATH: &str = "tests/fixtures/rust-engine/integrated-runtime-v1/death-respawn-drop-wire-v1.json";
const HIGH_REVISION: u64 = 0xf000_0000_0000_0100;

fn hash(seed: u8) -> CanonicalHash {
    let mut bytes = [0_u8; 16];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = seed.wrapping_add((index as u8).wrapping_mul(17));
    }
    CanonicalHash(bytes)
}

fn hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}").expect("writing to String is infallible");
    }
    output
}

fn checksum_hex(bytes: &[u8]) -> String {
    hex(&wire_checksum_v1(bytes))
}

fn identity(
    universe_id: &str,
    location_id: &str,
    revision: IntegratedRuntimeRevisionV2,
    tick: u64,
    state_hash: CanonicalHash,
) -> IntegratedRuntimeIdentityV2 {
    IntegratedRuntimeIdentityV2 {
        schema_version: INTEGRATED_RUNTIME_SCHEMA_V2,
        universe_id: universe_id.into(),
        location_id: location_id.into(),
        revision,
        tick,
        state_hash,
    }
}

fn respawn_request() -> PlayerRespawnWireV1 {
    PlayerRespawnWireV1 {
        expected: identity(
            "universe:wire:死亡🌍",
            "surface:雪",
            IntegratedRuntimeRevisionV2 {
                epoch: 17,
                world: 101,
                entities: 202,
                gameplay: 303,
                persistence: 404,
                network: 505,
                simulation: 606,
            },
            4_294_967_299,
            hash(0x11),
        ),
        external_entity_id: "player:opaque:水:🦊".into(),
        actor_id: "actor:opaque:雪:🧭".into(),
        player_id: PlayerId::new(0x89ab_cdef, 0xfedc_ba98),
        entity_id: EntityId::new(0x7654_3210, 0xedcb_a987),
        expected_entity_revision: 9_007_199_254_740_901,
        expected_gameplay_sequence: 9_007_199_254_740_801,
        expected_gameplay_combat_revision: 9_007_199_254_740_701,
        expected_combatant_revision: 9_007_199_254_740_601,
        expected_death_sequence: 9_007_199_254_740_501,
        expected_max_health: 1_234_567,
        respawn_position: FixedWorldVec3V1 {
            x_milli: -33_554_431_999,
            y_milli: 12_345_678,
            z_milli: 33_554_431_997,
        },
        keep_inventory: false,
    }
}

fn respawn_receipt(request: &PlayerRespawnWireV1, request_bytes: &[u8]) -> PlayerRespawnReceiptWireV1 {
    let mut after = request.expected.clone();
    after.revision.entities += 1;
    after.revision.gameplay += 2;
    after.revision.simulation += 1;
    after.state_hash = hash(0x22);
    let mut receipt = PlayerRespawnReceiptWireV1 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(request_bytes)),
        before: request.expected.clone(),
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
        resulting_oxygen_seconds: f64::from(f32::from_bits(0x4145_70a4)),
        keep_inventory: request.keep_inventory,
        inventory_before_revision: 9_007_199_254_740_400,
        inventory_after_revision: 9_007_199_254_740_401,
        equipment_before_revision: 9_007_199_254_740_300,
        equipment_after_revision: 9_007_199_254_740_301,
        custody_before_hash: hash(0x33),
        custody_after_hash: hash(0x44),
        generated_drop_count: 2,
        receipt_hash: CanonicalHash::default(),
    };
    receipt.receipt_hash = player_respawn_receipt_hash_v1(&receipt).expect("valid BWE7 fixture");
    receipt
}

fn player_drop_identity() -> IntegratedRuntimeIdentityV2 {
    identity(
        "universe:drop:玩家🌌",
        "surface:峡谷",
        IntegratedRuntimeRevisionV2 {
            epoch: 23,
            world: 701,
            entities: 702,
            gameplay: 703,
            persistence: 704,
            network: 705,
            simulation: 706,
        },
        4_294_967_333,
        hash(0x51),
    )
}

fn authority_evidence(seed: u8) -> IntegratedRuntimeNativeDropPickupAuthorityEvidenceV1 {
    let gameplay_before = GameplayRevision {
        epoch: 29,
        sequence: HIGH_REVISION + 1,
        inventory: HIGH_REVISION + 11,
        machines: HIGH_REVISION + 21,
        combat: HIGH_REVISION + 31,
        progression: HIGH_REVISION + 41,
        cardforge: HIGH_REVISION + 51,
    };
    let world_view_before = WorldViewRevisionV1 {
        epoch: 31,
        sequence: HIGH_REVISION + 61,
        clock: HIGH_REVISION + 71,
        machine_anchors: HIGH_REVISION + 81,
        dropped_items: HIGH_REVISION + 91,
        player_bindings: HIGH_REVISION + 101,
        environment: HIGH_REVISION + 111,
        atmosphere_gravity: HIGH_REVISION + 121,
        celestial: HIGH_REVISION + 131,
    };
    IntegratedRuntimeNativeDropPickupAuthorityEvidenceV1 {
        before_gameplay_revision: gameplay_before,
        before_gameplay_hash: hash(seed),
        after_gameplay_revision: GameplayRevision {
            sequence: gameplay_before.sequence + 1,
            inventory: gameplay_before.inventory + 1,
            ..gameplay_before
        },
        after_gameplay_hash: hash(seed.wrapping_add(1)),
        before_entity_revision: HIGH_REVISION + 141,
        before_entity_hash: hash(seed.wrapping_add(2)),
        after_entity_revision: HIGH_REVISION + 142,
        after_entity_hash: hash(seed.wrapping_add(3)),
        before_world_view_revision: world_view_before,
        before_world_view_hash: hash(seed.wrapping_add(4)),
        after_world_view_revision: WorldViewRevisionV1 {
            sequence: world_view_before.sequence + 1,
            dropped_items: world_view_before.dropped_items + 1,
            ..world_view_before
        },
        after_world_view_hash: hash(seed.wrapping_add(5)),
    }
}

fn player_drop_projection(
    query_bytes: &[u8],
    identity: IntegratedRuntimeIdentityV2,
) -> RuntimeNativePlayerDropProjectionReceiptWireV1 {
    let stack = ItemStack {
        item_code: 270,
        count: 2,
        durability_millionths: Some(543_219),
        metadata_hash: hash(0x61),
    };
    let actor = "actor:drop:玩家:🧰";
    let created_tick = 4_294_967_332;
    let mut receipt = IntegratedRuntimeNativePlayerDropReceiptV1 {
        schema_version: INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_SCHEMA_V1,
        sequence: 4_321,
        origin_input_sequence: 9_007_199_254_740_123,
        completion_tick: 4_294_967_333,
        world: WorldKey::new("universe:drop:玩家🌌", "surface:峡谷"),
        world_revision: WorldAuthorityRevisionV1 {
            epoch: 37,
            mutation: 38,
            residency: 39,
        },
        world_state_hash: hash(0x62),
        player_id: PlayerId::new(0x1357_9bdf, 0xfdb9_7531),
        player_entity_id: EntityId::new(0x2468_ace0, 0xeca8_6420),
        inventory: IntegratedRuntimeNativePlayerDropInventoryDeltaV1 {
            container: ContainerKey::player(actor),
            selected_slot: 8,
            before_revision: HIGH_REVISION + 201,
            after_revision: HIGH_REVISION + 202,
            before_stack: Some(stack.clone()),
            after_stack: Some(ItemStack {
                count: 1,
                ..stack.clone()
            }),
        },
        drop: IntegratedRuntimeNativePlayerDropSpawnV1 {
            drop_id: "drop:玩家:🧪:4321".into(),
            entity_id: EntityId::new(0xdead_beef, 0xcafe_babe),
            stack: ItemStack { count: 1, ..stack },
            custody_container: ContainerKey {
                kind: ContainerKind::Container,
                id: "drop-custody:玩家:🧪:4321".into(),
                owner_id: None,
            },
            custody_slot: 0,
            custody_revision: 0,
            spatial_revision: 0,
            position: FixedWorldVec3V1 {
                x_milli: -33_554_431_991,
                y_milli: 23_456_789,
                z_milli: 33_554_431_989,
            },
            velocity_milli_per_second: FixedWorldVec3V1 {
                x_milli: -4_095_999,
                y_milli: 1_234_567,
                z_milli: 4_095_997,
            },
            rotation: RotationMicroturnsV1 {
                yaw: 999_983,
                pitch: 123_457,
                roll: 765_431,
            },
            created_tick,
            expires_tick: Some(created_tick + 600),
            pickup_lock_actor_id: None,
            pickup_unlock_tick: created_tick + 7,
            origin_hash: CanonicalHash::default(),
        },
        authority: authority_evidence(0x70),
        content: IntegratedRuntimeNativePlayerDropContentBindingV1 {
            configured_manifest_hash: hash(0x80),
            installed_manifest_hash: hash(0x80),
            installed_registry_hash: hash(0x81),
            item_content_hash: hash(0x82),
            item_content_version: 0x7654_3210,
        },
        receipt_hash: CanonicalHash::default(),
    };
    receipt.drop.origin_hash = receipt.calculate_origin_hash_v1();
    receipt.receipt_hash = receipt.calculate_hash_v1();
    RuntimeNativePlayerDropProjectionReceiptWireV1 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(query_bytes)),
        cursor_after: receipt.sequence,
        identity,
        receipt: Some(receipt),
    }
}

fn pickup_identity() -> IntegratedRuntimeIdentityV2 {
    identity(
        "universe:pickup:死亡🌠",
        "surface:神殿",
        IntegratedRuntimeRevisionV2 {
            epoch: 41,
            world: 801,
            entities: 802,
            gameplay: 803,
            persistence: 804,
            network: 805,
            simulation: 806,
        },
        4_294_967_555,
        hash(0x91),
    )
}

fn pickup_projection(
    query_bytes: &[u8],
    respawn_receipt_hash: CanonicalHash,
    identity: IntegratedRuntimeIdentityV2,
) -> RuntimeNativeDropPickupProjectionReceiptWireV1 {
    let stack = ItemStack {
        item_code: 124,
        count: 3,
        durability_millionths: Some(333_667),
        metadata_hash: hash(0x92),
    };
    let before_revision = HIGH_REVISION + 301;
    let custody_before_revision = HIGH_REVISION + 311;
    let mut receipt = IntegratedRuntimeNativeDropPickupReceiptV1 {
        schema_version: INTEGRATED_RUNTIME_NATIVE_DROP_PICKUP_RECEIPT_SCHEMA_V1,
        sequence: 5_432,
        completion_tick: 4_294_967_554,
        world: WorldKey::new("universe:pickup:死亡🌠", "surface:神殿"),
        world_revision: WorldAuthorityRevisionV1 {
            epoch: 43,
            mutation: 44,
            residency: 45,
        },
        world_state_hash: hash(0x93),
        player_id: PlayerId::new(0xffff_ff01, 0x8000_0001),
        player_entity_id: EntityId::new(0xffff_ff02, 0x8000_0002),
        inventory_container: ContainerKey::player("player:pickup:英雄:🎒"),
        inventory_before_revision: before_revision,
        inventory_after_revision: before_revision + 2,
        affected_slots: vec![
            IntegratedRuntimeNativeDropPickupSlotDeltaV1 {
                slot: 2,
                before_stack: Some(ItemStack {
                    count: 62,
                    ..stack.clone()
                }),
                after_stack: Some(ItemStack {
                    count: 64,
                    ..stack.clone()
                }),
            },
            IntegratedRuntimeNativeDropPickupSlotDeltaV1 {
                slot: 7,
                before_stack: None,
                after_stack: Some(ItemStack {
                    count: 1,
                    ..stack.clone()
                }),
            },
        ],
        source: IntegratedRuntimeNativeDropPickupSourceV1 {
            drop_id: "death-drop:死亡:🫐:5432".into(),
            entity_id: EntityId::new(0xffff_ff03, 0x8000_0003),
            origin: IntegratedRuntimeNativeDropPickupOriginV1::PlayerDeathDrop {
                respawn_sequence: 9_007_199_254_740_321,
                respawn_receipt_hash,
                source_lane: PlayerDeathCustodyLaneV1::Equipment,
                source_slot: 7,
            },
            stack,
            custody_container: ContainerKey {
                kind: ContainerKind::Container,
                id: "death-drop-custody:死亡:🫐:5432".into(),
                owner_id: None,
            },
            custody_slot: 0,
            custody_before_revision,
            custody_emptied_revision: custody_before_revision + 2,
            spatial_revision: HIGH_REVISION + 321,
            position: FixedWorldVec3V1 {
                x_milli: 33_554_431_983,
                y_milli: -12_345_679,
                z_milli: -33_554_431_981,
            },
            velocity_milli_per_second: FixedWorldVec3V1 {
                x_milli: 4_095_991,
                y_milli: -1_234_569,
                z_milli: -4_095_989,
            },
            rotation: RotationMicroturnsV1 {
                yaw: 999_979,
                pitch: 246_913,
                roll: 864_197,
            },
        },
        authority: authority_evidence(0xa0),
        receipt_hash: CanonicalHash::default(),
    };
    receipt.receipt_hash = receipt.calculate_hash_v1();
    RuntimeNativeDropPickupProjectionReceiptWireV1 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(query_bytes)),
        cursor_after: receipt.sequence,
        identity,
        receipt: Some(receipt),
    }
}

struct Vector {
    name: &'static str,
    direction: &'static str,
    magic: &'static str,
    bytes: Vec<u8>,
}

fn build_vectors() -> Result<Vec<Vector>, Box<dyn std::error::Error>> {
    let request = respawn_request();
    let bwd7 = encode_player_respawn_v1(&request)?;
    let decoded_bwd7 = decode_player_respawn_v1(&bwd7)?;
    assert_eq!(decoded_bwd7, request);
    assert_eq!(encode_player_respawn_v1(&decoded_bwd7)?, bwd7);

    let receipt = respawn_receipt(&request, &bwd7);
    let bwe7 = encode_player_respawn_receipt_v1(&receipt)?;
    let decoded_bwe7 = decode_player_respawn_receipt_v1(&bwe7)?;
    assert_eq!(decoded_bwe7, receipt);
    assert_eq!(encode_player_respawn_receipt_v1(&decoded_bwe7)?, bwe7);

    let player_drop_identity = player_drop_identity();
    let bwq9_value = RuntimeNativePlayerDropReceiptQueryWireV1 {
        expected: player_drop_identity.clone(),
        after_sequence: 4_320,
    };
    let bwq9 = encode_runtime_native_player_drop_receipt_query_v1(&bwq9_value)?;
    let decoded_bwq9 = decode_runtime_native_player_drop_receipt_query_v1(&bwq9)?;
    assert_eq!(decoded_bwq9, bwq9_value);
    assert_eq!(encode_runtime_native_player_drop_receipt_query_v1(&decoded_bwq9)?, bwq9);

    let bws9_value = player_drop_projection(&bwq9, player_drop_identity);
    let bws9 = encode_runtime_native_player_drop_projection_receipt_v1(&bws9_value)?;
    let decoded_bws9 = decode_runtime_native_player_drop_projection_receipt_v1(&bws9)?;
    assert_eq!(decoded_bws9, bws9_value);
    assert_eq!(
        encode_runtime_native_player_drop_projection_receipt_v1(&decoded_bws9)?,
        bws9
    );

    let pickup_identity = pickup_identity();
    let bwq8_value = RuntimeNativeDropPickupReceiptQueryWireV1 {
        expected: pickup_identity.clone(),
        after_sequence: 5_431,
    };
    let bwq8 = encode_runtime_native_drop_pickup_receipt_query_v1(&bwq8_value)?;
    let decoded_bwq8 = decode_runtime_native_drop_pickup_receipt_query_v1(&bwq8)?;
    assert_eq!(decoded_bwq8, bwq8_value);
    assert_eq!(encode_runtime_native_drop_pickup_receipt_query_v1(&decoded_bwq8)?, bwq8);

    let bwr8_value = pickup_projection(&bwq8, receipt.receipt_hash, pickup_identity);
    let bwr8 = encode_runtime_native_drop_pickup_projection_receipt_v1(&bwr8_value)?;
    let decoded_bwr8 = decode_runtime_native_drop_pickup_projection_receipt_v1(&bwr8)?;
    assert_eq!(decoded_bwr8, bwr8_value);
    assert_eq!(
        encode_runtime_native_drop_pickup_projection_receipt_v1(&decoded_bwr8)?,
        bwr8
    );

    Ok(vec![
        Vector {
            name: "bwd7-request",
            direction: "typescript-to-rust",
            magic: "BWD7",
            bytes: bwd7,
        },
        Vector {
            name: "bwe7-receipt",
            direction: "rust-to-typescript",
            magic: "BWE7",
            bytes: bwe7,
        },
        Vector {
            name: "bwq9-request",
            direction: "typescript-to-rust",
            magic: "BWQ9",
            bytes: bwq9,
        },
        Vector {
            name: "bws9-receipt",
            direction: "rust-to-typescript",
            magic: "BWS9",
            bytes: bws9,
        },
        Vector {
            name: "bwq8-request",
            direction: "typescript-to-rust",
            magic: "BWQ8",
            bytes: bwq8,
        },
        Vector {
            name: "bwr8-receipt",
            direction: "rust-to-typescript",
            magic: "BWR8",
            bytes: bwr8,
        },
    ])
}

fn render_fixture() -> Result<String, Box<dyn std::error::Error>> {
    let vectors = build_vectors()?;
    let mut output = String::from(
        "{\n  \"schema\": 1,\n  \"generator\": \"blockwild-engine/death_respawn_drop_wire_fixtures\",\n  \"vectors\": {\n",
    );
    for (index, vector) in vectors.iter().enumerate() {
        use std::fmt::Write as _;
        writeln!(&mut output, "    \"{}\": {{", vector.name)?;
        writeln!(&mut output, "      \"direction\": \"{}\",", vector.direction)?;
        writeln!(&mut output, "      \"magic\": \"{}\",", vector.magic)?;
        writeln!(&mut output, "      \"byteLength\": {},", vector.bytes.len())?;
        writeln!(
            &mut output,
            "      \"wireChecksum\": \"{}\",",
            checksum_hex(&vector.bytes)
        )?;
        writeln!(&mut output, "      \"hex\": \"{}\"", hex(&vector.bytes))?;
        writeln!(
            &mut output,
            "    }}{}",
            if index + 1 == vectors.len() { "" } else { "," }
        )?;
    }
    output.push_str("  }\n}\n");
    Ok(output)
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("blockwild workspace root")
        .join(FIXTURE_RELATIVE_PATH)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let rendered = render_fixture()?;
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        None => print!("{rendered}"),
        Some("--write") => {
            let path = args.next().map(PathBuf::from).unwrap_or_else(fixture_path);
            fs::write(&path, rendered)?;
            println!("wrote {}", path.display());
        }
        Some("--check") => {
            let path = args.next().map(PathBuf::from).unwrap_or_else(fixture_path);
            let checked = fs::read_to_string(&path)?;
            if checked != rendered {
                return Err(format!("{} is stale; regenerate with --write before checking", path.display()).into());
            }
            println!("checked {}", path.display());
        }
        Some(argument) => {
            return Err(format!("unknown argument {argument}; expected --write or --check").into());
        }
    }
    if let Some(extra) = args.next() {
        return Err(format!("unexpected extra argument {extra}").into());
    }
    Ok(())
}
