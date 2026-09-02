use blockwild_types::CanonicalHash;

use crate::*;

#[test]
fn handshake_negotiation_is_exact_and_rejects_mixed_versions() {
    let fixture = canonical_network_fixture_v1().unwrap();
    assert_eq!(
        fixture.host_handshake.capabilities,
        vec![
            NetworkCapabilityV1::Observe,
            NetworkCapabilityV1::Chat,
            NetworkCapabilityV1::Interact,
            NetworkCapabilityV1::AgentWork,
        ]
    );
    let compatible = negotiate_network_handshake_v1(&fixture.host_handshake, &fixture.peer_handshake);
    assert!(compatible.decision.compatible);
    assert_eq!(
        compatible.decision.capabilities,
        vec![
            NetworkCapabilityV1::Observe,
            NetworkCapabilityV1::Chat,
            NetworkCapabilityV1::Interact,
        ]
    );
    assert_eq!(compatible.decision.max_command_bytes, 131_072);

    let mut mixed_engine = fixture.peer_handshake.clone();
    mixed_engine.engine_version = "1.12.0-legacy".into();
    let rejected = negotiate_network_handshake_v1(&fixture.host_handshake, &mixed_engine);
    assert!(!rejected.decision.compatible);
    assert_eq!(rejected.decision.code, HandshakeDecisionCodeV1::EngineMismatch);
    assert!(rejected.decision.capabilities.is_empty());
}

#[test]
fn all_canonical_wire_values_round_trip() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let handshake = encode_network_handshake_v1(&fixture.host_handshake).unwrap();
    assert_eq!(decode_network_handshake_v1(&handshake).unwrap(), fixture.host_handshake);
    let command = encode_network_command_v1(&fixture.agent_command).unwrap();
    assert_eq!(decode_network_command_v1(&command).unwrap(), fixture.agent_command);
    let delta = encode_network_delta_v1(&fixture.delta).unwrap();
    assert_eq!(decode_network_delta_v1(&delta).unwrap(), fixture.delta);
    let checkpoint = encode_network_checkpoint_v1(&fixture.checkpoint).unwrap();
    assert_eq!(decode_network_checkpoint_v1(&checkpoint).unwrap(), fixture.checkpoint);
    let work = encode_agent_work_command_v1(&fixture.agent_work).unwrap();
    assert_eq!(decode_agent_work_command_v1(&work).unwrap(), fixture.agent_work);
}

#[test]
fn wire_rejects_truncation_trailing_data_versions_and_malicious_sizes() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let encoded = encode_network_command_v1(&fixture.human_command).unwrap();
    assert_eq!(
        decode_network_command_v1(&encoded[..encoded.len() - 1])
            .unwrap_err()
            .code,
        NetworkErrorCode::Truncated
    );
    let mut trailing = encoded.clone();
    trailing.push(0);
    assert_eq!(
        decode_network_command_v1(&trailing).unwrap_err().code,
        NetworkErrorCode::Truncated
    );
    let mut schema = encoded.clone();
    schema[4] = 2;
    assert_eq!(
        decode_network_command_v1(&schema).unwrap_err().code,
        NetworkErrorCode::SchemaMismatch
    );
    let mut oversized = encoded;
    oversized[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_eq!(
        decode_network_command_v1(&oversized).unwrap_err().code,
        NetworkErrorCode::Truncated
    );
}

#[test]
fn native_player_pose_payload_and_projection_round_trip_and_reject_tampering() {
    let pose = native_player_pose(42);
    assert_eq!(pose.pose_hash.to_hex(), "4f75838a9217204c90910000d1e2b543");
    let bytes = encode_network_player_pose_v1(&pose).unwrap();
    assert_eq!(decode_network_player_pose_v1(&bytes).unwrap(), pose);
    assert!(bytes.len() <= NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1);

    let mut tampered_pose = bytes;
    *tampered_pose.last_mut().unwrap() ^= 0x80;
    assert_eq!(
        decode_network_player_pose_v1(&tampered_pose).unwrap_err().code,
        NetworkErrorCode::HashMismatch,
    );

    let projection = NetworkPlayerPoseProjectionV1::new(NetworkPlayerPoseProjectionSourceV1 {
        session_id: "session-r9".into(),
        peer_id: "peer-1".into(),
        connection_id: "conn-human-1".into(),
        player_id: "peer-1".into(),
        command_id: "pose:42".into(),
        command_sequence: 7,
        command_hash: CanonicalHash([0x11; 16]),
        receipt_hash: CanonicalHash([0x22; 16]),
        presented_delta_sequence: 9,
        presented_identity_hash: CanonicalHash([0x33; 16]),
        record_revision: 3,
        previous_record_hash: CanonicalHash([0x44; 16]),
        pose: pose.clone(),
    })
    .unwrap();
    let bytes = encode_network_player_pose_projection_v1(&projection).unwrap();
    assert_eq!(projection.record_hash.to_hex(), "51987a01efaa8790b089bb6f605af956");
    assert_eq!(projection.projection_hash.to_hex(), "8d3d9d01fbda1c00e077e7654e4135d2");
    assert_eq!(decode_network_player_pose_projection_v1(&bytes).unwrap(), projection);
    assert!(bytes.len() <= NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1);

    let mut tampered_projection = bytes;
    *tampered_projection.last_mut().unwrap() ^= 0x01;
    assert_eq!(
        decode_network_player_pose_projection_v1(&tampered_projection)
            .unwrap_err()
            .code,
        NetworkErrorCode::HashMismatch,
    );

    for (record_revision, previous_record_hash) in [(1, CanonicalHash([0x44; 16])), (2, CanonicalHash::default())] {
        assert_eq!(
            NetworkPlayerPoseProjectionV1::new(NetworkPlayerPoseProjectionSourceV1 {
                session_id: "session-r9".into(),
                peer_id: "peer-1".into(),
                connection_id: "conn-human-1".into(),
                player_id: "peer-1".into(),
                command_id: "pose:ancestry".into(),
                command_sequence: 8,
                command_hash: CanonicalHash([0x11; 16]),
                receipt_hash: CanonicalHash([0x22; 16]),
                presented_delta_sequence: 9,
                presented_identity_hash: CanonicalHash([0x33; 16]),
                record_revision,
                previous_record_hash,
                pose: pose.clone(),
            })
            .unwrap_err()
            .code,
            NetworkErrorCode::HashMismatch,
        );
    }
}

