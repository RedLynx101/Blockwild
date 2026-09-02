use std::{env, fs, path::PathBuf};

use blockwild_authority::WorldAuthorityRevisionV1;
use blockwild_engine::*;
use blockwild_gameplay::{CombatVitalUnits, FixedWorldVec3V1};
use blockwild_runtime_wire::{RuntimeInputFrameV1, WireError, wire_checksum_v1};
use blockwild_simulation::{CameraModeV1, CameraProfileV1};
use blockwild_types::{CanonicalHash, EntityId, PlayerId};

const FIXTURE_PATH: &str = "tests/fixtures/rust-engine/integrated-runtime-v1/r5-simulation-wire-v1.json";
const SAFE_MAX: u64 = 9_007_199_254_740_991;
const HIGH: u64 = 0xf000_0000_0000_0100;

fn hash(seed: u8) -> CanonicalHash {
    CanonicalHash(std::array::from_fn(|index| {
        seed.wrapping_add((index as u8).wrapping_mul(17))
    }))
}

fn identity() -> IntegratedRuntimeIdentityV2 {
    IntegratedRuntimeIdentityV2 {
        schema_version: INTEGRATED_RUNTIME_SCHEMA_V2,
        universe_id: "universe:水".into(),
        location_id: "surface:雪".into(),
        revision: IntegratedRuntimeRevisionV2 {
            epoch: 11,
            world: 12,
            entities: 13,
            gameplay: 14,
            persistence: 15,
            network: 16,
            simulation: 17,
        },
        tick: SAFE_MAX,
        state_hash: hash(0x11),
    }
}

pub fn binding() -> RuntimePlayerBindingWireV1 {
    RuntimePlayerBindingWireV1 {
        external_entity_id: "player:水".into(),
        actor_id: "actor:雪".into(),
        player_id: PlayerId::new(0x89ab_cdef, 0xfedc_ba98),
        creative_mode: true,
        radius: 0.375,
        standing_height: 1.875,
        crouching_height: 1.125,
        mass: 77.5,
        walk_speed: 4.25,
        sprint_speed: 7.75,
        creative_flight_speed: 12.5,
        maximum_oxygen_seconds: 33.25,
    }
}

pub struct Vector {
    pub family: &'static str,
    pub bytes: Vec<u8>,
}

