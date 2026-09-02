use crate::adventure;
use crate::contract::{BiomeId, Block, CHUNK_SIZE, GenerateChunkRequestV2, GenerationProfile, MarkerRow};
use crate::generator::TerrainGeneratorV18;
use crate::noise::value_noise_2;
use crate::underground::is_safe_cave_mouth;
use crate::{dragon, legendary, settlement};
use blockwild_types::{MIN_Y, WORLD_HEIGHT, fnv1a_utf16, hash2};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TreeForm {
    Rounded,
    Layered,
    Windswept,
    Ancient,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AquaticHabitat {
    River,
    Coast,
    Ocean,
    DeepOcean,
    LumenTrench,
}

impl AquaticHabitat {
    fn name(self) -> &'static str {
        match self {
            Self::River => "river",
            Self::Coast => "coast",
            Self::Ocean => "ocean",
            Self::DeepOcean => "deep-ocean",
            Self::LumenTrench => "lumen-trench",
        }
    }

    fn scale(self) -> f64 {
        match self {
            Self::River => 8.0,
            Self::Coast => 11.0,
            Self::Ocean => 14.0,
            Self::DeepOcean => 16.0,
            Self::LumenTrench => 13.0,
        }
    }

    fn base_spawn_chance(self) -> f64 {
        match self {
            Self::River | Self::Coast => 0.18,
            Self::Ocean => 0.24,
            Self::DeepOcean => 0.26,
            Self::LumenTrench => 0.33,
        }
    }

    fn weights(self) -> &'static [(u16, f64)] {
        match self {
            Self::River => &[(245, 0.58), (243, 0.42)],
            Self::Coast => &[
                (569, 0.58),
                (570, 0.24),
                (571, 0.08),
                (245, 0.04),
                (113, 0.025),
                (572, 0.025),
                (111, 0.01),
            ],
            Self::Ocean => &[
                (569, 0.54),
                (570, 0.40),
                (571, 0.025),
                (113, 0.015),
                (572, 0.01),
                (111, 0.007),
                (244, 0.003),
            ],
            Self::DeepOcean => &[
                (570, 0.55),
                (569, 0.34),
                (571, 0.05),
                (113, 0.03),
                (572, 0.025),
                (110, 0.003),
                (111, 0.0015),
                (112, 0.0005),
            ],
            Self::LumenTrench => &[
                (110, 0.38),
                (570, 0.22),
                (111, 0.16),
                (244, 0.10),
                (569, 0.06),
                (112, 0.05),
                (572, 0.03),
            ],
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Placement {
    x: i32,
    y: i32,
    z: i32,
    block: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ClearingBounds {
    min_x: i32,
    max_x: i32,
    min_z: i32,
    max_z: i32,
}

impl ClearingBounds {
    fn contains(self, x: i32, z: i32) -> bool {
        (self.min_x..=self.max_x).contains(&x) && (self.min_z..=self.max_z).contains(&z)
    }
}

#[derive(Clone, Copy, Debug)]
struct SyrupPondCandidate {
    cell_x: i32,
    cell_z: i32,
    x: i32,
    y: i32,
    z: i32,
    radius_x: i32,
    radius_z: i32,
}

#[derive(Clone, Copy, Debug)]
struct SyrupPondColumn {
    x: i32,
    z: i32,
    surface_y: i32,
    bed_y: i32,
    original_surface_y: i32,
}

#[inline]
fn index(lx: usize, y: i32, lz: usize) -> usize {
    lx + lz * CHUNK_SIZE + (y - MIN_Y) as usize * CHUNK_SIZE * CHUNK_SIZE
}

fn hash_unit(seed: &str, salt: &str) -> f64 {
    let text = format!("{seed}:{salt}");
    let mut hash = 2_166_136_261_u32;
    for unit in text.encode_utf16() {
        hash = (hash ^ u32::from(unit)).wrapping_mul(16_777_619);
    }
    hash ^= hash >> 16;
    f64::from(hash) / 4_294_967_296.0
}

fn structure_hash_unit(seed: &str, salt: &str) -> f64 {
    let text = format!("{seed}:{salt}");
    let mut hash = 2_166_136_261_u32;
    for unit in text.encode_utf16() {
        hash = (hash ^ u32::from(unit)).wrapping_mul(16_777_619);
    }
    hash ^= hash >> 16;
    hash = hash.wrapping_mul(0x85eb_ca6b);
    hash ^= hash >> 13;
    hash = hash.wrapping_mul(0xc2b2_ae35);
    hash ^= hash >> 16;
    f64::from(hash) / 4_294_967_296.0
}

fn adventure_hash_unit(seed: &str, salt: &str) -> f64 {
    let text = format!("{seed}:{salt}");
    let mut hash = 2_166_136_261_u32;
    for unit in text.encode_utf16() {
        hash = (hash ^ u32::from(unit)).wrapping_mul(16_777_619);
    }
    hash ^= hash >> 16;
    hash = hash.wrapping_mul(0x85eb_ca6b);
    hash ^= hash >> 13;
    f64::from(hash) / 4_294_967_296.0
}

fn aquatic_patch_hash(seed: &str, salt: &str) -> f64 {
    hash_unit(seed, salt)
}

fn aquatic_patch_spawn_chance(seed: &str, habitat: AquaticHabitat, x: i32, z: i32) -> f64 {
    let scale = habitat.scale();
    let cell_x = (f64::from(x) / scale).floor() as i32;
    let cell_z = (f64::from(z) / scale).floor() as i32;
    let mut inside_bed = false;
    'candidates: for offset_x in -1..=1 {
        for offset_z in -1..=1 {
            let candidate_x = cell_x + offset_x;
            let candidate_z = cell_z + offset_z;
            let key = format!("{}:{candidate_x},{candidate_z}", habitat.name());
            let center_x =
                (f64::from(candidate_x) + 0.14 + aquatic_patch_hash(seed, &format!("submerged-bed-x:{key}")) * 0.72)
                    * scale;
            let center_z =
                (f64::from(candidate_z) + 0.14 + aquatic_patch_hash(seed, &format!("submerged-bed-z:{key}")) * 0.72)
                    * scale;
            let dx = f64::from(x) - center_x;
            let dz = f64::from(z) - center_z;
            let maximum_radius = scale * 0.47;
            if dx * dx + dz * dz > maximum_radius * maximum_radius {
                continue;
            }
            let radius_x = scale * (0.30 + aquatic_patch_hash(seed, &format!("submerged-bed-radius-x:{key}")) * 0.12);
            let radius_z = scale * (0.30 + aquatic_patch_hash(seed, &format!("submerged-bed-radius-z:{key}")) * 0.12);
            let rotation = aquatic_patch_hash(seed, &format!("submerged-bed-rotation:{key}")) * std::f64::consts::TAU;
            let cosine = rotation.cos();
            let sine = rotation.sin();
            let normalized_x = (dx * cosine - dz * sine) / radius_x;
            let normalized_z = (dx * sine + dz * cosine) / radius_z;
            let radial_angle = normalized_z.atan2(normalized_x);
            let phase_a = aquatic_patch_hash(seed, &format!("submerged-bed-lobe-a:{key}")) * std::f64::consts::TAU;
            let phase_b = aquatic_patch_hash(seed, &format!("submerged-bed-lobe-b:{key}")) * std::f64::consts::TAU;
            let edge =
                0.93 + (radial_angle * 3.0 + phase_a).sin() * 0.10 + (radial_angle * 5.0 + phase_b).sin() * 0.055;
            if normalized_x * normalized_x + normalized_z * normalized_z <= edge * edge {
                inside_bed = true;
                break 'candidates;
            }
        }
    }
    habitat.base_spawn_chance() * if inside_bed { 2.7 } else { 0.05 }
}

fn aquatic_patch_species_roll(seed: &str, habitat: AquaticHabitat, x: i32, z: i32) -> f64 {
    let scale = (habitat.scale() * 0.42).max(4.5);
    let cell_x = (f64::from(x) / scale).floor() as i32;
    let cell_z = (f64::from(z) / scale).floor() as i32;
    let mut nearest_distance = f64::INFINITY;
    let mut nearest = (cell_x, cell_z);
    for offset_x in -1..=1 {
        for offset_z in -1..=1 {
            let candidate_x = cell_x + offset_x;
            let candidate_z = cell_z + offset_z;
            let center_x = (f64::from(candidate_x)
                + 0.15
                + aquatic_patch_hash(
                    seed,
                    &format!("submerged-center-x:{}:{candidate_x},{candidate_z}", habitat.name()),
                ) * 0.7)
                * scale;
            let center_z = (f64::from(candidate_z)
                + 0.15
                + aquatic_patch_hash(
                    seed,
                    &format!("submerged-center-z:{}:{candidate_x},{candidate_z}", habitat.name()),
                ) * 0.7)
                * scale;
            let dx = f64::from(x) - center_x;
            let dz = f64::from(z) - center_z;
            let distance = dx * dx + dz * dz;
            if distance < nearest_distance {
                nearest_distance = distance;
                nearest = (candidate_x, candidate_z);
            }
        }
    }
    aquatic_patch_hash(
        seed,
        &format!("submerged-species-bed:{}:{},{}", habitat.name(), nearest.0, nearest.1),
    )
}

fn pick_aquatic_flora(weights: &[(u16, f64)], roll: f64) -> u16 {
    let mut cursor = 0.0;
    for &(block, weight) in weights {
        cursor += weight;
        if roll < cursor {
            return block;
        }
    }
    weights.last().map_or(569, |entry| entry.0)
}

fn aquatic_flora_height(block: u16) -> i32 {
    match block {
        569 | 245 | 112 => 2,
        570 => 6,
        571 | 243 => 3,
        572 | 111 => 1,
        244 | 113 => 5,
        110 => 7,
        _ => 1,
    }
}

fn plan_submerged_flora(
    seed: &str,
    x: i32,
    bed_y: i32,
    z: i32,
    water_depth: i32,
    habitat: AquaticHabitat,
) -> Vec<Placement> {
    let depth = water_depth.max(0);
    if depth < 2
        || hash_unit(seed, &format!("submerged-scatter:{x},{z}")) >= aquatic_patch_spawn_chance(seed, habitat, x, z)
    {
        return Vec::new();
    }
    let patch_species = aquatic_patch_species_roll(seed, habitat, x, z);
    let local_species = hash_unit(seed, &format!("submerged-species-local:{}:{x},{z}", habitat.name()));
    let breaks_patch = hash_unit(seed, &format!("submerged-species-mix:{}:{x},{z}", habitat.name())) > 0.88;
    let block = pick_aquatic_flora(
        habitat.weights(),
        if breaks_patch { local_species } else { patch_species },
    );
    let natural_limit = aquatic_flora_height(block);
    let height_roll = 0.55 + hash_unit(seed, &format!("submerged-height:{x},{z}")) * 0.75;
    let height = ((f64::from(natural_limit) * height_roll).round() as i32).clamp(1, natural_limit.min(depth - 1));
    (0..height)
        .map(|dy| Placement {
            x,
            y: bed_y + 1 + dy,
            z,
            block,
        })
        .collect()
}

fn syrup_pond_candidate(
    generator: &TerrainGeneratorV18,
    seed: &str,
    cell_x: i32,
    cell_z: i32,
) -> Option<SyrupPondCandidate> {
    if hash_unit(seed, &format!("syrup-pond:{cell_x},{cell_z}:presence")) < 0.46 {
        return None;
    }
    let inset = 8;
    let span = 48 - inset * 2;
    let x = cell_x * 48
        + inset
        + (hash_unit(seed, &format!("syrup-pond:{cell_x},{cell_z}:x")) * f64::from(span)).floor() as i32;
    let z = cell_z * 48
        + inset
        + (hash_unit(seed, &format!("syrup-pond:{cell_x},{cell_z}:z")) * f64::from(span)).floor() as i32;
    let radius_x = 4 + (hash_unit(seed, &format!("syrup-pond:{cell_x},{cell_z}:rx")) * 4.0).floor() as i32;
    let radius_z = 3 + (hash_unit(seed, &format!("syrup-pond:{cell_x},{cell_z}:rz")) * 4.0).floor() as i32;
    let center = generator.sample_column(x, z);
    if center.biome != BiomeId::SugarplumVale || center.height <= center.waterline + 3 {
        return None;
    }
    for (dx, dz) in [(radius_x, 0), (-radius_x, 0), (0, radius_z), (0, -radius_z)] {
        let edge = generator.sample_column(x + dx, z + dz);
        if edge.biome != BiomeId::SugarplumVale
            || (edge.height - center.height).abs() > 2
            || edge.height <= edge.waterline + 2
        {
            return None;
        }
    }
    Some(SyrupPondCandidate {
        cell_x,
        cell_z,
        x,
        y: center.height - 1,
        z,
        radius_x,
        radius_z,
    })
}

fn syrup_pond_column(
    generator: &TerrainGeneratorV18,
    seed: &str,
    candidate: SyrupPondCandidate,
    x: i32,
    z: i32,
) -> Option<SyrupPondColumn> {
    let nx = f64::from(x - candidate.x) / f64::from(candidate.radius_x);
    let nz = f64::from(z - candidate.z) / f64::from(candidate.radius_z);
    let radial = nx * nx + nz * nz;
    let edge_wobble = (hash_unit(
        seed,
        &format!("syrup-pond:{}:{}:edge:{x},{z}", candidate.cell_x, candidate.cell_z),
    ) - 0.5)
        * 0.12;
    if radial > 1.0 + edge_wobble {
        return None;
    }
    let local = generator.sample_column(x, z);
    if local.biome != BiomeId::SugarplumVale || (local.height - candidate.y - 1).abs() > 2 {
        return None;
    }
    let depth = 1 + ((1.0 - radial).max(0.0) * 2.25).floor() as i32;
    Some(SyrupPondColumn {
        x,
        z,
        surface_y: candidate.y,
        bed_y: candidate.y - depth,
        original_surface_y: local.height,
    })
}

fn syrup_pond_columns_for_chunk(
    generator: &TerrainGeneratorV18,
    request: &GenerateChunkRequestV2,
) -> Vec<SyrupPondColumn> {
    let min_x = request.cx * CHUNK_SIZE as i32;
    let min_z = request.cz * CHUNK_SIZE as i32;
    let max_x = min_x + CHUNK_SIZE as i32 - 1;
    let max_z = min_z + CHUNK_SIZE as i32 - 1;
    let mut columns = Vec::new();
    for cell_x in (min_x - 7).div_euclid(48)..=(max_x + 7).div_euclid(48) {
        for cell_z in (min_z - 7).div_euclid(48)..=(max_z + 7).div_euclid(48) {
            let Some(candidate) = syrup_pond_candidate(generator, &request.seed_text, cell_x, cell_z) else {
                continue;
            };
            for x in min_x.max(candidate.x - candidate.radius_x)..=max_x.min(candidate.x + candidate.radius_x) {
                for z in min_z.max(candidate.z - candidate.radius_z)..=max_z.min(candidate.z + candidate.radius_z) {
                    if let Some(column) = syrup_pond_column(generator, &request.seed_text, candidate, x, z) {
                        columns.push(column);
                    }
                }
            }
        }
    }
    columns
}

pub(crate) fn is_syrup_pond_column(generator: &TerrainGeneratorV18, seed: &str, x: i32, z: i32) -> bool {
    let cell_x = x.div_euclid(48);
    let cell_z = z.div_euclid(48);
    for offset_x in -1..=1 {
        for offset_z in -1..=1 {
            if syrup_pond_candidate(generator, seed, cell_x + offset_x, cell_z + offset_z)
                .and_then(|candidate| syrup_pond_column(generator, seed, candidate, x, z))
                .is_some()
            {
                return true;
            }
        }
    }
    false
}

fn is_leaf(block: u16) -> bool {
    matches!(
        block,
        Block::WILDWOOD_LEAVES
            | Block::PINE_LEAVES
            | Block::BIRCH_LEAVES
            | Block::BLOOM_LEAVES
            | Block::JUNGLE_LEAVES
            | Block::SAKURA_LEAVES
            | Block::CANDYWOOD_LEAVES
            | Block::MOONBOUGH_LEAVES
            | Block::FROSTPEAR_LEAVES
    )
}

fn farm_hash_01(seed: &str, x: i32, y: i32, z: i32, cycle: i32) -> f64 {
    let mut state = fnv1a_utf16(seed);
    state ^= (x as u32).wrapping_mul(374_761_393)
        ^ (y as u32).wrapping_mul(668_265_263)
        ^ (z as u32).wrapping_mul(1_103_515_245)
        ^ (cycle as u32).wrapping_mul(2_246_822_519);
    state = (state ^ (state >> 13)).wrapping_mul(1_274_126_177);
    state ^= state >> 16;
    f64::from(state) / f64::from(u32::MAX)
}

fn plan_frostpear_tree(seed: &str, origin: (i32, i32, i32)) -> Vec<Placement> {
    let (origin_x, origin_y, origin_z) = origin;
    let height = 6 + (farm_hash_01(seed, origin_x, origin_y, origin_z, 0x6f3a) * 2.0).floor() as i32;
    let mut blocks = BTreeMap::<(i32, i32, i32), u16>::new();
    for dy in 0..height {
        blocks.insert((origin_x, origin_y + dy, origin_z), Block::PINE_LOG);
    }

    let canopy_y = origin_y + height - 1;
    for dy in -1_i32..=2 {
        let radius = if dy >= 2 { 1_i32 } else { 2_i32 };
        for dx in -radius..=radius {
            for dz in -radius..=radius {
                let edge = dx.abs() + dz.abs() + dy.max(0);
                if edge > 4 || (dx == 0 && dz == 0 && dy <= 0) {
                    continue;
                }
                if edge == 4 && farm_hash_01(seed, origin_x + dx, canopy_y + dy, origin_z + dz, 3) < 0.34 {
                    continue;
                }
                blocks.insert((origin_x + dx, canopy_y + dy, origin_z + dz), Block::FROSTPEAR_LEAVES);
            }
        }
    }

    let mut fruit_candidates = Vec::new();
    for dx in -2_i32..=2 {
        for dz in -2_i32..=2 {
            let distance = dx.abs() + dz.abs();
            if !(2..=3).contains(&distance) {
                continue;
            }
            let position = (origin_x + dx, canopy_y - 2, origin_z + dz);
            if blocks.get(&(position.0, position.1 + 1, position.2)).copied() == Some(Block::FROSTPEAR_LEAVES)
                && !blocks.contains_key(&position)
            {
                fruit_candidates.push(position);
            }
        }
    }
    fruit_candidates.sort_by(|left, right| {
        farm_hash_01(seed, left.0, left.1, left.2, 9).total_cmp(&farm_hash_01(seed, right.0, right.1, right.2, 9))
    });
    let fruit_count = 2 + (farm_hash_01(seed, origin_x, origin_y, origin_z, 10) * 3.0).floor() as usize;
    for position in fruit_candidates.into_iter().take(fruit_count) {
        blocks.insert(position, Block::FROSTPEAR_FRUIT);
    }
    blocks
        .into_iter()
        .map(|((x, y, z), block)| Placement { x, y, z, block })
        .collect()
}

fn is_replaceable(block: u16) -> bool {
    block == Block::AIR
        || is_leaf(block)
        || matches!(
            block,
            Block::TALL_GRASS
                | Block::RED_FLOWER
                | Block::BLUE_FLOWER
                | Block::SUNPETAL
                | Block::MOON_ORCHID
                | Block::DESERT_SHRUB
                | Block::SALTBRUSH
                | Block::COAST_ASTER
                | Block::MOONBERRY_BUSH_RIPE
                | Block::SUNBERRY_BUSH_RIPE
                | Block::SAKURA_BLOOM
                | Block::MOONPETAL
                | Block::STARFERN
                | Block::DREAMCAP
                | Block::CLOUDBELL
                | Block::WHEAT_CROP
                | Block::MOONRICE_CROP
                | Block::SUNROOT_CROP
                | Block::COTTON_CROP
                | Block::SUN_CARROT_CROP
                | Block::BLUEPOD_CROP
                | Block::DOUBLE_TALL_GRASS_LOWER
                | Block::DOUBLE_TALL_GRASS_UPPER
        )
}

fn is_generated_tree(block: u16) -> bool {
    is_leaf(block)
        || matches!(
            block,
            Block::WILDWOOD_LOG
                | Block::PINE_LOG
                | Block::BIRCH_LOG
                | Block::BLOOM_LOG
                | Block::JUNGLE_LOG
                | Block::SAKURA_LOG
                | Block::CANDYWOOD_LOG
                | Block::MOONBOUGH_LOG
                | Block::FROSTPEAR_LEAVES
        )
}

fn is_waterlogged_growth(block: u16) -> bool {
    matches!(block, 110..=113 | 243..=245 | 569..=572)
}

fn is_generated_growth(block: u16) -> bool {
    is_generated_tree(block)
        || matches!(
            block,
            Block::CACTUS
                | 38
                | Block::TALL_GRASS
                | Block::DOUBLE_TALL_GRASS_LOWER
                | Block::DOUBLE_TALL_GRASS_UPPER
                | Block::RED_FLOWER
                | Block::BLUE_FLOWER
                | Block::WHEAT_CROP
                | Block::SUNPETAL
                | Block::MOON_ORCHID
                | Block::CLOUDBELL
                | Block::DESERT_SHRUB
                | Block::SALTBRUSH
                | Block::COAST_ASTER
                | Block::SAKURA_BLOOM
                | Block::DREAMBLOSSOM
                | Block::RAINVEIL_FERN
                | Block::LANTERN_LOTUS
                | Block::MOONRICE_CROP
                | Block::SUNROOT_CROP
                | Block::LUMEN_KELP
                | Block::STAR_CORAL
                | Block::ABYSS_BLOOM
                | Block::TIDEVINE
                | Block::GUMDROP_BUSH
                | Block::PEPPERMINT_TUFT
                | Block::LOLLIPOP_ORCHID
                | Block::MARSHMALLOW_SHRUB
                | Block::MOONPETAL
                | Block::STARFERN
                | Block::DREAMCAP
                | Block::LUMENREED
                | Block::COTTON_CROP
                | Block::SUN_CARROT_CROP
                | Block::BLUEPOD_CROP
                | Block::FROSTPEAR_FRUIT
                | 243..=245
        )
}

fn is_rootable_tree_soil(block: u16) -> bool {
    matches!(
        block,
        Block::GRASS
            | Block::DIRT
            | Block::MEADOW_GRASS
            | Block::SNOWY_GRASS
            | Block::SAVANNA_GRASS
            | Block::SWAMP_GRASS
            | Block::JUNGLE_GRASS
            | Block::SAKURA_GRASS
            | Block::SUGARPLUM_GRASS
            | Block::SUGAR_SOIL
            | Block::GLIMMER_GRASS
            | Block::MUD
            | Block::MOSS
    )
}

const FACE_NEIGHBORS: [(i32, i32, i32); 6] = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)];