#[test]
fn native_player_pose_rejects_each_bounded_integer_family() {
    let mut source = native_player_pose_source(1);
    source.x_milliblocks = NETWORK_PLAYER_POSE_MAX_HORIZONTAL_MILLIBLOCKS_V1 + 1;
    assert_eq!(
        NetworkPlayerPoseV1::new(source).unwrap_err().code,
        NetworkErrorCode::InvalidInteger,
    );

    let mut source = native_player_pose_source(1);
    source.pitch_milliradians = NETWORK_PLAYER_POSE_MAX_PITCH_MILLIRADIANS_V1 + 1;
    assert_eq!(
        NetworkPlayerPoseV1::new(source).unwrap_err().code,
        NetworkErrorCode::InvalidInteger,
    );

    let mut source = native_player_pose_source(1);
    source.velocity_y_milliblocks_per_second = NETWORK_PLAYER_POSE_MAX_VELOCITY_MILLIBLOCKS_PER_SECOND_V1 + 1;
    assert_eq!(
        NetworkPlayerPoseV1::new(source).unwrap_err().code,
        NetworkErrorCode::InvalidInteger,
    );

    let mut source = native_player_pose_source(1);
    source.selected_slot = Some(9);
    assert_eq!(
        NetworkPlayerPoseV1::new(source).unwrap_err().code,
        NetworkErrorCode::InvalidInteger,
    );

    let mut source = native_player_pose_source(1);
    source.swimming_per_mille = Some(1_001);
    assert_eq!(
        NetworkPlayerPoseV1::new(source).unwrap_err().code,
        NetworkErrorCode::InvalidInteger,
    );

    let mut source = native_player_pose_source(1);
    source.boat_turn_per_mille = Some(-1_001);
    assert_eq!(
        NetworkPlayerPoseV1::new(source).unwrap_err().code,
        NetworkErrorCode::InvalidInteger,
    );

    let mut source = native_player_pose_source(1);
    source.mounted_creature_id = Some(NETWORK_MAX_SAFE_INTEGER_V1 + 1);
    assert_eq!(
        NetworkPlayerPoseV1::new(source).unwrap_err().code,
        NetworkErrorCode::InvalidInteger,
    );

    let mut source = native_player_pose_source(1);
    source.boat_id = None;
    assert_eq!(
        NetworkPlayerPoseV1::new(source).unwrap_err().code,
        NetworkErrorCode::InvalidLabel,
    );

    let mut source = native_player_pose_source(1);
    source.mounted_creature_id = None;
    assert_eq!(
        NetworkPlayerPoseV1::new(source).unwrap_err().code,
        NetworkErrorCode::InvalidLabel,
    );
}

#[test]
fn native_guest_pose_projection_is_accepted_idempotent_and_monotonic() {
    let (fixture, mut runtime) = native_player_pose_runtime();
    let first_pose = native_player_pose(42);
    let first_command = native_player_pose_command(&fixture, "pose:42", "pose-idem:42", "conn-human-1", 0, &first_pose);
    let first_request = prepare_network_guest_pose_request_v1(501, &fixture.delta.to, 1_000, &first_command).unwrap();
    let (first_receipt, first_projection) = native_player_pose_response(&mut runtime, &first_request);
    assert!(first_receipt.accepted());
    let first_projection = first_projection.expect("accepted native pose projection");
    assert_eq!(first_projection.record_revision, 1);
    assert_eq!(first_projection.previous_record_hash, CanonicalHash::default());
    assert_eq!(first_projection.pose, first_pose);
    assert_eq!(first_projection.command_hash, first_command.command_hash);
    assert_eq!(first_projection.receipt_hash, first_receipt.receipt_hash);
    assert_eq!(runtime.player_pose_record_count(), 1);
    assert_eq!(runtime.player_pose_projection_cache_count(), 1);

    let fingerprint = runtime.authority_fingerprint();
    let mut tampered_receipt = first_receipt.clone();
    tampered_receipt.receipt_hash = CanonicalHash::default();
    assert_eq!(
        encode_network_browser_response_v1(&NetworkBrowserResponseV1::GuestPose {
            request_id: 501,
            receipt: tampered_receipt,
            projection: Some(Box::new(first_projection.clone())),
            authority_fingerprint: fingerprint,
        })
        .unwrap_err()
        .code,
        NetworkErrorCode::HashMismatch,
    );
    let (duplicate_receipt, duplicate_projection) = native_player_pose_response(&mut runtime, &first_request);
    assert_eq!(duplicate_receipt, first_receipt);
    assert_eq!(duplicate_projection.as_ref(), Some(&first_projection));
    assert_eq!(runtime.authority_fingerprint(), fingerprint);
    assert_eq!(runtime.latest_player_pose_projection("peer-1"), Some(&first_projection));

    let second_pose = native_player_pose(43);
    let second_command =
        native_player_pose_command(&fixture, "pose:43", "pose-idem:43", "conn-human-1", 1, &second_pose);
    let second_request = prepare_network_guest_pose_request_v1(502, &fixture.delta.to, 1_001, &second_command).unwrap();
    let (_, second_projection) = native_player_pose_response(&mut runtime, &second_request);
    let second_projection = second_projection.expect("second native pose projection");
    assert_eq!(second_projection.record_revision, 2);
    assert_eq!(second_projection.previous_record_hash, first_projection.record_hash);
    assert_eq!(
        runtime.active_player_pose_projection("peer-1"),
        Some(&second_projection)
    );

    let (_, replayed_first) = native_player_pose_response(&mut runtime, &first_request);
    assert_eq!(replayed_first, Some(first_projection));
    assert_eq!(
        runtime.active_player_pose_projection("peer-1"),
        Some(&second_projection),
        "replaying an old exact receipt must not regress the active native record",
    );
}

#[test]
fn native_guest_pose_reconnect_preserves_history_and_fences_the_old_connection() {
    let (fixture, mut runtime) = native_player_pose_runtime();
    let first_pose = native_player_pose(50);
    let old_command = native_player_pose_command(&fixture, "pose:old", "pose-idem:old", "conn-human-1", 0, &first_pose);
    let old_request = prepare_network_guest_pose_request_v1(601, &fixture.delta.to, 1_000, &old_command).unwrap();
    let (_, first_projection) = native_player_pose_response(&mut runtime, &old_request);
    let first_projection = first_projection.unwrap();

    runtime.release_peer("peer-1");
    assert!(runtime.active_player_pose_projection("peer-1").is_none());
    assert_eq!(runtime.latest_player_pose_projection("peer-1"), Some(&first_projection));
    let mut replacement = native_player_pose_grant(&fixture);
    replacement.connection_id = "conn-human-2".into();
    replacement.next_sequence = 1;
    runtime.upsert_peer_grant(replacement).unwrap();
    let before_old_replay = runtime.authority_fingerprint();
    let (old_receipt, old_projection) = native_player_pose_response(&mut runtime, &old_request);
    assert_eq!(old_receipt.code, Some(NetworkReceiptCodeV1::ConnectionMismatch));
    assert!(old_projection.is_none());
    assert_eq!(runtime.authority_fingerprint(), before_old_replay);
    assert_eq!(runtime.latest_player_pose_projection("peer-1"), Some(&first_projection));

    assert!(runtime.record_delta_presentation(&fixture.delta).unwrap());
    let next_pose = native_player_pose(51);
    let next_command = native_player_pose_command(&fixture, "pose:new", "pose-idem:new", "conn-human-2", 1, &next_pose);
    let next_request = prepare_network_guest_pose_request_v1(602, &fixture.delta.to, 1_001, &next_command).unwrap();
    let (_, next_projection) = native_player_pose_response(&mut runtime, &next_request);
    let next_projection = next_projection.unwrap();
    assert_eq!(next_projection.record_revision, 2);
    assert_eq!(next_projection.previous_record_hash, first_projection.record_hash);
    assert_eq!(next_projection.connection_id, "conn-human-2");
    assert_eq!(runtime.active_player_pose_projection("peer-1"), Some(&next_projection));
}

