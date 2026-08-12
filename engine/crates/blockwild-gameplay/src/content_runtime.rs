use std::collections::{BTreeMap, BTreeSet};

use blockwild_types::{CanonicalHash, CanonicalHasher};

use crate::{
    ALL_CONTENT_DOMAINS, CONTENT_MANIFEST_SCHEMA_VERSION, ContentDomain, ContentManifestEntry, MAX_CONTENT_ENTRIES,
    MAX_ITEM_STACK, MetadataBlob, MetadataBlobStore, ProductionContentManifest,
};

pub const CONTENT_RUNTIME_SCHEMA_VERSION: u16 = 1;
pub const MAX_CONTENT_JSON_DEPTH: usize = 64;
pub const MAX_CONTENT_JSON_NODES: usize = 65_536;
pub const MAX_CONTENT_REFERENCES: usize = 262_144;
pub const MAX_CONTENT_RESOURCES_PER_ENTRY: usize = 4_096;
pub const MAX_BLOCK_ACTION_PROFILES: usize = 4_096;
pub const MAX_BLOCK_LOOT_RULES: usize = 32;
pub const MAX_BLOCK_LOOT_THRESHOLD_BONUSES: usize = 16;
pub const MAX_BLOCK_PLANTING_RULES: usize = 512;
pub const MAX_BLOCK_ACTION_INTENTS: usize = 32;
pub const MAX_BLOCK_AUTHORITY_BLOCKERS: usize = 32;
pub const MAX_RENDER_PRESENTATION_PROFILES: usize = 4_096;
pub const MAX_MISSING_RENDER_PRESENTATION_PROFILES: usize = 4_096;
pub const MAX_RENDER_PRESENTATION_REFS: usize = 4_096;
pub const MAX_RENDER_PRESENTATION_SOURCE_IDS: usize = 4_096;
pub const BLOCK_ACTION_CATALOG_ID: &str = "block-actions";
pub const RENDER_PRESENTATION_CATALOG_ID: &str = "render-presentations";
pub const CONTENT_ACTION_FIXED_SCALE: u64 = 1_000_000;

pub const BLOCK_TOPOLOGY_DIRECTIONAL: u16 = 1 << 0;
pub const BLOCK_TOPOLOGY_PAIRED: u16 = 1 << 1;
pub const BLOCK_TOPOLOGY_ATTACHED: u16 = 1 << 2;
pub const BLOCK_TOPOLOGY_VERTICAL_CONNECTED: u16 = 1 << 3;
pub const BLOCK_TOPOLOGY_HORIZONTAL_CONNECTED: u16 = 1 << 4;
pub const BLOCK_TOPOLOGY_WATERLOGGED: u16 = 1 << 5;
pub const BLOCK_TOPOLOGY_BOUNDED_NETWORK: u16 = 1 << 6;
pub const BLOCK_TOPOLOGY_MASK: u16 = BLOCK_TOPOLOGY_DIRECTIONAL
    | BLOCK_TOPOLOGY_PAIRED
    | BLOCK_TOPOLOGY_ATTACHED
    | BLOCK_TOPOLOGY_VERTICAL_CONNECTED
    | BLOCK_TOPOLOGY_HORIZONTAL_CONNECTED
    | BLOCK_TOPOLOGY_WATERLOGGED
    | BLOCK_TOPOLOGY_BOUNDED_NETWORK;

const BLOCK_ACTION_SHAPES: &[&str] = &[
    "alchemy",
    "apiary",
    "aquarium",
    "aquatic",
    "archive-shelf",
    "barrel",
    "bed",
    "bush",
    "cartography",
    "chair",
    "chest",
    "cross",
    "cube",
    "distillery",
    "door",
    "dragon-egg",
    "exhibit",
    "fence",
    "fireplace",
    "fruit",
    "gate",
    "gold-pile",
    "incubator",
    "lightning-bug-jar",
    "mooncap",
    "morph-loom",
    "orb-healer",
    "orb-rack",
    "shelf",
    "stool",
    "sugarworks",
    "table",
    "tall-flower",
    "tome-display",
    "torch",
    "wayshrine",
    "wild-hive",
];

const BLOCK_ACTION_VERTICAL_CONNECT_GROUPS: &[&str] = &[
    "abyss-bloom",
    "brinegrass",
    "cave-reed",
    "cave-root",
    "cultivated-flower",
    "double-tall-grass",
    "egg-reed",
    "featherwrack",
    "glow-kelp",
    "lumen-kelp",
    "lumenreed",
    "luminous-algae",
    "pearlfan",
    "reed-bloom",
    "river-ribbon",
    "rope-ladder",
    "sailkelp",
    "star-coral",
    "tidevine",
    "wild-peppermint",
];

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentSchema {
    ItemDefinition,
    BlockActionCatalog,
    BlockActionCatalogV2,
    CraftingRecipe,
    BlueprintDefinition,
    AlchemyRecipe,
    DistilleryRecipe,
    SugarworksRecipe,
    FurnaceRecipe,
    OrbMorphRecipe,
    GolemForgeRecipe,
    WheatMillProcess,
    MachineProfileV1,
    MachineProfileV2,
    RenderPresentationCatalog,
    SpellDefinition,
    CreatureMove,
    CreatureStatus,
    CreatureReaction,
    CreatureProfile,
    PlayerRenderProfile,
    CreatureType,
    CreatureTypeChart,
    QuestDefinition,
    QuestlineDefinition,
    GuildDefinition,
    GuildQuest,
    GuildNpc,
    FactionDefinition,
    CommerceItem,
    MerchantOffer,
    StockDefinition,
    TcgCardDefinition,
    TcgPrinting,
    TcgPack,
    TcgSet,
}

