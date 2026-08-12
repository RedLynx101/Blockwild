//! Canonical persistence codec for [`crate::WorldViewAuthorityV1`].

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;

use blockwild_types::{CanonicalHash, CanonicalHasher, EntityId, PlayerId};

use crate::world_view::{
    WORLD_VIEW_IDEMPOTENCY_WINDOW_V1, WORLD_VIEW_MAX_CELESTIAL_BODIES_V1, WORLD_VIEW_MAX_DROPPED_ITEMS_V1,
    WORLD_VIEW_MAX_MACHINE_ANCHORS_V1, WORLD_VIEW_MAX_PLAYER_BINDINGS_V1, WORLD_VIEW_REPLAY_WINDOW_V1,
    WorldViewAuthorityPartsV1, WorldViewIdempotencyEntryV1,
};
use crate::*;

pub const WORLD_VIEW_SNAPSHOT_SCHEMA_VERSION_V1: u16 = 1;
pub const WORLD_VIEW_SNAPSHOT_SCHEMA_VERSION_V2: u16 = 2;
pub const WORLD_VIEW_MAX_SNAPSHOT_BYTES_V1: usize = 64 * 1024 * 1024;
pub const WORLD_VIEW_MAX_SNAPSHOT_EXTENSIONS_V1: usize = 1024 * 1024;

const WORLD_VIEW_SNAPSHOT_MAGIC_V1: [u8; 8] = *b"BWVWSP\0\0";
const WORLD_VIEW_SNAPSHOT_FLAGS_V1: u16 = 0;
const WORLD_VIEW_SNAPSHOT_HEADER_BYTES_V1: usize = 68;
const WORLD_VIEW_MAX_SNAPSHOT_STRING_BYTES_V1: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorldViewSnapshotErrorCodeV1 {
    InvalidHeader,
    UnsupportedVersion,
    Capacity,
    Truncated,
    Corrupt,
    InvalidUtf8,
    InvalidValue,
    DuplicateKey,
    AuthorityRejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewSnapshotErrorV1 {
    pub code: WorldViewSnapshotErrorCodeV1,
    pub offset: usize,
    pub message: String,
}

impl WorldViewSnapshotErrorV1 {
    fn new(code: WorldViewSnapshotErrorCodeV1, offset: usize, message: impl Into<String>) -> Self {
        Self {
            code,
            offset,
            message: message.into(),
        }
    }
}

impl fmt::Display for WorldViewSnapshotErrorV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} at byte {}", self.message, self.offset)
    }
}

impl std::error::Error for WorldViewSnapshotErrorV1 {}