#[test]
fn native_guest_pose_preflight_failure_is_atomic() {
    let (fixture, mut runtime) = native_player_pose_runtime();
    let pose = native_player_pose(60);
    let valid = native_player_pose_command(&fixture, "pose:valid", "pose-idem:valid", "conn-human-1", 0, &pose);
    let valid_request = prepare_network_guest_pose_request_v1(701, &fixture.delta.to, 1_000, &valid).unwrap();
    let baseline = runtime.authority_fingerprint();

    let mut wrong_actor_source = source_from_command(&valid);
    wrong_actor_source.command_id = "pose:wrong-actor".into();
    wrong_actor_source.idempotency_key = "pose-idem:wrong-actor".into();
    wrong_actor_source.actor_id = "forged-player".into();
    let wrong_actor = NetworkCommandV1::new(wrong_actor_source).unwrap();
    assert_eq!(
        prepare_network_guest_pose_request_v1(702, &fixture.delta.to, 1_000, &wrong_actor)
            .unwrap_err()
            .code,
        NetworkErrorCode::InvalidLabel,
    );
    let wrong_actor_batch =
        prepare_network_command_batch_request_v1(702, &fixture.delta.to, 1_000, &[wrong_actor]).unwrap();
    assert_eq!(
        runtime.process(&wrong_actor_batch).unwrap_err().code,
        NetworkErrorCode::InvalidLabel,
    );
    assert_eq!(runtime.authority_fingerprint(), baseline);
    assert_eq!(runtime.player_pose_record_count(), 0);

    let mut malformed_source = source_from_command(&valid);
    malformed_source.command_id = "pose:malformed".into();
    malformed_source.idempotency_key = "pose-idem:malformed".into();
    malformed_source.payload = b"not-a-native-pose".to_vec();
    let malformed_command = NetworkCommandV1::new(malformed_source).unwrap();
    let malformed_batch =
        prepare_network_command_batch_request_v1(703, &fixture.delta.to, 1_000, &[malformed_command]).unwrap();
    assert_eq!(
        runtime.process(&malformed_batch).unwrap_err().code,
        NetworkErrorCode::WireMagic,
    );
    assert_eq!(runtime.authority_fingerprint(), baseline);
    assert_eq!(runtime.player_pose_record_count(), 0);

    let mut malformed = valid_request.clone();
    *malformed.last_mut().unwrap() ^= 0x80;
    assert_eq!(
        runtime.process(&malformed).unwrap_err().code,
        NetworkErrorCode::HashMismatch
    );
    assert_eq!(runtime.authority_fingerprint(), baseline);
    assert_eq!(runtime.player_pose_record_count(), 0);

    let (receipt, projection) = native_player_pose_response(&mut runtime, &valid_request);
    assert!(receipt.accepted(), "failed preflight must not consume sequence zero");
    assert_eq!(projection.unwrap().record_revision, 1);
}

#[test]
fn mixed_generic_batch_cannot_bypass_native_guest_pose_custody() {
    let (fixture, mut runtime) = native_player_pose_runtime();
    let pose = native_player_pose(70);
    let pose_command = native_player_pose_command(
        &fixture,
        "pose:dedicated-only",
        "pose-idem:dedicated-only",
        "conn-human-1",
        0,
        &pose,
    );
    let ordinary = NetworkCommandV1::new(NetworkCommandSourceV1 {
        session_id: "session-r9".into(),
        command_id: "ordinary:first".into(),
        idempotency_key: "ordinary-idem:first".into(),
        peer_id: "peer-1".into(),
        connection_id: "conn-human-1".into(),
        actor_id: "peer-1".into(),
        peer_kind: NetworkPeerKindV1::Human,
        kind: NetworkCommandKindV1::Gameplay,
        required_capability: NetworkCapabilityV1::Interact,
        sequence: 0,
        expected: fixture.delta.to.clone(),
        expires_at: 10_000,
        lease_keys: Vec::new(),
        payload: vec![1, 2, 3],
    })
    .unwrap();
    let batch =
        prepare_network_command_batch_request_v1(750, &fixture.delta.to, 1_000, &[ordinary, pose_command.clone()])
            .unwrap();
    let baseline = runtime.authority_fingerprint();
    assert_eq!(runtime.process(&batch).unwrap_err().code, NetworkErrorCode::InvalidEnum);
    assert_eq!(runtime.authority_fingerprint(), baseline);
    assert_eq!(runtime.player_pose_record_count(), 0);

    let dedicated = prepare_network_guest_pose_request_v1(751, &fixture.delta.to, 1_000, &pose_command).unwrap();
    let (receipt, projection) = native_player_pose_response(&mut runtime, &dedicated);
    assert!(
        receipt.accepted(),
        "the mixed batch must not consume command sequence zero"
    );
    assert_eq!(projection.unwrap().record_revision, 1);
}

#[test]
fn native_guest_pose_projection_cache_is_strictly_bounded() {
    let (fixture, mut runtime) = native_player_pose_runtime();
    for sequence in 0..(NETWORK_BROWSER_MAX_PLAYER_POSE_PROJECTIONS_V1 + 8) {
        let pose = native_player_pose(sequence as u64);
        let command = native_player_pose_command(
            &fixture,
            &format!("pose:{sequence}"),
            &format!("pose-idem:{sequence}"),
            "conn-human-1",
            sequence as u64,
            &pose,
        );
        let request =
            prepare_network_guest_pose_request_v1(800 + sequence as u64, &fixture.delta.to, 1_000, &command).unwrap();
        let (receipt, projection) = native_player_pose_response(&mut runtime, &request);
        assert!(receipt.accepted());
        assert_eq!(projection.unwrap().record_revision, sequence as u64 + 1);
    }
    assert_eq!(
        runtime.player_pose_projection_cache_count(),
        NETWORK_BROWSER_MAX_PLAYER_POSE_PROJECTIONS_V1,
    );
    assert_eq!(runtime.player_pose_record_count(), 1);
}

#[test]
fn malformed_and_tampered_packets_never_mutate_authority() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let mut authority = NetworkAuthorityV1::new("session-r9".into()).unwrap();
    authority.upsert_grant(fixture.human_grant.clone()).unwrap();
    let baseline = authority.authority_fingerprint();

    let mut invalid = fixture.human_command.clone();
    invalid.payload.push(0xff);
    assert_eq!(
        authority
            .authorize(&invalid, &fixture.starting_identity, 1_000)
            .unwrap_err()
            .code,
        NetworkErrorCode::HashMismatch
    );
    assert_eq!(authority.authority_fingerprint(), baseline);

    let wire = encode_network_command_v1(&fixture.human_command).unwrap();
    for index in (0..wire.len()).step_by((wire.len() / 64).max(1)) {
        let mut damaged = wire.clone();
        damaged[index] ^= 0x80;
        let _ = decode_network_command_v1(&damaged);
        assert_eq!(authority.authority_fingerprint(), baseline);
    }
}

