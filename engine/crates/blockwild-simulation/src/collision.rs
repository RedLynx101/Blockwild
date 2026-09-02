use blockwild_types::{CanonicalHash, CanonicalHasher};

use crate::{
    CellPos, ContractError, GravityProfileV1, LiquidKindV1, SIMULATION_MAX_EXTERNAL_IMPULSES_V1,
    SIMULATION_MAX_FIXED_DELTA_MICROS_V1, SimulationJobIdentityV1, SwimEnvironment, SwimInput, SwimRules, SwimmerState,
    Vec3, WorldReadWindowV1, step_swimming, write_f64, write_identity, write_vec3,
};

pub const PHYSICS_CONTROL_JUMP: u16 = 1 << 0;
pub const PHYSICS_CONTROL_CROUCH: u16 = 1 << 1;
pub const PHYSICS_CONTROL_SPRINT: u16 = 1 << 2;
pub const PHYSICS_CONTROL_ASCEND: u16 = 1 << 3;
pub const PHYSICS_CONTROL_DESCEND: u16 = 1 << 4;

pub const PHYSICS_CONTACT_GROUNDED: u16 = 1 << 0;
pub const PHYSICS_CONTACT_CEILING: u16 = 1 << 1;
pub const PHYSICS_CONTACT_NEGATIVE_X: u16 = 1 << 2;
pub const PHYSICS_CONTACT_POSITIVE_X: u16 = 1 << 3;
pub const PHYSICS_CONTACT_NEGATIVE_Z: u16 = 1 << 4;
pub const PHYSICS_CONTACT_POSITIVE_Z: u16 = 1 << 5;
pub const PHYSICS_CONTACT_IN_LIQUID: u16 = 1 << 6;
pub const PHYSICS_CONTACT_HEAD_SUBMERGED: u16 = 1 << 7;
pub const PHYSICS_CONTACT_SHORE_BOOSTED: u16 = 1 << 8;
pub const PHYSICS_CONTACT_UNKNOWN_BOUNDARY: u16 = 1 << 9;

pub const PHYSICS_MAX_ABS_POSITION_V1: f64 = 33_554_432.0;
pub const PHYSICS_MAX_ABS_VELOCITY_V1: f64 = 4_096.0;
pub const PHYSICS_MAX_DESIRED_SPEED_V1: f64 = 1_024.0;
pub const PHYSICS_MAX_ACCELERATION_V1: f64 = 4_096.0;

const PHYSICS_SHORE_LEDGE_MAX_HEIGHT_V1: f64 = 1.15;
// The standard 0.30-radius player reaches the same facing cell as the
// legacy 0.62 bank probe while larger bodies remain radius-aware.
const PHYSICS_SHORE_PROBE_CLEARANCE_V1: f64 = 0.32;
const PHYSICS_SHORE_STANDING_EPSILON_V1: f64 = 0.01;