impl ContentSchema {
    #[must_use]
    pub const fn as_id(self) -> &'static str {
        match self {
            Self::ItemDefinition => "item-definition@1",
            Self::BlockActionCatalog => "block-action-catalog@1",
            Self::BlockActionCatalogV2 => "block-action-catalog@2",
            Self::CraftingRecipe => "crafting-recipe@1",
            Self::BlueprintDefinition => "blueprint-definition@1",
            Self::AlchemyRecipe => "alchemy-recipe@1",
            Self::DistilleryRecipe => "distillery-recipe@1",
            Self::SugarworksRecipe => "sugarworks-recipe@1",
            Self::FurnaceRecipe => "furnace-recipe@1",
            Self::OrbMorphRecipe => "orb-morph-recipe@2",
            Self::GolemForgeRecipe => "golem-forge-recipe@1",
            Self::WheatMillProcess => "wheat-mill-process@1",
            Self::MachineProfileV1 => "machine-profile@1",
            Self::MachineProfileV2 => "machine-profile@2",
            Self::RenderPresentationCatalog => "render-presentation-catalog@1",
            Self::SpellDefinition => "spell-definition@1",
            Self::CreatureMove => "creature-move@1",
            Self::CreatureStatus => "creature-status@1",
            Self::CreatureReaction => "creature-reaction@1",
            Self::CreatureProfile => "creature-profile@1",
            Self::PlayerRenderProfile => "player-render-profile@1",
            Self::CreatureType => "creature-type@1",
            Self::CreatureTypeChart => "creature-type-chart@1",
            Self::QuestDefinition => "quest-definition@1",
            Self::QuestlineDefinition => "questline-definition@1",
            Self::GuildDefinition => "guild-definition@1",
            Self::GuildQuest => "guild-quest@1",
            Self::GuildNpc => "guild-npc@1",
            Self::FactionDefinition => "faction-definition@1",
            Self::CommerceItem => "commerce-item@1",
            Self::MerchantOffer => "merchant-offer@1",
            Self::StockDefinition => "stock-definition@1",
            Self::TcgCardDefinition => "tcg-card-definition@1",
            Self::TcgPrinting => "tcg-printing@1",
            Self::TcgPack => "tcg-pack@1",
            Self::TcgSet => "tcg-set@1",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentRuntimeStage {
    Manifest,
    BlobResolution,
    SchemaDecode,
    Invariants,
    References,
    Materialization,
    Attestation,
}

pub const CONTENT_RUNTIME_STAGES: [ContentRuntimeStage; 7] = [
    ContentRuntimeStage::Manifest,
    ContentRuntimeStage::BlobResolution,
    ContentRuntimeStage::SchemaDecode,
    ContentRuntimeStage::Invariants,
    ContentRuntimeStage::References,
    ContentRuntimeStage::Materialization,
    ContentRuntimeStage::Attestation,
];

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentRuntimeBlockerCode {
    Manifest,
    Capacity,
    MissingBlob,
    DescriptorMismatch,
    UnsupportedSchema,
    InvalidJson,
    MissingField,
    InvalidType,
    InvalidEnum,
    Range,
    DuplicateAlias,
    MissingDependency,
    ResourceConservation,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentRuntimeBlocker {
    pub code: ContentRuntimeBlockerCode,
    pub stage: ContentRuntimeStage,
    pub domain: Option<ContentDomain>,
    pub id: Option<String>,
    pub path: String,
    pub expected: Option<String>,
    pub actual: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CanonicalJson {
    Null,
    Bool(bool),
    Number(String),
    String(String),
    Array(Vec<Self>),
    Object(BTreeMap<String, Self>),
}

impl CanonicalJson {
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&Self> {
        self.as_object().and_then(|object| object.get(key))
    }

    #[must_use]
    pub const fn as_bool(&self) -> Option<bool> {
        if let Self::Bool(value) = self {
            Some(*value)
        } else {
            None
        }
    }

    #[must_use]
    pub fn as_str(&self) -> Option<&str> {
        if let Self::String(value) = self {
            Some(value)
        } else {
            None
        }
    }

    #[must_use]
    pub fn as_array(&self) -> Option<&[Self]> {
        if let Self::Array(value) = self {
            Some(value)
        } else {
            None
        }
    }

    #[must_use]
    pub fn as_object(&self) -> Option<&BTreeMap<String, Self>> {
        if let Self::Object(value) = self {
            Some(value)
        } else {
            None
        }
    }

    #[must_use]
    pub fn as_f64(&self) -> Option<f64> {
        let Self::Number(value) = self else {
            return None;
        };
        value.parse::<f64>().ok().filter(|number| number.is_finite())
    }

    #[must_use]
    pub fn as_u64(&self) -> Option<u64> {
        let value = self.as_f64()?;
        if value < 0.0 || value.fract() != 0.0 || value > u64::MAX as f64 {
            return None;
        }
        Some(value as u64)
    }
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentResourceKey {
    ItemCode(u32),
    ItemChoice(Vec<u32>),
    Symbolic(String),
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ContentResourceAmount {
    pub resource: ContentResourceKey,
    pub amount: u32,
    pub consumed: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ContentResourceFlow {
    pub inputs: Vec<ContentResourceAmount>,
    pub outputs: Vec<ContentResourceAmount>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ContentReference {
    pub domain: ContentDomain,
    pub id: String,
    pub path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentRecordCore {
    pub id: String,
    pub schema: ContentSchema,
    pub content_version: u32,
    pub blob_hash: CanonicalHash,
    pub aliases: Vec<String>,
    pub document: CanonicalJson,
    pub unknown_extension_bytes: Vec<u8>,
    pub references: Vec<ContentReference>,
    pub resources: ContentResourceFlow,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentActionToolKind {
    Hand,
    Axe,
    Bow,
    Crossbow,
    Firearm,
    Pickaxe,
    Shovel,
    Spear,
    Staff,
    Sword,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentActionLiquidKind {
    Water,
    Lava,
    Honey,
    Syrup,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentItemUseKind {
    Net,
    ReleaseCreature,
    Boat,
    CreatureCage,
    CaptureOrb,
    MagicRelic,
    Plant,
    Hoe,
    Scythe,
    Shears,
    Bucket,
    Lead,
    Shield,
    Blueprint,
    Potion,
    RangedWeapon,
    Spear,
    SeedPouch,
    SpellTome,
    ManaConsumable,
    DragonEgg,
    DragonModule,
    LairSurvey,
    SettlementChart,
    Cardforge,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockLootChanceModifier {
    None,
    LuckAdjustedV1,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockLootRollScope {
    None,
    RandomDropV1,
    SharedPlantYield,
    SharedExclusive,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentBlockLootThresholdBonus {
    pub above_millionths: u64,
    pub amount: u32,
    pub scythe_only: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ContentBlockLootCount {
    Constant(u32),
    UniformInclusive {
        minimum: u32,
        maximum: u32,
    },
    SharedRollFormula {
        base: u32,
        floor_roll_multiplier: u32,
        scythe_bonus: u32,
        threshold_bonuses: Vec<ContentBlockLootThresholdBonus>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentBlockLootRule {
    pub ordinal: u16,
    pub id: String,
    pub item_code: u32,
    pub chance_millionths: u64,
    pub chance_modifier: ContentBlockLootChanceModifier,
    pub roll_scope: ContentBlockLootRollScope,
    pub count: ContentBlockLootCount,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockLootMode {
    None,
    All,
    Exclusive,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockSelfDropMode {
    Absent,
    Contextual,
    MappedItem,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockSilkTouchPolicy {
    NotAuthored,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentBlockLootProfile {
    pub mode: ContentBlockLootMode,
    pub self_drop_mode: ContentBlockSelfDropMode,
    pub silk_touch: ContentBlockSilkTouchPolicy,
    pub rules: Vec<ContentBlockLootRule>,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockBreakReplacement {
    Blocked,
    Air,
    PairedAir,
    ColumnAir,
    ColumnWater,
    RootedTreeOrAir,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ContentBlockDurabilityCost {
    None,
    Constant(u32),
    RootedTreeLogCount { minimum: u32, divisor: u32 },
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockContextualOverride {
    None,
    RootedTreeFallRuntime,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockWrongToolPolicy {
    BreakNoLoot,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentBlockBreakProfile {
    pub replacement: ContentBlockBreakReplacement,
    pub durability_cost: ContentBlockDurabilityCost,
    pub wrong_tool: ContentBlockWrongToolPolicy,
    pub contextual_override: ContentBlockContextualOverride,
    pub loot: ContentBlockLootProfile,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentBlockHarvestIntent {
    pub replacement_without_scythe: u16,
    pub replacement_with_scythe: u16,
    pub replanted_without_scythe: bool,
    pub replanted_with_scythe: bool,
    pub preserve_cultivated: bool,
    pub scythe_durability_cost: u32,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockPlacementIntent {
    None,
    Direct,
    Directional,
    AttachedTorch,
    PairedDoor,
    PairedBed,
    OrientedGate,
    BoundedNetwork,
    Sapling,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockInteractionIntent {
    Harvest,
    Till,
    Plant,
    Bucket,
    FillBottle,
    ToggleGate,
    HitchLead,
    ToggleDoor,
    SleepSession,
    Seat,
    ArchiveShelfSession,
    CraftingSession,
    FurnaceSession,
    WheatMillSession,
    ChestSession,
    ApiarySession,
    MorphLoomSession,
    OrbRackSession,
    HealingStationSession,
    AquariumSession,
    FieldPerchSession,
    WaygridItemsSession,
    WaygridCreaturesSession,
    GolemForgeSession,
    ExhibitSession,
    CartographySession,
    AlchemySession,
    DistillerySession,
    SugarworksSession,
    MapSession,
    IncubatorSession,
    Lift,
    TomeDisplaySession,
    WayfinderSession,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentBlockPlantAbove {
    Air,
    ReplaceableDry,
    WaterSource,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentBlockPlantingRule {
    pub item_code: u32,
    pub above: ContentBlockPlantAbove,
    pub result_block: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentBlockActionRngSemantics {
    pub algorithm: String,
    pub seed_derivation: String,
    pub stream: String,
    pub unit: String,
    pub ordering: String,
    pub random_drop_gate: String,
    pub exclusive_selection: String,
    pub plant_yield_clamp_maximum_millionths: u64,
}

/// Typed action semantics retained from one installed item-definition blob.
/// Optional fields remain optional so non-interactive resources do not acquire
/// fabricated tool, food, or placement behavior during materialization.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentItemActionProfile {
    pub tool_kind: Option<ContentActionToolKind>,
    pub tier: Option<u16>,
    pub mining_speed_millionths: Option<u64>,
    pub max_durability: Option<u32>,
    pub infinite_durability: Option<bool>,
    pub food: Option<u32>,
    pub damage: Option<u32>,
    pub fuel: Option<u32>,
    pub use_kind: Option<ContentItemUseKind>,
    pub place_block: Option<u16>,
    pub plant_block: Option<u16>,
    pub bucket_liquid: Option<ContentActionLiquidKind>,
    pub ammo_item: Option<u32>,
    pub magazine_size: Option<u32>,
    pub blueprint_id: Option<String>,
    pub potion_id: Option<String>,
    pub creature_kind: Option<String>,
    pub spell_id: Option<String>,
    pub mana_increase: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentBlockActionProfile {
    pub block_id: u16,
    pub hardness_millionths: u64,
    pub solid: bool,
    pub replaceable: bool,
    pub liquid: Option<ContentActionLiquidKind>,
    pub preferred_tool: ContentActionToolKind,
    pub required_tier: u16,
    /// Canonical block-to-inventory mapping. Contextual loot rules may replace
    /// this result, but may not silently change this content-owned identity.
    pub mapped_item_code: Option<u32>,
    pub shape: Option<String>,
    pub collision_height_millionths: Option<u64>,
    pub vertical_connect_group: Option<String>,
    pub connect_group: Option<String>,
    pub topology_flags: u16,
    pub break_profile: Option<ContentBlockBreakProfile>,
    pub harvest_intent: Option<ContentBlockHarvestIntent>,
    pub placement_intent: Option<ContentBlockPlacementIntent>,
    pub placement_items: Vec<u32>,
    pub interaction_intents: Vec<ContentBlockInteractionIntent>,
    pub planting_rules: Vec<ContentBlockPlantingRule>,
    pub authority_blockers: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentBlockActionCatalogRecord {
    pub core: ContentRecordCore,
    pub rng_semantics: Option<ContentBlockActionRngSemantics>,
    pub authority_blockers: Vec<String>,
    pub profiles: BTreeMap<u16, ContentBlockActionProfile>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentItemRecord {
    pub core: ContentRecordCore,
    pub item_code: u32,
    pub max_stack: u32,
    pub action: ContentItemActionProfile,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentRecipeRecord {
    pub core: ContentRecordCore,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentMachineProfileRecord {
    pub core: ContentRecordCore,
    pub capacity_fields: BTreeMap<String, u64>,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ContentRenderPresentationRole {
    DroppedItem,
    HeldItem,
    Machine,
    Projectile,
    Summon,
    Vehicle,
    WorldProp,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentRenderPresentationModel {
    pub model_id: String,
    pub label: String,
    pub category: u8,
    pub ground_y_bits: Option<u32>,
    pub node_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentRenderPresentationProfile {
    pub id: String,
    pub role: ContentRenderPresentationRole,
    pub model: ContentRenderPresentationModel,
    pub content_refs: Vec<ContentReference>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentMissingRenderPresentationProfile {
    pub id: String,
    pub role: ContentRenderPresentationRole,
    pub source_presentation_ids: Vec<String>,
    pub content_refs: Vec<ContentReference>,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentRenderPresentationCatalogRecord {
    pub core: ContentRecordCore,
    pub catalog_schema: u16,
    pub catalog_revision: u32,
    pub catalog_sha256: String,
    pub catalog_canonical_hash: String,
    pub catalog_byte_length: u32,
    pub catalog_model_count: u32,
    pub catalog_node_count: u32,
    pub catalog_source: String,
    pub profiles: BTreeMap<String, ContentRenderPresentationProfile>,
    pub missing_profiles: BTreeMap<String, ContentMissingRenderPresentationProfile>,
    pub integration_blockers: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentAbilityRecord {
    pub core: ContentRecordCore,
    pub cooldown_millis: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentCreatureRecord {
    pub core: ContentRecordCore,
    pub natural_types: Vec<String>,
    pub move_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentPlayerRenderRecord {
    pub core: ContentRecordCore,
    pub catalog_schema: u16,
    pub catalog_revision: u32,
    pub catalog_sha256: String,
    pub catalog_canonical_hash: String,
    pub catalog_byte_length: u32,
    pub catalog_model_count: u32,
    pub catalog_node_count: u32,
    pub catalog_source: String,
    pub model_id: String,
    pub model_label: String,
    pub model_pose: String,
    pub model_category: u8,
    pub model_ground_y_bits: u64,
    pub model_node_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentTypedRecord {
    pub core: ContentRecordCore,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentRuntimeRegistry {
    pub manifest_hash: CanonicalHash,
    pub registry_hash: CanonicalHash,
    pub source_revision: String,
    pub items: BTreeMap<String, ContentItemRecord>,
    pub block_action_catalogs: BTreeMap<String, ContentBlockActionCatalogRecord>,
    pub crafting_recipes: BTreeMap<String, ContentRecipeRecord>,
    pub machine_recipes: BTreeMap<String, ContentRecipeRecord>,
    pub machine_profiles: BTreeMap<String, ContentMachineProfileRecord>,
    pub render_presentation_catalogs: BTreeMap<String, ContentRenderPresentationCatalogRecord>,
    pub abilities_spells: BTreeMap<String, ContentAbilityRecord>,
    pub creature_profiles: BTreeMap<String, ContentCreatureRecord>,
    pub player_render_profiles: BTreeMap<String, ContentPlayerRenderRecord>,
    pub creature_type_chart: BTreeMap<String, ContentTypedRecord>,
    pub quests_guilds: BTreeMap<String, ContentTypedRecord>,
    pub economy: BTreeMap<String, ContentTypedRecord>,
    pub cardforge_cards: BTreeMap<String, ContentTypedRecord>,
    pub cardforge_packs: BTreeMap<String, ContentTypedRecord>,
    pub aliases: BTreeMap<String, (ContentDomain, String)>,
}

impl Default for ContentRuntimeRegistry {
    fn default() -> Self {
        Self {
            manifest_hash: CanonicalHash([0; 16]),
            registry_hash: CanonicalHash([0; 16]),
            source_revision: String::new(),
            items: BTreeMap::new(),
            block_action_catalogs: BTreeMap::new(),
            crafting_recipes: BTreeMap::new(),
            machine_recipes: BTreeMap::new(),
            machine_profiles: BTreeMap::new(),
            render_presentation_catalogs: BTreeMap::new(),
            abilities_spells: BTreeMap::new(),
            creature_profiles: BTreeMap::new(),
            player_render_profiles: BTreeMap::new(),
            creature_type_chart: BTreeMap::new(),
            quests_guilds: BTreeMap::new(),
            economy: BTreeMap::new(),
            cardforge_cards: BTreeMap::new(),
            cardforge_packs: BTreeMap::new(),
            aliases: BTreeMap::new(),
        }
    }
}

impl ContentRuntimeRegistry {
    #[must_use]
    pub fn len(&self) -> usize {
        self.items.len()
            + self.block_action_catalogs.len()
            + self.crafting_recipes.len()
            + self.machine_recipes.len()
            + self.machine_profiles.len()
            + self.render_presentation_catalogs.len()
            + self.abilities_spells.len()
            + self.creature_profiles.len()
            + self.player_render_profiles.len()
            + self.creature_type_chart.len()
            + self.quests_guilds.len()
            + self.economy.len()
            + self.cardforge_cards.len()
            + self.cardforge_packs.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn install(
        &mut self,
        manifest: &ProductionContentManifest,
        store: &MetadataBlobStore,
    ) -> Result<ContentRuntimeInstallReport, Vec<ContentRuntimeBlocker>> {
        let (staged, report) = materialize_content_runtime(manifest, store)?;
        *self = staged;
        Ok(report)
    }

    #[must_use]
    pub fn get(&self, domain: ContentDomain, id: &str) -> Option<&ContentRecordCore> {
        match domain {
            ContentDomain::Item => self
                .items
                .get(id)
                .map(|record| &record.core)
                .or_else(|| self.block_action_catalogs.get(id).map(|record| &record.core)),
            ContentDomain::CraftingRecipe => self.crafting_recipes.get(id).map(|record| &record.core),
            ContentDomain::MachineRecipe => self.machine_recipes.get(id).map(|record| &record.core),
            ContentDomain::MachineProfile => self
                .machine_profiles
                .get(id)
                .map(|record| &record.core)
                .or_else(|| self.render_presentation_catalogs.get(id).map(|record| &record.core)),
            ContentDomain::AbilitySpell => self.abilities_spells.get(id).map(|record| &record.core),
            ContentDomain::CreatureProfile => self
                .creature_profiles
                .get(id)
                .map(|record| &record.core)
                .or_else(|| self.player_render_profiles.get(id).map(|record| &record.core)),
            ContentDomain::CreatureTypeChart => self.creature_type_chart.get(id).map(|record| &record.core),
            ContentDomain::QuestGuild => self.quests_guilds.get(id).map(|record| &record.core),
            ContentDomain::Economy => self.economy.get(id).map(|record| &record.core),
            ContentDomain::CardforgeCard => self.cardforge_cards.get(id).map(|record| &record.core),
            ContentDomain::CardforgePack => self.cardforge_packs.get(id).map(|record| &record.core),
        }
    }

    #[must_use]
    pub fn get_by_alias(&self, alias: &str) -> Option<&ContentRecordCore> {
        let (domain, id) = self.aliases.get(alias)?;
        self.get(*domain, id)
    }

    #[must_use]
    pub fn block_action(&self, block_id: u16) -> Option<&ContentBlockActionProfile> {
        self.block_action_catalogs
            .get(BLOCK_ACTION_CATALOG_ID)?
            .profiles
            .get(&block_id)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentRuntimeInstallReport {
    pub schema_version: u16,
    pub manifest_hash: CanonicalHash,
    pub registry_hash: CanonicalHash,
    pub installed_entries: u32,
    pub executable_bytes: u64,
    pub opaque_extension_bytes: u64,
    pub references: u32,
    pub domain_counts: BTreeMap<ContentDomain, u32>,
    pub completed_stages: Vec<ContentRuntimeStage>,
}

#[derive(Clone, Debug)]
struct DecodedRecord {
    domain: ContentDomain,
    id: String,
    schema: ContentSchema,
    content_version: u32,
    blob_hash: CanonicalHash,
    aliases: Vec<String>,
    document: CanonicalJson,
    unknown_extension_bytes: Vec<u8>,
}

#[derive(Default)]
struct RecordFacts {
    references: Vec<ContentReference>,
    reference_choices: Vec<ContentReferenceChoice>,
    resources: ContentResourceFlow,
    item_code: Option<u32>,
    max_stack: Option<u32>,
    item_action: Option<ContentItemActionProfile>,
    block_action_rng_semantics: Option<ContentBlockActionRngSemantics>,
    block_action_authority_blockers: Vec<String>,
    block_actions: BTreeMap<u16, ContentBlockActionProfile>,
    capacity_fields: BTreeMap<String, u64>,
    cooldown_millis: u64,
    natural_types: Vec<String>,
    move_ids: Vec<String>,
    player_render: Option<PlayerRenderFacts>,
    render_presentation: Option<RenderPresentationFacts>,
}

#[derive(Clone, Debug)]
struct PlayerRenderFacts {
    catalog_schema: u16,
    catalog_revision: u32,
    catalog_sha256: String,
    catalog_canonical_hash: String,
    catalog_byte_length: u32,
    catalog_model_count: u32,
    catalog_node_count: u32,
    catalog_source: String,
    model_id: String,
    model_label: String,
    model_pose: String,
    model_category: u8,
    model_ground_y_bits: u64,
    model_node_count: u32,
}

#[derive(Clone, Debug)]
struct RenderPresentationFacts {
    catalog_schema: u16,
    catalog_revision: u32,
    catalog_sha256: String,
    catalog_canonical_hash: String,
    catalog_byte_length: u32,
    catalog_model_count: u32,
    catalog_node_count: u32,
    catalog_source: String,
    profiles: BTreeMap<String, ContentRenderPresentationProfile>,
    missing_profiles: BTreeMap<String, ContentMissingRenderPresentationProfile>,
    integration_blockers: Vec<String>,
}

#[derive(Clone, Debug)]
struct ContentReferenceChoice {
    targets: Vec<(ContentDomain, String)>,
    path: String,
}

struct JsonParser<'a> {
    source: &'a [u8],
    cursor: usize,
    nodes: usize,
}

impl<'a> JsonParser<'a> {
    fn parse(source: &'a [u8]) -> Result<CanonicalJson, String> {
        std::str::from_utf8(source).map_err(|_| "content JSON is not UTF-8".to_owned())?;
        let mut parser = Self {
            source,
            cursor: 0,
            nodes: 0,
        };
        let value = parser.value(0)?;
        if parser.cursor != source.len() {
            return Err(format!("trailing bytes begin at {}", parser.cursor));
        }
        Ok(value)
    }

    fn value(&mut self, depth: usize) -> Result<CanonicalJson, String> {
        if depth > MAX_CONTENT_JSON_DEPTH {
            return Err("content JSON exceeds maximum depth".to_owned());
        }
        self.nodes += 1;
        if self.nodes > MAX_CONTENT_JSON_NODES {
            return Err("content JSON exceeds maximum node count".to_owned());
        }
        match self.peek() {
            Some(b'n') => {
                self.literal(b"null")?;
                Ok(CanonicalJson::Null)
            }
            Some(b't') => {
                self.literal(b"true")?;
                Ok(CanonicalJson::Bool(true))
            }
            Some(b'f') => {
                self.literal(b"false")?;
                Ok(CanonicalJson::Bool(false))
            }
            Some(b'"') => self.string().map(CanonicalJson::String),
            Some(b'[') => self.array(depth + 1),
            Some(b'{') => self.object(depth + 1),
            Some(b'-' | b'0'..=b'9') => self.number().map(CanonicalJson::Number),
            Some(value) => Err(format!("unexpected byte {value} at {}", self.cursor)),
            None => Err("unexpected end of content JSON".to_owned()),
        }
    }

    fn array(&mut self, depth: usize) -> Result<CanonicalJson, String> {
        self.expect(b'[')?;
        let mut values = Vec::new();
        if self.consume(b']') {
            return Ok(CanonicalJson::Array(values));
        }
        loop {
            values.push(self.value(depth)?);
            if self.consume(b']') {
                break;
            }
            self.expect(b',')?;
        }
        Ok(CanonicalJson::Array(values))
    }

    fn object(&mut self, depth: usize) -> Result<CanonicalJson, String> {
        self.expect(b'{')?;
        let mut fields = BTreeMap::new();
        if self.consume(b'}') {
            return Ok(CanonicalJson::Object(fields));
        }
        loop {
            let key = self.string()?;
            self.expect(b':')?;
            let value = self.value(depth)?;
            if fields.insert(key.clone(), value).is_some() {
                return Err(format!("duplicate object key {key:?}"));
            }
            if self.consume(b'}') {
                break;
            }
            self.expect(b',')?;
        }
        Ok(CanonicalJson::Object(fields))
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut result = String::new();
        let mut segment = self.cursor;
        loop {
            let Some(byte) = self.peek() else {
                return Err("unterminated JSON string".to_owned());
            };
            match byte {
                b'"' => {
                    self.push_utf8_segment(&mut result, segment, self.cursor)?;
                    self.cursor += 1;
                    return Ok(result);
                }
                b'\\' => {
                    self.push_utf8_segment(&mut result, segment, self.cursor)?;
                    self.cursor += 1;
                    let escaped = self.next().ok_or_else(|| "unterminated JSON escape".to_owned())?;
                    match escaped {
                        b'"' => result.push('"'),
                        b'\\' => result.push('\\'),
                        b'/' => result.push('/'),
                        b'b' => result.push('\u{0008}'),
                        b'f' => result.push('\u{000c}'),
                        b'n' => result.push('\n'),
                        b'r' => result.push('\r'),
                        b't' => result.push('\t'),
                        b'u' => self.push_unicode_escape(&mut result)?,
                        _ => return Err(format!("invalid JSON escape at {}", self.cursor - 1)),
                    }
                    segment = self.cursor;
                }
                0..=0x1f => return Err(format!("control byte in JSON string at {}", self.cursor)),
                _ => self.cursor += 1,
            }
        }
    }

    fn push_unicode_escape(&mut self, target: &mut String) -> Result<(), String> {
        let first = self.hex_quad()?;
        let scalar = if (0xd800..=0xdbff).contains(&first) {
            self.expect(b'\\')?;
            self.expect(b'u')?;
            let second = self.hex_quad()?;
            if !(0xdc00..=0xdfff).contains(&second) {
                return Err("high surrogate is not followed by a low surrogate".to_owned());
            }
            0x1_0000 + ((u32::from(first) - 0xd800) << 10) + (u32::from(second) - 0xdc00)
        } else if (0xdc00..=0xdfff).contains(&first) {
            return Err("unpaired low surrogate".to_owned());
        } else {
            u32::from(first)
        };
        target.push(char::from_u32(scalar).ok_or_else(|| "invalid Unicode scalar".to_owned())?);
        Ok(())
    }

    fn hex_quad(&mut self) -> Result<u16, String> {
        let mut value = 0_u16;
        for _ in 0..4 {
            let byte = self.next().ok_or_else(|| "truncated Unicode escape".to_owned())?;
            value = (value << 4)
                | u16::from(match byte {
                    b'0'..=b'9' => byte - b'0',
                    b'a'..=b'f' => byte - b'a' + 10,
                    b'A'..=b'F' => byte - b'A' + 10,
                    _ => return Err("invalid Unicode escape".to_owned()),
                });
        }
        Ok(value)
    }

    fn push_utf8_segment(&self, target: &mut String, start: usize, end: usize) -> Result<(), String> {
        let segment =
            std::str::from_utf8(&self.source[start..end]).map_err(|_| "invalid UTF-8 in JSON string".to_owned())?;
        target.push_str(segment);
        Ok(())
    }

    fn number(&mut self) -> Result<String, String> {
        let start = self.cursor;
        self.consume(b'-');
        match self.peek() {
            Some(b'0') => {
                self.cursor += 1;
                if self.peek().is_some_and(|value| value.is_ascii_digit()) {
                    return Err("JSON number has a leading zero".to_owned());
                }
            }
            Some(b'1'..=b'9') => {
                self.cursor += 1;
                while self.peek().is_some_and(|value| value.is_ascii_digit()) {
                    self.cursor += 1;
                }
            }
            _ => return Err("invalid JSON number integer".to_owned()),
        }
        if self.consume(b'.') {
            if !self.peek().is_some_and(|value| value.is_ascii_digit()) {
                return Err("JSON fraction has no digits".to_owned());
            }
            while self.peek().is_some_and(|value| value.is_ascii_digit()) {
                self.cursor += 1;
            }
        }
        if self.peek().is_some_and(|value| matches!(value, b'e' | b'E')) {
            self.cursor += 1;
            if self.peek().is_some_and(|value| matches!(value, b'+' | b'-')) {
                self.cursor += 1;
            }
            if !self.peek().is_some_and(|value| value.is_ascii_digit()) {
                return Err("JSON exponent has no digits".to_owned());
            }
            while self.peek().is_some_and(|value| value.is_ascii_digit()) {
                self.cursor += 1;
            }
        }
        let raw = std::str::from_utf8(&self.source[start..self.cursor])
            .map_err(|_| "invalid UTF-8 in JSON number".to_owned())?
            .to_owned();
        raw.parse::<f64>()
            .ok()
            .filter(|value| value.is_finite())
            .ok_or_else(|| "JSON number is not finite".to_owned())?;
        Ok(raw)
    }

    fn literal(&mut self, expected: &[u8]) -> Result<(), String> {
        if self.source.get(self.cursor..self.cursor + expected.len()) == Some(expected) {
            self.cursor += expected.len();
            Ok(())
        } else {
            Err(format!("invalid literal at {}", self.cursor))
        }
    }

    fn expect(&mut self, expected: u8) -> Result<(), String> {
        if self.consume(expected) {
            Ok(())
        } else {
            Err(format!("expected byte {expected} at {}", self.cursor))
        }
    }

    fn consume(&mut self, expected: u8) -> bool {
        if self.peek() == Some(expected) {
            self.cursor += 1;
            true
        } else {
            false
        }
    }

    fn next(&mut self) -> Option<u8> {
        let value = self.peek()?;
        self.cursor += 1;
        Some(value)
    }

    fn peek(&self) -> Option<u8> {
        self.source.get(self.cursor).copied()
    }
}

/// Validate Blockwild canonical JSON V1 without normalizing or replacing the
/// caller's bytes. The format is compact UTF-8 JSON with lexicographically
/// ordered object keys, minimally escaped strings, and finite numbers in their
/// shortest round-trippable representation.
pub(crate) fn validate_canonical_json_bytes_v1(source: &[u8]) -> Result<(), String> {
    let value = JsonParser::parse(source)?;
    let mut canonical = Vec::with_capacity(source.len());
    write_canonical_json_v1(&value, &mut canonical);
    if canonical != source {
        return Err("JSON bytes are valid but not Blockwild canonical JSON V1".to_owned());
    }
    Ok(())
}

fn write_canonical_json_v1(value: &CanonicalJson, output: &mut Vec<u8>) {
    match value {
        CanonicalJson::Null => output.extend_from_slice(b"null"),
        CanonicalJson::Bool(true) => output.extend_from_slice(b"true"),
        CanonicalJson::Bool(false) => output.extend_from_slice(b"false"),
        CanonicalJson::Number(number) => {
            let parsed = number
                .parse::<f64>()
                .expect("the content JSON parser already validated this finite number");
            if parsed == 0.0 {
                output.push(b'0');
            } else {
                output.extend_from_slice(parsed.to_string().as_bytes());
            }
        }
        CanonicalJson::String(string) => write_canonical_json_string_v1(string, output),
        CanonicalJson::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                write_canonical_json_v1(value, output);
            }
            output.push(b']');
        }
        CanonicalJson::Object(fields) => {
            output.push(b'{');
            for (index, (key, value)) in fields.iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                write_canonical_json_string_v1(key, output);
                output.push(b':');
                write_canonical_json_v1(value, output);
            }
            output.push(b'}');
        }
    }
}

fn write_canonical_json_string_v1(value: &str, output: &mut Vec<u8>) {
    output.push(b'"');
    for character in value.chars() {
        match character {
            '"' => output.extend_from_slice(br#"\""#),
            '\\' => output.extend_from_slice(br"\\"),
            '\u{0008}' => output.extend_from_slice(br"\b"),
            '\u{000c}' => output.extend_from_slice(br"\f"),
            '\n' => output.extend_from_slice(br"\n"),
            '\r' => output.extend_from_slice(br"\r"),
            '\t' => output.extend_from_slice(br"\t"),
            '\u{0000}'..='\u{001f}' => {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                let code = character as u8;
                output.extend_from_slice(br"\u00");
                output.push(HEX[usize::from(code >> 4)]);
                output.push(HEX[usize::from(code & 0x0f)]);
            }
            _ => {
                let mut bytes = [0_u8; 4];
                output.extend_from_slice(character.encode_utf8(&mut bytes).as_bytes());
            }
        }
    }
    output.push(b'"');
}

pub fn materialize_content_runtime(
    manifest: &ProductionContentManifest,
    store: &MetadataBlobStore,
) -> Result<(ContentRuntimeRegistry, ContentRuntimeInstallReport), Vec<ContentRuntimeBlocker>> {
    let mut blockers = validate_manifest(manifest);
    if !blockers.is_empty() {
        sort_blockers(&mut blockers);
        return Err(blockers);
    }

    let mut decoded = Vec::with_capacity(manifest.entries.len());
    let mut aliases = BTreeMap::<String, (ContentDomain, String)>::new();
    let mut executable_bytes = 0_u64;
    let mut opaque_extension_bytes = 0_u64;
    for entry in &manifest.entries {
        let Some(blob) = store.get(entry.blob_hash) else {
            blockers.push(runtime_blocker(
                ContentRuntimeBlockerCode::MissingBlob,
                ContentRuntimeStage::BlobResolution,
                Some(entry.domain),
                Some(entry.id.clone()),
                "$.blobHash",
                Some(entry.blob_hash.to_hex()),
                None,
            ));
            continue;
        };
        validate_blob_descriptor(entry, blob, &mut blockers);
        let Some(schema) = resolve_schema(entry, blob, &mut blockers) else {
            continue;
        };
        let document = match JsonParser::parse(&blob.bytes) {
            Ok(document) => document,
            Err(error) => {
                blockers.push(runtime_blocker(
                    ContentRuntimeBlockerCode::InvalidJson,
                    ContentRuntimeStage::SchemaDecode,
                    Some(entry.domain),
                    Some(entry.id.clone()),
                    "$.canonicalBytes",
                    Some("bounded canonical JSON".to_owned()),
                    Some(error),
                ));
                continue;
            }
        };
        for alias in &blob.aliases {
            let key = (entry.domain, entry.id.clone());
            if let Some(previous) = aliases.insert(alias.clone(), key.clone())
                && previous != key
            {
                blockers.push(runtime_blocker(
                    ContentRuntimeBlockerCode::DuplicateAlias,
                    ContentRuntimeStage::BlobResolution,
                    Some(entry.domain),
                    Some(entry.id.clone()),
                    "$.aliases",
                    Some(format!("{}:{}", previous.0.as_id(), previous.1)),
                    Some(alias.clone()),
                ));
            }
        }
        let canonical_alias = format!("{}:{}", entry.domain.as_id(), entry.id);
        if !blob.aliases.iter().any(|alias| alias == &canonical_alias) {
            blockers.push(runtime_blocker(
                ContentRuntimeBlockerCode::DescriptorMismatch,
                ContentRuntimeStage::BlobResolution,
                Some(entry.domain),
                Some(entry.id.clone()),
                "$.aliases",
                Some(canonical_alias),
                Some(blob.aliases.join(",")),
            ));
        }
        executable_bytes += u64::try_from(blob.bytes.len()).expect("metadata size fits u64");
        opaque_extension_bytes +=
            u64::try_from(blob.unknown_extension_bytes.len()).expect("metadata extension size fits u64");
        decoded.push(DecodedRecord {
            domain: entry.domain,
            id: entry.id.clone(),
            schema,
            content_version: blob.content_version,
            blob_hash: blob.hash,
            aliases: blob.aliases.clone(),
            document,
            unknown_extension_bytes: blob.unknown_extension_bytes.clone(),
        });
    }
    if !blockers.is_empty() {
        sort_blockers(&mut blockers);
        return Err(blockers);
    }

    let all_ids = decoded
        .iter()
        .map(|record| (record.domain, record.id.clone()))
        .collect::<BTreeSet<_>>();
    let mut registry = ContentRuntimeRegistry {
        manifest_hash: manifest.manifest_hash,
        registry_hash: CanonicalHash([0; 16]),
        source_revision: manifest.source_revision.clone(),
        aliases,
        ..ContentRuntimeRegistry::default()
    };
    let mut reference_count = 0_usize;
    for record in decoded {
        let before = blockers.len();
        let mut facts = validate_record(&record, &mut blockers);
        if blockers.len() != before {
            continue;
        }
        resolve_reference_choices(&record, &mut facts, &all_ids, &mut blockers);
        reference_count = reference_count.saturating_add(facts.references.len());
        if reference_count > MAX_CONTENT_REFERENCES {
            blockers.push(runtime_blocker(
                ContentRuntimeBlockerCode::Capacity,
                ContentRuntimeStage::References,
                Some(record.domain),
                Some(record.id.clone()),
                "$.references",
                Some(MAX_CONTENT_REFERENCES.to_string()),
                Some(reference_count.to_string()),
            ));
            continue;
        }
        for reference in &facts.references {
            if !all_ids.contains(&(reference.domain, reference.id.clone())) {
                blockers.push(runtime_blocker(
                    ContentRuntimeBlockerCode::MissingDependency,
                    ContentRuntimeStage::References,
                    Some(record.domain),
                    Some(record.id.clone()),
                    &reference.path,
                    Some(format!("{}:{}", reference.domain.as_id(), reference.id)),
                    None,
                ));
            }
        }
        if blockers.len() != before {
            continue;
        }
        insert_record(&mut registry, record, facts);
    }
    validate_action_links(&registry, &mut blockers);
    if !blockers.is_empty() {
        sort_blockers(&mut blockers);
        return Err(blockers);
    }
    if registry.len() != manifest.entries.len() {
        blockers.push(runtime_blocker(
            ContentRuntimeBlockerCode::Manifest,
            ContentRuntimeStage::Materialization,
            None,
            None,
            "$.entries",
            Some(manifest.entries.len().to_string()),
            Some(registry.len().to_string()),
        ));
        return Err(blockers);
    }
    registry.registry_hash = canonical_registry_hash(&registry);
    let domain_counts = ALL_CONTENT_DOMAINS
        .into_iter()
        .map(|domain| {
            (
                domain,
                u32::try_from(manifest.entries.iter().filter(|entry| entry.domain == domain).count())
                    .expect("content bound fits u32"),
            )
        })
        .collect();
    let report = ContentRuntimeInstallReport {
        schema_version: CONTENT_RUNTIME_SCHEMA_VERSION,
        manifest_hash: registry.manifest_hash,
        registry_hash: registry.registry_hash,
        installed_entries: u32::try_from(registry.len()).expect("content bound fits u32"),
        executable_bytes,
        opaque_extension_bytes,
        references: u32::try_from(reference_count).expect("reference bound fits u32"),
        domain_counts,
        completed_stages: CONTENT_RUNTIME_STAGES.to_vec(),
    };
    Ok((registry, report))
}

fn validate_action_links(registry: &ContentRuntimeRegistry, blockers: &mut Vec<ContentRuntimeBlocker>) {
    let Some(catalog) = registry.block_action_catalogs.get(BLOCK_ACTION_CATALOG_ID) else {
        // Legacy manifests remain valid until the production catalog is installed.
        return;
    };
    let contextual_v2 = catalog.core.schema == ContentSchema::BlockActionCatalogV2;
    for item in registry.items.values() {
        for (path, block_id) in [
            ("$.placeBlock", item.action.place_block),
            ("$.plantBlock", item.action.plant_block),
        ] {
            let Some(block_id) = block_id else {
                continue;
            };
            if !catalog.profiles.contains_key(&block_id) {
                blockers.push(runtime_blocker(
                    ContentRuntimeBlockerCode::MissingDependency,
                    ContentRuntimeStage::References,
                    Some(ContentDomain::Item),
                    Some(item.core.id.clone()),
                    path,
                    Some(format!("block-action:{block_id}")),
                    None,
                ));
            }
        }
        if contextual_v2
            && let Some(block_id) = item.action.place_block
            && let Some(profile) = catalog.profiles.get(&block_id)
            && !profile.placement_items.contains(&item.item_code)
        {
            blockers.push(runtime_blocker(
                ContentRuntimeBlockerCode::DescriptorMismatch,
                ContentRuntimeStage::References,
                Some(ContentDomain::Item),
                Some(item.core.id.clone()),
                "$.placeBlock",
                Some(format!("block-action:{block_id} lists item {}", item.item_code)),
                Some("missing reverse placement binding".to_owned()),
            ));
        }
    }
    if !contextual_v2 {
        return;
    }
    for profile in catalog.profiles.values() {
        if let Some(harvest) = &profile.harvest_intent {
            for (field, replacement) in [
                ("replacementWithoutScythe", harvest.replacement_without_scythe),
                ("replacementWithScythe", harvest.replacement_with_scythe),
            ] {
                if catalog.profiles.contains_key(&replacement) {
                    continue;
                }
                blockers.push(runtime_blocker(
                    ContentRuntimeBlockerCode::MissingDependency,
                    ContentRuntimeStage::References,
                    Some(ContentDomain::Item),
                    Some(BLOCK_ACTION_CATALOG_ID.to_owned()),
                    &format!("$.profiles[id={}].harvestIntent.{field}", profile.block_id),
                    Some(format!("block-action:{replacement}")),
                    None,
                ));
            }
        }
        for item_code in &profile.placement_items {
            if registry
                .items
                .get(&item_code.to_string())
                .is_some_and(|item| item.action.place_block != Some(profile.block_id))
            {
                blockers.push(runtime_blocker(
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::References,
                    Some(ContentDomain::Item),
                    Some(BLOCK_ACTION_CATALOG_ID.to_owned()),
                    &format!("$.profiles[id={}].placementItems", profile.block_id),
                    Some(format!("item {item_code} places block {}", profile.block_id)),
                    Some("item placeBlock mismatch".to_owned()),
                ));
            }
        }
        for rule in &profile.planting_rules {
            if !catalog.profiles.contains_key(&rule.result_block) {
                blockers.push(runtime_blocker(
                    ContentRuntimeBlockerCode::MissingDependency,
                    ContentRuntimeStage::References,
                    Some(ContentDomain::Item),
                    Some(BLOCK_ACTION_CATALOG_ID.to_owned()),
                    &format!("$.profiles[id={}].plantingRules.resultBlock", profile.block_id),
                    Some(format!("block-action:{}", rule.result_block)),
                    None,
                ));
            }
            if registry
                .items
                .get(&rule.item_code.to_string())
                .is_some_and(|item| item.action.use_kind != Some(ContentItemUseKind::Plant))
            {
                blockers.push(runtime_blocker(
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::References,
                    Some(ContentDomain::Item),
                    Some(BLOCK_ACTION_CATALOG_ID.to_owned()),
                    &format!("$.profiles[id={}].plantingRules.item", profile.block_id),
                    Some("item with useKind plant".to_owned()),
                    Some(rule.item_code.to_string()),
                ));
            }
        }
    }
}

fn validate_manifest(manifest: &ProductionContentManifest) -> Vec<ContentRuntimeBlocker> {
    let mut blockers = Vec::new();
    if manifest.schema_version != CONTENT_MANIFEST_SCHEMA_VERSION {
        blockers.push(runtime_blocker(
            ContentRuntimeBlockerCode::Manifest,
            ContentRuntimeStage::Manifest,
            None,
            None,
            "$.schemaVersion",
            Some(CONTENT_MANIFEST_SCHEMA_VERSION.to_string()),
            Some(manifest.schema_version.to_string()),
        ));
    }
    if manifest.source_revision.is_empty()
        || manifest.source_revision.len() > 160
        || manifest.source_revision.chars().any(char::is_control)
    {
        blockers.push(runtime_blocker(
            ContentRuntimeBlockerCode::Manifest,
            ContentRuntimeStage::Manifest,
            None,
            None,
            "$.sourceRevision",
            Some("1..160 non-control characters".to_owned()),
            Some(manifest.source_revision.clone()),
        ));
    }
    if manifest.entries.len() > MAX_CONTENT_ENTRIES {
        blockers.push(runtime_blocker(
            ContentRuntimeBlockerCode::Capacity,
            ContentRuntimeStage::Manifest,
            None,
            None,
            "$.entries",
            Some(MAX_CONTENT_ENTRIES.to_string()),
            Some(manifest.entries.len().to_string()),
        ));
    }
    let mut previous: Option<(ContentDomain, &str)> = None;
    let mut grouped = BTreeMap::<ContentDomain, Vec<&ContentManifestEntry>>::new();
    for entry in &manifest.entries {
        if entry.id.is_empty() || entry.id.len() > 160 || entry.id.chars().any(char::is_control) {
            blockers.push(runtime_blocker(
                ContentRuntimeBlockerCode::Manifest,
                ContentRuntimeStage::Manifest,
                Some(entry.domain),
                Some(entry.id.clone()),
                "$.entries[].id",
                Some("1..160 non-control characters".to_owned()),
                Some(entry.id.clone()),
            ));
        }
        let current = (entry.domain, entry.id.as_str());
        if previous.is_some_and(|prior| prior >= current) {
            blockers.push(runtime_blocker(
                ContentRuntimeBlockerCode::Manifest,
                ContentRuntimeStage::Manifest,
                Some(entry.domain),
                Some(entry.id.clone()),
                "$.entries",
                Some("strict domain/id order with unique ids".to_owned()),
                previous.map(|value| format!("{}:{}", value.0.as_id(), value.1)),
            ));
        }
        previous = Some(current);
        grouped.entry(entry.domain).or_default().push(entry);
    }
    let mut canonical_domains = BTreeMap::new();
    for domain in ALL_CONTENT_DOMAINS {
        let entries = grouped.get(&domain).cloned().unwrap_or_default();
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.content-domain.v1");
        hasher.write_str(domain.as_id());
        hasher.write_u64(entries.len() as u64);
        for entry in &entries {
            hasher.write_str(&entry.id);
            hasher.write_bytes(entry.blob_hash.as_bytes());
            hasher.write_u32(entry.byte_length);
        }
        let digest = hasher.finish();
        canonical_domains.insert(
            domain,
            (u32::try_from(entries.len()).expect("content bound fits u32"), digest),
        );
        match manifest.domains.get(&domain) {
            Some(declared) if declared.count == entries.len() as u32 && declared.hash == digest => {}
            Some(declared) => blockers.push(runtime_blocker(
                ContentRuntimeBlockerCode::Manifest,
                ContentRuntimeStage::Manifest,
                Some(domain),
                None,
                "$.domains",
                Some(format!("{}:{}", entries.len(), digest.to_hex())),
                Some(format!("{}:{}", declared.count, declared.hash.to_hex())),
            )),
            None => blockers.push(runtime_blocker(
                ContentRuntimeBlockerCode::Manifest,
                ContentRuntimeStage::Manifest,
                Some(domain),
                None,
                "$.domains",
                Some("domain digest".to_owned()),
                None,
            )),
        }
    }
    let mut hasher = CanonicalHasher::new("blockwild.gameplay.content-manifest.v1");
    hasher.write_u16(CONTENT_MANIFEST_SCHEMA_VERSION);
    hasher.write_str(&manifest.source_revision);
    hasher.write_u64(canonical_domains.len() as u64);
    for (domain, (count, hash)) in canonical_domains {
        hasher.write_str(domain.as_id());
        hasher.write_u32(count);
        hasher.write_bytes(hash.as_bytes());
    }
    let actual = hasher.finish();
    if actual != manifest.manifest_hash {
        blockers.push(runtime_blocker(
            ContentRuntimeBlockerCode::Manifest,
            ContentRuntimeStage::Manifest,
            None,
            None,
            "$.manifestHash",
            Some(actual.to_hex()),
            Some(manifest.manifest_hash.to_hex()),
        ));
    }
    blockers
}

fn validate_blob_descriptor(
    entry: &ContentManifestEntry,
    blob: &MetadataBlob,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    let expected_type = format!("blockwild.content.{}", entry.domain.as_id());
    let expected_length = usize::try_from(entry.byte_length).expect("u32 fits usize");
    let actual_length = blob.bytes.len() + blob.unknown_extension_bytes.len();
    if blob.hash != entry.blob_hash || blob.type_id != expected_type || expected_length != actual_length {
        blockers.push(runtime_blocker(
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::BlobResolution,
            Some(entry.domain),
            Some(entry.id.clone()),
            "$.blob",
            Some(format!(
                "{}:{}:{}",
                entry.blob_hash.to_hex(),
                expected_type,
                expected_length
            )),
            Some(format!("{}:{}:{}", blob.hash.to_hex(), blob.type_id, actual_length)),
        ));
    }
}

fn resolve_schema(
    entry: &ContentManifestEntry,
    blob: &MetadataBlob,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentSchema> {
    let schema = match (entry.domain, blob.schema_id.as_str(), blob.schema_version) {
        (ContentDomain::Item, "item-definition", 1) => ContentSchema::ItemDefinition,
        (ContentDomain::Item, "block-action-catalog", 1) => ContentSchema::BlockActionCatalog,
        (ContentDomain::Item, "block-action-catalog", 2) => ContentSchema::BlockActionCatalogV2,
        (ContentDomain::CraftingRecipe, "crafting-recipe", 1) => ContentSchema::CraftingRecipe,
        (ContentDomain::CraftingRecipe, "blueprint-definition", 1) => ContentSchema::BlueprintDefinition,
        (ContentDomain::MachineRecipe, "alchemy-recipe", 1) => ContentSchema::AlchemyRecipe,
        (ContentDomain::MachineRecipe, "distillery-recipe", 1) => ContentSchema::DistilleryRecipe,
        (ContentDomain::MachineRecipe, "sugarworks-recipe", 1) => ContentSchema::SugarworksRecipe,
        (ContentDomain::MachineRecipe, "furnace-recipe", 1) => ContentSchema::FurnaceRecipe,
        (ContentDomain::MachineRecipe, "orb-morph-recipe", 2) => ContentSchema::OrbMorphRecipe,
        (ContentDomain::MachineRecipe, "golem-forge-recipe", 1) => ContentSchema::GolemForgeRecipe,
        (ContentDomain::MachineRecipe, "wheat-mill-process", 1) => ContentSchema::WheatMillProcess,
        (ContentDomain::MachineProfile, "machine-profile", 1) => ContentSchema::MachineProfileV1,
        (ContentDomain::MachineProfile, "machine-profile", 2) => ContentSchema::MachineProfileV2,
        (ContentDomain::MachineProfile, "render-presentation-catalog", 1) => ContentSchema::RenderPresentationCatalog,
        (ContentDomain::AbilitySpell, "spell-definition", 1) => ContentSchema::SpellDefinition,
        (ContentDomain::AbilitySpell, "creature-move", 1) => ContentSchema::CreatureMove,
        (ContentDomain::AbilitySpell, "creature-status", 1) => ContentSchema::CreatureStatus,
        (ContentDomain::AbilitySpell, "creature-reaction", 1) => ContentSchema::CreatureReaction,
        (ContentDomain::CreatureProfile, "creature-profile", 1) => ContentSchema::CreatureProfile,
        (ContentDomain::CreatureProfile, "player-render-profile", 1) => ContentSchema::PlayerRenderProfile,
        (ContentDomain::CreatureTypeChart, "creature-type", 1) => ContentSchema::CreatureType,
        (ContentDomain::CreatureTypeChart, "creature-type-chart", 1) => ContentSchema::CreatureTypeChart,
        (ContentDomain::QuestGuild, "quest-definition", 1) => ContentSchema::QuestDefinition,
        (ContentDomain::QuestGuild, "questline-definition", 1) => ContentSchema::QuestlineDefinition,
        (ContentDomain::QuestGuild, "guild-definition", 1) => ContentSchema::GuildDefinition,
        (ContentDomain::QuestGuild, "guild-quest", 1) => ContentSchema::GuildQuest,
        (ContentDomain::QuestGuild, "guild-npc", 1) => ContentSchema::GuildNpc,
        (ContentDomain::QuestGuild, "faction-definition", 1) => ContentSchema::FactionDefinition,
        (ContentDomain::Economy, "commerce-item", 1) => ContentSchema::CommerceItem,
        (ContentDomain::Economy, "merchant-offer", 1) => ContentSchema::MerchantOffer,
        (ContentDomain::Economy, "stock-definition", 1) => ContentSchema::StockDefinition,
        (ContentDomain::CardforgeCard, "tcg-card-definition", 1) => ContentSchema::TcgCardDefinition,
        (ContentDomain::CardforgeCard, "tcg-printing", 1) => ContentSchema::TcgPrinting,
        (ContentDomain::CardforgePack, "tcg-pack", 1) => ContentSchema::TcgPack,
        (ContentDomain::CardforgePack, "tcg-set", 1) => ContentSchema::TcgSet,
        _ => {
            blockers.push(runtime_blocker(
                ContentRuntimeBlockerCode::UnsupportedSchema,
                ContentRuntimeStage::SchemaDecode,
                Some(entry.domain),
                Some(entry.id.clone()),
                "$.schema",
                Some("known production schema/version for domain".to_owned()),
                Some(format!("{}@{}", blob.schema_id, blob.schema_version)),
            ));
            return None;
        }
    };
    Some(schema)
}

fn validate_record(record: &DecodedRecord, blockers: &mut Vec<ContentRuntimeBlocker>) -> RecordFacts {
    let Some(object) = record.document.as_object() else {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::InvalidType,
            ContentRuntimeStage::SchemaDecode,
            "$",
            "object",
            json_kind(&record.document),
        ));
        return RecordFacts::default();
    };
    let mut facts = RecordFacts::default();
    match record.schema {
        ContentSchema::ItemDefinition => validate_item(record, object, &mut facts, blockers),
        ContentSchema::BlockActionCatalog | ContentSchema::BlockActionCatalogV2 => {
            validate_block_action_catalog(record, object, &mut facts, blockers);
        }
        ContentSchema::CraftingRecipe => validate_crafting(record, object, &mut facts, blockers),
        ContentSchema::BlueprintDefinition => validate_blueprint(record, object, &mut facts, blockers),
        ContentSchema::AlchemyRecipe | ContentSchema::DistilleryRecipe | ContentSchema::SugarworksRecipe => {
            validate_processing_recipe(record, object, &mut facts, blockers);
        }
        ContentSchema::FurnaceRecipe => validate_furnace(record, object, &mut facts, blockers),
        ContentSchema::OrbMorphRecipe => validate_orb_morph(record, object, &mut facts, blockers),
        ContentSchema::GolemForgeRecipe => validate_golem_recipe(record, object, &mut facts, blockers),
        ContentSchema::WheatMillProcess => validate_mill(record, object, &mut facts, blockers),
        ContentSchema::MachineProfileV1 | ContentSchema::MachineProfileV2 => {
            validate_machine_profile(record, object, &mut facts, blockers);
        }
        ContentSchema::RenderPresentationCatalog => {
            validate_render_presentation_catalog(record, object, &mut facts, blockers);
        }
        ContentSchema::SpellDefinition => validate_spell(record, object, &mut facts, blockers),
        ContentSchema::CreatureMove => validate_creature_move(record, object, &mut facts, blockers),
        ContentSchema::CreatureStatus => validate_creature_status(record, object, &mut facts, blockers),
        ContentSchema::CreatureReaction => validate_creature_reaction(record, object, &mut facts, blockers),
        ContentSchema::CreatureProfile => validate_creature(record, object, &mut facts, blockers),
        ContentSchema::PlayerRenderProfile => validate_player_render_profile(record, object, &mut facts, blockers),
        ContentSchema::CreatureType => validate_creature_type(record, object, blockers),
        ContentSchema::CreatureTypeChart => validate_type_chart(record, object, &mut facts, blockers),
        ContentSchema::QuestDefinition => validate_quest(record, object, &mut facts, blockers),
        ContentSchema::QuestlineDefinition => validate_questline(record, object, &mut facts, blockers),
        ContentSchema::GuildDefinition => validate_guild(record, object, &mut facts, blockers),
        ContentSchema::GuildQuest => validate_guild_quest(record, object, &mut facts, blockers),
        ContentSchema::GuildNpc => validate_guild_npc(record, object, &mut facts, blockers),
        ContentSchema::FactionDefinition => validate_faction(record, object, blockers),
        ContentSchema::CommerceItem => validate_commerce(record, object, blockers),
        ContentSchema::MerchantOffer => validate_merchant_offer(record, object, &mut facts, blockers),
        ContentSchema::StockDefinition => validate_stock(record, object, blockers),
        ContentSchema::TcgCardDefinition => validate_tcg_card(record, object, &mut facts, blockers),
        ContentSchema::TcgPrinting => validate_tcg_printing(record, object, &mut facts, blockers),
        ContentSchema::TcgPack => validate_tcg_pack(record, object, &mut facts, blockers),
        ContentSchema::TcgSet => validate_tcg_set(record, object, blockers),
    }
    normalize_facts(record, &mut facts, blockers);
    facts
}

fn validate_item(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    let item_code = required_u32(record, object, "id", 1, u32::MAX, blockers);
    if item_code.is_some_and(|code| code.to_string() != record.id) {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            "$.id",
            &record.id,
            &item_code.unwrap_or_default().to_string(),
        ));
    }
    required_nonempty_string(record, object, "name", blockers);
    let max_stack = required_u32(record, object, "maxStack", 1, MAX_ITEM_STACK, blockers);
    if let Some(value) = optional_string(record, object, "rarity", blockers) {
        enum_value(
            record,
            "$.rarity",
            value,
            &["common", "uncommon", "rare", "epic", "legendary"],
            blockers,
        );
    }
    if let Some(value) = optional_string(record, object, "equipmentSlot", blockers) {
        enum_value(
            record,
            "$.equipmentSlot",
            value,
            &["head", "chest", "legs", "feet"],
            blockers,
        );
    }
    let tool_kind = optional_string(record, object, "toolKind", blockers)
        .and_then(|value| parse_item_tool_kind(record, "$.toolKind", value, blockers));
    let ammo_item = optional_u32(record, object, "ammoItem", 1, u32::MAX, blockers);
    if let Some(ammo) = ammo_item {
        push_reference(facts, ContentDomain::Item, ammo.to_string(), "$.ammoItem");
    }
    facts.item_code = item_code;
    facts.max_stack = max_stack;
    let item_action = ContentItemActionProfile {
        tool_kind,
        tier: optional_u32(record, object, "tier", 0, u16::MAX.into(), blockers)
            .and_then(|value| u16::try_from(value).ok()),
        mining_speed_millionths: optional_millionths(
            record,
            object,
            "miningSpeed",
            0,
            u64::from(u32::MAX) * CONTENT_ACTION_FIXED_SCALE,
            blockers,
        ),
        max_durability: optional_u32(record, object, "maxDurability", 1, u32::MAX, blockers),
        infinite_durability: optional_bool(record, object, "infiniteDurability", blockers),
        food: optional_u32(record, object, "food", 0, u32::MAX, blockers),
        damage: optional_u32(record, object, "damage", 0, u32::MAX, blockers),
        fuel: optional_u32(record, object, "fuel", 0, u32::MAX, blockers),
        use_kind: optional_string(record, object, "useKind", blockers)
            .and_then(|value| parse_item_use_kind(record, "$.useKind", value, blockers)),
        place_block: optional_u32(record, object, "placeBlock", 0, u16::MAX.into(), blockers)
            .and_then(|value| u16::try_from(value).ok()),
        plant_block: optional_u32(record, object, "plantBlock", 0, u16::MAX.into(), blockers)
            .and_then(|value| u16::try_from(value).ok()),
        bucket_liquid: optional_string(record, object, "bucketLiquid", blockers)
            .and_then(|value| parse_liquid_kind(record, "$.bucketLiquid", value, blockers)),
        ammo_item,
        magazine_size: optional_u32(record, object, "magazineSize", 1, u32::MAX, blockers),
        blueprint_id: optional_string(record, object, "blueprintId", blockers).map(str::to_owned),
        potion_id: optional_string(record, object, "potionId", blockers).map(str::to_owned),
        creature_kind: optional_string(record, object, "creatureKind", blockers).map(str::to_owned),
        spell_id: optional_string(record, object, "spellId", blockers).map(str::to_owned),
        mana_increase: optional_u32(record, object, "manaIncrease", 0, u32::MAX, blockers),
    };
    if item_action.tool_kind.is_none() && (item_action.tier.is_some() || item_action.mining_speed_millionths.is_some())
    {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            "$.toolKind",
            "toolKind when tier or miningSpeed is present",
            "missing",
        ));
    }
    if item_action.bucket_liquid.is_some() && item_action.use_kind != Some(ContentItemUseKind::Bucket) {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            "$.useKind",
            "bucket when bucketLiquid is present",
            "missing or non-bucket",
        ));
    }
    if item_action.magazine_size.is_some() != item_action.ammo_item.is_some() {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            "$.ammoItem",
            "ammoItem and magazineSize together",
            "only one field present",
        ));
    }
    facts.item_action = Some(item_action);
}

fn validate_block_action_catalog(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    let is_v2 = record.schema == ContentSchema::BlockActionCatalogV2;
    if record.id != BLOCK_ACTION_CATALOG_ID {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            "$.id",
            BLOCK_ACTION_CATALOG_ID,
            &record.id,
        ));
    }
    let expected_schema = if is_v2 { 2 } else { 1 };
    required_u32(record, object, "schema", expected_schema, expected_schema, blockers);
    if is_v2 {
        facts.block_action_rng_semantics = parse_block_action_rng_semantics(record, object, blockers);
        facts.block_action_authority_blockers =
            parse_block_authority_blockers(record, object, "$", "authorityBlockers", true, blockers);
    }
    let Some(profiles) = required_array(record, object, "profiles", blockers) else {
        return;
    };
    if profiles.is_empty() || profiles.len() > MAX_BLOCK_ACTION_PROFILES {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::Capacity,
            ContentRuntimeStage::Invariants,
            "$.profiles",
            &format!("1..{MAX_BLOCK_ACTION_PROFILES}"),
            &profiles.len().to_string(),
        ));
    }

    let mut previous_id = None;
    for (index, profile) in profiles.iter().take(MAX_BLOCK_ACTION_PROFILES).enumerate() {
        let base = format!("$.profiles[{index}]");
        let Some(profile) = profile.as_object() else {
            invalid_type(record, &base, "object", profile, blockers);
            continue;
        };
        let block_id = required_u32_at(record, profile, "id", &base, 0, u16::MAX.into(), blockers)
            .and_then(|value| u16::try_from(value).ok());
        if let Some(block_id) = block_id {
            if previous_id.is_some_and(|previous| previous >= block_id) {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::Invariants,
                    &field_path(&base, "id"),
                    "strict ascending unique block ids",
                    &block_id.to_string(),
                ));
            }
            previous_id = Some(block_id);
        }
        let hardness_millionths = required_millionths_at(
            record,
            profile,
            "hardness",
            &base,
            0,
            u64::from(u32::MAX) * CONTENT_ACTION_FIXED_SCALE,
            blockers,
        );
        let solid = required_bool_at(record, profile, "solid", &base, blockers);
        let replaceable = required_bool_at(record, profile, "replaceable", &base, blockers);
        let preferred_tool = required_nonempty_string_at(record, profile, "preferredTool", &base, blockers)
            .and_then(|value| parse_block_tool_kind(record, &field_path(&base, "preferredTool"), value, blockers));
        let required_tier = required_u32_at(record, profile, "requiredTier", &base, 0, u16::MAX.into(), blockers)
            .and_then(|value| u16::try_from(value).ok());
        let mapped_item_code = optional_u32_at(record, profile, "item", &base, 1, u32::MAX, blockers);
        if let Some(item_code) = mapped_item_code {
            push_reference(
                facts,
                ContentDomain::Item,
                item_code.to_string(),
                &field_path(&base, "item"),
            );
        }
        let liquid = optional_string_at(record, profile, "liquid", &base, blockers)
            .and_then(|value| parse_liquid_kind(record, &field_path(&base, "liquid"), value, blockers));
        let shape = optional_string_at(record, profile, "shape", &base, blockers).map(|value| {
            enum_value(
                record,
                &field_path(&base, "shape"),
                value,
                BLOCK_ACTION_SHAPES,
                blockers,
            );
            value.to_owned()
        });
        let collision_height_millionths = optional_millionths_at(
            record,
            profile,
            "collisionHeight",
            &base,
            0,
            u64::from(u16::MAX) * CONTENT_ACTION_FIXED_SCALE,
            blockers,
        );
        let vertical_connect_group =
            optional_string_at(record, profile, "verticalConnectGroup", &base, blockers).map(|value| {
                enum_value(
                    record,
                    &field_path(&base, "verticalConnectGroup"),
                    value,
                    BLOCK_ACTION_VERTICAL_CONNECT_GROUPS,
                    blockers,
                );
                value.to_owned()
            });
        let connect_group = optional_string_at(record, profile, "connectGroup", &base, blockers).map(|value| {
            enum_value(record, &field_path(&base, "connectGroup"), value, &["fence"], blockers);
            value.to_owned()
        });
        let topology_flags = parse_topology_flags(record, profile, &base, blockers);
        validate_topology_consistency(
            record,
            &base,
            topology_flags,
            vertical_connect_group.as_deref(),
            connect_group.as_deref(),
            blockers,
        );
        let (
            break_profile,
            harvest_intent,
            placement_intent,
            placement_items,
            interaction_intents,
            planting_rules,
            authority_blockers,
        ) = if is_v2 {
            (
                parse_block_break_profile(record, profile, &base, facts, blockers),
                parse_block_harvest_intent(record, profile, &base, blockers),
                parse_block_placement_intent(record, profile, &base, blockers),
                parse_block_placement_items(record, profile, &base, facts, blockers),
                parse_block_interaction_intents(record, profile, &base, blockers),
                parse_block_planting_rules(record, profile, &base, facts, blockers),
                parse_block_authority_blockers(record, profile, &base, "authorityBlockers", false, blockers),
            )
        } else {
            (None, None, None, Vec::new(), Vec::new(), Vec::new(), Vec::new())
        };
        if is_v2 {
            if placement_intent.is_some_and(|intent| intent == ContentBlockPlacementIntent::None)
                != placement_items.is_empty()
            {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::Invariants,
                    &field_path(&base, "placementItems"),
                    "empty exactly when placementIntent is none",
                    &placement_items.len().to_string(),
                ));
            }
            let declares_harvest = interaction_intents.contains(&ContentBlockInteractionIntent::Harvest);
            if declares_harvest != harvest_intent.is_some() {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::Invariants,
                    &field_path(&base, "harvestIntent"),
                    "present exactly when interactionIntents contains harvest",
                    if harvest_intent.is_some() { "present" } else { "missing" },
                ));
            }
            let declares_planting = interaction_intents.contains(&ContentBlockInteractionIntent::Plant);
            if declares_planting == planting_rules.is_empty() {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::Invariants,
                    &field_path(&base, "plantingRules"),
                    "non-empty exactly when interactionIntents contains plant",
                    &planting_rules.len().to_string(),
                ));
            }
            if let Some(action) = &break_profile {
                if harvest_intent.is_some()
                    && action
                        .loot
                        .rules
                        .iter()
                        .any(|rule| rule.roll_scope != ContentBlockLootRollScope::SharedPlantYield)
                {
                    blockers.push(for_record(
                        record,
                        ContentRuntimeBlockerCode::DescriptorMismatch,
                        ContentRuntimeStage::Invariants,
                        &field_path(&base, "breakProfile"),
                        "harvest loot rules share the single legacy plant-yield draw",
                        "non-shared harvest roll",
                    ));
                }
                if action.loot.self_drop_mode == ContentBlockSelfDropMode::MappedItem {
                    let exact_mapped = mapped_item_code.is_some_and(|mapped| {
                        action.loot.rules.len() == 1
                            && action.loot.rules[0].item_code == mapped
                            && action.loot.rules[0].chance_millionths == CONTENT_ACTION_FIXED_SCALE
                            && action.loot.rules[0].roll_scope == ContentBlockLootRollScope::None
                            && action.loot.rules[0].count == ContentBlockLootCount::Constant(1)
                    });
                    if !exact_mapped {
                        blockers.push(for_record(
                            record,
                            ContentRuntimeBlockerCode::DescriptorMismatch,
                            ContentRuntimeStage::Invariants,
                            &field_path(&base, "breakProfile"),
                            "mapped-item loot exactly matches the canonical mapped item",
                            "mismatch",
                        ));
                    }
                }
            }
        }

        if let (
            Some(block_id),
            Some(hardness_millionths),
            Some(solid),
            Some(replaceable),
            Some(preferred_tool),
            Some(required_tier),
        ) = (
            block_id,
            hardness_millionths,
            solid,
            replaceable,
            preferred_tool,
            required_tier,
        ) {
            let profile = ContentBlockActionProfile {
                block_id,
                hardness_millionths,
                solid,
                replaceable,
                liquid,
                preferred_tool,
                required_tier,
                mapped_item_code,
                shape,
                collision_height_millionths,
                vertical_connect_group,
                connect_group,
                topology_flags,
                break_profile,
                harvest_intent,
                placement_intent,
                placement_items,
                interaction_intents,
                planting_rules,
                authority_blockers,
            };
            if facts.block_actions.insert(block_id, profile).is_some() {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::Invariants,
                    &field_path(&base, "id"),
                    "unique block id",
                    &block_id.to_string(),
                ));
            }
        }
    }
}

fn validate_crafting(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, &record.id, blockers);
    required_nonempty_string(record, object, "name", blockers);
    let width = required_u32(record, object, "width", 1, 9, blockers);
    let height = required_u32(record, object, "height", 1, 9, blockers);
    let pattern = required_array(record, object, "pattern", blockers);
    if let (Some(width), Some(height), Some(pattern)) = (width, height, pattern) {
        let expected = usize::try_from(width * height).expect("small dimensions fit usize");
        if pattern.len() != expected {
            blockers.push(for_record(
                record,
                ContentRuntimeBlockerCode::ResourceConservation,
                ContentRuntimeStage::Invariants,
                "$.pattern",
                &expected.to_string(),
                &pattern.len().to_string(),
            ));
        }
        let mut counts = BTreeMap::<ContentResourceKey, u32>::new();
        for (index, value) in pattern.iter().enumerate() {
            if let Some(item) = json_u32(value, 0, u32::MAX) {
                if item != 0 {
                    *counts.entry(ContentResourceKey::ItemCode(item)).or_default() += 1;
                    push_reference(facts, ContentDomain::Item, item.to_string(), "$.pattern");
                }
                continue;
            }
            if let Some(alternatives) = value.as_array() {
                let mut choices = alternatives
                    .iter()
                    .filter_map(|choice| json_u32(choice, 1, u32::MAX))
                    .collect::<Vec<_>>();
                choices.sort_unstable();
                choices.dedup();
                if !choices.is_empty() && choices.len() == alternatives.len() {
                    for item in &choices {
                        push_reference(facts, ContentDomain::Item, item.to_string(), "$.pattern");
                    }
                    *counts.entry(ContentResourceKey::ItemChoice(choices)).or_default() += 1;
                    continue;
                }
            }
            invalid_type(
                record,
                &format!("$.pattern[{index}]"),
                "non-negative item code or non-empty item-choice array",
                value,
                blockers,
            );
        }
        for (resource, amount) in counts {
            facts.resources.inputs.push(ContentResourceAmount {
                resource,
                amount,
                consumed: true,
            });
        }
    }
    if let Some((item, count)) = item_stack(record, object.get("output"), "$.output", blockers) {
        push_item_resource(&mut facts.resources.outputs, item, count, false);
        push_reference(facts, ContentDomain::Item, item.to_string(), "$.output.item");
    }
    require_flow(record, &facts.resources, blockers);
}

fn validate_blueprint(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "blueprint:"), blockers);
    required_nonempty_string(record, object, "name", blockers);
    for recipe in required_string_array(record, object, "recipeIds", blockers) {
        push_reference_choice(
            facts,
            [
                (ContentDomain::CraftingRecipe, recipe.clone()),
                (ContentDomain::MachineRecipe, recipe.clone()),
                (ContentDomain::MachineRecipe, format!("alchemy:{recipe}")),
                (ContentDomain::MachineRecipe, format!("distillery:{recipe}")),
                (ContentDomain::MachineRecipe, format!("sugarworks:{recipe}")),
                (ContentDomain::MachineRecipe, format!("orb-morph:{recipe}")),
                (ContentDomain::MachineRecipe, format!("golem-forge:{recipe}")),
            ],
            "$.recipeIds",
        );
    }
    optional_u32(record, object, "resaleGold", 0, MAX_ITEM_STACK, blockers);
}

fn validate_processing_recipe(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    let prefix = match record.schema {
        ContentSchema::AlchemyRecipe => "alchemy:",
        ContentSchema::DistilleryRecipe => "distillery:",
        ContentSchema::SugarworksRecipe => "sugarworks:",
        _ => "",
    };
    validate_embedded_id(record, object, strip_prefix(&record.id, prefix), blockers);
    required_nonempty_string(record, object, "name", blockers);
    let Some(inputs) = required_array(record, object, "inputs", blockers) else {
        return;
    };
    for (index, input) in inputs.iter().enumerate() {
        let path = format!("$.inputs[{index}]");
        if let Some(resource) = symbolic_resource(record, input, &path, true, blockers) {
            facts.resources.inputs.push(resource);
        }
    }
    if let Some(resource) = symbolic_resource(
        record,
        object.get("output").unwrap_or(&CanonicalJson::Null),
        "$.output",
        false,
        blockers,
    ) {
        facts.resources.outputs.push(resource);
    }
    let time_field = match record.schema {
        ContentSchema::AlchemyRecipe => "brewSeconds",
        ContentSchema::DistilleryRecipe => "fermentSeconds",
        ContentSchema::SugarworksRecipe => "batchSeconds",
        _ => "seconds",
    };
    required_number(record, object, time_field, 0.000_001, 86_400.0, blockers);
    if let Some(blueprint) = optional_string(record, object, "blueprintId", blockers) {
        push_reference(
            facts,
            ContentDomain::CraftingRecipe,
            format!("blueprint:{blueprint}"),
            "$.blueprintId",
        );
    }
    require_flow(record, &facts.resources, blockers);
}

fn validate_furnace(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    let input = required_u32(record, object, "inputItem", 1, u32::MAX, blockers);
    if let Some(item) = input {
        push_item_resource(&mut facts.resources.inputs, item, 1, true);
        push_reference(facts, ContentDomain::Item, item.to_string(), "$.inputItem");
    }
    if let Some((item, count)) = item_stack(record, object.get("output"), "$.output", blockers) {
        push_item_resource(&mut facts.resources.outputs, item, count, false);
        push_reference(facts, ContentDomain::Item, item.to_string(), "$.output.item");
    }
    require_flow(record, &facts.resources, blockers);
}

fn validate_orb_morph(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "orb-morph:"), blockers);
    let input_kind = required_nonempty_string(record, object, "inputKind", blockers);
    let output_kind = required_nonempty_string(record, object, "outputKind", blockers);
    if let Some(kind) = input_kind {
        push_reference(facts, ContentDomain::CreatureProfile, kind.to_owned(), "$.inputKind");
    }
    if let Some(kind) = output_kind {
        push_reference(facts, ContentDomain::CreatureProfile, kind.to_owned(), "$.outputKind");
    }
    required_u32(record, object, "complexity", 1, 100, blockers);
    required_number(record, object, "baseDurationSeconds", 0.000_001, 86_400.0, blockers);
    if let Some(costs) = required_array(record, object, "baseCosts", blockers) {
        for (index, cost) in costs.iter().enumerate() {
            let path = format!("$.baseCosts[{index}]");
            if let Some((item, count)) = item_stack(record, Some(cost), &path, blockers) {
                push_item_resource(&mut facts.resources.inputs, item, count, true);
                push_reference(facts, ContentDomain::Item, item.to_string(), &format!("{path}.item"));
            }
        }
    }
    if facts.resources.inputs.is_empty() {
        resource_error(record, "$.baseCosts", "at least one positive cost", "empty", blockers);
    }
}

fn validate_golem_recipe(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    let kind = required_nonempty_string(record, object, "type", blockers);
    if let Some(kind) = kind {
        push_reference_choice(
            facts,
            [
                (ContentDomain::CreatureProfile, kind.to_owned()),
                (ContentDomain::CreatureProfile, format!("{kind}-golem")),
            ],
            "$.type",
        );
    }
    if let Some(blueprint) = required_nonempty_string(record, object, "blueprintId", blockers) {
        push_reference(
            facts,
            ContentDomain::CraftingRecipe,
            format!("blueprint:{blueprint}"),
            "$.blueprintId",
        );
    }
    required_u32(record, object, "manaCost", 0, MAX_ITEM_STACK, blockers);
    required_number(record, object, "seconds", 0.000_001, 86_400.0, blockers);
    if let Some(resources) = required_object(record, object, "resources", blockers) {
        for (key, amount) in resources {
            if !valid_symbol(key) {
                invalid_value(
                    record,
                    &format!("$.resources.{key}"),
                    "bounded symbolic resource id",
                    key,
                    blockers,
                );
                continue;
            }
            let Some(amount) = json_u32(amount, 1, MAX_ITEM_STACK) else {
                invalid_type(
                    record,
                    &format!("$.resources.{key}"),
                    "positive integer",
                    amount,
                    blockers,
                );
                continue;
            };
            facts.resources.inputs.push(ContentResourceAmount {
                resource: ContentResourceKey::Symbolic(key.clone()),
                amount,
                consumed: true,
            });
        }
    }
    if facts.resources.inputs.is_empty() {
        resource_error(record, "$.resources", "at least one positive cost", "empty", blockers);
    }
}

fn validate_mill(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    required_nonempty_string(record, object, "id", blockers);
    if let Some((item, count)) = item_stack(record, object.get("input"), "$.input", blockers) {
        push_item_resource(&mut facts.resources.inputs, item, count, true);
        push_reference(facts, ContentDomain::Item, item.to_string(), "$.input.item");
    }
    if let Some((item, count)) = item_stack(record, object.get("output"), "$.output", blockers) {
        push_item_resource(&mut facts.resources.outputs, item, count, false);
        push_reference(facts, ContentDomain::Item, item.to_string(), "$.output.item");
    }
    required_number(record, object, "batchSeconds", 0.000_001, 86_400.0, blockers);
    require_flow(record, &facts.resources, blockers);
}

fn validate_machine_profile(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    if object.is_empty() {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::MissingField,
            ContentRuntimeStage::Invariants,
            "$",
            "at least one machine parameter",
            "empty object",
        ));
    }
    for field in [
        "outputCap",
        "stackCap",
        "workerCap",
        "nectarCap",
        "honeyCap",
        "jellyCap",
        "slots",
        "gelCap",
        "maxBlocks",
        "resourceCap",
    ] {
        if let Some(value) = optional_u64(record, object, field, 1, u64::MAX, blockers) {
            facts.capacity_fields.insert(field.to_owned(), value);
        }
    }
    for field in [
        "cycleSeconds",
        "honeyCycleSeconds",
        "jellyCycleSeconds",
        "workerGrowthSeconds",
        "healIntervalSeconds",
        "gelSeconds",
        "healSeconds",
        "breedSeconds",
    ] {
        if object.contains_key(field) {
            required_number(record, object, field, 0.000_001, 31_536_000.0, blockers);
        }
    }
    if let Some(ids) = optional_array(record, object, "inputItemIds", blockers) {
        for (index, value) in ids.iter().enumerate() {
            let Some(item) = json_u32(value, 1, u32::MAX) else {
                invalid_type(
                    record,
                    &format!("$.inputItemIds[{index}]"),
                    "positive item code",
                    value,
                    blockers,
                );
                continue;
            };
            push_reference(
                facts,
                ContentDomain::Item,
                item.to_string(),
                &format!("$.inputItemIds[{index}]"),
            );
            if record.id == "furnace" {
                push_reference(
                    facts,
                    ContentDomain::MachineRecipe,
                    format!("furnace:{item}"),
                    &format!("$.inputItemIds[{index}]"),
                );
            }
        }
    }
    if let Some(ids) = optional_string_array(record, object, "recipeIds", blockers) {
        for (index, id) in ids.into_iter().enumerate() {
            let target = match record.id.as_str() {
                "golem-forge" => format!("golem-forge:{id}"),
                "alchemy" => format!("alchemy:{id}"),
                "distillery" => format!("distillery:{id}"),
                _ => id,
            };
            push_reference(
                facts,
                ContentDomain::MachineRecipe,
                target,
                &format!("$.recipeIds[{index}]"),
            );
        }
    }
}

fn validate_spell(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "spell:"), blockers);
    required_nonempty_string(record, object, "name", blockers);
    required_u32(record, object, "manaCost", 0, MAX_ITEM_STACK, blockers);
    let cooldown = required_number(record, object, "cooldownSeconds", 0.0, 86_400.0, blockers);
    facts.cooldown_millis = cooldown.map(seconds_to_millis).unwrap_or_default();
    if let Some(value) = required_nonempty_string(record, object, "school", blockers) {
        enum_value(
            record,
            "$.school",
            value,
            &["alteration", "conjuration", "destruction", "restoration", "utility"],
            blockers,
        );
    }
    if let Some(value) = required_nonempty_string(record, object, "targeting", blockers) {
        enum_value(
            record,
            "$.targeting",
            value,
            &["aimed", "cone", "ground", "self"],
            blockers,
        );
    }
    let effects = required_array(record, object, "effects", blockers);
    if effects.is_some_and(<[CanonicalJson]>::is_empty) {
        resource_error(record, "$.effects", "one or more spell effects", "empty", blockers);
    }
}

fn validate_creature_move(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "move:"), blockers);
    let move_type = required_nonempty_string(record, object, "type", blockers);
    if let Some(kind) = move_type {
        push_reference(
            facts,
            ContentDomain::CreatureTypeChart,
            format!("type:{kind}"),
            "$.type",
        );
    }
    if let Some(value) = required_nonempty_string(record, object, "channel", blockers) {
        enum_value(
            record,
            "$.channel",
            value,
            &[
                "control",
                "field",
                "healing",
                "magical",
                "physical",
                "stance",
                "traversal",
            ],
            blockers,
        );
    }
    if let Some(value) = required_nonempty_string(record, object, "target", blockers) {
        enum_value(
            record,
            "$.target",
            value,
            &["ally", "area", "hostile", "point", "self"],
            blockers,
        );
    }
    if let Some(value) = required_nonempty_string(record, object, "shape", blockers) {
        enum_value(
            record,
            "$.shape",
            value,
            &["arc", "circle", "cone", "contact", "dash", "line"],
            blockers,
        );
    }
    if let Some(value) = required_nonempty_string(record, object, "worldImpact", blockers) {
        enum_value(record, "$.worldImpact", value, &["none", "soft", "visual"], blockers);
    }
    for field in [
        "range",
        "radius",
        "verticalTolerance",
        "windupSeconds",
        "activeSeconds",
        "recoverySeconds",
        "cooldownSeconds",
        "power",
        "exertionCost",
    ] {
        required_number(record, object, field, 0.0, 1_000_000.0, blockers);
    }
    facts.cooldown_millis = object
        .get("cooldownSeconds")
        .and_then(CanonicalJson::as_f64)
        .map(seconds_to_millis)
        .unwrap_or_default();
    if let Some(status) = optional_string(record, object, "appliesStatus", blockers) {
        push_reference(
            facts,
            ContentDomain::AbilitySpell,
            format!("status:{status}"),
            "$.appliesStatus",
        );
    }
    let Some(packets) = required_array(record, object, "packets", blockers) else {
        return;
    };
    if packets.is_empty() {
        resource_error(record, "$.packets", "one or more typed packets", "empty", blockers);
        return;
    }
    let mut share = 0.0;
    for (index, packet) in packets.iter().enumerate() {
        let Some(packet) = packet.as_object() else {
            invalid_type(record, &format!("$.packets[{index}]"), "object", packet, blockers);
            continue;
        };
        let path = format!("$.packets[{index}]");
        if let Some(kind) = required_nonempty_string_at(record, packet, "type", &path, blockers) {
            push_reference(
                facts,
                ContentDomain::CreatureTypeChart,
                format!("type:{kind}"),
                &format!("{path}.type"),
            );
        }
        if let Some(value) = required_number_at(record, packet, "share", &path, 0.000_001, 1.0, blockers) {
            share += value;
        }
    }
    if (share - 1.0).abs() > 0.000_001 {
        resource_error(
            record,
            "$.packets[].share",
            "sum exactly 1",
            &share.to_string(),
            blockers,
        );
    }
}

fn validate_creature_status(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "status:"), blockers);
    required_u32(record, object, "maximumStacks", 1, 1_000_000, blockers);
    required_number(
        record,
        object,
        "maximumDurationSeconds",
        0.000_001,
        31_536_000.0,
        blockers,
    );
    if let Some(modifiers) = optional_object(record, object, "typeStepModifiers", blockers) {
        for (kind, value) in modifiers {
            push_reference(
                facts,
                ContentDomain::CreatureTypeChart,
                format!("type:{kind}"),
                &format!("$.typeStepModifiers.{kind}"),
            );
            let Some(value) = value.as_f64() else {
                invalid_type(
                    record,
                    &format!("$.typeStepModifiers.{kind}"),
                    "integer -8..8",
                    value,
                    blockers,
                );
                continue;
            };
            if value.fract() != 0.0 || !(-8.0..=8.0).contains(&value) {
                invalid_value(
                    record,
                    &format!("$.typeStepModifiers.{kind}"),
                    "integer -8..8",
                    &value.to_string(),
                    blockers,
                );
            }
        }
    }
}

fn validate_creature_reaction(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    required_nonempty_string(record, object, "id", blockers);
    if let Some(status) = required_nonempty_string(record, object, "setupStatus", blockers) {
        push_reference(
            facts,
            ContentDomain::AbilitySpell,
            format!("status:{status}"),
            "$.setupStatus",
        );
    }
    for (index, kind) in required_string_array(record, object, "followupTypes", blockers)
        .into_iter()
        .enumerate()
    {
        push_reference(
            facts,
            ContentDomain::CreatureTypeChart,
            format!("type:{kind}"),
            &format!("$.followupTypes[{index}]"),
        );
    }
    required_number(record, object, "cooldownSeconds", 0.0, 86_400.0, blockers);
}

fn validate_creature(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id_field(record, object, "kind", &record.id, blockers);
    facts.natural_types = required_string_array(record, object, "naturalTypes", blockers);
    if facts.natural_types.is_empty() {
        resource_error(
            record,
            "$.naturalTypes",
            "at least one creature type",
            "empty",
            blockers,
        );
    }
    for (index, kind) in facts.natural_types.clone().into_iter().enumerate() {
        push_reference(
            facts,
            ContentDomain::CreatureTypeChart,
            format!("type:{kind}"),
            &format!("$.naturalTypes[{index}]"),
        );
    }
    if let Some(profile) = required_nonempty_string(record, object, "captureProfile", blockers) {
        enum_value(
            record,
            "$.captureProfile",
            profile,
            &[
                "aquatic",
                "armored",
                "gentle",
                "legendary",
                "open",
                "pursuit",
                "rescue",
                "resonant",
                "territorial",
                "uncapturable",
            ],
            blockers,
        );
    }
    let Some(moves) = required_object(record, object, "moves", blockers) else {
        return;
    };
    for field in ["basicMoveId", "fieldUtilityMoveId", "passiveStanceMoveId"] {
        if let Some(id) = optional_string_at(record, moves, field, "$.moves", blockers) {
            facts.move_ids.push(id.to_owned());
            push_reference(
                facts,
                ContentDomain::AbilitySpell,
                format!("move:{id}"),
                &format!("$.moves.{field}"),
            );
        }
    }
    let maximum_level = object
        .get("stats")
        .and_then(CanonicalJson::as_object)
        .and_then(|stats| stats.get("maximumLevel"))
        .and_then(CanonicalJson::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(1_000_000);
    let Some(unlocks) = moves.get("unlocks").and_then(CanonicalJson::as_array) else {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::MissingField,
            ContentRuntimeStage::Invariants,
            "$.moves.unlocks",
            "array",
            "missing",
        ));
        return;
    };
    let mut seen = BTreeSet::new();
    let mut prior_level = 0;
    for (index, unlock) in unlocks.iter().enumerate() {
        let Some(unlock) = unlock.as_object() else {
            invalid_type(record, &format!("$.moves.unlocks[{index}]"), "object", unlock, blockers);
            continue;
        };
        let path = format!("$.moves.unlocks[{index}]");
        let id = required_nonempty_string_at(record, unlock, "moveId", &path, blockers);
        let level = required_u32_at(record, unlock, "level", &path, 1, maximum_level, blockers);
        if let Some(id) = id {
            if !seen.insert(id.to_owned()) {
                invalid_value(record, &format!("{path}.moveId"), "unique move id", id, blockers);
            }
            facts.move_ids.push(id.to_owned());
            push_reference(
                facts,
                ContentDomain::AbilitySpell,
                format!("move:{id}"),
                &format!("{path}.moveId"),
            );
        }
        if let Some(level) = level {
            if level < prior_level {
                invalid_value(
                    record,
                    &format!("{path}.level"),
                    "non-decreasing unlock level",
                    &level.to_string(),
                    blockers,
                );
            }
            prior_level = level;
        }
    }
}

fn validate_player_render_profile(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    let root_schema = required_u32(record, object, "schema", 1, 1, blockers);
    let role = required_exact_string_at(record, object, "role", "$", "player", blockers);
    if record.id != "player:standing" {
        invalid_value(record, "$.id", "player:standing content id", &record.id, blockers);
    }

    let Some(catalog) = required_object(record, object, "catalog", blockers) else {
        return;
    };
    let catalog_schema = required_u32_at(record, catalog, "schema", "$.catalog", 2, 2, blockers);
    let catalog_format = required_exact_string_at(
        record,
        catalog,
        "format",
        "$.catalog",
        "blockwild-compiled-model-catalog-v2",
        blockers,
    );
    let catalog_revision = required_u32_at(record, catalog, "revision", "$.catalog", 1, u32::MAX, blockers);
    let catalog_sha256 = required_lowercase_hex_at(record, catalog, "sha256", "$.catalog", 64, blockers);
    let catalog_canonical_hash = required_lowercase_hex_at(record, catalog, "canonicalHash", "$.catalog", 32, blockers);
    let catalog_byte_length = required_u32_at(record, catalog, "byteLength", "$.catalog", 1, 64 * 1_048_576, blockers);
    let catalog_model_count = required_u32_at(record, catalog, "modelCount", "$.catalog", 1, 4_096, blockers);
    let catalog_node_count = required_u32_at(record, catalog, "nodeCount", "$.catalog", 1, u32::MAX, blockers);
    let catalog_source = required_nonempty_string_at(record, catalog, "source", "$.catalog", blockers);

    let Some(model) = required_object(record, object, "model", blockers) else {
        return;
    };
    let model_id = required_exact_string_at(record, model, "id", "$.model", "player-standing", blockers);
    let model_label = required_nonempty_string_at(record, model, "label", "$.model", blockers);
    let model_pose = required_exact_string_at(record, model, "pose", "$.model", "standing", blockers);
    let model_category = required_u32_at(record, model, "category", "$.model", 2, 2, blockers);
    let model_ground_y = required_number_at(record, model, "groundY", "$.model", 0.0, 0.0, blockers);
    let model_node_count = required_u32_at(record, model, "nodeCount", "$.model", 1, 16_384, blockers);
    if let (Some(model_nodes), Some(catalog_nodes)) = (model_node_count, catalog_node_count)
        && model_nodes > catalog_nodes
    {
        invalid_value(
            record,
            "$.model.nodeCount",
            "no greater than catalog.nodeCount",
            &model_nodes.to_string(),
            blockers,
        );
    }

    if let (
        Some(_),
        Some(_),
        Some(catalog_schema),
        Some(_),
        Some(catalog_revision),
        Some(catalog_sha256),
        Some(catalog_canonical_hash),
        Some(catalog_byte_length),
        Some(catalog_model_count),
        Some(catalog_node_count),
        Some(catalog_source),
        Some(model_id),
        Some(model_label),
        Some(model_pose),
        Some(model_category),
        Some(model_ground_y),
        Some(model_node_count),
    ) = (
        root_schema,
        role,
        catalog_schema,
        catalog_format,
        catalog_revision,
        catalog_sha256,
        catalog_canonical_hash,
        catalog_byte_length,
        catalog_model_count,
        catalog_node_count,
        catalog_source,
        model_id,
        model_label,
        model_pose,
        model_category,
        model_ground_y,
        model_node_count,
    ) {
        facts.player_render = Some(PlayerRenderFacts {
            catalog_schema: u16::try_from(catalog_schema).expect("catalog schema is bounded"),
            catalog_revision,
            catalog_sha256: catalog_sha256.to_owned(),
            catalog_canonical_hash: catalog_canonical_hash.to_owned(),
            catalog_byte_length,
            catalog_model_count,
            catalog_node_count,
            catalog_source: catalog_source.to_owned(),
            model_id: model_id.to_owned(),
            model_label: model_label.to_owned(),
            model_pose: model_pose.to_owned(),
            model_category: u8::try_from(model_category).expect("model category is bounded"),
            model_ground_y_bits: model_ground_y.to_bits(),
            model_node_count,
        });
    }
}

fn parse_render_presentation_role(
    record: &DecodedRecord,
    path: &str,
    value: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentRenderPresentationRole> {
    let role = match value {
        "dropped-item" => ContentRenderPresentationRole::DroppedItem,
        "held-item" => ContentRenderPresentationRole::HeldItem,
        "machine" => ContentRenderPresentationRole::Machine,
        "projectile" => ContentRenderPresentationRole::Projectile,
        "summon" => ContentRenderPresentationRole::Summon,
        "vehicle" => ContentRenderPresentationRole::Vehicle,
        "world-prop" => ContentRenderPresentationRole::WorldProp,
        _ => {
            enum_value(
                record,
                path,
                value,
                &[
                    "dropped-item",
                    "held-item",
                    "machine",
                    "projectile",
                    "summon",
                    "vehicle",
                    "world-prop",
                ],
                blockers,
            );
            return None;
        }
    };
    Some(role)
}

fn parse_render_presentation_domain(
    record: &DecodedRecord,
    path: &str,
    value: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentDomain> {
    let domain = match value {
        "ability-spell" => ContentDomain::AbilitySpell,
        "creature-profile" => ContentDomain::CreatureProfile,
        "item" => ContentDomain::Item,
        "machine-profile" => ContentDomain::MachineProfile,
        _ => {
            enum_value(
                record,
                path,
                value,
                &["ability-spell", "creature-profile", "item", "machine-profile"],
                blockers,
            );
            return None;
        }
    };
    Some(domain)
}

fn parse_render_presentation_refs(
    record: &DecodedRecord,
    values: &[CanonicalJson],
    base: &str,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Vec<ContentReference> {
    if values.len() > MAX_RENDER_PRESENTATION_REFS {
        invalid_value(
            record,
            base,
            &format!("at most {MAX_RENDER_PRESENTATION_REFS} content refs"),
            &values.len().to_string(),
            blockers,
        );
    }
    let mut output = Vec::new();
    let mut previous = None::<String>;
    for (index, value) in values.iter().take(MAX_RENDER_PRESENTATION_REFS).enumerate() {
        let path = format!("{base}[{index}]");
        let Some(reference) = value.as_object() else {
            invalid_type(record, &path, "content reference object", value, blockers);
            continue;
        };
        let domain_value = required_nonempty_string_at(record, reference, "domain", &path, blockers);
        let id = required_nonempty_string_at(record, reference, "id", &path, blockers);
        let (Some(domain_value), Some(id)) = (domain_value, id) else {
            continue;
        };
        let Some(domain) = parse_render_presentation_domain(record, &format!("{path}.domain"), domain_value, blockers)
        else {
            continue;
        };
        let key = format!("{}:{id}", domain.as_id());
        if previous.as_ref().is_some_and(|previous| previous >= &key) {
            invalid_value(
                record,
                &path,
                "strictly sorted unique domain:id reference",
                &key,
                blockers,
            );
        }
        previous = Some(key);
        let typed = ContentReference {
            domain,
            id: id.to_owned(),
            path: path.clone(),
        };
        facts.references.push(typed.clone());
        output.push(typed);
    }
    output
}

fn parse_render_model(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    base: &str,
    catalog_node_count: Option<u32>,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentRenderPresentationModel> {
    let model_id = required_nonempty_string_at(record, object, "id", base, blockers);
    let label = required_nonempty_string_at(record, object, "label", base, blockers);
    let category = required_u32_at(record, object, "category", base, 0, 8, blockers);
    let ground_path = field_path(base, "groundYBits");
    let ground_y_bits = match object.get("groundYBits") {
        Some(CanonicalJson::Null) => Some(None),
        Some(value) => match json_u32(value, 0, u32::MAX) {
            Some(bits) => Some(Some(bits)),
            None => {
                invalid_type(record, &ground_path, "u32 float bits or null", value, blockers);
                None
            }
        },
        None => {
            missing_field(record, &ground_path, "u32 float bits or null", blockers);
            None
        }
    };
    let node_count = required_u32_at(record, object, "nodeCount", base, 1, 16_384, blockers);
    if let (Some(model_nodes), Some(catalog_nodes)) = (node_count, catalog_node_count)
        && model_nodes > catalog_nodes
    {
        invalid_value(
            record,
            &field_path(base, "nodeCount"),
            "no greater than catalog.nodeCount",
            &model_nodes.to_string(),
            blockers,
        );
    }
    Some(ContentRenderPresentationModel {
        model_id: model_id?.to_owned(),
        label: label?.to_owned(),
        category: u8::try_from(category?).expect("model category is bounded"),
        ground_y_bits: ground_y_bits?,
        node_count: node_count?,
    })
}

fn validate_render_presentation_catalog(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    required_u32(record, object, "schema", 1, 1, blockers);
    if record.id != RENDER_PRESENTATION_CATALOG_ID {
        invalid_value(record, "$.id", RENDER_PRESENTATION_CATALOG_ID, &record.id, blockers);
    }
    let Some(catalog) = required_object(record, object, "catalog", blockers) else {
        return;
    };
    let catalog_schema = required_u32_at(record, catalog, "schema", "$.catalog", 2, 2, blockers);
    required_exact_string_at(
        record,
        catalog,
        "format",
        "$.catalog",
        "blockwild-compiled-model-catalog-v2",
        blockers,
    );
    let catalog_revision = required_u32_at(record, catalog, "revision", "$.catalog", 1, u32::MAX, blockers);
    let catalog_sha256 = required_lowercase_hex_at(record, catalog, "sha256", "$.catalog", 64, blockers);
    let catalog_canonical_hash = required_lowercase_hex_at(record, catalog, "canonicalHash", "$.catalog", 32, blockers);
    let catalog_byte_length = required_u32_at(record, catalog, "byteLength", "$.catalog", 1, 64 * 1_048_576, blockers);
    let catalog_model_count = required_u32_at(record, catalog, "modelCount", "$.catalog", 1, 4_096, blockers);
    let catalog_node_count = required_u32_at(record, catalog, "nodeCount", "$.catalog", 1, u32::MAX, blockers);
    let catalog_source = required_nonempty_string_at(record, catalog, "source", "$.catalog", blockers);

    let Some(profile_values) = required_array(record, object, "profiles", blockers) else {
        return;
    };
    if profile_values.is_empty() || profile_values.len() > MAX_RENDER_PRESENTATION_PROFILES {
        invalid_value(
            record,
            "$.profiles",
            &format!("1..={MAX_RENDER_PRESENTATION_PROFILES} profiles"),
            &profile_values.len().to_string(),
            blockers,
        );
    }
    let mut profiles = BTreeMap::new();
    let mut previous_profile_id = None::<String>;
    let mut role_refs = BTreeSet::new();
    for (index, value) in profile_values.iter().take(MAX_RENDER_PRESENTATION_PROFILES).enumerate() {
        let base = format!("$.profiles[{index}]");
        let Some(profile_object) = value.as_object() else {
            invalid_type(record, &base, "presentation profile object", value, blockers);
            continue;
        };
        let id = required_nonempty_string_at(record, profile_object, "id", &base, blockers);
        let role_value = required_nonempty_string_at(record, profile_object, "role", &base, blockers);
        let role =
            role_value.and_then(|role| parse_render_presentation_role(record, &format!("{base}.role"), role, blockers));
        let model = required_object_at(record, profile_object, "model", &base, blockers).and_then(|model| {
            parse_render_model(record, model, &format!("{base}.model"), catalog_node_count, blockers)
        });
        let content_refs = required_array_at(record, profile_object, "contentRefs", &base, blockers).map(|values| {
            parse_render_presentation_refs(record, values, &format!("{base}.contentRefs"), facts, blockers)
        });
        if content_refs.as_ref().is_some_and(Vec::is_empty) {
            invalid_value(
                record,
                &format!("{base}.contentRefs"),
                "at least one content ref",
                "empty",
                blockers,
            );
        }
        let (Some(id), Some(role), Some(model), Some(content_refs)) = (id, role, model, content_refs) else {
            continue;
        };
        if previous_profile_id
            .as_ref()
            .is_some_and(|previous| previous.as_str() >= id)
        {
            invalid_value(
                record,
                &format!("{base}.id"),
                "strictly sorted unique profile id",
                id,
                blockers,
            );
        }
        previous_profile_id = Some(id.to_owned());
        for reference in &content_refs {
            if !role_refs.insert((role, reference.domain, reference.id.clone())) {
                invalid_value(
                    record,
                    &reference.path,
                    "one model per presentation role and content ref",
                    &format!("{}:{}", reference.domain.as_id(), reference.id),
                    blockers,
                );
            }
        }
        if profiles
            .insert(
                id.to_owned(),
                ContentRenderPresentationProfile {
                    id: id.to_owned(),
                    role,
                    model,
                    content_refs,
                },
            )
            .is_some()
        {
            invalid_value(record, &format!("{base}.id"), "unique profile id", id, blockers);
        }
    }

    let Some(missing_values) = required_array(record, object, "missingProfiles", blockers) else {
        return;
    };
    if missing_values.len() > MAX_MISSING_RENDER_PRESENTATION_PROFILES {
        invalid_value(
            record,
            "$.missingProfiles",
            &format!("at most {MAX_MISSING_RENDER_PRESENTATION_PROFILES} blockers"),
            &missing_values.len().to_string(),
            blockers,
        );
    }
    let mut missing_profiles = BTreeMap::new();
    let mut previous_missing_id = None::<String>;
    for (index, value) in missing_values
        .iter()
        .take(MAX_MISSING_RENDER_PRESENTATION_PROFILES)
        .enumerate()
    {
        let base = format!("$.missingProfiles[{index}]");
        let Some(missing_object) = value.as_object() else {
            invalid_type(record, &base, "missing presentation profile object", value, blockers);
            continue;
        };
        let id = required_nonempty_string_at(record, missing_object, "id", &base, blockers);
        let role_value = required_nonempty_string_at(record, missing_object, "role", &base, blockers);
        let role =
            role_value.and_then(|role| parse_render_presentation_role(record, &format!("{base}.role"), role, blockers));
        let source_values = required_array_at(record, missing_object, "sourcePresentationIds", &base, blockers);
        let source_presentation_ids = parse_string_array(
            record,
            source_values,
            &format!("{base}.sourcePresentationIds"),
            blockers,
        );
        if source_presentation_ids.is_empty() || source_presentation_ids.len() > MAX_RENDER_PRESENTATION_SOURCE_IDS {
            invalid_value(
                record,
                &format!("{base}.sourcePresentationIds"),
                &format!("1..={MAX_RENDER_PRESENTATION_SOURCE_IDS} source ids"),
                &source_presentation_ids.len().to_string(),
                blockers,
            );
        }
        if !source_presentation_ids.windows(2).all(|pair| pair[0] < pair[1]) {
            invalid_value(
                record,
                &format!("{base}.sourcePresentationIds"),
                "strictly sorted unique source ids",
                "non-canonical",
                blockers,
            );
        }
        let content_refs = required_array_at(record, missing_object, "contentRefs", &base, blockers).map(|values| {
            parse_render_presentation_refs(record, values, &format!("{base}.contentRefs"), facts, blockers)
        });
        let reason = required_nonempty_string_at(record, missing_object, "reason", &base, blockers);
        let (Some(id), Some(role), Some(content_refs), Some(reason)) = (id, role, content_refs, reason) else {
            continue;
        };
        if previous_missing_id
            .as_ref()
            .is_some_and(|previous| previous.as_str() >= id)
        {
            invalid_value(
                record,
                &format!("{base}.id"),
                "strictly sorted unique blocker id",
                id,
                blockers,
            );
        }
        previous_missing_id = Some(id.to_owned());
        for reference in &content_refs {
            if !role_refs.insert((role, reference.domain, reference.id.clone())) {
                invalid_value(
                    record,
                    &reference.path,
                    "one mapped or missing presentation per role and content ref",
                    &format!("{}:{}", reference.domain.as_id(), reference.id),
                    blockers,
                );
            }
        }
        if missing_profiles
            .insert(
                id.to_owned(),
                ContentMissingRenderPresentationProfile {
                    id: id.to_owned(),
                    role,
                    source_presentation_ids,
                    content_refs,
                    reason: reason.to_owned(),
                },
            )
            .is_some()
        {
            invalid_value(record, &format!("{base}.id"), "unique blocker id", id, blockers);
        }
    }

    let integration_blockers = required_string_array(record, object, "integrationBlockers", blockers);
    if integration_blockers.is_empty() || integration_blockers.len() > MAX_BLOCK_AUTHORITY_BLOCKERS {
        invalid_value(
            record,
            "$.integrationBlockers",
            &format!("1..={MAX_BLOCK_AUTHORITY_BLOCKERS} blockers"),
            &integration_blockers.len().to_string(),
            blockers,
        );
    }
    if !integration_blockers.windows(2).all(|pair| pair[0] < pair[1]) {
        invalid_value(
            record,
            "$.integrationBlockers",
            "strictly sorted unique blockers",
            "non-canonical",
            blockers,
        );
    }

    if let (
        Some(catalog_schema),
        Some(catalog_revision),
        Some(catalog_sha256),
        Some(catalog_canonical_hash),
        Some(catalog_byte_length),
        Some(catalog_model_count),
        Some(catalog_node_count),
        Some(catalog_source),
    ) = (
        catalog_schema,
        catalog_revision,
        catalog_sha256,
        catalog_canonical_hash,
        catalog_byte_length,
        catalog_model_count,
        catalog_node_count,
        catalog_source,
    ) {
        facts.render_presentation = Some(RenderPresentationFacts {
            catalog_schema: u16::try_from(catalog_schema).expect("catalog schema is bounded"),
            catalog_revision,
            catalog_sha256: catalog_sha256.to_owned(),
            catalog_canonical_hash: catalog_canonical_hash.to_owned(),
            catalog_byte_length,
            catalog_model_count,
            catalog_node_count,
            catalog_source: catalog_source.to_owned(),
            profiles,
            missing_profiles,
            integration_blockers,
        });
    }
}

fn validate_creature_type(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "type:"), blockers);
    required_nonempty_string(record, object, "name", blockers);
    required_nonempty_string(record, object, "glyph", blockers);
    if let Some(color) = required_nonempty_string(record, object, "color", blockers)
        && !valid_hex_color(color)
    {
        invalid_value(record, "$.color", "#RRGGBB color", color, blockers);
    }
}

fn validate_type_chart(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    let owner = strip_prefix(&record.id, "chart:");
    push_reference(
        facts,
        ContentDomain::CreatureTypeChart,
        format!("type:{owner}"),
        "$.ownerType",
    );
    let mut seen = BTreeSet::new();
    for field in ["strongAgainst", "resistedBy"] {
        for (index, kind) in required_string_array(record, object, field, blockers)
            .into_iter()
            .enumerate()
        {
            if !seen.insert(kind.clone()) {
                invalid_value(
                    record,
                    &format!("$.{field}[{index}]"),
                    "type appears in only one relation",
                    &kind,
                    blockers,
                );
            }
            push_reference(
                facts,
                ContentDomain::CreatureTypeChart,
                format!("type:{kind}"),
                &format!("$.{field}[{index}]"),
            );
        }
    }
}

fn validate_quest(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "quest:"), blockers);
    required_nonempty_string(record, object, "name", blockers);
    if let Some(line) = required_nonempty_string(record, object, "questlineId", blockers) {
        push_reference(
            facts,
            ContentDomain::QuestGuild,
            format!("questline:{line}"),
            "$.questlineId",
        );
    }
    let objectives = required_array(record, object, "objectives", blockers);
    if objectives.is_some_and(<[CanonicalJson]>::is_empty) {
        resource_error(record, "$.objectives", "one or more objectives", "empty", blockers);
    }
}

fn validate_questline(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "questline:"), blockers);
    for (index, quest) in required_string_array(record, object, "questIds", blockers)
        .into_iter()
        .enumerate()
    {
        push_reference(
            facts,
            ContentDomain::QuestGuild,
            format!("quest:{quest}"),
            &format!("$.questIds[{index}]"),
        );
    }
}

fn validate_guild(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "guild:"), blockers);
    if let Some(faction) = required_nonempty_string(record, object, "factionId", blockers) {
        push_reference(
            facts,
            ContentDomain::QuestGuild,
            format!("faction:{faction}"),
            "$.factionId",
        );
    }
    for (field, prefix) in [("questIds", "guild-quest:"), ("principalNpcIds", "guild-npc:")] {
        for (index, id) in required_string_array(record, object, field, blockers)
            .into_iter()
            .enumerate()
        {
            push_reference(
                facts,
                ContentDomain::QuestGuild,
                format!("{prefix}{id}"),
                &format!("$.{field}[{index}]"),
            );
        }
    }
}

fn validate_guild_quest(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "guild-quest:"), blockers);
    if let Some(guild) = required_nonempty_string(record, object, "guildId", blockers) {
        push_reference(facts, ContentDomain::QuestGuild, format!("guild:{guild}"), "$.guildId");
    }
    required_u32(record, object, "number", 1, 1_000_000, blockers);
    let objectives = required_array(record, object, "objectives", blockers);
    if objectives.is_some_and(<[CanonicalJson]>::is_empty) {
        resource_error(record, "$.objectives", "one or more objectives", "empty", blockers);
    }
}

fn validate_guild_npc(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "guild-npc:"), blockers);
    if let Some(guild) = required_nonempty_string(record, object, "guildId", blockers) {
        push_reference(facts, ContentDomain::QuestGuild, format!("guild:{guild}"), "$.guildId");
    }
    required_nonempty_string(record, object, "name", blockers);
}

fn validate_faction(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "faction:"), blockers);
    required_nonempty_string(record, object, "name", blockers);
    required_nonempty_string(record, object, "race", blockers);
}

