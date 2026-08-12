use std::collections::BTreeMap;

use blockwild_types::{CanonicalHash, CanonicalHasher, seed_stream};

use crate::{
    ACTION_PROMOTION_RNG_SEMANTICS_VERSION_ID_V1, BLOCK_ACTION_CATALOG_ID, CONTENT_ACTION_FIXED_SCALE,
    ContentActionPromotionReportV1, ContentBlockActionProfile, ContentBlockLootChanceModifier, ContentBlockLootCount,
    ContentBlockLootMode, ContentBlockLootRollScope, ContentRuntimeRegistry, ContentSchema, MAX_BLOCK_LOOT_RULES,
    validate_action_promotion_report_v1,
};

pub const BLOCK_ACTION_LOOT_PLAN_SCHEMA_VERSION_V1: u16 = 1;
pub const BLOCK_ACTION_GENERATED_DROP_PROVENANCE_SCHEMA_VERSION_V1: u16 = 1;
pub const BLOCK_ACTION_LOOT_IMPLEMENTATION_VERSION_ID_V1: &str = "block-action-authoritative-rng-v1";
pub const BLOCK_ACTION_LOOT_RNG_STREAM_V1: &str = "block-action-loot-v1";
pub const MAX_BLOCK_ACTION_LOOT_DRAWS_V1: usize = MAX_BLOCK_LOOT_RULES * 2;
pub const MAX_BLOCK_ACTION_GENERATED_DROPS_V1: usize = MAX_BLOCK_LOOT_RULES;

const RNG_UNIT_DENOMINATOR_V1: u128 = 1_u128 << 32;
const RNG_FIXED_SCALE_V1: u128 = CONTENT_ACTION_FIXED_SCALE as u128;
const PLANT_YIELD_CLAMP_MAXIMUM_MILLIONTHS_V1: u64 = 999_900;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BlockActionLootErrorCodeV1 {
    Binding,
    Capacity,
    HashMismatch,
    InvalidContext,
    InvalidProfile,
    MissingItem,
    MissingRuntimeContext,
    Overflow,
    UnsupportedSemantics,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlockActionLootErrorV1 {
    pub code: BlockActionLootErrorCodeV1,
    pub path: String,
    pub message: String,
}

impl BlockActionLootErrorV1 {
    fn new(code: BlockActionLootErrorCodeV1, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code,
            path: path.into(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlockActionLootBindingV1 {
    pub manifest_hash: CanonicalHash,
    pub installed_registry_hash: CanonicalHash,
    pub catalog_schema_version: u16,
    pub catalog_content_version: u32,
    pub catalog_blob_hash: CanonicalHash,
    pub action_report_hash: CanonicalHash,
    pub rng_semantics_version_id: String,
    pub rng_semantics_hash: CanonicalHash,
    pub implementation_version_id: String,
    pub implementation_hash: CanonicalHash,
}

impl BlockActionLootBindingV1 {
    pub fn from_installed_content_v1(
        registry: &ContentRuntimeRegistry,
        report: &ContentActionPromotionReportV1,
    ) -> Result<Self, BlockActionLootErrorV1> {
        validate_action_promotion_report_v1(report).map_err(|errors| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Binding,
                "$.actionPromotionReport",
                format!(
                    "installed action-promotion report has {} validation error(s)",
                    errors.len()
                ),
            )
        })?;
        let installed_report = registry
            .action_promotion_report_v1()
            .map_err(|errors| {
                BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::Binding,
                    "$.installedActionPromotionReport",
                    format!(
                        "installed registry cannot reproduce its action-promotion report: {} validation error(s)",
                        errors.len()
                    ),
                )
            })?
            .ok_or_else(|| {
                BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::Binding,
                    "$.installedActionPromotionReport",
                    "installed registry has no action-promotion report",
                )
            })?;
        if installed_report != *report {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Binding,
                "$.actionPromotionReport",
                "supplied action-promotion report is not the exact report reproduced by the installed registry",
            ));
        }
        let catalog = registry
            .block_action_catalogs
            .get(BLOCK_ACTION_CATALOG_ID)
            .ok_or_else(|| {
                BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::Binding,
                    "$.blockActionCatalog",
                    "installed content has no block-action catalog",
                )
            })?;
        if registry.manifest_hash != report.manifest_hash
            || report.installed_registry_hash != Some(registry.registry_hash)
            || catalog.core.schema != ContentSchema::BlockActionCatalogV2
            || report.block_action_catalog_schema_version != 2
            || report.block_action_catalog_content_version != catalog.core.content_version
            || report.block_action_catalog_blob_hash != catalog.core.blob_hash
        {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Binding,
                "$.contentBinding",
                "installed registry, report, and schema-2 catalog identities do not agree",
            ));
        }
        let rng_semantics_version_id = report.rng_semantics_version_id.clone().ok_or_else(|| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::UnsupportedSemantics,
                "$.rngSemanticsVersionId",
                "schema-2 block actions require a declared RNG semantics version",
            )
        })?;
        let rng_semantics_hash = report.rng_semantics_hash.ok_or_else(|| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::UnsupportedSemantics,
                "$.rngSemanticsHash",
                "schema-2 block actions require an exact RNG semantics hash",
            )
        })?;
        let binding = Self {
            manifest_hash: registry.manifest_hash,
            installed_registry_hash: registry.registry_hash,
            catalog_schema_version: 2,
            catalog_content_version: catalog.core.content_version,
            catalog_blob_hash: catalog.core.blob_hash,
            action_report_hash: report.report_hash,
            rng_semantics_version_id,
            rng_semantics_hash,
            implementation_version_id: BLOCK_ACTION_LOOT_IMPLEMENTATION_VERSION_ID_V1.to_owned(),
            implementation_hash: canonical_block_action_loot_implementation_hash_v1(),
        };
        binding.validate_v1()?;
        Ok(binding)
    }

    pub fn validate_v1(&self) -> Result<(), BlockActionLootErrorV1> {
        if self.catalog_schema_version != 2
            || self.catalog_content_version == 0
            || self.rng_semantics_version_id != ACTION_PROMOTION_RNG_SEMANTICS_VERSION_ID_V1
            || self.implementation_version_id != BLOCK_ACTION_LOOT_IMPLEMENTATION_VERSION_ID_V1
        {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::UnsupportedSemantics,
                "$.binding",
                "block-action loot binding uses an unsupported schema or semantic version",
            ));
        }
        if [
            self.manifest_hash,
            self.installed_registry_hash,
            self.catalog_blob_hash,
            self.action_report_hash,
            self.rng_semantics_hash,
        ]
        .contains(&CanonicalHash::default())
        {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Binding,
                "$.binding",
                "block-action loot binding contains a zero content identity",
            ));
        }
        if self.implementation_hash != canonical_block_action_loot_implementation_hash_v1() {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::HashMismatch,
                "$.implementationHash",
                "block-action loot implementation hash does not match V1 semantics",
            ));
        }
        Ok(())
    }

    #[must_use]
    pub fn canonical_hash_v1(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.block-action-loot-binding.v1");
        hasher.write_u16(1);
        hasher.write_bytes(self.manifest_hash.as_bytes());
        hasher.write_bytes(self.installed_registry_hash.as_bytes());
        hasher.write_u16(self.catalog_schema_version);
        hasher.write_u32(self.catalog_content_version);
        hasher.write_bytes(self.catalog_blob_hash.as_bytes());
        hasher.write_bytes(self.action_report_hash.as_bytes());
        hasher.write_str(&self.rng_semantics_version_id);
        hasher.write_bytes(self.rng_semantics_hash.as_bytes());
        hasher.write_str(&self.implementation_version_id);
        hasher.write_bytes(self.implementation_hash.as_bytes());
        hasher.finish()
    }
}

