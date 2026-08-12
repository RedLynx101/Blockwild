use std::collections::BTreeMap;

use blockwild_types::CanonicalHash;

use super::*;

fn hash(byte: u8) -> CanonicalHash {
    CanonicalHash([byte; 16])
}

fn binding() -> BlockActionLootBindingV1 {
    BlockActionLootBindingV1 {
        manifest_hash: hash(1),
        installed_registry_hash: hash(2),
        catalog_schema_version: 2,
        catalog_content_version: 9,
        catalog_blob_hash: hash(3),
        action_report_hash: hash(4),
        rng_semantics_version_id: ACTION_PROMOTION_RNG_SEMANTICS_VERSION_ID_V1.to_owned(),
        rng_semantics_hash: hash(5),
        implementation_version_id: BLOCK_ACTION_LOOT_IMPLEMENTATION_VERSION_ID_V1.to_owned(),
        implementation_hash: canonical_block_action_loot_implementation_hash_v1(),
    }
}

fn context() -> BlockActionLootContextV1 {
    BlockActionLootContextV1 {
        block_action_sequence: 41,
        origin_input_sequence: 39,
        block_id: 7,
        position: BlockActionLootCellV1 { x: -2, y: 63, z: 11 },
        harvested: true,
        creative_mode: false,
        scythe: false,
    }
}

fn rule(
    ordinal: u16,
    id: &str,
    item_code: u32,
    chance_millionths: u64,
    chance_modifier: ContentBlockLootChanceModifier,
    roll_scope: ContentBlockLootRollScope,
    count: ContentBlockLootCount,
) -> ContentBlockLootRule {
    ContentBlockLootRule {
        ordinal,
        id: id.to_owned(),
        item_code,
        chance_millionths,
        chance_modifier,
        roll_scope,
        count,
    }
}

fn profile(mode: ContentBlockLootMode, rules: Vec<ContentBlockLootRule>) -> ContentBlockActionProfile {
    ContentBlockActionProfile {
        block_id: 7,
        hardness_millionths: 500_000,
        solid: true,
        replaceable: false,
        liquid: None,
        preferred_tool: ContentActionToolKind::Hand,
        required_tier: 0,
        mapped_item_code: None,
        shape: None,
        collision_height_millionths: None,
        vertical_connect_group: None,
        connect_group: None,
        topology_flags: 0,
        break_profile: Some(ContentBlockBreakProfile {
            replacement: ContentBlockBreakReplacement::Air,
            durability_cost: ContentBlockDurabilityCost::None,
            wrong_tool: ContentBlockWrongToolPolicy::BreakNoLoot,
            contextual_override: ContentBlockContextualOverride::None,
            loot: ContentBlockLootProfile {
                mode,
                self_drop_mode: ContentBlockSelfDropMode::Contextual,
                silk_touch: ContentBlockSilkTouchPolicy::NotAuthored,
                rules,
            },
        }),
        harvest_intent: None,
        placement_intent: Some(ContentBlockPlacementIntent::None),
        placement_items: Vec::new(),
        interaction_intents: Vec::new(),
        planting_rules: Vec::new(),
        authority_blockers: vec!["authoritative-rng-context-unbound".to_owned()],
    }
}

fn item_limits(values: &[(u32, u32)]) -> BTreeMap<u32, u32> {
    values.iter().copied().collect()
}

#[test]
fn xorshift_matches_the_engine_vector_and_seeded_cursor_is_nonzero() {
    let mut state = 1;
    let mut values = Vec::new();
    for _ in 0..5 {
        state = block_action_xorshift32_v1(state);
        values.push(state);
    }
    // This pins the same public xorshift32 transition used by blockwild-engine.
    assert_eq!(values, [270_369, 67_634_689, 2_647_435_461, 307_599_695, 2_398_689_233]);
    assert_eq!(block_action_xorshift32_v1(0), 0x6d2b_79f5);
    assert_ne!(BlockActionLootRngCursorV1::from_seed_v1("world-a").state, 0);
    assert_eq!(
        BlockActionLootRngCursorV1::from_seed_v1("world-a"),
        BlockActionLootRngCursorV1::from_seed_v1("world-a")
    );
}

