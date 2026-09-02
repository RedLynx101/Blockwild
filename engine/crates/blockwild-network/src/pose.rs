//! Canonical native custody for one guest player pose.
//!
//! The browser may carry richer appearance and equipment hints beside a pose,
//! but those values never enter this payload. Only bounded spatial and control
//! state reaches Rust authority.

use blockwild_types::{CanonicalHash, CanonicalHasher};

use crate::{NETWORK_MAX_SAFE_INTEGER_V1, NetworkError, NetworkErrorCode, label, safe_integer};

pub const NETWORK_PLAYER_POSE_SCHEMA_V1: u16 = 1;
pub const NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1: usize = 4 * 1024;
pub const NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1: usize = 16 * 1024;
pub const NETWORK_PLAYER_POSE_MAX_HORIZONTAL_MILLIBLOCKS_V1: i32 = 2_000_000_000;
pub const NETWORK_PLAYER_POSE_MAX_VERTICAL_MILLIBLOCKS_V1: i32 = 4_096_000;
pub const NETWORK_PLAYER_POSE_MAX_YAW_MILLIRADIANS_V1: i32 = 100_000_000;
pub const NETWORK_PLAYER_POSE_MAX_PITCH_MILLIRADIANS_V1: i32 = 3_142;
pub const NETWORK_PLAYER_POSE_MAX_VELOCITY_MILLIBLOCKS_PER_SECOND_V1: i32 = 256_000;

const POSE_MAGIC: [u8; 4] = *b"BWNP";
const PROJECTION_MAGIC: [u8; 4] = *b"BWPP";

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum NetworkPlayerPoseActionV1 {
    None = 0,
    Mine = 1,
    Use = 2,
}