#[must_use]
pub fn canonical_block_action_loot_implementation_hash_v1() -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild.gameplay.block-action-loot-implementation.v1");
    hasher.write_u16(1);
    hasher.write_str(BLOCK_ACTION_LOOT_IMPLEMENTATION_VERSION_ID_V1);
    hasher.write_str("xorshift32");
    hasher.write_str("blockwild-seed-stream-v1");
    hasher.write_str(BLOCK_ACTION_LOOT_RNG_STREAM_V1);
    hasher.write_str("u32-open-upper-v1");
    hasher.write_str("stable-profile-rule-order-v1");
    hasher.write_str("less-than-or-equal-v1");
    hasher.write_str("less-than-cumulative-v1");
    hasher.write_str("group-by-item-metadata-sorted-v1");
    hasher.write_str("split-by-installed-max-stack-v1");
    hasher.write_str("worst-case-generated-drop-bound-v1");
    hasher.write_u64(RNG_UNIT_DENOMINATOR_V1 as u64);
    hasher.write_u64(CONTENT_ACTION_FIXED_SCALE);
    hasher.write_u64(PLANT_YIELD_CLAMP_MAXIMUM_MILLIONTHS_V1);
    hasher.write_u64(MAX_BLOCK_ACTION_LOOT_DRAWS_V1 as u64);
    hasher.write_u64(MAX_BLOCK_ACTION_GENERATED_DROPS_V1 as u64);
    for combination in [
        "none:constant",
        "random-drop-v1:constant",
        "random-drop-v1:uniform-inclusive",
        "shared-exclusive:constant",
        "shared-plant-yield:constant",
        "shared-plant-yield:shared-roll-formula",
    ] {
        hasher.write_str(combination);
    }
    hasher.finish()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BlockActionLootCellV1 {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

impl BlockActionLootCellV1 {
    fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_i32(self.x);
        hasher.write_i32(self.y);
        hasher.write_i32(self.z);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlockActionLootContextV1 {
    pub block_action_sequence: u64,
    pub origin_input_sequence: u64,
    pub block_id: u16,
    pub position: BlockActionLootCellV1,
    pub harvested: bool,
    pub creative_mode: bool,
    pub scythe: bool,
}

impl BlockActionLootContextV1 {
    pub fn validate_v1(&self) -> Result<(), BlockActionLootErrorV1> {
        if self.block_action_sequence == 0 || self.origin_input_sequence == 0 || self.block_id == 0 {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::InvalidContext,
                "$.context",
                "block-action sequence, input sequence, and source block must be nonzero",
            ));
        }
        Ok(())
    }

    #[must_use]
    pub fn canonical_hash_v1(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.block-action-loot-context.v1");
        hasher.write_u16(1);
        hasher.write_u64(self.block_action_sequence);
        hasher.write_u64(self.origin_input_sequence);
        hasher.write_u16(self.block_id);
        self.position.hash_into(&mut hasher);
        hasher.write_u16(u16::from(self.harvested));
        hasher.write_u16(u16::from(self.creative_mode));
        hasher.write_u16(u16::from(self.scythe));
        hasher.finish()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BlockActionLootRngCursorV1 {
    pub state: u32,
    pub draw_count: u64,
}

impl BlockActionLootRngCursorV1 {
    #[must_use]
    pub fn from_seed_v1(seed: &str) -> Self {
        Self {
            state: seed_stream(seed, BLOCK_ACTION_LOOT_RNG_STREAM_V1),
            draw_count: 0,
        }
    }

    pub fn validate_v1(self) -> Result<(), BlockActionLootErrorV1> {
        if self.state == 0 {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::InvalidContext,
                "$.rng.state",
                "xorshift32 state must be nonzero",
            ));
        }
        Ok(())
    }

    fn hash_into(self, hasher: &mut CanonicalHasher) {
        hasher.write_u32(self.state);
        hasher.write_u64(self.draw_count);
    }
}

#[must_use]
pub const fn block_action_xorshift32_v1(mut state: u32) -> u32 {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    if state == 0 { 0x6d2b_79f5 } else { state }
}

