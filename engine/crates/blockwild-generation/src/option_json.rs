use std::fmt;

pub(crate) const CANONICAL_NPC_FACTION_IDS: [&str; 6] = [
    "hobbits",
    "goblins",
    "atlantians",
    "sugarcourt",
    "wood-elves",
    "dwarves",
];

const MAX_WORLD_OPTIONS_BYTES: usize = 8 * 1024;
const WORLD_OPTION_KEYS: [&str; 12] = [
    "biomeScale",
    "caveFrequency",
    "enabledFactions",
    "largeTownFrequency",
    "origin",
    "profile",
    "resourceAbundance",
    "roadCoverage",
    "settlementClustering",
    "settlementDensity",
    "settlementPattern",
    "structures",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WorldOptionsShape {
    /// A live locator request carries every normalized world option, including
    /// the presentation-only origin selector.
    ExactLocator,
    /// Chunk generation accepts the canonical sorted subset produced by the
    /// generic generation contract. Missing fields select documented defaults.
    GenerationPatch,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ParsedWorldOptions<'a> {
    pub(crate) biome_scale: Option<f64>,
    pub(crate) cave_frequency: Option<f64>,
    pub(crate) enabled_factions: Option<Vec<&'a str>>,
    pub(crate) large_town_frequency: Option<&'a str>,
    pub(crate) profile: Option<&'a str>,
    pub(crate) resource_abundance: Option<f64>,
    pub(crate) road_coverage: Option<&'a str>,
    pub(crate) settlement_clustering: Option<&'a str>,
    pub(crate) settlement_density: Option<f64>,
    pub(crate) settlement_pattern: Option<&'a str>,
    pub(crate) structures: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WorldOptionsJsonError(String);

impl fmt::Display for WorldOptionsJsonError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

fn invalid(message: impl Into<String>) -> WorldOptionsJsonError {
    WorldOptionsJsonError(message.into())
}

/// Parse one canonical world-options object without normalizing, searching, or
/// consulting any platform JSON implementation. Only exact top-level field
/// slices are interpreted; nested values can never spoof generation fields.
pub(crate) fn parse_world_options_json(
    value: &str,
    shape: WorldOptionsShape,
) -> Result<ParsedWorldOptions<'_>, WorldOptionsJsonError> {
    if value.len() > MAX_WORLD_OPTIONS_BYTES {
        return Err(invalid("world options exceed the canonical byte bound"));
    }
    let mut parser = CanonicalJsonParser::new(value.as_bytes());
    parser
        .take(b'{')
        .ok_or_else(|| invalid("world options must be a canonical JSON object"))?;
    let mut output = ParsedWorldOptions::default();
    let mut previous_key = None::<&[u8]>;
    let mut fields = 0_usize;

    if parser.peek() == Some(b'}') {
        parser.offset += 1;
    } else {
        loop {
            let key_bytes = parser
                .string()
                .ok_or_else(|| invalid("world option keys must be unescaped printable ASCII"))?;
            if previous_key.is_some_and(|previous| previous >= key_bytes) {
                return Err(invalid("world option keys must be sorted and unique"));
            }
            previous_key = Some(key_bytes);
            let key = std::str::from_utf8(key_bytes).map_err(|_| invalid("world option keys must be ASCII"))?;
            if WORLD_OPTION_KEYS.binary_search(&key).is_err() {
                return Err(invalid(format!("unknown world option {key}")));
            }
            parser
                .take(b':')
                .ok_or_else(|| invalid("world option key is missing its value separator"))?;
            let value_start = parser.offset;
            parser
                .value()
                .ok_or_else(|| invalid(format!("world option {key} is not canonical JSON")))?;
            let encoded = parser
                .bytes
                .get(value_start..parser.offset)
                .ok_or_else(|| invalid("world option value is out of bounds"))?;
            assign_world_option(&mut output, key, encoded)?;
            fields += 1;

            match parser.peek() {
                Some(b',') => parser.offset += 1,
                Some(b'}') => {
                    parser.offset += 1;
                    break;
                }
                _ => return Err(invalid("world options object is malformed")),
            }
        }
    }

    if parser.offset != parser.bytes.len() {
        return Err(invalid("world options contain trailing bytes"));
    }
    if shape == WorldOptionsShape::ExactLocator && fields != WORLD_OPTION_KEYS.len() {
        return Err(invalid("locator world options must contain all twelve fields"));
    }
    Ok(output)
}

pub(crate) fn valid_canonical_world_options_json(value: &str) -> bool {
    parse_world_options_json(value, WorldOptionsShape::ExactLocator).is_ok()
}

fn assign_world_option<'a>(
    output: &mut ParsedWorldOptions<'a>,
    key: &str,
    encoded: &'a [u8],
) -> Result<(), WorldOptionsJsonError> {
    match key {
        "biomeScale" => output.biome_scale = Some(bounded_number(encoded, 0.25, 4.0, key)?),
        "caveFrequency" => output.cave_frequency = Some(bounded_number(encoded, 0.0, 3.0, key)?),
        "enabledFactions" => output.enabled_factions = Some(enabled_factions(encoded)?),
        "largeTownFrequency" => {
            output.large_town_frequency = Some(enum_string(encoded, &["rare", "balanced", "frequent"], key)?)
        }
        "origin" => validate_world_origin(encoded)?,
        "profile" => output.profile = Some(enum_string(encoded, &["legacy-v14", "world-below-v15"], key)?),
        "resourceAbundance" => output.resource_abundance = Some(bounded_number(encoded, 0.25, 4.0, key)?),
        "roadCoverage" => {
            output.road_coverage = Some(enum_string(encoded, &["none", "local", "regional", "dense"], key)?)
        }
        "settlementClustering" => {
            output.settlement_clustering = Some(enum_string(encoded, &["even", "regional", "strong"], key)?)
        }
        "settlementDensity" => output.settlement_density = Some(bounded_number(encoded, 0.0, 2.0, key)?),
        "settlementPattern" => {
            output.settlement_pattern = Some(enum_string(encoded, &["legacy-scattered-v1", "heartlands-v2"], key)?)
        }
        "structures" => {
            output.structures = Some(match encoded {
                b"true" => true,
                b"false" => false,
                _ => return Err(invalid("world option structures must be a boolean")),
            });
        }
        _ => return Err(invalid(format!("unknown world option {key}"))),
    }
    Ok(())
}

