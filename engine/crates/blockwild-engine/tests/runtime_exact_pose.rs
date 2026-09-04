use blockwild_authority::{SectionInstallV1, WORLD_SECTION_CELL_COUNT_V1, WorldCellV1, WorldSectionAddressV1};
use blockwild_engine::*;
use blockwild_entity::{
    ENTITY_COMMAND_SCHEMA, EntityClass, EntityCommand, EntityCommandBatch, EntityCompatibilityRecord, EntityResidency,
    Vec3 as EntityVec3,
};
use blockwild_runtime_wire::RuntimeInputFrameV1;
use blockwild_types::PlayerId;

fn runtime_with_player() -> IntegratedRuntimeV2 {
    let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
    let address = runtime.world().active_address().clone();
    for section_y in [4_i16, 7_i16, 8_i16] {
        let mut cells = vec![WorldCellV1::default(); WORLD_SECTION_CELL_COUNT_V1];
        if section_y == 7 {
            for z in 0..16 {
                for x in 0..16 {
                    cells[x + 16 * (z + 16 * 15)].block_id = 1;
                }
            }
        }
        runtime
            .world_mut_for_platform_install()
            .install_section_for_replay(SectionInstallV1 {
                address: WorldSectionAddressV1 {
                    world: address.clone(),
                    chunk_x: 0,
                    chunk_z: 0,
                    section_y,
                },
                cells,
                source_revision: u64::from(section_y as u16),
                source_hash: format!("{section_y:032x}"),
            })
            .unwrap();
    }
    let mut record = EntityCompatibilityRecord::new("player:one", "player:one", "player");
    record.class = EntityClass::Player;
    record.position = EntityVec3::new(8.0, 63.5, 8.0);
    record.health = 20.0;
    record.maximum_health = 20.0;
    record.custom.insert("physics.grounded".into(), "true".into());
    let mut batch = IntegratedRuntimeBatchV2::empty("spawn-player", runtime.identity());
    batch.entities.push(EntityCommandBatch {
        schema: ENTITY_COMMAND_SCHEMA,
        sequence: 1,
        expected_revision: 0,
        tick: 0,
        commands: vec![EntityCommand::Spawn {
            record,
            residency: EntityResidency::Hot,
        }],
    });
    assert!(runtime.commit(batch).accepted());
    runtime
        .bind_player(RuntimePlayerBindingWireV1 {
            external_entity_id: "player:one".into(),
            actor_id: "player:one".into(),
            player_id: PlayerId::new(1, 1),
            creative_mode: true,
            radius: 0.35,
            standing_height: 1.8,
            crouching_height: 1.35,
            mass: 80.0,
            walk_speed: 4.3,
            sprint_speed: 6.2,
            creative_flight_speed: 8.0,
            maximum_oxygen_seconds: 15.0,
        })
        .unwrap();
    runtime
}

fn exact_continuation(runtime: &IntegratedRuntimeV2) -> RuntimePlayerExactContinuationV1 {
    let player = runtime.player().unwrap();
    RuntimePlayerExactContinuationV1 {
        expected: runtime.identity(),
        binding: RuntimeExactPlayerBindingV1 {
            actor_id: player.binding.actor_id.clone(),
            external_entity_id: player.binding.external_entity_id.clone(),
            player_id: player.binding.player_id,
            entity_id: player.entity_id,
        },
        position: [8.000000000000002, 63.5, 8.000000000000004],
        velocity: [0.0, -0.0, 0.0],
        yaw: 0.123456789012345,
        pitch: -0.234567890123456,
    }
}

#[test]
fn exact_continuation_is_accepted_only_at_the_existing_player_cas_boundary() {
    let mut runtime = runtime_with_player();
    let request = exact_continuation(&runtime);
    runtime.continue_player_exact_pose_v1(request.clone()).unwrap();
    let body = &runtime.player().unwrap().body;
    assert_eq!(body.position.x.to_bits(), request.position[0].to_bits());
    assert_eq!(body.position.z.to_bits(), request.position[2].to_bits());
    assert_eq!(body.velocity.y.to_bits(), (-0.0_f64).to_bits());
    let identity = runtime.identity();
    assert!(runtime.continue_player_exact_pose_v1(request).is_err());
    assert_eq!(runtime.identity(), identity);
}

