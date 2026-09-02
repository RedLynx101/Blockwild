use crate::contract::{
    BiomeId, Block, CELL_COUNT, CHUNK_SIZE, COLUMN_COUNT, ChunkPayloadV2, GENERATOR_VERSION, GenerateChunkRequestV2,
    GenerationError, GenerationOptions, GenerationProfile, MarkerRow, PROTOCOL_VERSION, RESULT_SCHEMA_VERSION,
    SECTION_COUNT, SECTION_HEIGHT, parse_flat_options,
};
use crate::features::{
    adventure_structure_markers, dragon_lair_markers, generate_surface_features, legendary_site_markers,
    named_structure_markers,
};
use crate::noise::{continent_offset, fbm_2, mix, smoothstep, value_noise_2, value_noise_3};
use crate::underground::{carve_graph_caves, cave_feature_at, safe_cave_entrance_floor};
use blockwild_types::{MIN_Y, WORLD_HEIGHT, fnv1a_utf16, hash2, hash3};
use std::collections::hash_map::Entry;
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::fmt;
use std::sync::Mutex;

const SEA_LEVEL: i32 = 32;
const ORE_MULTIPLIER: f64 = 1.25;
const SURFACE_REGION_CELL_SIZE: f64 = 420.0;
// Covers a chunk plus broad feature-planning probes while bounding every active request.
const COLUMN_SAMPLE_CACHE_CAPACITY: usize = 16_384;
const REGIONAL_BIOMES: [BiomeId; 36] = [
    BiomeId::Meadow,
    BiomeId::Wildwood,
    BiomeId::Birchlight,
    BiomeId::Savanna,
    BiomeId::Frostpine,
    BiomeId::Desert,
    BiomeId::Meadow,
    BiomeId::Wildwood,
    BiomeId::Birchlight,
    BiomeId::Savanna,
    BiomeId::Frostpine,
    BiomeId::Desert,
    BiomeId::Meadow,
    BiomeId::Wildwood,
    BiomeId::Birchlight,
    BiomeId::Savanna,
    BiomeId::Frostpine,
    BiomeId::Desert,
    BiomeId::Meadow,
    BiomeId::Wildwood,
    BiomeId::Birchlight,
    BiomeId::Savanna,
    BiomeId::Frostpine,
    BiomeId::Desert,
    BiomeId::Meadow,
    BiomeId::RainveilJungle,
    BiomeId::Siltfen,
    BiomeId::Bloomwood,
    BiomeId::SakurabloomGrove,
    BiomeId::SugarplumVale,
    BiomeId::Glimmerwood,
    BiomeId::MushroomFen,
    BiomeId::CloudreedGlen,
    BiomeId::Badlands,
    BiomeId::Highlands,
    BiomeId::Snowfield,
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ColumnSample {
    pub height: i32,
    pub waterline: i32,
    pub biome: BiomeId,
    pub temperature: f64,
    pub moisture: f64,
    pub continental: f64,
    pub river: f64,
    pub mountain: f64,
}

#[derive(Default)]
struct ColumnSampleCache {
    entries: HashMap<(i32, i32), ColumnSample>,
    insertion_order: VecDeque<(i32, i32)>,
    #[cfg(test)]
    hits: usize,
    #[cfg(test)]
    disabled: bool,
}

impl ColumnSampleCache {
    fn get(&mut self, x: i32, z: i32) -> Option<ColumnSample> {
        #[cfg(test)]
        if self.disabled {
            return None;
        }
        let sample = self.entries.get(&(x, z)).copied();
        #[cfg(test)]
        if sample.is_some() {
            self.hits = self.hits.saturating_add(1);
        }
        sample
    }

    fn insert(&mut self, x: i32, z: i32, sample: ColumnSample) {
        #[cfg(test)]
        if self.disabled {
            return;
        }
        let key = (x, z);
        if matches!(self.entries.entry(key), Entry::Occupied(_)) {
            return;
        }
        // Eviction follows this explicit queue, never HashMap iteration order.
        while self.entries.len() >= COLUMN_SAMPLE_CACHE_CAPACITY {
            let Some(evicted) = self.insertion_order.pop_front() else {
                return;
            };
            self.entries.remove(&evicted);
        }
        self.entries.insert(key, sample);
        self.insertion_order.push_back(key);
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.insertion_order.clear();
        #[cfg(test)]
        {
            self.hits = 0;
        }
    }

    #[cfg(test)]
    fn disable(&mut self) {
        self.clear();
        self.disabled = true;
    }
}

impl fmt::Debug for ColumnSampleCache {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ColumnSampleCache")
            .field("len", &self.entries.len())
            .field("capacity", &COLUMN_SAMPLE_CACHE_CAPACITY)
            .finish()
    }
}

#[derive(Debug)]
pub struct TerrainGeneratorV18 {
    seed: u32,
    options: GenerationOptions,
    column_sample_cache: Mutex<ColumnSampleCache>,
}

impl Clone for TerrainGeneratorV18 {
    fn clone(&self) -> Self {
        Self {
            seed: self.seed,
            options: self.options.clone(),
            column_sample_cache: Mutex::new(ColumnSampleCache::default()),
        }
    }
}

fn assert_send_and_sync<T: Send + Sync>() {}
const _: fn() = assert_send_and_sync::<TerrainGeneratorV18>;

#[derive(Clone, Copy)]
struct RegionSample {
    biome: BiomeId,
    core: BiomeId,
    boundary: f64,
}

impl TerrainGeneratorV18 {
    #[must_use]
    pub fn new(seed_text: impl Into<String>, options: GenerationOptions) -> Self {
        let seed_text = seed_text.into();
        Self {
            seed: fnv1a_utf16(&seed_text),
            options: options.normalized(),
            column_sample_cache: Mutex::new(ColumnSampleCache::default()),
        }
    }

    pub fn from_request(request: &GenerateChunkRequestV2) -> Result<Self, GenerationError> {
        Ok(Self::new(
            &request.seed_text,
            parse_flat_options(&request.generation_options_json)?,
        ))
    }

    #[must_use]
    pub const fn generator_version(&self) -> u16 {
        GENERATOR_VERSION
    }

    #[must_use]
    pub(crate) const fn seed(&self) -> u32 {
        self.seed
    }

    #[must_use]
    pub(crate) const fn cave_frequency(&self) -> f64 {
        self.options.cave_frequency
    }

    #[must_use]
    pub(crate) const fn structures_enabled(&self) -> bool {
        self.options.structures
    }

    #[must_use]
    pub(crate) const fn profile(&self) -> GenerationProfile {
        self.options.profile
    }

    #[must_use]
    pub(crate) const fn options(&self) -> &GenerationOptions {
        &self.options
    }

    #[must_use]
    pub fn sample_column(&self, x: i32, z: i32) -> ColumnSample {
        if let Some(sample) = self
            .column_sample_cache
            .lock()
            .expect("column sample cache mutex poisoned")
            .get(x, z)
        {
            return sample;
        }
        let sample = self.sample_column_uncached(x, z);
        self.column_sample_cache
            .lock()
            .expect("column sample cache mutex poisoned")
            .insert(x, z, sample);
        sample
    }

