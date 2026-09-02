//! Deterministic settlement layout and voxel extraction.
//!
//! This module is intentionally renderer-neutral. It mirrors the connected
//! tile planners used by the TypeScript v18 oracle, then extracts concrete
//! block placements for one accepted settlement. Keeping the semantic layout
//! separate from extraction makes later save/schema migrations testable.

use crate::contract::{Block, GenerationProfile, MarkerRow};
use crate::generator::TerrainGeneratorV18;
use crate::settlement::{Candidate, Environment, Faction, GuildHall, SettlementPlacement, Size};
use blockwild_types::{MIN_Y, WORLD_HEIGHT, hash2};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Point {
    x: i32,
    y: Option<i32>,
    z: i32,
}

impl Point {
    const fn surface(x: i32, z: i32) -> Self {
        Self { x, y: None, z }
    }

    const fn at(x: i32, y: i32, z: i32) -> Self {
        Self { x, y: Some(y), z }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FurnitureKind {
    Bed,
    Door,
    Chair,
    Table,
    Barrel,
    WheatMill,
    Distillery,
    MerchantCounter,
    BankCounter,
    Forge,
    Nest,
    RestAlcove,
    KelpTrough,
    CoralLoom,
    PearlCounter,
    GlowBasin,
    SugarworksKettle,
    SyrupVat,
    ConfectionCounter,
    PetBed,
    MoonwellBasin,
    TomeLectern,
    LivingChair,
    GolemCradle,
    ManaConduit,
    PowderBench,
    GearTable,
    BrightLantern,
}

#[derive(Clone, Copy, Debug)]
struct Furniture {
    kind: FurnitureKind,
    position: Point,
    facing: u8,
}

#[derive(Clone, Debug)]
struct Building {
    id: String,
    role: &'static str,
    position: Point,
    facing: u8,
    width: i32,
    depth: i32,
    floors: i32,
    furniture: Vec<Furniture>,
    guild_hall: Option<GuildHall>,
}

#[derive(Clone, Copy, Debug)]
struct WallNode {
    position: Point,
    tower: bool,
}

#[derive(Clone, Copy, Debug)]
struct Gate {
    position: Point,
    facing: u8,
}

#[derive(Clone, Copy, Debug)]
struct Light {
    position: Point,
}

#[derive(Clone, Debug)]
struct Layout {
    center: Point,
    radius: i32,
    buildings: Vec<Building>,
    paths: Vec<Point>,
    wall: Vec<WallNode>,
    gates: Vec<Gate>,
    approaches: Vec<Point>,
    lights: Vec<Light>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PublicArrival {
    pub x: i32,
    pub y_millis: i32,
    pub z: i32,
    pub anchor_kind: &'static str,
}

#[derive(Clone, Copy)]
struct Tile {
    x: i32,
    z: i32,
    connections: [bool; 4],
}

#[derive(Clone, Copy)]
struct Palette {
    path: u16,
    perimeter: u16,
    tower: u16,
    light: u16,
    wall: u16,
    corner: u16,
    roof: u16,
    floor: u16,
    hall: u16,
}

type Extraction = (Vec<SettlementPlacement>, Vec<(i32, i32, MarkerRow)>, i32);

fn hash32(value: &str) -> u32 {
    let mut hash = 2_166_136_261_u32;
    for code in value.encode_utf16() {
        hash = (hash ^ u32::from(code)).wrapping_mul(16_777_619);
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
    digits.into_iter().rev().collect()
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

fn tile_count(size: Size, seed: &str) -> usize {
    let (minimum, maximum) = match size {
        Size::Hamlet => (10_u32, 16_u32),
        Size::Village => (17, 25),
        Size::Town => (26, 36),
    };
    (minimum + hash32(&format!("{seed}|settlement-tile-count")) % (maximum - minimum + 1)) as usize
}

fn connected_tiles(seed: &str, target: usize, radius: i32) -> Vec<Tile> {
    let radius = radius.clamp(1, 12);
    let capacity = ((radius * 2 + 1) * (radius * 2 + 1)) as usize;
    let target = target.clamp(1, capacity);
    let mut occupied = vec![(0_i32, 0_i32)];
    let mut occupied_set = BTreeSet::from([(0_i32, 0_i32)]);
    let mut frontier = Vec::new();
    let mut queued = BTreeSet::new();
    let enqueue = |x: i32, z: i32, frontier: &mut Vec<(i32, i32)>, queued: &mut BTreeSet<(i32, i32)>| {
        if x.abs() <= radius && z.abs() <= radius && !occupied_set.contains(&(x, z)) && queued.insert((x, z)) {
            frontier.push((x, z));
        }
    };
    enqueue(1, 0, &mut frontier, &mut queued);
    enqueue(-1, 0, &mut frontier, &mut queued);
    enqueue(0, 1, &mut frontier, &mut queued);
    enqueue(0, -1, &mut frontier, &mut queued);
    let mut cursor = 0_usize;
    while occupied.len() < target && !frontier.is_empty() && cursor < capacity * 8 {
        let index = ((unit(seed, &format!("connected-frontier-{cursor}")) * frontier.len() as f64).floor() as usize)
            .min(frontier.len() - 1);
        let (x, z) = frontier.remove(index);
        queued.remove(&(x, z));
        cursor += 1;
        if !occupied_set.insert((x, z)) {
            continue;
        }
        occupied.push((x, z));
        for (nx, nz) in [(x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)] {
            if nx.abs() <= radius && nz.abs() <= radius && !occupied_set.contains(&(nx, nz)) && queued.insert((nx, nz))
            {
                frontier.push((nx, nz));
            }
        }
    }
    occupied.sort_by(|left, right| {
        (left.0.abs() + left.1.abs())
            .cmp(&(right.0.abs() + right.1.abs()))
            .then_with(|| {
                f64::from(left.1)
                    .atan2(f64::from(left.0))
                    .partial_cmp(&f64::from(right.1).atan2(f64::from(right.0)))
                    .unwrap_or(Ordering::Equal)
            })
    });
    occupied
        .into_iter()
        .map(|(x, z)| Tile {
            x,
            z,
            connections: [
                occupied_set.contains(&(x, z - 1)),
                occupied_set.contains(&(x + 1, z)),
                occupied_set.contains(&(x, z + 1)),
                occupied_set.contains(&(x - 1, z)),
            ],
        })
        .collect()
}

fn local_point(position: Point, facing: u8, x: i32, z: i32, y: i32) -> Point {
    let (rx, rz) = match facing & 3 {
        1 => (-z, x),
        2 => (-x, -z),
        3 => (z, -x),
        _ => (x, z),
    };
    Point {
        x: position.x + rx,
        y: position.y.map(|base| base + y),
        z: position.z + rz,
    }
}

fn furniture_for(faction: Faction, role: &'static str, position: Point, facing: u8) -> Vec<Furniture> {
    let mut entries = Vec::new();
    let mut add = |kind, x, z, y, item_facing| {
        entries.push(Furniture {
            kind,
            position: local_point(position, facing, x, z, y),
            facing: item_facing,
        });
    };
    let rear = (facing + 2) & 3;
    if faction == Faction::WoodElves {
        add(FurnitureKind::Door, 0, -2, 0, facing);
        if matches!(role, "living-home" | "moonbough-hall" | "leafwarden-lodge") {
            add(FurnitureKind::Bed, -1, 0, 0, rear);
            add(FurnitureKind::LivingChair, 1, 1, 0, rear);
        }
        if role == "glimmer-library" {
            add(FurnitureKind::TomeLectern, -1, 1, 0, facing);
            add(FurnitureKind::TomeLectern, 1, 1, 0, facing);
        }
        if role == "moonwell" {
            add(FurnitureKind::MoonwellBasin, 0, 0, 0, facing);
        }
        if role == "enclave-market" {
            add(FurnitureKind::MerchantCounter, 0, 1, 0, facing);
        }
        add(FurnitureKind::Table, 0, 0, 0, facing);
        return entries;
    }
    if faction == Faction::Dwarves {
        add(FurnitureKind::Door, 0, -2, 0, facing);
        if matches!(role, "stone-home" | "deepgear-hall" | "entrance-barracks") {
            add(FurnitureKind::Bed, -1, 0, 0, rear);
        }
        if role == "golem-forge" {
            add(FurnitureKind::GolemCradle, 0, 1, 0, facing);
            add(FurnitureKind::ManaConduit, 1, 1, 0, facing);
        }
        if role == "powderworks" {
            add(FurnitureKind::PowderBench, 0, 1, 0, facing);
        }
        if role == "gear-market" {
            add(FurnitureKind::MerchantCounter, 0, 1, 0, facing);
        }
        if role == "blacksmith" {
            add(FurnitureKind::Forge, 0, 1, 0, facing);
        }
        add(FurnitureKind::GearTable, 0, 0, 0, facing);
        add(FurnitureKind::BrightLantern, 1, -1, 2, facing);
        return entries;
    }
    if faction == Faction::Atlantians {
        if matches!(role, "home" | "tide-hall" | "guard-grotto") {
            add(FurnitureKind::RestAlcove, -1, 1, 0, facing);
        }
        if matches!(role, "home" | "tide-hall") {
            add(FurnitureKind::Nest, 1, 1, 1, facing);
        }
        match role {
            "kelp-garden" => add(FurnitureKind::KelpTrough, 0, 0, 0, facing),
            "coral-workshop" => add(FurnitureKind::CoralLoom, 0, 0, 0, facing),
            "pearl-market" => add(FurnitureKind::PearlCounter, 0, 0, 0, facing),
            "glow-clinic" => add(FurnitureKind::GlowBasin, 0, 0, 0, facing),
            "current-store" => {
                add(FurnitureKind::PearlCounter, -1, 0, 0, facing);
                add(FurnitureKind::KelpTrough, 1, 0, 0, facing);
            }
            _ => {}
        }
        return entries;
    }
    add(FurnitureKind::Door, 0, -2, 0, facing);
    if faction == Faction::Sugarcourt {
        if matches!(role, "bonbon-home" | "sugar-palace" | "brittle-barracks") {
            add(FurnitureKind::Bed, -1, 0, 0, rear);
        }
        if matches!(role, "bonbon-home" | "sugar-palace") {
            add(FurnitureKind::Bed, 1, 0, 0, rear);
        }
        add(FurnitureKind::Chair, 0, 1, 0, rear);
        add(FurnitureKind::Table, 0, 0, 0, facing);
        match role {
            "sugarworks" => {
                add(FurnitureKind::SugarworksKettle, 1, 1, 0, facing);
                add(FurnitureKind::SyrupVat, -1, 1, 0, facing);
            }
            "gumdrop-garden" => add(FurnitureKind::SyrupVat, 1, 1, 0, facing),
            "sweet-market" => add(FurnitureKind::ConfectionCounter, 1, 0, 0, facing),
            "candysmith" => add(FurnitureKind::Forge, 1, 1, 0, facing),
            "taffy-kennel" => {
                add(FurnitureKind::PetBed, -1, 1, 0, facing);
                add(FurnitureKind::PetBed, 1, 1, 0, facing);
            }
            _ => {}
        }
        return entries;
    }
    if matches!(role, "home" | "mayor-hall" | "guardhouse") {
        add(FurnitureKind::Bed, -1, 0, 0, rear);
    }
    if matches!(role, "home" | "mayor-hall") {
        add(FurnitureKind::Bed, 1, 0, 0, rear);
    }
    if role == "wheat-mill" {
        add(FurnitureKind::WheatMill, 0, 1, 0, facing);
        add(FurnitureKind::Barrel, -1, 1, 0, facing);
        add(FurnitureKind::Table, 1, 0, 0, facing);
    } else {
        add(FurnitureKind::Chair, 0, 1, 0, rear);
        add(FurnitureKind::Table, 0, 0, 0, facing);
    }
    if role == "brewery" {
        add(FurnitureKind::Barrel, -1, 1, 0, facing);
        add(FurnitureKind::Distillery, 1, 1, 0, facing);
    }
    if role == "bank" {
        add(FurnitureKind::BankCounter, 1, 0, 0, facing);
    }
    if role == "market" {
        add(FurnitureKind::MerchantCounter, 1, 0, 0, facing);
    }
    if role == "blacksmith" {
        add(FurnitureKind::Forge, 1, 1, 0, facing);
    }
    entries
}

fn line(points: &mut Vec<Point>, from: Point, to: Point, spacing: i32) {
    let vertical = to.y.unwrap_or(from.y.unwrap_or(0)) - from.y.unwrap_or(to.y.unwrap_or(0));
    let distance = f64::from(to.x - from.x)
        .hypot(f64::from(to.z - from.z))
        .hypot(f64::from(vertical));
    let steps = ((distance / f64::from(spacing)).ceil() as i32).max(1);
    for index in 0..=steps {
        let t = f64::from(index) / f64::from(steps);
        points.push(Point {
            x: js_round(f64::from(from.x) + f64::from(to.x - from.x) * t),
            z: js_round(f64::from(from.z) + f64::from(to.z - from.z) * t),
            y: (from.y.is_some() || to.y.is_some())
                .then(|| js_round(f64::from(from.y.or(to.y).unwrap_or(0)) + f64::from(vertical) * t)),
        });
    }
}

fn standard_roles(faction: Faction) -> (&'static [&'static str], &'static [&'static str]) {
    match faction {
        Faction::Atlantians => (
            &[
                "tide-hall",
                "guard-grotto",
                "pearl-market",
                "home",
                "kelp-garden",
                "coral-workshop",
                "glow-clinic",
                "home",
                "current-store",
                "kelp-garden",
                "guard-grotto",
                "home",
                "coral-workshop",
                "pearl-market",
                "home",
                "glow-clinic",
                "current-store",
                "kelp-garden",
            ],
            &[
                "home",
                "kelp-garden",
                "home",
                "coral-workshop",
                "current-store",
                "guard-grotto",
            ],
        ),
        Faction::Sugarcourt => (
            &[
                "sugar-palace",
                "brittle-barracks",
                "sweet-market",
                "bonbon-home",
                "bonbon-home",
                "gumdrop-garden",
                "sugarworks",
                "candysmith",
                "taffy-kennel",
                "bonbon-home",
                "gumdrop-garden",
                "sweet-market",
                "bonbon-home",
                "brittle-barracks",
                "sugarworks",
                "bonbon-home",
                "gumdrop-garden",
                "candysmith",
            ],
            &[
                "bonbon-home",
                "gumdrop-garden",
                "bonbon-home",
                "sweet-market",
                "taffy-kennel",
            ],
        ),
        Faction::Hobbits => (
            &[
                "mayor-hall",
                "guardhouse",
                "market",
                "home",
                "home",
                "wheat-mill",
                "brewery",
                "bank",
                "wheat-mill",
                "home",
                "alchemist",
                "warehouse",
                "home",
                "guardhouse",
                "market",
                "home",
                "wheat-mill",
                "warehouse",
            ],
            &["home", "wheat-mill", "home", "brewery", "warehouse", "guardhouse"],
        ),
        _ => (
            &[
                "mayor-hall",
                "guardhouse",
                "market",
                "home",
                "home",
                "farm",
                "mine-store",
                "blacksmith",
                "warg-kennel",
                "home",
                "alchemist",
                "warehouse",
                "home",
                "guardhouse",
                "market",
                "home",
                "farm",
                "warehouse",
            ],
            &["home", "mine-store", "home", "warg-kennel", "warehouse", "guardhouse"],
        ),
    }
}

fn role_plan(faction: Faction, size: Size, seed: &str) -> Vec<&'static str> {
    // The browser oracle chooses the footprint from `${candidate.id}|${worldSeed}`
    // but chooses filler roles from candidate.id alone. Keep those two hash
    // domains separate: combining them made layouts with >18 cells silently
    // diverge even when their connected tile graph was otherwise identical.
    let candidate_id = seed.split_once('|').map_or(seed, |(id, _)| id);
    let target = tile_count(size, seed);
    let (authored, fillers) = standard_roles(faction);
    (0..target)
        .map(|index| {
            authored.get(index).copied().unwrap_or_else(|| {
                let pick = ((unit(candidate_id, &format!("role-{index}")) * fillers.len() as f64).floor() as usize)
                    .min(fillers.len() - 1);
                fillers[pick]
            })
        })
        .collect()
}

fn unique_points(points: Vec<Point>) -> Vec<Point> {
    let mut seen = BTreeSet::new();
    points
        .into_iter()
        .filter(|point| seen.insert((point.x, point.y, point.z)))
        .take(1_024)
        .collect()
}

fn standard_layout(candidate: &Candidate, seed: &str) -> Layout {
    let aquatic = candidate.environment == Environment::Underwater;
    let center = candidate.floor_y.map_or_else(
        || Point::surface(candidate.x, candidate.z),
        |floor| Point::at(candidate.x, floor + 2, candidate.z),
    );
    let grid_radius = match candidate.size {
        Size::Hamlet => 2,
        Size::Village => 3,
        Size::Town => 4,
    };
    let tile_size = match candidate.faction {
        Faction::Hobbits => 9,
        Faction::Atlantians => 11,
        _ => 10,
    };
    let plan_seed = format!("{}|{seed}", candidate.id);
    let roles = role_plan(candidate.faction, candidate.size, &plan_seed);
    let tiles = connected_tiles(&plan_seed, roles.len(), grid_radius);
    let mut buildings = Vec::new();
    for (index, tile) in tiles.iter().enumerate() {
        let role = roles[index];
        let vertical = if aquatic && index > 0 {
            2 + ((tile.x.abs() + tile.z.abs() + index as i32) % 4) * 2
        } else {
            0
        };
        let position = Point {
            x: center.x + tile.x * tile_size,
            y: center.y.map(|value| value + vertical),
            z: center.z + tile.z * tile_size,
        };
        let facing = ((unit(&candidate.id, &format!("facing-{index}")) * 4.0).floor() as u8).min(3);
        let civic = matches!(role, "mayor-hall" | "tide-hall" | "sugar-palace");
        let broad = matches!(role, "warehouse" | "current-store" | "sugarworks" | "brittle-barracks");
        let width = if civic {
            9
        } else if broad {
            8
        } else {
            5 + (unit(&candidate.id, &format!("width-{index}")) * 3.0).floor() as i32
        };
        let depth = if civic {
            9
        } else if broad {
            7
        } else {
            5 + (unit(&candidate.id, &format!("depth-{index}")) * 3.0).floor() as i32
        };
        let floors = i32::from(civic || (candidate.size == Size::Town && index > 0 && index % 7 == 0)) + 1;
        buildings.push(Building {
            id: format!("{}-tile-{index}", candidate.id),
            role,
            position,
            facing,
            width,
            depth,
            floors,
            furniture: furniture_for(candidate.faction, role, position, facing),
            guild_hall: None,
        });
    }
    let mut paths = Vec::new();
    for tile in &tiles {
        let from = Point {
            x: center.x + tile.x * tile_size,
            y: center.y.map(|value| {
                value
                    + if aquatic {
                        let index = tiles
                            .iter()
                            .position(|entry| entry.x == tile.x && entry.z == tile.z)
                            .unwrap_or(0);
                        if index > 0 {
                            2 + ((tile.x.abs() + tile.z.abs() + index as i32) % 4) * 2
                        } else {
                            0
                        }
                    } else {
                        0
                    }
            }),
            z: center.z + tile.z * tile_size,
        };
        for (connection, dx, dz) in [(1, 1, 0), (2, 0, 1)] {
            if !tile.connections[connection] {
                continue;
            }
            if let Some(neighbor) = tiles
                .iter()
                .find(|entry| entry.x == tile.x + dx && entry.z == tile.z + dz)
            {
                let neighbor_index = tiles
                    .iter()
                    .position(|entry| entry.x == neighbor.x && entry.z == neighbor.z)
                    .unwrap_or(0);
                let to = Point {
                    x: center.x + neighbor.x * tile_size,
                    y: center.y.map(|value| {
                        value
                            + if aquatic && neighbor_index > 0 {
                                2 + ((neighbor.x.abs() + neighbor.z.abs() + neighbor_index as i32) % 4) * 2
                            } else {
                                0
                            }
                    }),
                    z: center.z + neighbor.z * tile_size,
                };
                line(&mut paths, from, to, if aquatic { 1 } else { 2 });
            }
        }
    }
    let perimeter = (grid_radius + 1) * tile_size;
    let gate_count = match candidate.size {
        Size::Hamlet => 2,
        Size::Village => 3,
        Size::Town => 4,
    };
    let first_side = (unit(&candidate.id, "gate-side") * 4.0).floor() as i32;
    let mut gates = Vec::new();
    if !aquatic {
        for index in 0..gate_count {
            let side = (first_side + index) % 4;
            let slide = js_round(
                (unit(&candidate.id, &format!("gate-slide-{index}")) * 2.0 - 1.0)
                    * f64::from(tile_size.min(perimeter / 3)),
            );
            let position = match side {
                0 => Point::surface(center.x + slide, center.z - perimeter),
                1 => Point::surface(center.x + perimeter, center.z + slide),
                2 => Point::surface(center.x + slide, center.z + perimeter),
                _ => Point::surface(center.x - perimeter, center.z + slide),
            };
            gates.push(Gate {
                position,
                facing: side as u8,
            });
        }
        for gate in &gates {
            if let Some(building) = buildings.iter().min_by(|left, right| {
                let left_distance =
                    f64::from(left.position.x - gate.position.x).hypot(f64::from(left.position.z - gate.position.z));
                let right_distance =
                    f64::from(right.position.x - gate.position.x).hypot(f64::from(right.position.z - gate.position.z));
                left_distance.total_cmp(&right_distance)
            }) {
                line(&mut paths, building.position, gate.position, 1);
            }
        }
    }
    let approaches = if aquatic {
        let count = (gate_count + 1).clamp(3, 5);
        let rotation = unit(&candidate.id, "approach-rotation") * 0.45;
        (0..count)
            .map(|index| {
                let angle = f64::from(index) * std::f64::consts::TAU / f64::from(count) + rotation;
                Point::at(
                    js_round(f64::from(center.x) + angle.cos() * f64::from(perimeter - 2)),
                    center.y.unwrap_or(0) + if index % 2 == 0 { 5 } else { 9 },
                    js_round(f64::from(center.z) + angle.sin() * f64::from(perimeter - 2)),
                )
            })
            .collect()
    } else {
        Vec::new()
    };
    if aquatic {
        for approach in &approaches {
            if let Some(building) = buildings.iter().min_by_key(|entry| {
                i64::from(entry.position.x - approach.x).pow(2) + i64::from(entry.position.z - approach.z).pow(2)
            }) {
                line(&mut paths, building.position, *approach, 1);
            }
        }
    }
    let mut wall = Vec::new();
    if !aquatic {
        let mut push = |x: i32, z: i32| {
            if gates.iter().any(|gate| gate.position.x == x && gate.position.z == z) {
                return;
            }
            let offset = (x - center.x).abs() + (z - center.z).abs();
            let corner = (x - center.x).abs() == perimeter && (z - center.z).abs() == perimeter;
            wall.push(WallNode {
                position: Point::surface(x, z),
                tower: corner || offset % (tile_size * 2) == 0,
            });
        };
        for offset in -perimeter..=perimeter {
            push(center.x + offset, center.z - perimeter);
            push(center.x + offset, center.z + perimeter);
        }
        for offset in -perimeter + 1..perimeter {
            push(center.x - perimeter, center.z + offset);
            push(center.x + perimeter, center.z + offset);
        }
    }
    let paths = unique_points(paths);
    let lights = if aquatic {
        let mut values = vec![Light {
            position: Point::at(center.x, center.y.unwrap_or(0) + 14, center.z),
        }];
        values.extend(buildings.iter().map(|building| Light {
            position: Point::at(
                building.position.x,
                building.position.y.or(center.y).unwrap_or(0) + 3,
                building.position.z,
            ),
        }));
        values.extend(approaches.iter().copied().map(|position| Light { position }));
        values.truncate(32);
        values
    } else {
        let mut values = Vec::new();
        for gate in &gates {
            let dx = if gate.facing % 2 == 0 { 2 } else { 0 };
            let dz = if gate.facing % 2 == 1 { 2 } else { 0 };
            values.push(Light {
                position: Point::surface(gate.position.x + dx, gate.position.z + dz),
            });
            values.push(Light {
                position: Point::surface(gate.position.x - dx, gate.position.z - dz),
            });
        }
        values.extend(
            buildings
                .iter()
                .enumerate()
                .filter(|(index, _)| *index == 0 || index % 2 == 0)
                .map(|(_, building)| Light {
                    position: Point {
                        x: building.position.x,
                        y: building.position.y.map(|value| value + 1),
                        z: building.position.z - building.depth / 2 - 1,
                    },
                }),
        );
        values.extend(paths.iter().step_by(18).copied().map(|position| Light { position }));
        values.truncate(32);
        values
    };
    Layout {
        center,
        radius: perimeter,
        buildings,
        paths,
        wall,
        gates,
        approaches,
        lights,
    }
}

fn v1_role(faction: Faction, role: &str) -> &'static str {
    if faction == Faction::WoodElves {
        match role {
            "civic-hall" => "moonbough-hall",
            "guard-post" => "leafwarden-lodge",
            "library" => "glimmer-library",
            "market" => "enclave-market",
            "garden" => "glow-garden",
            "alchemy" => "moonwell",
            _ => "living-home",
        }
    } else {
        match role {
            "civic-hall" => "deepgear-hall",
            "guard-post" => "entrance-barracks",
            "golem-forge" => "golem-forge",
            "powderworks" => "powderworks",
            "mine" => "delver-gallery",
            "market" => "gear-market",
            "forge" => "blacksmith",
            "storage" => "warehouse",
            _ => "stone-home",
        }
    }
}

fn v1_layout(candidate: &Candidate, seed: &str) -> Layout {
    let dwarf = candidate.faction == Faction::Dwarves;
    let radius = match candidate.size {
        Size::Hamlet => 2,
        Size::Village => 3,
        Size::Town => 4,
    };
    let style_id = format!(
        "{}-{}-{}-{}",
        candidate.faction.id(),
        base36(candidate.region_x),
        base36(candidate.region_z),
        base36_u32(hash32(&format!(
            "{seed}|{}|{}|{}",
            candidate.faction.id(),
            candidate.region_x,
            candidate.region_z
        )))
    );
    let tiles = connected_tiles(&style_id, tile_count(candidate.size, &style_id), radius);
    let authored: &[&str] = if dwarf {
        &[
            "civic-hall",
            "guard-post",
            "golem-forge",
            "forge",
            "market",
            "home",
            "mine",
            "powderworks",
            "home",
            "kennel",
            "storage",
            "home",
        ]
    } else {
        &[
            "civic-hall",
            "guard-post",
            "library",
            "market",
            "garden",
            "home",
            "home",
            "alchemy",
            "kennel",
            "garden",
            "home",
            "storage",
        ]
    };
    let fillers: &[&str] = if dwarf {
        &["home", "mine", "storage", "forge"]
    } else {
        &["home", "garden", "home", "storage"]
    };
    let tile_size = if dwarf { 10 } else { 11 };
    let civic_y = candidate.floor_y;
    let center = Point {
        x: candidate.x,
        y: civic_y,
        z: candidate.z,
    };
    let mut buildings = Vec::new();
    let mut tile_y = Vec::new();
    for (index, tile) in tiles.iter().enumerate() {
        let raw_role = authored.get(index).copied().unwrap_or_else(|| {
            fillers[((unit(&style_id, &format!("role-{index}")) * fillers.len() as f64).floor() as usize)
                .min(fillers.len() - 1)]
        });
        let role = v1_role(candidate.faction, raw_role);
        let civic = matches!(raw_role, "civic-hall" | "library" | "golem-forge");
        let y_offset = if dwarf {
            -12 - ((tile.x.abs() + tile.z.abs() - 1).max(0) * 2).min(10)
        } else {
            0
        };
        let y = if dwarf {
            civic_y.map(|base| base + (y_offset + 12).min(0))
        } else {
            civic_y
        };
        tile_y.push(y);
        let position = Point {
            x: center.x + tile.x * tile_size,
            y,
            z: center.z + tile.z * tile_size,
        };
        let facing = ((unit(&style_id, &format!("rotation-{index}")) * 4.0).floor() as u8).min(3);
        let mut width = if civic {
            9
        } else {
            5 + (unit(&style_id, &format!("width-{index}")) * 3.0).floor() as i32
        };
        if !dwarf && role == "living-home" {
            width = width.max(7) | 1;
        }
        let depth = if civic {
            9
        } else {
            5 + (unit(&style_id, &format!("depth-{index}")) * 3.0).floor() as i32
        };
        let floors = i32::from(civic || (candidate.size == Size::Town && index % 7 == 0)) + 1;
        buildings.push(Building {
            id: format!("{style_id}-tile-{index}"),
            role,
            position,
            facing,
            width,
            depth,
            floors,
            furniture: furniture_for(candidate.faction, role, position, facing),
            guild_hall: None,
        });
    }
    let mut paths = Vec::new();
    for (index, tile) in tiles.iter().enumerate() {
        let from = Point {
            x: center.x + tile.x * tile_size,
            y: tile_y[index],
            z: center.z + tile.z * tile_size,
        };
        for (connection, dx, dz) in [(1, 1, 0), (2, 0, 1)] {
            if !tile.connections[connection] {
                continue;
            }
            if let Some((neighbor_index, neighbor)) = tiles
                .iter()
                .enumerate()
                .find(|(_, entry)| entry.x == tile.x + dx && entry.z == tile.z + dz)
            {
                line(
                    &mut paths,
                    from,
                    Point {
                        x: center.x + neighbor.x * tile_size,
                        y: tile_y[neighbor_index],
                        z: center.z + neighbor.z * tile_size,
                    },
                    if dwarf { 1 } else { 2 },
                );
            }
        }
    }
    let gate_side = (unit(&style_id, "gate-side") * 4.0).floor() as i32;
    let slide = js_round((unit(&style_id, "gate-slide") * 2.0 - 1.0) * f64::from(radius));
    let (gate_x, gate_z) = if gate_side % 2 == 0 {
        (slide, if gate_side == 0 { -radius - 1 } else { radius + 1 })
    } else {
        (if gate_side == 1 { radius + 1 } else { -radius - 1 }, slide)
    };
    let surface_y = if dwarf {
        candidate.floor_y.map(|value| value + 18)
    } else {
        candidate.floor_y
    };
    let entrance = Point {
        x: center.x + gate_x * tile_size,
        y: surface_y,
        z: center.z + gate_z * tile_size,
    };
    let guard = buildings
        .iter()
        .find(|building| building.role == if dwarf { "entrance-barracks" } else { "leafwarden-lodge" })
        .map_or(center, |building| building.position);
    line(&mut paths, entrance, guard, 1);
    let gate_facing = if gate_z < 0 {
        0
    } else if gate_x > 0 {
        1
    } else if gate_z > 0 {
        2
    } else {
        3
    };
    let mut wall = Vec::new();
    if !dwarf {
        let wall_radius = (radius + 1) * tile_size;
        let mut push = |x: i32, z: i32| {
            if x == entrance.x && z == entrance.z {
                return;
            }
            let along = (x - center.x).abs() + (z - center.z).abs();
            wall.push(WallNode {
                position: Point { x, y: center.y, z },
                tower: ((x - center.x).abs() == wall_radius && (z - center.z).abs() == wall_radius)
                    || along % (tile_size * 2) == 0,
            });
        };
        for offset in -wall_radius..=wall_radius {
            push(center.x + offset, center.z - wall_radius);
            push(center.x + offset, center.z + wall_radius);
        }
        for offset in -wall_radius + 1..wall_radius {
            push(center.x - wall_radius, center.z + offset);
            push(center.x + wall_radius, center.z + offset);
        }
    }
    let lights = tiles
        .iter()
        .enumerate()
        .filter(|(index, _)| {
            *index == 0
                || authored.get(*index) == Some(&"guard-post")
                || authored.get(*index) == Some(&"golem-forge")
                || index % 3 == 0
        })
        .map(|(index, tile)| Light {
            position: Point {
                x: center.x + tile.x * tile_size,
                y: tile_y[index].map(|value| value + 2),
                z: center.z + tile.z * tile_size,
            },
        })
        .chain(dwarf.then_some(Light { position: entrance }))
        .collect();
    Layout {
        center,
        radius: (radius + 2) * tile_size,
        buildings,
        paths: unique_points(paths),
        wall,
        gates: vec![Gate {
            position: entrance,
            facing: gate_facing,
        }],
        approaches: dwarf.then_some(entrance).into_iter().collect(),
        lights,
    }
}

fn palette(faction: Faction) -> Palette {
    match faction {
        Faction::Hobbits => Palette {
            path: Block::GRAVEL,
            perimeter: Block::WILDWOOD_FENCE,
            tower: Block::WILDWOOD_LOG,
            light: Block::WILDWOOD_FENCE,
            wall: Block::PLANKS,
            corner: Block::WILDWOOD_LOG,
            roof: Block::HOBBIT_THATCH,
            floor: Block::PLANKS,
            hall: Block::STONE_BRICK,
        },
        Faction::Goblins => Palette {
            path: Block::GOBLIN_BRASSWORK,
            perimeter: Block::GOBLIN_BRASSWORK,
            tower: Block::GOBLIN_BRASSWORK,
            light: Block::GOBLIN_BRASSWORK,
            wall: Block::GOBLIN_BRASSWORK,
            corner: Block::STONE_BRICK,
            roof: Block::GOBLIN_BRASSWORK,
            floor: Block::PLANKS,
            hall: Block::STONE_BRICK,
        },
        Faction::Atlantians => Palette {
            path: Block::STAR_CORAL,
            perimeter: Block::STAR_CORAL,
            tower: Block::MOON_SLATE,
            light: Block::STAR_CORAL,
            wall: Block::GLASS,
            corner: Block::MOON_SLATE,
            roof: Block::STAR_CORAL,
            floor: Block::MOON_SLATE,
            hall: Block::MOON_SLATE,
        },
        Faction::Sugarcourt => Palette {
            path: Block::SUGAR_SOIL,
            perimeter: Block::BOILED_SUGARBRICK,
            tower: Block::CANDYWOOD_LOG,
            light: Block::CANDYWOOD_LOG,
            wall: Block::BOILED_SUGARBRICK,
            corner: Block::CANDYWOOD_LOG,
            roof: Block::BOILED_SUGARBRICK,
            floor: Block::CANDYWOOD_LOG,
            hall: Block::BOILED_SUGARBRICK,
        },
        Faction::WoodElves => Palette {
            path: Block::MOONBOUGH_LOG,
            perimeter: Block::MOONBOUGH_LEAVES,
            tower: Block::MOONBOUGH_LOG,
            light: Block::MOONBOUGH_LOG,
            wall: Block::MOONBOUGH_LOG,
            corner: Block::MOONBOUGH_LOG,
            roof: Block::MOONBOUGH_LEAVES,
            floor: Block::GLIMMER_GRASS,
            hall: Block::MOONWELL,
        },
        Faction::Dwarves => Palette {
            path: Block::DEEPGEAR_BRICK,
            perimeter: Block::DEEPGEAR_BRICK,
            tower: Block::RIVETED_BRASS,
            light: Block::RIVETED_BRASS,
            wall: Block::DEEPGEAR_BRICK,
            corner: Block::RIVETED_BRASS,
            roof: Block::DEEPGEAR_BRICK,
            floor: Block::DEEPGEAR_BRICK,
            hall: Block::RIVETED_BRASS,
        },
    }
}

fn guild_palette(guild_id: &str) -> Palette {
    match guild_id {
        "tideglass" => Palette {
            path: Block::STAR_CORAL,
            perimeter: Block::MOON_SLATE,
            tower: Block::GLOWSTONE,
            light: Block::STAR_CORAL,
            wall: Block::GLASS,
            corner: Block::MOON_SLATE,
            roof: Block::STAR_CORAL,
            floor: Block::MOON_SLATE,
            hall: Block::MOON_SLATE,
        },
        "moonbough" => Palette {
            path: Block::GLIMMER_GRASS,
            perimeter: Block::MOONBOUGH_LEAVES,
            tower: Block::MOONBOUGH_LOG,
            light: Block::MOONWELL,
            wall: Block::MOONBOUGH_LOG,
            corner: Block::LIVING_ROOT,
            roof: Block::MOONBOUGH_LOG,
            floor: Block::GLIMMER_GRASS,
            hall: Block::MOONWELL,
        },
        "brassroot" => Palette {
            path: Block::GRAVEL,
            perimeter: Block::GOBLIN_BRASSWORK,
            tower: Block::RIVETED_BRASS,
            light: Block::GOBLIN_BRASSWORK,
            wall: Block::GOBLIN_BRASSWORK,
            corner: Block::RIVETED_BRASS,
            roof: Block::STONE_BRICK,
            floor: Block::PLANKS,
            hall: Block::STONE_BRICK,
        },
        "deepgear" => Palette {
            path: Block::DEEPGEAR_BRICK,
            perimeter: Block::DEEPGEAR_BRICK,
            tower: Block::RIVETED_BRASS,
            light: Block::RIVETED_BRASS,
            wall: Block::DEEPGEAR_BRICK,
            corner: Block::RIVETED_BRASS,
            roof: Block::DEEPGEAR_BRICK,
            floor: Block::DEEPGEAR_BRICK,
            hall: Block::RIVETED_BRASS,
        },
        "sugarcourt-makers" => Palette {
            path: Block::SUGAR_SOIL,
            perimeter: Block::BOILED_SUGARBRICK,
            tower: Block::CANDYWOOD_LOG,
            light: Block::CANDYWOOD_LOG,
            wall: Block::BOILED_SUGARBRICK,
            corner: Block::CANDYWOOD_LOG,
            roof: Block::CANDYWOOD_LEAVES,
            floor: Block::CANDYWOOD_LOG,
            hall: Block::BOILED_SUGARBRICK,
        },
        "waykeeper" => Palette {
            path: Block::GRAVEL,
            perimeter: Block::LIVING_ROOT,
            tower: Block::WILDWOOD_LOG,
            light: Block::WILDWOOD_FENCE,
            wall: Block::PLANKS,
            corner: Block::LIVING_ROOT,
            roof: Block::HOBBIT_THATCH,
            floor: Block::PLANKS,
            hall: Block::MEADOW_GRASS,
        },
        _ => Palette {
            path: Block::GRAVEL,
            perimeter: Block::STONE_BRICK,
            tower: Block::WILDWOOD_LOG,
            light: Block::WILDWOOD_FENCE,
            wall: Block::PLANKS,
            corner: Block::WILDWOOD_LOG,
            roof: Block::PLANKS,
            floor: Block::PLANKS,
            hall: Block::STONE_BRICK,
        },
    }
}

fn apply_guild_hall(layout: &mut Layout, hall: Option<&GuildHall>, candidate: &Candidate, numeric_seed: u32) {
    let Some(hall) = hall else {
        return;
    };
    let replaceable = layout
        .buildings
        .iter()
        .enumerate()
        .filter(|(_, building)| {
            !matches!(
                building.role,
                "mayor-hall"
                    | "tide-hall"
                    | "sugar-palace"
                    | "moonbough-hall"
                    | "deepgear-hall"
                    | "guardhouse"
                    | "entrance-barracks"
            )
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let selected = if replaceable.is_empty() {
        layout.buildings.len().checked_sub(1)
    } else {
        let index = ((hash2(candidate.x, candidate.z, numeric_seed ^ 0x71a11) * replaceable.len() as f64).floor()
            as usize)
            .min(replaceable.len() - 1);
        Some(replaceable[index])
    };
    let Some(selected) = selected else {
        return;
    };
    let building = &mut layout.buildings[selected];
    building.width = building.width.max(7);
    building.depth = building.depth.max(7);
    building.furniture.push(Furniture {
        kind: FurnitureKind::Table,
        position: building.position,
        facing: building.facing,
    });
    building.furniture.push(Furniture {
        kind: FurnitureKind::Chair,
        position: Point {
            x: building.position.x + 2,
            ..building.position
        },
        facing: (building.facing + 2) & 3,
    });
    building.furniture.push(Furniture {
        kind: FurnitureKind::Chair,
        position: Point {
            x: building.position.x - 2,
            ..building.position
        },
        facing: building.facing,
    });
    building.guild_hall = Some(hall.clone());
}

fn walk_grid_line(from: Point, to: Point) -> Vec<Point> {
    let mut x = from.x;
    let mut z = from.z;
    let mut points = vec![Point::at(x, from.y.unwrap_or(0), z)];
    while x != to.x || z != to.z {
        let remaining_x = to.x - x;
        let remaining_z = to.z - z;
        if remaining_x != 0 && (remaining_z == 0 || remaining_x.abs() >= remaining_z.abs()) {
            x += remaining_x.signum();
        } else {
            z += remaining_z.signum();
        }
        points.push(Point::at(x, from.y.unwrap_or(0), z));
    }
    points
}

fn deepgear_road(from: Point, to: Point) -> Vec<Point> {
    let dx = to.x - from.x;
    let dz = to.z - from.z;
    let base_steps = dx.abs() + dz.abs();
    let vertical_steps = (to.y.unwrap_or(0) - from.y.unwrap_or(0)).abs();
    let required_steps = vertical_steps + 8;
    let detour = if base_steps < required_steps {
        ((required_steps - base_steps) as f64 / 2.0).ceil() as i32 + 4
    } else {
        0
    };
    let direction = if (from.x ^ from.z ^ to.x ^ to.z) & 1 == 0 {
        1
    } else {
        -1
    };
    let midpoint = Point::surface(
        js_round(f64::from(from.x + to.x) / 2.0),
        js_round(f64::from(from.z + to.z) / 2.0),
    );
    let waypoint = if dx.abs() >= dz.abs() {
        Point::surface(midpoint.x, midpoint.z + detour * direction)
    } else {
        Point::surface(midpoint.x + detour * direction, midpoint.z)
    };
    let horizontal = if detour > 0 {
        let mut first = walk_grid_line(from, waypoint);
        first.extend(walk_grid_line(waypoint, to).into_iter().skip(1));
        first
    } else {
        walk_grid_line(from, to)
    };
    let mut seen = BTreeSet::new();
    let unique = horizontal
        .into_iter()
        .filter(|point| seen.insert((point.x, point.z)))
        .collect::<Vec<_>>();
    let denominator = unique.len().saturating_sub(1).max(1) as f64;
    unique
        .into_iter()
        .enumerate()
        .map(|(index, point)| {
            Point::at(
                point.x,
                js_round(
                    f64::from(from.y.unwrap_or(0))
                        + f64::from(to.y.unwrap_or(0) - from.y.unwrap_or(0)) * index as f64 / denominator,
                ),
                point.z,
            )
        })
        .collect()
}

#[derive(Clone, Copy)]
struct LiftSite {
    x: i32,
    z: i32,
    surface_y: i32,
    bottom_y: i32,
    top_y: i32,
}

fn select_lift(center: Point, radius: i32, hold_y: i32, generator: &TerrainGeneratorV18) -> LiftSite {
    let offset = (radius - 5).max(7);
    let bottom_y = hold_y + 1;
    let mut sites = [
        (offset, 0),
        (0, offset),
        (-offset, 0),
        (0, -offset),
        (offset, offset),
        (-offset, offset),
        (-offset, -offset),
        (offset, -offset),
    ]
    .into_iter()
    .enumerate()
    .map(|(order, (dx, dz))| {
        let x = center.x + dx;
        let z = center.z + dz;
        let surface_y = generator.sample_column(x, z).height;
        let slope = [(1, 0), (-1, 0), (0, 1), (0, -1)]
            .into_iter()
            .map(|(nx, nz)| (generator.sample_column(x + nx * 2, z + nz * 2).height - surface_y).abs())
            .max()
            .unwrap_or(0);
        let rise = surface_y + 1 - bottom_y;
        (order, x, z, surface_y, rise, slope)
    })
    .collect::<Vec<_>>();
    sites.sort_by(|left, right| {
        i32::from(right.4 >= 5)
            .cmp(&i32::from(left.4 >= 5))
            .then_with(|| {
                (f64::from(right.4) - f64::from(right.5) * 1.75)
                    .total_cmp(&(f64::from(left.4) - f64::from(left.5) * 1.75))
            })
            .then_with(|| left.0.cmp(&right.0))
    });
    let (_, x, z, surface_y, _, _) = sites[0];
    LiftSite {
        x,
        z,
        surface_y,
        bottom_y,
        top_y: (surface_y + 1).max(bottom_y + 5),
    }
}

fn clamp_underwater(layout: &mut Layout, generator: &TerrainGeneratorV18) -> bool {
    let mut valid = true;
    let clamp_point = |point: Point, valid: &mut bool| {
        let column = generator.sample_column(point.x, point.z);
        let minimum = column.height + 1;
        let maximum = column.waterline - 1;
        if minimum > maximum {
            *valid = false;
        }
        Point::at(
            point.x,
            point.y.unwrap_or(minimum).clamp(minimum, maximum.max(minimum)),
            point.z,
        )
    };
    for building in &mut layout.buildings {
        let half_width = building.width / 2;
        let half_depth = building.depth / 2;
        let mut highest_bed = MIN_Y;
        let mut lowest_surface = MIN_Y + WORLD_HEIGHT;
        for x in building.position.x - half_width..=building.position.x + half_width {
            for z in building.position.z - half_depth..=building.position.z + half_depth {
                let column = generator.sample_column(x, z);
                highest_bed = highest_bed.max(column.height);
                lowest_surface = lowest_surface.min(column.waterline);
            }
        }
        let roof_rise = (building.floors * 3 + 1).min(5);
        let minimum = highest_bed + 2;
        let maximum = lowest_surface - roof_rise;
        if minimum > maximum {
            valid = false;
            continue;
        }
        let previous = building.position.y.unwrap_or(minimum);
        let next = previous.clamp(minimum, maximum);
        let delta = next - previous;
        building.position.y = Some(next);
        for furniture in &mut building.furniture {
            let requested = Point {
                x: furniture.position.x,
                y: Some(furniture.position.y.unwrap_or(previous) + delta),
                z: furniture.position.z,
            };
            furniture.position = clamp_point(requested, &mut valid);
        }
    }
    layout.center = clamp_point(layout.center, &mut valid);
    for path in &mut layout.paths {
        *path = clamp_point(*path, &mut valid);
    }
    for approach in &mut layout.approaches {
        *approach = clamp_point(*approach, &mut valid);
    }
    for light in &mut layout.lights {
        light.position = clamp_point(light.position, &mut valid);
    }
    valid
}

fn push(placements: &mut Vec<SettlementPlacement>, x: i32, y: i32, z: i32, block: u16) {
    if (MIN_Y..MIN_Y + WORLD_HEIGHT).contains(&y) {
        placements.push(SettlementPlacement { x, y, z, block });
    }
}

fn bed_blocks(facing: u8) -> (u16, u16, i32, i32) {
    match facing & 3 {
        1 => (Block::BED_EAST_FOOT, Block::BED_EAST_HEAD, 1, 0),
        2 => (Block::BED_SOUTH_FOOT, Block::BED_SOUTH_HEAD, 0, 1),
        3 => (Block::BED_WEST_FOOT, Block::BED_WEST_HEAD, -1, 0),
        _ => (Block::BED_NORTH_FOOT, Block::BED_NORTH_HEAD, 0, -1),
    }
}

fn furniture_block(kind: FurnitureKind, facing: u8) -> (u16, Option<(u16, i32, i32)>) {
    match kind {
        FurnitureKind::Bed => {
            let (foot, head, dx, dz) = bed_blocks(facing);
            (foot, Some((head, dx, dz)))
        }
        FurnitureKind::RestAlcove | FurnitureKind::Nest | FurnitureKind::PetBed => (Block::HEARTH_CHAIR, None),
        FurnitureKind::KelpTrough => (Block::LUMEN_KELP, None),
        FurnitureKind::CoralLoom => (Block::CARTOGRAPHY_TABLE, None),
        FurnitureKind::PearlCounter => (Block::CHEST, None),
        FurnitureKind::GlowBasin => (Block::ALCHEMY_STAND, None),
        FurnitureKind::SugarworksKettle | FurnitureKind::SyrupVat => (Block::SUGARWORKS, None),
        FurnitureKind::ConfectionCounter => (Block::WILDWOOD_TABLE, None),
        FurnitureKind::GolemCradle => (Block::GOLEM_FORGE, None),
        FurnitureKind::ManaConduit => (Block::AETHER_CONDUIT, None),
        FurnitureKind::PowderBench => (Block::POWDERWORKS, None),
        FurnitureKind::GearTable => (Block::GEAR_TABLE, None),
        FurnitureKind::BrightLantern => (Block::DEEPGEAR_LANTERN, None),
        FurnitureKind::MoonwellBasin => (Block::MOONWELL, None),
        FurnitureKind::TomeLectern => (Block::TOME_DISPLAY, None),
        FurnitureKind::LivingChair => (Block::MOONBOUGH_CHAIR, None),
        FurnitureKind::WheatMill => (Block::WHEAT_MILL, None),
        FurnitureKind::Chair => (Block::HEARTH_CHAIR, None),
        FurnitureKind::Barrel | FurnitureKind::Distillery => (Block::DISTILLERY, None),
        FurnitureKind::Forge => (Block::FURNACE, None),
        FurnitureKind::BankCounter | FurnitureKind::MerchantCounter => (Block::CHEST, None),
        FurnitureKind::Table => (Block::CARTOGRAPHY_TABLE, None),
        FurnitureKind::Door => (Block::AIR, None),
    }
}

fn civic(role: &str) -> bool {
    matches!(
        role,
        "mayor-hall" | "tide-hall" | "sugar-palace" | "moonbough-hall" | "deepgear-hall"
    )
}

fn stamp(
    candidate: &Candidate,
    layout: &Layout,
    generator: &TerrainGeneratorV18,
    placements: &mut Vec<SettlementPlacement>,
) {
    let palette = palette(candidate.faction);
    let underwater = candidate.environment == Environment::Underwater;
    let underground = candidate.environment == Environment::Underground;
    for point in &layout.paths {
        let column = generator.sample_column(point.x, point.z);
        if underwater || underground {
            let y = point.y.unwrap_or(column.height + 1);
            push(placements, point.x, y, point.z, palette.path);
            if underground {
                for dy in 1..=3 {
                    push(placements, point.x, y + dy, point.z, Block::AIR);
                    if dy <= 2 {
                        for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                            push(placements, point.x + dx, y + dy, point.z + dz, Block::AIR);
                        }
                    }
                }
            }
        } else if column.height > column.waterline {
            push(placements, point.x, column.height, point.z, palette.path);
        }
    }
    for node in &layout.wall {
        let ground = generator.sample_column(node.position.x, node.position.z).height;
        push(
            placements,
            node.position.x,
            ground + 1,
            node.position.z,
            palette.perimeter,
        );
        if node.tower {
            push(placements, node.position.x, ground + 2, node.position.z, palette.tower);
            push(placements, node.position.x, ground + 3, node.position.z, Block::TORCH);
        }
    }
    for gate in &layout.gates {
        let ground = generator.sample_column(gate.position.x, gate.position.z).height;
        let block = if gate.facing % 2 == 0 {
            Block::FENCE_GATE_NORTH_SOUTH_CLOSED
        } else {
            Block::FENCE_GATE_EAST_WEST_CLOSED
        };
        push(placements, gate.position.x, ground + 1, gate.position.z, block);
    }
    for light in &layout.lights {
        let ground = generator.sample_column(light.position.x, light.position.z).height;
        if underwater {
            push(
                placements,
                light.position.x,
                light.position.y.unwrap_or(ground + 2),
                light.position.z,
                Block::GLOWSTONE,
            );
        } else if underground {
            push(
                placements,
                light.position.x,
                light.position.y.unwrap_or(candidate.floor_y.unwrap_or(ground) + 2),
                light.position.z,
                Block::DEEPGEAR_LANTERN,
            );
        } else {
            push(
                placements,
                light.position.x,
                ground + 1,
                light.position.z,
                palette.light,
            );
            push(placements, light.position.x, ground + 2, light.position.z, Block::TORCH);
        }
    }
    for building in &layout.buildings {
        debug_assert!(
            !building.id.is_empty(),
            "authored settlement buildings require stable ids"
        );
        let building_palette = building
            .guild_hall
            .as_ref()
            .map_or(palette, |hall| guild_palette(hall.guild_id));
        let half_width = building.width / 2;
        let half_depth = building.depth / 2;
        let rotated = building.facing % 2 == 1;
        let extent_x = if rotated { half_depth } else { half_width };
        let extent_z = if rotated { half_width } else { half_depth };
        let base_y = if underwater {
            (generator.sample_column(building.position.x, building.position.z).height + 1)
                .max(building.position.y.or(candidate.floor_y).unwrap_or(0) - 1)
        } else if underground {
            building
                .position
                .y
                .or(candidate.floor_y)
                .unwrap_or(generator.sample_column(building.position.x, building.position.z).height - 18)
                - 1
        } else {
            generator.sample_column(building.position.x, building.position.z).height
        };
        let wall_height = building.floors * 3 + 1;
        if candidate.faction == Faction::WoodElves && building.role == "moonwell" {
            for x in building.position.x - 2..=building.position.x + 2 {
                for z in building.position.z - 2..=building.position.z + 2 {
                    for y in base_y + 1..=base_y + 4 {
                        push(placements, x, y, z, Block::AIR);
                    }
                    let edge = (x - building.position.x).abs().max((z - building.position.z).abs()) == 2;
                    if edge {
                        push(placements, x, base_y, z, Block::MOON_SLATE);
                    } else {
                        push(placements, x, base_y - 1, z, Block::MOON_SLATE);
                        let reed = ((x - building.position.x).abs() == 1 && z == building.position.z)
                            || ((z - building.position.z).abs() == 1 && x == building.position.x);
                        push(
                            placements,
                            x,
                            base_y,
                            z,
                            if reed { Block::LUMENREED } else { Block::WATER },
                        );
                    }
                }
            }
            push(
                placements,
                building.position.x + 2,
                base_y + 1,
                building.position.z,
                Block::MOONWELL,
            );
            continue;
        }
        for x in building.position.x - extent_x..=building.position.x + extent_x {
            for z in building.position.z - extent_z..=building.position.z + extent_z {
                let dx = x - building.position.x;
                let dz = z - building.position.z;
                let (u, v) = match building.facing {
                    1 => (dz, -dx),
                    2 => (-dx, -dz),
                    3 => (-dz, dx),
                    _ => (dx, dz),
                };
                let edge_x = u.abs() == half_width;
                let edge_z = v.abs() == half_depth;
                let chamfered = civic(building.role) && edge_x && edge_z;
                if underwater {
                    if chamfered {
                        continue;
                    }
                    let arch = edge_x || edge_z;
                    if arch {
                        push(placements, x, base_y, z, Block::MOON_SLATE);
                    }
                    if edge_x && edge_z {
                        for y in 1..=wall_height.min(4) {
                            push(placements, x, base_y + y, z, building_palette.corner);
                        }
                    } else if arch && ((x + z) & 3) == 0 {
                        push(placements, x, base_y + 2, z, building_palette.wall);
                    }
                    if arch && ((x - building.position.x).abs() + (z - building.position.z).abs()) & 1 == 0 {
                        push(placements, x, base_y + wall_height.min(5), z, building_palette.roof);
                    }
                    continue;
                }
                if underground {
                    for y in base_y..=base_y + wall_height + 2 {
                        push(placements, x, y, z, Block::AIR);
                    }
                    push(
                        placements,
                        x,
                        base_y,
                        z,
                        if building.guild_hall.is_some() || matches!(building.role, "deepgear-hall" | "golem-forge") {
                            building_palette.hall
                        } else {
                            building_palette.floor
                        },
                    );
                    if chamfered {
                        continue;
                    }
                    if edge_x || edge_z {
                        for y in 1..=wall_height {
                            let corner = edge_x && edge_z;
                            let window = !corner && y == 2 && ((x + z) & 3) == 0;
                            push(
                                placements,
                                x,
                                base_y + y,
                                z,
                                if window {
                                    Block::RIVETED_BRASS
                                } else if corner {
                                    building_palette.corner
                                } else {
                                    building_palette.wall
                                },
                            );
                        }
                    }
                    let arch_rise =
                        (2 - (f64::from(u.abs()) / (f64::from(half_width) / 2.0).max(1.0)).floor() as i32).max(0);
                    push(
                        placements,
                        x,
                        base_y + wall_height + 1 + arch_rise,
                        z,
                        building_palette.roof,
                    );
                    continue;
                }
                let local_height = generator.sample_column(x, z).height;
                for y in (local_height + 1).min(base_y)..=base_y {
                    push(placements, x, y, z, building_palette.corner);
                }
                for y in base_y + 1..=(base_y + wall_height + 2).max(local_height + 2) {
                    push(placements, x, y, z, Block::AIR);
                }
                push(
                    placements,
                    x,
                    base_y,
                    z,
                    if building.guild_hall.is_some() || civic(building.role) {
                        building_palette.hall
                    } else {
                        building_palette.floor
                    },
                );
                if chamfered {
                    continue;
                }
                if edge_x || edge_z {
                    for y in 1..=wall_height {
                        let corner = edge_x && edge_z;
                        let window = !corner && y % 3 == 2 && ((x + z) & 3) == 0;
                        push(
                            placements,
                            x,
                            base_y + y,
                            z,
                            if window {
                                Block::GLASS
                            } else if corner {
                                building_palette.corner
                            } else {
                                building_palette.wall
                            },
                        );
                    }
                }
                let roof_rise = match candidate.faction {
                    Faction::Hobbits => {
                        (2 - (f64::from(v.abs()) / (f64::from(half_depth) / 2.0).max(1.0)).floor() as i32).max(0)
                    }
                    Faction::Sugarcourt => (3 - (u.abs() + v.abs()) / half_width.min(half_depth).max(1)).max(0),
                    Faction::WoodElves => {
                        let distance = (f64::from(u) / f64::from(half_width.max(1)))
                            .hypot(f64::from(v) / f64::from(half_depth.max(1)));
                        (2 - (distance * 2.0).floor() as i32).max(0)
                    }
                    Faction::Goblins => i32::from((u + half_width) % 3 == 0) * 2,
                    _ => i32::from((u.abs() + v.abs()) % 3 == 0),
                };
                push(
                    placements,
                    x,
                    base_y + wall_height + 1 + roof_rise,
                    z,
                    building_palette.roof,
                );
            }
        }
        let door = local_point(building.position, building.facing, 0, -half_depth, 0);
        if !underwater || underground {
            let (lower, upper) = if building.facing % 2 == 1 {
                (Block::DOOR_X_CLOSED_LOWER, Block::DOOR_X_CLOSED_UPPER)
            } else {
                (Block::DOOR_CLOSED_LOWER, Block::DOOR_CLOSED_UPPER)
            };
            push(placements, door.x, base_y + 1, door.z, lower);
            push(placements, door.x, base_y + 2, door.z, upper);
        }
        for furniture in &building.furniture {
            if furniture.kind == FurnitureKind::Door {
                continue;
            }
            let y = if underwater || underground {
                furniture.position.y.unwrap_or(base_y + 1)
            } else {
                base_y + 1
            };
            let (block, head) = furniture_block(furniture.kind, furniture.facing);
            push(placements, furniture.position.x, y, furniture.position.z, block);
            if let Some((head_block, dx, dz)) = head {
                push(
                    placements,
                    furniture.position.x + dx,
                    y,
                    furniture.position.z + dz,
                    head_block,
                );
            }
        }
        if let Some(hall) = &building.guild_hall {
            let accent = building_palette.corner;
            for side in [-1, 1] {
                let post = local_point(building.position, building.facing, side * 2, -half_depth - 1, 0);
                push(placements, post.x, base_y + 1, post.z, accent);
                push(
                    placements,
                    post.x,
                    base_y + 2,
                    post.z,
                    if hall.guild_id == "tideglass" {
                        Block::GLOWSTONE
                    } else {
                        Block::TORCH
                    },
                );
            }
        }
    }
}

fn stamp_deepgear_infrastructure(
    candidate: &Candidate,
    layout: &Layout,
    generator: &TerrainGeneratorV18,
    placements: &mut Vec<SettlementPlacement>,
    markers: &mut Vec<(i32, i32, MarkerRow)>,
) -> Vec<Point> {
    let hold_y = candidate
        .floor_y
        .unwrap_or_else(|| (MIN_Y + 10).max(generator.sample_column(candidate.x, candidate.z).height - 18));
    let target = crate::underground::nearest_upper_coordinates(generator.seed(), candidate.x, candidate.z);
    let path = deepgear_road(
        Point::at(candidate.x, hold_y + 2, candidate.z),
        Point::at(target.0, target.1, target.2),
    );
    for point in &path {
        let y = point.y.unwrap_or(hold_y + 2);
        for dy in 0..=3 {
            for dx in -1_i32..=1 {
                for dz in -1_i32..=1 {
                    if dx.abs() + dz.abs() <= 1 {
                        push(placements, point.x + dx, y + dy, point.z + dz, Block::AIR);
                    }
                }
            }
        }
    }
    for point in &path {
        push(
            placements,
            point.x,
            point.y.unwrap_or(hold_y + 2) - 1,
            point.z,
            Block::DEEPGEAR_BRICK,
        );
    }
    let columns = path.iter().map(|point| (point.x, point.z)).collect::<BTreeSet<_>>();
    for point in path.iter().step_by(18) {
        if let Some((dx, dz)) = [(1, 0), (-1, 0), (0, 1), (0, -1)]
            .into_iter()
            .find(|(dx, dz)| !columns.contains(&(point.x + dx, point.z + dz)))
        {
            push(
                placements,
                point.x + dx,
                point.y.unwrap_or(hold_y + 2) + 1,
                point.z + dz,
                Block::DEEPGEAR_LANTERN,
            );
        }
    }

    let lift = select_lift(layout.center, layout.radius, hold_y, generator);
    if lift.top_y - lift.bottom_y >= 5 {
        for y in lift.bottom_y + 1..lift.top_y {
            for dx in -1..=1 {
                for dz in -1..=1 {
                    push(placements, lift.x + dx, y, lift.z + dz, Block::AIR);
                }
            }
            if (y - lift.bottom_y) % 16 == 8 {
                push(placements, lift.x + 2, y, lift.z, Block::DEEPGEAR_LANTERN);
            }
        }
        for dx in -2_i32..=2 {
            for dz in -2_i32..=2 {
                push(
                    placements,
                    lift.x + dx,
                    lift.top_y - 1,
                    lift.z + dz,
                    if dx.abs().max(dz.abs()) == 2 {
                        Block::DEEPGEAR_BRICK
                    } else {
                        Block::AIR
                    },
                );
            }
        }
        for y in lift.surface_y + 1..lift.top_y - 1 {
            for (dx, dz) in [(-2, -2), (2, -2), (-2, 2), (2, 2)] {
                push(placements, lift.x + dx, y, lift.z + dz, Block::DEEPGEAR_BRICK);
            }
        }
        for dy in 1..=3 {
            push(placements, lift.x - 2, lift.top_y + dy, lift.z, Block::RIVETED_BRASS);
            push(placements, lift.x + 2, lift.top_y + dy, lift.z, Block::RIVETED_BRASS);
        }
        for dx in -2..=2 {
            push(placements, lift.x + dx, lift.top_y + 4, lift.z, Block::DEEPGEAR_BRICK);
        }
        push(
            placements,
            lift.x - 2,
            lift.top_y + 2,
            lift.z + 1,
            Block::DEEPGEAR_LANTERN,
        );
        push(
            placements,
            lift.x + 2,
            lift.top_y + 2,
            lift.z + 1,
            Block::DEEPGEAR_LANTERN,
        );
        push(placements, lift.x, lift.bottom_y, lift.z, Block::DEEPGEAR_LIFT);
        push(placements, lift.x, lift.top_y, lift.z, Block::DEEPGEAR_LIFT);
        push(placements, lift.x, lift.top_y + 1, lift.z, Block::AIR);
        push(placements, lift.x, lift.top_y + 2, lift.z, Block::AIR);
        let key = format!("{}:deepgear-lift", candidate.id);
        markers.push((
            lift.x,
            lift.z,
            MarkerRow {
                key: key.clone(),
                canonical_json: format!(
                    "[\"{key}\",{{\"id\":\"{key}\",\"position\":{{\"x\":{},\"y\":{},\"z\":{}}},\"tag\":\"deepgear-lift:{}:cave-graph-anchor\",\"type\":\"landmark\"}}]",
                    lift.x,
                    lift.top_y + 1,
                    lift.z,
                    candidate.id
                ),
            },
        ));
    }
    path
}

fn escape_json(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn json_tags(tags: &[String]) -> String {
    format!(
        "[{}]",
        tags.iter()
            .map(|tag| format!("\"{}\"", escape_json(tag)))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn professions(candidate: &Candidate, count: usize) -> Vec<&'static str> {
    let values: &[&str] = match candidate.faction {
        Faction::WoodElves => &[
            "wood-elf-elderweaver",
            "wood-elf-leafwarden",
            "wood-elf-bow-warden",
            "wood-elf-grovekeeper",
            "wood-elf-tomekeeper",
            "wood-elf-potioner",
            "wood-elf-moonbroker",
            "wood-elf-leafwarden",
            "wood-elf-grovekeeper",
            "wood-elf-bow-warden",
            "wood-elf-moonbroker",
            "wood-elf-grovekeeper",
        ],
        Faction::Dwarves => &[
            "dwarf-thane",
            "dwarf-gatewarden",
            "dwarf-delver",
            "dwarf-gearwright",
            "dwarf-golemsmith",
            "dwarf-powderwright",
            "dwarf-provisioner",
            "dwarf-gatewarden",
            "dwarf-delver",
            "dwarf-golemsmith",
            "dwarf-provisioner",
            "dwarf-delver",
        ],
        Faction::Atlantians => &[
            "atlantian-tidewarden",
            "atlantian-trident-guard",
            "atlantian-kelpkeeper",
            "atlantian-coralwright",
            "atlantian-pearlbroker",
            "atlantian-glowmender",
            "atlantian-trident-guard",
            "atlantian-kelpkeeper",
            "atlantian-coralwright",
            "atlantian-pearlbroker",
        ],
        Faction::Sugarcourt => &[
            "sugarcourt-crown-confectioner",
            "sugarcourt-brittle-guard",
            "sugarcourt-gumdrop-gardener",
            "sugarcourt-sweetbroker",
            "sugarcourt-kennelkeeper",
            "sugarcourt-sugarboiler",
            "sugarcourt-candysmith",
            "sugarcourt-brittle-guard",
            "sugarcourt-gumdrop-gardener",
            "sugarcourt-sweetbroker",
        ],
        Faction::Hobbits | Faction::Goblins => &[
            "mayor",
            "warrior",
            "farmer",
            "general",
            "warrior",
            "general",
            "brewer",
            "banker",
            "farmer",
            "alchemist",
            "blacksmith",
            "general",
        ],
    };
    (0..count)
        .map(|index| {
            if candidate.faction == Faction::Goblins && index >= 6 {
                ["miner", "blacksmith", "alchemist", "warrior", "general", "miner"][(index - 6) % 6]
            } else if candidate.faction == Faction::Hobbits && index >= 6 {
                values[6 + (index - 6) % 6]
            } else {
                values[index % values.len()]
            }
        })
        .collect()
}

fn preferred_role(profession: &str, layout: &Layout) -> &'static str {
    match profession {
        "wood-elf-elderweaver" => "moonbough-hall",
        "wood-elf-leafwarden" | "wood-elf-bow-warden" => "leafwarden-lodge",
        "wood-elf-grovekeeper" => "glow-garden",
        "wood-elf-tomekeeper" => "glimmer-library",
        "wood-elf-potioner" => "moonwell",
        "wood-elf-moonbroker" => "enclave-market",
        "dwarf-thane" => "deepgear-hall",
        "dwarf-gatewarden" => "entrance-barracks",
        "dwarf-delver" => "delver-gallery",
        "dwarf-gearwright" => "blacksmith",
        "dwarf-golemsmith" => "golem-forge",
        "dwarf-powderwright" => "powderworks",
        "dwarf-provisioner" => "gear-market",
        "atlantian-tidewarden" => "tide-hall",
        "atlantian-trident-guard" => "guard-grotto",
        "atlantian-kelpkeeper" => "kelp-garden",
        "atlantian-coralwright" => "coral-workshop",
        "atlantian-pearlbroker" => "pearl-market",
        "atlantian-glowmender" => "glow-clinic",
        "sugarcourt-crown-confectioner" => "sugar-palace",
        "sugarcourt-brittle-guard" => "brittle-barracks",
        "sugarcourt-gumdrop-gardener" => "gumdrop-garden",
        "sugarcourt-sugarboiler" => "sugarworks",
        "sugarcourt-candysmith" => "candysmith",
        "sugarcourt-sweetbroker" => "sweet-market",
        "sugarcourt-kennelkeeper" => "taffy-kennel",
        "mayor" => "mayor-hall",
        "warrior" => "guardhouse",
        "farmer" if layout.buildings.iter().any(|building| building.role == "wheat-mill") => "wheat-mill",
        "farmer" => "farm",
        "miner" => "mine-store",
        "brewer" => "brewery",
        "banker" => "bank",
        "alchemist" => "alchemist",
        "blacksmith" => "blacksmith",
        _ => "home",
    }
}

fn resident_position(building: &Building, resident_index: usize) -> Point {
    let mut occupied = BTreeSet::new();
    for furniture in &building.furniture {
        occupied.insert((furniture.position.x, furniture.position.z));
        if furniture.kind == FurnitureKind::Bed {
            let head = local_point(furniture.position, furniture.facing, 0, -1, 0);
            occupied.insert((head.x, head.z));
        }
    }
    let anchors = [(0, -1), (1, -1), (-1, -1), (0, 1), (1, 1), (-1, 1)];
    for offset in 0..anchors.len() {
        let (x, z) = anchors[(resident_index + offset) % anchors.len()];
        let position = local_point(building.position, building.facing, x, z, 0);
        if !occupied.contains(&(position.x, position.z)) {
            return position;
        }
    }
    local_point(building.position, building.facing, 0, -1, 0)
}

fn resident_name(faction: Faction, seed: &str) -> String {
    let (given, family, salt): (&[&str], &[&str], &str) = match faction {
        Faction::Hobbits => (
            &[
                "Ada", "Bram", "Clover", "Dodie", "Elsin", "Fenn", "Marnie", "Nim", "Pip", "Rosie", "Tobbin", "Willa",
            ],
            &[
                "Barleywick",
                "Bramblebank",
                "Caskbottom",
                "Hearthdown",
                "Mossfoot",
                "Thimbleburrow",
                "Willowmere",
            ],
            "family",
        ),
        Faction::Goblins => (
            &[
                "Bikka", "Dreg", "Fizzik", "Grunna", "Kett", "Mogri", "Nix", "Rakka", "Skrim", "Tazza", "Vekk", "Zib",
            ],
            &[
                "Brassroot",
                "Cinderknuckle",
                "Flintcap",
                "Rattlepot",
                "Rustwhistle",
                "Slatebite",
                "Spindlegear",
            ],
            "clan",
        ),
        Faction::Atlantians => (
            &[
                "Aelune", "Caelis", "Ilyra", "Marev", "Neris", "Oruun", "Selyth", "Thal", "Vaela", "Ysara",
            ],
            &[
                "Bluecurrent",
                "Coralwake",
                "Glassfin",
                "Lumenveil",
                "Pearldeep",
                "Reefsinger",
                "Softtide",
            ],
            "tide",
        ),
        Faction::Sugarcourt => (
            &[
                "Bonnie", "Cinna", "Dulce", "Mallow", "Mint", "Nougat", "Poppy", "Praline", "Toffee", "Truffle",
                "Waffle", "Zest",
            ],
            &[
                "Brittlebrook",
                "Candleglass",
                "Honeyspun",
                "Peppermere",
                "Sugarwick",
                "Taffyfold",
                "Waferby",
            ],
            "family",
        ),
        Faction::WoodElves => (
            &[
                "Aelith", "Caerwyn", "Elaris", "Faelwen", "Irielle", "Lethan", "Naevra", "Oryn", "Sylra", "Thalen",
            ],
            &[
                "Brightfern",
                "Dewbranch",
                "Glowbough",
                "Moonpetal",
                "Silverleaf",
                "Starglen",
                "Whisperroot",
            ],
            "house",
        ),
        Faction::Dwarves => (
            &[
                "Bori", "Dagna", "Eitri", "Frida", "Garrik", "Hildi", "Kelda", "Orik", "Runa", "Torven",
            ],
            &[
                "Brassvein",
                "Deepgear",
                "Emberpin",
                "Ironclock",
                "Lanternmantle",
                "Stonewhistle",
                "Tunnelforge",
            ],
            "house",
        ),
    };
    let given_index = ((unit(seed, "given") * given.len() as f64).floor() as usize).min(given.len() - 1);
    let family_index = ((unit(seed, salt) * family.len() as f64).floor() as usize).min(family.len() - 1);
    format!("{} {}", given[given_index], family[family_index])
}

fn resident_mob(faction: Faction, profession: &'static str, index: usize) -> &'static str {
    match faction {
        Faction::WoodElves => profession,
        Faction::Dwarves => profession,
        Faction::Atlantians => profession,
        Faction::Sugarcourt => profession,
        Faction::Hobbits => match profession {
            "mayor" => "hobbit-mayor",
            "warrior" if index % 4 == 1 => "hobbit-crossbow-guard",
            "warrior" => "hobbit-hammer-guard",
            "farmer" => "hobbit-farmer",
            "miner" | "blacksmith" => "hobbit-miner",
            "banker" => "hobbit-banker",
            _ => "hobbit-merchant",
        },
        Faction::Goblins => match profession {
            "mayor" => "goblin-chieftain",
            "warrior" => "goblin-spear-guard",
            "miner" | "blacksmith" => "goblin-miner",
            "alchemist" => "goblin-alchemist",
            _ => "goblin-worker",
        },
    }
}

fn building_base_y(candidate: &Candidate, building: &Building, generator: &TerrainGeneratorV18) -> i32 {
    if candidate.environment == Environment::Underwater {
        (generator.sample_column(building.position.x, building.position.z).height + 1)
            .max(building.position.y.or(candidate.floor_y).unwrap_or(0) - 1)
    } else if candidate.environment == Environment::Underground {
        building
            .position
            .y
            .or(candidate.floor_y)
            .unwrap_or(generator.sample_column(building.position.x, building.position.z).height - 18)
            - 1
    } else {
        generator.sample_column(building.position.x, building.position.z).height
    }
}

fn spawn_marker(
    key: String,
    id: String,
    position: Point,
    mob: &str,
    count: u32,
    tags: Vec<String>,
    radius: f64,
) -> MarkerRow {
    MarkerRow {
        key: key.clone(),
        canonical_json: format!(
            "[\"{}\",{{\"count\":{},\"id\":\"{}\",\"mobKind\":\"{}\",\"persistent\":true,\"position\":{{\"x\":{},\"y\":{},\"z\":{}}},\"radius\":{},\"tags\":{},\"type\":\"spawn\"}}]",
            escape_json(&key),
            count,
            escape_json(&id),
            escape_json(mob),
            position.x,
            position.y.unwrap_or(0),
            position.z,
            radius,
            json_tags(&tags),
        ),
    }
}

#[derive(Clone, Copy)]
struct GuildPrincipal {
    id: &'static str,
    name: &'static str,
    role: &'static str,
    schedule: &'static str,
    recruitable: bool,
}

fn guild_principals(guild_id: &str) -> &'static [GuildPrincipal] {
    const WAYKEEPER: &[GuildPrincipal] = &[
        GuildPrincipal {
            id: "odelia-fen",
            name: "Odelia Fen",
            role: "Guildmaster",
            schedule: "dawn: inspects sanctuary releases|day: walks the teaching meadow|dusk: hears welfare cases|night: writes corridor orders",
            recruitable: false,
        },
        GuildPrincipal {
            id: "garrick-coil",
            name: "Garrick Coil",
            role: "Capture engineer",
            schedule: "dawn: calibrates care instruments|day: repairs instruments at the public bench|dusk: compares field notes to readings|night: tests quiet mechanisms",
            recruitable: false,
        },
        GuildPrincipal {
            id: "pella-reedshoe",
            name: "Pella Reedshoe",
            role: "Field naturalist",
            schedule: "dawn: listens beside Button's burrow|day: surveys migration signs|dusk: sketches shelter plans|night: shelters at the field blind",
            recruitable: true,
        },
    ];
    const TIDEGLASS: &[GuildPrincipal] = &[
        GuildPrincipal {
            id: "neris-nine-lights",
            name: "Neris Nine-Lights",
            role: "Curator",
            schedule: "dawn: trims nine observation lamps|day: catalogs the teaching reef|dusk: names only verified sightings|night: descends with the blue lamps",
            recruitable: false,
        },
        GuildPrincipal {
            id: "oru-kelpbraid",
            name: "Oru Kelpbraid",
            role: "Habitat handler",
            schedule: "dawn: feeds the Reefmender colony|day: repairs coral stations|dusk: scrubs tools the shrimp rearranged|night: checks nursery currents",
            recruitable: false,
        },
        GuildPrincipal {
            id: "sela-wakequiet",
            name: "Sela Wakequiet",
            role: "Diver",
            schedule: "dawn: checks safety lines from shore|day: retrieves submerged losses|dusk: maps sealed wreck exits|night: rests beside her Currentweaver",
            recruitable: true,
        },
    ];
    const MOONBOUGH: &[GuildPrincipal] = &[
        GuildPrincipal {
            id: "saelith-veyr",
            name: "Saelith Veyr",
            role: "First Bough",
            schedule: "dawn: audits interrupted rituals|day: teaches at the Three Laws court|dusk: hears concealed-risk reports|night: seals unstable archive wings",
            recruitable: false,
        },
        GuildPrincipal {
            id: "fenna-glassleaf",
            name: "Fenna Glassleaf",
            role: "Conjuration scholar",
            schedule: "dawn: reviews summon clauses|day: interviews manifested parties|dusk: feeds the Runeowl and revises contracts|night: observes the Palimpsest chamber",
            recruitable: false,
        },
        GuildPrincipal {
            id: "orren-third-bell",
            name: "Orren Third-Bell",
            role: "Hush-scarred mage",
            schedule: "dawn: practices one quiet ward|day: guides Hush crossings|dusk: rests between measured bells|night: records tolerable resonance",
            recruitable: true,
        },
    ];
    const BRASSROOT: &[GuildPrincipal] = &[
        GuildPrincipal {
            id: "korga-bent-spear",
            name: "Korga Bent-Spear",
            role: "Guildmaster",
            schedule: "dawn: inspects surrender chalk|day: arbitrates public contracts|dusk: drills measured force|night: annotates the Red Ledger",
            recruitable: false,
        },
        GuildPrincipal {
            id: "nix-three-receipts",
            name: "Nix Three-Receipts",
            role: "Quartermaster",
            schedule: "dawn: balances the repair purse|day: prices contracts in public|dusk: audits damage claims|night: files three signed copies",
            recruitable: false,
        },
        GuildPrincipal {
            id: "bram-coalgrin",
            name: "Bram Coalgrin",
            role: "Outrider",
            schedule: "dawn: runs Toll beside the caravan gate|day: escorts exposed road legs|dusk: practices rescue pulls|night: sleeps in the border stable",
            recruitable: true,
        },
    ];
    const DEEPGEAR: &[GuildPrincipal] = &[
        GuildPrincipal {
            id: "edda-rivetbraid",
            name: "Edda Rivetbraid",
            role: "Union keeper",
            schedule: "dawn: reads the overnight brace log|day: inspects active shifts|dusk: hears safety refusals|night: marks tomorrow's retreat routes",
            recruitable: false,
        },
        GuildPrincipal {
            id: "tovin-chalkmark",
            name: "Tovin Chalkmark",
            role: "Surveyor",
            schedule: "dawn: listens to cold rock|day: surveys the four-vein gallery|dusk: labels unresolved samples|night: compares resonance intervals",
            recruitable: false,
        },
        GuildPrincipal {
            id: "hessa-deepnote",
            name: "Hessa Deepnote",
            role: "Rescue engineer",
            schedule: "dawn: checks Pipet's collapse marks|day: braces rescue routes|dusk: repairs cover plates|night: sleeps beside the union cache",
            recruitable: true,
        },
    ];
    const HEARTHROAD: &[GuildPrincipal] = &[
        GuildPrincipal {
            id: "mara-bramblemap",
            name: "Mara Bramblemap",
            role: "League master",
            schedule: "dawn: updates road-event notes|day: walks one disputed route|dusk: debriefs expeditions over supper|night: redraws the Common Map",
            recruitable: false,
        },
        GuildPrincipal {
            id: "pip-underbridge",
            name: "Pip Underbridge",
            role: "Wayhouse keeper",
            schedule: "dawn: listens to the old Burrowbell|day: tends wayhouse beds|dusk: counts late travelers|night: watches the storm gate",
            recruitable: false,
        },
        GuildPrincipal {
            id: "rowan-mileglass",
            name: "Rowan Mileglass",
            role: "Cartographer",
            schedule: "dawn: checks yesterday's ink|day: draws while walking|dusk: compares Petalfox scent marks|night: copies maps at the wayhouse",
            recruitable: true,
        },
    ];
    const SUGARCOURT: &[GuildPrincipal] = &[
        GuildPrincipal {
            id: "dame-caramel-voss",
            name: "Dame Caramel Voss",
            role: "Steward",
            schedule: "dawn: tests oven temper by sound|day: inspects traveling provisions|dusk: hears maker failures|night: writes durable recipes",
            recruitable: false,
        },
        GuildPrincipal {
            id: "prill-snapcandy",
            name: "Prill Snapcandy",
            role: "Experimental maker",
            schedule: "dawn: labels yesterday's accidents|day: tests substitutions|dusk: traces counterfeit batches|night: observes living batter",
            recruitable: false,
        },
        GuildPrincipal {
            id: "taff-ribbons",
            name: "Taff Ribbons",
            role: "Courier-chef",
            schedule: "dawn: packs road meals with Knot|day: runs deliveries between factions|dusk: repairs the kitchen axle|night: feeds late arrivals",
            recruitable: true,
        },
    ];
    match guild_id {
        "waykeeper" => WAYKEEPER,
        "tideglass" => TIDEGLASS,
        "moonbough" => MOONBOUGH,
        "brassroot" => BRASSROOT,
        "deepgear" => DEEPGEAR,
        "hearthroad" => HEARTHROAD,
        "sugarcourt-makers" => SUGARCOURT,
        _ => &[],
    }
}

fn guild_npc_mob(faction: Faction, index: usize) -> &'static str {
    const ATLANTIAN: [&str; 3] = ["atlantian-tidewarden", "atlantian-kelpkeeper", "atlantian-glowmender"];
    const ELF: [&str; 3] = ["wood-elf-elderweaver", "wood-elf-tomekeeper", "wood-elf-leafwarden"];
    const DWARF: [&str; 3] = ["dwarf-thane", "dwarf-delver", "dwarf-gearwright"];
    const GOBLIN: [&str; 3] = ["goblin-chieftain", "goblin-worker", "goblin-spear-guard"];
    const SUGAR: [&str; 3] = [
        "sugarcourt-crown-confectioner",
        "sugarcourt-sweetbroker",
        "sugarcourt-candysmith",
    ];
    const HOBBIT: [&str; 3] = ["hobbit-mayor", "hobbit-merchant", "hobbit-hammer-guard"];
    match faction {
        Faction::Atlantians => ATLANTIAN[index % 3],
        Faction::WoodElves => ELF[index % 3],
        Faction::Dwarves => DWARF[index % 3],
        Faction::Goblins => GOBLIN[index % 3],
        Faction::Sugarcourt => SUGAR[index % 3],
        Faction::Hobbits => HOBBIT[index % 3],
    }
}

fn guild_principal_markers(
    candidate: &Candidate,
    building: &Building,
    hall: &GuildHall,
    generator: &TerrainGeneratorV18,
) -> Vec<(i32, i32, MarkerRow)> {
    let base_y = building_base_y(candidate, building, generator);
    guild_principals(hall.guild_id)
        .iter()
        .enumerate()
        .map(|(index, npc)| {
            let position = local_point(
                building.position,
                building.facing,
                (index as i32 - 1) * 2,
                if index == 1 { 1 } else { 0 },
                0,
            );
            let id = format!("guild-npc:{}:{}", npc.id, candidate.id);
            let key = format!("{}:spawn:{id}", candidate.id);
            let mut tags = vec![
                format!("settlement:{}", candidate.id),
                format!("resident:{id}"),
                format!("name:{}", npc.name),
                format!("profession:guild:{}:{}", hall.guild_id, npc.id),
                format!("faction:{}", candidate.faction.id()),
                format!("guild:{}", hall.guild_id),
                format!("guild-role:{}", npc.role),
                format!("schedule:{}", npc.schedule),
            ];
            if npc.recruitable {
                tags.push("recruitable:true".into());
            }
            (
                position.x,
                position.z,
                spawn_marker(
                    key,
                    id,
                    Point::at(position.x, base_y + 1, position.z),
                    guild_npc_mob(candidate.faction, index),
                    1,
                    tags,
                    0.25,
                ),
            )
        })
        .collect()
}

fn aligned_spawn(
    candidate: &Candidate,
    generator: &TerrainGeneratorV18,
    id: String,
    kind: &'static str,
    position: Point,
) -> (i32, i32, MarkerRow) {
    let y = position
        .y
        .unwrap_or_else(|| generator.sample_column(position.x, position.z).height + 1);
    let key = format!("{}:spawn:{id}", candidate.id);
    let radius = if kind == "webspinner-golem" { 0.35 } else { 2.5 };
    (
        position.x,
        position.z,
        spawn_marker(
            key,
            id,
            Point::at(position.x, y, position.z),
            kind,
            1,
            vec![
                format!("settlement:{}", candidate.id),
                format!("faction:{}", candidate.faction.id()),
                "aligned:true".into(),
            ],
            radius,
        ),
    )
}

fn aligned_markers(
    candidate: &Candidate,
    layout: &Layout,
    generator: &TerrainGeneratorV18,
) -> Vec<(i32, i32, MarkerRow)> {
    let mut rows = Vec::new();
    match candidate.faction {
        Faction::WoodElves => {
            for (index, gate) in layout.gates.iter().take(2).enumerate() {
                rows.push(aligned_spawn(
                    candidate,
                    generator,
                    format!("{}-glimmerhart-founding-{index}", candidate.id),
                    "glimmerhart",
                    gate.position,
                ));
            }
            for (index, building) in layout
                .buildings
                .iter()
                .filter(|building| building.role == "glimmer-library")
                .take(2)
                .enumerate()
            {
                rows.push(aligned_spawn(
                    candidate,
                    generator,
                    format!("{}-runeowl-founding-{index}", candidate.id),
                    "runeowl",
                    building.position,
                ));
            }
        }
        Faction::Dwarves => {
            let gate = layout.gates.first().map_or(layout.center, |gate| gate.position);
            for (index, offset) in [-2, 2].into_iter().enumerate() {
                rows.push(aligned_spawn(
                    candidate,
                    generator,
                    format!("{}-copper-scout-founding-{index}", candidate.id),
                    "copper-scout-golem",
                    Point {
                        x: gate.x + offset,
                        ..gate
                    },
                ));
            }
            let hound_gate = layout.gates.last().map_or(gate, |entry| entry.position);
            rows.push(aligned_spawn(
                candidate,
                generator,
                format!("{}-clockwork-hound-founding", candidate.id),
                "clockwork-hound-golem",
                Point {
                    z: hound_gate.z + 2,
                    ..hound_gate
                },
            ));
            if let Some(forge) = layout.buildings.iter().find(|building| building.role == "golem-forge") {
                rows.push(aligned_spawn(
                    candidate,
                    generator,
                    format!("{}-webspinner-founding", candidate.id),
                    "webspinner-golem",
                    local_point(forge.position, forge.facing, -2, 1, 0),
                ));
            }
            for (index, building) in layout
                .buildings
                .iter()
                .filter(|building| building.role == "stone-home")
                .take(2)
                .enumerate()
            {
                rows.push(aligned_spawn(
                    candidate,
                    generator,
                    format!("{}-copper-mole-founding-{index}", candidate.id),
                    "copper-mole",
                    building.position,
                ));
            }
        }
        Faction::Goblins => {
            for (index, gate) in layout.gates.iter().take(3).enumerate() {
                rows.push(aligned_spawn(
                    candidate,
                    generator,
                    format!("{}-warg-founding-{index}", candidate.id),
                    "warg",
                    gate.position,
                ));
            }
        }
        Faction::Sugarcourt => {
            for (index, gate) in layout.gates.iter().take(3).enumerate() {
                rows.push(aligned_spawn(
                    candidate,
                    generator,
                    format!("{}-taffy-hound-founding-{index}", candidate.id),
                    "taffy-hound",
                    gate.position,
                ));
            }
            for (index, building) in layout
                .buildings
                .iter()
                .filter(|building| matches!(building.role, "bonbon-home" | "sweet-market"))
                .take(3)
                .enumerate()
            {
                rows.push(aligned_spawn(
                    candidate,
                    generator,
                    format!("{}-praline-cat-founding-{index}", candidate.id),
                    "praline-cat",
                    building.position,
                ));
            }
        }
        Faction::Atlantians | Faction::Hobbits => {}
    }
    rows
}

fn glowfin_markers(
    candidate: &Candidate,
    layout: &Layout,
    generator: &TerrainGeneratorV18,
) -> Vec<(i32, i32, MarkerRow)> {
    if candidate.faction != Faction::WoodElves {
        return Vec::new();
    }
    layout
        .buildings
        .iter()
        .filter(|building| building.role == "moonwell")
        .map(|building| {
            let base_y = building_base_y(candidate, building, generator);
            let id = format!("{}:glowfin-shoal", building.id);
            let key = format!("{}:spawn:{id}", candidate.id);
            (
                building.position.x,
                building.position.z,
                spawn_marker(
                    key,
                    id,
                    Point::at(building.position.x, base_y, building.position.z),
                    "glowfin",
                    2,
                    vec![
                        format!("settlement:{}", candidate.id),
                        "faction:wood-elves".into(),
                        "habitat:glimmer-pond".into(),
                        "aligned:true".into(),
                    ],
                    1.25,
                ),
            )
        })
        .collect()
}

fn resident_markers(
    candidate: &Candidate,
    layout: &Layout,
    seed: &str,
    generator: &TerrainGeneratorV18,
) -> Vec<(i32, i32, MarkerRow)> {
    let count = match candidate.size {
        Size::Hamlet => 7,
        Size::Village => 15,
        Size::Town => 26,
    };
    let mut assignments = BTreeMap::<String, usize>::new();
    let mut rows = Vec::new();
    for (index, profession) in professions(candidate, count).into_iter().enumerate() {
        let role = preferred_role(profession, layout);
        let mut candidates = layout
            .buildings
            .iter()
            .filter(|building| building.role == role)
            .collect::<Vec<_>>();
        if candidates.is_empty() {
            candidates = layout
                .buildings
                .iter()
                .filter(|building| matches!(building.role, "home" | "living-home" | "stone-home" | "bonbon-home"))
                .collect();
        }
        if candidates.is_empty() {
            candidates = layout.buildings.iter().collect();
        }
        let assignment_key = candidates
            .iter()
            .map(|building| building.id.as_str())
            .collect::<Vec<_>>()
            .join("|");
        let assignment_index = assignments.entry(assignment_key).or_default();
        let building = candidates.get(*assignment_index % candidates.len()).copied();
        let local_index = *assignment_index;
        *assignment_index += 1;
        let id = format!("{}-resident-{index}", candidate.id);
        let position = building.map_or(layout.center, |entry| resident_position(entry, local_index));
        let y = building.map_or_else(
            || {
                position
                    .y
                    .unwrap_or_else(|| generator.sample_column(position.x, position.z).height + 1)
            },
            |entry| building_base_y(candidate, entry, generator) + 1,
        );
        let name = resident_name(candidate.faction, &format!("{seed}|{id}"));
        let key = format!("{}:spawn:{id}", candidate.id);
        let marker = spawn_marker(
            key,
            id.clone(),
            Point::at(position.x, y, position.z),
            resident_mob(candidate.faction, profession, index),
            1,
            vec![
                format!("settlement:{}", candidate.id),
                format!("resident:{id}"),
                format!("name:{name}"),
                format!("profession:{profession}"),
                format!("faction:{}", candidate.faction.id()),
                "authored-interior-spawn".into(),
            ],
            0.25,
        );
        rows.push((position.x, position.z, marker));
    }
    rows
}

/** The single pre-stamp materialization order used by extraction and locators. */
fn materialized_layout(
    candidate: &Candidate,
    hall: Option<&GuildHall>,
    seed: &str,
    generator: &TerrainGeneratorV18,
) -> Option<Layout> {
    let mut layout = if matches!(candidate.faction, Faction::WoodElves | Faction::Dwarves) {
        v1_layout(candidate, seed)
    } else {
        standard_layout(candidate, seed)
    };
    apply_guild_hall(&mut layout, hall, candidate, generator.seed());
    if candidate.environment == Environment::Underwater && !clamp_underwater(&mut layout, generator) {
        return None;
    }
    Some(layout)
}

/// Extracts one accepted candidate into a chunk-independent plan. Callers
/// filter placements and marker ownership by chunk after all feature families
/// have been ordered.
pub(crate) fn extract(
    candidate: &Candidate,
    hall: Option<&GuildHall>,
    seed: &str,
    generator: &TerrainGeneratorV18,
) -> Option<Extraction> {
    let layout = materialized_layout(candidate, hall, seed, generator)?;
    let mut placements = Vec::new();
    let mut markers = Vec::new();
    let deepgear_path = if candidate.environment == Environment::Underground
        && generator.profile() == GenerationProfile::WorldBelowV15
    {
        stamp_deepgear_infrastructure(candidate, &layout, generator, &mut placements, &mut markers)
    } else {
        Vec::new()
    };
    stamp(candidate, &layout, generator, &mut placements);
    for point in &deepgear_path {
        if f64::from(point.x - candidate.x).hypot(f64::from(point.z - candidate.z)) < 6.0 {
            continue;
        }
        let y = point.y.unwrap_or(candidate.floor_y.unwrap_or(0) + 2);
        push(&mut placements, point.x, y - 1, point.z, Block::DEEPGEAR_BRICK);
        for dy in 0..=3 {
            push(&mut placements, point.x, y + dy, point.z, Block::AIR);
        }
    }
    let center_y = candidate.floor_y.map_or_else(
        || generator.sample_column(candidate.x, candidate.z).height + 2,
        |floor| floor + 2,
    );
    let map_layer = match candidate.environment {
        Environment::Surface => "surface",
        Environment::Underwater => "underwater",
        Environment::Underground => "underground",
    };
    let key = format!("{}:landmark:{}", candidate.id, candidate.id);
    let id = escape_json(&candidate.id);
    let tag = format!(
        "settlement:{}:{}",
        candidate.faction.id(),
        match candidate.size {
            Size::Hamlet => "hamlet",
            Size::Village => "village",
            Size::Town => "town",
        }
    );
    let marker = MarkerRow {
        key: key.clone(),
        canonical_json: format!(
            "[\"{key}\",{{\"id\":\"{id}\",\"mapLayer\":\"{map_layer}\",\"position\":{{\"x\":{},\"y\":{center_y},\"z\":{}}},\"tag\":\"{tag}\",\"type\":\"landmark\"}}]",
            candidate.x, candidate.z
        ),
    };
    markers.push((candidate.x, candidate.z, marker));
    for building in &layout.buildings {
        let Some(hall) = &building.guild_hall else {
            continue;
        };
        let half_depth = building.depth / 2;
        let front = local_point(building.position, building.facing, 0, -half_depth - 1, 0);
        let base_y = if candidate.environment == Environment::Underwater {
            (generator.sample_column(building.position.x, building.position.z).height + 1)
                .max(building.position.y.or(candidate.floor_y).unwrap_or(0) - 1)
        } else if candidate.environment == Environment::Underground {
            building
                .position
                .y
                .or(candidate.floor_y)
                .unwrap_or(generator.sample_column(building.position.x, building.position.z).height - 18)
                - 1
        } else {
            generator.sample_column(building.position.x, building.position.z).height
        };
        let placement_id = escape_json(&hall.placement_id);
        let key = format!("{}:guild-hall:{}", candidate.id, hall.placement_id);
        let guild_id = hall.guild_id;
        let tag = escape_json(&format!("guild-hall:{guild_id}:lodge:{}", candidate.id));
        markers.push((
            building.position.x,
            building.position.z,
            MarkerRow {
                key: key.clone(),
                canonical_json: format!(
                    "[\"{key}\",{{\"id\":\"{placement_id}\",\"position\":{{\"x\":{},\"y\":{},\"z\":{}}},\"tag\":\"{tag}\",\"type\":\"landmark\"}}]",
                    front.x,
                    base_y + 1,
                    front.z
                ),
            },
        ));
        markers.extend(guild_principal_markers(candidate, building, hall, generator));
    }
    markers.extend(resident_markers(candidate, &layout, seed, generator));
    markers.extend(aligned_markers(candidate, &layout, generator));
    markers.extend(glowfin_markers(candidate, &layout, generator));
    Some((placements, markers, layout.radius))
}

/// Canonical public arrival from the same Rust layout that stamps the
/// settlement. Fixed-point Y preserves the legacy half-block player offset
/// without introducing a float wire representation.
pub(crate) fn public_arrival(
    candidate: &Candidate,
    hall: Option<&GuildHall>,
    seed: &str,
    generator: &TerrainGeneratorV18,
    breathes_water: bool,
) -> Option<PublicArrival> {
    let layout = materialized_layout(candidate, hall, seed, generator)?;
    let gate = layout.gates.first().copied();
    let public_anchor = gate.map_or_else(
        || layout.approaches.first().copied().unwrap_or(layout.center),
        |value| value.position,
    );
    let (offset_x, offset_z) = gate.map_or((0, 0), |value| match value.facing {
        0 => (0, -4),
        1 => (4, 0),
        2 => (0, 4),
        _ => (-4, 0),
    });
    let arrival_x = public_anchor.x + offset_x;
    let arrival_z = public_anchor.z + offset_z;
    let column = generator.sample_column(arrival_x, arrival_z);
    let (y_millis, anchor_kind) = match candidate.environment {
        Environment::Underwater if breathes_water => {
            let floor = candidate.floor_y.unwrap_or(column.height) + 2;
            let anchor = public_anchor.y.unwrap_or(column.height + 2);
            (floor.max(anchor).max(column.height + 2) * 1_000, "public-approach")
        }
        Environment::Underwater => (column.waterline * 1_000 + 1_510, "reef-air-arrival"),
        Environment::Underground => (column.height * 1_000 + 1_510, "surface-entry"),
        Environment::Surface => (column.height * 1_000 + 1_510, "public-approach"),
    };
    Some(PublicArrival {
        x: arrival_x,
        y_millis,
        z: arrival_z,
        anchor_kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::GenerationOptions;
    use crate::settlement::SettlementBiome;

    #[test]
    fn hobbit_population_repeats_professions_without_repeating_civic_leaders() {
        let candidate = Candidate {
            id: "freehold--3-1-vxnce6".into(),
            region_x: -3,
            region_z: 1,
            x: -1_117,
            z: 819,
            floor_y: None,
            size: Size::Village,
            faction: Faction::Hobbits,
            biome: SettlementBiome::FlowerMeadow,
            environment: Environment::Surface,
        };

        assert_eq!(
            professions(&candidate, 26),
            vec![
                "mayor",
                "warrior",
                "farmer",
                "general",
                "warrior",
                "general",
                "brewer",
                "banker",
                "farmer",
                "alchemist",
                "blacksmith",
                "general",
                "brewer",
                "banker",
                "farmer",
                "alchemist",
                "blacksmith",
                "general",
                "brewer",
                "banker",
                "farmer",
                "alchemist",
                "blacksmith",
                "general",
                "brewer",
                "banker",
            ]
        );
    }

    #[test]
    fn connected_tiles_are_stable_and_connected() {
        let first = connected_tiles("settlement-fixture", 16, 3);
        let second = connected_tiles("settlement-fixture", 16, 3);
        assert_eq!(
            first
                .iter()
                .map(|tile| (tile.x, tile.z, tile.connections))
                .collect::<Vec<_>>(),
            second
                .iter()
                .map(|tile| (tile.x, tile.z, tile.connections))
                .collect::<Vec<_>>()
        );
        assert_eq!(first.len(), 16);
        assert!(first.iter().all(|tile| tile.x.abs() <= 3 && tile.z.abs() <= 3));
    }

    #[test]
    fn underwater_materialization_rejects_shallow_workshop_at_exact_oracle_extrema() {
        let seed = "LOCATOR-ALL-FILTERS";
        let generator = TerrainGeneratorV18::new(seed, GenerationOptions::default());
        let candidate = Candidate {
            id: "tidehold--f--d-1hoh2dk".into(),
            region_x: -15,
            region_z: -13,
            x: -7_607,
            z: -6_478,
            floor_y: Some(16),
            size: Size::Village,
            faction: Faction::Atlantians,
            biome: SettlementBiome::DeepOcean,
            environment: Environment::Underwater,
        };
        let mut layout = standard_layout(&candidate, seed);
        let workshop = layout
            .buildings
            .iter()
            .find(|building| building.id == "tidehold--f--d-1hoh2dk-tile-21")
            .expect("exact shallow workshop exists");
        assert_eq!(
            (
                workshop.role,
                workshop.position.x,
                workshop.position.z,
                workshop.position.y,
                workshop.width,
                workshop.depth,
                workshop.floors
            ),
            ("coral-workshop", -7_574, -6_500, Some(24), 7, 6, 1),
        );
        let mut highest = (i32::MIN, 0, 0);
        let mut lowest_waterline = i32::MAX;
        for x in -7_577..=-7_571 {
            for z in -6_503..=-6_497 {
                let column = generator.sample_column(x, z);
                if column.height > highest.0 {
                    highest = (column.height, x, z);
                }
                lowest_waterline = lowest_waterline.min(column.waterline);
            }
        }
        assert_eq!(highest, (30, -7_571, -6_503));
        assert_eq!(lowest_waterline, 32);
        assert_eq!(highest.0 + 2, 32);
        assert_eq!(lowest_waterline - (workshop.floors * 3 + 1).min(5), 28);
        assert!(!clamp_underwater(&mut layout, &generator));
        assert_eq!(public_arrival(&candidate, None, seed, &generator, false), None);
    }
}
