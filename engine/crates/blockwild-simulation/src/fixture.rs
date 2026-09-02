//! Canonical native fixtures and allocation-inclusive micro-benchmark hooks.

use blockwild_types::CanonicalHash;

use crate::*;

#[derive(Clone, Debug)]
pub struct CanonicalSimulationFixture {
    pub physics: PhysicsStepInputV1,
    pub liquid: LiquidFrontierStepV1,
    pub path: PathJobV1,
    pub air: AirZoneTopologyJobV1,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct NativeBenchmarkReport {
    pub iterations: u32,
    pub physics_micros: u128,
    pub liquid_micros: u128,
    pub path_micros: u128,
    pub air_micros: u128,
    pub query_micros: u128,
    pub kinematics_micros: u128,
    pub gas_micros: u128,
    pub digest: u64,
}

#[must_use]
pub fn canonical_fixture() -> CanonicalSimulationFixture {
    let address = WorldAddressV1 {
        universe_id: "7".into(),
        location_id: "blockwild".into(),
    };
    let identity = WorldIdentityV1 {
        address: address.clone(),
        revision: WorldRevisionV1 {
            epoch: 2,
            mutation: 41,
            residency: 9,
        },
        state_hash: CanonicalHash([0x31; 16]),
    };
    let size = [12, 6, 12];
    let count = size.iter().map(|value| *value as usize).product();
    let mut window = WorldReadWindowV1 {
        address,
        origin: CellPos::new(-2, -1, -2),
        size,
        identity: identity.clone(),
        loaded_mask: vec![1; count],
        boundary: vec![0; count],
        blocks: vec![0; count],
        facing: vec![0; count],
        liquid_kind: vec![0; count],
        liquid_level: vec![0; count],
        flags: vec![0; count],
        snapshot_hash: CanonicalHash::default(),
    };
    for z in -2..10 {
        for x in -2..10 {
            let floor = window.index(CellPos::new(x, 0, z)).expect("fixture floor in range");
            window.blocks[floor] = 1;
        }
    }
    for z in 3..=5 {
        for x in 3..=5 {
            let water = window.index(CellPos::new(x, 1, z)).expect("fixture water in range");
            window.liquid_kind[water] = LiquidKindV1::Water as u8;
            window.liquid_level[water] = 0;
            window.flags[water] = WORLD_CELL_LIQUID_SOURCE;
        }
    }
    let wall = window.index(CellPos::new(2, 1, 1)).expect("fixture wall in range");
    window.blocks[wall] = 2;
    window.snapshot_hash = crate::contract::hash_world_window(&window);
    let job_identity = SimulationJobIdentityV1 {
        job_id: "r5-canonical".into(),
        sequence: 17,
        world: identity,
        source_snapshot_hash: window.snapshot_hash,
    };

    let physics = PhysicsStepInputV1 {
        identity: job_identity.clone(),
        fixed_delta_micros: 16_667,
        window: window.clone(),
        body: PhysicsBodyV1 {
            handle: "player:fixture".into(),
            position: Vec3::new(0.0, 0.51, 1.0),
            velocity: Vec3::default(),
            radius: 0.3,
            height: 1.8,
            mass: 1.15,
            grounded: true,
            crouching: false,
            fall_distance: 0.0,
            oxygen_seconds: 12.0,
            drowning_accumulator: 0.0,
            swim_entry_momentum_speed: 0.0,
            swim_surface_breach_ready: true,
            swim_surface_breach_seconds: 0.0,
            swim_stroke_cooldown_seconds: 0.0,
            swim_surface_bob_active: false,
            swim_shore_exit_ready: true,
        },
        controls: PhysicsControlsV1 {
            flags: 0,
            forward: 1.0,
            strafe: 0.0,
            yaw: 0.0,
            desired_speed: 5.2,
        },
        gravity: GravityProfileV1::default(),
        swimming: PhysicsSwimProfileV1::default(),
        external_impulses: Vec::new(),
        input_hash: CanonicalHash::default(),
    }
    .seal();

    let liquid = LiquidFrontierStepV1 {
        identity: job_identity.clone(),
        window,
        frontier: vec![CellPos::new(3, 1, 3)],
        operation_budget: 64,
        spread: LiquidSpreadV1::default(),
        input_hash: CanonicalHash::default(),
    }
    .seal();

    let path_size = [8, 4, 8];
    let path_count = path_size.iter().map(|value| *value as usize).product();
    let mut occupancy = PathOccupancyWindowV1 {
        origin: CellPos::new(0, 0, 0),
        size: path_size,
        cells: vec![PATH_CELL_LOADED | PATH_CELL_PASSABLE; path_count],
        snapshot_hash: CanonicalHash::default(),
    };
    for z in 0..8 {
        for x in 0..8 {
            let index = occupancy.index(CellPos::new(x, 1, z)).expect("path fixture in range");
            occupancy.cells[index] |= PATH_CELL_SUPPORT;
        }
    }
    for y in 1..=2 {
        let index = occupancy.index(CellPos::new(3, y, 3)).expect("path obstacle in range");
        occupancy.cells[index] &= !PATH_CELL_PASSABLE;
    }
    let path = PathJobV1 {
        identity: job_identity.clone(),
        occupancy,
        start: Vec3::new(1.0, 1.0, 1.0),
        goal: Vec3::new(6.0, 1.0, 6.0),
        maximum_distance: 96.0,
        maximum_nodes: 4_096,
        body_radius: 0.3,
        body_height: 1.8,
        input_hash: CanonicalHash::default(),
    }
    .seal();

    let air_size = [5, 5, 5];
    let air_count = air_size.iter().map(|value| *value as usize).product();
    let mut air = AirZoneTopologyJobV1 {
        identity: job_identity,
        topology_revision: 4,
        origin: CellPos::new(0, 0, 0),
        size: air_size,
        cells: vec![AIR_CELL_LOADED | AIR_CELL_SOLID | AIR_CELL_SEALABLE; air_count],
        maximum_visited_cells: 4_096,
        input_hash: CanonicalHash::default(),
    };
    for y in 1..4 {
        for z in 1..4 {
            for x in 1..4 {
                let index = air.index(CellPos::new(x, y, z)).expect("air fixture in range");
                air.cells[index] = AIR_CELL_LOADED | AIR_CELL_TRAVERSABLE_GAS;
            }
        }
    }
    let vent = air.index(CellPos::new(2, 2, 2)).expect("vent in range");
    air.cells[vent] |= AIR_CELL_VENT;
    air = air.seal();

    CanonicalSimulationFixture {
        physics,
        liquid,
        path,
        air,
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[must_use]
pub fn run_native_benchmark(iterations: u32) -> NativeBenchmarkReport {
    use std::{hint::black_box, time::Instant};
    let fixture = canonical_fixture();
    let iterations = iterations.max(1);
    let mut digest = 0_u64;

    let started = Instant::now();
    for index in 0..iterations {
        let result = black_box(step_physics(black_box(&fixture.physics)).expect("canonical physics fixture"));
        digest = digest.rotate_left(5)
            ^ u64::from_le_bytes(result.result_hash.0[..8].try_into().expect("eight hash bytes"))
            ^ u64::from(index);
    }
    let physics_micros = started.elapsed().as_micros();

    let started = Instant::now();
    for index in 0..iterations {
        let result = black_box(step_liquid_frontier(black_box(&fixture.liquid)).expect("canonical liquid fixture"));
        digest = digest.rotate_left(7)
            ^ u64::from_le_bytes(result.result_hash.0[..8].try_into().expect("eight hash bytes"))
            ^ u64::from(index);
    }
    let liquid_micros = started.elapsed().as_micros();

    let started = Instant::now();
    for index in 0..iterations {
        let result = black_box(find_path(black_box(&fixture.path)).expect("canonical path fixture"));
        digest = digest.rotate_left(11)
            ^ u64::from_le_bytes(result.result_hash.0[..8].try_into().expect("eight hash bytes"))
            ^ u64::from(index);
    }
    let path_micros = started.elapsed().as_micros();

    let started = Instant::now();
    for index in 0..iterations {
        let result = black_box(solve_air_zones(black_box(&fixture.air)).expect("canonical air fixture"));
        digest = digest.rotate_left(13)
            ^ u64::from_le_bytes(result.result_hash.0[..8].try_into().expect("eight hash bytes"))
            ^ u64::from(index);
    }
    let air_micros = started.elapsed().as_micros();

    let ray_query = VoxelRaycastQueryV1 {
        query_id: 1,
        origin: Vec3::new(0.0, 1.0, 1.0),
        direction: Vec3::new(1.0, 0.0, 0.0),
        maximum_distance: 16.0,
        maximum_visited_cells: 64,
        hit_liquids: false,
    };
    let entities = [
        BroadphaseEntityV1 {
            entity_id: 1,
            bounds: AabbV1::new(Vec3::new(0.0, 0.0, 0.0), Vec3::new(1.0, 2.0, 1.0)),
            layer_mask: 1,
        },
        BroadphaseEntityV1 {
            entity_id: 2,
            bounds: AabbV1::new(Vec3::new(1.0, 0.0, 1.0), Vec3::new(2.0, 2.0, 2.0)),
            layer_mask: 1,
        },
    ];
    let queries = [BroadphaseQueryV1 {
        query_id: 1,
        bounds: AabbV1::new(Vec3::new(-1.0, -1.0, -1.0), Vec3::new(3.0, 3.0, 3.0)),
        layer_mask: 1,
        maximum_results: 8,
    }];
    let started = Instant::now();
    for index in 0..iterations {
        let ray = black_box(raycast_voxels(black_box(&fixture.physics.window), ray_query).expect("ray fixture"));
        let broadphase = black_box(run_broadphase_batch(4.0, &entities, &queries).expect("broadphase fixture"));
        digest = digest.rotate_left(17)
            ^ u64::from(ray.visited_cells as u32)
            ^ u64::from(broadphase[0].entity_ids.len() as u32)
            ^ u64::from(index);
    }
    let query_micros = started.elapsed().as_micros();

    let started = Instant::now();
    for index in 0..iterations {
        let flight = black_box(step_creative_flight_velocity(
            Vec3::default(),
            CreativeFlightControlV1 {
                forward: 1.0,
                strafe: 0.25,
                yaw: 0.35,
                ascend: true,
                descend: false,
                sprinting: true,
                movement_multiplier: 1.0,
            },
            1.0 / 60.0,
        ));
        let boat = black_box(sailboat_candidate(
            SailboatKinematicsV1 {
                position: Vec3::default(),
                yaw: 0.25,
                velocity: 1.2,
            },
            SailboatControlV1 {
                forward: 1.0,
                turn: -0.4,
            },
            0.05,
        ));
        digest = digest.rotate_left(19) ^ flight.x.to_bits() ^ boat.state.velocity.to_bits() ^ u64::from(index);
    }
    let kinematics_micros = started.elapsed().as_micros();

    let gas_job = GasEqualizationJobV1 {
        identity: fixture.air.identity.clone(),
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
    .seal();
    let started = Instant::now();
    for index in 0..iterations {
        let result = black_box(equalize_gas_fixed(black_box(&gas_job)).expect("gas fixture"));
        digest = digest.rotate_left(23)
            ^ u64::from_le_bytes(result.result_hash.0[..8].try_into().expect("eight hash bytes"))
            ^ u64::from(index);
    }
    NativeBenchmarkReport {
        iterations,
        physics_micros,
        liquid_micros,
        path_micros,
        air_micros,
        query_micros,
        kinematics_micros,
        gas_micros: started.elapsed().as_micros(),
        digest,
    }
}
