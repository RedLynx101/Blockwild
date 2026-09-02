use crate::contract::{BiomeId, Block, CHUNK_SIZE, GenerationOptions, MarkerRow};
use crate::features::is_syrup_pond_column;
use crate::generator::TerrainGeneratorV18;
use crate::roads::{self, RoadNode, RoadPointKind, RoadSample};
use crate::settlement_layout;
use blockwild_types::{fnv1a_utf16, hash2};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

const REGION_BLOCKS: i32 = 32 * CHUNK_SIZE as i32;
const PROVINCE_REGIONS: i32 = 8;
const REACH: i32 = 208;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) enum Faction {
    Hobbits,
    Goblins,
    Atlantians,
    Sugarcourt,
    WoodElves,
    Dwarves,
}

impl Faction {
    const ALL: [Self; 6] = [
        Self::Hobbits,
        Self::Goblins,
        Self::Atlantians,
        Self::Sugarcourt,
        Self::WoodElves,
        Self::Dwarves,
    ];

    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::Hobbits => "hobbits",
            Self::Goblins => "goblins",
            Self::Atlantians => "atlantians",
            Self::Sugarcourt => "sugarcourt",
            Self::WoodElves => "wood-elves",
            Self::Dwarves => "dwarves",
        }
    }

    pub(crate) fn from_id(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|faction| faction.id() == value)
    }

    fn enabled(options: &GenerationOptions) -> Vec<Self> {
        Self::ALL
            .into_iter()
            .filter(|faction| options.enabled_factions.iter().any(|value| value == faction.id()))
            .collect()
    }

    fn eligible(self, biome: SettlementBiome) -> bool {
        match self {
            Self::Hobbits => matches!(
                biome,
                SettlementBiome::Forest | SettlementBiome::FlowerMeadow | SettlementBiome::Wildwood
            ),
            Self::Goblins => matches!(
                biome,
                SettlementBiome::Highlands | SettlementBiome::Badlands | SettlementBiome::CloudreedGlen
            ),
            Self::Atlantians => matches!(biome, SettlementBiome::DeepOcean | SettlementBiome::LumenTrench),
            Self::Sugarcourt => biome == SettlementBiome::SugarplumVale,
            Self::WoodElves => biome == SettlementBiome::Glimmerwood,
            Self::Dwarves => matches!(
                biome,
                SettlementBiome::SnowcapRange
                    | SettlementBiome::Highlands
                    | SettlementBiome::Badlands
                    | SettlementBiome::CloudreedGlen
            ),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SettlementBiome {
    Forest,
    FlowerMeadow,
    Wildwood,
    Highlands,
    Badlands,
    CloudreedGlen,
    DeepOcean,
    LumenTrench,
    SugarplumVale,
    Glimmerwood,
    SnowcapRange,
}

impl SettlementBiome {
    pub(crate) const fn id(self) -> &'static str {
        match self {
            Self::Forest => "forest",
            Self::FlowerMeadow => "flower-meadow",
            Self::Wildwood => "wildwood",
            Self::Highlands => "highlands",
            Self::Badlands => "badlands",
            Self::CloudreedGlen => "cloudreed-glen",
            Self::DeepOcean => "deep-ocean",
            Self::LumenTrench => "lumen-trench",
            Self::SugarplumVale => "sugarplum-vale",
            Self::Glimmerwood => "glimmerwood",
            Self::SnowcapRange => "snowcap-range",
        }
    }
}

fn settlement_biome(biome: BiomeId) -> Option<SettlementBiome> {
    match biome {
        BiomeId::Meadow => Some(SettlementBiome::FlowerMeadow),
        BiomeId::Wildwood => Some(SettlementBiome::Wildwood),
        BiomeId::Birchlight | BiomeId::Bloomwood | BiomeId::RainveilJungle | BiomeId::SakurabloomGrove => {
            Some(SettlementBiome::Forest)
        }
        BiomeId::Highlands => Some(SettlementBiome::Highlands),
        BiomeId::Badlands => Some(SettlementBiome::Badlands),
        BiomeId::CloudreedGlen => Some(SettlementBiome::CloudreedGlen),
        BiomeId::DeepOcean => Some(SettlementBiome::DeepOcean),
        BiomeId::LumenTrench => Some(SettlementBiome::LumenTrench),
        BiomeId::SugarplumVale => Some(SettlementBiome::SugarplumVale),
        BiomeId::Glimmerwood => Some(SettlementBiome::Glimmerwood),
        BiomeId::SnowcapRange => Some(SettlementBiome::SnowcapRange),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) enum Size {
    Hamlet,
    Village,
    Town,
}

impl Size {
    pub(crate) fn radius(self) -> i32 {
        match self {
            Self::Hamlet => 14,
            Self::Village => 22,
            Self::Town => 31,
        }
    }

    pub(crate) const fn id(self) -> &'static str {
        match self {
            Self::Hamlet => "hamlet",
            Self::Village => "village",
            Self::Town => "town",
        }
    }

    pub(crate) fn from_id(value: &str) -> Option<Self> {
        [Self::Hamlet, Self::Village, Self::Town]
            .into_iter()
            .find(|size| size.id() == value)
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) enum Environment {
    Surface,
    Underwater,
    Underground,
}

impl Environment {
    pub(crate) const fn id(self) -> &'static str {
        match self {
            Self::Surface => "surface",
            Self::Underwater => "underwater",
            Self::Underground => "underground",
        }
    }

    pub(crate) fn from_id(value: &str) -> Option<Self> {
        [Self::Surface, Self::Underwater, Self::Underground]
            .into_iter()
            .find(|environment| environment.id() == value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProvinceClass {
    Wild,
    Frontier,
    Heartland,
    Crossroads,
}

#[derive(Clone, Debug)]
pub(crate) struct Candidate {
    pub(crate) id: String,
    pub(crate) region_x: i32,
    pub(crate) region_z: i32,
    pub(crate) x: i32,
    pub(crate) z: i32,
    pub(crate) floor_y: Option<i32>,
    pub(crate) size: Size,
    pub(crate) faction: Faction,
    pub(crate) biome: SettlementBiome,
    pub(crate) environment: Environment,
}

#[derive(Clone, Debug)]
pub(crate) struct GuildHall {
    pub(crate) placement_id: String,
    pub(crate) guild_id: &'static str,
}

#[derive(Clone)]
struct Province {
    class: ProvinceClass,
    principal: Option<Faction>,
    members: Vec<(i32, i32, bool)>,
}

#[derive(Clone, Copy)]
struct Intent {
    size: Size,
    preferred: Option<Faction>,
}

#[derive(Clone, Copy)]
pub(crate) struct SettlementPlacement {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub block: u16,
}

#[derive(Clone)]
pub(crate) struct SettlementPlan {
    pub placements: Vec<SettlementPlacement>,
    pub only_air_placements: Vec<SettlementPlacement>,
    pub markers: Vec<(i32, i32, MarkerRow)>,
    pub clear_bounds: Option<(i32, i32, i32, i32)>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RoadTier {
    Local,
    Regional,
    Trunk,
}

impl RoadTier {
    const fn id(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Regional => "regional",
            Self::Trunk => "trunk",
        }
    }
}

#[derive(Clone)]
struct SettlementRoad {
    id: String,
    from: Candidate,
    to: Candidate,
    length: f64,
    looped: bool,
    tier: RoadTier,
}

fn hash32(value: &str) -> u32 {
    let mut hash = 2_166_136_261_u32;
    for unit in value.encode_utf16() {
        hash = (hash ^ u32::from(unit)).wrapping_mul(16_777_619);
    }
    hash
}

fn unit(seed: &str, salt: &str) -> f64 {
    f64::from(hash32(&format!("{seed}|{salt}"))) / 4_294_967_296.0
}

fn js_round(value: f64) -> i32 {
    (value + 0.5).floor() as i32
}

fn base36(value: i32) -> String {
    if value == 0 {
        return "0".into();
    }
    let negative = value < 0;
    let mut magnitude = i64::from(value).unsigned_abs();
    let mut digits = Vec::new();
    while magnitude > 0 {
        let digit = (magnitude % 36) as u8;
        digits.push(if digit < 10 {
            char::from(b'0' + digit)
        } else {
            char::from(b'a' + digit - 10)
        });
        magnitude /= 36;
    }
    if negative {
        digits.push('-');
    }
    digits.iter().rev().collect()
}

fn base36_u32(mut value: u32) -> String {
    if value == 0 {
        return "0".into();
    }
    let mut digits = Vec::new();
    while value > 0 {
        let digit = (value % 36) as u8;
        digits.push(if digit < 10 {
            char::from(b'0' + digit)
        } else {
            char::from(b'a' + digit - 10)
        });
        value /= 36;
    }
    digits.into_iter().rev().collect()
}

fn settlement_id(seed: &str, region_x: i32, region_z: i32, faction: Faction) -> String {
    let prefix = match faction {
        Faction::Hobbits => "freehold",
        Faction::Goblins => "clanhold",
        Faction::Atlantians => "tidehold",
        Faction::Sugarcourt => "bonbon-borough",
        Faction::WoodElves => "moonbough-enclave",
        Faction::Dwarves => "deepgear-hold",
    };
    format!(
        "{prefix}-{}-{}-{}",
        base36(region_x),
        base36(region_z),
        base36_u32(hash32(&format!("{seed}|{region_x}|{region_z}|{}", faction.id())))
    )
}

fn choose_faction(
    seed: &str,
    region_x: i32,
    region_z: i32,
    biome: SettlementBiome,
    enabled: &[Faction],
) -> Option<Faction> {
    let eligible = enabled
        .iter()
        .copied()
        .filter(|faction| faction.eligible(biome))
        .collect::<Vec<_>>();
    if eligible.is_empty() {
        return None;
    }
    Some(
        eligible[((unit(seed, &format!("{region_x}|{region_z}|faction")) * eligible.len() as f64).floor() as usize)
            .min(eligible.len() - 1)],
    )
}

fn planned_candidate(
    seed: &str,
    region_x: i32,
    region_z: i32,
    biome: SettlementBiome,
    floor_y: i32,
    enabled: &[Faction],
) -> Option<Candidate> {
    let faction = choose_faction(seed, region_x, region_z, biome, enabled)?;
    let size_roll = unit(seed, &format!("{region_x}|{region_z}|size"));
    let size = if size_roll < 0.58 {
        Size::Hamlet
    } else if size_roll < 0.9 {
        Size::Village
    } else {
        Size::Town
    };
    let environment = match faction {
        Faction::Atlantians => Environment::Underwater,
        Faction::Dwarves => Environment::Underground,
        _ => Environment::Surface,
    };
    let resolved_floor = match environment {
        Environment::Underwater => Some(floor_y.clamp(-52, 22)),
        Environment::Underground => Some((floor_y - 18).clamp(-48, 58)),
        Environment::Surface => None,
    };
    Some(Candidate {
        id: settlement_id(seed, region_x, region_z, faction),
        region_x,
        region_z,
        x: region_x * REGION_BLOCKS + 96 + (unit(seed, &format!("{region_x}|{region_z}|x")) * 320.0).floor() as i32,
        z: region_z * REGION_BLOCKS + 96 + (unit(seed, &format!("{region_x}|{region_z}|z")) * 320.0).floor() as i32,
        floor_y: resolved_floor,
        size,
        faction,
        biome,
        environment,
    })
}

struct Planner<'a> {
    seed: &'a str,
    numeric_seed: u32,
    generator: &'a TerrainGeneratorV18,
    options: &'a GenerationOptions,
    enabled: Vec<Faction>,
    provinces: BTreeMap<(i32, i32), Province>,
    raw: BTreeMap<(i32, i32), Option<Candidate>>,
    accepted: BTreeMap<(i32, i32), Option<Candidate>>,
}

impl<'a> Planner<'a> {
    fn new(seed: &'a str, generator: &'a TerrainGeneratorV18) -> Self {
        let options = generator.options();
        Self {
            seed,
            numeric_seed: fnv1a_utf16(seed),
            generator,
            options,
            enabled: Faction::enabled(options),
            provinces: BTreeMap::new(),
            raw: BTreeMap::new(),
            accepted: BTreeMap::new(),
        }
    }

    fn forbidden(&self, x: i32, z: i32, biome: SettlementBiome) -> bool {
        !matches!(biome, SettlementBiome::DeepOcean | SettlementBiome::LumenTrench)
            && is_syrup_pond_column(self.generator, self.seed, x, z)
    }

    fn province(&mut self, province_x: i32, province_z: i32) -> Province {
        if let Some(province) = self.provinces.get(&(province_x, province_z)) {
            return province.clone();
        }
        let clustering_coverage = match self.options.settlement_clustering.as_str() {
            "strong" => 0.29,
            "even" => 0.48,
            _ => 0.38,
        };
        let coverage = (clustering_coverage * self.options.settlement_density.powf(0.72)).clamp(0.0, 0.82);
        let disabled = !self.options.structures || self.enabled.is_empty() || self.options.settlement_density <= 0.0;
        let class = if self.options.settlement_pattern == "legacy-scattered-v1" {
            ProvinceClass::Frontier
        } else if disabled || unit(self.seed, &format!("heartland-class|{province_x}|{province_z}")) >= coverage {
            ProvinceClass::Wild
        } else {
            let kind = unit(self.seed, &format!("heartland-kind|{province_x}|{province_z}"));
            if kind < 0.1 {
                ProvinceClass::Crossroads
            } else if kind < 0.56 {
                ProvinceClass::Heartland
            } else {
                ProvinceClass::Frontier
            }
        };
        let origin_x = province_x * PROVINCE_REGIONS;
        let origin_z = province_z * PROVINCE_REGIONS;
        let parent_x = origin_x
            + 2
            + (unit(self.seed, &format!("heartland-parent-x|{province_x}|{province_z}")) * 4.0).floor() as i32;
        let parent_z = origin_z
            + 2
            + (unit(self.seed, &format!("heartland-parent-z|{province_x}|{province_z}")) * 4.0).floor() as i32;
        let parent_sample = self.generator.sample_column(
            parent_x * REGION_BLOCKS + REGION_BLOCKS / 2,
            parent_z * REGION_BLOCKS + REGION_BLOCKS / 2,
        );
        let parent_biome = settlement_biome(parent_sample.biome);
        let eligible = parent_biome.map_or_else(Vec::new, |biome| {
            self.enabled
                .iter()
                .copied()
                .filter(|faction| faction.eligible(biome))
                .collect()
        });
        let pool = if eligible.is_empty() { &self.enabled } else { &eligible };
        let principal = if pool.is_empty() {
            None
        } else {
            Some(pool[((unit(self.seed, &format!("heartland-culture|{parent_x}|{parent_z}")) * pool.len() as f64).floor() as usize).min(pool.len() - 1)])
        };
        let base = match class {
            ProvinceClass::Wild => 0,
            ProvinceClass::Frontier => 2,
            ProvinceClass::Heartland => 5,
            ProvinceClass::Crossroads => 6,
        };
        let bonus = match self.options.settlement_clustering.as_str() {
            "strong" => 1,
            "even" => -1,
            _ => 0,
        };
        let count = if base == 0 {
            0
        } else {
            js_round(f64::from(base) * self.options.settlement_density.clamp(0.35, 2.0) + f64::from(bonus)).clamp(1, 10)
        };
        let weight = match self.options.settlement_clustering.as_str() {
            "strong" => 3.8,
            "even" => 0.18,
            _ => 1.75,
        };
        let mut cells = Vec::new();
        for local_x in 0..PROVINCE_REGIONS {
            for local_z in 0..PROVINCE_REGIONS {
                let x = origin_x + local_x;
                let z = origin_z + local_z;
                if x == parent_x && z == parent_z {
                    continue;
                }
                let distance = f64::from(x - parent_x).hypot(f64::from(z - parent_z));
                let edge = if local_x == 0 || local_z == 0 || local_x == 7 || local_z == 7 {
                    0.55
                } else {
                    0.0
                };
                let score = distance * weight
                    + edge
                    + unit(
                        self.seed,
                        &format!("heartland-member|{province_x}|{province_z}|{x}|{z}"),
                    ) * 5.0;
                cells.push((x, z, score));
            }
        }
        cells.sort_by(|left, right| {
            left.2
                .partial_cmp(&right.2)
                .unwrap_or(Ordering::Equal)
                .then(left.0.cmp(&right.0))
                .then(left.1.cmp(&right.1))
        });
        let mut members = Vec::new();
        if count > 0 {
            members.push((parent_x, parent_z, true));
            members.extend(
                cells
                    .into_iter()
                    .take((count - 1) as usize)
                    .map(|(x, z, _)| (x, z, false)),
            );
        }
        let province = Province {
            class,
            principal,
            members,
        };
        self.provinces.insert((province_x, province_z), province.clone());
        province
    }

    fn intent(&mut self, region_x: i32, region_z: i32) -> Option<Intent> {
        let province = self.province(
            region_x.div_euclid(PROVINCE_REGIONS),
            region_z.div_euclid(PROVINCE_REGIONS),
        );
        if self.options.settlement_pattern == "legacy-scattered-v1" {
            return Some(Intent {
                size: Size::Hamlet,
                preferred: None,
            });
        }
        let member = province
            .members
            .iter()
            .find(|(x, z, _)| *x == region_x && *z == region_z)
            .copied();
        let Some((_, _, parent)) = member else {
            let chance = 0.004
                * self.options.settlement_density
                * if province.class == ProvinceClass::Wild {
                    1.0
                } else {
                    0.2
                };
            return (unit(self.seed, &format!("frontier-solitary|{region_x}|{region_z}")) < chance).then_some(Intent {
                size: Size::Hamlet,
                preferred: None,
            });
        };
        if parent {
            let town_chance = match self.options.large_town_frequency.as_str() {
                "frequent" => 0.94,
                "rare" => 0.48,
                _ => 0.76,
            };
            let size = if province.class == ProvinceClass::Frontier
                || unit(self.seed, &format!("heartland-parent-size|{region_x}|{region_z}")) > town_chance
            {
                Size::Village
            } else {
                Size::Town
            };
            Some(Intent {
                size,
                preferred: province.principal,
            })
        } else {
            let chance = match self.options.large_town_frequency.as_str() {
                "frequent" => 0.52,
                "rare" => 0.22,
                _ => 0.36,
            };
            Some(Intent {
                size: if unit(self.seed, &format!("heartland-satellite-size|{region_x}|{region_z}")) < chance {
                    Size::Village
                } else {
                    Size::Hamlet
                },
                preferred: if unit(self.seed, &format!("heartland-satellite-culture|{region_x}|{region_z}")) < 0.82 {
                    province.principal
                } else {
                    None
                },
            })
        }
    }

    fn raw_candidate(&mut self, region_x: i32, region_z: i32) -> Option<Candidate> {
        if let Some(value) = self.raw.get(&(region_x, region_z)) {
            return value.clone();
        }
        let value = self.raw_candidate_uncached(region_x, region_z);
        self.raw.insert((region_x, region_z), value.clone());
        value
    }

    #[allow(clippy::too_many_lines)]
    fn raw_candidate_uncached(&mut self, region_x: i32, region_z: i32) -> Option<Candidate> {
        if !self.options.structures || self.enabled.is_empty() || self.options.settlement_density <= 0.0 {
            return None;
        }
        let intent = self.intent(region_x, region_z)?;
        let origin_x = region_x * REGION_BLOCKS;
        let origin_z = region_z * REGION_BLOCKS;
        let preferred = intent.preferred.filter(|faction| self.enabled.contains(faction));
        let mut passes = Vec::new();
        if let Some(faction) = preferred {
            passes.push(vec![faction]);
            passes.push(self.enabled.clone());
        } else {
            passes.push(self.enabled.clone());
        }
        for enabled in passes {
            let mut best: Option<(Candidate, f64)> = None;
            for site_index in 0..16 {
                let grid_x = site_index % 4;
                let grid_z = site_index / 4;
                let jitter_x_unit = if self.options.settlement_pattern == "legacy-scattered-v1" {
                    hash2(region_x * 31 + site_index, region_z, self.numeric_seed ^ 0x0051_a7e5)
                } else {
                    unit(self.seed, &format!("site-x|{region_x}|{region_z}|{site_index}"))
                };
                let jitter_z_unit = if self.options.settlement_pattern == "legacy-scattered-v1" {
                    hash2(region_x, region_z * 31 + site_index, self.numeric_seed ^ 0x007e_115e)
                } else {
                    unit(self.seed, &format!("site-z|{region_x}|{region_z}|{site_index}"))
                };
                let jitter_x = ((jitter_x_unit - 0.5) * 46.0).floor() as i32;
                let jitter_z = ((jitter_z_unit - 0.5) * 46.0).floor() as i32;
                let x = origin_x + 80 + grid_x * 112 + jitter_x;
                let z = origin_z + 80 + grid_z * 112 + jitter_z;
                let terrain = self.generator.sample_column(x, z);
                let Some(biome) = settlement_biome(terrain.biome) else {
                    continue;
                };
                if self.forbidden(x, z, biome) {
                    continue;
                }
                let Some(mut candidate) =
                    planned_candidate(self.seed, region_x, region_z, biome, terrain.height, &enabled)
                else {
                    continue;
                };
                if self.options.settlement_pattern != "legacy-scattered-v1" {
                    candidate.size = intent.size;
                }
                let underwater = candidate.environment == Environment::Underwater;
                if (underwater && terrain.height >= terrain.waterline - 5)
                    || (!underwater && terrain.height <= terrain.waterline + 3)
                {
                    continue;
                }
                let footprint = candidate.size.radius().min(12);
                let mut relief = 0;
                let mut rejected = false;
                for (dx, dz) in [(footprint, 0), (-footprint, 0), (0, footprint), (0, -footprint)] {
                    let neighbor = self.generator.sample_column(x + dx, z + dz);
                    if !matches!(neighbor.biome, BiomeId::DeepOcean | BiomeId::LumenTrench)
                        && is_syrup_pond_column(self.generator, self.seed, x + dx, z + dz)
                    {
                        rejected = true;
                    }
                    relief = relief.max((neighbor.height - terrain.height).abs());
                }
                let limit = if underwater {
                    7
                } else if candidate.environment == Environment::Underground {
                    12
                } else {
                    5
                };
                if rejected || relief > limit {
                    continue;
                }
                candidate.x = x;
                candidate.z = z;
                candidate.floor_y = if underwater {
                    Some(terrain.height)
                } else if candidate.environment == Environment::Underground {
                    Some((terrain.height - 18).max(-54))
                } else {
                    None
                };
                let water_access = i32::from((terrain.height - terrain.waterline).abs() <= 8);
                let culture = match candidate.faction {
                    Faction::Dwarves | Faction::Sugarcourt | Faction::WoodElves => 9,
                    Faction::Goblins => 5,
                    Faction::Atlantians => 2,
                    Faction::Hobbits => 0,
                };
                let score_noise = if self.options.settlement_pattern == "legacy-scattered-v1" {
                    hash2(x, z, self.numeric_seed ^ 0x0051_0e5e)
                } else {
                    unit(self.seed, &format!("site-score|{x}|{z}"))
                };
                let score = f64::from(relief * 12 - water_access * 4 - culture) + score_noise * 3.0;
                if best.as_ref().is_none_or(|(_, current)| score < *current) {
                    best = Some((candidate, score));
                }
            }
            if let Some((candidate, _)) = best {
                if self.options.settlement_pattern == "legacy-scattered-v1" {
                    let chance = match candidate.faction {
                        Faction::Hobbits => 0.06,
                        Faction::Atlantians => 0.18,
                        Faction::Goblins => 0.58,
                        Faction::WoodElves => 0.82,
                        Faction::Sugarcourt | Faction::Dwarves => 0.9,
                    };
                    if hash2(region_x, region_z, self.numeric_seed ^ 0x2e1b_2138) > chance {
                        return None;
                    }
                }
                return Some(candidate);
            }
        }
        None
    }

    fn spacing(candidate: &Candidate, class: ProvinceClass) -> i32 {
        match (class, candidate.size) {
            (ProvinceClass::Wild, Size::Hamlet) => 384,
            (ProvinceClass::Wild, Size::Village) => 512,
            (ProvinceClass::Wild, Size::Town) => 672,
            (ProvinceClass::Frontier, Size::Hamlet) => 256,
            (ProvinceClass::Frontier, Size::Village) => 384,
            (ProvinceClass::Frontier, Size::Town) => 576,
            (_, Size::Hamlet) => 192,
            (_, Size::Village) => 288,
            (_, Size::Town) => 480,
        }
    }

    fn candidate(&mut self, region_x: i32, region_z: i32) -> Option<Candidate> {
        if let Some(value) = self.accepted.get(&(region_x, region_z)) {
            return value.clone();
        }
        let Some(planned) = self.raw_candidate(region_x, region_z) else {
            self.accepted.insert((region_x, region_z), None);
            return None;
        };
        let center = self.generator.sample_column(planned.x, planned.z);
        let nearby_valid = [(4, 0), (-4, 0), (0, 4), (0, -4)].into_iter().all(|(dx, dz)| {
            let sample = self.generator.sample_column(planned.x + dx, planned.z + dz);
            let forbidden = !matches!(sample.biome, BiomeId::DeepOcean | BiomeId::LumenTrench)
                && is_syrup_pond_column(self.generator, self.seed, planned.x + dx, planned.z + dz);
            !forbidden
                && (sample.height - center.height).abs()
                    <= if planned.environment == Environment::Underwater {
                        7
                    } else if planned.environment == Environment::Underground {
                        12
                    } else {
                        4
                    }
        });
        let terrain_valid = settlement_biome(center.biome) == Some(planned.biome)
            && !self.forbidden(planned.x, planned.z, planned.biome)
            && !if planned.environment == Environment::Underwater {
                center.height >= center.waterline - 5
            } else {
                center.height <= center.waterline + 3
            }
            && nearby_valid;
        if !terrain_valid {
            self.accepted.insert((region_x, region_z), None);
            return None;
        }
        let class = self.province(region_x.div_euclid(8), region_z.div_euclid(8)).class;
        let legacy = self.options.settlement_pattern == "legacy-scattered-v1";
        let rank_namespace = if legacy {
            "settlement-spacing"
        } else {
            "heartlands-spacing"
        };
        let rank = hash32(&format!("{}|{rank_namespace}|{}", self.seed, planned.id));
        let mut wins = true;
        for dx in -2..=2 {
            for dz in -2..=2 {
                if dx == 0 && dz == 0 {
                    continue;
                }
                let Some(other) = self.raw_candidate(region_x + dx, region_z + dz) else {
                    continue;
                };
                let other_class = self
                    .province((region_x + dx).div_euclid(8), (region_z + dz).div_euclid(8))
                    .class;
                let required = if legacy {
                    Self::spacing(&planned, ProvinceClass::Wild).max(Self::spacing(&other, ProvinceClass::Wild))
                } else {
                    Self::spacing(&planned, class).max(Self::spacing(&other, other_class))
                };
                if f64::from(planned.x - other.x).hypot(f64::from(planned.z - other.z)) >= f64::from(required) {
                    continue;
                }
                let other_rank = hash32(&format!("{}|{rank_namespace}|{}", self.seed, other.id));
                if other_rank < rank || (other_rank == rank && other.id < planned.id) {
                    wins = false;
                }
            }
        }
        let accepted = wins.then_some(planned);
        self.accepted.insert((region_x, region_z), accepted.clone());
        accepted
    }
}

#[derive(Clone, Debug)]
pub(crate) struct LocatedCandidate {
    pub(crate) candidate: Candidate,
    pub(crate) distance_squared: u64,
    pub(crate) guild_hall: Option<GuildHall>,
}

pub(crate) struct NearestCandidateQuery<'a> {
    pub(crate) origin_x_millis: i64,
    pub(crate) origin_z_millis: i64,
    pub(crate) factions: Option<&'a BTreeSet<Faction>>,
    pub(crate) sizes: Option<&'a BTreeSet<Size>>,
    pub(crate) environments: Option<&'a BTreeSet<Environment>>,
    pub(crate) excluded_ids: &'a BTreeSet<String>,
    pub(crate) maximum_region_radius: u16,
    pub(crate) limit: u8,
}

/// Independently selects the bounded nearest accepted settlements with the
/// same Chebyshev shells, filters, exclusion set, distance/id ordering, and
/// conservative early-exit proof as the browser compatibility index.
pub(crate) fn query_nearest_candidates(
    seed: &str,
    generator: &TerrainGeneratorV18,
    query: NearestCandidateQuery<'_>,
    mut materializable: impl FnMut(&Candidate, Option<&GuildHall>) -> bool,
) -> Vec<LocatedCandidate> {
    let mut planner = Planner::new(seed, generator);
    let origin_region_x = i32::try_from(query.origin_x_millis.div_euclid(i64::from(REGION_BLOCKS) * 1_000))
        .expect("bounded settlement origin region");
    let origin_region_z = i32::try_from(query.origin_z_millis.div_euclid(i64::from(REGION_BLOCKS) * 1_000))
        .expect("bounded settlement origin region");
    let maximum_region_radius = i32::from(query.maximum_region_radius.min(96));
    let limit = usize::from(query.limit.clamp(1, 32));
    let mut results = Vec::<LocatedCandidate>::new();
    for radius in 0..=maximum_region_radius {
        for dx in -radius..=radius {
            for dz in -radius..=radius {
                if dx.abs().max(dz.abs()) != radius {
                    continue;
                }
                let Some(candidate) = planner.candidate(origin_region_x + dx, origin_region_z + dz) else {
                    continue;
                };
                if query.excluded_ids.contains(&candidate.id)
                    || query
                        .factions
                        .is_some_and(|values| !values.contains(&candidate.faction))
                    || query.sizes.is_some_and(|values| !values.contains(&candidate.size))
                    || query
                        .environments
                        .is_some_and(|values| !values.contains(&candidate.environment))
                {
                    continue;
                }
                let guild_hall = hall_for_candidate(&mut planner, &candidate);
                if !materializable(&candidate, guild_hall.as_ref()) {
                    continue;
                }
                let delta_x = i64::from(candidate.x) * 1_000 - query.origin_x_millis;
                let delta_z = i64::from(candidate.z) * 1_000 - query.origin_z_millis;
                let distance_squared = u64::try_from(
                    delta_x
                        .checked_mul(delta_x)
                        .and_then(|x| delta_z.checked_mul(delta_z).and_then(|z| x.checked_add(z)))
                        .expect("bounded settlement query distance arithmetic"),
                )
                .expect("bounded settlement query distance");
                results.push(LocatedCandidate {
                    candidate,
                    distance_squared,
                    guild_hall,
                });
            }
        }
        results.sort_by(|left, right| {
            left.distance_squared
                .cmp(&right.distance_squared)
                .then_with(|| left.candidate.id.cmp(&right.candidate.id))
        });
        if results.len() >= limit {
            // ceil(512_000 * sqrt(2)); hard-coded and shared with the browser
            // oracle so early exit is integer-exact even beyond f64 precision.
            const REGION_DIAGONAL_MILLIS_CEIL: i128 = 724_078;
            let future_minimum =
                i128::from(radius) * i128::from(REGION_BLOCKS) * 1_000 - REGION_DIAGONAL_MILLIS_CEIL * 2;
            if future_minimum > 0
                && u64::try_from(future_minimum * future_minimum).expect("bounded settlement shell")
                    > results[limit - 1].distance_squared
            {
                results.truncate(limit);
                return results;
            }
        }
    }
    results.truncate(limit);
    results
}

fn size_radius(size: Size) -> i32 {
    match size {
        Size::Hamlet => 14,
        Size::Village => 22,
        Size::Town => 31,
    }
}

fn settlements_in_province(planner: &mut Planner<'_>, province_x: i32, province_z: i32) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    for dx in 0..PROVINCE_REGIONS {
        for dz in 0..PROVINCE_REGIONS {
            if let Some(candidate) =
                planner.candidate(province_x * PROVINCE_REGIONS + dx, province_z * PROVINCE_REGIONS + dz)
            {
                candidates.push(candidate);
            }
        }
    }
    candidates.sort_by(|left, right| left.id.cmp(&right.id));
    candidates
}

fn road_participation(options: &GenerationOptions, candidate: &Candidate) -> f64 {
    if options.road_coverage == "dense" {
        1.0
    } else if options.road_coverage == "local" {
        match candidate.size {
            Size::Town => 0.7,
            Size::Village => 0.45,
            Size::Hamlet => 0.2,
        }
    } else {
        match candidate.size {
            Size::Town => 1.0,
            Size::Village => 0.82,
            Size::Hamlet => 0.58,
        }
    }
}

fn principal(candidates: &[Candidate]) -> Option<Candidate> {
    candidates
        .iter()
        .find(|candidate| candidate.size == Size::Town)
        .or_else(|| candidates.iter().find(|candidate| candidate.size == Size::Village))
        .cloned()
}

fn road_connections_for_province(planner: &mut Planner<'_>, province_x: i32, province_z: i32) -> Vec<SettlementRoad> {
    if planner.options.road_coverage == "none" {
        return Vec::new();
    }
    let owner = format!("province:{province_x},{province_z}");
    let local_candidates = settlements_in_province(planner, province_x, province_z)
        .into_iter()
        .filter(|candidate| candidate.environment == Environment::Surface)
        .collect::<Vec<_>>();
    let selected = local_candidates
        .iter()
        .filter(|candidate| {
            unit(planner.seed, &format!("road-participation|{}", candidate.id))
                < road_participation(planner.options, candidate)
        })
        .cloned()
        .collect::<Vec<_>>();
    let nodes = selected
        .iter()
        .map(|candidate| RoadNode {
            id: candidate.id.clone(),
            x: candidate.x,
            z: candidate.z,
            payload: candidate.clone(),
            degree_limit: if candidate.size == Size::Town { 3 } else { 2 },
        })
        .collect::<Vec<_>>();
    let mut roads = roads::regional_graph(&nodes)
        .into_iter()
        .map(|edge| {
            let tier = if edge.from.payload.size == Size::Town || edge.to.payload.size == Size::Town {
                RoadTier::Regional
            } else {
                RoadTier::Local
            };
            SettlementRoad {
                id: edge.id,
                from: edge.from.payload,
                to: edge.to.payload,
                length: edge.length,
                looped: edge.looped,
                tier,
            }
        })
        .collect::<Vec<_>>();
    if planner.options.road_coverage == "local" {
        return roads;
    }
    let Some(source) = principal(&local_candidates) else {
        return roads;
    };
    for (offset_x, offset_z) in [(1, 0), (0, 1), (-1, 0), (0, -1)] {
        let neighbor_x = province_x + offset_x;
        let neighbor_z = province_z + offset_z;
        let neighbor_owner = format!("province:{neighbor_x},{neighbor_z}");
        if owner > neighbor_owner {
            continue;
        }
        let neighbors = settlements_in_province(planner, neighbor_x, neighbor_z)
            .into_iter()
            .filter(|candidate| candidate.environment == Environment::Surface)
            .collect::<Vec<_>>();
        let Some(target) = principal(&neighbors) else {
            continue;
        };
        let id = if source.id <= target.id {
            format!("{}<->{}", source.id, target.id)
        } else {
            format!("{}<->{}", target.id, source.id)
        };
        roads.push(SettlementRoad {
            id,
            length: f64::from(source.x - target.x).hypot(f64::from(source.z - target.z)),
            from: source.clone(),
            to: target,
            looped: false,
            tier: RoadTier::Trunk,
        });
    }
    roads.sort_by(|left, right| left.id.cmp(&right.id));
    roads
}

fn road_landmark(key: String, position: (i32, i32, i32), tag: String) -> MarkerRow {
    MarkerRow {
        key: key.clone(),
        canonical_json: format!(
            "[\"{key}\",{{\"id\":\"{key}\",\"position\":{{\"x\":{},\"y\":{},\"z\":{}}},\"tag\":\"{tag}\",\"type\":\"landmark\"}}]",
            position.0, position.1, position.2
        ),
    }
}

fn heartland_roads_for_chunk(planner: &mut Planner<'_>, cx: i32, cz: i32) -> SettlementPlan {
    let min_x = cx * CHUNK_SIZE as i32;
    let min_z = cz * CHUNK_SIZE as i32;
    let max_x = min_x + CHUNK_SIZE as i32 - 1;
    let max_z = min_z + CHUNK_SIZE as i32 - 1;
    let province_blocks = PROVINCE_REGIONS * REGION_BLOCKS;
    let province_x = min_x.div_euclid(province_blocks);
    let province_z = min_z.div_euclid(province_blocks);
    let inside = |x: i32, z: i32| x >= min_x && x <= max_x && z >= min_z && z <= max_z;
    let mut connections = BTreeMap::<String, SettlementRoad>::new();
    for dx in -1..=1 {
        for dz in -1..=1 {
            for edge in road_connections_for_province(planner, province_x + dx, province_z + dz) {
                connections.insert(edge.id.clone(), edge);
            }
        }
    }
    let mut placements = Vec::new();
    let mut only_air_placements = Vec::new();
    let mut markers = Vec::new();
    for edge in connections.into_values() {
        debug_assert!(edge.tier != RoadTier::Trunk || !edge.looped);
        let route_padding = if edge.tier == RoadTier::Trunk { 196 } else { 144 };
        if max_x < edge.from.x.min(edge.to.x) - route_padding
            || min_x > edge.from.x.max(edge.to.x) + route_padding
            || max_z < edge.from.z.min(edge.to.z) - route_padding
            || min_z > edge.from.z.max(edge.to.z) + route_padding
        {
            continue;
        }
        let length = edge.length.max(1.0);
        let ux = f64::from(edge.to.x - edge.from.x) / length;
        let uz = f64::from(edge.to.z - edge.from.z) / length;
        let from_inset = size_radius(edge.from.size) + 3;
        let to_inset = size_radius(edge.to.size) + 3;
        let from = (
            js_round(f64::from(edge.from.x) + ux * f64::from(from_inset)),
            js_round(f64::from(edge.from.z) + uz * f64::from(from_inset)),
        );
        let to = (
            js_round(f64::from(edge.to.x) - ux * f64::from(to_inset)),
            js_round(f64::from(edge.to.z) - uz * f64::from(to_inset)),
        );
        let road = roads::terrain_following(
            from,
            to,
            |x, z| {
                let column = planner.generator.sample_column(x, z);
                let slope_risk = [(4, 0), (-4, 0), (0, 4), (0, -4)]
                    .into_iter()
                    .map(|(offset_x, offset_z)| {
                        (planner.generator.sample_column(x + offset_x, z + offset_z).height - column.height).abs()
                    })
                    .max()
                    .unwrap_or(0);
                RoadSample {
                    height: column.height,
                    waterline: column.waterline,
                    water: column.height <= column.waterline,
                    forbidden: false,
                    slope_risk: f64::from(slope_risk),
                }
            },
            if edge.tier == RoadTier::Trunk { 6 } else { 4 },
        );
        let half_width = match edge.tier {
            RoadTier::Trunk => 2,
            RoadTier::Regional => 1,
            RoadTier::Local => 0,
        };
        for (point_index, point) in road.iter().enumerate() {
            if !inside(point.x, point.z) || point.kind == RoadPointKind::Ferry {
                continue;
            }
            let column = planner.generator.sample_column(point.x, point.z);
            let road_block = if matches!(point.kind, RoadPointKind::Bridge | RoadPointKind::Causeway) {
                Block::CAVE_BRIDGE
            } else if edge.from.faction == Faction::Sugarcourt {
                Block::BOILED_SUGARBRICK
            } else if edge.from.faction == Faction::WoodElves {
                Block::ROOTWEAVE_SOIL
            } else {
                Block::GRAVEL
            };
            let previous = road[point_index.saturating_sub(1)];
            let next = road[(point_index + 1).min(road.len() - 1)];
            let tangent_x = next.x - previous.x;
            let tangent_z = next.z - previous.z;
            let side_x = if tangent_z.abs() >= tangent_x.abs() {
                if tangent_z == 0 { 1 } else { tangent_z.signum() }
            } else {
                0
            };
            let side_z = if side_x == 0 {
                if tangent_x == 0 { 1 } else { tangent_x.signum() }
            } else {
                0
            };
            for width in -half_width..=half_width {
                let road_x = point.x + side_x * width;
                let road_z = point.z - side_z * width;
                if !inside(road_x, road_z) {
                    continue;
                }
                let road_column = planner.generator.sample_column(road_x, road_z);
                for y in (road_column.height + 1).max(point.y - 3)..point.y {
                    placements.push(SettlementPlacement {
                        x: road_x,
                        y,
                        z: road_z,
                        block: Block::COBBLESTONE,
                    });
                }
                placements.push(SettlementPlacement {
                    x: road_x,
                    y: point.y,
                    z: road_z,
                    block: road_block,
                });
                for y in point.y + 1..=(point.y + 3).min(road_column.height + 4) {
                    placements.push(SettlementPlacement {
                        x: road_x,
                        y,
                        z: road_z,
                        block: Block::AIR,
                    });
                }
            }
            let interval = match edge.tier {
                RoadTier::Trunk => 96,
                RoadTier::Regional => 128,
                RoadTier::Local => 192,
            };
            if point_index == 0 || point_index + 1 == road.len() || point_index % interval == 0 {
                let toward = if point_index < road.len() / 2 {
                    &edge.to
                } else {
                    &edge.from
                };
                let sign_x = point.x + side_x * (half_width + 1);
                let sign_z = point.z - side_z * (half_width + 1);
                if inside(sign_x, sign_z) && column.height > column.waterline {
                    only_air_placements.push(SettlementPlacement {
                        x: sign_x,
                        y: point.y + 1,
                        z: sign_z,
                        block: Block::CAVE_MARKER,
                    });
                }
                let id = format!("surface-road-sign:{}:{point_index}", edge.id);
                let distance = js_round(f64::from(toward.x - point.x).hypot(f64::from(toward.z - point.z)));
                let tag = format!(
                    "surface-road-sign:{}:{}:{}:{}:{}:{}:{distance}",
                    edge.tier.id(),
                    toward.id,
                    toward.faction.id(),
                    toward.size.id(),
                    toward.x,
                    toward.z,
                );
                markers.push((sign_x, sign_z, road_landmark(id, (sign_x, point.y + 1, sign_z), tag)));
            }
        }
    }
    SettlementPlan {
        placements,
        only_air_placements,
        markers,
        clear_bounds: None,
    }
}

fn compatible_with_guild(candidate: &Candidate, guild_id: &str) -> bool {
    match guild_id {
        "waykeeper" => {
            candidate.environment == Environment::Surface
                && matches!(candidate.faction, Faction::Hobbits | Faction::WoodElves)
        }
        "tideglass" => candidate.faction == Faction::Atlantians,
        "moonbough" => candidate.faction == Faction::WoodElves,
        "brassroot" => candidate.faction == Faction::Goblins,
        "deepgear" => candidate.faction == Faction::Dwarves,
        "hearthroad" => candidate.faction == Faction::Hobbits,
        "sugarcourt-makers" => candidate.faction == Faction::Sugarcourt,
        _ => false,
    }
}

fn hall_for_candidate(planner: &mut Planner<'_>, candidate: &Candidate) -> Option<GuildHall> {
    let macro_x = candidate.region_x.div_euclid(4) * 4;
    let macro_z = candidate.region_z.div_euclid(4) * 4;
    let region_id = format!(
        "settlement-cluster:{}:{}",
        candidate.region_x.div_euclid(4),
        candidate.region_z.div_euclid(4)
    );
    let mut candidates = Vec::new();
    for dx in 0..4 {
        for dz in 0..4 {
            if let Some(accepted) = planner.candidate(macro_x + dx, macro_z + dz) {
                candidates.push(accepted);
            }
        }
    }
    let mut occupied = BTreeSet::new();
    for guild_id in [
        "waykeeper",
        "tideglass",
        "moonbough",
        "brassroot",
        "deepgear",
        "hearthroad",
        "sugarcourt-makers",
        "cardwright",
        "waytable",
    ] {
        let mut pool = candidates
            .iter()
            .filter(|entry| compatible_with_guild(entry, guild_id) && !occupied.contains(&entry.id))
            .collect::<Vec<_>>();
        if pool.is_empty() {
            continue;
        }
        pool.sort_by(|left, right| {
            hash32(&format!("{}|{guild_id}|{}", planner.seed, left.id))
                .cmp(&hash32(&format!("{}|{guild_id}|{}", planner.seed, right.id)))
        });
        let selected = pool
            .iter()
            .copied()
            .find(|entry| {
                let chance = match entry.size {
                    Size::Hamlet => 0.08,
                    Size::Village => 0.3,
                    Size::Town => 0.6,
                };
                f64::from(hash32(&format!("{}|chance|{guild_id}|{}", planner.seed, entry.id))) / f64::from(u32::MAX)
                    < chance
            })
            .unwrap_or(pool[0]);
        occupied.insert(selected.id.clone());
        if selected.id == candidate.id {
            return Some(GuildHall {
                placement_id: format!("guild-hall:{region_id}:{guild_id}"),
                guild_id,
            });
        }
    }
    None
}

fn biome_name(biome: BiomeId) -> &'static str {
    match biome {
        BiomeId::DeepOcean => "Abyssal Ocean",
        BiomeId::Ocean => "Brightwater Ocean",
        BiomeId::Beach => "Sunwash Coast",
        BiomeId::Meadow => "Flower Meadow",
        BiomeId::Wildwood => "Wildwood Forest",
        BiomeId::Frostpine => "Frostpine Taiga",
        BiomeId::Desert => "Sunglass Desert",
        BiomeId::Savanna => "Sunstep Savanna",
        BiomeId::Siltfen => "Siltfen Swamp",
        BiomeId::Snowfield => "Whispering Snowfield",
        BiomeId::Badlands => "Painted Badlands",
        BiomeId::Birchlight => "Birchlight Grove",
        BiomeId::Bloomwood => "Bloomwood Vale",
        BiomeId::Highlands => "Cloudbreak Highlands",
        BiomeId::Volcanic => "Ember Wastes",
        BiomeId::MushroomFen => "Mooncap Fen",
        BiomeId::River => "Wandering River",
        BiomeId::CloudreedGlen => "Cloudreed Glen",
        BiomeId::RainveilJungle => "Rainveil Jungle",
        BiomeId::SakurabloomGrove => "Sakurabloom Grove",
        BiomeId::LumenTrench => "Lumen Trench",
        BiomeId::SugarplumVale => "Sugarplum Vale",
        BiomeId::Glimmerwood => "Glimmerwood",
        BiomeId::SnowcapRange => "Snowcap Range",
    }
}