/// Build every registered R5 family from native domain values, never from
/// checked JSON or TypeScript output. Aliased BWB6 families remain separate.
pub fn vectors() -> Result<Vec<Vector>, WireError> {
    let mut vectors = Vec::new();
    macro_rules! push {
        ($id:expr, $bytes:expr) => {{
            let bytes = $bytes;
            assert_eq!(decode_reencode($id, &bytes)?, bytes);
            vectors.push(Vector { family: $id, bytes });
        }};
    }
    let continuity = RuntimeContextCommandContinuityQueryWireV2 { expected: identity() };
    let request = encode_runtime_context_command_continuity_query_v2(&continuity)?;
    let receipt = RuntimeContextCommandContinuityReceiptWireV2 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(&request)),
        identity: identity(),
        last_sequence: Some(SAFE_MAX),
        next_sequence: None,
        queued_commands_empty: true,
    };
    push!("context-command-continuity-v2", request);
    push!(
        "context-command-continuity-receipt-v2",
        encode_runtime_context_command_continuity_receipt_v2(&receipt)?
    );

    let player = binding();
    let target = PlayerBootstrapStatusQueryWireV1 {
        external_entity_id: player.external_entity_id.clone(),
        actor_id: player.actor_id.clone(),
        player_id: player.player_id,
    };
    let request = encode_player_bootstrap_status_query_v1(&target)?;
    let receipt = PlayerBootstrapStatusWireV1 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(&request)),
        world_authority_revision: WorldAuthorityRevisionV1 {
            epoch: HIGH,
            mutation: HIGH + 1,
            residency: HIGH + 2,
        },
        entity_authority_revision: HIGH + 3,
        next_sequence: Some(HIGH + 4),
        tick: HIGH + 5,
        last_monotonic_time_us: HIGH + 6,
        last_input_sequence: Some(u64::MAX),
        next_input_sequence: None,
        last_action_sequence: Some(HIGH + 7),
        next_action_sequence: Some(HIGH + 8),
        authoritative_flags: 0,
        last_applied_input: Some(RuntimeInputFrameV1 {
            sequence: u64::MAX,
            target_tick: HIGH + 5,
            move_x: -32767,
            move_z: 32767,
            look_yaw: -12345,
            look_pitch: 23456,
            buttons: 1,
            selected_slot: 8,
            flags: 0,
        }),
        queued_inputs_empty: true,
        entity: None,
        runtime_player: Some(PlayerBootstrapRuntimePlayerWireV1 {
            entity_id: EntityId::new(29, 31),
            binding: player.clone(),
        }),
        world_view_binding: None,
        custody: None,
    };
    push!("player-bootstrap-status-v1", request);
    push!(
        "player-bootstrap-status-receipt-v1",
        encode_player_bootstrap_status_v1(&receipt)?
    );

    let request = encode_player_combat_bootstrap_status_query_v1(&target)?;
    let receipt = PlayerCombatBootstrapStatusWireV1 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(&request)),
        entity_authority_revision: HIGH,
        gameplay_sequence: HIGH + 1,
        gameplay_combat_revision: HIGH + 2,
        gameplay_state_hash: hash(0x22),
        status: PlayerCombatBootstrapStatusV1::ExactLinked,
        blocker: None,
        combatant: Some(PlayerCombatantBootstrapWireV1 {
            record_id: "combat:水".into(),
            owner_id: Some(player.actor_id.clone()),
            revision: HIGH + 3,
            entity_id: Some(EntityId::new(29, 31)),
            vital_units: CombatVitalUnits::MilliheartsV1,
            health: 12_345,
            max_health: 20_000,
            alive: true,
            cross_domain_parity: true,
        }),
    };
    push!("player-combat-bootstrap-status-v1", request);
    push!(
        "player-combat-bootstrap-status-receipt-v1",
        encode_player_combat_bootstrap_status_v1(&receipt)?
    );

    let mode = PlayerGameModeSetWireV1 {
        external_entity_id: player.external_entity_id.clone(),
        actor_id: player.actor_id.clone(),
        player_id: player.player_id,
        expected_creative_mode: false,
        expected_flags: 0,
        requested_creative_mode: true,
    };
    let request = encode_player_game_mode_set_v1(&mode)?;
    let before = identity();
    let mut after = before.clone();
    after.revision.simulation += 1;
    after.state_hash = hash(0x33);
    let mut receipt = PlayerGameModeSetReceiptWireV1 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(&request)),
        before,
        after,
        external_entity_id: player.external_entity_id.clone(),
        actor_id: player.actor_id.clone(),
        player_id: player.player_id,
        prior_creative_mode: false,
        prior_flags: 0,
        resulting_creative_mode: true,
        resulting_flags: blockwild_runtime_wire::RUNTIME_INPUT_FLAG_CREATIVE_V1,
        receipt_hash: CanonicalHash::default(),
    };
    receipt.receipt_hash = player_game_mode_set_receipt_hash_v1(&receipt)?;
    push!("player-game-mode-set-v1", request);
    push!(
        "player-game-mode-set-receipt-v1",
        encode_player_game_mode_set_receipt_v1(&receipt)?
    );

    let high = SAFE_MAX - 50;
    let respawn = PlayerRespawnWireV1 {
        expected: identity(),
        external_entity_id: player.external_entity_id.clone(),
        actor_id: player.actor_id.clone(),
        player_id: player.player_id,
        entity_id: EntityId::new(29, 31),
        expected_entity_revision: high,
        expected_gameplay_sequence: high + 1,
        expected_gameplay_combat_revision: high + 2,
        expected_combatant_revision: high + 3,
        expected_death_sequence: high + 4,
        expected_max_health: 20_000,
        respawn_position: FixedWorldVec3V1 {
            x_milli: -33_554_432_000,
            y_milli: 12_345,
            z_milli: 33_554_432_000,
        },
        keep_inventory: true,
    };
    let request = encode_player_respawn_v1(&respawn)?;
    let mut after = respawn.expected.clone();
    after.revision.simulation += 1;
    after.revision.entities += 1;
    after.revision.gameplay += 1;
    after.state_hash = hash(0x44);
    let mut receipt = PlayerRespawnReceiptWireV1 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(&request)),
        before: respawn.expected.clone(),
        after,
        external_entity_id: respawn.external_entity_id.clone(),
        actor_id: respawn.actor_id.clone(),
        player_id: respawn.player_id,
        entity_id: respawn.entity_id,
        death_sequence: respawn.expected_death_sequence,
        prior_entity_revision: high,
        resulting_entity_revision: high + 1,
        prior_gameplay_sequence: high + 1,
        resulting_gameplay_sequence: high + 2,
        prior_gameplay_combat_revision: high + 2,
        resulting_gameplay_combat_revision: high + 3,
        prior_combatant_revision: high + 3,
        resulting_combatant_revision: high + 4,
        maximum_health: 20_000,
        prior_health: 0,
        resulting_health: 20_000,
        prior_alive: false,
        resulting_alive: true,
        respawn_position: respawn.respawn_position,
        resulting_oxygen_seconds: 33.25,
        keep_inventory: true,
        inventory_before_revision: high + 5,
        inventory_after_revision: high + 5,
        equipment_before_revision: high + 6,
        equipment_after_revision: high + 6,
        custody_before_hash: hash(0x55),
        custody_after_hash: hash(0x55),
        generated_drop_count: 0,
        receipt_hash: CanonicalHash::default(),
    };
    receipt.receipt_hash = player_respawn_receipt_hash_v1(&receipt)?;
    push!("player-respawn-v1", request);
    push!("player-respawn-receipt-v1", encode_player_respawn_receipt_v1(&receipt)?);

    let camera = RuntimeCameraConfigWireV1 {
        expected_camera_revision: SAFE_MAX - 1,
        mode: CameraModeV1::ThirdFront,
        profile: CameraProfileV1 {
            rear_shoulder_offset: -0.375,
            far: 65_536.0,
            ..CameraProfileV1::default()
        },
    };
    let request = encode_runtime_camera_config_v1(&camera)?;
    let receipt = RuntimeCameraConfigReceiptWireV1 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(&request)),
        previous_camera_revision: SAFE_MAX - 1,
        resulting_camera_revision: SAFE_MAX,
        mode: camera.mode,
        profile: camera.profile,
        camera_state_hash: runtime_camera_config_state_hash_v1(SAFE_MAX, camera.mode, camera.profile),
    };
    push!("simulation-camera-config-v1", request);
    push!(
        "simulation-camera-config-receipt-v1",
        encode_runtime_camera_config_receipt_v1(&receipt)?
    );

    let request = encode_runtime_player_binding_v1(&player)?;
    for family in [
        "simulation-player-bind-v2",
        "simulation-player-bind-v3",
        "simulation-player-bind-v4",
        "simulation-player-bind-receipt-v2",
    ] {
        push!(family, request.clone());
    }
    let ack = RuntimePlayerFinalBindReceiptWireV1 {
        request_payload_hash: CanonicalHash(wire_checksum_v1(&request)),
        terminal_state_hash: hash(0x66),
    };
    push!(
        "simulation-player-bind-final-receipt-v3",
        encode_runtime_player_final_bind_receipt_v1(RuntimePlayerFinalBindVersionV1::InventoryV3, ack)
    );
    push!(
        "simulation-player-bind-final-receipt-v4",
        encode_runtime_player_final_bind_receipt_v1(RuntimePlayerFinalBindVersionV1::CombatV4, ack)
    );
    Ok(vectors)
}

