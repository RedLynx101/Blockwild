use blockwild_types::CanonicalHash;

use super::*;

fn reseal_world(window: &mut WorldReadWindowV1, identity: &mut SimulationJobIdentityV1) {
    window.snapshot_hash = crate::contract::hash_world_window(window);
    identity.source_snapshot_hash = window.snapshot_hash;
}

fn set_test_block(window: &mut WorldReadWindowV1, position: CellPos, block: u16) {
    let index = window.index(position).expect("test cell is inside the read window");
    window.blocks[index] = block;
}

fn set_test_water(window: &mut WorldReadWindowV1, position: CellPos) {
    let index = window.index(position).expect("test liquid is inside the read window");
    window.liquid_kind[index] = LiquidKindV1::Water as u8;
    window.liquid_level[index] = 0;
    window.flags[index] = WORLD_CELL_LIQUID_SOURCE;
}

fn shoreline_physics_fixture(bank_top_y: i32, unknown_clearance: bool) -> PhysicsStepInputV1 {
    let mut input = fixture::canonical_fixture().physics;
    let size = [9, 10, 9];
    let count = size.iter().map(|value| *value as usize).product();
    input.window = WorldReadWindowV1 {
        address: input.window.address.clone(),
        origin: CellPos::new(-4, -1, -4),
        size,
        identity: input.window.identity.clone(),
        loaded_mask: vec![1; count],
        boundary: vec![0; count],
        blocks: vec![0; count],
        facing: vec![0; count],
        liquid_kind: vec![0; count],
        liquid_level: vec![0; count],
        flags: vec![0; count],
        snapshot_hash: CanonicalHash::default(),
    };
    for z in -4..=4 {
        for x in -4..=4 {
            set_test_block(&mut input.window, CellPos::new(x, 0, z), 1);
        }
    }
    for z in 0..=3 {
        for x in -1..=1 {
            for y in 1..=2 {
                set_test_water(&mut input.window, CellPos::new(x, y, z));
            }
        }
    }
    for z in -3..=-1 {
        for x in -1..=1 {
            for y in 1..=bank_top_y {
                set_test_block(&mut input.window, CellPos::new(x, y, z), 2);
            }
        }
    }
    if unknown_clearance {
        let index = input
            .window
            .index(CellPos::new(0, bank_top_y + 1, -1))
            .expect("unknown ledge clearance is inside the read window");
        input.window.loaded_mask[index] = 0;
    }
    reseal_world(&mut input.window, &mut input.identity);
    input.body.position = Vec3::new(0.0, 0.89, -0.19);
    input.body.velocity = Vec3::default();
    input.body.grounded = false;
    input.body.swim_shore_exit_ready = true;
    input.controls = PhysicsControlsV1 {
        flags: PHYSICS_CONTROL_JUMP,
        forward: 1.0,
        strafe: 0.0,
        yaw: 0.0,
        desired_speed: 5.2,
    };
    input.fixed_delta_micros = 50_000;
    input.seal()
}

#[derive(Debug)]
struct ShorelinePhysicsTrace {
    result: PhysicsStepResultV1,
    shore_exits: usize,
    liquid_exits: usize,
    liquid_reentries: usize,
    fall_damage_events: usize,
    touched_unknown: bool,
    reached_dry_ground_beyond_ledge: bool,
}

fn advance_shoreline_fixture(mut input: PhysicsStepInputV1, maximum_steps: usize) -> ShorelinePhysicsTrace {
    let mut shore_exits = 0;
    let mut liquid_exits = 0;
    let mut liquid_reentries = 0;
    let mut fall_damage_events = 0;
    let mut touched_unknown = false;
    let mut observed_liquid_exit = false;
    let mut reached_dry_ground_beyond_ledge = false;
    let mut result = None;
    for _ in 0..maximum_steps {
        let step = step_physics(&input).expect("valid shoreline physics step");
        shore_exits += step
            .events
            .iter()
            .filter(|event| event.kind == PhysicsEventKindV1::ShoreExit)
            .count();
        let step_liquid_exits = step
            .events
            .iter()
            .filter(|event| event.kind == PhysicsEventKindV1::LiquidExit)
            .count();
        liquid_exits += step_liquid_exits;
        observed_liquid_exit |= step_liquid_exits > 0;
        if observed_liquid_exit {
            liquid_reentries += step
                .events
                .iter()
                .filter(|event| event.kind == PhysicsEventKindV1::LiquidEnter)
                .count();
        }
        fall_damage_events += step
            .events
            .iter()
            .filter(|event| event.kind == PhysicsEventKindV1::FallDamage)
            .count();
        touched_unknown |= step.contact_flags & PHYSICS_CONTACT_UNKNOWN_BOUNDARY != 0;
        reached_dry_ground_beyond_ledge |= step.contact_flags & PHYSICS_CONTACT_IN_LIQUID == 0
            && step.body.grounded
            && step.body.position.y >= 3.49
            && step.body.position.z < -0.5;
        input.body = step.body.clone();
        result = Some(step);
        if reached_dry_ground_beyond_ledge {
            break;
        }
        input = input.seal();
    }
    ShorelinePhysicsTrace {
        result: result.expect("shoreline trace runs at least one step"),
        shore_exits,
        liquid_exits,
        liquid_reentries,
        fall_damage_events,
        touched_unknown,
        reached_dry_ground_beyond_ledge,
    }
}

#[test]
fn world_window_uses_x_fastest_z_then_y_and_unknown_is_solid() {
    let fixture = fixture::canonical_fixture();
    let window = &fixture.physics.window;
    let origin = window.origin;
    assert_eq!(window.index(origin), Some(0));
    assert_eq!(window.index(origin.offset([1, 0, 0])), Some(1));
    assert_eq!(window.index(origin.offset([0, 0, 1])), Some(window.size[0] as usize));
    assert!(window.is_collision_solid(CellPos::new(10_000, 10_000, 10_000)));
}

