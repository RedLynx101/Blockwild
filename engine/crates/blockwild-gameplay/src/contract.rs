use std::collections::BTreeSet;

use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId, PlayerId};

use crate::{CardforgeCommand, CombatCommand, InventoryCommand, MachineCommand, ProgressionCommand};

pub const GAMEPLAY_PROTOCOL_VERSION: u16 = 1;
pub const GAMEPLAY_SCHEMA_VERSION: u16 = 1;
pub const MAX_COMMANDS_PER_BATCH: usize = 256;
pub const MAX_PAYLOAD_BYTES: usize = 256 * 1024;
pub const MAX_EVENT_BYTES: usize = 256 * 1024;
pub const MAX_ITEM_STACK: u32 = 0x7fff_ffff;
pub const MAX_ID_LENGTH: usize = 160;
pub const IDEMPOTENCY_WINDOW: usize = 4_096;
/// Wire discriminant reserved for [`GameplayCommand::AdvanceSchedule`].
/// Existing command tags 0..=4 remain unchanged.
pub const GAMEPLAY_COMMAND_ADVANCE_SCHEDULE_TAG_V1: u16 = 5;
/// Maximum canonical machine jobs a single schedule command may inspect.
pub const MAX_SCHEDULE_MACHINE_ADVANCES_V1: u16 = 64;

pub type Tick = u64;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct GameplayRevision {
    pub epoch: u32,
    pub sequence: u64,
    pub inventory: u64,
    pub machines: u64,
    pub combat: u64,
    pub progression: u64,
    pub cardforge: u64,
}

