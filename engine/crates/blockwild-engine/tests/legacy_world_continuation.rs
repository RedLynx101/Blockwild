use blockwild_engine::legacy_world_continuation::*;
use blockwild_types::{CanonicalHash, CanonicalHasher};

fn fixture(generator_version: u16) -> LegacyWorldContinuationV1 {
    let source_state = LegacyContinuationStateV1 {
        day: 41.0,
        time: 0.0,
        weather: LegacyWeatherV1::Clear,
        spawn: LegacyContinuationVec3V1 {
            x: -13.125,
            y: 40.51,
            z: -0.0,
        },
        pose: LegacyContinuationPoseV1 {
            x: 16_777_217.123_456_79,
            y: 40.51,
            z: -8.123_456_789,
            yaw: 0.123_456_789_123,
            pitch: 1.7,
        },
    };
    let mut target_state = source_state.clone();
    target_state.spawn.z = 0.0;
    target_state.pose.pitch = 1.4;
    let mut value = LegacyWorldContinuationV1 {
        schema_version: 1,
        source: LegacyContinuationSourceV1 {
            generator_version,
            raw_sha256: LegacyContinuationSha256V1([0x11; 32]),
            byte_length: 4096,
            semantic_hash: CanonicalHash([0x22; 16]),
            world_seed: "\u{feff}Source 🌿".into(),
            state: source_state,
        },
        target: LegacyContinuationTargetV1 {
            catalog_world_id: "catalog-🌿".into(),
            universe_id: "universe".into(),
            location_id: "overworld".into(),
            generator_hash: CanonicalHash([0x33; 16]),
            content_hash: CanonicalHash([0x44; 16]),
            normalized_semantic_hash: CanonicalHash([0x55; 16]),
            generator_version: 18,
            generator_profile: LegacyGeneratorProfileV1::WorldBelowV15,
            mode: LegacyModeV1::Builder,
            state: target_state,
            options: LegacyContinuationWorldOptionsV1 {
                difficulty: LegacyDifficultyV1::Peaceful,
                day_length_minutes: 35.0,
                mob_density: 0.0,
                butterfly_density: 0.0,
                cave_frequency: 1.0,
                biome_scale: 1.35,
                resource_abundance: 1.0,
                structures: true,
                weather: false,
                keep_inventory: true,
                friendly_fire: false,
                sleep_rule: LegacySleepRuleV1::Percentage,
                sleep_percentage: 50.0,
                enabled_factions: vec![LegacyFactionV1::Hobbits, LegacyFactionV1::Dwarves],
                settlement_pattern: if generator_version == 16 {
                    LegacySettlementPatternV1::LegacyScattered
                } else {
                    LegacySettlementPatternV1::Heartlands
                },
                settlement_density: 1.0,
                settlement_clustering: LegacySettlementClusteringV1::Regional,
                road_coverage: LegacyRoadCoverageV1::Regional,
                large_town_frequency: LegacyLargeTownFrequencyV1::Balanced,
                origin: LegacyContinuationOriginV1::Wilderness,
            },
        },
        actor: LegacyContinuationActorV1 {
            profile_id: "profile".into(),
            actor_id: "actor".into(),
            command_actor_id: "reviewer".into(),
            profile_canonical_hash: LegacyContinuationSha256V1([0x66; 32]),
        },
        policy: LegacyContinuationPolicyV1 {
            version: 1,
            id: LEGACY_WORLD_CONTINUATION_POLICY_ID_V1.into(),
            proposal_hash: LegacyContinuationSha256V1([0x77; 32]),
            decision: LegacyReviewDecisionV1::AffirmReviewOnly,
        },
        actual_legacy_load_world_time: ((0.32 % 1.0) + 1.0) % 1.0,
        decisions: LegacyContinuationDecisionsV1 {
            owner: LegacyOwnerDecisionV1::AdoptSelectedNotHistorical,
            velocity: LegacyVelocityDecisionV1::FreshRestNotRestored,
            grounded: LegacyGroundedDecisionV1::RecomputeNoHistoricalAssertion,
            session_age: LegacySessionAgeDecisionV1::FreshZeroNotHistorical,
        },
    };
    if generator_version == 17 {
        let options = &mut value.target.options;
        options.difficulty = LegacyDifficultyV1::Hard;
        options.day_length_minutes = 120.0;
        options.mob_density = 3.0;
        options.butterfly_density = 4.0;
        options.cave_frequency = 3.0;
        options.biome_scale = 4.0;
        options.resource_abundance = 0.25;
        options.weather = true;
        options.keep_inventory = false;
        options.friendly_fire = true;
        options.sleep_rule = LegacySleepRuleV1::AllPlayers;
        options.sleep_percentage = 100.0;
        options.enabled_factions = vec![
            LegacyFactionV1::Hobbits,
            LegacyFactionV1::Goblins,
            LegacyFactionV1::Atlantians,
            LegacyFactionV1::Sugarcourt,
            LegacyFactionV1::WoodElves,
            LegacyFactionV1::Dwarves,
        ];
        options.settlement_density = 2.0;
        options.settlement_clustering = LegacySettlementClusteringV1::Strong;
        options.road_coverage = LegacyRoadCoverageV1::Dense;
        options.large_town_frequency = LegacyLargeTownFrequencyV1::Frequent;
        options.origin = LegacyContinuationOriginV1::CultureSettlement {
            faction_id: LegacyFactionV1::Dwarves,
            minimum_size: LegacySettlementSizeV1::Town,
        };
    }
    value
}