#[test]
fn authority_enforces_revision_sequence_capability_and_idempotency() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let mut authority = NetworkAuthorityV1::new("session-r9".into()).unwrap();
    authority.upsert_grant(fixture.human_grant.clone()).unwrap();
    let accepted = authority
        .authorize(&fixture.human_command, &fixture.starting_identity, 1_000)
        .unwrap();
    assert!(accepted.accepted());
    assert_eq!(authority.grant("peer-1").unwrap().next_sequence, 1);
    let duplicate = authority
        .authorize(&fixture.human_command, &fixture.starting_identity, 1_001)
        .unwrap();
    assert_eq!(duplicate, accepted);
    assert_eq!(authority.grant("peer-1").unwrap().next_sequence, 1);

    let reordered = command_from(
        &fixture.human_command,
        "cmd-order",
        "idem-order",
        3,
        fixture.starting_identity.clone(),
        Vec::new(),
    );
    let receipt = authority
        .authorize(&reordered, &fixture.starting_identity, 1_002)
        .unwrap();
    assert_eq!(receipt.code, Some(NetworkReceiptCodeV1::Sequence));

    let stale = command_from(
        &fixture.human_command,
        "cmd-stale",
        "idem-stale",
        1,
        NetworkAuthorityIdentityV1::new(
            fixture.starting_identity.address.clone(),
            NetworkAuthorityRevisionV1::default(),
        )
        .unwrap(),
        Vec::new(),
    );
    let receipt = authority.authorize(&stale, &fixture.starting_identity, 1_003).unwrap();
    assert_eq!(receipt.code, Some(NetworkReceiptCodeV1::StaleRevision));

    let denied = NetworkCommandV1::new(NetworkCommandSourceV1 {
        command_id: "cmd-denied".into(),
        idempotency_key: "idem-denied".into(),
        sequence: 1,
        required_capability: NetworkCapabilityV1::Combat,
        lease_keys: Vec::new(),
        expected: fixture.starting_identity.clone(),
        payload: Vec::new(),
        session_id: fixture.human_command.session_id.clone(),
        peer_id: fixture.human_command.peer_id.clone(),
        connection_id: fixture.human_command.connection_id.clone(),
        actor_id: fixture.human_command.actor_id.clone(),
        peer_kind: fixture.human_command.peer_kind,
        kind: fixture.human_command.kind,
        expires_at: fixture.human_command.expires_at,
    })
    .unwrap();
    let receipt = authority.authorize(&denied, &fixture.starting_identity, 1_004).unwrap();
    assert_eq!(receipt.code, Some(NetworkReceiptCodeV1::CapabilityDenied));
}

#[test]
fn pose_authority_tracks_the_latest_connection_bound_presentation() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let mut authority = NetworkAuthorityV1::new("session-r9".into()).unwrap();
    authority.upsert_grant(fixture.human_grant.clone()).unwrap();
    let presented_a = fixture.starting_identity.clone();
    let live_b = NetworkAuthorityIdentityV1::new(
        presented_a.address.clone(),
        NetworkAuthorityRevisionV1 {
            world: presented_a.revision.world + 1,
            ..presented_a.revision
        },
    )
    .unwrap();

    let missing_cursor = pose_command_from(
        &fixture.human_command,
        "pose-missing",
        "idem-pose-missing",
        0,
        presented_a.clone(),
    );
    assert_eq!(
        authority.authorize(&missing_cursor, &live_b, 1_000).unwrap().code,
        Some(NetworkReceiptCodeV1::StaleRevision),
    );

    let before_presentation = authority.authority_fingerprint();
    assert!(authority.record_peer_presentation("peer-1", 1, &presented_a).unwrap());
    let after_presentation = authority.authority_fingerprint();
    assert_ne!(after_presentation, before_presentation);
    assert!(!authority.record_peer_presentation("peer-1", 1, &presented_a).unwrap());
    assert_eq!(authority.authority_fingerprint(), after_presentation);

    let pose_from_a = pose_command_from(
        &fixture.human_command,
        "pose-from-a",
        "idem-pose-from-a",
        0,
        presented_a.clone(),
    );
    assert_eq!(
        decode_network_command_v1(&encode_network_command_v1(&pose_from_a).unwrap()).unwrap(),
        pose_from_a,
        "the explicit pose kind must survive the native wire boundary",
    );
    assert!(
        authority.authorize(&pose_from_a, &live_b, 1_001).unwrap().accepted(),
        "pose admission follows the exact state presented to this connection",
    );

    let non_pose_from_a = command_from(
        &fixture.human_command,
        "gameplay-from-a",
        "idem-gameplay-from-a",
        1,
        presented_a.clone(),
        Vec::new(),
    );
    assert_eq!(
        authority.authorize(&non_pose_from_a, &live_b, 1_002).unwrap().code,
        Some(NetworkReceiptCodeV1::StaleRevision),
        "non-pose commands retain strict live-authority equality",
    );

    assert!(authority.record_peer_presentation("peer-1", 2, &live_b).unwrap());
    assert_eq!(
        authority
            .record_peer_presentation("peer-1", 3, &presented_a)
            .unwrap_err()
            .code,
        NetworkErrorCode::HashMismatch,
        "a newer delta sequence cannot rewind a domain revision",
    );
    let other_address = NetworkAuthorityIdentityV1::new(
        WorldAddressV1 {
            universe_id: live_b.address.universe_id.clone(),
            location_id: "other-location".into(),
        },
        live_b.revision,
    )
    .unwrap();
    assert_eq!(
        authority
            .record_peer_presentation("peer-1", 3, &other_address)
            .unwrap_err()
            .code,
        NetworkErrorCode::HashMismatch,
        "a presentation cursor cannot silently switch authority addresses",
    );
    let stale_pose = pose_command_from(
        &fixture.human_command,
        "pose-stale-a",
        "idem-pose-stale-a",
        1,
        presented_a.clone(),
    );
    assert_eq!(
        authority.authorize(&stale_pose, &live_b, 1_003).unwrap().code,
        Some(NetworkReceiptCodeV1::StaleRevision),
    );

    let advanced_epoch = NetworkAuthorityIdentityV1::new(
        live_b.address.clone(),
        NetworkAuthorityRevisionV1 {
            epoch: live_b.revision.epoch + 1,
            ..live_b.revision
        },
    )
    .unwrap();
    let epoch_stale = pose_command_from(
        &fixture.human_command,
        "pose-old-epoch",
        "idem-pose-old-epoch",
        1,
        live_b.clone(),
    );
    assert_eq!(
        authority.authorize(&epoch_stale, &advanced_epoch, 1_004).unwrap().code,
        Some(NetworkReceiptCodeV1::StaleRevision),
        "a presentation cursor cannot cross an authority epoch",
    );
    let presentation_ahead = pose_command_from(
        &fixture.human_command,
        "pose-presentation-ahead",
        "idem-pose-presentation-ahead",
        1,
        live_b.clone(),
    );
    assert_eq!(
        authority
            .authorize(&presentation_ahead, &presented_a, 1_004)
            .unwrap()
            .code,
        Some(NetworkReceiptCodeV1::StaleRevision),
        "a presented domain revision cannot be ahead of live authority",
    );

    let pose_from_b = pose_command_from(
        &fixture.human_command,
        "pose-from-b",
        "idem-pose-from-b",
        1,
        live_b.clone(),
    );
    assert!(authority.authorize(&pose_from_b, &live_b, 1_005).unwrap().accepted());

    let mut replacement = fixture.human_grant.clone();
    replacement.connection_id = "conn-human-2".into();
    replacement.next_sequence = 2;
    authority.upsert_grant(replacement.clone()).unwrap();
    let old_connection = pose_command_from(
        &fixture.human_command,
        "pose-old-connection",
        "idem-pose-old-connection",
        2,
        live_b.clone(),
    );
    assert_eq!(
        authority.authorize(&old_connection, &live_b, 1_006).unwrap().code,
        Some(NetworkReceiptCodeV1::ConnectionMismatch),
    );
    let new_connection_without_cursor = NetworkCommandV1::new(NetworkCommandSourceV1 {
        connection_id: replacement.connection_id.clone(),
        command_id: "pose-new-connection-missing".into(),
        idempotency_key: "idem-pose-new-connection-missing".into(),
        ..source_from_command(&old_connection)
    })
    .unwrap();
    assert_eq!(
        authority
            .authorize(&new_connection_without_cursor, &live_b, 1_007)
            .unwrap()
            .code,
        Some(NetworkReceiptCodeV1::StaleRevision),
        "replacing a connection clears its prior presentation cursor",
    );
    assert!(authority.record_peer_presentation("peer-1", 3, &live_b).unwrap());
    let accepted_replacement = NetworkCommandV1::new(NetworkCommandSourceV1 {
        command_id: "pose-new-connection".into(),
        idempotency_key: "idem-pose-new-connection".into(),
        ..source_from_command(&new_connection_without_cursor)
    })
    .unwrap();
    assert!(
        authority
            .authorize(&accepted_replacement, &live_b, 1_008)
            .unwrap()
            .accepted(),
    );
    authority.release_peer("peer-1");
    replacement.next_sequence = 3;
    authority.upsert_grant(replacement).unwrap();
    let released_cursor = NetworkCommandV1::new(NetworkCommandSourceV1 {
        command_id: "pose-after-release".into(),
        idempotency_key: "idem-pose-after-release".into(),
        sequence: 3,
        ..source_from_command(&accepted_replacement)
    })
    .unwrap();
    assert_eq!(
        authority.authorize(&released_cursor, &live_b, 1_009).unwrap().code,
        Some(NetworkReceiptCodeV1::StaleRevision),
        "releasing a peer clears its connection-bound presentation cursor",
    );
}