#[derive(Clone, Debug)]
pub struct DecodedWorldViewAuthoritySnapshotV1 {
    pub authority: WorldViewAuthorityV1,
    pub unknown_extension_bytes: Vec<u8>,
    pub snapshot_hash: CanonicalHash,
    pub schema_version: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldViewSnapshotInstallReportV1 {
    pub schema_version: u16,
    pub state_hash: CanonicalHash,
    pub replay_hash: CanonicalHash,
    pub snapshot_hash: CanonicalHash,
    pub unknown_extension_bytes: Vec<u8>,
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn raw(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    fn u8(&mut self, value: u8) {
        self.raw(&[value]);
    }

    fn u16(&mut self, value: u16) {
        self.raw(&value.to_le_bytes());
    }

    fn u32(&mut self, value: u32) {
        self.raw(&value.to_le_bytes());
    }

    fn i32(&mut self, value: i32) {
        self.raw(&value.to_le_bytes());
    }

    fn u64(&mut self, value: u64) {
        self.raw(&value.to_le_bytes());
    }

    fn i64(&mut self, value: i64) {
        self.raw(&value.to_le_bytes());
    }

    fn bool(&mut self, value: bool) {
        self.u8(u8::from(value));
    }

    fn hash(&mut self, value: CanonicalHash) {
        self.raw(value.as_bytes());
    }

    fn count(&mut self, value: usize) -> Result<(), WorldViewSnapshotErrorV1> {
        self.u32(u32::try_from(value).map_err(|_| {
            WorldViewSnapshotErrorV1::new(
                WorldViewSnapshotErrorCodeV1::Capacity,
                self.bytes.len(),
                "world-view snapshot collection length exceeds u32",
            )
        })?);
        Ok(())
    }

    fn bytes(&mut self, value: &[u8], max: usize) -> Result<(), WorldViewSnapshotErrorV1> {
        if value.len() > max {
            return Err(WorldViewSnapshotErrorV1::new(
                WorldViewSnapshotErrorCodeV1::Capacity,
                self.bytes.len(),
                "world-view snapshot byte field exceeds its bound",
            ));
        }
        self.count(value.len())?;
        self.raw(value);
        Ok(())
    }

    fn string(&mut self, value: &str) -> Result<(), WorldViewSnapshotErrorV1> {
        self.bytes(value.as_bytes(), WORLD_VIEW_MAX_SNAPSHOT_STRING_BYTES_V1)
    }

    fn option_string(&mut self, value: Option<&str>) -> Result<(), WorldViewSnapshotErrorV1> {
        match value {
            Some(value) => {
                self.u8(1);
                self.string(value)
            }
            None => {
                self.u8(0);
                Ok(())
            }
        }
    }

    fn option_u16(&mut self, value: Option<u16>) {
        match value {
            Some(value) => {
                self.u8(1);
                self.u16(value);
            }
            None => self.u8(0),
        }
    }

    fn option_u64(&mut self, value: Option<u64>) {
        match value {
            Some(value) => {
                self.u8(1);
                self.u64(value);
            }
            None => self.u8(0),
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

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    fn raw(&mut self, count: usize) -> Result<&'a [u8], WorldViewSnapshotErrorV1> {
        let end = self.offset.checked_add(count).ok_or_else(|| {
            WorldViewSnapshotErrorV1::new(
                WorldViewSnapshotErrorCodeV1::Capacity,
                self.offset,
                "world-view snapshot offset overflow",
            )
        })?;
        let value = self.bytes.get(self.offset..end).ok_or_else(|| {
            WorldViewSnapshotErrorV1::new(
                WorldViewSnapshotErrorCodeV1::Truncated,
                self.offset,
                "world-view snapshot ended before a declared field",
            )
        })?;
        self.offset = end;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, WorldViewSnapshotErrorV1> {
        Ok(self.raw(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, WorldViewSnapshotErrorV1> {
        let mut bytes = [0; 2];
        bytes.copy_from_slice(self.raw(2)?);
        Ok(u16::from_le_bytes(bytes))
    }

    fn u32(&mut self) -> Result<u32, WorldViewSnapshotErrorV1> {
        let mut bytes = [0; 4];
        bytes.copy_from_slice(self.raw(4)?);
        Ok(u32::from_le_bytes(bytes))
    }

    fn i32(&mut self) -> Result<i32, WorldViewSnapshotErrorV1> {
        let mut bytes = [0; 4];
        bytes.copy_from_slice(self.raw(4)?);
        Ok(i32::from_le_bytes(bytes))
    }

    fn u64(&mut self) -> Result<u64, WorldViewSnapshotErrorV1> {
        let mut bytes = [0; 8];
        bytes.copy_from_slice(self.raw(8)?);
        Ok(u64::from_le_bytes(bytes))
    }

    fn i64(&mut self) -> Result<i64, WorldViewSnapshotErrorV1> {
        let mut bytes = [0; 8];
        bytes.copy_from_slice(self.raw(8)?);
        Ok(i64::from_le_bytes(bytes))
    }

    fn bool(&mut self) -> Result<bool, WorldViewSnapshotErrorV1> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(self.invalid("world-view snapshot boolean is not canonical")),
        }
    }

    fn hash(&mut self) -> Result<CanonicalHash, WorldViewSnapshotErrorV1> {
        let mut bytes = [0; 16];
        bytes.copy_from_slice(self.raw(16)?);
        Ok(CanonicalHash(bytes))
    }

    fn count(&mut self, max: usize) -> Result<usize, WorldViewSnapshotErrorV1> {
        let value = usize::try_from(self.u32()?)
            .map_err(|_| self.invalid("world-view snapshot collection cannot fit this platform"))?;
        if value > max {
            return Err(WorldViewSnapshotErrorV1::new(
                WorldViewSnapshotErrorCodeV1::Capacity,
                self.offset,
                "world-view snapshot collection exceeds its bound",
            ));
        }
        Ok(value)
    }

    fn bytes(&mut self, max: usize) -> Result<Vec<u8>, WorldViewSnapshotErrorV1> {
        let count = self.count(max)?;
        Ok(self.raw(count)?.to_vec())
    }

    fn string(&mut self) -> Result<String, WorldViewSnapshotErrorV1> {
        let offset = self.offset;
        String::from_utf8(self.bytes(WORLD_VIEW_MAX_SNAPSHOT_STRING_BYTES_V1)?).map_err(|_| {
            WorldViewSnapshotErrorV1::new(
                WorldViewSnapshotErrorCodeV1::InvalidUtf8,
                offset,
                "world-view snapshot string is not UTF-8",
            )
        })
    }

    fn option_string(&mut self) -> Result<Option<String>, WorldViewSnapshotErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.string()?)),
            _ => Err(self.invalid("world-view optional string tag is not canonical")),
        }
    }

    fn option_u16(&mut self) -> Result<Option<u16>, WorldViewSnapshotErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.u16()?)),
            _ => Err(self.invalid("world-view optional u16 tag is not canonical")),
        }
    }

    fn option_u64(&mut self) -> Result<Option<u64>, WorldViewSnapshotErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.u64()?)),
            _ => Err(self.invalid("world-view optional u64 tag is not canonical")),
        }
    }

    fn invalid(&self, message: impl Into<String>) -> WorldViewSnapshotErrorV1 {
        WorldViewSnapshotErrorV1::new(WorldViewSnapshotErrorCodeV1::InvalidValue, self.offset, message)
    }

    fn finish(self) -> Result<(), WorldViewSnapshotErrorV1> {
        if self.remaining() != 0 {
            return Err(WorldViewSnapshotErrorV1::new(
                WorldViewSnapshotErrorCodeV1::Corrupt,
                self.offset,
                "world-view snapshot has trailing bytes",
            ));
        }
        Ok(())
    }
}

impl WorldViewAuthorityV1 {
    pub fn encode_snapshot_v1(
        &self,
        gameplay: &GameplayState,
        unknown_extension_bytes: &[u8],
    ) -> Result<Vec<u8>, WorldViewSnapshotErrorV1> {
        self.state
            .validate_against_gameplay(gameplay)
            .map_err(authority_error)?;
        if unknown_extension_bytes.len() > WORLD_VIEW_MAX_SNAPSHOT_EXTENSIONS_V1 {
            return Err(WorldViewSnapshotErrorV1::new(
                WorldViewSnapshotErrorCodeV1::Capacity,
                0,
                "world-view snapshot extension exceeds its bound",
            ));
        }
        let parts = self.snapshot_parts();
        // Continue emitting byte-identical BWVWSP/1 records for states whose
        // pickup semantics are representable by the legacy implicit
        // `created_tick` deadline. The first explicit delayed unlock upgrades
        // the record to BWVWSP/2.
        let schema_version = if parts
            .state
            .dropped_items
            .values()
            .any(|drop| drop.pickup_unlock_tick != drop.created_tick)
        {
            WORLD_VIEW_SNAPSHOT_SCHEMA_VERSION_V2
        } else {
            WORLD_VIEW_SNAPSHOT_SCHEMA_VERSION_V1
        };
        let mut payload = Writer::default();
        encode_state(&mut payload, &parts.state, schema_version)?;
        encode_grants(&mut payload, &parts.grants)?;
        encode_idempotency(&mut payload, &parts.idempotency)?;
        encode_idempotency_order(&mut payload, &parts.idempotency_order)?;
        encode_replay(&mut payload, &parts.replay)?;
        payload.bytes(unknown_extension_bytes, WORLD_VIEW_MAX_SNAPSHOT_EXTENSIONS_V1)?;

        let total = WORLD_VIEW_SNAPSHOT_HEADER_BYTES_V1
            .checked_add(payload.bytes.len())
            .ok_or_else(|| capacity_error(0, "world-view snapshot length overflow"))?;
        if total > WORLD_VIEW_MAX_SNAPSHOT_BYTES_V1 {
            return Err(capacity_error(0, "world-view snapshot exceeds its file bound"));
        }
        let mut output = Writer::default();
        output.raw(&WORLD_VIEW_SNAPSHOT_MAGIC_V1);
        output.u16(schema_version);
        output.u16(WORLD_VIEW_SNAPSHOT_FLAGS_V1);
        output.u64(
            u64::try_from(payload.bytes.len())
                .map_err(|_| capacity_error(output.bytes.len(), "world-view payload length exceeds u64"))?,
        );
        output.hash(self.state.state_hash());
        output.hash(self.replay_hash());
        output.hash(world_view_payload_hash_v1(&payload.bytes, schema_version));
        output.raw(&payload.bytes);
        Ok(output.bytes)
    }