fn bounded_number(encoded: &[u8], minimum: f64, maximum: f64, key: &str) -> Result<f64, WorldOptionsJsonError> {
    let token = std::str::from_utf8(encoded).map_err(|_| invalid(format!("world option {key} must be ASCII")))?;
    let decimals = token.split_once('.').map_or(0, |(_, fraction)| fraction.len());
    if decimals > 2 {
        return Err(invalid(format!("world option {key} exceeds two decimal places")));
    }
    token
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite() && *number >= minimum && *number <= maximum)
        .ok_or_else(|| invalid(format!("world option {key} is outside its canonical bounds")))
}

fn enum_string<'a>(encoded: &'a [u8], allowed: &[&str], key: &str) -> Result<&'a str, WorldOptionsJsonError> {
    let value = decoded_string(encoded).ok_or_else(|| invalid(format!("world option {key} must be a string")))?;
    allowed
        .contains(&value)
        .then_some(value)
        .ok_or_else(|| invalid(format!("world option {key} contains an unsupported value")))
}

fn decoded_string(encoded: &[u8]) -> Option<&str> {
    let mut parser = CanonicalJsonParser::new(encoded);
    let bytes = parser.string()?;
    (parser.offset == parser.bytes.len())
        .then(|| std::str::from_utf8(bytes).ok())
        .flatten()
}

fn enabled_factions(encoded: &[u8]) -> Result<Vec<&str>, WorldOptionsJsonError> {
    let mut parser = CanonicalJsonParser::new(encoded);
    parser
        .take(b'[')
        .ok_or_else(|| invalid("world option enabledFactions must be an array"))?;
    let mut result = Vec::with_capacity(CANONICAL_NPC_FACTION_IDS.len());
    let mut previous_rank = None::<usize>;
    if parser.peek() == Some(b']') {
        parser.offset += 1;
    } else {
        loop {
            let bytes = parser
                .string()
                .ok_or_else(|| invalid("enabled faction IDs must be unescaped strings"))?;
            let faction = std::str::from_utf8(bytes).map_err(|_| invalid("enabled faction IDs must be ASCII"))?;
            let rank = CANONICAL_NPC_FACTION_IDS
                .iter()
                .position(|allowed| *allowed == faction)
                .ok_or_else(|| invalid("enabledFactions contains an unknown faction"))?;
            if previous_rank.is_some_and(|previous| previous >= rank) {
                return Err(invalid("enabledFactions must be unique and preserve registry order"));
            }
            previous_rank = Some(rank);
            result.push(faction);
            match parser.peek() {
                Some(b',') => parser.offset += 1,
                Some(b']') => {
                    parser.offset += 1;
                    break;
                }
                _ => return Err(invalid("enabledFactions is malformed")),
            }
        }
    }
    if parser.offset != parser.bytes.len() {
        return Err(invalid("enabledFactions contains trailing bytes"));
    }
    Ok(result)
}

