use blockwild_simulation::*;
use blockwild_types::CanonicalHash;

fn world(origin: CellPos, size: [u32; 3]) -> WorldReadWindowV1 {
    let address = WorldAddressV1 {
        universe_id: "golden".into(),
        location_id: "r5".into(),
    };
    let identity = WorldIdentityV1 {
        address: address.clone(),
        revision: WorldRevisionV1 {
            epoch: 1,
            mutation: 8,
            residency: 13,
        },
        state_hash: CanonicalHash([0x55; 16]),
    };
    let count = size.iter().map(|value| *value as usize).product();
    WorldReadWindowV1 {
        address,
        origin,
        size,
        identity,
        loaded_mask: vec![1; count],
        boundary: vec![0; count],
        blocks: vec![0; count],
        facing: vec![0; count],
        liquid_kind: vec![0; count],
        liquid_level: vec![0; count],
        flags: vec![0; count],
        snapshot_hash: CanonicalHash::default(),
    }
}

fn set_block(window: &mut WorldReadWindowV1, position: CellPos, block: u16) {
    let index = window.index(position).expect("golden position");
    window.blocks[index] = block;
}

fn main() {
    println!("{{\"schemaVersion\":2,\"fixture\":\"r5-completion-golden\"}}");
    for hz in [30_u32, 60, 120] {
        let dt = 1.0 / f64::from(hz);
        let mut position = Vec3::new(-16.25, 40.0, 0.5);
        let mut velocity = Vec3::default();
        for _ in 0..hz {
            velocity = step_creative_flight_velocity(
                velocity,
                CreativeFlightControlV1 {
                    forward: 1.0,
                    strafe: 0.25,
                    yaw: 0.35,
                    ascend: true,
                    descend: false,
                    sprinting: true,
                    movement_multiplier: 1.0,
                },
                dt,
            );
            position = position + velocity * dt;
        }
        println!(
            "{{\"scenario\":\"flight-replay\",\"hz\":{hz},\"position\":[{:.12},{:.12},{:.12}],\"velocity\":[{:.12},{:.12},{:.12}]}}",
            position.x, position.y, position.z, velocity.x, velocity.y, velocity.z
        );
    }

    let hit = apply_legacy_player_knockback(KnockbackInputV1 {
        velocity: Vec3::new(0.2, -0.4, 0.1),
        player_position: Vec3::new(-16.0, 1.0, 0.0),
        origin: Vec3::new(-17.0, 1.0, 0.0),
        yaw: 0.0,
        strength: 2.35,
        swimming: false,
        grounded: true,
        restrained: false,
    });
    println!(
        "{{\"scenario\":\"hit-hop\",\"speed\":{:.12},\"velocity\":[{:.12},{:.12},{:.12}],\"grounded\":{}}}",
        hit.applied_speed, hit.velocity.x, hit.velocity.y, hit.velocity.z, hit.grounded
    );

    let swim_input = SwimInput {
        jump_held: true,
        moving_forward: true,
        crouching: false,
        sprinting: true,
    };
    let shore_environment = SwimEnvironment {
        submersion: 0.68,
        head_submerged: false,
        horizontal_collision: true,
        shore_ledge_height: Some(1.0),
        surface_gap: Some(0.72),
        surface_clearance: Some(0.1),
        entered_from_air: false,
    };
    let swim_dt = 1.0 / 60.0;
    let swim_rules = SwimRules::default();
    let swim = step_swimming(
        SwimmerState {
            velocity_y: 0.0,
            oxygen_seconds: 12.0,
            drowning_accumulator: 0.0,
            entry_momentum_speed: 0.0,
            surface_breach_ready: true,
            surface_breach_seconds: 0.0,
            surface_stroke_cooldown_seconds: 0.0,
            surface_bob_active: false,
            shore_exit_ready: true,
        },
        swim_input,
        shore_environment,
        swim_dt,
        swim_rules,
    );
    println!(
        "{{\"scenario\":\"shore-exit\",\"velocityY\":{:.12},\"shoreBoosted\":{},\"oxygen\":{:.12},\"drowningAccumulator\":{:.12},\"entryMomentumSpeed\":{:.12},\"surfaceBreachReady\":{},\"shoreExitReady\":{},\"surfaceBreachSeconds\":{:.12},\"surfaceStrokeCooldownSeconds\":{:.12},\"surfaceBobActive\":{},\"damage\":{:.12},\"horizontalSpeedScale\":{:.12}}}",
        swim.state.velocity_y,
        swim.shore_boosted,
        swim.state.oxygen_seconds,
        swim.state.drowning_accumulator,
        swim.state.entry_momentum_speed,
        swim.state.surface_breach_ready,
        swim.state.shore_exit_ready,
        swim.state.surface_breach_seconds,
        swim.state.surface_stroke_cooldown_seconds,
        swim.state.surface_bob_active,
        swim.damage,
        swim.horizontal_speed_scale
    );
    let sustained = step_swimming(
        swim.state,
        swim_input,
        SwimEnvironment {
            horizontal_collision: false,
            shore_ledge_height: None,
            ..shore_environment
        },
        swim_dt,
        swim_rules,
    );
    println!(
        "{{\"scenario\":\"shore-exit-sustain\",\"velocityY\":{:.12},\"shoreBoosted\":{},\"oxygen\":{:.12},\"drowningAccumulator\":{:.12},\"entryMomentumSpeed\":{:.12},\"surfaceBreachReady\":{},\"shoreExitReady\":{},\"surfaceBreachSeconds\":{:.12},\"surfaceStrokeCooldownSeconds\":{:.12},\"surfaceBobActive\":{},\"damage\":{:.12},\"horizontalSpeedScale\":{:.12}}}",
        sustained.state.velocity_y,
        sustained.shore_boosted,
        sustained.state.oxygen_seconds,
        sustained.state.drowning_accumulator,
        sustained.state.entry_momentum_speed,
        sustained.state.surface_breach_ready,
        sustained.state.shore_exit_ready,
        sustained.state.surface_breach_seconds,
        sustained.state.surface_stroke_cooldown_seconds,
        sustained.state.surface_bob_active,
        sustained.damage,
        sustained.horizontal_speed_scale
    );

    let current_boat = SailboatKinematicsV1 {
        position: Vec3::new(-16.25, 32.5, 0.0),
        yaw: 0.25,
        velocity: 1.2,
    };
    let boat_candidate = sailboat_candidate(
        current_boat,
        SailboatControlV1 {
            forward: 1.0,
            turn: -0.4,
        },
        0.05,
    );
    let boat = commit_sailboat_candidate(
        current_boat,
        boat_candidate,
        SailboatWaterSamplesV1 {
            center: true,
            bow: true,
            stern: true,
        },
    );
    println!(
        "{{\"scenario\":\"boat\",\"position\":[{:.12},{:.12},{:.12}],\"yaw\":{:.12},\"velocity\":{:.12}}}",
        boat.position.x, boat.position.y, boat.position.z, boat.yaw, boat.velocity
    );

    let mut collision_world = world(CellPos::new(-18, -1, -3), [12, 6, 8]);
    for z in -3..5 {
        for x in -18..-6 {
            set_block(&mut collision_world, CellPos::new(x, 0, z), 1);
        }
    }
    set_block(&mut collision_world, CellPos::new(-15, 1, 0), 4);
    set_block(&mut collision_world, CellPos::new(-13, 1, 0), 5);
    set_block(&mut collision_world, CellPos::new(-11, 1, 0), 6);
    collision_world = collision_world.seal();
    let ray = raycast_voxels(
        &collision_world,
        VoxelRaycastQueryV1 {
            query_id: 1,
            origin: Vec3::new(-17.4, 1.0, 0.0),
            direction: Vec3::new(1.0, 0.0, 0.0),
            maximum_distance: 20.0,
            maximum_visited_cells: 128,
            hit_liquids: false,
        },
    )
    .expect("negative-coordinate DDA")
    .hit
    .expect("chunk boundary hit");
    println!(
        "{{\"scenario\":\"negative-chunk-ray\",\"cell\":[{},{},{}],\"distance\":{:.12},\"normal\":[{:.1},{:.1},{:.1}]}}",
        ray.cell.x, ray.cell.y, ray.cell.z, ray.distance, ray.normal.x, ray.normal.y, ray.normal.z
    );

    let closed = CollisionShapeWindowV1 {
        world: collision_world.clone(),
        overrides: vec![legacy_door_override(CellPos::new(-13, 1, 0), true, false)],
    };
    let open = CollisionShapeWindowV1 {
        world: collision_world.clone(),
        overrides: vec![legacy_door_override(CellPos::new(-13, 1, 0), true, true)],
    };
    let closed_hit = collides_body_shapes(&closed, Vec3::new(-13.05, 0.51, 0.0), 0.3, 1.8).0;
    let open_hit = collides_body_shapes(&open, Vec3::new(-13.05, 0.51, 0.0), 0.3, 1.8).0;
    let unknown_hit = collides_body_shapes(&open, Vec3::new(-18.45, 0.51, 0.0), 0.3, 1.8).0;
    println!(
        "{{\"scenario\":\"doors-and-unloaded\",\"closed\":{closed_hit},\"open\":{open_hit},\"unloadedSolid\":{unknown_hit}}}"
    );
    let stair = CollisionShapeWindowV1 {
        world: collision_world.clone(),
        overrides: vec![legacy_height_override(CellPos::new(-11, 1, 0), 0.5)],
    };
    let stair_result = sweep_body_horizontal_with_step(
        &stair,
        HorizontalStepInputV1 {
            position: Vec3::new(-12.0, 0.51, 0.0),
            radius: 0.3,
            height: 1.8,
            axis: 0,
            distance: 1.0,
            maximum_sweep_step: 0.14,
            step_height: 0.55,
        },
    );
    println!(
        "{{\"scenario\":\"stairs\",\"stepped\":{},\"blocked\":{},\"position\":[{:.12},{:.12},{:.12}]}}",
        stair_result.stepped,
        stair_result.blocked,
        stair_result.position.x,
        stair_result.position.y,
        stair_result.position.z
    );

    let fixture = blockwild_simulation::fixture::canonical_fixture();
    let liquid = step_liquid_frontier(&fixture.liquid).expect("liquid golden");
    let liquid_positions = liquid
        .changes
        .iter()
        .take(6)
        .map(|change| format!("[{},{},{}]", change.position.x, change.position.y, change.position.z))
        .collect::<Vec<_>>()
        .join(",");
    println!(
        "{{\"scenario\":\"liquid-order\",\"operations\":{},\"changes\":[{}],\"remaining\":{}}}",
        liquid.operations,
        liquid_positions,
        liquid.remaining_frontier.len()
    );

    let path = find_path(&fixture.path).expect("path golden");
    let path_cells = path
        .cells
        .iter()
        .take(5)
        .map(|cell| format!("[{},{},{}]", cell.x, cell.y, cell.z))
        .collect::<Vec<_>>()
        .join(",");
    println!(
        "{{\"scenario\":\"path-tie\",\"code\":{},\"cells\":[{}],\"visited\":{}}}",
        path.code as u8, path_cells, path.visited
    );

    let mut air = fixture.air.clone();
    let opening = air.index(CellPos::new(0, 2, 2)).expect("air opening");
    air.cells[opening] = AIR_CELL_TRAVERSABLE_GAS;
    air = air.seal();
    let zones = solve_air_zones(&air).expect("unsafe unknown topology");
    println!(
        "{{\"scenario\":\"atmosphere-unknown\",\"sealed\":{},\"leakFaces\":{},\"budgetExhausted\":{}}}",
        zones.zones[0].sealed, zones.zones[0].leak_faces, zones.budget_exhausted
    );

    let gas = equalize_gas_fixed(
        &GasEqualizationJobV1 {
            identity: fixture.air.identity,
            topology_revision: 5,
            fixed_delta_micros: 100_000,
            maximum_connections: 1,
            zones: vec![
                AirZoneGasStateV1 {
                    zone_id: 1,
                    volume_units: 1_000,
                    mixture: GasMixtureV1 {
                        oxygen: 210_000_000,
                        nitrogen: 780_000_000,
                        carbon_dioxide: 10_000_000,
                        toxic: 0,
                    },
                },
                AirZoneGasStateV1 {
                    zone_id: 2,
                    volume_units: 1_000,
                    mixture: GasMixtureV1::default(),
                },
            ],
            connections: vec![AirConnectionV1 {
                connection_id: 1,
                from_zone: 1,
                to_zone: Some(2),
                kind: AirConnectionKindV1::Vent,
                conductance_ppm: 1_000_000,
                enabled: true,
            }],
            input_hash: CanonicalHash::default(),
        }
        .seal(),
    )
    .expect("fixed gas golden");
    println!(
        "{{\"scenario\":\"fixed-gas\",\"zone1Pressure\":{},\"zone2Pressure\":{},\"transferred\":{}}}",
        gas.zones[0].pressure_fixed(),
        gas.zones[1].pressure_fixed(),
        gas.transfers[0].mixture.total()
    );
}