const AXIS_ORDERS: [[usize; 3]; 6] = [[1, 0, 2], [1, 2, 0], [0, 1, 2], [0, 2, 1], [2, 1, 0], [2, 0, 1]];

fn connected_tree_keys(
    blocks: &BTreeMap<(i32, i32, i32), Placement>,
    root: (i32, i32, i32),
    predicate: impl Fn(Placement) -> bool,
) -> BTreeSet<(i32, i32, i32)> {
    if !blocks.contains_key(&root) {
        return BTreeSet::new();
    }
    let mut visited = BTreeSet::from([root]);
    let mut queue = VecDeque::from([root]);
    while let Some((x, y, z)) = queue.pop_front() {
        for (dx, dy, dz) in FACE_NEIGHBORS {
            let key = (x + dx, y + dy, z + dz);
            let Some(&next) = blocks.get(&key) else {
                continue;
            };
            if visited.contains(&key) || !predicate(next) {
                continue;
            }
            visited.insert(key);
            queue.push_back(key);
        }
    }
    visited
}

fn manhattan(left: Placement, right: Placement) -> i32 {
    (left.x - right.x).abs() + (left.y - right.y).abs() + (left.z - right.z).abs()
}

fn bridge_tree_cells(
    anchor: Placement,
    target: Placement,
    block: u16,
    forbidden: &BTreeSet<(i32, i32)>,
    order: [usize; 3],
) -> Option<Vec<Placement>> {
    let mut cursor = [anchor.x, anchor.y, anchor.z];
    let destination = [target.x, target.y, target.z];
    let mut bridge = Vec::new();
    for axis in order {
        while cursor[axis] != destination[axis] {
            cursor[axis] += (destination[axis] - cursor[axis]).signum();
            if forbidden.contains(&(cursor[0], cursor[2])) {
                return None;
            }
            bridge.push(Placement {
                x: cursor[0],
                y: cursor[1],
                z: cursor[2],
                block,
            });
        }
    }
    Some(bridge)
}

