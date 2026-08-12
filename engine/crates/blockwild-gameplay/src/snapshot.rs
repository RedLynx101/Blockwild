//! Canonical persistence for the complete gameplay authority.
//!
//! The format is deliberately independent from browser storage and the Wasm
//! ABI. Adapters persist these bytes as an opaque record, then ask this module
//! to decode and validate the entire replacement before installing it.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;

use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId, PlayerId};

use crate::authority::{GameplayAuthoritySnapshotParts, IdempotencyEntry};
use crate::*;

pub const GAMEPLAY_SNAPSHOT_SCHEMA_VERSION: u16 = 4;
pub const GAMEPLAY_SNAPSHOT_MIN_SUPPORTED_SCHEMA_VERSION: u16 = 1;
pub const MAX_GAMEPLAY_SNAPSHOT_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_GAMEPLAY_SNAPSHOT_EXTENSIONS: usize = 4 * 1024 * 1024;

const SNAPSHOT_MAGIC: [u8; 8] = *b"BWGPSNP\0";
const SNAPSHOT_FLAGS: u16 = 0;
const HEADER_BYTES: usize = 68;
const MAX_COLLECTION_ENTRIES: usize = 262_144;
const MAX_STRING_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GameplaySnapshotErrorCode {
    InvalidHeader,
    UnsupportedVersion,
    Capacity,
    Truncated,
    Corrupt,
    InvalidUtf8,
    InvalidValue,
    DuplicateKey,
    AuthorityRejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameplaySnapshotError {
    pub code: GameplaySnapshotErrorCode,
    pub offset: usize,
    pub message: String,
}

impl GameplaySnapshotError {
    fn new(code: GameplaySnapshotErrorCode, offset: usize, message: impl Into<String>) -> Self {
        Self {
            code,
            offset,
            message: message.into(),
        }
    }
}

impl fmt::Display for GameplaySnapshotError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} at byte {}", self.message, self.offset)
    }
}

impl std::error::Error for GameplaySnapshotError {}

#[derive(Clone, Debug)]
pub struct DecodedGameplayAuthoritySnapshot {
    pub authority: GameplayAuthority,
    pub schema_version: u16,
    pub unknown_extension_bytes: Vec<u8>,
    pub snapshot_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameplaySnapshotInstallReport {
    pub schema_version: u16,
    pub state_hash: CanonicalHash,
    pub replay_hash: CanonicalHash,
    pub snapshot_hash: CanonicalHash,
    pub unknown_extension_bytes: Vec<u8>,
}

/// Explicit boundary for the pre-native projection. V0 never claimed to own
/// command receipts, replay history, or idempotency state, so importing one
/// starts those histories empty instead of fabricating them.
#[derive(Clone, Debug)]
pub struct LegacyGameplayProjectionV0 {
    pub state: GameplayState,
    pub grants: BTreeMap<String, ActorGrant>,
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn raw(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    fn length(&mut self, value: usize) -> Result<(), GameplaySnapshotError> {
        let value = u32::try_from(value).map_err(|_| {
            GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                self.bytes.len(),
                "snapshot collection length exceeds u32",
            )
        })?;
        value.encode(self)
    }

    fn bounded_bytes(&mut self, bytes: &[u8], max: usize) -> Result<(), GameplaySnapshotError> {
        if bytes.len() > max {
            return Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                self.bytes.len(),
                "snapshot byte field exceeds its bound",
            ));
        }
        self.length(bytes.len())?;
        self.raw(bytes);
        Ok(())
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    fn raw(&mut self, count: usize) -> Result<&'a [u8], GameplaySnapshotError> {
        let end = self.offset.checked_add(count).ok_or_else(|| {
            GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                self.offset,
                "snapshot offset overflow",
            )
        })?;
        let value = self.bytes.get(self.offset..end).ok_or_else(|| {
            GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Truncated,
                self.offset,
                "snapshot ended before the declared field",
            )
        })?;
        self.offset = end;
        Ok(value)
    }

    fn length(&mut self, max: usize) -> Result<usize, GameplaySnapshotError> {
        let count = usize::try_from(u32::decode(self)?).map_err(|_| {
            GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                self.offset,
                "snapshot collection length cannot fit this platform",
            )
        })?;
        if count > max {
            return Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                self.offset,
                "snapshot collection exceeds its declared bound",
            ));
        }
        Ok(count)
    }

    fn bounded_bytes(&mut self, max: usize) -> Result<Vec<u8>, GameplaySnapshotError> {
        let count = self.length(max)?;
        Ok(self.raw(count)?.to_vec())
    }

    fn finish(self) -> Result<(), GameplaySnapshotError> {
        if self.remaining() != 0 {
            return Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Corrupt,
                self.offset,
                "snapshot payload has trailing bytes",
            ));
        }
        Ok(())
    }
}

trait SnapshotCodec: Sized {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError>;
    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError>;
}

macro_rules! integer_codec {
    ($type:ty, $width:expr) => {
        impl SnapshotCodec for $type {
            fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
                writer.raw(&self.to_le_bytes());
                Ok(())
            }

            fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
                let mut bytes = [0_u8; $width];
                bytes.copy_from_slice(reader.raw($width)?);
                Ok(<$type>::from_le_bytes(bytes))
            }
        }
    };
}

integer_codec!(u16, 2);
integer_codec!(u32, 4);
integer_codec!(u64, 8);
integer_codec!(i32, 4);
integer_codec!(i64, 8);

impl SnapshotCodec for u8 {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        writer.raw(&[*self]);
        Ok(())
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        Ok(reader.raw(1)?[0])
    }
}

impl SnapshotCodec for bool {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        u8::from(*self).encode(writer)
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        match u8::decode(reader)? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::InvalidValue,
                reader.offset.saturating_sub(1),
                "snapshot boolean is not canonical",
            )),
        }
    }
}

impl SnapshotCodec for String {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        writer.bounded_bytes(self.as_bytes(), MAX_STRING_BYTES)
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        let start = reader.offset;
        String::from_utf8(reader.bounded_bytes(MAX_STRING_BYTES)?).map_err(|_| {
            GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::InvalidUtf8,
                start,
                "snapshot string is not UTF-8",
            )
        })
    }
}

impl SnapshotCodec for CanonicalHash {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        writer.raw(self.as_bytes());
        Ok(())
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        let mut bytes = [0_u8; 16];
        bytes.copy_from_slice(reader.raw(16)?);
        Ok(Self(bytes))
    }
}

impl SnapshotCodec for PlayerId {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        self.packed().encode(writer)
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        let packed = u64::decode(reader)?;
        Ok(Self::new(packed as u32, (packed >> 32) as u32))
    }
}

impl SnapshotCodec for EntityId {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        self.packed().encode(writer)
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        let packed = u64::decode(reader)?;
        Ok(Self::new(packed as u32, (packed >> 32) as u32))
    }
}

impl<T: SnapshotCodec> SnapshotCodec for Option<T> {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        match self {
            None => 0_u8.encode(writer),
            Some(value) => {
                1_u8.encode(writer)?;
                value.encode(writer)
            }
        }
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        match u8::decode(reader)? {
            0 => Ok(None),
            1 => Ok(Some(T::decode(reader)?)),
            _ => Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::InvalidValue,
                reader.offset.saturating_sub(1),
                "snapshot option tag is invalid",
            )),
        }
    }
}

impl<T: SnapshotCodec> SnapshotCodec for Vec<T> {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        if self.len() > MAX_COLLECTION_ENTRIES {
            return Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                writer.bytes.len(),
                "snapshot sequence exceeds its bound",
            ));
        }
        writer.length(self.len())?;
        self.iter().try_for_each(|value| value.encode(writer))
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        let count = reader.length(MAX_COLLECTION_ENTRIES)?;
        let mut values = Vec::with_capacity(count);
        for _ in 0..count {
            values.push(T::decode(reader)?);
        }
        Ok(values)
    }
}

impl<T: SnapshotCodec> SnapshotCodec for VecDeque<T> {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        if self.len() > MAX_COLLECTION_ENTRIES {
            return Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                writer.bytes.len(),
                "snapshot queue exceeds its bound",
            ));
        }
        writer.length(self.len())?;
        self.iter().try_for_each(|value| value.encode(writer))
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        let count = reader.length(MAX_COLLECTION_ENTRIES)?;
        let mut values = VecDeque::with_capacity(count);
        for _ in 0..count {
            values.push_back(T::decode(reader)?);
        }
        Ok(values)
    }
}

impl<K, V> SnapshotCodec for BTreeMap<K, V>
where
    K: SnapshotCodec + Ord,
    V: SnapshotCodec,
{
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        if self.len() > MAX_COLLECTION_ENTRIES {
            return Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                writer.bytes.len(),
                "snapshot map exceeds its bound",
            ));
        }
        writer.length(self.len())?;
        for (key, value) in self {
            key.encode(writer)?;
            value.encode(writer)?;
        }
        Ok(())
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        let count = reader.length(MAX_COLLECTION_ENTRIES)?;
        let mut values = Self::new();
        for _ in 0..count {
            let key = K::decode(reader)?;
            if values.last_key_value().is_some_and(|(previous, _)| previous >= &key) {
                return Err(GameplaySnapshotError::new(
                    GameplaySnapshotErrorCode::DuplicateKey,
                    reader.offset,
                    "snapshot map keys are not in strict canonical order",
                ));
            }
            let value = V::decode(reader)?;
            values.insert(key, value);
        }
        Ok(values)
    }
}

impl<T> SnapshotCodec for BTreeSet<T>
where
    T: SnapshotCodec + Ord,
{
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        if self.len() > MAX_COLLECTION_ENTRIES {
            return Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                writer.bytes.len(),
                "snapshot set exceeds its bound",
            ));
        }
        writer.length(self.len())?;
        self.iter().try_for_each(|value| value.encode(writer))
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        let count = reader.length(MAX_COLLECTION_ENTRIES)?;
        let mut values = Self::new();
        for _ in 0..count {
            let value = T::decode(reader)?;
            if values.last().is_some_and(|previous| previous >= &value) {
                return Err(GameplaySnapshotError::new(
                    GameplaySnapshotErrorCode::DuplicateKey,
                    reader.offset,
                    "snapshot set values are not in strict canonical order",
                ));
            }
            values.insert(value);
        }
        Ok(values)
    }
}

impl<A: SnapshotCodec, B: SnapshotCodec> SnapshotCodec for (A, B) {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        self.0.encode(writer)?;
        self.1.encode(writer)
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        Ok((A::decode(reader)?, B::decode(reader)?))
    }
}

impl<A: SnapshotCodec, B: SnapshotCodec, C: SnapshotCodec> SnapshotCodec for (A, B, C) {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        self.0.encode(writer)?;
        self.1.encode(writer)?;
        self.2.encode(writer)
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        Ok((A::decode(reader)?, B::decode(reader)?, C::decode(reader)?))
    }
}

macro_rules! unit_enum_codec {
    ($type:ty { $($variant:path => $tag:expr),+ $(,)? }) => {
        impl SnapshotCodec for $type {
            fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
                let tag: u8 = match self {
                    $($variant => $tag,)+
                };
                tag.encode(writer)
            }

            fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
                let offset = reader.offset;
                match u8::decode(reader)? {
                    $($tag => Ok($variant),)+
                    _ => Err(GameplaySnapshotError::new(
                        GameplaySnapshotErrorCode::InvalidValue,
                        offset,
                        concat!("snapshot ", stringify!($type), " tag is invalid"),
                    )),
                }
            }
        }
    };
}

macro_rules! struct_codec {
    ($type:ty { $($field:ident),+ $(,)? }) => {
        impl SnapshotCodec for $type {
            fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
                $(self.$field.encode(writer)?;)+
                Ok(())
            }

            fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
                Ok(Self {
                    $($field: SnapshotCodec::decode(reader)?,)+
                })
            }
        }
    };
}