fn round_trip(value: &LegacyWorldContinuationV1) -> LegacyWorldContinuationV1 {
    let bytes = value.encode().expect("valid typed fixture");
    let hash = value.semantic_hash().unwrap();
    let decoded = LegacyWorldContinuationV1::decode(&bytes, Some(hash)).expect("decode independent packet");
    assert_eq!(&decoded, value);
    assert_eq!(decoded.encode().unwrap(), bytes);
    assert_eq!(decoded.semantic_hash().unwrap(), hash);
    decoded
}

#[test]
fn midnight_source_normalized_and_legacy_load_stages_remain_separate() {
    for version in [16, 17] {
        let decoded = round_trip(&fixture(version));
        assert_eq!(decoded.source.state.spawn.z.to_bits(), (-0.0_f64).to_bits());
        assert_eq!(decoded.target.state.spawn.z.to_bits(), 0.0_f64.to_bits());
        assert_eq!(decoded.source.state.time, 0.0);
        assert_eq!(decoded.target.state.time, 0.0);
        assert_eq!(
            decoded.actual_legacy_load_world_time.to_bits(),
            (((0.32_f64 % 1.0) + 1.0) % 1.0).to_bits()
        );
        assert_ne!(decoded.source.state.pose.pitch, decoded.target.state.pose.pitch);
        assert_ne!(
            f64::from(decoded.target.state.pose.y as f32),
            decoded.target.state.pose.y
        );
        assert_eq!(decoded.source.world_seed, "\u{feff}Source 🌿");
    }
}

#[test]
fn all_finite_pose_bits_including_subnormal_and_signed_zero_are_lossless() {
    for bits in [
        0,
        1,
        0x8000_0000_0000_0000,
        0x8000_0000_0000_0001,
        0x7fef_ffff_ffff_ffff,
        0xffef_ffff_ffff_ffff,
        0x3fd5_5555_5555_5555,
    ] {
        let number = f64::from_bits(bits);
        let mut value = fixture(17);
        value.source.state.pose.x = number;
        value.target.state.pose.yaw = number;
        value.target.state.spawn.z = number;
        let decoded = round_trip(&value);
        assert_eq!(decoded.source.state.pose.x.to_bits(), bits);
        assert_eq!(decoded.target.state.pose.yaw.to_bits(), bits);
        assert_eq!(decoded.target.state.spawn.z.to_bits(), bits);
    }
    let negative = fixture(16);
    let mut positive = negative.clone();
    positive.source.state.spawn.z = 0.0;
    assert_ne!(positive.semantic_hash().unwrap(), negative.semantic_hash().unwrap());
}