fn exact_input(
    runtime: &IntegratedRuntimeV2,
    sequence: u64,
    target_tick: u64,
    yaw: f64,
    pitch: f64,
) -> RuntimeExactInputFrameV2 {
    let (look_yaw, look_pitch) = exact_look_projection(yaw, pitch);
    RuntimeExactInputFrameV2 {
        binding: exact_continuation(runtime).binding,
        controls: RuntimeInputFrameV1 {
            sequence,
            target_tick,
            look_yaw,
            look_pitch,
            ..RuntimeInputFrameV1::default()
        },
        yaw,
        pitch,
    }
}

fn drain(runtime: &mut IntegratedRuntimeV2) {
    use blockwild_persistence::*;
    for _ in 0..64 {
        let diagnostics = runtime.persistence_authority().diagnostics();
        if diagnostics.dirty_records == 0 && !diagnostics.commit_in_flight && runtime.persistence_dispatcher().is_idle()
        {
            return;
        }
        let packet = runtime
            .poll_persistence_platform(INTEGRATED_RUNTIME_PERSISTENCE_MAX_PACKET_BYTES)
            .unwrap()
            .unwrap();
        let PersistenceBrowserRequestV1::Commit {
            request_id,
            transaction,
            checkpoint,
        } = decode_persistence_browser_request_v1(&packet.bytes).unwrap()
        else {
            panic!("commit expected")
        };
        let response = encode_persistence_browser_response_v1(&PersistenceBrowserResponseV1::Commit(
            PersistenceBrowserCommitResultV1 {
                request_id,
                code: PersistenceBrowserCommitCodeV1::Committed,
                transaction_id: transaction.transaction_id,
                journal_sequence: transaction.next_journal_sequence,
                durable_hash: blockwild_types::CanonicalHash([0x77; 16]),
                checkpoint_hash: checkpoint.checkpoint_hash,
                verified_readback: true,
                message: "durable native test fixture".into(),
            },
        ))
        .unwrap();
        assert_eq!(
            runtime
                .complete_persistence_platform(packet.transfer_token, &response)
                .unwrap()
                .status,
            PersistenceDispatchStatusV1::Accepted
        );
    }
    panic!("persistence did not drain");
}

#[test]
fn real_fixed_ticks_retain_exact_idle_look_and_resolve_changed_input_once() {
    let mut runtime = runtime_with_player();
    let request = exact_continuation(&runtime);
    runtime.continue_player_exact_pose_v1(request.clone()).unwrap();
    assert_eq!(runtime.step(1_000_000, 8_000).unwrap().fixed_steps, 0);
    assert_eq!(runtime.step(1_050_000, 8_000).unwrap().fixed_steps, 1);
    let idle = runtime.network_player_pose_v2().unwrap();
    assert_eq!(idle.source.yaw.to_bits(), request.yaw.to_bits());
    assert_eq!(idle.source.pitch.to_bits(), request.pitch.to_bits());
    assert_eq!(idle.source.position[0].to_bits(), request.position[0].to_bits());
    assert_eq!(idle.source.position[2].to_bits(), request.position[2].to_bits());
    let mut input = exact_input(&runtime, 1, 2, -0.345678901234567, 0.456789012345678);
    input.controls.move_z = i16::MAX;
    runtime.accept_exact_inputs_v2(&[input.clone()]).unwrap();
    assert_eq!(runtime.step(1_100_000, 8_000).unwrap().fixed_steps, 1);
    let moved = runtime.network_player_pose_v2().unwrap();
    assert_eq!(moved.source.yaw.to_bits(), input.yaw.to_bits());
    assert_eq!(moved.source.pitch.to_bits(), input.pitch.to_bits());
    assert_ne!(moved.source.position, idle.source.position);
    assert_ne!(moved.source.position[0], f64::from(moved.source.position[0] as f32));
    assert_eq!(moved.source.input_sequence, 1);
    let before = runtime.player().unwrap().clone();
    runtime.bind_player(before.binding.clone()).unwrap();
    assert_eq!(runtime.player().unwrap().body, before.body);
    assert_eq!(
        runtime.exact_player_state_v1().unwrap().yaw.to_bits(),
        input.yaw.to_bits()
    );
    assert_eq!(runtime.step(1_150_000, 8_000).unwrap().fixed_steps, 1);
    assert_eq!(
        runtime.network_player_pose_v2().unwrap().source.yaw.to_bits(),
        input.yaw.to_bits()
    );
}