fn validate_commerce(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id_field(record, object, "key", strip_prefix(&record.id, "commerce:"), blockers);
    required_nonempty_string(record, object, "name", blockers);
    required_u32(record, object, "baseValue", 0, MAX_ITEM_STACK, blockers);
    required_u32(record, object, "stackLimit", 1, MAX_ITEM_STACK, blockers);
    if let Some(value) = required_nonempty_string(record, object, "category", blockers) {
        enum_value(
            record,
            "$.category",
            value,
            &[
                "ammunition",
                "armor",
                "blueprint",
                "creature",
                "crop",
                "drink",
                "food",
                "honey",
                "material",
                "misc",
                "ore",
                "potion",
                "treasure",
                "weapon",
            ],
            blockers,
        );
    }
}

fn validate_merchant_offer(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    if let Some(item) = required_nonempty_string(record, object, "itemKey", blockers) {
        push_reference(facts, ContentDomain::Economy, format!("commerce:{item}"), "$.itemKey");
    }
    required_u32(record, object, "count", 1, MAX_ITEM_STACK, blockers);
    optional_number(record, object, "rareChance", 0.0, 1.0, blockers);
}

fn validate_stock(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id_field(record, object, "symbol", strip_prefix(&record.id, "stock:"), blockers);
    required_nonempty_string(record, object, "name", blockers);
    required_u32(record, object, "initialPriceGold", 1, MAX_ITEM_STACK, blockers);
    required_u32(record, object, "driftBasisPoints", 0, 10_000, blockers);
}