fn lodge_guild(biome: BiomeId, region_x: i32, region_z: i32, seed: u32) -> Option<&'static str> {
    if hash2(region_x, region_z, seed ^ 0x6a09_e667) >= 0.1 {
        return None;
    }
    let guilds: [&str; 3] = if biome == BiomeId::SugarplumVale {
        ["sugarcourt-makers", "hearthroad", "waykeeper"]
    } else if matches!(biome, BiomeId::Beach | BiomeId::River) {
        ["tideglass", "hearthroad", "waykeeper"]
    } else if matches!(
        biome,
        BiomeId::Highlands | BiomeId::SnowcapRange | BiomeId::Badlands | BiomeId::Volcanic
    ) {
        ["deepgear", "hearthroad", "brassroot"]
    } else if matches!(
        biome,
        BiomeId::Wildwood
            | BiomeId::Birchlight
            | BiomeId::Bloomwood
            | BiomeId::Glimmerwood
            | BiomeId::RainveilJungle
            | BiomeId::SakurabloomGrove
            | BiomeId::MushroomFen
    ) {
        ["moonbough", "waykeeper", "hearthroad"]
    } else if matches!(biome, BiomeId::Desert | BiomeId::Savanna) {
        ["brassroot", "hearthroad", "waykeeper"]
    } else {
        ["waykeeper", "hearthroad", "brassroot"]
    };
    let index = ((hash2(region_x, region_z, seed ^ 0xbb67_ae85) * guilds.len() as f64).floor() as usize) % guilds.len();
    Some(guilds[index])
}

