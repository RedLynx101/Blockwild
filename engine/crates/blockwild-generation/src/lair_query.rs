use crate::contract::{GenerationError, parse_flat_options};
use crate::dragon::{LairQuery, query_nearest_lair};
use crate::generator::TerrainGeneratorV18;
use crate::locator_wire::{
    MAX_ID_BYTES, MAX_OPTIONS_BYTES, MAX_SEED_BYTES, Reader, Writer, valid_canonical_world_options_json, valid_hash,
};
use blockwild_types::CanonicalHasher;
use std::collections::BTreeSet;

const REQUEST_MAGIC: [u8; 4] = *b"BWLQ";
const RESULT_MAGIC: [u8; 4] = *b"BWLR";
const SCHEMA: u16 = 1;
const MAX_EXCLUDED_IDS: usize = 4_096;
const ORIGIN_BOUND_MILLIS: i64 = 2_147_400_000_000;

#[derive(Clone, Debug)]
struct Request {
    seed: String,
    options_json: String,
    origin_x_millis: i64,
    origin_z_millis: i64,
    dragon_type: String,
    minimum_stage: u8,
    excluded_ids: BTreeSet<String>,
    maximum_region_radius: u16,
    request_hash: String,
}

impl Request {
    fn expected_hash(&self) -> String {
        let mut hasher = CanonicalHasher::new("blockwild-lair-query-v1");
        hasher.write_str(&self.seed);
        hasher.write_str(&self.options_json);
        hasher.write_u64(self.origin_x_millis as u64);
        hasher.write_u64(self.origin_z_millis as u64);
        hasher.write_str(&self.dragon_type);
        hasher.write_u16(u16::from(self.minimum_stage));
        hasher.write_u16(u16::try_from(self.excluded_ids.len()).expect("bounded exclusions"));
        for value in &self.excluded_ids {
            hasher.write_str(value);
        }
        hasher.write_u16(self.maximum_region_radius);
        hasher.finish().to_hex()
    }
}

pub(crate) fn query_packet(bytes: &[u8]) -> Result<Vec<u8>, GenerationError> {
    let request = decode_request(bytes)?;
    if request.expected_hash() != request.request_hash {
        return Err(GenerationError::Wire("lair query request hash mismatch".into()));
    }
    let generator = TerrainGeneratorV18::new(&request.seed, parse_flat_options(&request.options_json)?);
    let result = query_nearest_lair(
        &request.seed,
        &generator,
        LairQuery {
            origin_x_millis: request.origin_x_millis,
            origin_z_millis: request.origin_z_millis,
            dragon_type: &request.dragon_type,
            minimum_stage: request.minimum_stage,
            excluded_ids: &request.excluded_ids,
            maximum_region_radius: request.maximum_region_radius,
        },
    );
    let mut writer = Writer::new(RESULT_MAGIC, "lair query");
    writer.u16(SCHEMA);
    writer.string(&request.request_hash, 32)?;
    let mut hasher = CanonicalHasher::new("blockwild-lair-query-result-v1");
    hasher.write_str(&request.request_hash);
    if let Some(located) = result {
        writer.u8(1);
        let candidate = located.candidate;
        let id = candidate.id();
        let (x, y, z) = candidate.position();
        let dragon_type = candidate.dragon_type();
        let stage = candidate.stage();
        let sex = candidate.sex();
        writer.string(&id, MAX_ID_BYTES)?;
        writer.string(dragon_type, 16)?;
        writer.u8(stage);
        writer.string(sex, 8)?;
        writer.i32(x);
        writer.i32(y);
        writer.i32(z);
        writer.u64(located.distance_squared);
        hasher.write_u16(1);
        hasher.write_str(&id);
        hasher.write_str(dragon_type);
        hasher.write_u16(u16::from(stage));
        hasher.write_str(sex);
        hasher.write_i32(x);
        hasher.write_i32(y);
        hasher.write_i32(z);
        hasher.write_u64(located.distance_squared);
    } else {
        writer.u8(0);
        hasher.write_u16(0);
    }
    writer.string(&hasher.finish().to_hex(), 32)?;
    writer.finish()
}

fn decode_request(bytes: &[u8]) -> Result<Request, GenerationError> {
    let mut reader = Reader::new(bytes, REQUEST_MAGIC, "lair query")?;
    if reader.u16()? != SCHEMA {
        return Err(GenerationError::Wire("lair query schema mismatch".into()));
    }
    let seed = reader.string(MAX_SEED_BYTES)?;
    let options_json = reader.string(MAX_OPTIONS_BYTES)?;
    let origin_x_millis = reader.i64()?;
    let origin_z_millis = reader.i64()?;
    let dragon_type = reader.string(16)?;
    let minimum_stage = reader.u8()?;
    let excluded_count = usize::from(reader.u16()?);
    if excluded_count > MAX_EXCLUDED_IDS {
        return Err(GenerationError::Wire("lair exclusions exceed bound".into()));
    }
    let mut excluded_ids = BTreeSet::new();
    let mut previous = None::<String>;
    for _ in 0..excluded_count {
        let value = reader.string(MAX_ID_BYTES)?;
        if value.is_empty() || previous.as_ref().is_some_and(|entry| entry >= &value) {
            return Err(GenerationError::Wire(
                "lair exclusions are not unique and sorted".into(),
            ));
        }
        excluded_ids.insert(value.clone());
        previous = Some(value);
    }
    let maximum_region_radius = reader.u16()?;
    let request_hash = reader.string(32)?;
    reader.done()?;
    if seed.is_empty()
        || !valid_canonical_world_options_json(&options_json)
        || !(-ORIGIN_BOUND_MILLIS..=ORIGIN_BOUND_MILLIS).contains(&origin_x_millis)
        || !(-ORIGIN_BOUND_MILLIS..=ORIGIN_BOUND_MILLIS).contains(&origin_z_millis)
        || !matches!(
            dragon_type.as_str(),
            "fire" | "ice" | "steel" | "gold" | "silver" | "sea"
        )
        || !(3..=5).contains(&minimum_stage)
        || !(1..=64).contains(&maximum_region_radius)
        || !valid_hash(&request_hash)
    {
        return Err(GenerationError::Wire("lair query is outside canonical bounds".into()));
    }
    Ok(Request {
        seed,
        options_json,
        origin_x_millis,
        origin_z_millis,
        dragon_type,
        minimum_stage,
        excluded_ids,
        maximum_region_radius,
        request_hash,
    })
}