fn validate_tcg_card(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "definition:"), blockers);
    required_u32(record, object, "schema", 1, 1, blockers);
    required_u32(record, object, "rulesRevision", 1, u32::MAX, blockers);
    required_u32(record, object, "cost", 0, 100, blockers);
    if let Some(value) = required_nonempty_string(record, object, "class", blockers) {
        enum_value(
            record,
            "$.class",
            value,
            &["character", "creature", "place", "relic", "technique"],
            blockers,
        );
    }
    if let Some(value) = required_nonempty_string(record, object, "rarity", blockers) {
        enum_value(
            record,
            "$.rarity",
            value,
            &["common", "uncommon", "rare", "epic", "legendary"],
            blockers,
        );
    }
    if let Some(kind) = required_nonempty_string(record, object, "primaryType", blockers) {
        push_reference(
            facts,
            ContentDomain::CreatureTypeChart,
            format!("type:{kind}"),
            "$.primaryType",
        );
    }
    for (index, kind) in required_string_array(record, object, "secondaryTypes", blockers)
        .into_iter()
        .enumerate()
    {
        push_reference(
            facts,
            ContentDomain::CreatureTypeChart,
            format!("type:{kind}"),
            &format!("$.secondaryTypes[{index}]"),
        );
    }
    let abilities = required_array(record, object, "abilities", blockers);
    if abilities.is_some_and(|values| values.len() > 64) {
        invalid_value(
            record,
            "$.abilities",
            "at most 64 abilities",
            &abilities.map(<[CanonicalJson]>::len).unwrap_or_default().to_string(),
            blockers,
        );
    }
}