unit_enum_codec!(ContainerKind {
    ContainerKind::Player => 0,
    ContainerKind::Equipment => 1,
    ContainerKind::Container => 2,
    ContainerKind::Machine => 3,
    ContainerKind::Waygrid => 4,
    ContainerKind::CardforgeCase => 5,
});
unit_enum_codec!(ResourceKind {
    ResourceKind::Item => 0,
    ResourceKind::Liquid => 1,
    ResourceKind::Gas => 2,
    ResourceKind::Energy => 3,
    ResourceKind::Heat => 4,
});
unit_enum_codec!(MachineKind {
    MachineKind::Furnace => 0,
    MachineKind::Farm => 1,
    MachineKind::Waygrid => 2,
    MachineKind::Aquarium => 3,
    MachineKind::Apiary => 4,
    MachineKind::Generator => 5,
    MachineKind::Battery => 6,
    MachineKind::Logistics => 7,
    MachineKind::Anchor => 8,
    MachineKind::Custom => 9,
});
unit_enum_codec!(PortMode {
    PortMode::Input => 0,
    PortMode::Output => 1,
    PortMode::Bidirectional => 2,
});
unit_enum_codec!(DamageKind {
    DamageKind::Physical => 0,
    DamageKind::Fire => 1,
    DamageKind::Frost => 2,
    DamageKind::Tide => 3,
    DamageKind::Storm => 4,
    DamageKind::Verdant => 5,
    DamageKind::Arcane => 6,
    DamageKind::True => 7,
});
unit_enum_codec!(Disposition {
    Disposition::Passive => 0,
    Disposition::Neutral => 1,
    Disposition::Aggressive => 2,
    Disposition::Legendary => 3,
});
unit_enum_codec!(CaptureReadiness {
    CaptureReadiness::Wild => 0,
    CaptureReadiness::SubduedByHealth => 1,
    CaptureReadiness::CalmByOutmaneuver => 2,
    CaptureReadiness::CalmByCare => 3,
    CaptureReadiness::Captured => 4,
    CaptureReadiness::Bonded => 5,
});
unit_enum_codec!(CombatVitalUnits {
    CombatVitalUnits::LegacyWholeHeartsV1 => 0,
    CombatVitalUnits::MilliheartsV1 => 1,
});
unit_enum_codec!(CardRarity {
    CardRarity::Common => 0,
    CardRarity::Uncommon => 1,
    CardRarity::Rare => 2,
    CardRarity::Epic => 3,
    CardRarity::Legendary => 4,
});
unit_enum_codec!(ActorRole {
    ActorRole::Host => 0,
    ActorRole::Guest => 1,
    ActorRole::Agent => 2,
    ActorRole::System => 3,
});
unit_enum_codec!(Scope {
    Scope::InventorySelf => 0,
    Scope::InventoryAny => 1,
    Scope::Machines => 2,
    Scope::CombatSelf => 3,
    Scope::CombatAny => 4,
    Scope::ProgressionSelf => 5,
    Scope::ProgressionAny => 6,
    Scope::CardforgeSelf => 7,
    Scope::CardforgeAny => 8,
    Scope::System => 9,
});
unit_enum_codec!(Domain {
    Domain::Inventory => 0,
    Domain::Machines => 1,
    Domain::Combat => 2,
    Domain::Progression => 3,
    Domain::Cardforge => 4,
});
unit_enum_codec!(ContentDomain {
    ContentDomain::Item => 0,
    ContentDomain::CraftingRecipe => 1,
    ContentDomain::MachineRecipe => 2,
    ContentDomain::MachineProfile => 3,
    ContentDomain::AbilitySpell => 4,
    ContentDomain::CreatureProfile => 5,
    ContentDomain::CreatureTypeChart => 6,
    ContentDomain::QuestGuild => 7,
    ContentDomain::Economy => 8,
    ContentDomain::CardforgeCard => 9,
    ContentDomain::CardforgePack => 10,
});

struct_codec!(GameplayRevision {
    epoch,
    sequence,
    inventory,
    machines,
    combat,
    progression,
    cardforge,
});
struct_codec!(WorldKey { universe, location });
struct_codec!(AuthorityIdentity {
    world,
    revision,
    state_hash,
});
struct_codec!(ActorGrant {
    player_id,
    entity_id,
    role,
    scopes,
});
struct_codec!(OpaquePayload { type_id, schema, bytes });
struct_codec!(ResourceDelta {
    item_code,
    metadata_hash,
    amount,
    reason,
});
struct_codec!(StatDelta {
    record_id,
    stat_id,
    amount,
});
struct_codec!(GameplayEvent {
    event_id,
    kind,
    actor_id,
    record_id,
    payload,
});
struct_codec!(AcceptedReceipt {
    batch_id,
    before,
    after,
    touched_domains,
    resource_deltas,
    stat_deltas,
    events,
    receipt_hash,
});
struct_codec!(ReplayEntry {
    sequence,
    actor_id,
    idempotency_key,
    command_hash,
    before_hash,
    after_hash,
    receipt_hash,
});

impl SnapshotCodec for IdempotencyEntry {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        self.command_hash.encode(writer)?;
        self.receipt.encode(writer)
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        Ok(Self {
            command_hash: CanonicalHash::decode(reader)?,
            receipt: AcceptedReceipt::decode(reader)?,
        })
    }
}

struct_codec!(ContainerKey { kind, id, owner_id });
struct_codec!(ItemStack {
    item_code,
    count,
    durability_millionths,
    metadata_hash,
});
struct_codec!(ItemDefinition {
    code,
    content_id,
    max_stack,
    tags,
});
struct_codec!(ItemInstanceMetadataV1 {
    hash,
    type_id,
    schema_id,
    schema_version,
    content_version,
    canonical_json_bytes,
    unknown_extension_bytes,
});
struct_codec!(Container {
    key,
    revision,
    slots,
    equipment_tags,
});
struct_codec!(Ingredient {
    item_code,
    metadata_hash,
    count,
});
struct_codec!(Recipe {
    recipe_id,
    station_tag,
    inputs,
    outputs,
    ticks,
});
struct_codec!(FurnaceState {
    furnace_id,
    revision,
    recipe_id,
    source,
    destination,
    progress_ticks,
    fuel_ticks,
    last_tick,
    active,
});
impl SnapshotCodec for InventoryState {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        self.items.encode(writer)?;
        self.containers.encode(writer)?;
        self.recipes.encode(writer)?;
        self.furnaces.encode(writer)?;
        self.item_instance_metadata.encode(writer)
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        Ok(Self {
            items: SnapshotCodec::decode(reader)?,
            containers: SnapshotCodec::decode(reader)?,
            recipes: SnapshotCodec::decode(reader)?,
            furnaces: SnapshotCodec::decode(reader)?,
            item_instance_metadata: SnapshotCodec::decode(reader)?,
        })
    }
}

fn decode_inventory_state_v1(reader: &mut Reader<'_>) -> Result<InventoryState, GameplaySnapshotError> {
    Ok(InventoryState {
        items: SnapshotCodec::decode(reader)?,
        containers: SnapshotCodec::decode(reader)?,
        recipes: SnapshotCodec::decode(reader)?,
        furnaces: SnapshotCodec::decode(reader)?,
        item_instance_metadata: BTreeMap::new(),
    })
}

struct_codec!(ResourceKey {
    kind,
    content_id,
    item_code,
    metadata_hash,
});
struct_codec!(MachinePort {
    port_id,
    mode,
    accepted,
    capacity,
    resources,
});
struct_codec!(MachineRecipe {
    recipe_id,
    duration_ticks,
    inputs,
    outputs,
});
struct_codec!(ActivityLease {
    lease_id,
    owner_id,
    start_tick,
    end_tick,
    max_cycles,
});
struct_codec!(MachineState {
    machine_id,
    owner_id,
    kind,
    revision,
    active,
    recipe_id,
    progress_ticks,
    last_tick,
    ports,
    lease,
    settings,
});
struct_codec!(PowerNetwork {
    network_id,
    revision,
    stored,
    capacity,
    members,
});
struct_codec!(MachineStateSet {
    machines,
    recipes,
    power_networks,
});

struct_codec!(FixedVec3 {
    x_milli,
    y_milli,
    z_milli,
});
struct_codec!(StatusInstance {
    status_id,
    source_id,
    magnitude,
    expires_tick,
    stacks,
});

/// Exact combatant payload emitted by gameplay snapshot schemas V1-V3.
///
/// Keep this independent from `CombatantState` so adding fields to the current
/// authority never changes a frozen legacy decoder.
#[derive(Clone)]
struct LegacyCombatantStateV3 {
    record_id: String,
    owner_id: Option<String>,
    revision: u64,
    position: FixedVec3,
    health: u32,
    max_health: u32,
    stamina: u32,
    mana: u32,
    armor: u32,
    resist_per_mille: BTreeMap<DamageKind, u16>,
    statuses: BTreeMap<String, StatusInstance>,
    cooldown_until: BTreeMap<String, u64>,
    alive: bool,
}

struct_codec!(LegacyCombatantStateV3 {
    record_id,
    owner_id,
    revision,
    position,
    health,
    max_health,
    stamina,
    mana,
    armor,
    resist_per_mille,
    statuses,
    cooldown_until,
    alive,
});

impl From<&CombatantState> for LegacyCombatantStateV3 {
    fn from(value: &CombatantState) -> Self {
        Self {
            record_id: value.record_id.clone(),
            owner_id: value.owner_id.clone(),
            revision: value.revision,
            position: value.position,
            health: value.health,
            max_health: value.max_health,
            stamina: value.stamina,
            mana: value.mana,
            armor: value.armor,
            resist_per_mille: value.resist_per_mille.clone(),
            statuses: value.statuses.clone(),
            cooldown_until: value.cooldown_until.clone(),
            alive: value.alive,
        }
    }
}

impl From<LegacyCombatantStateV3> for CombatantState {
    fn from(value: LegacyCombatantStateV3) -> Self {
        Self {
            record_id: value.record_id,
            owner_id: value.owner_id,
            revision: value.revision,
            position: value.position,
            health: value.health,
            max_health: value.max_health,
            stamina: value.stamina,
            mana: value.mana,
            armor: value.armor,
            resist_per_mille: value.resist_per_mille,
            statuses: value.statuses,
            cooldown_until: value.cooldown_until,
            alive: value.alive,
            vital_units: CombatVitalUnits::LegacyWholeHeartsV1,
            entity_id: None,
        }
    }
}

struct_codec!(CombatantState {
    record_id,
    owner_id,
    revision,
    position,
    health,
    max_health,
    stamina,
    mana,
    armor,
    resist_per_mille,
    statuses,
    cooldown_until,
    alive,
    vital_units,
    entity_id,
});
struct_codec!(StatusTemplate {
    status_id,
    magnitude,
    duration_ticks,
    max_stacks,
});
struct_codec!(AbilitySpec {
    ability_id,
    damage_kind,
    base_damage,
    range_milli,
    cooldown_ticks,
    stamina_cost,
    mana_cost,
    projectile_speed_milli,
    status,
});
struct_codec!(ProjectileState {
    projectile_id,
    source_id,
    target_id,
    ability_id,
    position,
    velocity,
    spawned_tick,
    expires_tick,
    revision,
    presentation,
});
struct_codec!(CombatPresentationLinkV1 {
    entity_id,
    content_domain,
    content_id,
    presentation_id,
});
struct_codec!(CreatureCompatibilityRecord {
    record_id,
    creature_content_id,
    variant_id,
    disposition,
    readiness,
    captured_by,
    owner_id,
    bond,
    care,
    equipment_ids,
    research_flags,
    pacification_score,
    last_aggression_tick,
    revision,
});
struct_codec!(SummonState {
    summon_id,
    content_id,
    owner_id,
    spawned_tick,
    expires_tick,
    grounded,
    revision,
    position,
    presentation,
});
struct_codec!(CombatState {
    combatants,
    abilities,
    projectiles,
    creatures,
    summons,
    tick,
});