impl NetworkPlayerPoseActionV1 {
    fn from_wire(value: u8) -> Result<Self, NetworkError> {
        match value {
            0 => Ok(Self::None),
            1 => Ok(Self::Mine),
            2 => Ok(Self::Use),
            _ => Err(NetworkError::new(
                NetworkErrorCode::InvalidEnum,
                "unknown native player pose action",
            )),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkPlayerPoseSourceV1 {
    pub player_id: String,
    pub tick: u64,
    pub x_milliblocks: i32,
    pub y_milliblocks: i32,
    pub z_milliblocks: i32,
    pub yaw_milliradians: i32,
    pub pitch_milliradians: i32,
    pub velocity_x_milliblocks_per_second: i32,
    pub velocity_y_milliblocks_per_second: i32,
    pub velocity_z_milliblocks_per_second: i32,
    pub grounded: bool,
    pub selected_slot: Option<u8>,
    pub shield_raised: bool,
    pub crouching: bool,
    pub sprinting: bool,
    pub action: NetworkPlayerPoseActionV1,
    pub swimming_per_mille: Option<u16>,
    pub seated_per_mille: Option<u16>,
    pub boat_id: Option<String>,
    pub boat_seat: Option<u8>,
    pub boat_forward_per_mille: Option<i32>,
    pub boat_turn_per_mille: Option<i32>,
    pub mounted_creature_id: Option<u64>,
    pub mounted_creature_seat: Option<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkPlayerPoseV1 {
    pub schema_version: u16,
    pub player_id: String,
    pub tick: u64,
    pub x_milliblocks: i32,
    pub y_milliblocks: i32,
    pub z_milliblocks: i32,
    pub yaw_milliradians: i32,
    pub pitch_milliradians: i32,
    pub velocity_x_milliblocks_per_second: i32,
    pub velocity_y_milliblocks_per_second: i32,
    pub velocity_z_milliblocks_per_second: i32,
    pub grounded: bool,
    pub selected_slot: Option<u8>,
    pub shield_raised: bool,
    pub crouching: bool,
    pub sprinting: bool,
    pub action: NetworkPlayerPoseActionV1,
    pub swimming_per_mille: Option<u16>,
    pub seated_per_mille: Option<u16>,
    pub boat_id: Option<String>,
    pub boat_seat: Option<u8>,
    pub boat_forward_per_mille: Option<i32>,
    pub boat_turn_per_mille: Option<i32>,
    pub mounted_creature_id: Option<u64>,
    pub mounted_creature_seat: Option<u8>,
    pub pose_hash: CanonicalHash,
}

impl NetworkPlayerPoseV1 {
    pub fn new(source: NetworkPlayerPoseSourceV1) -> Result<Self, NetworkError> {
        validate_pose_source(&source)?;
        let mut pose = Self {
            schema_version: NETWORK_PLAYER_POSE_SCHEMA_V1,
            player_id: source.player_id,
            tick: source.tick,
            x_milliblocks: source.x_milliblocks,
            y_milliblocks: source.y_milliblocks,
            z_milliblocks: source.z_milliblocks,
            yaw_milliradians: source.yaw_milliradians,
            pitch_milliradians: source.pitch_milliradians,
            velocity_x_milliblocks_per_second: source.velocity_x_milliblocks_per_second,
            velocity_y_milliblocks_per_second: source.velocity_y_milliblocks_per_second,
            velocity_z_milliblocks_per_second: source.velocity_z_milliblocks_per_second,
            grounded: source.grounded,
            selected_slot: source.selected_slot,
            shield_raised: source.shield_raised,
            crouching: source.crouching,
            sprinting: source.sprinting,
            action: source.action,
            swimming_per_mille: source.swimming_per_mille,
            seated_per_mille: source.seated_per_mille,
            boat_id: source.boat_id,
            boat_seat: source.boat_seat,
            boat_forward_per_mille: source.boat_forward_per_mille,
            boat_turn_per_mille: source.boat_turn_per_mille,
            mounted_creature_id: source.mounted_creature_id,
            mounted_creature_seat: source.mounted_creature_seat,
            pose_hash: CanonicalHash::default(),
        };
        pose.pose_hash = pose_hash(&encode_pose_body(&pose)?);
        Ok(pose)
    }

    pub fn validate(&self) -> Result<(), NetworkError> {
        if self.schema_version != NETWORK_PLAYER_POSE_SCHEMA_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::SchemaMismatch,
                "native player pose schema mismatch",
            ));
        }
        let rebuilt = Self::new(self.source())?;
        if rebuilt != *self {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "native player pose hash mismatch",
            ));
        }
        Ok(())
    }

    fn source(&self) -> NetworkPlayerPoseSourceV1 {
        NetworkPlayerPoseSourceV1 {
            player_id: self.player_id.clone(),
            tick: self.tick,
            x_milliblocks: self.x_milliblocks,
            y_milliblocks: self.y_milliblocks,
            z_milliblocks: self.z_milliblocks,
            yaw_milliradians: self.yaw_milliradians,
            pitch_milliradians: self.pitch_milliradians,
            velocity_x_milliblocks_per_second: self.velocity_x_milliblocks_per_second,
            velocity_y_milliblocks_per_second: self.velocity_y_milliblocks_per_second,
            velocity_z_milliblocks_per_second: self.velocity_z_milliblocks_per_second,
            grounded: self.grounded,
            selected_slot: self.selected_slot,
            shield_raised: self.shield_raised,
            crouching: self.crouching,
            sprinting: self.sprinting,
            action: self.action,
            swimming_per_mille: self.swimming_per_mille,
            seated_per_mille: self.seated_per_mille,
            boat_id: self.boat_id.clone(),
            boat_seat: self.boat_seat,
            boat_forward_per_mille: self.boat_forward_per_mille,
            boat_turn_per_mille: self.boat_turn_per_mille,
            mounted_creature_id: self.mounted_creature_id,
            mounted_creature_seat: self.mounted_creature_seat,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkPlayerPoseProjectionSourceV1 {
    pub session_id: String,
    pub peer_id: String,
    pub connection_id: String,
    pub player_id: String,
    pub command_id: String,
    pub command_sequence: u64,
    pub command_hash: CanonicalHash,
    pub receipt_hash: CanonicalHash,
    pub presented_delta_sequence: u64,
    pub presented_identity_hash: CanonicalHash,
    pub record_revision: u64,
    pub previous_record_hash: CanonicalHash,
    pub pose: NetworkPlayerPoseV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkPlayerPoseProjectionV1 {
    pub schema_version: u16,
    pub session_id: String,
    pub peer_id: String,
    pub connection_id: String,
    pub player_id: String,
    pub command_id: String,
    pub command_sequence: u64,
    pub command_hash: CanonicalHash,
    pub receipt_hash: CanonicalHash,
    pub presented_delta_sequence: u64,
    pub presented_identity_hash: CanonicalHash,
    pub record_revision: u64,
    pub previous_record_hash: CanonicalHash,
    pub pose: NetworkPlayerPoseV1,
    pub record_hash: CanonicalHash,
    pub projection_hash: CanonicalHash,
}

impl NetworkPlayerPoseProjectionV1 {
    pub fn new(source: NetworkPlayerPoseProjectionSourceV1) -> Result<Self, NetworkError> {
        for value in [
            &source.session_id,
            &source.peer_id,
            &source.connection_id,
            &source.player_id,
            &source.command_id,
        ] {
            label(value, 180, "native player pose projection label")?;
        }
        safe_integer(source.command_sequence, "native player pose command sequence")?;
        safe_integer(
            source.presented_delta_sequence,
            "native player pose presentation sequence",
        )?;
        safe_integer(source.record_revision, "native player pose record revision")?;
        if source.record_revision == 0 {
            return Err(NetworkError::new(
                NetworkErrorCode::InvalidInteger,
                "native player pose record revision must be positive",
            ));
        }
        if (source.record_revision == 1) != (source.previous_record_hash == CanonicalHash::default()) {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "native player pose predecessor does not match its record revision",
            ));
        }
        source.pose.validate()?;
        if source.player_id != source.pose.player_id {
            return Err(NetworkError::new(
                NetworkErrorCode::InvalidLabel,
                "native player pose projection player does not match its pose",
            ));
        }
        let record_hash = network_player_pose_record_hash_v1(
            &source.session_id,
            &source.peer_id,
            &source.player_id,
            source.record_revision,
            source.previous_record_hash,
            source.pose.pose_hash,
        );
        let projection_hash = network_player_pose_projection_hash_v1(
            &source.session_id,
            &source.peer_id,
            &source.connection_id,
            &source.player_id,
            &source.command_id,
            source.command_sequence,
            source.command_hash,
            source.receipt_hash,
            source.presented_delta_sequence,
            source.presented_identity_hash,
            source.record_revision,
            record_hash,
        );
        Ok(Self {
            schema_version: NETWORK_PLAYER_POSE_SCHEMA_V1,
            session_id: source.session_id,
            peer_id: source.peer_id,
            connection_id: source.connection_id,
            player_id: source.player_id,
            command_id: source.command_id,
            command_sequence: source.command_sequence,
            command_hash: source.command_hash,
            receipt_hash: source.receipt_hash,
            presented_delta_sequence: source.presented_delta_sequence,
            presented_identity_hash: source.presented_identity_hash,
            record_revision: source.record_revision,
            previous_record_hash: source.previous_record_hash,
            pose: source.pose,
            record_hash,
            projection_hash,
        })
    }

    pub fn validate(&self) -> Result<(), NetworkError> {
        if self.schema_version != NETWORK_PLAYER_POSE_SCHEMA_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::SchemaMismatch,
                "native player pose projection schema mismatch",
            ));
        }
        let rebuilt = Self::new(NetworkPlayerPoseProjectionSourceV1 {
            session_id: self.session_id.clone(),
            peer_id: self.peer_id.clone(),
            connection_id: self.connection_id.clone(),
            player_id: self.player_id.clone(),
            command_id: self.command_id.clone(),
            command_sequence: self.command_sequence,
            command_hash: self.command_hash,
            receipt_hash: self.receipt_hash,
            presented_delta_sequence: self.presented_delta_sequence,
            presented_identity_hash: self.presented_identity_hash,
            record_revision: self.record_revision,
            previous_record_hash: self.previous_record_hash,
            pose: self.pose.clone(),
        })?;
        if rebuilt != *self {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "native player pose projection hash mismatch",
            ));
        }
        Ok(())
    }
}

