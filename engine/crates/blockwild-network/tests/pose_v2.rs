use blockwild_network::*;
use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId, PlayerId};
#[path = "support/pose_v2_vectors.rs"]
mod vectors;

fn source() -> NetworkPlayerPoseSourceV2 {
    NetworkPlayerPoseSourceV2 {
        universe_id: "universe-r9".into(),
        location_id: "surface".into(),
        session_id: "native-session".into(),
        actor_id: "actor-🌿".into(),
        external_entity_id: "player:exact".into(),
        player_id: PlayerId::new(0x1234_5678, 0x90ab_cdef),
        entity_id: EntityId::new(0, 1),
        tick: u64::MAX,
        input_sequence: 9_007_199_254_740_993,
        revision: NetworkPlayerPoseRevisionV2 {
            epoch: 1,
            world: 2,
            entities: 3,
            gameplay: 4,
            persistence: 5,
            network: 6,
            simulation: u64::MAX,
        },
        state_hash: CanonicalHash([0x42; 16]),
        position: [12.387_123_456_789, -0.0, -9.876_543_210_123],
        velocity: [-0.0, f64::from_bits(1), -256.123_456_789],
        yaw: -0.0,
        pitch: 0.314_159_265_358_979_3,
        grounded: true,
    }
}
fn f64s(source: &NetworkPlayerPoseSourceV2) -> [u64; 8] {
    [
        source.position[0],
        source.position[1],
        source.position[2],
        source.velocity[0],
        source.velocity[1],
        source.velocity[2],
        source.yaw,
        source.pitch,
    ]
    .map(f64::to_bits)
}

#[test]
fn exact_pose_round_trip_preserves_f64_and_full_u64_binding() {
    let source = source();
    let pose = NetworkPlayerPoseV2::new(source.clone()).unwrap();
    let bytes = encode_network_player_pose_v2(&pose).unwrap();
    let decoded = decode_network_player_pose_v2(&bytes).unwrap();
    assert_eq!(f64s(&decoded.source), f64s(&source));
    assert_eq!(decoded, pose);
    assert_eq!(encode_network_player_pose_v2(&decoded).unwrap(), bytes);
    assert_eq!(decoded.source.player_id.packed(), 0x90ab_cdef_1234_5678);
    assert_eq!(decoded.source.entity_id, EntityId::new(0, 1));
    assert_eq!(decoded.source.tick, u64::MAX);
}

#[test]
fn every_f64_signed_zero_changes_exact_hash() {
    for field in 0..8 {
        let mut positive = source();
        positive.position = [0.0; 3];
        positive.velocity = [0.0; 3];
        positive.yaw = 0.0;
        positive.pitch = 0.0;
        let mut negative = positive.clone();
        match field {
            0..=2 => negative.position[field] = -0.0,
            3..=5 => negative.velocity[field - 3] = -0.0,
            6 => negative.yaw = -0.0,
            _ => negative.pitch = -0.0,
        }
        let a = NetworkPlayerPoseV2::new(positive).unwrap();
        let b = NetworkPlayerPoseV2::new(negative).unwrap();
        assert_ne!(a.pose_hash, b.pose_hash);
        assert_ne!(a.projection_hash, b.projection_hash);
        assert_eq!(
            f64s(
                &decode_network_player_pose_v2(&encode_network_player_pose_v2(&b).unwrap())
                    .unwrap()
                    .source
            ),
            f64s(&b.source)
        );
    }
}

#[test]
fn native_physics_and_exact_look_bounds_are_not_clamped() {
    // Native simulation/collision.rs:26-27 and PhysicsJobV1::validate enforce these bounds.
    let mut edge = source();
    edge.position = [-33_554_432.0, 33_554_432.0, 0.0];
    edge.velocity = [-4096.0, 4096.0, 0.0];
    edge.yaw = -std::f64::consts::PI;
    edge.pitch = std::f64::consts::FRAC_PI_2;
    NetworkPlayerPoseV2::new(edge).unwrap();
    for field in 0..8 {
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, f64::MAX] {
            let mut invalid = source();
            match field {
                0..=2 => invalid.position[field] = bad,
                3..=5 => invalid.velocity[field - 3] = bad,
                6 => invalid.yaw = bad,
                _ => invalid.pitch = bad,
            }
            assert!(NetworkPlayerPoseV2::new(invalid).is_err());
        }
    }
    for invalid in [EntityId::new(0, 0), EntityId::new(42, 0)] {
        let mut s = source();
        s.entity_id = invalid;
        assert!(NetworkPlayerPoseV2::new(s).is_err());
    }
    let mut s = source();
    s.player_id = PlayerId::default();
    assert!(NetworkPlayerPoseV2::new(s).is_err());
}

#[test]
fn binding_mutations_change_only_projection_hash() {
    let a = NetworkPlayerPoseV2::new(source()).unwrap();
    let mut s = source();
    s.revision.simulation -= 1;
    let b = NetworkPlayerPoseV2::new(s).unwrap();
    assert_eq!(a.pose_hash, b.pose_hash);
    assert_ne!(a.projection_hash, b.projection_hash);
    let mut stale = a.clone();
    stale.source.actor_id = "other".into();
    assert!(encode_network_player_pose_v2(&stale).is_err());
    let mut stale = a;
    stale.source.yaw = 0.0;
    assert!(encode_network_player_pose_v2(&stale).is_err());
}

