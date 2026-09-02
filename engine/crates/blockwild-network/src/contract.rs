use core::cmp::Ordering;
use core::fmt;

use blockwild_types::{CanonicalHash, CanonicalHasher};

pub const NETWORK_AUTHORITY_SCHEMA_V1: u16 = 1;
pub const NETWORK_AUTHORITY_PROTOCOL_V1: u16 = 1;
pub const NETWORK_MAX_COMMAND_BYTES_V1: usize = 2 * 1024 * 1024;
pub const NETWORK_MAX_DELTA_BYTES_V1: usize = 16 * 1024 * 1024;
pub const NETWORK_MAX_DELTA_RECORDS_V1: usize = 16_384;
pub const NETWORK_MAX_INTEREST_CHUNKS_V1: usize = 1_024;
pub const NETWORK_MAX_INTEREST_ENTITIES_V1: usize = 16_384;
pub const NETWORK_MAX_LEASE_KEYS_V1: usize = 2_048;
pub const NETWORK_MAX_IDEMPOTENCY_RECEIPTS_V1: usize = 512;
pub const NETWORK_MAX_SAFE_INTEGER_V1: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum NetworkPeerKindV1 {
    Human = 0,
    Agent = 1,
}

impl NetworkPeerKindV1 {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Human => "human",
            Self::Agent => "agent",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum NetworkPeerRoleV1 {
    Host = 0,
    Guest = 1,
}

impl NetworkPeerRoleV1 {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Host => "host",
            Self::Guest => "guest",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum NetworkCapabilityV1 {
    Observe = 0,
    Chat = 1,
    Interact = 2,
    Inventory = 3,
    Build = 4,
    Combat = 5,
    CreatureCare = 6,
    Trade = 7,
    Travel = 8,
    AgentWork = 9,
}

pub const NETWORK_CAPABILITY_ORDER_V1: [NetworkCapabilityV1; 10] = [
    NetworkCapabilityV1::Observe,
    NetworkCapabilityV1::Chat,
    NetworkCapabilityV1::Interact,
    NetworkCapabilityV1::Inventory,
    NetworkCapabilityV1::Build,
    NetworkCapabilityV1::Combat,
    NetworkCapabilityV1::CreatureCare,
    NetworkCapabilityV1::Trade,
    NetworkCapabilityV1::Travel,
    NetworkCapabilityV1::AgentWork,
];

impl NetworkCapabilityV1 {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Observe => "observe",
            Self::Chat => "chat",
            Self::Interact => "interact",
            Self::Inventory => "inventory",
            Self::Build => "build",
            Self::Combat => "combat",
            Self::CreatureCare => "creature-care",
            Self::Trade => "trade",
            Self::Travel => "travel",
            Self::AgentWork => "agent-work",
        }
    }