#[must_use]
pub fn network_player_pose_record_hash_v1(
    session_id: &str,
    peer_id: &str,
    player_id: &str,
    record_revision: u64,
    previous_record_hash: CanonicalHash,
    pose_hash: CanonicalHash,
) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-network-player-pose-record-v1");
    hasher.write_str(session_id);
    hasher.write_str(peer_id);
    hasher.write_str(player_id);
    hasher.write_u64(record_revision);
    hasher.write_bytes(previous_record_hash.as_bytes());
    hasher.write_bytes(pose_hash.as_bytes());
    hasher.finish()
}

#[allow(clippy::too_many_arguments)]
#[must_use]
pub fn network_player_pose_projection_hash_v1(
    session_id: &str,
    peer_id: &str,
    connection_id: &str,
    player_id: &str,
    command_id: &str,
    command_sequence: u64,
    command_hash: CanonicalHash,
    receipt_hash: CanonicalHash,
    presented_delta_sequence: u64,
    presented_identity_hash: CanonicalHash,
    record_revision: u64,
    record_hash: CanonicalHash,
) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-network-player-pose-projection-v1");
    hasher.write_str(session_id);
    hasher.write_str(peer_id);
    hasher.write_str(connection_id);
    hasher.write_str(player_id);
    hasher.write_str(command_id);
    hasher.write_u64(command_sequence);
    hasher.write_bytes(command_hash.as_bytes());
    hasher.write_bytes(receipt_hash.as_bytes());
    hasher.write_u64(presented_delta_sequence);
    hasher.write_bytes(presented_identity_hash.as_bytes());
    hasher.write_u64(record_revision);
    hasher.write_bytes(record_hash.as_bytes());
    hasher.finish()
}

