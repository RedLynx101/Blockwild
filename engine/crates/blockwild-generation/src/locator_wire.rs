use crate::contract::GenerationError;
pub(crate) use crate::option_json::valid_canonical_world_options_json;

pub(crate) const MAX_LOCATOR_PACKET: usize = 1024 * 1024;
pub(crate) const MAX_SEED_BYTES: usize = 2_048;
pub(crate) const MAX_OPTIONS_BYTES: usize = 8 * 1024;
pub(crate) const MAX_ID_BYTES: usize = 128;

pub(crate) fn valid_hash(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub(crate) struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
    label: &'static str,
}

impl<'a> Reader<'a> {
    pub(crate) fn new(bytes: &'a [u8], magic: [u8; 4], label: &'static str) -> Result<Self, GenerationError> {
        if bytes.len() < 4 || bytes.len() > MAX_LOCATOR_PACKET || bytes[..4] != magic {
            return Err(GenerationError::Wire(format!(
                "{label} packet has invalid bounds or magic"
            )));
        }
        Ok(Self {
            bytes,
            offset: 4,
            label,
        })
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8], GenerationError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| GenerationError::Wire(format!("{} packet overflow", self.label)))?;
        if end > self.bytes.len() {
            return Err(GenerationError::Wire(format!("{} packet is truncated", self.label)));
        }
        let result = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(result)
    }
    pub(crate) fn u8(&mut self) -> Result<u8, GenerationError> {
        Ok(self.take(1)?[0])
    }
    pub(crate) fn u16(&mut self) -> Result<u16, GenerationError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("bounded slice")))
    }
    pub(crate) fn u32(&mut self) -> Result<u32, GenerationError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("bounded slice")))
    }
    pub(crate) fn i64(&mut self) -> Result<i64, GenerationError> {
        Ok(i64::from_le_bytes(self.take(8)?.try_into().expect("bounded slice")))
    }
    pub(crate) fn string(&mut self, maximum: usize) -> Result<String, GenerationError> {
        let length = usize::try_from(self.u32()?)
            .map_err(|_| GenerationError::Wire(format!("{} string length overflow", self.label)))?;
        if length > maximum {
            return Err(GenerationError::Wire(format!(
                "{} string exceeds wire bound",
                self.label
            )));
        }
        String::from_utf8(self.take(length)?.to_vec())
            .map_err(|_| GenerationError::Wire(format!("{} string is not UTF-8", self.label)))
    }
    pub(crate) fn done(self) -> Result<(), GenerationError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(GenerationError::Wire(format!(
                "{} packet has trailing bytes",
                self.label
            )))
        }
    }
}

pub(crate) struct Writer {
    bytes: Vec<u8>,
    label: &'static str,
}