#[test]
fn camera_pose_distinguishes_f64_looks_that_share_one_legacy_i16_projection() {
    let below = std::f64::consts::FRAC_PI_4 - f64::EPSILON;
    let above = std::f64::consts::FRAC_PI_4 + f64::EPSILON;
    assert_eq!(exact_look_projection(below, 0.0), exact_look_projection(above, 0.0));
    let mut first = runtime_with_player();
    let mut second = runtime_with_player();
    let mut first_request = exact_continuation(&first);
    first_request.yaw = below;
    let mut second_request = exact_continuation(&second);
    second_request.yaw = above;
    first.continue_player_exact_pose_v1(first_request).unwrap();
    second.continue_player_exact_pose_v1(second_request).unwrap();
    let first_pose = first.camera_pose([1_100, 700]).unwrap();
    let second_pose = second.camera_pose([1_100, 700]).unwrap();
    assert_ne!(
        first_pose, second_pose,
        "camera must consume the f64 authority, not its shared i16 projection"
    );
    assert_ne!(first_pose.pose_hash, second_pose.pose_hash);
}

#[test]
fn exact_checkpoint_retains_pending_sidecar_and_next_real_step_equivalence() {
    let mut runtime = runtime_with_player();
    runtime
        .continue_player_exact_pose_v1(exact_continuation(&runtime))
        .unwrap();
    runtime.step(1_000_000, 8_000).unwrap();
    assert_eq!(runtime.step(1_050_000, 8_000).unwrap().fixed_steps, 1);
    let mut input = exact_input(&runtime, 1, 2, -0.0, 0.123456789012345);
    input.controls.move_x = i16::MAX / 3;
    runtime.accept_exact_inputs_v2(&[input]).unwrap();
    drain(&mut runtime);
    let bytes = runtime.export_runtime_checkpoint().unwrap();
    assert!(bytes.windows(6).any(|value| value == b"BWRC\x11\x00"));
    let mut restored =
        IntegratedRuntimeV2::restore_runtime_checkpoint(&bytes, integrated_runtime_checkpoint_hash_v1(&bytes)).unwrap();
    let activation_identity = restored.exact_player_state_v1().unwrap().continuation.expected.clone();
    assert_eq!(restored.state_hash(), runtime.state_hash());
    assert_eq!(restored.export_runtime_checkpoint().unwrap(), bytes);
    assert_eq!(
        restored.camera_pose([1100, 700]).unwrap(),
        runtime.camera_pose([1100, 700]).unwrap()
    );
    assert_eq!(runtime.step(1_100_000, 8_000).unwrap().fixed_steps, 1);
    assert_eq!(restored.step(1_100_000, 8_000).unwrap().fixed_steps, 1);
    assert_eq!(restored.state_hash(), runtime.state_hash());
    assert_eq!(restored.player().unwrap().body, runtime.player().unwrap().body);
    assert_eq!(
        restored.network_player_pose_v2().unwrap(),
        runtime.network_player_pose_v2().unwrap()
    );
    assert_eq!(
        restored.exact_player_state_v1().unwrap().yaw.to_bits(),
        (-0.0_f64).to_bits()
    );
    assert_eq!(
        restored.exact_player_state_v1().unwrap().continuation.expected,
        activation_identity
    );
    assert_ne!(
        restored.identity(),
        activation_identity,
        "activation lineage is immutable history, not a current-identity alias"
    );
}