#[test]
fn presentation_state_authority_tracks_the_latest_reachable_connection_presentation() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let mut authority = NetworkAuthorityV1::new("session-r9".into()).unwrap();
    authority.upsert_grant(fixture.human_grant.clone()).unwrap();
    let presented_a = fixture.starting_identity.clone();
    let live_b = NetworkAuthorityIdentityV1::new(
        presented_a.address.clone(),
        NetworkAuthorityRevisionV1 {
            entities: presented_a.revision.entities + 1,
            ..presented_a.revision
        },
    )
    .unwrap();

    let missing_cursor = presentation_state_command_from(
        &fixture.human_command,
        "player-state-missing",
        "idem-player-state-missing",
        0,
        presented_a.clone(),
    );
    let missing_receipt = authority.authorize(&missing_cursor, &live_b, 1_000).unwrap();
    assert_eq!(missing_receipt.code, Some(NetworkReceiptCodeV1::StaleRevision));
    assert_eq!(
        missing_receipt.message,
        "Player-state command does not match the latest connection-bound authority presentation.",
    );

    assert!(authority.record_peer_presentation("peer-1", 1, &presented_a).unwrap());
    let from_a = presentation_state_command_from(
        &fixture.human_command,
        "player-state-from-a",
        "idem-player-state-from-a",
        0,
        presented_a.clone(),
    );
    assert_eq!(NetworkCommandKindV1::PresentationState as u8, 7);
    assert_eq!(
        decode_network_command_v1(&encode_network_command_v1(&from_a).unwrap()).unwrap(),
        from_a,
        "the additive presentation-state kind must survive the native wire boundary",
    );
    assert!(
        authority.authorize(&from_a, &live_b, 1_001).unwrap().accepted(),
        "player-state admission follows the latest state presented to this connection",
    );

    assert!(authority.record_peer_presentation("peer-1", 2, &live_b).unwrap());
    let stale_a = presentation_state_command_from(
        &fixture.human_command,
        "player-state-stale-a",
        "idem-player-state-stale-a",
        1,
        presented_a,
    );
    assert_eq!(
        authority.authorize(&stale_a, &live_b, 1_002).unwrap().code,
        Some(NetworkReceiptCodeV1::StaleRevision),
        "player-state must name the exact latest connection-bound presentation",
    );
    let from_b = presentation_state_command_from(
        &fixture.human_command,
        "player-state-from-b",
        "idem-player-state-from-b",
        1,
        live_b.clone(),
    );
    assert!(authority.authorize(&from_b, &live_b, 1_003).unwrap().accepted());
}

#[test]
fn leases_are_exclusive_expire_and_release_deterministically() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let mut authority = NetworkAuthorityV1::new("session-r9".into()).unwrap();
    authority.upsert_grant(fixture.human_grant.clone()).unwrap();
    assert!(
        authority
            .authorize(&fixture.human_command, &fixture.starting_identity, 1_000)
            .unwrap()
            .accepted()
    );
    assert_eq!(authority.active_lease_count(), 1);

    let mut second_grant = fixture.agent_grant.clone();
    second_grant.capabilities.push(NetworkCapabilityV1::Interact);
    second_grant.capabilities.sort();
    authority.upsert_grant(second_grant).unwrap();
    let competing = NetworkCommandV1::new(NetworkCommandSourceV1 {
        session_id: "session-r9".into(),
        command_id: "cmd-compete".into(),
        idempotency_key: "idem-compete".into(),
        peer_id: "agent-peer-1".into(),
        connection_id: "conn-agent-1".into(),
        actor_id: "agent:field-drone-1".into(),
        peer_kind: NetworkPeerKindV1::Agent,
        kind: NetworkCommandKindV1::Gameplay,
        required_capability: NetworkCapabilityV1::Interact,
        sequence: 0,
        expected: fixture.starting_identity.clone(),
        expires_at: 11_000,
        lease_keys: fixture.human_command.lease_keys.clone(),
        payload: vec![],
    })
    .unwrap();
    let blocked = authority
        .authorize(&competing, &fixture.starting_identity, 1_001)
        .unwrap();
    assert_eq!(blocked.code, Some(NetworkReceiptCodeV1::LeaseConflict));
    authority.release_command(&fixture.human_command.command_id);
    assert_eq!(authority.active_lease_count(), 0);
}