#[test]
fn complete_options_enum_branches_and_ordered_factions_round_trip() {
    let mut value = fixture(17);
    value.target.options.enabled_factions = vec![
        LegacyFactionV1::Hobbits,
        LegacyFactionV1::Goblins,
        LegacyFactionV1::Atlantians,
        LegacyFactionV1::Sugarcourt,
        LegacyFactionV1::WoodElves,
        LegacyFactionV1::Dwarves,
    ];
    macro_rules! vary {
        ($field:ident, $values:expr) => {
            for variant in $values {
                value.target.options.$field = variant;
                round_trip(&value);
            }
        };
    }
    vary!(
        difficulty,
        [
            LegacyDifficultyV1::Peaceful,
            LegacyDifficultyV1::Easy,
            LegacyDifficultyV1::Normal,
            LegacyDifficultyV1::Hard
        ]
    );
    vary!(
        sleep_rule,
        [
            LegacySleepRuleV1::AnyPlayer,
            LegacySleepRuleV1::Percentage,
            LegacySleepRuleV1::AllPlayers
        ]
    );
    vary!(
        settlement_pattern,
        [
            LegacySettlementPatternV1::LegacyScattered,
            LegacySettlementPatternV1::Heartlands
        ]
    );
    vary!(
        settlement_clustering,
        [
            LegacySettlementClusteringV1::Even,
            LegacySettlementClusteringV1::Regional,
            LegacySettlementClusteringV1::Strong
        ]
    );
    vary!(
        road_coverage,
        [
            LegacyRoadCoverageV1::None,
            LegacyRoadCoverageV1::Local,
            LegacyRoadCoverageV1::Regional,
            LegacyRoadCoverageV1::Dense
        ]
    );
    vary!(
        large_town_frequency,
        [
            LegacyLargeTownFrequencyV1::Rare,
            LegacyLargeTownFrequencyV1::Balanced,
            LegacyLargeTownFrequencyV1::Frequent
        ]
    );
    for size in [
        LegacySettlementSizeV1::Hamlet,
        LegacySettlementSizeV1::Village,
        LegacySettlementSizeV1::Town,
    ] {
        value.target.options.origin = LegacyContinuationOriginV1::CultureSettlement {
            faction_id: LegacyFactionV1::Dwarves,
            minimum_size: size,
        };
        round_trip(&value);
    }
    value.target.options.origin = LegacyContinuationOriginV1::NearAnySettlement;
    round_trip(&value);
    value.target.options.origin = LegacyContinuationOriginV1::Wilderness;
    value.target.options.enabled_factions.clear();
    round_trip(&value);
    value.source.state.weather = LegacyWeatherV1::Rain;
    value.target.state.weather = LegacyWeatherV1::Rain;
    round_trip(&value);
}

#[test]
fn finite_identity_option_and_canonical_faction_bounds_are_strict() {
    let changes: Vec<fn(&mut LegacyWorldContinuationV1)> = vec![
        |v| v.schema_version = 2,
        |v| v.source.generator_version = 18,
        |v| v.target.generator_version = 17,
        |v| v.source.byte_length = 0,
        |v| v.source.byte_length = 64 * 1024 * 1024 + 1,
        |v| v.source.state.day = 1.5,
        |v| v.target.state.day = 9_007_199_254_740_992.0,
        |v| v.source.state.pose.x = f64::INFINITY,
        |v| v.target.state.spawn.z = f64::NAN,
        |v| v.target.options.day_length_minutes = 121.0,
        |v| v.target.options.mob_density = -1.0,
        |v| v.target.options.enabled_factions.reverse(),
        |v| v.target.options.enabled_factions.push(LegacyFactionV1::Dwarves),
        |v| {
            v.target.options.origin = LegacyContinuationOriginV1::CultureSettlement {
                faction_id: LegacyFactionV1::Goblins,
                minimum_size: LegacySettlementSizeV1::Town,
            }
        },
        |v| {
            v.target.options.structures = false;
            v.target.options.origin = LegacyContinuationOriginV1::NearAnySettlement;
        },
        |v| v.actor.actor_id = "bad\0actor".into(),
        |v| v.target.catalog_world_id = "x".repeat(49),
        |v| v.source.world_seed = "a".repeat(513),
        |v| v.policy.version = 2,
        |v| v.policy.id.push('x'),
        |v| v.actual_legacy_load_world_time = 1.0,
    ];
    for change in changes {
        let mut value = fixture(16);
        change(&mut value);
        assert!(value.validate().is_err());
        assert!(value.encode().is_err());
        assert!(value.semantic_hash().is_err());
    }
    let mut valid = fixture(16);
    valid.source.byte_length = 64 * 1024 * 1024;
    valid.source.state.day = 9_007_199_254_740_991.0;
    valid.source.world_seed = "🌿".repeat(256);
    round_trip(&valid);
    valid.source.world_seed = "a\0\n\u{feff}b".into();
    round_trip(&valid);
}