struct_codec!(SkillState { rank, xp });
struct_codec!(PlayerProgression {
    player_id,
    revision,
    level,
    perk_points,
    skills,
    unlocked_perks,
    research_flags,
    fast_travel_charges,
});
struct_codec!(PerkDefinition {
    perk_id,
    skill_id,
    required_rank,
    cost,
    prerequisites,
});
struct_codec!(QuestRecord {
    record_id,
    owner_id,
    quest_id,
    revision,
    stage,
    completed,
    choices,
    flags,
});
struct_codec!(QuestChoiceDefinition {
    quest_id,
    stage,
    option_id,
    next_stage,
    required_flags,
    granted_flags,
    complete,
});
struct_codec!(AlignmentRecord {
    record_id,
    owner_id,
    content_id,
    revision,
    standing,
    rank,
    flags,
});
struct_codec!(Wallet {
    owner_id,
    revision,
    balances,
});
struct_codec!(MarketListing {
    listing_id,
    seller_id,
    content_id,
    currency_id,
    unit_price,
    available,
    revision,
});
struct_codec!(SettlementRecord {
    settlement_id,
    faction_id,
    revision,
    prosperity,
    safety,
    population,
    upgrades,
});
struct_codec!(DragonRecord {
    dragon_id,
    owner_id,
    species_id,
    variant_id,
    revision,
    level,
    xp,
    bond,
    unlocked_moves,
    equipment_ids,
    research_flags,
});
struct_codec!(LegendaryEncounter {
    encounter_id,
    creature_id,
    revision,
    phase,
    resolved,
    eligible_players,
    flags,
});
struct_codec!(ProgressionState {
    players,
    perks,
    quests,
    quest_choices,
    factions,
    guilds,
    wallets,
    listings,
    settlements,
    dragons,
    legendary,
    dialogue_history,
});

struct_codec!(PrintingKey {
    card_id,
    variant_id,
    finish_id,
});
struct_codec!(CardDefinition {
    printing,
    rarity,
    class_ids,
    type_ids,
    deck_cost,
    power,
    health,
    rules,
});
struct_codec!(WeightedCard { printing, weight });
struct_codec!(PackSlot { candidates });
struct_codec!(PackDefinition { pack_id, slots });
struct_codec!(PackRecord {
    record_id,
    owner_id,
    pack_id,
    seed,
    revision,
    opened,
});
struct_codec!(CardCustody {
    owner_id,
    revision,
    case,
    archive,
    rewards_claimed,
});
struct_codec!(DeckRules {
    min_cards,
    max_cards,
    max_copies,
    max_cost,
    allowed_classes,
    banned_cards,
});
struct_codec!(DeckRecord {
    deck_id,
    owner_id,
    rules_id,
    revision,
    cards,
});
struct_codec!(BattlePlayer {
    owner_id,
    deck_id,
    health,
    resource,
    hand,
    draw_pile,
    board,
});

impl SnapshotCodec for BattleState {
    fn encode(&self, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
        self.match_id.encode(writer)?;
        self.revision.encode(writer)?;
        self.sequence.encode(writer)?;
        self.active_player.encode(writer)?;
        self.players[0].encode(writer)?;
        self.players[1].encode(writer)?;
        self.winner.encode(writer)
    }

    fn decode(reader: &mut Reader<'_>) -> Result<Self, GameplaySnapshotError> {
        Ok(Self {
            match_id: String::decode(reader)?,
            revision: u64::decode(reader)?,
            sequence: u32::decode(reader)?,
            active_player: u8::decode(reader)?,
            players: [BattlePlayer::decode(reader)?, BattlePlayer::decode(reader)?],
            winner: Option::<String>::decode(reader)?,
        })
    }
}

struct_codec!(CardforgeState {
    cards,
    packs,
    pack_records,
    custody,
    deck_rules,
    decks,
    battles,
});
struct_codec!(GameplayState {
    world,
    revision,
    tick,
    inventory,
    machines,
    combat,
    progression,
    cardforge,
});

fn decode_gameplay_state_v1(reader: &mut Reader<'_>) -> Result<GameplayState, GameplaySnapshotError> {
    Ok(GameplayState {
        world: SnapshotCodec::decode(reader)?,
        revision: SnapshotCodec::decode(reader)?,
        tick: SnapshotCodec::decode(reader)?,
        inventory: decode_inventory_state_v1(reader)?,
        machines: SnapshotCodec::decode(reader)?,
        combat: decode_combat_state_v2(reader)?,
        progression: SnapshotCodec::decode(reader)?,
        cardforge: SnapshotCodec::decode(reader)?,
    })
}

#[cfg(test)]
fn encode_gameplay_state_v1(value: &GameplayState, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
    value.world.encode(writer)?;
    value.revision.encode(writer)?;
    value.tick.encode(writer)?;
    value.inventory.items.encode(writer)?;
    value.inventory.containers.encode(writer)?;
    value.inventory.recipes.encode(writer)?;
    value.inventory.furnaces.encode(writer)?;
    value.machines.encode(writer)?;
    encode_combat_state_v2(&value.combat, writer)?;
    value.progression.encode(writer)?;
    value.cardforge.encode(writer)
}

fn decode_gameplay_state_v2(reader: &mut Reader<'_>) -> Result<GameplayState, GameplaySnapshotError> {
    Ok(GameplayState {
        world: SnapshotCodec::decode(reader)?,
        revision: SnapshotCodec::decode(reader)?,
        tick: SnapshotCodec::decode(reader)?,
        inventory: SnapshotCodec::decode(reader)?,
        machines: SnapshotCodec::decode(reader)?,
        combat: decode_combat_state_v2(reader)?,
        progression: SnapshotCodec::decode(reader)?,
        cardforge: SnapshotCodec::decode(reader)?,
    })
}

#[cfg(test)]
fn encode_gameplay_state_v2(value: &GameplayState, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
    value.world.encode(writer)?;
    value.revision.encode(writer)?;
    value.tick.encode(writer)?;
    value.inventory.encode(writer)?;
    value.machines.encode(writer)?;
    encode_combat_state_v2(&value.combat, writer)?;
    value.progression.encode(writer)?;
    value.cardforge.encode(writer)
}

fn decode_gameplay_state_v3(reader: &mut Reader<'_>) -> Result<GameplayState, GameplaySnapshotError> {
    Ok(GameplayState {
        world: SnapshotCodec::decode(reader)?,
        revision: SnapshotCodec::decode(reader)?,
        tick: SnapshotCodec::decode(reader)?,
        inventory: SnapshotCodec::decode(reader)?,
        machines: SnapshotCodec::decode(reader)?,
        combat: decode_combat_state_v3(reader)?,
        progression: SnapshotCodec::decode(reader)?,
        cardforge: SnapshotCodec::decode(reader)?,
    })
}

#[cfg(test)]
fn encode_gameplay_state_v3(value: &GameplayState, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
    value.world.encode(writer)?;
    value.revision.encode(writer)?;
    value.tick.encode(writer)?;
    value.inventory.encode(writer)?;
    value.machines.encode(writer)?;
    encode_combat_state_v3(&value.combat, writer)?;
    value.progression.encode(writer)?;
    value.cardforge.encode(writer)
}

fn decode_combat_state_v2(reader: &mut Reader<'_>) -> Result<CombatState, GameplaySnapshotError> {
    let combatants = BTreeMap::<String, LegacyCombatantStateV3>::decode(reader)?
        .into_iter()
        .map(|(id, value)| (id, value.into()))
        .collect();
    let abilities = BTreeMap::<String, AbilitySpec>::decode(reader)?;
    let legacy_projectiles = BTreeMap::<String, LegacyProjectileStateV2>::decode(reader)?;
    let creatures = BTreeMap::<String, CreatureCompatibilityRecord>::decode(reader)?;
    let legacy_summons = BTreeMap::<String, LegacySummonStateV2>::decode(reader)?;
    let tick = u64::decode(reader)?;
    Ok(CombatState {
        combatants,
        abilities,
        projectiles: legacy_projectiles
            .into_iter()
            .map(|(id, value)| {
                (
                    id,
                    ProjectileState {
                        projectile_id: value.projectile_id,
                        source_id: value.source_id,
                        target_id: value.target_id,
                        ability_id: value.ability_id,
                        position: value.position,
                        velocity: value.velocity,
                        spawned_tick: value.spawned_tick,
                        expires_tick: value.expires_tick,
                        revision: value.revision,
                        presentation: None,
                    },
                )
            })
            .collect(),
        creatures,
        summons: legacy_summons
            .into_iter()
            .map(|(id, value)| {
                (
                    id,
                    SummonState {
                        summon_id: value.summon_id,
                        content_id: value.content_id,
                        owner_id: value.owner_id,
                        spawned_tick: value.spawned_tick,
                        expires_tick: value.expires_tick,
                        grounded: value.grounded,
                        revision: value.revision,
                        position: None,
                        presentation: None,
                    },
                )
            })
            .collect(),
        tick,
    })
}

#[cfg(test)]
fn encode_combat_state_v2(value: &CombatState, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
    value
        .combatants
        .iter()
        .map(|(id, combatant)| (id.clone(), LegacyCombatantStateV3::from(combatant)))
        .collect::<BTreeMap<_, _>>()
        .encode(writer)?;
    value.abilities.encode(writer)?;
    value
        .projectiles
        .iter()
        .map(|(id, projectile)| (id.clone(), LegacyProjectileStateV2::from(projectile)))
        .collect::<BTreeMap<_, _>>()
        .encode(writer)?;
    value.creatures.encode(writer)?;
    value
        .summons
        .iter()
        .map(|(id, summon)| (id.clone(), LegacySummonStateV2::from(summon)))
        .collect::<BTreeMap<_, _>>()
        .encode(writer)?;
    value.tick.encode(writer)
}

fn decode_combat_state_v3(reader: &mut Reader<'_>) -> Result<CombatState, GameplaySnapshotError> {
    Ok(CombatState {
        combatants: BTreeMap::<String, LegacyCombatantStateV3>::decode(reader)?
            .into_iter()
            .map(|(id, value)| (id, value.into()))
            .collect(),
        abilities: SnapshotCodec::decode(reader)?,
        projectiles: SnapshotCodec::decode(reader)?,
        creatures: SnapshotCodec::decode(reader)?,
        summons: SnapshotCodec::decode(reader)?,
        tick: SnapshotCodec::decode(reader)?,
    })
}

#[cfg(test)]
fn encode_combat_state_v3(value: &CombatState, writer: &mut Writer) -> Result<(), GameplaySnapshotError> {
    value
        .combatants
        .iter()
        .map(|(id, combatant)| (id.clone(), LegacyCombatantStateV3::from(combatant)))
        .collect::<BTreeMap<_, _>>()
        .encode(writer)?;
    value.abilities.encode(writer)?;
    value.projectiles.encode(writer)?;
    value.creatures.encode(writer)?;
    value.summons.encode(writer)?;
    value.tick.encode(writer)
}

#[derive(Clone)]
struct LegacyProjectileStateV2 {
    projectile_id: String,
    source_id: String,
    target_id: Option<String>,
    ability_id: String,
    position: FixedVec3,
    velocity: FixedVec3,
    spawned_tick: u64,
    expires_tick: u64,
    revision: u64,
}

struct_codec!(LegacyProjectileStateV2 {
    projectile_id,
    source_id,
    target_id,
    ability_id,
    position,
    velocity,
    spawned_tick,
    expires_tick,
    revision,
});

impl From<&ProjectileState> for LegacyProjectileStateV2 {
    fn from(value: &ProjectileState) -> Self {
        Self {
            projectile_id: value.projectile_id.clone(),
            source_id: value.source_id.clone(),
            target_id: value.target_id.clone(),
            ability_id: value.ability_id.clone(),
            position: value.position,
            velocity: value.velocity,
            spawned_tick: value.spawned_tick,
            expires_tick: value.expires_tick,
            revision: value.revision,
        }
    }
}

#[derive(Clone)]
struct LegacySummonStateV2 {
    summon_id: String,
    content_id: String,
    owner_id: String,
    spawned_tick: u64,
    expires_tick: Option<u64>,
    grounded: bool,
    revision: u64,
}

struct_codec!(LegacySummonStateV2 {
    summon_id,
    content_id,
    owner_id,
    spawned_tick,
    expires_tick,
    grounded,
    revision,
});

impl From<&SummonState> for LegacySummonStateV2 {
    fn from(value: &SummonState) -> Self {
        Self {
            summon_id: value.summon_id.clone(),
            content_id: value.content_id.clone(),
            owner_id: value.owner_id.clone(),
            spawned_tick: value.spawned_tick,
            expires_tick: value.expires_tick,
            grounded: value.grounded,
            revision: value.revision,
        }
    }
}