#[test]
fn sequence_overflow_is_atomic() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let mut authority = NetworkAuthorityV1::new("session-r9".into()).unwrap();
    let mut grant = fixture.human_grant.clone();
    grant.next_sequence = NETWORK_MAX_SAFE_INTEGER_V1;
    authority.upsert_grant(grant).unwrap();
    let command = command_from(
        &fixture.human_command,
        "cmd-last-sequence",
        "idem-last-sequence",
        NETWORK_MAX_SAFE_INTEGER_V1,
        fixture.starting_identity.clone(),
        vec!["atomic:lease".into()],
    );
    let before = authority.authority_fingerprint();
    assert_eq!(
        authority
            .authorize(&command, &fixture.starting_identity, 1_000)
            .unwrap_err()
            .code,
        NetworkErrorCode::InvalidInteger,
    );
    assert_eq!(authority.authority_fingerprint(), before);
    assert_eq!(authority.active_lease_count(), 0);
}

#[test]
fn interest_index_touches_only_relevant_scopes() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let mut index = InterestIndexV1::default();
    let relevant = NetworkDeltaRecordV1::new(NetworkDeltaRecordKindV1::World, "near".into(), 1, vec![1]).unwrap();
    index
        .upsert(ScopedDeltaRecordV1 {
            scope: ReplicationScopeV1::Chunk(fixture.interest.chunks[0].clone()),
            record: relevant.clone(),
        })
        .unwrap();
    let global = NetworkDeltaRecordV1::new(NetworkDeltaRecordKindV1::Gameplay, "global".into(), 1, vec![2]).unwrap();
    let location = NetworkDeltaRecordV1::new(NetworkDeltaRecordKindV1::World, "location".into(), 1, vec![3]).unwrap();
    let entity =
        NetworkDeltaRecordV1::new(NetworkDeltaRecordKindV1::Entity, "mob:emberjay:2".into(), 1, vec![4]).unwrap();
    index
        .upsert(ScopedDeltaRecordV1 {
            scope: ReplicationScopeV1::Global,
            record: global.clone(),
        })
        .unwrap();
    index
        .upsert(ScopedDeltaRecordV1 {
            scope: ReplicationScopeV1::Location(fixture.interest.chunks[0].address.clone()),
            record: location.clone(),
        })
        .unwrap();
    index
        .upsert(ScopedDeltaRecordV1 {
            scope: ReplicationScopeV1::Entity("mob:emberjay:2".into()),
            record: entity.clone(),
        })
        .unwrap();
    for number in 0..200 {
        let address = WorldAddressV1 {
            universe_id: "blockwild".into(),
            location_id: format!("moon-{number}"),
        };
        index
            .upsert(ScopedDeltaRecordV1 {
                scope: ReplicationScopeV1::Location(address),
                record: NetworkDeltaRecordV1::new(
                    NetworkDeltaRecordKindV1::World,
                    format!("far-{number}"),
                    1,
                    vec![number as u8],
                )
                .unwrap(),
            })
            .unwrap();
    }
    let (selected, stats) = index.select(&fixture.interest);
    assert_eq!(selected, vec![entity, global, location, relevant]);
    assert_eq!(stats.candidate_records, 4);
    assert!(stats.scope_probes <= 6);
    assert_eq!(index.record_count(), 204);
}

#[test]
fn delta_receiver_detects_loss_reorder_duplicates_and_stale_from() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let state = ReplicatedStateV1::new(fixture.starting_identity.clone());
    let mut receiver = DeltaReceiverV1::new(
        "session-r9".into(),
        "peer-1".into(),
        1,
        fixture.interest.clone(),
        0,
        0,
        state,
    )
    .unwrap();
    let mut ahead = fixture.delta.clone();
    ahead.sequence = 1;
    ahead = NetworkDeltaV1::new(NetworkDeltaSourceV1 {
        session_id: ahead.session_id,
        delta_id: "delta-ahead".into(),
        peer_id: ahead.peer_id,
        keyframe: ahead.keyframe,
        sequence: 1,
        acknowledged_command_sequence: ahead.acknowledged_command_sequence,
        from: ahead.from,
        to: ahead.to,
        interest_hash: ahead.interest_hash,
        records: ahead.records,
    })
    .unwrap();
    let before = receiver.state().canonical_state_hash();
    assert_eq!(receiver.apply(&ahead).unwrap().code, DeltaApplyCodeV1::SequenceGap);
    assert_eq!(receiver.state().canonical_state_hash(), before);
    assert_eq!(receiver.apply(&fixture.delta).unwrap().code, DeltaApplyCodeV1::Applied);
    let applied = receiver.state().canonical_state_hash();
    assert_eq!(
        receiver.apply(&fixture.delta).unwrap().code,
        DeltaApplyCodeV1::Duplicate
    );
    assert_eq!(receiver.state().canonical_state_hash(), applied);
}

#[test]
fn keyframe_recovers_after_loss_without_accepting_wrong_interest() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let mut receiver = DeltaReceiverV1::new(
        "session-r9".into(),
        "peer-1".into(),
        1,
        fixture.interest.clone(),
        0,
        0,
        ReplicatedStateV1::new(fixture.starting_identity.clone()),
    )
    .unwrap();
    let keyframe = NetworkDeltaV1::new(NetworkDeltaSourceV1 {
        session_id: "session-r9".into(),
        delta_id: "keyframe-0".into(),
        peer_id: "peer-1".into(),
        keyframe: true,
        sequence: 0,
        acknowledged_command_sequence: 0,
        from: NetworkAuthorityIdentityV1::new(
            WorldAddressV1 {
                universe_id: "blockwild".into(),
                location_id: "old".into(),
            },
            NetworkAuthorityRevisionV1::default(),
        )
        .unwrap(),
        to: fixture.delta.to.clone(),
        interest_hash: fixture.interest.interest_hash,
        records: fixture.delta.records.clone(),
    })
    .unwrap();
    assert_eq!(receiver.apply(&keyframe).unwrap().code, DeltaApplyCodeV1::Applied);
    assert_eq!(receiver.state().record_count(), 1);
}