#[must_use]
pub const fn block_action_random_gate_v1(draw: u32, chance_millionths: u64) -> bool {
    (draw as u128) * RNG_FIXED_SCALE_V1 <= (chance_millionths as u128) * RNG_UNIT_DENOMINATOR_V1
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BlockActionRngDrawPurposeV1 {
    RandomGate,
    RandomCount,
    SharedExclusive,
    SharedPlantYield,
}

impl BlockActionRngDrawPurposeV1 {
    const fn tag(self) -> u16 {
        match self {
            Self::RandomGate => 0,
            Self::RandomCount => 1,
            Self::SharedExclusive => 2,
            Self::SharedPlantYield => 3,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BlockActionRngDrawV1 {
    pub index: u16,
    pub rule_ordinal: Option<u16>,
    pub purpose: BlockActionRngDrawPurposeV1,
    pub value: u32,
}

impl BlockActionRngDrawV1 {
    fn hash_into(self, hasher: &mut CanonicalHasher) {
        hasher.write_u16(self.index);
        match self.rule_ordinal {
            Some(ordinal) => {
                hasher.write_u16(1);
                hasher.write_u16(ordinal);
            }
            None => hasher.write_u16(0),
        }
        hasher.write_u16(self.purpose.tag());
        hasher.write_u32(self.value);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlockActionLootRuleOutcomeV1 {
    pub ordinal: u16,
    pub rule_id: String,
    pub item_code: u32,
    pub selected: bool,
    pub count: u32,
    pub gate_draw_index: Option<u16>,
    pub count_draw_index: Option<u16>,
}

impl BlockActionLootRuleOutcomeV1 {
    fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u16(self.ordinal);
        hasher.write_str(&self.rule_id);
        hasher.write_u32(self.item_code);
        hasher.write_u16(u16::from(self.selected));
        hasher.write_u32(self.count);
        hash_option_u16(hasher, self.gate_draw_index);
        hash_option_u16(hasher, self.count_draw_index);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlockActionGeneratedStackV1 {
    pub group_ordinal: u16,
    pub item_code: u32,
    pub metadata_hash: CanonicalHash,
    pub count: u32,
}

impl BlockActionGeneratedStackV1 {
    fn hash_into(&self, hasher: &mut CanonicalHasher) {
        hasher.write_u16(self.group_ordinal);
        hasher.write_u32(self.item_code);
        hasher.write_bytes(self.metadata_hash.as_bytes());
        hasher.write_u32(self.count);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlockActionLootPlanV1 {
    pub schema_version: u16,
    pub binding: BlockActionLootBindingV1,
    pub context: BlockActionLootContextV1,
    pub rng_before: BlockActionLootRngCursorV1,
    pub draws: Vec<BlockActionRngDrawV1>,
    pub outcomes: Vec<BlockActionLootRuleOutcomeV1>,
    pub stacks: Vec<BlockActionGeneratedStackV1>,
    pub rng_after: BlockActionLootRngCursorV1,
    pub plan_hash: CanonicalHash,
}

impl BlockActionLootPlanV1 {
    #[must_use]
    pub fn calculate_hash_v1(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.block-action-loot-plan.v1");
        hasher.write_u16(self.schema_version);
        hasher.write_bytes(self.binding.canonical_hash_v1().as_bytes());
        hasher.write_bytes(self.context.canonical_hash_v1().as_bytes());
        self.rng_before.hash_into(&mut hasher);
        hasher.write_u64(self.draws.len() as u64);
        for draw in &self.draws {
            draw.hash_into(&mut hasher);
        }
        hasher.write_u64(self.outcomes.len() as u64);
        for outcome in &self.outcomes {
            outcome.hash_into(&mut hasher);
        }
        hasher.write_u64(self.stacks.len() as u64);
        for stack in &self.stacks {
            stack.hash_into(&mut hasher);
        }
        self.rng_after.hash_into(&mut hasher);
        hasher.finish()
    }

    pub fn validate_hash_v1(&self) -> Result<(), BlockActionLootErrorV1> {
        if self.schema_version != BLOCK_ACTION_LOOT_PLAN_SCHEMA_VERSION_V1 {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::UnsupportedSemantics,
                "$.schemaVersion",
                "unsupported block-action loot plan schema",
            ));
        }
        if self.draws.len() > MAX_BLOCK_ACTION_LOOT_DRAWS_V1
            || self.outcomes.len() > MAX_BLOCK_LOOT_RULES
            || self.stacks.len() > MAX_BLOCK_ACTION_GENERATED_DROPS_V1
        {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Capacity,
                "$",
                "block-action loot plan exceeds its bounded vectors",
            ));
        }
        if self.plan_hash != self.calculate_hash_v1() {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::HashMismatch,
                "$.planHash",
                "block-action loot plan hash does not match canonical fields",
            ));
        }
        Ok(())
    }
}

pub fn evaluate_block_action_loot_v1(
    binding: &BlockActionLootBindingV1,
    profile: &ContentBlockActionProfile,
    item_max_stacks: &BTreeMap<u32, u32>,
    context: &BlockActionLootContextV1,
    rng_before: BlockActionLootRngCursorV1,
) -> Result<BlockActionLootPlanV1, BlockActionLootErrorV1> {
    binding.validate_v1()?;
    context.validate_v1()?;
    rng_before.validate_v1()?;
    if context.block_id != profile.block_id {
        return Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::InvalidContext,
            "$.context.blockId",
            "loot context source block does not match its installed profile",
        ));
    }
    let break_profile = profile.break_profile.as_ref().ok_or_else(|| {
        BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::InvalidProfile,
            "$.breakProfile",
            "schema-2 loot evaluation requires a typed break profile",
        )
    })?;
    validate_loot_profile_v1(profile, item_max_stacks)?;

    let mut cursor = rng_before;
    let mut draws = Vec::new();
    let mut outcomes = Vec::new();
    if context.harvested && !context.creative_mode && break_profile.loot.mode != ContentBlockLootMode::None {
        if break_profile
            .loot
            .rules
            .iter()
            .any(|rule| rule.chance_modifier == ContentBlockLootChanceModifier::LuckAdjustedV1)
        {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::MissingRuntimeContext,
                "$.luck",
                "luck-adjusted loot remains blocked until an authoritative progression context is bound",
            ));
        }
        match break_profile.loot.mode {
            ContentBlockLootMode::None => {}
            ContentBlockLootMode::Exclusive => {
                evaluate_exclusive_v1(&break_profile.loot.rules, &mut cursor, &mut draws, &mut outcomes)?;
            }
            ContentBlockLootMode::All
                if break_profile
                    .loot
                    .rules
                    .first()
                    .is_some_and(|rule| rule.roll_scope == ContentBlockLootRollScope::SharedPlantYield) =>
            {
                evaluate_shared_plant_v1(
                    &break_profile.loot.rules,
                    context.scythe,
                    &mut cursor,
                    &mut draws,
                    &mut outcomes,
                )?;
            }
            ContentBlockLootMode::All => {
                evaluate_all_v1(&break_profile.loot.rules, &mut cursor, &mut draws, &mut outcomes)?;
            }
        }
    }
    let stacks = group_generated_stacks_v1(&outcomes, item_max_stacks)?;
    let mut plan = BlockActionLootPlanV1 {
        schema_version: BLOCK_ACTION_LOOT_PLAN_SCHEMA_VERSION_V1,
        binding: binding.clone(),
        context: context.clone(),
        rng_before,
        draws,
        outcomes,
        stacks,
        rng_after: cursor,
        plan_hash: CanonicalHash::default(),
    };
    plan.plan_hash = plan.calculate_hash_v1();
    plan.validate_hash_v1()?;
    Ok(plan)
}