impl Writer {
    pub(crate) fn new(magic: [u8; 4], label: &'static str) -> Self {
        Self {
            bytes: magic.to_vec(),
            label,
        }
    }
    pub(crate) fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }
    pub(crate) fn u16(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    pub(crate) fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    pub(crate) fn u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    pub(crate) fn i32(&mut self, value: i32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    #[cfg(test)]
    pub(crate) fn i64(&mut self, value: i64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    pub(crate) fn string(&mut self, value: &str, maximum: usize) -> Result<(), GenerationError> {
        if value.len() > maximum {
            return Err(GenerationError::Wire(format!(
                "{} string exceeds wire bound",
                self.label
            )));
        }
        self.u32(value.len() as u32);
        self.bytes.extend_from_slice(value.as_bytes());
        Ok(())
    }
    pub(crate) fn finish(self) -> Result<Vec<u8>, GenerationError> {
        if self.bytes.len() > MAX_LOCATOR_PACKET {
            Err(GenerationError::Wire(format!(
                "{} result exceeds packet bound",
                self.label
            )))
        } else {
            Ok(self.bytes)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_options_accept_the_real_registry_order_and_reject_reordered_factions() {
        let actual = r#"{"biomeScale":1.35,"caveFrequency":1,"enabledFactions":["hobbits","goblins","atlantians","sugarcourt","wood-elves","dwarves"],"largeTownFrequency":"balanced","origin":{"mode":"wilderness"},"profile":"world-below-v15","resourceAbundance":1,"roadCoverage":"regional","settlementClustering":"regional","settlementDensity":1,"settlementPattern":"heartlands-v2","structures":true}"#;
        assert!(valid_canonical_world_options_json(actual));
        assert!(!valid_canonical_world_options_json(
            &actual.replace("\"hobbits\",\"goblins\"", "\"goblins\",\"hobbits\"",)
        ));
    }

    #[test]
    fn world_options_reject_nested_values_that_spoof_top_level_fields() {
        let actual = r#"{"biomeScale":1.35,"caveFrequency":1,"enabledFactions":["hobbits","goblins","atlantians","sugarcourt","wood-elves","dwarves"],"largeTownFrequency":"balanced","origin":{"mode":"wilderness"},"profile":"world-below-v15","resourceAbundance":1,"roadCoverage":"regional","settlementClustering":"regional","settlementDensity":1,"settlementPattern":"heartlands-v2","structures":true}"#;
        let replacements = [
            ("\"biomeScale\":1.35", "\"biomeScale\":{\"biomeScale\":1.35}"),
            ("\"caveFrequency\":1", "\"caveFrequency\":{\"caveFrequency\":1}"),
            (
                "\"enabledFactions\":[\"hobbits\",\"goblins\",\"atlantians\",\"sugarcourt\",\"wood-elves\",\"dwarves\"]",
                "\"enabledFactions\":{\"enabledFactions\":[\"hobbits\",\"goblins\",\"atlantians\",\"sugarcourt\",\"wood-elves\",\"dwarves\"]}",
            ),
            (
                "\"largeTownFrequency\":\"balanced\"",
                "\"largeTownFrequency\":{\"largeTownFrequency\":\"balanced\"}",
            ),
            (
                "\"origin\":{\"mode\":\"wilderness\"}",
                "\"origin\":{\"origin\":{\"mode\":\"wilderness\"}}",
            ),
            (
                "\"profile\":\"world-below-v15\"",
                "\"profile\":{\"profile\":\"world-below-v15\"}",
            ),
            (
                "\"resourceAbundance\":1",
                "\"resourceAbundance\":{\"resourceAbundance\":1}",
            ),
            (
                "\"roadCoverage\":\"regional\"",
                "\"roadCoverage\":{\"roadCoverage\":\"regional\"}",
            ),
            (
                "\"settlementClustering\":\"regional\"",
                "\"settlementClustering\":{\"settlementClustering\":\"regional\"}",
            ),
            (
                "\"settlementDensity\":1",
                "\"settlementDensity\":{\"settlementDensity\":1}",
            ),
            (
                "\"settlementPattern\":\"heartlands-v2\"",
                "\"settlementPattern\":{\"settlementPattern\":\"heartlands-v2\"}",
            ),
            ("\"structures\":true", "\"structures\":{\"structures\":true}"),
        ];
        for (needle, replacement) in replacements {
            let spoofed = actual.replace(needle, replacement);
            assert!(
                !valid_canonical_world_options_json(&spoofed),
                "accepted nested top-level spoof for {needle}"
            );
        }
    }

    #[test]
    fn world_options_accept_every_two_decimal_slider_step_without_float_equality() {
        let template = r#"{"biomeScale":1.35,"caveFrequency":VALUE,"enabledFactions":["hobbits","goblins","atlantians","sugarcourt","wood-elves","dwarves"],"largeTownFrequency":"balanced","origin":{"mode":"wilderness"},"profile":"world-below-v15","resourceAbundance":1,"roadCoverage":"regional","settlementClustering":"regional","settlementDensity":1,"settlementPattern":"heartlands-v2","structures":true}"#;
        for step in 0..=60 {
            let value = f64::from(step) * 0.05;
            let token = if step % 20 == 0 {
                format!("{}", step / 20)
            } else if step % 2 == 0 {
                format!("{value:.1}")
            } else {
                format!("{value:.2}")
            };
            assert!(
                valid_canonical_world_options_json(&template.replace("VALUE", &token)),
                "rejected {token}"
            );
        }
    }

    #[test]
    fn world_options_reject_settlement_density_above_the_typescript_maximum() {
        let template = r#"{"biomeScale":1.35,"caveFrequency":1,"enabledFactions":["hobbits","goblins","atlantians","sugarcourt","wood-elves","dwarves"],"largeTownFrequency":"balanced","origin":{"mode":"wilderness"},"profile":"world-below-v15","resourceAbundance":1,"roadCoverage":"regional","settlementClustering":"regional","settlementDensity":VALUE,"settlementPattern":"heartlands-v2","structures":true}"#;
        assert!(valid_canonical_world_options_json(&template.replace("VALUE", "2")));
        assert!(!valid_canonical_world_options_json(&template.replace("VALUE", "2.01")));
        assert!(!valid_canonical_world_options_json(&template.replace("VALUE", "3")));
    }
}