fn validate_tcg_printing(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "printing:"), blockers);
    required_u32(record, object, "schema", 1, 1, blockers);
    if let Some(card) = required_nonempty_string(record, object, "cardDefinitionId", blockers) {
        push_reference(
            facts,
            ContentDomain::CardforgeCard,
            format!("definition:{card}"),
            "$.cardDefinitionId",
        );
    }
    if let Some(set) = required_nonempty_string(record, object, "setId", blockers) {
        push_reference(facts, ContentDomain::CardforgePack, format!("set:{set}"), "$.setId");
    }
    if let Some(value) = required_nonempty_string(record, object, "variant", blockers) {
        enum_value(
            record,
            "$.variant",
            value,
            &["boss-signature", "capture", "full-art", "showcase", "standard"],
            blockers,
        );
    }
    if let Some(value) = required_nonempty_string(record, object, "finish", blockers) {
        enum_value(
            record,
            "$.finish",
            value,
            &["etched", "foil", "signature", "standard"],
            blockers,
        );
    }
    required_u32(record, object, "valueModifierPermille", 1, 1_000_000, blockers);
}

fn validate_tcg_pack(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "pack:"), blockers);
    required_nonempty_string(record, object, "name", blockers);
    required_u32(record, object, "retailPrice", 0, MAX_ITEM_STACK, blockers);
    for (index, set) in required_string_array(record, object, "setIds", blockers)
        .into_iter()
        .enumerate()
    {
        push_reference(
            facts,
            ContentDomain::CardforgePack,
            format!("set:{set}"),
            &format!("$.setIds[{index}]"),
        );
    }
}

fn validate_tcg_set(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id(record, object, strip_prefix(&record.id, "set:"), blockers);
    required_nonempty_string(record, object, "name", blockers);
    required_nonempty_string(record, object, "symbol", blockers);
}

fn normalize_facts(record: &DecodedRecord, facts: &mut RecordFacts, blockers: &mut Vec<ContentRuntimeBlocker>) {
    facts.references.sort();
    facts.references.dedup();
    facts.natural_types.sort();
    facts.natural_types.dedup();
    facts.move_ids.sort();
    facts.move_ids.dedup();
    aggregate_resources(&mut facts.resources.inputs);
    aggregate_resources(&mut facts.resources.outputs);
    let total = facts.resources.inputs.len() + facts.resources.outputs.len();
    if total > MAX_CONTENT_RESOURCES_PER_ENTRY {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::Capacity,
            ContentRuntimeStage::Invariants,
            "$.resources",
            &MAX_CONTENT_RESOURCES_PER_ENTRY.to_string(),
            &total.to_string(),
        ));
    }
}

fn resolve_reference_choices(
    record: &DecodedRecord,
    facts: &mut RecordFacts,
    all_ids: &BTreeSet<(ContentDomain, String)>,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    for choice in facts.reference_choices.drain(..) {
        let mut matches = choice
            .targets
            .iter()
            .filter(|target| all_ids.contains(*target))
            .cloned()
            .collect::<Vec<_>>();
        matches.sort();
        matches.dedup();
        match matches.as_slice() {
            [(domain, id)] => facts.references.push(ContentReference {
                domain: *domain,
                id: id.clone(),
                path: choice.path,
            }),
            [] => blockers.push(for_record(
                record,
                ContentRuntimeBlockerCode::MissingDependency,
                ContentRuntimeStage::References,
                &choice.path,
                &choice
                    .targets
                    .iter()
                    .map(|(domain, id)| format!("{}:{id}", domain.as_id()))
                    .collect::<Vec<_>>()
                    .join("|"),
                "missing",
            )),
            _ => blockers.push(for_record(
                record,
                ContentRuntimeBlockerCode::DescriptorMismatch,
                ContentRuntimeStage::References,
                &choice.path,
                "exactly one dependency target",
                &matches
                    .iter()
                    .map(|(domain, id)| format!("{}:{id}", domain.as_id()))
                    .collect::<Vec<_>>()
                    .join("|"),
            )),
        }
    }
    facts.references.sort();
    facts.references.dedup();
}

fn insert_record(registry: &mut ContentRuntimeRegistry, record: DecodedRecord, facts: RecordFacts) {
    let domain = record.domain;
    let id = record.id.clone();
    let core = ContentRecordCore {
        id: record.id,
        schema: record.schema,
        content_version: record.content_version,
        blob_hash: record.blob_hash,
        aliases: record.aliases,
        document: record.document,
        unknown_extension_bytes: record.unknown_extension_bytes,
        references: facts.references,
        resources: facts.resources,
    };
    match domain {
        ContentDomain::Item => {
            if matches!(
                record.schema,
                ContentSchema::BlockActionCatalog | ContentSchema::BlockActionCatalogV2
            ) {
                registry.block_action_catalogs.insert(
                    id,
                    ContentBlockActionCatalogRecord {
                        core,
                        rng_semantics: facts.block_action_rng_semantics,
                        authority_blockers: facts.block_action_authority_blockers,
                        profiles: facts.block_actions,
                    },
                );
            } else {
                registry.items.insert(
                    id,
                    ContentItemRecord {
                        core,
                        item_code: facts.item_code.expect("validated item has item code"),
                        max_stack: facts.max_stack.expect("validated item has stack limit"),
                        action: facts.item_action.expect("validated item has typed action semantics"),
                    },
                );
            }
        }
        ContentDomain::CraftingRecipe => {
            registry.crafting_recipes.insert(id, ContentRecipeRecord { core });
        }
        ContentDomain::MachineRecipe => {
            registry.machine_recipes.insert(id, ContentRecipeRecord { core });
        }
        ContentDomain::MachineProfile => {
            if record.schema == ContentSchema::RenderPresentationCatalog {
                let render = facts
                    .render_presentation
                    .expect("validated render presentation catalog has typed facts");
                registry.render_presentation_catalogs.insert(
                    id,
                    ContentRenderPresentationCatalogRecord {
                        core,
                        catalog_schema: render.catalog_schema,
                        catalog_revision: render.catalog_revision,
                        catalog_sha256: render.catalog_sha256,
                        catalog_canonical_hash: render.catalog_canonical_hash,
                        catalog_byte_length: render.catalog_byte_length,
                        catalog_model_count: render.catalog_model_count,
                        catalog_node_count: render.catalog_node_count,
                        catalog_source: render.catalog_source,
                        profiles: render.profiles,
                        missing_profiles: render.missing_profiles,
                        integration_blockers: render.integration_blockers,
                    },
                );
            } else {
                registry.machine_profiles.insert(
                    id,
                    ContentMachineProfileRecord {
                        core,
                        capacity_fields: facts.capacity_fields,
                    },
                );
            }
        }
        ContentDomain::AbilitySpell => {
            registry.abilities_spells.insert(
                id,
                ContentAbilityRecord {
                    core,
                    cooldown_millis: facts.cooldown_millis,
                },
            );
        }
        ContentDomain::CreatureProfile => {
            if record.schema == ContentSchema::PlayerRenderProfile {
                let render = facts
                    .player_render
                    .expect("validated player render profile has typed facts");
                registry.player_render_profiles.insert(
                    id,
                    ContentPlayerRenderRecord {
                        core,
                        catalog_schema: render.catalog_schema,
                        catalog_revision: render.catalog_revision,
                        catalog_sha256: render.catalog_sha256,
                        catalog_canonical_hash: render.catalog_canonical_hash,
                        catalog_byte_length: render.catalog_byte_length,
                        catalog_model_count: render.catalog_model_count,
                        catalog_node_count: render.catalog_node_count,
                        catalog_source: render.catalog_source,
                        model_id: render.model_id,
                        model_label: render.model_label,
                        model_pose: render.model_pose,
                        model_category: render.model_category,
                        model_ground_y_bits: render.model_ground_y_bits,
                        model_node_count: render.model_node_count,
                    },
                );
            } else {
                registry.creature_profiles.insert(
                    id,
                    ContentCreatureRecord {
                        core,
                        natural_types: facts.natural_types,
                        move_ids: facts.move_ids,
                    },
                );
            }
        }
        ContentDomain::CreatureTypeChart => {
            registry.creature_type_chart.insert(id, ContentTypedRecord { core });
        }
        ContentDomain::QuestGuild => {
            registry.quests_guilds.insert(id, ContentTypedRecord { core });
        }
        ContentDomain::Economy => {
            registry.economy.insert(id, ContentTypedRecord { core });
        }
        ContentDomain::CardforgeCard => {
            registry.cardforge_cards.insert(id, ContentTypedRecord { core });
        }
        ContentDomain::CardforgePack => {
            registry.cardforge_packs.insert(id, ContentTypedRecord { core });
        }
    }
}

fn canonical_registry_hash(registry: &ContentRuntimeRegistry) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild.gameplay.content-runtime.v1");
    hasher.write_u16(CONTENT_RUNTIME_SCHEMA_VERSION);
    hasher.write_bytes(registry.manifest_hash.as_bytes());
    hasher.write_str(&registry.source_revision);
    hasher.write_u64(registry.len() as u64);
    for domain in ALL_CONTENT_DOMAINS {
        let records = records_for_domain(registry, domain);
        hasher.write_str(domain.as_id());
        hasher.write_u64(records.len() as u64);
        for record in records {
            hash_record(&mut hasher, record);
        }
    }
    hasher.write_u64(registry.aliases.len() as u64);
    for (alias, (domain, id)) in &registry.aliases {
        hasher.write_str(alias);
        hasher.write_str(domain.as_id());
        hasher.write_str(id);
    }
    hasher.finish()
}

fn records_for_domain(registry: &ContentRuntimeRegistry, domain: ContentDomain) -> Vec<&ContentRecordCore> {
    match domain {
        ContentDomain::Item => {
            let mut records = registry
                .items
                .values()
                .map(|record| &record.core)
                .chain(registry.block_action_catalogs.values().map(|record| &record.core))
                .collect::<Vec<_>>();
            records.sort_by(|left, right| left.id.cmp(&right.id));
            records
        }
        ContentDomain::CraftingRecipe => registry.crafting_recipes.values().map(|record| &record.core).collect(),
        ContentDomain::MachineRecipe => registry.machine_recipes.values().map(|record| &record.core).collect(),
        ContentDomain::MachineProfile => {
            let mut records = registry
                .machine_profiles
                .values()
                .map(|record| &record.core)
                .chain(
                    registry
                        .render_presentation_catalogs
                        .values()
                        .map(|record| &record.core),
                )
                .collect::<Vec<_>>();
            records.sort_by(|left, right| left.id.cmp(&right.id));
            records
        }
        ContentDomain::AbilitySpell => registry.abilities_spells.values().map(|record| &record.core).collect(),
        ContentDomain::CreatureProfile => {
            let mut records = registry
                .creature_profiles
                .values()
                .map(|record| &record.core)
                .chain(registry.player_render_profiles.values().map(|record| &record.core))
                .collect::<Vec<_>>();
            records.sort_by(|left, right| left.id.cmp(&right.id));
            records
        }
        ContentDomain::CreatureTypeChart => registry
            .creature_type_chart
            .values()
            .map(|record| &record.core)
            .collect(),
        ContentDomain::QuestGuild => registry.quests_guilds.values().map(|record| &record.core).collect(),
        ContentDomain::Economy => registry.economy.values().map(|record| &record.core).collect(),
        ContentDomain::CardforgeCard => registry.cardforge_cards.values().map(|record| &record.core).collect(),
        ContentDomain::CardforgePack => registry.cardforge_packs.values().map(|record| &record.core).collect(),
    }
}

fn hash_record(hasher: &mut CanonicalHasher, record: &ContentRecordCore) {
    hasher.write_str(&record.id);
    hasher.write_str(record.schema.as_id());
    hasher.write_u32(record.content_version);
    hasher.write_bytes(record.blob_hash.as_bytes());
    hasher.write_u64(record.references.len() as u64);
    for reference in &record.references {
        hasher.write_str(reference.domain.as_id());
        hasher.write_str(&reference.id);
        hasher.write_str(&reference.path);
    }
    hash_resources(hasher, &record.resources.inputs);
    hash_resources(hasher, &record.resources.outputs);
}

fn hash_resources(hasher: &mut CanonicalHasher, resources: &[ContentResourceAmount]) {
    hasher.write_u64(resources.len() as u64);
    for resource in resources {
        match &resource.resource {
            ContentResourceKey::ItemCode(code) => {
                hasher.write_u16(0);
                hasher.write_u32(*code);
            }
            ContentResourceKey::ItemChoice(codes) => {
                hasher.write_u16(2);
                hasher.write_u64(codes.len() as u64);
                for code in codes {
                    hasher.write_u32(*code);
                }
            }
            ContentResourceKey::Symbolic(id) => {
                hasher.write_u16(1);
                hasher.write_str(id);
            }
        }
        hasher.write_u32(resource.amount);
        hasher.write_u16(u16::from(resource.consumed));
    }
}

fn required_nonempty_string<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a str> {
    required_nonempty_string_at(record, object, field, "$", blockers)
}

fn required_nonempty_string_at<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a str> {
    let path = field_path(base, field);
    let Some(value) = object.get(field) else {
        missing_field(record, &path, "non-empty string", blockers);
        return None;
    };
    let Some(value) = value.as_str() else {
        invalid_type(record, &path, "non-empty string", value, blockers);
        return None;
    };
    if !valid_symbol(value) {
        invalid_value(record, &path, "1..160 non-control characters", value, blockers);
        return None;
    }
    Some(value)
}

fn required_exact_string_at<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    expected: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a str> {
    let value = required_nonempty_string_at(record, object, field, base, blockers)?;
    if value != expected {
        invalid_value(record, &field_path(base, field), expected, value, blockers);
        return None;
    }
    Some(value)
}

fn required_lowercase_hex_at<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    length: usize,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a str> {
    let value = required_nonempty_string_at(record, object, field, base, blockers)?;
    if value.len() != length
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        invalid_value(
            record,
            &field_path(base, field),
            &format!("{length} lowercase hexadecimal characters"),
            value,
            blockers,
        );
        return None;
    }
    Some(value)
}

fn optional_string<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a str> {
    optional_string_at(record, object, field, "$", blockers)
}

fn optional_string_at<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a str> {
    let value = object.get(field)?;
    if matches!(value, CanonicalJson::Null) {
        return None;
    }
    let path = field_path(base, field);
    let Some(value) = value.as_str() else {
        invalid_type(record, &path, "string or null", value, blockers);
        return None;
    };
    if !valid_symbol(value) {
        invalid_value(record, &path, "1..160 non-control characters", value, blockers);
        return None;
    }
    Some(value)
}