impl GameplayAuthority {
    /// Encode the complete authority, including grants, retry receipts, replay
    /// order, and opaque future bytes, into the canonical V4 persistence record.
    pub fn encode_snapshot(&self, unknown_extension_bytes: &[u8]) -> Result<Vec<u8>, GameplaySnapshotError> {
        if unknown_extension_bytes.len() > MAX_GAMEPLAY_SNAPSHOT_EXTENSIONS {
            return Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                0,
                "snapshot extension exceeds the V4 bound",
            ));
        }
        validate_snapshot_state(&self.state)?;
        let parts = self.snapshot_parts();
        let mut payload = Writer::default();
        parts.state.encode(&mut payload)?;
        parts.grants.encode(&mut payload)?;
        parts.idempotency.encode(&mut payload)?;
        parts.idempotency_order.encode(&mut payload)?;
        parts.replay.encode(&mut payload)?;
        payload.bounded_bytes(unknown_extension_bytes, MAX_GAMEPLAY_SNAPSHOT_EXTENSIONS)?;

        let payload_hash = payload_hash(GAMEPLAY_SNAPSHOT_SCHEMA_VERSION, &payload.bytes);
        let state_hash = self.state.state_hash();
        let replay_hash = self.replay_hash();
        let total = HEADER_BYTES.checked_add(payload.bytes.len()).ok_or_else(|| {
            GameplaySnapshotError::new(GameplaySnapshotErrorCode::Capacity, 0, "snapshot length overflow")
        })?;
        if total > MAX_GAMEPLAY_SNAPSHOT_BYTES {
            return Err(GameplaySnapshotError::new(
                GameplaySnapshotErrorCode::Capacity,
                0,
                "snapshot exceeds the V4 file bound",
            ));
        }

        let mut output = Writer::default();
        output.raw(&SNAPSHOT_MAGIC);
        GAMEPLAY_SNAPSHOT_SCHEMA_VERSION.encode(&mut output)?;
        SNAPSHOT_FLAGS.encode(&mut output)?;
        u64::try_from(payload.bytes.len())
            .map_err(|_| {
                GameplaySnapshotError::new(
                    GameplaySnapshotErrorCode::Capacity,
                    output.bytes.len(),
                    "snapshot payload length exceeds u64",
                )
            })?
            .encode(&mut output)?;
        state_hash.encode(&mut output)?;
        replay_hash.encode(&mut output)?;
        payload_hash.encode(&mut output)?;
        output.raw(&payload.bytes);
        Ok(output.bytes)
    }

    /// Decode and validate into a temporary authority, then replace `self` in
    /// one assignment. An error leaves the original authority untouched.
    pub fn install_snapshot(&mut self, bytes: &[u8]) -> Result<GameplaySnapshotInstallReport, GameplaySnapshotError> {
        let decoded = decode_gameplay_authority_snapshot(bytes)?;
        let report = GameplaySnapshotInstallReport {
            schema_version: decoded.schema_version,
            state_hash: decoded.authority.state.state_hash(),
            replay_hash: decoded.authority.replay_hash(),
            snapshot_hash: decoded.snapshot_hash,
            unknown_extension_bytes: decoded.unknown_extension_bytes,
        };
        *self = decoded.authority;
        Ok(report)
    }
}

pub fn decode_gameplay_authority_snapshot(
    bytes: &[u8],
) -> Result<DecodedGameplayAuthoritySnapshot, GameplaySnapshotError> {
    if bytes.len() > MAX_GAMEPLAY_SNAPSHOT_BYTES {
        return Err(GameplaySnapshotError::new(
            GameplaySnapshotErrorCode::Capacity,
            0,
            "snapshot exceeds the gameplay file bound",
        ));
    }
    if bytes.len() < HEADER_BYTES {
        return Err(GameplaySnapshotError::new(
            GameplaySnapshotErrorCode::Truncated,
            bytes.len(),
            "snapshot is shorter than its header",
        ));
    }
    let mut header = Reader::new(bytes);
    if header.raw(SNAPSHOT_MAGIC.len())? != SNAPSHOT_MAGIC {
        return Err(GameplaySnapshotError::new(
            GameplaySnapshotErrorCode::InvalidHeader,
            0,
            "snapshot magic is invalid",
        ));
    }
    let schema = u16::decode(&mut header)?;
    if !(GAMEPLAY_SNAPSHOT_MIN_SUPPORTED_SCHEMA_VERSION..=GAMEPLAY_SNAPSHOT_SCHEMA_VERSION).contains(&schema) {
        return Err(GameplaySnapshotError::new(
            GameplaySnapshotErrorCode::UnsupportedVersion,
            SNAPSHOT_MAGIC.len(),
            "snapshot schema is unsupported",
        ));
    }
    let flags = u16::decode(&mut header)?;
    if flags != SNAPSHOT_FLAGS {
        return Err(GameplaySnapshotError::new(
            GameplaySnapshotErrorCode::UnsupportedVersion,
            SNAPSHOT_MAGIC.len() + 2,
            "snapshot uses unsupported required flags",
        ));
    }
    let payload_length = usize::try_from(u64::decode(&mut header)?).map_err(|_| {
        GameplaySnapshotError::new(
            GameplaySnapshotErrorCode::Capacity,
            SNAPSHOT_MAGIC.len() + 4,
            "snapshot payload cannot fit this platform",
        )
    })?;
    let expected_state_hash = CanonicalHash::decode(&mut header)?;
    let expected_replay_hash = CanonicalHash::decode(&mut header)?;
    let expected_payload_hash = CanonicalHash::decode(&mut header)?;
    if payload_length != header.remaining() {
        return Err(GameplaySnapshotError::new(
            GameplaySnapshotErrorCode::Truncated,
            header.offset,
            "snapshot payload length does not match the file",
        ));
    }
    let payload = header.raw(payload_length)?.to_vec();
    header.finish()?;
    if payload_hash(schema, &payload) != expected_payload_hash {
        return Err(GameplaySnapshotError::new(
            GameplaySnapshotErrorCode::Corrupt,
            HEADER_BYTES,
            "snapshot payload hash does not match",
        ));
    }

    let mut reader = Reader::new(&payload);
    let state = match schema {
        1 => decode_gameplay_state_v1(&mut reader)?,
        2 => decode_gameplay_state_v2(&mut reader)?,
        3 => decode_gameplay_state_v3(&mut reader)?,
        _ => GameplayState::decode(&mut reader)?,
    };
    let grants = BTreeMap::<String, ActorGrant>::decode(&mut reader)?;
    let idempotency = BTreeMap::<(String, String), IdempotencyEntry>::decode(&mut reader)?;
    let idempotency_order = VecDeque::<(String, String)>::decode(&mut reader)?;
    let replay = Vec::<ReplayEntry>::decode(&mut reader)?;
    let unknown_extension_bytes = reader.bounded_bytes(MAX_GAMEPLAY_SNAPSHOT_EXTENSIONS)?;
    reader.finish()?;
    validate_snapshot_state(&state)?;
    if state.state_hash() != expected_state_hash {
        return Err(GameplaySnapshotError::new(
            GameplaySnapshotErrorCode::Corrupt,
            HEADER_BYTES,
            "snapshot state hash does not match",
        ));
    }
    let authority = GameplayAuthority::from_snapshot_parts(GameplayAuthoritySnapshotParts {
        state,
        grants,
        idempotency,
        idempotency_order,
        replay,
    })
    .map_err(authority_error)?;
    if authority.replay_hash() != expected_replay_hash {
        return Err(GameplaySnapshotError::new(
            GameplaySnapshotErrorCode::Corrupt,
            HEADER_BYTES,
            "snapshot replay hash does not match",
        ));
    }
    Ok(DecodedGameplayAuthoritySnapshot {
        authority,
        schema_version: schema,
        unknown_extension_bytes,
        snapshot_hash: snapshot_hash(bytes),
    })
}

pub fn import_legacy_gameplay_projection_v0(
    projection: LegacyGameplayProjectionV0,
) -> Result<GameplayAuthority, GameplaySnapshotError> {
    validate_snapshot_state(&projection.state)?;
    let mut authority = GameplayAuthority::new(projection.state);
    for (actor_id, grant) in projection.grants {
        authority.grant_actor(actor_id, grant).map_err(authority_error)?;
    }
    Ok(authority)
}

#[must_use]
pub fn canonical_gameplay_snapshot_hash(bytes: &[u8]) -> CanonicalHash {
    snapshot_hash(bytes)
}

fn payload_hash(schema_version: u16, bytes: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild.gameplay.snapshot.payload.v1");
    hasher.write_u16(schema_version);
    hasher.write_bytes(bytes);
    hasher.finish()
}

fn snapshot_hash(bytes: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild.gameplay.snapshot.file.v1");
    hasher.write_bytes(bytes);
    hasher.finish()
}

fn authority_error(rejection: Rejection) -> GameplaySnapshotError {
    GameplaySnapshotError::new(GameplaySnapshotErrorCode::AuthorityRejected, 0, rejection.message)
}

fn validate_snapshot_state(state: &GameplayState) -> Result<(), GameplaySnapshotError> {
    state.world.validate().map_err(authority_error)?;
    validate_inventory(&state.inventory)?;
    validate_machines(&state.machines)?;
    validate_combat(&state.combat)?;
    validate_progression(&state.progression)?;
    validate_cardforge(&state.cardforge)?;
    Ok(())
}

fn validate_inventory(state: &InventoryState) -> Result<(), GameplaySnapshotError> {
    let mut validated = InventoryState::default();
    for (code, item) in &state.items {
        if *code != item.code {
            return invalid("inventory item map key disagrees with its definition");
        }
        validated.register_item(item.clone()).map_err(authority_error)?;
    }
    for (key, container) in &state.containers {
        if key != &container.key {
            return invalid("container map key disagrees with its record");
        }
        validated.insert_container(container.clone()).map_err(authority_error)?;
    }
    for (recipe_id, recipe) in &state.recipes {
        if recipe_id != &recipe.recipe_id {
            return invalid("recipe map key disagrees with its definition");
        }
        validated.register_recipe(recipe.clone()).map_err(authority_error)?;
    }
    for (furnace_id, furnace) in &state.furnaces {
        if furnace_id != &furnace.furnace_id {
            return invalid("furnace map key disagrees with its record");
        }
        validate_identifier("furnace", furnace_id)?;
        if !state.recipes.contains_key(&furnace.recipe_id)
            || !state.containers.contains_key(&furnace.source)
            || !state.containers.contains_key(&furnace.destination)
        {
            return invalid("furnace references an unknown recipe or container");
        }
    }
    for (hash, metadata) in &state.item_instance_metadata {
        if hash != &metadata.hash {
            return invalid("item-instance metadata map key disagrees with its record");
        }
        metadata.validate().map_err(authority_error)?;
    }
    Ok(())
}

fn validate_machines(state: &MachineStateSet) -> Result<(), GameplaySnapshotError> {
    let mut validated = MachineStateSet::default();
    for (recipe_id, recipe) in &state.recipes {
        if recipe_id != &recipe.recipe_id {
            return invalid("machine recipe map key disagrees with its definition");
        }
        validated.register_recipe(recipe.clone()).map_err(authority_error)?;
    }
    for (machine_id, machine) in &state.machines {
        if machine_id != &machine.machine_id {
            return invalid("machine map key disagrees with its record");
        }
        if let Some(recipe_id) = &machine.recipe_id
            && !state.recipes.contains_key(recipe_id)
        {
            return invalid("machine references an unknown recipe");
        }
        for (port_id, port) in &machine.ports {
            if port_id != &port.port_id {
                return invalid("machine port map key disagrees with its record");
            }
        }
        if let Some(lease) = &machine.lease {
            lease.validate().map_err(authority_error)?;
        }
        validated.insert_machine(machine.clone()).map_err(authority_error)?;
    }
    for (network_id, network) in &state.power_networks {
        if network_id != &network.network_id {
            return invalid("power network map key disagrees with its record");
        }
        validate_identifier("power network", network_id)?;
        if network.capacity == 0 || network.stored > network.capacity {
            return invalid("power network storage is outside capacity");
        }
        if network
            .members
            .iter()
            .any(|member| !state.machines.contains_key(member))
        {
            return invalid("power network references an unknown machine");
        }
    }
    Ok(())
}