    pub fn install_snapshot_v1(
        &mut self,
        bytes: &[u8],
        gameplay: &GameplayState,
    ) -> Result<WorldViewSnapshotInstallReportV1, WorldViewSnapshotErrorV1> {
        let decoded = decode_world_view_authority_snapshot_v1(bytes, gameplay)?;
        let report = WorldViewSnapshotInstallReportV1 {
            schema_version: decoded.schema_version,
            state_hash: decoded.authority.state.state_hash(),
            replay_hash: decoded.authority.replay_hash(),
            snapshot_hash: decoded.snapshot_hash,
            unknown_extension_bytes: decoded.unknown_extension_bytes,
        };
        *self = decoded.authority;
        Ok(report)
    }
}

pub fn decode_world_view_authority_snapshot_v1(
    bytes: &[u8],
    gameplay: &GameplayState,
) -> Result<DecodedWorldViewAuthoritySnapshotV1, WorldViewSnapshotErrorV1> {
    if bytes.len() > WORLD_VIEW_MAX_SNAPSHOT_BYTES_V1 {
        return Err(capacity_error(0, "world-view snapshot exceeds its file bound"));
    }
    if bytes.len() < WORLD_VIEW_SNAPSHOT_HEADER_BYTES_V1 {
        return Err(WorldViewSnapshotErrorV1::new(
            WorldViewSnapshotErrorCodeV1::Truncated,
            bytes.len(),
            "world-view snapshot is shorter than its header",
        ));
    }
    let mut reader = Reader::new(bytes);
    if reader.raw(WORLD_VIEW_SNAPSHOT_MAGIC_V1.len())? != WORLD_VIEW_SNAPSHOT_MAGIC_V1 {
        return Err(WorldViewSnapshotErrorV1::new(
            WorldViewSnapshotErrorCodeV1::InvalidHeader,
            0,
            "world-view snapshot magic is invalid",
        ));
    }
    let schema = reader.u16()?;
    if !matches!(
        schema,
        WORLD_VIEW_SNAPSHOT_SCHEMA_VERSION_V1 | WORLD_VIEW_SNAPSHOT_SCHEMA_VERSION_V2
    ) {
        return Err(WorldViewSnapshotErrorV1::new(
            WorldViewSnapshotErrorCodeV1::UnsupportedVersion,
            WORLD_VIEW_SNAPSHOT_MAGIC_V1.len(),
            "world-view snapshot schema is unsupported",
        ));
    }
    if reader.u16()? != WORLD_VIEW_SNAPSHOT_FLAGS_V1 {
        return Err(WorldViewSnapshotErrorV1::new(
            WorldViewSnapshotErrorCodeV1::UnsupportedVersion,
            WORLD_VIEW_SNAPSHOT_MAGIC_V1.len() + 2,
            "world-view snapshot has unsupported required flags",
        ));
    }
    let payload_len = usize::try_from(reader.u64()?)
        .map_err(|_| capacity_error(reader.offset, "world-view payload cannot fit this platform"))?;
    let expected_state_hash = reader.hash()?;
    let expected_replay_hash = reader.hash()?;
    let expected_payload_hash = reader.hash()?;
    if payload_len != reader.remaining() {
        return Err(WorldViewSnapshotErrorV1::new(
            WorldViewSnapshotErrorCodeV1::Truncated,
            reader.offset,
            "world-view payload length does not match the file",
        ));
    }
    let payload = reader.raw(payload_len)?.to_vec();
    reader.finish()?;
    if world_view_payload_hash_v1(&payload, schema) != expected_payload_hash {
        return Err(WorldViewSnapshotErrorV1::new(
            WorldViewSnapshotErrorCodeV1::Corrupt,
            WORLD_VIEW_SNAPSHOT_HEADER_BYTES_V1,
            "world-view payload hash does not match",
        ));
    }
    let mut payload_reader = Reader::new(&payload);
    let state = decode_state(&mut payload_reader, schema)?;
    let grants = decode_grants(&mut payload_reader)?;
    let idempotency = decode_idempotency(&mut payload_reader)?;
    let idempotency_order = decode_idempotency_order(&mut payload_reader)?;
    let replay = decode_replay(&mut payload_reader)?;
    let unknown_extension_bytes = payload_reader.bytes(WORLD_VIEW_MAX_SNAPSHOT_EXTENSIONS_V1)?;
    payload_reader.finish()?;
    if state.state_hash() != expected_state_hash {
        return Err(WorldViewSnapshotErrorV1::new(
            WorldViewSnapshotErrorCodeV1::Corrupt,
            WORLD_VIEW_SNAPSHOT_HEADER_BYTES_V1,
            "world-view state hash does not match",
        ));
    }
    let authority = WorldViewAuthorityV1::from_snapshot_parts(
        WorldViewAuthorityPartsV1 {
            state,
            grants,
            idempotency,
            idempotency_order,
            replay,
        },
        gameplay,
    )
    .map_err(authority_error)?;
    if authority.replay_hash() != expected_replay_hash {
        return Err(WorldViewSnapshotErrorV1::new(
            WorldViewSnapshotErrorCodeV1::Corrupt,
            WORLD_VIEW_SNAPSHOT_HEADER_BYTES_V1,
            "world-view replay hash does not match",
        ));
    }
    Ok(DecodedWorldViewAuthoritySnapshotV1 {
        authority,
        unknown_extension_bytes,
        snapshot_hash: canonical_world_view_snapshot_hash_v1(bytes),
        schema_version: schema,
    })
}