#[test]
fn semantic_terms_cannot_be_changed_by_resealing_transport() {
    let original = fixture(16);
    let expected = original.semantic_hash().unwrap();
    let mut changed = original.clone();
    changed.target.state.pose.x += 0.000_000_1;
    let bytes = changed.encode().unwrap();
    assert_ne!(changed.semantic_hash().unwrap(), expected);
    assert!(
        LegacyWorldContinuationV1::decode(&bytes, Some(expected))
            .unwrap_err()
            .0
            .contains("semantic")
    );
    round_trip(&changed);
    let mut corrupt = original.encode().unwrap();
    corrupt[12 + 2] ^= 1; // Valid raw SHA field, old semantic digest, newly sealed transport.
    reseal(&mut corrupt, false);
    assert!(
        LegacyWorldContinuationV1::decode(&corrupt, None)
            .unwrap_err()
            .0
            .contains("semantic")
    );
}

fn reseal(bytes: &mut [u8], semantic: bool) {
    let length = bytes.len();
    if semantic {
        let mut hasher = CanonicalHasher::new("blockwild-legacy-world-continuation-semantic-v1");
        hasher.write_u16(1);
        hasher.write_bytes(&bytes[12..length - 32]);
        bytes[length - 32..length - 16].copy_from_slice(hasher.finish().as_bytes());
    }
    let mut hasher = CanonicalHasher::new("blockwild-legacy-world-continuation-transport-v1");
    hasher.write_bytes(&bytes[..length - 16]);
    bytes[length - 16..].copy_from_slice(hasher.finish().as_bytes());
}

#[test]
fn resealed_invalid_typed_payloads_still_fail_and_unknown_tags_are_not_ignored() {
    let original = fixture(16).encode().unwrap();
    let state_start = 12 + 2 + 32 + 8 + 16 + 2 + "\u{feff}Source 🌿".len();
    for (offset, data) in [
        (12, vec![18, 0]),             // source generator version
        (state_start + 16, vec![255]), // source weather tag
        (state_start + 8, f64::INFINITY.to_le_bytes().to_vec()),
        (state_start, 1.5_f64.to_le_bytes().to_vec()),
        (12 + 2 + 32 + 8 + 16 + 2, vec![0xff]), // malformed UTF-8
        (original.len() - 33, vec![1]),         // last explicit transient decision tag
    ] {
        let mut bytes = original.clone();
        bytes[offset..offset + data.len()].copy_from_slice(&data);
        reseal(&mut bytes, true);
        assert!(
            LegacyWorldContinuationV1::decode(&bytes, None).is_err(),
            "offset {offset}"
        );
    }
}

#[test]
fn every_truncation_mutation_trailer_and_oversize_packet_is_rejected() {
    let bytes = fixture(16).encode().unwrap();
    for length in 0..bytes.len() {
        assert!(
            LegacyWorldContinuationV1::decode(&bytes[..length], None).is_err(),
            "length {length}"
        );
    }
    for index in 0..bytes.len() {
        let mut changed = bytes.clone();
        changed[index] ^= 1;
        assert!(
            LegacyWorldContinuationV1::decode(&changed, None).is_err(),
            "offset {index}"
        );
    }
    let mut trailing = bytes;
    trailing.push(0);
    assert!(LegacyWorldContinuationV1::decode(&trailing, None).is_err());
    assert!(LegacyWorldContinuationV1::decode(&vec![0; LEGACY_WORLD_CONTINUATION_MAX_BYTES_V1 + 1], None).is_err());
}

fn hex(bytes: &[u8]) -> String {
    use core::fmt::Write as _;
    let mut result = String::new();
    for byte in bytes {
        write!(&mut result, "{byte:02x}").unwrap();
    }
    result
}

/// The checked fixture is authored here in Rust, not generated by TypeScript.
/// To review/regenerate: cargo test -p blockwild-engine --test
/// legacy_world_continuation checked_rust_vectors -- --nocapture
#[test]
fn checked_rust_vectors() {
    let vectors = [16, 17].map(|version| {
        let value = fixture(version);
        format!(
            "    {{\"sourceGeneratorVersion\":{version},\"semanticHash\":\"{}\",\"hex\":\"{}\"}}",
            value.semantic_hash().unwrap().to_hex(),
            hex(&value.encode().unwrap())
        )
    });
    let json = format!(
        "{{\n  \"schemaVersion\": 1,\n  \"producer\": \"blockwild-engine Rust standalone codec\",\n  \"vectors\": [\n{}\n  ]\n}}\n",
        vectors.join(",\n")
    );
    println!("BWLC_FIXTURES_BEGIN\n{json}BWLC_FIXTURES_END");
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures/rust-engine/legacy-world-continuation-v1.json");
    let checked = std::fs::read_to_string(path).expect("checked Rust-authored vector fixture exists");
    assert_eq!(checked.replace("\r\n", "\n"), json);
}