pub fn encode_network_player_pose_v1(value: &NetworkPlayerPoseV1) -> Result<Vec<u8>, NetworkError> {
    value.validate()?;
    let mut bytes = encode_pose_body(value)?;
    bytes.extend_from_slice(value.pose_hash.as_bytes());
    if bytes.len() > NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::Budget,
            "native player pose exceeds its V1 wire budget",
        ));
    }
    Ok(bytes)
}

pub fn decode_network_player_pose_v1(bytes: &[u8]) -> Result<NetworkPlayerPoseV1, NetworkError> {
    if bytes.len() > NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::Budget,
            "native player pose exceeds its V1 wire budget",
        ));
    }
    let mut reader = Reader::new(bytes);
    if reader.array_4()? != POSE_MAGIC {
        return Err(NetworkError::new(
            NetworkErrorCode::WireMagic,
            "native player pose magic mismatch",
        ));
    }
    let schema_version = reader.u16()?;
    if schema_version != NETWORK_PLAYER_POSE_SCHEMA_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::SchemaMismatch,
            "native player pose schema mismatch",
        ));
    }
    let source = NetworkPlayerPoseSourceV1 {
        player_id: reader.string(180)?,
        tick: reader.u64()?,
        x_milliblocks: reader.i32()?,
        y_milliblocks: reader.i32()?,
        z_milliblocks: reader.i32()?,
        yaw_milliradians: reader.i32()?,
        pitch_milliradians: reader.i32()?,
        velocity_x_milliblocks_per_second: reader.i32()?,
        velocity_y_milliblocks_per_second: reader.i32()?,
        velocity_z_milliblocks_per_second: reader.i32()?,
        grounded: reader.flag()?,
        selected_slot: reader.option_u8()?,
        shield_raised: reader.flag()?,
        crouching: reader.flag()?,
        sprinting: reader.flag()?,
        action: NetworkPlayerPoseActionV1::from_wire(reader.u8()?)?,
        swimming_per_mille: reader.option_u16()?,
        seated_per_mille: reader.option_u16()?,
        boat_id: reader.option_string(180)?,
        boat_seat: reader.option_u8()?,
        boat_forward_per_mille: reader.option_i32()?,
        boat_turn_per_mille: reader.option_i32()?,
        mounted_creature_id: reader.option_u64()?,
        mounted_creature_seat: reader.option_u8()?,
    };
    let expected_hash = reader.hash()?;
    reader.finish()?;
    let pose = NetworkPlayerPoseV1::new(source)?;
    if pose.pose_hash != expected_hash {
        return Err(NetworkError::new(
            NetworkErrorCode::HashMismatch,
            "native player pose payload hash mismatch",
        ));
    }
    Ok(pose)
}

pub fn encode_network_player_pose_projection_v1(
    value: &NetworkPlayerPoseProjectionV1,
) -> Result<Vec<u8>, NetworkError> {
    value.validate()?;
    let pose = encode_network_player_pose_v1(&value.pose)?;
    let mut writer = Writer::default();
    writer.raw(&PROJECTION_MAGIC);
    writer.u16(value.schema_version);
    writer.string(&value.session_id)?;
    writer.string(&value.peer_id)?;
    writer.string(&value.connection_id)?;
    writer.string(&value.player_id)?;
    writer.string(&value.command_id)?;
    writer.u64(value.command_sequence);
    writer.hash(value.command_hash);
    writer.hash(value.receipt_hash);
    writer.u64(value.presented_delta_sequence);
    writer.hash(value.presented_identity_hash);
    writer.u64(value.record_revision);
    writer.hash(value.previous_record_hash);
    writer.bytes(&pose)?;
    writer.hash(value.record_hash);
    writer.hash(value.projection_hash);
    let bytes = writer.finish();
    if bytes.len() > NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::Budget,
            "native player pose projection exceeds its V1 wire budget",
        ));
    }
    Ok(bytes)
}