fn validate_world_origin(encoded: &[u8]) -> Result<(), WorldOptionsJsonError> {
    let mut parser = CanonicalJsonParser::new(encoded);
    parser
        .take(b'{')
        .ok_or_else(|| invalid("world option origin must be an object"))?;
    let first_key = parser
        .string()
        .ok_or_else(|| invalid("world option origin is missing its first field"))?;
    parser
        .take(b':')
        .ok_or_else(|| invalid("world option origin is malformed"))?;
    if first_key == b"mode" {
        let mode = decoded_string_at(&mut parser).ok_or_else(|| invalid("world origin mode must be a string"))?;
        if !matches!(mode, "wilderness" | "near-any-settlement") {
            return Err(invalid("world origin mode is unsupported"));
        }
    } else if first_key == b"factionId" {
        let faction =
            decoded_string_at(&mut parser).ok_or_else(|| invalid("world origin factionId must be a string"))?;
        if !CANONICAL_NPC_FACTION_IDS.contains(&faction) {
            return Err(invalid("world origin factionId is unsupported"));
        }
        parser
            .take(b',')
            .ok_or_else(|| invalid("culture-settlement origin is missing minimumSize"))?;
        expect_key(&mut parser, b"minimumSize")?;
        let size =
            decoded_string_at(&mut parser).ok_or_else(|| invalid("world origin minimumSize must be a string"))?;
        if !matches!(size, "hamlet" | "village" | "town") {
            return Err(invalid("world origin minimumSize is unsupported"));
        }
        parser
            .take(b',')
            .ok_or_else(|| invalid("culture-settlement origin is missing mode"))?;
        expect_key(&mut parser, b"mode")?;
        if decoded_string_at(&mut parser) != Some("culture-settlement") {
            return Err(invalid("culture-settlement origin has an invalid mode"));
        }
    } else {
        return Err(invalid("world origin contains an unknown or unsorted field"));
    }
    parser
        .take(b'}')
        .ok_or_else(|| invalid("world option origin contains extra or malformed fields"))?;
    if parser.offset != parser.bytes.len() {
        return Err(invalid("world option origin contains trailing bytes"));
    }
    Ok(())
}

fn expect_key(parser: &mut CanonicalJsonParser<'_>, expected: &[u8]) -> Result<(), WorldOptionsJsonError> {
    if parser.string() != Some(expected) || parser.take(b':').is_none() {
        return Err(invalid(
            "world origin fields must have the exact canonical shape and order",
        ));
    }
    Ok(())
}

fn decoded_string_at<'a>(parser: &mut CanonicalJsonParser<'a>) -> Option<&'a str> {
    std::str::from_utf8(parser.string()?).ok()
}