pub fn decode_reencode(family: &str, bytes: &[u8]) -> Result<Vec<u8>, WireError> {
    macro_rules! codec {
        ($decode:ident, $encode:ident) => {
            $encode(&$decode(bytes)?)
        };
    }
    match family {
        "context-command-continuity-v2" => codec!(
            decode_runtime_context_command_continuity_query_v2,
            encode_runtime_context_command_continuity_query_v2
        ),
        "context-command-continuity-receipt-v2" => codec!(
            decode_runtime_context_command_continuity_receipt_v2,
            encode_runtime_context_command_continuity_receipt_v2
        ),
        "player-bootstrap-status-v1" => codec!(
            decode_player_bootstrap_status_query_v1,
            encode_player_bootstrap_status_query_v1
        ),
        "player-bootstrap-status-receipt-v1" => {
            codec!(decode_player_bootstrap_status_v1, encode_player_bootstrap_status_v1)
        }
        "player-combat-bootstrap-status-v1" => codec!(
            decode_player_combat_bootstrap_status_query_v1,
            encode_player_combat_bootstrap_status_query_v1
        ),
        "player-combat-bootstrap-status-receipt-v1" => codec!(
            decode_player_combat_bootstrap_status_v1,
            encode_player_combat_bootstrap_status_v1
        ),
        "player-game-mode-set-v1" => codec!(decode_player_game_mode_set_v1, encode_player_game_mode_set_v1),
        "player-game-mode-set-receipt-v1" => codec!(
            decode_player_game_mode_set_receipt_v1,
            encode_player_game_mode_set_receipt_v1
        ),
        "player-respawn-v1" => codec!(decode_player_respawn_v1, encode_player_respawn_v1),
        "player-respawn-receipt-v1" => codec!(decode_player_respawn_receipt_v1, encode_player_respawn_receipt_v1),
        "simulation-camera-config-v1" => codec!(decode_runtime_camera_config_v1, encode_runtime_camera_config_v1),
        "simulation-camera-config-receipt-v1" => codec!(
            decode_runtime_camera_config_receipt_v1,
            encode_runtime_camera_config_receipt_v1
        ),
        "simulation-player-bind-v2"
        | "simulation-player-bind-v3"
        | "simulation-player-bind-v4"
        | "simulation-player-bind-receipt-v2" => {
            codec!(decode_runtime_player_binding_v1, encode_runtime_player_binding_v1)
        }
        "simulation-player-bind-final-receipt-v3" | "simulation-player-bind-final-receipt-v4" => {
            let version = if family.ends_with("v3") {
                RuntimePlayerFinalBindVersionV1::InventoryV3
            } else {
                RuntimePlayerFinalBindVersionV1::CombatV4
            };
            Ok(encode_runtime_player_final_bind_receipt_v1(
                version,
                decode_runtime_player_final_bind_receipt_v1(version, bytes)?,
            ))
        }
        _ => panic!("unknown R5 family {family}"),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn fixture() -> String {
    use std::fmt::Write as _;
    let mut output = String::from(
        "{\n  \"schema\": 1,\n  \"producer\": \"blockwild-engine/r5_simulation_wire_fixture\",\n  \"families\": [\n",
    );
    let vectors = vectors().expect("native R5 fixture values are valid");
    for (index, vector) in vectors.iter().enumerate() {
        let family = INTEGRATED_RUNTIME_DOMAIN_WIRE_FAMILIES_V1
            .iter()
            .find(|family| family.id == vector.family)
            .expect("registered R5 family");
        writeln!(&mut output, "    {{\"id\": \"{}\", \"direction\": \"{}\", \"magic\": \"{}\", \"operationSchema\": {}, \"innerSchema\": {}, \"checksum\": \"{}\", \"hex\": \"{}\"}}{}",
            family.id, family.direction, std::str::from_utf8(&family.magic).unwrap(), family.operation_schema, family.inner_schema,
            hex(&wire_checksum_v1(&vector.bytes)), hex(&vector.bytes), if index + 1 == vectors.len() { "" } else { "," }).unwrap();
    }
    output.push_str("  ]\n}\n");
    output
}

pub fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(FIXTURE_PATH)
}

fn main() {
    let rendered = fixture();
    if env::args().any(|argument| argument == "--check") {
        assert_eq!(
            fs::read_to_string(fixture_path())
                .expect("checked R5 fixture exists")
                .replace("\r\n", "\n"),
            rendered
        );
        println!("r5-simulation-wire-fixture=ok");
    } else {
        print!("{rendered}");
    }
}
