use crate::contract::{GenerationError, parse_flat_options};
use crate::generator::TerrainGeneratorV18;
use crate::locator_wire::{
    MAX_ID_BYTES, MAX_OPTIONS_BYTES, MAX_SEED_BYTES, Reader, Writer, valid_canonical_world_options_json, valid_hash,
};
use crate::settlement::{Environment, Faction, NearestCandidateQuery, Size, query_nearest_candidates};
use crate::settlement_layout::public_arrival;
use blockwild_types::CanonicalHasher;
use std::collections::BTreeSet;

const REQUEST_MAGIC: [u8; 4] = *b"BWSQ";
const RESULT_MAGIC: [u8; 4] = *b"BWSR";
const SCHEMA: u16 = 1;
const MAX_EXCLUDED_IDS: usize = 4_096;
const MAX_RESULTS: u8 = 32;
const MAX_RADIUS: u16 = 96;
const ORIGIN_BOUND_MILLIS: i64 = 2_147_400_000_000;

#[derive(Clone, Debug)]
struct Request {
    seed: String,
    options_json: String,
    origin_x_millis: i64,
    origin_z_millis: i64,
    faction_ids: Option<Vec<String>>,
    factions: Option<BTreeSet<Faction>>,
    size_ids: Option<Vec<String>>,
    sizes: Option<BTreeSet<Size>>,
    environment_ids: Option<Vec<String>>,
    environments: Option<BTreeSet<Environment>>,
    excluded_ids: BTreeSet<String>,
    maximum_region_radius: u16,
    limit: u8,
    breathes_water: bool,
    request_hash: String,
}

fn write_string_set<'a>(hasher: &mut CanonicalHasher, values: impl ExactSizeIterator<Item = &'a str>) {
    hasher.write_u16(u16::try_from(values.len()).expect("bounded locator set"));
    for value in values {
        hasher.write_str(value);
    }
}

impl Request {
    fn expected_hash(&self) -> String {
        let mut hasher = CanonicalHasher::new("blockwild-settlement-query-v1");
        hasher.write_str(&self.seed);
        hasher.write_str(&self.options_json);
        hasher.write_u64(self.origin_x_millis as u64);
        hasher.write_u64(self.origin_z_millis as u64);
        for values in [&self.faction_ids, &self.size_ids, &self.environment_ids] {
            hasher.write_u16(u16::from(values.is_some()));
            if let Some(values) = values {
                write_string_set(&mut hasher, values.iter().map(String::as_str));
            }
        }
        hasher.write_u16(u16::try_from(self.excluded_ids.len()).expect("bounded exclusions"));
        for value in &self.excluded_ids {
            hasher.write_str(value);
        }
        hasher.write_u16(self.maximum_region_radius);
        hasher.write_u16(u16::from(self.limit));
        hasher.write_u16(u16::from(self.breathes_water));
        hasher.finish().to_hex()
    }
}