/// Mirrors `repairGeneratedTreePlan`: authored branch islands are bridged,
/// while crown components clipped by liquid/POI columns are deterministically
/// connected or pruned. This is essential at chunk seams because a branch
/// rooted in a neighbor must yield the same slice regardless of generation
/// order.
fn repair_generated_tree_plan(
    plan: Vec<Placement>,
    root: (i32, i32, i32),
    log_block: u16,
    forbidden: &BTreeSet<(i32, i32)>,
) -> Vec<Placement> {
    if forbidden.contains(&(root.0, root.2)) {
        return Vec::new();
    }
    let mut blocks = BTreeMap::<(i32, i32, i32), Placement>::new();
    for placement in plan {
        if forbidden.contains(&(placement.x, placement.z)) {
            continue;
        }
        let key = (placement.x, placement.y, placement.z);
        if blocks.get(&key).is_some_and(|current| current.block == log_block) && placement.block != log_block {
            continue;
        }
        blocks.insert(key, placement);
    }
    blocks.insert(
        root,
        Placement {
            x: root.0,
            y: root.1,
            z: root.2,
            block: log_block,
        },
    );

    let mut log_connected = connected_tree_keys(&blocks, root, |placement| placement.block == log_block);
    loop {
        let target = blocks
            .values()
            .copied()
            .filter(|placement| {
                placement.block == log_block && !log_connected.contains(&(placement.x, placement.y, placement.z))
            })
            .min_by_key(|placement| (placement.y, placement.x, placement.z));
        let Some(target) = target else {
            break;
        };
        let mut anchors = log_connected
            .iter()
            .filter_map(|key| blocks.get(key).copied())
            .collect::<Vec<_>>();
        anchors.sort_by_key(|anchor| (manhattan(target, *anchor), anchor.y, anchor.x, anchor.z));
        let bridge = anchors.iter().take(16).find_map(|&anchor| {
            AXIS_ORDERS
                .iter()
                .find_map(|&order| bridge_tree_cells(anchor, target, log_block, forbidden, order))
        });
        if let Some(bridge) = bridge {
            for placement in bridge {
                blocks.insert((placement.x, placement.y, placement.z), placement);
            }
        } else {
            blocks.remove(&(target.x, target.y, target.z));
        }
        log_connected = connected_tree_keys(&blocks, root, |placement| placement.block == log_block);
    }

    let mut attached = connected_tree_keys(&blocks, root, |_| true);
    loop {
        let target = blocks
            .values()
            .copied()
            .filter(|placement| {
                placement.block != log_block && !attached.contains(&(placement.x, placement.y, placement.z))
            })
            .min_by_key(|placement| (placement.y, placement.x, placement.z));
        let Some(target) = target else {
            break;
        };
        let mut anchors = attached
            .iter()
            .filter_map(|key| blocks.get(key).copied())
            .collect::<Vec<_>>();
        anchors.sort_by_key(|anchor| (manhattan(target, *anchor), anchor.y, anchor.x, anchor.z));
        let bridge = anchors
            .iter()
            .take(24)
            .take_while(|anchor| manhattan(target, **anchor) <= 4)
            .find_map(|&anchor| {
                AXIS_ORDERS
                    .iter()
                    .find_map(|&order| bridge_tree_cells(anchor, target, target.block, forbidden, order))
            });
        if let Some(bridge) = bridge {
            for placement in bridge {
                let key = (placement.x, placement.y, placement.z);
                if blocks.get(&key).is_none_or(|current| current.block != log_block) {
                    blocks.insert(key, placement);
                }
            }
        } else {
            let start = (target.x, target.y, target.z);
            let mut component = BTreeSet::from([start]);
            let mut queue = VecDeque::from([start]);
            while let Some((x, y, z)) = queue.pop_front() {
                for (dx, dy, dz) in FACE_NEIGHBORS {
                    let key = (x + dx, y + dy, z + dz);
                    let Some(next) = blocks.get(&key) else {
                        continue;
                    };
                    if next.block == log_block || attached.contains(&key) || component.contains(&key) {
                        continue;
                    }
                    component.insert(key);
                    queue.push_back(key);
                }
            }
            for key in component {
                blocks.remove(&key);
            }
        }
        attached = connected_tree_keys(&blocks, root, |_| true);
    }

    let mut result = blocks.into_values().collect::<Vec<_>>();
    result.sort_by_key(|placement| (placement.y, placement.z, placement.x));
    result
}