    fn sample_column_uncached(&self, x: i32, z: i32) -> ColumnSample {
        let biome_scale = if self.options.profile == GenerationProfile::LegacyV14 {
            1.0
        } else {
            self.options.biome_scale
        };
        let sample_x = f64::from(x) / biome_scale;
        let sample_z = f64::from(z) / biome_scale;
        let warp_x = sample_x + 34.0 * fbm_2(sample_x, sample_z, self.seed ^ 0x1f12_3bb5, 1.0 / 420.0, 3);
        let warp_z = sample_z + 34.0 * fbm_2(sample_x, sample_z, self.seed ^ 0x72e8_a1d3, 1.0 / 420.0, 3);
        let continental = 0.72 * fbm_2(warp_x, warp_z, self.seed ^ 0x9e37_79b9, 1.0 / 720.0, 5)
            + 0.28 * fbm_2(warp_x, warp_z, self.seed ^ 0x85eb_ca6b, 1.0 / 240.0, 3);
        let temperature = (0.5
            + 0.5
                * (0.78 * fbm_2(sample_x, sample_z, self.seed ^ 0xc2b2_ae35, 1.0 / 560.0, 4)
                    + 0.22 * fbm_2(sample_x, sample_z, self.seed ^ 0x27d4_eb2d, 1.0 / 140.0, 2)))
        .clamp(0.0, 1.0);
        let moisture = (0.5
            + 0.5
                * (0.8 * fbm_2(sample_x, sample_z, self.seed ^ 0x1656_67b1, 1.0 / 510.0, 4)
                    + 0.2 * fbm_2(sample_x, sample_z, self.seed ^ 0xd3a2_646c, 1.0 / 125.0, 2)))
        .clamp(0.0, 1.0);
        let erosion = (0.5 + 0.5 * fbm_2(warp_x, warp_z, self.seed ^ 0xfd70_46c5, 1.0 / 390.0, 4)).clamp(0.0, 1.0);
        let region = (0.5 + 0.5 * fbm_2(warp_x, warp_z, self.seed ^ 0xb55a_4f09, 1.0 / 440.0, 3)).clamp(0.0, 1.0);
        let variant = (0.5 + 0.5 * fbm_2(warp_x - 900.0, warp_z + 600.0, self.seed ^ 0x94d0_49bb, 1.0 / 270.0, 3))
            .clamp(0.0, 1.0);
        let ridge = (1.0 - fbm_2(warp_x, warp_z, self.seed ^ 0x369d_ea0f, 1.0 / 165.0, 4).abs())
            .max(0.0)
            .powi(3);
        let mountain = smoothstep(0.25, 0.58, continental) * smoothstep(0.56, 0.8, region) * (1.0 - 0.65 * erosion);
        let detail = (5.5 - 3.7 * erosion) * fbm_2(warp_x, warp_z, self.seed ^ 0x7f4a_7c15, 1.0 / 92.0, 4)
            + 1.2 * fbm_2(warp_x, warp_z, self.seed ^ 0x632b_e59b, 1.0 / 24.0, 2);
        let mut height =
            f64::from(SEA_LEVEL) + continent_offset(continental) + detail + mountain * (6.0 + 30.0 * ridge);
        let ocean_weight = 1.0 - smoothstep(-0.26, -0.03, continental);
        let ocean_basin = 0.5 + 0.5 * fbm_2(warp_x + 731.0, warp_z - 419.0, self.seed ^ 0x41c6_4e6d, 1.0 / 210.0, 4);
        let trench = (1.0 - fbm_2(warp_x - 503.0, warp_z + 887.0, self.seed ^ 0x9f4a_7c31, 1.0 / 185.0, 4).abs())
            .max(0.0)
            .powi(5);
        height -= ocean_weight * (2.5 + ocean_basin * 7.0 + trench * 17.0);
        let river_field = fbm_2(warp_x + 211.0, warp_z - 173.0, self.seed ^ 0x8515_7af5, 1.0 / 320.0, 3).abs();
        let river = (1.0 - smoothstep(0.018, 0.066, river_field))
            * smoothstep(-0.16, 0.06, continental)
            * (1.0 - 0.75 * mountain);
        let river_bed = 0.5 + 0.5 * fbm_2(warp_x - 377.0, warp_z + 229.0, self.seed ^ 0xa511_e9b3, 1.0 / 74.0, 3);
        height = mix(
            height,
            f64::from(SEA_LEVEL) - (2.5 + river_bed * 2.0),
            smoothstep(0.12, 0.78, river) * 0.92,
        );
        let swamp = smoothstep(0.7, 0.86, moisture)
            * smoothstep(0.38, 0.57, temperature)
            * (1.0 - smoothstep(f64::from(SEA_LEVEL + 10), f64::from(SEA_LEVEL + 18), height));
        height = mix(
            height,
            f64::from(SEA_LEVEL) + 2.0 + 1.4 * fbm_2(warp_x, warp_z, self.seed ^ 0xe17a_1465, 1.0 / 42.0, 2),
            swamp * 0.76,
        );
        let dry = smoothstep(0.6, 0.77, temperature) * (1.0 - smoothstep(0.23, 0.36, moisture));
        height += 3.6 * dry * (1.0 - fbm_2(warp_x, warp_z, self.seed ^ 0xa24b_aed4, 1.0 / 50.0, 3).abs()).powi(2);
        let local_relief = fbm_2(warp_x + 53.0, warp_z - 91.0, self.seed ^ 0x4cf5_ad43, 1.0 / 46.0, 3);
        height += local_relief
            * (1.15 + dry * 2.15 + moisture * 0.65 + mountain * 1.5)
            * (1.0 - smoothstep(0.2, 0.7, river) * 0.9);
        let sugarplum_relief = smoothstep(0.68, 0.78, variant)
            * (1.0 - smoothstep(0.91, 0.98, variant))
            * smoothstep(0.32, 0.46, moisture)
            * (1.0 - smoothstep(0.76, 0.9, moisture));
        height += sugarplum_relief
            * (1.1 + 1.35 * fbm_2(warp_x + 193.0, warp_z - 307.0, self.seed ^ 0x7c15_a4f3, 1.0 / 38.0, 3))
            * (1.0 - river);
        let world_below = self.options.profile == GenerationProfile::WorldBelowV15;
        let macro_roll = fbm_2(warp_x - 119.0, warp_z + 287.0, self.seed ^ 0xd807_aa98, 1.0 / 260.0, 4);
        let hill_country = smoothstep(-0.02, 0.42, continental) * (1.0 - mountain) * (1.0 - swamp) * (1.0 - river);
        if world_below {
            height += hill_country * (3.2 * macro_roll + 4.4 * macro_roll.max(0.0).powi(2));
        }
        let surface_region = world_below.then(|| self.surface_region(sample_x, sample_z, temperature, moisture));
        if let Some(surface) =
            surface_region.filter(|_| height > f64::from(SEA_LEVEL + 1) && continental > -0.08 && river < 0.5)
        {
            let strength = 0.78 * (1.0 - smoothstep(0.0, 0.92, surface.boundary));
            let broad = fbm_2(warp_x + 947.0, warp_z - 613.0, self.seed ^ 0x510e_527f, 1.0 / 150.0, 4);
            let folded =
                (1.0 - fbm_2(warp_x - 283.0, warp_z + 719.0, self.seed ^ 0x9b05_688c, 1.0 / 105.0, 4).abs()).max(0.0);
            match surface.core {
                BiomeId::Meadow => height = mix(height, f64::from(SEA_LEVEL + 8) + broad * 2.2, strength * 0.42),
                BiomeId::Siltfen | BiomeId::MushroomFen => {
                    height = mix(height, f64::from(SEA_LEVEL) + 3.2 + broad * 1.8, strength * 0.8)
                }
                BiomeId::Wildwood | BiomeId::Birchlight => height += strength * (2.3 * broad + 3.1 * folded),
                BiomeId::Bloomwood | BiomeId::SakurabloomGrove | BiomeId::Glimmerwood => {
                    height += strength * (3.4 * broad + 4.6 * folded)
                }
                BiomeId::SugarplumVale => height += strength * (2.5 + 4.2 * broad.max(0.0).powi(2)),
                BiomeId::Savanna => {
                    height = mix(
                        height,
                        ((height + broad * 3.0) / 3.0).round() * 3.0 + 2.5 * folded,
                        strength * 0.62,
                    )
                }
                BiomeId::Desert => height += strength * (1.8 + 5.2 * folded.powi(2) + broad * 1.4),
                BiomeId::Badlands => {
                    height = mix(
                        height,
                        ((height.max(f64::from(SEA_LEVEL + 9)) + folded * 13.0) / 5.0).round() * 5.0,
                        strength * 0.76,
                    )
                }
                BiomeId::RainveilJungle => height += strength * (8.0 * folded + 7.0 * broad),
                BiomeId::CloudreedGlen => height += strength * (5.0 + 8.0 * folded + broad * 3.0),
                BiomeId::Highlands => {
                    height = mix(
                        height,
                        height.max(f64::from(SEA_LEVEL + 42) + folded * 38.0 + broad * 8.0),
                        strength * 0.88,
                    )
                }
                BiomeId::Snowfield | BiomeId::Frostpine => height += strength * (2.5 * broad + 4.0 * folded),
                _ => {}
            }
        }
        let reserve_cell_x = (sample_x / 768.0).floor() as i32;
        let reserve_cell_z = (sample_z / 768.0).floor() as i32;
        let reserve_center_x = f64::from(reserve_cell_x * 768 + 128)
            + hash2(reserve_cell_x, reserve_cell_z, self.seed ^ 0x243f_6a88) * 512.0;
        let reserve_center_z = f64::from(reserve_cell_z * 768 + 128)
            + hash2(reserve_cell_x, reserve_cell_z, self.seed ^ 0x85a3_08d3) * 512.0;
        let reserve_radius = 82.0 + hash2(reserve_cell_x, reserve_cell_z, self.seed ^ 0x1319_8a2e) * 38.0;
        let reserve_distance = ((sample_x - reserve_center_x).powi(2) + (sample_z - reserve_center_z).powi(2)).sqrt()
            + fbm_2(sample_x, sample_z, self.seed ^ 0x0370_7344, 1.0 / 62.0, 2) * 13.0;
        let reserve_strength = if world_below {
            1.0 - smoothstep(reserve_radius * 0.48, reserve_radius, reserve_distance)
        } else {
            0.0
        };
        let reserves = [
            BiomeId::CloudreedGlen,
            BiomeId::RainveilJungle,
            BiomeId::SakurabloomGrove,
            BiomeId::MushroomFen,
            BiomeId::SugarplumVale,
            BiomeId::Glimmerwood,
            BiomeId::SnowcapRange,
            BiomeId::Volcanic,
            BiomeId::LumenTrench,
        ];
        let reserve_index = ((hash2(reserve_cell_x, reserve_cell_z, self.seed ^ 0xa409_3822) * reserves.len() as f64)
            .floor() as usize)
            .min(reserves.len() - 1);
        let reserve_biome = reserves[reserve_index];
        if reserve_strength > 0.0 {
            let relief = fbm_2(
                sample_x + 913.0,
                sample_z - 271.0,
                self.seed ^ 0x299f_31d0,
                1.0 / 46.0,
                3,
            );
            match reserve_biome {
                BiomeId::LumenTrench => {
                    height = mix(
                        height,
                        f64::from(SEA_LEVEL - 28) - 7.0 * relief.max(0.0),
                        reserve_strength * 0.96,
                    )
                }
                BiomeId::SnowcapRange => {
                    height = mix(
                        height,
                        height.max(f64::from(SEA_LEVEL + 58) + 28.0 * (1.0 - relief.abs()).max(0.0)),
                        reserve_strength * 0.96,
                    )
                }
                BiomeId::Volcanic => {
                    height = mix(
                        height,
                        height.max(f64::from(SEA_LEVEL + 28) + 26.0 * (1.0 - relief.abs()).max(0.0) + relief * 4.0),
                        reserve_strength * 0.92,
                    )
                }
                BiomeId::MushroomFen => {
                    height = mix(height, f64::from(SEA_LEVEL + 3) + relief * 2.0, reserve_strength * 0.88)
                }
                _ => {
                    height = mix(
                        height,
                        height.max(
                            f64::from(SEA_LEVEL + 8)
                                + relief
                                    * if reserve_biome == BiomeId::CloudreedGlen {
                                        6.0
                                    } else {
                                        4.0
                                    },
                        ),
                        reserve_strength * 0.86,
                    )
                }
            }
        }
        if river > 0.52 {
            let depth = 3.0 + (smoothstep(0.52, 0.9, river) * 3.0 + river_bed * 2.0).floor();
            height = height.min(f64::from(SEA_LEVEL) - depth);
        }
        let height = (height.round() as i32).clamp(MIN_Y + 7, 119);
        let mut biome = if river > 0.52 {
            BiomeId::River
        } else if height <= SEA_LEVEL - 23 && trench > 0.34 {
            BiomeId::LumenTrench
        } else if height <= SEA_LEVEL - 10 {
            BiomeId::DeepOcean
        } else if height <= SEA_LEVEL - 2 {
            if temperature < 0.15 {
                BiomeId::Snowfield
            } else {
                BiomeId::Ocean
            }
        } else if height <= if world_below { SEA_LEVEL } else { SEA_LEVEL + 2 } {
            BiomeId::Beach
        } else if let Some(surface) = surface_region {
            if height >= 96 && temperature < 0.62 {
                BiomeId::SnowcapRange
            } else if height >= 76 && !matches!(surface.biome, BiomeId::Badlands | BiomeId::Desert) {
                if temperature < 0.42 {
                    BiomeId::Snowfield
                } else {
                    BiomeId::Highlands
                }
            } else {
                surface.biome
            }
        } else if variant > 0.8 && mountain > 0.12 && temperature > 0.4 {
            BiomeId::Volcanic
        } else if (mountain > 0.52 || height >= 76) && temperature < 0.58 {
            BiomeId::SnowcapRange
        } else if mountain > 0.36 || height >= 68 {
            if temperature < 0.35 || height > 78 {
                BiomeId::Snowfield
            } else {
                BiomeId::Highlands
            }
        } else if temperature < 0.2 {
            BiomeId::Snowfield
        } else if temperature < 0.36 && moisture >= 0.42 {
            BiomeId::Frostpine
        } else if height < 68
            && (0.38..=0.7).contains(&temperature)
            && (0.33..=0.76).contains(&moisture)
            && (0.7..=0.93).contains(&variant)
        {
            BiomeId::SugarplumVale
        } else if (0.32..=0.55).contains(&temperature) && moisture >= 0.64 && (0.18..=0.43).contains(&variant) {
            BiomeId::Glimmerwood
        } else if temperature > 0.62 && moisture < 0.2 && variant > 0.52 {
            BiomeId::Badlands
        } else if temperature > 0.64 && moisture < 0.3 {
            BiomeId::Desert
        } else if temperature > 0.58 && moisture < 0.54 {
            BiomeId::Savanna
        } else if (42..=66).contains(&height)
            && (0.3..=0.55).contains(&temperature)
            && (0.68..=0.92).contains(&moisture)
            && variant < 0.58
        {
            BiomeId::CloudreedGlen
        } else if temperature > 0.57 && moisture > 0.72 && variant < 0.78 {
            BiomeId::RainveilJungle
        } else if (0.34..=0.62).contains(&temperature) && moisture > 0.55 && variant > 0.42 && variant < 0.68 {
            BiomeId::SakurabloomGrove
        } else if moisture > 0.74 && height < SEA_LEVEL + 14 {
            if variant > 0.74 {
                BiomeId::MushroomFen
            } else {
                BiomeId::Siltfen
            }
        } else if moisture > 0.63 && variant > 0.72 {
            BiomeId::Bloomwood
        } else if moisture > 0.54 && variant > 0.55 {
            BiomeId::Birchlight
        } else if moisture > 0.56 {
            BiomeId::Wildwood
        } else {
            BiomeId::Meadow
        };
        if reserve_strength > 0.62 && river < 0.58 {
            biome = reserve_biome;
        }
        ColumnSample {
            height,
            waterline: SEA_LEVEL,
            biome,
            temperature,
            moisture,
            continental,
            river,
            mountain,
        }
    }

