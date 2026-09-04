//! Standalone BWLC v1 review-terms codec, not a native migration executor.
//!
//! This value is NOT stored in native snapshots/checkpoints, consumed by runtime
//! systems, or accepted by an adoption API. Its identities bind a separately
//! validated review and archived source; they do not attest consent, empty-target
//! custody, historical ownership, or archive durability. Existing world-only and
//! rich-save guards remain unchanged. All transient choices are explicitly new
//! decisions, not restored facts. Source, storage-normalized, and actual legacy
//! load time are distinct: loading numeric midnight zero historically substitutes
//! 0.32 before wrapping. This codec preserves all supplied finite f64 bits and
//! does not select a runtime behavior.
//!
//! Wire: `BWLC`, u16 version, u16 zero flags, u32 body length, typed body,
//! semantic hash[16], transport hash[16]. Integers/f64 are little-endian; strings
//! have u16 UTF-8 byte lengths; closed enum tags follow their declarations below.
//! The noncryptographic semantic digest is recomputed from the complete canonical
//! typed body, not the embedded hash/checksum. Neither digest authenticates data.
//! Schema/field changes require a new version. Full normalized options are typed;
//! original optional fields and absences remain bound in the complete source.

use blockwild_types::{CanonicalHash, CanonicalHasher};

pub const LEGACY_WORLD_CONTINUATION_MAX_BYTES_V1: usize = 8192;
pub const LEGACY_WORLD_CONTINUATION_POLICY_ID_V1: &str = "blockwild-fresh-runtime-review-g16-g17-builder-v1";
pub const LEGACY_WORLD_CONTINUATION_NATIVE_EXECUTION_ALLOWED_V1: bool = false;
pub const LEGACY_WORLD_CONTINUATION_STORED_BY_NATIVE_RUNTIME_V1: bool = false;
pub const LEGACY_WORLD_CONTINUATION_CONSUMED_BY_NATIVE_RUNTIME_V1: bool = false;
const MAGIC: &[u8; 4] = b"BWLC";
const HEADER: usize = 12;
const TRAILER: usize = 32;
const SEMANTIC_DOMAIN: &str = "blockwild-legacy-world-continuation-semantic-v1";
const TRANSPORT_DOMAIN: &str = "blockwild-legacy-world-continuation-transport-v1";
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// SHA-256 identity, deliberately not interchangeable with CanonicalHash[16].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LegacyContinuationSha256V1(pub [u8; 32]);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyContinuationErrorV1(pub &'static str);
impl core::fmt::Display for LegacyContinuationErrorV1 {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(formatter, "BWLC v1: {}", self.0)
    }
}
impl std::error::Error for LegacyContinuationErrorV1 {}
type Result<T> = core::result::Result<T, LegacyContinuationErrorV1>;
fn fail<T>(message: &'static str) -> Result<T> {
    Err(LegacyContinuationErrorV1(message))
}