fn lodge_palette(guild: &str) -> (u16, u16, u16, u16, u16) {
    match guild {
        "tideglass" => (
            Block::MOON_SLATE,
            Block::GLASS,
            Block::MOON_SLATE,
            Block::STAR_CORAL,
            Block::STAR_CORAL,
        ),
        "moonbough" => (
            Block::MOONWELL,
            Block::MOONBOUGH_LOG,
            Block::LIVING_ROOT,
            Block::MOONBOUGH_LOG,
            Block::MOONBOUGH_LOG,
        ),
        "brassroot" => (
            Block::STONE_BRICK,
            Block::GOBLIN_BRASSWORK,
            Block::RIVETED_BRASS,
            Block::STONE_BRICK,
            Block::GRAVEL,
        ),
        "deepgear" => (
            Block::RIVETED_BRASS,
            Block::DEEPGEAR_BRICK,
            Block::RIVETED_BRASS,
            Block::DEEPGEAR_BRICK,
            Block::DEEPGEAR_BRICK,
        ),
        "sugarcourt-makers" => (
            Block::BOILED_SUGARBRICK,
            Block::BOILED_SUGARBRICK,
            Block::CANDYWOOD_LOG,
            Block::CANDYWOOD_LEAVES,
            Block::SUGAR_SOIL,
        ),
        "waykeeper" => (
            Block::MEADOW_GRASS,
            Block::PLANKS,
            Block::LIVING_ROOT,
            Block::HOBBIT_THATCH,
            Block::GRAVEL,
        ),
        _ => (
            Block::STONE_BRICK,
            Block::PLANKS,
            Block::WILDWOOD_LOG,
            Block::PLANKS,
            Block::GRAVEL,
        ),
    }
}