pub(crate) fn query_packet(bytes: &[u8]) -> Result<Vec<u8>, GenerationError> {
    let request = decode_request(bytes)?;
    if request.expected_hash() != request.request_hash {
        return Err(GenerationError::Wire("settlement query request hash mismatch".into()));
    }
    let options = parse_flat_options(&request.options_json)?;
    let generator = TerrainGeneratorV18::new(&request.seed, options);
    let located = query_nearest_candidates(
        &request.seed,
        &generator,
        NearestCandidateQuery {
            origin_x_millis: request.origin_x_millis,
            origin_z_millis: request.origin_z_millis,
            factions: request.factions.as_ref(),
            sizes: request.sizes.as_ref(),
            environments: request.environments.as_ref(),
            excluded_ids: &request.excluded_ids,
            maximum_region_radius: request.maximum_region_radius,
            limit: request.limit,
        },
        |candidate, hall| public_arrival(candidate, hall, &request.seed, &generator, request.breathes_water).is_some(),
    );
    let mut rows = Vec::with_capacity(located.len());
    for entry in located {
        let arrival = public_arrival(
            &entry.candidate,
            entry.guild_hall.as_ref(),
            &request.seed,
            &generator,
            request.breathes_water,
        );
        rows.push((
            entry,
            arrival.expect("locator admitted only materializable settlements"),
        ));
    }

    let mut result_hasher = CanonicalHasher::new("blockwild-settlement-query-result-v1");
    result_hasher.write_str(&request.request_hash);
    result_hasher.write_u16(u16::try_from(rows.len()).expect("bounded result count"));
    let mut writer = Writer::new(RESULT_MAGIC, "settlement query");
    writer.u16(SCHEMA);
    writer.string(&request.request_hash, 32)?;
    writer.u8(u8::try_from(rows.len()).expect("bounded result count"));
    for (entry, arrival) in &rows {
        let candidate = &entry.candidate;
        writer.string(&candidate.id, MAX_ID_BYTES)?;
        writer.string(candidate.faction.id(), 16)?;
        writer.string(candidate.size.id(), 16)?;
        writer.string(candidate.environment.id(), 16)?;
        writer.string(candidate.biome.id(), 32)?;
        writer.i32(candidate.region_x);
        writer.i32(candidate.region_z);
        writer.i32(candidate.x);
        writer.i32(candidate.z);
        if let Some(floor_y) = candidate.floor_y {
            writer.u8(1);
            writer.i32(floor_y);
        } else {
            writer.u8(0);
        }
        writer.u64(entry.distance_squared);
        writer.i32(arrival.x);
        writer.i32(arrival.y_millis);
        writer.i32(arrival.z);
        writer.string(arrival.anchor_kind, 32)?;

        result_hasher.write_str(&candidate.id);
        result_hasher.write_str(candidate.faction.id());
        result_hasher.write_str(candidate.size.id());
        result_hasher.write_str(candidate.environment.id());
        result_hasher.write_str(candidate.biome.id());
        result_hasher.write_i32(candidate.region_x);
        result_hasher.write_i32(candidate.region_z);
        result_hasher.write_i32(candidate.x);
        result_hasher.write_i32(candidate.z);
        result_hasher.write_u16(u16::from(candidate.floor_y.is_some()));
        if let Some(floor_y) = candidate.floor_y {
            result_hasher.write_i32(floor_y);
        }
        result_hasher.write_u64(entry.distance_squared);
        result_hasher.write_i32(arrival.x);
        result_hasher.write_i32(arrival.y_millis);
        result_hasher.write_i32(arrival.z);
        result_hasher.write_str(arrival.anchor_kind);
    }
    writer.string(&result_hasher.finish().to_hex(), 32)?;
    writer.finish()
}

type DecodedOptionalSortedSet<T> = (Option<Vec<String>>, Option<BTreeSet<T>>);

fn decode_optional_sorted_set<T: Ord>(
    reader: &mut Reader<'_>,
    maximum: usize,
    parse: impl Fn(&str) -> Option<T>,
    label: &str,
) -> Result<DecodedOptionalSortedSet<T>, GenerationError> {
    let present = match reader.u8()? {
        0 => return Ok((None, None)),
        1 => true,
        _ => {
            return Err(GenerationError::Wire(format!(
                "settlement query {label} presence flag is invalid"
            )));
        }
    };
    debug_assert!(present);
    let count = usize::from(reader.u8()?);
    if count > maximum {
        return Err(GenerationError::Wire(format!("settlement query {label} exceeds bound")));
    }
    let mut output = BTreeSet::new();
    let mut ids = Vec::with_capacity(count);
    let mut previous = None::<String>;
    for _ in 0..count {
        let value = reader.string(32)?;
        if previous.as_ref().is_some_and(|entry| entry >= &value) {
            return Err(GenerationError::Wire(format!(
                "settlement query {label} is not unique and sorted"
            )));
        }
        let parsed = parse(&value)
            .ok_or_else(|| GenerationError::Wire(format!("settlement query {label} contains an invalid value")))?;
        output.insert(parsed);
        ids.push(value.clone());
        previous = Some(value);
    }
    Ok((Some(ids), Some(output)))
}