fn validate_loot_profile_v1(
    profile: &ContentBlockActionProfile,
    item_max_stacks: &BTreeMap<u32, u32>,
) -> Result<(), BlockActionLootErrorV1> {
    let loot = &profile
        .break_profile
        .as_ref()
        .expect("caller checked typed break profile")
        .loot;
    if loot.rules.len() > MAX_BLOCK_LOOT_RULES {
        return Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::Capacity,
            "$.breakProfile.loot.rules",
            "block-action loot rule count exceeds its bound",
        ));
    }
    match loot.mode {
        ContentBlockLootMode::None if !loot.rules.is_empty() => {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::InvalidProfile,
                "$.breakProfile.loot.rules",
                "loot mode none cannot contain rules",
            ));
        }
        ContentBlockLootMode::All if loot.rules.is_empty() => {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::InvalidProfile,
                "$.breakProfile.loot.rules",
                "loot mode all requires at least one rule",
            ));
        }
        ContentBlockLootMode::Exclusive if loot.rules.len() < 2 => {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::InvalidProfile,
                "$.breakProfile.loot.rules",
                "exclusive loot requires at least two rules",
            ));
        }
        _ => {}
    }
    let shared_plant = loot
        .rules
        .iter()
        .any(|rule| rule.roll_scope == ContentBlockLootRollScope::SharedPlantYield);
    let mut exclusive_chance = 0_u64;
    let mut rule_ids = std::collections::BTreeSet::new();
    for (index, rule) in loot.rules.iter().enumerate() {
        let path = format!("$.breakProfile.loot.rules[{index}]");
        if usize::from(rule.ordinal) != index
            || rule.id.is_empty()
            || rule.id.len() > 160
            || rule.id.chars().any(char::is_control)
            || !rule_ids.insert(rule.id.clone())
        {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::InvalidProfile,
                &path,
                "loot rules must have exact ordinals and bounded unique identifiers",
            ));
        }
        if !(1..=CONTENT_ACTION_FIXED_SCALE).contains(&rule.chance_millionths) {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::InvalidProfile,
                format!("{path}.chanceMillionths"),
                "loot probability lies outside one million millionths",
            ));
        }
        if !supported_roll_count_v1(rule.roll_scope, &rule.count)
            || rule.roll_scope == ContentBlockLootRollScope::None
                && (rule.chance_millionths != CONTENT_ACTION_FIXED_SCALE
                    || rule.chance_modifier != ContentBlockLootChanceModifier::None)
            || rule.roll_scope == ContentBlockLootRollScope::SharedPlantYield
                && (rule.chance_millionths != CONTENT_ACTION_FIXED_SCALE
                    || rule.chance_modifier != ContentBlockLootChanceModifier::None)
            || shared_plant && rule.roll_scope != ContentBlockLootRollScope::SharedPlantYield
        {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::UnsupportedSemantics,
                &path,
                "loot rule uses an unsupported roll/count combination or mixed shared-plant group",
            ));
        }
        validate_count_shape_v1(&rule.count, &path)?;
        let max_stack = item_max_stacks.get(&rule.item_code).copied().ok_or_else(|| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::MissingItem,
                format!("{path}.item"),
                "loot rule references an item without an installed stack limit",
            )
        })?;
        if max_stack == 0 {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Capacity,
                format!("{path}.item"),
                "loot rule references an item with a zero stack limit",
            ));
        }
        if loot.mode == ContentBlockLootMode::Exclusive {
            if rule.roll_scope != ContentBlockLootRollScope::SharedExclusive
                || rule.chance_modifier != ContentBlockLootChanceModifier::None
            {
                return Err(BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::UnsupportedSemantics,
                    &path,
                    "exclusive loot requires unmodified shared-exclusive rules",
                ));
            }
            exclusive_chance = exclusive_chance.checked_add(rule.chance_millionths).ok_or_else(|| {
                BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::Overflow,
                    &path,
                    "exclusive probability sum overflowed",
                )
            })?;
        } else if rule.roll_scope == ContentBlockLootRollScope::SharedExclusive {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::UnsupportedSemantics,
                &path,
                "shared-exclusive rules require exclusive loot mode",
            ));
        }
    }
    if loot.mode == ContentBlockLootMode::Exclusive && exclusive_chance != CONTENT_ACTION_FIXED_SCALE {
        return Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::InvalidProfile,
            "$.breakProfile.loot.rules",
            "exclusive probabilities must total one million millionths",
        ));
    }
    if block_action_loot_generated_drop_maximum_v1(profile, item_max_stacks)? > MAX_BLOCK_ACTION_GENERATED_DROPS_V1 {
        return Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::Capacity,
            "$.breakProfile.loot.rules",
            "worst-case grouped loot exceeds the generated-drop bound",
        ));
    }
    Ok(())
}