    pub fn generate(
        &self,
        request: &GenerateChunkRequestV2,
        cancelled: impl Fn() -> bool,
    ) -> Result<ChunkPayloadV2, GenerationError> {
        request.validate()?;
        if !request
            .namespace
            .split('|')
            .any(|part| part == format!("g{GENERATOR_VERSION}"))
        {
            return Err(GenerationError::UnsupportedGenerator(request.namespace.clone()));
        }
        // A generator is normally created per request, but callers may reuse one.
        // Reset here so memoized probes remain request-scoped in both cases.
        self.column_sample_cache
            .lock()
            .expect("column sample cache mutex poisoned")
            .clear();
        let mut blocks = vec![Block::AIR; CELL_COUNT];
        let mut heightmap = vec![0_i16; COLUMN_COUNT];
        let mut biomes = vec![0_u8; COLUMN_COUNT];
        for lx in 0..CHUNK_SIZE {
            if cancelled() {
                return Err(GenerationError::Cancelled);
            }
            for lz in 0..CHUNK_SIZE {
                let gx = request.cx.wrapping_mul(CHUNK_SIZE as i32).wrapping_add(lx as i32);
                let gz = request.cz.wrapping_mul(CHUNK_SIZE as i32).wrapping_add(lz as i32);
                let column = self.sample_column(gx, gz);
                let column_index = lx + lz * CHUNK_SIZE;
                heightmap[column_index] = column.height as i16;
                biomes[column_index] = column.biome as u8;
                self.generate_column(&mut blocks, lx, lz, gx, gz, column);
            }
        }
        let underground_markers = if self.options.profile == GenerationProfile::WorldBelowV15 {
            carve_graph_caves(self, request, &heightmap, &mut blocks)
        } else {
            Vec::new()
        };
        let surface_markers = generate_surface_features(self, request, &mut heightmap, &biomes, &mut blocks);
        for &(index, block) in &request.edits {
            blocks[index as usize] = block;
        }
        let mut section_block_counts = vec![0_u16; SECTION_COUNT];
        let mut sky_tops = vec![MIN_Y as i16 - 1; COLUMN_COUNT];
        let mut light = vec![0_u16; CELL_COUNT];
        let mut light_indices = BTreeSet::new();
        let mut leaf_indices = BTreeSet::new();
        self.finalize(
            &blocks,
            &mut section_block_counts,
            &mut sky_tops,
            &mut light_indices,
            &mut leaf_indices,
        );
        initialize_light(&blocks, &mut light);
        let mut markers = self.generate_markers(request, &heightmap, &biomes);
        markers.extend(surface_markers);
        markers.extend(underground_markers);
        markers.sort();
        let mut payload = ChunkPayloadV2 {
            protocol_version: PROTOCOL_VERSION,
            schema_version: RESULT_SCHEMA_VERSION,
            epoch: request.epoch,
            task_id: request.task_id,
            revision: request.revision,
            namespace: request.namespace.clone(),
            content_hash: request.content_hash.clone(),
            generator_hash: request.generator_hash.clone(),
            request_hash: request.request_hash.clone(),
            key: request.key.clone(),
            cx: request.cx,
            cz: request.cz,
            blocks,
            heightmap,
            biomes,
            section_block_counts,
            sky_tops,
            light,
            light_indices: light_indices.into_iter().collect(),
            leaf_indices: leaf_indices.into_iter().collect(),
            markers,
            chunk_hash: String::new(),
        };
        payload.chunk_hash = payload.canonical_hash().to_hex();
        payload.validate(request)?;
        Ok(payload)
    }