#[derive(Clone, Debug, PartialEq)]
pub struct PhysicsBodyV1 {
    pub handle: String,
    pub position: Vec3,
    pub velocity: Vec3,
    pub radius: f64,
    pub height: f64,
    pub mass: f64,
    pub grounded: bool,
    pub crouching: bool,
    pub fall_distance: f64,
    pub oxygen_seconds: f64,
    pub drowning_accumulator: f64,
    pub swim_entry_momentum_speed: f64,
    pub swim_surface_breach_ready: bool,
    pub swim_surface_breach_seconds: f64,
    pub swim_stroke_cooldown_seconds: f64,
    pub swim_surface_bob_active: bool,
    pub swim_shore_exit_ready: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsControlsV1 {
    pub flags: u16,
    pub forward: f64,
    pub strafe: f64,
    pub yaw: f64,
    pub desired_speed: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhysicsSwimProfileV1 {
    pub enabled: bool,
    pub max_oxygen_seconds: f64,
    pub oxygen_drain_per_second: f64,
    pub oxygen_recovery_per_second: f64,
    pub drowning_interval_seconds: f64,
    pub drowning_damage: f64,
    pub buoyancy_acceleration: f64,
    pub passive_sink_acceleration: f64,
    pub maximum_sink_speed: f64,
    pub swim_acceleration: f64,
    pub water_drag: f64,
    pub shore_exit_velocity: f64,
}

impl Default for PhysicsSwimProfileV1 {
    fn default() -> Self {
        let rules = SwimRules::default();
        Self {
            enabled: true,
            max_oxygen_seconds: rules.max_oxygen_seconds,
            oxygen_drain_per_second: rules.oxygen_drain_per_second,
            oxygen_recovery_per_second: rules.oxygen_recovery_per_second,
            drowning_interval_seconds: rules.drowning_interval_seconds,
            drowning_damage: rules.drowning_damage,
            buoyancy_acceleration: rules.buoyancy_acceleration,
            passive_sink_acceleration: rules.passive_sink_acceleration,
            maximum_sink_speed: rules.maximum_sink_speed,
            swim_acceleration: rules.swim_acceleration,
            water_drag: rules.water_drag,
            shore_exit_velocity: rules.shore_exit_velocity,
        }
    }
}

impl PhysicsSwimProfileV1 {
    fn rules(self) -> SwimRules {
        SwimRules {
            max_oxygen_seconds: self.max_oxygen_seconds,
            oxygen_drain_per_second: self.oxygen_drain_per_second,
            oxygen_recovery_per_second: self.oxygen_recovery_per_second,
            drowning_interval_seconds: self.drowning_interval_seconds,
            drowning_damage: self.drowning_damage,
            buoyancy_acceleration: self.buoyancy_acceleration,
            passive_sink_acceleration: self.passive_sink_acceleration,
            maximum_sink_speed: self.maximum_sink_speed,
            swim_acceleration: self.swim_acceleration,
            water_drag: self.water_drag,
            shore_exit_velocity: self.shore_exit_velocity,
            ..SwimRules::default()
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PhysicsExternalImpulseV1 {
    pub source_handle: String,
    pub impulse: Vec3,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PhysicsStepInputV1 {
    pub identity: SimulationJobIdentityV1,
    pub fixed_delta_micros: u32,
    pub window: WorldReadWindowV1,
    pub body: PhysicsBodyV1,
    pub controls: PhysicsControlsV1,
    pub gravity: GravityProfileV1,
    pub swimming: PhysicsSwimProfileV1,
    pub external_impulses: Vec<PhysicsExternalImpulseV1>,
    pub input_hash: CanonicalHash,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PhysicsEventKindV1 {
    Jump,
    Land,
    FallDamage,
    DrownDamage,
    LiquidEnter,
    LiquidExit,
    ShoreExit,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhysicsEventV1 {
    pub kind: PhysicsEventKindV1,
    pub amount: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PhysicsStepResultV1 {
    pub identity: SimulationJobIdentityV1,
    pub body: PhysicsBodyV1,
    pub contact_flags: u16,
    pub events: Vec<PhysicsEventV1>,
    pub result_hash: CanonicalHash,
}

impl PhysicsStepInputV1 {
    pub fn validate(&self) -> Result<(), ContractError> {
        self.window.validate()?;
        if self.fixed_delta_micros == 0 || self.fixed_delta_micros > SIMULATION_MAX_FIXED_DELTA_MICROS_V1 {
            return Err(ContractError::InvalidDelta);
        }
        if self.external_impulses.len() > SIMULATION_MAX_EXTERNAL_IMPULSES_V1 {
            return Err(ContractError::InvalidBudget);
        }
        if self.identity.world != self.window.identity
            || self.identity.source_snapshot_hash != self.window.snapshot_hash
        {
            return Err(ContractError::IdentityMismatch);
        }
        let finite = [
            self.body.position.x,
            self.body.position.y,
            self.body.position.z,
            self.body.velocity.x,
            self.body.velocity.y,
            self.body.velocity.z,
            self.body.radius,
            self.body.height,
            self.body.mass,
            self.controls.forward,
            self.controls.strafe,
            self.controls.yaw,
            self.controls.desired_speed,
            self.body.fall_distance,
            self.body.oxygen_seconds,
            self.body.drowning_accumulator,
            self.body.swim_entry_momentum_speed,
            self.body.swim_surface_breach_seconds,
            self.body.swim_stroke_cooldown_seconds,
            self.gravity.gravity,
            self.gravity.terminal_velocity,
            self.gravity.air_drag,
            self.gravity.ground_acceleration,
            self.gravity.air_acceleration,
            self.gravity.jump_velocity,
            self.gravity.maximum_sweep_step,
            self.swimming.max_oxygen_seconds,
            self.swimming.oxygen_drain_per_second,
            self.swimming.oxygen_recovery_per_second,
            self.swimming.drowning_interval_seconds,
            self.swimming.drowning_damage,
            self.swimming.buoyancy_acceleration,
            self.swimming.passive_sink_acceleration,
            self.swimming.maximum_sink_speed,
            self.swimming.swim_acceleration,
            self.swimming.water_drag,
            self.swimming.shore_exit_velocity,
        ];
        if finite.iter().any(|value| !value.is_finite())
            || [self.body.position.x, self.body.position.y, self.body.position.z]
                .iter()
                .any(|value| value.abs() > PHYSICS_MAX_ABS_POSITION_V1)
            || [self.body.velocity.x, self.body.velocity.y, self.body.velocity.z]
                .iter()
                .any(|value| value.abs() > PHYSICS_MAX_ABS_VELOCITY_V1)
            || self.body.radius <= 0.0
            || self.body.radius > 64.0
            || self.body.height <= 0.0
            || self.body.height > 128.0
            || self.body.mass <= 0.0
            || self.body.mass > 1_000_000.0
            || self.body.fall_distance < 0.0
            || self.body.oxygen_seconds < 0.0
            || self.body.drowning_accumulator < 0.0
            || self.controls.forward.abs() > 1.0
            || self.controls.strafe.abs() > 1.0
            || self.controls.desired_speed < 0.0
            || self.controls.desired_speed > PHYSICS_MAX_DESIRED_SPEED_V1
            || self.gravity.gravity < 0.0
            || self.gravity.gravity > PHYSICS_MAX_ACCELERATION_V1
            || self.gravity.terminal_velocity < 0.0
            || self.gravity.terminal_velocity > PHYSICS_MAX_ABS_VELOCITY_V1
            || self.gravity.air_drag < 0.0
            || self.gravity.air_drag > PHYSICS_MAX_ACCELERATION_V1
            || self.gravity.ground_acceleration < 0.0
            || self.gravity.ground_acceleration > PHYSICS_MAX_ACCELERATION_V1
            || self.gravity.air_acceleration < 0.0
            || self.gravity.air_acceleration > PHYSICS_MAX_ACCELERATION_V1
            || self.gravity.jump_velocity < 0.0
            || self.gravity.jump_velocity > PHYSICS_MAX_ABS_VELOCITY_V1
            || !(0.01..=1.0).contains(&self.gravity.maximum_sweep_step)
            || self.swimming.max_oxygen_seconds < 0.0
            || self.swimming.max_oxygen_seconds > 86_400.0
            || self.swimming.oxygen_drain_per_second < 0.0
            || self.swimming.oxygen_drain_per_second > PHYSICS_MAX_ACCELERATION_V1
            || self.swimming.oxygen_recovery_per_second < 0.0
            || self.swimming.oxygen_recovery_per_second > PHYSICS_MAX_ACCELERATION_V1
            || self.swimming.drowning_interval_seconds <= 0.0
            || self.swimming.drowning_interval_seconds > 86_400.0
            || self.swimming.drowning_damage < 0.0
            || self.swimming.drowning_damage > 1_000_000.0
            || self.swimming.buoyancy_acceleration < 0.0
            || self.swimming.buoyancy_acceleration > PHYSICS_MAX_ACCELERATION_V1
            || self.swimming.passive_sink_acceleration < 0.0
            || self.swimming.passive_sink_acceleration > PHYSICS_MAX_ACCELERATION_V1
            || self.swimming.maximum_sink_speed < 0.0
            || self.swimming.maximum_sink_speed > PHYSICS_MAX_ABS_VELOCITY_V1
            || self.swimming.swim_acceleration < 0.0
            || self.swimming.swim_acceleration > PHYSICS_MAX_ACCELERATION_V1
            || self.swimming.water_drag < 0.0
            || self.swimming.water_drag > PHYSICS_MAX_ACCELERATION_V1
            || self.swimming.shore_exit_velocity < 0.0
            || self.swimming.shore_exit_velocity > PHYSICS_MAX_ABS_VELOCITY_V1
        {
            return Err(ContractError::InvalidNumber);
        }
        if self.controls.flags & !0x1f != 0 {
            return Err(ContractError::InvalidFlags);
        }
        if self.body.handle.is_empty()
            || self.body.handle.len() > 160
            || self.external_impulses.iter().any(|impulse| {
                impulse.source_handle.is_empty()
                    || impulse.source_handle.len() > 160
                    || [impulse.impulse.x, impulse.impulse.y, impulse.impulse.z]
                        .iter()
                        .any(|value| !value.is_finite() || value.abs() > PHYSICS_MAX_ABS_VELOCITY_V1)
            })
        {
            return Err(ContractError::InvalidNumber);
        }
        if hash_physics_step_input(self) != self.input_hash {
            return Err(ContractError::IdentityMismatch);
        }
        Ok(())
    }
}

fn write_body(hasher: &mut CanonicalHasher, body: &PhysicsBodyV1) {
    hasher.write_str(&body.handle);
    write_vec3(hasher, body.position);
    write_vec3(hasher, body.velocity);
    for value in [
        body.radius,
        body.height,
        body.mass,
        body.fall_distance,
        body.oxygen_seconds,
        body.drowning_accumulator,
        body.swim_entry_momentum_speed,
        body.swim_surface_breach_seconds,
        body.swim_stroke_cooldown_seconds,
    ] {
        write_f64(hasher, value);
    }
    hasher.write_u16(u16::from(body.grounded));
    hasher.write_u16(u16::from(body.crouching));
    hasher.write_u16(u16::from(body.swim_surface_breach_ready));
    hasher.write_u16(u16::from(body.swim_surface_bob_active));
    hasher.write_u16(u16::from(body.swim_shore_exit_ready));
}

#[must_use]
pub fn hash_physics_step_input(input: &PhysicsStepInputV1) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-physics-step-input-v1");
    hasher.write_u16(crate::SIMULATION_SCHEMA_V1);
    write_identity(&mut hasher, &input.identity);
    hasher.write_u32(input.fixed_delta_micros);
    hasher.write_str(&input.window.snapshot_hash.to_hex());
    write_body(&mut hasher, &input.body);
    hasher.write_u16(input.controls.flags);
    hasher.write_u32(input.external_impulses.len() as u32);
    for value in [
        input.controls.forward,
        input.controls.strafe,
        input.controls.yaw,
        input.controls.desired_speed,
    ] {
        write_f64(&mut hasher, value);
    }
    for value in [
        input.gravity.gravity,
        input.gravity.terminal_velocity,
        input.gravity.air_drag,
        input.gravity.ground_acceleration,
        input.gravity.air_acceleration,
        input.gravity.jump_velocity,
        input.gravity.maximum_sweep_step,
    ] {
        write_f64(&mut hasher, value);
    }
    hasher.write_u16(u16::from(input.swimming.enabled));
    for value in [
        input.swimming.max_oxygen_seconds,
        input.swimming.oxygen_drain_per_second,
        input.swimming.oxygen_recovery_per_second,
        input.swimming.drowning_interval_seconds,
        input.swimming.drowning_damage,
        input.swimming.buoyancy_acceleration,
        input.swimming.passive_sink_acceleration,
        input.swimming.maximum_sink_speed,
        input.swimming.swim_acceleration,
        input.swimming.water_drag,
        input.swimming.shore_exit_velocity,
    ] {
        write_f64(&mut hasher, value);
    }
    for impulse in &input.external_impulses {
        hasher.write_str(&impulse.source_handle);
        write_vec3(&mut hasher, impulse.impulse);
    }
    hasher.finish()
}

impl PhysicsStepInputV1 {
    /// Seals a newly constructed DTO with the canonical TypeScript-compatible input hash.
    #[must_use]
    pub fn seal(mut self) -> Self {
        self.input_hash = hash_physics_step_input(&self);
        self
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AxisSweepResultV1 {
    pub position: Vec3,
    pub blocked: bool,
    pub unknown_boundary: bool,
}

#[must_use]
pub fn collides_body(window: &WorldReadWindowV1, position: Vec3, radius: f64, height: f64) -> (bool, bool) {
    let minimum_x = (position.x - radius + 0.5).floor() as i32;
    let maximum_x = (position.x + radius - 0.001 + 0.5).floor() as i32;
    let minimum_y = (position.y + 0.25).floor() as i32;
    let maximum_y = (position.y + height - 0.001 + 0.5).floor() as i32;
    let minimum_z = (position.z - radius + 0.5).floor() as i32;
    let maximum_z = (position.z + radius - 0.001 + 0.5).floor() as i32;
    let mut blocked = false;
    let mut unknown_boundary = false;
    for y in minimum_y..=maximum_y {
        for z in minimum_z..=maximum_z {
            for x in minimum_x..=maximum_x {
                let cell = CellPos::new(x, y, z);
                let unknown = window.sample(cell).is_none_or(|sample| !sample.loaded);
                unknown_boundary |= unknown;
                let block_bottom = f64::from(y) - 0.5;
                let block_top = block_bottom + 1.0;
                if window.is_collision_solid(cell) && position.y + height > block_bottom && position.y < block_top {
                    blocked = true;
                }
            }
        }
    }
    (blocked, unknown_boundary)
}

#[must_use]
pub fn sweep_body_axis(
    window: &WorldReadWindowV1,
    position: Vec3,
    radius: f64,
    height: f64,
    axis: usize,
    distance: f64,
    maximum_step: f64,
) -> AxisSweepResultV1 {
    let steps = ((distance.abs() / maximum_step.max(0.01)).ceil() as usize).max(1);
    let step = distance / steps as f64;
    let mut current = position;
    let mut unknown_boundary = false;
    for _ in 0..steps {
        let mut candidate = current;
        match axis {
            0 => candidate.x += step,
            1 => candidate.y += step,
            _ => candidate.z += step,
        }
        let (blocked, unknown) = collides_body(window, candidate, radius, height);
        unknown_boundary |= unknown;
        if blocked {
            return AxisSweepResultV1 {
                position: current,
                blocked: true,
                unknown_boundary,
            };
        }
        current = candidate;
    }
    AxisSweepResultV1 {
        position: current,
        blocked: false,
        unknown_boundary,
    }
}

fn contiguous_liquid_surface_y(window: &WorldReadWindowV1, x: i32, z: i32, start_y: i32) -> Option<f64> {
    // The immutable read window is the hard bound. Reaching unknown/unloaded
    // data before open air means the surface is not authoritative.
    let mut liquid_y = start_y;
    loop {
        let above_y = liquid_y.checked_add(1)?;
        let above_position = CellPos::new(x, above_y, z);
        let above = window.sample(above_position)?;
        if !above.loaded {
            return None;
        }
        if above.liquid_kind == LiquidKindV1::None {
            return (!window.is_collision_solid(above_position)).then_some(f64::from(liquid_y) + 0.5);
        }
        liquid_y = above_y;
    }
}

fn sample_shore_ledge_height(
    window: &WorldReadWindowV1,
    body: &PhysicsBodyV1,
    yaw: f64,
    surface_y: Option<f64>,
) -> Option<f64> {
    let surface_y = surface_y?;
    let (sin, cos) = yaw.sin_cos();
    let probe_distance = body.radius + PHYSICS_SHORE_PROBE_CLEARANCE_V1;
    let target_x = (body.position.x - sin * probe_distance + 0.5).floor() as i32;
    let target_z = (body.position.z - cos * probe_distance + 0.5).floor() as i32;
    let minimum_support_y = (surface_y - 0.5).floor() as i32;
    let maximum_support_y = (surface_y + PHYSICS_SHORE_LEDGE_MAX_HEIGHT_V1 - 0.5).floor() as i32;

    for support_y in (minimum_support_y..=maximum_support_y).rev() {
        let support_position = CellPos::new(target_x, support_y, target_z);
        let support = window.sample(support_position)?;
        if !support.loaded || !window.is_collision_solid(support_position) {
            continue;
        }
        let support_top = f64::from(support_y) + 0.5;
        let ledge_height = (support_top - surface_y).max(0.0);
        let standing_position = Vec3::new(
            f64::from(target_x),
            support_top + PHYSICS_SHORE_STANDING_EPSILON_V1,
            f64::from(target_z),
        );
        let (standing_blocked, standing_unknown) = collides_body(window, standing_position, body.radius, body.height);
        if !standing_blocked && !standing_unknown {
            return Some(ledge_height);
        }
    }
    None
}

fn sample_liquid_environment(
    window: &WorldReadWindowV1,
    body: &PhysicsBodyV1,
    predicted: Vec3,
    forward_yaw: f64,
) -> SwimEnvironment {
    let heights = [
        0.08,
        body.height * 0.25,
        body.height * 0.5,
        body.height * 0.75,
        body.height * 0.92,
    ];
    let sample_x = (body.position.x + 0.5).floor() as i32;
    let sample_z = (body.position.z + 0.5).floor() as i32;
    let mut liquid_samples = 0;
    let mut highest_liquid_y = None;
    for height in heights {
        let sample_y = (body.position.y + height + 0.5).floor() as i32;
        if window
            .sample(CellPos::new(sample_x, sample_y, sample_z))
            .is_some_and(|cell| cell.loaded && cell.liquid_kind != LiquidKindV1::None)
        {
            liquid_samples += 1;
            highest_liquid_y = Some(highest_liquid_y.map_or(sample_y, |current: i32| current.max(sample_y)));
        }
    }
    let eye_y = body.position.y + body.height * 0.9;
    let head_cell = CellPos::new(sample_x, (eye_y + 0.5).floor() as i32, sample_z);
    let head_submerged = window
        .sample(head_cell)
        .is_some_and(|cell| cell.loaded && cell.liquid_kind != LiquidKindV1::None);
    let surface_y =
        highest_liquid_y.and_then(|liquid_y| contiguous_liquid_surface_y(window, sample_x, sample_z, liquid_y));
    let (sin, cos) = forward_yaw.sin_cos();
    let forward_x = -sin;
    let forward_z = -cos;
    let attempted_forward_distance =
        ((predicted.x - body.position.x) * forward_x + (predicted.z - body.position.z) * forward_z).max(0.0);
    let forward_predicted = Vec3::new(
        body.position.x + forward_x * attempted_forward_distance,
        body.position.y,
        body.position.z + forward_z * attempted_forward_distance,
    );
    let (horizontal_collision, horizontal_unknown) = collides_body(window, forward_predicted, body.radius, body.height);
    let shore_ledge_height = (!horizontal_unknown && horizontal_collision)
        .then(|| sample_shore_ledge_height(window, body, forward_yaw, surface_y))
        .flatten();
    SwimEnvironment {
        submersion: liquid_samples as f64 / heights.len() as f64,
        head_submerged,
        horizontal_collision,
        shore_ledge_height,
        surface_gap: surface_y.map(|surface_y| (surface_y - eye_y).max(0.0)),
        surface_clearance: surface_y.map(|surface_y| eye_y - surface_y),
        entered_from_air: liquid_samples > 0 && body.swim_entry_momentum_speed <= f64::EPSILON,
    }
}

#[must_use]
pub fn fall_damage_for_distance(distance: f64) -> f64 {
    let unsafe_distance = (if distance.is_finite() { distance } else { 0.0 } - 4.0).max(0.0);
    if unsafe_distance <= 0.0 {
        0.0
    } else {
        (unsafe_distance - 0.0001).ceil().min(6.0)
    }
}

pub fn step_physics(input: &PhysicsStepInputV1) -> Result<PhysicsStepResultV1, ContractError> {
    input.validate()?;
    let dt = f64::from(input.fixed_delta_micros) / 1_000_000.0;
    let mut body = input.body.clone();
    let mut events = Vec::new();
    let was_grounded = body.grounded;
    let initial_environment = sample_liquid_environment(&input.window, &body, body.position, input.controls.yaw);
    let was_in_liquid = initial_environment.submersion > 0.0;

    for external in &input.external_impulses {
        body.velocity = body.velocity + external.impulse * body.mass.recip();
    }

    let forward = input.controls.forward.clamp(-1.0, 1.0);
    let strafe = input.controls.strafe.clamp(-1.0, 1.0);
    let length = (forward * forward + strafe * strafe).sqrt().max(1.0);
    let (sin, cos) = input.controls.yaw.sin_cos();
    let desired_x = (-sin * (forward / length) + cos * (strafe / length)) * input.controls.desired_speed;
    let desired_z = (-cos * (forward / length) - sin * (strafe / length)) * input.controls.desired_speed;
    let acceleration = if body.grounded || was_in_liquid {
        input.gravity.ground_acceleration
    } else {
        input.gravity.air_acceleration
    };
    let blend = (acceleration * dt).min(1.0);
    body.velocity.x += (desired_x - body.velocity.x) * blend;
    body.velocity.z += (desired_z - body.velocity.z) * blend;
    if forward.abs() + strafe.abs() <= f64::EPSILON {
        let drag = (-input.gravity.air_drag * dt).exp();
        body.velocity.x *= drag;
        body.velocity.z *= drag;
    }

    let jump_held = input.controls.flags & PHYSICS_CONTROL_JUMP != 0;
    if !jump_held {
        // This must also run on dry steps: releasing jump after climbing out
        // is the sole action that arms a later shore-exit attempt.
        body.swim_shore_exit_ready = true;
    }
    if body.grounded && jump_held && !was_in_liquid {
        body.velocity.y = input.gravity.jump_velocity;
        body.grounded = false;
        events.push(PhysicsEventV1 {
            kind: PhysicsEventKindV1::Jump,
            amount: 0.0,
        });
    }

    let predicted = Vec3::new(
        body.position.x + body.velocity.x * dt,
        body.position.y,
        body.position.z + body.velocity.z * dt,
    );
    let environment = sample_liquid_environment(&input.window, &body, predicted, input.controls.yaw);
    if input.swimming.enabled && environment.submersion > 0.0 {
        let swim = step_swimming(
            SwimmerState {
                velocity_y: body.velocity.y,
                oxygen_seconds: body.oxygen_seconds,
                drowning_accumulator: body.drowning_accumulator,
                entry_momentum_speed: body.swim_entry_momentum_speed,
                surface_breach_ready: body.swim_surface_breach_ready,
                surface_breach_seconds: body.swim_surface_breach_seconds,
                surface_stroke_cooldown_seconds: body.swim_stroke_cooldown_seconds,
                surface_bob_active: body.swim_surface_bob_active,
                shore_exit_ready: body.swim_shore_exit_ready,
            },
            SwimInput {
                jump_held,
                moving_forward: forward > 0.0,
                crouching: input.controls.flags & PHYSICS_CONTROL_CROUCH != 0,
                sprinting: input.controls.flags & PHYSICS_CONTROL_SPRINT != 0,
            },
            environment,
            dt,
            input.swimming.rules(),
        );
        body.velocity.y = swim.state.velocity_y;
        body.oxygen_seconds = swim.state.oxygen_seconds;
        body.drowning_accumulator = swim.state.drowning_accumulator;
        body.swim_entry_momentum_speed = swim.state.entry_momentum_speed;
        body.swim_surface_breach_ready = swim.state.surface_breach_ready;
        body.swim_surface_breach_seconds = swim.state.surface_breach_seconds;
        body.swim_stroke_cooldown_seconds = swim.state.surface_stroke_cooldown_seconds;
        body.swim_surface_bob_active = swim.state.surface_bob_active;
        body.swim_shore_exit_ready = swim.state.shore_exit_ready;
        if swim.damage > 0.0 {
            events.push(PhysicsEventV1 {
                kind: PhysicsEventKindV1::DrownDamage,
                amount: swim.damage,
            });
        }
        if swim.shore_boosted {
            events.push(PhysicsEventV1 {
                kind: PhysicsEventKindV1::ShoreExit,
                amount: 0.0,
            });
        }
    } else {
        body.velocity.y = (body.velocity.y - input.gravity.gravity * dt).max(-input.gravity.terminal_velocity);
        body.oxygen_seconds = (body.oxygen_seconds + input.swimming.oxygen_recovery_per_second * dt)
            .min(input.swimming.max_oxygen_seconds);
        body.drowning_accumulator = 0.0;
        body.swim_surface_breach_seconds = 0.0;
        body.swim_stroke_cooldown_seconds = 0.0;
        body.swim_surface_bob_active = false;
    }

    let attempted_velocity = body.velocity;
    let x = sweep_body_axis(
        &input.window,
        body.position,
        body.radius,
        body.height,
        0,
        body.velocity.x * dt,
        input.gravity.maximum_sweep_step,
    );
    body.position = x.position;
    if x.blocked {
        body.velocity.x = 0.0;
    }
    let vertical_start = body.position.y;
    let y = sweep_body_axis(
        &input.window,
        body.position,
        body.radius,
        body.height,
        1,
        body.velocity.y * dt,
        input.gravity.maximum_sweep_step,
    );
    body.position = y.position;
    if y.blocked {
        body.velocity.y = 0.0;
    }
    if !was_in_liquid && attempted_velocity.y < 0.0 {
        body.fall_distance += (vertical_start - body.position.y).max(0.0);
    }
    let z = sweep_body_axis(
        &input.window,
        body.position,
        body.radius,
        body.height,
        2,
        body.velocity.z * dt,
        input.gravity.maximum_sweep_step,
    );
    body.position = z.position;
    if z.blocked {
        body.velocity.z = 0.0;
    }

    let final_environment = sample_liquid_environment(&input.window, &body, body.position, input.controls.yaw);
    let in_liquid = final_environment.submersion > 0.0;
    if was_in_liquid || in_liquid {
        // Liquid contact breaks the causal chain from an earlier air fall.
        // Clear before landing resolution so shallow-water landings cannot
        // convert stale dry-air distance into damage.
        body.fall_distance = 0.0;
    }

    let probe = Vec3::new(body.position.x, body.position.y - 0.055, body.position.z);
    body.grounded = collides_body(&input.window, probe, body.radius, body.height).0;
    if !was_grounded && body.grounded && !was_in_liquid && !in_liquid {
        events.push(PhysicsEventV1 {
            kind: PhysicsEventKindV1::Land,
            amount: 0.0,
        });
        let damage = fall_damage_for_distance(body.fall_distance);
        if damage > 0.0 {
            events.push(PhysicsEventV1 {
                kind: PhysicsEventKindV1::FallDamage,
                amount: damage,
            });
        }
        body.fall_distance = 0.0;
    }

    if !was_in_liquid && in_liquid {
        events.push(PhysicsEventV1 {
            kind: PhysicsEventKindV1::LiquidEnter,
            amount: 0.0,
        });
    } else if was_in_liquid && !in_liquid {
        events.push(PhysicsEventV1 {
            kind: PhysicsEventKindV1::LiquidExit,
            amount: 0.0,
        });
    }

    let mut contacts = 0_u16;
    if body.grounded {
        contacts |= PHYSICS_CONTACT_GROUNDED;
    }
    if y.blocked && attempted_velocity.y > 0.0 {
        contacts |= PHYSICS_CONTACT_CEILING;
    }
    if x.blocked {
        contacts |= if attempted_velocity.x < 0.0 {
            PHYSICS_CONTACT_NEGATIVE_X
        } else {
            PHYSICS_CONTACT_POSITIVE_X
        };
    }
    if z.blocked {
        contacts |= if attempted_velocity.z < 0.0 {
            PHYSICS_CONTACT_NEGATIVE_Z
        } else {
            PHYSICS_CONTACT_POSITIVE_Z
        };
    }
    if in_liquid {
        contacts |= PHYSICS_CONTACT_IN_LIQUID;
    }
    if final_environment.head_submerged {
        contacts |= PHYSICS_CONTACT_HEAD_SUBMERGED;
    }
    if events.iter().any(|event| event.kind == PhysicsEventKindV1::ShoreExit) {
        contacts |= PHYSICS_CONTACT_SHORE_BOOSTED;
    }
    if x.unknown_boundary || y.unknown_boundary || z.unknown_boundary {
        contacts |= PHYSICS_CONTACT_UNKNOWN_BOUNDARY;
    }

    let mut hasher = CanonicalHasher::new("blockwild-physics-step-result-v1");
    hasher.write_u16(crate::SIMULATION_SCHEMA_V1);
    write_identity(&mut hasher, &input.identity);
    write_body(&mut hasher, &body);
    hasher.write_u16(contacts);
    hasher.write_u32(events.len() as u32);
    for event in &events {
        hasher.write_str(match event.kind {
            PhysicsEventKindV1::Jump => "jump",
            PhysicsEventKindV1::Land => "land",
            PhysicsEventKindV1::FallDamage => "fall-damage",
            PhysicsEventKindV1::DrownDamage => "drown-damage",
            PhysicsEventKindV1::LiquidEnter => "liquid-enter",
            PhysicsEventKindV1::LiquidExit => "liquid-exit",
            PhysicsEventKindV1::ShoreExit => "shore-exit",
        });
        write_f64(&mut hasher, event.amount);
    }
    Ok(PhysicsStepResultV1 {
        identity: input.identity.clone(),
        body,
        contact_flags: contacts,
        events,
        result_hash: hasher.finish(),
    })
}