fn validate_count_shape_v1(count: &ContentBlockLootCount, path: &str) -> Result<(), BlockActionLootErrorV1> {
    match count {
        ContentBlockLootCount::Constant(value) if *value == 0 => Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::InvalidProfile,
            format!("{path}.count"),
            "constant loot count must be nonzero",
        )),
        ContentBlockLootCount::UniformInclusive { minimum, maximum } if *minimum == 0 || minimum > maximum => {
            Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::InvalidProfile,
                format!("{path}.count"),
                "uniform loot count requires 1 <= minimum <= maximum",
            ))
        }
        ContentBlockLootCount::SharedRollFormula { threshold_bonuses, .. } => {
            let mut previous = None;
            for bonus in threshold_bonuses {
                if bonus.amount == 0
                    || bonus.above_millionths >= CONTENT_ACTION_FIXED_SCALE
                    || previous.is_some_and(|prior| prior >= bonus.above_millionths)
                {
                    return Err(BlockActionLootErrorV1::new(
                        BlockActionLootErrorCodeV1::InvalidProfile,
                        format!("{path}.count.thresholdBonuses"),
                        "shared plant thresholds must be bounded, positive, and strictly ascending",
                    ));
                }
                previous = Some(bonus.above_millionths);
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

#[must_use]
pub fn supported_block_action_roll_count_v1(
    roll_scope: ContentBlockLootRollScope,
    count: &ContentBlockLootCount,
) -> bool {
    supported_roll_count_v1(roll_scope, count)
}

fn supported_roll_count_v1(roll_scope: ContentBlockLootRollScope, count: &ContentBlockLootCount) -> bool {
    matches!(
        (roll_scope, count),
        (ContentBlockLootRollScope::None, ContentBlockLootCount::Constant(_))
            | (
                ContentBlockLootRollScope::RandomDropV1,
                ContentBlockLootCount::Constant(_)
            )
            | (
                ContentBlockLootRollScope::RandomDropV1,
                ContentBlockLootCount::UniformInclusive { .. }
            )
            | (
                ContentBlockLootRollScope::SharedExclusive,
                ContentBlockLootCount::Constant(_)
            )
            | (
                ContentBlockLootRollScope::SharedPlantYield,
                ContentBlockLootCount::Constant(_)
            )
            | (
                ContentBlockLootRollScope::SharedPlantYield,
                ContentBlockLootCount::SharedRollFormula { .. }
            )
    )
}

pub fn block_action_loot_count_maximum_v1(count: &ContentBlockLootCount) -> Result<u64, BlockActionLootErrorV1> {
    match count {
        ContentBlockLootCount::Constant(value) => Ok(u64::from(*value)),
        ContentBlockLootCount::UniformInclusive { maximum, .. } => Ok(u64::from(*maximum)),
        ContentBlockLootCount::SharedRollFormula {
            base,
            floor_roll_multiplier,
            scythe_bonus,
            threshold_bonuses,
        } => {
            let floor_maximum = u64::from(*floor_roll_multiplier)
                .checked_mul(PLANT_YIELD_CLAMP_MAXIMUM_MILLIONTHS_V1)
                .map(|value| value / CONTENT_ACTION_FIXED_SCALE)
                .ok_or_else(|| {
                    BlockActionLootErrorV1::new(
                        BlockActionLootErrorCodeV1::Overflow,
                        "$.count.floorRollMultiplier",
                        "shared plant maximum overflowed",
                    )
                })?;
            threshold_bonuses
                .iter()
                .filter(|bonus| bonus.above_millionths < PLANT_YIELD_CLAMP_MAXIMUM_MILLIONTHS_V1)
                .try_fold(
                    u64::from(*base) + floor_maximum + u64::from(*scythe_bonus),
                    |total, bonus| {
                        total.checked_add(u64::from(bonus.amount)).ok_or_else(|| {
                            BlockActionLootErrorV1::new(
                                BlockActionLootErrorCodeV1::Overflow,
                                "$.count.thresholdBonuses",
                                "shared plant maximum overflowed",
                            )
                        })
                    },
                )
        }
    }
}

pub fn block_action_loot_generated_drop_maximum_v1(
    profile: &ContentBlockActionProfile,
    item_max_stacks: &BTreeMap<u32, u32>,
) -> Result<usize, BlockActionLootErrorV1> {
    let Some(action) = &profile.break_profile else {
        return Ok(0);
    };
    if action.loot.mode == ContentBlockLootMode::None {
        return Ok(0);
    }
    if action.loot.mode == ContentBlockLootMode::Exclusive {
        let mut maximum = 0_u64;
        for rule in &action.loot.rules {
            let max_stack = item_max_stacks.get(&rule.item_code).copied().ok_or_else(|| {
                BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::MissingItem,
                    "$.breakProfile.loot.rules.item",
                    "loot rule references an item without an installed stack limit",
                )
            })?;
            if max_stack == 0 {
                return Err(BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::Capacity,
                    "$.breakProfile.loot.rules.item",
                    "loot rule references an item with a zero stack limit",
                ));
            }
            let count = block_action_loot_count_maximum_v1(&rule.count)?;
            let chunks = count
                .checked_add(u64::from(max_stack) - 1)
                .map(|value| value / u64::from(max_stack))
                .ok_or_else(|| {
                    BlockActionLootErrorV1::new(
                        BlockActionLootErrorCodeV1::Overflow,
                        "$.breakProfile.loot.rules.count",
                        "exclusive generated-drop maximum overflowed",
                    )
                })?;
            maximum = maximum.max(chunks);
        }
        return usize::try_from(maximum).map_err(|_| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Capacity,
                "$.breakProfile.loot.rules",
                "exclusive generated-drop maximum exceeds usize",
            )
        });
    }

    let mut grouped = BTreeMap::<u32, u64>::new();
    for rule in &action.loot.rules {
        if !item_max_stacks.contains_key(&rule.item_code) {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::MissingItem,
                "$.breakProfile.loot.rules.item",
                "loot rule references an item without an installed stack limit",
            ));
        }
        let count = block_action_loot_count_maximum_v1(&rule.count)?;
        let total = grouped.entry(rule.item_code).or_default();
        *total = total.checked_add(count).ok_or_else(|| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Overflow,
                "$.breakProfile.loot.rules.count",
                "grouped generated-drop maximum overflowed",
            )
        })?;
    }
    let mut chunks = 0_u64;
    for (item_code, total) in grouped {
        let max_stack = item_max_stacks[&item_code];
        if max_stack == 0 {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Capacity,
                "$.breakProfile.loot.rules.item",
                "loot rule references an item with a zero stack limit",
            ));
        }
        let item_chunks = total
            .checked_add(u64::from(max_stack) - 1)
            .map(|value| value / u64::from(max_stack))
            .ok_or_else(|| {
                BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::Overflow,
                    "$.breakProfile.loot.rules.count",
                    "grouped generated-drop chunk count overflowed",
                )
            })?;
        chunks = chunks.checked_add(item_chunks).ok_or_else(|| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Overflow,
                "$.breakProfile.loot.rules",
                "generated-drop maximum overflowed",
            )
        })?;
    }
    usize::try_from(chunks).map_err(|_| {
        BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::Capacity,
            "$.breakProfile.loot.rules",
            "generated-drop maximum exceeds usize",
        )
    })
}