#[test]
fn reconnect_checkpoint_produces_specific_desync_evidence() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let changed = NetworkAuthorityIdentityV1::new(
        fixture.checkpoint.identity.address.clone(),
        NetworkAuthorityRevisionV1 {
            entities: fixture.checkpoint.identity.revision.entities + 1,
            ..fixture.checkpoint.identity.revision
        },
    )
    .unwrap();
    let diagnostic = diagnose_network_desync_v1(&fixture.checkpoint, &changed).unwrap();
    assert_eq!(diagnostic.first_divergent_subsystem, DivergentSubsystemV1::Entities);
    assert_eq!(
        diagnostic.replay_sequence,
        fixture.checkpoint.acknowledged_command_sequence
    );
    assert!(diagnose_network_desync_v1(&fixture.checkpoint, &fixture.checkpoint.identity).is_none());
    let receiver = DeltaReceiverV1::from_checkpoint(
        &fixture.checkpoint,
        fixture.interest.clone(),
        ReplicatedStateV1::new(fixture.checkpoint.identity.clone()),
    )
    .unwrap();
    assert_eq!(
        receiver.reconnect_checkpoint().unwrap().acknowledged_delta_sequence,
        fixture.checkpoint.acknowledged_delta_sequence,
    );
}

#[test]
fn agents_use_network_authority_then_bounded_fifo_work() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let current = fixture.agent_command.expected.clone();
    let mut network = NetworkAuthorityV1::new("session-r9".into()).unwrap();
    network.upsert_grant(fixture.agent_grant.clone()).unwrap();
    let mut agents = AgentWorkAuthorityV1::default();
    agents.upsert_grant(fixture.agent_capability_grant.clone()).unwrap();
    let decision = agents
        .authorize(
            &mut network,
            &fixture.agent_command,
            &fixture.agent_work,
            &current,
            1_100,
        )
        .unwrap();
    assert_eq!(decision.code, AgentAuthorityCodeV1::Accepted);
    let receipt = decision.receipt.unwrap();
    let mut queue = AgentWorkQueueV1::default();
    queue
        .enqueue(fixture.agent_work.clone(), &fixture.agent_command, &receipt)
        .unwrap();
    queue
        .enqueue(fixture.agent_work.clone(), &fixture.agent_command, &receipt)
        .unwrap();
    assert_eq!(queue.len(), 1);
    assert_eq!(queue.queued_units(), 12);
    assert!(queue.tick(5, 1_101).is_empty());
    assert_eq!(queue.queued_units(), 7);
    assert_eq!(queue.tick(7, 1_102), vec!["cmd-agent-1"]);
    assert!(queue.is_empty());
}

#[test]
fn agent_observation_is_canonical_bounded_and_sorted() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let observation = AgentObservationV1::new(
        4,
        1_000,
        2_000,
        fixture.starting_identity.clone(),
        "+X east, +Y up, +Z south; milliblocks".into(),
        "agent:field-drone-1".into(),
        "Field Drone".into(),
        [1_000, 64_000, -2_000],
        [10, 0, -5],
        1_570,
        0,
        vec![AgentCapabilityV1::Harvest, AgentCapabilityV1::ObserveWorld],
        vec![
            AgentNearbyRecordV1 {
                entity_id: "mob:z".into(),
                kind: 2,
                position_milliblocks: [2_000, 64_000, -2_000],
                distance_milliblocks: 1_000,
                interactable: true,
                state: "calm".into(),
            },
            AgentNearbyRecordV1 {
                entity_id: "mob:a".into(),
                kind: 2,
                position_milliblocks: [0, 64_000, -2_000],
                distance_milliblocks: 1_000,
                interactable: false,
                state: "hostile".into(),
            },
        ],
        vec!["task:z".into(), "task:a".into()],
        b"biome=frostpine".to_vec(),
    )
    .unwrap();
    observation.validate().unwrap();
    assert_eq!(
        observation.capabilities,
        vec![AgentCapabilityV1::ObserveWorld, AgentCapabilityV1::Harvest]
    );
    assert_eq!(observation.nearby[0].entity_id, "mob:a");
    assert_eq!(observation.task_ids, vec!["task:a", "task:z"]);
}

#[test]
fn oversized_agent_observation_fails_before_authority() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let result = AgentObservationV1::new(
        1,
        1_000,
        2_000,
        fixture.starting_identity,
        "milliblocks".into(),
        "agent:field-drone-1".into(),
        "Field Drone".into(),
        [0; 3],
        [0; 3],
        0,
        0,
        vec![],
        vec![],
        vec![],
        vec![0; AGENT_MAX_OBSERVATION_BYTES_V1],
    );
    assert_eq!(result.unwrap_err().code, NetworkErrorCode::Budget);
}

#[test]
fn host_replay_reproduces_final_hash_and_reordering_fails_closed() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let first = run_network_replay_v1(&fixture.replay).unwrap();
    let second = run_network_replay_v1(&fixture.replay).unwrap();
    assert_eq!(first, second);
    assert_eq!(first.receipts.len(), 2);
    assert!(first.receipts.iter().all(NetworkCommandReceiptV1::accepted));
    assert_ne!(first.final_state_hash, fixture.starting_identity.state_hash);

    let mut reordered = fixture.replay.clone();
    reordered.steps.swap(0, 1);
    assert!(run_network_replay_v1(&reordered).is_err());
}

#[test]
fn hostile_wire_fuzz_never_panics_or_yields_unvalidated_commands() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let seed = encode_network_command_v1(&fixture.human_command).unwrap();
    let mut state = 0x9e37_79b9_u32;
    for length in 0..512_usize {
        let mut bytes = seed[..length.min(seed.len())].to_vec();
        for byte in &mut bytes {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            *byte ^= state as u8;
        }
        if let Ok(command) = decode_network_command_v1(&bytes) {
            command.validate().unwrap();
        }
    }
}

#[test]
fn receipt_cache_is_strictly_bounded() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let mut authority = NetworkAuthorityV1::new("session-r9".into()).unwrap();
    let mut grant = fixture.human_grant.clone();
    grant.interest = fixture.interest.clone();
    authority.upsert_grant(grant).unwrap();
    for sequence in 0..(NETWORK_MAX_IDEMPOTENCY_RECEIPTS_V1 + 32) {
        let command = command_from(
            &fixture.human_command,
            &format!("cmd-cache-{sequence}"),
            &format!("idem-cache-{sequence}"),
            sequence as u64,
            fixture.starting_identity.clone(),
            Vec::new(),
        );
        assert!(
            authority
                .authorize(&command, &fixture.starting_identity, 1_000)
                .unwrap()
                .accepted()
        );
        authority.release_command(&command.command_id);
    }
    assert_eq!(authority.receipt_count(), NETWORK_MAX_IDEMPOTENCY_RECEIPTS_V1);
}

#[test]
fn canonical_fixture_and_native_hook_are_stable() {
    let fixture = canonical_network_fixture_v1().unwrap();
    let replay = run_network_replay_v1(&fixture.replay).unwrap();
    assert_eq!(
        fixture.starting_identity.state_hash.to_hex(),
        "58fe8921315fa69bc83a57243b37de36"
    );
    assert_eq!(
        fixture.host_handshake.handshake_hash.to_hex(),
        "49933fb3af588f00c8aa230cc62ccda1"
    );
    assert_eq!(
        fixture.interest.interest_hash.to_hex(),
        "60c7ca0475dfd0c7903e97801b161b26"
    );
    assert_eq!(
        fixture.human_command.command_hash.to_hex(),
        "3c138c46b6083b0400566e319bfd728f"
    );
    assert_eq!(fixture.delta.delta_hash.to_hex(), "64bc7697c9401c7aa06ad421ec1fdbac");
    assert_eq!(
        fixture.checkpoint.checkpoint_hash.to_hex(),
        "24aef6ec54505dfb6068cd6b96893934"
    );
    assert_ne!(fixture.human_command.command_hash, fixture.agent_command.command_hash);
    assert_ne!(replay.replay_hash, CanonicalHash::default());
    let first = run_network_native_benchmark_v1(2).unwrap();
    let second = run_network_native_benchmark_v1(2).unwrap();
    assert_eq!(first.digest, second.digest);
}