fn waypost_plan(
    planner: &Planner<'_>,
    region_x: i32,
    region_z: i32,
    chunk_x: i32,
    chunk_z: i32,
) -> Option<SettlementPlan> {
    if planner.options.profile == crate::contract::GenerationProfile::LegacyV14 {
        return None;
    }
    if planner.options.settlement_pattern == "heartlands-v2"
        && hash2(region_x, region_z, planner.numeric_seed ^ 0x7761_7970) > 0.012 * planner.options.settlement_density
    {
        return None;
    }
    let x = region_x * REGION_BLOCKS
        + 190
        + (hash2(region_x, region_z, planner.numeric_seed ^ 0x243f_6a88) * 132.0).floor() as i32;
    let z = region_z * REGION_BLOCKS
        + 190
        + (hash2(region_x, region_z, planner.numeric_seed ^ 0x85a3_08d3) * 132.0).floor() as i32;
    let column = planner.generator.sample_column(x, z);
    if column.height <= column.waterline + 3 {
        return None;
    }
    let y = column.height + 1;
    let mut placements = Vec::new();
    let mut markers = Vec::new();
    let min_x = chunk_x * CHUNK_SIZE as i32;
    let min_z = chunk_z * CHUNK_SIZE as i32;
    let inside = |px: i32, pz: i32| {
        px >= min_x && px < min_x + CHUNK_SIZE as i32 && pz >= min_z && pz < min_z + CHUNK_SIZE as i32
    };
    if let Some(guild) = lodge_guild(column.biome, region_x, region_z, planner.numeric_seed) {
        let (hall_floor, wall, corner, roof, _) = lodge_palette(guild);
        for dz in -3_i32..=3 {
            for dx in -3_i32..=3 {
                placements.push(SettlementPlacement {
                    x: x + dx,
                    y,
                    z: z + dz,
                    block: hall_floor,
                });
                if (dx.abs() == 3 || dz.abs() == 3) && !(dz == -3 && dx.abs() <= 1) {
                    for dy in 1..=3 {
                        placements.push(SettlementPlacement {
                            x: x + dx,
                            y: y + dy,
                            z: z + dz,
                            block: if dx.abs() == 3 && dz.abs() == 3 { corner } else { wall },
                        });
                    }
                }
                placements.push(SettlementPlacement {
                    x: x + dx,
                    y: y + 4,
                    z: z + dz,
                    block: roof,
                });
            }
        }
        for side in [-2, 2] {
            placements.push(SettlementPlacement {
                x: x + side,
                y: y + 1,
                z: z - 4,
                block: corner,
            });
            placements.push(SettlementPlacement {
                x: x + side,
                y: y + 2,
                z: z - 4,
                block: Block::TORCH,
            });
        }
        placements.push(SettlementPlacement {
            x: x + 2,
            y: y + 1,
            z: z + 1,
            block: Block::CHEST,
        });
        if inside(x, z) {
            let id = format!("guild-lodge:{guild}:{region_x}:{region_z}");
            markers.push((
                x,
                z,
                MarkerRow {
                    key: id.clone(),
                    canonical_json: format!("[\"{id}\",{{\"id\":\"{id}\",\"position\":{{\"x\":{x},\"y\":{},\"z\":{}}},\"tag\":\"guild-lodge:{guild}:{}\",\"type\":\"landmark\"}}]", y + 1, z - 4, biome_name(column.biome)),
                },
            ));
            let chest_key = format!("{id}:chest");
            markers.push((
                x,
                z,
                crate::adventure::rolled_chest_marker(
                    chest_key,
                    &format!("{id}:locker"),
                    (x + 2, y + 1, z + 1),
                    "adventure-cache",
                    &format!("{}:{id}", planner.seed),
                    3,
                ),
            ));
        }
        Some(SettlementPlan {
            placements,
            only_air_placements: Vec::new(),
            markers,
            clear_bounds: Some((x - 4, x + 4, z - 4, z + 4)),
        })
    } else {
        for (dx, dz) in [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)] {
            placements.push(SettlementPlacement {
                x: x + dx,
                y,
                z: z + dz,
                block: Block::CAVE_BRIDGE,
            });
        }
        placements.push(SettlementPlacement {
            x,
            y: y + 1,
            z,
            block: Block::CAVE_MARKER,
        });
        placements.push(SettlementPlacement {
            x: x + 1,
            y: y + 1,
            z: z + 1,
            block: Block::TORCH,
        });
        if inside(x, z) {
            let id = format!("inhabited-waypost:{region_x}:{region_z}");
            markers.push((
                x,
                z,
                MarkerRow {
                    key: id.clone(),
                    canonical_json: format!("[\"{id}\",{{\"id\":\"{id}\",\"position\":{{\"x\":{x},\"y\":{},\"z\":{z}}},\"tag\":\"inhabited-waypost:{}\",\"type\":\"landmark\"}}]", y + 1, biome_name(column.biome)),
                },
            ));
        }
        Some(SettlementPlan {
            placements,
            only_air_placements: Vec::new(),
            markers,
            clear_bounds: None,
        })
    }
}