    fn surface_region(&self, x: f64, z: f64, temperature: f64, moisture: f64) -> RegionSample {
        let base_x = (x / SURFACE_REGION_CELL_SIZE).floor() as i32;
        let base_z = (z / SURFACE_REGION_CELL_SIZE).floor() as i32;
        let mut candidates = Vec::with_capacity(9);
        for cell_x in base_x - 1..=base_x + 1 {
            for cell_z in base_z - 1..=base_z + 1 {
                let jitter_x = (hash2(cell_x, cell_z, self.seed ^ 0xbb67_ae85) - 0.5) * SURFACE_REGION_CELL_SIZE * 0.42;
                let jitter_z = (hash2(cell_x, cell_z, self.seed ^ 0x3c6e_f372) - 0.5) * SURFACE_REGION_CELL_SIZE * 0.42;
                let center_x = (f64::from(cell_x) + 0.5) * SURFACE_REGION_CELL_SIZE + jitter_x;
                let center_z = (f64::from(cell_z) + 0.5) * SURFACE_REGION_CELL_SIZE + jitter_z;
                let distance = ((x - center_x).powi(2) + (z - center_z).powi(2)).sqrt();
                candidates.push((distance, cell_x, cell_z, self.regional_biome(cell_x, cell_z)));
            }
        }
        candidates.sort_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then(left.1.cmp(&right.1))
                .then(left.2.cmp(&right.2))
        });
        let first = candidates[0];
        let second = candidates[1];
        let boundary = (1.0 - (second.0 - first.0) / 90.0).clamp(0.0, 1.0);
        let biome = if boundary > 0.0 {
            transition_biome(first.3, second.3, temperature, moisture)
        } else {
            first.3
        };
        RegionSample {
            biome,
            core: first.3,
            boundary,
        }
    }

    fn regional_biome(&self, x: i32, z: i32) -> BiomeId {
        let phase = (hash2(0, 0, self.seed ^ 0x6a09_e667) * REGIONAL_BIOMES.len() as f64).floor() as i32;
        let strides = [5_i32, 7, 11, 13];
        let x_stride = strides[(self.seed & 3) as usize];
        let z_stride = strides[((self.seed >> 3) & 3) as usize];
        let index = (x
            .wrapping_mul(x_stride)
            .wrapping_add(z.wrapping_mul(z_stride))
            .wrapping_add(phase))
        .rem_euclid(REGIONAL_BIOMES.len() as i32);
        REGIONAL_BIOMES[index as usize]
    }

    fn generate_column(&self, blocks: &mut [u16], lx: usize, lz: usize, gx: i32, gz: i32, column: ColumnSample) {
        let (top, filler) = self.surface_blocks(column);
        let extra_bedrock = 1 + (hash2(gx, gz, self.seed ^ 0x4cf5_ad43) * 4.0).floor() as i32;
        let tunnel_warp = value_noise_2(f64::from(gx) / 76.0, f64::from(gz) / 76.0, self.seed ^ 0x91e1_0da5) * 4.0;
        let ravine_line = fbm_2(f64::from(gx), f64::from(gz), self.seed ^ 0x1656_67c5, 1.0 / 230.0, 2).abs();
        let ravine_segment = fbm_2(f64::from(gx), f64::from(gz), self.seed ^ 0x9e37_79f9, 1.0 / 520.0, 2);
        let aquifer_table =
            -4 + (7.0 * fbm_2(f64::from(gx), f64::from(gz), self.seed ^ 0x7ed5_5d16, 1.0 / 170.0, 2)).floor() as i32;
        let aquifer_wet = value_noise_2(f64::from(gx) / 64.0, f64::from(gz) / 64.0, self.seed ^ 0x94d0_49bd) > 0.28;
        let aquifer_neighbor = |x: i32, z: i32| {
            let table =
                -4 + (7.0 * fbm_2(f64::from(x), f64::from(z), self.seed ^ 0x7ed5_5d16, 1.0 / 170.0, 2)).floor() as i32;
            let wet = value_noise_2(f64::from(x) / 64.0, f64::from(z) / 64.0, self.seed ^ 0x94d0_49bd) > 0.28;
            (wet, table)
        };
        let neighboring_aquifers = [
            aquifer_neighbor(gx - 1, gz),
            aquifer_neighbor(gx + 1, gz),
            aquifer_neighbor(gx, gz - 1),
            aquifer_neighbor(gx, gz + 1),
        ];
        let entrance_floor = safe_cave_entrance_floor(self, gx, gz);
        let bank_ring = [
            self.sample_column(gx - 3, gz),
            self.sample_column(gx + 3, gz),
            self.sample_column(gx, gz - 3),
            self.sample_column(gx, gz + 3),
            self.sample_column(gx - 2, gz - 2),
            self.sample_column(gx + 2, gz - 2),
            self.sample_column(gx - 2, gz + 2),
            self.sample_column(gx + 2, gz + 2),
        ];
        let near_aquatic_bank = bank_ring.iter().any(|neighbor| {
            matches!(
                neighbor.biome,
                BiomeId::River | BiomeId::Ocean | BiomeId::DeepOcean | BiomeId::LumenTrench | BiomeId::Beach
            ) || neighbor.height <= neighbor.waterline + 2
        });
        let protected_roof = if near_aquatic_bank {
            (column.height - 7).min(
                bank_ring
                    .iter()
                    .map(|neighbor| neighbor.height)
                    .min()
                    .unwrap_or(column.height)
                    - 3,
            )
        } else {
            column.height - 4
        };
        for y in MIN_Y..=column.height.max(column.waterline) {
            let mut block = Block::AIR;
            if y <= MIN_Y + extra_bedrock {
                block = Block::BEDROCK;
            } else if y <= column.height {
                block = if y == column.height {
                    top
                } else if y
                    >= column.height
                        - if matches!(column.biome, BiomeId::Desert | BiomeId::Beach) {
                            5
                        } else {
                            3
                        }
                {
                    filler
                } else if y < MIN_Y + 18 {
                    Block::BASALT
                } else if y < -10 {
                    Block::DEEPSTONE
                } else if column.biome == BiomeId::Volcanic {
                    Block::BASALT
                } else {
                    Block::STONE
                };
                let depth = column.height - y;
                let surface_mouth = entrance_floor.is_some_and(|floor| y >= floor && y <= column.height);
                if self.options.cave_frequency > 0.0 && (y < protected_roof || surface_mouth) && y > MIN_Y + 4 {
                    let base_threshold = mix(0.5, 0.34, smoothstep(12.0, 52.0, f64::from(depth)));
                    let threshold = base_threshold + (1.0 - self.options.cave_frequency) * 0.1;
                    let cheese = value_noise_3(
                        f64::from(gx) / 42.0,
                        f64::from(y) / 50.0,
                        f64::from(gz) / 42.0,
                        self.seed ^ 0x6d2b_79f5,
                    ) * 0.72
                        + value_noise_3(
                            f64::from(gx) / 18.0,
                            f64::from(y) / 22.0,
                            f64::from(gz) / 18.0,
                            self.seed ^ 0x27d4_eb2f,
                        ) * 0.28
                        > threshold;
                    let spaghetti =
                        (f64::from(gx) * 0.115 + f64::from(y) * 0.083 + f64::from(gz) * 0.041 + tunnel_warp)
                            .sin()
                            .abs()
                            < 0.052 * self.options.cave_frequency
                            && (f64::from(gz) * 0.129 - f64::from(y) * 0.071 + f64::from(gx) * 0.033 - tunnel_warp)
                                .sin()
                                .abs()
                                < 0.16 * self.options.cave_frequency.sqrt();
                    let deep = y < -24
                        && value_noise_3(
                            f64::from(gx) / 68.0,
                            f64::from(y) / 58.0,
                            f64::from(gz) / 68.0,
                            self.seed ^ 0x5bd1_e995,
                        ) > 0.47 + (1.0 - self.options.cave_frequency) * 0.08
                        && (f64::from(gx) * 0.09 + f64::from(gz) * 0.07 + f64::from(y) * 0.11).sin() > -0.05;
                    let ravine_top = column.height - 5;
                    let ravine_bottom = (column.height - 38).max(MIN_Y + 5);
                    let ravine_p = f64::from(y - ravine_bottom) / f64::from((ravine_top - ravine_bottom).max(1));
                    let ravine = ravine_segment > 0.1
                        && y > ravine_bottom
                        && y < ravine_top
                        && ravine_line
                            < 0.02
                                * self.options.cave_frequency
                                * (0.35 + 0.65 * (std::f64::consts::PI * ravine_p).sin());
                    let (chamber, chimney) =
                        cave_feature_at(self.seed, gx, y, gz, column.height, self.options.cave_frequency);
                    if cheese || spaghetti || deep || ravine || chamber || chimney || surface_mouth {
                        block = if y <= MIN_Y + 7 {
                            Block::LAVA
                        } else if aquifer_wet && y <= aquifer_table {
                            Block::WATER
                        } else if !neighboring_aquifers.iter().any(|(wet, table)| *wet && y <= *table) {
                            Block::AIR
                        } else {
                            block
                        };
                    }
                }
                if matches!(block, Block::STONE | Block::DEEPSTONE | Block::BASALT)
                    && self.options.profile == GenerationProfile::WorldBelowV15
                {
                    block = self.ore_at(gx, y, gz, block);
                }
                if matches!(block, Block::STONE | Block::DEEPSTONE | Block::BASALT) {
                    let vein = hash3(
                        gx.div_euclid(3),
                        y.div_euclid(2),
                        gz.div_euclid(3),
                        self.seed ^ 0x8f1b_bcdc,
                    );
                    if y < -16 && vein > 1.0 - 0.0022 * self.options.resource_abundance {
                        block = if hash3(gx, y, gz, self.seed ^ 0x5a17_d3e9) > 0.992 {
                            Block::VEINMETAL_HEART
                        } else {
                            Block::LIVING_VEIN
                        };
                    }
                }
                if matches!(block, Block::STONE | Block::DEEPSTONE | Block::BASALT) {
                    let accent = hash3(
                        gx.div_euclid(3),
                        y.div_euclid(3),
                        gz.div_euclid(3),
                        self.seed ^ 0x73a2_d49b,
                    );
                    if matches!(
                        column.biome,
                        BiomeId::Desert | BiomeId::Beach | BiomeId::Highlands | BiomeId::Savanna
                    ) && y > column.height - 24
                        && accent > 0.58
                    {
                        block = Block::LIMESTONE;
                    } else if matches!(
                        column.biome,
                        BiomeId::Frostpine | BiomeId::Snowfield | BiomeId::Bloomwood | BiomeId::MushroomFen
                    ) && y < column.height - 12
                        && accent < 0.34
                    {
                        block = Block::MOON_SLATE;
                    }
                }
            } else if y <= column.waterline {
                block = if column.temperature < 0.14 && y == column.waterline {
                    Block::ICE
                } else {
                    Block::WATER
                };
            }
            if block != Block::AIR {
                blocks[index(lx, y, lz)] = block;
            }
        }
    }

    fn ore_at(&self, x: i32, y: i32, z: i32, fallback: u16) -> u16 {
        let abundance = self.options.resource_abundance * ORE_MULTIPLIER;
        let cell = hash3(
            x.div_euclid(3),
            y.div_euclid(2),
            z.div_euclid(3),
            self.seed ^ 0x0123_4567,
        );
        let detail = hash3(x, y, z, self.seed ^ 0x89ab_cdef);
        let mut block = fallback;
        if y < 66 && cell > 1.0 - 0.008 * abundance && detail > 0.25 {
            block = Block::COAL_ORE;
        }
        if y < 48 && cell < 0.008 * abundance && detail > 0.3 {
            block = Block::IRON_ORE;
        }
        if y < 54 && (cell - 0.985).abs() < 0.002 * abundance && detail > 0.35 {
            block = Block::COPPER_ORE;
        }
        if y < 8 && (cell - 0.97725).abs() < 0.00125 * abundance && detail > 0.4 {
            block = Block::GOLD_ORE;
        }
        if y < -24 && (cell - 0.97075).abs() < 0.00075 * abundance && detail > 0.5 {
            block = Block::CRYSTAL_ORE;
        }
        block
    }

    pub(crate) fn surface_blocks(&self, column: ColumnSample) -> (u16, u16) {
        match column.biome {
            BiomeId::LumenTrench => (
                Block::MOON_SLATE,
                if hash2(column.height, column.biome as i32, self.seed) > 0.45 {
                    Block::DEEPSTONE
                } else {
                    Block::CLAY
                },
            ),
            BiomeId::DeepOcean | BiomeId::Ocean | BiomeId::River => (
                Block::GRAVEL,
                if hash2(column.height, column.biome as i32, self.seed) > 0.5 {
                    Block::CLAY
                } else {
                    Block::SAND
                },
            ),
            BiomeId::Beach | BiomeId::Desert => (Block::SAND, Block::SAND),
            BiomeId::Badlands => (Block::RED_SAND, Block::SUNBAKED_CLAY),
            BiomeId::Siltfen | BiomeId::MushroomFen => (Block::SWAMP_GRASS, Block::MUD),
            BiomeId::Savanna => (Block::SAVANNA_GRASS, Block::DIRT),
            BiomeId::SugarplumVale => (Block::SUGARPLUM_GRASS, Block::SUGAR_SOIL),
            BiomeId::Glimmerwood => (Block::GLIMMER_GRASS, Block::DIRT),
            BiomeId::SnowcapRange => (Block::SNOWY_GRASS, Block::SNOWCAP_STONE),
            BiomeId::Snowfield => (Block::SNOWY_GRASS, Block::DIRT),
            _ if column.height > 72 && column.temperature < 0.48 => (Block::SNOWY_GRASS, Block::DIRT),
            BiomeId::Volcanic => (Block::BASALT, Block::BASALT),
            BiomeId::Highlands => (
                if column.height > 76 { Block::SNOW } else { Block::STONE },
                Block::STONE,
            ),
            BiomeId::Meadow => (Block::MEADOW_GRASS, Block::DIRT),
            BiomeId::CloudreedGlen => (Block::CLOUDREED_GRASS, Block::DIRT),
            BiomeId::RainveilJungle => (Block::JUNGLE_GRASS, Block::DIRT),
            BiomeId::SakurabloomGrove => (Block::SAKURA_GRASS, Block::DIRT),
            _ => (Block::GRASS, Block::DIRT),
        }
    }

    #[allow(dead_code)]
    fn generate_features(&self, request: &GenerateChunkRequestV2, heights: &[i16], biomes: &[u8], blocks: &mut [u16]) {
        for lz in 0..CHUNK_SIZE {
            for lx in 0..CHUNK_SIZE {
                let gx = request.cx * CHUNK_SIZE as i32 + lx as i32;
                let gz = request.cz * CHUNK_SIZE as i32 + lz as i32;
                let column = lx + lz * CHUNK_SIZE;
                let y = i32::from(heights[column]) + 1;
                if y > 127 || blocks[index(lx, y, lz)] != Block::AIR {
                    continue;
                }
                let roll = hash2(gx, gz, self.seed ^ 0x4a39_b70d);
                let biome = biomes[column];
                let flora = match biome {
                    value if value == BiomeId::Meadow as u8 && roll > 0.72 => {
                        if roll > 0.92 {
                            Block::SUNPETAL
                        } else {
                            Block::TALL_GRASS
                        }
                    }
                    value if value == BiomeId::Desert as u8 && roll > 0.99775 => Block::CACTUS,
                    value if value == BiomeId::SakurabloomGrove as u8 && roll > 0.82 => Block::SAKURA_BLOOM,
                    value if value == BiomeId::Glimmerwood as u8 && roll > 0.78 => {
                        if roll > 0.96 {
                            Block::MOONPETAL
                        } else {
                            Block::STARFERN
                        }
                    }
                    value if value == BiomeId::LumenTrench as u8 && roll > 0.84 => {
                        if roll > 0.97 {
                            Block::ABYSS_BLOOM
                        } else {
                            Block::LUMEN_KELP
                        }
                    }
                    value if value == BiomeId::Ocean as u8 && roll > 0.91 => {
                        if roll > 0.98 {
                            Block::STAR_CORAL
                        } else {
                            Block::TIDEVINE
                        }
                    }
                    _ if roll > 0.86 => Block::TALL_GRASS,
                    _ => Block::AIR,
                };
                if flora != Block::AIR {
                    blocks[index(lx, y, lz)] = flora;
                }
                let tree_roll = hash2(gx, gz, self.seed ^ 0xc13f_a9a9);
                if tree_roll > 0.985 && y + 6 <= 127 && !matches!(biome, 0 | 1 | 2 | 6 | 10 | 14 | 16 | 20) {
                    let (log, leaves) = match biome {
                        value if value == BiomeId::Frostpine as u8 || value == BiomeId::Snowfield as u8 => {
                            (Block::PINE_LOG, Block::PINE_LEAVES)
                        }
                        value if value == BiomeId::Birchlight as u8 => (Block::BIRCH_LOG, Block::BIRCH_LEAVES),
                        value if value == BiomeId::RainveilJungle as u8 => (Block::JUNGLE_LOG, Block::JUNGLE_LEAVES),
                        value if value == BiomeId::SakurabloomGrove as u8 => (Block::SAKURA_LOG, Block::SAKURA_LEAVES),
                        value if value == BiomeId::SugarplumVale as u8 => {
                            (Block::CANDYWOOD_LOG, Block::CANDYWOOD_LEAVES)
                        }
                        value if value == BiomeId::Glimmerwood as u8 => (Block::MOONBOUGH_LOG, Block::MOONBOUGH_LEAVES),
                        value if value == BiomeId::Bloomwood as u8 => (Block::BLOOM_LOG, Block::BLOOM_LEAVES),
                        _ => (Block::WILDWOOD_LOG, Block::WILDWOOD_LEAVES),
                    };
                    for dy in 0..4 {
                        blocks[index(lx, y + dy, lz)] = log;
                    }
                    for dx in -2_i32..=2 {
                        for dz in -2_i32..=2 {
                            for dy in 3..=5 {
                                let tx = lx as i32 + dx;
                                let tz = lz as i32 + dz;
                                if tx >= 0
                                    && tx < CHUNK_SIZE as i32
                                    && tz >= 0
                                    && tz < CHUNK_SIZE as i32
                                    && dx.abs() + dz.abs() + (dy - 4_i32).abs() <= 4
                                {
                                    blocks[index(tx as usize, y + dy, tz as usize)] = leaves;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fn finalize(
        &self,
        blocks: &[u16],
        sections: &mut [u16],
        sky: &mut [i16],
        light_indices: &mut BTreeSet<u32>,
        leaves: &mut BTreeSet<u32>,
    ) {
        let mut indexed_lava_cells = BTreeSet::new();
        for (cell, &block) in blocks.iter().enumerate() {
            if block == Block::AIR {
                continue;
            }
            sections[cell / (COLUMN_COUNT * SECTION_HEIGHT)] += 1;
            let y = MIN_Y + (cell / COLUMN_COUNT) as i32;
            let column = cell % COLUMN_COUNT;
            if blocks_sky(block) {
                sky[column] = y as i16;
            }
            if is_leaf(block) {
                leaves.insert(cell as u32);
            }
            let layer = cell / COLUMN_COUNT;
            let horizontal = cell % COLUMN_COUNT;
            let local_z = horizontal / CHUNK_SIZE;
            let local_x = horizontal % CHUNK_SIZE;
            let is_indexed_light = if block == Block::LAVA {
                let x = local_x as i32;
                let y = MIN_Y + layer as i32;
                let z = local_z as i32;
                indexed_lava_cells.insert((x.div_euclid(4), (y - MIN_Y).div_euclid(3), z.div_euclid(4)))
            } else {
                emission(block) > 0
            };
            if is_indexed_light {
                light_indices.insert(cell as u32);
            }
        }
    }

    fn generate_markers(&self, request: &GenerateChunkRequestV2, heights: &[i16], biomes: &[u8]) -> Vec<MarkerRow> {
        if !self.options.structures {
            return Vec::new();
        }
        let _ = (heights, biomes);
        let mut markers = named_structure_markers(self, request);
        markers.extend(adventure_structure_markers(self, request));
        markers.extend(dragon_lair_markers(self, request));
        markers.extend(legendary_site_markers(self, request));
        markers
    }
}

fn transition_biome(first: BiomeId, second: BiomeId, temperature: f64, moisture: f64) -> BiomeId {
    if first == second {
        return first;
    }
    let cold = matches!(first, BiomeId::Frostpine | BiomeId::Snowfield | BiomeId::Highlands)
        || matches!(second, BiomeId::Frostpine | BiomeId::Snowfield | BiomeId::Highlands);
    let dry = matches!(first, BiomeId::Desert | BiomeId::Badlands | BiomeId::Savanna)
        || matches!(second, BiomeId::Desert | BiomeId::Badlands | BiomeId::Savanna);
    let wet = matches!(first, BiomeId::Siltfen | BiomeId::MushroomFen | BiomeId::RainveilJungle)
        || matches!(
            second,
            BiomeId::Siltfen | BiomeId::MushroomFen | BiomeId::RainveilJungle
        );
    if cold && temperature < 0.48 {
        BiomeId::Frostpine
    } else if dry && (temperature > 0.52 || moisture < 0.42) {
        BiomeId::Savanna
    } else if wet && moisture > 0.56 {
        BiomeId::Wildwood
    } else if moisture > 0.53 {
        BiomeId::Birchlight
    } else {
        BiomeId::Meadow
    }
}

fn index(x: usize, y: i32, z: usize) -> usize {
    x + z * CHUNK_SIZE + (y - MIN_Y) as usize * COLUMN_COUNT
}

fn blocks_sky(block: u16) -> bool {
    // Keep this list byte-for-byte equivalent to `world.ts::blocksSky`: only
    // solid, full-cube, opaque definitions establish the cached sky top.
    // Light dampening is intentionally not a proxy here; authored shapes such
    // as Giant Mooncaps may fully damp light while still exposing the column
    // to the sky-top cache.
    matches!(
        block,
        1..=5
            | 8..=11
            | 13..=17
            | 19
            | 21..=30
            | 31
            | 33..=36
            | 39..=44
            | 50
            | 73
            | 78
            | 79
            | 91
            | 97..=99
            | 102
            | 103
            | 105
            | 106
            | 137..=139
            | 141
            | 157
            | 158
            | 164..=171
            | 176..=180
            | 192..=196
            | 217..=220
            | 246
            | 254..=256
            | 258
            | 259
            | 261
            | 262
            | 268
            | 274..=280
            | 283
            | 285..=289
            | 294..=296
            | 535..=538
            | 546..=550
            | 552
            | 568
            | 597..=600
    )
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

fn emission(block: u16) -> u8 {
    emission_definition(block).map_or(0, |definition| definition.0)
}

fn light_dampening(block: u16) -> u8 {
    match block {
        0
        | 12
        | 32
        | 37
        | 45
        | 60..=63
        | 72
        | 92..=96
        | 109
        | 127
        | 131
        | 133
        | 134
        | 142
        | 143
        | 160..=162
        | 170
        | 172
        | 173
        | 175
        | 190
        | 191
        | 197
        | 198
        | 225
        | 234
        | 240..=242
        | 248
        | 249
        | 251
        | 252
        | 264
        | 265
        | 267
        | 269
        | 281
        | 282
        | 293
        | 551 => 0,
        41 => 2,
        6
        | 7
        | 18
        | 20
        | 28
        | 46..=49
        | 51..=59
        | 64..=71
        | 74..=77
        | 80..=90
        | 100
        | 101
        | 104
        | 107
        | 108
        | 110..=126
        | 128..=130
        | 132
        | 135
        | 136
        | 140
        | 144..=156
        | 159
        | 163
        | 174
        | 181..=189
        | 199..=210
        | 221..=224
        | 226..=233
        | 243..=245
        | 247
        | 250
        | 253
        | 257
        | 260
        | 263
        | 266
        | 270..=273
        | 284
        | 290..=292
        | 539
        | 540
        | 541
        | 544
        | 565..=567
        | 569..=572 => 1,
        _ => 15,
    }
}

fn emission_definition(block: u16) -> Option<(u8, [f64; 3])> {
    let value = match block {
        13 => (15, [1.0, 0.78, 0.3]),
        32 | 60..=63 | 191 => (14, [1.0, 0.58, 0.24]),
        35 => (9, [0.34, 0.95, 1.0]),
        37 => (15, [1.0, 0.28, 0.08]),
        44 | 171 => (13, [0.34, 0.95, 1.0]),
        79 => (6, [0.42, 0.72, 0.46]),
        109 | 160 | 162 | 262 => (4, [0.65, 0.48, 1.0]),
        110 | 161 | 163 | 264 | 271 => (5, [0.34, 1.0, 0.8]),
        111 => (6, [1.0, 0.36, 0.54]),
        112 => (7, [0.65, 0.48, 1.0]),
        127 | 234 => (7, [0.65, 0.48, 1.0]),
        133 => (7, [1.0, 0.58, 0.24]),
        134 => (9, [1.0, 0.58, 0.24]),
        159 => (2, [0.34, 0.74, 0.58]),
        167 => (15, [1.0, 0.78, 0.3]),
        174 => (10, [0.35, 0.78, 1.0]),
        175 => (8, [0.34, 0.95, 1.0]),
        176..=179 => (7, [0.34, 0.95, 1.0]),
        180 => (10, [0.65, 0.48, 1.0]),
        193 => (6, [0.34, 0.95, 1.0]),
        195 => (5, [1.0, 0.78, 0.3]),
        196 => (5, [0.62, 0.8, 1.0]),
        197 => (11, [1.0, 0.78, 0.3]),
        198 => (11, [0.62, 0.8, 1.0]),
        201 => (10, [0.76, 1.0, 0.28]),
        225 => (8, [0.65, 0.48, 1.0]),
        242 => (10, [0.34, 0.95, 1.0]),
        251 => (9, [0.38, 0.82, 0.78]),
        258 => (4, [0.47, 1.0, 0.55]),
        265 => (7, [1.0, 0.78, 0.3]),
        267 => (3, [0.47, 1.0, 0.55]),
        279 => (10, [0.42, 0.56, 1.0]),
        281 => (8, [0.48, 0.66, 1.0]),
        285 => (10, [1.0, 0.32, 0.12]),
        288 => (4, [0.48, 0.82, 0.64]),
        289 => (11, [0.48, 0.92, 0.72]),
        293 => (8, [1.0, 0.78, 0.3]),
        _ => return None,
    };
    Some(value)
}

fn emission_packed(block: u16) -> u16 {
    let Some((level, color)) = emission_definition(block) else {
        return 0;
    };
    let level = f64::from(level);
    let red = (level * color[0]).round().clamp(0.0, 15.0) as u16;
    let green = (level * color[1]).round().clamp(0.0, 15.0) as u16;
    let blue = (level * color[2]).round().clamp(0.0, 15.0) as u16;
    blue | (green << 4) | (red << 8)
}

fn initialize_light(blocks: &[u16], light: &mut [u16]) {
    let mut queue = VecDeque::new();
    let mut queued = vec![false; CELL_COUNT];
    for z in 0..CHUNK_SIZE {
        for x in 0..CHUNK_SIZE {
            let mut sky = 15_u16;
            for y in (MIN_Y..=127).rev() {
                let cell = index(x, y, z);
                let dampening = light_dampening(blocks[cell]);
                if dampening >= 15 {
                    sky = 0;
                } else if dampening > 0 {
                    sky = sky.saturating_sub(u16::from(dampening));
                }
                light[cell] = emission_packed(blocks[cell]) | (sky << 12);
                if light[cell] > 0 {
                    queue.push_back(cell);
                    queued[cell] = true;
                }
            }
        }
    }
    while let Some(cell) = queue.pop_front() {
        queued[cell] = false;
        let source = light[cell];
        if source == 0 {
            continue;
        }
        let layer = cell / COLUMN_COUNT;
        let horizontal = cell % COLUMN_COUNT;
        let z = horizontal / CHUNK_SIZE;
        let x = horizontal % CHUNK_SIZE;
        let mut neighbors = [usize::MAX; 6];
        if x > 0 {
            neighbors[0] = cell - 1;
        }
        if x + 1 < CHUNK_SIZE {
            neighbors[1] = cell + 1;
        }
        if z > 0 {
            neighbors[2] = cell - CHUNK_SIZE;
        }
        if z + 1 < CHUNK_SIZE {
            neighbors[3] = cell + CHUNK_SIZE;
        }
        if layer > 0 {
            neighbors[4] = cell - COLUMN_COUNT;
        }
        if layer + 1 < WORLD_HEIGHT as usize {
            neighbors[5] = cell + COLUMN_COUNT;
        }
        for neighbor in neighbors.into_iter().filter(|&value| value != usize::MAX) {
            let dampening = light_dampening(blocks[neighbor]);
            let attenuation = if dampening >= 15 { 15 } else { 1 + dampening };
            let mut next = light[neighbor];
            for channel in 0..4 {
                let shift = channel * 4;
                let source_level = (source >> shift) & 0xf;
                let candidate = source_level.saturating_sub(u16::from(attenuation));
                let current = (next >> shift) & 0xf;
                if candidate > current {
                    next = (next & !(0xf << shift)) | (candidate << shift);
                }
            }
            if next != light[neighbor] {
                light[neighbor] = next;
                if !queued[neighbor] {
                    queued[neighbor] = true;
                    queue.push_back(neighbor);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::fixture_request;

    fn cache_sample(height: i32) -> ColumnSample {
        ColumnSample {
            height,
            waterline: SEA_LEVEL,
            biome: BiomeId::Meadow,
            temperature: 0.5,
            moisture: 0.5,
            continental: 0.0,
            river: 0.0,
            mountain: 0.0,
        }
    }

    #[test]
    fn column_sample_cache_preserves_send_and_sync() {
        assert_send_and_sync::<TerrainGeneratorV18>();
    }

    #[test]
    fn column_sample_cache_memoizes_exact_coordinates() {
        let generator = TerrainGeneratorV18::new("column-cache-hit", GenerationOptions::default());
        let expected = generator.sample_column_uncached(-117, 293);

        assert_eq!(generator.sample_column(-117, 293), expected);
        assert_eq!(
            generator
                .column_sample_cache
                .lock()
                .expect("column sample cache mutex poisoned")
                .entries
                .len(),
            1
        );
        assert_eq!(
            generator
                .column_sample_cache
                .lock()
                .expect("column sample cache mutex poisoned")
                .hits,
            0
        );

        assert_eq!(generator.sample_column(-117, 293), expected);
        let cache = generator
            .column_sample_cache
            .lock()
            .expect("column sample cache mutex poisoned");
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.hits, 1);
    }

    #[test]
    fn column_sample_cache_has_a_hard_fifo_bound() {
        let mut cache = ColumnSampleCache::default();
        for x in 0..COLUMN_SAMPLE_CACHE_CAPACITY {
            cache.insert(x as i32, 0, cache_sample(x as i32));
        }
        assert_eq!(cache.entries.len(), COLUMN_SAMPLE_CACHE_CAPACITY);
        assert_eq!(cache.insertion_order.len(), COLUMN_SAMPLE_CACHE_CAPACITY);

        cache.insert(COLUMN_SAMPLE_CACHE_CAPACITY as i32, 0, cache_sample(i32::MAX));

        assert_eq!(cache.entries.len(), COLUMN_SAMPLE_CACHE_CAPACITY);
        assert_eq!(cache.insertion_order.len(), COLUMN_SAMPLE_CACHE_CAPACITY);
        assert!(!cache.entries.contains_key(&(0, 0)));
        assert!(cache.entries.contains_key(&(1, 0)));
        assert!(cache.entries.contains_key(&(COLUMN_SAMPLE_CACHE_CAPACITY as i32, 0)));
        assert_eq!(cache.insertion_order.front(), Some(&(1, 0)));
    }

    #[test]
    fn column_sample_cache_is_empty_on_generator_clone() {
        let generator = TerrainGeneratorV18::new("column-cache-clone", GenerationOptions::default());
        let expected = generator.sample_column(41, -73);
        assert_eq!(
            generator
                .column_sample_cache
                .lock()
                .expect("column sample cache mutex poisoned")
                .entries
                .len(),
            1
        );

        let clone = generator.clone();
        assert!(
            clone
                .column_sample_cache
                .lock()
                .expect("column sample cache mutex poisoned")
                .entries
                .is_empty()
        );
        assert_eq!(clone.sample_column(41, -73), expected);
        assert_eq!(
            clone
                .column_sample_cache
                .lock()
                .expect("column sample cache mutex poisoned")
                .entries
                .len(),
            1
        );
        assert_eq!(
            generator
                .column_sample_cache
                .lock()
                .expect("column sample cache mutex poisoned")
                .entries
                .len(),
            1
        );
    }

    #[test]
    fn column_sample_cache_preserves_whole_generation_bytes() {
        let request = fixture_request("column-cache-byte-parity", -31, 47, 1);
        let cached_generator = TerrainGeneratorV18::from_request(&request).unwrap();
        let uncached_generator = TerrainGeneratorV18::from_request(&request).unwrap();
        uncached_generator
            .column_sample_cache
            .lock()
            .expect("column sample cache mutex poisoned")
            .disable();

        let cached = cached_generator.generate(&request, || false).unwrap();
        let uncached = uncached_generator.generate(&request, || false).unwrap();

        assert_eq!(cached, uncached);
        assert!(
            uncached_generator
                .column_sample_cache
                .lock()
                .expect("column sample cache mutex poisoned")
                .entries
                .is_empty()
        );
    }

    #[test]
    fn generation_is_repeatable_for_positive_and_negative_chunks() {
        for &(seed, cx, cz) in &[
            ("WILDERNESS", -8, -1),
            ("large-seed-9007199254740991", 77, -93),
            ("unicode-🌿", -250, 251),
        ] {
            let request = fixture_request(seed, cx, cz, 1);
            let generator = TerrainGeneratorV18::from_request(&request).unwrap();
            let first = generator.generate(&request, || false).unwrap();
            let second = generator.generate(&request, || false).unwrap();
            assert_eq!(first, second);
            assert_eq!(first.blocks.len(), CELL_COUNT);
            assert!(first.section_block_counts.iter().any(|&count| count > 0));
        }
    }

    #[test]
    fn oceans_share_one_water_datum_and_edits_win_last() {
        let mut request = fixture_request("ocean", -88, 94, 1);
        request.edits = vec![(0, Block::WATER), ((CELL_COUNT - 1) as u32, Block::STONE)];
        request.request_hash = request.canonical_hash().to_hex();
        let chunk = TerrainGeneratorV18::from_request(&request)
            .unwrap()
            .generate(&request, || false)
            .unwrap();
        assert_eq!(chunk.blocks[0], Block::WATER);
        assert_eq!(chunk.blocks[CELL_COUNT - 1], Block::STONE);
    }

    #[test]
    fn cancellation_is_checked_per_column_slice() {
        let request = fixture_request("cancel", 1, 1, 1);
        let generator = TerrainGeneratorV18::from_request(&request).unwrap();
        assert_eq!(generator.generate(&request, || true), Err(GenerationError::Cancelled));
    }

    #[test]
    fn corpus_is_order_independent_and_stream_metadata_is_exact() {
        let mut forward = Vec::new();
        for case in 0..128_i32 {
            let cx = case.wrapping_mul(7_919).rem_euclid(4_093) - 2_046;
            let cz = 2_046 - case.wrapping_mul(3_571).rem_euclid(4_093);
            let request = fixture_request(&format!("corpus-{}", case.rem_euclid(17)), cx, cz, case as u32 + 1);
            let chunk = TerrainGeneratorV18::from_request(&request)
                .unwrap()
                .generate(&request, || false)
                .unwrap();
            assert_eq!(chunk.heightmap.len(), COLUMN_COUNT);
            assert_eq!(chunk.biomes.len(), COLUMN_COUNT);
            assert_eq!(chunk.blocks.len(), CELL_COUNT);
            assert_eq!(
                chunk
                    .section_block_counts
                    .iter()
                    .map(|&value| usize::from(value))
                    .sum::<usize>(),
                chunk.blocks.iter().filter(|&&block| block != Block::AIR).count()
            );
            assert!(chunk.light_indices.windows(2).all(|pair| pair[0] < pair[1]));
            assert!(chunk.leaf_indices.windows(2).all(|pair| pair[0] < pair[1]));
            forward.push(chunk.chunk_hash);
        }
        let mut reverse = Vec::new();
        for case in (0..128_i32).rev() {
            let cx = case.wrapping_mul(7_919).rem_euclid(4_093) - 2_046;
            let cz = 2_046 - case.wrapping_mul(3_571).rem_euclid(4_093);
            let request = fixture_request(&format!("corpus-{}", case.rem_euclid(17)), cx, cz, case as u32 + 1);
            reverse.push(
                TerrainGeneratorV18::from_request(&request)
                    .unwrap()
                    .generate(&request, || false)
                    .unwrap()
                    .chunk_hash,
            );
        }
        reverse.reverse();
        assert_eq!(forward, reverse);
    }

    #[test]
    fn legacy_beach_flora_matches_the_typescript_oracle_vector() {
        let mut request = fixture_request("HEARTHROADS", -130, -191, 132);
        request.generation_options_json = r#"{"biomeScale":1.35,"caveFrequency":1,"enabledFactions":["hobbits","goblins","atlantians","sugarcourt","wood-elves","dwarves"],"largeTownFrequency":"balanced","profile":"legacy-v14","resourceAbundance":1,"roadCoverage":"regional","settlementClustering":"regional","settlementDensity":1,"settlementPattern":"heartlands-v2","structures":true}"#.into();
        request.edits = vec![(0, 7), (24_576, 13), (49_151, 3)];
        request.request_hash = request.canonical_hash().to_hex();

        let chunk = TerrainGeneratorV18::from_request(&request)
            .unwrap()
            .generate(&request, || false)
            .unwrap();
        let saltbrush = chunk
            .blocks
            .iter()
            .enumerate()
            .filter_map(|(index, &block)| (block == Block::SALTBRUSH).then_some(index))
            .collect::<Vec<_>>();
        let coast_aster = chunk
            .blocks
            .iter()
            .enumerate()
            .filter_map(|(index, &block)| (block == Block::COAST_ASTER).then_some(index))
            .collect::<Vec<_>>();

        assert_eq!(saltbrush, vec![25_517, 25_551, 25_558, 25_596]);
        assert_eq!(coast_aster, vec![25_116, 25_298, 25_535]);
    }

    #[test]
    fn high_resource_abundance_preserves_typescript_ore_precedence() {
        let request = fixture_request("RESOURCE-OPTIONS", -1, -1, 138);
        let generator = TerrainGeneratorV18::new(
            "RESOURCE-OPTIONS",
            GenerationOptions {
                resource_abundance: 4.0,
                ..GenerationOptions::default()
            },
        );

        // The TypeScript oracle evaluates ore branches independently. At the
        // maximum supported abundance, later Copper and Gold matches therefore
        // replace an earlier Coal match when their threshold windows overlap.
        assert_eq!(generator.ore_at(-13, -60, -9, Block::BASALT), Block::COPPER_ORE);

        let chunk = generator.generate(&request, || false).unwrap();
        let count = |block| chunk.blocks.iter().filter(|&&value| value == block).count();
        assert_eq!(count(Block::COAL_ORE), 62);
        assert_eq!(count(Block::IRON_ORE), 135);
        assert_eq!(count(Block::COPPER_ORE), 70);
        assert_eq!(count(Block::GOLD_ORE), 5);
        assert_eq!(count(Block::CRYSTAL_ORE), 0);
        assert_eq!(count(Block::LIVING_VEIN), 56);
        assert_eq!(count(Block::VEINMETAL_HEART), 1);
    }

    #[test]
    fn legacy_biome_cascade_matches_the_typescript_oracle_vectors() {
        let options = GenerationOptions {
            profile: GenerationProfile::LegacyV14,
            ..GenerationOptions::default()
        };
        let generator = TerrainGeneratorV18::new("LOCATOR-LEGACY", options);
        let vectors = [
            (
                -24_000,
                -19_326,
                ColumnSample {
                    height: 40,
                    waterline: 32,
                    biome: BiomeId::SugarplumVale,
                    temperature: 0.418_172_342_784_653_9,
                    moisture: 0.549_661_775_411_619_1,
                    continental: 0.160_938_599_898_645_26,
                    river: 0.0,
                    mountain: 0.0,
                },
            ),
            (
                -24_000,
                -9_281,
                ColumnSample {
                    height: 36,
                    waterline: 32,
                    biome: BiomeId::Glimmerwood,
                    temperature: 0.512_737_615_583_777_8,
                    moisture: 0.740_960_606_958_747_7,
                    continental: 0.101_409_472_106_043_17,
                    river: 0.0,
                    mountain: 0.0,
                },
            ),
            (
                -20_966,
                1_748,
                ColumnSample {
                    height: 37,
                    waterline: 32,
                    biome: BiomeId::Badlands,
                    temperature: 0.629_809_537_339_318_9,
                    moisture: 0.192_928_387_937_938_98,
                    continental: 0.085_255_501_581_667_02,
                    river: 0.0,
                    mountain: 0.0,
                },
            ),
            (
                -24_000,
                21_797,
                ColumnSample {
                    height: 45,
                    waterline: 32,
                    biome: BiomeId::CloudreedGlen,
                    temperature: 0.531_260_340_054_715_3,
                    moisture: 0.680_788_556_027_849_9,
                    continental: 0.358_009_160_706_987_6,
                    river: 0.0,
                    mountain: 0.0,
                },
            ),
            (
                -24_000,
                -9_158,
                ColumnSample {
                    height: 37,
                    waterline: 32,
                    biome: BiomeId::RainveilJungle,
                    temperature: 0.582_587_794_438_985_2,
                    moisture: 0.789_849_271_697_562_2,
                    continental: 0.274_936_144_092_677_36,
                    river: 0.0,
                    mountain: 0.0,
                },
            ),
            (
                -24_000,
                -19_490,
                ColumnSample {
                    height: 36,
                    waterline: 32,
                    biome: BiomeId::SakurabloomGrove,
                    temperature: 0.377_629_184_584_261_1,
                    moisture: 0.662_627_323_516_613_1,
                    continental: 0.045_697_793_378_344_3,
                    river: 0.0,
                    mountain: 0.0,
                },
            ),
        ];
        for (x, z, expected) in vectors {
            assert_eq!(
                generator.sample_column(x, z),
                expected,
                "legacy sample ({x}, {z}) drifted"
            );
        }
    }
}