/// Re-evaluate a persisted plan from its bound inputs and require exact byte-
/// model equality. Runtime checkpoint/replay code can use this without trusting
/// the plan's self-reported draws or post-draw cursor.
pub fn replay_verify_block_action_loot_plan_v1(
    plan: &BlockActionLootPlanV1,
    profile: &ContentBlockActionProfile,
    item_max_stacks: &BTreeMap<u32, u32>,
) -> Result<(), BlockActionLootErrorV1> {
    plan.validate_hash_v1()?;
    let replayed =
        evaluate_block_action_loot_v1(&plan.binding, profile, item_max_stacks, &plan.context, plan.rng_before)?;
    if replayed != *plan {
        return Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::HashMismatch,
            "$.plan",
            "persisted block-action loot plan does not match deterministic replay",
        ));
    }
    Ok(())
}

fn evaluate_all_v1(
    rules: &[crate::ContentBlockLootRule],
    cursor: &mut BlockActionLootRngCursorV1,
    draws: &mut Vec<BlockActionRngDrawV1>,
    outcomes: &mut Vec<BlockActionLootRuleOutcomeV1>,
) -> Result<(), BlockActionLootErrorV1> {
    for rule in rules {
        match rule.roll_scope {
            ContentBlockLootRollScope::None => {
                outcomes.push(outcome_v1(rule, true, constant_count_v1(&rule.count)?, None, None))
            }
            ContentBlockLootRollScope::RandomDropV1 => {
                let (gate_index, gate_draw) = draw_v1(
                    cursor,
                    draws,
                    Some(rule.ordinal),
                    BlockActionRngDrawPurposeV1::RandomGate,
                )?;
                if block_action_random_gate_v1(gate_draw, rule.chance_millionths) {
                    let (count_index, count_draw) = draw_v1(
                        cursor,
                        draws,
                        Some(rule.ordinal),
                        BlockActionRngDrawPurposeV1::RandomCount,
                    )?;
                    let count = random_count_v1(&rule.count, count_draw)?;
                    outcomes.push(outcome_v1(rule, true, count, Some(gate_index), Some(count_index)));
                } else {
                    outcomes.push(outcome_v1(rule, false, 0, Some(gate_index), None));
                }
            }
            ContentBlockLootRollScope::SharedExclusive | ContentBlockLootRollScope::SharedPlantYield => {
                return Err(BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::UnsupportedSemantics,
                    "$.breakProfile.loot.rules",
                    "shared roll scope reached the independent-rule evaluator",
                ));
            }
        }
    }
    Ok(())
}

fn evaluate_exclusive_v1(
    rules: &[crate::ContentBlockLootRule],
    cursor: &mut BlockActionLootRngCursorV1,
    draws: &mut Vec<BlockActionRngDrawV1>,
    outcomes: &mut Vec<BlockActionLootRuleOutcomeV1>,
) -> Result<(), BlockActionLootErrorV1> {
    let (draw_index, draw) = draw_v1(cursor, draws, None, BlockActionRngDrawPurposeV1::SharedExclusive)?;
    let probabilities = rules.iter().map(|rule| rule.chance_millionths).collect::<Vec<_>>();
    let selected = block_action_exclusive_selection_v1(draw, &probabilities)?;
    for (index, rule) in rules.iter().enumerate() {
        let is_selected = index == selected;
        outcomes.push(outcome_v1(
            rule,
            is_selected,
            if is_selected {
                constant_count_v1(&rule.count)?
            } else {
                0
            },
            Some(draw_index),
            None,
        ));
    }
    Ok(())
}

pub fn block_action_exclusive_selection_v1(
    draw: u32,
    chance_millionths: &[u64],
) -> Result<usize, BlockActionLootErrorV1> {
    let mut cumulative = 0_u64;
    let mut selected = None;
    for (index, chance) in chance_millionths.iter().copied().enumerate() {
        if chance == 0 || chance > CONTENT_ACTION_FIXED_SCALE {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::InvalidProfile,
                "$.breakProfile.loot.rules",
                "exclusive probability lies outside 1..1000000",
            ));
        }
        cumulative = cumulative.checked_add(chance).ok_or_else(|| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Overflow,
                "$.breakProfile.loot.rules",
                "exclusive probability sum overflowed",
            )
        })?;
        if selected.is_none()
            && u128::from(draw) * RNG_FIXED_SCALE_V1 < u128::from(cumulative) * RNG_UNIT_DENOMINATOR_V1
        {
            selected = Some(index);
        }
    }
    if cumulative != CONTENT_ACTION_FIXED_SCALE {
        return Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::InvalidProfile,
            "$.breakProfile.loot.rules",
            "exclusive probabilities must total one million millionths",
        ));
    }
    selected.ok_or_else(|| {
        BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::InvalidProfile,
            "$.breakProfile.loot.rules",
            "exclusive rule list did not cover the RNG unit interval",
        )
    })
}