fn plan_full_tree(
    seed: &str,
    origin: (i32, i32, i32),
    form: TreeForm,
    log: u16,
    leaves: u16,
    generator: &TerrainGeneratorV18,
) -> Vec<Placement> {
    let mut blocks = BTreeMap::<(i32, i32, i32), u16>::new();
    let set = |map: &mut BTreeMap<_, _>, x, y, z, block| {
        map.insert((x, y, z), block);
    };
    let set_leaf = |map: &mut BTreeMap<_, _>, x, y, z| {
        if map.get(&(x, y, z)).copied() != Some(log) {
            map.insert((x, y, z), leaves);
        }
    };
    let fullness = (0.78 + hash_unit(seed, "tree-fullness") * 0.22).clamp(0.0, 1.0);
    let trunk_height = match form {
        TreeForm::Ancient => 9 + (hash_unit(seed, "tree-height") * 3.0).floor() as i32,
        TreeForm::Layered => 7 + (hash_unit(seed, "tree-height") * 2.0).floor() as i32,
        TreeForm::Windswept => 6 + (hash_unit(seed, "tree-height") * 2.0).floor() as i32,
        TreeForm::Rounded => 5 + (hash_unit(seed, "tree-height") * 3.0).floor() as i32,
    };
    let trunk_top = origin.1 + trunk_height - 1;
    let cardinals = [(1, 0), (-1, 0), (0, 1), (0, -1)];
    for y in origin.1..=trunk_top {
        set(&mut blocks, origin.0, y, origin.2, log);
    }
    let mut crown_x = origin.0;
    let mut crown_z = origin.2;
    let branch = |map: &mut BTreeMap<(i32, i32, i32), u16>,
                  start: (i32, i32, i32),
                  dx: i32,
                  dz: i32,
                  length: i32,
                  rise_every: i32| {
        let mut cursor = start;
        map.insert(cursor, log);
        for step in 1..=length {
            cursor.0 += dx;
            cursor.2 += dz;
            map.insert(cursor, log);
            if rise_every > 0 && step % rise_every == 0 {
                cursor.1 += 1;
                map.insert(cursor, log);
            }
        }
        cursor
    };
    match form {
        TreeForm::Rounded => {
            let long = (hash_unit(seed, "rounded-long-branch") * 4.0).floor() as usize;
            for (i, &(dx, dz)) in cardinals.iter().enumerate() {
                branch(
                    &mut blocks,
                    (origin.0, trunk_top - 2 + (i % 2) as i32, origin.2),
                    dx,
                    dz,
                    if i == long { 2 } else { 1 },
                    0,
                );
            }
        }
        TreeForm::Layered => {
            for (dx, dz) in cardinals {
                branch(&mut blocks, (origin.0, trunk_top - 4, origin.2), dx, dz, 2, 0);
                branch(&mut blocks, (origin.0, trunk_top - 1, origin.2), dx, dz, 1, 0);
            }
            set(&mut blocks, origin.0, trunk_top + 1, origin.2, log);
        }
        TreeForm::Windswept => {
            let (wx, wz) = cardinals[(hash_unit(seed, "windswept-direction") * 4.0).floor() as usize];
            let tip = branch(&mut blocks, (origin.0, trunk_top - 3, origin.2), wx, wz, 3, 2);
            crown_x = tip.0 - wx;
            crown_z = tip.2 - wz;
            branch(&mut blocks, (origin.0, trunk_top - 2, origin.2), -wx, -wz, 1, 0);
        }
        TreeForm::Ancient => {
            for (dx, dz) in cardinals {
                let column = generator.sample_column(origin.0 + dx, origin.2 + dz);
                if !is_rootable_tree_soil(generator.surface_blocks(column).0) {
                    continue;
                }
                let base = column.height + 1;
                if (base - origin.1).abs() <= 2 {
                    for y in base.min(origin.1 + 2)..=base.max(origin.1 + 2) {
                        set(&mut blocks, origin.0 + dx, y, origin.2 + dz, log);
                    }
                }
            }
            if fullness > 0.9 {
                for (dx, dz) in [(1, 1), (-1, 1), (1, -1), (-1, -1)] {
                    let column = generator.sample_column(origin.0 + dx, origin.2 + dz);
                    if !is_rootable_tree_soil(generator.surface_blocks(column).0) {
                        continue;
                    }
                    let base = column.height + 1;
                    if (base - origin.1).abs() <= 1 {
                        for y in base.min(origin.1 + 1)..=base.max(origin.1 + 1) {
                            set(&mut blocks, origin.0 + dx, y, origin.2 + dz, log);
                        }
                    }
                }
            }
            for (i, &(dx, dz)) in cardinals.iter().enumerate() {
                let length = 2 + if hash_unit(seed, &format!("ancient-branch:{i}")) > 0.55 {
                    1
                } else {
                    0
                };
                branch(
                    &mut blocks,
                    (origin.0, trunk_top - 3 + (i % 2) as i32, origin.2),
                    dx,
                    dz,
                    length,
                    2,
                );
            }
        }
    }
    let mut crown = |y: i32, rx: f64, rz: f64, salt: &str, trim: f64| {
        for dz in -(rz.ceil() as i32)..=rz.ceil() as i32 {
            for dx in -(rx.ceil() as i32)..=rx.ceil() as i32 {
                let normalized = f64::from(dx * dx) / (rx * rx).max(0.25) + f64::from(dz * dz) / (rz * rz).max(0.25);
                if normalized > 1.04 {
                    continue;
                }
                let edge = normalized > 0.7;
                let edge_trim = trim + (1.0 - fullness) * 0.5;
                if edge && hash_unit(seed, &format!("{salt}:{dx},{dz}")) < edge_trim {
                    continue;
                }
                set_leaf(&mut blocks, crown_x + dx, y, crown_z + dz);
            }
        }
    };
    match form {
        TreeForm::Rounded => {
            for (dy, rx, trim) in [
                (-2, 2.8, 0.04),
                (-1, 3.2, 0.03),
                (0, 3.15, 0.02),
                (1, 2.45, 0.03),
                (2, 1.35, 0.02),
            ] {
                crown(trunk_top + dy, rx, rx, &format!("rounded:{dy}"), trim);
            }
        }
        TreeForm::Layered => {
            for (dy, rx, trim) in [
                (-4, 3.7, 0.06),
                (-3, 2.9, 0.05),
                (-2, 1.9, 0.03),
                (-1, 3.05, 0.06),
                (0, 2.25, 0.04),
                (1, 1.45, 0.02),
                (2, 0.8, 0.),
            ] {
                crown(trunk_top + dy, rx, rx, &format!("layered:{dy}"), trim);
            }
        }
        TreeForm::Windswept => {
            let x_stretched = crown_x != origin.0;
            let rx: f64 = if x_stretched { 3.8 } else { 2.5 };
            let rz: f64 = if x_stretched { 2.5 } else { 3.8 };
            for (dy, sub, trim) in [(-2, 0., 0.08), (-1, 0., 0.06), (0, 0.45, 0.04), (1, 1.35, 0.03)] {
                crown(
                    trunk_top + dy,
                    (rx - sub).max(1.6),
                    (rz - sub).max(1.6),
                    &format!("windswept:{dy}"),
                    trim,
                );
            }
        }
        TreeForm::Ancient => {
            for (dy, rx, trim) in [
                (-3, 4.45, 0.05),
                (-2, 4.65, 0.04),
                (-1, 4.4, 0.03),
                (0, 4., 0.03),
                (1, 3.55, 0.03),
                (2, 2.75, 0.02),
                (3, 1.55, 0.01),
            ] {
                crown(trunk_top + dy, rx, rx, &format!("ancient:{dy}"), trim);
            }
        }
    }
    blocks
        .into_iter()
        .map(|((x, y, z), block)| Placement { x, y, z, block })
        .collect()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NamedStructureKind {
    DesertTemple,
    ForestTemple,
    SunbunGrove,
    ButterflySanctuary,
    AbandonedApiary,
    WaykeeperGrotto,
}

#[derive(Clone, Debug)]
struct NamedStructurePlan {
    origin: (i32, i32, i32),
    radius_x: i32,
    radius_z: i32,
    placements: Vec<Placement>,
}

struct StructurePlanBuilder {
    origin: (i32, i32, i32),
    blocks: BTreeMap<(i32, i32, i32), u16>,
}

impl StructurePlanBuilder {
    fn new(origin: (i32, i32, i32)) -> Self {
        Self {
            origin,
            blocks: BTreeMap::new(),
        }
    }

    fn set(&mut self, dx: i32, dy: i32, dz: i32, block: u16) {
        self.blocks
            .insert((self.origin.0 + dx, self.origin.1 + dy, self.origin.2 + dz), block);
    }

    #[allow(clippy::too_many_arguments)]
    fn fill(&mut self, min_x: i32, min_y: i32, min_z: i32, max_x: i32, max_y: i32, max_z: i32, block: u16) {
        for y in min_y..=max_y {
            for z in min_z..=max_z {
                for x in min_x..=max_x {
                    self.set(x, y, z, block);
                }
            }
        }
    }

    fn finish(self) -> Vec<Placement> {
        self.blocks
            .into_iter()
            .map(|((x, y, z), block)| Placement { x, y, z, block })
            .collect()
    }
}

fn structure_kind_for_chunk(
    generator: &TerrainGeneratorV18,
    seed_text: &str,
    chunk_x: i32,
    chunk_z: i32,
) -> Option<NamedStructureKind> {
    let x = chunk_x * CHUNK_SIZE as i32 + CHUNK_SIZE as i32 / 2;
    let z = chunk_z * CHUNK_SIZE as i32 + CHUNK_SIZE as i32 / 2;
    let biome = generator.sample_column(x, z).biome;
    let biome_name = if matches!(biome, BiomeId::Desert | BiomeId::Badlands) {
        "desert"
    } else if matches!(
        biome,
        BiomeId::Wildwood | BiomeId::Frostpine | BiomeId::Birchlight | BiomeId::Bloomwood
    ) {
        "forest"
    } else if matches!(biome, BiomeId::Meadow | BiomeId::CloudreedGlen) {
        "meadow"
    } else {
        return None;
    };
    let region_x = chunk_x.div_euclid(16);
    let region_z = chunk_z.div_euclid(16);
    let local_x =
        (structure_hash_unit(seed_text, &format!("structure-region:{region_x},{region_z}:x")) * 16.0).floor() as i32;
    let local_z =
        (structure_hash_unit(seed_text, &format!("structure-region:{region_x},{region_z}:z")) * 16.0).floor() as i32;
    if region_x * 16 + local_x != chunk_x || region_z * 16 + local_z != chunk_z {
        return None;
    }
    if biome_name == "desert" {
        return Some(NamedStructureKind::DesertTemple);
    }
    let roll = structure_hash_unit(seed_text, &format!("poi:{biome_name}:{region_x},{region_z}"));
    if biome_name == "forest" {
        return Some(if roll < 0.22 {
            NamedStructureKind::AbandonedApiary
        } else {
            NamedStructureKind::ForestTemple
        });
    }
    Some(if roll < 0.24 {
        NamedStructureKind::SunbunGrove
    } else if roll < 0.52 {
        NamedStructureKind::AbandonedApiary
    } else if roll < 0.68 {
        NamedStructureKind::WaykeeperGrotto
    } else {
        NamedStructureKind::ButterflySanctuary
    })
}

#[allow(clippy::too_many_lines)]
fn plan_named_structure(kind: NamedStructureKind, origin: (i32, i32, i32), seed: &str) -> NamedStructurePlan {
    let mut builder = StructurePlanBuilder::new(origin);
    let (radius_x, radius_z) = match kind {
        NamedStructureKind::DesertTemple => {
            builder.fill(-7, 0, -7, 7, 0, 7, Block::TEMPLE_SANDSTONE);
            for layer in 0..6_i32 {
                let extent = 6 - layer;
                builder.fill(
                    -extent,
                    layer + 1,
                    -extent,
                    extent,
                    layer + 1,
                    extent,
                    Block::TEMPLE_SANDSTONE,
                );
            }
            builder.fill(-3, 1, -3, 3, 4, 3, Block::AIR);
            builder.fill(-1, 1, 3, 1, 3, 7, Block::AIR);
            for (x, z) in [(-3, -3), (3, -3), (-3, 3), (3, 3)] {
                builder.fill(x, 1, z, x, 4, z, Block::TEMPLE_SANDSTONE);
            }
            builder.set(0, 1, -3, Block::GLOWSTONE);
            builder.set(0, 1, -1, Block::CHEST);
            for (dx, dy, dz, block) in [
                (0, 1, 6, Block::DOOR_CLOSED_LOWER),
                (0, 2, 6, Block::DOOR_CLOSED_UPPER),
                (-2, 2, -2, Block::TORCH_WALL_SOUTH),
                (2, 2, -2, Block::TORCH_WALL_SOUTH),
                (-2, 1, 1, Block::WILDWOOD_TABLE),
                (-3, 1, 1, Block::WILDWOOD_STOOL),
                (3, 1, -1, Block::SEALED_BARREL),
            ] {
                builder.set(dx, dy, dz, block);
            }
            (7, 7)
        }
        NamedStructureKind::ForestTemple => {
            builder.fill(-6, 0, -6, 6, 0, 6, Block::COBBLESTONE);
            for z in 5..=8 {
                builder.fill(
                    -1,
                    0,
                    z,
                    1,
                    0,
                    z,
                    if z % 2 != 0 {
                        Block::STONE_BRICK
                    } else {
                        Block::COBBLESTONE
                    },
                );
            }
            builder.fill(-4, 1, -4, 4, 1, 4, Block::AIR);
            for edge in -4..=4 {
                for y in 1..=4 {
                    let wall = if y == 1 { Block::COBBLESTONE } else { Block::PLANKS };
                    builder.set(-5, y, edge, wall);
                    builder.set(5, y, edge, wall);
                    builder.set(edge, y, -5, wall);
                    builder.set(edge, y, 5, wall);
                }
            }
            for (x, z) in [(-5, -2), (-5, 2), (5, -2), (5, 2), (-2, -5), (2, -5)] {
                builder.set(x, 2, z, Block::GLASS);
                builder.set(x, 3, z, Block::GLASS);
            }
            builder.set(0, 1, 5, Block::AIR);
            builder.set(0, 2, 5, Block::AIR);
            for (x, z) in [(-5, -5), (5, -5), (-5, 5), (5, 5)] {
                builder.fill(x, 1, z, x, 6, z, Block::WILDWOOD_LOG);
                builder.fill(x - 1, 6, z - 1, x + 1, 7, z + 1, Block::WILDWOOD_LEAVES);
            }
            builder.fill(-5, 6, -5, 5, 6, 5, Block::PLANKS);
            builder.fill(-4, 6, -4, 4, 6, 4, Block::AIR);
            for x in [-2, 2] {
                builder.fill(x, 1, 5, x, 4, 5, Block::WILDWOOD_LOG);
            }
            builder.fill(-2, 4, 5, 2, 4, 5, Block::WILDWOOD_LOG);
            builder.fill(-3, 5, 4, 3, 5, 6, Block::WILDWOOD_LEAVES);
            for (x, z, flower) in [
                (-4, -2, Block::BLUE_FLOWER),
                (4, -2, Block::RED_FLOWER),
                (-4, 2, Block::RED_FLOWER),
                (4, 2, Block::BLUE_FLOWER),
            ] {
                builder.set(x, 1, z, flower);
            }
            builder.fill(-2, 1, -3, 2, 2, -2, Block::RUNE_STONE);
            builder.set(0, 3, -2, Block::GLOWSTONE);
            builder.set(0, 3, -3, Block::CHEST);
            for (dx, dy, dz, block) in [
                (0, 1, 5, Block::DOOR_CLOSED_LOWER),
                (0, 2, 5, Block::DOOR_CLOSED_UPPER),
                (-1, 3, 5, Block::TORCH_WALL_EAST),
                (1, 3, 5, Block::TORCH_WALL_WEST),
                (-2, 1, 2, Block::WILDWOOD_TABLE),
                (-3, 1, 2, Block::WILDWOOD_STOOL),
                (2, 1, 3, Block::WILDWOOD_SHELF),
            ] {
                builder.set(dx, dy, dz, block);
            }
            (6, 6)
        }
        NamedStructureKind::SunbunGrove => {
            for z in -7_i32..=7 {
                for x in -7_i32..=7 {
                    let distance = f64::from(x * x + z * z).sqrt();
                    if distance <= 7.2 {
                        builder.set(x, 0, z, Block::MEADOW_GRASS);
                    }
                    if distance > 5.6 && distance < 7.2 && (x + z) % 2 == 0 {
                        builder.set(x, 1, z, Block::BANANA_PLANT);
                    }
                }
            }
            builder.fill(-4, 1, 0, -4, 4, 0, Block::BLOOM_LOG);
            builder.fill(4, 1, 0, 4, 4, 0, Block::BLOOM_LOG);
            for x in -3_i32..=3 {
                builder.set(
                    x,
                    5 + (f64::from(x.abs()) * 0.22).round() as i32,
                    0,
                    Block::BLOOM_LEAVES,
                );
            }
            builder.set(0, 1, 5, Block::CHEST);
            for (dx, dy, dz, block) in [
                (-2, 1, -3, Block::WILDWOOD_TABLE),
                (-3, 1, -3, Block::WILDWOOD_STOOL),
                (-1, 1, -3, Block::WILDWOOD_STOOL),
                (4, 1, 3, Block::SEALED_BARREL),
                (-4, 2, 0, Block::TORCH_WALL_EAST),
                (4, 2, 0, Block::TORCH_WALL_WEST),
            ] {
                builder.set(dx, dy, dz, block);
            }
            (7, 7)
        }
        NamedStructureKind::ButterflySanctuary => {
            for z in -9_i32..=9 {
                for x in -9_i32..=9 {
                    let distance = f64::from(x * x + z * z).sqrt();
                    if distance <= 9.2 {
                        builder.set(x, 0, z, Block::MEADOW_GRASS);
                    }
                    if distance > 5.2 && distance < 8.7 && (x * 3 + z * 5).abs() % 3 != 0 {
                        let red = structure_hash_unit(seed, &format!("sanctuary-flower:{x},{z}")) > 0.48;
                        builder.set(x, 1, z, if red { Block::SUNPETAL } else { Block::MOON_ORCHID });
                    }
                }
            }
            for (x, z) in [(-5, 0), (5, 0), (0, -5), (0, 5)] {
                builder.fill(x, 1, z, x, 3, z, Block::BIRCH_LOG);
                builder.set(x, 4, z, Block::GLOWSTONE);
            }
            builder.set(0, 1, 0, Block::CHEST);
            builder.set(-3, 1, 0, Block::WILDWOOD_STOOL);
            builder.set(3, 1, 0, Block::WILDWOOD_STOOL);
            builder.set(0, 1, -3, Block::WILDWOOD_TABLE);
            (9, 9)
        }
        NamedStructureKind::AbandonedApiary => {
            for z in -6_i32..=6 {
                for x in -6_i32..=6 {
                    let distance = f64::from(x * x + z * z).sqrt();
                    if distance <= 6.4 {
                        builder.set(x, 0, z, Block::MEADOW_GRASS);
                    }
                    if distance > 4.2
                        && distance < 6.2
                        && structure_hash_unit(seed, &format!("apiary-bloom:{x},{z}")) > 0.58
                    {
                        let block = if structure_hash_unit(seed, &format!("apiary-color:{x},{z}")) > 0.5 {
                            Block::RED_FLOWER
                        } else {
                            Block::BLUE_FLOWER
                        };
                        builder.set(x, 1, z, block);
                    }
                }
            }
            builder.fill(-3, 1, 2, 3, 1, 2, Block::PLANKS);
            builder.fill(-3, 1, -2, 3, 1, -2, Block::PLANKS);
            builder.set(-2, 2, 2, Block::APIARY);
            builder.set(2, 2, -2, Block::WILD_BEEHIVE);
            builder.set(0, 1, 0, Block::CHEST);
            for (dx, dy, dz, block) in [
                (0, 2, 2, Block::WILDWOOD_TABLE),
                (-1, 2, 2, Block::WILDWOOD_STOOL),
                (3, 2, -2, Block::SEALED_BARREL),
                (-3, 2, -2, Block::WILDWOOD_SHELF),
                (0, 2, -2, Block::TORCH),
            ] {
                builder.set(dx, dy, dz, block);
            }
            (6, 6)
        }
        NamedStructureKind::WaykeeperGrotto => {
            builder.fill(-5, 0, -5, 5, 0, 5, Block::MOSS);
            for (x, z) in [(-5, -5), (5, -5), (-5, 5), (5, 5)] {
                builder.fill(x, 1, z, x, 4, z, Block::MOON_SLATE);
                builder.set(x, 5, z, Block::GLOWSTONE);
            }
            for edge in -4..=4 {
                builder.set(edge, 4, -5, Block::GLASS);
                builder.set(edge, 4, 5, Block::GLASS);
                builder.set(-5, 4, edge, Block::GLASS);
                builder.set(5, 4, edge, Block::GLASS);
            }
            builder.set(0, 1, 0, Block::CREATURE_HEALER);
            builder.set(-2, 1, 0, Block::CAPTURE_ORB_RACK);
            builder.set(2, 1, 0, Block::CHEST);
            for (dx, dy, dz, block) in [
                (-3, 1, 0, Block::WILDWOOD_STOOL),
                (3, 1, 0, Block::WILDWOOD_STOOL),
                (0, 1, -3, Block::WILDWOOD_TABLE),
                (0, 1, 5, Block::MOON_SLATE),
                (0, 2, 5, Block::MOON_SLATE),
                (0, 2, 4, Block::TORCH_WALL_NORTH),
            ] {
                builder.set(dx, dy, dz, block);
            }
            (5, 5)
        }
    };
    NamedStructurePlan {
        origin,
        radius_x,
        radius_z,
        placements: builder.finish(),
    }
}

fn named_structure_plans(generator: &TerrainGeneratorV18, request: &GenerateChunkRequestV2) -> Vec<NamedStructurePlan> {
    if !generator.structures_enabled() {
        return Vec::new();
    }
    let mut plans = Vec::new();
    for origin_cx in request.cx - 1..=request.cx + 1 {
        for origin_cz in request.cz - 1..=request.cz + 1 {
            let origin_x = origin_cx * CHUNK_SIZE as i32 + CHUNK_SIZE as i32 / 2;
            let origin_z = origin_cz * CHUNK_SIZE as i32 + CHUNK_SIZE as i32 / 2;
            let column = generator.sample_column(origin_x, origin_z);
            if column.height <= column.waterline + 2
                || is_syrup_pond_column(generator, &request.seed_text, origin_x, origin_z)
            {
                continue;
            }
            if let Some(kind) = structure_kind_for_chunk(generator, &request.seed_text, origin_cx, origin_cz) {
                plans.push(plan_named_structure(
                    kind,
                    (origin_x, column.height, origin_z),
                    &request.seed_text,
                ));
            }
        }
    }
    plans
}

fn tideglass_embassy_plans(
    generator: &TerrainGeneratorV18,
    request: &GenerateChunkRequestV2,
) -> Vec<NamedStructurePlan> {
    if !generator.structures_enabled() {
        return Vec::new();
    }
    let mut plans = Vec::new();
    for origin_cx in request.cx - 1..=request.cx + 1 {
        for origin_cz in request.cz - 1..=request.cz + 1 {
            let origin_x = origin_cx * CHUNK_SIZE as i32 + CHUNK_SIZE as i32 / 2;
            let origin_z = origin_cz * CHUNK_SIZE as i32 + CHUNK_SIZE as i32 / 2;
            let column = generator.sample_column(origin_x, origin_z);
            if !matches!(
                column.biome,
                BiomeId::Beach | BiomeId::Ocean | BiomeId::DeepOcean | BiomeId::LumenTrench
            ) || is_syrup_pond_column(generator, &request.seed_text, origin_x, origin_z)
            {
                continue;
            }
            let region_x = origin_cx.div_euclid(12);
            let region_z = origin_cz.div_euclid(12);
            let local_x = (adventure_hash_unit(&request.seed_text, &format!("v13-poi:{region_x},{region_z}:x")) * 12.0)
                .floor() as i32;
            let local_z = (adventure_hash_unit(&request.seed_text, &format!("v13-poi:{region_x},{region_z}:z")) * 12.0)
                .floor() as i32;
            if origin_cx != region_x * 12 + local_x || origin_cz != region_z * 12 + local_z {
                continue;
            }
            // Coast POIs retain their authored catalogue order: reedwatch,
            // tidepool, lighthouse, embassy, drowned gate, tideclock wreck.
            let coast_kind_index =
                (adventure_hash_unit(&request.seed_text, &format!("v13-poi:{region_x},{region_z}:kind")) * 6.0).floor()
                    as usize;
            if coast_kind_index != 3 {
                continue;
            }
            let origin = (origin_x, column.height, origin_z);
            let mut builder = StructurePlanBuilder::new(origin);
            for x in -8_i32..=8 {
                for z in -8_i32..=8 {
                    if x * x + z * z <= 64 {
                        builder.set(x, 0, z, Block::LIMESTONE);
                    }
                }
            }
            builder.fill(-6, 0, -5, 6, 0, 5, Block::STORYBOOK_BRICK);
            builder.fill(-4, 0, -3, 4, 0, 2, Block::WATER);
            for x in [-6, 6] {
                for z in [-5, 5] {
                    builder.fill(x, 1, z, x, 5, z, Block::LIMESTONE);
                }
            }
            builder.fill(-6, 5, -5, 6, 5, 5, Block::GLASS);
            for (x, z) in [(-4, -3), (4, -3), (-4, 2), (4, 2)] {
                builder.set(x, 0, z, Block::WHISPERGLASS);
            }
            builder.set(0, 1, 4, Block::WILDWOOD_TABLE);
            builder.set(4, 1, 3, Block::CHEST);
            plans.push(NamedStructurePlan {
                origin,
                radius_x: 8,
                radius_z: 8,
                placements: builder.finish(),
            });
        }
    }
    plans
}

fn clear_generated_growth_for_bounds(
    blocks: &mut [u16],
    min_x: i32,
    min_z: i32,
    bounds: ClearingBounds,
    generated_tree_plans: &[Vec<Placement>],
    suppressed_tree_plans: &mut BTreeSet<usize>,
) {
    let inside =
        |x: i32, z: i32| x >= min_x && x < min_x + CHUNK_SIZE as i32 && z >= min_z && z < min_z + CHUNK_SIZE as i32;
    let mut newly_suppressed = Vec::new();
    for (plan_index, plan) in generated_tree_plans.iter().enumerate() {
        if suppressed_tree_plans.contains(&plan_index)
            || !plan.iter().any(|placement| bounds.contains(placement.x, placement.z))
        {
            continue;
        }
        suppressed_tree_plans.insert(plan_index);
        newly_suppressed.push(plan_index);
    }
    let mut affected = BTreeSet::<(i32, i32, i32)>::new();
    for plan_index in newly_suppressed {
        for placement in &generated_tree_plans[plan_index] {
            if inside(placement.x, placement.z) {
                affected.insert((placement.x, placement.y, placement.z));
            }
        }
    }
    let mut surviving = BTreeMap::<(i32, i32, i32), Placement>::new();
    if !affected.is_empty() {
        for (plan_index, plan) in generated_tree_plans.iter().enumerate() {
            if suppressed_tree_plans.contains(&plan_index) {
                continue;
            }
            for &placement in plan {
                let key = (placement.x, placement.y, placement.z);
                if !affected.contains(&key) {
                    continue;
                }
                match surviving.get(&key) {
                    Some(existing) if !is_leaf(existing.block) || is_leaf(placement.block) => {}
                    _ => {
                        surviving.insert(key, placement);
                    }
                }
            }
        }
    }
    for &(x, y, z) in &affected {
        let block_index = index((x - min_x) as usize, y, (z - min_z) as usize);
        if is_generated_tree(blocks[block_index]) {
            blocks[block_index] = surviving
                .get(&(x, y, z))
                .map_or(Block::AIR, |placement| placement.block);
        }
    }
    for x in bounds.min_x.max(min_x)..=bounds.max_x.min(min_x + CHUNK_SIZE as i32 - 1) {
        for z in bounds.min_z.max(min_z)..=bounds.max_z.min(min_z + CHUNK_SIZE as i32 - 1) {
            let lx = (x - min_x) as usize;
            let lz = (z - min_z) as usize;
            for y in MIN_Y..MIN_Y + WORLD_HEIGHT {
                let block_index = index(lx, y, lz);
                let growth = blocks[block_index];
                if is_generated_growth(growth) {
                    blocks[block_index] = if is_waterlogged_growth(growth) {
                        Block::WATER
                    } else {
                        Block::AIR
                    };
                }
            }
        }
    }
}

#[allow(clippy::too_many_lines)]
pub(crate) fn generate_surface_features(
    generator: &TerrainGeneratorV18,
    request: &GenerateChunkRequestV2,
    heights: &mut [i16],
    biomes: &[u8],
    blocks: &mut [u16],
) -> Vec<MarkerRow> {
    let min_x = request.cx * CHUNK_SIZE as i32;
    let min_z = request.cz * CHUNK_SIZE as i32;
    let inside =
        |x: i32, z: i32| x >= min_x && x < min_x + CHUNK_SIZE as i32 && z >= min_z && z < min_z + CHUNK_SIZE as i32;
    let place = |blocks: &mut [u16], placement: Placement, only_air: bool| {
        if !inside(placement.x, placement.z) || placement.y < MIN_Y || placement.y >= MIN_Y + WORLD_HEIGHT {
            return;
        }
        let i = index(
            (placement.x - min_x) as usize,
            placement.y,
            (placement.z - min_z) as usize,
        );
        let current = blocks[i];
        if only_air && matches!(current, Block::WATER | Block::LAVA) {
            return;
        }
        if !only_air || is_replaceable(current) {
            let replacement_is_double = matches!(
                placement.block,
                Block::DOUBLE_TALL_GRASS_LOWER | Block::DOUBLE_TALL_GRASS_UPPER
            );
            if !replacement_is_double
                && current == Block::DOUBLE_TALL_GRASS_LOWER
                && placement.y + 1 < MIN_Y + WORLD_HEIGHT
            {
                let upper = index(
                    (placement.x - min_x) as usize,
                    placement.y + 1,
                    (placement.z - min_z) as usize,
                );
                if blocks[upper] == Block::DOUBLE_TALL_GRASS_UPPER {
                    blocks[upper] = Block::AIR;
                }
            } else if !replacement_is_double && current == Block::DOUBLE_TALL_GRASS_UPPER && placement.y > MIN_Y {
                let lower = index(
                    (placement.x - min_x) as usize,
                    placement.y - 1,
                    (placement.z - min_z) as usize,
                );
                if blocks[lower] == Block::DOUBLE_TALL_GRASS_LOWER {
                    blocks[lower] = Block::AIR;
                }
            }
            blocks[i] = placement.block;
        }
    };
    let seed = generator.seed();
    let syrup_columns = syrup_pond_columns_for_chunk(generator, request);
    let syrup_cells = syrup_columns
        .iter()
        .map(|column| (column.x, column.z))
        .collect::<BTreeSet<_>>();
    for column in syrup_columns {
        let lx = (column.x - min_x) as usize;
        let lz = (column.z - min_z) as usize;
        for y in column.bed_y + 1..=column.surface_y.max(column.original_surface_y) {
            place(
                blocks,
                Placement {
                    x: column.x,
                    y,
                    z: column.z,
                    block: Block::AIR,
                },
                false,
            );
        }
        place(
            blocks,
            Placement {
                x: column.x,
                y: column.bed_y,
                z: column.z,
                block: Block::SUGAR_SOIL,
            },
            false,
        );
        for y in column.bed_y + 1..=column.surface_y {
            place(
                blocks,
                Placement {
                    x: column.x,
                    y,
                    z: column.z,
                    block: 142,
                },
                false,
            );
        }
        heights[lx + lz * CHUNK_SIZE] = column.bed_y as i16;
    }
    let mut logs = Vec::new();
    let mut leaves = Vec::new();
    let mut generated_tree_plans = Vec::<Vec<Placement>>::new();
    let cell_size = 9_i32;
    for cell_x in (min_x - 8).div_euclid(cell_size)..=(min_x + CHUNK_SIZE as i32 + 8).div_euclid(cell_size) {
        for cell_z in (min_z - 8).div_euclid(cell_size)..=(min_z + CHUNK_SIZE as i32 + 8).div_euclid(cell_size) {
            let x = cell_x * cell_size + 4 + (hash2(cell_x, cell_z, seed ^ 0x1111_1111) * 2.0).floor() as i32;
            let z = cell_z * cell_size + 4 + (hash2(cell_x, cell_z, seed ^ 0x2222_2222) * 2.0).floor() as i32;
            if x * x + z * z < 28
                || is_safe_cave_mouth(generator, x, z)
                || is_syrup_pond_column(generator, &request.seed_text, x, z)
            {
                continue;
            }
            let column = generator.sample_column(x, z);
            let density = match column.biome {
                BiomeId::Meadow => 0.06,
                BiomeId::Wildwood => 0.42,
                BiomeId::Frostpine => 0.33,
                BiomeId::Savanna => 0.11,
                BiomeId::Siltfen => 0.2,
                BiomeId::Birchlight => 0.34,
                BiomeId::Bloomwood => 0.38,
                BiomeId::Snowfield => 0.07,
                BiomeId::MushroomFen => 0.23,
                BiomeId::CloudreedGlen => 0.16,
                BiomeId::RainveilJungle => 0.5,
                BiomeId::SakurabloomGrove => 0.36,
                BiomeId::SugarplumVale => 0.34,
                BiomeId::Glimmerwood => 0.43,
                BiomeId::SnowcapRange => 0.18,
                _ => 0.,
            };
            let chance = (density * (f64::from(cell_size * cell_size) / 16.0)).min(0.98);
            if hash2(cell_x, cell_z, seed ^ 0x3333_3333) >= chance || column.height <= column.waterline + 1 {
                continue;
            }
            let trunk = match column.biome {
                BiomeId::Frostpine | BiomeId::Snowfield | BiomeId::SnowcapRange => Block::PINE_LOG,
                BiomeId::Birchlight | BiomeId::CloudreedGlen => Block::BIRCH_LOG,
                BiomeId::Bloomwood => Block::BLOOM_LOG,
                BiomeId::RainveilJungle => Block::JUNGLE_LOG,
                BiomeId::SakurabloomGrove => Block::SAKURA_LOG,
                BiomeId::SugarplumVale => Block::CANDYWOOD_LOG,
                BiomeId::Glimmerwood => Block::MOONBOUGH_LOG,
                _ => Block::WILDWOOD_LOG,
            };
            let leaf = match trunk {
                Block::PINE_LOG => Block::PINE_LEAVES,
                Block::BIRCH_LOG => Block::BIRCH_LEAVES,
                Block::BLOOM_LOG => Block::BLOOM_LEAVES,
                Block::JUNGLE_LOG => Block::JUNGLE_LEAVES,
                Block::SAKURA_LOG => Block::SAKURA_LEAVES,
                Block::CANDYWOOD_LOG => Block::CANDYWOOD_LEAVES,
                Block::MOONBOUGH_LOG => Block::MOONBOUGH_LEAVES,
                _ => Block::WILDWOOD_LEAVES,
            };
            let frostpear = column.biome == BiomeId::Frostpine && hash2(x, z, seed ^ 0x6f12_a4b9) > 0.8;
            let root = (x, column.height + 1, z);
            let raw_plan = if frostpear {
                plan_frostpear_tree(&format!("{}:frostpear:{x},{z}", request.seed_text), root)
            } else if trunk == Block::PINE_LOG {
                let height = 6 + (hash2(x, z, seed) * 3.0).floor() as i32;
                let mut plan = Vec::new();
                for dy in 1..=height {
                    plan.push(Placement {
                        x,
                        y: column.height + dy,
                        z,
                        block: trunk,
                    });
                }
                for dy in -3_i32..=1 {
                    let radius: i32 = if dy % 2 == 0 { 2 } else { 1 };
                    for dx in -radius..=radius {
                        for dz in -radius..=radius {
                            if dx.abs() + dz.abs() <= radius + 1 {
                                plan.push(Placement {
                                    x: x + dx,
                                    y: column.height + height + dy,
                                    z: z + dz,
                                    block: leaf,
                                });
                            }
                        }
                    }
                }
                plan
            } else {
                let roll = hash2(x, z, seed ^ 0x51a6_c72d);
                let form = if column.biome == BiomeId::SugarplumVale {
                    if roll > 0.91 {
                        TreeForm::Ancient
                    } else if roll > 0.36 {
                        TreeForm::Layered
                    } else {
                        TreeForm::Rounded
                    }
                } else if (column.biome == BiomeId::RainveilJungle && roll > 0.42) || roll > 0.975 {
                    TreeForm::Ancient
                } else if column.biome == BiomeId::CloudreedGlen || roll > 0.77 {
                    TreeForm::Windswept
                } else if roll > 0.45 {
                    TreeForm::Layered
                } else {
                    TreeForm::Rounded
                };
                plan_full_tree(
                    &format!("{}:{x},{z}", request.seed_text),
                    root,
                    form,
                    trunk,
                    leaf,
                    generator,
                )
            };
            let mut forbidden_columns = syrup_cells.clone();
            if column.biome == BiomeId::SugarplumVale {
                for tree_x in x - 6..=x + 6 {
                    for tree_z in z - 6..=z + 6 {
                        if is_syrup_pond_column(generator, &request.seed_text, tree_x, tree_z) {
                            forbidden_columns.insert((tree_x, tree_z));
                        }
                    }
                }
            }
            let plan = repair_generated_tree_plan(raw_plan, root, trunk, &forbidden_columns);
            generated_tree_plans.push(plan.clone());
            for placement in plan {
                if syrup_cells.contains(&(placement.x, placement.z)) {
                    continue;
                }
                if is_leaf(placement.block) {
                    leaves.push(placement)
                } else {
                    logs.push(placement)
                }
            }
        }
    }
    for p in logs {
        place(blocks, p, false);
    }
    for p in leaves {
        place(blocks, p, true);
    }

    let mut legacy_clearings = Vec::<ClearingBounds>::new();
    let mut suppressed_tree_plans = BTreeSet::<usize>::new();

    let apply_secondary_vegetation = |blocks: &mut [u16], legacy_clearings: &[ClearingBounds]| {
        let center_biome = generator.sample_column(min_x + 8, min_z + 8).biome;
        if matches!(center_biome, BiomeId::Desert | BiomeId::Badlands | BiomeId::Meadow) {
            let meadow = center_biome == BiomeId::Meadow;
            let mut feature_count = 0_usize;
            'columns: for lz in 0..CHUNK_SIZE {
                for lx in 0..CHUNK_SIZE {
                    if feature_count >= 64 {
                        break 'columns;
                    }
                    let x = min_x + lx as i32;
                    let z = min_z + lz as i32;
                    let biome_name = if meadow { "meadow" } else { "desert" };
                    let roll = structure_hash_unit(&request.seed_text, &format!("vegetation:{biome_name}:{x},{z}"));
                    let y = generator.sample_column(x, z).height + 1;
                    let mut placements = Vec::new();
                    if meadow {
                        if roll > 0.73 {
                            let block = if roll > 0.91 {
                                Block::SUNPETAL
                            } else if roll > 0.86 {
                                Block::MOON_ORCHID
                            } else if roll > 0.82 {
                                Block::RED_FLOWER
                            } else {
                                Block::TALL_GRASS
                            };
                            placements.push(Placement { x, y, z, block });
                        }
                    } else if roll > 1.0 - 0.013 * 0.15 {
                        let height = 2
                            + (structure_hash_unit(&request.seed_text, &format!("saguaro-height:{x},{z}")) * 3.0)
                                .floor() as i32;
                        for dy in 0..height {
                            placements.push(Placement {
                                x,
                                y: y + dy,
                                z,
                                block: Block::CACTUS,
                            });
                        }
                        if height >= 3 && lx > 0 && lx < CHUNK_SIZE - 1 {
                            let direction =
                                if structure_hash_unit(&request.seed_text, &format!("saguaro-arm:{x},{z}")) < 0.5 {
                                    -1
                                } else {
                                    1
                                };
                            placements.push(Placement {
                                x: x + direction,
                                y: y + height - 2,
                                z,
                                block: Block::CACTUS,
                            });
                        }
                    } else if roll > 1.0 - 0.013 * 0.15 - 0.017 * 0.15 {
                        placements.push(Placement {
                            x,
                            y,
                            z,
                            block: Block::CACTUS,
                        });
                    } else if roll > 0.952 && roll <= 0.97 {
                        placements.push(Placement {
                            x,
                            y,
                            z,
                            block: Block::DESERT_SHRUB,
                        });
                    } else if roll > 0.944 && roll <= 0.952 {
                        placements.push(Placement {
                            x,
                            y,
                            z,
                            block: Block::STONE,
                        });
                        if structure_hash_unit(&request.seed_text, &format!("sunspike:{x},{z}")) > 0.55 {
                            placements.push(Placement {
                                x,
                                y: y + 1,
                                z,
                                block: Block::STONE,
                            });
                        }
                    }

                    if !placements.is_empty() {
                        feature_count += 1;
                    }
                    for placement in placements {
                        let column = generator.sample_column(placement.x, placement.z);
                        if column.height <= column.waterline
                            || matches!(column.biome, BiomeId::DeepOcean | BiomeId::Ocean | BiomeId::River)
                            || is_safe_cave_mouth(generator, placement.x, placement.z)
                            || legacy_clearings
                                .iter()
                                .any(|bounds| bounds.contains(placement.x, placement.z))
                        {
                            continue;
                        }
                        place(blocks, placement, true);
                    }
                }
            }
        }
    };

    for lz in 0..CHUNK_SIZE {
        for lx in 0..CHUNK_SIZE {
            let x = min_x + lx as i32;
            let z = min_z + lz as i32;
            let column = generator.sample_column(x, z);
            if column.height <= column.waterline || is_safe_cave_mouth(generator, x, z) || syrup_cells.contains(&(x, z))
            {
                continue;
            }
            let y = column.height + 1;
            if y >= MIN_Y + WORLD_HEIGHT {
                continue;
            }
            let ground = blocks[index(lx, column.height, lz)];
            let above = blocks[index(lx, y, lz)];
            if ground == Block::AIR || is_fluid(ground) || above != Block::AIR {
                continue;
            }
            let roll = hash2(x, z, seed ^ 0x4444_4444);
            let plant = if column.biome == BiomeId::Desert {
                if roll > 0.99775 { Some(Block::CACTUS) } else { None }
            } else if column.biome == BiomeId::Beach {
                if roll > 0.986 {
                    Some(Block::COAST_ASTER)
                } else if roll > 0.965 {
                    Some(Block::SALTBRUSH)
                } else {
                    None
                }
            } else if column.biome == BiomeId::Volcanic {
                if roll > 0.991 {
                    Some(Block::RED_FLOWER)
                } else if roll > 0.975 {
                    Some(Block::DESERT_SHRUB)
                } else {
                    None
                }
            } else if column.biome == BiomeId::Highlands {
                if roll > 0.988 {
                    Some(Block::CLOUDBELL)
                } else if roll > 0.965 {
                    Some(Block::TALL_GRASS)
                } else {
                    None
                }
            } else if column.biome == BiomeId::SnowcapRange {
                if roll > 0.992 {
                    Some(Block::DREAMCAP)
                } else if roll > 0.978 {
                    Some(Block::STARFERN)
                } else {
                    None
                }
            } else if column.biome == BiomeId::Frostpine {
                if roll > 0.992 {
                    Some(Block::MOONBERRY_BUSH_RIPE)
                } else if roll > 0.982 {
                    Some(Block::SUNBERRY_BUSH_RIPE)
                } else if roll > 0.955 {
                    Some(Block::STARFERN)
                } else if roll > 0.88 {
                    Some(Block::TALL_GRASS)
                } else {
                    None
                }
            } else if surface_flora_biome(column.biome) {
                surface_plant(generator, x, z, column.biome, roll)
            } else if column.biome == BiomeId::MushroomFen && roll > 0.9 {
                Some(38)
            } else {
                None
            };
            let Some(plant) = plant else {
                continue;
            };
            if plant == Block::CACTUS {
                let height = 2 + (hash2(x, z, seed ^ 0x5555_5555) * 3.0).floor() as i32;
                for dy in 1..=height {
                    place(
                        blocks,
                        Placement {
                            x,
                            y: column.height + dy,
                            z,
                            block: plant,
                        },
                        true,
                    );
                }
            } else if plant == Block::PEPPERMINT_TUFT {
                let roll = hash_unit(&request.seed_text, &format!("wild-peppermint-height:{x},{z}"));
                let height = if roll < 0.42 {
                    1
                } else if roll < 0.82 {
                    2
                } else {
                    3
                };
                for dy in 1..=height {
                    let placement_y = column.height + dy;
                    if blocks[index(lx, placement_y, lz)] != Block::AIR {
                        break;
                    }
                    place(
                        blocks,
                        Placement {
                            x,
                            y: placement_y,
                            z,
                            block: plant,
                        },
                        false,
                    );
                }
            } else if surface_flora_biome(column.biome)
                && plant == Block::TALL_GRASS
                && hash2(x, z, seed ^ 0x1381_3813) > 0.82
                && blocks[index(lx, column.height + 2, lz)] == Block::AIR
            {
                place(
                    blocks,
                    Placement {
                        x,
                        y,
                        z,
                        block: Block::DOUBLE_TALL_GRASS_LOWER,
                    },
                    true,
                );
                place(
                    blocks,
                    Placement {
                        x,
                        y: y + 1,
                        z,
                        block: Block::DOUBLE_TALL_GRASS_UPPER,
                    },
                    true,
                );
            } else {
                place(blocks, Placement { x, y, z, block: plant }, true);
            }
        }
    }

    if generator.structures_enabled() {
        let region_size = 96_i32;
        for rx in (min_x - 10).div_euclid(region_size)..=(min_x + CHUNK_SIZE as i32 + 10).div_euclid(region_size) {
            for rz in (min_z - 10).div_euclid(region_size)..=(min_z + CHUNK_SIZE as i32 + 10).div_euclid(region_size) {
                if hash2(rx, rz, seed ^ 0x6666_6666) < 0.72 {
                    continue;
                }
                let x = rx * region_size
                    + 18
                    + (hash2(rx, rz, seed ^ 0x7777_7777) * f64::from(region_size - 36)).floor() as i32;
                let z = rz * region_size
                    + 18
                    + (hash2(rx, rz, seed ^ 0x8888_8888) * f64::from(region_size - 36)).floor() as i32;
                let column = generator.sample_column(x, z);
                if column.height <= column.waterline + 2
                    || matches!(column.biome, BiomeId::Ocean | BiomeId::DeepOcean | BiomeId::River)
                    || is_syrup_pond_column(generator, &request.seed_text, x, z)
                {
                    continue;
                }
                let bounds = ClearingBounds {
                    min_x: x - 6,
                    max_x: x + 6,
                    min_z: z - 6,
                    max_z: z + 6,
                };
                legacy_clearings.push(bounds);

                let mut newly_suppressed = Vec::new();
                for (plan_index, plan) in generated_tree_plans.iter().enumerate() {
                    if suppressed_tree_plans.contains(&plan_index)
                        || !plan.iter().any(|placement| bounds.contains(placement.x, placement.z))
                    {
                        continue;
                    }
                    suppressed_tree_plans.insert(plan_index);
                    newly_suppressed.push(plan_index);
                }
                let mut affected_tree_cells = BTreeSet::<(i32, i32, i32)>::new();
                for plan_index in newly_suppressed {
                    for placement in &generated_tree_plans[plan_index] {
                        if inside(placement.x, placement.z) {
                            affected_tree_cells.insert((placement.x, placement.y, placement.z));
                        }
                    }
                }
                let mut surviving_tree_cells = BTreeMap::<(i32, i32, i32), Placement>::new();
                if !affected_tree_cells.is_empty() {
                    for (plan_index, plan) in generated_tree_plans.iter().enumerate() {
                        if suppressed_tree_plans.contains(&plan_index) {
                            continue;
                        }
                        for &placement in plan {
                            let key = (placement.x, placement.y, placement.z);
                            if !affected_tree_cells.contains(&key) {
                                continue;
                            }
                            match surviving_tree_cells.get(&key) {
                                Some(existing) if !is_leaf(existing.block) || is_leaf(placement.block) => {}
                                _ => {
                                    surviving_tree_cells.insert(key, placement);
                                }
                            }
                        }
                    }
                }
                for &(tree_x, tree_y, tree_z) in &affected_tree_cells {
                    let block_index = index((tree_x - min_x) as usize, tree_y, (tree_z - min_z) as usize);
                    if !is_generated_tree(blocks[block_index]) {
                        continue;
                    }
                    blocks[block_index] = surviving_tree_cells
                        .get(&(tree_x, tree_y, tree_z))
                        .map_or(Block::AIR, |placement| placement.block);
                }
                for clear_x in bounds.min_x.max(min_x)..=bounds.max_x.min(min_x + CHUNK_SIZE as i32 - 1) {
                    for clear_z in bounds.min_z.max(min_z)..=bounds.max_z.min(min_z + CHUNK_SIZE as i32 - 1) {
                        let lx = (clear_x - min_x) as usize;
                        let lz = (clear_z - min_z) as usize;
                        for clear_y in MIN_Y..MIN_Y + WORLD_HEIGHT {
                            let block_index = index(lx, clear_y, lz);
                            let growth = blocks[block_index];
                            if is_generated_growth(growth) {
                                blocks[block_index] = if is_waterlogged_growth(growth) {
                                    Block::WATER
                                } else {
                                    Block::AIR
                                };
                            }
                        }
                    }
                }

                let cabin = hash2(rx, rz, seed ^ 0x9999_9999) > 0.63
                    && matches!(
                        column.biome,
                        BiomeId::Wildwood | BiomeId::Birchlight | BiomeId::Frostpine
                    );
                if cabin {
                    for dx in -3_i32..=3 {
                        for dz in -3_i32..=3 {
                            place(
                                blocks,
                                Placement {
                                    x: x + dx,
                                    y: column.height,
                                    z: z + dz,
                                    block: Block::PLANKS,
                                },
                                false,
                            );
                        }
                    }
                    for dy in 1..=3 {
                        for dx in -3_i32..=3 {
                            for dz in -3_i32..=3 {
                                let wall = dx.abs() == 3 || dz.abs() == 3;
                                if wall && !(dz == -3 && dx == 0 && dy < 3) {
                                    place(
                                        blocks,
                                        Placement {
                                            x: x + dx,
                                            y: column.height + dy,
                                            z: z + dz,
                                            block: if dx.abs() == 3 && dz.abs() == 3 {
                                                Block::WILDWOOD_LOG
                                            } else {
                                                Block::PLANKS
                                            },
                                        },
                                        false,
                                    );
                                }
                            }
                        }
                    }
                    for dx in -4_i32..=4 {
                        for dz in -4_i32..=4 {
                            place(
                                blocks,
                                Placement {
                                    x: x + dx,
                                    y: column.height + 4 + i32::from(dx.abs() <= 2 && dz.abs() <= 2),
                                    z: z + dz,
                                    block: Block::PLANKS,
                                },
                                true,
                            );
                        }
                    }
                    for (dx, dy, dz, block) in [
                        (-2, 1, 1, Block::CRAFTING_TABLE),
                        (2, 1, 1, Block::CHEST),
                        (0, 1, -3, Block::DOOR_CLOSED_LOWER),
                        (0, 2, -3, Block::DOOR_CLOSED_UPPER),
                        (0, 2, 2, Block::TORCH_WALL_NORTH),
                        (-1, 1, 0, Block::WILDWOOD_TABLE),
                        (-2, 1, 0, Block::WILDWOOD_STOOL),
                        (2, 1, -1, Block::WILDWOOD_SHELF),
                        (2, 1, 2, Block::SEALED_BARREL),
                        (-2, 1, 2, Block::HEARTH_FIREPLACE),
                    ] {
                        place(
                            blocks,
                            Placement {
                                x: x + dx,
                                y: column.height + dy,
                                z: z + dz,
                                block,
                            },
                            false,
                        );
                    }
                } else {
                    for dx in -2_i32..=2 {
                        for dz in -2_i32..=2 {
                            if dx.abs() == 2 || dz.abs() == 2 || (dx == 0 && dz == 0) {
                                place(
                                    blocks,
                                    Placement {
                                        x: x + dx,
                                        y: column.height,
                                        z: z + dz,
                                        block: if hash2(x + dx, z + dz, seed) > 0.25 {
                                            Block::STONE_BRICK
                                        } else {
                                            Block::MOSS
                                        },
                                    },
                                    false,
                                );
                            }
                        }
                    }
                    for dy in 1..=4 {
                        place(
                            blocks,
                            Placement {
                                x,
                                y: column.height + dy,
                                z,
                                block: if dy == 4 { Block::GLOWSTONE } else { Block::STONE_BRICK },
                            },
                            false,
                        );
                    }
                    place(
                        blocks,
                        Placement {
                            x: x + 2,
                            y: column.height + 1,
                            z: z + 2,
                            block: Block::CHEST,
                        },
                        false,
                    );
                }
            }
        }
    }

    apply_secondary_vegetation(blocks, &legacy_clearings);

    for lz in 0..CHUNK_SIZE {
        for lx in 0..CHUNK_SIZE {
            let x = min_x + lx as i32;
            let z = min_z + lz as i32;
            let column = generator.sample_column(x, z);
            let water_depth = column.waterline - column.height;
            if water_depth < 2 {
                continue;
            }
            let habitat = match column.biome {
                BiomeId::LumenTrench => AquaticHabitat::LumenTrench,
                BiomeId::DeepOcean => AquaticHabitat::DeepOcean,
                BiomeId::Ocean => AquaticHabitat::Ocean,
                BiomeId::Beach => AquaticHabitat::Coast,
                BiomeId::River => AquaticHabitat::River,
                _ => continue,
            };
            for placement in plan_submerged_flora(&request.seed_text, x, column.height, z, water_depth, habitat) {
                let current = blocks[index(lx, placement.y, lz)];
                if current == Block::WATER {
                    place(blocks, placement, false);
                }
            }
        }
    }
    for plan in named_structure_plans(generator, request) {
        clear_generated_growth_for_bounds(
            blocks,
            min_x,
            min_z,
            ClearingBounds {
                min_x: plan.origin.0 - plan.radius_x - 4,
                max_x: plan.origin.0 + plan.radius_x + 4,
                min_z: plan.origin.2 - plan.radius_z - 4,
                max_z: plan.origin.2 + plan.radius_z + 4,
            },
            &generated_tree_plans,
            &mut suppressed_tree_plans,
        );
        for placement in plan.placements {
            if inside(placement.x, placement.z) && (MIN_Y..MIN_Y + WORLD_HEIGHT).contains(&placement.y) {
                blocks[index(
                    (placement.x - min_x) as usize,
                    placement.y,
                    (placement.z - min_z) as usize,
                )] = placement.block;
            }
        }
    }
    for plan in tideglass_embassy_plans(generator, request) {
        clear_generated_growth_for_bounds(
            blocks,
            min_x,
            min_z,
            ClearingBounds {
                min_x: plan.origin.0 - plan.radius_x - 3,
                max_x: plan.origin.0 + plan.radius_x + 3,
                min_z: plan.origin.2 - plan.radius_z - 3,
                max_z: plan.origin.2 + plan.radius_z + 3,
            },
            &generated_tree_plans,
            &mut suppressed_tree_plans,
        );
        for placement in plan.placements {
            if inside(placement.x, placement.z) && (MIN_Y..MIN_Y + WORLD_HEIGHT).contains(&placement.y) {
                blocks[index(
                    (placement.x - min_x) as usize,
                    placement.y,
                    (placement.z - min_z) as usize,
                )] = placement.block;
            }
        }
    }
    for origin_cx in request.cx - 1..=request.cx + 1 {
        for origin_cz in request.cz - 1..=request.cz + 1 {
            let origin_x = origin_cx * CHUNK_SIZE as i32 + CHUNK_SIZE as i32 / 2;
            let origin_z = origin_cz * CHUNK_SIZE as i32 + CHUNK_SIZE as i32 / 2;
            let column = generator.sample_column(origin_x, origin_z);
            let coast = matches!(
                column.biome,
                BiomeId::Beach | BiomeId::Ocean | BiomeId::DeepOcean | BiomeId::LumenTrench
            );
            if (!coast && column.height <= column.waterline + 2)
                || is_syrup_pond_column(generator, &request.seed_text, origin_x, origin_z)
            {
                continue;
            }
            for dungeon in [false, true] {
                let Some(kind) = adventure::candidate(&request.seed_text, origin_cx, origin_cz, column.biome, dungeon)
                else {
                    continue;
                };
                if !adventure::mythic_terrain_is_valid(kind, generator, (origin_x, origin_z)) {
                    continue;
                }
                let origin_y = adventure::plan_origin_y(kind, column.height, column.waterline);
                let Some(plan) = adventure::plan(kind, (origin_x, origin_y, origin_z), &request.seed_text) else {
                    continue;
                };
                clear_generated_growth_for_bounds(
                    blocks,
                    min_x,
                    min_z,
                    ClearingBounds {
                        min_x: plan.bounds.0 - 3,
                        max_x: plan.bounds.1 + 3,
                        min_z: plan.bounds.2 - 3,
                        max_z: plan.bounds.3 + 3,
                    },
                    &generated_tree_plans,
                    &mut suppressed_tree_plans,
                );
                for placement in plan.placements {
                    if inside(placement.x, placement.z) && (MIN_Y..MIN_Y + WORLD_HEIGHT).contains(&placement.y) {
                        blocks[index(
                            (placement.x - min_x) as usize,
                            placement.y,
                            (placement.z - min_z) as usize,
                        )] = placement.block;
                    }
                }
            }
        }
    }
    let mut structure_markers = Vec::new();
    if generator.structures_enabled() {
        for plan in settlement::plans_for_chunk(&request.seed_text, request.cx, request.cz, generator) {
            let settlement::SettlementPlan {
                placements,
                only_air_placements,
                markers,
                clear_bounds,
            } = plan;
            structure_markers.extend(
                markers
                    .into_iter()
                    .filter(|(x, z, _)| inside(*x, *z))
                    .map(|(_, _, marker)| marker),
            );
            if let Some(bounds) = clear_bounds {
                clear_generated_growth_for_bounds(
                    blocks,
                    min_x,
                    min_z,
                    ClearingBounds {
                        min_x: bounds.0,
                        max_x: bounds.1,
                        min_z: bounds.2,
                        max_z: bounds.3,
                    },
                    &generated_tree_plans,
                    &mut suppressed_tree_plans,
                );
            }
            for placement in placements {
                if inside(placement.x, placement.z) && (MIN_Y..MIN_Y + WORLD_HEIGHT).contains(&placement.y) {
                    blocks[index(
                        (placement.x - min_x) as usize,
                        placement.y,
                        (placement.z - min_z) as usize,
                    )] = placement.block;
                }
            }
            for placement in only_air_placements {
                if inside(placement.x, placement.z) && (MIN_Y..MIN_Y + WORLD_HEIGHT).contains(&placement.y) {
                    let placement_index = index(
                        (placement.x - min_x) as usize,
                        placement.y,
                        (placement.z - min_z) as usize,
                    );
                    if is_replaceable(blocks[placement_index]) {
                        blocks[placement_index] = placement.block;
                    }
                }
            }
        }
        for plan in dragon::plans_for_chunk(&request.seed_text, request.cx, request.cz, generator) {
            for placement in plan.placements {
                if inside(placement.x, placement.z) && (MIN_Y..MIN_Y + WORLD_HEIGHT).contains(&placement.y) {
                    blocks[index(
                        (placement.x - min_x) as usize,
                        placement.y,
                        (placement.z - min_z) as usize,
                    )] = placement.block;
                }
            }
        }
        for plan in dragon::sea_nest_plans_for_chunk(&request.seed_text, request.cx, request.cz, generator) {
            for placement in plan.placements {
                if inside(placement.x, placement.z) && (MIN_Y..MIN_Y + WORLD_HEIGHT).contains(&placement.y) {
                    blocks[index(
                        (placement.x - min_x) as usize,
                        placement.y,
                        (placement.z - min_z) as usize,
                    )] = placement.block;
                }
            }
        }
        if generator.profile() == GenerationProfile::WorldBelowV15 {
            for plan in legendary::plans_for_chunk(&request.seed_text, request.cx, request.cz, generator) {
                for placement in plan.placements {
                    if inside(placement.x, placement.z) && (MIN_Y..MIN_Y + WORLD_HEIGHT).contains(&placement.y) {
                        blocks[index(
                            (placement.x - min_x) as usize,
                            placement.y,
                            (placement.z - min_z) as usize,
                        )] = placement.block;
                    }
                }
            }
        }
    }
    let _ = (heights, biomes);
    structure_markers
}

