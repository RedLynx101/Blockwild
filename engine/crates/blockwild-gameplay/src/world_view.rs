//! Renderer-neutral authority for spatial gameplay and location presentation inputs.
//!
//! These records are authoritative facts used by extraction. They are not GPU
//! records and contain no renderer handles. `IntegratedRuntimeV2` can stage an
//! ordinary [`GameplayState`] first, then apply a [`WorldViewBatchV1`] against
//! that staged state so inventory custody and spatial ownership commit together.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId, PlayerId};

use crate::{
    ActorRole, ContainerKey, ContainerKind, GameplayActor, GameplayState, ItemStack, Rejection, RejectionCode,
    WorldKey, validate_id,
};

pub const WORLD_VIEW_PROTOCOL_VERSION_V1: u16 = 1;
pub const WORLD_VIEW_SCHEMA_VERSION_V1: u16 = 1;
pub const WORLD_VIEW_MAX_COMMANDS_V1: usize = 256;
pub const WORLD_VIEW_MAX_MACHINE_ANCHORS_V1: usize = 65_536;
pub const WORLD_VIEW_MAX_DROPPED_ITEMS_V1: usize = 65_536;
pub const WORLD_VIEW_MAX_PLAYER_BINDINGS_V1: usize = 4_096;
pub const WORLD_VIEW_MAX_CELESTIAL_BODIES_V1: usize = 256;
pub const WORLD_VIEW_IDEMPOTENCY_WINDOW_V1: usize = 4_096;
pub const WORLD_VIEW_REPLAY_WINDOW_V1: usize = 4_096;
pub const WORLD_VIEW_COORDINATE_LIMIT_MILLI_V1: i64 = 33_554_432_000;
pub const WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND_V1: i64 = 4_096_000;
pub const WORLD_VIEW_UNIT_SCALE_V1: i32 = 1_000_000;
pub const WORLD_VIEW_FRACTION_SCALE_V1: u32 = 1_000_000;
pub const WORLD_VIEW_MAX_PRESSURE_MILLIPASCALS_V1: u64 = 10_000_000_000;
pub const WORLD_VIEW_MAX_TEMPERATURE_MILLIKELVIN_V1: u32 = 10_000_000;
pub const WORLD_VIEW_MAX_GRAVITY_MICROMETRES_PER_SECOND_SQUARED_V1: u64 = 1_000_000_000;
/// Pickup locks are deliberately short-lived presentation/gameplay guards,
/// not durable ownership leases. Keeping the deadline bounded prevents a
/// malformed command from making ordinary item custody unreachable forever.
pub const WORLD_VIEW_MAX_PICKUP_LOCK_TICKS_V1: u64 = 1_200;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct FixedWorldVec3V1 {
    pub x_milli: i64,
    pub y_milli: i64,
    pub z_milli: i64,
}

impl FixedWorldVec3V1 {
    fn validate_position(self) -> Result<(), Rejection> {
        if [self.x_milli, self.y_milli, self.z_milli]
            .into_iter()
            .any(|value| value.unsigned_abs() > WORLD_VIEW_COORDINATE_LIMIT_MILLI_V1 as u64)
        {
            return Err(invalid("world-view position is outside the supported coordinate range"));
        }
        Ok(())
    }

    fn validate_velocity(self) -> Result<(), Rejection> {
        if [self.x_milli, self.y_milli, self.z_milli]
            .into_iter()
            .any(|value| value.unsigned_abs() > WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND_V1 as u64)
        {
            return Err(invalid("world-view velocity is outside the supported range"));
        }
        Ok(())
    }

    pub(crate) fn hash_into(self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.x_milli as u64);
        hasher.write_u64(self.y_milli as u64);
        hasher.write_u64(self.z_milli as u64);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FixedUnitVectorV1 {
    pub x_millionths: i32,
    pub y_millionths: i32,
    pub z_millionths: i32,
}

impl FixedUnitVectorV1 {
    pub const DOWN: Self = Self {
        x_millionths: 0,
        y_millionths: -WORLD_VIEW_UNIT_SCALE_V1,
        z_millionths: 0,
    };

    pub const UP: Self = Self {
        x_millionths: 0,
        y_millionths: WORLD_VIEW_UNIT_SCALE_V1,
        z_millionths: 0,
    };

    fn validate(self) -> Result<(), Rejection> {
        let components = [self.x_millionths, self.y_millionths, self.z_millionths];
        if components
            .into_iter()
            .any(|value| value.unsigned_abs() > WORLD_VIEW_UNIT_SCALE_V1 as u32)
        {
            return Err(invalid("unit-vector component exceeds one millionth scale"));
        }
        let length_squared = components.into_iter().fold(0_i64, |sum, value| {
            sum.saturating_add(i64::from(value).saturating_mul(i64::from(value)))
        });
        const MIN_LENGTH_SQUARED: i64 = 980_000_i64 * 980_000_i64;
        const MAX_LENGTH_SQUARED: i64 = 1_020_000_i64 * 1_020_000_i64;
        if !(MIN_LENGTH_SQUARED..=MAX_LENGTH_SQUARED).contains(&length_squared) {
            return Err(invalid("direction is not a normalized fixed-point vector"));
        }
        Ok(())
    }