impl GameplayRevision {
    pub(crate) fn hash_into(self, hasher: &mut CanonicalHasher) {
        hasher.write_u32(self.epoch);
        hasher.write_u64(self.sequence);
        hasher.write_u64(self.inventory);
        hasher.write_u64(self.machines);
        hasher.write_u64(self.combat);
        hasher.write_u64(self.progression);
        hasher.write_u64(self.cardforge);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldKey {
    pub universe: String,
    pub location: String,
}

impl WorldKey {
    #[must_use]
    pub fn new(universe: impl Into<String>, location: impl Into<String>) -> Self {
        Self {
            universe: universe.into(),
            location: location.into(),
        }
    }

    pub(crate) fn validate(&self) -> Result<(), Rejection> {
        validate_id("universe", &self.universe)?;
        validate_id("location", &self.location)
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_str(&self.universe);
        hasher.write_str(&self.location);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorityIdentity {
    pub world: WorldKey,
    pub revision: GameplayRevision,
    pub state_hash: CanonicalHash,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ActorRole {
    Host,
    Guest,
    Agent,
    System,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameplayActor {
    pub actor_id: String,
    pub player_id: Option<PlayerId>,
    pub entity_id: Option<EntityId>,
    pub role: ActorRole,
}

impl GameplayActor {
    pub(crate) fn validate_shape(&self) -> Result<(), Rejection> {
        validate_id("actor", &self.actor_id)?;
        match self.role {
            ActorRole::System if self.player_id.is_some() => Err(Rejection::new(
                RejectionCode::Unauthorized,
                "system actors cannot impersonate a player",
            )),
            ActorRole::Guest | ActorRole::Agent if self.player_id.is_none() => Err(Rejection::new(
                RejectionCode::Unauthorized,
                "guest and agent actors require a player identity",
            )),
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum Scope {
    InventorySelf,
    InventoryAny,
    Machines,
    CombatSelf,
    CombatAny,
    ProgressionSelf,
    ProgressionAny,
    CardforgeSelf,
    CardforgeAny,
    System,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActorGrant {
    pub player_id: Option<PlayerId>,
    pub entity_id: Option<EntityId>,
    pub role: ActorRole,
    pub scopes: BTreeSet<Scope>,
}

impl ActorGrant {
    #[must_use]
    pub fn host(player_id: PlayerId, entity_id: EntityId) -> Self {
        Self {
            player_id: Some(player_id),
            entity_id: Some(entity_id),
            role: ActorRole::Host,
            scopes: BTreeSet::from([
                Scope::InventorySelf,
                Scope::Machines,
                Scope::CombatSelf,
                Scope::ProgressionSelf,
                Scope::CardforgeSelf,
            ]),
        }
    }

    #[must_use]
    pub fn system() -> Self {
        Self {
            player_id: None,
            entity_id: None,
            role: ActorRole::System,
            scopes: BTreeSet::from([Scope::System]),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpaquePayload {
    pub type_id: String,
    pub schema: u16,
    pub bytes: Vec<u8>,
}

impl OpaquePayload {
    pub fn validate(&self) -> Result<(), Rejection> {
        validate_id("payload type", &self.type_id)?;
        if self.schema == 0 {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "payload schema must be non-zero",
            ));
        }
        if self.bytes.len() > MAX_PAYLOAD_BYTES {
            return Err(Rejection::new(
                RejectionCode::Capacity,
                "payload exceeds the protocol limit",
            ));
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_str(&self.type_id);
        hasher.write_u16(self.schema);
        hasher.write_bytes(&self.bytes);
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct GameplayScheduleAdvanceV1 {
    pub expected_tick: Tick,
    pub to_tick: Tick,
    pub machine_budget: u16,
}

impl GameplayScheduleAdvanceV1 {
    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.expected_tick);
        hasher.write_u64(self.to_tick);
        hasher.write_u16(self.machine_budget);
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum GameplayCommand {
    Inventory(InventoryCommand),
    Machine(MachineCommand),
    Combat(CombatCommand),
    Progression(ProgressionCommand),
    Cardforge(CardforgeCommand),
    /// System-only global clock, combat, and bounded machine transaction.
    AdvanceSchedule(GameplayScheduleAdvanceV1),
}

impl GameplayCommand {
    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        match self {
            Self::Inventory(command) => {
                hasher.write_u16(0);
                command.hash_into(hasher);
            }
            Self::Machine(command) => {
                hasher.write_u16(1);
                command.hash_into(hasher);
            }
            Self::Combat(command) => {
                hasher.write_u16(2);
                command.hash_into(hasher);
            }
            Self::Progression(command) => {
                hasher.write_u16(3);
                command.hash_into(hasher);
            }
            Self::Cardforge(command) => {
                hasher.write_u16(4);
                command.hash_into(hasher);
            }
            Self::AdvanceSchedule(command) => {
                hasher.write_u16(GAMEPLAY_COMMAND_ADVANCE_SCHEDULE_TAG_V1);
                command.hash_into(hasher);
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct GameplayBatch {
    pub schema_version: u16,
    pub batch_id: String,
    pub idempotency_key: String,
    pub actor: GameplayActor,
    pub identity: AuthorityIdentity,
    pub commands: Vec<GameplayCommand>,
    pub command_hash: CanonicalHash,
}

impl GameplayBatch {
    #[must_use]
    pub fn new(
        batch_id: impl Into<String>,
        idempotency_key: impl Into<String>,
        actor: GameplayActor,
        identity: AuthorityIdentity,
        commands: Vec<GameplayCommand>,
    ) -> Self {
        let mut batch = Self {
            schema_version: GAMEPLAY_SCHEMA_VERSION,
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
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.commands.v1");
        hasher.write_u64(self.commands.len() as u64);
        for command in &self.commands {
            command.hash_into(&mut hasher);
        }
        hasher.finish()
    }

    pub(crate) fn validate_shape(&self) -> Result<(), Rejection> {
        if self.schema_version != GAMEPLAY_SCHEMA_VERSION {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "unsupported gameplay schema",
            ));
        }
        validate_id("batch", &self.batch_id)?;
        validate_id("idempotency key", &self.idempotency_key)?;
        self.actor.validate_shape()?;
        self.identity.world.validate()?;
        if self.commands.is_empty() || self.commands.len() > MAX_COMMANDS_PER_BATCH {
            return Err(Rejection::new(
                RejectionCode::Capacity,
                "command count is outside protocol bounds",
            ));
        }
        if self.command_hash != self.calculate_command_hash() {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "command hash does not match canonical commands",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum Domain {
    Inventory,
    Machines,
    Combat,
    Progression,
    Cardforge,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResourceDelta {
    pub item_code: u32,
    pub metadata_hash: CanonicalHash,
    pub amount: i64,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatDelta {
    pub record_id: String,
    pub stat_id: String,
    pub amount: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameplayEvent {
    pub event_id: String,
    pub kind: String,
    pub actor_id: String,
    pub record_id: Option<String>,
    pub payload: OpaquePayload,
}

impl GameplayEvent {
    pub fn validate(&self) -> Result<(), Rejection> {
        validate_id("event", &self.event_id)?;
        validate_id("event kind", &self.kind)?;
        if let Some(record_id) = &self.record_id {
            validate_id("event record", record_id)?;
        }
        self.payload.validate()?;
        if self.payload.bytes.len() > MAX_EVENT_BYTES {
            return Err(Rejection::new(
                RejectionCode::Capacity,
                "event payload exceeds the protocol limit",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AcceptedReceipt {
    pub batch_id: String,
    pub before: AuthorityIdentity,
    pub after: AuthorityIdentity,
    pub touched_domains: BTreeSet<Domain>,
    pub resource_deltas: Vec<ResourceDelta>,
    pub stat_deltas: Vec<StatDelta>,
    pub events: Vec<GameplayEvent>,
    pub receipt_hash: CanonicalHash,
}

impl AcceptedReceipt {
    /// Recompute the canonical receipt digest independently of its stored hash.
    #[must_use]
    pub fn calculate_hash(&self) -> CanonicalHash {
        crate::authority::receipt_hash(
            &self.batch_id,
            &self.before,
            &self.after,
            &self.touched_domains,
            &self.resource_deltas,
            &self.stat_deltas,
            &self.events,
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RejectionCode {
    WrongWorld,
    StaleRevision,
    Duplicate,
    Unauthorized,
    InvalidCommand,
    InsufficientResource,
    InvalidTarget,
    Cooldown,
    RulesRejected,
    Capacity,
    Conflict,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Rejection {
    pub code: RejectionCode,
    pub message: String,
}

impl Rejection {
    #[must_use]
    pub fn new(code: RejectionCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum GameplayReceipt {
    Accepted(AcceptedReceipt),
    Rejected {
        batch_id: String,
        identity: AuthorityIdentity,
        rejection: Rejection,
    },
}

pub(crate) fn validate_id(field: &str, value: &str) -> Result<(), Rejection> {
    if value.is_empty() || value.len() > MAX_ID_LENGTH || value.chars().any(char::is_control) {
        return Err(Rejection::new(
            RejectionCode::InvalidCommand,
            format!("{field} identifier is malformed"),
        ));
    }
    Ok(())
}

pub(crate) fn write_option_str(hasher: &mut CanonicalHasher, value: Option<&str>) {
    match value {
        Some(value) => {
            hasher.write_u16(1);
            hasher.write_str(value);
        }
        None => hasher.write_u16(0),
    }
}

pub(crate) fn write_option_u64(hasher: &mut CanonicalHasher, value: Option<u64>) {
    match value {
        Some(value) => {
            hasher.write_u16(1);
            hasher.write_u64(value);
        }
        None => hasher.write_u16(0),
    }
}