fn is_fluid(block: u16) -> bool {
    matches!(block, Block::WATER | Block::LAVA)
}

fn surface_flora_biome(biome: BiomeId) -> bool {
    matches!(
        biome,
        BiomeId::Meadow
            | BiomeId::Wildwood
            | BiomeId::Birchlight
            | BiomeId::Bloomwood
            | BiomeId::Savanna
            | BiomeId::Siltfen
            | BiomeId::CloudreedGlen
            | BiomeId::RainveilJungle
            | BiomeId::SakurabloomGrove
            | BiomeId::SugarplumVale
            | BiomeId::Glimmerwood
    )
}

fn surface_plant(generator: &TerrainGeneratorV18, x: i32, z: i32, biome: BiomeId, roll: f64) -> Option<u16> {
    let seed = generator.seed();
    let patch = 0.72 * value_noise_2(f64::from(x) / 19., f64::from(z) / 19., seed ^ 0x35f1_a93b)
        + 0.28 * value_noise_2(f64::from(x) / 6., f64::from(z) / 6., seed ^ 0x6c8e_9cf5);
    let density = match biome {
        BiomeId::Meadow => 0.72,
        BiomeId::Bloomwood => 0.79,
        BiomeId::SugarplumVale => 0.8,
        BiomeId::Savanna => 0.9,
        _ => 0.84,
    };
    if roll + patch * 0.11 <= density {
        return None;
    }
    let flower = matches!(
        biome,
        BiomeId::Meadow | BiomeId::Bloomwood | BiomeId::CloudreedGlen | BiomeId::SakurabloomGrove
    );
    let wheat = hash2(x, z, seed ^ 0x7a9d_35f1) > 0.986;
    let crop = hash2(x, z, seed ^ 0x4d37_a1c9);
    if matches!(
        biome,
        BiomeId::Meadow | BiomeId::Wildwood | BiomeId::Birchlight | BiomeId::Bloomwood
    ) && crop > 0.972
    {
        return Some(Block::COTTON_CROP);
    }
    if matches!(biome, BiomeId::Meadow | BiomeId::Savanna) && crop > 0.977 {
        return Some(Block::SUN_CARROT_CROP);
    }
    if matches!(biome, BiomeId::Siltfen | BiomeId::RainveilJungle | BiomeId::Birchlight) && crop > 0.98 {
        return Some(Block::BLUEPOD_CROP);
    }
    let biome_specific = match biome {
        BiomeId::Glimmerwood => Some(if roll > 0.968 {
            Block::MOONPETAL
        } else if roll > 0.925 {
            Block::DREAMCAP
        } else {
            Block::STARFERN
        }),
        BiomeId::SugarplumVale => Some(if roll > 0.976 {
            Block::LOLLIPOP_ORCHID
        } else if roll > 0.95 {
            Block::MARSHMALLOW_SHRUB
        } else if roll > 0.89 {
            Block::GUMDROP_BUSH
        } else {
            Block::PEPPERMINT_TUFT
        }),
        BiomeId::RainveilJungle => {
            if roll > 0.972 {
                Some(Block::LANTERN_LOTUS)
            } else if roll > 0.88 {
                Some(Block::RAINVEIL_FERN)
            } else {
                None
            }
        }
        BiomeId::SakurabloomGrove => {
            if roll > 0.974 {
                Some(Block::DREAMBLOSSOM)
            } else if roll > 0.89 {
                Some(Block::SAKURA_BLOOM)
            } else {
                None
            }
        }
        BiomeId::Siltfen if roll > 0.988 => Some(Block::MOONRICE_CROP),
        BiomeId::Savanna if roll > 0.992 => Some(Block::SUNROOT_CROP),
        BiomeId::CloudreedGlen => {
            if roll > 0.955 {
                Some(Block::CLOUDBELL)
            } else if roll > 0.905 {
                Some(Block::TALL_GRASS)
            } else {
                None
            }
        }
        _ => None,
    };
    biome_specific.or(Some(if flower && roll > 0.965 {
        Block::BLUE_FLOWER
    } else if flower && roll > 0.925 {
        Block::RED_FLOWER
    } else if wheat {
        Block::WHEAT_CROP
    } else {
        Block::TALL_GRASS
    }))
}