fn evaluate_shared_plant_v1(
    rules: &[crate::ContentBlockLootRule],
    scythe: bool,
    cursor: &mut BlockActionLootRngCursorV1,
    draws: &mut Vec<BlockActionRngDrawV1>,
    outcomes: &mut Vec<BlockActionLootRuleOutcomeV1>,
) -> Result<(), BlockActionLootErrorV1> {
    let (draw_index, draw) = draw_v1(cursor, draws, None, BlockActionRngDrawPurposeV1::SharedPlantYield)?;
    for rule in rules {
        outcomes.push(outcome_v1(
            rule,
            true,
            shared_plant_count_v1(&rule.count, draw, scythe)?,
            None,
            Some(draw_index),
        ));
    }
    Ok(())
}

fn draw_v1(
    cursor: &mut BlockActionLootRngCursorV1,
    draws: &mut Vec<BlockActionRngDrawV1>,
    rule_ordinal: Option<u16>,
    purpose: BlockActionRngDrawPurposeV1,
) -> Result<(u16, u32), BlockActionLootErrorV1> {
    if draws.len() >= MAX_BLOCK_ACTION_LOOT_DRAWS_V1 {
        return Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::Capacity,
            "$.draws",
            "block-action loot draw count exceeds its bound",
        ));
    }
    let index = u16::try_from(draws.len()).map_err(|_| {
        BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::Capacity,
            "$.draws",
            "block-action loot draw index exceeds u16",
        )
    })?;
    cursor.draw_count = cursor.draw_count.checked_add(1).ok_or_else(|| {
        BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::Overflow,
            "$.rng.drawCount",
            "block-action loot RNG draw count is exhausted",
        )
    })?;
    cursor.state = block_action_xorshift32_v1(cursor.state);
    draws.push(BlockActionRngDrawV1 {
        index,
        rule_ordinal,
        purpose,
        value: cursor.state,
    });
    Ok((index, cursor.state))
}

fn constant_count_v1(count: &ContentBlockLootCount) -> Result<u32, BlockActionLootErrorV1> {
    match count {
        ContentBlockLootCount::Constant(value) => Ok(*value),
        _ => Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::UnsupportedSemantics,
            "$.count",
            "constant count was required by this roll scope",
        )),
    }
}

fn random_count_v1(count: &ContentBlockLootCount, draw: u32) -> Result<u32, BlockActionLootErrorV1> {
    match count {
        ContentBlockLootCount::Constant(value) => Ok(*value),
        ContentBlockLootCount::UniformInclusive { minimum, maximum } => {
            block_action_uniform_inclusive_count_v1(draw, *minimum, *maximum)
        }
        ContentBlockLootCount::SharedRollFormula { .. } => Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::UnsupportedSemantics,
            "$.count",
            "shared formula cannot consume an independent random count draw",
        )),
    }
}

pub fn block_action_uniform_inclusive_count_v1(
    draw: u32,
    minimum: u32,
    maximum: u32,
) -> Result<u32, BlockActionLootErrorV1> {
    if minimum == 0 || minimum > maximum {
        return Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::InvalidProfile,
            "$.count",
            "uniform count range requires 1 <= minimum <= maximum",
        ));
    }
    let width = u64::from(maximum) - u64::from(minimum) + 1;
    let offset = (u128::from(draw) * u128::from(width)) / RNG_UNIT_DENOMINATOR_V1;
    u32::try_from(u128::from(minimum) + offset).map_err(|_| {
        BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::Overflow,
            "$.count",
            "uniform count result exceeds u32",
        )
    })
}

fn shared_plant_count_v1(
    count: &ContentBlockLootCount,
    draw: u32,
    scythe: bool,
) -> Result<u32, BlockActionLootErrorV1> {
    match count {
        ContentBlockLootCount::Constant(value) => Ok(*value),
        ContentBlockLootCount::SharedRollFormula { .. } => block_action_shared_plant_count_v1(count, draw, scythe),
        ContentBlockLootCount::UniformInclusive { .. } => Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::UnsupportedSemantics,
            "$.count",
            "uniform count cannot consume a shared plant draw",
        )),
    }
}

pub fn block_action_shared_plant_count_v1(
    count: &ContentBlockLootCount,
    draw: u32,
    scythe: bool,
) -> Result<u32, BlockActionLootErrorV1> {
    let ContentBlockLootCount::SharedRollFormula {
        base,
        floor_roll_multiplier,
        scythe_bonus,
        threshold_bonuses,
    } = count
    else {
        return Err(BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::UnsupportedSemantics,
            "$.count",
            "shared plant evaluator requires a shared-roll-formula count",
        ));
    };
    let p_numerator = (u128::from(draw) * RNG_FIXED_SCALE_V1)
        .min(u128::from(PLANT_YIELD_CLAMP_MAXIMUM_MILLIONTHS_V1) * RNG_UNIT_DENOMINATOR_V1);
    let p_denominator = RNG_UNIT_DENOMINATOR_V1 * RNG_FIXED_SCALE_V1;
    let floor_term = p_numerator * u128::from(*floor_roll_multiplier) / p_denominator;
    let mut total = u128::from(*base) + floor_term;
    if scythe {
        total += u128::from(*scythe_bonus);
    }
    for bonus in threshold_bonuses {
        if p_numerator > u128::from(bonus.above_millionths) * RNG_UNIT_DENOMINATOR_V1 && (!bonus.scythe_only || scythe)
        {
            total += u128::from(bonus.amount);
        }
    }
    u32::try_from(total).map_err(|_| {
        BlockActionLootErrorV1::new(
            BlockActionLootErrorCodeV1::Overflow,
            "$.count",
            "shared plant count exceeds u32",
        )
    })
}

