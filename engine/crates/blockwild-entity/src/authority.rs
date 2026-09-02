use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;

use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId, LocationId};

use crate::{
    AiState, CareState, DragonState, EntityComponents, EquipmentSlotState, HusbandryState, LegendaryState,
    LocomotionBody, MountState, NetworkAuthorityState, ProtectionProvenance, ProtectionState, SentientState,
    SimulationTier, SocialFollowerState, SummonState, Vec3, VitalsEnvironment, WorkState,
};

pub const ENTITY_COMPATIBILITY_SCHEMA: u16 = 1;
pub const ENTITY_COMMAND_SCHEMA: u16 = 1;
pub const MAX_ENTITY_COUNT: usize = 65_535;
pub const MAX_ENTITY_COMMANDS_PER_BATCH: usize = 4_096;
pub const MAX_ENTITY_COMPATIBILITY_MAP_ENTRIES: usize = 256;
pub const MAX_ENTITY_COMPATIBILITY_STRING_BYTES: usize = 4_096;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum EntityClass {
    Creature = 0,
    Player = 1,
    Sentient = 2,
    Construct = 3,
    Projectile = 4,
    Vehicle = 5,
}

/// Lossless compatibility surface for current creature saves.
///
/// Hot runtime data deliberately stays compact, while authored and player-owned
/// data remains in this cold record. String keys are retained at the save and
/// content boundary so migrating the engine never rerolls a specimen.
#[derive(Clone, Debug, PartialEq)]
pub struct EntityCompatibilityRecord {
    pub schema: u16,
    pub external_entity_id: String,
    pub legacy_numeric_id: Option<u64>,
    pub specimen_id: String,
    pub kind_key: String,
    pub class: EntityClass,
    pub variant_key: Option<String>,
    pub name: Option<String>,
    pub location_id: LocationId,
    pub position: Vec3,
    pub yaw: f32,
    pub velocity: Vec3,
    pub health: f32,
    pub maximum_health: f32,
    pub age_ticks: u64,
    pub natural_spawned: bool,
    pub ever_led: bool,
    pub owner_id: Option<String>,
    pub tamed: bool,
    pub bond_points: u32,
    pub bond_tier: String,
    pub social_group_id: Option<String>,
    pub faction_id: Option<String>,
    pub settlement_id: Option<String>,
    pub equipment: BTreeMap<String, String>,
    pub research: BTreeMap<String, u32>,
    pub custom: BTreeMap<String, String>,
}

impl EntityCompatibilityRecord {
    #[must_use]
    pub fn new(
        external_entity_id: impl Into<String>,
        specimen_id: impl Into<String>,
        kind_key: impl Into<String>,
    ) -> Self {
        Self {
            schema: ENTITY_COMPATIBILITY_SCHEMA,
            external_entity_id: external_entity_id.into(),
            legacy_numeric_id: None,
            specimen_id: specimen_id.into(),
            kind_key: kind_key.into(),
            class: EntityClass::Creature,
            variant_key: None,
            name: None,
            location_id: LocationId::new(1, 1),
            position: Vec3::ZERO,
            yaw: 0.0,
            velocity: Vec3::ZERO,
            health: 1.0,
            maximum_health: 1.0,
            age_ticks: 0,
            natural_spawned: false,
            ever_led: false,
            owner_id: None,
            tamed: false,
            bond_points: 0,
            bond_tier: "wary".to_owned(),
            social_group_id: None,
            faction_id: None,
            settlement_id: None,
            equipment: BTreeMap::new(),
            research: BTreeMap::new(),
            custom: BTreeMap::new(),
        }
    }

    pub fn validate(&self) -> Result<(), EntityError> {
        if self.schema != ENTITY_COMPATIBILITY_SCHEMA {
            return Err(EntityError::UnsupportedSchema(self.schema));
        }
        if self.external_entity_id.is_empty() || self.specimen_id.is_empty() || self.kind_key.is_empty() {
            return Err(EntityError::InvalidRecord("identity fields cannot be empty"));
        }
        if self.location_id.0.index() == 0 || self.location_id.0.generation() == 0 {
            return Err(EntityError::InvalidRecord("location identity is reserved"));
        }
        if !self.position.is_finite() || !self.velocity.is_finite() || !self.yaw.is_finite() {
            return Err(EntityError::InvalidRecord("transform must be finite"));
        }
        if !self.health.is_finite()
            || !self.maximum_health.is_finite()
            || self.maximum_health <= 0.0
            || self.health < 0.0
            || self.health > self.maximum_health
        {
            return Err(EntityError::InvalidRecord("health is outside its valid range"));
        }
        for value in [
            self.external_entity_id.as_str(),
            self.specimen_id.as_str(),
            self.kind_key.as_str(),
            self.bond_tier.as_str(),
        ]
        .into_iter()
        .chain(self.variant_key.iter().map(String::as_str))
        .chain(self.name.iter().map(String::as_str))
        .chain(self.owner_id.iter().map(String::as_str))
        .chain(self.social_group_id.iter().map(String::as_str))
        .chain(self.faction_id.iter().map(String::as_str))
        .chain(self.settlement_id.iter().map(String::as_str))
        {
            if value.len() > MAX_ENTITY_COMPATIBILITY_STRING_BYTES {
                return Err(EntityError::LimitExceeded("compatibility string"));
            }
        }
        for map_len in [self.equipment.len(), self.research.len(), self.custom.len()] {
            if map_len > MAX_ENTITY_COMPATIBILITY_MAP_ENTRIES {
                return Err(EntityError::LimitExceeded("compatibility map"));
            }
        }
        for (key, value) in self.equipment.iter().chain(&self.custom) {
            if key.is_empty()
                || key.len() > MAX_ENTITY_COMPATIBILITY_STRING_BYTES
                || value.len() > MAX_ENTITY_COMPATIBILITY_STRING_BYTES
            {
                return Err(EntityError::LimitExceeded("compatibility map entry"));
            }
        }
        for key in self.research.keys() {
            if key.is_empty() || key.len() > MAX_ENTITY_COMPATIBILITY_STRING_BYTES {
                return Err(EntityError::LimitExceeded("compatibility research key"));
            }
        }
        Ok(())
    }