#[must_use]
pub fn canonical_world_view_snapshot_hash_v1(bytes: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild.gameplay.world-view.snapshot.file.v1");
    hasher.write_bytes(bytes);
    hasher.finish()
}

fn world_view_payload_hash_v1(bytes: &[u8], schema_version: u16) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild.gameplay.world-view.snapshot.payload.v1");
    hasher.write_u16(schema_version);
    hasher.write_bytes(bytes);
    hasher.finish()
}

fn encode_state(
    writer: &mut Writer,
    state: &WorldViewStateV1,
    schema_version: u16,
) -> Result<(), WorldViewSnapshotErrorV1> {
    encode_world_key(writer, &state.world)?;
    encode_revision(writer, state.revision);
    writer.u64(state.tick);
    writer.count(state.machine_anchors.len())?;
    for anchor in state.machine_anchors.values() {
        encode_machine_anchor(writer, anchor)?;
    }
    writer.count(state.dropped_items.len())?;
    for drop in state.dropped_items.values() {
        encode_drop(writer, drop, schema_version)?;
    }
    writer.count(state.player_bindings.len())?;
    for binding in state.player_bindings.values() {
        encode_player_binding(writer, binding)?;
    }
    encode_environment(writer, &state.environment);
    encode_atmosphere_gravity(writer, &state.atmosphere_gravity);
    encode_celestial(writer, &state.celestial)?;
    Ok(())
}

fn decode_state(reader: &mut Reader<'_>, schema_version: u16) -> Result<WorldViewStateV1, WorldViewSnapshotErrorV1> {
    let world = decode_world_key(reader)?;
    let revision = decode_revision(reader)?;
    let tick = reader.u64()?;
    let mut machine_anchors = BTreeMap::new();
    for _ in 0..reader.count(WORLD_VIEW_MAX_MACHINE_ANCHORS_V1)? {
        let anchor = decode_machine_anchor(reader)?;
        let key = anchor.machine_id.clone();
        insert_unique(&mut machine_anchors, key, anchor, reader.offset, "machine anchor")?;
    }
    let mut dropped_items = BTreeMap::new();
    for _ in 0..reader.count(WORLD_VIEW_MAX_DROPPED_ITEMS_V1)? {
        let drop = decode_drop(reader, schema_version)?;
        let key = drop.drop_id.clone();
        insert_unique(&mut dropped_items, key, drop, reader.offset, "dropped item")?;
    }
    let mut player_bindings = BTreeMap::new();
    for _ in 0..reader.count(WORLD_VIEW_MAX_PLAYER_BINDINGS_V1)? {
        let binding = decode_player_binding(reader)?;
        insert_unique(
            &mut player_bindings,
            binding.player_id,
            binding,
            reader.offset,
            "player binding",
        )?;
    }
    Ok(WorldViewStateV1 {
        world,
        revision,
        tick,
        machine_anchors,
        dropped_items,
        player_bindings,
        environment: decode_environment(reader)?,
        atmosphere_gravity: decode_atmosphere_gravity(reader)?,
        celestial: decode_celestial(reader)?,
    })
}

fn encode_world_key(writer: &mut Writer, world: &WorldKey) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.string(&world.universe)?;
    writer.string(&world.location)
}

fn decode_world_key(reader: &mut Reader<'_>) -> Result<WorldKey, WorldViewSnapshotErrorV1> {
    Ok(WorldKey::new(reader.string()?, reader.string()?))
}

fn encode_revision(writer: &mut Writer, revision: WorldViewRevisionV1) {
    writer.u32(revision.epoch);
    writer.u64(revision.sequence);
    writer.u64(revision.clock);
    writer.u64(revision.machine_anchors);
    writer.u64(revision.dropped_items);
    writer.u64(revision.player_bindings);
    writer.u64(revision.environment);
    writer.u64(revision.atmosphere_gravity);
    writer.u64(revision.celestial);
}

fn decode_revision(reader: &mut Reader<'_>) -> Result<WorldViewRevisionV1, WorldViewSnapshotErrorV1> {
    Ok(WorldViewRevisionV1 {
        epoch: reader.u32()?,
        sequence: reader.u64()?,
        clock: reader.u64()?,
        machine_anchors: reader.u64()?,
        dropped_items: reader.u64()?,
        player_bindings: reader.u64()?,
        environment: reader.u64()?,
        atmosphere_gravity: reader.u64()?,
        celestial: reader.u64()?,
    })
}

fn encode_position(writer: &mut Writer, value: FixedWorldVec3V1) {
    writer.i64(value.x_milli);
    writer.i64(value.y_milli);
    writer.i64(value.z_milli);
}

fn decode_position(reader: &mut Reader<'_>) -> Result<FixedWorldVec3V1, WorldViewSnapshotErrorV1> {
    Ok(FixedWorldVec3V1 {
        x_milli: reader.i64()?,
        y_milli: reader.i64()?,
        z_milli: reader.i64()?,
    })
}

fn encode_direction(writer: &mut Writer, value: FixedUnitVectorV1) {
    writer.i32(value.x_millionths);
    writer.i32(value.y_millionths);
    writer.i32(value.z_millionths);
}

fn decode_direction(reader: &mut Reader<'_>) -> Result<FixedUnitVectorV1, WorldViewSnapshotErrorV1> {
    Ok(FixedUnitVectorV1 {
        x_millionths: reader.i32()?,
        y_millionths: reader.i32()?,
        z_millionths: reader.i32()?,
    })
}

fn encode_rotation(writer: &mut Writer, value: RotationMicroturnsV1) {
    writer.u32(value.yaw);
    writer.u32(value.pitch);
    writer.u32(value.roll);
}