fn validate_combat(state: &CombatState) -> Result<(), GameplaySnapshotError> {
    let mut validated = CombatState::default();
    let mut linked_entities = BTreeSet::new();
    for (ability_id, ability) in &state.abilities {
        if ability_id != &ability.ability_id {
            return invalid("ability map key disagrees with its definition");
        }
        validated.register_ability(ability.clone()).map_err(authority_error)?;
    }
    for (record_id, combatant) in &state.combatants {
        if record_id != &combatant.record_id {
            return invalid("combatant map key disagrees with its record");
        }
        validate_identifier("combatant", record_id)?;
        if combatant.max_health == 0 || combatant.health > combatant.max_health {
            return invalid("combatant health is outside its bounds");
        }
        if (combatant.vital_units != CombatVitalUnits::LegacyWholeHeartsV1 || combatant.entity_id.is_some())
            && combatant.alive != (combatant.health > 0)
        {
            return invalid("linked or precision combatant alive state disagrees with health");
        }
        if let Some(entity_id) = combatant.entity_id {
            if entity_id.packed() == 0 {
                return invalid("combatant entity link uses the reserved id");
            }
            if !linked_entities.insert(entity_id) {
                return invalid("combatant entity link is duplicated");
            }
        }
        for (status_id, status) in &combatant.statuses {
            if status_id != &status.status_id {
                return invalid("combatant status key disagrees with its record");
            }
            validate_identifier("status source", &status.source_id)?;
        }
        for ability_id in combatant.cooldown_until.keys() {
            validate_identifier("cooldown", ability_id)?;
        }
    }
    for (projectile_id, projectile) in &state.projectiles {
        if projectile_id != &projectile.projectile_id {
            return invalid("projectile map key disagrees with its record");
        }
        validate_identifier("projectile", projectile_id)?;
        if projectile.spawned_tick > projectile.expires_tick
            || !state.abilities.contains_key(&projectile.ability_id)
            || !state.combatants.contains_key(&projectile.source_id)
            || projectile
                .target_id
                .as_ref()
                .is_some_and(|target| !state.combatants.contains_key(target))
        {
            return invalid("projectile has an invalid lifetime or authority reference");
        }
        if let Some(link) = &projectile.presentation {
            validate_identifier("projectile presentation content", &link.content_id)?;
            validate_identifier("projectile presentation profile", &link.presentation_id)?;
            let elapsed_ticks = state.tick.checked_sub(projectile.spawned_tick);
            if link.entity_id.packed() == 0
                || link.content_domain != ContentDomain::Item
                || elapsed_ticks != Some(projectile.revision)
                || projectile.expires_tick <= state.tick
            {
                return invalid("projectile presentation link is invalid");
            }
        }
    }
    for (record_id, creature) in &state.creatures {
        if record_id != &creature.record_id || !state.combatants.contains_key(record_id) {
            return invalid("creature key or combatant reference is invalid");
        }
        validate_identifier("creature content", &creature.creature_content_id)?;
        validate_identifier("creature variant", &creature.variant_id)?;
        validate_ids("creature equipment", &creature.equipment_ids)?;
        validate_id_set("creature research", &creature.research_flags)?;
    }
    for (summon_id, summon) in &state.summons {
        if summon_id != &summon.summon_id || summon.expires_tick.is_some_and(|expires| expires < summon.spawned_tick) {
            return invalid("summon key or lifetime is invalid");
        }
        validate_identifier("summon", summon_id)?;
        validate_identifier("summon content", &summon.content_id)?;
        validate_identifier("summon owner", &summon.owner_id)?;
        if summon.presentation.is_some() != summon.position.is_some() {
            return invalid("summon presentation link and position must have equal presence");
        }
        if let Some(link) = &summon.presentation {
            validate_identifier("summon presentation content", &link.content_id)?;
            validate_identifier("summon presentation profile", &link.presentation_id)?;
            if link.entity_id.packed() == 0
                || link.content_domain != ContentDomain::CreatureProfile
                || link.content_id != summon.content_id
                || summon.spawned_tick > state.tick
                || summon.expires_tick.is_some_and(|expires| expires <= state.tick)
            {
                return invalid("summon presentation link is invalid");
            }
        }
    }
    Ok(())
}

fn validate_progression(state: &ProgressionState) -> Result<(), GameplaySnapshotError> {
    for (player_id, player) in &state.players {
        if player_id != &player.player_id {
            return invalid("player progression key disagrees with its record");
        }
        validate_identifier("progression player", player_id)?;
        for skill_id in player.skills.keys() {
            validate_identifier("skill", skill_id)?;
        }
        validate_id_set("unlocked perk", &player.unlocked_perks)?;
        validate_id_set("player research", &player.research_flags)?;
    }
    for (perk_id, perk) in &state.perks {
        if perk_id != &perk.perk_id {
            return invalid("perk map key disagrees with its definition");
        }
        validate_identifier("perk", perk_id)?;
        validate_identifier("perk skill", &perk.skill_id)?;
        validate_id_set("perk prerequisite", &perk.prerequisites)?;
    }
    for (record_id, quest) in &state.quests {
        if record_id != &quest.record_id {
            return invalid("quest map key disagrees with its record");
        }
        validate_identifier("quest record", record_id)?;
        validate_identifier("quest owner", &quest.owner_id)?;
        validate_identifier("quest", &quest.quest_id)?;
        validate_ids("quest choice history", &quest.choices)?;
        validate_id_set("quest flag", &quest.flags)?;
    }
    for ((quest_id, stage, option_id), choice) in &state.quest_choices {
        if quest_id != &choice.quest_id || stage != &choice.stage || option_id != &choice.option_id {
            return invalid("quest choice map key disagrees with its definition");
        }
        validate_identifier("quest choice quest", quest_id)?;
        validate_identifier("quest choice option", option_id)?;
        validate_id_set("quest choice requirement", &choice.required_flags)?;
        validate_id_set("quest choice grant", &choice.granted_flags)?;
    }
    validate_alignments(&state.factions, "faction")?;
    validate_alignments(&state.guilds, "guild")?;
    for (owner_id, wallet) in &state.wallets {
        if owner_id != &wallet.owner_id {
            return invalid("wallet map key disagrees with its record");
        }
        validate_identifier("wallet owner", owner_id)?;
        validate_id_map("wallet currency", &wallet.balances)?;
    }
    for (listing_id, listing) in &state.listings {
        if listing_id != &listing.listing_id {
            return invalid("market listing key disagrees with its record");
        }
        validate_identifier("market listing", listing_id)?;
        validate_identifier("market seller", &listing.seller_id)?;
        validate_identifier("market content", &listing.content_id)?;
        validate_identifier("market currency", &listing.currency_id)?;
    }
    for (settlement_id, settlement) in &state.settlements {
        if settlement_id != &settlement.settlement_id {
            return invalid("settlement map key disagrees with its record");
        }
        validate_identifier("settlement", settlement_id)?;
        validate_identifier("settlement faction", &settlement.faction_id)?;
        validate_id_set("settlement upgrade", &settlement.upgrades)?;
    }
    for (dragon_id, dragon) in &state.dragons {
        if dragon_id != &dragon.dragon_id {
            return invalid("dragon map key disagrees with its record");
        }
        validate_identifier("dragon", dragon_id)?;
        validate_identifier("dragon owner", &dragon.owner_id)?;
        validate_identifier("dragon species", &dragon.species_id)?;
        validate_identifier("dragon variant", &dragon.variant_id)?;
        validate_id_set("dragon move", &dragon.unlocked_moves)?;
        validate_ids("dragon equipment", &dragon.equipment_ids)?;
        validate_id_set("dragon research", &dragon.research_flags)?;
    }
    for (encounter_id, encounter) in &state.legendary {
        if encounter_id != &encounter.encounter_id {
            return invalid("legendary encounter key disagrees with its record");
        }
        validate_identifier("legendary encounter", encounter_id)?;
        validate_identifier("legendary creature", &encounter.creature_id)?;
        validate_id_set("legendary player", &encounter.eligible_players)?;
        validate_id_set("legendary flag", &encounter.flags)?;
    }
    for (owner_id, history) in &state.dialogue_history {
        validate_identifier("dialogue owner", owner_id)?;
        validate_ids("dialogue choice", history)?;
    }
    Ok(())
}

fn validate_cardforge(state: &CardforgeState) -> Result<(), GameplaySnapshotError> {
    let mut validated = CardforgeState::default();
    for (printing, card) in &state.cards {
        if printing != &card.printing {
            return invalid("card map key disagrees with its definition");
        }
        validated.register_card(card.clone()).map_err(authority_error)?;
    }
    for (pack_id, pack) in &state.packs {
        if pack_id != &pack.pack_id {
            return invalid("pack map key disagrees with its definition");
        }
        validated.register_pack(pack.clone()).map_err(authority_error)?;
    }
    for (record_id, record) in &state.pack_records {
        if record_id != &record.record_id || !state.packs.contains_key(&record.pack_id) {
            return invalid("pack record key or definition reference is invalid");
        }
        validate_identifier("pack record", record_id)?;
        validate_identifier("pack owner", &record.owner_id)?;
    }
    for (owner_id, custody) in &state.custody {
        if owner_id != &custody.owner_id {
            return invalid("card custody key disagrees with its record");
        }
        validate_identifier("card custody owner", owner_id)?;
        if custody
            .case
            .keys()
            .chain(custody.archive.keys())
            .any(|printing| !state.cards.contains_key(printing))
        {
            return invalid("card custody references an unknown printing");
        }
        validate_id_set("card reward", &custody.rewards_claimed)?;
    }
    for (rules_id, rules) in &state.deck_rules {
        validate_identifier("deck rules", rules_id)?;
        if rules.min_cards > rules.max_cards {
            return invalid("deck rules are internally inconsistent");
        }
        validate_id_set("deck class", &rules.allowed_classes)?;
        validate_id_set("banned card", &rules.banned_cards)?;
    }
    for (deck_id, deck) in &state.decks {
        if deck_id != &deck.deck_id
            || !state.deck_rules.contains_key(&deck.rules_id)
            || deck.cards.keys().any(|printing| !state.cards.contains_key(printing))
        {
            return invalid("deck key or authority reference is invalid");
        }
        validate_identifier("deck", deck_id)?;
        validate_identifier("deck owner", &deck.owner_id)?;
    }
    for (match_id, battle) in &state.battles {
        if match_id != &battle.match_id || battle.active_player > 1 {
            return invalid("battle key or active player is invalid");
        }
        validate_identifier("battle", match_id)?;
        for player in &battle.players {
            validate_identifier("battle owner", &player.owner_id)?;
            if !state.decks.contains_key(&player.deck_id)
                || player
                    .hand
                    .iter()
                    .chain(&player.draw_pile)
                    .chain(&player.board)
                    .any(|printing| !state.cards.contains_key(printing))
            {
                return invalid("battle player references an unknown deck or printing");
            }
        }
    }
    Ok(())
}

fn validate_alignments(records: &BTreeMap<String, AlignmentRecord>, label: &str) -> Result<(), GameplaySnapshotError> {
    for (record_id, record) in records {
        if record_id != &record.record_id {
            return invalid("alignment map key disagrees with its record");
        }
        validate_identifier(label, record_id)?;
        validate_identifier("alignment owner", &record.owner_id)?;
        validate_identifier("alignment content", &record.content_id)?;
        validate_id_set("alignment flag", &record.flags)?;
    }
    Ok(())
}

fn validate_identifier(label: &str, value: &str) -> Result<(), GameplaySnapshotError> {
    validate_id(label, value).map_err(authority_error)
}

fn validate_ids(label: &str, values: &[String]) -> Result<(), GameplaySnapshotError> {
    values.iter().try_for_each(|value| validate_identifier(label, value))
}

fn validate_id_set(label: &str, values: &BTreeSet<String>) -> Result<(), GameplaySnapshotError> {
    values.iter().try_for_each(|value| validate_identifier(label, value))
}

fn validate_id_map<T>(label: &str, values: &BTreeMap<String, T>) -> Result<(), GameplaySnapshotError> {
    values.keys().try_for_each(|value| validate_identifier(label, value))
}