#[test]
fn swept_axis_never_tunnels_and_unknown_boundary_fails_closed() {
    let fixture = fixture::canonical_fixture();
    let window = &fixture.physics.window;
    let swept = sweep_body_axis(window, Vec3::new(0.0, 0.51, 1.0), 0.3, 1.8, 0, 8.0, 0.14);
    assert!(swept.blocked);
    assert!(swept.position.x < 2.0);

    let boundary = sweep_body_axis(window, Vec3::new(8.5, 0.51, 8.5), 0.3, 1.8, 0, 8.0, 0.14);
    assert!(boundary.blocked);
    assert!(boundary.unknown_boundary);
}

#[test]
fn body_collision_reports_unknown_regardless_of_solid_scan_order() {
    let mut input = fixture::canonical_fixture().physics;
    let position = Vec3::new(0.0, 0.51, 0.0);
    for (solid_x, unknown_x) in [(-1, 1), (1, -1)] {
        let mut window = input.window.clone();
        for block in &mut window.blocks {
            *block = 0;
        }
        window.loaded_mask.fill(1);
        set_test_block(&mut window, CellPos::new(solid_x, 1, 0), 1);
        let unknown_index = window
            .index(CellPos::new(unknown_x, 1, 0))
            .expect("mixed solid/unknown collision cell is inside the read window");
        window.loaded_mask[unknown_index] = 0;
        reseal_world(&mut window, &mut input.identity);

        let (blocked, unknown_boundary) = collides_body(&window, position, 0.6, 1.8);
        assert!(blocked, "solid cell must keep the capsule blocked");
        assert!(
            unknown_boundary,
            "unknown cell must be reported even when a solid cell is encountered first"
        );
    }
}

#[test]
fn physics_step_is_revision_bound_and_deterministic() {
    let fixture = fixture::canonical_fixture();
    let first = step_physics(&fixture.physics).expect("valid fixture");
    let second = step_physics(&fixture.physics).expect("valid fixture");
    assert_eq!(first, second);
    assert!(identity_is_current(&first.identity, &fixture.physics.window.identity));
    let mut stale = fixture.physics.clone();
    stale.window.identity.revision.mutation += 1;
    stale = stale.seal();
    assert_eq!(step_physics(&stale), Err(ContractError::IdentityMismatch));
}

#[test]
fn physics_sweep_stops_high_velocity_at_wall() {
    let mut fixture = fixture::canonical_fixture().physics;
    fixture.body.position = Vec3::new(0.0, 0.51, 1.0);
    fixture.body.velocity = Vec3::new(200.0, 0.0, 0.0);
    fixture.body.grounded = false;
    fixture.controls = PhysicsControlsV1::default();
    fixture.gravity.gravity = 0.0;
    fixture.gravity.ground_acceleration = 0.0;
    fixture.gravity.air_acceleration = 0.0;
    fixture.fixed_delta_micros = 100_000;
    fixture = fixture.seal();
    let result = step_physics(&fixture).expect("valid fast sweep");
    assert!(result.body.position.x < 2.0);
    assert_eq!(result.body.velocity.x, 0.0);
    assert_ne!(result.contact_flags & PHYSICS_CONTACT_POSITIVE_X, 0);
}

#[test]
fn exact_swim_port_drains_oxygen_and_batches_drowning_damage() {
    let rules = SwimRules::default();
    let state = SwimmerState {
        velocity_y: 0.0,
        oxygen_seconds: 0.25,
        drowning_accumulator: 1.25,
        entry_momentum_speed: 0.0,
        surface_breach_ready: true,
        surface_breach_seconds: 0.0,
        surface_stroke_cooldown_seconds: 0.0,
        surface_bob_active: false,
        shore_exit_ready: true,
    };
    let step = step_swimming(
        state,
        SwimInput::default(),
        SwimEnvironment {
            submersion: 1.0,
            head_submerged: true,
            ..SwimEnvironment::default()
        },
        0.5,
        rules,
    );
    assert_eq!(step.state.oxygen_seconds, 0.0);
    assert_eq!(step.damage, 1.0);
    assert!((step.state.drowning_accumulator - 0.25).abs() < 1.0e-12);
}

#[test]
fn swim_entry_momentum_and_surface_bob_remain_bounded() {
    let rules = SwimRules::default();
    let entry = step_swimming(
        SwimmerState {
            velocity_y: -20.0,
            oxygen_seconds: 12.0,
            drowning_accumulator: 0.0,
            entry_momentum_speed: 0.0,
            surface_breach_ready: true,
            surface_breach_seconds: 0.0,
            surface_stroke_cooldown_seconds: 0.0,
            surface_bob_active: false,
            shore_exit_ready: true,
        },
        SwimInput::default(),
        SwimEnvironment {
            submersion: 1.0,
            entered_from_air: true,
            ..SwimEnvironment::default()
        },
        1.0 / 60.0,
        rules,
    );
    assert!(entry.state.entry_momentum_speed > rules.maximum_sink_speed);
    assert!(entry.state.velocity_y < -rules.maximum_sink_speed);

    let bob = step_swimming(
        SwimmerState {
            velocity_y: -0.2,
            oxygen_seconds: 12.0,
            drowning_accumulator: 0.0,
            entry_momentum_speed: 0.0,
            surface_breach_ready: true,
            surface_breach_seconds: 0.0,
            surface_stroke_cooldown_seconds: 0.0,
            surface_bob_active: false,
            shore_exit_ready: true,
        },
        SwimInput {
            jump_held: true,
            ..SwimInput::default()
        },
        SwimEnvironment {
            submersion: 0.75,
            surface_clearance: Some(0.1),
            ..SwimEnvironment::default()
        },
        1.0 / 60.0,
        rules,
    );
    assert!(bob.state.surface_bob_active);
    assert!(bob.state.velocity_y <= rules.surface_bob_velocity);
    assert!(bob.state.velocity_y > 0.0);
}