pub(crate) fn plans_for_chunk(seed: &str, cx: i32, cz: i32, generator: &TerrainGeneratorV18) -> Vec<SettlementPlan> {
    let min_x = cx * CHUNK_SIZE as i32;
    let min_z = cz * CHUNK_SIZE as i32;
    let start_x = (min_x - REACH).div_euclid(REGION_BLOCKS);
    let end_x = (min_x + CHUNK_SIZE as i32 + REACH).div_euclid(REGION_BLOCKS);
    let start_z = (min_z - REACH).div_euclid(REGION_BLOCKS);
    let end_z = (min_z + CHUNK_SIZE as i32 + REACH).div_euclid(REGION_BLOCKS);
    let mut planner = Planner::new(seed, generator);
    let mut plans = Vec::new();
    if generator.profile() == crate::contract::GenerationProfile::WorldBelowV15
        && planner.options.road_coverage != "none"
        && planner.options.settlement_pattern == "heartlands-v2"
    {
        plans.push(heartland_roads_for_chunk(&mut planner, cx, cz));
    }
    for region_x in start_x..=end_x {
        for region_z in start_z..=end_z {
            let has_intent = planner.intent(region_x, region_z).is_some();
            let planned = has_intent.then(|| planner.raw_candidate(region_x, region_z)).flatten();
            if planned.is_none()
                && let Some(plan) = waypost_plan(&planner, region_x, region_z, cx, cz)
            {
                plans.push(plan);
            } else if let Some(candidate) = planner.candidate(region_x, region_z) {
                let hall = hall_for_candidate(&mut planner, &candidate);
                if let Some((placements, markers, radius)) =
                    settlement_layout::extract(&candidate, hall.as_ref(), seed, generator)
                {
                    plans.push(SettlementPlan {
                        placements,
                        only_air_placements: Vec::new(),
                        markers,
                        clear_bounds: Some((
                            candidate.x - radius - 2,
                            candidate.x + radius + 2,
                            candidate.z - radius - 2,
                            candidate.z + radius + 2,
                        )),
                    });
                }
            }
        }
    }
    plans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faction_order_and_ids_match_the_save_contract() {
        assert_eq!(
            Faction::ALL.map(Faction::id),
            [
                "hobbits",
                "goblins",
                "atlantians",
                "sugarcourt",
                "wood-elves",
                "dwarves"
            ]
        );
        assert_eq!(base36(-35), "-z");
        assert_eq!(base36(36), "10");
    }

    #[test]
    fn locator_materializes_the_same_atlantian_guild_hall_as_stamping() {
        let seed = "LOCATOR-ALL-FILTERS";
        let generator = TerrainGeneratorV18::new(seed, GenerationOptions::default());
        let factions = BTreeSet::from([Faction::Atlantians]);
        let environments = BTreeSet::from([Environment::Underwater]);
        let located = query_nearest_candidates(
            seed,
            &generator,
            NearestCandidateQuery {
                origin_x_millis: -2_484_000,
                origin_z_millis: -5_974_000,
                factions: Some(&factions),
                sizes: None,
                environments: Some(&environments),
                excluded_ids: &BTreeSet::new(),
                maximum_region_radius: 18,
                limit: 1,
            },
            |candidate, hall| {
                crate::settlement_layout::public_arrival(candidate, hall, seed, &generator, false).is_some()
            },
        );
        assert_eq!(located.len(), 1);
        assert_eq!(located[0].candidate.id, "tidehold--5--c-ubgd6u");
        let hall = located[0].guild_hall.as_ref().expect("locator carries resolved hall");
        assert_eq!(hall.placement_id, "guild-hall:settlement-cluster:-2:-3:tideglass");
        assert_eq!(hall.guild_id, "tideglass");
    }

    #[test]
    fn legacy_locator_candidate_matches_the_compatibility_index() {
        let seed = "LOCATOR-LEGACY";
        let options = GenerationOptions {
            profile: crate::contract::GenerationProfile::LegacyV14,
            settlement_pattern: "legacy-scattered-v1".into(),
            ..GenerationOptions::default()
        };
        let generator = TerrainGeneratorV18::new(seed, options);
        let mut planner = Planner::new(seed, &generator);
        let raw = planner
            .raw_candidate(-9, 8)
            .expect("legacy candidate survives site rarity");
        assert_eq!(
            (
                raw.id.as_str(),
                raw.x,
                raw.z,
                raw.faction,
                raw.size,
                raw.biome,
                raw.environment
            ),
            (
                "bonbon-borough--9-8-uwh7rk",
                -4_208,
                4_153,
                Faction::Sugarcourt,
                Size::Hamlet,
                SettlementBiome::SugarplumVale,
                Environment::Surface
            ),
        );
        let accepted = planner.candidate(-9, 8).expect("legacy candidate survives spacing");
        assert_eq!(accepted.id, raw.id);
    }

    #[test]
    #[ignore = "diagnostic only"]
    fn dump_reference_candidate() {
        let generator = TerrainGeneratorV18::new("r3-settlement-breadth-0", GenerationOptions::default());
        let mut planner = Planner::new("r3-settlement-breadth-0", &generator);
        println!("intent={}", planner.intent(-3, 1).is_some());
        println!("raw={:?}", planner.raw_candidate(-3, 1));
        println!("accepted={:?}", planner.candidate(-3, 1));
    }
}