pub fn decode_network_player_pose_projection_v1(bytes: &[u8]) -> Result<NetworkPlayerPoseProjectionV1, NetworkError> {
    if bytes.len() > NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::Budget,
            "native player pose projection exceeds its V1 wire budget",
        ));
    }
    let mut reader = Reader::new(bytes);
    if reader.array_4()? != PROJECTION_MAGIC {
        return Err(NetworkError::new(
            NetworkErrorCode::WireMagic,
            "native player pose projection magic mismatch",
        ));
    }
    let schema_version = reader.u16()?;
    if schema_version != NETWORK_PLAYER_POSE_SCHEMA_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::SchemaMismatch,
            "native player pose projection schema mismatch",
        ));
    }
    let session_id = reader.string(180)?;
    let peer_id = reader.string(180)?;
    let connection_id = reader.string(180)?;
    let player_id = reader.string(180)?;
    let command_id = reader.string(180)?;
    let command_sequence = reader.u64()?;
    let command_hash = reader.hash()?;
    let receipt_hash = reader.hash()?;
    let presented_delta_sequence = reader.u64()?;
    let presented_identity_hash = reader.hash()?;
    let record_revision = reader.u64()?;
    let previous_record_hash = reader.hash()?;
    let pose = decode_network_player_pose_v1(&reader.bytes(NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1)?)?;
    let expected_record_hash = reader.hash()?;
    let expected_projection_hash = reader.hash()?;
    reader.finish()?;
    let projection = NetworkPlayerPoseProjectionV1::new(NetworkPlayerPoseProjectionSourceV1 {
        session_id,
        peer_id,
        connection_id,
        player_id,
        command_id,
        command_sequence,
        command_hash,
        receipt_hash,
        presented_delta_sequence,
        presented_identity_hash,
        record_revision,
        previous_record_hash,
        pose,
    })?;
    if projection.record_hash != expected_record_hash || projection.projection_hash != expected_projection_hash {
        return Err(NetworkError::new(
            NetworkErrorCode::HashMismatch,
            "native player pose projection record or projection hash mismatch",
        ));
    }
    Ok(projection)
}

