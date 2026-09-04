//! Rust-authored exact pose fixtures. This module only creates synthetic test
//! values; it does not assert runtime ownership of any example identity.
use blockwild_network::*;
use blockwild_types::{CanonicalHash, EntityId, PlayerId};
use std::fmt::Write;

pub fn sources() -> Vec<(&'static str, NetworkPlayerPoseSourceV2)> {
    let exact = NetworkPlayerPoseSourceV2 {
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
    };
    let mut edges = exact.clone();
    edges.universe_id = "\u{feff}universe-r9".into();
    edges.actor_id = "actor-é".into();
    edges.position = [-33_554_432.0, 33_554_432.0, 0.0];
    edges.velocity = [-4096.0, 4096.0, -f64::from_bits(1)];
    edges.yaw = std::f64::consts::PI;
    edges.pitch = -std::f64::consts::FRAC_PI_2;
    edges.grounded = false;
    edges.player_id = PlayerId::new(1, 0);
    edges.entity_id = EntityId::new(u32::MAX, u32::MAX);
    let mut labels = exact.clone();
    labels.universe_id = "ࠀ".repeat(64);
    labels.location_id = "ࠀ".repeat(128);
    labels.session_id = "ࠀ".repeat(180);
    labels.actor_id = "é".repeat(256);
    labels.external_entity_id = "x".repeat(512);
    vec![
        ("exact-f64-u64", exact),
        ("native-domain-edges-bom", edges),
        ("maximum-native-labels", labels),
    ]
}

pub fn render() -> String {
    let mut out = String::from(
        "{\n  \"schema\": 2,\n  \"producer\": \"cargo run -p blockwild-network --example pose_v2_vectors\",\n  \"boundary\": \"synthetic native-codec vectors; not runtime ownership or migration evidence\",\n  \"vectors\": [\n",
    );
    for (index, (id, source)) in sources().into_iter().enumerate() {
        let pose = NetworkPlayerPoseV2::new(source.clone()).expect("valid fixture source");
        let bytes = encode_network_player_pose_v2(&pose).expect("valid fixture pose");
        if index != 0 {
            out.push_str(",\n");
        }
        write!(out, "    {{\n      \"id\": \"{id}\",\n      \"wireHex\": \"").unwrap();
        for byte in bytes {
            write!(out, "{byte:02x}").unwrap();
        }
        write!(out, "\",\n      \"poseHash\": \"{}\",\n      \"projectionHash\": \"{}\",\n      \"playerId\": \"{}\",\n      \"entityId\": \"{}\",\n      \"tick\": \"{}\",\n      \"inputSequence\": \"{}\",\n      \"f64Bits\": [", pose.pose_hash.to_hex(), pose.projection_hash.to_hex(), source.player_id.packed(), source.entity_id.packed(), source.tick, source.input_sequence).unwrap();
        for (i, value) in source
            .position
            .into_iter()
            .chain(source.velocity)
            .chain([source.yaw, source.pitch])
            .enumerate()
        {
            if i != 0 {
                out.push_str(", ");
            }
            write!(out, "\"{:016x}\"", value.to_bits()).unwrap();
        }
        out.push_str("]\n    }");
    }
    out.push_str("\n  ]\n}\n");
    out
}