#[test]
fn held_shore_exit_survives_contact_oscillation_and_only_rearms_after_release() {
    let rules = SwimRules::default();
    let input = SwimInput {
        jump_held: true,
        moving_forward: true,
        ..SwimInput::default()
    };
    let shore = SwimEnvironment {
        submersion: 0.75,
        head_submerged: false,
        horizontal_collision: true,
        shore_ledge_height: Some(1.0),
        surface_gap: Some(0.3),
        surface_clearance: Some(0.1),
        ..SwimEnvironment::default()
    };
    let mut state = SwimmerState {
        velocity_y: -0.4,
        oxygen_seconds: rules.max_oxygen_seconds,
        drowning_accumulator: 0.0,
        entry_momentum_speed: 0.0,
        surface_breach_ready: true,
        surface_breach_seconds: 0.0,
        surface_stroke_cooldown_seconds: 0.0,
        surface_bob_active: false,
        shore_exit_ready: true,
    };
    let mut boosts = 0;
    let dt = 1.0 / 60.0;

    for index in 0..60 {
        // Reproduce the live shoreline oscillation: collision/head/surface
        // readings can alternate while the same jump press remains held.
        let environment = match index % 4 {
            0 => shore,
            1 => SwimEnvironment {
                horizontal_collision: false,
                head_submerged: true,
                surface_clearance: None,
                ..shore
            },
            2 => SwimEnvironment {
                horizontal_collision: true,
                head_submerged: true,
                surface_clearance: Some(-0.2),
                ..shore
            },
            _ => SwimEnvironment {
                horizontal_collision: false,
                head_submerged: false,
                surface_clearance: Some(0.8),
                ..shore
            },
        };
        let step = step_swimming(state, input, environment, dt, rules);
        boosts += usize::from(step.shore_boosted);
        state = step.state;
    }

    assert_eq!(boosts, 1, "held shore contact must emit exactly one boost cue");
    assert!(
        state.velocity_y < rules.shore_exit_velocity,
        "bounded mantle must stop pinning vertical velocity: {state:?}"
    );
    assert!(!state.shore_exit_ready);

    let recontact = step_swimming(state, input, shore, dt, rules);
    assert!(!recontact.shore_boosted, "contact separation must not re-arm held jump");
    assert!(!recontact.state.shore_exit_ready);

    let released = step_swimming(
        recontact.state,
        SwimInput {
            jump_held: false,
            moving_forward: true,
            ..SwimInput::default()
        },
        shore,
        dt,
        rules,
    );
    assert!(released.state.surface_breach_ready);
    assert!(released.state.shore_exit_ready);
    let repressed = step_swimming(released.state, input, shore, dt, rules);
    assert!(
        repressed.shore_boosted,
        "release and re-press must start a new shore attempt"
    );

    assert!(!repressed.state.shore_exit_ready);
}

#[test]
fn shore_mantle_sustain_is_bounded_and_release_semantics_remain_one_shot() {
    let rules = SwimRules::default();
    let shore = SwimEnvironment {
        submersion: 0.6,
        head_submerged: false,
        horizontal_collision: true,
        shore_ledge_height: Some(1.0),
        surface_gap: Some(0.0),
        surface_clearance: Some(0.1),
        ..SwimEnvironment::default()
    };
    let held = SwimInput {
        jump_held: true,
        moving_forward: true,
        ..SwimInput::default()
    };
    let initial = SwimmerState {
        velocity_y: 0.0,
        oxygen_seconds: rules.max_oxygen_seconds,
        drowning_accumulator: 0.0,
        entry_momentum_speed: 0.0,
        surface_breach_ready: true,
        surface_breach_seconds: 0.0,
        surface_stroke_cooldown_seconds: 0.0,
        surface_bob_active: false,
        shore_exit_ready: true,
    };
    let qualified = step_swimming(initial, held, shore, 0.05, rules);
    assert!(qualified.shore_boosted);
    assert!(!qualified.state.shore_exit_ready);
    assert_eq!(qualified.state.surface_breach_seconds, SHORE_MANTLE_SUSTAIN_SECONDS);
    assert_eq!(qualified.state.surface_stroke_cooldown_seconds, 0.0);
    assert!(!qualified.state.surface_bob_active);

    let sustained = step_swimming(qualified.state, held, shore, 0.05, rules);
    assert!(!sustained.shore_boosted);
    assert_eq!(sustained.state.velocity_y, rules.shore_exit_velocity);
    assert!((sustained.state.surface_breach_seconds - 0.15).abs() <= 1.0e-12);

    let dry = step_swimming(sustained.state, held, SwimEnvironment::default(), 0.05, rules);
    assert_eq!(dry.state.surface_breach_seconds, 0.0);
    assert_eq!(dry.state.surface_stroke_cooldown_seconds, 0.0);
    assert!(!dry.state.surface_bob_active);
    assert!(!dry.state.shore_exit_ready);

    let forward_released = step_swimming(
        sustained.state,
        SwimInput {
            jump_held: true,
            moving_forward: false,
            ..SwimInput::default()
        },
        shore,
        0.05,
        rules,
    );
    assert!(!forward_released.shore_boosted);
    assert_eq!(forward_released.state.surface_breach_seconds, 0.0);
    assert!(!forward_released.state.shore_exit_ready);

    let same_press = step_swimming(forward_released.state, held, shore, 0.05, rules);
    assert!(!same_press.shore_boosted);
    assert_eq!(same_press.state.surface_breach_seconds, 0.0);
    assert!(!same_press.state.shore_exit_ready);

    let jump_released = step_swimming(
        same_press.state,
        SwimInput {
            jump_held: false,
            moving_forward: true,
            ..SwimInput::default()
        },
        shore,
        0.05,
        rules,
    );
    assert!(jump_released.state.shore_exit_ready);
    assert_eq!(jump_released.state.surface_breach_seconds, 0.0);
    assert!(step_swimming(jump_released.state, held, shore, 0.05, rules).shore_boosted);
}