fn validate_pose_source(source: &NetworkPlayerPoseSourceV1) -> Result<(), NetworkError> {
    label(&source.player_id, 180, "native player pose player id")?;
    safe_integer(source.tick, "native player pose tick")?;
    bounded_i32(
        source.x_milliblocks,
        NETWORK_PLAYER_POSE_MAX_HORIZONTAL_MILLIBLOCKS_V1,
        "native player pose horizontal position is outside V1 bounds",
    )?;
    bounded_i32(
        source.y_milliblocks,
        NETWORK_PLAYER_POSE_MAX_VERTICAL_MILLIBLOCKS_V1,
        "native player pose vertical position is outside V1 bounds",
    )?;
    bounded_i32(
        source.z_milliblocks,
        NETWORK_PLAYER_POSE_MAX_HORIZONTAL_MILLIBLOCKS_V1,
        "native player pose horizontal position is outside V1 bounds",
    )?;
    bounded_i32(
        source.yaw_milliradians,
        NETWORK_PLAYER_POSE_MAX_YAW_MILLIRADIANS_V1,
        "native player pose yaw is outside V1 bounds",
    )?;
    bounded_i32(
        source.pitch_milliradians,
        NETWORK_PLAYER_POSE_MAX_PITCH_MILLIRADIANS_V1,
        "native player pose pitch is outside V1 bounds",
    )?;
    for velocity in [
        source.velocity_x_milliblocks_per_second,
        source.velocity_y_milliblocks_per_second,
        source.velocity_z_milliblocks_per_second,
    ] {
        bounded_i32(
            velocity,
            NETWORK_PLAYER_POSE_MAX_VELOCITY_MILLIBLOCKS_PER_SECOND_V1,
            "native player pose velocity is outside V1 bounds",
        )?;
    }
    if source.selected_slot.is_some_and(|value| value > 8) {
        return Err(NetworkError::new(
            NetworkErrorCode::InvalidInteger,
            "native player pose selected slot is outside V1 bounds",
        ));
    }
    for value in [source.swimming_per_mille, source.seated_per_mille]
        .into_iter()
        .flatten()
    {
        if value > 1_000 {
            return Err(NetworkError::new(
                NetworkErrorCode::InvalidInteger,
                "native player pose fraction is outside V1 bounds",
            ));
        }
    }
    if let Some(boat_id) = &source.boat_id {
        label(boat_id, 180, "native player pose boat id")?;
    }
    if source.boat_seat.is_some_and(|value| value > 1) {
        return Err(NetworkError::new(
            NetworkErrorCode::InvalidInteger,
            "native player pose boat seat is outside V1 bounds",
        ));
    }
    for value in [source.boat_forward_per_mille, source.boat_turn_per_mille]
        .into_iter()
        .flatten()
    {
        bounded_i32(value, 1_000, "native player pose boat input is outside V1 bounds")?;
    }
    if source.boat_id.is_none()
        && (source.boat_seat.is_some()
            || source.boat_forward_per_mille.is_some()
            || source.boat_turn_per_mille.is_some())
    {
        return Err(NetworkError::new(
            NetworkErrorCode::InvalidLabel,
            "native player pose boat fields require a boat id",
        ));
    }
    if let Some(entity_id) = source.mounted_creature_id {
        safe_integer(entity_id, "native player pose mounted creature id")?;
    }
    if source.mounted_creature_seat.is_some_and(|value| value > 3) {
        return Err(NetworkError::new(
            NetworkErrorCode::InvalidInteger,
            "native player pose mounted creature seat is outside V1 bounds",
        ));
    }
    if source.mounted_creature_id.is_none() && source.mounted_creature_seat.is_some() {
        return Err(NetworkError::new(
            NetworkErrorCode::InvalidLabel,
            "native player pose mounted creature seat requires a creature id",
        ));
    }
    Ok(())
}

fn bounded_i32(value: i32, maximum: i32, message: &'static str) -> Result<(), NetworkError> {
    if (-maximum..=maximum).contains(&value) {
        Ok(())
    } else {
        Err(NetworkError::new(NetworkErrorCode::InvalidInteger, message))
    }
}

fn encode_pose_body(value: &NetworkPlayerPoseV1) -> Result<Vec<u8>, NetworkError> {
    let mut writer = Writer::default();
    writer.raw(&POSE_MAGIC);
    writer.u16(value.schema_version);
    writer.string(&value.player_id)?;
    writer.u64(value.tick);
    writer.i32(value.x_milliblocks);
    writer.i32(value.y_milliblocks);
    writer.i32(value.z_milliblocks);
    writer.i32(value.yaw_milliradians);
    writer.i32(value.pitch_milliradians);
    writer.i32(value.velocity_x_milliblocks_per_second);
    writer.i32(value.velocity_y_milliblocks_per_second);
    writer.i32(value.velocity_z_milliblocks_per_second);
    writer.flag(value.grounded);
    writer.option_u8(value.selected_slot);
    writer.flag(value.shield_raised);
    writer.flag(value.crouching);
    writer.flag(value.sprinting);
    writer.u8(value.action as u8);
    writer.option_u16(value.swimming_per_mille);
    writer.option_u16(value.seated_per_mille);
    writer.option_string(value.boat_id.as_deref())?;
    writer.option_u8(value.boat_seat);
    writer.option_i32(value.boat_forward_per_mille);
    writer.option_i32(value.boat_turn_per_mille);
    writer.option_u64(value.mounted_creature_id);
    writer.option_u8(value.mounted_creature_seat);
    Ok(writer.finish())
}