fn invalid<T>(message: &str) -> Result<T, GameplaySnapshotError> {
    Err(GameplaySnapshotError::new(
        GameplaySnapshotErrorCode::InvalidValue,
        0,
        message,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_v1_fixture(authority: &GameplayAuthority, extensions: &[u8]) -> Vec<u8> {
        assert!(authority.state.inventory.item_instance_metadata.is_empty());
        let parts = authority.snapshot_parts();
        let mut payload = Writer::default();
        encode_gameplay_state_v1(&parts.state, &mut payload).unwrap();
        parts.grants.encode(&mut payload).unwrap();
        parts.idempotency.encode(&mut payload).unwrap();
        parts.idempotency_order.encode(&mut payload).unwrap();
        parts.replay.encode(&mut payload).unwrap();
        payload
            .bounded_bytes(extensions, MAX_GAMEPLAY_SNAPSHOT_EXTENSIONS)
            .unwrap();

        let mut output = Writer::default();
        output.raw(&SNAPSHOT_MAGIC);
        1_u16.encode(&mut output).unwrap();
        SNAPSHOT_FLAGS.encode(&mut output).unwrap();
        u64::try_from(payload.bytes.len()).unwrap().encode(&mut output).unwrap();
        authority.state.state_hash().encode(&mut output).unwrap();
        authority.replay_hash().encode(&mut output).unwrap();
        payload_hash(1, &payload.bytes).encode(&mut output).unwrap();
        output.raw(&payload.bytes);
        output.bytes
    }

    fn encode_v2_fixture(authority: &GameplayAuthority, extensions: &[u8]) -> Vec<u8> {
        let parts = authority.snapshot_parts();
        let mut payload = Writer::default();
        encode_gameplay_state_v2(&parts.state, &mut payload).unwrap();
        parts.grants.encode(&mut payload).unwrap();
        parts.idempotency.encode(&mut payload).unwrap();
        parts.idempotency_order.encode(&mut payload).unwrap();
        parts.replay.encode(&mut payload).unwrap();
        payload
            .bounded_bytes(extensions, MAX_GAMEPLAY_SNAPSHOT_EXTENSIONS)
            .unwrap();
        let mut output = Writer::default();
        output.raw(&SNAPSHOT_MAGIC);
        2_u16.encode(&mut output).unwrap();
        SNAPSHOT_FLAGS.encode(&mut output).unwrap();
        u64::try_from(payload.bytes.len()).unwrap().encode(&mut output).unwrap();
        authority.state.state_hash().encode(&mut output).unwrap();
        authority.replay_hash().encode(&mut output).unwrap();
        payload_hash(2, &payload.bytes).encode(&mut output).unwrap();
        output.raw(&payload.bytes);
        output.bytes
    }

    fn encode_v3_fixture(authority: &GameplayAuthority, extensions: &[u8]) -> Vec<u8> {
        let parts = authority.snapshot_parts();
        let mut payload = Writer::default();
        encode_gameplay_state_v3(&parts.state, &mut payload).unwrap();
        parts.grants.encode(&mut payload).unwrap();
        parts.idempotency.encode(&mut payload).unwrap();
        parts.idempotency_order.encode(&mut payload).unwrap();
        parts.replay.encode(&mut payload).unwrap();
        payload
            .bounded_bytes(extensions, MAX_GAMEPLAY_SNAPSHOT_EXTENSIONS)
            .unwrap();
        let mut output = Writer::default();
        output.raw(&SNAPSHOT_MAGIC);
        3_u16.encode(&mut output).unwrap();
        SNAPSHOT_FLAGS.encode(&mut output).unwrap();
        u64::try_from(payload.bytes.len()).unwrap().encode(&mut output).unwrap();
        authority.state.state_hash().encode(&mut output).unwrap();
        authority.replay_hash().encode(&mut output).unwrap();
        payload_hash(3, &payload.bytes).encode(&mut output).unwrap();
        output.raw(&payload.bytes);
        output.bytes
    }

    fn representative_authority() -> (GameplayAuthority, GameplayBatch, AcceptedReceipt) {
        let owner = "player-élan".to_string();
        let actor_owner = "actor-é".to_string();
        let player_id = PlayerId::new(17, 3);
        let entity_id = EntityId::new(29, 4);
        let player_container = ContainerKey::player(actor_owner);
        let metadata = CanonicalHash([0x8f; 16]);
        let mut state = GameplayState::new(WorldKey::new("universe-sæ", "surface-世界"), 7);
        state.tick = 1_000;

        state
            .inventory
            .register_item(ItemDefinition {
                code: 1,
                content_id: "moonberry-éclat".into(),
                max_stack: 64,
                tags: BTreeSet::from(["food".into()]),
            })
            .expect("fixture item is valid");
        state
            .inventory
            .register_item(ItemDefinition {
                code: 2,
                content_id: "field-knife".into(),
                max_stack: 1,
                tags: BTreeSet::from(["tool".into()]),
            })
            .expect("fixture tool is valid");
        let mut player_inventory = Container::new(player_container.clone(), 2);
        player_inventory.slots[0] = Some(ItemStack {
            item_code: 1,
            count: 2,
            durability_millionths: Some(900_001),
            metadata_hash: metadata,
        });
        state
            .inventory
            .insert_container(player_inventory)
            .expect("fixture inventory is valid");
        state
            .inventory
            .register_recipe(Recipe {
                recipe_id: "polish-knife".into(),
                station_tag: Some("bench".into()),
                inputs: vec![Ingredient {
                    item_code: 1,
                    metadata_hash: Some(metadata),
                    count: 1,
                }],
                outputs: vec![ItemStack::simple(2, 1)],
                ticks: 30,
            })
            .expect("fixture recipe is valid");
        state.inventory.furnaces.insert(
            "furnace-é".into(),
            FurnaceState {
                furnace_id: "furnace-é".into(),
                revision: 4,
                recipe_id: "polish-knife".into(),
                source: player_container.clone(),
                destination: player_container.clone(),
                progress_ticks: 12,
                fuel_ticks: 70,
                last_tick: 998,
                active: false,
            },
        );

        let item_resource = ResourceKey {
            kind: ResourceKind::Item,
            content_id: "moonberry-éclat".into(),
            item_code: Some(1),
            metadata_hash: metadata,
        };
        let energy_resource = ResourceKey {
            kind: ResourceKind::Energy,
            content_id: "wild-current".into(),
            item_code: None,
            metadata_hash: CanonicalHash::default(),
        };
        state
            .machines
            .register_recipe(MachineRecipe {
                recipe_id: "press-berry".into(),
                duration_ticks: 40,
                inputs: BTreeMap::from([(item_resource.clone(), 1)]),
                outputs: BTreeMap::from([(energy_resource.clone(), 3)]),
            })
            .expect("fixture machine recipe is valid");
        state
            .machines
            .insert_machine(MachineState {
                machine_id: "press-é".into(),
                owner_id: Some(owner.clone()),
                kind: MachineKind::Custom,
                revision: 8,
                active: true,
                recipe_id: Some("press-berry".into()),
                progress_ticks: 7,
                last_tick: 999,
                ports: BTreeMap::from([(
                    "omni".into(),
                    MachinePort {
                        port_id: "omni".into(),
                        mode: PortMode::Bidirectional,
                        accepted: BTreeSet::from([ResourceKind::Item, ResourceKind::Energy]),
                        capacity: 100,
                        resources: BTreeMap::from([(item_resource, 2), (energy_resource, 5)]),
                    },
                )]),
                lease: Some(ActivityLease {
                    lease_id: "lease-é".into(),
                    owner_id: owner.clone(),
                    start_tick: 900,
                    end_tick: 1_100,
                    max_cycles: 4,
                }),
                settings: Some(OpaquePayload {
                    type_id: "blockwild.machine.settings.v1".into(),
                    schema: 1,
                    bytes: vec![0, 0x80, 0xff],
                }),
            })
            .expect("fixture machine is valid");
        state.machines.power_networks.insert(
            "grid-é".into(),
            PowerNetwork {
                network_id: "grid-é".into(),
                revision: 2,
                stored: 40,
                capacity: 100,
                members: BTreeSet::from(["press-é".into()]),
            },
        );

        state
            .combat
            .register_ability(AbilitySpec {
                ability_id: "star-bolt-é".into(),
                damage_kind: DamageKind::Arcane,
                base_damage: 9,
                range_milli: 8_000,
                cooldown_ticks: 10,
                stamina_cost: 1,
                mana_cost: 3,
                projectile_speed_milli: Some(500),
                status: Some(StatusTemplate {
                    status_id: "glimmer-é".into(),
                    magnitude: -2,
                    duration_ticks: 20,
                    max_stacks: 2,
                }),
            })
            .expect("fixture ability is valid");
        state.combat.combatants.insert(
            "hero-é".into(),
            CombatantState {
                record_id: "hero-é".into(),
                owner_id: Some(owner.clone()),
                revision: 2,
                position: FixedVec3 {
                    x_milli: -500,
                    y_milli: 2_000,
                    z_milli: 7,
                },
                health: 19,
                max_health: 20,
                stamina: 8,
                mana: 11,
                armor: 3,
                resist_per_mille: BTreeMap::from([(DamageKind::Fire, 250)]),
                statuses: BTreeMap::from([(
                    "glimmer-é".into(),
                    StatusInstance {
                        status_id: "glimmer-é".into(),
                        source_id: "hero-é".into(),
                        magnitude: -2,
                        expires_tick: 1_010,
                        stacks: 1,
                    },
                )]),
                cooldown_until: BTreeMap::from([("star-bolt-é".into(), 1_002)]),
                alive: true,
                vital_units: CombatVitalUnits::LegacyWholeHeartsV1,
                entity_id: None,
            },
        );
        state.combat.combatants.insert(
            "creature-é".into(),
            CombatantState {
                record_id: "creature-é".into(),
                owner_id: None,
                revision: 5,
                position: FixedVec3 {
                    x_milli: 1_000,
                    y_milli: 2_000,
                    z_milli: 3_000,
                },
                health: 12,
                max_health: 30,
                stamina: 4,
                mana: 0,
                armor: 1,
                resist_per_mille: BTreeMap::new(),
                statuses: BTreeMap::new(),
                cooldown_until: BTreeMap::new(),
                alive: true,
                vital_units: CombatVitalUnits::LegacyWholeHeartsV1,
                entity_id: None,
            },
        );
        state.combat.projectiles.insert(
            "bolt-é".into(),
            ProjectileState {
                projectile_id: "bolt-é".into(),
                source_id: "hero-é".into(),
                target_id: Some("creature-é".into()),
                ability_id: "star-bolt-é".into(),
                position: FixedVec3::default(),
                velocity: FixedVec3 {
                    x_milli: 1,
                    y_milli: -2,
                    z_milli: 3,
                },
                spawned_tick: 990,
                expires_tick: 1_020,
                revision: 1,
                presentation: None,
            },
        );
        state.combat.creatures.insert(
            "creature-é".into(),
            CreatureCompatibilityRecord {
                record_id: "creature-é".into(),
                creature_content_id: "petalfox".into(),
                variant_id: "moonlit-é".into(),
                disposition: Disposition::Aggressive,
                readiness: CaptureReadiness::CalmByCare,
                captured_by: Some(owner.clone()),
                owner_id: None,
                bond: 12,
                care: 44,
                equipment_ids: vec!["ribbon-é".into()],
                research_flags: BTreeSet::from(["observed-é".into()]),
                pacification_score: 33,
                last_aggression_tick: 950,
                revision: 5,
            },
        );
        state.combat.summons.insert(
            "summon-é".into(),
            SummonState {
                summon_id: "summon-é".into(),
                content_id: "vellum-sprite".into(),
                owner_id: owner.clone(),
                spawned_tick: 900,
                expires_tick: Some(1_100),
                grounded: true,
                revision: 2,
                position: None,
                presentation: None,
            },
        );
        state.combat.tick = 1_000;

        state.progression.players.insert(
            owner.clone(),
            PlayerProgression {
                player_id: owner.clone(),
                revision: 3,
                level: 8,
                perk_points: 2,
                skills: BTreeMap::from([("husbandry-é".into(), SkillState { rank: 4, xp: 900 })]),
                unlocked_perks: BTreeSet::from(["gentle-hands".into()]),
                research_flags: BTreeSet::from(["petalfox-é".into()]),
                fast_travel_charges: 6,
            },
        );
        state.progression.perks.insert(
            "gentle-hands".into(),
            PerkDefinition {
                perk_id: "gentle-hands".into(),
                skill_id: "husbandry-é".into(),
                required_rank: 2,
                cost: 1,
                prerequisites: BTreeSet::new(),
            },
        );
        state.progression.quests.insert(
            "quest-record-é".into(),
            QuestRecord {
                record_id: "quest-record-é".into(),
                owner_id: owner.clone(),
                quest_id: "first-dawn".into(),
                revision: 2,
                stage: 3,
                completed: false,
                choices: vec!["spare-é".into()],
                flags: BTreeSet::from(["heard-song".into()]),
            },
        );
        state.progression.quest_choices.insert(
            ("first-dawn".into(), 3, "spare-é".into()),
            QuestChoiceDefinition {
                quest_id: "first-dawn".into(),
                stage: 3,
                option_id: "spare-é".into(),
                next_stage: 4,
                required_flags: BTreeSet::from(["heard-song".into()]),
                granted_flags: BTreeSet::from(["mercy-é".into()]),
                complete: false,
            },
        );
        let alignment = AlignmentRecord {
            record_id: "alignment-é".into(),
            owner_id: owner.clone(),
            content_id: "guild-é".into(),
            revision: 1,
            standing: -7,
            rank: 2,
            flags: BTreeSet::from(["known-é".into()]),
        };
        state
            .progression
            .factions
            .insert("alignment-é".into(), alignment.clone());
        state.progression.guilds.insert("alignment-é".into(), alignment);
        state.progression.wallets.insert(
            owner.clone(),
            Wallet {
                owner_id: owner.clone(),
                revision: 4,
                balances: BTreeMap::from([("gold-é".into(), 123)]),
            },
        );
        state.progression.listings.insert(
            "listing-é".into(),
            MarketListing {
                listing_id: "listing-é".into(),
                seller_id: owner.clone(),
                content_id: "moonberry-éclat".into(),
                currency_id: "gold-é".into(),
                unit_price: 3,
                available: 9,
                revision: 1,
            },
        );
        state.progression.settlements.insert(
            "village-é".into(),
            SettlementRecord {
                settlement_id: "village-é".into(),
                faction_id: "guild-é".into(),
                revision: 2,
                prosperity: 70,
                safety: 55,
                population: 40,
                upgrades: BTreeSet::from(["well-é".into()]),
            },
        );
        state.progression.dragons.insert(
            "dragon-é".into(),
            DragonRecord {
                dragon_id: "dragon-é".into(),
                owner_id: owner.clone(),
                species_id: "sea-dragon".into(),
                variant_id: "opal-é".into(),
                revision: 3,
                level: 12,
                xp: 8_800,
                bond: 77,
                unlocked_moves: BTreeSet::from(["tide-song".into()]),
                equipment_ids: vec!["saddle-é".into()],
                research_flags: BTreeSet::from(["hatched-é".into()]),
            },
        );
        state.progression.legendary.insert(
            "legend-é".into(),
            LegendaryEncounter {
                encounter_id: "legend-é".into(),
                creature_id: "glasswake-stag".into(),
                revision: 1,
                phase: 2,
                resolved: false,
                eligible_players: BTreeSet::from([owner.clone()]),
                flags: BTreeSet::from(["bell-rung-é".into()]),
            },
        );
        state
            .progression
            .dialogue_history
            .insert(owner.clone(), vec!["bonjour-é".into(), "星-answer".into()]);

        let printing = PrintingKey {
            card_id: "petalfox-é".into(),
            variant_id: "moonlit-é".into(),
            finish_id: "foil-é".into(),
        };
        state
            .cardforge
            .register_card(CardDefinition {
                printing: printing.clone(),
                rarity: CardRarity::Rare,
                class_ids: BTreeSet::from(["verdant-é".into()]),
                type_ids: BTreeSet::from(["wild".into()]),
                deck_cost: 2,
                power: 3,
                health: 4,
                rules: Some(OpaquePayload {
                    type_id: "blockwild.card.rules.v1".into(),
                    schema: 1,
                    bytes: vec![0x80, 0xff, 0],
                }),
            })
            .expect("fixture card is valid");
        state
            .cardforge
            .register_pack(PackDefinition {
                pack_id: "wild-pack-é".into(),
                slots: vec![PackSlot {
                    candidates: vec![WeightedCard {
                        printing: printing.clone(),
                        weight: 5,
                    }],
                }],
            })
            .expect("fixture pack is valid");
        state.cardforge.pack_records.insert(
            "pack-record-é".into(),
            PackRecord {
                record_id: "pack-record-é".into(),
                owner_id: owner.clone(),
                pack_id: "wild-pack-é".into(),
                seed: "seed-é".into(),
                revision: 1,
                opened: false,
            },
        );
        state.cardforge.custody.insert(
            owner.clone(),
            CardCustody {
                owner_id: owner.clone(),
                revision: 3,
                case: BTreeMap::from([(printing.clone(), 2)]),
                archive: BTreeMap::from([(printing.clone(), 1)]),
                rewards_claimed: BTreeSet::from(["starter-é".into()]),
            },
        );
        state.cardforge.deck_rules.insert(
            "field-é".into(),
            DeckRules {
                min_cards: 1,
                max_cards: 60,
                max_copies: 4,
                max_cost: 100,
                allowed_classes: BTreeSet::from(["verdant-é".into()]),
                banned_cards: BTreeSet::new(),
            },
        );
        state.cardforge.decks.insert(
            "deck-é".into(),
            DeckRecord {
                deck_id: "deck-é".into(),
                owner_id: owner.clone(),
                rules_id: "field-é".into(),
                revision: 2,
                cards: BTreeMap::from([(printing.clone(), 1)]),
            },
        );
        let battle_player = BattlePlayer {
            owner_id: owner.clone(),
            deck_id: "deck-é".into(),
            health: 20,
            resource: 3,
            hand: vec![printing.clone()],
            draw_pile: vec![printing.clone()],
            board: vec![printing],
        };
        state.cardforge.battles.insert(
            "match-é".into(),
            BattleState {
                match_id: "match-é".into(),
                revision: 7,
                sequence: 4,
                active_player: 1,
                players: [battle_player.clone(), battle_player],
                winner: None,
            },
        );

        let actor = GameplayActor {
            actor_id: "actor-é".into(),
            player_id: Some(player_id),
            entity_id: Some(entity_id),
            role: ActorRole::Host,
        };
        let mut authority = GameplayAuthority::new(state);
        authority
            .grant_actor(actor.actor_id.clone(), ActorGrant::host(player_id, entity_id))
            .expect("fixture grant is valid");
        let batch = GameplayBatch::new(
            "snapshot-batch-é",
            "retry-é",
            actor,
            authority.state.identity(),
            vec![GameplayCommand::Inventory(InventoryCommand::Transfer(
                TransferCommand {
                    from: SlotRef {
                        container: player_container.clone(),
                        slot: 0,
                        expected_container_revision: Some(0),
                    },
                    to: SlotRef {
                        container: player_container,
                        slot: 1,
                        expected_container_revision: Some(0),
                    },
                    count: 1,
                    expected: Some(ExpectedStack {
                        item_code: 1,
                        metadata_hash: metadata,
                        minimum_count: 2,
                    }),
                },
            ))],
        );
        let GameplayReceipt::Accepted(receipt) = authority.apply_batch(&batch) else {
            panic!("fixture batch must be accepted");
        };
        (authority, batch, receipt)
    }

    #[test]
    fn full_authority_round_trip_is_exact_and_preserves_retry_receipt() {
        let (authority, batch, receipt) = representative_authority();
        let extensions = [0, 0x80, 0xff, 7, 9];
        let bytes = authority
            .encode_snapshot(&extensions)
            .expect("representative authority encodes");
        let mut decoded = decode_gameplay_authority_snapshot(&bytes)
            .expect("representative authority decodes")
            .authority;
        assert_eq!(decoded.state, authority.state);
        assert_eq!(decoded.replay(), authority.replay());
        assert_eq!(decoded.state.state_hash(), authority.state.state_hash());
        assert_eq!(decoded.replay_hash(), authority.replay_hash());

        let before_state = decoded.state.clone();
        let before_replay = decoded.replay().to_vec();
        assert_eq!(decoded.apply_batch(&batch), GameplayReceipt::Accepted(receipt));
        assert_eq!(decoded.state, before_state);
        assert_eq!(decoded.replay(), before_replay);
        assert_eq!(
            decoded
                .encode_snapshot(&extensions)
                .expect("restored authority re-encodes"),
            bytes
        );

        let decoded_record = decode_gameplay_authority_snapshot(&bytes).expect("record decodes again");
        assert_eq!(decoded_record.unknown_extension_bytes, extensions);
        assert_eq!(decoded_record.snapshot_hash, canonical_gameplay_snapshot_hash(&bytes));
    }

    #[test]
    fn v4_combat_vital_units_and_entity_links_round_trip_canonically() {
        let (authority, _, _) = representative_authority();
        let legacy_hash = authority.state.state_hash();
        let mut state = authority.state.clone();
        let hero = state.combat.combatants.get_mut("hero-é").expect("fixture hero");
        hero.health = 19_500;
        hero.max_health = 20_000;
        hero.vital_units = CombatVitalUnits::MilliheartsV1;
        hero.entity_id = Some(EntityId::new(u32::MAX - 7, u32::MAX));
        let creature = state.combat.combatants.get_mut("creature-é").expect("fixture creature");
        creature.entity_id = Some(EntityId::new(u32::MAX - 8, u32::MAX - 1));
        let authority = GameplayAuthority::new(state);
        let extensions = [0, 0x80, 0xff, 0, 7];
        let bytes = authority.encode_snapshot(&extensions).expect("V4 authority encodes");
        let decoded = decode_gameplay_authority_snapshot(&bytes).expect("V4 authority decodes");

        assert_eq!(decoded.schema_version, 4);
        assert_eq!(decoded.authority.state, authority.state);
        assert_eq!(decoded.unknown_extension_bytes, extensions);
        assert_ne!(decoded.authority.state.state_hash(), legacy_hash);
        assert_eq!(decoded.authority.encode_snapshot(&extensions).unwrap(), bytes);
    }

    #[test]
    fn v4_combat_link_and_vital_bounds_fail_closed() {
        let (authority, _, _) = representative_authority();
        let linked = EntityId::new(77, 9);

        let mut duplicate = authority.state.clone();
        for combatant in duplicate.combat.combatants.values_mut() {
            combatant.entity_id = Some(linked);
        }
        assert_eq!(
            GameplayAuthority::new(duplicate)
                .encode_snapshot(&[])
                .expect_err("duplicate R6 combat links must fail")
                .code,
            GameplaySnapshotErrorCode::InvalidValue
        );

        let mut reserved = authority.state.clone();
        reserved
            .combat
            .combatants
            .get_mut("hero-é")
            .expect("fixture hero")
            .entity_id = Some(EntityId::default());
        assert_eq!(
            GameplayAuthority::new(reserved)
                .encode_snapshot(&[])
                .expect_err("reserved R6 combat link must fail")
                .code,
            GameplaySnapshotErrorCode::InvalidValue
        );

        let mut health = authority.state.clone();
        health.combat.combatants.get_mut("hero-é").expect("fixture hero").health = 21;
        assert_eq!(
            GameplayAuthority::new(health)
                .encode_snapshot(&[])
                .expect_err("combat health above its declared maximum must fail")
                .code,
            GameplaySnapshotErrorCode::InvalidValue
        );

        let mut inconsistent = authority.state.clone();
        let hero = inconsistent.combat.combatants.get_mut("hero-é").expect("fixture hero");
        hero.vital_units = CombatVitalUnits::MilliheartsV1;
        hero.health = 0;
        hero.alive = true;
        assert_eq!(
            GameplayAuthority::new(inconsistent)
                .encode_snapshot(&[])
                .expect_err("precision combat alive state must match its health")
                .code,
            GameplaySnapshotErrorCode::InvalidValue
        );

        let mut legacy_inconsistent = authority.state.clone();
        let hero = legacy_inconsistent
            .combat
            .combatants
            .get_mut("hero-é")
            .expect("fixture hero");
        hero.health = 0;
        hero.alive = true;
        GameplayAuthority::new(legacy_inconsistent)
            .encode_snapshot(&[])
            .expect("legacy unlinked combat snapshots preserve their historical validation contract");

        let mut reader = Reader::new(&[2]);
        assert_eq!(
            CombatVitalUnits::decode(&mut reader)
                .expect_err("unknown vital-unit tags must fail")
                .code,
            GameplaySnapshotErrorCode::InvalidValue
        );
    }

    #[test]
    fn v4_payload_tampering_is_rejected_before_authority_install() {
        let (authority, _, _) = representative_authority();
        let mut bytes = authority.encode_snapshot(&[]).expect("V4 authority encodes");
        bytes[HEADER_BYTES + 1] ^= 0x80;
        assert_eq!(
            decode_gameplay_authority_snapshot(&bytes)
                .expect_err("V4 payload tampering must fail")
                .code,
            GameplaySnapshotErrorCode::Corrupt
        );
    }

    #[test]
    fn v4_linked_combat_identity_round_trips_high_u64_unicode_and_extensions_exactly() {
        let (authority, _, _) = representative_authority();
        let mut state = authority.state.clone();
        let projectile_link = CombatPresentationLinkV1 {
            entity_id: EntityId::new(7, u32::MAX),
            content_domain: ContentDomain::Item,
            content_id: "202".into(),
            presentation_id: "projectile:水:🏹".into(),
        };
        state
            .combat
            .projectiles
            .get_mut("bolt-é")
            .expect("fixture projectile")
            .presentation = Some(projectile_link);
        state
            .combat
            .projectiles
            .get_mut("bolt-é")
            .expect("fixture projectile")
            .revision = 10;
        let summon = state.combat.summons.get_mut("summon-é").expect("fixture summon");
        summon.position = Some(FixedVec3 {
            x_milli: i32::MIN + 1,
            y_milli: 70_000,
            z_milli: i32::MAX,
        });
        summon.presentation = Some(CombatPresentationLinkV1 {
            entity_id: EntityId::new(8, u32::MAX - 1),
            content_domain: ContentDomain::CreatureProfile,
            content_id: summon.content_id.clone(),
            presentation_id: "summon:水:🐉".into(),
        });
        let authority = GameplayAuthority::new(state);
        let extensions = [0, 0x80, 0xff, 0, 7];
        let bytes = authority.encode_snapshot(&extensions).unwrap();
        let decoded = decode_gameplay_authority_snapshot(&bytes).unwrap();
        assert_eq!(decoded.schema_version, GAMEPLAY_SNAPSHOT_SCHEMA_VERSION);
        assert_eq!(decoded.authority.state, authority.state);
        assert_eq!(decoded.unknown_extension_bytes, extensions);
        assert_eq!(decoded.authority.encode_snapshot(&extensions).unwrap(), bytes);

        let mut corrupt = authority.state.clone();
        corrupt
            .combat
            .projectiles
            .get_mut("bolt-é")
            .expect("fixture projectile")
            .revision = 9;
        let error = GameplayAuthority::new(corrupt)
            .encode_snapshot(&extensions)
            .expect_err("linked projectile revision must attest exact elapsed ticks");
        assert_eq!(error.code, GameplaySnapshotErrorCode::InvalidValue);
    }

    #[test]
    fn install_is_atomic_and_restores_grants_for_new_commands() {
        let (authority, _, _) = representative_authority();
        let bytes = authority.encode_snapshot(&[]).expect("snapshot encodes");
        let mut target = GameplayAuthority::new(GameplayState::new(WorldKey::new("other", "world"), 1));
        let original = target.state.clone();
        let mut corrupt = bytes.clone();
        corrupt[HEADER_BYTES + 3] ^= 0x40;
        assert!(target.install_snapshot(&corrupt).is_err());
        assert_eq!(target.state, original);

        let report = target.install_snapshot(&bytes).expect("valid snapshot installs");
        assert_eq!(report.state_hash, authority.state.state_hash());
        let actor = GameplayActor {
            actor_id: "actor-é".into(),
            player_id: Some(PlayerId::new(17, 3)),
            entity_id: Some(EntityId::new(29, 4)),
            role: ActorRole::Host,
        };
        let container = ContainerKey::player("actor-é");
        let container_revision = target.state.inventory.containers[&container].revision;
        let fresh = GameplayBatch::new(
            "post-restore-é",
            "fresh-é",
            actor,
            target.state.identity(),
            vec![GameplayCommand::Inventory(InventoryCommand::Transfer(
                TransferCommand {
                    from: SlotRef {
                        container: container.clone(),
                        slot: 1,
                        expected_container_revision: Some(container_revision),
                    },
                    to: SlotRef {
                        container,
                        slot: 0,
                        expected_container_revision: Some(container_revision),
                    },
                    count: 1,
                    expected: None,
                },
            ))],
        );
        assert!(matches!(target.apply_batch(&fresh), GameplayReceipt::Accepted(_)));
    }

    #[test]
    fn truncation_corruption_and_malicious_count_fail_closed() {
        let (authority, _, _) = representative_authority();
        let bytes = authority.encode_snapshot(&[]).expect("snapshot encodes");
        for cut in [0, 1, HEADER_BYTES - 1, HEADER_BYTES, bytes.len() - 1] {
            assert!(decode_gameplay_authority_snapshot(&bytes[..cut]).is_err());
        }

        let mut corrupt = bytes.clone();
        corrupt[HEADER_BYTES + 1] ^= 0xff;
        assert_eq!(
            decode_gameplay_authority_snapshot(&corrupt)
                .expect_err("payload corruption must fail")
                .code,
            GameplaySnapshotErrorCode::Corrupt
        );

        let mut invalid_utf8 = bytes.clone();
        invalid_utf8[HEADER_BYTES + 4] = 0xff;
        let checksum = payload_hash(GAMEPLAY_SNAPSHOT_SCHEMA_VERSION, &invalid_utf8[HEADER_BYTES..]);
        invalid_utf8[52..68].copy_from_slice(checksum.as_bytes());
        assert_eq!(
            decode_gameplay_authority_snapshot(&invalid_utf8)
                .expect_err("invalid UTF-8 must fail")
                .code,
            GameplaySnapshotErrorCode::InvalidUtf8
        );

        let mut malicious = bytes;
        let universe_len = "universe-sæ".len();
        let location_len = "surface-世界".len();
        let item_count_offset = HEADER_BYTES + 4 + universe_len + 4 + location_len + 52 + 8;
        malicious[item_count_offset..item_count_offset + 4].copy_from_slice(
            &u32::try_from(MAX_COLLECTION_ENTRIES + 1)
                .expect("test bound fits")
                .to_le_bytes(),
        );
        let checksum = payload_hash(GAMEPLAY_SNAPSHOT_SCHEMA_VERSION, &malicious[HEADER_BYTES..]);
        malicious[52..68].copy_from_slice(checksum.as_bytes());
        assert_eq!(
            decode_gameplay_authority_snapshot(&malicious)
                .expect_err("malicious collection count must fail")
                .code,
            GameplaySnapshotErrorCode::Capacity
        );
    }

    #[test]
    fn legacy_projection_import_is_explicit_and_starts_histories_empty() {
        let (authority, _, _) = representative_authority();
        let projection = LegacyGameplayProjectionV0 {
            state: authority.state.clone(),
            grants: BTreeMap::from([(
                "actor-é".into(),
                ActorGrant::host(PlayerId::new(17, 3), EntityId::new(29, 4)),
            )]),
        };
        let imported = import_legacy_gameplay_projection_v0(projection).expect("legacy projection imports");
        assert_eq!(imported.state, authority.state);
        assert!(imported.replay().is_empty());
    }

    #[test]
    fn snapshot_v2_fixture_vector_is_stable() {
        let (authority, _, _) = representative_authority();
        let bytes = encode_v2_fixture(&authority, &[0, 0x80, 0xff, 7, 9]);
        let actual = format!(
            "schema=2\nbytes={}\nstate_hash={}\nreplay_hash={}\nsnapshot_hash={}\n",
            bytes.len(),
            authority.state.state_hash().to_hex(),
            authority.replay_hash().to_hex(),
            canonical_gameplay_snapshot_hash(&bytes).to_hex()
        );
        assert_eq!(actual, include_str!("../fixtures/gameplay-snapshot-v2.txt"));
        let decoded = decode_gameplay_authority_snapshot(&bytes).unwrap();
        assert_eq!(decoded.schema_version, 2);
        assert!(
            decoded
                .authority
                .state
                .combat
                .projectiles
                .values()
                .all(|projectile| projectile.presentation.is_none())
        );
        assert!(
            decoded
                .authority
                .state
                .combat
                .summons
                .values()
                .all(|summon| summon.presentation.is_none() && summon.position.is_none())
        );
        assert!(decoded.authority.state.combat.combatants.values().all(|combatant| {
            combatant.vital_units == CombatVitalUnits::LegacyWholeHeartsV1 && combatant.entity_id.is_none()
        }));
    }

    #[test]
    fn snapshot_v3_combatant_abi_decodes_as_explicit_legacy_defaults() {
        let (authority, _, _) = representative_authority();
        let extensions = [0, 0x80, 0xff, 7, 9];
        let bytes = encode_v3_fixture(&authority, &extensions);
        let decoded = decode_gameplay_authority_snapshot(&bytes).expect("V3 fixture remains readable");

        assert_eq!(decoded.schema_version, 3);
        assert_eq!(decoded.authority.state, authority.state);
        assert_eq!(decoded.authority.state.state_hash(), authority.state.state_hash());
        assert_eq!(decoded.authority.replay_hash(), authority.replay_hash());
        assert_eq!(decoded.unknown_extension_bytes, extensions);
        assert!(decoded.authority.state.combat.combatants.values().all(|combatant| {
            combatant.vital_units == CombatVitalUnits::LegacyWholeHeartsV1 && combatant.entity_id.is_none()
        }));
        assert_eq!(
            canonical_gameplay_snapshot_hash(&bytes).to_hex(),
            "2898ef983c1ce9f310288b80dfc95c1d"
        );
        let current = decoded
            .authority
            .encode_snapshot(&extensions)
            .expect("legacy state upgrades to V4");
        assert_ne!(
            current, bytes,
            "V4 writes explicit combat-unit/link fields even when both use defaults"
        );
        let current = decode_gameplay_authority_snapshot(&current).expect("upgraded V4 snapshot decodes");
        assert_eq!(current.schema_version, 4);
        assert_eq!(current.authority.state.state_hash(), authority.state.state_hash());
    }

    #[test]
    fn snapshot_v1_fixture_decodes_with_an_empty_metadata_store() {
        let (authority, _, _) = representative_authority();
        let bytes = encode_v1_fixture(&authority, &[0, 0x80, 0xff, 7, 9]);
        let actual = format!(
            "schema=1\nbytes={}\nstate_hash={}\nreplay_hash={}\nsnapshot_hash={}\n",
            bytes.len(),
            authority.state.state_hash().to_hex(),
            authority.replay_hash().to_hex(),
            canonical_gameplay_snapshot_hash(&bytes).to_hex()
        );
        assert_eq!(actual, include_str!("../fixtures/gameplay-snapshot-v1.txt"));

        let decoded = decode_gameplay_authority_snapshot(&bytes).expect("V1 fixture remains readable");
        assert_eq!(decoded.schema_version, 1);
        assert!(decoded.authority.state.inventory.item_instance_metadata.is_empty());
        assert_eq!(decoded.authority.state, authority.state);
        assert!(decoded.authority.state.combat.combatants.values().all(|combatant| {
            combatant.vital_units == CombatVitalUnits::LegacyWholeHeartsV1 && combatant.entity_id.is_none()
        }));
        assert_eq!(decoded.authority.replay_hash(), authority.replay_hash());
        let current = decoded
            .authority
            .encode_snapshot(&decoded.unknown_extension_bytes)
            .unwrap();
        assert_eq!(
            decode_gameplay_authority_snapshot(&current).unwrap().schema_version,
            GAMEPLAY_SNAPSHOT_SCHEMA_VERSION
        );
    }
}