trait Tag: Sized {
    fn tag(&self) -> u8;
    fn from_tag(tag: u8) -> Result<Self>;
}
macro_rules! closed_enum {
    ($name:ident { $($variant:ident = $tag:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
        #[repr(u8)]
        pub enum $name { $($variant = $tag),+ }
        impl Tag for $name {
            fn tag(&self) -> u8 { *self as u8 }
            fn from_tag(tag: u8) -> Result<Self> {
                match tag { $($tag => Ok(Self::$variant)),+, _ => fail(concat!("unknown ", stringify!($name), " tag")) }
            }
        }
    };
}
closed_enum!(LegacyWeatherV1 { Clear = 0, Rain = 1 });
closed_enum!(LegacyDifficultyV1 { Peaceful = 0, Easy = 1, Normal = 2, Hard = 3 });
closed_enum!(LegacySleepRuleV1 { AnyPlayer = 0, Percentage = 1, AllPlayers = 2 });
closed_enum!(LegacyFactionV1 { Hobbits = 0, Goblins = 1, Atlantians = 2, Sugarcourt = 3, WoodElves = 4, Dwarves = 5 });
closed_enum!(LegacySettlementPatternV1 { LegacyScattered = 0, Heartlands = 1 });
closed_enum!(LegacySettlementClusteringV1 { Even = 0, Regional = 1, Strong = 2 });
closed_enum!(LegacyRoadCoverageV1 { None = 0, Local = 1, Regional = 2, Dense = 3 });
closed_enum!(LegacyLargeTownFrequencyV1 { Rare = 0, Balanced = 1, Frequent = 2 });
closed_enum!(LegacySettlementSizeV1 { Hamlet = 0, Village = 1, Town = 2 });
closed_enum!(LegacyGeneratorProfileV1 { WorldBelowV15 = 0 });
closed_enum!(LegacyModeV1 { Builder = 0 });
closed_enum!(LegacyReviewDecisionV1 { AffirmReviewOnly = 0 });
closed_enum!(LegacyOwnerDecisionV1 { AdoptSelectedNotHistorical = 0 });
closed_enum!(LegacyVelocityDecisionV1 { FreshRestNotRestored = 0 });
closed_enum!(LegacyGroundedDecisionV1 { RecomputeNoHistoricalAssertion = 0 });
closed_enum!(LegacySessionAgeDecisionV1 { FreshZeroNotHistorical = 0 });

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LegacyContinuationVec3V1 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LegacyContinuationPoseV1 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub yaw: f64,
    pub pitch: f64,
}
#[derive(Clone, Debug, PartialEq)]
pub struct LegacyContinuationStateV1 {
    pub day: f64,
    pub time: f64,
    pub weather: LegacyWeatherV1,
    pub spawn: LegacyContinuationVec3V1,
    pub pose: LegacyContinuationPoseV1,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LegacyContinuationOriginV1 {
    Wilderness,
    NearAnySettlement,
    CultureSettlement {
        faction_id: LegacyFactionV1,
        minimum_size: LegacySettlementSizeV1,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub struct LegacyContinuationWorldOptionsV1 {
    pub difficulty: LegacyDifficultyV1,
    pub day_length_minutes: f64,
    pub mob_density: f64,
    pub butterfly_density: f64,
    pub cave_frequency: f64,
    pub biome_scale: f64,
    pub resource_abundance: f64,
    pub structures: bool,
    pub weather: bool,
    pub keep_inventory: bool,
    pub friendly_fire: bool,
    pub sleep_rule: LegacySleepRuleV1,
    pub sleep_percentage: f64,
    pub enabled_factions: Vec<LegacyFactionV1>,
    pub settlement_pattern: LegacySettlementPatternV1,
    pub settlement_density: f64,
    pub settlement_clustering: LegacySettlementClusteringV1,
    pub road_coverage: LegacyRoadCoverageV1,
    pub large_town_frequency: LegacyLargeTownFrequencyV1,
    pub origin: LegacyContinuationOriginV1,
}
#[derive(Clone, Debug, PartialEq)]
pub struct LegacyContinuationSourceV1 {
    pub generator_version: u16,
    pub raw_sha256: LegacyContinuationSha256V1,
    pub byte_length: u64,
    pub semantic_hash: CanonicalHash,
    pub world_seed: String,
    pub state: LegacyContinuationStateV1,
}
#[derive(Clone, Debug, PartialEq)]
pub struct LegacyContinuationTargetV1 {
    pub catalog_world_id: String,
    pub universe_id: String,
    pub location_id: String,
    pub generator_hash: CanonicalHash,
    pub content_hash: CanonicalHash,
    pub normalized_semantic_hash: CanonicalHash,
    pub generator_version: u16,
    pub generator_profile: LegacyGeneratorProfileV1,
    pub mode: LegacyModeV1,
    pub state: LegacyContinuationStateV1,
    pub options: LegacyContinuationWorldOptionsV1,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyContinuationActorV1 {
    pub profile_id: String,
    pub actor_id: String,
    pub command_actor_id: String,
    pub profile_canonical_hash: LegacyContinuationSha256V1,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyContinuationPolicyV1 {
    pub version: u16,
    pub id: String,
    pub proposal_hash: LegacyContinuationSha256V1,
    pub decision: LegacyReviewDecisionV1,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyContinuationDecisionsV1 {
    pub owner: LegacyOwnerDecisionV1,
    pub velocity: LegacyVelocityDecisionV1,
    pub grounded: LegacyGroundedDecisionV1,
    pub session_age: LegacySessionAgeDecisionV1,
}
#[derive(Clone, Debug, PartialEq)]
pub struct LegacyWorldContinuationV1 {
    pub schema_version: u16,
    pub source: LegacyContinuationSourceV1,
    pub target: LegacyContinuationTargetV1,
    pub actor: LegacyContinuationActorV1,
    pub policy: LegacyContinuationPolicyV1,
    pub actual_legacy_load_world_time: f64,
    pub decisions: LegacyContinuationDecisionsV1,
}

fn finite(value: f64) -> Result<()> {
    if value.is_finite() {
        Ok(())
    } else {
        fail("nonfinite f64")
    }
}
fn range(value: f64, minimum: f64, maximum: f64) -> Result<()> {
    finite(value)?;
    if (minimum..=maximum).contains(&value) {
        Ok(())
    } else {
        fail("numeric bound")
    }
}
fn text(value: &str, maximum: usize, visible: bool) -> Result<()> {
    if value.is_empty() || value.len() > maximum || (visible && value.chars().any(char::is_control)) {
        fail("string bound or control")
    } else {
        Ok(())
    }
}
impl LegacyContinuationStateV1 {
    fn validate(&self) -> Result<()> {
        range(self.day, 1.0, MAX_SAFE_INTEGER)?;
        if self.day.fract() != 0.0 {
            return fail("day must be an exact safe integer");
        }
        for value in [
            self.time,
            self.spawn.x,
            self.spawn.y,
            self.spawn.z,
            self.pose.x,
            self.pose.y,
            self.pose.z,
            self.pose.yaw,
            self.pose.pitch,
        ] {
            finite(value)?;
        }
        Ok(())
    }
}
impl LegacyContinuationWorldOptionsV1 {
    fn validate(&self) -> Result<()> {
        for (value, minimum, maximum) in [
            (self.day_length_minutes, 5.0, 120.0),
            (self.mob_density, 0.0, 3.0),
            (self.butterfly_density, 0.0, 4.0),
            (self.cave_frequency, 0.0, 3.0),
            (self.biome_scale, 0.25, 4.0),
            (self.resource_abundance, 0.25, 4.0),
            (self.sleep_percentage, 1.0, 100.0),
            (self.settlement_density, 0.0, 2.0),
        ] {
            range(value, minimum, maximum)?;
        }
        if self.enabled_factions.len() > 6 || self.enabled_factions.windows(2).any(|pair| pair[0] >= pair[1]) {
            return fail("factions must be unique in canonical order");
        }
        if let LegacyContinuationOriginV1::CultureSettlement { faction_id, .. } = &self.origin
            && !self.enabled_factions.contains(faction_id)
        {
            return fail("origin faction is disabled");
        }
        if self.origin != LegacyContinuationOriginV1::Wilderness && (!self.structures || self.settlement_density == 0.0)
        {
            return fail("origin lacks settlements");
        }
        Ok(())
    }
}
impl LegacyWorldContinuationV1 {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return fail("schema version");
        }
        if !matches!(self.source.generator_version, 16 | 17) {
            return fail("source generator version");
        }
        if !(1..=64 * 1024 * 1024).contains(&self.source.byte_length) {
            return fail("source byte length");
        }
        text(&self.source.world_seed, 2048, false)?;
        if self.source.world_seed.encode_utf16().count() > 512 {
            return fail("seed bound");
        }
        self.source.state.validate()?;
        text(&self.target.catalog_world_id, 48, true)?;
        text(&self.target.universe_id, 64, true)?;
        text(&self.target.location_id, 128, true)?;
        if self.target.generator_version != 18 {
            return fail("target generator version");
        }
        self.target.state.validate()?;
        self.target.options.validate()?;
        text(&self.actor.profile_id, 72, true)?;
        text(&self.actor.actor_id, 150, true)?;
        text(&self.actor.command_actor_id, 160, true)?;
        if self.policy.version != 1 || self.policy.id != LEGACY_WORLD_CONTINUATION_POLICY_ID_V1 {
            return fail("policy version or identity");
        }
        finite(self.actual_legacy_load_world_time)?;
        if !(0.0..1.0).contains(&self.actual_legacy_load_world_time) {
            return fail("actual legacy-load clock bound");
        }
        Ok(())
    }

    /// Complete typed semantic recomputation, independent of incoming envelopes.
    pub fn semantic_hash(&self) -> Result<CanonicalHash> {
        Ok(semantic(&self.body()?))
    }

    pub fn encode(&self) -> Result<Vec<u8>> {
        let body = self.body()?;
        let mut writer = Writer::default();
        writer.raw(MAGIC);
        writer.u16(1);
        writer.u16(0);
        writer.u32(body.len() as u32);
        writer.raw(&body);
        writer.raw(semantic(&body).as_bytes());
        let checksum = transport(&writer.0);
        writer.raw(checksum.as_bytes());
        Ok(writer.0)
    }

    pub fn decode(bytes: &[u8], expected_semantic_hash: Option<CanonicalHash>) -> Result<Self> {
        if !(HEADER + TRAILER..=LEGACY_WORLD_CONTINUATION_MAX_BYTES_V1).contains(&bytes.len()) {
            return fail("packet bound");
        }
        let mut header = Reader::new(bytes);
        if header.raw(4)? != MAGIC || header.u16()? != 1 || header.u16()? != 0 {
            return fail("magic, schema or flags");
        }
        let length = header.u32()? as usize;
        if length != bytes.len() - HEADER - TRAILER {
            return fail("payload length");
        }
        if transport(&bytes[..bytes.len() - 16]).as_bytes() != &bytes[bytes.len() - 16..] {
            return fail("transport checksum");
        }
        let incoming_body = header.raw(length)?;
        let mut reader = Reader::new(incoming_body);
        let source = LegacyContinuationSourceV1 {
            generator_version: reader.u16()?,
            raw_sha256: reader.sha()?,
            byte_length: reader.u64()?,
            semantic_hash: reader.hash()?,
            world_seed: reader.string()?,
            state: reader.state()?,
        };
        let target = LegacyContinuationTargetV1 {
            catalog_world_id: reader.string()?,
            universe_id: reader.string()?,
            location_id: reader.string()?,
            generator_hash: reader.hash()?,
            content_hash: reader.hash()?,
            normalized_semantic_hash: reader.hash()?,
            generator_version: reader.u16()?,
            generator_profile: reader.enumeration()?,
            mode: reader.enumeration()?,
            state: reader.state()?,
            options: reader.options()?,
        };
        let actor = LegacyContinuationActorV1 {
            profile_id: reader.string()?,
            actor_id: reader.string()?,
            command_actor_id: reader.string()?,
            profile_canonical_hash: reader.sha()?,
        };
        let policy = LegacyContinuationPolicyV1 {
            version: reader.u16()?,
            id: reader.string()?,
            proposal_hash: reader.sha()?,
            decision: reader.enumeration()?,
        };
        let actual_legacy_load_world_time = reader.f64()?;
        let decisions = LegacyContinuationDecisionsV1 {
            owner: reader.enumeration()?,
            velocity: reader.enumeration()?,
            grounded: reader.enumeration()?,
            session_age: reader.enumeration()?,
        };
        if reader.offset != length {
            return fail("trailing body");
        }
        let value = Self {
            schema_version: 1,
            source,
            target,
            actor,
            policy,
            actual_legacy_load_world_time,
            decisions,
        };
        let canonical_body = value.body()?;
        let digest = semantic(&canonical_body);
        if canonical_body != incoming_body || digest.as_bytes() != header.raw(16)? {
            return fail("semantic hash or canonical body");
        }
        if expected_semantic_hash.is_some_and(|expected| expected != digest) {
            return fail("expected semantic hash");
        }
        Ok(value)
    }

    fn body(&self) -> Result<Vec<u8>> {
        self.validate()?;
        let mut writer = Writer::default();
        let source = &self.source;
        let target = &self.target;
        writer.u16(source.generator_version);
        writer.raw(&source.raw_sha256.0);
        writer.u64(source.byte_length);
        writer.raw(source.semantic_hash.as_bytes());
        writer.string(&source.world_seed);
        writer.state(&source.state);
        writer.string(&target.catalog_world_id);
        writer.string(&target.universe_id);
        writer.string(&target.location_id);
        writer.raw(target.generator_hash.as_bytes());
        writer.raw(target.content_hash.as_bytes());
        writer.raw(target.normalized_semantic_hash.as_bytes());
        writer.u16(target.generator_version);
        writer.enumeration(&target.generator_profile);
        writer.enumeration(&target.mode);
        writer.state(&target.state);
        writer.options(&target.options);
        writer.string(&self.actor.profile_id);
        writer.string(&self.actor.actor_id);
        writer.string(&self.actor.command_actor_id);
        writer.raw(&self.actor.profile_canonical_hash.0);
        writer.u16(self.policy.version);
        writer.string(&self.policy.id);
        writer.raw(&self.policy.proposal_hash.0);
        writer.enumeration(&self.policy.decision);
        writer.f64(self.actual_legacy_load_world_time);
        writer.enumeration(&self.decisions.owner);
        writer.enumeration(&self.decisions.velocity);
        writer.enumeration(&self.decisions.grounded);
        writer.enumeration(&self.decisions.session_age);
        if writer.0.len() + HEADER + TRAILER > LEGACY_WORLD_CONTINUATION_MAX_BYTES_V1 {
            return fail("packet bound");
        }
        Ok(writer.0)
    }
}

fn semantic(body: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new(SEMANTIC_DOMAIN);
    hasher.write_u16(1);
    hasher.write_bytes(body);
    hasher.finish()
}
fn transport(bytes: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new(TRANSPORT_DOMAIN);
    hasher.write_bytes(bytes);
    hasher.finish()
}
#[derive(Default)]
struct Writer(Vec<u8>);
impl Writer {
    fn raw(&mut self, bytes: &[u8]) {
        self.0.extend_from_slice(bytes);
    }
    fn u8(&mut self, value: u8) {
        self.0.push(value);
    }
    fn u16(&mut self, value: u16) {
        self.raw(&value.to_le_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.raw(&value.to_le_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.raw(&value.to_le_bytes());
    }
    fn f64(&mut self, value: f64) {
        self.u64(value.to_bits());
    }
    fn string(&mut self, value: &str) {
        self.u16(value.len() as u16);
        self.raw(value.as_bytes());
    }
    fn enumeration<T: Tag>(&mut self, value: &T) {
        self.u8(value.tag());
    }
    fn state(&mut self, value: &LegacyContinuationStateV1) {
        self.f64(value.day);
        self.f64(value.time);
        self.enumeration(&value.weather);
        for number in [
            value.spawn.x,
            value.spawn.y,
            value.spawn.z,
            value.pose.x,
            value.pose.y,
            value.pose.z,
            value.pose.yaw,
            value.pose.pitch,
        ] {
            self.f64(number);
        }
    }
    fn options(&mut self, value: &LegacyContinuationWorldOptionsV1) {
        self.enumeration(&value.difficulty);
        for number in [
            value.day_length_minutes,
            value.mob_density,
            value.butterfly_density,
            value.cave_frequency,
            value.biome_scale,
            value.resource_abundance,
        ] {
            self.f64(number);
        }
        for boolean in [
            value.structures,
            value.weather,
            value.keep_inventory,
            value.friendly_fire,
        ] {
            self.u8(u8::from(boolean));
        }
        self.enumeration(&value.sleep_rule);
        self.f64(value.sleep_percentage);
        self.u8(value.enabled_factions.len() as u8);
        for faction in &value.enabled_factions {
            self.enumeration(faction);
        }
        self.enumeration(&value.settlement_pattern);
        self.f64(value.settlement_density);
        self.enumeration(&value.settlement_clustering);
        self.enumeration(&value.road_coverage);
        self.enumeration(&value.large_town_frequency);
        match &value.origin {
            LegacyContinuationOriginV1::Wilderness => self.u8(0),
            LegacyContinuationOriginV1::NearAnySettlement => self.u8(1),
            LegacyContinuationOriginV1::CultureSettlement {
                faction_id,
                minimum_size,
            } => {
                self.u8(2);
                self.enumeration(faction_id);
                self.enumeration(minimum_size);
            }
        }
    }
}
struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn raw(&mut self, length: usize) -> Result<&'a [u8]> {
        if length > self.bytes.len() - self.offset {
            return fail("truncated payload");
        }
        let value = &self.bytes[self.offset..self.offset + length];
        self.offset += length;
        Ok(value)
    }
    fn array<const N: usize>(&mut self) -> Result<[u8; N]> {
        Ok(self.raw(N)?.try_into().expect("checked fixed width"))
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.raw(1)?[0])
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.array()?))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.array()?))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.array()?))
    }
    fn f64(&mut self) -> Result<f64> {
        let value = f64::from_bits(self.u64()?);
        finite(value)?;
        Ok(value)
    }
    fn string(&mut self) -> Result<String> {
        let length = usize::from(self.u16()?);
        String::from_utf8(self.raw(length)?.to_vec()).map_err(|_| LegacyContinuationErrorV1("invalid UTF-8"))
    }
    fn enumeration<T: Tag>(&mut self) -> Result<T> {
        T::from_tag(self.u8()?)
    }
    fn boolean(&mut self) -> Result<bool> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => fail("boolean tag"),
        }
    }
    fn hash(&mut self) -> Result<CanonicalHash> {
        Ok(CanonicalHash(self.array()?))
    }
    fn sha(&mut self) -> Result<LegacyContinuationSha256V1> {
        Ok(LegacyContinuationSha256V1(self.array()?))
    }
    fn state(&mut self) -> Result<LegacyContinuationStateV1> {
        Ok(LegacyContinuationStateV1 {
            day: self.f64()?,
            time: self.f64()?,
            weather: self.enumeration()?,
            spawn: LegacyContinuationVec3V1 {
                x: self.f64()?,
                y: self.f64()?,
                z: self.f64()?,
            },
            pose: LegacyContinuationPoseV1 {
                x: self.f64()?,
                y: self.f64()?,
                z: self.f64()?,
                yaw: self.f64()?,
                pitch: self.f64()?,
            },
        })
    }
    fn options(&mut self) -> Result<LegacyContinuationWorldOptionsV1> {
        let difficulty = self.enumeration()?;
        let day_length_minutes = self.f64()?;
        let mob_density = self.f64()?;
        let butterfly_density = self.f64()?;
        let cave_frequency = self.f64()?;
        let biome_scale = self.f64()?;
        let resource_abundance = self.f64()?;
        let structures = self.boolean()?;
        let weather = self.boolean()?;
        let keep_inventory = self.boolean()?;
        let friendly_fire = self.boolean()?;
        let sleep_rule = self.enumeration()?;
        let sleep_percentage = self.f64()?;
        let count = self.u8()?;
        if count > 6 {
            return fail("faction count");
        }
        let enabled_factions = (0..count).map(|_| self.enumeration()).collect::<Result<Vec<_>>>()?;
        let settlement_pattern = self.enumeration()?;
        let settlement_density = self.f64()?;
        let settlement_clustering = self.enumeration()?;
        let road_coverage = self.enumeration()?;
        let large_town_frequency = self.enumeration()?;
        let origin = match self.u8()? {
            0 => LegacyContinuationOriginV1::Wilderness,
            1 => LegacyContinuationOriginV1::NearAnySettlement,
            2 => LegacyContinuationOriginV1::CultureSettlement {
                faction_id: self.enumeration()?,
                minimum_size: self.enumeration()?,
            },
            _ => return fail("unknown origin tag"),
        };
        Ok(LegacyContinuationWorldOptionsV1 {
            difficulty,
            day_length_minutes,
            mob_density,
            butterfly_density,
            cave_frequency,
            biome_scale,
            resource_abundance,
            structures,
            weather,
            keep_inventory,
            friendly_fire,
            sleep_rule,
            sleep_percentage,
            enabled_factions,
            settlement_pattern,
            settlement_density,
            settlement_clustering,
            road_coverage,
            large_town_frequency,
            origin,
        })
    }
}