fn decode_rotation(reader: &mut Reader<'_>) -> Result<RotationMicroturnsV1, WorldViewSnapshotErrorV1> {
    Ok(RotationMicroturnsV1 {
        yaw: reader.u32()?,
        pitch: reader.u32()?,
        roll: reader.u32()?,
    })
}

fn encode_color(writer: &mut Writer, value: LinearRgbMillionthsV1) {
    writer.u32(value.red);
    writer.u32(value.green);
    writer.u32(value.blue);
}

fn decode_color(reader: &mut Reader<'_>) -> Result<LinearRgbMillionthsV1, WorldViewSnapshotErrorV1> {
    Ok(LinearRgbMillionthsV1 {
        red: reader.u32()?,
        green: reader.u32()?,
        blue: reader.u32()?,
    })
}

fn encode_container_key(writer: &mut Writer, key: &ContainerKey) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.u8(key.kind as u8);
    writer.string(&key.id)?;
    writer.option_string(key.owner_id.as_deref())
}

fn decode_container_key(reader: &mut Reader<'_>) -> Result<ContainerKey, WorldViewSnapshotErrorV1> {
    let kind = match reader.u8()? {
        0 => ContainerKind::Player,
        1 => ContainerKind::Equipment,
        2 => ContainerKind::Container,
        3 => ContainerKind::Machine,
        4 => ContainerKind::Waygrid,
        5 => ContainerKind::CardforgeCase,
        _ => return Err(reader.invalid("world-view container kind is unknown")),
    };
    Ok(ContainerKey {
        kind,
        id: reader.string()?,
        owner_id: reader.option_string()?,
    })
}

fn encode_machine_anchor(writer: &mut Writer, anchor: &MachineSpatialAnchorV1) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.string(&anchor.machine_id)?;
    writer.u64(anchor.revision);
    writer.string(&anchor.presentation_id)?;
    encode_position(writer, anchor.position);
    encode_rotation(writer, anchor.rotation);
    for extent in anchor.half_extents_milli {
        writer.u32(extent);
    }
    match &anchor.light {
        Some(light) => {
            writer.u8(1);
            writer.u8(light.kind as u8);
            encode_color(writer, light.color);
            writer.u64(light.luminous_flux_millilumens);
            writer.u32(light.range_milli);
            writer.u32(light.inner_cone_microturns);
            writer.u32(light.outer_cone_microturns);
            writer.bool(light.casts_shadows);
            writer.bool(light.enabled);
        }
        None => writer.u8(0),
    }
    Ok(())
}

fn decode_machine_anchor(reader: &mut Reader<'_>) -> Result<MachineSpatialAnchorV1, WorldViewSnapshotErrorV1> {
    let machine_id = reader.string()?;
    let revision = reader.u64()?;
    let presentation_id = reader.string()?;
    let position = decode_position(reader)?;
    let rotation = decode_rotation(reader)?;
    let half_extents_milli = [reader.u32()?, reader.u32()?, reader.u32()?];
    let light = match reader.u8()? {
        0 => None,
        1 => Some(MachineLightProfileV1 {
            kind: match reader.u8()? {
                0 => MachineLightKindV1::Point,
                1 => MachineLightKindV1::Spot,
                2 => MachineLightKindV1::Area,
                3 => MachineLightKindV1::Emissive,
                _ => return Err(reader.invalid("world-view machine light kind is unknown")),
            },
            color: decode_color(reader)?,
            luminous_flux_millilumens: reader.u64()?,
            range_milli: reader.u32()?,
            inner_cone_microturns: reader.u32()?,
            outer_cone_microturns: reader.u32()?,
            casts_shadows: reader.bool()?,
            enabled: reader.bool()?,
        }),
        _ => return Err(reader.invalid("world-view optional machine light tag is not canonical")),
    };
    Ok(MachineSpatialAnchorV1 {
        machine_id,
        revision,
        presentation_id,
        position,
        rotation,
        half_extents_milli,
        light,
    })
}

fn encode_drop(
    writer: &mut Writer,
    drop: &DroppedItemSpatialV1,
    schema_version: u16,
) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.string(&drop.drop_id)?;
    writer.u64(drop.revision);
    writer.u64(drop.entity_id.packed());
    encode_container_key(writer, &drop.container)?;
    writer.u16(drop.slot);
    writer.u64(drop.bound_container_revision);
    encode_position(writer, drop.position);
    encode_position(writer, drop.velocity_milli_per_second);
    encode_rotation(writer, drop.rotation);
    writer.u64(drop.created_tick);
    writer.option_u64(drop.expires_tick);
    writer.option_string(drop.pickup_lock_actor_id.as_deref())?;
    if schema_version >= WORLD_VIEW_SNAPSHOT_SCHEMA_VERSION_V2 {
        writer.u64(drop.pickup_unlock_tick);
    }
    Ok(())
}

fn decode_drop(reader: &mut Reader<'_>, schema_version: u16) -> Result<DroppedItemSpatialV1, WorldViewSnapshotErrorV1> {
    let drop_id = reader.string()?;
    let revision = reader.u64()?;
    let entity_id = decode_entity_id(reader.u64()?);
    let container = decode_container_key(reader)?;
    let slot = reader.u16()?;
    let bound_container_revision = reader.u64()?;
    let position = decode_position(reader)?;
    let velocity_milli_per_second = decode_position(reader)?;
    let rotation = decode_rotation(reader)?;
    let created_tick = reader.u64()?;
    let expires_tick = reader.option_u64()?;
    let pickup_lock_actor_id = reader.option_string()?;
    let pickup_unlock_tick = if schema_version >= WORLD_VIEW_SNAPSHOT_SCHEMA_VERSION_V2 {
        reader.u64()?
    } else {
        created_tick
    };
    Ok(DroppedItemSpatialV1 {
        drop_id,
        revision,
        entity_id,
        container,
        slot,
        bound_container_revision,
        position,
        velocity_milli_per_second,
        rotation,
        created_tick,
        expires_tick,
        pickup_lock_actor_id,
        pickup_unlock_tick,
    })
}

