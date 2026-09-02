use std::collections::BTreeMap;

use blockwild_types::EntityId;

use crate::{EntityCompatibilityRecord, ProtectionState, Vec3};

pub const MAX_COMPONENT_KEY_BYTES: usize = 128;
pub const MAX_COMPONENT_TEXT_BYTES: usize = 4_096;
pub const MAX_COMPONENT_MAP_ENTRIES: usize = 128;
pub const MAX_ROUTE_POINTS: usize = 256;
pub const MAX_THREATS: usize = 64;
pub const MAX_MOUNT_SEATS: usize = 8;
pub const MAX_UNKNOWN_EXTENSION_BYTES: usize = 1_048_576;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum MovementMode {
    Ground = 0,
    Swim = 1,
    Fly = 2,
    Burrow = 3,
    Climb = 4,
    Mounted = 5,
    KnockedBack = 6,
    Disabled = 7,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum BodyShape {
    Capsule = 0,
    Box = 1,
    Sphere = 2,
    Serpentine = 3,
    Flying = 4,
    Aquatic = 5,
}

#[derive(Clone, Debug, PartialEq)]
pub struct VitalsEnvironment {
    pub health: f32,
    pub maximum_health: f32,
    pub hunger_milli: u16,
    pub saturation_milli: u16,
    pub oxygen_milli: u16,
    pub temperature_milli: i16,
    pub wetness_milli: u16,
    pub environment_flags: u32,
    pub last_damage_tick: u64,
    pub last_breath_tick: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ActionState {
    pub key: String,
    pub phase: u16,
    pub started_tick: u64,
    pub ends_tick: u64,
    pub target: Option<EntityId>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocomotionBody {
    pub shape: BodyShape,
    pub radius: f32,
    pub half_height: f32,
    pub mass: f32,
    pub step_height: f32,
    pub velocity: Vec3,
    pub desired_velocity: Vec3,
    pub grounded: bool,
    pub submerged: bool,
    pub movement_mode: MovementMode,
    pub action: ActionState,
    pub cooldowns: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BlackboardValue {
    Bool(bool),
    Signed(i64),
    Unsigned(u64),
    FixedMilli(i64),
    Text(String),
    Entity(EntityId),
    Bytes(Vec<u8>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum AiIntentKind {
    Idle = 0,
    Wander = 1,
    Graze = 2,
    Flee = 3,
    Pursue = 4,
    Attack = 5,
    Follow = 6,
    Work = 7,
    ReturnHome = 8,
    Scripted = 9,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThreatMemory {
    pub entity: EntityId,
    pub score_milli: u32,
    pub last_seen_tick: u64,
    pub last_known_cell: [i32; 3],
}

#[derive(Clone, Debug, PartialEq)]
pub struct AiState {
    pub intent: AiIntentKind,
    pub intent_key: String,
    pub target: Option<EntityId>,
    pub home: Vec3,
    pub blackboard: BTreeMap<String, BlackboardValue>,
    pub route_epoch: u64,
    pub route_cursor: u16,
    pub route: Vec<Vec3>,
    pub threats: Vec<ThreatMemory>,
    pub decision_due_tick: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SocialFollowerState {
    pub group_id: Option<String>,
    pub leader: Option<EntityId>,
    pub following: Option<EntityId>,
    pub herd_rank: i16,
    pub disposition_milli: i16,
    pub preferred_separation: f32,
    pub last_social_tick: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MountSeat {
    pub index: u8,
    pub role: String,
    pub offset: Vec3,
    pub occupant: Option<EntityId>,
    pub control_weight_milli: u16,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MountState {
    pub parent_mount: Option<EntityId>,
    pub occupied_seat: Option<u8>,
    pub seats: Vec<MountSeat>,
    pub saddle_key: Option<String>,
    pub accepts_riders: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtectionProvenance {
    pub flags: ProtectionState,
    pub first_owned_tick: Option<u64>,
    pub first_led_tick: Option<u64>,
    pub enclosure_verified_tick: Option<u64>,
    pub named_tick: Option<u64>,
    pub provenance_key: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkAuthorityState {
    pub owner_peer_id: Option<String>,
    pub last_command_sequence: u64,
    pub last_command_tick: u64,
    pub lease_epoch: u64,
    pub lease_expires_tick: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CareState {
    pub stabilized: bool,
    pub nourishment_milli: u16,
    pub trust_milli: u16,
    pub care_stage: u16,
    pub last_care_tick: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HusbandryState {
    pub sex: u8,
    pub maturity_milli: u16,
    pub breed_cooldown_until_tick: u64,
    pub gestation_until_tick: u64,
    pub parent_specimen_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkState {
    pub task_key: String,
    pub progress_milli: u16,
    pub target_entity: Option<EntityId>,
    pub target_cell: Option<[i32; 3]>,
    pub carrying_item_key: Option<String>,
    pub due_tick: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EquipmentSlotState {
    pub item_key: String,
    pub count: u16,
    pub durability: u32,
    pub custom: BTreeMap<String, Vec<u8>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DragonState {
    pub lineage_key: String,
    pub element_key: String,
    pub life_stage: u16,
    pub flight_stamina_milli: u16,
    pub breath_charge_milli: u16,
    pub egg_or_hatchling: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegendaryState {
    pub encounter_key: String,
    pub phase: u16,
    pub defeated: bool,
    pub capture_lock_until_tick: u64,
    pub world_flags: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SummonState {
    pub origin_realm_key: String,
    pub summoner_id: Option<String>,
    pub expires_tick: u64,
    pub grounded: bool,
    pub grounding_item_key: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SentientState {
    pub faction_id: Option<String>,
    pub settlement_id: Option<String>,
    pub occupation_key: String,
    pub dialogue_state: BTreeMap<String, u32>,
    pub reputation_milli: i32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EntityComponents {
    pub vitals: VitalsEnvironment,
    pub locomotion: LocomotionBody,
    pub ai: AiState,
    pub social: SocialFollowerState,
    pub mount: MountState,
    pub protection: ProtectionProvenance,
    pub network: NetworkAuthorityState,
    pub care: Option<CareState>,
    pub husbandry: Option<HusbandryState>,
    pub work: Option<WorkState>,
    pub equipment: BTreeMap<String, EquipmentSlotState>,
    pub dragon: Option<DragonState>,
    pub legendary: Option<LegendaryState>,
    pub summon: Option<SummonState>,
    pub sentient: Option<SentientState>,
    /// Forward-compatible authored components are byte-exact and never interpreted.
    pub unknown_extensions: BTreeMap<String, Vec<u8>>,
}

impl EntityComponents {
    #[must_use]
    pub fn from_compatibility(record: &EntityCompatibilityRecord, protection: ProtectionState) -> Self {
        let mut flags = protection;
        if record.tamed {
            flags.insert(ProtectionState::TAMED);
        }
        if record.owner_id.is_some() {
            flags.insert(ProtectionState::OWNED);
        }
        if record.ever_led {
            flags.insert(ProtectionState::EVER_LED);
        }
        if record.name.is_some() {
            flags.insert(ProtectionState::NAMED);
        }
        Self {
            vitals: VitalsEnvironment {
                health: record.health,
                maximum_health: record.maximum_health,
                hunger_milli: 10_000,
                saturation_milli: 10_000,
                oxygen_milli: 10_000,
                temperature_milli: 0,
                wetness_milli: 0,
                environment_flags: 0,
                last_damage_tick: 0,
                last_breath_tick: 0,
            },
            locomotion: LocomotionBody {
                shape: BodyShape::Capsule,
                radius: 0.45,
                half_height: 0.72,
                mass: 1.0,
                step_height: 1.05,
                velocity: record.velocity,
                desired_velocity: Vec3::ZERO,
                grounded: compatibility_bool(record, "physics.grounded", true),
                submerged: compatibility_bool(record, "physics.inLiquid", false),
                movement_mode: MovementMode::Ground,
                action: ActionState {
                    key: "idle".to_owned(),
                    phase: 0,
                    started_tick: record.age_ticks,
                    ends_tick: 0,
                    target: None,
                },
                cooldowns: BTreeMap::new(),
            },
            ai: AiState {
                intent: AiIntentKind::Idle,
                intent_key: "idle".to_owned(),
                target: None,
                home: record.position,
                blackboard: BTreeMap::new(),
                route_epoch: 0,
                route_cursor: 0,
                route: Vec::new(),
                threats: Vec::new(),
                decision_due_tick: 0,
            },
            social: SocialFollowerState {
                group_id: record.social_group_id.clone(),
                leader: None,
                following: None,
                herd_rank: 0,
                disposition_milli: 0,
                preferred_separation: 1.0,
                last_social_tick: 0,
            },
            mount: MountState {
                parent_mount: None,
                occupied_seat: None,
                seats: Vec::new(),
                saddle_key: record.equipment.get("saddle").cloned(),
                accepts_riders: record.equipment.contains_key("saddle"),
            },
            protection: ProtectionProvenance {
                flags,
                first_owned_tick: record.owner_id.as_ref().map(|_| 0),
                first_led_tick: record.ever_led.then_some(0),
                enclosure_verified_tick: None,
                named_tick: record.name.as_ref().map(|_| 0),
                provenance_key: None,
            },
            network: NetworkAuthorityState {
                owner_peer_id: record.owner_id.clone(),
                last_command_sequence: 0,
                last_command_tick: 0,
                lease_epoch: 0,
                lease_expires_tick: 0,
            },
            care: (record.tamed || record.bond_points > 0).then_some(CareState {
                stabilized: record.tamed,
                nourishment_milli: 10_000,
                trust_milli: u16::try_from(record.bond_points.min(10_000)).unwrap_or(10_000),
                care_stage: u16::from(record.tamed),
                last_care_tick: 0,
            }),
            husbandry: None,
            work: None,
            equipment: record
                .equipment
                .iter()
                .map(|(slot, item)| {
                    (
                        slot.clone(),
                        EquipmentSlotState {
                            item_key: item.clone(),
                            count: 1,
                            durability: 0,
                            custom: BTreeMap::new(),
                        },
                    )
                })
                .collect(),
            dragon: None,
            legendary: None,
            summon: None,
            sentient: None,
            unknown_extensions: BTreeMap::new(),
        }
    }

    pub(crate) fn synchronize_compatibility_physics(&mut self, record: &EntityCompatibilityRecord) {
        self.locomotion.grounded = compatibility_bool(record, "physics.grounded", self.locomotion.grounded);
        self.locomotion.submerged = compatibility_bool(record, "physics.inLiquid", self.locomotion.submerged);
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if !self.vitals.health.is_finite()
            || !self.vitals.maximum_health.is_finite()
            || self.vitals.maximum_health <= 0.0
            || self.vitals.health < 0.0
            || self.vitals.health > self.vitals.maximum_health
        {
            return Err("component health is outside its valid range");
        }
        if [
            self.vitals.hunger_milli,
            self.vitals.saturation_milli,
            self.vitals.oxygen_milli,
            self.vitals.wetness_milli,
        ]
        .into_iter()
        .any(|value| value > 10_000)
        {
            return Err("environment meter exceeds 10000 milli-units");
        }
        if !self.locomotion.velocity.is_finite()
            || !self.locomotion.desired_velocity.is_finite()
            || !self.ai.home.is_finite()
            || !self.locomotion.radius.is_finite()
            || !self.locomotion.half_height.is_finite()
            || !self.locomotion.mass.is_finite()
            || !self.locomotion.step_height.is_finite()
            || self.locomotion.radius <= 0.0
            || self.locomotion.half_height <= 0.0
            || self.locomotion.mass <= 0.0
            || self.locomotion.step_height < 0.0
        {
            return Err("locomotion body is invalid");
        }
        if self.ai.route.len() > MAX_ROUTE_POINTS
            || self.ai.route.iter().any(|point| !point.is_finite())
            || usize::from(self.ai.route_cursor) > self.ai.route.len()
            || self.ai.threats.len() > MAX_THREATS
            || self.ai.threats.windows(2).any(|pair| pair[0].entity >= pair[1].entity)
        {
            return Err("AI route or threat state exceeds bounds");
        }
        if self.mount.seats.len() > MAX_MOUNT_SEATS
            || self.mount.seats.windows(2).any(|pair| pair[0].index >= pair[1].index)
            || self.mount.seats.iter().any(|seat| !seat.offset.is_finite())
            || !self.social.preferred_separation.is_finite()
            || self.social.preferred_separation < 0.0
        {
            return Err("social or mount state is invalid");
        }
        for id in self
            .locomotion
            .action
            .target
            .iter()
            .chain(self.ai.target.iter())
            .chain(self.social.leader.iter())
            .chain(self.social.following.iter())
            .chain(self.mount.parent_mount.iter())
            .chain(self.mount.seats.iter().filter_map(|seat| seat.occupant.as_ref()))
            .chain(self.work.iter().filter_map(|work| work.target_entity.as_ref()))
        {
            if id.0.index() == 0 || id.0.generation() == 0 {
                return Err("component reference uses a reserved entity ID");
            }
        }
        if self
            .ai
            .threats
            .iter()
            .any(|threat| threat.entity.0.index() == 0 || threat.entity.0.generation() == 0)
        {
            return Err("threat memory uses a reserved entity ID");
        }
        if self
            .mount
            .occupied_seat
            .is_some_and(|index| !self.mount.seats.iter().any(|seat| seat.index == index))
        {
            return Err("occupied mount seat does not exist");
        }
        check_key(&self.locomotion.action.key)?;
        check_key(&self.ai.intent_key)?;
        check_map(&self.locomotion.cooldowns)?;
        check_map(&self.ai.blackboard)?;
        check_map(&self.equipment)?;
        check_map(&self.unknown_extensions)?;
        let mut unknown_bytes = 0usize;
        for value in self.unknown_extensions.values() {
            unknown_bytes = unknown_bytes
                .checked_add(value.len())
                .ok_or("extension bytes overflow")?;
        }
        if unknown_bytes > MAX_UNKNOWN_EXTENSION_BYTES {
            return Err("unknown extension bytes exceed bound");
        }
        for (key, value) in &self.ai.blackboard {
            check_key(key)?;
            match value {
                BlackboardValue::Text(value) => check_text(value)?,
                BlackboardValue::Bytes(value) if value.len() > MAX_COMPONENT_TEXT_BYTES => {
                    return Err("blackboard byte value exceeds bound");
                }
                _ => {}
            }
        }
        for (slot, equipment) in &self.equipment {
            check_key(slot)?;
            check_key(&equipment.item_key)?;
            if equipment.item_key.is_empty() || equipment.count == 0 {
                return Err("equipment item and count must be non-empty");
            }
            check_map(&equipment.custom)?;
            if equipment
                .custom
                .values()
                .any(|value| value.len() > MAX_COMPONENT_TEXT_BYTES)
            {
                return Err("equipment extension bytes exceed bound");
            }
        }
        for seat in &self.mount.seats {
            check_key(&seat.role)?;
        }
        for value in self
            .social
            .group_id
            .iter()
            .chain(self.mount.saddle_key.iter())
            .chain(self.protection.provenance_key.iter())
            .chain(self.network.owner_peer_id.iter())
        {
            check_text(value)?;
        }
        if let Some(state) = &self.husbandry {
            if state.parent_specimen_ids.len() > 2 || state.sex > 2 || state.maturity_milli > 10_000 {
                return Err("husbandry parent list exceeds bound");
            }
            for value in &state.parent_specimen_ids {
                check_text(value)?;
            }
        }
        if let Some(state) = &self.work {
            check_key(&state.task_key)?;
            for value in state.carrying_item_key.iter() {
                check_text(value)?;
            }
        }
        if self
            .care
            .as_ref()
            .is_some_and(|state| state.nourishment_milli > 10_000 || state.trust_milli > 10_000)
        {
            return Err("care meter exceeds 10000 milli-units");
        }
        if self.work.as_ref().is_some_and(|state| state.progress_milli > 10_000) {
            return Err("work progress exceeds 10000 milli-units");
        }
        if let Some(state) = &self.dragon {
            check_key(&state.lineage_key)?;
            check_key(&state.element_key)?;
            if state.flight_stamina_milli > 10_000 || state.breath_charge_milli > 10_000 {
                return Err("dragon meter exceeds 10000 milli-units");
            }
        }
        if let Some(state) = &self.legendary {
            check_key(&state.encounter_key)?;
            check_map(&state.world_flags)?;
        }
        if let Some(state) = &self.summon {
            check_key(&state.origin_realm_key)?;
            for value in state.summoner_id.iter().chain(state.grounding_item_key.iter()) {
                check_text(value)?;
            }
        }
        if let Some(state) = &self.sentient {
            check_key(&state.occupation_key)?;
            for value in state.faction_id.iter().chain(state.settlement_id.iter()) {
                check_text(value)?;
            }
            check_map(&state.dialogue_state)?;
        }
        Ok(())
    }
}

fn compatibility_bool(record: &EntityCompatibilityRecord, key: &str, fallback: bool) -> bool {
    record
        .custom
        .get(key)
        .and_then(|value| value.parse::<bool>().ok())
        .unwrap_or(fallback)
}

fn check_key(value: &str) -> Result<(), &'static str> {
    if value.is_empty() || value.len() > MAX_COMPONENT_KEY_BYTES {
        return Err("component key is empty or exceeds bound");
    }
    Ok(())
}

fn check_text(value: &str) -> Result<(), &'static str> {
    if value.len() > MAX_COMPONENT_TEXT_BYTES {
        return Err("component text exceeds bound");
    }
    Ok(())
}

fn check_map<K, V>(value: &BTreeMap<K, V>) -> Result<(), &'static str>
where
    K: AsRef<str> + Ord,
{
    if value.len() > MAX_COMPONENT_MAP_ENTRIES {
        return Err("component map exceeds entry bound");
    }
    for key in value.keys() {
        check_key(key.as_ref())?;
    }
    Ok(())
}