    pub(crate) fn hash_into(self, hasher: &mut CanonicalHasher) {
        hasher.write_i32(self.x_millionths);
        hasher.write_i32(self.y_millionths);
        hasher.write_i32(self.z_millionths);
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RotationMicroturnsV1 {
    pub yaw: u32,
    pub pitch: u32,
    pub roll: u32,
}

impl RotationMicroturnsV1 {
    fn validate(self) -> Result<(), Rejection> {
        if [self.yaw, self.pitch, self.roll]
            .into_iter()
            .any(|value| value >= WORLD_VIEW_FRACTION_SCALE_V1)
        {
            return Err(invalid("rotation must be canonical microturns below one turn"));
        }
        Ok(())
    }

    pub(crate) fn hash_into(self, hasher: &mut CanonicalHasher) {
        hasher.write_u32(self.yaw);
        hasher.write_u32(self.pitch);
        hasher.write_u32(self.roll);
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct LinearRgbMillionthsV1 {
    pub red: u32,
    pub green: u32,
    pub blue: u32,
}

impl LinearRgbMillionthsV1 {
    pub const WHITE: Self = Self {
        red: WORLD_VIEW_FRACTION_SCALE_V1,
        green: WORLD_VIEW_FRACTION_SCALE_V1,
        blue: WORLD_VIEW_FRACTION_SCALE_V1,
    };

    fn validate(self) -> Result<(), Rejection> {
        if [self.red, self.green, self.blue]
            .into_iter()
            .any(|value| value > WORLD_VIEW_FRACTION_SCALE_V1)
        {
            return Err(invalid("linear color channel exceeds one millionth scale"));
        }
        Ok(())
    }

    pub(crate) fn hash_into(self, hasher: &mut CanonicalHasher) {
        hasher.write_u32(self.red);
        hasher.write_u32(self.green);
        hasher.write_u32(self.blue);
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum MachineLightKindV1 {
    Point,
    Spot,
    Area,
    Emissive,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MachineLightProfileV1 {
    pub kind: MachineLightKindV1,
    pub color: LinearRgbMillionthsV1,
    pub luminous_flux_millilumens: u64,
    pub range_milli: u32,
    pub inner_cone_microturns: u32,
    pub outer_cone_microturns: u32,
    pub casts_shadows: bool,
    pub enabled: bool,
}

impl MachineLightProfileV1 {
    fn validate(&self) -> Result<(), Rejection> {
        self.color.validate()?;
        if self.luminous_flux_millilumens == 0 || self.range_milli == 0 || self.range_milli > 1_024_000 {
            return Err(invalid("machine light intensity or range is outside bounds"));
        }
        if self.outer_cone_microturns > 500_000
            || self.inner_cone_microturns > self.outer_cone_microturns
            || self.kind != MachineLightKindV1::Spot
                && (self.inner_cone_microturns != 0 || self.outer_cone_microturns != 0)
        {
            return Err(invalid("machine light cone is invalid for its light kind"));
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u16(self.kind as u16);
        self.color.hash_into(hasher);
        hasher.write_u64(self.luminous_flux_millilumens);
        hasher.write_u32(self.range_milli);
        hasher.write_u32(self.inner_cone_microturns);
        hasher.write_u32(self.outer_cone_microturns);
        hasher.write_u16(u16::from(self.casts_shadows));
        hasher.write_u16(u16::from(self.enabled));
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MachineSpatialAnchorV1 {
    pub machine_id: String,
    pub revision: u64,
    pub presentation_id: String,
    pub position: FixedWorldVec3V1,
    pub rotation: RotationMicroturnsV1,
    pub half_extents_milli: [u32; 3],
    pub light: Option<MachineLightProfileV1>,
}

impl MachineSpatialAnchorV1 {
    fn validate(&self) -> Result<(), Rejection> {
        validate_id("machine spatial anchor", &self.machine_id)?;
        validate_id("machine presentation", &self.presentation_id)?;
        self.position.validate_position()?;
        self.rotation.validate()?;
        if self
            .half_extents_milli
            .into_iter()
            .any(|value| value == 0 || value > 1_024_000)
        {
            return Err(invalid("machine spatial bounds are empty or too large"));
        }
        if let Some(light) = &self.light {
            light.validate()?;
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_str(&self.machine_id);
        hasher.write_u64(self.revision);
        hasher.write_str(&self.presentation_id);
        self.position.hash_into(hasher);
        self.rotation.hash_into(hasher);
        for extent in self.half_extents_milli {
            hasher.write_u32(extent);
        }
        hash_option(hasher, self.light.as_ref(), MachineLightProfileV1::hash_into);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DroppedItemSpatialV1 {
    pub drop_id: String,
    pub revision: u64,
    pub entity_id: EntityId,
    pub container: ContainerKey,
    pub slot: u16,
    pub bound_container_revision: u64,
    pub position: FixedWorldVec3V1,
    pub velocity_milli_per_second: FixedWorldVec3V1,
    pub rotation: RotationMicroturnsV1,
    pub created_tick: u64,
    pub expires_tick: Option<u64>,
    /// Legacy descriptive provenance retained in state/snapshot hashes. It is
    /// not a pickup capability; current native drops use `None` and the global
    /// [`Self::pickup_unlock_tick`] deadline is the only eligibility lock.
    pub pickup_lock_actor_id: Option<String>,
    pub pickup_unlock_tick: u64,
}

impl DroppedItemSpatialV1 {
    fn validate_shape(&self) -> Result<(), Rejection> {
        validate_id("dropped item", &self.drop_id)?;
        if self.entity_id.packed() == 0 {
            return Err(invalid("dropped item uses the reserved zero entity identity"));
        }
        self.container.validate()?;
        self.position.validate_position()?;
        self.velocity_milli_per_second.validate_velocity()?;
        self.rotation.validate()?;
        if self.expires_tick.is_some_and(|tick| tick <= self.created_tick) {
            return Err(invalid("dropped item expiry must follow creation"));
        }
        if self.pickup_unlock_tick < self.created_tick
            || self.pickup_unlock_tick.saturating_sub(self.created_tick) > WORLD_VIEW_MAX_PICKUP_LOCK_TICKS_V1
            || self
                .expires_tick
                .is_some_and(|expires_tick| self.pickup_unlock_tick > expires_tick)
        {
            return Err(invalid(
                "dropped item pickup unlock must be bounded between creation and expiry",
            ));
        }
        if let Some(actor_id) = &self.pickup_lock_actor_id {
            validate_id("dropped item pickup lock", actor_id)?;
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_str(&self.drop_id);
        hasher.write_u64(self.revision);
        hasher.write_u64(self.entity_id.packed());
        self.container.hash_into(hasher);
        hasher.write_u16(self.slot);
        hasher.write_u64(self.bound_container_revision);
        self.position.hash_into(hasher);
        self.velocity_milli_per_second.hash_into(hasher);
        self.rotation.hash_into(hasher);
        hasher.write_u64(self.created_tick);
        hash_option_u64(hasher, self.expires_tick);
        hash_option_str(hasher, self.pickup_lock_actor_id.as_deref());
        // A legacy BWVWSP/1 record had no explicit deadline. Its canonical
        // meaning is immediate unlock at `created_tick`, and omitting that
        // default preserves historical state/replay hashes exactly.
        if self.pickup_unlock_tick != self.created_tick {
            hasher.write_str("pickup-unlock-tick-v1");
            hasher.write_u64(self.pickup_unlock_tick);
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerInventoryBindingV1 {
    pub player_id: PlayerId,
    pub revision: u64,
    pub actor_id: String,
    pub entity_id: EntityId,
    pub inventory_container: ContainerKey,
    pub equipment_container: ContainerKey,
    pub selected_slot: u16,
    pub back_slot: Option<u16>,
}

impl PlayerInventoryBindingV1 {
    fn validate_shape(&self) -> Result<(), Rejection> {
        if self.player_id.packed() == 0 || self.entity_id.packed() == 0 {
            return Err(invalid("player binding uses a reserved zero identity"));
        }
        validate_id("player binding actor", &self.actor_id)?;
        self.inventory_container.validate()?;
        self.equipment_container.validate()?;
        if self.inventory_container == self.equipment_container
            || self.inventory_container.kind != ContainerKind::Player
            || self.equipment_container.kind != ContainerKind::Equipment
        {
            return Err(invalid(
                "player binding requires distinct player and equipment containers",
            ));
        }
        if self.inventory_container.owner_id.as_deref() != Some(&self.actor_id)
            || self.equipment_container.owner_id.as_deref() != Some(&self.actor_id)
        {
            return Err(invalid("player binding containers do not belong to the bound actor"));
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.player_id.packed());
        hasher.write_u64(self.revision);
        hasher.write_str(&self.actor_id);
        hasher.write_u64(self.entity_id.packed());
        self.inventory_container.hash_into(hasher);
        self.equipment_container.hash_into(hasher);
        hasher.write_u16(self.selected_slot);
        match self.back_slot {
            Some(slot) => {
                hasher.write_u16(1);
                hasher.write_u16(slot);
            }
            None => hasher.write_u16(0),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum WeatherKindV1 {
    Clear,
    Cloudy,
    Rain,
    Snow,
    Storm,
    Dust,
    Ash,
    Mist,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EnvironmentLightingStateV1 {
    pub revision: u64,
    pub observed_tick: u64,
    pub weather: WeatherKindV1,
    pub weather_seed: u64,
    pub precipitation_millionths: u32,
    pub cloud_cover_millionths: u32,
    pub fog_density_millionths: u32,
    pub wind_milli_per_second: FixedWorldVec3V1,
    pub ambient_color: LinearRgbMillionthsV1,
    pub ambient_irradiance_millionths: u32,
    pub sky_color: LinearRgbMillionthsV1,
    pub sky_irradiance_millionths: u32,
    pub lightning_probability_millionths: u32,
}

impl Default for EnvironmentLightingStateV1 {
    fn default() -> Self {
        Self {
            revision: 0,
            observed_tick: 0,
            weather: WeatherKindV1::Clear,
            weather_seed: 0,
            precipitation_millionths: 0,
            cloud_cover_millionths: 0,
            fog_density_millionths: 0,
            wind_milli_per_second: FixedWorldVec3V1::default(),
            ambient_color: LinearRgbMillionthsV1::WHITE,
            ambient_irradiance_millionths: 300_000,
            sky_color: LinearRgbMillionthsV1 {
                red: 470_000,
                green: 690_000,
                blue: 1_000_000,
            },
            sky_irradiance_millionths: WORLD_VIEW_FRACTION_SCALE_V1,
            lightning_probability_millionths: 0,
        }
    }
}

impl EnvironmentLightingStateV1 {
    fn validate(&self, authority_tick: u64) -> Result<(), Rejection> {
        if self.observed_tick > authority_tick {
            return Err(invalid("environment observation is ahead of authority time"));
        }
        for fraction in [
            self.precipitation_millionths,
            self.cloud_cover_millionths,
            self.fog_density_millionths,
            self.ambient_irradiance_millionths,
            self.sky_irradiance_millionths,
            self.lightning_probability_millionths,
        ] {
            if fraction > WORLD_VIEW_FRACTION_SCALE_V1 {
                return Err(invalid("environment fraction exceeds one millionth scale"));
            }
        }
        self.wind_milli_per_second.validate_velocity()?;
        self.ambient_color.validate()?;
        self.sky_color.validate()?;
        if matches!(self.weather, WeatherKindV1::Clear | WeatherKindV1::Cloudy) && self.precipitation_millionths != 0 {
            return Err(invalid("clear or cloudy weather cannot author precipitation"));
        }
        if self.weather != WeatherKindV1::Storm && self.lightning_probability_millionths != 0 {
            return Err(invalid("only storm weather can author lightning probability"));
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.revision);
        hasher.write_u64(self.observed_tick);
        hasher.write_u16(self.weather as u16);
        hasher.write_u64(self.weather_seed);
        hasher.write_u32(self.precipitation_millionths);
        hasher.write_u32(self.cloud_cover_millionths);
        hasher.write_u32(self.fog_density_millionths);
        self.wind_milli_per_second.hash_into(hasher);
        self.ambient_color.hash_into(hasher);
        hasher.write_u32(self.ambient_irradiance_millionths);
        self.sky_color.hash_into(hasher);
        hasher.write_u32(self.sky_irradiance_millionths);
        hasher.write_u32(self.lightning_probability_millionths);
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct GasCompositionMillionthsV1 {
    pub oxygen: u32,
    pub nitrogen: u32,
    pub carbon_dioxide: u32,
    pub argon: u32,
    pub other: u32,
    pub toxic: u32,
}

impl GasCompositionMillionthsV1 {
    fn validate(self, pressure_millipascals: u64) -> Result<(), Rejection> {
        let total = u64::from(self.oxygen)
            .saturating_add(u64::from(self.nitrogen))
            .saturating_add(u64::from(self.carbon_dioxide))
            .saturating_add(u64::from(self.argon))
            .saturating_add(u64::from(self.other));
        if pressure_millipascals == 0 {
            if total != 0 || self.toxic != 0 {
                return Err(invalid("vacuum atmosphere cannot contain gas fractions"));
            }
        } else if total != u64::from(WORLD_VIEW_FRACTION_SCALE_V1) || self.toxic > WORLD_VIEW_FRACTION_SCALE_V1 {
            return Err(invalid("atmosphere composition must sum to one million"));
        }
        Ok(())
    }

    pub(crate) fn hash_into(self, hasher: &mut CanonicalHasher) {
        hasher.write_u32(self.oxygen);
        hasher.write_u32(self.nitrogen);
        hasher.write_u32(self.carbon_dioxide);
        hasher.write_u32(self.argon);
        hasher.write_u32(self.other);
        hasher.write_u32(self.toxic);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GravityStateV1 {
    pub acceleration_micrometres_per_second_squared: u64,
    pub direction: FixedUnitVectorV1,
}

impl GravityStateV1 {
    fn validate(self) -> Result<(), Rejection> {
        if self.acceleration_micrometres_per_second_squared > WORLD_VIEW_MAX_GRAVITY_MICROMETRES_PER_SECOND_SQUARED_V1 {
            return Err(invalid("gravity acceleration exceeds the supported bound"));
        }
        self.direction.validate()
    }

    pub(crate) fn hash_into(self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.acceleration_micrometres_per_second_squared);
        self.direction.hash_into(hasher);
    }
}

impl Default for GravityStateV1 {
    fn default() -> Self {
        Self {
            acceleration_micrometres_per_second_squared: 9_810_000,
            direction: FixedUnitVectorV1::DOWN,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AtmosphereGravityStateV1 {
    pub revision: u64,
    pub pressure_millipascals: u64,
    pub temperature_millikelvin: u32,
    pub composition: GasCompositionMillionthsV1,
    pub optical_extinction_millionths: u32,
    pub gravity: GravityStateV1,
}

impl Default for AtmosphereGravityStateV1 {
    fn default() -> Self {
        Self {
            revision: 0,
            pressure_millipascals: 101_325_000,
            temperature_millikelvin: 288_150,
            composition: GasCompositionMillionthsV1 {
                oxygen: 209_500,
                nitrogen: 780_600,
                carbon_dioxide: 420,
                argon: 9_300,
                other: 180,
                toxic: 0,
            },
            optical_extinction_millionths: 20_000,
            gravity: GravityStateV1::default(),
        }
    }
}

impl AtmosphereGravityStateV1 {
    fn validate(&self) -> Result<(), Rejection> {
        if self.pressure_millipascals > WORLD_VIEW_MAX_PRESSURE_MILLIPASCALS_V1
            || self.temperature_millikelvin > WORLD_VIEW_MAX_TEMPERATURE_MILLIKELVIN_V1
            || self.pressure_millipascals > 0 && self.temperature_millikelvin == 0
            || self.optical_extinction_millionths > WORLD_VIEW_FRACTION_SCALE_V1
        {
            return Err(invalid(
                "atmosphere pressure, temperature, or extinction is outside bounds",
            ));
        }
        self.composition.validate(self.pressure_millipascals)?;
        self.gravity.validate()
    }

    #[must_use]
    pub fn is_human_breathable(&self) -> bool {
        let oxygen_partial_pressure = self
            .pressure_millipascals
            .saturating_mul(u64::from(self.composition.oxygen))
            / u64::from(WORLD_VIEW_FRACTION_SCALE_V1);
        (16_000_000..=30_000_000).contains(&oxygen_partial_pressure)
            && self.composition.toxic <= 1_000
            && (260_000..=330_000).contains(&self.temperature_millikelvin)
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.revision);
        hasher.write_u64(self.pressure_millipascals);
        hasher.write_u32(self.temperature_millikelvin);
        self.composition.hash_into(hasher);
        hasher.write_u32(self.optical_extinction_millionths);
        self.gravity.hash_into(hasher);
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum CelestialBodyKindV1 {
    Star,
    Planet,
    Moon,
    Station,
    Asteroid,
    Artificial,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CelestialBodySkyV1 {
    pub body_id: String,
    pub parent_body_id: Option<String>,
    pub kind: CelestialBodyKindV1,
    pub presentation_id: String,
    pub direction: FixedUnitVectorV1,
    pub angular_radius_microdegrees: u32,
    pub illuminated_fraction_millionths: u32,
    pub phase_microturns: u32,
    pub tint: LinearRgbMillionthsV1,
    pub radiance_millionths: u32,
    pub render_order: i32,
    pub occludes_stars: bool,
}

impl CelestialBodySkyV1 {
    fn validate(&self) -> Result<(), Rejection> {
        validate_id("celestial body", &self.body_id)?;
        if let Some(parent) = &self.parent_body_id {
            validate_id("celestial parent", parent)?;
            if parent == &self.body_id {
                return Err(invalid("celestial body cannot parent itself"));
            }
        }
        validate_id("celestial presentation", &self.presentation_id)?;
        self.direction.validate()?;
        self.tint.validate()?;
        if self.angular_radius_microdegrees == 0
            || self.angular_radius_microdegrees > 90_000_000
            || self.illuminated_fraction_millionths > WORLD_VIEW_FRACTION_SCALE_V1
            || self.phase_microturns >= WORLD_VIEW_FRACTION_SCALE_V1
            || self.radiance_millionths > 100_000_000
        {
            return Err(invalid("celestial sky parameters are outside bounds"));
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_str(&self.body_id);
        hash_option_str(hasher, self.parent_body_id.as_deref());
        hasher.write_u16(self.kind as u16);
        hasher.write_str(&self.presentation_id);
        self.direction.hash_into(hasher);
        hasher.write_u32(self.angular_radius_microdegrees);
        hasher.write_u32(self.illuminated_fraction_millionths);
        hasher.write_u32(self.phase_microturns);
        self.tint.hash_into(hasher);
        hasher.write_u32(self.radiance_millionths);
        hasher.write_i32(self.render_order);
        hasher.write_u16(u16::from(self.occludes_stars));
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CelestialSkyStateV1 {
    pub revision: u64,
    pub ephemeris_tick: u64,
    pub starfield_seed: u64,
    pub bodies: BTreeMap<String, CelestialBodySkyV1>,
}

impl CelestialSkyStateV1 {
    fn validate(&self, authority_tick: u64) -> Result<(), Rejection> {
        if self.ephemeris_tick > authority_tick || self.bodies.len() > WORLD_VIEW_MAX_CELESTIAL_BODIES_V1 {
            return Err(invalid(
                "celestial state is ahead of authority time or exceeds capacity",
            ));
        }
        for (body_id, body) in &self.bodies {
            if body_id != &body.body_id {
                return Err(invalid("celestial map key disagrees with its record"));
            }
            body.validate()?;
            if body
                .parent_body_id
                .as_ref()
                .is_some_and(|parent| !self.bodies.contains_key(parent))
            {
                return Err(invalid("celestial body references an unknown parent"));
            }
        }
        for body in self.bodies.values() {
            let mut visited = BTreeSet::new();
            let mut cursor = body.parent_body_id.as_ref();
            while let Some(parent) = cursor {
                if !visited.insert(parent) {
                    return Err(invalid("celestial parent graph contains a cycle"));
                }
                cursor = self
                    .bodies
                    .get(parent)
                    .and_then(|record| record.parent_body_id.as_ref());
            }
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.revision);
        hasher.write_u64(self.ephemeris_tick);
        hasher.write_u64(self.starfield_seed);
        hasher.write_u64(self.bodies.len() as u64);
        for body in self.bodies.values() {
            body.hash_into(hasher);
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct WorldViewRevisionV1 {
    pub epoch: u32,
    pub sequence: u64,
    pub clock: u64,
    pub machine_anchors: u64,
    pub dropped_items: u64,
    pub player_bindings: u64,
    pub environment: u64,
    pub atmosphere_gravity: u64,
    pub celestial: u64,
}

impl WorldViewRevisionV1 {
    pub(crate) fn hash_into(self, hasher: &mut CanonicalHasher) {
        hasher.write_u32(self.epoch);
        hasher.write_u64(self.sequence);
        hasher.write_u64(self.clock);
        hasher.write_u64(self.machine_anchors);
        hasher.write_u64(self.dropped_items);
        hasher.write_u64(self.player_bindings);
        hasher.write_u64(self.environment);
        hasher.write_u64(self.atmosphere_gravity);
        hasher.write_u64(self.celestial);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewStateV1 {
    pub world: WorldKey,
    pub revision: WorldViewRevisionV1,
    pub tick: u64,
    pub machine_anchors: BTreeMap<String, MachineSpatialAnchorV1>,
    pub dropped_items: BTreeMap<String, DroppedItemSpatialV1>,
    pub player_bindings: BTreeMap<PlayerId, PlayerInventoryBindingV1>,
    pub environment: EnvironmentLightingStateV1,
    pub atmosphere_gravity: AtmosphereGravityStateV1,
    pub celestial: CelestialSkyStateV1,
}

impl WorldViewStateV1 {
    #[must_use]
    pub fn new(world: WorldKey, epoch: u32) -> Self {
        Self {
            world,
            revision: WorldViewRevisionV1 {
                epoch,
                ..WorldViewRevisionV1::default()
            },
            tick: 0,
            machine_anchors: BTreeMap::new(),
            dropped_items: BTreeMap::new(),
            player_bindings: BTreeMap::new(),
            environment: EnvironmentLightingStateV1::default(),
            atmosphere_gravity: AtmosphereGravityStateV1::default(),
            celestial: CelestialSkyStateV1::default(),
        }
    }

    #[must_use]
    pub fn state_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.world-view.state.v1");
        self.world.hash_into(&mut hasher);
        self.revision.hash_into(&mut hasher);
        hasher.write_u64(self.tick);
        hasher.write_u64(self.machine_anchors.len() as u64);
        for anchor in self.machine_anchors.values() {
            anchor.hash_into(&mut hasher);
        }
        hasher.write_u64(self.dropped_items.len() as u64);
        for drop in self.dropped_items.values() {
            drop.hash_into(&mut hasher);
        }
        hasher.write_u64(self.player_bindings.len() as u64);
        for binding in self.player_bindings.values() {
            binding.hash_into(&mut hasher);
        }
        self.environment.hash_into(&mut hasher);
        self.atmosphere_gravity.hash_into(&mut hasher);
        self.celestial.hash_into(&mut hasher);
        hasher.finish()
    }

    #[must_use]
    pub fn identity(&self) -> WorldViewIdentityV1 {
        WorldViewIdentityV1 {
            world: self.world.clone(),
            revision: self.revision,
            state_hash: self.state_hash(),
        }
    }

    /// Validate every renderer-facing reference against the canonical R7 state.
    /// A caller should pass the staged post-command gameplay state when a cross-
    /// domain transaction moves item custody and spatial ownership together.
    pub fn validate_against_gameplay(&self, gameplay: &GameplayState) -> Result<(), Rejection> {
        self.world.validate()?;
        if gameplay.world != self.world {
            return Err(Rejection::new(
                RejectionCode::WrongWorld,
                "world-view authority and gameplay authority target different worlds",
            ));
        }
        if self.machine_anchors.len() > WORLD_VIEW_MAX_MACHINE_ANCHORS_V1
            || self.dropped_items.len() > WORLD_VIEW_MAX_DROPPED_ITEMS_V1
            || self.player_bindings.len() > WORLD_VIEW_MAX_PLAYER_BINDINGS_V1
        {
            return Err(capacity("world-view state exceeds a collection bound"));
        }

        for (machine_id, anchor) in &self.machine_anchors {
            if machine_id != &anchor.machine_id || !gameplay.machines.machines.contains_key(machine_id) {
                return Err(invalid("machine anchor key or machine reference is invalid"));
            }
            anchor.validate()?;
        }

        let mut drop_entities = BTreeSet::new();
        let mut drop_slots = BTreeSet::new();
        for (drop_id, drop) in &self.dropped_items {
            if drop_id != &drop.drop_id {
                return Err(invalid("dropped-item map key disagrees with its record"));
            }
            drop.validate_shape()?;
            if !drop_entities.insert(drop.entity_id) || !drop_slots.insert((drop.container.clone(), drop.slot)) {
                return Err(Rejection::new(
                    RejectionCode::Conflict,
                    "dropped items cannot share an entity or inventory slot",
                ));
            }
            validate_drop_inventory_link(drop, gameplay)?;
        }

        let mut actor_ids = BTreeSet::new();
        let mut entity_ids = BTreeSet::new();
        let mut containers = BTreeSet::new();
        for (player_id, binding) in &self.player_bindings {
            if player_id != &binding.player_id {
                return Err(invalid("player binding map key disagrees with its record"));
            }
            binding.validate_shape()?;
            if !actor_ids.insert(&binding.actor_id)
                || !entity_ids.insert(binding.entity_id)
                || !containers.insert(&binding.inventory_container)
                || !containers.insert(&binding.equipment_container)
            {
                return Err(Rejection::new(
                    RejectionCode::Conflict,
                    "player bindings must have unique actors, entities, and containers",
                ));
            }
            validate_player_inventory_link(binding, gameplay)?;
        }

        self.environment.validate(self.tick)?;
        self.atmosphere_gravity.validate()?;
        self.celestial.validate(self.tick)
    }

    #[must_use]
    pub fn player_binding(&self, player_id: PlayerId) -> Option<&PlayerInventoryBindingV1> {
        self.player_bindings.get(&player_id)
    }

    #[must_use]
    pub fn player_binding_by_entity(&self, entity_id: EntityId) -> Option<&PlayerInventoryBindingV1> {
        self.player_bindings
            .values()
            .find(|binding| binding.entity_id == entity_id)
    }

    pub fn held_stack<'a>(
        &self,
        gameplay: &'a GameplayState,
        player_id: PlayerId,
    ) -> Result<Option<&'a ItemStack>, Rejection> {
        let binding = self
            .player_bindings
            .get(&player_id)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "player inventory binding does not exist"))?;
        validate_player_inventory_link(binding, gameplay)?;
        Ok(gameplay
            .inventory
            .containers
            .get(&binding.inventory_container)
            .and_then(|container| container.slots.get(usize::from(binding.selected_slot)))
            .and_then(Option::as_ref))
    }

    pub fn dropped_stack<'a>(&self, gameplay: &'a GameplayState, drop_id: &str) -> Result<&'a ItemStack, Rejection> {
        let drop = self
            .dropped_items
            .get(drop_id)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "dropped item does not exist"))?;
        validate_drop_inventory_link(drop, gameplay)?;
        gameplay
            .inventory
            .containers
            .get(&drop.container)
            .and_then(|container| container.slots.get(usize::from(drop.slot)))
            .and_then(Option::as_ref)
            .ok_or_else(|| invalid("dropped item inventory slot became empty"))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerDropStageRequestV1 {
    pub batch_id: String,
    pub idempotency_key: String,
    pub actor: GameplayActor,
    pub expected_gameplay_identity: crate::AuthorityIdentity,
    pub expected_world_view_identity: WorldViewIdentityV1,
    pub player_id: PlayerId,
    pub expected_binding_revision: u64,
    pub expected_source_container_revision: u64,
    pub expected_stack: crate::ExpectedStack,
    pub drop_id: String,
    pub drop_entity_id: EntityId,
    pub custody_container_id: String,
    pub position: FixedWorldVec3V1,
    pub velocity_milli_per_second: FixedWorldVec3V1,
    pub rotation: RotationMicroturnsV1,
    pub expires_tick: Option<u64>,
    /// Legacy descriptive provenance only; it does not grant or deny pickup.
    pub pickup_lock_actor_id: Option<String>,
    pub pickup_unlock_tick: u64,
}

impl PlayerDropStageRequestV1 {
    #[must_use]
    pub fn request_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.world-view.player-drop.request.v1");
        hasher.write_str(&self.batch_id);
        hasher.write_str(&self.idempotency_key);
        hasher.write_str(&self.actor.actor_id);
        hash_option_u64(&mut hasher, self.actor.player_id.map(PlayerId::packed));
        hash_option_u64(&mut hasher, self.actor.entity_id.map(EntityId::packed));
        hasher.write_u16(self.actor.role as u16);
        self.expected_gameplay_identity.world.hash_into(&mut hasher);
        self.expected_gameplay_identity.revision.hash_into(&mut hasher);
        hasher.write_bytes(self.expected_gameplay_identity.state_hash.as_bytes());
        self.expected_world_view_identity.hash_into(&mut hasher);
        hasher.write_u64(self.player_id.packed());
        hasher.write_u64(self.expected_binding_revision);
        hasher.write_u64(self.expected_source_container_revision);
        hasher.write_u32(self.expected_stack.item_code);
        hasher.write_bytes(self.expected_stack.metadata_hash.as_bytes());
        hasher.write_u32(self.expected_stack.minimum_count);
        hasher.write_str(&self.drop_id);
        hasher.write_u64(self.drop_entity_id.packed());
        hasher.write_str(&self.custody_container_id);
        self.position.hash_into(&mut hasher);
        self.velocity_milli_per_second.hash_into(&mut hasher);
        self.rotation.hash_into(&mut hasher);
        hash_option_u64(&mut hasher, self.expires_tick);
        hash_option_str(&mut hasher, self.pickup_lock_actor_id.as_deref());
        if self.pickup_unlock_tick != 0 {
            hasher.write_str("pickup-unlock-tick-v1");
            hasher.write_u64(self.pickup_unlock_tick);
        }
        hasher.finish()
    }
}

#[derive(Clone, Debug)]
pub struct StagedPlayerDropV1 {
    pub gameplay: crate::GameplayAuthority,
    pub gameplay_receipt: crate::AcceptedReceipt,
    pub before_gameplay_identity: crate::AuthorityIdentity,
    pub after_gameplay_identity: crate::AuthorityIdentity,
    pub drop: DroppedItemSpatialV1,
    pub stack: ItemStack,
    pub source_container: ContainerKey,
    pub custody_container: ContainerKey,
    pub transaction_hash: CanonicalHash,
}

/// Stage the inventory half of a one-item world drop without mutating either
/// input. The caller must stage the matching R6 entity spawn and apply
/// `WorldViewCommandV1::RegisterDrop` to a cloned runtime before assigning any
/// result. This makes partial custody, entity, or spatial commits impossible.
pub fn stage_player_drop_v1(
    gameplay: &crate::GameplayAuthority,
    world_view: &WorldViewStateV1,
    request: &PlayerDropStageRequestV1,
) -> Result<StagedPlayerDropV1, Rejection> {
    if world_view.identity() != request.expected_world_view_identity {
        return Err(Rejection::new(
            RejectionCode::StaleRevision,
            "player-drop world-view identity is stale",
        ));
    }
    if gameplay.state.world != world_view.world {
        return Err(Rejection::new(
            RejectionCode::WrongWorld,
            "player-drop gameplay and world-view authorities target different worlds",
        ));
    }
    validate_id("player-drop batch", &request.batch_id)?;
    validate_id("player-drop idempotency key", &request.idempotency_key)?;
    request.actor.validate_shape()?;
    validate_id("player drop", &request.drop_id)?;
    validate_id("drop custody container", &request.custody_container_id)?;
    if request.drop_entity_id.packed() == 0 {
        return Err(invalid("player drop uses the reserved zero entity identity"));
    }
    request.position.validate_position()?;
    request.velocity_milli_per_second.validate_velocity()?;
    request.rotation.validate()?;
    if let Some(actor_id) = &request.pickup_lock_actor_id {
        validate_id("player-drop pickup lock", actor_id)?;
    }
    if request.pickup_unlock_tick < world_view.tick
        || request.pickup_unlock_tick.saturating_sub(world_view.tick) > WORLD_VIEW_MAX_PICKUP_LOCK_TICKS_V1
        || request
            .expires_tick
            .is_some_and(|expires_tick| request.pickup_unlock_tick > expires_tick)
    {
        return Err(invalid(
            "player-drop pickup unlock must be bounded between creation and expiry",
        ));
    }
    if world_view.dropped_items.contains_key(&request.drop_id)
        || world_view
            .dropped_items
            .values()
            .any(|drop| drop.entity_id == request.drop_entity_id)
    {
        return Err(Rejection::new(
            RejectionCode::Conflict,
            "player-drop identity is already spatially owned",
        ));
    }
    let binding = world_view
        .player_binding(request.player_id)
        .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "player inventory binding does not exist"))?;
    require_revision(
        binding.revision,
        request.expected_binding_revision,
        "player inventory binding",
    )?;
    validate_player_inventory_link(binding, &gameplay.state)?;
    if request.actor.actor_id != binding.actor_id
        || request.actor.player_id != Some(binding.player_id)
        || request.actor.entity_id != Some(binding.entity_id)
    {
        return Err(Rejection::new(
            RejectionCode::Unauthorized,
            "player-drop actor does not match the explicit player binding",
        ));
    }

    let custody_container = ContainerKey {
        kind: ContainerKind::Container,
        id: request.custody_container_id.clone(),
        owner_id: None,
    };
    custody_container.validate()?;
    let source_container = binding.inventory_container.clone();
    let mut staged = gameplay.clone();
    let request_hash = request.request_hash();
    let gameplay_batch = crate::GameplayBatch::new(
        &request.batch_id,
        &request.idempotency_key,
        request.actor.clone(),
        request.expected_gameplay_identity.clone(),
        vec![crate::GameplayCommand::Inventory(
            crate::InventoryCommand::CreateDropCustody(crate::CreateDropCustodyCommand {
                source: crate::SlotRef {
                    container: source_container.clone(),
                    slot: binding.selected_slot,
                    expected_container_revision: Some(request.expected_source_container_revision),
                },
                custody: custody_container.clone(),
                expected: Some(request.expected_stack.clone()),
                request_hash,
            }),
        )],
    );
    let gameplay_receipt = match staged.apply_batch(&gameplay_batch) {
        crate::GameplayReceipt::Accepted(receipt) => receipt,
        crate::GameplayReceipt::Rejected { rejection, .. } => return Err(rejection),
    };
    let stack = staged
        .state
        .inventory
        .containers
        .get(&custody_container)
        .and_then(|container| container.slots.first())
        .and_then(Option::as_ref)
        .cloned()
        .ok_or_else(|| invalid("accepted drop-custody command did not materialize its item"))?;
    if stack.count != 1 {
        return Err(invalid("drop custody must contain exactly one item"));
    }

    let drop = DroppedItemSpatialV1 {
        drop_id: request.drop_id.clone(),
        revision: 0,
        entity_id: request.drop_entity_id,
        container: custody_container.clone(),
        slot: 0,
        bound_container_revision: 0,
        position: request.position,
        velocity_milli_per_second: request.velocity_milli_per_second,
        rotation: request.rotation,
        created_tick: world_view.tick,
        expires_tick: request.expires_tick,
        pickup_lock_actor_id: request.pickup_lock_actor_id.clone(),
        pickup_unlock_tick: request.pickup_unlock_tick,
    };
    drop.validate_shape()?;
    validate_drop_inventory_link(&drop, &staged.state)?;
    world_view.validate_against_gameplay(&staged.state)?;
    let before_gameplay_identity = gameplay_receipt.before.clone();
    let after_gameplay_identity = gameplay_receipt.after.clone();
    let transaction_hash = player_drop_transaction_hash(request_hash, gameplay_receipt.receipt_hash, &drop, &stack);
    Ok(StagedPlayerDropV1 {
        gameplay: staged,
        gameplay_receipt,
        before_gameplay_identity,
        after_gameplay_identity,
        drop,
        stack,
        source_container,
        custody_container,
        transaction_hash,
    })
}

fn player_drop_transaction_hash(
    request_hash: CanonicalHash,
    gameplay_receipt_hash: CanonicalHash,
    drop: &DroppedItemSpatialV1,
    stack: &ItemStack,
) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild.gameplay.world-view.player-drop.transaction.v1");
    hasher.write_bytes(request_hash.as_bytes());
    hasher.write_bytes(gameplay_receipt_hash.as_bytes());
    drop.hash_into(&mut hasher);
    stack.hash_into(&mut hasher);
    hasher.finish()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewIdentityV1 {
    pub world: WorldKey,
    pub revision: WorldViewRevisionV1,
    pub state_hash: CanonicalHash,
}

impl WorldViewIdentityV1 {
    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        self.world.hash_into(hasher);
        self.revision.hash_into(hasher);
        hasher.write_bytes(self.state_hash.as_bytes());
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum WorldViewDomainV1 {
    Clock,
    MachineAnchors,
    DroppedItems,
    PlayerBindings,
    Environment,
    AtmosphereGravity,
    Celestial,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum WorldViewScopeV1 {
    MachineAnchors,
    DroppedItems,
    PlayerBindingSelf,
    PlayerBindingAny,
    Environment,
    System,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewActorGrantV1 {
    pub player_id: Option<PlayerId>,
    pub entity_id: Option<EntityId>,
    pub role: ActorRole,
    pub scopes: BTreeSet<WorldViewScopeV1>,
}

impl WorldViewActorGrantV1 {
    #[must_use]
    pub fn system() -> Self {
        Self {
            player_id: None,
            entity_id: None,
            role: ActorRole::System,
            scopes: BTreeSet::from([WorldViewScopeV1::System]),
        }
    }

    #[must_use]
    pub fn player(player_id: PlayerId, entity_id: EntityId) -> Self {
        Self {
            player_id: Some(player_id),
            entity_id: Some(entity_id),
            role: ActorRole::Host,
            scopes: BTreeSet::from([WorldViewScopeV1::PlayerBindingSelf]),
        }
    }

    fn validate(&self) -> Result<(), Rejection> {
        if self.scopes.is_empty()
            || self.player_id.is_some_and(|id| id.packed() == 0)
            || self.entity_id.is_some_and(|id| id.packed() == 0)
        {
            return Err(Rejection::new(
                RejectionCode::Unauthorized,
                "world-view grant is empty or malformed",
            ));
        }
        match self.role {
            ActorRole::System
                if self.player_id.is_some()
                    || self.entity_id.is_some()
                    || !self.scopes.contains(&WorldViewScopeV1::System) =>
            {
                Err(Rejection::new(
                    RejectionCode::Unauthorized,
                    "system world-view grant cannot impersonate a player",
                ))
            }
            ActorRole::Guest | ActorRole::Agent if self.player_id.is_none() || self.entity_id.is_none() => {
                Err(Rejection::new(
                    RejectionCode::Unauthorized,
                    "guest and agent world-view grants require player and entity identities",
                ))
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum DropRemovalReasonV1 {
    PickedUp,
    Expired,
    Destroyed,
    ContainerRemoved,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorldViewCommandV1 {
    AdvanceTick {
        expected_tick: u64,
        to_tick: u64,
    },
    UpsertMachineAnchor {
        expected_revision: Option<u64>,
        anchor: MachineSpatialAnchorV1,
    },
    RemoveMachineAnchor {
        machine_id: String,
        expected_revision: u64,
    },
    RegisterDrop {
        drop: DroppedItemSpatialV1,
    },
    UpdateDropTransform {
        drop_id: String,
        expected_revision: u64,
        position: FixedWorldVec3V1,
        velocity_milli_per_second: FixedWorldVec3V1,
        rotation: RotationMicroturnsV1,
    },
    RelinkDropInventory {
        drop_id: String,
        expected_revision: u64,
        container: ContainerKey,
        slot: u16,
        bound_container_revision: u64,
    },
    SetDropPickupLock {
        drop_id: String,
        expected_revision: u64,
        pickup_lock_actor_id: Option<String>,
        pickup_unlock_tick: u64,
    },
    RemoveDrop {
        drop_id: String,
        expected_revision: u64,
        reason: DropRemovalReasonV1,
    },
    UpsertPlayerBinding {
        expected_revision: Option<u64>,
        binding: PlayerInventoryBindingV1,
    },
    SelectPlayerSlot {
        player_id: PlayerId,
        expected_revision: u64,
        selected_slot: u16,
    },
    RemovePlayerBinding {
        player_id: PlayerId,
        expected_revision: u64,
    },
    SetEnvironment {
        expected_revision: u64,
        environment: EnvironmentLightingStateV1,
    },
    SetAtmosphereGravity {
        expected_revision: u64,
        atmosphere_gravity: AtmosphereGravityStateV1,
    },
    SetCelestialSky {
        expected_revision: u64,
        celestial: CelestialSkyStateV1,
    },
}

impl WorldViewCommandV1 {
    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        match self {
            Self::AdvanceTick { expected_tick, to_tick } => {
                hasher.write_u16(0);
                hasher.write_u64(*expected_tick);
                hasher.write_u64(*to_tick);
            }
            Self::UpsertMachineAnchor {
                expected_revision,
                anchor,
            } => {
                hasher.write_u16(1);
                hash_option_u64(hasher, *expected_revision);
                anchor.hash_into(hasher);
            }
            Self::RemoveMachineAnchor {
                machine_id,
                expected_revision,
            } => {
                hasher.write_u16(2);
                hasher.write_str(machine_id);
                hasher.write_u64(*expected_revision);
            }
            Self::RegisterDrop { drop } => {
                hasher.write_u16(3);
                drop.hash_into(hasher);
            }
            Self::UpdateDropTransform {
                drop_id,
                expected_revision,
                position,
                velocity_milli_per_second,
                rotation,
            } => {
                hasher.write_u16(4);
                hasher.write_str(drop_id);
                hasher.write_u64(*expected_revision);
                position.hash_into(hasher);
                velocity_milli_per_second.hash_into(hasher);
                rotation.hash_into(hasher);
            }
            Self::RelinkDropInventory {
                drop_id,
                expected_revision,
                container,
                slot,
                bound_container_revision,
            } => {
                hasher.write_u16(5);
                hasher.write_str(drop_id);
                hasher.write_u64(*expected_revision);
                container.hash_into(hasher);
                hasher.write_u16(*slot);
                hasher.write_u64(*bound_container_revision);
            }
            Self::SetDropPickupLock {
                drop_id,
                expected_revision,
                pickup_lock_actor_id,
                pickup_unlock_tick,
            } => {
                hasher.write_u16(6);
                hasher.write_str(drop_id);
                hasher.write_u64(*expected_revision);
                hash_option_str(hasher, pickup_lock_actor_id.as_deref());
                hasher.write_u64(*pickup_unlock_tick);
            }
            Self::RemoveDrop {
                drop_id,
                expected_revision,
                reason,
            } => {
                hasher.write_u16(7);
                hasher.write_str(drop_id);
                hasher.write_u64(*expected_revision);
                hasher.write_u16(*reason as u16);
            }
            Self::UpsertPlayerBinding {
                expected_revision,
                binding,
            } => {
                hasher.write_u16(8);
                hash_option_u64(hasher, *expected_revision);
                binding.hash_into(hasher);
            }
            Self::SelectPlayerSlot {
                player_id,
                expected_revision,
                selected_slot,
            } => {
                hasher.write_u16(9);
                hasher.write_u64(player_id.packed());
                hasher.write_u64(*expected_revision);
                hasher.write_u16(*selected_slot);
            }
            Self::RemovePlayerBinding {
                player_id,
                expected_revision,
            } => {
                hasher.write_u16(10);
                hasher.write_u64(player_id.packed());
                hasher.write_u64(*expected_revision);
            }
            Self::SetEnvironment {
                expected_revision,
                environment,
            } => {
                hasher.write_u16(11);
                hasher.write_u64(*expected_revision);
                environment.hash_into(hasher);
            }
            Self::SetAtmosphereGravity {
                expected_revision,
                atmosphere_gravity,
            } => {
                hasher.write_u16(12);
                hasher.write_u64(*expected_revision);
                atmosphere_gravity.hash_into(hasher);
            }
            Self::SetCelestialSky {
                expected_revision,
                celestial,
            } => {
                hasher.write_u16(13);
                hasher.write_u64(*expected_revision);
                celestial.hash_into(hasher);
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewBatchV1 {
    pub schema_version: u16,
    pub batch_id: String,
    pub idempotency_key: String,
    pub actor: GameplayActor,
    pub identity: WorldViewIdentityV1,
    pub commands: Vec<WorldViewCommandV1>,
    pub command_hash: CanonicalHash,
}

impl WorldViewBatchV1 {
    #[must_use]
    pub fn new(
        batch_id: impl Into<String>,
        idempotency_key: impl Into<String>,
        actor: GameplayActor,
        identity: WorldViewIdentityV1,
        commands: Vec<WorldViewCommandV1>,
    ) -> Self {
        let mut batch = Self {
            schema_version: WORLD_VIEW_SCHEMA_VERSION_V1,
            batch_id: batch_id.into(),
            idempotency_key: idempotency_key.into(),
            actor,
            identity,
            commands,
            command_hash: CanonicalHash::default(),
        };
        batch.command_hash = batch.calculate_command_hash();
        batch
    }

    #[must_use]
    pub fn calculate_command_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.world-view.commands.v1");
        hasher.write_u64(self.commands.len() as u64);
        for command in &self.commands {
            command.hash_into(&mut hasher);
        }
        hasher.finish()
    }

    fn validate_shape(&self) -> Result<(), Rejection> {
        if self.schema_version != WORLD_VIEW_SCHEMA_VERSION_V1 {
            return Err(invalid("unsupported world-view batch schema"));
        }
        validate_id("world-view batch", &self.batch_id)?;
        validate_id("world-view idempotency key", &self.idempotency_key)?;
        self.actor.validate_shape()?;
        self.identity.world.validate()?;
        if self.commands.is_empty() || self.commands.len() > WORLD_VIEW_MAX_COMMANDS_V1 {
            return Err(capacity("world-view command count is outside protocol bounds"));
        }
        if self.command_hash != self.calculate_command_hash() {
            return Err(invalid("world-view command hash does not match canonical commands"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewEventV1 {
    pub event_id: String,
    pub domain: WorldViewDomainV1,
    pub kind: String,
    pub record_id: Option<String>,
    pub record_revision: Option<u64>,
}

impl WorldViewEventV1 {
    fn validate(&self) -> Result<(), Rejection> {
        validate_id("world-view event", &self.event_id)?;
        validate_id("world-view event kind", &self.kind)?;
        if let Some(record_id) = &self.record_id {
            validate_id("world-view event record", record_id)?;
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_str(&self.event_id);
        hasher.write_u16(self.domain as u16);
        hasher.write_str(&self.kind);
        hash_option_str(hasher, self.record_id.as_deref());
        hash_option_u64(hasher, self.record_revision);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewAcceptedReceiptV1 {
    pub batch_id: String,
    pub before: WorldViewIdentityV1,
    pub after: WorldViewIdentityV1,
    pub touched_domains: BTreeSet<WorldViewDomainV1>,
    pub events: Vec<WorldViewEventV1>,
    pub receipt_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorldViewReceiptV1 {
    Accepted(WorldViewAcceptedReceiptV1),
    Rejected {
        batch_id: String,
        identity: WorldViewIdentityV1,
        rejection: Rejection,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewReplayEntryV1 {
    pub sequence: u64,
    pub actor_id: String,
    pub idempotency_key: String,
    pub command_hash: CanonicalHash,
    pub before_hash: CanonicalHash,
    pub after_hash: CanonicalHash,
    pub receipt_hash: CanonicalHash,
}

impl WorldViewReplayEntryV1 {
    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.sequence);
        hasher.write_str(&self.actor_id);
        hasher.write_str(&self.idempotency_key);
        hasher.write_bytes(self.command_hash.as_bytes());
        hasher.write_bytes(self.before_hash.as_bytes());
        hasher.write_bytes(self.after_hash.as_bytes());
        hasher.write_bytes(self.receipt_hash.as_bytes());
    }
}

#[derive(Clone, Debug)]
pub(crate) struct WorldViewIdempotencyEntryV1 {
    pub(crate) command_hash: CanonicalHash,
    pub(crate) receipt: WorldViewAcceptedReceiptV1,
}

#[derive(Clone, Debug)]
pub(crate) struct WorldViewAuthorityPartsV1 {
    pub(crate) state: WorldViewStateV1,
    pub(crate) grants: BTreeMap<String, WorldViewActorGrantV1>,
    pub(crate) idempotency: BTreeMap<(String, String), WorldViewIdempotencyEntryV1>,
    pub(crate) idempotency_order: VecDeque<(String, String)>,
    pub(crate) replay: VecDeque<WorldViewReplayEntryV1>,
}

#[derive(Clone, Debug)]
pub struct WorldViewAuthorityV1 {
    pub state: WorldViewStateV1,
    grants: BTreeMap<String, WorldViewActorGrantV1>,
    idempotency: BTreeMap<(String, String), WorldViewIdempotencyEntryV1>,
    idempotency_order: VecDeque<(String, String)>,
    replay: VecDeque<WorldViewReplayEntryV1>,
}

impl WorldViewAuthorityV1 {
    #[must_use]
    pub fn new(state: WorldViewStateV1) -> Self {
        Self {
            state,
            grants: BTreeMap::new(),
            idempotency: BTreeMap::new(),
            idempotency_order: VecDeque::new(),
            replay: VecDeque::new(),
        }
    }

    pub fn grant_actor(&mut self, actor_id: impl Into<String>, grant: WorldViewActorGrantV1) -> Result<(), Rejection> {
        let actor_id = actor_id.into();
        validate_id("world-view actor grant", &actor_id)?;
        grant.validate()?;
        self.grants.insert(actor_id, grant);
        Ok(())
    }

    #[must_use]
    pub fn replay(&self) -> &VecDeque<WorldViewReplayEntryV1> {
        &self.replay
    }

    #[must_use]
    pub fn replay_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.world-view.replay.v1");
        hasher.write_u64(self.replay.len() as u64);
        for entry in &self.replay {
            entry.hash_into(&mut hasher);
        }
        hasher.finish()
    }

    pub(crate) fn snapshot_parts(&self) -> WorldViewAuthorityPartsV1 {
        WorldViewAuthorityPartsV1 {
            state: self.state.clone(),
            grants: self.grants.clone(),
            idempotency: self.idempotency.clone(),
            idempotency_order: self.idempotency_order.clone(),
            replay: self.replay.clone(),
        }
    }

    pub(crate) fn from_snapshot_parts(
        parts: WorldViewAuthorityPartsV1,
        gameplay: &GameplayState,
    ) -> Result<Self, Rejection> {
        parts.state.validate_against_gameplay(gameplay)?;
        if parts.idempotency.len() > WORLD_VIEW_IDEMPOTENCY_WINDOW_V1
            || parts.idempotency_order.len() > WORLD_VIEW_IDEMPOTENCY_WINDOW_V1
            || parts.replay.len() > WORLD_VIEW_REPLAY_WINDOW_V1
            || parts.idempotency.len() != parts.idempotency_order.len()
        {
            return Err(capacity("world-view snapshot history exceeds its window"));
        }
        for (actor_id, grant) in &parts.grants {
            validate_id("world-view snapshot actor grant", actor_id)?;
            grant.validate()?;
        }
        let mut ordered = BTreeSet::new();
        for key in &parts.idempotency_order {
            validate_id("world-view snapshot idempotency actor", &key.0)?;
            validate_id("world-view snapshot idempotency key", &key.1)?;
            if !ordered.insert(key.clone()) || !parts.idempotency.contains_key(key) {
                return Err(invalid("world-view idempotency order is not a unique map permutation"));
            }
        }
        if parts
            .replay
            .iter()
            .zip(parts.replay.iter().skip(1))
            .any(|(left, right)| left.sequence >= right.sequence)
        {
            return Err(invalid("world-view replay sequence is not strictly increasing"));
        }
        if let Some(last) = parts.replay.back()
            && (last.sequence != parts.state.revision.sequence || last.after_hash != parts.state.state_hash())
        {
            return Err(invalid("world-view replay tail does not identify restored state"));
        }
        for (key, entry) in &parts.idempotency {
            if !parts.replay.iter().any(|replay| {
                replay.actor_id == key.0
                    && replay.idempotency_key == key.1
                    && replay.command_hash == entry.command_hash
                    && replay.before_hash == entry.receipt.before.state_hash
                    && replay.after_hash == entry.receipt.after.state_hash
                    && replay.receipt_hash == entry.receipt.receipt_hash
            }) || calculate_receipt_hash(&entry.receipt) != entry.receipt.receipt_hash
            {
                return Err(invalid(
                    "world-view retry receipt is absent from replay or has an invalid hash",
                ));
            }
            for event in &entry.receipt.events {
                event.validate()?;
            }
        }
        Ok(Self {
            state: parts.state,
            grants: parts.grants,
            idempotency: parts.idempotency,
            idempotency_order: parts.idempotency_order,
            replay: parts.replay,
        })
    }

    pub fn apply_batch(&mut self, batch: &WorldViewBatchV1, gameplay: &GameplayState) -> WorldViewReceiptV1 {
        let current = self.state.identity();
        if let Err(rejection) = batch.validate_shape() {
            return rejected(batch, current, rejection);
        }
        let retry_key = (batch.actor.actor_id.clone(), batch.idempotency_key.clone());
        if let Some(entry) = self.idempotency.get(&retry_key) {
            if entry.command_hash == batch.command_hash {
                return WorldViewReceiptV1::Accepted(entry.receipt.clone());
            }
            return rejected(
                batch,
                current,
                Rejection::new(
                    RejectionCode::Conflict,
                    "world-view idempotency key was reused for different commands",
                ),
            );
        }
        if batch.identity.world != self.state.world || gameplay.world != self.state.world {
            return rejected(
                batch,
                current,
                Rejection::new(RejectionCode::WrongWorld, "world-view batch targets another world"),
            );
        }
        if batch.identity != current {
            return rejected(
                batch,
                current,
                Rejection::new(RejectionCode::StaleRevision, "world-view identity is stale"),
            );
        }
        let grant = match self.validate_actor(&batch.actor) {
            Ok(grant) => grant.clone(),
            Err(rejection) => return rejected(batch, current, rejection),
        };

        let before = current;
        let mut staged = self.state.clone();
        let mut touched = BTreeSet::new();
        let mut events = Vec::with_capacity(batch.commands.len());
        for (index, command) in batch.commands.iter().enumerate() {
            if let Err(rejection) = authorize_world_view_command(&batch.actor, &grant, command) {
                return rejected(batch, before, rejection);
            }
            if let Err(rejection) = dispatch_world_view_command(
                &mut staged,
                command,
                gameplay,
                &batch.batch_id,
                index,
                &mut touched,
                &mut events,
            ) {
                return rejected(batch, before, rejection);
            }
        }
        if let Err(rejection) = staged.validate_against_gameplay(gameplay) {
            return rejected(batch, before, rejection);
        }
        if let Err(rejection) = events.iter().try_for_each(WorldViewEventV1::validate) {
            return rejected(batch, before, rejection);
        }

        staged.revision.sequence = match staged.revision.sequence.checked_add(1) {
            Some(value) => value,
            None => return rejected(batch, before, capacity("world-view sequence overflow")),
        };
        for domain in &touched {
            let revision = match domain {
                WorldViewDomainV1::Clock => &mut staged.revision.clock,
                WorldViewDomainV1::MachineAnchors => &mut staged.revision.machine_anchors,
                WorldViewDomainV1::DroppedItems => &mut staged.revision.dropped_items,
                WorldViewDomainV1::PlayerBindings => &mut staged.revision.player_bindings,
                WorldViewDomainV1::Environment => &mut staged.revision.environment,
                WorldViewDomainV1::AtmosphereGravity => &mut staged.revision.atmosphere_gravity,
                WorldViewDomainV1::Celestial => &mut staged.revision.celestial,
            };
            *revision = match revision.checked_add(1) {
                Some(value) => value,
                None => return rejected(batch, before, capacity("world-view domain revision overflow")),
            };
        }
        let after = staged.identity();
        let mut receipt = WorldViewAcceptedReceiptV1 {
            batch_id: batch.batch_id.clone(),
            before: before.clone(),
            after: after.clone(),
            touched_domains: touched,
            events,
            receipt_hash: CanonicalHash::default(),
        };
        receipt.receipt_hash = calculate_receipt_hash(&receipt);
        self.state = staged;
        self.replay.push_back(WorldViewReplayEntryV1 {
            sequence: after.revision.sequence,
            actor_id: batch.actor.actor_id.clone(),
            idempotency_key: batch.idempotency_key.clone(),
            command_hash: batch.command_hash,
            before_hash: before.state_hash,
            after_hash: after.state_hash,
            receipt_hash: receipt.receipt_hash,
        });
        while self.replay.len() > WORLD_VIEW_REPLAY_WINDOW_V1 {
            self.replay.pop_front();
        }
        self.idempotency.insert(
            retry_key.clone(),
            WorldViewIdempotencyEntryV1 {
                command_hash: batch.command_hash,
                receipt: receipt.clone(),
            },
        );
        self.idempotency_order.push_back(retry_key);
        while self.idempotency_order.len() > WORLD_VIEW_IDEMPOTENCY_WINDOW_V1 {
            if let Some(expired) = self.idempotency_order.pop_front() {
                self.idempotency.remove(&expired);
            }
        }
        WorldViewReceiptV1::Accepted(receipt)
    }

    fn validate_actor(&self, actor: &GameplayActor) -> Result<&WorldViewActorGrantV1, Rejection> {
        let grant = self
            .grants
            .get(&actor.actor_id)
            .ok_or_else(|| Rejection::new(RejectionCode::Unauthorized, "actor has no world-view authority grant"))?;
        if grant.player_id != actor.player_id || grant.entity_id != actor.entity_id || grant.role != actor.role {
            return Err(Rejection::new(
                RejectionCode::Unauthorized,
                "world-view actor identity does not match authority grant",
            ));
        }
        Ok(grant)
    }
}

#[allow(clippy::too_many_arguments)]
fn dispatch_world_view_command(
    state: &mut WorldViewStateV1,
    command: &WorldViewCommandV1,
    gameplay: &GameplayState,
    batch_id: &str,
    command_index: usize,
    touched: &mut BTreeSet<WorldViewDomainV1>,
    events: &mut Vec<WorldViewEventV1>,
) -> Result<(), Rejection> {
    match command {
        WorldViewCommandV1::AdvanceTick { expected_tick, to_tick } => {
            if state.tick != *expected_tick {
                return Err(Rejection::new(
                    RejectionCode::StaleRevision,
                    "world-view tick does not match the expected tick",
                ));
            }
            if to_tick <= expected_tick {
                return Err(invalid("world-view tick advance must move strictly forward"));
            }
            state.tick = *to_tick;
            touched.insert(WorldViewDomainV1::Clock);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::Clock,
                "tick-advanced",
                None,
                None,
            );
        }
        WorldViewCommandV1::UpsertMachineAnchor {
            expected_revision,
            anchor,
        } => {
            anchor.validate()?;
            if !gameplay.machines.machines.contains_key(&anchor.machine_id) {
                return Err(invalid("machine anchor references an unknown gameplay machine"));
            }
            validate_upsert_revision(
                state
                    .machine_anchors
                    .get(&anchor.machine_id)
                    .map(|record| record.revision),
                *expected_revision,
                anchor.revision,
                "machine anchor",
            )?;
            if state.machine_anchors.len() >= WORLD_VIEW_MAX_MACHINE_ANCHORS_V1
                && !state.machine_anchors.contains_key(&anchor.machine_id)
            {
                return Err(capacity("machine anchor capacity is exhausted"));
            }
            state.machine_anchors.insert(anchor.machine_id.clone(), anchor.clone());
            touched.insert(WorldViewDomainV1::MachineAnchors);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::MachineAnchors,
                "machine-anchor-upserted",
                Some(anchor.machine_id.clone()),
                Some(anchor.revision),
            );
        }
        WorldViewCommandV1::RemoveMachineAnchor {
            machine_id,
            expected_revision,
        } => {
            validate_id("machine anchor", machine_id)?;
            let record = state
                .machine_anchors
                .get(machine_id)
                .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "machine anchor does not exist"))?;
            require_revision(record.revision, *expected_revision, "machine anchor")?;
            state.machine_anchors.remove(machine_id);
            touched.insert(WorldViewDomainV1::MachineAnchors);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::MachineAnchors,
                "machine-anchor-removed",
                Some(machine_id.clone()),
                None,
            );
        }
        WorldViewCommandV1::RegisterDrop { drop } => {
            drop.validate_shape()?;
            if drop.revision != 0 || state.dropped_items.contains_key(&drop.drop_id) {
                return Err(Rejection::new(
                    RejectionCode::Conflict,
                    "dropped item already exists or has a nonzero initial revision",
                ));
            }
            if state.dropped_items.len() >= WORLD_VIEW_MAX_DROPPED_ITEMS_V1 {
                return Err(capacity("dropped-item capacity is exhausted"));
            }
            validate_drop_inventory_link(drop, gameplay)?;
            if state.dropped_items.values().any(|record| {
                record.entity_id == drop.entity_id || record.container == drop.container && record.slot == drop.slot
            }) {
                return Err(Rejection::new(
                    RejectionCode::Conflict,
                    "dropped item entity or inventory slot is already spatially owned",
                ));
            }
            state.dropped_items.insert(drop.drop_id.clone(), drop.clone());
            touched.insert(WorldViewDomainV1::DroppedItems);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::DroppedItems,
                "drop-registered",
                Some(drop.drop_id.clone()),
                Some(0),
            );
        }
        WorldViewCommandV1::UpdateDropTransform {
            drop_id,
            expected_revision,
            position,
            velocity_milli_per_second,
            rotation,
        } => {
            position.validate_position()?;
            velocity_milli_per_second.validate_velocity()?;
            rotation.validate()?;
            let drop = state
                .dropped_items
                .get_mut(drop_id)
                .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "dropped item does not exist"))?;
            require_revision(drop.revision, *expected_revision, "dropped item")?;
            drop.position = *position;
            drop.velocity_milli_per_second = *velocity_milli_per_second;
            drop.rotation = *rotation;
            drop.revision = next_revision(drop.revision, "dropped item")?;
            let revision = drop.revision;
            touched.insert(WorldViewDomainV1::DroppedItems);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::DroppedItems,
                "drop-transform-updated",
                Some(drop_id.clone()),
                Some(revision),
            );
        }
        WorldViewCommandV1::RelinkDropInventory {
            drop_id,
            expected_revision,
            container,
            slot,
            bound_container_revision,
        } => {
            let candidate = {
                let drop = state
                    .dropped_items
                    .get(drop_id)
                    .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "dropped item does not exist"))?;
                require_revision(drop.revision, *expected_revision, "dropped item")?;
                let mut candidate = drop.clone();
                candidate.container = container.clone();
                candidate.slot = *slot;
                candidate.bound_container_revision = *bound_container_revision;
                candidate.revision = next_revision(candidate.revision, "dropped item")?;
                candidate
            };
            validate_drop_inventory_link(&candidate, gameplay)?;
            if state
                .dropped_items
                .values()
                .any(|record| record.drop_id != *drop_id && record.container == *container && record.slot == *slot)
            {
                return Err(Rejection::new(
                    RejectionCode::Conflict,
                    "inventory slot is already owned by another drop",
                ));
            }
            let revision = candidate.revision;
            state.dropped_items.insert(drop_id.clone(), candidate);
            touched.insert(WorldViewDomainV1::DroppedItems);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::DroppedItems,
                "drop-inventory-relinked",
                Some(drop_id.clone()),
                Some(revision),
            );
        }
        WorldViewCommandV1::SetDropPickupLock {
            drop_id,
            expected_revision,
            pickup_lock_actor_id,
            pickup_unlock_tick,
        } => {
            if let Some(actor_id) = pickup_lock_actor_id {
                validate_id("dropped-item pickup lock", actor_id)?;
            }
            let drop = state
                .dropped_items
                .get_mut(drop_id)
                .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "dropped item does not exist"))?;
            require_revision(drop.revision, *expected_revision, "dropped item")?;
            if *pickup_unlock_tick < state.tick
                || pickup_unlock_tick.saturating_sub(drop.created_tick) > WORLD_VIEW_MAX_PICKUP_LOCK_TICKS_V1
                || drop
                    .expires_tick
                    .is_some_and(|expires_tick| *pickup_unlock_tick > expires_tick)
            {
                return Err(invalid(
                    "dropped-item pickup unlock must be current, bounded, and precede expiry",
                ));
            }
            drop.pickup_lock_actor_id.clone_from(pickup_lock_actor_id);
            drop.pickup_unlock_tick = *pickup_unlock_tick;
            drop.revision = next_revision(drop.revision, "dropped item")?;
            let revision = drop.revision;
            touched.insert(WorldViewDomainV1::DroppedItems);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::DroppedItems,
                "drop-pickup-lock-updated",
                Some(drop_id.clone()),
                Some(revision),
            );
        }
        WorldViewCommandV1::RemoveDrop {
            drop_id,
            expected_revision,
            reason,
        } => {
            let drop = state
                .dropped_items
                .get(drop_id)
                .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "dropped item does not exist"))?;
            require_revision(drop.revision, *expected_revision, "dropped item")?;
            if *reason == DropRemovalReasonV1::ContainerRemoved {
                if gameplay.inventory.containers.contains_key(&drop.container) {
                    return Err(Rejection::new(
                        RejectionCode::Conflict,
                        "container-removed drop event requires custody to be absent from staged gameplay",
                    ));
                }
            } else if drop_slot_contains_item(drop, gameplay) {
                return Err(Rejection::new(
                    RejectionCode::Conflict,
                    "dropped-item spatial ownership cannot be removed while its inventory slot still contains an item",
                ));
            }
            state.dropped_items.remove(drop_id);
            touched.insert(WorldViewDomainV1::DroppedItems);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::DroppedItems,
                "drop-removed",
                Some(drop_id.clone()),
                None,
            );
        }
        WorldViewCommandV1::UpsertPlayerBinding {
            expected_revision,
            binding,
        } => {
            binding.validate_shape()?;
            validate_upsert_revision(
                state
                    .player_bindings
                    .get(&binding.player_id)
                    .map(|record| record.revision),
                *expected_revision,
                binding.revision,
                "player inventory binding",
            )?;
            validate_player_inventory_link(binding, gameplay)?;
            if state.player_bindings.len() >= WORLD_VIEW_MAX_PLAYER_BINDINGS_V1
                && !state.player_bindings.contains_key(&binding.player_id)
            {
                return Err(capacity("player-binding capacity is exhausted"));
            }
            if state.player_bindings.values().any(|record| {
                record.player_id != binding.player_id
                    && (record.actor_id == binding.actor_id
                        || record.entity_id == binding.entity_id
                        || record.inventory_container == binding.inventory_container
                        || record.equipment_container == binding.equipment_container)
            }) {
                return Err(Rejection::new(
                    RejectionCode::Conflict,
                    "player binding actor, entity, or container is already bound",
                ));
            }
            state.player_bindings.insert(binding.player_id, binding.clone());
            touched.insert(WorldViewDomainV1::PlayerBindings);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::PlayerBindings,
                "player-inventory-bound",
                Some(binding.actor_id.clone()),
                Some(binding.revision),
            );
        }
        WorldViewCommandV1::SelectPlayerSlot {
            player_id,
            expected_revision,
            selected_slot,
        } => {
            let binding = state.player_bindings.get_mut(player_id).ok_or_else(|| {
                Rejection::new(RejectionCode::InvalidTarget, "player inventory binding does not exist")
            })?;
            require_revision(binding.revision, *expected_revision, "player inventory binding")?;
            let inventory = gameplay
                .inventory
                .containers
                .get(&binding.inventory_container)
                .ok_or_else(|| invalid("bound player inventory does not exist"))?;
            if usize::from(*selected_slot) >= inventory.slots.len() {
                return Err(invalid("selected player slot is outside the bound inventory"));
            }
            binding.selected_slot = *selected_slot;
            binding.revision = next_revision(binding.revision, "player inventory binding")?;
            let revision = binding.revision;
            touched.insert(WorldViewDomainV1::PlayerBindings);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::PlayerBindings,
                "player-slot-selected",
                Some(binding.actor_id.clone()),
                Some(revision),
            );
        }
        WorldViewCommandV1::RemovePlayerBinding {
            player_id,
            expected_revision,
        } => {
            let binding = state.player_bindings.get(player_id).ok_or_else(|| {
                Rejection::new(RejectionCode::InvalidTarget, "player inventory binding does not exist")
            })?;
            require_revision(binding.revision, *expected_revision, "player inventory binding")?;
            let actor_id = binding.actor_id.clone();
            state.player_bindings.remove(player_id);
            touched.insert(WorldViewDomainV1::PlayerBindings);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::PlayerBindings,
                "player-inventory-unbound",
                Some(actor_id),
                None,
            );
        }
        WorldViewCommandV1::SetEnvironment {
            expected_revision,
            environment,
        } => {
            require_revision(state.environment.revision, *expected_revision, "environment")?;
            if environment.revision != next_revision(*expected_revision, "environment")? {
                return Err(invalid(
                    "replacement environment revision is not the canonical successor",
                ));
            }
            environment.validate(state.tick)?;
            state.environment = environment.clone();
            touched.insert(WorldViewDomainV1::Environment);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::Environment,
                "environment-updated",
                None,
                Some(environment.revision),
            );
        }
        WorldViewCommandV1::SetAtmosphereGravity {
            expected_revision,
            atmosphere_gravity,
        } => {
            require_revision(
                state.atmosphere_gravity.revision,
                *expected_revision,
                "atmosphere and gravity",
            )?;
            if atmosphere_gravity.revision != next_revision(*expected_revision, "atmosphere and gravity")? {
                return Err(invalid(
                    "replacement atmosphere revision is not the canonical successor",
                ));
            }
            atmosphere_gravity.validate()?;
            state.atmosphere_gravity = atmosphere_gravity.clone();
            touched.insert(WorldViewDomainV1::AtmosphereGravity);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::AtmosphereGravity,
                "atmosphere-gravity-updated",
                None,
                Some(atmosphere_gravity.revision),
            );
        }
        WorldViewCommandV1::SetCelestialSky {
            expected_revision,
            celestial,
        } => {
            require_revision(state.celestial.revision, *expected_revision, "celestial sky")?;
            if celestial.revision != next_revision(*expected_revision, "celestial sky")? {
                return Err(invalid("replacement celestial revision is not the canonical successor"));
            }
            celestial.validate(state.tick)?;
            state.celestial = celestial.clone();
            touched.insert(WorldViewDomainV1::Celestial);
            push_event(
                events,
                batch_id,
                command_index,
                WorldViewDomainV1::Celestial,
                "celestial-sky-updated",
                None,
                Some(celestial.revision),
            );
        }
    }
    Ok(())
}

fn authorize_world_view_command(
    actor: &GameplayActor,
    grant: &WorldViewActorGrantV1,
    command: &WorldViewCommandV1,
) -> Result<(), Rejection> {
    if matches!(command, WorldViewCommandV1::AdvanceTick { .. }) {
        if actor.role == ActorRole::System
            && grant.role == ActorRole::System
            && grant.scopes.contains(&WorldViewScopeV1::System)
        {
            return Ok(());
        }
        return Err(Rejection::new(
            RejectionCode::Unauthorized,
            "world-view tick advance requires the system actor",
        ));
    }
    if grant.scopes.contains(&WorldViewScopeV1::System) {
        return Ok(());
    }
    let required = match command {
        WorldViewCommandV1::SetEnvironment { .. }
        | WorldViewCommandV1::SetAtmosphereGravity { .. }
        | WorldViewCommandV1::SetCelestialSky { .. } => WorldViewScopeV1::Environment,
        WorldViewCommandV1::UpsertMachineAnchor { .. } | WorldViewCommandV1::RemoveMachineAnchor { .. } => {
            WorldViewScopeV1::MachineAnchors
        }
        WorldViewCommandV1::RegisterDrop { .. }
        | WorldViewCommandV1::UpdateDropTransform { .. }
        | WorldViewCommandV1::RelinkDropInventory { .. }
        | WorldViewCommandV1::SetDropPickupLock { .. }
        | WorldViewCommandV1::RemoveDrop { .. } => WorldViewScopeV1::DroppedItems,
        WorldViewCommandV1::UpsertPlayerBinding { .. } | WorldViewCommandV1::RemovePlayerBinding { .. } => {
            WorldViewScopeV1::PlayerBindingAny
        }
        WorldViewCommandV1::SelectPlayerSlot { player_id, .. } => {
            if grant.scopes.contains(&WorldViewScopeV1::PlayerBindingAny) {
                return Ok(());
            }
            if grant.player_id == Some(*player_id)
                && actor.player_id == Some(*player_id)
                && grant.scopes.contains(&WorldViewScopeV1::PlayerBindingSelf)
            {
                return Ok(());
            }
            WorldViewScopeV1::PlayerBindingSelf
        }
        WorldViewCommandV1::AdvanceTick { .. } => {
            unreachable!("world-view clock authorization returned above")
        }
    };
    if !grant.scopes.contains(&required) {
        return Err(Rejection::new(
            RejectionCode::Unauthorized,
            "actor lacks the required world-view authority scope",
        ));
    }
    Ok(())
}

fn validate_drop_inventory_link(drop: &DroppedItemSpatialV1, gameplay: &GameplayState) -> Result<(), Rejection> {
    let container = gameplay
        .inventory
        .containers
        .get(&drop.container)
        .ok_or_else(|| invalid("dropped item references an unknown inventory container"))?;
    if container.revision != drop.bound_container_revision {
        return Err(Rejection::new(
            RejectionCode::StaleRevision,
            "dropped-item container revision is stale",
        ));
    }
    if container.slots.get(usize::from(drop.slot)).is_none_or(Option::is_none) {
        return Err(invalid(
            "dropped item references an empty or out-of-range inventory slot",
        ));
    }
    Ok(())
}

fn drop_slot_contains_item(drop: &DroppedItemSpatialV1, gameplay: &GameplayState) -> bool {
    gameplay
        .inventory
        .containers
        .get(&drop.container)
        .and_then(|container| container.slots.get(usize::from(drop.slot)))
        .is_some_and(Option::is_some)
}

fn validate_player_inventory_link(
    binding: &PlayerInventoryBindingV1,
    gameplay: &GameplayState,
) -> Result<(), Rejection> {
    let inventory = gameplay
        .inventory
        .containers
        .get(&binding.inventory_container)
        .ok_or_else(|| invalid("player binding references an unknown inventory container"))?;
    let equipment = gameplay
        .inventory
        .containers
        .get(&binding.equipment_container)
        .ok_or_else(|| invalid("player binding references an unknown equipment container"))?;
    if usize::from(binding.selected_slot) >= inventory.slots.len() {
        return Err(invalid("player selected slot is outside the bound inventory"));
    }
    if let Some(back_slot) = binding.back_slot {
        let slot = usize::from(back_slot);
        if slot >= equipment.slots.len() || equipment.equipment_tags[slot].as_deref() != Some("back") {
            return Err(invalid(
                "player back slot is absent or does not carry the back equipment tag",
            ));
        }
    }
    Ok(())
}

fn validate_upsert_revision(
    current: Option<u64>,
    expected: Option<u64>,
    replacement: u64,
    record: &str,
) -> Result<(), Rejection> {
    match (current, expected) {
        (None, None) if replacement == 0 => Ok(()),
        (Some(current), Some(expected)) if current == expected => {
            let next = next_revision(current, record)?;
            if replacement == next {
                Ok(())
            } else {
                Err(invalid(format!(
                    "replacement {record} revision is not the canonical successor"
                )))
            }
        }
        (None, Some(_)) | (Some(_), None) => Err(Rejection::new(
            RejectionCode::Conflict,
            format!("{record} create/update expectation does not match current state"),
        )),
        (Some(_), Some(_)) => Err(Rejection::new(
            RejectionCode::StaleRevision,
            format!("{record} revision is stale"),
        )),
        (None, None) => Err(invalid(format!("new {record} must start at revision zero"))),
    }
}

fn require_revision(current: u64, expected: u64, record: &str) -> Result<(), Rejection> {
    if current != expected {
        return Err(Rejection::new(
            RejectionCode::StaleRevision,
            format!("{record} revision is stale"),
        ));
    }
    Ok(())
}

fn next_revision(current: u64, record: &str) -> Result<u64, Rejection> {
    current
        .checked_add(1)
        .ok_or_else(|| capacity(format!("{record} revision overflow")))
}

#[allow(clippy::too_many_arguments)]
fn push_event(
    events: &mut Vec<WorldViewEventV1>,
    batch_id: &str,
    command_index: usize,
    domain: WorldViewDomainV1,
    kind: &str,
    record_id: Option<String>,
    record_revision: Option<u64>,
) {
    events.push(WorldViewEventV1 {
        event_id: format!("{batch_id}:{command_index}"),
        domain,
        kind: kind.to_owned(),
        record_id,
        record_revision,
    });
}

fn calculate_receipt_hash(receipt: &WorldViewAcceptedReceiptV1) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild.gameplay.world-view.receipt.v1");
    hasher.write_str(&receipt.batch_id);
    receipt.before.hash_into(&mut hasher);
    receipt.after.hash_into(&mut hasher);
    hasher.write_u64(receipt.touched_domains.len() as u64);
    for domain in &receipt.touched_domains {
        hasher.write_u16(*domain as u16);
    }
    hasher.write_u64(receipt.events.len() as u64);
    for event in &receipt.events {
        event.hash_into(&mut hasher);
    }
    hasher.finish()
}

fn rejected(batch: &WorldViewBatchV1, identity: WorldViewIdentityV1, rejection: Rejection) -> WorldViewReceiptV1 {
    WorldViewReceiptV1::Rejected {
        batch_id: batch.batch_id.clone(),
        identity,
        rejection,
    }
}

fn hash_option<T>(hasher: &mut CanonicalHasher, value: Option<&T>, hash: impl Fn(&T, &mut CanonicalHasher)) {
    match value {
        Some(value) => {
            hasher.write_u16(1);
            hash(value, hasher);
        }
        None => hasher.write_u16(0),
    }
}

fn hash_option_str(hasher: &mut CanonicalHasher, value: Option<&str>) {
    match value {
        Some(value) => {
            hasher.write_u16(1);
            hasher.write_str(value);
        }
        None => hasher.write_u16(0),
    }
}

fn hash_option_u64(hasher: &mut CanonicalHasher, value: Option<u64>) {
    match value {
        Some(value) => {
            hasher.write_u16(1);
            hasher.write_u64(value);
        }
        None => hasher.write_u16(0),
    }
}

fn invalid(message: impl Into<String>) -> Rejection {
    Rejection::new(RejectionCode::InvalidCommand, message)
}

fn capacity(message: impl Into<String>) -> Rejection {
    Rejection::new(RejectionCode::Capacity, message)
}