fn encode_player_binding(
    writer: &mut Writer,
    binding: &PlayerInventoryBindingV1,
) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.u64(binding.player_id.packed());
    writer.u64(binding.revision);
    writer.string(&binding.actor_id)?;
    writer.u64(binding.entity_id.packed());
    encode_container_key(writer, &binding.inventory_container)?;
    encode_container_key(writer, &binding.equipment_container)?;
    writer.u16(binding.selected_slot);
    writer.option_u16(binding.back_slot);
    Ok(())
}

fn decode_player_binding(reader: &mut Reader<'_>) -> Result<PlayerInventoryBindingV1, WorldViewSnapshotErrorV1> {
    Ok(PlayerInventoryBindingV1 {
        player_id: decode_player_id(reader.u64()?),
        revision: reader.u64()?,
        actor_id: reader.string()?,
        entity_id: decode_entity_id(reader.u64()?),
        inventory_container: decode_container_key(reader)?,
        equipment_container: decode_container_key(reader)?,
        selected_slot: reader.u16()?,
        back_slot: reader.option_u16()?,
    })
}

fn encode_environment(writer: &mut Writer, environment: &EnvironmentLightingStateV1) {
    writer.u64(environment.revision);
    writer.u64(environment.observed_tick);
    writer.u8(environment.weather as u8);
    writer.u64(environment.weather_seed);
    writer.u32(environment.precipitation_millionths);
    writer.u32(environment.cloud_cover_millionths);
    writer.u32(environment.fog_density_millionths);
    encode_position(writer, environment.wind_milli_per_second);
    encode_color(writer, environment.ambient_color);
    writer.u32(environment.ambient_irradiance_millionths);
    encode_color(writer, environment.sky_color);
    writer.u32(environment.sky_irradiance_millionths);
    writer.u32(environment.lightning_probability_millionths);
}

fn decode_environment(reader: &mut Reader<'_>) -> Result<EnvironmentLightingStateV1, WorldViewSnapshotErrorV1> {
    Ok(EnvironmentLightingStateV1 {
        revision: reader.u64()?,
        observed_tick: reader.u64()?,
        weather: match reader.u8()? {
            0 => WeatherKindV1::Clear,
            1 => WeatherKindV1::Cloudy,
            2 => WeatherKindV1::Rain,
            3 => WeatherKindV1::Snow,
            4 => WeatherKindV1::Storm,
            5 => WeatherKindV1::Dust,
            6 => WeatherKindV1::Ash,
            7 => WeatherKindV1::Mist,
            _ => return Err(reader.invalid("world-view weather kind is unknown")),
        },
        weather_seed: reader.u64()?,
        precipitation_millionths: reader.u32()?,
        cloud_cover_millionths: reader.u32()?,
        fog_density_millionths: reader.u32()?,
        wind_milli_per_second: decode_position(reader)?,
        ambient_color: decode_color(reader)?,
        ambient_irradiance_millionths: reader.u32()?,
        sky_color: decode_color(reader)?,
        sky_irradiance_millionths: reader.u32()?,
        lightning_probability_millionths: reader.u32()?,
    })
}

fn encode_atmosphere_gravity(writer: &mut Writer, state: &AtmosphereGravityStateV1) {
    writer.u64(state.revision);
    writer.u64(state.pressure_millipascals);
    writer.u32(state.temperature_millikelvin);
    writer.u32(state.composition.oxygen);
    writer.u32(state.composition.nitrogen);
    writer.u32(state.composition.carbon_dioxide);
    writer.u32(state.composition.argon);
    writer.u32(state.composition.other);
    writer.u32(state.composition.toxic);
    writer.u32(state.optical_extinction_millionths);
    writer.u64(state.gravity.acceleration_micrometres_per_second_squared);
    encode_direction(writer, state.gravity.direction);
}

fn decode_atmosphere_gravity(reader: &mut Reader<'_>) -> Result<AtmosphereGravityStateV1, WorldViewSnapshotErrorV1> {
    Ok(AtmosphereGravityStateV1 {
        revision: reader.u64()?,
        pressure_millipascals: reader.u64()?,
        temperature_millikelvin: reader.u32()?,
        composition: GasCompositionMillionthsV1 {
            oxygen: reader.u32()?,
            nitrogen: reader.u32()?,
            carbon_dioxide: reader.u32()?,
            argon: reader.u32()?,
            other: reader.u32()?,
            toxic: reader.u32()?,
        },
        optical_extinction_millionths: reader.u32()?,
        gravity: GravityStateV1 {
            acceleration_micrometres_per_second_squared: reader.u64()?,
            direction: decode_direction(reader)?,
        },
    })
}

fn encode_celestial(writer: &mut Writer, state: &CelestialSkyStateV1) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.u64(state.revision);
    writer.u64(state.ephemeris_tick);
    writer.u64(state.starfield_seed);
    writer.count(state.bodies.len())?;
    for body in state.bodies.values() {
        writer.string(&body.body_id)?;
        writer.option_string(body.parent_body_id.as_deref())?;
        writer.u8(body.kind as u8);
        writer.string(&body.presentation_id)?;
        encode_direction(writer, body.direction);
        writer.u32(body.angular_radius_microdegrees);
        writer.u32(body.illuminated_fraction_millionths);
        writer.u32(body.phase_microturns);
        encode_color(writer, body.tint);
        writer.u32(body.radiance_millionths);
        writer.i32(body.render_order);
        writer.bool(body.occludes_stars);
    }
    Ok(())
}