fn pose_hash(body: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-network-player-pose-payload-v1");
    hasher.write_bytes(body);
    hasher.finish()
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn raw(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }
    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }
    fn u16(&mut self, value: u16) {
        self.raw(&value.to_le_bytes());
    }
    fn i32(&mut self, value: i32) {
        self.raw(&value.to_le_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.raw(&value.to_le_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.raw(&value.to_le_bytes());
    }
    fn flag(&mut self, value: bool) {
        self.u8(u8::from(value));
    }
    fn hash(&mut self, value: CanonicalHash) {
        self.raw(value.as_bytes());
    }
    fn bytes(&mut self, value: &[u8]) -> Result<(), NetworkError> {
        let length = u32::try_from(value.len())
            .map_err(|_| NetworkError::new(NetworkErrorCode::Budget, "native player pose byte field exceeds u32"))?;
        self.u32(length);
        self.raw(value);
        Ok(())
    }
    fn string(&mut self, value: &str) -> Result<(), NetworkError> {
        self.bytes(value.as_bytes())
    }
    fn option_u8(&mut self, value: Option<u8>) {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.u8(value);
        }
    }
    fn option_u16(&mut self, value: Option<u16>) {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.u16(value);
        }
    }
    fn option_i32(&mut self, value: Option<i32>) {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.i32(value);
        }
    }
    fn option_u64(&mut self, value: Option<u64>) {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.u64(value);
        }
    }
    fn option_string(&mut self, value: Option<&str>) -> Result<(), NetworkError> {
        self.flag(value.is_some());
        if let Some(value) = value {
            self.string(value)?;
        }
        Ok(())
    }
    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8], NetworkError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| NetworkError::new(NetworkErrorCode::Truncated, "native player pose offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| NetworkError::new(NetworkErrorCode::Truncated, "native player pose is truncated"))?;
        self.offset = end;
        Ok(value)
    }
    fn array_4(&mut self) -> Result<[u8; 4], NetworkError> {
        Ok(self.take(4)?.try_into().expect("fixed slice"))
    }
    fn u8(&mut self) -> Result<u8, NetworkError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, NetworkError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("fixed slice")))
    }
    fn i32(&mut self) -> Result<i32, NetworkError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }
    fn u32(&mut self) -> Result<u32, NetworkError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }
    fn u64(&mut self) -> Result<u64, NetworkError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().expect("fixed slice")))
    }
    fn flag(&mut self) -> Result<bool, NetworkError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(NetworkError::new(
                NetworkErrorCode::WireType,
                "native player pose option flag is not 0 or 1",
            )),
        }
    }
    fn hash(&mut self) -> Result<CanonicalHash, NetworkError> {
        Ok(CanonicalHash(self.take(16)?.try_into().expect("fixed slice")))
    }
    fn bytes(&mut self, maximum: usize) -> Result<Vec<u8>, NetworkError> {
        let length = self.u32()? as usize;
        if length > maximum {
            return Err(NetworkError::new(
                NetworkErrorCode::Budget,
                "native player pose byte field exceeds V1 budget",
            ));
        }
        Ok(self.take(length)?.to_vec())
    }
    fn string(&mut self, maximum_utf16: usize) -> Result<String, NetworkError> {
        let value = String::from_utf8(self.bytes(NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1)?)
            .map_err(|_| NetworkError::new(NetworkErrorCode::WireType, "native player pose string is not UTF-8"))?;
        label(&value, maximum_utf16, "native player pose string")?;
        Ok(value)
    }
    fn option_u8(&mut self) -> Result<Option<u8>, NetworkError> {
        if self.flag()? { Ok(Some(self.u8()?)) } else { Ok(None) }
    }
    fn option_u16(&mut self) -> Result<Option<u16>, NetworkError> {
        if self.flag()? { Ok(Some(self.u16()?)) } else { Ok(None) }
    }
    fn option_i32(&mut self) -> Result<Option<i32>, NetworkError> {
        if self.flag()? { Ok(Some(self.i32()?)) } else { Ok(None) }
    }
    fn option_u64(&mut self) -> Result<Option<u64>, NetworkError> {
        if self.flag()? { Ok(Some(self.u64()?)) } else { Ok(None) }
    }
    fn option_string(&mut self, maximum_utf16: usize) -> Result<Option<String>, NetworkError> {
        if self.flag()? {
            Ok(Some(self.string(maximum_utf16)?))
        } else {
            Ok(None)
        }
    }
    fn finish(&self) -> Result<(), NetworkError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(NetworkError::new(
                NetworkErrorCode::TrailingBytes,
                "native player pose contains trailing bytes",
            ))
        }
    }
}

const _: () = assert!(NETWORK_MAX_SAFE_INTEGER_V1 < u64::MAX);