#[test]
fn one_block_shore_exit_is_single_and_reaches_dry_ground_under_held_input() {
    let input = shoreline_physics_fixture(3, false);
    let trace = advance_shoreline_fixture(input.clone(), 120);
    assert_eq!(
        trace.shore_exits, 1,
        "one held shore attempt must emit exactly one exit cue"
    );
    assert_eq!(trace.liquid_exits, 1, "the mantle must leave liquid exactly once");
    assert_eq!(
        trace.liquid_reentries, 0,
        "the accepted mantle must not fall back into liquid"
    );
    assert_eq!(trace.fall_damage_events, 0);
    assert!(!trace.touched_unknown);
    assert!(
        trace.reached_dry_ground_beyond_ledge,
        "the accepted one-block-above-water ledge must be physically traversed: {trace:?}"
    );
    assert_eq!(trace.result.body.swim_surface_breach_seconds, 0.0);
    assert_eq!(trace.result.body.swim_stroke_cooldown_seconds, 0.0);
    assert!(!trace.result.body.swim_surface_bob_active);
    assert!(!trace.result.body.swim_shore_exit_ready);

    let mut neutral = input;
    neutral.body = trace.result.body;
    neutral.controls = PhysicsControlsV1::default();
    for _ in 0..12 {
        neutral = neutral.seal();
        let settled = step_physics(&neutral).expect("neutral post-mantle step");
        assert_eq!(settled.contact_flags & PHYSICS_CONTACT_IN_LIQUID, 0);
        assert_eq!(settled.contact_flags & PHYSICS_CONTACT_UNKNOWN_BOUNDARY, 0);
        assert!(settled.events.iter().all(|event| {
            !matches!(
                event.kind,
                PhysicsEventKindV1::ShoreExit | PhysicsEventKindV1::LiquidEnter | PhysicsEventKindV1::FallDamage
            )
        }));
        neutral.body = settled.body;
    }
    assert!(neutral.body.grounded);
    assert!(neutral.body.position.y >= 3.49);
    assert!(neutral.body.swim_shore_exit_ready);
}

#[test]
fn tall_underwater_wall_is_not_a_shore_ledge() {
    let trace = advance_shoreline_fixture(shoreline_physics_fixture(4, false), 80);
    assert_eq!(
        trace.shore_exits, 0,
        "a two-block-above-water cliff must never emit a shore-exit cue"
    );
    assert!(!trace.reached_dry_ground_beyond_ledge);
    assert!(
        trace.result.body.position.z > -0.5,
        "the solid cliff must remain authoritative"
    );
}

#[test]
fn unknown_elevated_clearance_fails_closed_for_shore_exit() {
    let trace = advance_shoreline_fixture(shoreline_physics_fixture(3, true), 80);
    assert_eq!(
        trace.shore_exits, 0,
        "unknown target headroom must not qualify as a ledge"
    );
    assert!(!trace.reached_dry_ground_beyond_ledge);
    assert!(
        trace.result.body.position.z > -0.5,
        "unknown clearance must keep the body blocked"
    );
}

#[test]
fn deep_or_head_submerged_contact_cannot_start_a_shore_exit() {
    let mut input = shoreline_physics_fixture(4, false);
    for z in 0..=3 {
        for x in -1..=1 {
            set_test_water(&mut input.window, CellPos::new(x, 3, z));
        }
    }
    reseal_world(&mut input.window, &mut input.identity);
    input.body.position.y = 0.51;
    input = input.seal();
    let result = step_physics(&input).expect("deep forward bank contact");
    assert_ne!(result.contact_flags & PHYSICS_CONTACT_IN_LIQUID, 0);
    assert_ne!(result.contact_flags & PHYSICS_CONTACT_HEAD_SUBMERGED, 0);
    assert!(
        result
            .events
            .iter()
            .all(|event| event.kind != PhysicsEventKindV1::ShoreExit)
    );
}

#[test]
fn dry_forward_wall_cannot_start_a_shore_exit() {
    let mut input = shoreline_physics_fixture(3, false);
    input.window.liquid_kind.fill(LiquidKindV1::None as u8);
    input.window.liquid_level.fill(0);
    input.window.flags.fill(0);
    reseal_world(&mut input.window, &mut input.identity);
    input = input.seal();
    let result = step_physics(&input).expect("dry forward wall contact");
    assert_eq!(result.contact_flags & PHYSICS_CONTACT_IN_LIQUID, 0);
    assert!(
        result
            .events
            .iter()
            .all(|event| event.kind != PhysicsEventKindV1::ShoreExit)
    );
}