fn decode_celestial(reader: &mut Reader<'_>) -> Result<CelestialSkyStateV1, WorldViewSnapshotErrorV1> {
    let revision = reader.u64()?;
    let ephemeris_tick = reader.u64()?;
    let starfield_seed = reader.u64()?;
    let mut bodies = BTreeMap::new();
    for _ in 0..reader.count(WORLD_VIEW_MAX_CELESTIAL_BODIES_V1)? {
        let body = CelestialBodySkyV1 {
            body_id: reader.string()?,
            parent_body_id: reader.option_string()?,
            kind: match reader.u8()? {
                0 => CelestialBodyKindV1::Star,
                1 => CelestialBodyKindV1::Planet,
                2 => CelestialBodyKindV1::Moon,
                3 => CelestialBodyKindV1::Station,
                4 => CelestialBodyKindV1::Asteroid,
                5 => CelestialBodyKindV1::Artificial,
                _ => return Err(reader.invalid("world-view celestial body kind is unknown")),
            },
            presentation_id: reader.string()?,
            direction: decode_direction(reader)?,
            angular_radius_microdegrees: reader.u32()?,
            illuminated_fraction_millionths: reader.u32()?,
            phase_microturns: reader.u32()?,
            tint: decode_color(reader)?,
            radiance_millionths: reader.u32()?,
            render_order: reader.i32()?,
            occludes_stars: reader.bool()?,
        };
        let key = body.body_id.clone();
        insert_unique(&mut bodies, key, body, reader.offset, "celestial body")?;
    }
    Ok(CelestialSkyStateV1 {
        revision,
        ephemeris_tick,
        starfield_seed,
        bodies,
    })
}

fn encode_grants(
    writer: &mut Writer,
    grants: &BTreeMap<String, WorldViewActorGrantV1>,
) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.count(grants.len())?;
    for (actor_id, grant) in grants {
        writer.string(actor_id)?;
        encode_optional_player_id(writer, grant.player_id);
        encode_optional_entity_id(writer, grant.entity_id);
        writer.u8(grant.role as u8);
        writer.count(grant.scopes.len())?;
        for scope in &grant.scopes {
            writer.u8(*scope as u8);
        }
    }
    Ok(())
}

fn decode_grants(reader: &mut Reader<'_>) -> Result<BTreeMap<String, WorldViewActorGrantV1>, WorldViewSnapshotErrorV1> {
    let mut grants = BTreeMap::new();
    for _ in 0..reader.count(WORLD_VIEW_MAX_PLAYER_BINDINGS_V1.saturating_add(1))? {
        let actor_id = reader.string()?;
        let player_id = decode_optional_player_id(reader)?;
        let entity_id = decode_optional_entity_id(reader)?;
        let role = decode_actor_role(reader)?;
        let mut scopes = BTreeSet::new();
        for _ in 0..reader.count(6)? {
            let scope = match reader.u8()? {
                0 => WorldViewScopeV1::MachineAnchors,
                1 => WorldViewScopeV1::DroppedItems,
                2 => WorldViewScopeV1::PlayerBindingSelf,
                3 => WorldViewScopeV1::PlayerBindingAny,
                4 => WorldViewScopeV1::Environment,
                5 => WorldViewScopeV1::System,
                _ => return Err(reader.invalid("world-view scope is unknown")),
            };
            if !scopes.insert(scope) {
                return Err(duplicate_error(reader.offset, "world-view scope"));
            }
        }
        insert_unique(
            &mut grants,
            actor_id,
            WorldViewActorGrantV1 {
                player_id,
                entity_id,
                role,
                scopes,
            },
            reader.offset,
            "world-view actor grant",
        )?;
    }
    Ok(grants)
}

fn encode_idempotency(
    writer: &mut Writer,
    entries: &BTreeMap<(String, String), WorldViewIdempotencyEntryV1>,
) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.count(entries.len())?;
    for ((actor_id, key), entry) in entries {
        writer.string(actor_id)?;
        writer.string(key)?;
        writer.hash(entry.command_hash);
        encode_receipt(writer, &entry.receipt)?;
    }
    Ok(())
}

fn decode_idempotency(
    reader: &mut Reader<'_>,
) -> Result<BTreeMap<(String, String), WorldViewIdempotencyEntryV1>, WorldViewSnapshotErrorV1> {
    let mut entries = BTreeMap::new();
    for _ in 0..reader.count(WORLD_VIEW_IDEMPOTENCY_WINDOW_V1)? {
        let key = (reader.string()?, reader.string()?);
        let value = WorldViewIdempotencyEntryV1 {
            command_hash: reader.hash()?,
            receipt: decode_receipt(reader)?,
        };
        insert_unique(&mut entries, key, value, reader.offset, "world-view idempotency entry")?;
    }
    Ok(entries)
}

fn encode_idempotency_order(
    writer: &mut Writer,
    order: &VecDeque<(String, String)>,
) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.count(order.len())?;
    for (actor_id, key) in order {
        writer.string(actor_id)?;
        writer.string(key)?;
    }
    Ok(())
}

fn decode_idempotency_order(reader: &mut Reader<'_>) -> Result<VecDeque<(String, String)>, WorldViewSnapshotErrorV1> {
    let mut order = VecDeque::new();
    for _ in 0..reader.count(WORLD_VIEW_IDEMPOTENCY_WINDOW_V1)? {
        order.push_back((reader.string()?, reader.string()?));
    }
    Ok(order)
}

fn encode_replay(
    writer: &mut Writer,
    replay: &VecDeque<WorldViewReplayEntryV1>,
) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.count(replay.len())?;
    for entry in replay {
        writer.u64(entry.sequence);
        writer.string(&entry.actor_id)?;
        writer.string(&entry.idempotency_key)?;
        writer.hash(entry.command_hash);
        writer.hash(entry.before_hash);
        writer.hash(entry.after_hash);
        writer.hash(entry.receipt_hash);
    }
    Ok(())
}

fn decode_replay(reader: &mut Reader<'_>) -> Result<VecDeque<WorldViewReplayEntryV1>, WorldViewSnapshotErrorV1> {
    let mut replay = VecDeque::new();
    for _ in 0..reader.count(WORLD_VIEW_REPLAY_WINDOW_V1)? {
        replay.push_back(WorldViewReplayEntryV1 {
            sequence: reader.u64()?,
            actor_id: reader.string()?,
            idempotency_key: reader.string()?,
            command_hash: reader.hash()?,
            before_hash: reader.hash()?,
            after_hash: reader.hash()?,
            receipt_hash: reader.hash()?,
        });
    }
    Ok(replay)
}

