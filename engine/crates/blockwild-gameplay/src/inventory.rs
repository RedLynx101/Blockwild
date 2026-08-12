use std::collections::{BTreeMap, BTreeSet};

use blockwild_types::{CanonicalHash, CanonicalHasher};

use crate::{MAX_ITEM_STACK, Rejection, RejectionCode, ResourceDelta, validate_id, write_option_str, write_option_u64};

pub const PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1: usize = 9;
pub const MAX_ITEM_INSTANCE_METADATA_BYTES_V1: usize = 64 * 1024;
pub const MAX_ITEM_INSTANCE_METADATA_EXTENSION_BYTES_V1: usize = 64 * 1024;
pub const MAX_PLAYER_INVENTORY_IMPORT_METADATA_BYTES_V1: usize = 256 * 1024;
pub const INVENTORY_COMMAND_IMPORT_PLAYER_V1_TAG: u16 = 6;

pub type ItemCode = u32;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContainerKind {
    Player,
    Equipment,
    Container,
    Machine,
    Waygrid,
    CardforgeCase,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ContainerKey {
    pub kind: ContainerKind,
    pub id: String,
    pub owner_id: Option<String>,
}

impl ContainerKey {
    #[must_use]
    pub fn player(id: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            kind: ContainerKind::Player,
            owner_id: Some(id.clone()),
            id,
        }
    }

    pub(crate) fn validate(&self) -> Result<(), Rejection> {
        validate_id("container", &self.id)?;
        if let Some(owner_id) = &self.owner_id {
            validate_id("container owner", owner_id)?;
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u16(self.kind as u16);
        hasher.write_str(&self.id);
        write_option_str(hasher, self.owner_id.as_deref());
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ItemStack {
    pub item_code: ItemCode,
    pub count: u32,
    pub durability_millionths: Option<u32>,
    pub metadata_hash: CanonicalHash,
}

impl ItemStack {
    #[must_use]
    pub const fn simple(item_code: ItemCode, count: u32) -> Self {
        Self {
            item_code,
            count,
            durability_millionths: None,
            metadata_hash: CanonicalHash([0; 16]),
        }
    }

    pub fn validate(&self, max_stack: u32) -> Result<(), Rejection> {
        if self.item_code == 0 || self.count == 0 || self.count > MAX_ITEM_STACK || self.count > max_stack {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "item stack is outside its declared bounds",
            ));
        }
        if self.durability_millionths.is_some_and(|value| value > 1_000_000) {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "durability must be between zero and one million millionths",
            ));
        }
        Ok(())
    }

    #[must_use]
    pub fn compatible_with(&self, other: &Self) -> bool {
        self.item_code == other.item_code
            && self.durability_millionths == other.durability_millionths
            && self.metadata_hash == other.metadata_hash
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u32(self.item_code);
        hasher.write_u32(self.count);
        write_option_u64(hasher, self.durability_millionths.map(u64::from));
        hasher.write_bytes(self.metadata_hash.as_bytes());
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ItemDefinition {
    pub code: ItemCode,
    pub content_id: String,
    pub max_stack: u32,
    pub tags: BTreeSet<String>,
}

impl ItemDefinition {
    pub fn validate(&self) -> Result<(), Rejection> {
        validate_id("item content", &self.content_id)?;
        if self.code == 0 || self.max_stack == 0 || self.max_stack > MAX_ITEM_STACK {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "item definition has invalid code or stack limit",
            ));
        }
        for tag in &self.tags {
            validate_id("item tag", tag)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Container {
    pub key: ContainerKey,
    pub revision: u64,
    pub slots: Vec<Option<ItemStack>>,
    pub equipment_tags: Vec<Option<String>>,
}

impl Container {
    #[must_use]
    pub fn new(key: ContainerKey, slots: usize) -> Self {
        Self {
            key,
            revision: 0,
            slots: vec![None; slots],
            equipment_tags: vec![None; slots],
        }
    }

    pub fn validate(&self, items: &BTreeMap<ItemCode, ItemDefinition>) -> Result<(), Rejection> {
        self.key.validate()?;
        if self.slots.is_empty() || self.slots.len() > usize::from(u16::MAX) {
            return Err(Rejection::new(
                RejectionCode::Capacity,
                "container slot count is outside protocol bounds",
            ));
        }
        if self.equipment_tags.len() != self.slots.len() {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "equipment tag layout does not match slots",
            ));
        }
        for (slot_index, stack) in self.slots.iter().enumerate() {
            let Some(stack) = stack else { continue };
            let definition = items
                .get(&stack.item_code)
                .ok_or_else(|| Rejection::new(RejectionCode::InvalidCommand, "stack references an unknown item"))?;
            stack.validate(definition.max_stack)?;
            if let Some(required_tag) = &self.equipment_tags[slot_index]
                && !definition.tags.contains(required_tag)
            {
                return Err(Rejection::new(
                    RejectionCode::RulesRejected,
                    "item is not legal for the equipment slot",
                ));
            }
        }
        Ok(())
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        self.key.hash_into(hasher);
        hasher.write_u64(self.revision);
        hasher.write_u64(self.slots.len() as u64);
        for (index, stack) in self.slots.iter().enumerate() {
            write_option_str(hasher, self.equipment_tags[index].as_deref());
            match stack {
                Some(stack) => {
                    hasher.write_u16(1);
                    stack.hash_into(hasher);
                }
                None => hasher.write_u16(0),
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlotRef {
    pub container: ContainerKey,
    pub slot: u16,
    pub expected_container_revision: Option<u64>,
}

impl SlotRef {
    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        self.container.hash_into(hasher);
        hasher.write_u16(self.slot);
        write_option_u64(hasher, self.expected_container_revision);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpectedStack {
    pub item_code: ItemCode,
    pub metadata_hash: CanonicalHash,
    pub minimum_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferCommand {
    pub from: SlotRef,
    pub to: SlotRef,
    pub count: u32,
    pub expected: Option<ExpectedStack>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Ingredient {
    pub item_code: ItemCode,
    pub metadata_hash: Option<CanonicalHash>,
    pub count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Recipe {
    pub recipe_id: String,
    pub station_tag: Option<String>,
    pub inputs: Vec<Ingredient>,
    pub outputs: Vec<ItemStack>,
    pub ticks: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CraftCommand {
    pub recipe_id: String,
    pub quantity: u16,
    pub station_id: Option<String>,
    pub source: ContainerKey,
    pub destination: ContainerKey,
    pub expected_source_revision: Option<u64>,
    pub expected_destination_revision: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FurnaceState {
    pub furnace_id: String,
    pub revision: u64,
    pub recipe_id: String,
    pub source: ContainerKey,
    pub destination: ContainerKey,
    pub progress_ticks: u64,
    pub fuel_ticks: u64,
    pub last_tick: u64,
    pub active: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FurnaceAdvanceCommand {
    pub furnace_id: String,
    pub expected_revision: u64,
    pub to_tick: u64,
    pub fuel_item: Option<Ingredient>,
    pub fuel_ticks_per_item: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreateDropCustodyCommand {
    pub source: SlotRef,
    pub custody: ContainerKey,
    pub expected: Option<ExpectedStack>,
    pub request_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RemoveEmptyDropCustodyCommand {
    pub custody: ContainerKey,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreatePlayerCustodyCommand {
    pub inventory: ContainerKey,
    pub inventory_slots: u16,
    pub equipment: ContainerKey,
    pub equipment_slots: u16,
    pub back_slot: Option<u16>,
}

/// An immutable, content-addressed item-instance descriptor. Unlike the
/// production content blob store this table does not use reference counts:
/// inventory custody remains represented by [`ItemStack`], while these bytes
/// are a durable lookup record for non-zero stack metadata hashes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ItemInstanceMetadataV1 {
    pub hash: CanonicalHash,
    pub type_id: String,
    pub schema_id: String,
    pub schema_version: u16,
    pub content_version: u32,
    pub canonical_json_bytes: Vec<u8>,
    pub unknown_extension_bytes: Vec<u8>,
}

impl ItemInstanceMetadataV1 {
    #[must_use]
    pub fn calculate_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.item-instance-metadata.v1");
        hasher.write_u16(1);
        hasher.write_str(&self.type_id);
        hasher.write_str(&self.schema_id);
        hasher.write_u16(self.schema_version);
        hasher.write_u32(self.content_version);
        hasher.write_bytes(&self.canonical_json_bytes);
        hasher.write_bytes(&self.unknown_extension_bytes);
        hasher.finish()
    }

    pub(crate) fn validate(&self) -> Result<(), Rejection> {
        validate_id("item metadata type", &self.type_id)?;
        validate_id("item metadata schema", &self.schema_id)?;
        if self.schema_version == 0 {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "item metadata schema version must be non-zero",
            ));
        }
        if self.canonical_json_bytes.len() > MAX_ITEM_INSTANCE_METADATA_BYTES_V1
            || self.unknown_extension_bytes.len() > MAX_ITEM_INSTANCE_METADATA_EXTENSION_BYTES_V1
        {
            return Err(Rejection::new(
                RejectionCode::Capacity,
                "item metadata descriptor exceeds its byte bound",
            ));
        }
        crate::content_runtime::validate_canonical_json_bytes_v1(&self.canonical_json_bytes).map_err(|_| {
            Rejection::new(
                RejectionCode::InvalidCommand,
                "item metadata bytes are not canonical JSON V1",
            )
        })?;
        if self.hash == CanonicalHash::default() || self.hash != self.calculate_hash() {
            return Err(Rejection::new(
                RejectionCode::Conflict,
                "item metadata hash does not match its immutable descriptor",
            ));
        }
        Ok(())
    }

    fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_bytes(self.hash.as_bytes());
        hasher.write_str(&self.type_id);
        hasher.write_str(&self.schema_id);
        hasher.write_u16(self.schema_version);
        hasher.write_u32(self.content_version);
        hasher.write_bytes(&self.canonical_json_bytes);
        hasher.write_bytes(&self.unknown_extension_bytes);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportPlayerInventoryV1 {
    pub inventory: ContainerKey,
    pub expected_revision: u64,
    pub slots: Vec<Option<ItemStack>>,
    pub metadata: Vec<ItemInstanceMetadataV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InventoryCommand {
    Transfer(TransferCommand),
    Craft(CraftCommand),
    AdvanceFurnace(FurnaceAdvanceCommand),
    CreateDropCustody(CreateDropCustodyCommand),
    RemoveEmptyDropCustody(RemoveEmptyDropCustodyCommand),
    CreatePlayerCustody(CreatePlayerCustodyCommand),
    ImportPlayerInventoryV1(ImportPlayerInventoryV1),
}

impl InventoryCommand {
    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        match self {
            Self::Transfer(command) => {
                hasher.write_u16(0);
                command.from.hash_into(hasher);
                command.to.hash_into(hasher);
                hasher.write_u32(command.count);
                match &command.expected {
                    Some(expected) => {
                        hasher.write_u16(1);
                        hasher.write_u32(expected.item_code);
                        hasher.write_bytes(expected.metadata_hash.as_bytes());
                        hasher.write_u32(expected.minimum_count);
                    }
                    None => hasher.write_u16(0),
                }
            }
            Self::Craft(command) => {
                hasher.write_u16(1);
                hasher.write_str(&command.recipe_id);
                hasher.write_u16(command.quantity);
                write_option_str(hasher, command.station_id.as_deref());
                command.source.hash_into(hasher);
                command.destination.hash_into(hasher);
                write_option_u64(hasher, command.expected_source_revision);
                write_option_u64(hasher, command.expected_destination_revision);
            }
            Self::AdvanceFurnace(command) => {
                hasher.write_u16(2);
                hasher.write_str(&command.furnace_id);
                hasher.write_u64(command.expected_revision);
                hasher.write_u64(command.to_tick);
                match &command.fuel_item {
                    Some(fuel) => {
                        hasher.write_u16(1);
                        hash_ingredient(fuel, hasher);
                    }
                    None => hasher.write_u16(0),
                }
                hasher.write_u32(command.fuel_ticks_per_item);
            }
            Self::CreateDropCustody(command) => {
                hasher.write_u16(3);
                command.source.hash_into(hasher);
                command.custody.hash_into(hasher);
                match &command.expected {
                    Some(expected) => {
                        hasher.write_u16(1);
                        hasher.write_u32(expected.item_code);
                        hasher.write_bytes(expected.metadata_hash.as_bytes());
                        hasher.write_u32(expected.minimum_count);
                    }
                    None => hasher.write_u16(0),
                }
                hasher.write_bytes(command.request_hash.as_bytes());
            }
            Self::RemoveEmptyDropCustody(command) => {
                hasher.write_u16(4);
                command.custody.hash_into(hasher);
                hasher.write_u64(command.expected_revision);
            }
            Self::CreatePlayerCustody(command) => {
                hasher.write_u16(5);
                command.inventory.hash_into(hasher);
                hasher.write_u16(command.inventory_slots);
                command.equipment.hash_into(hasher);
                hasher.write_u16(command.equipment_slots);
                write_option_u64(hasher, command.back_slot.map(u64::from));
            }
            Self::ImportPlayerInventoryV1(command) => {
                hasher.write_u16(INVENTORY_COMMAND_IMPORT_PLAYER_V1_TAG);
                command.inventory.hash_into(hasher);
                hasher.write_u64(command.expected_revision);
                hasher.write_u64(command.slots.len() as u64);
                for slot in &command.slots {
                    match slot {
                        Some(stack) => {
                            hasher.write_u16(1);
                            stack.hash_into(hasher);
                        }
                        None => hasher.write_u16(0),
                    }
                }
                hasher.write_u64(command.metadata.len() as u64);
                for metadata in &command.metadata {
                    metadata.hash_into(hasher);
                }
            }
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct InventoryState {
    pub items: BTreeMap<ItemCode, ItemDefinition>,
    pub containers: BTreeMap<ContainerKey, Container>,
    pub recipes: BTreeMap<String, Recipe>,
    pub furnaces: BTreeMap<String, FurnaceState>,
    pub item_instance_metadata: BTreeMap<CanonicalHash, ItemInstanceMetadataV1>,
}

impl InventoryState {
    pub fn register_item(&mut self, item: ItemDefinition) -> Result<(), Rejection> {
        item.validate()?;
        if self.items.insert(item.code, item).is_some() {
            return Err(Rejection::new(RejectionCode::Conflict, "duplicate item code"));
        }
        Ok(())
    }

    pub fn insert_container(&mut self, container: Container) -> Result<(), Rejection> {
        container.validate(&self.items)?;
        if self.containers.insert(container.key.clone(), container).is_some() {
            return Err(Rejection::new(RejectionCode::Conflict, "duplicate container"));
        }
        Ok(())
    }

    pub fn create_drop_custody(&mut self, command: &CreateDropCustodyCommand) -> Result<Vec<ResourceDelta>, Rejection> {
        command.source.container.validate()?;
        command.custody.validate()?;
        if command.source.expected_container_revision.is_none()
            || command.custody.kind != ContainerKind::Container
            || command.custody.owner_id.is_some()
            || command.source.container == command.custody
        {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "drop custody requires a revisioned source and a distinct unowned container",
            ));
        }
        if self.containers.contains_key(&command.custody) {
            return Err(Rejection::new(
                RejectionCode::Conflict,
                "drop custody container already exists",
            ));
        }
        let source = self
            .containers
            .get(&command.source.container)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "drop source container does not exist"))?;
        check_container_revision(source, command.source.expected_container_revision)?;
        let source_stack = source
            .slots
            .get(usize::from(command.source.slot))
            .and_then(Option::as_ref)
            .ok_or_else(|| Rejection::new(RejectionCode::InsufficientResource, "drop source slot is empty"))?;
        if let Some(expected) = &command.expected
            && (source_stack.item_code != expected.item_code
                || source_stack.metadata_hash != expected.metadata_hash
                || source_stack.count < expected.minimum_count.max(1))
        {
            return Err(Rejection::new(
                RejectionCode::Conflict,
                "drop source stack no longer matches the expected item",
            ));
        }
        let mut dropped_stack = source_stack.clone();
        dropped_stack.count = 1;
        let source = self
            .containers
            .get_mut(&command.source.container)
            .expect("drop source was validated");
        let source_stack = source.slots[usize::from(command.source.slot)]
            .as_mut()
            .expect("drop source stack was validated");
        source_stack.count -= 1;
        if source_stack.count == 0 {
            source.slots[usize::from(command.source.slot)] = None;
        }
        source.revision = source
            .revision
            .checked_add(1)
            .ok_or_else(|| Rejection::new(RejectionCode::Capacity, "drop source revision overflow"))?;
        let mut custody = Container::new(command.custody.clone(), 1);
        custody.slots[0] = Some(dropped_stack);
        self.insert_container(custody)?;
        Ok(Vec::new())
    }

    pub fn remove_empty_drop_custody(
        &mut self,
        command: &RemoveEmptyDropCustodyCommand,
    ) -> Result<Vec<ResourceDelta>, Rejection> {
        command.custody.validate()?;
        if command.custody.kind != ContainerKind::Container || command.custody.owner_id.is_some() {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "drop custody must be an unowned ordinary container",
            ));
        }
        let custody = self
            .containers
            .get(&command.custody)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "drop custody container does not exist"))?;
        check_container_revision(custody, Some(command.expected_revision))?;
        if custody.slots.iter().any(Option::is_some) {
            return Err(Rejection::new(
                RejectionCode::Conflict,
                "nonempty drop custody cannot be removed",
            ));
        }
        if self
            .furnaces
            .values()
            .any(|furnace| furnace.source == command.custody || furnace.destination == command.custody)
        {
            return Err(Rejection::new(
                RejectionCode::Conflict,
                "drop custody is still referenced by a furnace",
            ));
        }
        self.containers.remove(&command.custody);
        Ok(Vec::new())
    }

    pub fn create_player_custody(
        &mut self,
        command: &CreatePlayerCustodyCommand,
    ) -> Result<Vec<ResourceDelta>, Rejection> {
        command.inventory.validate()?;
        command.equipment.validate()?;
        if command.inventory.kind != ContainerKind::Player
            || command.equipment.kind != ContainerKind::Equipment
            || command.inventory.owner_id.is_none()
            || command.inventory.owner_id != command.equipment.owner_id
            || command.inventory == command.equipment
            || command.inventory_slots == 0
            || command.equipment_slots == 0
            || command.back_slot.is_some_and(|slot| slot >= command.equipment_slots)
        {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "player custody container shape is invalid",
            ));
        }
        if self.containers.contains_key(&command.inventory) || self.containers.contains_key(&command.equipment) {
            return Err(Rejection::new(
                RejectionCode::Conflict,
                "player custody container already exists",
            ));
        }
        let inventory = Container::new(command.inventory.clone(), usize::from(command.inventory_slots));
        let mut equipment = Container::new(command.equipment.clone(), usize::from(command.equipment_slots));
        if let Some(back_slot) = command.back_slot {
            equipment.equipment_tags[usize::from(back_slot)] = Some("back".into());
        }
        self.insert_container(inventory)?;
        self.insert_container(equipment)?;
        Ok(Vec::new())
    }

    /// Import the exact legacy nine-slot player inventory once. The authority
    /// already applies commands to a cloned [`GameplayState`], and this method
    /// stages again so it is also atomic when used in focused unit tests.
    pub fn import_player_inventory_v1(
        &mut self,
        command: &ImportPlayerInventoryV1,
    ) -> Result<Vec<ResourceDelta>, Rejection> {
        command.inventory.validate()?;
        if command.inventory.kind != ContainerKind::Player || command.inventory.owner_id.is_none() {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "player inventory import requires an owned player container",
            ));
        }
        if command.expected_revision != 0 || command.slots.len() != PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1 {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "player inventory import requires revision zero and exactly nine slots",
            ));
        }
        if command.metadata.len() > PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1 {
            return Err(Rejection::new(
                RejectionCode::Capacity,
                "player inventory import metadata exceeds the slot bound",
            ));
        }
        let metadata_bytes = command.metadata.iter().try_fold(0_usize, |total, metadata| {
            total
                .checked_add(metadata.canonical_json_bytes.len())
                .and_then(|value| value.checked_add(metadata.unknown_extension_bytes.len()))
        });
        if metadata_bytes.is_none_or(|bytes| bytes > MAX_PLAYER_INVENTORY_IMPORT_METADATA_BYTES_V1) {
            return Err(Rejection::new(
                RejectionCode::Capacity,
                "player inventory import metadata exceeds the total byte bound",
            ));
        }

        let target = self
            .containers
            .get(&command.inventory)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "player inventory does not exist"))?;
        if target.revision != command.expected_revision {
            return Err(Rejection::new(
                RejectionCode::StaleRevision,
                "player inventory revision is not pristine",
            ));
        }
        if target.slots.len() != PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1
            || target.equipment_tags.len() != PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1
            || target.equipment_tags.iter().any(Option::is_some)
        {
            return Err(Rejection::new(
                RejectionCode::InvalidTarget,
                "player inventory target is not an ordinary nine-slot custody",
            ));
        }
        if target.slots.iter().any(Option::is_some) {
            return Err(Rejection::new(
                RejectionCode::Conflict,
                "nonempty player inventory cannot be imported",
            ));
        }

        let mut supplied_metadata = BTreeMap::new();
        for metadata in &command.metadata {
            metadata.validate()?;
            if supplied_metadata.insert(metadata.hash, metadata).is_some() {
                return Err(Rejection::new(
                    RejectionCode::Conflict,
                    "player inventory import repeats a metadata descriptor",
                ));
            }
            if let Some(existing) = self.item_instance_metadata.get(&metadata.hash)
                && existing != metadata
            {
                return Err(Rejection::new(
                    RejectionCode::Conflict,
                    "item metadata hash conflicts with the immutable store",
                ));
            }
        }
        if command
            .metadata
            .windows(2)
            .any(|records| records[0].hash > records[1].hash)
        {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "player inventory import metadata is not in canonical hash order",
            ));
        }

        let mut referenced_metadata = BTreeSet::new();
        let mut deltas = Vec::new();
        for stack in command.slots.iter().flatten() {
            let definition = self.items.get(&stack.item_code).ok_or_else(|| {
                Rejection::new(RejectionCode::InvalidCommand, "import stack references an unknown item")
            })?;
            stack.validate(definition.max_stack)?;
            if stack.metadata_hash != CanonicalHash::default() {
                referenced_metadata.insert(stack.metadata_hash);
                if !supplied_metadata.contains_key(&stack.metadata_hash) {
                    return Err(Rejection::new(
                        RejectionCode::InvalidCommand,
                        "import stack metadata descriptor is missing",
                    ));
                }
            }
            deltas.push(ResourceDelta {
                item_code: stack.item_code,
                metadata_hash: stack.metadata_hash,
                amount: i64::from(stack.count),
                reason: "player-inventory-import-v1".into(),
            });
        }
        if supplied_metadata.keys().any(|hash| !referenced_metadata.contains(hash)) {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "player inventory import contains unreferenced metadata",
            ));
        }

        let mut staged = self.clone();
        for metadata in command.metadata.iter().cloned() {
            staged.item_instance_metadata.entry(metadata.hash).or_insert(metadata);
        }
        let target = staged
            .containers
            .get_mut(&command.inventory)
            .expect("import target was validated");
        target.slots.clone_from(&command.slots);
        target.revision = 1;
        *self = staged;
        Ok(deltas)
    }

    pub fn register_recipe(&mut self, recipe: Recipe) -> Result<(), Rejection> {
        validate_id("recipe", &recipe.recipe_id)?;
        if recipe.inputs.is_empty() || recipe.outputs.is_empty() || recipe.ticks == 0 {
            return Err(Rejection::new(RejectionCode::InvalidCommand, "recipe is incomplete"));
        }
        for input in &recipe.inputs {
            if input.count == 0 || !self.items.contains_key(&input.item_code) {
                return Err(Rejection::new(RejectionCode::InvalidCommand, "recipe input is invalid"));
            }
        }
        for output in &recipe.outputs {
            let definition = self
                .items
                .get(&output.item_code)
                .ok_or_else(|| Rejection::new(RejectionCode::InvalidCommand, "recipe output item is unknown"))?;
            output.validate(definition.max_stack)?;
        }
        if self.recipes.insert(recipe.recipe_id.clone(), recipe).is_some() {
            return Err(Rejection::new(RejectionCode::Conflict, "duplicate recipe"));
        }
        Ok(())
    }

    pub fn transfer(&mut self, command: &TransferCommand) -> Result<Vec<ResourceDelta>, Rejection> {
        if command.count == 0 || command.from.container == command.to.container && command.from.slot == command.to.slot
        {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "transfer is empty or self-referential",
            ));
        }
        let source = self
            .containers
            .get(&command.from.container)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "source container does not exist"))?;
        check_container_revision(source, command.from.expected_container_revision)?;
        let source_stack = source
            .slots
            .get(usize::from(command.from.slot))
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "source slot is outside container"))?
            .as_ref()
            .ok_or_else(|| Rejection::new(RejectionCode::InsufficientResource, "source slot is empty"))?
            .clone();
        if source_stack.count < command.count {
            return Err(Rejection::new(
                RejectionCode::InsufficientResource,
                "source stack is too small",
            ));
        }
        if let Some(expected) = &command.expected
            && (expected.item_code != source_stack.item_code
                || expected.metadata_hash != source_stack.metadata_hash
                || source_stack.count < expected.minimum_count)
        {
            return Err(Rejection::new(RejectionCode::Conflict, "source stack changed"));
        }
        let destination = self
            .containers
            .get(&command.to.container)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "destination container does not exist"))?;
        check_container_revision(destination, command.to.expected_container_revision)?;
        let destination_stack = destination
            .slots
            .get(usize::from(command.to.slot))
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "destination slot is outside container"))?
            .clone();
        if destination_stack
            .as_ref()
            .is_some_and(|stack| !stack.compatible_with(&source_stack))
        {
            return Err(Rejection::new(
                RejectionCode::RulesRejected,
                "destination stack is incompatible",
            ));
        }
        let definition = self
            .items
            .get(&source_stack.item_code)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidCommand, "source item definition is missing"))?;
        let existing = destination_stack.as_ref().map_or(0, |stack| stack.count);
        if existing
            .checked_add(command.count)
            .is_none_or(|count| count > definition.max_stack)
        {
            return Err(Rejection::new(
                RejectionCode::Capacity,
                "destination stack cannot hold transfer",
            ));
        }
        if let Some(required_tag) = &destination.equipment_tags[usize::from(command.to.slot)]
            && !definition.tags.contains(required_tag)
        {
            return Err(Rejection::new(
                RejectionCode::RulesRejected,
                "item is illegal for equipment slot",
            ));
        }

        self.mutate_slot(&command.from, |slot| {
            let stack = slot.as_mut().expect("validated source stack");
            stack.count -= command.count;
            if stack.count == 0 {
                *slot = None;
            }
        });
        self.mutate_slot(&command.to, |slot| match slot {
            Some(stack) => stack.count += command.count,
            None => {
                let mut moved = source_stack.clone();
                moved.count = command.count;
                *slot = Some(moved);
            }
        });
        Ok(Vec::new())
    }

    pub fn craft(&mut self, command: &CraftCommand) -> Result<Vec<ResourceDelta>, Rejection> {
        if command.quantity == 0 {
            return Err(Rejection::new(RejectionCode::InvalidCommand, "craft quantity is zero"));
        }
        let recipe = self
            .recipes
            .get(&command.recipe_id)
            .cloned()
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "recipe does not exist"))?;
        if recipe.station_tag.is_some() && command.station_id.is_none() {
            return Err(Rejection::new(
                RejectionCode::RulesRejected,
                "recipe requires a station",
            ));
        }
        let source = self
            .containers
            .get(&command.source)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "craft source does not exist"))?;
        check_container_revision(source, command.expected_source_revision)?;
        let destination = self
            .containers
            .get(&command.destination)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "craft destination does not exist"))?;
        check_container_revision(destination, command.expected_destination_revision)?;

        let mut staged = self.clone();
        let mut deltas = Vec::new();
        for ingredient in &recipe.inputs {
            let count = ingredient
                .count
                .checked_mul(u32::from(command.quantity))
                .ok_or_else(|| Rejection::new(RejectionCode::Capacity, "craft input count overflow"))?;
            staged.remove_matching(&command.source, ingredient, count)?;
            deltas.push(ResourceDelta {
                item_code: ingredient.item_code,
                metadata_hash: ingredient.metadata_hash.unwrap_or_default(),
                amount: -i64::from(count),
                reason: format!("craft:{}", recipe.recipe_id),
            });
        }
        for output in &recipe.outputs {
            let count = output
                .count
                .checked_mul(u32::from(command.quantity))
                .ok_or_else(|| Rejection::new(RejectionCode::Capacity, "craft output count overflow"))?;
            let mut created = output.clone();
            created.count = count;
            staged.add_stack(&command.destination, created.clone())?;
            deltas.push(ResourceDelta {
                item_code: created.item_code,
                metadata_hash: created.metadata_hash,
                amount: i64::from(count),
                reason: format!("craft:{}", recipe.recipe_id),
            });
        }
        *self = staged;
        Ok(deltas)
    }

    pub fn advance_furnace(&mut self, command: &FurnaceAdvanceCommand) -> Result<Vec<ResourceDelta>, Rejection> {
        let mut furnace = self
            .furnaces
            .get(&command.furnace_id)
            .cloned()
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "furnace does not exist"))?;
        if furnace.revision != command.expected_revision {
            return Err(Rejection::new(
                RejectionCode::StaleRevision,
                "furnace revision is stale",
            ));
        }
        if command.to_tick < furnace.last_tick {
            return Err(Rejection::new(
                RejectionCode::InvalidCommand,
                "furnace cannot move backward in time",
            ));
        }
        let recipe = self
            .recipes
            .get(&furnace.recipe_id)
            .cloned()
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "furnace recipe is missing"))?;
        let elapsed = command.to_tick - furnace.last_tick;
        let mut deltas = Vec::new();
        if furnace.active && furnace.fuel_ticks < elapsed {
            let needed = elapsed - furnace.fuel_ticks;
            let fuel = command
                .fuel_item
                .as_ref()
                .ok_or_else(|| Rejection::new(RejectionCode::InsufficientResource, "furnace requires fuel"))?;
            if command.fuel_ticks_per_item == 0 {
                return Err(Rejection::new(RejectionCode::InvalidCommand, "fuel duration is zero"));
            }
            let items = needed.div_ceil(u64::from(command.fuel_ticks_per_item));
            let items = u32::try_from(items)
                .map_err(|_| Rejection::new(RejectionCode::Capacity, "fuel request is too large"))?;
            self.remove_matching(&furnace.source, fuel, items)?;
            furnace.fuel_ticks = furnace
                .fuel_ticks
                .saturating_add(u64::from(items) * u64::from(command.fuel_ticks_per_item));
            deltas.push(ResourceDelta {
                item_code: fuel.item_code,
                metadata_hash: fuel.metadata_hash.unwrap_or_default(),
                amount: -i64::from(items),
                reason: "furnace:fuel".into(),
            });
        }
        let active_ticks = elapsed.min(furnace.fuel_ticks);
        furnace.fuel_ticks -= active_ticks;
        furnace.progress_ticks = furnace.progress_ticks.saturating_add(active_ticks);
        let cycles = furnace.progress_ticks / u64::from(recipe.ticks);
        if cycles > 0 {
            let cycles_u32 = u32::try_from(cycles)
                .map_err(|_| Rejection::new(RejectionCode::Capacity, "furnace cycle count is too large"))?;
            let mut staged = self.clone();
            for input in &recipe.inputs {
                let count = input
                    .count
                    .checked_mul(cycles_u32)
                    .ok_or_else(|| Rejection::new(RejectionCode::Capacity, "furnace input overflow"))?;
                staged.remove_matching(&furnace.source, input, count)?;
                deltas.push(ResourceDelta {
                    item_code: input.item_code,
                    metadata_hash: input.metadata_hash.unwrap_or_default(),
                    amount: -i64::from(count),
                    reason: format!("furnace:{}", recipe.recipe_id),
                });
            }
            for output in &recipe.outputs {
                let count = output
                    .count
                    .checked_mul(cycles_u32)
                    .ok_or_else(|| Rejection::new(RejectionCode::Capacity, "furnace output overflow"))?;
                let mut created = output.clone();
                created.count = count;
                staged.add_stack(&furnace.destination, created.clone())?;
                deltas.push(ResourceDelta {
                    item_code: created.item_code,
                    metadata_hash: created.metadata_hash,
                    amount: i64::from(count),
                    reason: format!("furnace:{}", recipe.recipe_id),
                });
            }
            *self = staged;
            furnace.progress_ticks %= u64::from(recipe.ticks);
        }
        furnace.last_tick = command.to_tick;
        furnace.revision = furnace.revision.wrapping_add(1);
        self.furnaces.insert(command.furnace_id.clone(), furnace);
        Ok(deltas)
    }

    pub(crate) fn consume_owned_item(
        &mut self,
        owner_id: &str,
        item_code: ItemCode,
        count: u32,
        reason: &str,
    ) -> Result<ResourceDelta, Rejection> {
        let key = self
            .containers
            .keys()
            .find(|key| key.kind == ContainerKind::Player && key.owner_id.as_deref() == Some(owner_id))
            .cloned()
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "player inventory does not exist"))?;
        self.remove_matching(
            &key,
            &Ingredient {
                item_code,
                metadata_hash: None,
                count,
            },
            count,
        )?;
        Ok(ResourceDelta {
            item_code,
            metadata_hash: CanonicalHash::default(),
            amount: -i64::from(count),
            reason: reason.to_owned(),
        })
    }

    pub(crate) fn grant_owned_item(
        &mut self,
        owner_id: &str,
        item_code: ItemCode,
        metadata_hash: CanonicalHash,
        count: u32,
    ) -> Result<(), Rejection> {
        let key = self
            .containers
            .keys()
            .find(|key| key.kind == ContainerKind::Player && key.owner_id.as_deref() == Some(owner_id))
            .cloned()
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "player inventory does not exist"))?;
        self.add_stack(
            &key,
            ItemStack {
                item_code,
                count,
                durability_millionths: None,
                metadata_hash,
            },
        )
    }

    pub(crate) fn resource_totals(&self) -> BTreeMap<(ItemCode, CanonicalHash), i128> {
        let mut totals = BTreeMap::new();
        for stack in self
            .containers
            .values()
            .flat_map(|container| container.slots.iter().flatten())
        {
            *totals.entry((stack.item_code, stack.metadata_hash)).or_default() += i128::from(stack.count);
        }
        totals
    }

    fn mutate_slot(&mut self, reference: &SlotRef, mutate: impl FnOnce(&mut Option<ItemStack>)) {
        let container = self
            .containers
            .get_mut(&reference.container)
            .expect("validated container");
        mutate(&mut container.slots[usize::from(reference.slot)]);
        container.revision = container.revision.wrapping_add(1);
    }

    fn remove_matching(
        &mut self,
        key: &ContainerKey,
        ingredient: &Ingredient,
        mut count: u32,
    ) -> Result<(), Rejection> {
        let container = self
            .containers
            .get_mut(key)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "container does not exist"))?;
        let available: u64 = container
            .slots
            .iter()
            .flatten()
            .filter(|stack| {
                stack.item_code == ingredient.item_code
                    && ingredient.metadata_hash.is_none_or(|hash| hash == stack.metadata_hash)
            })
            .map(|stack| u64::from(stack.count))
            .sum();
        if available < u64::from(count) {
            return Err(Rejection::new(
                RejectionCode::InsufficientResource,
                "container lacks recipe resources",
            ));
        }
        for slot in &mut container.slots {
            let Some(stack) = slot else { continue };
            if stack.item_code != ingredient.item_code
                || ingredient.metadata_hash.is_some_and(|hash| hash != stack.metadata_hash)
            {
                continue;
            }
            let removed = count.min(stack.count);
            stack.count -= removed;
            count -= removed;
            if stack.count == 0 {
                *slot = None;
            }
            if count == 0 {
                break;
            }
        }
        container.revision = container.revision.wrapping_add(1);
        Ok(())
    }

    fn add_stack(&mut self, key: &ContainerKey, mut stack: ItemStack) -> Result<(), Rejection> {
        let definition = self
            .items
            .get(&stack.item_code)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidCommand, "item definition is missing"))?
            .clone();
        let container = self
            .containers
            .get_mut(key)
            .ok_or_else(|| Rejection::new(RejectionCode::InvalidTarget, "container does not exist"))?;
        for existing in container.slots.iter_mut().flatten() {
            if existing.compatible_with(&stack) && existing.count < definition.max_stack {
                let moved = stack.count.min(definition.max_stack - existing.count);
                existing.count += moved;
                stack.count -= moved;
                if stack.count == 0 {
                    container.revision = container.revision.wrapping_add(1);
                    return Ok(());
                }
            }
        }
        for slot in &mut container.slots {
            if slot.is_none() {
                let moved = stack.count.min(definition.max_stack);
                let mut part = stack.clone();
                part.count = moved;
                *slot = Some(part);
                stack.count -= moved;
                if stack.count == 0 {
                    container.revision = container.revision.wrapping_add(1);
                    return Ok(());
                }
            }
        }
        Err(Rejection::new(
            RejectionCode::Capacity,
            "container has insufficient output space",
        ))
    }

    pub(crate) fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.items.len() as u64);
        for item in self.items.values() {
            hasher.write_u32(item.code);
            hasher.write_str(&item.content_id);
            hasher.write_u32(item.max_stack);
            for tag in &item.tags {
                hasher.write_str(tag);
            }
        }
        hasher.write_u64(self.recipes.len() as u64);
        for recipe in self.recipes.values() {
            hasher.write_str(&recipe.recipe_id);
            write_option_str(hasher, recipe.station_tag.as_deref());
            hasher.write_u64(recipe.inputs.len() as u64);
            for input in &recipe.inputs {
                hash_ingredient(input, hasher);
            }
            hasher.write_u64(recipe.outputs.len() as u64);
            for output in &recipe.outputs {
                output.hash_into(hasher);
            }
            hasher.write_u32(recipe.ticks);
        }
        hasher.write_u64(self.containers.len() as u64);
        for container in self.containers.values() {
            container.hash_into(hasher);
        }
        hasher.write_u64(self.furnaces.len() as u64);
        for furnace in self.furnaces.values() {
            hasher.write_str(&furnace.furnace_id);
            hasher.write_u64(furnace.revision);
            hasher.write_str(&furnace.recipe_id);
            furnace.source.hash_into(hasher);
            furnace.destination.hash_into(hasher);
            hasher.write_u64(furnace.progress_ticks);
            hasher.write_u64(furnace.fuel_ticks);
            hasher.write_u64(furnace.last_tick);
            hasher.write_u16(u16::from(furnace.active));
        }
        // Empty stores deliberately contribute no bytes so decoded V1
        // snapshots retain their historical state hashes.
        if !self.item_instance_metadata.is_empty() {
            hasher.write_str("blockwild.gameplay.item-instance-metadata-store.v1");
            hasher.write_u64(self.item_instance_metadata.len() as u64);
            for metadata in self.item_instance_metadata.values() {
                metadata.hash_into(hasher);
            }
        }
    }
}

fn check_container_revision(container: &Container, expected: Option<u64>) -> Result<(), Rejection> {
    if expected.is_some_and(|revision| revision != container.revision) {
        return Err(Rejection::new(
            RejectionCode::StaleRevision,
            "container revision is stale",
        ));
    }
    Ok(())
}

fn hash_ingredient(ingredient: &Ingredient, hasher: &mut CanonicalHasher) {
    hasher.write_u32(ingredient.item_code);
    match ingredient.metadata_hash {
        Some(hash) => {
            hasher.write_u16(1);
            hasher.write_bytes(hash.as_bytes());
        }
        None => hasher.write_u16(0),
    }
    hasher.write_u32(ingredient.count);
}