#[test]
fn liquid_entry_clears_air_fall_distance_without_masking_later_dry_falls() {
    let mut entering = fixture::canonical_fixture().physics;
    entering.body.position = Vec3::new(3.0, 2.0, 3.0);
    entering.body.velocity = Vec3::new(0.0, -10.0, 0.0);
    entering.body.grounded = false;
    entering.body.fall_distance = 6.6;
    entering.controls = PhysicsControlsV1::default();
    entering.gravity.gravity = 0.0;
    entering.gravity.air_drag = 0.0;
    entering.gravity.ground_acceleration = 0.0;
    entering.gravity.air_acceleration = 0.0;
    entering.fixed_delta_micros = 100_000;
    entering = entering.seal();
    let entered = step_physics(&entering).expect("air-to-liquid step");
    assert_ne!(entered.contact_flags & PHYSICS_CONTACT_IN_LIQUID, 0);
    assert_eq!(entered.body.fall_distance, 0.0);
    assert!(
        entered
            .events
            .iter()
            .any(|event| event.kind == PhysicsEventKindV1::LiquidEnter)
    );
    assert!(
        entered
            .events
            .iter()
            .all(|event| !matches!(event.kind, PhysicsEventKindV1::Land | PhysicsEventKindV1::FallDamage))
    );

    let mut occupying = fixture::canonical_fixture().physics;
    occupying.body.position = Vec3::new(3.0, 0.51, 3.0);
    occupying.body.velocity = Vec3::new(0.0, -1.0, 0.0);
    occupying.body.grounded = false;
    occupying.body.fall_distance = 6.6;
    occupying.controls = PhysicsControlsV1::default();
    occupying = occupying.seal();
    let occupied = step_physics(&occupying).expect("stale fall distance while occupying liquid");
    assert_ne!(occupied.contact_flags & PHYSICS_CONTACT_IN_LIQUID, 0);
    assert_eq!(occupied.body.fall_distance, 0.0);
    assert!(
        occupied
            .events
            .iter()
            .all(|event| !matches!(event.kind, PhysicsEventKindV1::Land | PhysicsEventKindV1::FallDamage))
    );

    let mut shore_landing = fixture::canonical_fixture().physics;
    shore_landing.body = entered.body;
    shore_landing.body.position = Vec3::new(0.0, 0.51, 1.0);
    shore_landing.body.velocity = Vec3::new(0.0, -1.0, 0.0);
    shore_landing.body.grounded = false;
    shore_landing.controls = PhysicsControlsV1::default();
    shore_landing.swimming.enabled = false;
    shore_landing = shore_landing.seal();
    let landed = step_physics(&shore_landing).expect("dry shore landing after liquid entry");
    assert!(landed.body.grounded);
    assert_eq!(landed.body.fall_distance, 0.0);
    assert!(landed.events.iter().any(|event| event.kind == PhysicsEventKindV1::Land));
    assert!(
        landed
            .events
            .iter()
            .all(|event| event.kind != PhysicsEventKindV1::FallDamage)
    );

    let mut dry_fall = fixture::canonical_fixture().physics;
    dry_fall.body.position = Vec3::new(0.0, 0.51, 1.0);
    dry_fall.body.velocity = Vec3::new(0.0, -1.0, 0.0);
    dry_fall.body.grounded = false;
    dry_fall.body.fall_distance = 6.6;
    dry_fall.controls = PhysicsControlsV1::default();
    dry_fall.swimming.enabled = false;
    dry_fall = dry_fall.seal();
    let dry_landing = step_physics(&dry_fall).expect("genuine dry landing");
    assert!(
        dry_landing
            .events
            .iter()
            .any(|event| { event.kind == PhysicsEventKindV1::FallDamage && (event.amount - 3.0).abs() < f64::EPSILON })
    );
}

#[test]
fn dry_jump_release_rearms_consumed_shore_exit_latch() {
    let mut input = fixture::canonical_fixture().physics;
    input.body.swim_shore_exit_ready = false;
    input.body.position = Vec3::new(0.0, 0.51, 1.0);
    input.controls = PhysicsControlsV1::default();
    input = input.seal();
    let result = step_physics(&input).expect("dry released-jump step");
    assert!(result.body.swim_shore_exit_ready);
}

#[test]
fn liquid_frontier_is_fifo_bounded_and_defers_new_work() {
    let mut job = fixture::canonical_fixture().liquid;
    let source = CellPos::new(7, 1, 7);
    let index = job.window.index(source).expect("source in fixture");
    job.window.liquid_kind[index] = LiquidKindV1::Water as u8;
    job.window.liquid_level[index] = 0;
    job.window.flags[index] = WORLD_CELL_LIQUID_SOURCE;
    job.frontier = vec![source];
    job.operation_budget = 1;
    reseal_world(&mut job.window, &mut job.identity);
    job = job.seal();
    let result = step_liquid_frontier(&job).expect("valid liquid job");
    assert_eq!(result.operations, 1);
    assert_eq!(result.changes.len(), 4);
    assert!(
        result
            .changes
            .iter()
            .all(|change| change.next.is_some_and(|cell| cell.level == 1))
    );
    assert!(!result.remaining_frontier.is_empty());
    assert_eq!(result, step_liquid_frontier(&job).expect("repeat liquid job"));
}

#[test]
fn source_overflow_includes_one_stable_falling_column() {
    let mut job = fixture::canonical_fixture().liquid;
    let source = CellPos::new(7, 4, 7);
    let index = job.window.index(source).expect("source in fixture");
    job.window.liquid_kind[index] = LiquidKindV1::Water as u8;
    job.window.flags[index] = WORLD_CELL_LIQUID_SOURCE;
    job.frontier = vec![source];
    job.operation_budget = 1;
    reseal_world(&mut job.window, &mut job.identity);
    job = job.seal();
    let result = step_liquid_frontier(&job).expect("valid falling liquid");
    assert_eq!(result.changes.len(), 5);
    let downward = result
        .changes
        .iter()
        .find(|change| change.position == CellPos::new(7, 3, 7));
    assert!(downward.is_some_and(|change| change.next.is_some_and(|cell| cell.falling)));
}