#[test]
fn v17_hash_and_checkpoint_distinguish_signed_zero_while_legacy_v16_is_stable() {
    let mut positive = runtime_with_player();
    let mut negative = runtime_with_player();
    drain(&mut positive);
    drain(&mut negative);
    let legacy_positive = positive.export_runtime_checkpoint().unwrap();
    let legacy_negative = negative.export_runtime_checkpoint().unwrap();
    assert_eq!(legacy_positive, legacy_negative);
    assert!(legacy_positive.windows(6).any(|value| value == b"BWRC\x10\x00"));

    let mut plus_request = exact_continuation(&positive);
    plus_request.velocity = [0.0, 0.0, 0.0];
    plus_request.yaw = 0.0;
    plus_request.pitch = 0.0;
    let mut minus_request = exact_continuation(&negative);
    minus_request.velocity = [-0.0, 0.0, 0.0];
    minus_request.yaw = -0.0;
    minus_request.pitch = 0.0;
    positive.continue_player_exact_pose_v1(plus_request).unwrap();
    negative.continue_player_exact_pose_v1(minus_request).unwrap();
    drain(&mut positive);
    drain(&mut negative);
    assert_ne!(positive.state_hash(), negative.state_hash());
    let plus = positive.export_runtime_checkpoint().unwrap();
    let minus = negative.export_runtime_checkpoint().unwrap();
    assert_ne!(plus, minus);
    assert!(plus.windows(6).any(|value| value == b"BWRC\x11\x00"));
    assert!(minus.windows(6).any(|value| value == b"BWRC\x11\x00"));
    let restored_minus =
        IntegratedRuntimeV2::restore_runtime_checkpoint(&minus, integrated_runtime_checkpoint_hash_v1(&minus)).unwrap();
    assert_eq!(
        restored_minus.player().unwrap().body.velocity.x.to_bits(),
        (-0.0_f64).to_bits()
    );
    assert_eq!(
        restored_minus.exact_player_state_v1().unwrap().yaw.to_bits(),
        (-0.0_f64).to_bits()
    );
}

#[test]
fn exact_input_packet_and_admission_reject_tamper_without_mutation() {
    let mut runtime = runtime_with_player();
    runtime
        .continue_player_exact_pose_v1(exact_continuation(&runtime))
        .unwrap();
    let input = exact_input(&runtime, 1, 1, -0.0, 0.123456789012345);
    let bytes = encode_runtime_exact_input_v2(&input).unwrap();
    let decoded = decode_runtime_exact_input_v2(&bytes).unwrap();
    assert_eq!(decoded.yaw.to_bits(), input.yaw.to_bits());
    assert_eq!(encode_runtime_exact_input_v2(&decoded).unwrap(), bytes);
    for index in [0, 4, 6, bytes.len() - 17, bytes.len() - 1] {
        let mut corrupt = bytes.clone();
        corrupt[index] ^= 1;
        assert!(decode_runtime_exact_input_v2(&corrupt).is_err());
    }
    let before = runtime.identity();
    for variant in 0..5 {
        let mut bad = input.clone();
        match variant {
            0 => bad.binding.actor_id = "other".into(),
            1 => bad.binding.entity_id = blockwild_types::EntityId::new(0, 99),
            2 => bad.controls.look_pitch += 1,
            3 => bad.yaw = f64::NAN,
            _ => bad.controls.target_tick = 999,
        }
        assert!(runtime.accept_exact_inputs_v2(&[input.clone(), bad]).is_err());
        assert_eq!(runtime.identity(), before);
    }
}

#[test]
fn exact_continuation_rejects_invalid_finite_domains_and_identity_atomically() {
    let mut runtime = runtime_with_player();
    let before = runtime.identity();
    for variant in 0..8 {
        let mut request = exact_continuation(&runtime);
        match variant {
            0 => request.position[0] = f64::INFINITY,
            1 => request.position[0] = 33_554_433.0,
            2 => request.velocity[2] = 4096.000001,
            3 => request.yaw = std::f64::consts::PI + 0.000001,
            4 => request.pitch = -std::f64::consts::FRAC_PI_2 - 0.000001,
            5 => request.binding.actor_id = "other".into(),
            6 => request.expected.revision.simulation += 1,
            _ => request.expected.state_hash.0[0] ^= 1,
        }
        assert!(runtime.continue_player_exact_pose_v1(request).is_err());
        assert_eq!(runtime.identity(), before);
    }
}