#[test]
fn rejects_truncated_trailing_tampered_and_cross_version_packets() {
    let bytes = encode_network_player_pose_v2(&NetworkPlayerPoseV2::new(source()).unwrap()).unwrap();
    for length in 0..bytes.len() {
        assert!(decode_network_player_pose_v2(&bytes[..length]).is_err());
    }
    for index in 0..bytes.len() {
        let mut bad = bytes.clone();
        bad[index] ^= 1;
        assert!(decode_network_player_pose_v2(&bad).is_err(), "tamper {index}");
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(decode_network_player_pose_v2(&trailing).is_err());
    assert!(decode_network_player_pose_v1(&bytes).is_err());
    assert!(decode_network_player_pose_v2(&vec![0; NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V2 + 1]).is_err());
}

fn reseal(bytes: &mut [u8]) {
    let length = bytes.len();
    let pose_offset = length - 32 - 65;
    let mut pose = 2_u16.to_le_bytes().to_vec();
    pose.extend_from_slice(&bytes[pose_offset..length - 32]);
    let mut h = CanonicalHasher::new("blockwild-network-player-exact-pose-v2");
    h.write_bytes(&pose);
    bytes[length - 32..length - 16].copy_from_slice(h.finish().as_bytes());
    let mut h = CanonicalHasher::new("blockwild-network-player-exact-projection-v2");
    h.write_bytes(&bytes[..length - 16]);
    bytes[length - 16..].copy_from_slice(h.finish().as_bytes());
}

#[test]
fn resealed_invalid_domains_and_noncanonical_encodings_are_rejected() {
    let original = encode_network_player_pose_v2(&NetworkPlayerPoseV2::new(source()).unwrap()).unwrap();
    let pose_offset = original.len() - 32 - 65;
    for field in 0..8 {
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, f64::MAX] {
            let mut bytes = original.clone();
            bytes[pose_offset + field * 8..pose_offset + field * 8 + 8].copy_from_slice(&bad.to_bits().to_le_bytes());
            reseal(&mut bytes);
            assert!(decode_network_player_pose_v2(&bytes).is_err());
        }
    }
    for (offset, byte) in [(4, 1), (6, 1), (14, 0xff), (pose_offset + 64, 2)] {
        let mut bytes = original.clone();
        bytes[offset] = byte;
        reseal(&mut bytes);
        assert!(decode_network_player_pose_v2(&bytes).is_err());
    }
}

#[test]
fn labels_preserve_native_runtime_byte_domain_and_strict_utf8() {
    let mut s = source();
    s.actor_id = "é".repeat(256);
    s.external_entity_id = "x".repeat(512);
    let pose = NetworkPlayerPoseV2::new(s.clone()).unwrap();
    assert_eq!(
        decode_network_player_pose_v2(&encode_network_player_pose_v2(&pose).unwrap())
            .unwrap()
            .source
            .actor_id,
        s.actor_id
    );
    for bad in ["é".repeat(257), "x".repeat(513), "control\n".into(), String::new()] {
        let mut invalid = s.clone();
        invalid.actor_id = bad;
        assert!(NetworkPlayerPoseV2::new(invalid).is_err());
    }
    let mut invalid = s;
    invalid.universe_id = "x".repeat(65);
    assert!(NetworkPlayerPoseV2::new(invalid).is_err());
}

#[test]
fn checked_fixture_is_exactly_rust_authored() {
    let checked = include_str!("../../../../tests/fixtures/rust-engine/r9-network-wire/native-pose-v2-vectors.json");
    assert_eq!(checked.replace("\r\n", "\n"), vectors::render());
    for (_, source) in vectors::sources() {
        let expected = f64s(&source);
        let pose = NetworkPlayerPoseV2::new(source).unwrap();
        let decoded = decode_network_player_pose_v2(&encode_network_player_pose_v2(&pose).unwrap()).unwrap();
        assert_eq!(f64s(&decoded.source), expected);
    }
}

#[test]
fn one_ulp_outside_every_native_f64_bound_is_rejected() {
    let bounds: [f64; 8] = [
        33_554_432.0,
        33_554_432.0,
        33_554_432.0,
        4096.0,
        4096.0,
        4096.0,
        std::f64::consts::PI,
        std::f64::consts::FRAC_PI_2,
    ];
    for (field, bound) in bounds.into_iter().enumerate() {
        for sign in [-1.0, 1.0] {
            let outside = sign * f64::from_bits(bound.to_bits() + 1);
            let mut s = source();
            match field {
                0..=2 => s.position[field] = outside,
                3..=5 => s.velocity[field - 3] = outside,
                6 => s.yaw = outside,
                _ => s.pitch = outside,
            }
            assert!(NetworkPlayerPoseV2::new(s).is_err(), "outside field{field}, sign{sign}");
        }
    }
}

#[test]
fn address_labels_mirror_native_control_policy_without_narrowing_sessions() {
    // blockwild-authority/src/contract.rs validate_label: C0 and DEL, not all C1.
    for bad in ["\0", "\n", "\u{7f}"] {
        let mut s = source();
        s.universe_id.push_str(bad);
        assert!(NetworkPlayerPoseV2::new(s).is_err());
        let mut s = source();
        s.location_id.push_str(bad);
        assert!(NetworkPlayerPoseV2::new(s).is_err());
    }
    let mut s = source();
    s.session_id.push('\n');
    NetworkPlayerPoseV2::new(s).unwrap();
}