    pub(crate) const fn from_wire(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Observe),
            1 => Some(Self::Chat),
            2 => Some(Self::Interact),
            3 => Some(Self::Inventory),
            4 => Some(Self::Build),
            5 => Some(Self::Combat),
            6 => Some(Self::CreatureCare),
            7 => Some(Self::Trade),
            8 => Some(Self::Travel),
            9 => Some(Self::AgentWork),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct NetworkAuthorityRevisionV1 {
    pub epoch: u64,
    pub world: u64,
    pub entities: u64,
    pub gameplay: u64,
    pub persistence: u64,
}

impl NetworkAuthorityRevisionV1 {
    pub fn validate(self) -> Result<(), NetworkError> {
        for value in [self.epoch, self.world, self.entities, self.gameplay, self.persistence] {
            safe_integer(value, "authority revision")?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct WorldAddressV1 {
    pub universe_id: String,
    pub location_id: String,
}

impl WorldAddressV1 {
    pub fn validate(&self) -> Result<(), NetworkError> {
        label(&self.universe_id, 64, "address.universeId")?;
        label(&self.location_id, 128, "address.locationId")?;
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkAuthorityIdentityV1 {
    pub address: WorldAddressV1,
    pub revision: NetworkAuthorityRevisionV1,
    pub state_hash: CanonicalHash,
}

impl NetworkAuthorityIdentityV1 {
    pub fn new(address: WorldAddressV1, revision: NetworkAuthorityRevisionV1) -> Result<Self, NetworkError> {
        address.validate()?;
        revision.validate()?;
        let mut hasher = CanonicalHasher::new("blockwild-network-authority-v1");
        hasher.write_str(&address.universe_id);
        hasher.write_str(&address.location_id);
        write_revision(&mut hasher, revision);
        Ok(Self {
            address,
            revision,
            state_hash: hasher.finish(),
        })
    }

    pub fn validate(&self) -> Result<(), NetworkError> {
        let normalized = Self::new(self.address.clone(), self.revision)?;
        if normalized.state_hash != self.state_hash {
            return Err(NetworkError::new(
                NetworkErrorCode::IdentityHash,
                "authority identity hash mismatch",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkHandshakeV1 {
    pub schema_version: u16,
    pub protocol_version: u16,
    pub session_id: String,
    pub peer_id: String,
    pub peer_kind: NetworkPeerKindV1,
    pub role: NetworkPeerRoleV1,
    pub engine_version: String,
    pub content_hash: CanonicalHash,
    pub generator_hash: CanonicalHash,
    pub capabilities: Vec<NetworkCapabilityV1>,
    pub max_command_bytes: u32,
    pub handshake_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkHandshakeSourceV1 {
    pub session_id: String,
    pub peer_id: String,
    pub peer_kind: NetworkPeerKindV1,
    pub role: NetworkPeerRoleV1,
    pub engine_version: String,
    pub content_hash: CanonicalHash,
    pub generator_hash: CanonicalHash,
    pub capabilities: Vec<NetworkCapabilityV1>,
    pub max_command_bytes: u32,
}

impl NetworkHandshakeV1 {
    pub fn new(source: NetworkHandshakeSourceV1) -> Result<Self, NetworkError> {
        label(&source.session_id, 180, "sessionId")?;
        label(&source.peer_id, 180, "peerId")?;
        label(&source.engine_version, 64, "engineVersion")?;
        let capabilities = normalize_capabilities(&source.capabilities);
        if source.max_command_bytes == 0 || source.max_command_bytes as usize > NETWORK_MAX_COMMAND_BYTES_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::Budget,
                "max command bytes exceeds V1 budget",
            ));
        }
        let mut hasher = CanonicalHasher::new("blockwild-network-handshake-v1");
        hasher.write_u16(NETWORK_AUTHORITY_SCHEMA_V1);
        hasher.write_u16(NETWORK_AUTHORITY_PROTOCOL_V1);
        hasher.write_str(&source.session_id);
        hasher.write_str(&source.peer_id);
        hasher.write_str(source.peer_kind.as_str());
        hasher.write_str(source.role.as_str());
        hasher.write_str(&source.engine_version);
        hasher.write_str(&source.content_hash.to_hex());
        hasher.write_str(&source.generator_hash.to_hex());
        hasher.write_u32(capabilities.len() as u32);
        for capability in &capabilities {
            hasher.write_str(capability.as_str());
        }
        hasher.write_u32(source.max_command_bytes);
        Ok(Self {
            schema_version: NETWORK_AUTHORITY_SCHEMA_V1,
            protocol_version: NETWORK_AUTHORITY_PROTOCOL_V1,
            session_id: source.session_id,
            peer_id: source.peer_id,
            peer_kind: source.peer_kind,
            role: source.role,
            engine_version: source.engine_version,
            content_hash: source.content_hash,
            generator_hash: source.generator_hash,
            capabilities,
            max_command_bytes: source.max_command_bytes,
            handshake_hash: hasher.finish(),
        })
    }

    pub fn validate(&self) -> Result<(), NetworkError> {
        if self.schema_version != NETWORK_AUTHORITY_SCHEMA_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::SchemaMismatch,
                "network schema version mismatch",
            ));
        }
        if self.protocol_version != NETWORK_AUTHORITY_PROTOCOL_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::ProtocolMismatch,
                "network protocol version mismatch",
            ));
        }
        let rebuilt = Self::new(NetworkHandshakeSourceV1 {
            session_id: self.session_id.clone(),
            peer_id: self.peer_id.clone(),
            peer_kind: self.peer_kind,
            role: self.role,
            engine_version: self.engine_version.clone(),
            content_hash: self.content_hash,
            generator_hash: self.generator_hash,
            capabilities: self.capabilities.clone(),
            max_command_bytes: self.max_command_bytes,
        })?;
        if rebuilt != *self {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "handshake hash or normalization mismatch",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HandshakeDecisionCodeV1 {
    Ok,
    SchemaMismatch,
    ProtocolMismatch,
    SessionMismatch,
    RoleConflict,
    EngineMismatch,
    ContentMismatch,
    GeneratorMismatch,
    CommandBudget,
}

impl HandshakeDecisionCodeV1 {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::SchemaMismatch => "schema-mismatch",
            Self::ProtocolMismatch => "protocol-mismatch",
            Self::SessionMismatch => "session-mismatch",
            Self::RoleConflict => "role-conflict",
            Self::EngineMismatch => "engine-mismatch",
            Self::ContentMismatch => "content-mismatch",
            Self::GeneratorMismatch => "generator-mismatch",
            Self::CommandBudget => "command-budget",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkHandshakeDecisionV1 {
    pub compatible: bool,
    pub code: HandshakeDecisionCodeV1,
    pub capabilities: Vec<NetworkCapabilityV1>,
    pub max_command_bytes: u32,
    pub message: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkCompatibilityRecordV1 {
    pub host_handshake_hash: CanonicalHash,
    pub peer_handshake_hash: CanonicalHash,
    pub decision: NetworkHandshakeDecisionV1,
    pub record_hash: CanonicalHash,
}

#[must_use]
pub fn negotiate_network_handshake_v1(
    host: &NetworkHandshakeV1,
    peer: &NetworkHandshakeV1,
) -> NetworkCompatibilityRecordV1 {
    let rejected = |code, message| NetworkHandshakeDecisionV1 {
        compatible: false,
        code,
        capabilities: Vec::new(),
        max_command_bytes: 0,
        message,
    };
    let decision = if host.schema_version != peer.schema_version {
        rejected(
            HandshakeDecisionCodeV1::SchemaMismatch,
            "Save/network schema versions differ.",
        )
    } else if host.protocol_version != peer.protocol_version {
        rejected(
            HandshakeDecisionCodeV1::ProtocolMismatch,
            "Network protocol versions differ.",
        )
    } else if host.session_id != peer.session_id {
        rejected(
            HandshakeDecisionCodeV1::SessionMismatch,
            "Peers did not present the same session.",
        )
    } else if host.role != NetworkPeerRoleV1::Host || peer.role != NetworkPeerRoleV1::Guest {
        rejected(
            HandshakeDecisionCodeV1::RoleConflict,
            "A session requires exactly one host authority.",
        )
    } else if host.engine_version != peer.engine_version {
        rejected(
            HandshakeDecisionCodeV1::EngineMismatch,
            "Engine versions are not compatible.",
        )
    } else if host.content_hash != peer.content_hash {
        rejected(
            HandshakeDecisionCodeV1::ContentMismatch,
            "Authored content fingerprints differ.",
        )
    } else if host.generator_hash != peer.generator_hash {
        rejected(
            HandshakeDecisionCodeV1::GeneratorMismatch,
            "World generator fingerprints differ.",
        )
    } else {
        let max_command_bytes = host.max_command_bytes.min(peer.max_command_bytes);
        if max_command_bytes == 0 {
            rejected(
                HandshakeDecisionCodeV1::CommandBudget,
                "No compatible command payload budget exists.",
            )
        } else {
            let capabilities = NETWORK_CAPABILITY_ORDER_V1
                .into_iter()
                .filter(|capability| host.capabilities.contains(capability) && peer.capabilities.contains(capability))
                .collect();
            NetworkHandshakeDecisionV1 {
                compatible: true,
                code: HandshakeDecisionCodeV1::Ok,
                capabilities,
                max_command_bytes,
                message: "Peer may join through host Rust authority.",
            }
        }
    };
    let mut hasher = CanonicalHasher::new("blockwild-network-compatibility-record-v1");
    hasher.write_bytes(host.handshake_hash.as_bytes());
    hasher.write_bytes(peer.handshake_hash.as_bytes());
    hasher.write_str(decision.code.as_str());
    hasher.write_u16(u16::from(decision.compatible));
    hasher.write_u32(decision.max_command_bytes);
    hasher.write_u32(decision.capabilities.len() as u32);
    for capability in &decision.capabilities {
        hasher.write_str(capability.as_str());
    }
    NetworkCompatibilityRecordV1 {
        host_handshake_hash: host.handshake_hash,
        peer_handshake_hash: peer.handshake_hash,
        decision,
        record_hash: hasher.finish(),
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct NetworkInterestChunkV1 {
    pub address: WorldAddressV1,
    pub chunk_x: i32,
    pub chunk_z: i32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkInterestSetV1 {
    pub sequence: u64,
    pub chunks: Vec<NetworkInterestChunkV1>,
    pub entity_ids: Vec<String>,
    pub interest_hash: CanonicalHash,
}

impl NetworkInterestSetV1 {
    pub fn new(
        sequence: u64,
        mut chunks: Vec<NetworkInterestChunkV1>,
        mut entity_ids: Vec<String>,
    ) -> Result<Self, NetworkError> {
        safe_integer(sequence, "interest.sequence")?;
        if chunks.len() > NETWORK_MAX_INTEREST_CHUNKS_V1 || entity_ids.len() > NETWORK_MAX_INTEREST_ENTITIES_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::InterestSize,
                "interest set exceeds V1 bounds",
            ));
        }
        for chunk in &chunks {
            chunk.address.validate()?;
        }
        for entity_id in &entity_ids {
            label(entity_id, 128, "entityId")?;
        }
        chunks.sort_by(|left, right| compare_utf16(&chunk_key(left), &chunk_key(right)));
        if chunks.windows(2).any(|pair| chunk_key(&pair[0]) == chunk_key(&pair[1])) {
            return Err(NetworkError::new(
                NetworkErrorCode::DuplicateInterest,
                "interest set contains duplicate chunk",
            ));
        }
        entity_ids.sort_by(|left, right| compare_utf16(left, right));
        entity_ids.dedup();
        let mut hasher = CanonicalHasher::new("blockwild-network-interest-v1");
        hasher.write_u64(sequence);
        hasher.write_u32(chunks.len() as u32);
        for chunk in &chunks {
            hasher.write_str(&chunk.address.universe_id);
            hasher.write_str(&chunk.address.location_id);
            hasher.write_i32(chunk.chunk_x);
            hasher.write_i32(chunk.chunk_z);
        }
        hasher.write_u32(entity_ids.len() as u32);
        for entity_id in &entity_ids {
            hasher.write_str(entity_id);
        }
        Ok(Self {
            sequence,
            chunks,
            entity_ids,
            interest_hash: hasher.finish(),
        })
    }

    pub fn validate(&self) -> Result<(), NetworkError> {
        let rebuilt = Self::new(self.sequence, self.chunks.clone(), self.entity_ids.clone())?;
        if rebuilt != *self {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "interest set hash or ordering mismatch",
            ));
        }
        Ok(())
    }

    #[must_use]
    pub fn includes_location(&self, address: &WorldAddressV1) -> bool {
        self.chunks.iter().any(|chunk| chunk.address == *address)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum NetworkCommandKindV1 {
    World = 0,
    Gameplay = 1,
    Agent = 2,
    Chat = 3,
    Interest = 4,
    Reconnect = 5,
    Pose = 6,
    PresentationState = 7,
}

impl NetworkCommandKindV1 {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::World => "world",
            Self::Gameplay => "gameplay",
            Self::Agent => "agent",
            Self::Chat => "chat",
            Self::Interest => "interest",
            Self::Reconnect => "reconnect",
            Self::Pose => "pose",
            Self::PresentationState => "presentation-state",
        }
    }

    pub(crate) const fn from_wire(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::World),
            1 => Some(Self::Gameplay),
            2 => Some(Self::Agent),
            3 => Some(Self::Chat),
            4 => Some(Self::Interest),
            5 => Some(Self::Reconnect),
            6 => Some(Self::Pose),
            7 => Some(Self::PresentationState),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkCommandV1 {
    pub schema_version: u16,
    pub protocol_version: u16,
    pub session_id: String,
    pub command_id: String,
    pub idempotency_key: String,
    pub peer_id: String,
    pub connection_id: String,
    pub actor_id: String,
    pub peer_kind: NetworkPeerKindV1,
    pub kind: NetworkCommandKindV1,
    pub required_capability: NetworkCapabilityV1,
    pub sequence: u64,
    pub expected: NetworkAuthorityIdentityV1,
    pub expires_at: u64,
    pub lease_keys: Vec<String>,
    pub payload: Vec<u8>,
    pub command_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkCommandSourceV1 {
    pub session_id: String,
    pub command_id: String,
    pub idempotency_key: String,
    pub peer_id: String,
    pub connection_id: String,
    pub actor_id: String,
    pub peer_kind: NetworkPeerKindV1,
    pub kind: NetworkCommandKindV1,
    pub required_capability: NetworkCapabilityV1,
    pub sequence: u64,
    pub expected: NetworkAuthorityIdentityV1,
    pub expires_at: u64,
    pub lease_keys: Vec<String>,
    pub payload: Vec<u8>,
}

impl NetworkCommandV1 {
    pub fn new(mut source: NetworkCommandSourceV1) -> Result<Self, NetworkError> {
        for (value, maximum, name) in [
            (&source.session_id, 180, "sessionId"),
            (&source.command_id, 180, "commandId"),
            (&source.idempotency_key, 256, "idempotencyKey"),
            (&source.peer_id, 180, "peerId"),
            (&source.connection_id, 180, "connectionId"),
            (&source.actor_id, 180, "actorId"),
        ] {
            label(value, maximum, name)?;
        }
        safe_integer(source.sequence, "sequence")?;
        safe_integer(source.expires_at, "expiresAt")?;
        source.expected.validate()?;
        if source.payload.len() > NETWORK_MAX_COMMAND_BYTES_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::CommandPayload,
                "command payload exceeds V1 budget",
            ));
        }
        if source.lease_keys.len() > NETWORK_MAX_LEASE_KEYS_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::LeaseSize,
                "command exceeds lease-key budget",
            ));
        }
        for key in &source.lease_keys {
            label(key, 256, "leaseKey")?;
        }
        source.lease_keys.sort_by(|left, right| compare_utf16(left, right));
        source.lease_keys.dedup();
        let mut hasher = CanonicalHasher::new("blockwild-network-command-v1");
        hasher.write_u16(NETWORK_AUTHORITY_SCHEMA_V1);
        hasher.write_u16(NETWORK_AUTHORITY_PROTOCOL_V1);
        hasher.write_str(&source.session_id);
        hasher.write_str(&source.command_id);
        hasher.write_str(&source.idempotency_key);
        hasher.write_str(&source.peer_id);
        hasher.write_str(&source.connection_id);
        hasher.write_str(&source.actor_id);
        hasher.write_str(source.peer_kind.as_str());
        hasher.write_str(source.kind.as_str());
        hasher.write_str(source.required_capability.as_str());
        hasher.write_u64(source.sequence);
        hasher.write_str(&source.expected.state_hash.to_hex());
        hasher.write_u64(source.expires_at);
        hasher.write_u32(source.lease_keys.len() as u32);
        for key in &source.lease_keys {
            hasher.write_str(key);
        }
        hasher.write_bytes(&source.payload);
        Ok(Self {
            schema_version: NETWORK_AUTHORITY_SCHEMA_V1,
            protocol_version: NETWORK_AUTHORITY_PROTOCOL_V1,
            session_id: source.session_id,
            command_id: source.command_id,
            idempotency_key: source.idempotency_key,
            peer_id: source.peer_id,
            connection_id: source.connection_id,
            actor_id: source.actor_id,
            peer_kind: source.peer_kind,
            kind: source.kind,
            required_capability: source.required_capability,
            sequence: source.sequence,
            expected: source.expected,
            expires_at: source.expires_at,
            lease_keys: source.lease_keys,
            payload: source.payload,
            command_hash: hasher.finish(),
        })
    }

    pub fn validate(&self) -> Result<(), NetworkError> {
        if self.schema_version != NETWORK_AUTHORITY_SCHEMA_V1 || self.protocol_version != NETWORK_AUTHORITY_PROTOCOL_V1
        {
            return Err(NetworkError::new(
                NetworkErrorCode::ProtocolMismatch,
                "command protocol/schema mismatch",
            ));
        }
        let rebuilt = Self::new(NetworkCommandSourceV1 {
            session_id: self.session_id.clone(),
            command_id: self.command_id.clone(),
            idempotency_key: self.idempotency_key.clone(),
            peer_id: self.peer_id.clone(),
            connection_id: self.connection_id.clone(),
            actor_id: self.actor_id.clone(),
            peer_kind: self.peer_kind,
            kind: self.kind,
            required_capability: self.required_capability,
            sequence: self.sequence,
            expected: self.expected.clone(),
            expires_at: self.expires_at,
            lease_keys: self.lease_keys.clone(),
            payload: self.payload.clone(),
        })?;
        if rebuilt != *self {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "command hash or normalization mismatch",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum NetworkDeltaRecordKindV1 {
    World = 0,
    Entity = 1,
    Gameplay = 2,
    Player = 3,
    Agent = 4,
    Tombstone = 5,
}

impl NetworkDeltaRecordKindV1 {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::World => "world",
            Self::Entity => "entity",
            Self::Gameplay => "gameplay",
            Self::Player => "player",
            Self::Agent => "agent",
            Self::Tombstone => "tombstone",
        }
    }

    pub(crate) const fn from_wire(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::World),
            1 => Some(Self::Entity),
            2 => Some(Self::Gameplay),
            3 => Some(Self::Player),
            4 => Some(Self::Agent),
            5 => Some(Self::Tombstone),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkDeltaRecordV1 {
    pub kind: NetworkDeltaRecordKindV1,
    pub record_id: String,
    pub revision: u64,
    pub payload: Vec<u8>,
    pub payload_hash: CanonicalHash,
}

impl NetworkDeltaRecordV1 {
    pub fn new(
        kind: NetworkDeltaRecordKindV1,
        record_id: String,
        revision: u64,
        payload: Vec<u8>,
    ) -> Result<Self, NetworkError> {
        label(&record_id, 256, "recordId")?;
        safe_integer(revision, "record.revision")?;
        let mut hasher = CanonicalHasher::new("blockwild-network-delta-record-v1");
        hasher.write_bytes(&payload);
        Ok(Self {
            kind,
            record_id,
            revision,
            payload,
            payload_hash: hasher.finish(),
        })
    }

    #[must_use]
    pub fn key(&self) -> String {
        format!("{}/{}", self.kind.as_str(), encode_uri_component(&self.record_id))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkDeltaV1 {
    pub schema_version: u16,
    pub protocol_version: u16,
    pub session_id: String,
    pub delta_id: String,
    pub peer_id: String,
    pub keyframe: bool,
    pub sequence: u64,
    pub acknowledged_command_sequence: u64,
    pub from: NetworkAuthorityIdentityV1,
    pub to: NetworkAuthorityIdentityV1,
    pub interest_hash: CanonicalHash,
    pub records: Vec<NetworkDeltaRecordV1>,
    pub byte_length: u32,
    pub delta_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkDeltaSourceV1 {
    pub session_id: String,
    pub delta_id: String,
    pub peer_id: String,
    pub keyframe: bool,
    pub sequence: u64,
    pub acknowledged_command_sequence: u64,
    pub from: NetworkAuthorityIdentityV1,
    pub to: NetworkAuthorityIdentityV1,
    pub interest_hash: CanonicalHash,
    pub records: Vec<NetworkDeltaRecordV1>,
}

impl NetworkDeltaV1 {
    pub fn new(mut source: NetworkDeltaSourceV1) -> Result<Self, NetworkError> {
        label(&source.session_id, 180, "sessionId")?;
        label(&source.delta_id, 180, "deltaId")?;
        label(&source.peer_id, 180, "peerId")?;
        safe_integer(source.sequence, "sequence")?;
        safe_integer(source.acknowledged_command_sequence, "acknowledgedCommandSequence")?;
        source.from.validate()?;
        source.to.validate()?;
        if !source.keyframe && source.from.address != source.to.address {
            return Err(NetworkError::new(
                NetworkErrorCode::DeltaLocation,
                "non-keyframe delta cannot cross locations",
            ));
        }
        if source.records.len() > NETWORK_MAX_DELTA_RECORDS_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::DeltaRecordCount,
                "delta record budget exceeded",
            ));
        }
        for record in &source.records {
            let rebuilt = NetworkDeltaRecordV1::new(
                record.kind,
                record.record_id.clone(),
                record.revision,
                record.payload.clone(),
            )?;
            if rebuilt != *record {
                return Err(NetworkError::new(
                    NetworkErrorCode::HashMismatch,
                    "delta record hash mismatch",
                ));
            }
        }
        source
            .records
            .sort_by(|left, right| compare_utf16(&left.key(), &right.key()));
        if source.records.windows(2).any(|pair| pair[0].key() == pair[1].key()) {
            return Err(NetworkError::new(
                NetworkErrorCode::DuplicateDeltaRecord,
                "duplicate delta record",
            ));
        }
        let byte_length = source
            .records
            .iter()
            .try_fold(0_usize, |total, record| total.checked_add(record.payload.len()))
            .ok_or_else(|| NetworkError::new(NetworkErrorCode::DeltaSize, "delta payload length overflow"))?;
        if byte_length > NETWORK_MAX_DELTA_BYTES_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::DeltaSize,
                "delta byte budget exceeded",
            ));
        }
        let mut hasher = CanonicalHasher::new("blockwild-network-delta-v1");
        hasher.write_u16(NETWORK_AUTHORITY_SCHEMA_V1);
        hasher.write_u16(NETWORK_AUTHORITY_PROTOCOL_V1);
        hasher.write_str(&source.session_id);
        hasher.write_str(&source.delta_id);
        hasher.write_str(&source.peer_id);
        hasher.write_u16(u16::from(source.keyframe));
        hasher.write_u64(source.sequence);
        hasher.write_u64(source.acknowledged_command_sequence);
        hasher.write_str(&source.from.state_hash.to_hex());
        hasher.write_str(&source.to.state_hash.to_hex());
        hasher.write_str(&source.interest_hash.to_hex());
        hasher.write_u32(source.records.len() as u32);
        for record in &source.records {
            hasher.write_str(record.kind.as_str());
            hasher.write_str(&record.record_id);
            hasher.write_u64(record.revision);
            hasher.write_str(&record.payload_hash.to_hex());
            hasher.write_bytes(&record.payload);
        }
        Ok(Self {
            schema_version: NETWORK_AUTHORITY_SCHEMA_V1,
            protocol_version: NETWORK_AUTHORITY_PROTOCOL_V1,
            session_id: source.session_id,
            delta_id: source.delta_id,
            peer_id: source.peer_id,
            keyframe: source.keyframe,
            sequence: source.sequence,
            acknowledged_command_sequence: source.acknowledged_command_sequence,
            from: source.from,
            to: source.to,
            interest_hash: source.interest_hash,
            records: source.records,
            byte_length: byte_length as u32,
            delta_hash: hasher.finish(),
        })
    }