fn outcome_v1(
    rule: &crate::ContentBlockLootRule,
    selected: bool,
    count: u32,
    gate_draw_index: Option<u16>,
    count_draw_index: Option<u16>,
) -> BlockActionLootRuleOutcomeV1 {
    BlockActionLootRuleOutcomeV1 {
        ordinal: rule.ordinal,
        rule_id: rule.id.clone(),
        item_code: rule.item_code,
        selected,
        count,
        gate_draw_index,
        count_draw_index,
    }
}

fn group_generated_stacks_v1(
    outcomes: &[BlockActionLootRuleOutcomeV1],
    item_max_stacks: &BTreeMap<u32, u32>,
) -> Result<Vec<BlockActionGeneratedStackV1>, BlockActionLootErrorV1> {
    let metadata_hash = CanonicalHash::default();
    let mut grouped = BTreeMap::<(u32, CanonicalHash), u64>::new();
    let mut successful = 0_usize;
    for outcome in outcomes.iter().filter(|outcome| outcome.selected && outcome.count > 0) {
        successful = successful.checked_add(1).ok_or_else(|| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Overflow,
                "$.outcomes",
                "successful loot outcome count overflowed",
            )
        })?;
        let total = grouped.entry((outcome.item_code, metadata_hash)).or_default();
        *total = total.checked_add(u64::from(outcome.count)).ok_or_else(|| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Overflow,
                "$.stacks",
                "grouped loot count overflowed",
            )
        })?;
    }
    let mut stacks = Vec::with_capacity(successful);
    for ((item_code, metadata_hash), mut remaining) in grouped {
        let max_stack = item_max_stacks.get(&item_code).copied().ok_or_else(|| {
            BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::MissingItem,
                "$.stacks.item",
                "grouped loot item has no installed stack limit",
            )
        })?;
        while remaining > 0 {
            if stacks.len() >= MAX_BLOCK_ACTION_GENERATED_DROPS_V1 {
                return Err(BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::Capacity,
                    "$.stacks",
                    "grouped loot exceeds the generated-drop bound",
                ));
            }
            let count = remaining.min(u64::from(max_stack));
            let group_ordinal = u16::try_from(stacks.len()).map_err(|_| {
                BlockActionLootErrorV1::new(
                    BlockActionLootErrorCodeV1::Capacity,
                    "$.stacks",
                    "generated-drop ordinal exceeds u16",
                )
            })?;
            stacks.push(BlockActionGeneratedStackV1 {
                group_ordinal,
                item_code,
                metadata_hash,
                count: u32::try_from(count).expect("count is bounded by u32 max_stack"),
            });
            remaining -= count;
        }
    }
    Ok(stacks)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GeneratedDropProvenanceV1 {
    pub schema_version: u16,
    pub manifest_hash: CanonicalHash,
    pub installed_registry_hash: CanonicalHash,
    pub catalog_blob_hash: CanonicalHash,
    pub action_report_hash: CanonicalHash,
    pub rng_semantics_hash: CanonicalHash,
    pub block_action_sequence: u64,
    pub origin_input_sequence: u64,
    pub block_id: u16,
    pub position: BlockActionLootCellV1,
    pub loot_plan_hash: CanonicalHash,
    pub group_ordinal: u16,
}

impl GeneratedDropProvenanceV1 {
    pub fn validate_v1(&self) -> Result<(), BlockActionLootErrorV1> {
        if self.schema_version != BLOCK_ACTION_GENERATED_DROP_PROVENANCE_SCHEMA_VERSION_V1 {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::UnsupportedSemantics,
                "$.provenance.schemaVersion",
                "unsupported generated-drop provenance schema",
            ));
        }
        if self.block_action_sequence == 0 || self.origin_input_sequence == 0 || self.block_id == 0 {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::InvalidContext,
                "$.provenance",
                "generated-drop provenance sequence or block is invalid",
            ));
        }
        if usize::from(self.group_ordinal) >= MAX_BLOCK_ACTION_GENERATED_DROPS_V1 {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Capacity,
                "$.provenance.groupOrdinal",
                "generated-drop provenance group ordinal exceeds its bound",
            ));
        }
        if [
            self.manifest_hash,
            self.installed_registry_hash,
            self.catalog_blob_hash,
            self.action_report_hash,
            self.rng_semantics_hash,
            self.loot_plan_hash,
        ]
        .contains(&CanonicalHash::default())
        {
            return Err(BlockActionLootErrorV1::new(
                BlockActionLootErrorCodeV1::Binding,
                "$.provenance",
                "generated-drop provenance contains a zero content or plan identity",
            ));
        }
        Ok(())
    }

    #[must_use]
    pub fn drop_id_v1(&self) -> String {
        format!("block-loot-v1:{}:{}", self.block_action_sequence, self.group_ordinal)
    }

    #[must_use]
    pub fn custody_id_v1(&self) -> String {
        format!(
            "block-loot-custody-v1:{}:{}",
            self.block_action_sequence, self.group_ordinal
        )
    }

    #[must_use]
    pub fn canonical_hash_v1(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild.gameplay.generated-drop-provenance.v1");
        hasher.write_u16(self.schema_version);
        hasher.write_bytes(self.manifest_hash.as_bytes());
        hasher.write_bytes(self.installed_registry_hash.as_bytes());
        hasher.write_bytes(self.catalog_blob_hash.as_bytes());
        hasher.write_bytes(self.action_report_hash.as_bytes());
        hasher.write_bytes(self.rng_semantics_hash.as_bytes());
        hasher.write_u64(self.block_action_sequence);
        hasher.write_u64(self.origin_input_sequence);
        hasher.write_u16(self.block_id);
        self.position.hash_into(&mut hasher);
        hasher.write_bytes(self.loot_plan_hash.as_bytes());
        hasher.write_u16(self.group_ordinal);
        hasher.finish()
    }
}

fn hash_option_u16(hasher: &mut CanonicalHasher, value: Option<u16>) {
    match value {
        Some(value) => {
            hasher.write_u16(1);
            hasher.write_u16(value);
        }
        None => hasher.write_u16(0),
    }
}