#[test]
fn path_ties_follow_cardinal_then_elevation_order() {
    let fixture = fixture::canonical_fixture();
    let result = find_path(&fixture.path).expect("valid path");
    assert_eq!(result.code, PathResultCodeV1::Found);
    assert_eq!(result.cells.first(), Some(&CellPos::new(2, 1, 1)));
    assert_eq!(result, find_path(&fixture.path).expect("repeat path"));
}

#[test]
fn path_unknown_and_budget_states_are_explicit() {
    let mut unloaded = fixture::canonical_fixture().path;
    let goal = canonical_path_cell(unloaded.goal);
    let index = unloaded.occupancy.index(goal).expect("goal in range");
    unloaded.occupancy.cells[index] &= !PATH_CELL_LOADED;
    unloaded = unloaded.seal();
    assert_eq!(
        find_path(&unloaded).expect("valid unloaded job").code,
        PathResultCodeV1::Unloaded
    );

    let mut bounded = fixture::canonical_fixture().path;
    bounded.maximum_nodes = 1;
    bounded = bounded.seal();
    let result = find_path(&bounded).expect("valid bounded path");
    assert_eq!(result.code, PathResultCodeV1::BudgetExhausted);
    assert_eq!(result.visited, 1);
}

fn canonical_path_cell(value: Vec3) -> CellPos {
    CellPos::new(
        (value.x + 0.5).floor() as i32,
        (value.y + 0.5).floor() as i32,
        (value.z + 0.5).floor() as i32,
    )
}

#[test]
fn air_topology_counts_vents_and_seals_closed_room() {
    let job = fixture::canonical_fixture().air;
    let result = solve_air_zones(&job).expect("valid air job");
    assert_eq!(result.zones.len(), 1);
    assert_eq!(result.zones[0].cell_count, 27);
    assert_eq!(result.zones[0].vent_count, 1);
    assert!(result.zones[0].sealed);
    assert_eq!(result, solve_air_zones(&job).expect("repeat air job"));
}

#[test]
fn air_unknown_boundary_leaks_and_budget_is_hard() {
    let mut leaking = fixture::canonical_fixture().air;
    let opening = leaking.index(CellPos::new(0, 2, 2)).expect("opening in range");
    leaking.cells[opening] = AIR_CELL_LOADED | AIR_CELL_TRAVERSABLE_GAS;
    leaking = leaking.seal();
    let result = solve_air_zones(&leaking).expect("valid leak topology");
    assert!(
        result
            .zones
            .iter()
            .any(|zone| zone.leak_faces & AIR_LEAK_UNKNOWN_BOUNDARY != 0 && !zone.sealed)
    );

    let mut bounded = fixture::canonical_fixture().air;
    bounded.maximum_visited_cells = 3;
    bounded = bounded.seal();
    let result = solve_air_zones(&bounded).expect("valid bounded air topology");
    assert!(result.budget_exhausted);
    assert_eq!(result.visited_cells, 3);
    assert!(!result.zones[0].sealed);
}

#[test]
fn projectile_sweep_is_continuous_and_ties_are_stable() {
    let projectile = ProjectileSweepV1 {
        projectile_id: 9,
        origin: Vec3::new(0.0, 0.0, 0.0),
        displacement: Vec3::new(20.0, 0.0, 0.0),
        radius: 0.1,
    };
    let targets = [
        SweepTargetV1 {
            target_id: 8,
            bounds: AabbV1::new(Vec3::new(5.0, -1.0, -1.0), Vec3::new(6.0, 1.0, 1.0)),
        },
        SweepTargetV1 {
            target_id: 2,
            bounds: AabbV1::new(Vec3::new(5.0, -1.0, -1.0), Vec3::new(6.0, 1.0, 1.0)),
        },
    ];
    let hit = sweep_projectile_batch(&[projectile], &targets)[0];
    assert_eq!(hit.target_id, 2);
    assert!(hit.hit.time > 0.0 && hit.hit.time < 1.0);
    assert_eq!(hit.hit.normal, Vec3::new(-1.0, 0.0, 0.0));
}

#[test]
fn projectile_sweep_property_keeps_hits_inside_expanded_bounds() {
    let target = SweepTargetV1 {
        target_id: 4,
        bounds: AabbV1::new(Vec3::new(-1.0, -2.0, -3.0), Vec3::new(2.0, 3.0, 4.0)),
    };
    let mut seed = 0x91e1_0da5_u32;
    for projectile_id in 0..256_u64 {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        let y = f64::from(seed & 0xff) / 255.0 * 4.0 - 1.0;
        let z = f64::from(seed >> 8 & 0xff) / 255.0 * 6.0 - 2.0;
        let projectile = ProjectileSweepV1 {
            projectile_id,
            origin: Vec3::new(-12.0, y, z),
            displacement: Vec3::new(28.0, 0.0, 0.0),
            radius: 0.15,
        };
        let hit = sweep_projectile_batch(&[projectile], &[target])[0];
        let expanded = target.bounds.expanded(Vec3::new(0.15, 0.15, 0.15));
        assert!((0.0..=1.0).contains(&hit.hit.time));
        assert!(hit.hit.point.x >= expanded.minimum.x - 1.0e-9 && hit.hit.point.x <= expanded.maximum.x + 1.0e-9);
        assert!(hit.hit.point.y >= expanded.minimum.y - 1.0e-9 && hit.hit.point.y <= expanded.maximum.y + 1.0e-9);
        assert!(hit.hit.point.z >= expanded.minimum.z - 1.0e-9 && hit.hit.point.z <= expanded.maximum.z + 1.0e-9);
    }
}