fn required_u32(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    minimum: u32,
    maximum: u32,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<u32> {
    required_u32_at(record, object, field, "$", minimum, maximum, blockers)
}

fn required_u32_at(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    minimum: u32,
    maximum: u32,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<u32> {
    let path = field_path(base, field);
    let Some(value) = object.get(field) else {
        missing_field(record, &path, "integer", blockers);
        return None;
    };
    let Some(value) = json_u32(value, minimum, maximum) else {
        invalid_type(record, &path, &format!("integer {minimum}..{maximum}"), value, blockers);
        return None;
    };
    Some(value)
}

fn optional_u32(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    minimum: u32,
    maximum: u32,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<u32> {
    let value = object.get(field)?;
    if matches!(value, CanonicalJson::Null) {
        return None;
    }
    let Some(value) = json_u32(value, minimum, maximum) else {
        invalid_type(
            record,
            &format!("$.{field}"),
            &format!("integer {minimum}..{maximum}"),
            value,
            blockers,
        );
        return None;
    };
    Some(value)
}

fn optional_u32_at(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    minimum: u32,
    maximum: u32,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<u32> {
    let value = object.get(field)?;
    if matches!(value, CanonicalJson::Null) {
        return None;
    }
    let path = field_path(base, field);
    let Some(value) = json_u32(value, minimum, maximum) else {
        invalid_type(
            record,
            &path,
            &format!("integer {minimum}..{maximum} or null"),
            value,
            blockers,
        );
        return None;
    };
    Some(value)
}

fn optional_u64(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    minimum: u64,
    maximum: u64,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<u64> {
    let value = object.get(field)?;
    let Some(value) = value
        .as_u64()
        .filter(|value| (*value >= minimum) && (*value <= maximum))
    else {
        invalid_type(
            record,
            &format!("$.{field}"),
            &format!("integer {minimum}..{maximum}"),
            value,
            blockers,
        );
        return None;
    };
    Some(value)
}

fn optional_bool(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<bool> {
    let value = object.get(field)?;
    if matches!(value, CanonicalJson::Null) {
        return None;
    }
    let Some(value) = value.as_bool() else {
        invalid_type(record, &format!("$.{field}"), "boolean or null", value, blockers);
        return None;
    };
    Some(value)
}

fn required_bool_at(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<bool> {
    let path = field_path(base, field);
    let Some(value) = object.get(field) else {
        missing_field(record, &path, "boolean", blockers);
        return None;
    };
    let Some(value) = value.as_bool() else {
        invalid_type(record, &path, "boolean", value, blockers);
        return None;
    };
    Some(value)
}

fn optional_millionths(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    minimum: u64,
    maximum: u64,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<u64> {
    let value = object.get(field)?;
    if matches!(value, CanonicalJson::Null) {
        return None;
    }
    millionths_at(record, value, &format!("$.{field}"), minimum, maximum, blockers)
}

fn optional_millionths_at(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    minimum: u64,
    maximum: u64,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<u64> {
    let value = object.get(field)?;
    if matches!(value, CanonicalJson::Null) {
        return None;
    }
    millionths_at(record, value, &field_path(base, field), minimum, maximum, blockers)
}

fn required_millionths_at(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    minimum: u64,
    maximum: u64,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<u64> {
    let path = field_path(base, field);
    let Some(value) = object.get(field) else {
        missing_field(record, &path, "exact fixed-point number", blockers);
        return None;
    };
    millionths_at(record, value, &path, minimum, maximum, blockers)
}

fn millionths_at(
    record: &DecodedRecord,
    value: &CanonicalJson,
    path: &str,
    minimum: u64,
    maximum: u64,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<u64> {
    let CanonicalJson::Number(number) = value else {
        invalid_type(record, path, "exact fixed-point number", value, blockers);
        return None;
    };
    let Some(scaled) = decimal_to_millionths(number).filter(|scaled| (*scaled >= minimum) && (*scaled <= maximum))
    else {
        invalid_value(
            record,
            path,
            &format!("exact millionths {minimum}..{maximum}"),
            number,
            blockers,
        );
        return None;
    };
    Some(scaled)
}

fn decimal_to_millionths(source: &str) -> Option<u64> {
    let (significand, exponent) = source
        .split_once(['e', 'E'])
        .map_or(Some((source, 0_i32)), |(significand, exponent)| {
            Some((significand, exponent.parse::<i32>().ok()?))
        })?;
    if significand.starts_with('-') {
        return None;
    }
    let (whole, fraction) = significand.split_once('.').unwrap_or((significand, ""));
    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let digits = format!("{whole}{fraction}").parse::<u128>().ok()?;
    let fraction_len = i32::try_from(fraction.len()).ok()?;
    let shift = exponent.checked_add(6)?.checked_sub(fraction_len)?;
    let scaled = if shift >= 0 {
        digits.checked_mul(10_u128.checked_pow(u32::try_from(shift).ok()?)?)?
    } else {
        let divisor = 10_u128.checked_pow(shift.unsigned_abs())?;
        if digits % divisor != 0 {
            return None;
        }
        digits / divisor
    };
    u64::try_from(scaled).ok()
}

fn required_number(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    minimum: f64,
    maximum: f64,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<f64> {
    required_number_at(record, object, field, "$", minimum, maximum, blockers)
}

fn required_number_at(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    minimum: f64,
    maximum: f64,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<f64> {
    let path = field_path(base, field);
    let Some(value) = object.get(field) else {
        missing_field(record, &path, "finite number", blockers);
        return None;
    };
    let Some(number) = value
        .as_f64()
        .filter(|number| (*number >= minimum) && (*number <= maximum))
    else {
        invalid_type(
            record,
            &path,
            &format!("finite number {minimum}..{maximum}"),
            value,
            blockers,
        );
        return None;
    };
    Some(number)
}

fn optional_number(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    minimum: f64,
    maximum: f64,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<f64> {
    let value = object.get(field)?;
    let Some(number) = value
        .as_f64()
        .filter(|number| (*number >= minimum) && (*number <= maximum))
    else {
        invalid_type(
            record,
            &format!("$.{field}"),
            &format!("finite number {minimum}..{maximum}"),
            value,
            blockers,
        );
        return None;
    };
    Some(number)
}

fn required_array<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a [CanonicalJson]> {
    let Some(value) = object.get(field) else {
        missing_field(record, &format!("$.{field}"), "array", blockers);
        return None;
    };
    let Some(value) = value.as_array() else {
        invalid_type(record, &format!("$.{field}"), "array", value, blockers);
        return None;
    };
    Some(value)
}

fn required_array_at<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a [CanonicalJson]> {
    let path = field_path(base, field);
    let Some(value) = object.get(field) else {
        missing_field(record, &path, "array", blockers);
        return None;
    };
    let Some(value) = value.as_array() else {
        invalid_type(record, &path, "array", value, blockers);
        return None;
    };
    Some(value)
}

fn optional_array<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a [CanonicalJson]> {
    let value = object.get(field)?;
    let Some(value) = value.as_array() else {
        invalid_type(record, &format!("$.{field}"), "array", value, blockers);
        return None;
    };
    Some(value)
}

fn optional_array_at<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a [CanonicalJson]> {
    let value = object.get(field)?;
    let path = field_path(base, field);
    let Some(value) = value.as_array() else {
        invalid_type(record, &path, "array", value, blockers);
        return None;
    };
    Some(value)
}

fn required_object<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a BTreeMap<String, CanonicalJson>> {
    let Some(value) = object.get(field) else {
        missing_field(record, &format!("$.{field}"), "object", blockers);
        return None;
    };
    let Some(value) = value.as_object() else {
        invalid_type(record, &format!("$.{field}"), "object", value, blockers);
        return None;
    };
    Some(value)
}

fn required_object_at<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a BTreeMap<String, CanonicalJson>> {
    let path = field_path(base, field);
    let Some(value) = object.get(field) else {
        missing_field(record, &path, "object", blockers);
        return None;
    };
    let Some(value) = value.as_object() else {
        invalid_type(record, &path, "object", value, blockers);
        return None;
    };
    Some(value)
}

fn optional_object<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a BTreeMap<String, CanonicalJson>> {
    let value = object.get(field)?;
    let Some(value) = value.as_object() else {
        invalid_type(record, &format!("$.{field}"), "object", value, blockers);
        return None;
    };
    Some(value)
}

fn optional_object_at<'a>(
    record: &DecodedRecord,
    object: &'a BTreeMap<String, CanonicalJson>,
    field: &str,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<&'a BTreeMap<String, CanonicalJson>> {
    let value = object.get(field)?;
    let path = field_path(base, field);
    let Some(value) = value.as_object() else {
        invalid_type(record, &path, "object", value, blockers);
        return None;
    };
    Some(value)
}

fn required_string_array(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Vec<String> {
    parse_string_array(
        record,
        required_array(record, object, field, blockers),
        &format!("$.{field}"),
        blockers,
    )
}

fn optional_string_array(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<Vec<String>> {
    let values = optional_array(record, object, field, blockers)?;
    Some(parse_string_array(
        record,
        Some(values),
        &format!("$.{field}"),
        blockers,
    ))
}

fn parse_string_array(
    record: &DecodedRecord,
    values: Option<&[CanonicalJson]>,
    path: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Vec<String> {
    let mut output = Vec::new();
    let mut seen = BTreeSet::new();
    for (index, value) in values.unwrap_or_default().iter().enumerate() {
        let Some(value) = value.as_str().filter(|value| valid_symbol(value)) else {
            invalid_type(
                record,
                &format!("{path}[{index}]"),
                "bounded non-empty string",
                value,
                blockers,
            );
            continue;
        };
        if !seen.insert(value) {
            invalid_value(record, &format!("{path}[{index}]"), "unique string", value, blockers);
            continue;
        }
        output.push(value.to_owned());
    }
    output
}

fn item_stack(
    record: &DecodedRecord,
    value: Option<&CanonicalJson>,
    path: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<(u32, u32)> {
    let Some(value) = value else {
        missing_field(record, path, "item stack object", blockers);
        return None;
    };
    let Some(object) = value.as_object() else {
        invalid_type(record, path, "item stack object", value, blockers);
        return None;
    };
    let item = required_u32_at(record, object, "item", path, 1, u32::MAX, blockers)?;
    let count = required_u32_at(record, object, "count", path, 1, MAX_ITEM_STACK, blockers)?;
    Some((item, count))
}

fn symbolic_resource(
    record: &DecodedRecord,
    value: &CanonicalJson,
    path: &str,
    input: bool,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentResourceAmount> {
    let Some(object) = value.as_object() else {
        invalid_type(record, path, "resource object", value, blockers);
        return None;
    };
    let id = required_nonempty_string_at(record, object, "item", path, blockers)?;
    let count = required_u32_at(record, object, "count", path, 1, MAX_ITEM_STACK, blockers)?;
    let consumed = if input {
        object.get("consume").and_then(CanonicalJson::as_bool).unwrap_or(true)
    } else {
        false
    };
    if object.contains_key("consume") && object.get("consume").and_then(CanonicalJson::as_bool).is_none() {
        invalid_type(
            record,
            &format!("{path}.consume"),
            "boolean",
            object.get("consume").expect("field exists"),
            blockers,
        );
    }
    Some(ContentResourceAmount {
        resource: ContentResourceKey::Symbolic(id.to_owned()),
        amount: count,
        consumed,
    })
}

fn require_flow(record: &DecodedRecord, flow: &ContentResourceFlow, blockers: &mut Vec<ContentRuntimeBlocker>) {
    if flow.inputs.is_empty() || !flow.inputs.iter().any(|input| input.consumed) || flow.outputs.is_empty() {
        resource_error(
            record,
            "$.resources",
            "one consumed positive input and one positive output",
            &format!("{}/{}", flow.inputs.len(), flow.outputs.len()),
            blockers,
        );
    }
}

fn aggregate_resources(resources: &mut Vec<ContentResourceAmount>) {
    let mut grouped = BTreeMap::<(ContentResourceKey, bool), u32>::new();
    for resource in resources.drain(..) {
        let key = (resource.resource, resource.consumed);
        let entry = grouped.entry(key).or_default();
        *entry = entry.saturating_add(resource.amount);
    }
    *resources = grouped
        .into_iter()
        .map(|((resource, consumed), amount)| ContentResourceAmount {
            resource,
            amount,
            consumed,
        })
        .collect();
}

fn push_item_resource(resources: &mut Vec<ContentResourceAmount>, item: u32, amount: u32, consumed: bool) {
    resources.push(ContentResourceAmount {
        resource: ContentResourceKey::ItemCode(item),
        amount,
        consumed,
    });
}

fn push_reference(facts: &mut RecordFacts, domain: ContentDomain, id: String, path: &str) {
    facts.references.push(ContentReference {
        domain,
        id,
        path: path.to_owned(),
    });
}

fn push_reference_choice<const N: usize>(facts: &mut RecordFacts, targets: [(ContentDomain, String); N], path: &str) {
    facts.reference_choices.push(ContentReferenceChoice {
        targets: targets.into_iter().collect(),
        path: path.to_owned(),
    });
}

fn validate_embedded_id(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    expected: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    validate_embedded_id_field(record, object, "id", expected, blockers);
}

fn validate_embedded_id_field(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    field: &str,
    expected: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    if let Some(value) = required_nonempty_string(record, object, field, blockers)
        && value != expected
    {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            &format!("$.{field}"),
            expected,
            value,
        ));
    }
}

fn enum_value(
    record: &DecodedRecord,
    path: &str,
    value: &str,
    allowed: &[&str],
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    if !allowed.contains(&value) {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::InvalidEnum,
            ContentRuntimeStage::Invariants,
            path,
            &allowed.join("|"),
            value,
        ));
    }
}

fn parse_item_tool_kind(
    record: &DecodedRecord,
    path: &str,
    value: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentActionToolKind> {
    let parsed = match value {
        "axe" => ContentActionToolKind::Axe,
        "bow" => ContentActionToolKind::Bow,
        "crossbow" => ContentActionToolKind::Crossbow,
        "firearm" => ContentActionToolKind::Firearm,
        "pickaxe" => ContentActionToolKind::Pickaxe,
        "shovel" => ContentActionToolKind::Shovel,
        "spear" => ContentActionToolKind::Spear,
        "staff" => ContentActionToolKind::Staff,
        "sword" => ContentActionToolKind::Sword,
        _ => {
            enum_value(
                record,
                path,
                value,
                &[
                    "axe", "bow", "crossbow", "firearm", "pickaxe", "shovel", "spear", "staff", "sword",
                ],
                blockers,
            );
            return None;
        }
    };
    Some(parsed)
}

fn parse_block_tool_kind(
    record: &DecodedRecord,
    path: &str,
    value: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentActionToolKind> {
    let parsed = match value {
        "hand" => ContentActionToolKind::Hand,
        "axe" => ContentActionToolKind::Axe,
        "pickaxe" => ContentActionToolKind::Pickaxe,
        "shovel" => ContentActionToolKind::Shovel,
        _ => {
            enum_value(record, path, value, &["hand", "axe", "pickaxe", "shovel"], blockers);
            return None;
        }
    };
    Some(parsed)
}

fn parse_liquid_kind(
    record: &DecodedRecord,
    path: &str,
    value: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentActionLiquidKind> {
    let parsed = match value {
        "water" => ContentActionLiquidKind::Water,
        "lava" => ContentActionLiquidKind::Lava,
        "honey" => ContentActionLiquidKind::Honey,
        "syrup" => ContentActionLiquidKind::Syrup,
        _ => {
            enum_value(record, path, value, &["water", "lava", "honey", "syrup"], blockers);
            return None;
        }
    };
    Some(parsed)
}

fn parse_item_use_kind(
    record: &DecodedRecord,
    path: &str,
    value: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentItemUseKind> {
    let parsed = match value {
        "net" => ContentItemUseKind::Net,
        "release-creature" => ContentItemUseKind::ReleaseCreature,
        "boat" => ContentItemUseKind::Boat,
        "creature-cage" => ContentItemUseKind::CreatureCage,
        "capture-orb" => ContentItemUseKind::CaptureOrb,
        "magic-relic" => ContentItemUseKind::MagicRelic,
        "plant" => ContentItemUseKind::Plant,
        "hoe" => ContentItemUseKind::Hoe,
        "scythe" => ContentItemUseKind::Scythe,
        "shears" => ContentItemUseKind::Shears,
        "bucket" => ContentItemUseKind::Bucket,
        "lead" => ContentItemUseKind::Lead,
        "shield" => ContentItemUseKind::Shield,
        "blueprint" => ContentItemUseKind::Blueprint,
        "potion" => ContentItemUseKind::Potion,
        "ranged-weapon" => ContentItemUseKind::RangedWeapon,
        "spear" => ContentItemUseKind::Spear,
        "seed-pouch" => ContentItemUseKind::SeedPouch,
        "spell-tome" => ContentItemUseKind::SpellTome,
        "mana-consumable" => ContentItemUseKind::ManaConsumable,
        "dragon-egg" => ContentItemUseKind::DragonEgg,
        "dragon-module" => ContentItemUseKind::DragonModule,
        "lair-survey" => ContentItemUseKind::LairSurvey,
        "settlement-chart" => ContentItemUseKind::SettlementChart,
        "cardforge" => ContentItemUseKind::Cardforge,
        _ => {
            enum_value(
                record,
                path,
                value,
                &[
                    "net",
                    "release-creature",
                    "boat",
                    "creature-cage",
                    "capture-orb",
                    "magic-relic",
                    "plant",
                    "hoe",
                    "scythe",
                    "shears",
                    "bucket",
                    "lead",
                    "shield",
                    "blueprint",
                    "potion",
                    "ranged-weapon",
                    "spear",
                    "seed-pouch",
                    "spell-tome",
                    "mana-consumable",
                    "dragon-egg",
                    "dragon-module",
                    "lair-survey",
                    "settlement-chart",
                    "cardforge",
                ],
                blockers,
            );
            return None;
        }
    };
    Some(parsed)
}

fn parse_block_action_rng_semantics(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentBlockActionRngSemantics> {
    let base = "$.rngSemantics";
    let semantics = required_object_at(record, object, "rngSemantics", "$", blockers)?;
    Some(ContentBlockActionRngSemantics {
        algorithm: required_exact_string_at(record, semantics, "algorithm", base, "xorshift32", blockers)?.to_owned(),
        seed_derivation: required_exact_string_at(
            record,
            semantics,
            "seedDerivation",
            base,
            "blockwild-seed-stream-v1",
            blockers,
        )?
        .to_owned(),
        stream: required_exact_string_at(record, semantics, "stream", base, "block-action-loot-v1", blockers)?
            .to_owned(),
        unit: required_exact_string_at(record, semantics, "unit", base, "u32-open-upper-v1", blockers)?.to_owned(),
        ordering: required_exact_string_at(
            record,
            semantics,
            "ordering",
            base,
            "stable-profile-rule-order-v1",
            blockers,
        )?
        .to_owned(),
        random_drop_gate: required_exact_string_at(
            record,
            semantics,
            "randomDropGate",
            base,
            "less-than-or-equal-v1",
            blockers,
        )?
        .to_owned(),
        exclusive_selection: required_exact_string_at(
            record,
            semantics,
            "exclusiveSelection",
            base,
            "less-than-cumulative-v1",
            blockers,
        )?
        .to_owned(),
        plant_yield_clamp_maximum_millionths: u64::from(required_u32_at(
            record,
            semantics,
            "plantYieldClampMaximumMillionths",
            base,
            999_900,
            999_900,
            blockers,
        )?),
    })
}

const BLOCK_AUTHORITY_BLOCKERS: &[&str] = &[
    "authoritative-rng-context-unbound",
    "column-world-state-runtime",
    "dynamic-block-state-runtime",
    "dynamic-session-dispatch-runtime",
    "game-mode-host-custody-runtime",
    "legacy-computed-loot-source-runtime",
    "legacy-loot-item-reference-unresolved",
    "liquid-source-state-runtime",
    "network-topology-state-runtime",
    "paired-world-state-runtime",
    "player-luck-context-runtime",
    "rooted-tree-discovery-runtime",
    "world-support-collision-runtime",
];

fn parse_block_authority_blockers(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    base: &str,
    field: &str,
    required: bool,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Vec<String> {
    let path = field_path(base, field);
    let values = if required {
        required_array_at(record, object, field, base, blockers)
    } else {
        optional_array_at(record, object, field, base, blockers)
    };
    let Some(values) = values else {
        return Vec::new();
    };
    if values.len() > MAX_BLOCK_AUTHORITY_BLOCKERS {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::Capacity,
            ContentRuntimeStage::Invariants,
            &path,
            &format!("0..{MAX_BLOCK_AUTHORITY_BLOCKERS}"),
            &values.len().to_string(),
        ));
    }
    let mut parsed = Vec::new();
    let mut previous: Option<&str> = None;
    for (index, value) in values.iter().take(MAX_BLOCK_AUTHORITY_BLOCKERS).enumerate() {
        let item_path = format!("{path}[{index}]");
        let Some(value) = value.as_str() else {
            invalid_type(record, &item_path, "authority blocker string", value, blockers);
            continue;
        };
        if !BLOCK_AUTHORITY_BLOCKERS.contains(&value) {
            enum_value(record, &item_path, value, BLOCK_AUTHORITY_BLOCKERS, blockers);
            continue;
        }
        if previous.is_some_and(|prior| prior >= value) {
            blockers.push(for_record(
                record,
                ContentRuntimeBlockerCode::DescriptorMismatch,
                ContentRuntimeStage::Invariants,
                &item_path,
                "strict ascending unique authority blockers",
                value,
            ));
        }
        previous = Some(value);
        parsed.push(value.to_owned());
    }
    parsed
}

fn parse_block_loot_count(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentBlockLootCount> {
    let kind = required_nonempty_string_at(record, object, "kind", base, blockers)?;
    match kind {
        "constant" => {
            required_u32_at(record, object, "value", base, 1, u32::MAX, blockers).map(ContentBlockLootCount::Constant)
        }
        "uniform-inclusive" => {
            let minimum = required_u32_at(record, object, "minimum", base, 1, u32::MAX, blockers)?;
            let maximum = required_u32_at(record, object, "maximum", base, 1, u32::MAX, blockers)?;
            if minimum > maximum {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::Range,
                    ContentRuntimeStage::Invariants,
                    &field_path(base, "maximum"),
                    "maximum >= minimum",
                    &maximum.to_string(),
                ));
                return None;
            }
            Some(ContentBlockLootCount::UniformInclusive { minimum, maximum })
        }
        "shared-roll-formula" => {
            let base_count = required_u32_at(record, object, "base", base, 0, u32::MAX, blockers)?;
            let floor_roll_multiplier =
                required_u32_at(record, object, "floorRollMultiplier", base, 0, u32::MAX, blockers)?;
            let scythe_bonus = required_u32_at(record, object, "scytheBonus", base, 0, u32::MAX, blockers)?;
            let threshold_path = field_path(base, "thresholdBonuses");
            let values = required_array_at(record, object, "thresholdBonuses", base, blockers)?;
            if values.len() > MAX_BLOCK_LOOT_THRESHOLD_BONUSES {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::Capacity,
                    ContentRuntimeStage::Invariants,
                    &threshold_path,
                    &format!("0..{MAX_BLOCK_LOOT_THRESHOLD_BONUSES}"),
                    &values.len().to_string(),
                ));
            }
            let mut threshold_bonuses = Vec::new();
            let mut previous = None;
            for (index, value) in values.iter().take(MAX_BLOCK_LOOT_THRESHOLD_BONUSES).enumerate() {
                let item_base = format!("{threshold_path}[{index}]");
                let Some(value) = value.as_object() else {
                    invalid_type(record, &item_base, "threshold bonus object", value, blockers);
                    continue;
                };
                let above_millionths = required_u32_at(
                    record,
                    value,
                    "aboveMillionths",
                    &item_base,
                    0,
                    (CONTENT_ACTION_FIXED_SCALE - 1) as u32,
                    blockers,
                )
                .map(u64::from);
                let amount = required_u32_at(record, value, "amount", &item_base, 1, u32::MAX, blockers);
                let scythe_only = required_bool_at(record, value, "scytheOnly", &item_base, blockers);
                if let (Some(above_millionths), Some(amount), Some(scythe_only)) =
                    (above_millionths, amount, scythe_only)
                {
                    if previous.is_some_and(|prior| prior >= above_millionths) {
                        blockers.push(for_record(
                            record,
                            ContentRuntimeBlockerCode::DescriptorMismatch,
                            ContentRuntimeStage::Invariants,
                            &field_path(&item_base, "aboveMillionths"),
                            "strict ascending unique thresholds",
                            &above_millionths.to_string(),
                        ));
                    }
                    previous = Some(above_millionths);
                    threshold_bonuses.push(ContentBlockLootThresholdBonus {
                        above_millionths,
                        amount,
                        scythe_only,
                    });
                }
            }
            Some(ContentBlockLootCount::SharedRollFormula {
                base: base_count,
                floor_roll_multiplier,
                scythe_bonus,
                threshold_bonuses,
            })
        }
        _ => {
            enum_value(
                record,
                &field_path(base, "kind"),
                kind,
                &["constant", "uniform-inclusive", "shared-roll-formula"],
                blockers,
            );
            None
        }
    }
}

fn parse_block_loot_rule(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    base: &str,
    expected_ordinal: usize,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentBlockLootRule> {
    let ordinal = required_u32_at(record, object, "ordinal", base, 0, u16::MAX.into(), blockers)
        .and_then(|value| u16::try_from(value).ok())?;
    if usize::from(ordinal) != expected_ordinal {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            &field_path(base, "ordinal"),
            &expected_ordinal.to_string(),
            &ordinal.to_string(),
        ));
    }
    let id = required_nonempty_string_at(record, object, "id", base, blockers)?.to_owned();
    let item_code = required_u32_at(record, object, "item", base, 1, u32::MAX, blockers)?;
    push_reference(
        facts,
        ContentDomain::Item,
        item_code.to_string(),
        &field_path(base, "item"),
    );
    let chance_millionths = u64::from(required_u32_at(
        record,
        object,
        "chanceMillionths",
        base,
        1,
        CONTENT_ACTION_FIXED_SCALE as u32,
        blockers,
    )?);
    let chance_modifier = match required_nonempty_string_at(record, object, "chanceModifier", base, blockers)? {
        "none" => ContentBlockLootChanceModifier::None,
        "luck-adjusted-v1" => ContentBlockLootChanceModifier::LuckAdjustedV1,
        value => {
            enum_value(
                record,
                &field_path(base, "chanceModifier"),
                value,
                &["none", "luck-adjusted-v1"],
                blockers,
            );
            return None;
        }
    };
    let roll_scope = match required_nonempty_string_at(record, object, "rollScope", base, blockers)? {
        "none" => ContentBlockLootRollScope::None,
        "random-drop-v1" => ContentBlockLootRollScope::RandomDropV1,
        "shared-plant-yield" => ContentBlockLootRollScope::SharedPlantYield,
        "shared-exclusive" => ContentBlockLootRollScope::SharedExclusive,
        value => {
            enum_value(
                record,
                &field_path(base, "rollScope"),
                value,
                &["none", "random-drop-v1", "shared-plant-yield", "shared-exclusive"],
                blockers,
            );
            return None;
        }
    };
    let count_base = field_path(base, "count");
    let count_object = required_object_at(record, object, "count", base, blockers)?;
    let count = parse_block_loot_count(record, count_object, &count_base, blockers)?;
    if roll_scope == ContentBlockLootRollScope::None
        && (chance_millionths != CONTENT_ACTION_FIXED_SCALE || chance_modifier != ContentBlockLootChanceModifier::None)
    {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            base,
            "non-random rules have probability one and no modifier",
            &format!("{chance_millionths}:{chance_modifier:?}"),
        ));
    }
    if chance_modifier == ContentBlockLootChanceModifier::LuckAdjustedV1
        && roll_scope != ContentBlockLootRollScope::RandomDropV1
    {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            &field_path(base, "chanceModifier"),
            "luck adjustment only on random-drop-v1",
            "incompatible roll scope",
        ));
    }
    Some(ContentBlockLootRule {
        ordinal,
        id,
        item_code,
        chance_millionths,
        chance_modifier,
        roll_scope,
        count,
    })
}

fn parse_block_loot_profile(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    base: &str,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentBlockLootProfile> {
    let mode = match required_nonempty_string_at(record, object, "mode", base, blockers)? {
        "none" => ContentBlockLootMode::None,
        "all" => ContentBlockLootMode::All,
        "exclusive" => ContentBlockLootMode::Exclusive,
        value => {
            enum_value(
                record,
                &field_path(base, "mode"),
                value,
                &["none", "all", "exclusive"],
                blockers,
            );
            return None;
        }
    };
    let self_drop_mode = match required_nonempty_string_at(record, object, "selfDropMode", base, blockers)? {
        "absent" => ContentBlockSelfDropMode::Absent,
        "contextual" => ContentBlockSelfDropMode::Contextual,
        "mapped-item" => ContentBlockSelfDropMode::MappedItem,
        value => {
            enum_value(
                record,
                &field_path(base, "selfDropMode"),
                value,
                &["absent", "contextual", "mapped-item"],
                blockers,
            );
            return None;
        }
    };
    required_exact_string_at(record, object, "silkTouch", base, "not-authored", blockers)?;
    let rules_path = field_path(base, "rules");
    let values = required_array_at(record, object, "rules", base, blockers)?;
    if values.len() > MAX_BLOCK_LOOT_RULES {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::Capacity,
            ContentRuntimeStage::Invariants,
            &rules_path,
            &format!("0..{MAX_BLOCK_LOOT_RULES}"),
            &values.len().to_string(),
        ));
    }
    let mut rules = Vec::new();
    let mut ids = BTreeSet::new();
    for (index, value) in values.iter().take(MAX_BLOCK_LOOT_RULES).enumerate() {
        let rule_base = format!("{rules_path}[{index}]");
        let Some(value) = value.as_object() else {
            invalid_type(record, &rule_base, "loot rule object", value, blockers);
            continue;
        };
        if let Some(rule) = parse_block_loot_rule(record, value, &rule_base, index, facts, blockers) {
            if !ids.insert(rule.id.clone()) {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::Invariants,
                    &field_path(&rule_base, "id"),
                    "unique loot rule id",
                    &rule.id,
                ));
            }
            rules.push(rule);
        }
    }
    match mode {
        ContentBlockLootMode::None if !rules.is_empty() => blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            &rules_path,
            "no rules when loot mode is none",
            &rules.len().to_string(),
        )),
        ContentBlockLootMode::None if self_drop_mode != ContentBlockSelfDropMode::Absent => blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            &field_path(base, "selfDropMode"),
            "absent when loot mode is none",
            "non-absent",
        )),
        ContentBlockLootMode::All if rules.is_empty() => blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            &rules_path,
            "at least one rule when loot mode is all",
            "empty",
        )),
        ContentBlockLootMode::All
            if rules
                .iter()
                .any(|rule| rule.roll_scope == ContentBlockLootRollScope::SharedExclusive) =>
        {
            blockers.push(for_record(
                record,
                ContentRuntimeBlockerCode::DescriptorMismatch,
                ContentRuntimeStage::Invariants,
                &rules_path,
                "shared-exclusive rules only in exclusive mode",
                "shared-exclusive",
            ));
        }
        ContentBlockLootMode::Exclusive => {
            let chance_sum = rules.iter().map(|rule| rule.chance_millionths).sum::<u64>();
            if rules.len() < 2
                || chance_sum != CONTENT_ACTION_FIXED_SCALE
                || rules.iter().any(|rule| {
                    rule.roll_scope != ContentBlockLootRollScope::SharedExclusive
                        || rule.chance_modifier != ContentBlockLootChanceModifier::None
                })
            {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::Invariants,
                    &rules_path,
                    "two or more unmodified shared-exclusive rules totaling 1000000",
                    &format!("count={};chance={chance_sum}", rules.len()),
                ));
            }
        }
        _ => {}
    }
    Some(ContentBlockLootProfile {
        mode,
        self_drop_mode,
        silk_touch: ContentBlockSilkTouchPolicy::NotAuthored,
        rules,
    })
}

fn parse_block_break_profile(
    record: &DecodedRecord,
    profile: &BTreeMap<String, CanonicalJson>,
    profile_base: &str,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentBlockBreakProfile> {
    let base = field_path(profile_base, "breakProfile");
    let object = required_object_at(record, profile, "breakProfile", profile_base, blockers)?;
    let replacement = match required_nonempty_string_at(record, object, "replacement", &base, blockers)? {
        "blocked" => ContentBlockBreakReplacement::Blocked,
        "air" => ContentBlockBreakReplacement::Air,
        "paired-air" => ContentBlockBreakReplacement::PairedAir,
        "column-air" => ContentBlockBreakReplacement::ColumnAir,
        "column-water" => ContentBlockBreakReplacement::ColumnWater,
        "rooted-tree-or-air" => ContentBlockBreakReplacement::RootedTreeOrAir,
        value => {
            enum_value(
                record,
                &field_path(&base, "replacement"),
                value,
                &[
                    "blocked",
                    "air",
                    "paired-air",
                    "column-air",
                    "column-water",
                    "rooted-tree-or-air",
                ],
                blockers,
            );
            return None;
        }
    };
    let durability_base = field_path(&base, "durabilityCost");
    let durability = required_object_at(record, object, "durabilityCost", &base, blockers)?;
    let durability_cost = match required_nonempty_string_at(record, durability, "kind", &durability_base, blockers)? {
        "none" => ContentBlockDurabilityCost::None,
        "constant" => ContentBlockDurabilityCost::Constant(required_u32_at(
            record,
            durability,
            "amount",
            &durability_base,
            1,
            u32::MAX,
            blockers,
        )?),
        "rooted-tree-log-count" => {
            let minimum = required_u32_at(record, durability, "minimum", &durability_base, 1, u32::MAX, blockers)?;
            let divisor = required_u32_at(record, durability, "divisor", &durability_base, 1, u32::MAX, blockers)?;
            required_exact_string_at(record, durability, "rounding", &durability_base, "ceiling", blockers)?;
            ContentBlockDurabilityCost::RootedTreeLogCount { minimum, divisor }
        }
        value => {
            enum_value(
                record,
                &field_path(&durability_base, "kind"),
                value,
                &["none", "constant", "rooted-tree-log-count"],
                blockers,
            );
            return None;
        }
    };
    required_exact_string_at(record, object, "wrongTool", &base, "break-no-loot", blockers)?;
    let contextual_override = match required_nonempty_string_at(record, object, "contextualOverride", &base, blockers)?
    {
        "none" => ContentBlockContextualOverride::None,
        "rooted-tree-fall-runtime" => ContentBlockContextualOverride::RootedTreeFallRuntime,
        value => {
            enum_value(
                record,
                &field_path(&base, "contextualOverride"),
                value,
                &["none", "rooted-tree-fall-runtime"],
                blockers,
            );
            return None;
        }
    };
    let loot_base = field_path(&base, "loot");
    let loot = required_object_at(record, object, "loot", &base, blockers)
        .and_then(|loot| parse_block_loot_profile(record, loot, &loot_base, facts, blockers))?;
    let rooted = replacement == ContentBlockBreakReplacement::RootedTreeOrAir;
    if rooted
        != matches!(
            contextual_override,
            ContentBlockContextualOverride::RootedTreeFallRuntime
        )
        || rooted != matches!(durability_cost, ContentBlockDurabilityCost::RootedTreeLogCount { .. })
    {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            &base,
            "rooted replacement, override, and durability cost together",
            "inconsistent rooted-tree fields",
        ));
    }
    if (replacement == ContentBlockBreakReplacement::Blocked)
        != matches!(durability_cost, ContentBlockDurabilityCost::None)
    {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            &durability_base,
            "none exactly for blocked breaks",
            "inconsistent blocked durability",
        ));
    }
    Some(ContentBlockBreakProfile {
        replacement,
        durability_cost,
        wrong_tool: ContentBlockWrongToolPolicy::BreakNoLoot,
        contextual_override,
        loot,
    })
}