    pub fn validate(&self) -> Result<(), NetworkError> {
        if self.schema_version != NETWORK_AUTHORITY_SCHEMA_V1 || self.protocol_version != NETWORK_AUTHORITY_PROTOCOL_V1
        {
            return Err(NetworkError::new(
                NetworkErrorCode::ProtocolMismatch,
                "delta protocol/schema mismatch",
            ));
        }
        let rebuilt = Self::new(NetworkDeltaSourceV1 {
            session_id: self.session_id.clone(),
            delta_id: self.delta_id.clone(),
            peer_id: self.peer_id.clone(),
            keyframe: self.keyframe,
            sequence: self.sequence,
            acknowledged_command_sequence: self.acknowledged_command_sequence,
            from: self.from.clone(),
            to: self.to.clone(),
            interest_hash: self.interest_hash,
            records: self.records.clone(),
        })?;
        if rebuilt != *self {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "delta hash, size, or normalization mismatch",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkReconnectCheckpointV1 {
    pub schema_version: u16,
    pub session_id: String,
    pub peer_id: String,
    pub connection_generation: u64,
    pub acknowledged_command_sequence: u64,
    pub acknowledged_delta_sequence: u64,
    pub identity: NetworkAuthorityIdentityV1,
    pub interest_hash: CanonicalHash,
    pub checkpoint_hash: CanonicalHash,
}

impl NetworkReconnectCheckpointV1 {
    pub fn new(
        session_id: String,
        peer_id: String,
        connection_generation: u64,
        acknowledged_command_sequence: u64,
        acknowledged_delta_sequence: u64,
        identity: NetworkAuthorityIdentityV1,
        interest_hash: CanonicalHash,
    ) -> Result<Self, NetworkError> {
        label(&session_id, 180, "sessionId")?;
        label(&peer_id, 180, "peerId")?;
        for (value, name) in [
            (connection_generation, "connectionGeneration"),
            (acknowledged_command_sequence, "acknowledgedCommandSequence"),
            (acknowledged_delta_sequence, "acknowledgedDeltaSequence"),
        ] {
            safe_integer(value, name)?;
        }
        identity.validate()?;
        let mut hasher = CanonicalHasher::new("blockwild-network-reconnect-v1");
        hasher.write_str(&session_id);
        hasher.write_str(&peer_id);
        hasher.write_u64(connection_generation);
        hasher.write_u64(acknowledged_command_sequence);
        hasher.write_u64(acknowledged_delta_sequence);
        hasher.write_str(&identity.state_hash.to_hex());
        hasher.write_str(&interest_hash.to_hex());
        Ok(Self {
            schema_version: NETWORK_AUTHORITY_SCHEMA_V1,
            session_id,
            peer_id,
            connection_generation,
            acknowledged_command_sequence,
            acknowledged_delta_sequence,
            identity,
            interest_hash,
            checkpoint_hash: hasher.finish(),
        })
    }

    pub fn validate(&self) -> Result<(), NetworkError> {
        if self.schema_version != NETWORK_AUTHORITY_SCHEMA_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::SchemaMismatch,
                "checkpoint schema mismatch",
            ));
        }
        let rebuilt = Self::new(
            self.session_id.clone(),
            self.peer_id.clone(),
            self.connection_generation,
            self.acknowledged_command_sequence,
            self.acknowledged_delta_sequence,
            self.identity.clone(),
            self.interest_hash,
        )?;
        if rebuilt != *self {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "checkpoint hash mismatch",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DivergentSubsystemV1 {
    World,
    Entities,
    Gameplay,
    Persistence,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkDesyncDiagnosticV1 {
    pub session_id: String,
    pub peer_id: String,
    pub checkpoint_hash: CanonicalHash,
    pub expected_state_hash: CanonicalHash,
    pub observed_state_hash: CanonicalHash,
    pub first_divergent_subsystem: DivergentSubsystemV1,
    pub replay_sequence: u64,
}

#[must_use]
pub fn diagnose_network_desync_v1(
    checkpoint: &NetworkReconnectCheckpointV1,
    observed: &NetworkAuthorityIdentityV1,
) -> Option<NetworkDesyncDiagnosticV1> {
    if checkpoint.identity.state_hash == observed.state_hash {
        return None;
    }
    let expected = checkpoint.identity.revision;
    let actual = observed.revision;
    let first_divergent_subsystem = if expected.world != actual.world {
        DivergentSubsystemV1::World
    } else if expected.entities != actual.entities {
        DivergentSubsystemV1::Entities
    } else if expected.gameplay != actual.gameplay {
        DivergentSubsystemV1::Gameplay
    } else if expected.persistence != actual.persistence {
        DivergentSubsystemV1::Persistence
    } else {
        DivergentSubsystemV1::Unknown
    };
    Some(NetworkDesyncDiagnosticV1 {
        session_id: checkpoint.session_id.clone(),
        peer_id: checkpoint.peer_id.clone(),
        checkpoint_hash: checkpoint.checkpoint_hash,
        expected_state_hash: checkpoint.identity.state_hash,
        observed_state_hash: observed.state_hash,
        first_divergent_subsystem,
        replay_sequence: checkpoint.acknowledged_command_sequence,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkErrorCode {
    Budget,
    CommandPayload,
    DeltaLocation,
    DeltaRecordCount,
    DeltaSize,
    DuplicateDeltaRecord,
    DuplicateInterest,
    HashMismatch,
    IdentityHash,
    InterestSize,
    InvalidEnum,
    InvalidInteger,
    InvalidLabel,
    LeaseSize,
    ProtocolMismatch,
    SchemaMismatch,
    Truncated,
    TrailingBytes,
    WireMagic,
    WireType,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkError {
    pub code: NetworkErrorCode,
    pub message: &'static str,
}

impl NetworkError {
    #[must_use]
    pub const fn new(code: NetworkErrorCode, message: &'static str) -> Self {
        Self { code, message }
    }
}

impl fmt::Display for NetworkError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for NetworkError {}

pub(crate) fn safe_integer(value: u64, _name: &str) -> Result<u64, NetworkError> {
    if value > NETWORK_MAX_SAFE_INTEGER_V1 {
        Err(NetworkError::new(
            NetworkErrorCode::InvalidInteger,
            "integer exceeds JavaScript safe range",
        ))
    } else {
        Ok(value)
    }
}

pub(crate) fn label(value: &str, maximum: usize, _name: &str) -> Result<(), NetworkError> {
    let units = value.encode_utf16().count();
    if units == 0 || units > maximum {
        Err(NetworkError::new(
            NetworkErrorCode::InvalidLabel,
            "label is empty or exceeds its UTF-16 bound",
        ))
    } else {
        Ok(())
    }
}

pub(crate) fn normalize_capabilities(input: &[NetworkCapabilityV1]) -> Vec<NetworkCapabilityV1> {
    NETWORK_CAPABILITY_ORDER_V1
        .into_iter()
        .filter(|capability| input.contains(capability))
        .collect()
}

pub(crate) fn compare_utf16(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

pub(crate) fn encode_uri_component(value: &str) -> String {
    let mut output = String::new();
    for &byte in value.as_bytes() {
        let safe = byte.is_ascii_alphanumeric()
            || matches!(byte, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')');
        if safe {
            output.push(char::from(byte));
        } else {
            use core::fmt::Write as _;
            write!(&mut output, "%{byte:02X}").expect("writing to String cannot fail");
        }
    }
    output
}

fn chunk_key(value: &NetworkInterestChunkV1) -> String {
    format!(
        "{}@{}/{},{}",
        encode_uri_component(&value.address.universe_id),
        encode_uri_component(&value.address.location_id),
        value.chunk_x,
        value.chunk_z,
    )
}

pub(crate) fn write_revision(hasher: &mut CanonicalHasher, revision: NetworkAuthorityRevisionV1) {
    hasher.write_u64(revision.epoch);
    hasher.write_u64(revision.world);
    hasher.write_u64(revision.entities);
    hasher.write_u64(revision.gameplay);
    hasher.write_u64(revision.persistence);
}
