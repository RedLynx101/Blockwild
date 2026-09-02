//! Pure swimming, surface-bob, oxygen, and drowning rules.

/// Same-press vertical follow-through after the one emitted shore-exit cue.
/// The timer reuses `surface_breach_seconds`; a consumed shore latch, zero
/// stroke cooldown, and inactive bob distinguish it from a surface stroke.
pub const SHORE_MANTLE_SUSTAIN_SECONDS: f64 = 0.20;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SwimmerState {
    pub velocity_y: f64,
    pub oxygen_seconds: f64,
    pub drowning_accumulator: f64,
    pub entry_momentum_speed: f64,
    pub surface_breach_ready: bool,
    pub surface_breach_seconds: f64,
    pub surface_stroke_cooldown_seconds: f64,
    pub surface_bob_active: bool,
    /// One-shot shore-exit intent latch. A qualifying boost consumes it and
    /// only releasing jump arms another attempt.
    pub shore_exit_ready: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SwimEnvironment {
    pub submersion: f64,
    pub head_submerged: bool,
    pub horizontal_collision: bool,
    pub shore_ledge_height: Option<f64>,
    pub surface_gap: Option<f64>,
    pub surface_clearance: Option<f64>,
    pub entered_from_air: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SwimInput {
    pub jump_held: bool,
    pub moving_forward: bool,
    pub crouching: bool,
    pub sprinting: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SwimRules {
    pub max_oxygen_seconds: f64,
    pub oxygen_drain_per_second: f64,
    pub oxygen_recovery_per_second: f64,
    pub drowning_interval_seconds: f64,
    pub drowning_damage: f64,
    pub buoyancy_acceleration: f64,
    pub passive_sink_acceleration: f64,
    pub maximum_sink_speed: f64,
    pub crouch_sink_acceleration: f64,
    pub crouch_maximum_sink_speed: f64,
    pub swim_acceleration: f64,
    pub sprint_vertical_multiplier: f64,
    pub water_drag: f64,
    pub shore_exit_velocity: f64,
    pub entry_momentum_retention: f64,
    pub entry_momentum_decay_per_second: f64,
    pub surface_breach_velocity: f64,
    pub surface_breach_duration_seconds: f64,
    pub surface_bob_velocity: f64,
    pub surface_bob_floor_clearance: f64,
    pub surface_bob_recovery_acceleration: f64,
    pub surface_recovery_acceleration: f64,
    pub surface_stroke_cycle_seconds: f64,
}

impl Default for SwimRules {
    fn default() -> Self {
        Self {
            max_oxygen_seconds: 12.0,
            oxygen_drain_per_second: 1.0,
            oxygen_recovery_per_second: 4.0,
            drowning_interval_seconds: 1.5,
            drowning_damage: 1.0,
            buoyancy_acceleration: 3.2,
            passive_sink_acceleration: 4.25,
            maximum_sink_speed: 2.3,
            crouch_sink_acceleration: 7.5,
            crouch_maximum_sink_speed: 4.2,
            swim_acceleration: 11.6,
            sprint_vertical_multiplier: 1.2,
            water_drag: 2.8,
            shore_exit_velocity: 8.15,
            entry_momentum_retention: 0.54,
            entry_momentum_decay_per_second: 3.6,
            surface_breach_velocity: 3.65,
            surface_breach_duration_seconds: 0.14,
            surface_bob_velocity: 0.98,
            surface_bob_floor_clearance: 0.34,
            surface_bob_recovery_acceleration: 1.6,
            surface_recovery_acceleration: 13.5,
            surface_stroke_cycle_seconds: 0.18,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SwimStep {
    pub state: SwimmerState,
    pub damage: f64,
    pub shore_boosted: bool,
    pub horizontal_speed_scale: f64,
}

/// Rust port of `app/game/liquids.ts::stepSwimming`, with a native one-shot
/// latch for shore exits so one held input cannot pin the upward impulse.
#[must_use]
pub fn step_swimming(
    state: SwimmerState,
    input: SwimInput,
    environment: SwimEnvironment,
    delta_seconds: f64,
    rules: SwimRules,
) -> SwimStep {
    let dt = delta_seconds.clamp(0.0, 1.0);
    let submersion = environment.submersion.clamp(0.0, 1.0);
    let mut oxygen_seconds = state.oxygen_seconds.clamp(0.0, rules.max_oxygen_seconds);
    let mut drowning_accumulator = state.drowning_accumulator.max(0.0);
    let mut damage = 0.0;
    let mut entry_momentum_speed = state.entry_momentum_speed.max(0.0);
    let mut surface_breach_ready = state.surface_breach_ready;
    let mut surface_breach_seconds = state.surface_breach_seconds.max(0.0);
    let mut surface_stroke_cooldown_seconds = state.surface_stroke_cooldown_seconds.max(0.0);
    let mut surface_bob_active = state.surface_bob_active;
    surface_stroke_cooldown_seconds = (surface_stroke_cooldown_seconds - dt).max(0.0);
    let mut shore_exit_ready = state.shore_exit_ready;
    let shore_mantle_was_active = !shore_exit_ready
        && surface_breach_seconds > 0.0
        && surface_stroke_cooldown_seconds <= 0.0
        && !surface_bob_active;

    if !input.jump_held {
        surface_breach_ready = true;
        shore_exit_ready = true;
        surface_breach_seconds = 0.0;
        surface_stroke_cooldown_seconds = 0.0;
        surface_bob_active = false;
    } else if !input.moving_forward && shore_mantle_was_active {
        surface_breach_seconds = 0.0;
    } else if shore_exit_ready
        && surface_stroke_cooldown_seconds <= 0.0
        && (environment.head_submerged
            || environment.surface_clearance.unwrap_or(f64::NEG_INFINITY) <= rules.surface_bob_floor_clearance)
    {
        surface_breach_ready = true;
    }
    if submersion <= f64::EPSILON {
        surface_breach_seconds = 0.0;
        surface_stroke_cooldown_seconds = 0.0;
        surface_bob_active = false;
    }

    if environment.head_submerged {
        oxygen_seconds = (oxygen_seconds - dt * rules.oxygen_drain_per_second.max(0.0)).max(0.0);
        if oxygen_seconds <= 0.0 {
            drowning_accumulator += dt;
            while drowning_accumulator >= rules.drowning_interval_seconds {
                drowning_accumulator -= rules.drowning_interval_seconds;
                damage += rules.drowning_damage;
            }
        } else {
            drowning_accumulator = 0.0;
        }
    } else {
        oxygen_seconds = (oxygen_seconds + rules.oxygen_recovery_per_second * dt).min(rules.max_oxygen_seconds);
        drowning_accumulator = 0.0;
    }

    let mut velocity_y = state.velocity_y;
    let mut shore_boosted = false;
    if submersion > 0.0 {
        let ordinary_maximum_sink = if input.crouching {
            rules.crouch_maximum_sink_speed
        } else {
            rules.maximum_sink_speed
        };
        if environment.entered_from_air && velocity_y < -ordinary_maximum_sink {
            entry_momentum_speed =
                entry_momentum_speed.max(velocity_y.abs() * rules.entry_momentum_retention.clamp(0.0, 1.0));
        }
        let slow_surface_bob = surface_bob_active && input.jump_held && !environment.head_submerged;
        if !slow_surface_bob {
            velocity_y *= (-rules.water_drag * submersion * dt).exp();
            velocity_y += rules.buoyancy_acceleration * (submersion - 0.84).max(0.0) * dt;
            velocity_y -= rules.passive_sink_acceleration * dt;
        }
        if input.crouching && !input.jump_held {
            velocity_y -= rules.crouch_sink_acceleration * dt;
        }
        let recovering = input.jump_held && environment.head_submerged && surface_stroke_cooldown_seconds > 0.0;
        if input.jump_held
            && ((environment.head_submerged && !recovering) || entry_momentum_speed > ordinary_maximum_sink)
        {
            velocity_y += rules.swim_acceleration
                * if input.sprinting {
                    rules.sprint_vertical_multiplier
                } else {
                    1.0
                }
                * dt;
        }
        if entry_momentum_speed > ordinary_maximum_sink {
            entry_momentum_speed =
                (entry_momentum_speed - rules.entry_momentum_decay_per_second * dt).max(ordinary_maximum_sink);
        }
        let entry_maximum_sink = ordinary_maximum_sink.max(entry_momentum_speed);
        velocity_y = velocity_y.max(-entry_maximum_sink);
        if velocity_y >= -ordinary_maximum_sink + 1.0e-6 {
            entry_momentum_speed = 0.0;
        }

        let ledge_height = environment.shore_ledge_height.unwrap_or(f64::INFINITY);
        let surface_gap = environment.surface_gap.unwrap_or(f64::INFINITY);
        let shore_mantle_active = !shore_exit_ready
            && surface_breach_seconds > 0.0
            && surface_stroke_cooldown_seconds <= 0.0
            && !surface_bob_active;
        if shore_mantle_active && input.jump_held && input.moving_forward {
            velocity_y = velocity_y.max(rules.shore_exit_velocity);
            surface_breach_seconds = (surface_breach_seconds - dt).max(0.0);
        } else if shore_exit_ready
            && input.jump_held
            && input.moving_forward
            && environment.horizontal_collision
            && !environment.head_submerged
            && ledge_height <= 1.15
            && surface_gap <= 0.9
        {
            velocity_y = velocity_y.max(rules.shore_exit_velocity);
            shore_boosted = true;
            shore_exit_ready = false;
            surface_breach_ready = false;
            surface_breach_seconds = SHORE_MANTLE_SUSTAIN_SECONDS;
            surface_stroke_cooldown_seconds = 0.0;
            surface_bob_active = false;
        } else if input.jump_held && !environment.head_submerged && entry_momentum_speed <= ordinary_maximum_sink {
            let begins_surface_breach = surface_breach_ready && velocity_y > 0.35;
            let begins_held_surface_bob = surface_breach_ready
                && surface_stroke_cooldown_seconds <= 0.0
                && environment.surface_clearance.unwrap_or(f64::NEG_INFINITY) <= rules.surface_bob_floor_clearance
                && !begins_surface_breach;
            if begins_surface_breach {
                surface_breach_ready = false;
                surface_breach_seconds = rules.surface_breach_duration_seconds;
                surface_stroke_cooldown_seconds = rules.surface_stroke_cycle_seconds;
                surface_bob_active = false;
            } else if begins_held_surface_bob {
                surface_breach_ready = false;
                surface_stroke_cooldown_seconds = rules.surface_stroke_cycle_seconds;
                surface_bob_active = true;
                velocity_y = velocity_y.max(rules.surface_bob_velocity);
            }
            if surface_breach_seconds > 0.0 {
                velocity_y = velocity_y.max(rules.surface_breach_velocity);
                surface_breach_seconds = (surface_breach_seconds - dt).max(0.0);
            } else if surface_bob_active {
                velocity_y -= rules.surface_bob_recovery_acceleration * dt;
            } else {
                velocity_y -= rules.surface_recovery_acceleration * dt;
            }
        }
    }

    SwimStep {
        state: SwimmerState {
            velocity_y,
            oxygen_seconds,
            drowning_accumulator,
            entry_momentum_speed,
            surface_breach_ready,
            surface_breach_seconds,
            surface_stroke_cooldown_seconds,
            surface_bob_active,
            shore_exit_ready,
        },
        damage,
        shore_boosted,
        horizontal_speed_scale: 1.0 - submersion * 0.38,
    }
}
