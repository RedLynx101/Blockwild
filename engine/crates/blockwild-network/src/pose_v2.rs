//! Exact runtime-owned pose projection; independent of quantized BWNP/BWPP V1.
//!
//! BWPE: magic[4], schema:u16(2), flags:u16(0), body_length:u32, body,
//! pose_hash[16], projection_hash[16]. Integers/f64 are little-endian; strings
//! are u16 byte length + strict UTF-8. The pose hash seals version + eight raw
//! f64 values + grounded. The projection hash seals header + entire binding and
//! pose body + pose hash. Both are noncryptographic, NOT proof of native origin.
//! The integrated state hash is an opaque binding, not derivable from a pose.
//! Only a trusted native producer can attest ownership; this codec does not
//! admit guest input, migrate saves, or confer authority/consent.
use crate::{NetworkError, NetworkErrorCode, label};
use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId, PlayerId};

pub const NETWORK_PLAYER_POSE_SCHEMA_V2: u16 = 2;
pub const NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V2: usize = 4096;
// Pinned to native simulation/collision.rs PHYSICS_MAX_ABS_*_V1.
pub const NETWORK_PLAYER_POSE_MAX_ABS_POSITION_V2: f64 = 33_554_432.0;
pub const NETWORK_PLAYER_POSE_MAX_ABS_VELOCITY_V2: f64 = 4096.0;
const MAGIC: &[u8; 4] = b"BWPE";
const HEADER: usize = 12;
const TRAILER: usize = 32;
const POSE_DOMAIN: &str = "blockwild-network-player-exact-pose-v2";
const PROJECTION_DOMAIN: &str = "blockwild-network-player-exact-projection-v2";

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct NetworkPlayerPoseRevisionV2 {
    pub epoch: u64,
    pub world: u64,
    pub entities: u64,
    pub gameplay: u64,
    pub persistence: u64,
    pub network: u64,
    pub simulation: u64,
}
#[derive(Clone, Debug, PartialEq)]
pub struct NetworkPlayerPoseSourceV2 {
    pub universe_id: String,
    pub location_id: String,
    pub session_id: String,
    pub actor_id: String,
    pub external_entity_id: String,
    pub player_id: PlayerId,
    pub entity_id: EntityId,
    pub tick: u64,
    pub input_sequence: u64,
    pub revision: NetworkPlayerPoseRevisionV2,
    pub state_hash: CanonicalHash,
    pub position: [f64; 3],
    pub velocity: [f64; 3],
    pub yaw: f64,
    pub pitch: f64,
    pub grounded: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct NetworkPlayerPoseV2 {
    pub schema_version: u16,
    pub source: NetworkPlayerPoseSourceV2,
    pub pose_hash: CanonicalHash,
    pub projection_hash: CanonicalHash,
}
impl NetworkPlayerPoseV2 {
    pub fn new(source: NetworkPlayerPoseSourceV2) -> Result<Self, NetworkError> {
        validate_source(&source)?;
        let pose_hash = pose_hash(&source);
        let projection_hash = digest(PROJECTION_DOMAIN, &projection_prefix(&source, pose_hash));
        Ok(Self {
            schema_version: NETWORK_PLAYER_POSE_SCHEMA_V2,
            source,
            pose_hash,
            projection_hash,
        })
    }
    pub fn validate(&self) -> Result<(), NetworkError> {
        if self.schema_version != NETWORK_PLAYER_POSE_SCHEMA_V2 {
            return Err(error(NetworkErrorCode::SchemaMismatch, "exact pose schema mismatch"));
        }
        // f64 PartialEq cannot establish bit equality: -0 and +0 differ here.
        let rebuilt = Self::new(self.source.clone())?;
        if self.pose_hash != rebuilt.pose_hash || self.projection_hash != rebuilt.projection_hash {
            return Err(error(
                NetworkErrorCode::HashMismatch,
                "exact pose or projection hash mismatch",
            ));
        }
        Ok(())
    }
}
pub fn encode_network_player_pose_v2(value: &NetworkPlayerPoseV2) -> Result<Vec<u8>, NetworkError> {
    value.validate()?;
    let mut bytes = projection_prefix(&value.source, value.pose_hash);
    bytes.extend_from_slice(value.projection_hash.as_bytes());
    if bytes.len() > NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V2 {
        return Err(error(NetworkErrorCode::Budget, "exact pose wire budget"));
    }
    Ok(bytes)
}
pub fn decode_network_player_pose_v2(bytes: &[u8]) -> Result<NetworkPlayerPoseV2, NetworkError> {
    if bytes.len() > NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V2 {
        return Err(error(NetworkErrorCode::Budget, "exact pose wire budget"));
    }
    let mut r = Reader { bytes, offset: 0 };
    if &r.array::<4>()? != MAGIC {
        return Err(error(NetworkErrorCode::WireMagic, "exact pose magic mismatch"));
    }
    if r.u16()? != NETWORK_PLAYER_POSE_SCHEMA_V2 {
        return Err(error(NetworkErrorCode::SchemaMismatch, "exact pose schema mismatch"));
    }
    if r.u16()? != 0 {
        return Err(error(NetworkErrorCode::WireType, "exact pose reserved flags"));
    }
    let body_length = r.u32()? as usize;
    if body_length.checked_add(HEADER + TRAILER) != Some(bytes.len()) {
        return Err(error(
            NetworkErrorCode::TrailingBytes,
            "exact pose body length mismatch",
        ));
    }
    let universe_id = r.string(64 * 3)?;
    let location_id = r.string(128 * 3)?;
    let session_id = r.string(180 * 3)?;
    let actor_id = r.string(512)?;
    let external_entity_id = r.string(512)?;
    let player = r.u64()?;
    let entity = r.u64()?;
    let source = NetworkPlayerPoseSourceV2 {
        universe_id,
        location_id,
        session_id,
        actor_id,
        external_entity_id,
        player_id: PlayerId::new(player as u32, (player >> 32) as u32),
        entity_id: EntityId::new(entity as u32, (entity >> 32) as u32),
        tick: r.u64()?,
        input_sequence: r.u64()?,
        revision: NetworkPlayerPoseRevisionV2 {
            epoch: r.u64()?,
            world: r.u64()?,
            entities: r.u64()?,
            gameplay: r.u64()?,
            persistence: r.u64()?,
            network: r.u64()?,
            simulation: r.u64()?,
        },
        state_hash: CanonicalHash(r.array()?),
        position: [r.f64()?, r.f64()?, r.f64()?],
        velocity: [r.f64()?, r.f64()?, r.f64()?],
        yaw: r.f64()?,
        pitch: r.f64()?,
        grounded: r.flag()?,
    };
    if r.offset != HEADER + body_length {
        return Err(error(
            NetworkErrorCode::TrailingBytes,
            "exact pose body is not canonical",
        ));
    }
    let expected_pose = CanonicalHash(r.array()?);
    let expected_projection = CanonicalHash(r.array()?);
    let pose = NetworkPlayerPoseV2::new(source)?;
    if pose.pose_hash != expected_pose || pose.projection_hash != expected_projection {
        return Err(error(
            NetworkErrorCode::HashMismatch,
            "exact pose or projection hash mismatch",
        ));
    }
    Ok(pose)
}

fn error(code: NetworkErrorCode, message: &'static str) -> NetworkError {
    NetworkError::new(code, message)
}
fn validate_source(s: &NetworkPlayerPoseSourceV2) -> Result<(), NetworkError> {
    for (value, cap) in [(&s.universe_id, 64), (&s.location_id, 128)] {
        label(value, cap, "exact pose identity")?;
        // Mirror blockwild_authority::validate_label for WorldAddressV1.
        if value
            .chars()
            .any(|character| character <= '\u{1f}' || character == '\u{7f}')
        {
            return Err(error(NetworkErrorCode::InvalidLabel, "exact pose world address label"));
        }
    }
    // NetworkBrowserAuthorityRuntimeV1 applies only the shared network-label
    // bound to sessionId; do not silently impose the address control policy.
    label(&s.session_id, 180, "exact pose session identity")?;
    // RuntimePlayerBindingWireV1 uses UTF-8 bytes, not the guest-label cap.
    for value in [&s.actor_id, &s.external_entity_id] {
        if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
            return Err(error(
                NetworkErrorCode::InvalidLabel,
                "exact pose runtime binding label",
            ));
        }
    }
    // Entity slot zero is valid; generation zero is not live. Player IDs are
    // derived packed identities and may use either half of the nonzero u64.
    if s.player_id.packed() == 0 || s.entity_id.0.generation() == 0 {
        return Err(error(NetworkErrorCode::InvalidInteger, "exact pose packed identity"));
    }
    for (values, cap) in [
        (&s.position, NETWORK_PLAYER_POSE_MAX_ABS_POSITION_V2),
        (&s.velocity, NETWORK_PLAYER_POSE_MAX_ABS_VELOCITY_V2),
    ] {
        if values.iter().any(|v| !v.is_finite() || v.abs() > cap) {
            return Err(error(NetworkErrorCode::WireType, "exact pose native physics bound"));
        }
    }
    if !s.yaw.is_finite()
        || s.yaw.abs() > std::f64::consts::PI
        || !s.pitch.is_finite()
        || s.pitch.abs() > std::f64::consts::FRAC_PI_2
    {
        return Err(error(NetworkErrorCode::WireType, "exact pose native look bound"));
    }
    Ok(())
}
fn digest(domain: &str, bytes: &[u8]) -> CanonicalHash {
    let mut h = CanonicalHasher::new(domain);
    h.write_bytes(bytes);
    h.finish()
}
fn write_pose(bytes: &mut Vec<u8>, s: &NetworkPlayerPoseSourceV2) {
    for v in s.position.into_iter().chain(s.velocity).chain([s.yaw, s.pitch]) {
        bytes.extend_from_slice(&v.to_bits().to_le_bytes());
    }
    bytes.push(u8::from(s.grounded));
}
fn pose_hash(s: &NetworkPlayerPoseSourceV2) -> CanonicalHash {
    let mut bytes = NETWORK_PLAYER_POSE_SCHEMA_V2.to_le_bytes().to_vec();
    write_pose(&mut bytes, s);
    digest(POSE_DOMAIN, &bytes)
}
fn projection_prefix(s: &NetworkPlayerPoseSourceV2, pose_hash: CanonicalHash) -> Vec<u8> {
    let mut body = Vec::new();
    for v in [
        &s.universe_id,
        &s.location_id,
        &s.session_id,
        &s.actor_id,
        &s.external_entity_id,
    ] {
        // validate_source bounds every UTF-8 label below u16::MAX.
        body.extend_from_slice(&(v.len() as u16).to_le_bytes());
        body.extend_from_slice(v.as_bytes());
    }
    let r = s.revision;
    for v in [
        s.player_id.packed(),
        s.entity_id.packed(),
        s.tick,
        s.input_sequence,
        r.epoch,
        r.world,
        r.entities,
        r.gameplay,
        r.persistence,
        r.network,
        r.simulation,
    ] {
        body.extend_from_slice(&v.to_le_bytes());
    }
    body.extend_from_slice(s.state_hash.as_bytes());
    write_pose(&mut body, s);
    let mut bytes = MAGIC.to_vec();
    bytes.extend_from_slice(&NETWORK_PLAYER_POSE_SCHEMA_V2.to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.extend_from_slice(&(body.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&body);
    bytes.extend_from_slice(pose_hash.as_bytes());
    bytes
}
struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], NetworkError> {
        let end = self
            .offset
            .checked_add(count)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| error(NetworkErrorCode::Truncated, "exact pose truncated"))?;
        let result = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(result)
    }
    fn array<const N: usize>(&mut self) -> Result<[u8; N], NetworkError> {
        Ok(self.take(N)?.try_into().expect("checked fixed length"))
    }
    fn u16(&mut self) -> Result<u16, NetworkError> {
        Ok(u16::from_le_bytes(self.array()?))
    }
    fn u32(&mut self) -> Result<u32, NetworkError> {
        Ok(u32::from_le_bytes(self.array()?))
    }
    fn u64(&mut self) -> Result<u64, NetworkError> {
        Ok(u64::from_le_bytes(self.array()?))
    }
    fn f64(&mut self) -> Result<f64, NetworkError> {
        Ok(f64::from_bits(self.u64()?))
    }
    fn flag(&mut self) -> Result<bool, NetworkError> {
        match self.take(1)?[0] {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(error(NetworkErrorCode::InvalidEnum, "exact pose boolean")),
        }
    }
    fn string(&mut self, cap: usize) -> Result<String, NetworkError> {
        let length = usize::from(self.u16()?);
        if length == 0 || length > cap {
            return Err(error(NetworkErrorCode::Budget, "exact pose string byte bound"));
        }
        let s = std::str::from_utf8(self.take(length)?)
            .map_err(|_| error(NetworkErrorCode::InvalidLabel, "exact pose invalid UTF-8"))?;
        Ok(s.to_owned())
    }
}
