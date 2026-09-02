use blockwild_types::{CanonicalHash, CanonicalHasher, WORLD_HEIGHT};
use std::fmt;

use crate::option_json::{CANONICAL_NPC_FACTION_IDS, WorldOptionsShape, parse_world_options_json};

pub const PROTOCOL_VERSION: u16 = 2;
pub const REQUEST_SCHEMA_VERSION: u16 = 2;
pub const RESULT_SCHEMA_VERSION: u16 = 2;
pub const GENERATOR_VERSION: u16 = 18;
pub const TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2: u32 = 155;
pub const TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2: &str = "5d4e6b1445b00f3430164d1a8093d8dc";
pub const CHUNK_SIZE: usize = 16;
pub const COLUMN_COUNT: usize = CHUNK_SIZE * CHUNK_SIZE;
pub const CELL_COUNT: usize = COLUMN_COUNT * WORLD_HEIGHT as usize;
pub const SECTION_HEIGHT: usize = 16;
pub const SECTION_COUNT: usize = WORLD_HEIGHT as usize / SECTION_HEIGHT;
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GenerationProfile {
    LegacyV14,
    WorldBelowV15,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GenerationOptions {
    pub profile: GenerationProfile,
    pub cave_frequency: f64,
    pub biome_scale: f64,
    pub resource_abundance: f64,
    pub structures: bool,
    pub settlement_density: f64,
    pub enabled_factions: Vec<String>,
    pub settlement_pattern: String,
    pub settlement_clustering: String,
    pub road_coverage: String,
    pub large_town_frequency: String,
    pub canonical_json: String,
}

impl Default for GenerationOptions {
    fn default() -> Self {
        Self {
            profile: GenerationProfile::WorldBelowV15,
            cave_frequency: 1.0,
            biome_scale: 1.35,
            resource_abundance: 1.0,
            structures: true,
            settlement_density: 1.0,
            enabled_factions: CANONICAL_NPC_FACTION_IDS.into_iter().map(str::to_owned).collect(),
            settlement_pattern: "heartlands-v2".into(),
            settlement_clustering: "regional".into(),
            road_coverage: "regional".into(),
            large_town_frequency: "balanced".into(),
            canonical_json: "{}".into(),
        }
    }
}

impl GenerationOptions {
    #[must_use]
    pub fn normalized(mut self) -> Self {
        self.cave_frequency = round_hundredth(self.cave_frequency.clamp(0.0, 3.0));
        self.biome_scale = round_hundredth(self.biome_scale.clamp(0.25, 4.0));
        self.resource_abundance = round_hundredth(self.resource_abundance.clamp(0.25, 4.0));
        self.settlement_density = round_hundredth(self.settlement_density.clamp(0.0, 2.0));
        let requested_factions = std::mem::take(&mut self.enabled_factions);
        self.enabled_factions = CANONICAL_NPC_FACTION_IDS
            .into_iter()
            .filter(|faction| requested_factions.iter().any(|value| value == faction))
            .map(str::to_owned)
            .collect();
        self
    }
}

fn round_hundredth(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BiomeId {
    DeepOcean = 0,
    Ocean = 1,
    Beach = 2,
    Meadow = 3,
    Wildwood = 4,
    Frostpine = 5,
    Desert = 6,
    Savanna = 7,
    Siltfen = 8,
    Snowfield = 9,
    Badlands = 10,
    Birchlight = 11,
    Bloomwood = 12,
    Highlands = 13,
    Volcanic = 14,
    MushroomFen = 15,
    River = 16,
    CloudreedGlen = 17,
    RainveilJungle = 18,
    SakurabloomGrove = 19,
    LumenTrench = 20,
    SugarplumVale = 21,
    Glimmerwood = 22,
    SnowcapRange = 23,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Block;

impl Block {
    pub const AIR: u16 = 0;
    pub const GRASS: u16 = 1;
    pub const DIRT: u16 = 2;
    pub const STONE: u16 = 3;
    pub const SAND: u16 = 4;
    pub const WILDWOOD_LOG: u16 = 5;
    pub const WILDWOOD_LEAVES: u16 = 6;
    pub const WATER: u16 = 7;
    pub const COAL_ORE: u16 = 8;
    pub const IRON_ORE: u16 = 9;
    pub const PLANKS: u16 = 10;
    pub const BEDROCK: u16 = 14;
    pub const GLASS: u16 = 12;
    pub const GLOWSTONE: u16 = 13;
    pub const SNOWY_GRASS: u16 = 15;
    pub const SNOW: u16 = 16;
    pub const PINE_LOG: u16 = 17;
    pub const PINE_LEAVES: u16 = 18;
    pub const BIRCH_LOG: u16 = 19;
    pub const BIRCH_LEAVES: u16 = 20;
    pub const RED_SAND: u16 = 21;
    pub const CLAY: u16 = 22;
    pub const CACTUS: u16 = 23;
    pub const MUD: u16 = 24;
    pub const SWAMP_GRASS: u16 = 25;
    pub const SAVANNA_GRASS: u16 = 26;
    pub const BLOOM_LOG: u16 = 27;
    pub const BLOOM_LEAVES: u16 = 28;
    pub const COBBLESTONE: u16 = 29;
    pub const CRAFTING_TABLE: u16 = 30;
    pub const COPPER_ORE: u16 = 33;
    pub const GOLD_ORE: u16 = 34;
    pub const CRYSTAL_ORE: u16 = 35;
    pub const DEEPSTONE: u16 = 36;
    pub const LAVA: u16 = 37;
    pub const MUSHROOM_CAP: u16 = 38;
    pub const GRAVEL: u16 = 40;
    pub const MOSS: u16 = 39;
    pub const ICE: u16 = 41;
    pub const BASALT: u16 = 42;
    pub const CRYSTAL_BLOCK: u16 = 44;
    pub const TALL_GRASS: u16 = 46;
    pub const RED_FLOWER: u16 = 47;
    pub const BLUE_FLOWER: u16 = 48;
    pub const WHEAT_CROP: u16 = 49;
    pub const DOOR_CLOSED_LOWER: u16 = 52;
    pub const DOOR_CLOSED_UPPER: u16 = 53;
    pub const DOOR_X_CLOSED_LOWER: u16 = 56;
    pub const DOOR_X_CLOSED_UPPER: u16 = 57;
    pub const BED_NORTH_FOOT: u16 = 64;
    pub const BED_NORTH_HEAD: u16 = 65;
    pub const BED_SOUTH_FOOT: u16 = 66;
    pub const BED_SOUTH_HEAD: u16 = 67;
    pub const BED_EAST_FOOT: u16 = 68;
    pub const BED_EAST_HEAD: u16 = 69;
    pub const BED_WEST_FOOT: u16 = 70;
    pub const BED_WEST_HEAD: u16 = 71;
    pub const MEADOW_GRASS: u16 = 73;
    pub const SUNPETAL: u16 = 74;
    pub const MOON_ORCHID: u16 = 75;
    pub const DESERT_SHRUB: u16 = 76;
    pub const BANANA_PLANT: u16 = 77;
    pub const TEMPLE_SANDSTONE: u16 = 78;
    pub const RUNE_STONE: u16 = 79;
    pub const MOONBERRY_BUSH_RIPE: u16 = 82;
    pub const SUNBERRY_BUSH_RIPE: u16 = 85;
    pub const LIMESTONE: u16 = 97;
    pub const MOON_SLATE: u16 = 98;
    pub const SUNBAKED_CLAY: u16 = 99;
    pub const SALTBRUSH: u16 = 100;
    pub const COAST_ASTER: u16 = 101;
    pub const JUNGLE_GRASS: u16 = 102;
    pub const JUNGLE_LOG: u16 = 103;
    pub const JUNGLE_LEAVES: u16 = 104;
    pub const SAKURA_GRASS: u16 = 105;
    pub const SAKURA_LOG: u16 = 106;
    pub const SAKURA_LEAVES: u16 = 107;
    pub const SAKURA_BLOOM: u16 = 108;
    pub const DREAMBLOSSOM: u16 = 109;
    pub const LUMEN_KELP: u16 = 110;
    pub const STAR_CORAL: u16 = 111;
    pub const ABYSS_BLOOM: u16 = 112;
    pub const TIDEVINE: u16 = 113;
    pub const MOONRICE_CROP: u16 = 116;
    pub const SUNROOT_CROP: u16 = 119;
    pub const RAINVEIL_FERN: u16 = 132;
    pub const LANTERN_LOTUS: u16 = 133;
    pub const SUGARPLUM_GRASS: u16 = 137;
    pub const SUGAR_SOIL: u16 = 138;
    pub const CANDYWOOD_LOG: u16 = 139;
    pub const CANDYWOOD_LEAVES: u16 = 140;
    pub const BOILED_SUGARBRICK: u16 = 141;
    pub const GUMDROP_BUSH: u16 = 144;
    pub const PEPPERMINT_TUFT: u16 = 145;
    pub const LOLLIPOP_ORCHID: u16 = 146;
    pub const MARSHMALLOW_SHRUB: u16 = 147;
    pub const GLIMMER_GRASS: u16 = 157;
    pub const MOONBOUGH_LOG: u16 = 158;
    pub const MOONBOUGH_LEAVES: u16 = 159;
    pub const MOONPETAL: u16 = 160;
    pub const STARFERN: u16 = 161;
    pub const DREAMCAP: u16 = 162;
    pub const LUMENREED: u16 = 163;
    pub const SNOWCAP_STONE: u16 = 164;
    pub const RIVETED_BRASS: u16 = 166;
    pub const DEEPGEAR_LANTERN: u16 = 167;
    pub const WILDWOOD_FENCE: u16 = 92;
    pub const FENCE_GATE_NORTH_SOUTH_CLOSED: u16 = 93;
    pub const FENCE_GATE_EAST_WEST_CLOSED: u16 = 94;
    pub const SUGARWORKS: u16 = 154;
    pub const DEEPGEAR_BRICK: u16 = 165;
    pub const GEAR_TABLE: u16 = 170;
    pub const GOLEM_FORGE: u16 = 168;
    pub const POWDERWORKS: u16 = 169;
    pub const AETHER_CONDUIT: u16 = 171;
    pub const MOONBOUGH_CHAIR: u16 = 173;
    pub const MOONWELL: u16 = 174;
    pub const COTTON_CROP: u16 = 183;
    pub const SUN_CARROT_CROP: u16 = 186;
    pub const BLUEPOD_CROP: u16 = 189;
    pub const DOUBLE_TALL_GRASS_LOWER: u16 = 199;
    pub const DOUBLE_TALL_GRASS_UPPER: u16 = 200;
    pub const CLOUDREED_GRASS: u16 = 246;
    pub const CLOUDBELL: u16 = 247;
    pub const STONE_BRICK: u16 = 11;
    pub const TORCH_WALL_NORTH: u16 = 60;
    pub const TORCH_WALL_SOUTH: u16 = 61;
    pub const TORCH_WALL_EAST: u16 = 62;
    pub const TORCH_WALL_WEST: u16 = 63;
    pub const FURNACE: u16 = 31;
    pub const TORCH: u16 = 32;
    pub const CHEST: u16 = 45;
    pub const WILDWOOD_TABLE: u16 = 128;
    pub const WILDWOOD_STOOL: u16 = 129;
    pub const WILDWOOD_SHELF: u16 = 130;
    pub const SEALED_BARREL: u16 = 131;
    pub const HEARTH_FIREPLACE: u16 = 191;
    pub const FROSTPEAR_SAPLING: u16 = 539;
    pub const FROSTPEAR_LEAVES: u16 = 540;
    pub const FROSTPEAR_FRUIT: u16 = 541;
    pub const ROOTWEAVE_SOIL: u16 = 256;
    pub const LIVING_ROOT: u16 = 257;
    pub const LUMINOUS_ROOT: u16 = 258;
    pub const GROTTO_MOSS: u16 = 259;
    pub const HANGING_ROOT: u16 = 260;
    pub const STARBLOOM_CAP: u16 = 262;
    pub const STARBLOOM_STEM: u16 = 263;
    pub const LUMINOUS_GILLS: u16 = 264;
    pub const LANTERN_BLOOM: u16 = 265;
    pub const SPORE_POD: u16 = 266;
    pub const GLASSWATER_STONE: u16 = 268;
    pub const REFLECTIVE_SHALE: u16 = 269;
    pub const CAVE_REED: u16 = 270;
    pub const LUMINOUS_ALGAE: u16 = 271;
    pub const EGG_REED: u16 = 273;
    pub const MINERAL_CRUST: u16 = 274;
    pub const PILLARSTONE: u16 = 275;
    pub const FLOWSTONE: u16 = 276;
    pub const FOSSIL_STONE: u16 = 277;
    pub const CRYSTALDEEP_STONE: u16 = 278;
    pub const RESONANT_CRYSTAL: u16 = 279;
    pub const BUDDING_CRYSTAL: u16 = 280;
    pub const CRYSTAL_CLUSTER: u16 = 281;
    pub const SULFUR_STONE: u16 = 283;
    pub const SULFUR_GROWTH: u16 = 284;
    pub const FUMAROLE_VENT: u16 = 285;
    pub const HEAT_CRACKED_ROCK: u16 = 286;
    pub const MINERAL_TERRACE: u16 = 287;
    pub const LIVING_VEIN: u16 = 288;
    pub const VEINMETAL_HEART: u16 = 289;
    pub const ROPE_ANCHOR: u16 = 290;
    pub const CAVE_MARKER: u16 = 293;
    pub const CAVE_BRIDGE: u16 = 295;
    pub const DEEPGEAR_LIFT: u16 = 296;
    pub const CAPTURE_ORB_RACK: u16 = 241;
    pub const CREATURE_HEALER: u16 = 242;
    pub const APIARY: u16 = 240;
    pub const WILD_BEEHIVE: u16 = 248;
    pub const CARTOGRAPHY_TABLE: u16 = 249;
    pub const ALCHEMY_STAND: u16 = 250;
    pub const WAYSHRINE: u16 = 251;
    pub const DISTILLERY: u16 = 252;
    pub const HEARTH_CHAIR: u16 = 253;
    pub const HOBBIT_THATCH: u16 = 254;
    pub const GOBLIN_BRASSWORK: u16 = 255;
    pub const WAYFARER_CANVAS: u16 = 192;
    pub const WHISPERGLASS: u16 = 193;
    pub const STORYBOOK_BRICK: u16 = 194;
    pub const GILDED_DRAGONSTONE: u16 = 195;
    pub const ARGENT_DRAGONSTONE: u16 = 196;
    pub const GOLD_DRAGON_EGG_BLOCK: u16 = 197;
    pub const SILVER_DRAGON_EGG_BLOCK: u16 = 198;
    pub const WROUGHT_IRON_DOOR_CLOSED_LOWER: u16 = 202;
    pub const WROUGHT_IRON_DOOR_CLOSED_UPPER: u16 = 203;
    pub const FIELD_PERCH: u16 = 210;
    pub const CHARRED_DRAGONSTONE: u16 = 217;
    pub const RIME_DRAGONSTONE: u16 = 218;
    pub const RIVETED_DRAGONSTONE: u16 = 219;
    pub const GOLD_BLOCK: u16 = 220;
    pub const GOLD_PILE: u16 = 221;
    pub const FIRE_DRAGON_EGG_BLOCK: u16 = 222;
    pub const ICE_DRAGON_EGG_BLOCK: u16 = 223;
    pub const STEEL_DRAGON_EGG_BLOCK: u16 = 224;
    pub const SEA_DRAGON_EGG_BLOCK: u16 = 175;
    pub const ARCHIVE_SHELF: u16 = 226;
    pub const TOME_DISPLAY: u16 = 227;
    pub const GIANT_MOONPETAL: u16 = 234;
    pub const NACRE_TIDEWORK: u16 = 546;
    pub const WINDWORN_ALABASTER: u16 = 547;
    pub const FOSSILROOT_CALCITE: u16 = 548;
    pub const EMBERGLASS_ARCHIVE: u16 = 549;
    pub const MIRRORPEAT: u16 = 550;
    pub const REEDGLASS: u16 = 551;
    pub const MOONFELT_MYCELIUM: u16 = 552;
    pub const WHEAT_MILL: u16 = 598;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GenerateChunkRequestV2 {
    pub protocol_version: u16,
    pub schema_version: u16,
    pub epoch: u32,
    pub task_id: u32,
    pub revision: u32,
    pub namespace: String,
    pub content_hash: String,
    pub generator_hash: String,
    pub seed_text: String,
    pub generation_options_json: String,
    pub key: String,
    pub cx: i32,
    pub cz: i32,
    pub edits: Vec<(u32, u16)>,
    pub request_hash: String,
}

impl GenerateChunkRequestV2 {
    pub fn validate(&self) -> Result<(), GenerationError> {
        if self.protocol_version != PROTOCOL_VERSION || self.schema_version != REQUEST_SCHEMA_VERSION {
            return Err(GenerationError::InvalidRequest("unsupported protocol or schema".into()));
        }
        if self.key != format!("{},{}", self.cx, self.cz) {
            return Err(GenerationError::InvalidRequest(
                "chunk key does not match coordinates".into(),
            ));
        }
        if !valid_hash(&self.content_hash) || !valid_hash(&self.generator_hash) || !valid_hash(&self.request_hash) {
            return Err(GenerationError::InvalidRequest(
                "hash fields must be 32 lowercase hexadecimal characters".into(),
            ));
        }
        parse_flat_options(&self.generation_options_json)?;
        let mut previous = None;
        for &(index, _) in &self.edits {
            if index as usize >= CELL_COUNT || previous.is_some_and(|value| index <= value) {
                return Err(GenerationError::InvalidRequest(
                    "edits must be sorted, unique, and in bounds".into(),
                ));
            }
            previous = Some(index);
        }
        if self.canonical_hash().to_hex() != self.request_hash {
            return Err(GenerationError::InvalidRequest("request hash mismatch".into()));
        }
        Ok(())
    }

    #[must_use]
    pub fn canonical_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild-generate-chunk-request-v2");
        hasher.write_u16(self.protocol_version);
        hasher.write_u16(self.schema_version);
        hasher.write_u32(self.epoch);
        hasher.write_u32(self.task_id);
        hasher.write_u32(self.revision);
        for value in [
            &self.namespace,
            &self.content_hash,
            &self.generator_hash,
            &self.seed_text,
            &self.generation_options_json,
            &self.key,
        ] {
            hasher.write_str(value);
        }
        hasher.write_i32(self.cx);
        hasher.write_i32(self.cz);
        let mut bytes = Vec::with_capacity(self.edits.len() * 8);
        for &(index, block) in &self.edits {
            bytes.extend_from_slice(&index.to_le_bytes());
            bytes.extend_from_slice(&u32::from(block).to_le_bytes());
        }
        hasher.write_bytes(&bytes);
        hasher.finish()
    }
}

fn valid_hash(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct MarkerRow {
    pub key: String,
    /// Canonical JSON `[key, marker]` row, retained opaquely for content breadth.
    pub canonical_json: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChunkPayloadV2 {
    pub protocol_version: u16,
    pub schema_version: u16,
    pub epoch: u32,
    pub task_id: u32,
    pub revision: u32,
    pub namespace: String,
    pub content_hash: String,
    pub generator_hash: String,
    pub request_hash: String,
    pub key: String,
    pub cx: i32,
    pub cz: i32,
    pub blocks: Vec<u16>,
    pub heightmap: Vec<i16>,
    pub biomes: Vec<u8>,
    pub section_block_counts: Vec<u16>,
    pub sky_tops: Vec<i16>,
    pub light: Vec<u16>,
    pub light_indices: Vec<u32>,
    pub leaf_indices: Vec<u32>,
    pub markers: Vec<MarkerRow>,
    pub chunk_hash: String,
}

impl ChunkPayloadV2 {
    pub fn validate(&self, request: &GenerateChunkRequestV2) -> Result<(), GenerationError> {
        if self.protocol_version != PROTOCOL_VERSION
            || self.schema_version != RESULT_SCHEMA_VERSION
            || self.epoch != request.epoch
            || self.task_id != request.task_id
            || self.revision != request.revision
            || self.request_hash != request.request_hash
            || self.key != request.key
            || self.cx != request.cx
            || self.cz != request.cz
        {
            return Err(GenerationError::InvalidResult(
                "result authority metadata mismatch".into(),
            ));
        }
        if self.blocks.len() != CELL_COUNT
            || self.light.len() != CELL_COUNT
            || self.heightmap.len() != COLUMN_COUNT
            || self.biomes.len() != COLUMN_COUNT
            || self.sky_tops.len() != COLUMN_COUNT
            || self.section_block_counts.len() != SECTION_COUNT
        {
            return Err(GenerationError::InvalidResult("result stream size mismatch".into()));
        }
        if self.chunk_hash != self.canonical_hash().to_hex() {
            return Err(GenerationError::InvalidResult("chunk hash mismatch".into()));
        }
        Ok(())
    }

    #[must_use]
    pub fn canonical_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild-generated-chunk-v2");
        hasher.write_u16(self.protocol_version);
        hasher.write_u16(self.schema_version);
        hasher.write_u32(self.epoch);
        hasher.write_u32(self.task_id);
        hasher.write_u32(self.revision);
        for value in [
            &self.namespace,
            &self.content_hash,
            &self.generator_hash,
            &self.request_hash,
            &self.key,
        ] {
            hasher.write_str(value);
        }
        hasher.write_i32(self.cx);
        hasher.write_i32(self.cz);
        hash_u16(&mut hasher, &self.blocks);
        hash_i16(&mut hasher, &self.heightmap);
        hasher.write_bytes(&self.biomes);
        hash_u16(&mut hasher, &self.section_block_counts);
        hash_i16(&mut hasher, &self.sky_tops);
        hash_u16(&mut hasher, &self.light);
        hash_u32(&mut hasher, &self.light_indices);
        hash_u32(&mut hasher, &self.leaf_indices);
        let offsets = marker_offsets(&self.markers);
        hash_u32(&mut hasher, &offsets);
        let marker_bytes = self
            .markers
            .iter()
            .flat_map(|row| row.canonical_json.bytes())
            .collect::<Vec<_>>();
        hasher.write_bytes(&marker_bytes);
        hasher.finish()
    }
}

fn hash_u16(hasher: &mut CanonicalHasher, values: &[u16]) {
    let bytes = values.iter().flat_map(|value| value.to_le_bytes()).collect::<Vec<_>>();
    hasher.write_bytes(&bytes);
}

fn hash_i16(hasher: &mut CanonicalHasher, values: &[i16]) {
    let bytes = values.iter().flat_map(|value| value.to_le_bytes()).collect::<Vec<_>>();
    hasher.write_bytes(&bytes);
}

fn hash_u32(hasher: &mut CanonicalHasher, values: &[u32]) {
    let bytes = values.iter().flat_map(|value| value.to_le_bytes()).collect::<Vec<_>>();
    hasher.write_bytes(&bytes);
}

#[must_use]
pub fn marker_offsets(markers: &[MarkerRow]) -> Vec<u32> {
    let mut result = Vec::with_capacity(markers.len() + 1);
    result.push(0);
    let mut offset = 0_u32;
    for row in markers {
        offset = offset.saturating_add(row.canonical_json.len() as u32);
        result.push(offset);
    }
    result
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParityCertificate {
    pub generator_version: u16,
    pub generator_hash: String,
    pub content_hash: String,
    pub corpus_hash: String,
    pub corpus_cases: u32,
    pub byte_equal: bool,
}

impl ParityCertificate {
    #[must_use]
    pub fn promotes(&self, request: &GenerateChunkRequestV2) -> bool {
        self.generator_version == GENERATOR_VERSION
            && self.byte_equal
            && self.corpus_cases == TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2
            && self.corpus_hash == TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2
            && self.generator_hash == request.generator_hash
            && self.content_hash == request.content_hash
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GenerationError {
    InvalidRequest(String),
    InvalidResult(String),
    UnsupportedGenerator(String),
    Cancelled,
    Wire(String),
}

impl fmt::Display for GenerationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(message) => write!(formatter, "invalid request: {message}"),
            Self::InvalidResult(message) => write!(formatter, "invalid result: {message}"),
            Self::UnsupportedGenerator(message) => write!(formatter, "unsupported generator: {message}"),
            Self::Cancelled => formatter.write_str("generation cancelled"),
            Self::Wire(message) => write!(formatter, "wire error: {message}"),
        }
    }
}

impl std::error::Error for GenerationError {}

pub fn parse_flat_options(canonical_json: &str) -> Result<GenerationOptions, GenerationError> {
    let parsed = parse_world_options_json(canonical_json, WorldOptionsShape::GenerationPatch)
        .map_err(|error| GenerationError::InvalidRequest(error.to_string()))?;
    let profile = match parsed.profile {
        Some("legacy-v14") => GenerationProfile::LegacyV14,
        Some("world-below-v15") | None => GenerationProfile::WorldBelowV15,
        Some(_) => unreachable!("world option parser admits only known profiles"),
    };
    let legacy = profile == GenerationProfile::LegacyV14;
    Ok(GenerationOptions {
        profile,
        cave_frequency: parsed.cave_frequency.unwrap_or(1.0),
        biome_scale: parsed.biome_scale.unwrap_or(if legacy { 1.0 } else { 1.35 }),
        resource_abundance: parsed.resource_abundance.unwrap_or(1.0),
        structures: parsed.structures.unwrap_or(true),
        settlement_density: parsed.settlement_density.unwrap_or(1.0),
        enabled_factions: parsed.enabled_factions.map_or_else(
            || CANONICAL_NPC_FACTION_IDS.into_iter().map(str::to_owned).collect(),
            |values| values.into_iter().map(str::to_owned).collect(),
        ),
        settlement_pattern: parsed
            .settlement_pattern
            .unwrap_or(if legacy { "legacy-scattered-v1" } else { "heartlands-v2" })
            .into(),
        settlement_clustering: parsed.settlement_clustering.unwrap_or("regional").into(),
        road_coverage: parsed.road_coverage.unwrap_or("regional").into(),
        large_town_frequency: parsed.large_town_frequency.unwrap_or("balanced").into(),
        canonical_json: canonical_json.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_are_bounded_and_stable() {
        let options = GenerationOptions {
            cave_frequency: 99.0,
            biome_scale: -2.0,
            resource_abundance: 1.237,
            settlement_density: 99.0,
            enabled_factions: vec![
                "dwarves".into(),
                "unknown".into(),
                "hobbits".into(),
                "dwarves".into(),
                "goblins".into(),
            ],
            ..Default::default()
        }
        .normalized();
        assert_eq!(options.cave_frequency, 3.0);
        assert_eq!(options.biome_scale, 0.25);
        assert_eq!(options.resource_abundance, 1.24);
        assert_eq!(options.settlement_density, 2.0);
        assert_eq!(options.enabled_factions, vec!["hobbits", "goblins", "dwarves"]);
    }

    #[test]
    fn generation_patches_preserve_conditional_defaults_and_explicit_values() {
        let modern = parse_flat_options("{}").unwrap();
        assert_eq!(modern.profile, GenerationProfile::WorldBelowV15);
        assert_eq!(modern.biome_scale, 1.35);
        assert_eq!(modern.settlement_pattern, "heartlands-v2");
        assert_eq!(modern.enabled_factions.len(), 6);

        let legacy = parse_flat_options(r#"{"profile":"legacy-v14"}"#).unwrap();
        assert_eq!(legacy.profile, GenerationProfile::LegacyV14);
        assert_eq!(legacy.biome_scale, 1.0);
        assert_eq!(legacy.settlement_pattern, "legacy-scattered-v1");

        let explicit = parse_flat_options(
            r#"{"enabledFactions":[],"origin":{"mode":"wilderness"},"profile":"legacy-v14","settlementPattern":"heartlands-v2"}"#,
        )
        .unwrap();
        assert_eq!(explicit.profile, GenerationProfile::LegacyV14);
        assert_eq!(explicit.biome_scale, 1.0);
        assert_eq!(explicit.settlement_pattern, "heartlands-v2");
        assert!(explicit.enabled_factions.is_empty());
    }

    #[test]
    fn hash_valid_nested_generation_spoofs_are_invalid_requests() {
        let mut request = crate::service::fixture_request("nested-spoof", 0, 0, 1);
        request.generation_options_json = r#"{"origin":{"profile":"legacy-v14"}}"#.into();
        request.request_hash = request.canonical_hash().to_hex();
        assert_eq!(request.canonical_hash().to_hex(), request.request_hash);
        assert!(matches!(
            request.validate(),
            Err(GenerationError::InvalidRequest(message)) if message.contains("origin")
        ));
    }

    #[test]
    fn parity_requires_the_exact_promoted_certificate() {
        let request = crate::service::fixture_request("parity", -8, 7, 1);
        let certificate = ParityCertificate {
            generator_version: GENERATOR_VERSION,
            generator_hash: request.generator_hash.clone(),
            content_hash: request.content_hash.clone(),
            corpus_hash: TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2.into(),
            corpus_cases: TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
            byte_equal: true,
        };
        assert!(certificate.promotes(&request));
        assert!(
            !ParityCertificate {
                corpus_cases: 154,
                ..certificate.clone()
            }
            .promotes(&request)
        );
        assert!(
            !ParityCertificate {
                corpus_cases: 156,
                ..certificate.clone()
            }
            .promotes(&request)
        );
        assert!(
            !ParityCertificate {
                corpus_hash: "0".repeat(32),
                ..certificate.clone()
            }
            .promotes(&request)
        );
        assert!(
            !ParityCertificate {
                corpus_hash: "4d4e6b1445b00f3430164d1a8093d8dc".into(),
                ..certificate.clone()
            }
            .promotes(&request)
        );
        assert!(
            !ParityCertificate {
                generator_hash: "f".repeat(32),
                ..certificate.clone()
            }
            .promotes(&request)
        );
        assert!(
            !ParityCertificate {
                byte_equal: false,
                ..certificate
            }
            .promotes(&request)
        );
    }
}