fn decode_request(bytes: &[u8]) -> Result<Request, GenerationError> {
    let mut reader = Reader::new(bytes, REQUEST_MAGIC, "settlement query")?;
    if reader.u16()? != SCHEMA {
        return Err(GenerationError::Wire("settlement query schema mismatch".into()));
    }
    let seed = reader.string(MAX_SEED_BYTES)?;
    let options_json = reader.string(MAX_OPTIONS_BYTES)?;
    let origin_x_millis = reader.i64()?;
    let origin_z_millis = reader.i64()?;
    let (faction_ids, factions) = decode_optional_sorted_set(&mut reader, 6, Faction::from_id, "factions")?;
    let (size_ids, sizes) = decode_optional_sorted_set(&mut reader, 3, Size::from_id, "sizes")?;
    let (environment_ids, environments) =
        decode_optional_sorted_set(&mut reader, 3, Environment::from_id, "environments")?;
    let excluded_count = usize::from(reader.u16()?);
    if excluded_count > MAX_EXCLUDED_IDS {
        return Err(GenerationError::Wire("settlement query exclusions exceed bound".into()));
    }
    let mut excluded_ids = BTreeSet::new();
    let mut previous = None::<String>;
    for _ in 0..excluded_count {
        let value = reader.string(MAX_ID_BYTES)?;
        if value.is_empty() || previous.as_ref().is_some_and(|entry| entry >= &value) {
            return Err(GenerationError::Wire(
                "settlement query exclusions are not unique and sorted".into(),
            ));
        }
        excluded_ids.insert(value.clone());
        previous = Some(value);
    }
    let maximum_region_radius = reader.u16()?;
    let limit = reader.u8()?;
    let breathes_water = match reader.u8()? {
        0 => false,
        1 => true,
        _ => return Err(GenerationError::Wire("settlement query water flag is invalid".into())),
    };
    let request_hash = reader.string(32)?;
    reader.done()?;
    if seed.is_empty()
        || !valid_canonical_world_options_json(&options_json)
        || !(-ORIGIN_BOUND_MILLIS..=ORIGIN_BOUND_MILLIS).contains(&origin_x_millis)
        || !(-ORIGIN_BOUND_MILLIS..=ORIGIN_BOUND_MILLIS).contains(&origin_z_millis)
        || maximum_region_radius > MAX_RADIUS
        || !(1..=MAX_RESULTS).contains(&limit)
        || !valid_hash(&request_hash)
    {
        return Err(GenerationError::Wire(
            "settlement query is outside canonical bounds".into(),
        ));
    }
    Ok(Request {
        seed,
        options_json,
        origin_x_millis,
        origin_z_millis,
        faction_ids,
        factions,
        size_ids,
        sizes,
        environment_ids,
        environments,
        excluded_ids,
        maximum_region_radius,
        limit,
        breathes_water,
        request_hash,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canonical_request() -> Vec<u8> {
        let mut request = Request {
            seed: "locator-test".into(),
            options_json: r#"{"biomeScale":1.35,"caveFrequency":1,"enabledFactions":["hobbits","goblins","atlantians","sugarcourt","wood-elves","dwarves"],"largeTownFrequency":"balanced","origin":{"mode":"wilderness"},"profile":"world-below-v15","resourceAbundance":1,"roadCoverage":"regional","settlementClustering":"regional","settlementDensity":1,"settlementPattern":"heartlands-v2","structures":true}"#.into(),
            origin_x_millis: -513_250,
            origin_z_millis: 777_750,
            faction_ids: Some(vec!["atlantians".into(), "hobbits".into()]),
            factions: Some([Faction::Atlantians, Faction::Hobbits].into_iter().collect()),
            size_ids: Some(vec!["town".into(), "village".into()]),
            sizes: Some([Size::Village, Size::Town].into_iter().collect()),
            environment_ids: None,
            environments: None,
            excluded_ids: ["settlement-a".into(), "settlement-b".into()].into_iter().collect(),
            maximum_region_radius: 18,
            limit: 4,
            breathes_water: false,
            request_hash: String::new(),
        };
        request.request_hash = request.expected_hash();
        let mut writer = Writer::new(REQUEST_MAGIC, "settlement query");
        writer.u16(SCHEMA);
        writer.string(&request.seed, MAX_SEED_BYTES).unwrap();
        writer.string(&request.options_json, MAX_OPTIONS_BYTES).unwrap();
        writer.i64(request.origin_x_millis);
        writer.i64(request.origin_z_millis);
        writer.u8(1);
        writer.u8(2);
        writer.string("atlantians", 32).unwrap();
        writer.string("hobbits", 32).unwrap();
        writer.u8(1);
        writer.u8(2);
        writer.string("town", 32).unwrap();
        writer.string("village", 32).unwrap();
        writer.u8(0);
        writer.u16(2);
        writer.string("settlement-a", MAX_ID_BYTES).unwrap();
        writer.string("settlement-b", MAX_ID_BYTES).unwrap();
        writer.u16(18);
        writer.u8(4);
        writer.u8(0);
        writer.string(&request.request_hash, 32).unwrap();
        writer.finish().unwrap()
    }

    #[test]
    fn canonical_packet_is_bounded_and_hash_bound() {
        let bytes = canonical_request();
        assert!(query_packet(&bytes).is_ok());
        let mut tampered = bytes.clone();
        tampered[12] ^= 1;
        assert!(query_packet(&tampered).is_err());
        let mut trailing = bytes;
        trailing.push(0);
        assert!(query_packet(&trailing).is_err());
    }
}