struct CanonicalJsonParser<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> CanonicalJsonParser<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.offset).copied()
    }

    fn take(&mut self, expected: u8) -> Option<()> {
        (self.peek()? == expected).then(|| self.offset += 1)
    }

    fn literal(&mut self, expected: &[u8]) -> Option<()> {
        let end = self.offset.checked_add(expected.len())?;
        (self.bytes.get(self.offset..end)? == expected).then(|| self.offset = end)
    }

    fn string(&mut self) -> Option<&'a [u8]> {
        self.take(b'"')?;
        let start = self.offset;
        while let Some(byte) = self.peek() {
            if byte == b'"' {
                let result = self.bytes.get(start..self.offset)?;
                self.offset += 1;
                return Some(result);
            }
            // World option keys and values are fixed printable ASCII enums.
            // Escapes and whitespace are unnecessary and fail closed.
            if !(0x21..=0x7e).contains(&byte) || byte == b'\\' {
                return None;
            }
            self.offset += 1;
        }
        None
    }

    fn number(&mut self) -> Option<()> {
        let start = self.offset;
        if self.peek() == Some(b'-') {
            self.offset += 1;
        }
        match self.peek()? {
            b'0' => {
                self.offset += 1;
                if self.peek().is_some_and(|byte| byte.is_ascii_digit()) {
                    return None;
                }
            }
            b'1'..=b'9' => {
                while self.peek().is_some_and(|byte| byte.is_ascii_digit()) {
                    self.offset += 1;
                }
            }
            _ => return None,
        }
        if self.peek() == Some(b'.') {
            self.offset += 1;
            let fraction_start = self.offset;
            while self.peek().is_some_and(|byte| byte.is_ascii_digit()) {
                self.offset += 1;
            }
            if fraction_start == self.offset || self.bytes[self.offset - 1] == b'0' {
                return None;
            }
        }
        (self.bytes.get(start..self.offset)? != b"-0").then_some(())
    }

    fn array(&mut self) -> Option<()> {
        self.take(b'[')?;
        if self.peek() == Some(b']') {
            self.offset += 1;
            return Some(());
        }
        loop {
            self.value()?;
            match self.peek()? {
                b',' => self.offset += 1,
                b']' => {
                    self.offset += 1;
                    return Some(());
                }
                _ => return None,
            }
        }
    }

    fn object(&mut self) -> Option<()> {
        self.take(b'{')?;
        if self.peek() == Some(b'}') {
            self.offset += 1;
            return Some(());
        }
        let mut previous = None::<&[u8]>;
        loop {
            let key = self.string()?;
            if previous.is_some_and(|entry| entry >= key) {
                return None;
            }
            previous = Some(key);
            self.take(b':')?;
            self.value()?;
            match self.peek()? {
                b',' => self.offset += 1,
                b'}' => {
                    self.offset += 1;
                    return Some(());
                }
                _ => return None,
            }
        }
    }

    fn value(&mut self) -> Option<()> {
        match self.peek()? {
            b'{' => self.object(),
            b'[' => self.array(),
            b'"' => self.string().map(|_| ()),
            b't' => self.literal(b"true"),
            b'f' => self.literal(b"false"),
            b'n' => self.literal(b"null"),
            b'-' | b'0'..=b'9' => self.number(),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL_OPTIONS: &str = r#"{"biomeScale":1.35,"caveFrequency":1,"enabledFactions":["hobbits","goblins","atlantians","sugarcourt","wood-elves","dwarves"],"largeTownFrequency":"balanced","origin":{"mode":"wilderness"},"profile":"world-below-v15","resourceAbundance":1,"roadCoverage":"regional","settlementClustering":"regional","settlementDensity":1,"settlementPattern":"heartlands-v2","structures":true}"#;

    #[test]
    fn exact_locator_requires_all_twelve_fields_while_generation_accepts_sorted_patches() {
        assert_eq!(
            parse_world_options_json(FULL_OPTIONS, WorldOptionsShape::ExactLocator),
            Ok(ParsedWorldOptions {
                biome_scale: Some(1.35),
                cave_frequency: Some(1.0),
                enabled_factions: Some(CANONICAL_NPC_FACTION_IDS.to_vec()),
                large_town_frequency: Some("balanced"),
                profile: Some("world-below-v15"),
                resource_abundance: Some(1.0),
                road_coverage: Some("regional"),
                settlement_clustering: Some("regional"),
                settlement_density: Some(1.0),
                settlement_pattern: Some("heartlands-v2"),
                structures: Some(true),
            })
        );
        assert!(parse_world_options_json("{}", WorldOptionsShape::GenerationPatch).is_ok());
        assert!(parse_world_options_json("{}", WorldOptionsShape::ExactLocator).is_err());
        let full_without_origin = FULL_OPTIONS.replace(r#","origin":{"mode":"wilderness"}"#, "");
        assert!(parse_world_options_json(&full_without_origin, WorldOptionsShape::GenerationPatch).is_ok());
        assert!(parse_world_options_json(&full_without_origin, WorldOptionsShape::ExactLocator).is_err());

        let singletons = [
            r#"{"biomeScale":1.35}"#,
            r#"{"caveFrequency":1}"#,
            r#"{"enabledFactions":[]}"#,
            r#"{"largeTownFrequency":"rare"}"#,
            r#"{"origin":{"mode":"near-any-settlement"}}"#,
            r#"{"profile":"legacy-v14"}"#,
            r#"{"resourceAbundance":4}"#,
            r#"{"roadCoverage":"none"}"#,
            r#"{"settlementClustering":"strong"}"#,
            r#"{"settlementDensity":0}"#,
            r#"{"settlementPattern":"legacy-scattered-v1"}"#,
            r#"{"structures":false}"#,
        ];
        for singleton in singletons {
            assert!(
                parse_world_options_json(singleton, WorldOptionsShape::GenerationPatch).is_ok(),
                "rejected {singleton}"
            );
        }
    }

    #[test]
    fn every_ordered_faction_subset_and_world_origin_shape_is_structural() {
        for mask in 0_u8..64 {
            let values = CANONICAL_NPC_FACTION_IDS
                .iter()
                .enumerate()
                .filter(|(index, _)| mask & (1_u8 << *index) != 0)
                .map(|(_, faction)| format!(r#""{faction}""#))
                .collect::<Vec<_>>()
                .join(",");
            let json = format!(r#"{{"enabledFactions":[{values}]}}"#);
            let parsed = parse_world_options_json(&json, WorldOptionsShape::GenerationPatch).unwrap();
            assert_eq!(parsed.enabled_factions.unwrap().len(), mask.count_ones() as usize);
        }
        assert!(
            parse_world_options_json(
                r#"{"enabledFactions":["goblins","hobbits"]}"#,
                WorldOptionsShape::GenerationPatch,
            )
            .is_err()
        );

        for origin in [r#"{"mode":"wilderness"}"#, r#"{"mode":"near-any-settlement"}"#] {
            let json = format!(r#"{{"origin":{origin}}}"#);
            assert!(parse_world_options_json(&json, WorldOptionsShape::GenerationPatch).is_ok());
        }
        for faction in CANONICAL_NPC_FACTION_IDS {
            for size in ["hamlet", "village", "town"] {
                let json = format!(
                    r#"{{"origin":{{"factionId":"{faction}","minimumSize":"{size}","mode":"culture-settlement"}}}}"#
                );
                assert!(parse_world_options_json(&json, WorldOptionsShape::GenerationPatch).is_ok());
            }
        }
    }

    #[test]
    fn normalized_number_domain_accepts_endpoints_and_two_decimal_steps() {
        for (key, minimum_step, maximum_step) in [
            ("biomeScale", 25, 400),
            ("caveFrequency", 0, 300),
            ("resourceAbundance", 25, 400),
            ("settlementDensity", 0, 200),
        ] {
            for step in minimum_step..=maximum_step {
                let token = if step % 100 == 0 {
                    format!("{}", step / 100)
                } else if step % 10 == 0 {
                    format!("{}.{:01}", step / 100, (step % 100) / 10)
                } else {
                    format!("{}.{:02}", step / 100, step % 100)
                };
                let json = format!(r#"{{"{key}":{token}}}"#);
                assert!(
                    parse_world_options_json(&json, WorldOptionsShape::GenerationPatch).is_ok(),
                    "rejected {key}={token}"
                );
            }
        }
    }

    #[test]
    fn malformed_noncanonical_spoofed_and_wrong_typed_options_fail_closed() {
        let invalid_values = [
            "",
            "[]",
            r#"{"unknown":1}"#,
            r#"{"profile":"legacy-v14","profile":"world-below-v15"}"#,
            r#"{"structures":true,"profile":"world-below-v15"}"#,
            r#"{"profile":"legacy-v14", "structures":true}"#,
            r#"{"profile":"legacy\\u002dv14"}"#,
            r#"{"profile":"legacy-v14"}false"#,
            r#"{"caveFrequency":1.0}"#,
            r#"{"caveFrequency":01}"#,
            r#"{"caveFrequency":1e0}"#,
            r#"{"caveFrequency":3.01}"#,
            r#"{"biomeScale":0.24}"#,
            r#"{"resourceAbundance":4.01}"#,
            r#"{"settlementDensity":2.01}"#,
            r#"{"structures":"true"}"#,
            r#"{"profile":true}"#,
            r#"{"profile":"future-v99"}"#,
            r#"{"origin":{"profile":"legacy-v14"}}"#,
            r#"{"origin":{"mode":"wilderness","profile":"legacy-v14"}}"#,
            r#"{"origin":{"mode":"wilderness","mode":"wilderness"}}"#,
            r#"{"origin":{"minimumSize":"town","factionId":"hobbits","mode":"culture-settlement"}}"#,
            r#"{"enabledFactions":["hobbits","hobbits"]}"#,
            r#"{"enabledFactions":["unknown"]}"#,
            r#"{"largeTownFrequency":"always"}"#,
            r#"{"roadCoverage":"everywhere"}"#,
            r#"{"settlementClustering":"random"}"#,
            r#"{"settlementPattern":"future-v3"}"#,
            r#"{"profile":"legacy-v14"#,
        ];
        for value in invalid_values {
            assert!(
                parse_world_options_json(value, WorldOptionsShape::GenerationPatch).is_err(),
                "accepted {value}"
            );
        }
    }
}