fn structure_hash(seed: &str, salt: &str) -> f64 {
    let text = format!("{seed}:{salt}");
    let mut hash = 2_166_136_261_u32;
    for unit in text.encode_utf16() {
        hash = (hash ^ u32::from(unit)).wrapping_mul(16_777_619);
    }
    hash ^= hash >> 16;
    hash = hash.wrapping_mul(0x85eb_ca6b);
    hash ^= hash >> 13;
    hash = hash.wrapping_mul(0xc2b2_ae35);
    hash ^= hash >> 16;
    f64::from(hash) / 4_294_967_296.0
}

fn waykeeper_origins(generator: &TerrainGeneratorV18, request: &GenerateChunkRequestV2) -> Vec<(i32, i32, i32)> {
    if !generator.structures_enabled() {
        return Vec::new();
    }
    let mut origins = Vec::new();
    for origin_cx in request.cx - 1..=request.cx + 1 {
        for origin_cz in request.cz - 1..=request.cz + 1 {
            let x = origin_cx * 16 + 8;
            let z = origin_cz * 16 + 8;
            let column = generator.sample_column(x, z);
            if !matches!(column.biome, BiomeId::Meadow | BiomeId::CloudreedGlen)
                || column.height <= column.waterline + 2
            {
                continue;
            }
            let region_x = origin_cx.div_euclid(16);
            let region_z = origin_cz.div_euclid(16);
            let local_x = (structure_hash(&request.seed_text, &format!("structure-region:{region_x},{region_z}:x"))
                * 16.0)
                .floor() as i32;
            let local_z = (structure_hash(&request.seed_text, &format!("structure-region:{region_x},{region_z}:z"))
                * 16.0)
                .floor() as i32;
            if region_x * 16 + local_x != origin_cx || region_z * 16 + local_z != origin_cz {
                continue;
            }
            let roll = structure_hash(&request.seed_text, &format!("poi:meadow:{region_x},{region_z}"));
            if (0.52..0.68).contains(&roll) {
                origins.push((x, column.height, z));
            }
        }
    }
    origins
}