#[test]
fn integer_probability_and_count_boundaries_are_exact() {
    assert!(block_action_random_gate_v1(u32::MAX, CONTENT_ACTION_FIXED_SCALE));
    assert!(block_action_random_gate_v1(4_294, 1));
    assert!(!block_action_random_gate_v1(4_295, 1));
    assert!(block_action_random_gate_v1(1_u32 << 31, 500_000));
    assert!(!block_action_random_gate_v1((1_u32 << 31) + 1, 500_000));

    assert_eq!(block_action_uniform_inclusive_count_v1(0, 2, 5).unwrap(), 2);
    assert_eq!(block_action_uniform_inclusive_count_v1(1_u32 << 30, 2, 5).unwrap(), 3);
    assert_eq!(block_action_uniform_inclusive_count_v1(u32::MAX, 2, 5).unwrap(), 5);
    assert_eq!(
        block_action_uniform_inclusive_count_v1(0, 5, 4).unwrap_err().code,
        BlockActionLootErrorCodeV1::InvalidProfile
    );

    assert_eq!(
        block_action_exclusive_selection_v1((1_u32 << 31) - 1, &[500_000, 500_000]).unwrap(),
        0
    );
    assert_eq!(
        block_action_exclusive_selection_v1(1_u32 << 31, &[500_000, 500_000]).unwrap(),
        1
    );
    assert_eq!(
        block_action_exclusive_selection_v1(u32::MAX, &[500_000, 500_000]).unwrap(),
        1
    );
    assert!(block_action_exclusive_selection_v1(0, &[499_999, 500_000]).is_err());
}

#[test]
fn shared_plant_mapping_uses_one_integer_draw_strict_thresholds_and_clamp() {
    let formula = ContentBlockLootCount::SharedRollFormula {
        base: 1,
        floor_roll_multiplier: 2,
        scythe_bonus: 1,
        threshold_bonuses: vec![
            ContentBlockLootThresholdBonus {
                above_millionths: 500_000,
                amount: 3,
                scythe_only: false,
            },
            ContentBlockLootThresholdBonus {
                above_millionths: 999_899,
                amount: 2,
                scythe_only: true,
            },
            ContentBlockLootThresholdBonus {
                above_millionths: 999_900,
                amount: 7,
                scythe_only: false,
            },
        ],
    };
    assert_eq!(
        block_action_shared_plant_count_v1(&formula, 1_u32 << 31, false).unwrap(),
        2
    );
    assert_eq!(
        block_action_shared_plant_count_v1(&formula, (1_u32 << 31) + 1, false).unwrap(),
        5
    );
    // The maximum draw clamps to 999900 millionths: the 999899 threshold fires,
    // while the exact 999900 threshold remains false under strict `>`.
    assert_eq!(block_action_shared_plant_count_v1(&formula, u32::MAX, true).unwrap(), 8);
    assert_eq!(block_action_loot_count_maximum_v1(&formula).unwrap(), 8);
}

#[test]
fn evaluator_consumes_declared_draws_groups_stacks_and_replays_exactly() {
    let profile = profile(
        ContentBlockLootMode::All,
        vec![
            rule(
                0,
                "random-constant",
                10,
                CONTENT_ACTION_FIXED_SCALE,
                ContentBlockLootChanceModifier::None,
                ContentBlockLootRollScope::RandomDropV1,
                ContentBlockLootCount::Constant(3),
            ),
            rule(
                1,
                "certain",
                10,
                CONTENT_ACTION_FIXED_SCALE,
                ContentBlockLootChanceModifier::None,
                ContentBlockLootRollScope::None,
                ContentBlockLootCount::Constant(4),
            ),
        ],
    );
    let limits = item_limits(&[(10, 5)]);
    let rng = BlockActionLootRngCursorV1 {
        state: 1,
        draw_count: 10,
    };
    let plan = evaluate_block_action_loot_v1(&binding(), &profile, &limits, &context(), rng).unwrap();
    assert_eq!(
        canonical_block_action_loot_implementation_hash_v1().to_hex(),
        "6c2abe4c55b8975d10e599f1e7bb5490"
    );
    assert_eq!(plan.plan_hash.to_hex(), "6f62747cdbf91a6ec83a57e66bc2a962");
    assert_eq!(
        plan.draws.len(),
        2,
        "successful random constants still consume their count draw"
    );
    assert_eq!(plan.draws[0].value, 270_369);
    assert_eq!(plan.draws[0].purpose, BlockActionRngDrawPurposeV1::RandomGate);
    assert_eq!(plan.draws[1].value, 67_634_689);
    assert_eq!(plan.draws[1].purpose, BlockActionRngDrawPurposeV1::RandomCount);
    assert_eq!(plan.rng_after.state, 67_634_689);
    assert_eq!(plan.rng_after.draw_count, 12);
    assert_eq!(
        plan.outcomes.iter().map(|outcome| outcome.count).collect::<Vec<_>>(),
        [3, 4]
    );
    assert_eq!(plan.stacks.iter().map(|stack| stack.count).collect::<Vec<_>>(), [5, 2]);
    assert_eq!(
        plan.stacks.iter().map(|stack| stack.group_ordinal).collect::<Vec<_>>(),
        [0, 1]
    );
    replay_verify_block_action_loot_plan_v1(&plan, &profile, &limits).unwrap();
    assert_eq!(
        plan,
        evaluate_block_action_loot_v1(&binding(), &profile, &limits, &context(), rng).unwrap()
    );

    let mut self_consistent_tamper = plan.clone();
    self_consistent_tamper.draws[0].value ^= 1;
    self_consistent_tamper.plan_hash = self_consistent_tamper.calculate_hash_v1();
    assert_eq!(
        replay_verify_block_action_loot_plan_v1(&self_consistent_tamper, &profile, &limits)
            .unwrap_err()
            .code,
        BlockActionLootErrorCodeV1::HashMismatch
    );
}