#[test]
fn action_raycast_uses_exact_dda_normal_and_never_tunnels() {
    let mut window = fixture::canonical_fixture().physics.window;
    let cell = CellPos::new(4, 2, 1);
    let index = window.index(cell).expect("action target is inside fixture window");
    window.blocks[index] = 7;
    window = window.seal();
    let result = raycast_action_target(
        &window,
        VoxelRaycastQueryV1 {
            query_id: 41,
            origin: Vec3::new(-1.25, 2.0, 1.0),
            direction: Vec3::new(1.0, 0.0, 0.0),
            maximum_distance: 12.0,
            maximum_visited_cells: 64,
            hit_liquids: false,
        },
        &[],
    )
    .expect("bounded action ray");
    let Some(ActionRayTargetV1::Voxel(hit)) = result.target else {
        panic!("solid voxel should be selected");
    };
    assert_eq!(hit.kind, VoxelRayHitKindV1::Solid);
    assert_eq!(hit.cell, cell);
    assert_eq!(hit.normal, Vec3::new(-1.0, 0.0, 0.0));
    assert_eq!(hit.point, Vec3::new(3.5, 2.0, 1.0));
    assert!(!result.budget_exhausted);
}

#[test]
fn action_raycast_entity_order_is_stable_and_voxels_occlude() {
    let mut window = fixture::canonical_fixture().physics.window;
    let wall = CellPos::new(5, 2, 1);
    let index = window.index(wall).expect("wall is inside fixture window");
    window.blocks[index] = 9;
    window = window.seal();
    let query = VoxelRaycastQueryV1 {
        query_id: 42,
        origin: Vec3::new(-1.0, 2.0, 1.0),
        direction: Vec3::new(1.0, 0.0, 0.0),
        maximum_distance: 12.0,
        maximum_visited_cells: 64,
        hit_liquids: false,
    };
    let shared = AabbV1::new(Vec3::new(2.0, 1.5, 0.5), Vec3::new(3.0, 2.5, 1.5));
    let behind = AabbV1::new(Vec3::new(7.0, 1.5, 0.5), Vec3::new(8.0, 2.5, 1.5));
    let targets = [
        ActionRayEntityTargetV1 {
            entity_id: 9,
            bounds: behind,
        },
        ActionRayEntityTargetV1 {
            entity_id: 8,
            bounds: shared,
        },
        ActionRayEntityTargetV1 {
            entity_id: 2,
            bounds: shared,
        },
    ];
    let result = raycast_action_target(&window, query, &targets).expect("valid entity page");
    assert!(matches!(
        result.target,
        Some(ActionRayTargetV1::Entity { entity_id: 2, distance, .. }) if distance == 3.0
    ));

    let only_behind = raycast_action_target(&window, query, &targets[..1]).expect("valid occluded entity");
    assert!(matches!(
        only_behind.target,
        Some(ActionRayTargetV1::Voxel(VoxelRayHitV1 { cell, .. })) if cell == wall
    ));
}

#[test]
fn action_raycast_unknown_boundary_and_caps_fail_closed() {
    let mut window = fixture::canonical_fixture().physics.window;
    let boundary = CellPos::new(4, 2, 1);
    let index = window.index(boundary).expect("boundary is inside fixture window");
    window.loaded_mask[index] = 0;
    window = window.seal();
    let query = VoxelRaycastQueryV1 {
        query_id: 43,
        origin: Vec3::new(-1.0, 2.0, 1.0),
        direction: Vec3::new(1.0, 0.0, 0.0),
        maximum_distance: 12.0,
        maximum_visited_cells: 64,
        hit_liquids: false,
    };
    let result = raycast_action_target(&window, query, &[]).expect("unknown boundary is a result");
    assert!(matches!(
        result.target,
        Some(ActionRayTargetV1::Voxel(VoxelRayHitV1 {
            kind: VoxelRayHitKindV1::UnknownBoundary,
            cell,
            ..
        })) if cell == boundary
    ));

    let duplicate = ActionRayEntityTargetV1 {
        entity_id: 7,
        bounds: AabbV1::new(Vec3::new(1.0, 1.0, 1.0), Vec3::new(2.0, 2.0, 2.0)),
    };
    assert_eq!(
        raycast_action_target(&window, query, &[duplicate, duplicate]),
        Err(ContractError::InvalidFlags)
    );
}

#[test]
fn camera_pose_matches_first_rear_front_and_collision_contracts() {
    let mut window = fixture::canonical_fixture().physics.window;
    let wall = CellPos::new(0, 2, 3);
    let index = window.index(wall).expect("rear-camera wall is inside fixture window");
    window.blocks[index] = 8;
    window = window.seal();
    let base = CameraPoseInputV1 {
        body_position: Vec3::new(0.0, 0.5, 1.0),
        look_yaw: 0.0,
        look_pitch: 0.0,
        mode: CameraModeV1::FirstPerson,
        aiming: false,
        viewport: [1_280, 720],
        profile: CameraProfileV1 {
            third_person_distance: 2.0,
            ..CameraProfileV1::default()
        },
    };
    let first = derive_camera_pose_v1(None, base).expect("first-person needs no collision window");
    assert_eq!(first.position, Vec3::new(0.0, 2.12, 1.0));
    assert_eq!(first.orientation, [0.0, 0.0, -0.0, 1.0]);
    assert!(!first.collided);

    let rear = derive_camera_pose_v1(
        Some(&window),
        CameraPoseInputV1 {
            mode: CameraModeV1::ThirdRear,
            ..base
        },
    )
    .expect("rear camera");
    assert!(rear.collided);
    assert!(rear.position.z < 3.0 && rear.position.z > 1.0);
    assert_eq!(rear.viewport, [1_280, 720]);

    let front = derive_camera_pose_v1(
        Some(&window),
        CameraPoseInputV1 {
            mode: CameraModeV1::ThirdFront,
            aiming: true,
            ..base
        },
    )
    .expect("front camera");
    assert!(!front.collided);
    assert!(front.position.z < base.body_position.z);
    assert_eq!(front.vertical_fov_radians, base.profile.aim_vertical_fov_radians);
    assert_ne!(front.pose_hash, first.pose_hash);
}