fn encode_receipt(writer: &mut Writer, receipt: &WorldViewAcceptedReceiptV1) -> Result<(), WorldViewSnapshotErrorV1> {
    writer.string(&receipt.batch_id)?;
    encode_identity(writer, &receipt.before)?;
    encode_identity(writer, &receipt.after)?;
    writer.count(receipt.touched_domains.len())?;
    for domain in &receipt.touched_domains {
        writer.u8(*domain as u8);
    }
    writer.count(receipt.events.len())?;
    for event in &receipt.events {
        writer.string(&event.event_id)?;
        writer.u8(event.domain as u8);
        writer.string(&event.kind)?;
        writer.option_string(event.record_id.as_deref())?;
        writer.option_u64(event.record_revision);
    }
    writer.hash(receipt.receipt_hash);
    Ok(())
}

fn decode_receipt(reader: &mut Reader<'_>) -> Result<WorldViewAcceptedReceiptV1, WorldViewSnapshotErrorV1> {
    let batch_id = reader.string()?;
    let before = decode_identity(reader)?;
    let after = decode_identity(reader)?;
    let mut touched_domains = BTreeSet::new();
    for _ in 0..reader.count(7)? {
        let domain = decode_domain(reader)?;
        if !touched_domains.insert(domain) {
            return Err(duplicate_error(reader.offset, "world-view receipt domain"));
        }
    }
    let mut events = Vec::new();
    for _ in 0..reader.count(WORLD_VIEW_MAX_COMMANDS_V1)? {
        events.push(WorldViewEventV1 {
            event_id: reader.string()?,
            domain: decode_domain(reader)?,
            kind: reader.string()?,
            record_id: reader.option_string()?,
            record_revision: reader.option_u64()?,
        });
    }
    Ok(WorldViewAcceptedReceiptV1 {
        batch_id,
        before,
        after,
        touched_domains,
        events,
        receipt_hash: reader.hash()?,
    })
}

fn encode_identity(writer: &mut Writer, identity: &WorldViewIdentityV1) -> Result<(), WorldViewSnapshotErrorV1> {
    encode_world_key(writer, &identity.world)?;
    encode_revision(writer, identity.revision);
    writer.hash(identity.state_hash);
    Ok(())
}

fn decode_identity(reader: &mut Reader<'_>) -> Result<WorldViewIdentityV1, WorldViewSnapshotErrorV1> {
    Ok(WorldViewIdentityV1 {
        world: decode_world_key(reader)?,
        revision: decode_revision(reader)?,
        state_hash: reader.hash()?,
    })
}

fn encode_optional_player_id(writer: &mut Writer, value: Option<PlayerId>) {
    match value {
        Some(value) => {
            writer.u8(1);
            writer.u64(value.packed());
        }
        None => writer.u8(0),
    }
}

fn decode_optional_player_id(reader: &mut Reader<'_>) -> Result<Option<PlayerId>, WorldViewSnapshotErrorV1> {
    match reader.u8()? {
        0 => Ok(None),
        1 => Ok(Some(decode_player_id(reader.u64()?))),
        _ => Err(reader.invalid("world-view optional player identity tag is not canonical")),
    }
}

fn encode_optional_entity_id(writer: &mut Writer, value: Option<EntityId>) {
    match value {
        Some(value) => {
            writer.u8(1);
            writer.u64(value.packed());
        }
        None => writer.u8(0),
    }
}

fn decode_optional_entity_id(reader: &mut Reader<'_>) -> Result<Option<EntityId>, WorldViewSnapshotErrorV1> {
    match reader.u8()? {
        0 => Ok(None),
        1 => Ok(Some(decode_entity_id(reader.u64()?))),
        _ => Err(reader.invalid("world-view optional entity identity tag is not canonical")),
    }
}

fn decode_player_id(packed: u64) -> PlayerId {
    PlayerId::new(packed as u32, (packed >> 32) as u32)
}

fn decode_entity_id(packed: u64) -> EntityId {
    EntityId::new(packed as u32, (packed >> 32) as u32)
}

fn decode_actor_role(reader: &mut Reader<'_>) -> Result<ActorRole, WorldViewSnapshotErrorV1> {
    match reader.u8()? {
        0 => Ok(ActorRole::Host),
        1 => Ok(ActorRole::Guest),
        2 => Ok(ActorRole::Agent),
        3 => Ok(ActorRole::System),
        _ => Err(reader.invalid("world-view actor role is unknown")),
    }
}

fn decode_domain(reader: &mut Reader<'_>) -> Result<WorldViewDomainV1, WorldViewSnapshotErrorV1> {
    match reader.u8()? {
        0 => Ok(WorldViewDomainV1::Clock),
        1 => Ok(WorldViewDomainV1::MachineAnchors),
        2 => Ok(WorldViewDomainV1::DroppedItems),
        3 => Ok(WorldViewDomainV1::PlayerBindings),
        4 => Ok(WorldViewDomainV1::Environment),
        5 => Ok(WorldViewDomainV1::AtmosphereGravity),
        6 => Ok(WorldViewDomainV1::Celestial),
        _ => Err(reader.invalid("world-view domain is unknown")),
    }
}

fn insert_unique<K: Ord, V>(
    map: &mut BTreeMap<K, V>,
    key: K,
    value: V,
    offset: usize,
    name: &str,
) -> Result<(), WorldViewSnapshotErrorV1> {
    if map.insert(key, value).is_some() {
        return Err(duplicate_error(offset, name));
    }
    Ok(())
}

fn duplicate_error(offset: usize, name: &str) -> WorldViewSnapshotErrorV1 {
    WorldViewSnapshotErrorV1::new(
        WorldViewSnapshotErrorCodeV1::DuplicateKey,
        offset,
        format!("duplicate {name} in world-view snapshot"),
    )
}

fn capacity_error(offset: usize, message: impl Into<String>) -> WorldViewSnapshotErrorV1 {
    WorldViewSnapshotErrorV1::new(WorldViewSnapshotErrorCodeV1::Capacity, offset, message)
}

fn authority_error(rejection: Rejection) -> WorldViewSnapshotErrorV1 {
    WorldViewSnapshotErrorV1::new(WorldViewSnapshotErrorCodeV1::AuthorityRejected, 0, rejection.message)
}
