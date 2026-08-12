use blockwild_types::CanonicalHash;

use super::*;

fn reseal_world(window: &mut WorldReadWindowV1, identity: &mut SimulationJobIdentityV1) {
    window.snapshot_hash = crate::contract::hash_world_window(window);
    identity.source_snapshot_hash = window.snapshot_hash;
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