    #[must_use]
    pub fn canonical_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.entity.compatibility.v1");
        hasher.write_str(&self.external_entity_id);
        hasher.write_u64(self.legacy_numeric_id.unwrap_or_default());
        hasher.write_str(&self.specimen_id);
        hasher.write_str(&self.kind_key);
        hasher.write_u16(self.class as u16);
        hasher.write_str(self.variant_key.as_deref().unwrap_or_default());
        hasher.write_str(self.name.as_deref().unwrap_or_default());
        hasher.write_u64(self.location_id.packed());
        for value in self
            .position
            .to_array()
            .into_iter()
            .chain([self.yaw])
            .chain(self.velocity.to_array())
        {
            hasher.write_u32(value.to_bits());
        }
        hasher.write_u32(self.health.to_bits());
        hasher.write_u32(self.maximum_health.to_bits());
        hasher.write_u64(self.age_ticks);
        hasher.write_u16(u16::from(self.natural_spawned));
        hasher.write_u16(u16::from(self.ever_led));
        hasher.write_str(self.owner_id.as_deref().unwrap_or_default());
        hasher.write_u16(u16::from(self.tamed));
        hasher.write_u32(self.bond_points);
        hasher.write_str(&self.bond_tier);
        hasher.write_str(self.social_group_id.as_deref().unwrap_or_default());
        hasher.write_str(self.faction_id.as_deref().unwrap_or_default());
        hasher.write_str(self.settlement_id.as_deref().unwrap_or_default());
        hash_string_map(&mut hasher, &self.equipment);
        hash_u32_map(&mut hasher, &self.research);
        hash_string_map(&mut hasher, &self.custom);
        hasher.finish()
    }
}

fn hash_string_map(hasher: &mut CanonicalHasher, values: &BTreeMap<String, String>) {
    hasher.write_u32(values.len() as u32);
    for (key, value) in values {
        hasher.write_str(key);
        hasher.write_str(value);
    }
}