#[test]
fn exact_native_network_projection_is_bound_and_read_only() {
    use blockwild_network::*;
    assert_eq!(
        NETWORK_PLAYER_POSE_MAX_ABS_POSITION_V2,
        blockwild_simulation::PHYSICS_MAX_ABS_POSITION_V1
    );
    assert_eq!(
        NETWORK_PLAYER_POSE_MAX_ABS_VELOCITY_V2,
        blockwild_simulation::PHYSICS_MAX_ABS_VELOCITY_V1
    );
    let mut runtime = runtime_with_player();
    runtime
        .continue_player_exact_pose_v1(exact_continuation(&runtime))
        .unwrap();
    runtime.step(1_000_000, 8_000).unwrap();
    assert_eq!(runtime.step(1_050_000, 8_000).unwrap().fixed_steps, 1);
    let before = runtime.identity();
    let projection = runtime.network_player_pose_v2().unwrap();
    assert_eq!(projection.source.state_hash, before.state_hash);
    assert_eq!(projection.source.tick, before.tick);
    assert_eq!(projection.source.entity_id, runtime.player().unwrap().entity_id);
    assert_eq!(projection.source.revision.simulation, before.revision.simulation);
    let bytes = encode_network_player_pose_v2(&projection).unwrap();
    assert_eq!(decode_network_player_pose_v2(&bytes).unwrap(), projection);
    assert_eq!(runtime.identity(), before);
    let mut forged = projection.clone();
    forged.source.position[0] += 0.00000001;
    assert!(encode_network_player_pose_v2(&forged).is_err());
    let resealed = NetworkPlayerPoseV2::new(forged.source).unwrap();
    assert_ne!(
        resealed.projection_hash, projection.projection_hash,
        "resealed codec values are not native producer evidence"
    );
}

#[test]
fn exact_mode_rejects_external_r6_signed_zero_yaw_and_position_drift() {
    for variant in 0..3 {
        let mut runtime = runtime_with_player();
        let mut request = exact_continuation(&runtime);
        request.velocity[0] = -0.0;
        runtime.continue_player_exact_pose_v1(request).unwrap();
        let before = runtime.identity();
        let player = runtime.player().unwrap();
        let mut record = runtime.entities().hot().get(&player.entity_id).unwrap().record.clone();
        match variant {
            0 => record.velocity.x = 0.0,
            1 => record.yaw += 0.1,
            _ => record.position.x += 0.25,
        }
        let mut batch = IntegratedRuntimeBatchV2::empty("forged-exact-projection", before.clone());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 100,
            expected_revision: runtime.entities().revision(),
            tick: 0,
            commands: vec![EntityCommand::ReplaceCompatibilityRecord {
                id: player.entity_id,
                value: record,
            }],
        });
        assert!(!runtime.commit(batch).accepted());
        assert_eq!(runtime.identity(), before);
    }
}

#[test]
fn same_player_rebind_preserves_actual_f64_fixed_step_body() {
    let mut runtime = runtime_with_player();
    runtime
        .accept_inputs(&[RuntimeInputFrameV1 {
            sequence: 1,
            target_tick: 1,
            move_z: i16::MAX,
            ..RuntimeInputFrameV1::default()
        }])
        .unwrap();
    assert_eq!(runtime.step(1_000_000, 8_000).unwrap().fixed_steps, 0);
    assert_eq!(runtime.step(1_050_000, 8_000).unwrap().fixed_steps, 1);
    let before = runtime.player().unwrap().clone();
    assert_ne!(
        f64::from(before.body.position.z as f32),
        before.body.position.z,
        "real physics produced sub-f32 position"
    );
    runtime.bind_player(before.binding.clone()).unwrap();
    assert_eq!(
        runtime.player().unwrap().body,
        before.body,
        "same binding must not reconstruct the precise body from R6 f32"
    );
}

#[test]
fn explicit_legacy_entity_teleport_still_rebinds_from_its_f32_origin() {
    let mut runtime = runtime_with_player();
    let player = runtime.player().unwrap().clone();
    let mut record = runtime.entities().hot().get(&player.entity_id).unwrap().record.clone();
    record.position = EntityVec3::new(4.25, 64.0, 9.75);
    record.velocity = EntityVec3::new(0.5, 0.0, -0.75);
    let mut batch = IntegratedRuntimeBatchV2::empty("explicit-legacy-teleport", runtime.identity());
    batch.entities.push(EntityCommandBatch {
        schema: ENTITY_COMMAND_SCHEMA,
        sequence: 100,
        expected_revision: runtime.entities().revision(),
        tick: 0,
        commands: vec![EntityCommand::ReplaceCompatibilityRecord {
            id: player.entity_id,
            value: record,
        }],
    });
    assert!(runtime.commit(batch).accepted());
    runtime.bind_player(player.binding).unwrap();
    let body = &runtime.player().unwrap().body;
    assert_eq!([body.position.x, body.position.y, body.position.z], [4.25, 64.0, 9.75]);
    assert_eq!([body.velocity.x, body.velocity.y, body.velocity.z], [0.5, 0.0, -0.75]);
}