#[test]
fn camera_pose_fails_closed_on_missing_window_unknown_cells_and_hostile_viewport() {
    let base = CameraPoseInputV1 {
        body_position: Vec3::new(0.0, 0.5, 1.0),
        look_yaw: 0.0,
        look_pitch: 0.0,
        mode: CameraModeV1::ThirdRear,
        aiming: false,
        viewport: [800, 600],
        profile: CameraProfileV1::default(),
    };
    assert_eq!(derive_camera_pose_v1(None, base), Err(ContractError::InvalidFlags));
    let mut window = fixture::canonical_fixture().physics.window;
    let unknown = CellPos::new(0, 2, 2);
    let index = window.index(unknown).expect("unknown camera cell in range");
    window.loaded_mask[index] = 0;
    window = window.seal();
    let blocked = derive_camera_pose_v1(Some(&window), base).expect("unknown boundary is collision");
    assert!(blocked.collided);
    assert!(blocked.resolved_distance < 1.0);
    assert_eq!(
        derive_camera_pose_v1(
            Some(&window),
            CameraPoseInputV1 {
                viewport: [0, CAMERA_MAX_VIEWPORT_V1 + 1],
                ..base
            }
        ),
        Err(ContractError::InvalidNumber)
    );
}

#[test]
fn camera_pose_zero_distance_collision_has_canonical_finite_orientation() {
    let base = CameraPoseInputV1 {
        body_position: Vec3::new(0.0, 0.5, 1.0),
        look_yaw: 0.37,
        look_pitch: -0.21,
        mode: CameraModeV1::ThirdRear,
        aiming: false,
        viewport: [800, 600],
        profile: CameraProfileV1::default(),
    };
    let mut window = fixture::canonical_fixture().physics.window;
    let target_cell = CellPos::new(0, 2, 1);
    let index = window
        .index(target_cell)
        .expect("camera target is inside fixture window");
    window.loaded_mask[index] = 0;
    window = window.seal();

    let first = derive_camera_pose_v1(Some(&window), base).expect("origin collision remains a pose");
    let second = derive_camera_pose_v1(Some(&window), base).expect("origin collision is deterministic");
    assert!(first.collided);
    assert_eq!(first.resolved_distance, 0.0);
    assert_eq!(first, second);
    assert!(
        [
            first.position.x,
            first.position.y,
            first.position.z,
            first.orientation[0],
            first.orientation[1],
            first.orientation[2],
            first.orientation[3],
            first.vertical_fov_radians,
            first.near,
            first.far,
            first.resolved_distance,
        ]
        .into_iter()
        .all(f64::is_finite)
    );
    let orientation_length_squared = first.orientation.into_iter().map(|value| value * value).sum::<f64>();
    assert!((orientation_length_squared - 1.0).abs() <= 1.0e-12);
}

#[test]
fn swept_axis_property_never_commits_a_colliding_body() {
    let fixture = fixture::canonical_fixture();
    for index in 0..160_u32 {
        let angle = f64::from(index) * 0.618_033_988_749_894_8;
        let origin = Vec3::new(angle.sin() * 1.2, 0.51, 1.0 + angle.cos() * 1.2);
        let distance = (f64::from(index % 17) - 8.0) * 0.71;
        let axis = usize::try_from(index % 3).expect("axis is in 0..3");
        let result = sweep_body_axis(&fixture.physics.window, origin, 0.3, 1.8, axis, distance, 0.14);
        assert!(!collides_body(&fixture.physics.window, result.position, 0.3, 1.8).0);
    }
}

#[test]
fn mount_profiles_are_deterministic_and_gravity_scales() {
    let control = MountControlV1 {
        forward: 1.0,
        sprinting: true,
        ..MountControlV1::default()
    };
    let profile = MountProfileV1::ground(0.8, 1.6, 4.0);
    let low_gravity = GravityProfileV1::scaled(0.25);
    let first = step_mount_velocity(Vec3::default(), control, profile, low_gravity, 1.0 / 60.0);
    let second = step_mount_velocity(Vec3::default(), control, profile, low_gravity, 1.0 / 60.0);
    assert_eq!(first, second);
    assert!(first.z < 0.0);
    assert!(GravityProfileV1::scaled(0.25).jump_velocity > GravityProfileV1::default().jump_velocity);
}

#[test]
fn canonical_fixture_hashes_and_native_hook_are_stable() {
    let fixture = fixture::canonical_fixture();
    let parity_fixture = include_str!("../../../../tests/fixtures/rust-engine/r5/simulation-input-hashes.json");
    for hash in [
        fixture.physics.input_hash,
        fixture.liquid.input_hash,
        fixture.path.input_hash,
        fixture.air.input_hash,
    ] {
        assert!(parity_fixture.contains(&hash.to_hex()));
    }
    let hashes = [
        step_physics(&fixture.physics).expect("physics").result_hash,
        step_liquid_frontier(&fixture.liquid).expect("liquid").result_hash,
        find_path(&fixture.path).expect("path").result_hash,
        solve_air_zones(&fixture.air).expect("air").result_hash,
    ];
    assert!(hashes.iter().all(|hash| *hash != CanonicalHash::default()));
    #[cfg(not(target_arch = "wasm32"))]
    {
        let benchmark = fixture::run_native_benchmark(2);
        assert_eq!(benchmark.iterations, 2);
        assert!(benchmark.physics_micros + benchmark.liquid_micros + benchmark.path_micros + benchmark.air_micros > 0);
    }
}