#[derive(Clone)]
struct Loot {
    item: &'static str,
    weight: i32,
    min: i32,
    max: i32,
    count: i32,
}

fn healer_loot(seed: &str) -> Vec<Loot> {
    let table = [
        ("waykeeper-capture-orb", 24, 1, 2),
        ("cave-gel", 27, 2, 7),
        ("glow-dust", 20, 2, 6),
        ("crystal-shard", 15, 1, 4),
        ("moonberry", 14, 2, 5),
    ];
    let mut loot: Vec<Loot> = Vec::new();
    for roll in 0..4 {
        let mut cursor = structure_hash(seed, &format!("healer-cache:roll:{roll}")) * 100.0;
        let mut selected = table[4];
        for entry in table {
            cursor -= f64::from(entry.1);
            if cursor <= 0.0 {
                selected = entry;
                break;
            }
        }
        let count = selected.2
            + (structure_hash(seed, &format!("healer-cache:count:{roll}")) * f64::from(selected.3 - selected.2 + 1))
                .floor() as i32;
        if let Some(found) = loot.iter_mut().find(|entry| entry.item == selected.0) {
            found.count += count;
        } else {
            loot.push(Loot {
                item: selected.0,
                weight: selected.1,
                min: selected.2,
                max: selected.3,
                count,
            });
        }
    }
    loot
}