fn parse_block_harvest_intent(
    record: &DecodedRecord,
    profile: &BTreeMap<String, CanonicalJson>,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentBlockHarvestIntent> {
    let object = optional_object_at(record, profile, "harvestIntent", base, blockers)?;
    let intent_base = field_path(base, "harvestIntent");
    Some(ContentBlockHarvestIntent {
        replacement_without_scythe: required_u32_at(
            record,
            object,
            "replacementWithoutScythe",
            &intent_base,
            0,
            u16::MAX.into(),
            blockers,
        )
        .and_then(|value| u16::try_from(value).ok())?,
        replacement_with_scythe: required_u32_at(
            record,
            object,
            "replacementWithScythe",
            &intent_base,
            0,
            u16::MAX.into(),
            blockers,
        )
        .and_then(|value| u16::try_from(value).ok())?,
        replanted_without_scythe: required_bool_at(record, object, "replantedWithoutScythe", &intent_base, blockers)?,
        replanted_with_scythe: required_bool_at(record, object, "replantedWithScythe", &intent_base, blockers)?,
        preserve_cultivated: required_bool_at(record, object, "preserveCultivated", &intent_base, blockers)?,
        scythe_durability_cost: required_u32_at(
            record,
            object,
            "scytheDurabilityCost",
            &intent_base,
            0,
            u32::MAX,
            blockers,
        )?,
    })
}

fn parse_block_placement_intent(
    record: &DecodedRecord,
    profile: &BTreeMap<String, CanonicalJson>,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentBlockPlacementIntent> {
    let value = required_nonempty_string_at(record, profile, "placementIntent", base, blockers)?;
    let parsed = match value {
        "none" => ContentBlockPlacementIntent::None,
        "direct" => ContentBlockPlacementIntent::Direct,
        "directional" => ContentBlockPlacementIntent::Directional,
        "attached-torch" => ContentBlockPlacementIntent::AttachedTorch,
        "paired-door" => ContentBlockPlacementIntent::PairedDoor,
        "paired-bed" => ContentBlockPlacementIntent::PairedBed,
        "oriented-gate" => ContentBlockPlacementIntent::OrientedGate,
        "bounded-network" => ContentBlockPlacementIntent::BoundedNetwork,
        "sapling" => ContentBlockPlacementIntent::Sapling,
        _ => {
            enum_value(
                record,
                &field_path(base, "placementIntent"),
                value,
                &[
                    "none",
                    "direct",
                    "directional",
                    "attached-torch",
                    "paired-door",
                    "paired-bed",
                    "oriented-gate",
                    "bounded-network",
                    "sapling",
                ],
                blockers,
            );
            return None;
        }
    };
    Some(parsed)
}

fn parse_block_placement_items(
    record: &DecodedRecord,
    profile: &BTreeMap<String, CanonicalJson>,
    base: &str,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Vec<u32> {
    let path = field_path(base, "placementItems");
    let Some(values) = optional_array_at(record, profile, "placementItems", base, blockers) else {
        return Vec::new();
    };
    if values.len() > MAX_BLOCK_ACTION_INTENTS {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::Capacity,
            ContentRuntimeStage::Invariants,
            &path,
            &format!("0..{MAX_BLOCK_ACTION_INTENTS}"),
            &values.len().to_string(),
        ));
    }
    let mut items = Vec::new();
    let mut previous = None;
    for (index, value) in values.iter().take(MAX_BLOCK_ACTION_INTENTS).enumerate() {
        let item_path = format!("{path}[{index}]");
        let Some(item) = json_u32(value, 1, u32::MAX) else {
            invalid_type(record, &item_path, "positive item code", value, blockers);
            continue;
        };
        if previous.is_some_and(|prior| prior >= item) {
            blockers.push(for_record(
                record,
                ContentRuntimeBlockerCode::DescriptorMismatch,
                ContentRuntimeStage::Invariants,
                &item_path,
                "strict ascending unique placement item codes",
                &item.to_string(),
            ));
        }
        previous = Some(item);
        push_reference(facts, ContentDomain::Item, item.to_string(), &item_path);
        items.push(item);
    }
    items
}

fn parse_block_interaction_intent(
    record: &DecodedRecord,
    path: &str,
    value: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Option<ContentBlockInteractionIntent> {
    let parsed = match value {
        "harvest" => ContentBlockInteractionIntent::Harvest,
        "till" => ContentBlockInteractionIntent::Till,
        "plant" => ContentBlockInteractionIntent::Plant,
        "bucket" => ContentBlockInteractionIntent::Bucket,
        "fill-bottle" => ContentBlockInteractionIntent::FillBottle,
        "toggle-gate" => ContentBlockInteractionIntent::ToggleGate,
        "hitch-lead" => ContentBlockInteractionIntent::HitchLead,
        "toggle-door" => ContentBlockInteractionIntent::ToggleDoor,
        "sleep-session" => ContentBlockInteractionIntent::SleepSession,
        "seat" => ContentBlockInteractionIntent::Seat,
        "archive-shelf-session" => ContentBlockInteractionIntent::ArchiveShelfSession,
        "crafting-session" => ContentBlockInteractionIntent::CraftingSession,
        "furnace-session" => ContentBlockInteractionIntent::FurnaceSession,
        "wheat-mill-session" => ContentBlockInteractionIntent::WheatMillSession,
        "chest-session" => ContentBlockInteractionIntent::ChestSession,
        "apiary-session" => ContentBlockInteractionIntent::ApiarySession,
        "morph-loom-session" => ContentBlockInteractionIntent::MorphLoomSession,
        "orb-rack-session" => ContentBlockInteractionIntent::OrbRackSession,
        "healing-station-session" => ContentBlockInteractionIntent::HealingStationSession,
        "aquarium-session" => ContentBlockInteractionIntent::AquariumSession,
        "field-perch-session" => ContentBlockInteractionIntent::FieldPerchSession,
        "waygrid-items-session" => ContentBlockInteractionIntent::WaygridItemsSession,
        "waygrid-creatures-session" => ContentBlockInteractionIntent::WaygridCreaturesSession,
        "golem-forge-session" => ContentBlockInteractionIntent::GolemForgeSession,
        "exhibit-session" => ContentBlockInteractionIntent::ExhibitSession,
        "cartography-session" => ContentBlockInteractionIntent::CartographySession,
        "alchemy-session" => ContentBlockInteractionIntent::AlchemySession,
        "distillery-session" => ContentBlockInteractionIntent::DistillerySession,
        "sugarworks-session" => ContentBlockInteractionIntent::SugarworksSession,
        "map-session" => ContentBlockInteractionIntent::MapSession,
        "incubator-session" => ContentBlockInteractionIntent::IncubatorSession,
        "lift" => ContentBlockInteractionIntent::Lift,
        "tome-display-session" => ContentBlockInteractionIntent::TomeDisplaySession,
        "wayfinder-session" => ContentBlockInteractionIntent::WayfinderSession,
        _ => {
            enum_value(
                record,
                path,
                value,
                &[
                    "harvest",
                    "till",
                    "plant",
                    "bucket",
                    "fill-bottle",
                    "toggle-gate",
                    "hitch-lead",
                    "toggle-door",
                    "sleep-session",
                    "seat",
                    "archive-shelf-session",
                    "crafting-session",
                    "furnace-session",
                    "wheat-mill-session",
                    "chest-session",
                    "apiary-session",
                    "morph-loom-session",
                    "orb-rack-session",
                    "healing-station-session",
                    "aquarium-session",
                    "field-perch-session",
                    "waygrid-items-session",
                    "waygrid-creatures-session",
                    "golem-forge-session",
                    "exhibit-session",
                    "cartography-session",
                    "alchemy-session",
                    "distillery-session",
                    "sugarworks-session",
                    "map-session",
                    "incubator-session",
                    "lift",
                    "tome-display-session",
                    "wayfinder-session",
                ],
                blockers,
            );
            return None;
        }
    };
    Some(parsed)
}

fn parse_block_interaction_intents(
    record: &DecodedRecord,
    profile: &BTreeMap<String, CanonicalJson>,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Vec<ContentBlockInteractionIntent> {
    let path = field_path(base, "interactionIntents");
    let Some(values) = optional_array_at(record, profile, "interactionIntents", base, blockers) else {
        return Vec::new();
    };
    if values.len() > MAX_BLOCK_ACTION_INTENTS {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::Capacity,
            ContentRuntimeStage::Invariants,
            &path,
            &format!("0..{MAX_BLOCK_ACTION_INTENTS}"),
            &values.len().to_string(),
        ));
    }
    let mut intents = Vec::new();
    let mut seen = BTreeSet::new();
    for (index, value) in values.iter().take(MAX_BLOCK_ACTION_INTENTS).enumerate() {
        let item_path = format!("{path}[{index}]");
        let Some(value) = value.as_str() else {
            invalid_type(record, &item_path, "interaction intent string", value, blockers);
            continue;
        };
        if let Some(intent) = parse_block_interaction_intent(record, &item_path, value, blockers) {
            if !seen.insert(intent) {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::Invariants,
                    &item_path,
                    "unique interaction intents",
                    value,
                ));
            }
            intents.push(intent);
        }
    }
    intents
}

fn parse_block_planting_rules(
    record: &DecodedRecord,
    profile: &BTreeMap<String, CanonicalJson>,
    base: &str,
    facts: &mut RecordFacts,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> Vec<ContentBlockPlantingRule> {
    let path = field_path(base, "plantingRules");
    let Some(values) = optional_array_at(record, profile, "plantingRules", base, blockers) else {
        return Vec::new();
    };
    if values.len() > MAX_BLOCK_PLANTING_RULES {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::Capacity,
            ContentRuntimeStage::Invariants,
            &path,
            &format!("0..{MAX_BLOCK_PLANTING_RULES}"),
            &values.len().to_string(),
        ));
    }
    let mut rules = Vec::new();
    let mut previous = None;
    for (index, value) in values.iter().take(MAX_BLOCK_PLANTING_RULES).enumerate() {
        let item_base = format!("{path}[{index}]");
        let Some(value) = value.as_object() else {
            invalid_type(record, &item_base, "planting rule object", value, blockers);
            continue;
        };
        let item_code = required_u32_at(record, value, "item", &item_base, 1, u32::MAX, blockers);
        let above =
            required_nonempty_string_at(record, value, "above", &item_base, blockers).and_then(|value| match value {
                "air" => Some(ContentBlockPlantAbove::Air),
                "replaceable-dry" => Some(ContentBlockPlantAbove::ReplaceableDry),
                "water-source" => Some(ContentBlockPlantAbove::WaterSource),
                _ => {
                    enum_value(
                        record,
                        &field_path(&item_base, "above"),
                        value,
                        &["air", "replaceable-dry", "water-source"],
                        blockers,
                    );
                    None
                }
            });
        let result_block = required_u32_at(record, value, "resultBlock", &item_base, 0, u16::MAX.into(), blockers)
            .and_then(|value| u16::try_from(value).ok());
        if let (Some(item_code), Some(above), Some(result_block)) = (item_code, above, result_block) {
            let order = (item_code, above);
            if previous.is_some_and(|prior| prior >= order) {
                blockers.push(for_record(
                    record,
                    ContentRuntimeBlockerCode::DescriptorMismatch,
                    ContentRuntimeStage::Invariants,
                    &item_base,
                    "strict item/above order with unique planting rules",
                    &format!("{item_code}:{above:?}"),
                ));
            }
            previous = Some(order);
            push_reference(
                facts,
                ContentDomain::Item,
                item_code.to_string(),
                &field_path(&item_base, "item"),
            );
            rules.push(ContentBlockPlantingRule {
                item_code,
                above,
                result_block,
            });
        }
    }
    rules
}

fn parse_topology_flags(
    record: &DecodedRecord,
    object: &BTreeMap<String, CanonicalJson>,
    base: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) -> u16 {
    let path = field_path(base, "topologyFlags");
    let Some(value) = object.get("topologyFlags") else {
        missing_field(record, &path, "array", blockers);
        return 0;
    };
    let Some(values) = value.as_array() else {
        invalid_type(record, &path, "array", value, blockers);
        return 0;
    };
    let mut flags = 0_u16;
    for (index, value) in values.iter().enumerate() {
        let item_path = format!("{path}[{index}]");
        let Some(value) = value.as_str() else {
            invalid_type(record, &item_path, "topology flag string", value, blockers);
            continue;
        };
        let flag = match value {
            "directional" => BLOCK_TOPOLOGY_DIRECTIONAL,
            "paired" => BLOCK_TOPOLOGY_PAIRED,
            "attached" => BLOCK_TOPOLOGY_ATTACHED,
            "vertical-connected" => BLOCK_TOPOLOGY_VERTICAL_CONNECTED,
            "horizontal-connected" => BLOCK_TOPOLOGY_HORIZONTAL_CONNECTED,
            "waterlogged" => BLOCK_TOPOLOGY_WATERLOGGED,
            "bounded-network" => BLOCK_TOPOLOGY_BOUNDED_NETWORK,
            _ => {
                enum_value(
                    record,
                    &item_path,
                    value,
                    &[
                        "directional",
                        "paired",
                        "attached",
                        "vertical-connected",
                        "horizontal-connected",
                        "waterlogged",
                        "bounded-network",
                    ],
                    blockers,
                );
                continue;
            }
        };
        if flags & flag != 0 {
            blockers.push(for_record(
                record,
                ContentRuntimeBlockerCode::DescriptorMismatch,
                ContentRuntimeStage::Invariants,
                &item_path,
                "unique topology flags",
                value,
            ));
        }
        flags |= flag;
    }
    flags
}

fn validate_topology_consistency(
    record: &DecodedRecord,
    base: &str,
    topology_flags: u16,
    vertical_connect_group: Option<&str>,
    connect_group: Option<&str>,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    let has_vertical_flag = topology_flags & BLOCK_TOPOLOGY_VERTICAL_CONNECTED != 0;
    if has_vertical_flag != vertical_connect_group.is_some() {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            &field_path(base, "verticalConnectGroup"),
            "vertical-connected flag exactly when a vertical group is present",
            vertical_connect_group.unwrap_or("missing"),
        ));
    }
    let has_horizontal_flag = topology_flags & BLOCK_TOPOLOGY_HORIZONTAL_CONNECTED != 0;
    if has_horizontal_flag != connect_group.is_some() {
        blockers.push(for_record(
            record,
            ContentRuntimeBlockerCode::DescriptorMismatch,
            ContentRuntimeStage::Invariants,
            &field_path(base, "connectGroup"),
            "horizontal-connected flag exactly when a connect group is present",
            connect_group.unwrap_or("missing"),
        ));
    }
}

fn seconds_to_millis(seconds: f64) -> u64 {
    (seconds * 1_000.0).round() as u64
}

fn strip_prefix<'a>(value: &'a str, prefix: &str) -> &'a str {
    value.strip_prefix(prefix).unwrap_or(value)
}

fn valid_symbol(value: &str) -> bool {
    !value.is_empty() && value.len() <= 160 && !value.chars().any(char::is_control)
}

fn valid_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn json_u32(value: &CanonicalJson, minimum: u32, maximum: u32) -> Option<u32> {
    value
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| (*value >= minimum) && (*value <= maximum))
}

fn field_path(base: &str, field: &str) -> String {
    if base == "$" {
        format!("$.{field}")
    } else {
        format!("{base}.{field}")
    }
}

fn json_kind(value: &CanonicalJson) -> &'static str {
    match value {
        CanonicalJson::Null => "null",
        CanonicalJson::Bool(_) => "boolean",
        CanonicalJson::Number(_) => "number",
        CanonicalJson::String(_) => "string",
        CanonicalJson::Array(_) => "array",
        CanonicalJson::Object(_) => "object",
    }
}

fn missing_field(record: &DecodedRecord, path: &str, expected: &str, blockers: &mut Vec<ContentRuntimeBlocker>) {
    blockers.push(for_record(
        record,
        ContentRuntimeBlockerCode::MissingField,
        ContentRuntimeStage::Invariants,
        path,
        expected,
        "missing",
    ));
}

fn invalid_type(
    record: &DecodedRecord,
    path: &str,
    expected: &str,
    actual: &CanonicalJson,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    blockers.push(for_record(
        record,
        ContentRuntimeBlockerCode::InvalidType,
        ContentRuntimeStage::Invariants,
        path,
        expected,
        json_kind(actual),
    ));
}

fn invalid_value(
    record: &DecodedRecord,
    path: &str,
    expected: &str,
    actual: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    blockers.push(for_record(
        record,
        ContentRuntimeBlockerCode::Range,
        ContentRuntimeStage::Invariants,
        path,
        expected,
        actual,
    ));
}

fn resource_error(
    record: &DecodedRecord,
    path: &str,
    expected: &str,
    actual: &str,
    blockers: &mut Vec<ContentRuntimeBlocker>,
) {
    blockers.push(for_record(
        record,
        ContentRuntimeBlockerCode::ResourceConservation,
        ContentRuntimeStage::Invariants,
        path,
        expected,
        actual,
    ));
}

fn for_record(
    record: &DecodedRecord,
    code: ContentRuntimeBlockerCode,
    stage: ContentRuntimeStage,
    path: &str,
    expected: &str,
    actual: &str,
) -> ContentRuntimeBlocker {
    runtime_blocker(
        code,
        stage,
        Some(record.domain),
        Some(record.id.clone()),
        path,
        Some(expected.to_owned()),
        Some(actual.to_owned()),
    )
}

fn runtime_blocker(
    code: ContentRuntimeBlockerCode,
    stage: ContentRuntimeStage,
    domain: Option<ContentDomain>,
    id: Option<String>,
    path: &str,
    expected: Option<String>,
    actual: Option<String>,
) -> ContentRuntimeBlocker {
    ContentRuntimeBlocker {
        code,
        stage,
        domain,
        id,
        path: path.to_owned(),
        expected,
        actual,
    }
}