fn hash_u32_map(hasher: &mut CanonicalHasher, values: &BTreeMap<String, u32>) {
    hasher.write_u32(values.len() as u32);
    for (key, value) in values {
        hasher.write_str(key);
        hasher.write_u32(*value);
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct HotEntity {
    pub record: EntityCompatibilityRecord,
    pub components: EntityComponents,
    pub entity_revision: u64,
    pub tier: SimulationTier,
    pub protection: ProtectionState,
    pub out_of_range_seconds: f32,
    pub last_simulated_tick: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DormantEntitySummary {
    pub slept_at_tick: u64,
    pub last_advanced_tick: u64,
    pub care_cycles: u32,
    pub breeding_cycles: u32,
    pub work_cycles: u32,
    pub next_care_tick: u64,
    pub next_breeding_tick: u64,
    pub next_work_tick: u64,
    pub next_ecology_tick: u64,
    pub route_epoch: u64,
    pub population_cost_quarters: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ColdEntity {
    pub record: EntityCompatibilityRecord,
    pub components: EntityComponents,
    pub entity_revision: u64,
    pub protection: ProtectionState,
    pub summary: DormantEntitySummary,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EntityResidency {
    Hot,
    Cold,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct EntitySlot {
    pub(crate) generation: u32,
    pub(crate) residency: Option<EntityResidency>,
}

impl EntitySlot {
    const fn reserved() -> Self {
        Self {
            generation: 0,
            residency: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct EntityAuthority {
    pub(crate) revision: u64,
    pub(crate) last_sequence: Option<u64>,
    pub(crate) slots: Vec<EntitySlot>,
    pub(crate) free: BTreeSet<u32>,
    pub(crate) hot: BTreeMap<EntityId, HotEntity>,
    pub(crate) cold: BTreeMap<EntityId, ColdEntity>,
}

impl Default for EntityAuthority {
    fn default() -> Self {
        Self {
            revision: 0,
            last_sequence: None,
            slots: vec![EntitySlot::reserved()],
            free: BTreeSet::new(),
            hot: BTreeMap::new(),
            cold: BTreeMap::new(),
        }
    }
}

impl EntityAuthority {
    #[must_use]
    pub const fn revision(&self) -> u64 {
        self.revision
    }

    #[must_use]
    pub fn hot(&self) -> &BTreeMap<EntityId, HotEntity> {
        &self.hot
    }

    #[must_use]
    pub fn cold(&self) -> &BTreeMap<EntityId, ColdEntity> {
        &self.cold
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.hot.len() + self.cold.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.hot.is_empty() && self.cold.is_empty()
    }

    fn spawn(
        &mut self,
        record: EntityCompatibilityRecord,
        components: Option<EntityComponents>,
        residency: EntityResidency,
        tick: u64,
    ) -> Result<EntityId, EntityError> {
        record.validate()?;
        if self.len() >= MAX_ENTITY_COUNT {
            return Err(EntityError::LimitExceeded("entity count"));
        }
        if self
            .hot
            .values()
            .any(|entity| entity.record.external_entity_id == record.external_entity_id)
            || self
                .cold
                .values()
                .any(|entity| entity.record.external_entity_id == record.external_entity_id)
        {
            return Err(EntityError::DuplicateExternalId(record.external_entity_id));
        }
        let index = self.free.pop_first().unwrap_or_else(|| {
            let index = u32::try_from(self.slots.len()).expect("entity slot count exceeds u32");
            self.slots.push(EntitySlot {
                generation: 1,
                residency: None,
            });
            index
        });
        let slot = &mut self.slots[index as usize];
        slot.residency = Some(residency);
        let id = EntityId::new(index, slot.generation);
        self.insert_storage(id, record, components, residency, tick, ProtectionState::default())?;
        Ok(id)
    }

    /// Import a known generational identity without remapping old save records.
    fn insert_with_id(
        &mut self,
        id: EntityId,
        record: EntityCompatibilityRecord,
        components: Option<EntityComponents>,
        residency: EntityResidency,
        tick: u64,
    ) -> Result<(), EntityError> {
        record.validate()?;
        let index = id.0.index();
        if index == 0 || id.0.generation() == 0 {
            return Err(EntityError::InvalidId(id));
        }
        if self
            .hot
            .values()
            .any(|entity| entity.record.external_entity_id == record.external_entity_id)
            || self
                .cold
                .values()
                .any(|entity| entity.record.external_entity_id == record.external_entity_id)
        {
            return Err(EntityError::DuplicateExternalId(record.external_entity_id));
        }
        let required = index as usize + 1;
        if required > MAX_ENTITY_COUNT + 1 {
            return Err(EntityError::LimitExceeded("entity slot index"));
        }
        if self.slots.len() < required {
            for new_index in self.slots.len()..required {
                self.slots.push(EntitySlot {
                    generation: 1,
                    residency: None,
                });
                if new_index != index as usize {
                    self.free.insert(new_index as u32);
                }
            }
        }
        let slot = &mut self.slots[index as usize];
        if slot.residency.is_some() {
            return Err(EntityError::AlreadyOccupied(id));
        }
        self.free.remove(&index);
        slot.generation = id.0.generation().max(1);
        slot.residency = Some(residency);
        self.insert_storage(id, record, components, residency, tick, ProtectionState::default())?;
        Ok(())
    }

    fn insert_storage(
        &mut self,
        id: EntityId,
        record: EntityCompatibilityRecord,
        components: Option<EntityComponents>,
        residency: EntityResidency,
        tick: u64,
        protection: ProtectionState,
    ) -> Result<(), EntityError> {
        let components = components.unwrap_or_else(|| EntityComponents::from_compatibility(&record, protection));
        components.validate().map_err(EntityError::InvalidRecord)?;
        let protection = components.protection.flags;
        let route_epoch = components.ai.route_epoch;
        match residency {
            EntityResidency::Hot => {
                self.hot.insert(
                    id,
                    HotEntity {
                        record,
                        components,
                        entity_revision: 1,
                        tier: SimulationTier::Nearby,
                        protection,
                        out_of_range_seconds: 0.0,
                        last_simulated_tick: tick,
                    },
                );
            }
            EntityResidency::Cold => {
                self.cold.insert(
                    id,
                    ColdEntity {
                        record,
                        components,
                        entity_revision: 1,
                        protection,
                        summary: DormantEntitySummary {
                            slept_at_tick: tick,
                            last_advanced_tick: tick,
                            route_epoch,
                            ..DormantEntitySummary::default()
                        },
                    },
                );
            }
        }
        Ok(())
    }

    #[must_use]
    pub fn entity_revision(&self, id: EntityId) -> Option<u64> {
        match self.residency(id)? {
            EntityResidency::Hot => self.hot.get(&id).map(|entity| entity.entity_revision),
            EntityResidency::Cold => self.cold.get(&id).map(|entity| entity.entity_revision),
        }
    }

    #[must_use]
    pub fn compatibility_record(&self, id: EntityId) -> Option<&EntityCompatibilityRecord> {
        match self.residency(id)? {
            EntityResidency::Hot => self.hot.get(&id).map(|entity| &entity.record),
            EntityResidency::Cold => self.cold.get(&id).map(|entity| &entity.record),
        }
    }

    #[must_use]
    pub fn components(&self, id: EntityId) -> Option<&EntityComponents> {
        match self.residency(id)? {
            EntityResidency::Hot => self.hot.get(&id).map(|entity| &entity.components),
            EntityResidency::Cold => self.cold.get(&id).map(|entity| &entity.components),
        }
    }

    #[must_use]
    pub fn contains(&self, id: EntityId) -> bool {
        self.validate_live_id(id).is_ok()
    }

    #[must_use]
    pub fn residency(&self, id: EntityId) -> Option<EntityResidency> {
        self.validate_live_id(id).ok()
    }

    fn hibernate(&mut self, id: EntityId, tick: u64) -> Result<(), EntityError> {
        match self.validate_live_id(id)? {
            EntityResidency::Cold => Ok(()),
            EntityResidency::Hot => {
                let hot = self.hot.remove(&id).ok_or(EntityError::MissingEntity(id))?;
                let route_epoch = hot.components.ai.route_epoch;
                self.cold.insert(
                    id,
                    ColdEntity {
                        record: hot.record,
                        components: hot.components,
                        entity_revision: hot.entity_revision.wrapping_add(1),
                        protection: hot.protection,
                        summary: DormantEntitySummary {
                            slept_at_tick: tick,
                            last_advanced_tick: tick,
                            route_epoch,
                            ..DormantEntitySummary::default()
                        },
                    },
                );
                self.slots[id.0.index() as usize].residency = Some(EntityResidency::Cold);
                Ok(())
            }
        }
    }

    fn wake(&mut self, id: EntityId, tier: SimulationTier, tick: u64) -> Result<(), EntityError> {
        if tier == SimulationTier::Dormant {
            return Err(EntityError::InvalidRecord("a hot entity cannot use the dormant tier"));
        }
        match self.validate_live_id(id)? {
            EntityResidency::Hot => {
                let entity = self.hot.get_mut(&id).ok_or(EntityError::MissingEntity(id))?;
                entity.tier = tier;
                entity.entity_revision = entity.entity_revision.wrapping_add(1);
                Ok(())
            }
            EntityResidency::Cold => {
                let cold = self.cold.remove(&id).ok_or(EntityError::MissingEntity(id))?;
                self.hot.insert(
                    id,
                    HotEntity {
                        record: cold.record,
                        components: cold.components,
                        entity_revision: cold.entity_revision.wrapping_add(1),
                        tier,
                        protection: cold.protection,
                        out_of_range_seconds: 0.0,
                        last_simulated_tick: tick,
                    },
                );
                self.slots[id.0.index() as usize].residency = Some(EntityResidency::Hot);
                Ok(())
            }
        }
    }

    fn remove(&mut self, id: EntityId) -> Result<EntityCompatibilityRecord, EntityError> {
        let residency = self.validate_live_id(id)?;
        let record = match residency {
            EntityResidency::Hot => self.hot.remove(&id).ok_or(EntityError::MissingEntity(id))?.record,
            EntityResidency::Cold => self.cold.remove(&id).ok_or(EntityError::MissingEntity(id))?.record,
        };
        let index = id.0.index();
        let slot = &mut self.slots[index as usize];
        slot.residency = None;
        slot.generation = slot.generation.wrapping_add(1).max(1);
        self.free.insert(index);
        Ok(record)
    }

    fn hot_mut(&mut self, id: EntityId) -> Result<&mut HotEntity, EntityError> {
        if self.validate_live_id(id)? != EntityResidency::Hot {
            return Err(EntityError::WrongResidency(id));
        }
        self.hot.get_mut(&id).ok_or(EntityError::MissingEntity(id))
    }

    fn components_mut(
        &mut self,
        id: EntityId,
    ) -> Result<(&mut EntityCompatibilityRecord, &mut EntityComponents, &mut u64), EntityError> {
        match self.validate_live_id(id)? {
            EntityResidency::Hot => {
                let entity = self.hot.get_mut(&id).ok_or(EntityError::MissingEntity(id))?;
                Ok((&mut entity.record, &mut entity.components, &mut entity.entity_revision))
            }
            EntityResidency::Cold => {
                let entity = self.cold.get_mut(&id).ok_or(EntityError::MissingEntity(id))?;
                Ok((&mut entity.record, &mut entity.components, &mut entity.entity_revision))
            }
        }
    }

    fn validate_live_id(&self, id: EntityId) -> Result<EntityResidency, EntityError> {
        let index = id.0.index() as usize;
        if index == 0 || index >= self.slots.len() {
            return Err(EntityError::MissingEntity(id));
        }
        let slot = self.slots[index];
        if slot.generation != id.0.generation() {
            return Err(EntityError::StaleEntity(id));
        }
        slot.residency.ok_or(EntityError::MissingEntity(id))
    }

    pub fn apply_batch(&mut self, batch: &EntityCommandBatch) -> Result<EntityEventBatch, EntityError> {
        if batch.schema != ENTITY_COMMAND_SCHEMA {
            return Err(EntityError::UnsupportedSchema(batch.schema));
        }
        if batch.expected_revision != self.revision {
            return Err(EntityError::StaleRevision {
                expected: self.revision,
                supplied: batch.expected_revision,
            });
        }
        if self.last_sequence.is_some_and(|sequence| batch.sequence <= sequence) {
            return Err(EntityError::StaleSequence {
                last: self.last_sequence.unwrap_or_default(),
                supplied: batch.sequence,
            });
        }
        if batch.commands.len() > MAX_ENTITY_COMMANDS_PER_BATCH {
            return Err(EntityError::LimitExceeded("command batch"));
        }
        let mut staged = self.clone();
        let mut events = Vec::with_capacity(batch.commands.len());
        for (command_index, command) in batch.commands.iter().enumerate() {
            staged.apply_command(command, batch.tick, command_index as u32, &mut events)?;
        }
        staged.revision = staged.revision.wrapping_add(1);
        staged.last_sequence = Some(batch.sequence);
        let result = EntityEventBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: batch.sequence,
            previous_revision: self.revision,
            revision: staged.revision,
            events,
        };
        *self = staged;
        Ok(result)
    }

    fn apply_command(
        &mut self,
        command: &EntityCommand,
        tick: u64,
        command_index: u32,
        events: &mut Vec<EntityEvent>,
    ) -> Result<(), EntityError> {
        let commanded_id = match command {
            EntityCommand::Spawn { .. } | EntityCommand::SpawnTyped { .. } => None,
            EntityCommand::SpawnAt { id, .. }
            | EntityCommand::SpawnTypedAt { id, .. }
            | EntityCommand::Despawn { id, .. }
            | EntityCommand::Hibernate { id }
            | EntityCommand::Wake { id, .. }
            | EntityCommand::UpdateMotion { id, .. }
            | EntityCommand::SetSimulationTier { id, .. }
            | EntityCommand::SetProtection { id, .. }
            | EntityCommand::SetVitalsEnvironment { id, .. }
            | EntityCommand::SetLocomotionBody { id, .. }
            | EntityCommand::SetAiState { id, .. }
            | EntityCommand::SetSocialState { id, .. }
            | EntityCommand::SetMountState { id, .. }
            | EntityCommand::SetProtectionProvenance { id, .. }
            | EntityCommand::SetNetworkAuthority { id, .. }
            | EntityCommand::SetCareState { id, .. }
            | EntityCommand::SetHusbandryState { id, .. }
            | EntityCommand::SetWorkState { id, .. }
            | EntityCommand::SetEquipment { id, .. }
            | EntityCommand::SetDragonState { id, .. }
            | EntityCommand::SetLegendaryState { id, .. }
            | EntityCommand::SetSummonState { id, .. }
            | EntityCommand::SetSentientState { id, .. }
            | EntityCommand::ReplaceComponents { id, .. }
            | EntityCommand::ReplaceCompatibilityRecord { id, .. }
            | EntityCommand::SetRangeState { id, .. }
            | EntityCommand::SetDormantSummary { id, .. } => Some(*id),
        };
        let previous_entity_revision = commanded_id.and_then(|id| self.entity_revision(id)).unwrap_or(0);
        let (id, kind) = match command {
            EntityCommand::Spawn { record, residency } => {
                let id = self.spawn(record.clone(), None, *residency, tick)?;
                (id, EntityEventKind::Spawned { residency: *residency })
            }
            EntityCommand::SpawnTyped {
                record,
                components,
                residency,
            } => {
                let id = self.spawn(record.clone(), Some(components.clone()), *residency, tick)?;
                (id, EntityEventKind::Spawned { residency: *residency })
            }
            EntityCommand::SpawnAt { id, record, residency } => {
                self.insert_with_id(*id, record.clone(), None, *residency, tick)?;
                (*id, EntityEventKind::Spawned { residency: *residency })
            }
            EntityCommand::SpawnTypedAt {
                id,
                record,
                components,
                residency,
            } => {
                self.insert_with_id(*id, record.clone(), Some(components.clone()), *residency, tick)?;
                (*id, EntityEventKind::Spawned { residency: *residency })
            }
            EntityCommand::Despawn { id, reason } => {
                self.remove(*id)?;
                (*id, EntityEventKind::Despawned { reason: *reason })
            }
            EntityCommand::Hibernate { id } => {
                self.hibernate(*id, tick)?;
                (*id, EntityEventKind::ResidencyChanged(EntityResidency::Cold))
            }
            EntityCommand::Wake { id, tier } => {
                self.wake(*id, *tier, tick)?;
                (*id, EntityEventKind::ResidencyChanged(EntityResidency::Hot))
            }
            EntityCommand::UpdateMotion {
                id,
                position,
                yaw,
                velocity,
            } => {
                if !position.is_finite() || !velocity.is_finite() || !yaw.is_finite() {
                    return Err(EntityError::InvalidRecord("motion command must be finite"));
                }
                let entity = self.hot_mut(*id)?;
                entity.record.position = *position;
                entity.record.yaw = *yaw;
                entity.record.velocity = *velocity;
                entity.components.locomotion.velocity = *velocity;
                entity.last_simulated_tick = tick;
                entity.entity_revision = entity.entity_revision.wrapping_add(1);
                (*id, EntityEventKind::MotionUpdated)
            }
            EntityCommand::SetSimulationTier { id, tier } => {
                if *tier == SimulationTier::Dormant {
                    return Err(EntityError::InvalidRecord(
                        "hibernate instead of assigning the dormant tier",
                    ));
                }
                let entity = self.hot_mut(*id)?;
                entity.tier = *tier;
                entity.entity_revision = entity.entity_revision.wrapping_add(1);
                (*id, EntityEventKind::TierChanged(*tier))
            }
            EntityCommand::SetProtection { id, protection } => {
                let (_, components, revision) = self.components_mut(*id)?;
                components.protection.flags = *protection;
                *revision = revision.wrapping_add(1);
                match self.validate_live_id(*id)? {
                    EntityResidency::Hot => {
                        self.hot.get_mut(id).ok_or(EntityError::MissingEntity(*id))?.protection = *protection
                    }
                    EntityResidency::Cold => {
                        self.cold.get_mut(id).ok_or(EntityError::MissingEntity(*id))?.protection = *protection
                    }
                }
                (*id, EntityEventKind::ProtectionChanged)
            }
            EntityCommand::SetVitalsEnvironment { id, value } => {
                let (record, components, revision) = self.components_mut(*id)?;
                components.vitals = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                record.health = value.health;
                record.maximum_health = value.maximum_health;
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::VitalsEnvironmentChanged)
            }
            EntityCommand::SetLocomotionBody { id, value } => {
                let (record, components, revision) = self.components_mut(*id)?;
                components.locomotion = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                record.velocity = value.velocity;
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::LocomotionChanged)
            }
            EntityCommand::SetAiState { id, value } => {
                let residency = self.validate_live_id(*id)?;
                let (_, components, revision) = self.components_mut(*id)?;
                components.ai = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                *revision = revision.wrapping_add(1);
                if residency == EntityResidency::Cold {
                    self.cold
                        .get_mut(id)
                        .ok_or(EntityError::MissingEntity(*id))?
                        .summary
                        .route_epoch = value.route_epoch;
                }
                (*id, EntityEventKind::AiChanged)
            }
            EntityCommand::SetSocialState { id, value } => {
                let (record, components, revision) = self.components_mut(*id)?;
                components.social = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                record.social_group_id = value.group_id.clone();
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::SocialChanged)
            }
            EntityCommand::SetMountState { id, value } => {
                let (_, components, revision) = self.components_mut(*id)?;
                components.mount = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::MountChanged)
            }
            EntityCommand::SetProtectionProvenance { id, value } => {
                let (_, components, revision) = self.components_mut(*id)?;
                components.protection = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                *revision = revision.wrapping_add(1);
                match self.validate_live_id(*id)? {
                    EntityResidency::Hot => {
                        self.hot.get_mut(id).ok_or(EntityError::MissingEntity(*id))?.protection = value.flags
                    }
                    EntityResidency::Cold => {
                        self.cold.get_mut(id).ok_or(EntityError::MissingEntity(*id))?.protection = value.flags
                    }
                }
                (*id, EntityEventKind::ProtectionChanged)
            }
            EntityCommand::SetNetworkAuthority { id, value } => {
                let (_, components, revision) = self.components_mut(*id)?;
                components.network = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::NetworkAuthorityChanged)
            }
            EntityCommand::SetCareState { id, value } => {
                let (record, components, revision) = self.components_mut(*id)?;
                components.care = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                if let Some(care) = value {
                    record.bond_points = u32::from(care.trust_milli);
                    record.tamed = care.stabilized;
                }
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::CareChanged)
            }
            EntityCommand::SetHusbandryState { id, value } => {
                let (_, components, revision) = self.components_mut(*id)?;
                components.husbandry = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::HusbandryChanged)
            }
            EntityCommand::SetWorkState { id, value } => {
                let (_, components, revision) = self.components_mut(*id)?;
                components.work = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::WorkChanged)
            }
            EntityCommand::SetEquipment { id, value } => {
                let (record, components, revision) = self.components_mut(*id)?;
                components.equipment = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                record.equipment = value
                    .iter()
                    .map(|(slot, item)| (slot.clone(), item.item_key.clone()))
                    .collect();
                components.mount.saddle_key = record.equipment.get("saddle").cloned();
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::EquipmentChanged)
            }
            EntityCommand::SetDragonState { id, value } => {
                let (_, components, revision) = self.components_mut(*id)?;
                components.dragon = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::DragonChanged)
            }
            EntityCommand::SetLegendaryState { id, value } => {
                let (_, components, revision) = self.components_mut(*id)?;
                components.legendary = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::LegendaryChanged)
            }
            EntityCommand::SetSummonState { id, value } => {
                let (_, components, revision) = self.components_mut(*id)?;
                components.summon = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::SummonChanged)
            }
            EntityCommand::SetSentientState { id, value } => {
                let (record, components, revision) = self.components_mut(*id)?;
                components.sentient = value.clone();
                components.validate().map_err(EntityError::InvalidRecord)?;
                record.faction_id = value.as_ref().and_then(|sentient| sentient.faction_id.clone());
                record.settlement_id = value.as_ref().and_then(|sentient| sentient.settlement_id.clone());
                *revision = revision.wrapping_add(1);
                (*id, EntityEventKind::SentientChanged)
            }
            EntityCommand::ReplaceComponents { id, value } => {
                value.validate().map_err(EntityError::InvalidRecord)?;
                let residency = self.validate_live_id(*id)?;
                let (record, components, revision) = self.components_mut(*id)?;
                *components = value.clone();
                record.health = value.vitals.health;
                record.maximum_health = value.vitals.maximum_health;
                record.velocity = value.locomotion.velocity;
                record.social_group_id = value.social.group_id.clone();
                record.equipment = value
                    .equipment
                    .iter()
                    .map(|(slot, item)| (slot.clone(), item.item_key.clone()))
                    .collect();
                *revision = revision.wrapping_add(1);
                if residency == EntityResidency::Cold {
                    self.cold
                        .get_mut(id)
                        .ok_or(EntityError::MissingEntity(*id))?
                        .summary
                        .route_epoch = value.ai.route_epoch;
                }
                (*id, EntityEventKind::ComponentsReplaced)
            }
            EntityCommand::ReplaceCompatibilityRecord { id, value } => {
                value.validate()?;
                let duplicate = self.hot.iter().any(|(candidate_id, entity)| {
                    *candidate_id != *id && entity.record.external_entity_id == value.external_entity_id
                }) || self.cold.iter().any(|(candidate_id, entity)| {
                    *candidate_id != *id && entity.record.external_entity_id == value.external_entity_id
                });
                if duplicate {
                    return Err(EntityError::DuplicateExternalId(value.external_entity_id.clone()));
                }
                let (record, components, revision) = self.components_mut(*id)?;
                *record = value.clone();
                components.vitals.health = value.health;
                components.vitals.maximum_health = value.maximum_health;
                components.locomotion.velocity = value.velocity;
                components.synchronize_compatibility_physics(value);
                components.social.group_id = value.social_group_id.clone();
                components.equipment = value
                    .equipment
                    .iter()
                    .map(|(slot, item_key)| {
                        (
                            slot.clone(),
                            EquipmentSlotState {
                                item_key: item_key.clone(),
                                count: 1,
                                durability: 0,
                                custom: BTreeMap::new(),
                            },
                        )
                    })
                    .collect();
                components.mount.saddle_key = value.equipment.get("saddle").cloned();
                components.mount.accepts_riders = components.mount.saddle_key.is_some();
                components.care = (value.tamed || value.bond_points > 0).then(|| {
                    let mut care = components.care.clone().unwrap_or(CareState {
                        stabilized: false,
                        nourishment_milli: 10_000,
                        trust_milli: 0,
                        care_stage: 0,
                        last_care_tick: 0,
                    });
                    care.stabilized = value.tamed;
                    care.trust_milli = u16::try_from(value.bond_points.min(10_000)).unwrap_or(10_000);
                    care
                });
                if let Some(sentient) = &mut components.sentient {
                    sentient.faction_id = value.faction_id.clone();
                    sentient.settlement_id = value.settlement_id.clone();
                }
                for (enabled, flag) in [
                    (value.tamed, ProtectionState::TAMED),
                    (value.owner_id.is_some(), ProtectionState::OWNED),
                    (value.ever_led, ProtectionState::EVER_LED),
                    (value.name.is_some(), ProtectionState::NAMED),
                ] {
                    if enabled {
                        components.protection.flags.insert(flag);
                    } else {
                        components.protection.flags.remove(flag);
                    }
                }
                components.validate().map_err(EntityError::InvalidRecord)?;
                let flags = components.protection.flags;
                *revision = revision.wrapping_add(1);
                match self.validate_live_id(*id)? {
                    EntityResidency::Hot => {
                        self.hot.get_mut(id).ok_or(EntityError::MissingEntity(*id))?.protection = flags
                    }
                    EntityResidency::Cold => {
                        self.cold.get_mut(id).ok_or(EntityError::MissingEntity(*id))?.protection = flags
                    }
                }
                (*id, EntityEventKind::CompatibilityRecordChanged)
            }
            EntityCommand::SetRangeState {
                id,
                out_of_range_seconds,
                last_simulated_tick,
            } => {
                if !out_of_range_seconds.is_finite() || *out_of_range_seconds < 0.0 {
                    return Err(EntityError::InvalidRecord(
                        "range state must be finite and non-negative",
                    ));
                }
                let entity = self.hot_mut(*id)?;
                entity.out_of_range_seconds = *out_of_range_seconds;
                entity.last_simulated_tick = *last_simulated_tick;
                entity.entity_revision = entity.entity_revision.wrapping_add(1);
                (*id, EntityEventKind::RangeStateChanged)
            }
            EntityCommand::SetDormantSummary { id, value } => {
                if self.validate_live_id(*id)? != EntityResidency::Cold {
                    return Err(EntityError::WrongResidency(*id));
                }
                let entity = self.cold.get_mut(id).ok_or(EntityError::MissingEntity(*id))?;
                if value.route_epoch != entity.components.ai.route_epoch {
                    return Err(EntityError::InvalidRecord(
                        "dormant route epoch must match AI route epoch",
                    ));
                }
                entity.summary = value.clone();
                entity.entity_revision = entity.entity_revision.wrapping_add(1);
                (*id, EntityEventKind::DormantSummaryChanged)
            }
        };
        let entity_revision = self
            .entity_revision(id)
            .unwrap_or_else(|| previous_entity_revision.wrapping_add(1));
        events.push(EntityEvent {
            command_index,
            entity_id: id,
            previous_entity_revision,
            entity_revision,
            kind,
        });
        Ok(())
    }

    #[must_use]
    pub fn canonical_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.entity.authority.v2");
        let snapshot = crate::encode_entity_authority_snapshot(self)
            .expect("an authority accepted only validated records and components");
        hasher.write_bytes(&snapshot);
        hasher.finish()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct EntityCommandBatch {
    pub schema: u16,
    pub sequence: u64,
    pub expected_revision: u64,
    pub tick: u64,
    pub commands: Vec<EntityCommand>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum EntityCommand {
    Spawn {
        record: EntityCompatibilityRecord,
        residency: EntityResidency,
    },
    SpawnTyped {
        record: EntityCompatibilityRecord,
        components: EntityComponents,
        residency: EntityResidency,
    },
    SpawnAt {
        id: EntityId,
        record: EntityCompatibilityRecord,
        residency: EntityResidency,
    },
    SpawnTypedAt {
        id: EntityId,
        record: EntityCompatibilityRecord,
        components: EntityComponents,
        residency: EntityResidency,
    },
    Despawn {
        id: EntityId,
        reason: DespawnReason,
    },
    Hibernate {
        id: EntityId,
    },
    Wake {
        id: EntityId,
        tier: SimulationTier,
    },
    UpdateMotion {
        id: EntityId,
        position: Vec3,
        yaw: f32,
        velocity: Vec3,
    },
    SetSimulationTier {
        id: EntityId,
        tier: SimulationTier,
    },
    SetProtection {
        id: EntityId,
        protection: ProtectionState,
    },
    SetVitalsEnvironment {
        id: EntityId,
        value: VitalsEnvironment,
    },
    SetLocomotionBody {
        id: EntityId,
        value: LocomotionBody,
    },
    SetAiState {
        id: EntityId,
        value: AiState,
    },
    SetSocialState {
        id: EntityId,
        value: SocialFollowerState,
    },
    SetMountState {
        id: EntityId,
        value: MountState,
    },
    SetProtectionProvenance {
        id: EntityId,
        value: ProtectionProvenance,
    },
    SetNetworkAuthority {
        id: EntityId,
        value: NetworkAuthorityState,
    },
    SetCareState {
        id: EntityId,
        value: Option<CareState>,
    },
    SetHusbandryState {
        id: EntityId,
        value: Option<HusbandryState>,
    },
    SetWorkState {
        id: EntityId,
        value: Option<WorkState>,
    },
    SetEquipment {
        id: EntityId,
        value: BTreeMap<String, EquipmentSlotState>,
    },
    SetDragonState {
        id: EntityId,
        value: Option<DragonState>,
    },
    SetLegendaryState {
        id: EntityId,
        value: Option<LegendaryState>,
    },
    SetSummonState {
        id: EntityId,
        value: Option<SummonState>,
    },
    SetSentientState {
        id: EntityId,
        value: Option<SentientState>,
    },
    ReplaceComponents {
        id: EntityId,
        value: EntityComponents,
    },
    ReplaceCompatibilityRecord {
        id: EntityId,
        value: EntityCompatibilityRecord,
    },
    SetRangeState {
        id: EntityId,
        out_of_range_seconds: f32,
        last_simulated_tick: u64,
    },
    SetDormantSummary {
        id: EntityId,
        value: DormantEntitySummary,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DespawnReason {
    NaturalRange,
    Defeated,
    Captured,
    Released,
    Admin,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EntityEventBatch {
    pub schema: u16,
    pub sequence: u64,
    pub previous_revision: u64,
    pub revision: u64,
    pub events: Vec<EntityEvent>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EntityEvent {
    pub command_index: u32,
    pub entity_id: EntityId,
    pub previous_entity_revision: u64,
    pub entity_revision: u64,
    pub kind: EntityEventKind,
}

#[derive(Clone, Debug, PartialEq)]
pub enum EntityEventKind {
    Spawned { residency: EntityResidency },
    Despawned { reason: DespawnReason },
    ResidencyChanged(EntityResidency),
    MotionUpdated,
    TierChanged(SimulationTier),
    ProtectionChanged,
    VitalsEnvironmentChanged,
    LocomotionChanged,
    AiChanged,
    SocialChanged,
    MountChanged,
    NetworkAuthorityChanged,
    CareChanged,
    HusbandryChanged,
    WorkChanged,
    EquipmentChanged,
    DragonChanged,
    LegendaryChanged,
    SummonChanged,
    SentientChanged,
    ComponentsReplaced,
    CompatibilityRecordChanged,
    RangeStateChanged,
    DormantSummaryChanged,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EntityError {
    UnsupportedSchema(u16),
    InvalidRecord(&'static str),
    InvalidId(EntityId),
    MissingEntity(EntityId),
    StaleEntity(EntityId),
    AlreadyOccupied(EntityId),
    WrongResidency(EntityId),
    DuplicateExternalId(String),
    StaleRevision { expected: u64, supplied: u64 },
    StaleSequence { last: u64, supplied: u64 },
    LimitExceeded(&'static str),
}

impl fmt::Display for EntityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedSchema(schema) => write!(formatter, "unsupported entity schema {schema}"),
            Self::InvalidRecord(message) => write!(formatter, "invalid entity record: {message}"),
            Self::InvalidId(id) => write!(formatter, "invalid entity id {id:?}"),
            Self::MissingEntity(id) => write!(formatter, "missing entity {id:?}"),
            Self::StaleEntity(id) => write!(formatter, "stale entity handle {id:?}"),
            Self::AlreadyOccupied(id) => write!(formatter, "entity slot already occupied {id:?}"),
            Self::WrongResidency(id) => write!(formatter, "entity has the wrong residency {id:?}"),
            Self::DuplicateExternalId(id) => write!(formatter, "duplicate external entity id {id}"),
            Self::StaleRevision { expected, supplied } => {
                write!(formatter, "stale revision {supplied}; expected {expected}")
            }
            Self::StaleSequence { last, supplied } => {
                write!(formatter, "stale sequence {supplied}; last accepted {last}")
            }
            Self::LimitExceeded(what) => write!(formatter, "entity {what} exceeds its bound"),
        }
    }
}

impl Error for EntityError {}