fn native_player_pose_source(tick: u64) -> NetworkPlayerPoseSourceV1 {
    NetworkPlayerPoseSourceV1 {
        player_id: "peer-1".into(),
        tick,
        x_milliblocks: 12_345,
        y_milliblocks: 64_500,
        z_milliblocks: -9_876,
        yaw_milliradians: 1_571,
        pitch_milliradians: -314,
        velocity_x_milliblocks_per_second: 4_350,
        velocity_y_milliblocks_per_second: -125,
        velocity_z_milliblocks_per_second: 750,
        grounded: true,
        selected_slot: Some(3),
        shield_raised: true,
        crouching: false,
        sprinting: true,
        action: NetworkPlayerPoseActionV1::Mine,
        swimming_per_mille: Some(250),
        seated_per_mille: Some(1_000),
        boat_id: Some("boat:cedar-1".into()),
        boat_seat: Some(0),
        boat_forward_per_mille: Some(875),
        boat_turn_per_mille: Some(-250),
        mounted_creature_id: Some(42),
        mounted_creature_seat: Some(1),
    }
}

fn native_player_pose(tick: u64) -> NetworkPlayerPoseV1 {
    let mut source = native_player_pose_source(tick);
    source.x_milliblocks += i32::try_from(tick % 10_000).unwrap();
    NetworkPlayerPoseV1::new(source).unwrap()
}

fn native_player_pose_grant(fixture: &NetworkCanonicalFixtureV1) -> NetworkPeerGrantV1 {
    NetworkPeerGrantV1 {
        actor_id: "peer-1".into(),
        ..fixture.human_grant.clone()
    }
}

fn native_player_pose_runtime() -> (NetworkCanonicalFixtureV1, NetworkBrowserAuthorityRuntimeV1) {
    let fixture = canonical_network_fixture_v1().unwrap();
    let mut runtime = NetworkBrowserAuthorityRuntimeV1::new("session-r9".into()).unwrap();
    runtime.upsert_peer_grant(native_player_pose_grant(&fixture)).unwrap();
    assert!(runtime.record_delta_presentation(&fixture.delta).unwrap());
    (fixture, runtime)
}

fn native_player_pose_command(
    fixture: &NetworkCanonicalFixtureV1,
    command_id: &str,
    idempotency_key: &str,
    connection_id: &str,
    sequence: u64,
    pose: &NetworkPlayerPoseV1,
) -> NetworkCommandV1 {
    NetworkCommandV1::new(NetworkCommandSourceV1 {
        session_id: "session-r9".into(),
        command_id: command_id.into(),
        idempotency_key: idempotency_key.into(),
        peer_id: "peer-1".into(),
        connection_id: connection_id.into(),
        actor_id: "peer-1".into(),
        peer_kind: NetworkPeerKindV1::Human,
        kind: NetworkCommandKindV1::Pose,
        required_capability: NetworkCapabilityV1::Interact,
        sequence,
        expected: fixture.delta.to.clone(),
        expires_at: 10_000,
        lease_keys: Vec::new(),
        payload: encode_network_player_pose_v1(pose).unwrap(),
    })
    .unwrap()
}

fn native_player_pose_response(
    runtime: &mut NetworkBrowserAuthorityRuntimeV1,
    request: &[u8],
) -> (NetworkCommandReceiptV1, Option<NetworkPlayerPoseProjectionV1>) {
    match decode_network_browser_response_v1(&runtime.process(request).unwrap()).unwrap() {
        NetworkBrowserResponseV1::GuestPose {
            receipt, projection, ..
        } => (receipt, projection.map(|projection| *projection)),
        response => panic!("unexpected native guest pose response: {response:?}"),
    }
}

fn command_from(
    base: &NetworkCommandV1,
    command_id: &str,
    idempotency_key: &str,
    sequence: u64,
    expected: NetworkAuthorityIdentityV1,
    lease_keys: Vec<String>,
) -> NetworkCommandV1 {
    NetworkCommandV1::new(NetworkCommandSourceV1 {
        session_id: base.session_id.clone(),
        command_id: command_id.into(),
        idempotency_key: idempotency_key.into(),
        peer_id: base.peer_id.clone(),
        connection_id: base.connection_id.clone(),
        actor_id: base.actor_id.clone(),
        peer_kind: base.peer_kind,
        kind: base.kind,
        required_capability: base.required_capability,
        sequence,
        expected,
        expires_at: base.expires_at,
        lease_keys,
        payload: base.payload.clone(),
    })
    .unwrap()
}

fn pose_command_from(
    base: &NetworkCommandV1,
    command_id: &str,
    idempotency_key: &str,
    sequence: u64,
    expected: NetworkAuthorityIdentityV1,
) -> NetworkCommandV1 {
    NetworkCommandV1::new(NetworkCommandSourceV1 {
        kind: NetworkCommandKindV1::Pose,
        command_id: command_id.into(),
        idempotency_key: idempotency_key.into(),
        sequence,
        expected,
        lease_keys: Vec::new(),
        ..source_from_command(base)
    })
    .unwrap()
}

fn presentation_state_command_from(
    base: &NetworkCommandV1,
    command_id: &str,
    idempotency_key: &str,
    sequence: u64,
    expected: NetworkAuthorityIdentityV1,
) -> NetworkCommandV1 {
    NetworkCommandV1::new(NetworkCommandSourceV1 {
        kind: NetworkCommandKindV1::PresentationState,
        command_id: command_id.into(),
        idempotency_key: idempotency_key.into(),
        sequence,
        expected,
        lease_keys: Vec::new(),
        ..source_from_command(base)
    })
    .unwrap()
}

fn source_from_command(base: &NetworkCommandV1) -> NetworkCommandSourceV1 {
    NetworkCommandSourceV1 {
        session_id: base.session_id.clone(),
        command_id: base.command_id.clone(),
        idempotency_key: base.idempotency_key.clone(),
        peer_id: base.peer_id.clone(),
        connection_id: base.connection_id.clone(),
        actor_id: base.actor_id.clone(),
        peer_kind: base.peer_kind,
        kind: base.kind,
        required_capability: base.required_capability,
        sequence: base.sequence,
        expected: base.expected.clone(),
        expires_at: base.expires_at,
        lease_keys: base.lease_keys.clone(),
        payload: base.payload.clone(),
    }
}