fn sort_blockers(blockers: &mut [ContentRuntimeBlocker]) {
    blockers.sort_by(|left, right| {
        (left.stage, left.domain, &left.id, &left.path, left.code).cmp(&(
            right.stage,
            right.domain,
            &right.id,
            &right.path,
            right.code,
        ))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ContentArtifact, compile_content_bundle, install_content_bundle};

    fn artifact(domain: ContentDomain, id: &str, schema: &str, version: u16, json: &str) -> ContentArtifact {
        ContentArtifact {
            domain,
            id: id.to_owned(),
            schema_id: schema.to_owned(),
            schema_version: version,
            content_version: 1,
            aliases: vec![format!("{}:{id}", domain.as_id())],
            canonical_bytes: json.as_bytes().to_vec(),
            unknown_extension_bytes: if id == "1" || id == "player:standing" {
                vec![0, 0x80, 0xff, 7]
            } else {
                Vec::new()
            },
        }
    }

    fn reference_fixture() -> Vec<ContentArtifact> {
        vec![
            artifact(
                ContentDomain::Item,
                "1",
                "item-definition",
                1,
                r##"{"color":"#68a341","id":1,"maxStack":64,"name":"Grass Block"}"##,
            ),
            artifact(
                ContentDomain::Item,
                "2",
                "item-definition",
                1,
                r##"{"color":"#895b35","id":2,"maxStack":64,"name":"Board"}"##,
            ),
            artifact(
                ContentDomain::CraftingRecipe,
                "board",
                "crafting-recipe",
                1,
                r#"{"height":1,"id":"board","name":"Board","output":{"count":1,"item":2},"pattern":[1],"width":1}"#,
            ),
            artifact(
                ContentDomain::MachineRecipe,
                "furnace:1",
                "furnace-recipe",
                1,
                r#"{"inputItem":1,"output":{"count":1,"item":2}}"#,
            ),
            artifact(
                ContentDomain::MachineProfile,
                "furnace",
                "machine-profile",
                1,
                r#"{"inputItemIds":[1]}"#,
            ),
            artifact(
                ContentDomain::AbilitySpell,
                "move:gust",
                "creature-move",
                1,
                r#"{"activeSeconds":0.1,"channel":"physical","cooldownSeconds":1,"exertionCost":0,"id":"gust","name":"Gust","packets":[{"share":1,"type":"wild"}],"power":1,"radius":1,"range":2,"recoverySeconds":0.2,"shape":"contact","target":"hostile","type":"wild","verticalTolerance":1,"windupSeconds":0.2,"worldImpact":"visual"}"#,
            ),
            artifact(
                ContentDomain::CreatureProfile,
                "fox",
                "creature-profile",
                1,
                r#"{"captureProfile":"gentle","kind":"fox","moves":{"basicMoveId":"gust","unlocks":[{"level":1,"moveId":"gust"}]},"naturalTypes":["wild"],"stats":{"maximumLevel":50}}"#,
            ),
            artifact(
                ContentDomain::CreatureProfile,
                "player:standing",
                "player-render-profile",
                1,
                r#"{"catalog":{"byteLength":785824,"canonicalHash":"52fd4aebb0c457f3c83af79af6b83c93","format":"blockwild-compiled-model-catalog-v2","modelCount":252,"nodeCount":13121,"revision":1,"schema":2,"sha256":"12c522f880e94c1ae527de701ae3e710fee13701d66fbb0a4ad24895557011b4","source":"renderer-neutral model specs and offline production captures"},"model":{"category":2,"groundY":0,"id":"player-standing","label":"Player · Standing","nodeCount":25,"pose":"standing"},"role":"player","schema":1}"#,
            ),
            artifact(
                ContentDomain::CreatureTypeChart,
                "type:wild",
                "creature-type",
                1,
                r##"{"color":"#5a9d55","glyph":"W","id":"wild","name":"Wild"}"##,
            ),
            artifact(
                ContentDomain::CreatureTypeChart,
                "chart:wild",
                "creature-type-chart",
                1,
                r#"{"resistedBy":[],"strongAgainst":[]}"#,
            ),
            artifact(
                ContentDomain::QuestGuild,
                "faction:field",
                "faction-definition",
                1,
                r#"{"id":"field","name":"Field Folk","race":"human"}"#,
            ),
            artifact(
                ContentDomain::Economy,
                "commerce:grass",
                "commerce-item",
                1,
                r#"{"baseValue":1,"category":"material","key":"grass","name":"Grass","stackLimit":64}"#,
            ),
            artifact(
                ContentDomain::CardforgeCard,
                "definition:card:test",
                "tcg-card-definition",
                1,
                r#"{"abilities":[],"class":"creature","cost":1,"id":"card:test","name":"Field Fox","primaryType":"wild","rarity":"common","rulesRevision":1,"schema":1,"secondaryTypes":[]}"#,
            ),
            artifact(
                ContentDomain::CardforgePack,
                "set:test",
                "tcg-set",
                1,
                r#"{"id":"test","name":"Test Set","symbol":"T"}"#,
            ),
        ]
    }

    fn render_presentation_fixture() -> Vec<ContentArtifact> {
        let mut artifacts = reference_fixture();
        let mut catalog = artifact(
            ContentDomain::MachineProfile,
            RENDER_PRESENTATION_CATALOG_ID,
            "render-presentation-catalog",
            1,
            r#"{"catalog":{"byteLength":785824,"canonicalHash":"52fd4aebb0c457f3c83af79af6b83c93","format":"blockwild-compiled-model-catalog-v2","modelCount":252,"nodeCount":13121,"revision":1,"schema":2,"sha256":"12c522f880e94c1ae527de701ae3e710fee13701d66fbb0a4ad24895557011b4","source":"renderer-neutral model specs and offline production captures"},"integrationBlockers":["dropped-item-r6-model-binding-runtime","machine-world-view-presentation-binding-runtime"],"missingProfiles":[{"contentRefs":[{"domain":"item","id":"2"}],"id":"missing:world-prop:board","reason":"No exact BWM2 identity is authored for this fixture item.","role":"world-prop","sourcePresentationIds":["fixture:board"]}],"profiles":[{"contentRefs":[{"domain":"item","id":"1"}],"id":"held:survey-pick","model":{"category":0,"groundYBits":null,"id":"held-pickaxe","label":"Stone Pickaxe","nodeCount":5},"role":"held-item"},{"contentRefs":[{"domain":"machine-profile","id":"furnace"}],"id":"machine:furnace","model":{"category":3,"groundYBits":null,"id":"stone-block","label":"Stone Block","nodeCount":1},"role":"machine"},{"contentRefs":[{"domain":"ability-spell","id":"move:gust"},{"domain":"creature-profile","id":"fox"}],"id":"summon:fox","model":{"category":1,"groundYBits":0,"id":"fox","label":"Fox","nodeCount":16},"role":"summon"}],"schema":1}"#,
        );
        catalog.unknown_extension_bytes = vec![0, 0x80, 0xff, 13];
        artifacts.push(catalog);
        artifacts
    }

    fn action_fixture() -> Vec<ContentArtifact> {
        let item = artifact(
            ContentDomain::Item,
            "1",
            "item-definition",
            1,
            r##"{"bucketLiquid":"water","color":"#68a341","food":2,"id":1,"infiniteDurability":true,"maxDurability":99,"maxStack":1,"miningSpeed":1.25,"name":"Survey Pick","placeBlock":1,"tier":2,"toolKind":"pickaxe","useKind":"bucket"}"##,
        );
        let mut catalog = artifact(
            ContentDomain::Item,
            BLOCK_ACTION_CATALOG_ID,
            "block-action-catalog",
            1,
            r#"{"profiles":[{"hardness":0,"id":0,"preferredTool":"hand","replaceable":true,"requiredTier":0,"solid":false,"topologyFlags":[]},{"collisionHeight":1.25,"connectGroup":"fence","hardness":0.9,"id":1,"item":1,"preferredTool":"pickaxe","replaceable":false,"requiredTier":2,"shape":"fence","solid":true,"topologyFlags":["horizontal-connected"]}],"schema":1}"#,
        );
        catalog.unknown_extension_bytes = vec![0, 0x80, 0xff, 9];
        vec![item, catalog]
    }

    fn contextual_action_fixture() -> Vec<ContentArtifact> {
        let place_item = artifact(
            ContentDomain::Item,
            "1",
            "item-definition",
            1,
            r##"{"color":"#68a341","damage":3,"fuel":4,"id":1,"maxDurability":99,"maxStack":1,"miningSpeed":1.25,"name":"Survey Pick","placeBlock":1,"tier":2,"toolKind":"pickaxe"}"##,
        );
        let plant_item = artifact(
            ContentDomain::Item,
            "2",
            "item-definition",
            1,
            r##"{"color":"#895b35","id":2,"maxStack":64,"name":"Test Seed","plantBlock":1,"useKind":"plant"}"##,
        );
        let ranged_item = artifact(
            ContentDomain::Item,
            "3",
            "item-definition",
            1,
            r##"{"ammoItem":1,"color":"#345678","damage":7,"id":3,"magazineSize":1,"maxDurability":50,"maxStack":1,"name":"Test Bow","toolKind":"bow","useKind":"ranged-weapon"}"##,
        );
        let mut catalog = artifact(
            ContentDomain::Item,
            BLOCK_ACTION_CATALOG_ID,
            "block-action-catalog",
            2,
            r#"{"authorityBlockers":["authoritative-rng-context-unbound","dynamic-session-dispatch-runtime","game-mode-host-custody-runtime","legacy-computed-loot-source-runtime","world-support-collision-runtime"],"profiles":[{"breakProfile":{"contextualOverride":"none","durabilityCost":{"kind":"none"},"loot":{"mode":"none","rules":[],"selfDropMode":"absent","silkTouch":"not-authored"},"replacement":"blocked","wrongTool":"break-no-loot"},"hardness":0,"id":0,"placementIntent":"none","preferredTool":"hand","replaceable":true,"requiredTier":0,"solid":false,"topologyFlags":[]},{"authorityBlockers":["authoritative-rng-context-unbound"],"breakProfile":{"contextualOverride":"none","durabilityCost":{"amount":1,"kind":"constant"},"loot":{"mode":"all","rules":[{"chanceMillionths":1000000,"chanceModifier":"none","count":{"base":2,"floorRollMultiplier":2,"kind":"shared-roll-formula","scytheBonus":1,"thresholdBonuses":[{"aboveMillionths":560000,"amount":1,"scytheOnly":false}]},"id":"produce","item":1,"ordinal":0,"rollScope":"shared-plant-yield"},{"chanceMillionths":1000000,"chanceModifier":"none","count":{"kind":"constant","value":1},"id":"seed","item":2,"ordinal":1,"rollScope":"shared-plant-yield"}],"selfDropMode":"contextual","silkTouch":"not-authored"},"replacement":"air","wrongTool":"break-no-loot"},"hardness":0.5,"harvestIntent":{"preserveCultivated":true,"replacementWithScythe":1,"replacementWithoutScythe":1,"replantedWithScythe":true,"replantedWithoutScythe":true,"scytheDurabilityCost":1},"id":1,"interactionIntents":["harvest","plant"],"item":1,"placementIntent":"direct","placementItems":[1],"plantingRules":[{"above":"air","item":2,"resultBlock":1}],"preferredTool":"pickaxe","replaceable":false,"requiredTier":2,"solid":true,"topologyFlags":[]},{"authorityBlockers":["authoritative-rng-context-unbound","player-luck-context-runtime"],"breakProfile":{"contextualOverride":"none","durabilityCost":{"amount":1,"kind":"constant"},"loot":{"mode":"all","rules":[{"chanceMillionths":220000,"chanceModifier":"luck-adjusted-v1","count":{"kind":"uniform-inclusive","maximum":2,"minimum":1},"id":"fiber","item":1,"ordinal":0,"rollScope":"random-drop-v1"}],"selfDropMode":"contextual","silkTouch":"not-authored"},"replacement":"air","wrongTool":"break-no-loot"},"hardness":0.1,"id":2,"placementIntent":"none","preferredTool":"hand","replaceable":true,"requiredTier":0,"solid":false,"topologyFlags":[]},{"authorityBlockers":["authoritative-rng-context-unbound"],"breakProfile":{"contextualOverride":"none","durabilityCost":{"amount":1,"kind":"constant"},"loot":{"mode":"exclusive","rules":[{"chanceMillionths":160000,"chanceModifier":"none","count":{"kind":"constant","value":1},"id":"first","item":1,"ordinal":0,"rollScope":"shared-exclusive"},{"chanceMillionths":840000,"chanceModifier":"none","count":{"kind":"constant","value":1},"id":"second","item":2,"ordinal":1,"rollScope":"shared-exclusive"}],"selfDropMode":"contextual","silkTouch":"not-authored"},"replacement":"air","wrongTool":"break-no-loot"},"hardness":0.2,"id":3,"placementIntent":"none","preferredTool":"hand","replaceable":true,"requiredTier":0,"solid":false,"topologyFlags":[]}],"rngSemantics":{"algorithm":"xorshift32","exclusiveSelection":"less-than-cumulative-v1","ordering":"stable-profile-rule-order-v1","plantYieldClampMaximumMillionths":999900,"randomDropGate":"less-than-or-equal-v1","seedDerivation":"blockwild-seed-stream-v1","stream":"block-action-loot-v1","unit":"u32-open-upper-v1"},"schema":2}"#,
        );
        catalog.unknown_extension_bytes = vec![0, 0x80, 0xff, 11];
        vec![place_item, plant_item, ranged_item, catalog]
    }

    fn installed(artifacts: Vec<ContentArtifact>) -> (ProductionContentManifest, MetadataBlobStore) {
        let bundle = compile_content_bundle("content-runtime-fixture-v1", artifacts).expect("fixture compiles");
        let mut store = MetadataBlobStore::default();
        install_content_bundle(&bundle, &mut store).expect("fixture installs");
        (bundle.manifest, store)
    }

    fn resign_manifest(manifest: &mut ProductionContentManifest) {
        for domain in ALL_CONTENT_DOMAINS {
            let entries = manifest
                .entries
                .iter()
                .filter(|entry| entry.domain == domain)
                .collect::<Vec<_>>();
            let mut hasher = CanonicalHasher::new("blockwild.gameplay.content-domain.v1");
            hasher.write_str(domain.as_id());
            hasher.write_u64(entries.len() as u64);
            for entry in &entries {
                hasher.write_str(&entry.id);
                hasher.write_bytes(entry.blob_hash.as_bytes());
                hasher.write_u32(entry.byte_length);
            }
            let digest = manifest.domains.get_mut(&domain).expect("all domains declared");
            digest.count = entries.len() as u32;
            digest.hash = hasher.finish();
        }
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.content-manifest.v1");
        hasher.write_u16(CONTENT_MANIFEST_SCHEMA_VERSION);
        hasher.write_str(&manifest.source_revision);
        hasher.write_u64(manifest.domains.len() as u64);
        for (domain, digest) in &manifest.domains {
            hasher.write_str(domain.as_id());
            hasher.write_u32(digest.count);
            hasher.write_bytes(digest.hash.as_bytes());
        }
        manifest.manifest_hash = hasher.finish();
    }

    #[test]
    fn all_domains_materialize_with_exact_opaque_bytes() {
        let (manifest, store) = installed(reference_fixture());
        let (registry, report) = materialize_content_runtime(&manifest, &store).expect("valid registry");
        assert_eq!(registry.len(), 14);
        assert_eq!(report.installed_entries, 14);
        assert_eq!(report.completed_stages, CONTENT_RUNTIME_STAGES);
        assert_eq!(registry.items["1"].core.unknown_extension_bytes, [0, 0x80, 0xff, 7]);
        assert_eq!(registry.crafting_recipes["board"].core.resources.inputs[0].amount, 1);
        assert_eq!(registry.creature_profiles["fox"].natural_types, ["wild"]);
        let player = &registry.player_render_profiles["player:standing"];
        assert_eq!(player.model_id, "player-standing");
        assert_eq!(player.model_label, "Player · Standing");
        assert_eq!(player.model_pose, "standing");
        assert_eq!(
            player.catalog_sha256,
            "12c522f880e94c1ae527de701ae3e710fee13701d66fbb0a4ad24895557011b4"
        );
        assert_eq!(player.core.unknown_extension_bytes, [0, 0x80, 0xff, 7]);
        assert!(!registry.creature_profiles.contains_key("player:standing"));
        assert_eq!(registry.get_by_alias("item:1").expect("alias").id, "1");
        let exact = include_str!("../fixtures/content-runtime-v1.txt");
        let expected = [
            format!("schema={}", report.schema_version),
            format!("entries={}", report.installed_entries),
            format!("manifest={}", report.manifest_hash.to_hex()),
            format!("registry={}", report.registry_hash.to_hex()),
            format!("references={}", report.references),
            format!("executable_bytes={}", report.executable_bytes),
            format!("opaque_extension_bytes={}", report.opaque_extension_bytes),
        ]
        .join("\n")
            + "\n";
        assert_eq!(exact, expected);
    }

    #[test]
    fn install_is_atomic_on_invalid_json() {
        let (manifest, store) = installed(reference_fixture());
        let mut registry = ContentRuntimeRegistry::default();
        registry.install(&manifest, &store).expect("initial install");
        let original_hash = registry.registry_hash;
        let mut invalid = reference_fixture();
        invalid[0].canonical_bytes = br#"{"id":1,"id":1}"#.to_vec();
        let (bad_manifest, bad_store) = installed(invalid);
        let blockers = registry
            .install(&bad_manifest, &bad_store)
            .expect_err("duplicate key rejected");
        assert!(
            blockers
                .iter()
                .any(|blocker| blocker.code == ContentRuntimeBlockerCode::InvalidJson)
        );
        assert_eq!(registry.registry_hash, original_hash);
    }

    #[test]
    fn action_profiles_materialize_exactly_and_preserve_extensions() {
        let (manifest, store) = installed(action_fixture());
        let (registry, report) = materialize_content_runtime(&manifest, &store).expect("actions materialize");
        assert_eq!(report.installed_entries, 2);
        assert_eq!(registry.items.len(), 1);
        assert_eq!(registry.block_action_catalogs.len(), 1);
        assert_eq!(registry.len(), 2);

        let action = &registry.items["1"].action;
        assert_eq!(action.tool_kind, Some(ContentActionToolKind::Pickaxe));
        assert_eq!(action.tier, Some(2));
        assert_eq!(action.mining_speed_millionths, Some(1_250_000));
        assert_eq!(action.max_durability, Some(99));
        assert_eq!(action.infinite_durability, Some(true));
        assert_eq!(action.food, Some(2));
        assert_eq!(action.use_kind, Some(ContentItemUseKind::Bucket));
        assert_eq!(action.place_block, Some(1));
        assert_eq!(action.bucket_liquid, Some(ContentActionLiquidKind::Water));

        let block = registry.block_action(1).expect("block action");
        assert_eq!(block.hardness_millionths, 900_000);
        assert_eq!(block.preferred_tool, ContentActionToolKind::Pickaxe);
        assert_eq!(block.required_tier, 2);
        assert_eq!(block.mapped_item_code, Some(1));
        assert_eq!(block.collision_height_millionths, Some(1_250_000));
        assert_eq!(block.connect_group.as_deref(), Some("fence"));
        assert_eq!(block.topology_flags, BLOCK_TOPOLOGY_HORIZONTAL_CONNECTED);
        let catalog = &registry.block_action_catalogs[BLOCK_ACTION_CATALOG_ID];
        assert_eq!(catalog.core.unknown_extension_bytes, [0, 0x80, 0xff, 9]);
        assert_eq!(
            registry
                .get(ContentDomain::Item, BLOCK_ACTION_CATALOG_ID)
                .expect("catalog core")
                .schema,
            ContentSchema::BlockActionCatalog
        );
    }

    #[test]
    fn contextual_action_profiles_materialize_losslessly() {
        let (manifest, store) = installed(contextual_action_fixture());
        let (registry, report) =
            materialize_content_runtime(&manifest, &store).expect("contextual actions materialize");
        assert_eq!(report.installed_entries, 4);
        let item = &registry.items["1"].action;
        assert_eq!(item.damage, Some(3));
        assert_eq!(item.fuel, Some(4));
        assert_eq!(item.place_block, Some(1));
        let ranged = &registry.items["3"].action;
        assert_eq!(ranged.ammo_item, Some(1));
        assert_eq!(ranged.magazine_size, Some(1));
        assert_eq!(ranged.damage, Some(7));
        assert_eq!(ranged.use_kind, Some(ContentItemUseKind::RangedWeapon));

        let catalog = &registry.block_action_catalogs[BLOCK_ACTION_CATALOG_ID];
        assert_eq!(catalog.core.schema, ContentSchema::BlockActionCatalogV2);
        assert_eq!(catalog.core.unknown_extension_bytes, [0, 0x80, 0xff, 11]);
        assert_eq!(
            catalog.rng_semantics.as_ref().expect("rng semantics").stream,
            "block-action-loot-v1"
        );
        assert!(
            catalog
                .authority_blockers
                .contains(&"legacy-computed-loot-source-runtime".to_owned())
        );

        let profile = registry.block_action(1).expect("contextual block");
        assert_eq!(profile.placement_intent, Some(ContentBlockPlacementIntent::Direct));
        assert_eq!(profile.placement_items, [1]);
        assert_eq!(profile.planting_rules[0].item_code, 2);
        assert_eq!(profile.planting_rules[0].result_block, 1);
        let harvest = profile.harvest_intent.as_ref().expect("harvest intent");
        assert_eq!(harvest.replacement_without_scythe, 1);
        assert_eq!(harvest.replacement_with_scythe, 1);
        assert!(harvest.replanted_without_scythe);
        assert!(harvest.replanted_with_scythe);
        assert!(harvest.preserve_cultivated);
        let loot = &profile.break_profile.as_ref().expect("break profile").loot;
        assert_eq!(loot.mode, ContentBlockLootMode::All);
        assert_eq!(loot.silk_touch, ContentBlockSilkTouchPolicy::NotAuthored);
        assert_eq!(loot.rules[0].ordinal, 0);
        assert_eq!(loot.rules[1].ordinal, 1);
        assert!(matches!(
            loot.rules[0].count,
            ContentBlockLootCount::SharedRollFormula {
                base: 2,
                floor_roll_multiplier: 2,
                scythe_bonus: 1,
                ..
            }
        ));
        let exclusive = registry.block_action(3).expect("exclusive block");
        assert_eq!(
            exclusive.break_profile.as_ref().expect("break profile").loot.mode,
            ContentBlockLootMode::Exclusive
        );
    }

    #[test]
    fn contextual_action_bounds_references_probability_and_order_fail_atomically() {
        let (manifest, store) = installed(contextual_action_fixture());
        let mut registry = ContentRuntimeRegistry::default();
        registry.install(&manifest, &store).expect("initial contextual install");
        let original = registry.clone();
        let cases = [
            (
                "\"id\":\"seed\",\"item\":2",
                "\"id\":\"seed\",\"item\":999",
                ContentRuntimeBlockerCode::MissingDependency,
                "unknown item reference",
            ),
            (
                "\"maximum\":2,\"minimum\":1",
                "\"maximum\":0,\"minimum\":1",
                ContentRuntimeBlockerCode::InvalidType,
                "invalid loot range",
            ),
            (
                "\"chanceMillionths\":220000",
                "\"chanceMillionths\":1000001",
                ContentRuntimeBlockerCode::InvalidType,
                "out-of-bounds probability",
            ),
            (
                "\"id\":\"second\",\"item\":2,\"ordinal\":1",
                "\"id\":\"second\",\"item\":2,\"ordinal\":0",
                ContentRuntimeBlockerCode::DescriptorMismatch,
                "loot order drift",
            ),
            (
                "\"chanceMillionths\":840000",
                "\"chanceMillionths\":830000",
                ContentRuntimeBlockerCode::DescriptorMismatch,
                "exclusive probability gap",
            ),
        ];
        for (needle, replacement, code, label) in cases {
            let mut invalid = contextual_action_fixture();
            let catalog = invalid
                .iter_mut()
                .find(|artifact| artifact.schema_id == "block-action-catalog")
                .expect("catalog fixture");
            let source = String::from_utf8(catalog.canonical_bytes.clone()).expect("fixture UTF-8");
            assert!(source.contains(needle), "mutation target: {label}");
            catalog.canonical_bytes = source.replace(needle, replacement).into_bytes();
            let (bad_manifest, bad_store) = installed(invalid);
            let blockers = registry.install(&bad_manifest, &bad_store).expect_err(label);
            assert!(
                blockers.iter().any(|blocker| blocker.code == code),
                "{label}: {blockers:?}"
            );
            assert_eq!(registry, original, "{label}");
        }
    }

    #[test]
    fn action_profile_drift_is_rejected_transactionally() {
        let (manifest, store) = installed(action_fixture());
        let mut registry = ContentRuntimeRegistry::default();
        registry.install(&manifest, &store).expect("initial action install");
        let original = registry.clone();

        let mut invalid = action_fixture();
        let catalog = invalid
            .iter_mut()
            .find(|artifact| artifact.schema_id == "block-action-catalog")
            .expect("catalog fixture");
        catalog.canonical_bytes = String::from_utf8(catalog.canonical_bytes.clone())
            .expect("fixture UTF-8")
            .replace("horizontal-connected", "teleporting")
            .into_bytes();
        let (bad_manifest, bad_store) = installed(invalid);
        let blockers = registry
            .install(&bad_manifest, &bad_store)
            .expect_err("unknown topology rejected");
        assert!(blockers.iter().any(|blocker| {
            blocker.code == ContentRuntimeBlockerCode::InvalidEnum && blocker.path == "$.profiles[1].topologyFlags[0]"
        }));
        assert_eq!(registry, original);

        let mut imprecise = action_fixture();
        let catalog = imprecise
            .iter_mut()
            .find(|artifact| artifact.schema_id == "block-action-catalog")
            .expect("catalog fixture");
        catalog.canonical_bytes = String::from_utf8(catalog.canonical_bytes.clone())
            .expect("fixture UTF-8")
            .replace("\"hardness\":0.9", "\"hardness\":0.0000001")
            .into_bytes();
        let (bad_manifest, bad_store) = installed(imprecise);
        let blockers = materialize_content_runtime(&bad_manifest, &bad_store).expect_err("sub-millionth rejected");
        assert!(blockers.iter().any(|blocker| {
            blocker.code == ContentRuntimeBlockerCode::Range && blocker.path == "$.profiles[1].hardness"
        }));

        let mut duplicate = action_fixture();
        let catalog = duplicate
            .iter_mut()
            .find(|artifact| artifact.schema_id == "block-action-catalog")
            .expect("catalog fixture");
        catalog.canonical_bytes = String::from_utf8(catalog.canonical_bytes.clone())
            .expect("fixture UTF-8")
            .replace("\"id\":1,\"item\"", "\"id\":0,\"item\"")
            .into_bytes();
        let (bad_manifest, bad_store) = installed(duplicate);
        let blockers = materialize_content_runtime(&bad_manifest, &bad_store).expect_err("duplicate id rejected");
        assert!(blockers.iter().any(|blocker| {
            blocker.code == ContentRuntimeBlockerCode::DescriptorMismatch && blocker.path == "$.profiles[1].id"
        }));

        let mut missing_block = action_fixture();
        let item = missing_block
            .iter_mut()
            .find(|artifact| artifact.schema_id == "item-definition")
            .expect("item fixture");
        item.canonical_bytes = String::from_utf8(item.canonical_bytes.clone())
            .expect("fixture UTF-8")
            .replace("\"placeBlock\":1", "\"placeBlock\":2")
            .into_bytes();
        let (bad_manifest, bad_store) = installed(missing_block);
        let blockers = materialize_content_runtime(&bad_manifest, &bad_store).expect_err("missing block rejected");
        assert!(blockers.iter().any(|blocker| {
            blocker.code == ContentRuntimeBlockerCode::MissingDependency && blocker.path == "$.placeBlock"
        }));
    }

    #[test]
    fn player_render_profile_is_distinct_and_transactional() {
        let (manifest, store) = installed(reference_fixture());
        let mut registry = ContentRuntimeRegistry::default();
        registry.install(&manifest, &store).expect("initial install");
        let original = registry.clone();

        let mut invalid = reference_fixture();
        let player = invalid
            .iter_mut()
            .find(|artifact| artifact.schema_id == "player-render-profile")
            .expect("player render fixture");
        player.canonical_bytes = String::from_utf8(player.canonical_bytes.clone())
            .expect("fixture UTF-8")
            .replace("52fd4aebb0c457f3c83af79af6b83c93", "52FD4AEBB0C457F3C83AF79AF6B83C93")
            .into_bytes();
        let (bad_manifest, bad_store) = installed(invalid);
        let blockers = registry
            .install(&bad_manifest, &bad_store)
            .expect_err("uppercase canonical hash rejected");
        assert!(blockers.iter().any(|blocker| blocker.path == "$.catalog.canonicalHash"));
        assert_eq!(registry, original);
        assert!(!registry.creature_profiles.contains_key("player:standing"));
    }

    #[test]
    fn player_render_profile_matches_typescript_content_hash() {
        let mut player = reference_fixture()
            .into_iter()
            .find(|artifact| artifact.schema_id == "player-render-profile")
            .expect("player render fixture");
        player.aliases = vec![
            "creature-profile:player:standing".to_owned(),
            "player-render-profile:standing".to_owned(),
        ];
        player.unknown_extension_bytes.clear();
        let bundle = compile_content_bundle("blockwild-1.12.0+cardforge-3", vec![player]).expect("profile compiles");
        assert_eq!(
            bundle.manifest.entries[0].blob_hash.to_hex(),
            "77f7d6234c83e717c83a571e32b3e97f"
        );
        let mut store = MetadataBlobStore::default();
        install_content_bundle(&bundle, &mut store).expect("profile installs");
        let (registry, report) = materialize_content_runtime(&bundle.manifest, &store).expect("profile materializes");
        assert_eq!(report.installed_entries, 1);
        assert_eq!(registry.player_render_profiles["player:standing"].model_node_count, 25);
        assert!(registry.creature_profiles.is_empty());
    }

    #[test]
    fn render_presentation_profiles_materialize_distinctly_and_preserve_extensions() {
        let (manifest, store) = installed(render_presentation_fixture());
        let (registry, report) = materialize_content_runtime(&manifest, &store).expect("presentations materialize");
        assert_eq!(report.installed_entries, 15);
        assert_eq!(registry.machine_profiles.len(), 1);
        assert_eq!(registry.render_presentation_catalogs.len(), 1);
        let catalog = &registry.render_presentation_catalogs[RENDER_PRESENTATION_CATALOG_ID];
        assert_eq!(catalog.core.schema, ContentSchema::RenderPresentationCatalog);
        assert_eq!(catalog.core.unknown_extension_bytes, [0, 0x80, 0xff, 13]);
        assert_eq!(catalog.catalog_schema, 2);
        assert_eq!(catalog.catalog_revision, 1);
        assert_eq!(
            catalog.catalog_sha256,
            "12c522f880e94c1ae527de701ae3e710fee13701d66fbb0a4ad24895557011b4"
        );
        assert_eq!(catalog.catalog_canonical_hash, "52fd4aebb0c457f3c83af79af6b83c93");
        assert_eq!(catalog.catalog_byte_length, 785_824);
        assert_eq!(catalog.catalog_model_count, 252);
        assert_eq!(catalog.catalog_node_count, 13_121);
        assert_eq!(catalog.profiles.len(), 3);
        assert_eq!(catalog.missing_profiles.len(), 1);
        assert_eq!(catalog.integration_blockers.len(), 2);
        let held = &catalog.profiles["held:survey-pick"];
        assert_eq!(held.role, ContentRenderPresentationRole::HeldItem);
        assert_eq!(held.model.model_id, "held-pickaxe");
        assert_eq!(held.model.label, "Stone Pickaxe");
        assert_eq!(held.model.category, 0);
        assert_eq!(held.model.ground_y_bits, None);
        assert_eq!(held.model.node_count, 5);
        assert_eq!(held.content_refs[0].domain, ContentDomain::Item);
        assert_eq!(held.content_refs[0].id, "1");
        let summon = &catalog.profiles["summon:fox"];
        assert_eq!(summon.role, ContentRenderPresentationRole::Summon);
        assert_eq!(summon.model.ground_y_bits, Some(0));
        assert_eq!(summon.content_refs.len(), 2);
        assert_eq!(
            catalog.missing_profiles["missing:world-prop:board"].content_refs[0].id,
            "2"
        );
        assert!(!registry.creature_profiles.contains_key(RENDER_PRESENTATION_CATALOG_ID));
        assert!(
            !registry
                .player_render_profiles
                .contains_key(RENDER_PRESENTATION_CATALOG_ID)
        );
        assert!(!registry.machine_profiles.contains_key(RENDER_PRESENTATION_CATALOG_ID));
    }

    #[test]
    fn render_presentation_drift_and_ambiguous_role_refs_fail_atomically() {
        let (manifest, store) = installed(render_presentation_fixture());
        let mut registry = ContentRuntimeRegistry::default();
        registry
            .install(&manifest, &store)
            .expect("initial presentation install");
        let original = registry.clone();

        let mut invalid = render_presentation_fixture();
        let catalog = invalid
            .iter_mut()
            .find(|artifact| artifact.schema_id == "render-presentation-catalog")
            .expect("presentation fixture");
        catalog.canonical_bytes = String::from_utf8(catalog.canonical_bytes.clone())
            .expect("fixture UTF-8")
            .replace(
                r#"{"domain":"machine-profile","id":"furnace"}],"id":"machine:furnace"#,
                r#"{"domain":"item","id":"1"}],"id":"machine:furnace"#,
            )
            .replace(r#""role":"machine"#, r#""role":"held-item"#)
            .into_bytes();
        let (bad_manifest, bad_store) = installed(invalid);
        let blockers = registry
            .install(&bad_manifest, &bad_store)
            .expect_err("ambiguous role binding rejected");
        assert!(blockers.iter().any(|blocker| {
            blocker.code == ContentRuntimeBlockerCode::InvalidEnum
                || (blocker.code == ContentRuntimeBlockerCode::Range && blocker.path.contains("contentRefs"))
        }));
        assert_eq!(registry, original);

        let mut missing = render_presentation_fixture();
        let catalog = missing
            .iter_mut()
            .find(|artifact| artifact.schema_id == "render-presentation-catalog")
            .expect("presentation fixture");
        catalog.canonical_bytes = String::from_utf8(catalog.canonical_bytes.clone())
            .expect("fixture UTF-8")
            .replace(r#"{"domain":"item","id":"2"}"#, r#"{"domain":"item","id":"999"}"#)
            .into_bytes();
        let (bad_manifest, bad_store) = installed(missing);
        let blockers = registry
            .install(&bad_manifest, &bad_store)
            .expect_err("missing presentation content ref rejected");
        assert!(blockers.iter().any(|blocker| {
            blocker.code == ContentRuntimeBlockerCode::MissingDependency && blocker.path.contains("missingProfiles")
        }));
        assert_eq!(registry, original);
    }

    #[test]
    fn missing_dependency_and_free_output_fail_closed() {
        let mut missing = reference_fixture();
        missing[6].canonical_bytes = String::from_utf8_lossy(&missing[6].canonical_bytes)
            .replace("\"wild\"", "\"void\"")
            .into_bytes();
        let (manifest, store) = installed(missing);
        let blockers = materialize_content_runtime(&manifest, &store).expect_err("missing type rejected");
        assert!(
            blockers
                .iter()
                .any(|blocker| blocker.code == ContentRuntimeBlockerCode::MissingDependency)
        );

        let mut free = reference_fixture();
        free[2].canonical_bytes =
            br#"{"height":1,"id":"board","name":"Board","output":{"count":1,"item":2},"pattern":[0],"width":1}"#
                .to_vec();
        let (manifest, store) = installed(free);
        let blockers = materialize_content_runtime(&manifest, &store).expect_err("free output rejected");
        assert!(
            blockers
                .iter()
                .any(|blocker| blocker.code == ContentRuntimeBlockerCode::ResourceConservation)
        );
    }

    #[test]
    fn parser_rejects_depth_trailing_and_non_finite_numbers() {
        let nested = format!(
            "{}0{}",
            "[".repeat(MAX_CONTENT_JSON_DEPTH + 2),
            "]".repeat(MAX_CONTENT_JSON_DEPTH + 2)
        );
        assert!(JsonParser::parse(nested.as_bytes()).is_err());
        assert!(JsonParser::parse(b"{}x").is_err());
        assert!(JsonParser::parse(b"1e9999").is_err());
        assert_eq!(
            JsonParser::parse(br#""\ud83d\udc09""#),
            Ok(CanonicalJson::String("🐉".to_owned()))
        );
    }

    #[test]
    fn canonical_json_validation_preserves_unicode_and_rejects_alternate_spellings() {
        assert!(validate_canonical_json_bytes_v1("{\"name\":\"Mizu 水\",\"nested\":[1,true]}".as_bytes()).is_ok());
        assert!(validate_canonical_json_bytes_v1(b"{\"nested\":[1,true],\"name\":\"Mizu\"}").is_err());
        assert!(validate_canonical_json_bytes_v1(b"{ \"name\":\"Mizu\"}").is_err());
        assert!(validate_canonical_json_bytes_v1(b"{\"number\":1.0}").is_err());
        assert!(validate_canonical_json_bytes_v1(b"{\"number\":-0}").is_err());
    }

    #[test]
    fn duplicate_alias_schema_and_enum_drift_are_rejected() {
        let (mut manifest, store) = installed(reference_fixture());
        let first = manifest
            .entries
            .iter()
            .find(|entry| entry.domain == ContentDomain::Item)
            .expect("item");
        let mut duplicate = first.clone();
        duplicate.id = "3".to_owned();
        manifest.entries.push(duplicate);
        manifest
            .entries
            .sort_by(|left, right| (left.domain, &left.id).cmp(&(right.domain, &right.id)));
        resign_manifest(&mut manifest);
        let blockers = materialize_content_runtime(&manifest, &store).expect_err("alias duplication rejected");
        assert!(
            blockers
                .iter()
                .any(|blocker| blocker.code == ContentRuntimeBlockerCode::DuplicateAlias)
        );

        let mut bad_schema = reference_fixture();
        bad_schema[0].schema_version = 9;
        let (manifest, store) = installed(bad_schema);
        let blockers = materialize_content_runtime(&manifest, &store).expect_err("schema drift rejected");
        assert!(
            blockers
                .iter()
                .any(|blocker| blocker.code == ContentRuntimeBlockerCode::UnsupportedSchema)
        );

        let mut bad_enum = reference_fixture();
        bad_enum[0].canonical_bytes =
            br##"{"color":"#68a341","id":1,"maxStack":64,"name":"Grass Block","rarity":"mythical"}"##.to_vec();
        let (manifest, store) = installed(bad_enum);
        let blockers = materialize_content_runtime(&manifest, &store).expect_err("enum drift rejected");
        assert!(
            blockers
                .iter()
                .any(|blocker| blocker.code == ContentRuntimeBlockerCode::InvalidEnum)
        );
    }
}
