use crate::contract::{BiomeId, Block, MarkerRow};
use crate::generator::TerrainGeneratorV18;
use blockwild_types::hash2;
use std::collections::BTreeMap;

const REGION_BLOCKS: i32 = 44 * 16;
const MAX_HORIZONTAL_RADIUS: i32 = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DragonType {
    Fire,
    Ice,
    Steel,
    Gold,
    Silver,
}

impl DragonType {
    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::Fire => "fire",
            Self::Ice => "ice",
            Self::Steel => "steel",
            Self::Gold => "gold",
            Self::Silver => "silver",
        }
    }

    pub(crate) fn from_id(value: &str) -> Option<Self> {
        [Self::Fire, Self::Ice, Self::Steel, Self::Gold, Self::Silver]
            .into_iter()
            .find(|dragon_type| dragon_type.id() == value)
    }

    fn palette(self) -> (u16, u16) {
        match self {
            Self::Fire => (Block::CHARRED_DRAGONSTONE, Block::FIRE_DRAGON_EGG_BLOCK),
            Self::Ice => (Block::RIME_DRAGONSTONE, Block::ICE_DRAGON_EGG_BLOCK),
            Self::Steel => (Block::RIVETED_DRAGONSTONE, Block::STEEL_DRAGON_EGG_BLOCK),
            Self::Gold => (Block::GILDED_DRAGONSTONE, Block::GOLD_DRAGON_EGG_BLOCK),
            Self::Silver => (Block::ARGENT_DRAGONSTONE, Block::SILVER_DRAGON_EGG_BLOCK),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DragonSex {
    Female,
    Male,
}

impl DragonSex {
    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::Female => "female",
            Self::Male => "male",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Candidate {
    pub(crate) dragon_type: DragonType,
    pub(crate) stage: u8,
    pub(crate) sex: DragonSex,
    pub(crate) region_x: i32,
    pub(crate) region_z: i32,
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) z: i32,
    radius_x: i32,
    radius_z: i32,
}

impl Candidate {
    pub(crate) fn id(self) -> String {
        format!(
            "dragon-lair:{}:{}:{}",
            self.dragon_type.id(),
            self.region_x,
            self.region_z
        )
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct DragonPlacement {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub block: u16,
}

#[derive(Clone, Debug)]
pub(crate) struct DragonMarker {
    pub x: i32,
    pub z: i32,
    pub row: MarkerRow,
}

#[derive(Clone, Debug)]
pub(crate) struct DragonPlan {
    pub placements: Vec<DragonPlacement>,
    pub markers: Vec<DragonMarker>,
}

fn seed_hash(source: &str) -> u32 {
    source.encode_utf16().fold(2_166_136_261_u32, |value, unit| {
        (value ^ u32::from(unit)).wrapping_mul(16_777_619)
    })
}

fn hash_unit(seed: &str, salt: &str) -> f64 {
    let mut value = seed_hash(&format!("{seed}|{salt}"));
    value = (value ^ (value >> 15)).wrapping_mul(2_246_822_519);
    value = (value ^ (value >> 13)).wrapping_mul(3_266_489_917);
    f64::from(value ^ (value >> 16)) / 4_294_967_296.0
}

fn js_round(value: f64) -> i32 {
    (value + 0.5).floor() as i32
}

fn candidate(seed: &str, region_x: i32, region_z: i32, generator: &TerrainGeneratorV18) -> Option<Candidate> {
    if hash_unit(seed, &format!("dragon-lair-present:{region_x},{region_z}")) < 0.29 {
        return None;
    }
    let margin = 112;
    let span = REGION_BLOCKS - margin * 2;
    let x = region_x * REGION_BLOCKS
        + margin
        + (hash_unit(seed, &format!("dragon-lair-x:{region_x},{region_z}")) * f64::from(span)).floor() as i32;
    let z = region_z * REGION_BLOCKS
        + margin
        + (hash_unit(seed, &format!("dragon-lair-z:{region_x},{region_z}")) * f64::from(span)).floor() as i32;
    let surface_y = generator.sample_column(x, z).height;
    let y = (surface_y - 22)
        .min(-18 - (hash_unit(seed, &format!("dragon-lair-y:{region_x},{region_z}")) * 22.0).floor() as i32)
        .clamp(-46, -16);
    let roll = hash_unit(seed, &format!("dragon-type:{region_x},{region_z}"));
    let dragon_type = if roll < 0.31 {
        DragonType::Fire
    } else if roll < 0.62 {
        DragonType::Ice
    } else if roll < 0.93 {
        DragonType::Steel
    } else if roll < 0.965 {
        DragonType::Gold
    } else {
        DragonType::Silver
    };
    let stage = if hash_unit(seed, &format!("dragon-lair-stage:{region_x},{region_z}")) < 0.22 {
        5
    } else {
        4
    };
    let sex = if hash_unit(seed, &format!("dragon-lair-sex:{region_x},{region_z}")) < 0.5 {
        DragonSex::Female
    } else {
        DragonSex::Male
    };
    Some(Candidate {
        dragon_type,
        stage,
        sex,
        region_x,
        region_z,
        x,
        y,
        z,
        radius_x: if stage == 5 { 32 } else { 25 },
        radius_z: if stage == 5 { 28 } else { 22 },
    })
}

#[derive(Clone, Debug)]
pub(crate) enum LairCandidate {
    Terrestrial(Candidate),
    Sea(SeaNest),
}

impl LairCandidate {
    pub(crate) fn id(&self) -> String {
        match self {
            Self::Terrestrial(value) => value.id(),
            Self::Sea(value) => value.id.clone(),
        }
    }
    pub(crate) fn dragon_type(&self) -> &'static str {
        match self {
            Self::Terrestrial(value) => value.dragon_type.id(),
            Self::Sea(_) => "sea",
        }
    }
    pub(crate) fn stage(&self) -> u8 {
        match self {
            Self::Terrestrial(value) => value.stage,
            Self::Sea(value) => u8::try_from(value.stage).expect("bounded sea stage"),
        }
    }
    pub(crate) fn sex(&self) -> &'static str {
        match self {
            Self::Terrestrial(value) => value.sex.id(),
            Self::Sea(value) => {
                if value.female {
                    "female"
                } else {
                    "male"
                }
            }
        }
    }
    pub(crate) fn position(&self) -> (i32, i32, i32) {
        match self {
            Self::Terrestrial(value) => (value.x, value.y, value.z),
            Self::Sea(value) => (value.x, value.y, value.z),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct LocatedLair {
    pub(crate) candidate: LairCandidate,
    pub(crate) distance_squared: u64,
}

pub(crate) struct LairQuery<'a> {
    pub(crate) origin_x_millis: i64,
    pub(crate) origin_z_millis: i64,
    pub(crate) dragon_type: &'a str,
    pub(crate) minimum_stage: u8,
    pub(crate) excluded_ids: &'a std::collections::BTreeSet<String>,
    pub(crate) maximum_region_radius: u16,
}

fn later_shell_cannot_win(radius: i32, region_blocks: i32, distance_squared: u64) -> bool {
    let minimum = (i128::from(radius) * i128::from(region_blocks) - i128::from(region_blocks * 3 / 2)) * 1_000;
    minimum > 0 && u64::try_from(minimum * minimum).expect("bounded lair shell") > distance_squared
}

pub(crate) fn query_nearest_lair(
    seed: &str,
    generator: &TerrainGeneratorV18,
    query: LairQuery<'_>,
) -> Option<LocatedLair> {
    let sea = query.dragon_type == "sea";
    let terrestrial_type = if sea {
        None
    } else {
        Some(DragonType::from_id(query.dragon_type)?)
    };
    let region_blocks = if sea { 48 * 16 } else { REGION_BLOCKS };
    let origin_region_x = i32::try_from(query.origin_x_millis.div_euclid(i64::from(region_blocks) * 1_000))
        .expect("bounded lair origin region");
    let origin_region_z = i32::try_from(query.origin_z_millis.div_euclid(i64::from(region_blocks) * 1_000))
        .expect("bounded lair origin region");
    let mut best: Option<LocatedLair> = None;
    for radius in 0..=i32::from(query.maximum_region_radius.min(64)) {
        for dx in -radius..=radius {
            for dz in -radius..=radius {
                if radius > 0 && dx.abs().max(dz.abs()) != radius {
                    continue;
                }
                let candidate = if sea {
                    let Some(probe) = sea_nest(seed, origin_region_x + dx, origin_region_z + dz, -48) else {
                        continue;
                    };
                    let column = generator.sample_column(probe.x, probe.z);
                    if !matches!(column.biome, BiomeId::DeepOcean | BiomeId::LumenTrench) || column.height > 22 {
                        continue;
                    }
                    let Some(value) = sea_nest(seed, origin_region_x + dx, origin_region_z + dz, column.height) else {
                        continue;
                    };
                    LairCandidate::Sea(value)
                } else {
                    let Some(value) = candidate(seed, origin_region_x + dx, origin_region_z + dz, generator) else {
                        continue;
                    };
                    if Some(value.dragon_type) != terrestrial_type {
                        continue;
                    }
                    LairCandidate::Terrestrial(value)
                };
                if candidate.stage() < query.minimum_stage || query.excluded_ids.contains(&candidate.id()) {
                    continue;
                }
                let (x, _, z) = candidate.position();
                let delta_x = i64::from(x) * 1_000 - query.origin_x_millis;
                let delta_z = i64::from(z) * 1_000 - query.origin_z_millis;
                let distance_squared = u64::try_from(
                    delta_x
                        .checked_mul(delta_x)
                        .and_then(|x| delta_z.checked_mul(delta_z).and_then(|z| x.checked_add(z)))
                        .expect("bounded lair query distance arithmetic"),
                )
                .expect("bounded lair query distance");
                let replace = best.as_ref().is_none_or(|current| {
                    distance_squared < current.distance_squared
                        || distance_squared == current.distance_squared && candidate.id() < current.candidate.id()
                });
                if replace {
                    best = Some(LocatedLair {
                        candidate,
                        distance_squared,
                    });
                }
            }
        }
        if best
            .as_ref()
            .is_some_and(|value| later_shell_cannot_win(radius, region_blocks, value.distance_squared))
        {
            break;
        }
    }
    best
}

#[derive(Clone, Copy)]
struct Chamber {
    name: &'static str,
    x: i32,
    y: i32,
    z: i32,
    rx: i32,
    ry: i32,
    rz: i32,
}

fn plan_candidate(seed: &str, candidate: Candidate) -> DragonPlan {
    let id = candidate.id();
    let (wall, egg_block) = candidate.dragon_type.palette();
    let type_id = candidate.dragon_type.id();
    let (main_rx, main_ry, main_rz) = if candidate.stage == 5 {
        (20, 12, 19)
    } else {
        (16, 9, 15)
    };
    let chambers = if candidate.stage == 5 {
        [
            Chamber {
                name: "great-vault",
                x: candidate.x,
                y: candidate.y,
                z: candidate.z,
                rx: 20,
                ry: 12,
                rz: 19,
            },
            Chamber {
                name: "treasury",
                x: candidate.x - 22,
                y: candidate.y - 5,
                z: candidate.z,
                rx: 10,
                ry: 7,
                rz: 10,
            },
            Chamber {
                name: "rookery",
                x: candidate.x,
                y: candidate.y - 5,
                z: candidate.z + 18,
                rx: 11,
                ry: 7,
                rz: 10,
            },
            Chamber {
                name: "entrance",
                x: candidate.x,
                y: candidate.y - 6,
                z: candidate.z - 18,
                rx: 9,
                ry: 6,
                rz: 10,
            },
        ]
    } else {
        [
            Chamber {
                name: "great-vault",
                x: candidate.x,
                y: candidate.y,
                z: candidate.z,
                rx: 16,
                ry: 9,
                rz: 15,
            },
            Chamber {
                name: "treasury",
                x: candidate.x - 18,
                y: candidate.y - 4,
                z: candidate.z,
                rx: 7,
                ry: 5,
                rz: 7,
            },
            Chamber {
                name: "rookery",
                x: candidate.x,
                y: candidate.y - 4,
                z: candidate.z + 15,
                rx: 8,
                ry: 5,
                rz: 7,
            },
            Chamber {
                name: "entrance",
                x: candidate.x,
                y: candidate.y - 4,
                z: candidate.z - 15,
                rx: 7,
                ry: 5,
                rz: 7,
            },
        ]
    };
    let mut cavern = BTreeMap::<(i32, i32, i32), (f64, &'static str)>::new();
    for chamber in chambers {
        for dy in -chamber.ry..=chamber.ry {
            for dz in -chamber.rz..=chamber.rz {
                for dx in -chamber.rx..=chamber.rx {
                    let distance = (f64::from(dx) / f64::from(chamber.rx)).powi(2)
                        + (f64::from(dy) / f64::from(chamber.ry)).powi(2)
                        + (f64::from(dz) / f64::from(chamber.rz)).powi(2);
                    if distance > 1.0 {
                        continue;
                    }
                    let key = (chamber.x + dx, chamber.y + dy, chamber.z + dz);
                    if cavern.get(&key).is_none_or(|existing| distance < existing.0) {
                        cavern.insert(key, (distance, chamber.name));
                    }
                }
            }
        }
    }
    let mut blocks = BTreeMap::<(i32, i32, i32), u16>::new();
    for ((x, y, z), (distance, _chamber)) in cavern {
        let shell_noise = (hash_unit(
            seed,
            &format!("lair-shell:{},{}:{x},{y},{z}", candidate.region_x, candidate.region_z),
        ) - 0.5)
            * 0.055;
        blocks.insert(
            (x, y, z),
            if distance + shell_noise >= 0.72 {
                wall
            } else {
                Block::AIR
            },
        );
    }

    let floor_y = candidate.y - main_ry + 2;
    let treasury = chambers[1];
    let rookery = chambers[2];
    let floor_rx = treasury.rx - 1;
    let floor_rz = treasury.rz - 1;
    let mut floor_cells = Vec::<(i32, i32, f64)>::new();
    for dz in -floor_rz..=floor_rz {
        for dx in -floor_rx..=floor_rx {
            let distance =
                (f64::from(dx) / f64::from(floor_rx)).powi(2) + (f64::from(dz) / f64::from(floor_rz)).powi(2);
            if distance > 1.0 {
                continue;
            }
            let x = treasury.x + dx;
            let z = treasury.z + dz;
            floor_cells.push((x, z, distance));
            blocks.insert((x, floor_y - 1, z), wall);
            blocks.insert((x, floor_y, z), Block::AIR);
            blocks.insert((x, floor_y + 1, z), Block::AIR);
            blocks.insert((x, floor_y + 2, z), Block::AIR);
        }
    }
    let treasure_count = if candidate.stage == 5 { 58 } else { 34 };
    let mut hoard = floor_cells
        .into_iter()
        .filter(|(x, z, distance)| *distance <= 0.78 && (x + z) & 1 == 0)
        .collect::<Vec<_>>();
    hoard.sort_by(|left, right| {
        hash_unit(
            seed,
            &format!(
                "treasure-cell:{},{}:{},{}",
                candidate.region_x, candidate.region_z, left.0, left.1
            ),
        )
        .total_cmp(&hash_unit(
            seed,
            &format!(
                "treasure-cell:{},{}:{},{}",
                candidate.region_x, candidate.region_z, right.0, right.1
            ),
        ))
        .then_with(|| left.1.cmp(&right.1))
        .then_with(|| left.0.cmp(&right.0))
    });
    for (index, &(x, z, _)) in hoard.iter().take(treasure_count).enumerate() {
        blocks.insert(
            (x, floor_y, z),
            if index < if candidate.stage == 5 { 14 } else { 8 } {
                Block::GOLD_BLOCK
            } else {
                Block::GOLD_PILE
            },
        );
    }

    let pillar_count = match candidate.dragon_type {
        DragonType::Steel => 10,
        DragonType::Gold => 9,
        DragonType::Silver => 7,
        DragonType::Ice => 8,
        DragonType::Fire => 6,
    };
    let base_angle = hash_unit(
        seed,
        &format!("lair-rib-angle:{},{}", candidate.region_x, candidate.region_z),
    ) * 0.4;
    for index in 0..pillar_count {
        let angle = f64::from(index) / f64::from(pillar_count) * std::f64::consts::TAU + base_angle;
        let x = candidate.x + js_round(angle.cos() * f64::from(main_rx - 4));
        let z = candidate.z + js_round(angle.sin() * f64::from(main_rz - 4));
        let height = 2 + (index + i32::from(candidate.stage)) % 4;
        for dy in 0..height {
            blocks.insert(
                (x, floor_y + dy, z),
                if candidate.dragon_type == DragonType::Ice {
                    Block::ICE
                } else {
                    wall
                },
            );
        }
    }

    let mut markers = Vec::new();
    let chest_count = if candidate.stage == 5 { 6 } else { 4 };
    let tome_keys: [&str; 2] = match candidate.dragon_type {
        DragonType::Fire => ["tome-flame-jet", "tome-blinkstep"],
        DragonType::Ice => ["tome-frost-lance", "tome-arcane-ward"],
        DragonType::Gold => ["tome-healing-light", "tome-flame-jet"],
        DragonType::Silver => ["tome-arcane-ward", "tome-frost-lance"],
        DragonType::Steel => ["tome-steel-spear", "tome-healing-light"],
    };
    for index in 0..chest_count {
        let angle = f64::from(index) / f64::from(chest_count) * std::f64::consts::TAU
            + hash_unit(
                seed,
                &format!("chest-angle:{},{}", candidate.region_x, candidate.region_z),
            );
        let radius = 3.max(treasury.rx - 3);
        let x = treasury.x + js_round(angle.cos() * f64::from(radius));
        let z = treasury.z + js_round(angle.sin() * f64::from(radius));
        blocks.insert((x, floor_y, z), Block::CHEST);
        let rare = hash_unit(
            seed,
            &format!("chest-rare:{},{}:{index}", candidate.region_x, candidate.region_z),
        );
        let gold = 5
            + (hash_unit(seed, &format!("chest-gold:{index}")) * f64::from(if candidate.stage == 5 { 18 } else { 10 }))
                .floor() as u32;
        let crystal = 2 + (hash_unit(seed, &format!("chest-crystal:{index}")) * 7.0).floor() as u32;
        let marker_id = format!("{id}:chest:{index}");
        let key = format!("{id}:chest:{marker_id}");
        let mut loot = vec![
            format!("{{\"count\":{gold},\"itemKey\":\"gold-ingot\"}}"),
            format!("{{\"count\":{crystal},\"itemKey\":\"crystal-shard\"}}"),
            format!(
                "{{\"count\":{},\"itemKey\":\"{type_id}-dragon-scale\"}}",
                if candidate.stage == 5 { 5 } else { 3 }
            ),
        ];
        if rare < 0.2 {
            loot.push(format!(
                "{{\"count\":1,\"itemKey\":\"{}\"}}",
                tome_keys[index as usize % tome_keys.len()]
            ));
        }
        if rare > 0.92 {
            loot.push(format!(
                "{{\"count\":1,\"itemKey\":\"{}\"}}",
                if index % 2 == 1 {
                    "blueprint-dragonbone-arms"
                } else {
                    "blueprint-dragon-scale-armor"
                }
            ));
        }
        markers.push(DragonMarker {
            x,
            z,
            row: MarkerRow {
                key: key.clone(),
                canonical_json: format!(
                    "[\"{key}\",{{\"id\":\"{marker_id}\",\"loot\":[{}],\"lootTable\":\"desert-temple\",\"position\":{{\"x\":{x},\"y\":{floor_y},\"z\":{z}}},\"type\":\"chest\"}}]",
                    loot.join(",")
                ),
            },
        });
    }

    let egg_count = if candidate.sex == DragonSex::Male {
        0
    } else if candidate.stage == 4 {
        1
    } else {
        1 + (hash_unit(
            &format!("{seed}:{},{}", candidate.region_x, candidate.region_z),
            &format!("egg-count:{type_id}"),
        ) * 3.0)
            .floor() as i32
    };
    for index in 0..egg_count {
        let offset = index - egg_count / 2;
        blocks.insert(
            (rookery.x + offset * 2, floor_y, rookery.z + 1.max(rookery.rz - 4)),
            egg_block,
        );
    }

    let guardian_id = format!("{id}:guardian");
    let guardian_key = format!("{id}:spawn:{guardian_id}");
    let sex = candidate.sex.id();
    markers.push(DragonMarker {
        x: candidate.x,
        z: candidate.z,
        row: MarkerRow {
            key: guardian_key.clone(),
            canonical_json: format!(
                "[\"{guardian_key}\",{{\"count\":1,\"id\":\"{guardian_id}\",\"mobKind\":\"{type_id}-dragon\",\"persistent\":true,\"position\":{{\"x\":{},\"y\":{},\"z\":{}}},\"radius\":1,\"tags\":[\"dragon:{type_id}\",\"stage:{}\",\"sex:{sex}\",\"lair:{id}\",\"permanent:true\",\"guardian:true\"],\"type\":\"spawn\"}}]",
                candidate.x,
                floor_y + 1,
                candidate.z,
                candidate.stage
            ),
        },
    });
    let landmark_key = format!("{id}:landmark:{id}");
    markers.push(DragonMarker {
        x: candidate.x,
        z: candidate.z,
        row: MarkerRow {
            key: landmark_key.clone(),
            canonical_json: format!(
                "[\"{landmark_key}\",{{\"id\":\"{id}\",\"mapLayer\":\"underground\",\"position\":{{\"x\":{},\"y\":{},\"z\":{}}},\"tag\":\"dragon-lair:{type_id}:stage-{}:{sex}\",\"type\":\"landmark\"}}]",
                candidate.x, candidate.y, candidate.z, candidate.stage
            ),
        },
    });

    let placements = blocks
        .into_iter()
        .map(|((x, y, z), block)| DragonPlacement { x, y, z, block })
        .collect();
    DragonPlan { placements, markers }
}

pub(crate) fn plans_for_chunk(
    seed: &str,
    chunk_x: i32,
    chunk_z: i32,
    generator: &TerrainGeneratorV18,
) -> Vec<DragonPlan> {
    let min_x = chunk_x * 16;
    let min_z = chunk_z * 16;
    let region_min_x = (min_x - MAX_HORIZONTAL_RADIUS).div_euclid(REGION_BLOCKS);
    let region_max_x = (min_x + 16 + MAX_HORIZONTAL_RADIUS).div_euclid(REGION_BLOCKS);
    let region_min_z = (min_z - MAX_HORIZONTAL_RADIUS).div_euclid(REGION_BLOCKS);
    let region_max_z = (min_z + 16 + MAX_HORIZONTAL_RADIUS).div_euclid(REGION_BLOCKS);
    let mut plans = Vec::new();
    for region_x in region_min_x..=region_max_x {
        for region_z in region_min_z..=region_max_z {
            let Some(candidate) = candidate(seed, region_x, region_z, generator) else {
                continue;
            };
            if candidate.x + candidate.radius_x < min_x
                || candidate.x - candidate.radius_x >= min_x + 16
                || candidate.z + candidate.radius_z < min_z
                || candidate.z - candidate.radius_z >= min_z + 16
            {
                continue;
            }
            plans.push(plan_candidate(seed, candidate));
        }
    }
    plans
}

fn base36(value: i32) -> String {
    if value == 0 {
        return "0".into();
    }
    let negative = value < 0;
    let mut magnitude = i64::from(value).unsigned_abs();
    let mut output = String::new();
    while magnitude > 0 {
        let digit = (magnitude % 36) as u8;
        output.push(if digit < 10 {
            char::from(b'0' + digit)
        } else {
            char::from(b'a' + digit - 10)
        });
        magnitude /= 36;
    }
    if negative {
        output.push('-');
    }
    output.chars().rev().collect()
}

fn base36_u32(mut value: u32) -> String {
    if value == 0 {
        return "0".into();
    }
    let mut output = String::new();
    while value > 0 {
        let digit = (value % 36) as u8;
        output.push(if digit < 10 {
            char::from(b'0' + digit)
        } else {
            char::from(b'a' + digit - 10)
        });
        value /= 36;
    }
    output.chars().rev().collect()
}

#[derive(Clone, Debug)]
pub(crate) struct SeaNest {
    id: String,
    x: i32,
    y: i32,
    z: i32,
    radius: i32,
    stage: i32,
    female: bool,
    eggs: i32,
}

fn culture_unit(seed: &str, salt: &str) -> f64 {
    f64::from(seed_hash(&format!("{seed}|{salt}"))) / 4_294_967_296.0
}

fn sea_nest(seed: &str, region_x: i32, region_z: i32, ocean_floor_y: i32) -> Option<SeaNest> {
    let salt = format!("{seed}|sea-dragon-nest|{region_x}|{region_z}");
    if culture_unit(&salt, "rarity") >= 0.115 {
        return None;
    }
    let region_size = 48 * 16;
    let stage_roll = culture_unit(&salt, "stage");
    let stage = if stage_roll < 0.54 {
        3
    } else if stage_roll < 0.9 {
        4
    } else {
        5
    };
    let female = culture_unit(&salt, "sex") < 0.56;
    Some(SeaNest {
        id: format!(
            "sea-nest-{}-{}-{}",
            base36(region_x),
            base36(region_z),
            base36_u32(seed_hash(&salt))
        ),
        x: region_x * region_size + 128 + (culture_unit(&salt, "x") * f64::from(region_size - 256)).floor() as i32,
        y: (ocean_floor_y + 2).clamp(-58, 10),
        z: region_z * region_size + 128 + (culture_unit(&salt, "z") * f64::from(region_size - 256)).floor() as i32,
        radius: 25 + stage * 3,
        stage,
        female,
        eggs: if female {
            1 + i32::from(culture_unit(&salt, "eggs") > 0.72)
        } else {
            0
        },
    })
}

pub(crate) fn sea_nest_plans_for_chunk(
    seed: &str,
    chunk_x: i32,
    chunk_z: i32,
    generator: &TerrainGeneratorV18,
) -> Vec<DragonPlan> {
    let min_x = chunk_x * 16;
    let min_z = chunk_z * 16;
    let max_x = min_x + 15;
    let max_z = min_z + 15;
    let region_size = 48 * 16;
    let reach = 40;
    let start_x = (min_x - reach).div_euclid(region_size);
    let end_x = (max_x + reach).div_euclid(region_size);
    let start_z = (min_z - reach).div_euclid(region_size);
    let end_z = (max_z + reach).div_euclid(region_size);
    let mut plans = Vec::new();
    for region_x in start_x..=end_x {
        for region_z in start_z..=end_z {
            let Some(probe) = sea_nest(seed, region_x, region_z, -48) else {
                continue;
            };
            let center = generator.sample_column(probe.x, probe.z);
            if !matches!(center.biome, BiomeId::DeepOcean | BiomeId::LumenTrench)
                || center.height > center.waterline - 8
            {
                continue;
            }
            let Some(nest) = sea_nest(seed, region_x, region_z, center.height) else {
                continue;
            };
            if nest.x + nest.radius < min_x
                || nest.x - nest.radius > max_x
                || nest.z + nest.radius < min_z
                || nest.z - nest.radius > max_z
            {
                continue;
            }
            let mut blocks = BTreeMap::<(i32, i32, i32), u16>::new();
            for x in min_x.max(nest.x - nest.radius)..=max_x.min(nest.x + nest.radius) {
                for z in min_z.max(nest.z - nest.radius)..=max_z.min(nest.z + nest.radius) {
                    let dx = x - nest.x;
                    let dz = z - nest.z;
                    let distance = f64::from(dx * dx + dz * dz).sqrt();
                    if distance > f64::from(nest.radius) {
                        continue;
                    }
                    let local_floor = generator.sample_column(x, z).height;
                    let inner = distance <= f64::from(nest.radius) * 0.27;
                    let middle = (distance - f64::from(nest.radius) * 0.52).abs() < 1.15;
                    let outer = (distance - f64::from(nest.radius) * 0.84).abs() < 0.85;
                    let spiral = ((f64::from(dz)).atan2(f64::from(dx)) * 3.0 + distance * 0.62).sin() > 0.72;
                    if inner || middle || outer || (spiral && distance < f64::from(nest.radius) * 0.9) {
                        blocks.insert((x, local_floor + 1, z), Block::MOON_SLATE);
                        if inner && distance < f64::from(nest.radius) * 0.18 {
                            blocks.insert((x, local_floor + 2, z), Block::MOON_SLATE);
                        }
                    }
                    let ornament = hash2(x, z, generator.seed() ^ 0x5ea0_d6a1);
                    if !inner && distance < f64::from(nest.radius) * 0.76 && ornament > 0.955 {
                        blocks.insert(
                            (x, local_floor + 2, z),
                            if ornament > 0.982 {
                                Block::ABYSS_BLOOM
                            } else {
                                Block::STAR_CORAL
                            },
                        );
                    } else if outer && ornament > 0.91 {
                        blocks.insert((x, local_floor + 2, z), Block::GLASS);
                    }
                }
            }

            let floor_y = center.height + 2;
            for index in 0..nest.eggs {
                let x = nest.x + index * 2 - (nest.eggs - 1);
                let z = nest.z + 1;
                if (min_x..=max_x).contains(&x) && (min_z..=max_z).contains(&z) {
                    blocks.insert((x, floor_y, z), Block::SEA_DRAGON_EGG_BLOCK);
                }
            }
            let mut markers = Vec::new();
            let chest_x = nest.x + 6.min(nest.radius - 4);
            let chest_z = nest.z - 2;
            if nest.stage >= 4 && (min_x..=max_x).contains(&chest_x) && (min_z..=max_z).contains(&chest_z) {
                let chest_y = generator.sample_column(chest_x, chest_z).height + 2;
                blocks.insert((chest_x, chest_y, chest_z), Block::CHEST);
                let marker_id = format!("{}:hoard", nest.id);
                let key = format!("{}:chest:{marker_id}", nest.id);
                markers.push(DragonMarker {
                    x: chest_x,
                    z: chest_z,
                    row: MarkerRow {
                        key: key.clone(),
                        canonical_json: format!(
                            "[\"{key}\",{{\"id\":\"{marker_id}\",\"loot\":[{{\"count\":{},\"itemKey\":\"gold-ingot\"}},{{\"count\":{},\"itemKey\":\"sea-dragon-scale\"}},{{\"count\":1,\"itemKey\":\"water-breathing-potion\"}}],\"lootTable\":\"desert-temple\",\"position\":{{\"x\":{chest_x},\"y\":{chest_y},\"z\":{chest_z}}},\"type\":\"chest\"}}]",
                            6 + nest.stage * 3,
                            nest.stage - 2
                        ),
                    },
                });
            }
            if (min_x..=max_x).contains(&nest.x) && (min_z..=max_z).contains(&nest.z) {
                let guardian_id = format!("{}:guardian", nest.id);
                let guardian_key = format!("{}:spawn:{guardian_id}", nest.id);
                markers.push(DragonMarker {
                    x: nest.x,
                    z: nest.z,
                    row: MarkerRow {
                        key: guardian_key.clone(),
                        canonical_json: format!(
                            "[\"{guardian_key}\",{{\"count\":1,\"id\":\"{guardian_id}\",\"mobKind\":\"sea-dragon\",\"persistent\":true,\"position\":{{\"x\":{},\"y\":{},\"z\":{}}},\"radius\":2,\"tags\":[\"dragon:sea\",\"stage:{}\",\"sex:{}\",\"lair:{}\",\"permanent:true\",\"guardian:true\",\"aquatic:true\"],\"type\":\"spawn\"}}]",
                            nest.x,
                            floor_y + 2,
                            nest.z,
                            nest.stage,
                            if nest.female { "female" } else { "male" },
                            nest.id
                        ),
                    },
                });
                let landmark_key = format!("{}:landmark:{}", nest.id, nest.id);
                markers.push(DragonMarker {
                    x: nest.x,
                    z: nest.z,
                    row: MarkerRow {
                        key: landmark_key.clone(),
                        canonical_json: format!(
                            "[\"{landmark_key}\",{{\"id\":\"{}\",\"mapLayer\":\"underwater\",\"position\":{{\"x\":{},\"y\":{},\"z\":{}}},\"tag\":\"dragon-nest:sea:stage-{}:{}\",\"type\":\"landmark\"}}]",
                            nest.id,
                            nest.x,
                            nest.y,
                            nest.z,
                            nest.stage,
                            if nest.female { "female" } else { "male" }
                        ),
                    },
                });
            }
            plans.push(DragonPlan {
                placements: blocks
                    .into_iter()
                    .map(|((x, y, z), block)| DragonPlacement { x, y, z, block })
                    .collect(),
                markers,
            });
        }
    }
    plans
}

#[cfg(test)]
mod locator_tests {
    use super::*;
    use crate::contract::GenerationOptions;
    use std::collections::BTreeSet;

    #[test]
    fn sea_lair_query_has_a_positive_bounded_path() {
        for index in 0..64 {
            let seed = format!("sea-locator-positive-{index}");
            let generator = TerrainGeneratorV18::new(&seed, GenerationOptions::default());
            if let Some(result) = query_nearest_lair(
                &seed,
                &generator,
                LairQuery {
                    origin_x_millis: -250,
                    origin_z_millis: 750,
                    dragon_type: "sea",
                    minimum_stage: 3,
                    excluded_ids: &BTreeSet::new(),
                    maximum_region_radius: 8,
                },
            ) {
                assert_eq!(result.candidate.dragon_type(), "sea");
                assert!(result.candidate.stage() >= 3);
                return;
            }
        }
        panic!("bounded positive sea-lair corpus must contain a real generated nest");
    }
}