#[test]
fn one_successful_rule_splits_into_bounded_max_stack_custodies() {
    let profile = profile(
        ContentBlockLootMode::All,
        vec![rule(
            0,
            "large-drop",
            10,
            CONTENT_ACTION_FIXED_SCALE,
            ContentBlockLootChanceModifier::None,
            ContentBlockLootRollScope::None,
            ContentBlockLootCount::Constant(8),
        )],
    );
    let limits = item_limits(&[(10, 5)]);
    assert_eq!(
        block_action_loot_generated_drop_maximum_v1(&profile, &limits).unwrap(),
        2
    );
    let plan = evaluate_block_action_loot_v1(
        &binding(),
        &profile,
        &limits,
        &context(),
        BlockActionLootRngCursorV1 {
            state: 1,
            draw_count: 0,
        },
    )
    .unwrap();
    assert_eq!(plan.outcomes.len(), 1);
    assert_eq!(plan.stacks.iter().map(|stack| stack.count).collect::<Vec<_>>(), [5, 3]);
    assert_eq!(
        plan.stacks.iter().map(|stack| stack.group_ordinal).collect::<Vec<_>>(),
        [0, 1]
    );
}

#[test]
fn failed_gate_unharvested_creative_and_luck_have_exact_draw_behavior() {
    let random = rule(
        0,
        "rare",
        10,
        1,
        ContentBlockLootChanceModifier::None,
        ContentBlockLootRollScope::RandomDropV1,
        ContentBlockLootCount::Constant(1),
    );
    let limits = item_limits(&[(10, 5)]);
    let rng = BlockActionLootRngCursorV1 {
        state: 1,
        draw_count: 0,
    };
    let failed = evaluate_block_action_loot_v1(
        &binding(),
        &profile(ContentBlockLootMode::All, vec![random.clone()]),
        &limits,
        &context(),
        rng,
    )
    .unwrap();
    assert_eq!(failed.draws.len(), 1);
    assert_eq!(failed.outcomes[0].count_draw_index, None);
    assert!(!failed.outcomes[0].selected);

    let mut creative = context();
    creative.creative_mode = true;
    let skipped = evaluate_block_action_loot_v1(
        &binding(),
        &profile(ContentBlockLootMode::All, vec![random.clone()]),
        &limits,
        &creative,
        rng,
    )
    .unwrap();
    assert!(skipped.draws.is_empty());
    assert!(skipped.outcomes.is_empty());
    assert_eq!(skipped.rng_after, rng);
    let mut unharvested = context();
    unharvested.harvested = false;
    let skipped = evaluate_block_action_loot_v1(
        &binding(),
        &profile(ContentBlockLootMode::All, vec![random.clone()]),
        &limits,
        &unharvested,
        rng,
    )
    .unwrap();
    assert!(skipped.draws.is_empty());
    assert_eq!(skipped.rng_after, rng);

    let mut luck = random;
    luck.chance_modifier = ContentBlockLootChanceModifier::LuckAdjustedV1;
    assert_eq!(
        evaluate_block_action_loot_v1(
            &binding(),
            &profile(ContentBlockLootMode::All, vec![luck]),
            &limits,
            &context(),
            rng,
        )
        .unwrap_err()
        .code,
        BlockActionLootErrorCodeV1::MissingRuntimeContext
    );
}