pub(crate) fn named_structure_markers(
    generator: &TerrainGeneratorV18,
    request: &GenerateChunkRequestV2,
) -> Vec<MarkerRow> {
    let mut rows = Vec::new();
    for (x, y, z) in waykeeper_origins(generator, request) {
        let id = format!("waykeeper-healing-grotto:{x},{z}");
        let chest_key = format!("{id}:chest:waykeeper-supplies");
        let loot_seed = format!("{}:waykeeper-supplies", request.seed_text);
        let mut loot_json = String::new();
        for entry in healer_loot(&loot_seed) {
            if !loot_json.is_empty() {
                loot_json.push(',');
            }
            loot_json.push_str(&format!(
                "{{\"count\":{},\"itemKey\":\"{}\",\"max\":{},\"min\":{},\"weight\":{}}}",
                entry.count, entry.item, entry.max, entry.min, entry.weight
            ));
        }
        if structure_hash(&loot_seed, "healer-cache:bonus:0") < 0.035 {
            loot_json.push_str(",{\"chance\":0.035,\"count\":1,\"durability\":1800,\"itemKey\":\"cloudglass-reliquary\",\"max\":1,\"min\":1}");
        }
        rows.push(MarkerRow { key: chest_key.clone(), canonical_json: format!("[\"{chest_key}\",{{\"id\":\"waykeeper-supplies\",\"loot\":[{loot_json}],\"lootTable\":\"healer-cache\",\"position\":{{\"x\":{},\"y\":{},\"z\":{}}},\"type\":\"chest\"}}]", x + 2, y + 1, z) });
        let landmark_key = format!("{id}:landmark:healing-heart");
        rows.push(MarkerRow { key: landmark_key.clone(), canonical_json: format!("[\"{landmark_key}\",{{\"id\":\"healing-heart\",\"mapLayer\":\"surface\",\"position\":{{\"x\":{x},\"y\":{},\"z\":{z}}},\"tag\":\"waykeeper-healing-grotto\",\"type\":\"landmark\"}}]", y + 1) });
        let spawn_key = format!("{id}:spawn:grotto-dragonflies");
        rows.push(MarkerRow { key: spawn_key.clone(), canonical_json: format!("[\"{spawn_key}\",{{\"count\":3,\"id\":\"grotto-dragonflies\",\"mobKind\":\"reed-dragonfly\",\"persistent\":true,\"position\":{{\"x\":{x},\"y\":{},\"z\":{}}},\"radius\":4,\"tags\":[\"grotto-resident\",\"ambient\"],\"type\":\"spawn\"}}]", y + 2, z + 3) });
    }
    rows
}

pub(crate) fn adventure_structure_markers(
    generator: &TerrainGeneratorV18,
    request: &GenerateChunkRequestV2,
) -> Vec<MarkerRow> {
    if !generator.structures_enabled() {
        return Vec::new();
    }
    let mut markers = Vec::new();
    for origin_cx in request.cx - 1..=request.cx + 1 {
        for origin_cz in request.cz - 1..=request.cz + 1 {
            let origin_x = origin_cx * CHUNK_SIZE as i32 + CHUNK_SIZE as i32 / 2;
            let origin_z = origin_cz * CHUNK_SIZE as i32 + CHUNK_SIZE as i32 / 2;
            let column = generator.sample_column(origin_x, origin_z);
            let coast = matches!(
                column.biome,
                BiomeId::Beach | BiomeId::Ocean | BiomeId::DeepOcean | BiomeId::LumenTrench
            );
            if (!coast && column.height <= column.waterline + 2)
                || is_syrup_pond_column(generator, &request.seed_text, origin_x, origin_z)
            {
                continue;
            }
            for dungeon in [false, true] {
                let Some(kind) = adventure::candidate(&request.seed_text, origin_cx, origin_cz, column.biome, dungeon)
                else {
                    continue;
                };
                if !adventure::mythic_terrain_is_valid(kind, generator, (origin_x, origin_z)) {
                    continue;
                }
                let origin_y = adventure::plan_origin_y(kind, column.height, column.waterline);
                if let Some(plan) = adventure::plan(kind, (origin_x, origin_y, origin_z), &request.seed_text) {
                    markers.extend(plan.markers.into_iter().filter_map(|marker| {
                        (marker.x.div_euclid(CHUNK_SIZE as i32) == request.cx
                            && marker.z.div_euclid(CHUNK_SIZE as i32) == request.cz)
                            .then_some(marker.row)
                    }));
                }
            }
        }
    }
    markers
}

pub(crate) fn dragon_lair_markers(generator: &TerrainGeneratorV18, request: &GenerateChunkRequestV2) -> Vec<MarkerRow> {
    if !generator.structures_enabled() {
        return Vec::new();
    }
    dragon::plans_for_chunk(&request.seed_text, request.cx, request.cz, generator)
        .into_iter()
        .chain(dragon::sea_nest_plans_for_chunk(
            &request.seed_text,
            request.cx,
            request.cz,
            generator,
        ))
        .flat_map(|plan| plan.markers)
        .filter_map(|marker| {
            (marker.x.div_euclid(CHUNK_SIZE as i32) == request.cx
                && marker.z.div_euclid(CHUNK_SIZE as i32) == request.cz)
                .then_some(marker.row)
        })
        .collect()
}

pub(crate) fn legendary_site_markers(
    generator: &TerrainGeneratorV18,
    request: &GenerateChunkRequestV2,
) -> Vec<MarkerRow> {
    if !generator.structures_enabled() || generator.profile() != GenerationProfile::WorldBelowV15 {
        return Vec::new();
    }
    legendary::plans_for_chunk(&request.seed_text, request.cx, request.cz, generator)
        .into_iter()
        .flat_map(|plan| plan.markers)
        .filter_map(|marker| {
            (marker.x.div_euclid(CHUNK_SIZE as i32) == request.cx
                && marker.z.div_euclid(CHUNK_SIZE as i32) == request.cz)
                .then_some(marker.row)
        })
        .collect()
}