#[test]
fn evaluator_rejects_unsupported_duplicate_and_over_capacity_profiles() {
    let unsupported = profile(
        ContentBlockLootMode::All,
        vec![rule(
            0,
            "bad",
            10,
            CONTENT_ACTION_FIXED_SCALE,
            ContentBlockLootChanceModifier::None,
            ContentBlockLootRollScope::None,
            ContentBlockLootCount::UniformInclusive { minimum: 1, maximum: 2 },
        )],
    );
    assert_eq!(
        evaluate_block_action_loot_v1(
            &binding(),
            &unsupported,
            &item_limits(&[(10, 2)]),
            &context(),
            BlockActionLootRngCursorV1 {
                state: 1,
                draw_count: 0
            },
        )
        .unwrap_err()
        .code,
        BlockActionLootErrorCodeV1::UnsupportedSemantics
    );

    let duplicate = profile(
        ContentBlockLootMode::All,
        vec![
            rule(
                0,
                "same",
                10,
                CONTENT_ACTION_FIXED_SCALE,
                ContentBlockLootChanceModifier::None,
                ContentBlockLootRollScope::None,
                ContentBlockLootCount::Constant(1),
            ),
            rule(
                1,
                "same",
                10,
                CONTENT_ACTION_FIXED_SCALE,
                ContentBlockLootChanceModifier::None,
                ContentBlockLootRollScope::None,
                ContentBlockLootCount::Constant(1),
            ),
        ],
    );
    assert_eq!(
        evaluate_block_action_loot_v1(
            &binding(),
            &duplicate,
            &item_limits(&[(10, 2)]),
            &context(),
            BlockActionLootRngCursorV1 {
                state: 1,
                draw_count: 0
            },
        )
        .unwrap_err()
        .code,
        BlockActionLootErrorCodeV1::InvalidProfile
    );

    let over_capacity = profile(
        ContentBlockLootMode::All,
        vec![rule(
            0,
            "too-many",
            10,
            CONTENT_ACTION_FIXED_SCALE,
            ContentBlockLootChanceModifier::None,
            ContentBlockLootRollScope::None,
            ContentBlockLootCount::Constant(161),
        )],
    );
    assert_eq!(
        evaluate_block_action_loot_v1(
            &binding(),
            &over_capacity,
            &item_limits(&[(10, 5)]),
            &context(),
            BlockActionLootRngCursorV1 {
                state: 1,
                draw_count: 0
            },
        )
        .unwrap_err()
        .code,
        BlockActionLootErrorCodeV1::Capacity
    );
}

fn provenance() -> GeneratedDropProvenanceV1 {
    GeneratedDropProvenanceV1 {
        schema_version: BLOCK_ACTION_GENERATED_DROP_PROVENANCE_SCHEMA_VERSION_V1,
        manifest_hash: hash(1),
        installed_registry_hash: hash(2),
        catalog_blob_hash: hash(3),
        action_report_hash: hash(4),
        rng_semantics_hash: hash(5),
        block_action_sequence: 41,
        origin_input_sequence: 39,
        block_id: 7,
        position: BlockActionLootCellV1 { x: -2, y: 63, z: 11 },
        loot_plan_hash: hash(6),
        group_ordinal: 2,
    }
}

#[test]
fn provenance_hash_and_derived_ids_are_canonical_and_bounded() {
    let value = provenance();
    assert_eq!(value.canonical_hash_v1().to_hex(), "b602016c18bb35d0c8c1146cc167ba3b");
    value.validate_v1().unwrap();
    assert_eq!(value.drop_id_v1(), "block-loot-v1:41:2");
    assert_eq!(value.custody_id_v1(), "block-loot-custody-v1:41:2");
    assert_eq!(value.canonical_hash_v1(), provenance().canonical_hash_v1());

    let mut zero_hash = value.clone();
    zero_hash.loot_plan_hash = CanonicalHash::default();
    assert_eq!(
        zero_hash.validate_v1().unwrap_err().code,
        BlockActionLootErrorCodeV1::Binding
    );
    let mut zero_sequence = value.clone();
    zero_sequence.block_action_sequence = 0;
    assert_eq!(
        zero_sequence.validate_v1().unwrap_err().code,
        BlockActionLootErrorCodeV1::InvalidContext
    );
    let mut over_capacity = value;
    over_capacity.group_ordinal = MAX_BLOCK_ACTION_GENERATED_DROPS_V1 as u16;
    assert_eq!(
        over_capacity.validate_v1().unwrap_err().code,
        BlockActionLootErrorCodeV1::Capacity
    );
}
