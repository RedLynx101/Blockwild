//! Coarse, checksummed browser boundary for Rust multiplayer and agent authority.
//!
//! WebRTC transports opaque packets. This module is the first layer allowed to
//! decode them, negotiate compatibility, authorize human/agent commands, or
//! accept a delta/reconnect transition.

use std::collections::{BTreeMap, VecDeque};

use blockwild_types::{CanonicalHash, CanonicalHasher};

use crate::{
    AgentAuthorityCodeV1, AgentCapabilityGrantV1, AgentWorkAuthorityV1, AgentWorkCommandV1, DeltaApplyCodeV1,
    DeltaReceiverV1, HandshakeDecisionCodeV1, NetworkAuthorityIdentityV1, NetworkAuthorityV1, NetworkCapabilityV1,
    NetworkCommandKindV1, NetworkCommandReceiptV1, NetworkCommandV1, NetworkCompatibilityRecordV1, NetworkDeltaV1,
    NetworkError, NetworkErrorCode, NetworkHandshakeV1, NetworkInterestChunkV1, NetworkInterestSetV1,
    NetworkPeerGrantV1, NetworkPeerKindV1, NetworkPlayerPoseProjectionSourceV1, NetworkPlayerPoseProjectionV1,
    NetworkPlayerPoseV1, NetworkReceiptCodeV1, NetworkReceiptStatusV1, NetworkReconnectCheckpointV1, ReplicatedStateV1,
    WorldAddressV1, decode_agent_work_command_v1, decode_network_checkpoint_v1, decode_network_command_v1,
    decode_network_delta_v1, decode_network_handshake_v1, decode_network_player_pose_projection_v1,
    decode_network_player_pose_v1, encode_agent_work_command_v1, encode_network_checkpoint_v1,
    encode_network_command_v1, encode_network_delta_v1, encode_network_handshake_v1,
    encode_network_player_pose_projection_v1, encode_network_player_pose_v1, negotiate_network_handshake_v1,
};

pub const NETWORK_BROWSER_PROTOCOL_V1: u16 = 1;
pub const NETWORK_BROWSER_HEADER_BYTES_V1: usize = 36;
pub const NETWORK_BROWSER_MAX_WIRE_BYTES_V1: usize = 64 * 1024 * 1024;
pub const NETWORK_BROWSER_MAX_BATCH_PACKETS_V1: usize = 512;
pub const NETWORK_BROWSER_MAX_DELTA_RECEIVERS_V1: usize = 1_024;
pub const NETWORK_BROWSER_MAX_PLAYER_POSE_RECORDS_V1: usize = 1_024;
pub const NETWORK_BROWSER_MAX_PLAYER_POSE_PROJECTIONS_V1: usize = 512;

const REQUEST_MAGIC: [u8; 4] = *b"BWRN";
const RESPONSE_MAGIC: [u8; 4] = *b"BWNA";
const REQUEST_HANDSHAKE: u16 = 1;
const REQUEST_COMMAND_BATCH: u16 = 2;
const REQUEST_DELTA_DELIVERY: u16 = 3;
const REQUEST_AGENT_COMMAND: u16 = 4;
const REQUEST_GUEST_POSE: u16 = 5;
const RESPONSE_HANDSHAKE: u16 = 101;
const RESPONSE_COMMAND_BATCH: u16 = 102;
const RESPONSE_DELTA_DELIVERY: u16 = 103;
const RESPONSE_AGENT_COMMAND: u16 = 104;
const RESPONSE_GUEST_POSE: u16 = 105;
const RESPONSE_ERROR: u16 = 255;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NetworkBrowserRequestV1 {
    Handshake {
        request_id: u64,
        host: NetworkHandshakeV1,
        peer: NetworkHandshakeV1,
    },
    CommandBatch {
        request_id: u64,
        current: NetworkAuthorityIdentityV1,
        now: u64,
        commands: Vec<NetworkCommandV1>,
    },
    DeltaDelivery {
        request_id: u64,
        checkpoint: NetworkReconnectCheckpointV1,
        interest: NetworkInterestSetV1,
        delta: NetworkDeltaV1,
    },
    AgentCommand {
        request_id: u64,
        current: NetworkAuthorityIdentityV1,
        now: u64,
        envelope: NetworkCommandV1,
        work: AgentWorkCommandV1,
    },
    GuestPose {
        request_id: u64,
        current: NetworkAuthorityIdentityV1,
        now: u64,
        command: NetworkCommandV1,
        pose: NetworkPlayerPoseV1,
    },
}

impl NetworkBrowserRequestV1 {
    #[must_use]
    pub const fn request_id(&self) -> u64 {
        match self {
            Self::Handshake { request_id, .. }
            | Self::CommandBatch { request_id, .. }
            | Self::DeltaDelivery { request_id, .. }
            | Self::AgentCommand { request_id, .. }
            | Self::GuestPose { request_id, .. } => *request_id,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NetworkBrowserResponseV1 {
    Handshake {
        request_id: u64,
        compatibility: NetworkCompatibilityRecordV1,
    },
    CommandBatch {
        request_id: u64,
        receipts: Vec<NetworkCommandReceiptV1>,
        authority_fingerprint: CanonicalHash,
    },
    DeltaDelivery {
        request_id: u64,
        code: DeltaApplyCodeV1,
        sequence: u64,
        state_hash: CanonicalHash,
        message: String,
    },
    AgentCommand {
        request_id: u64,
        code: AgentAuthorityCodeV1,
        receipt: Option<NetworkCommandReceiptV1>,
        authority_fingerprint: CanonicalHash,
    },
    GuestPose {
        request_id: u64,
        receipt: NetworkCommandReceiptV1,
        projection: Option<Box<NetworkPlayerPoseProjectionV1>>,
        authority_fingerprint: CanonicalHash,
    },
    Error {
        request_id: u64,
        code: String,
        message: String,
    },
}

/// Durable host-side command authority. A malformed batch is decoded in full
/// before this structure is touched, so invalid bytes cannot partially mutate
/// sequences, receipts, grants, or leases.
#[derive(Clone, Debug)]
pub struct NetworkBrowserAuthorityRuntimeV1 {
    session_id: String,
    network: NetworkAuthorityV1,
    agent: AgentWorkAuthorityV1,
    delta_receivers: BTreeMap<(String, String, u64), DeltaReceiverV1>,
    player_pose_history: BTreeMap<String, NetworkPlayerPoseProjectionV1>,
    active_player_poses: BTreeMap<String, NetworkPlayerPoseProjectionV1>,
    player_pose_projections: BTreeMap<String, NetworkPlayerPoseProjectionV1>,
    player_pose_projection_order: VecDeque<String>,
}

impl NetworkBrowserAuthorityRuntimeV1 {
    pub fn new(session_id: String) -> Result<Self, NetworkError> {
        Ok(Self {
            network: NetworkAuthorityV1::new(session_id.clone())?,
            session_id,
            agent: AgentWorkAuthorityV1::default(),
            delta_receivers: BTreeMap::new(),
            player_pose_history: BTreeMap::new(),
            active_player_poses: BTreeMap::new(),
            player_pose_projections: BTreeMap::new(),
            player_pose_projection_order: VecDeque::new(),
        })
    }

    pub fn upsert_peer_grant(&mut self, grant: NetworkPeerGrantV1) -> Result<(), NetworkError> {
        let prior_binding = self
            .network
            .grant(&grant.peer_id)
            .map(|current| (current.connection_id.clone(), current.actor_id.clone()));
        let peer_id = grant.peer_id.clone();
        let next_binding = (grant.connection_id.clone(), grant.actor_id.clone());
        self.network.upsert_grant(grant)?;
        if prior_binding.is_some_and(|prior| prior != next_binding) {
            self.active_player_poses.remove(&peer_id);
        }
        Ok(())
    }

    pub fn upsert_agent_grant(&mut self, grant: AgentCapabilityGrantV1) -> Result<(), NetworkError> {
        self.agent.upsert_grant(grant)
    }

    pub fn release_peer(&mut self, peer_id: &str) {
        self.network.release_peer(peer_id);
        self.active_player_poses.remove(peer_id);
        self.delta_receivers
            .retain(|(_, receiver_peer_id, _), _| receiver_peer_id != peer_id);
    }

    /// Release the resource leases held by one completed or cancelled command.
    /// The command receipt remains cached, so a network retry is still
    /// idempotent and cannot execute the command a second time.
    pub fn release_command(&mut self, command_id: &str) {
        self.network.release_command(command_id);
    }

    /// Record the exact authority identity carried by a successfully built
    /// peer delta. The network authority supplies the active connection id so
    /// callers cannot forge or accidentally retain a cursor across reconnects.
    pub fn record_delta_presentation(&mut self, delta: &NetworkDeltaV1) -> Result<bool, NetworkError> {
        if delta.session_id != self.session_id {
            return Err(NetworkError::new(
                NetworkErrorCode::InvalidLabel,
                "delta presentation belongs to another authority session",
            ));
        }
        self.network
            .record_peer_presentation(&delta.peer_id, delta.sequence, &delta.to)
    }

    #[must_use]
    pub fn authority_fingerprint(&self) -> CanonicalHash {
        self.network.authority_fingerprint()
    }

    #[must_use]
    /// Last durable record in this authority runtime's per-peer hash chain.
    /// It survives release solely to preserve monotonic reconnect ancestry.
    pub fn latest_player_pose_projection(&self, peer_id: &str) -> Option<&NetworkPlayerPoseProjectionV1> {
        self.player_pose_history.get(peer_id)
    }

    #[must_use]
    /// Presentation-safe record for the currently granted connection only.
    pub fn active_player_pose_projection(&self, peer_id: &str) -> Option<&NetworkPlayerPoseProjectionV1> {
        let projection = self.active_player_poses.get(peer_id)?;
        let grant = self.network.grant(peer_id)?;
        (grant.connection_id == projection.connection_id && grant.actor_id == projection.player_id)
            .then_some(projection)
    }

    #[must_use]
    pub fn player_pose_record_count(&self) -> usize {
        self.player_pose_history.len()
    }

    #[must_use]
    pub fn player_pose_projection_cache_count(&self) -> usize {
        self.player_pose_projections.len()
    }

    pub fn reconnect_checkpoint(
        &self,
        session_id: &str,
        peer_id: &str,
        connection_generation: u64,
    ) -> Result<Option<NetworkReconnectCheckpointV1>, NetworkError> {
        self.delta_receivers
            .get(&(session_id.to_owned(), peer_id.to_owned(), connection_generation))
            .map(DeltaReceiverV1::reconnect_checkpoint)
            .transpose()
    }

    pub fn process(&mut self, bytes: &[u8]) -> Result<Vec<u8>, NetworkError> {
        let request = decode_network_browser_request_v1(bytes)?;
        let response = match request {
            NetworkBrowserRequestV1::Handshake { request_id, host, peer } => NetworkBrowserResponseV1::Handshake {
                request_id,
                compatibility: negotiate_network_handshake_v1(&host, &peer),
            },
            NetworkBrowserRequestV1::CommandBatch {
                request_id,
                current,
                now,
                commands,
            } => {
                let mut contains_pose = false;
                for command in &commands {
                    if command.kind == NetworkCommandKindV1::Pose {
                        let pose = decode_network_player_pose_v1(&command.payload)?;
                        prevalidate_guest_pose_command(command, &pose)?;
                        contains_pose = true;
                    }
                }
                if contains_pose {
                    return Err(NetworkError::new(
                        NetworkErrorCode::InvalidEnum,
                        "native guest pose commands require the dedicated browser request",
                    ));
                }
                let mut receipts = Vec::with_capacity(commands.len());
                for command in &commands {
                    receipts.push(self.network.authorize(command, &current, now)?);
                }
                NetworkBrowserResponseV1::CommandBatch {
                    request_id,
                    receipts,
                    authority_fingerprint: self.network.authority_fingerprint(),
                }
            }
            NetworkBrowserRequestV1::DeltaDelivery {
                request_id,
                checkpoint,
                interest,
                delta,
            } => {
                if checkpoint.session_id != self.session_id {
                    let state_hash = ReplicatedStateV1::new(checkpoint.identity.clone()).canonical_state_hash();
                    return encode_network_browser_response_v1(&NetworkBrowserResponseV1::DeltaDelivery {
                        request_id,
                        code: DeltaApplyCodeV1::SessionMismatch,
                        sequence: checkpoint.acknowledged_delta_sequence.saturating_add(1),
                        state_hash,
                        message: delta_message(DeltaApplyCodeV1::SessionMismatch).to_owned(),
                    });
                }
                let key = (
                    checkpoint.session_id.clone(),
                    checkpoint.peer_id.clone(),
                    checkpoint.connection_generation,
                );
                let receiver = if let Some(receiver) = self.delta_receivers.get_mut(&key) {
                    receiver
                } else if delta.keyframe {
                    if self.delta_receivers.len() >= NETWORK_BROWSER_MAX_DELTA_RECEIVERS_V1 {
                        return Err(NetworkError::new(
                            NetworkErrorCode::Budget,
                            "network browser delta receiver budget is exhausted",
                        ));
                    }
                    let state = ReplicatedStateV1::new(checkpoint.identity.clone());
                    self.delta_receivers.insert(
                        key.clone(),
                        DeltaReceiverV1::from_checkpoint(&checkpoint, interest.clone(), state)?,
                    );
                    self.delta_receivers.get_mut(&key).expect("inserted delta receiver")
                } else {
                    let state_hash = ReplicatedStateV1::new(checkpoint.identity.clone()).canonical_state_hash();
                    return encode_network_browser_response_v1(&NetworkBrowserResponseV1::DeltaDelivery {
                        request_id,
                        code: DeltaApplyCodeV1::StaleFrom,
                        sequence: checkpoint.acknowledged_delta_sequence.saturating_add(1),
                        state_hash,
                        message: "A keyframe is required to initialize this Rust delta receiver.".to_owned(),
                    });
                };
                let outcome = receiver.apply_with_interest(interest, &delta)?;
                NetworkBrowserResponseV1::DeltaDelivery {
                    request_id,
                    code: outcome.code,
                    sequence: outcome.sequence,
                    state_hash: outcome.state_hash,
                    message: delta_message(outcome.code).to_owned(),
                }
            }
            NetworkBrowserRequestV1::AgentCommand {
                request_id,
                current,
                now,
                envelope,
                work,
            } => {
                let decision = self
                    .agent
                    .authorize(&mut self.network, &envelope, &work, &current, now)?;
                NetworkBrowserResponseV1::AgentCommand {
                    request_id,
                    code: decision.code,
                    receipt: decision.receipt,
                    authority_fingerprint: self.network.authority_fingerprint(),
                }
            }
            NetworkBrowserRequestV1::GuestPose {
                request_id,
                current,
                now,
                command,
                pose,
            } => {
                let (receipt, projection) = self.authorize_guest_pose(&command, &pose, &current, now)?;
                NetworkBrowserResponseV1::GuestPose {
                    request_id,
                    receipt,
                    projection: projection.map(Box::new),
                    authority_fingerprint: self.network.authority_fingerprint(),
                }
            }
        };
        encode_network_browser_response_v1(&response)
    }

    fn authorize_guest_pose(
        &mut self,
        command: &NetworkCommandV1,
        pose: &NetworkPlayerPoseV1,
        current: &NetworkAuthorityIdentityV1,
        now: u64,
    ) -> Result<(NetworkCommandReceiptV1, Option<NetworkPlayerPoseProjectionV1>), NetworkError> {
        prevalidate_guest_pose_command(command, pose)?;
        let cached = self
            .player_pose_projections
            .get(&command.idempotency_key)
            .filter(|projection| projection.command_hash == command.command_hash)
            .cloned();

        // Stage generic authority separately so no projection-construction
        // failure can leave a consumed command sequence or receipt behind.
        let mut staged_network = self.network.clone();
        let receipt = staged_network.authorize_active_peer_command(command, current, now)?;
        if !receipt.accepted() {
            self.network = staged_network;
            return Ok((receipt, None));
        }
        if let Some(projection) = cached {
            if projection.receipt_hash != receipt.receipt_hash {
                return Err(NetworkError::new(
                    NetworkErrorCode::HashMismatch,
                    "cached native player pose projection receipt drifted",
                ));
            }
            self.network = staged_network;
            return Ok((receipt, Some(projection)));
        }

        if !self.player_pose_history.contains_key(&command.peer_id)
            && self.player_pose_history.len() >= NETWORK_BROWSER_MAX_PLAYER_POSE_RECORDS_V1
        {
            return Err(NetworkError::new(
                NetworkErrorCode::Budget,
                "network browser native player pose record budget is exhausted",
            ));
        }
        let prior = self.player_pose_history.get(&command.peer_id);
        let record_revision = prior.map_or(Ok(1), |projection| {
            projection.record_revision.checked_add(1).ok_or_else(|| {
                NetworkError::new(
                    NetworkErrorCode::InvalidInteger,
                    "native player pose record revision overflow",
                )
            })
        })?;
        crate::safe_integer(record_revision, "native player pose record revision")?;
        let previous_record_hash = prior.map_or(CanonicalHash::default(), |projection| projection.record_hash);

        let presentation = staged_network.peer_presentation(&command.peer_id).ok_or_else(|| {
            NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "accepted native player pose lacks a connection-bound presentation",
            )
        })?;
        let projection = NetworkPlayerPoseProjectionV1::new(NetworkPlayerPoseProjectionSourceV1 {
            session_id: command.session_id.clone(),
            peer_id: command.peer_id.clone(),
            connection_id: command.connection_id.clone(),
            player_id: pose.player_id.clone(),
            command_id: command.command_id.clone(),
            command_sequence: command.sequence,
            command_hash: command.command_hash,
            receipt_hash: receipt.receipt_hash,
            presented_delta_sequence: presentation.delta_sequence,
            presented_identity_hash: presentation.identity.state_hash,
            record_revision,
            previous_record_hash,
            pose: pose.clone(),
        })?;

        self.network = staged_network;
        self.player_pose_history
            .insert(command.peer_id.clone(), projection.clone());
        self.active_player_poses
            .insert(command.peer_id.clone(), projection.clone());
        let cache_key = command.idempotency_key.clone();
        self.player_pose_projections
            .insert(cache_key.clone(), projection.clone());
        self.player_pose_projection_order.push_back(cache_key);
        while self.player_pose_projection_order.len() > NETWORK_BROWSER_MAX_PLAYER_POSE_PROJECTIONS_V1 {
            if let Some(expired) = self.player_pose_projection_order.pop_front() {
                self.player_pose_projections.remove(&expired);
            }
        }
        Ok((receipt, Some(projection)))
    }
}

#[must_use]
pub fn validate_delta_delivery(
    checkpoint: &NetworkReconnectCheckpointV1,
    interest_hash: CanonicalHash,
    delta: &NetworkDeltaV1,
) -> (DeltaApplyCodeV1, &'static str) {
    if delta.session_id != checkpoint.session_id {
        (DeltaApplyCodeV1::SessionMismatch, "Delta belongs to another session.")
    } else if delta.peer_id != checkpoint.peer_id {
        (DeltaApplyCodeV1::PeerMismatch, "Delta belongs to another peer.")
    } else if checkpoint.interest_hash != interest_hash || delta.interest_hash != interest_hash {
        (
            DeltaApplyCodeV1::InterestMismatch,
            "Delta does not match the host-authorized interest set.",
        )
    } else if delta.sequence <= checkpoint.acknowledged_delta_sequence {
        (DeltaApplyCodeV1::Duplicate, "Delta was already acknowledged.")
    } else if delta.sequence != checkpoint.acknowledged_delta_sequence.saturating_add(1) {
        (
            DeltaApplyCodeV1::SequenceGap,
            "Delta sequence has a gap; request a keyframe.",
        )
    } else if delta.acknowledged_command_sequence < checkpoint.acknowledged_command_sequence {
        (
            DeltaApplyCodeV1::CommandAcknowledgementRegressed,
            "Command acknowledgement regressed.",
        )
    } else if !delta.keyframe && delta.from != checkpoint.identity {
        (
            DeltaApplyCodeV1::StaleFrom,
            "Delta starts from stale authoritative state.",
        )
    } else {
        (DeltaApplyCodeV1::Applied, "Delta may be applied atomically.")
    }
}

const fn delta_message(code: DeltaApplyCodeV1) -> &'static str {
    match code {
        DeltaApplyCodeV1::Applied => "Delta applied atomically by the Rust receiver.",
        DeltaApplyCodeV1::Duplicate => "Delta was already acknowledged.",
        DeltaApplyCodeV1::SequenceGap => "Delta sequence has a gap; request a keyframe.",
        DeltaApplyCodeV1::SessionMismatch => "Delta belongs to another session.",
        DeltaApplyCodeV1::PeerMismatch => "Delta belongs to another peer.",
        DeltaApplyCodeV1::InterestMismatch => "Delta does not match the host-authorized interest set.",
        DeltaApplyCodeV1::StaleFrom => "Delta starts from stale authoritative state.",
        DeltaApplyCodeV1::CommandAcknowledgementRegressed => "Command acknowledgement regressed.",
    }
}

pub fn prepare_network_handshake_request_v1(
    request_id: u64,
    host: &NetworkHandshakeV1,
    peer: &NetworkHandshakeV1,
) -> Result<Vec<u8>, NetworkError> {
    let mut payload = Writer::default();
    payload.bytes(&encode_network_handshake_v1(host)?)?;
    payload.bytes(&encode_network_handshake_v1(peer)?)?;
    wrap(REQUEST_MAGIC, REQUEST_HANDSHAKE, request_id, payload.finish())
}

pub fn prepare_network_command_batch_request_v1(
    request_id: u64,
    current: &NetworkAuthorityIdentityV1,
    now: u64,
    commands: &[NetworkCommandV1],
) -> Result<Vec<u8>, NetworkError> {
    if commands.is_empty() || commands.len() > NETWORK_BROWSER_MAX_BATCH_PACKETS_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::Budget,
            "command batch is outside its V1 bounds",
        ));
    }
    current.validate()?;
    let mut payload = Writer::default();
    payload.identity(current)?;
    payload.u64(now);
    payload.u32(commands.len() as u32);
    for command in commands {
        payload.bytes(&encode_network_command_v1(command)?)?;
    }
    wrap(REQUEST_MAGIC, REQUEST_COMMAND_BATCH, request_id, payload.finish())
}

pub fn prepare_network_delta_delivery_request_v1(
    request_id: u64,
    checkpoint: &NetworkReconnectCheckpointV1,
    interest: &NetworkInterestSetV1,
    delta: &NetworkDeltaV1,
) -> Result<Vec<u8>, NetworkError> {
    checkpoint.validate()?;
    interest.validate()?;
    delta.validate()?;
    let mut payload = Writer::default();
    payload.bytes(&encode_network_checkpoint_v1(checkpoint)?)?;
    payload.interest(interest)?;
    payload.bytes(&encode_network_delta_v1(delta)?)?;
    wrap(REQUEST_MAGIC, REQUEST_DELTA_DELIVERY, request_id, payload.finish())
}

pub fn prepare_network_agent_request_v1(
    request_id: u64,
    current: &NetworkAuthorityIdentityV1,
    now: u64,
    envelope: &NetworkCommandV1,
    work: &AgentWorkCommandV1,
) -> Result<Vec<u8>, NetworkError> {
    current.validate()?;
    let mut payload = Writer::default();
    payload.identity(current)?;
    payload.u64(now);
    payload.bytes(&encode_network_command_v1(envelope)?)?;
    payload.bytes(&encode_agent_work_command_v1(work)?)?;
    wrap(REQUEST_MAGIC, REQUEST_AGENT_COMMAND, request_id, payload.finish())
}

pub fn prepare_network_guest_pose_request_v1(
    request_id: u64,
    current: &NetworkAuthorityIdentityV1,
    now: u64,
    command: &NetworkCommandV1,
) -> Result<Vec<u8>, NetworkError> {
    current.validate()?;
    crate::safe_integer(now, "native player pose authority clock")?;
    let pose = decode_network_player_pose_v1(&command.payload)?;
    prevalidate_guest_pose_command(command, &pose)?;
    let mut payload = Writer::default();
    payload.identity(current)?;
    payload.u64(now);
    payload.bytes(&encode_network_command_v1(command)?)?;
    wrap(REQUEST_MAGIC, REQUEST_GUEST_POSE, request_id, payload.finish())
}

pub fn decode_network_browser_request_v1(bytes: &[u8]) -> Result<NetworkBrowserRequestV1, NetworkError> {
    let (kind, request_id, payload) = unwrap(REQUEST_MAGIC, bytes)?;
    let mut reader = Reader::new(payload);
    let result = match kind {
        REQUEST_HANDSHAKE => NetworkBrowserRequestV1::Handshake {
            request_id,
            host: decode_network_handshake_v1(&reader.bytes(crate::NETWORK_MAX_HANDSHAKE_WIRE_BYTES_V1)?)?,
            peer: decode_network_handshake_v1(&reader.bytes(crate::NETWORK_MAX_HANDSHAKE_WIRE_BYTES_V1)?)?,
        },
        REQUEST_COMMAND_BATCH => {
            let current = reader.identity()?;
            let now = reader.u64()?;
            let count = reader.u32()? as usize;
            if count == 0 || count > NETWORK_BROWSER_MAX_BATCH_PACKETS_V1 {
                return Err(NetworkError::new(
                    NetworkErrorCode::Budget,
                    "command batch is outside its V1 bounds",
                ));
            }
            let mut commands = Vec::with_capacity(count);
            for _ in 0..count {
                commands.push(decode_network_command_v1(
                    &reader.bytes(crate::NETWORK_MAX_COMMAND_WIRE_BYTES_V1)?,
                )?);
            }
            NetworkBrowserRequestV1::CommandBatch {
                request_id,
                current,
                now,
                commands,
            }
        }
        REQUEST_DELTA_DELIVERY => NetworkBrowserRequestV1::DeltaDelivery {
            request_id,
            checkpoint: decode_network_checkpoint_v1(&reader.bytes(crate::NETWORK_MAX_CHECKPOINT_WIRE_BYTES_V1)?)?,
            interest: reader.interest()?,
            delta: decode_network_delta_v1(&reader.bytes(crate::NETWORK_MAX_DELTA_WIRE_BYTES_V1)?)?,
        },
        REQUEST_AGENT_COMMAND => NetworkBrowserRequestV1::AgentCommand {
            request_id,
            current: reader.identity()?,
            now: reader.u64()?,
            envelope: decode_network_command_v1(&reader.bytes(crate::NETWORK_MAX_COMMAND_WIRE_BYTES_V1)?)?,
            work: decode_agent_work_command_v1(&reader.bytes(crate::AGENT_MAX_COMMAND_BYTES_V1 + 4096)?)?,
        },
        REQUEST_GUEST_POSE => {
            let current = reader.identity()?;
            let now = reader.u64()?;
            crate::safe_integer(now, "native player pose authority clock")?;
            let command = decode_network_command_v1(&reader.bytes(crate::NETWORK_MAX_COMMAND_WIRE_BYTES_V1)?)?;
            let pose = decode_network_player_pose_v1(&command.payload)?;
            prevalidate_guest_pose_command(&command, &pose)?;
            NetworkBrowserRequestV1::GuestPose {
                request_id,
                current,
                now,
                command,
                pose,
            }
        }
        _ => {
            return Err(NetworkError::new(
                NetworkErrorCode::InvalidEnum,
                "unknown network browser request kind",
            ));
        }
    };
    reader.finish()?;
    Ok(result)
}

pub fn encode_network_browser_response_v1(response: &NetworkBrowserResponseV1) -> Result<Vec<u8>, NetworkError> {
    let mut payload = Writer::default();
    let (kind, request_id) = match response {
        NetworkBrowserResponseV1::Handshake {
            request_id,
            compatibility,
        } => {
            payload.u8(u8::from(compatibility.decision.compatible));
            payload.string(compatibility.decision.code.as_str())?;
            payload.u32(compatibility.decision.capabilities.len() as u32);
            for capability in &compatibility.decision.capabilities {
                payload.u8(*capability as u8);
            }
            payload.u32(compatibility.decision.max_command_bytes);
            payload.string(compatibility.decision.message)?;
            payload.hash(compatibility.record_hash);
            (RESPONSE_HANDSHAKE, *request_id)
        }
        NetworkBrowserResponseV1::CommandBatch {
            request_id,
            receipts,
            authority_fingerprint,
        } => {
            payload.u32(receipts.len() as u32);
            for receipt in receipts {
                payload.receipt(receipt)?;
            }
            payload.hash(*authority_fingerprint);
            (RESPONSE_COMMAND_BATCH, *request_id)
        }
        NetworkBrowserResponseV1::DeltaDelivery {
            request_id,
            code,
            sequence,
            state_hash,
            message,
        } => {
            payload.string(delta_code(*code))?;
            payload.u64(*sequence);
            payload.hash(*state_hash);
            payload.string(message)?;
            (RESPONSE_DELTA_DELIVERY, *request_id)
        }
        NetworkBrowserResponseV1::AgentCommand {
            request_id,
            code,
            receipt,
            authority_fingerprint,
        } => {
            payload.string(agent_code(*code))?;
            payload.u8(u8::from(receipt.is_some()));
            if let Some(receipt) = receipt {
                payload.receipt(receipt)?;
            }
            payload.hash(*authority_fingerprint);
            (RESPONSE_AGENT_COMMAND, *request_id)
        }
        NetworkBrowserResponseV1::GuestPose {
            request_id,
            receipt,
            projection,
            authority_fingerprint,
        } => {
            validate_command_receipt_hash(receipt)?;
            validate_guest_pose_response_binding(receipt, projection.as_deref())?;
            payload.receipt(receipt)?;
            payload.u8(u8::from(projection.is_some()));
            if let Some(projection) = projection {
                payload.bytes(&encode_network_player_pose_projection_v1(projection)?)?;
            }
            payload.hash(*authority_fingerprint);
            (RESPONSE_GUEST_POSE, *request_id)
        }
        NetworkBrowserResponseV1::Error {
            request_id,
            code,
            message,
        } => {
            payload.string(code)?;
            payload.string(message)?;
            (RESPONSE_ERROR, *request_id)
        }
    };
    wrap(RESPONSE_MAGIC, kind, request_id, payload.finish())
}

pub fn decode_network_browser_response_v1(bytes: &[u8]) -> Result<NetworkBrowserResponseV1, NetworkError> {
    let (kind, request_id, payload) = unwrap(RESPONSE_MAGIC, bytes)?;
    let mut reader = Reader::new(payload);
    let result = match kind {
        RESPONSE_HANDSHAKE => {
            let compatible = reader.flag()?;
            let code = handshake_code(&reader.string()?)?;
            let count = reader.u32()? as usize;
            if count > crate::NETWORK_CAPABILITY_ORDER_V1.len() {
                return Err(NetworkError::new(
                    NetworkErrorCode::Budget,
                    "capability response exceeds V1 bounds",
                ));
            }
            let mut capabilities = Vec::with_capacity(count);
            for _ in 0..count {
                capabilities.push(capability(reader.u8()?)?);
            }
            let max_command_bytes = reader.u32()?;
            let _message = reader.string()?;
            let record_hash = reader.hash()?;
            NetworkBrowserResponseV1::Handshake {
                request_id,
                compatibility: NetworkCompatibilityRecordV1 {
                    host_handshake_hash: CanonicalHash::default(),
                    peer_handshake_hash: CanonicalHash::default(),
                    decision: crate::NetworkHandshakeDecisionV1 {
                        compatible,
                        code,
                        capabilities,
                        max_command_bytes,
                        message: handshake_message(code),
                    },
                    record_hash,
                },
            }
        }
        RESPONSE_COMMAND_BATCH => {
            let count = reader.u32()? as usize;
            if count > NETWORK_BROWSER_MAX_BATCH_PACKETS_V1 {
                return Err(NetworkError::new(
                    NetworkErrorCode::Budget,
                    "receipt batch exceeds V1 bounds",
                ));
            }
            let mut receipts = Vec::with_capacity(count);
            for _ in 0..count {
                receipts.push(reader.receipt()?);
            }
            NetworkBrowserResponseV1::CommandBatch {
                request_id,
                receipts,
                authority_fingerprint: reader.hash()?,
            }
        }
        RESPONSE_DELTA_DELIVERY => NetworkBrowserResponseV1::DeltaDelivery {
            request_id,
            code: parse_delta_code(&reader.string()?)?,
            sequence: reader.u64()?,
            state_hash: reader.hash()?,
            message: reader.string()?,
        },
        RESPONSE_AGENT_COMMAND => {
            let code = parse_agent_code(&reader.string()?)?;
            let receipt = if !reader.flag()? { None } else { Some(reader.receipt()?) };
            NetworkBrowserResponseV1::AgentCommand {
                request_id,
                code,
                receipt,
                authority_fingerprint: reader.hash()?,
            }
        }
        RESPONSE_GUEST_POSE => {
            let receipt = reader.receipt()?;
            validate_command_receipt_hash(&receipt)?;
            let projection = if reader.flag()? {
                Some(Box::new(decode_network_player_pose_projection_v1(
                    &reader.bytes(crate::NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1)?,
                )?))
            } else {
                None
            };
            validate_guest_pose_response_binding(&receipt, projection.as_deref())?;
            NetworkBrowserResponseV1::GuestPose {
                request_id,
                receipt,
                projection,
                authority_fingerprint: reader.hash()?,
            }
        }
        RESPONSE_ERROR => NetworkBrowserResponseV1::Error {
            request_id,
            code: reader.string()?,
            message: reader.string()?,
        },
        _ => {
            return Err(NetworkError::new(
                NetworkErrorCode::InvalidEnum,
                "unknown network browser response kind",
            ));
        }
    };
    reader.finish()?;
    Ok(result)
}

fn prevalidate_guest_pose_command(command: &NetworkCommandV1, pose: &NetworkPlayerPoseV1) -> Result<(), NetworkError> {
    command.validate()?;
    pose.validate()?;
    if command.kind != NetworkCommandKindV1::Pose
        || command.peer_kind != NetworkPeerKindV1::Human
        || command.required_capability != NetworkCapabilityV1::Interact
        || !command.lease_keys.is_empty()
    {
        return Err(NetworkError::new(
            NetworkErrorCode::InvalidEnum,
            "native guest pose command has an invalid authority shape",
        ));
    }
    if command.peer_id != command.actor_id || command.actor_id != pose.player_id {
        return Err(NetworkError::new(
            NetworkErrorCode::InvalidLabel,
            "native guest pose player, actor, and peer ids must match",
        ));
    }
    if command.payload != encode_network_player_pose_v1(pose)? {
        return Err(NetworkError::new(
            NetworkErrorCode::HashMismatch,
            "native guest pose command payload is not canonical",
        ));
    }
    Ok(())
}

fn validate_guest_pose_response_binding(
    receipt: &NetworkCommandReceiptV1,
    projection: Option<&NetworkPlayerPoseProjectionV1>,
) -> Result<(), NetworkError> {
    if receipt.accepted() != projection.is_some() {
        return Err(NetworkError::new(
            NetworkErrorCode::WireType,
            "native player pose response acceptance and projection disagree",
        ));
    }
    if let Some(projection) = projection
        && (projection.command_id != receipt.command_id
            || projection.peer_id != receipt.peer_id
            || projection.receipt_hash != receipt.receipt_hash)
    {
        return Err(NetworkError::new(
            NetworkErrorCode::HashMismatch,
            "native player pose response receipt and projection disagree",
        ));
    }
    Ok(())
}

fn validate_command_receipt_hash(receipt: &NetworkCommandReceiptV1) -> Result<(), NetworkError> {
    if receipt.schema_version != crate::NETWORK_AUTHORITY_SCHEMA_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::SchemaMismatch,
            "native player pose authority receipt schema mismatch",
        ));
    }
    crate::label(&receipt.command_id, 180, "native player pose receipt command id")?;
    crate::label(
        &receipt.idempotency_key,
        256,
        "native player pose receipt idempotency key",
    )?;
    crate::label(&receipt.peer_id, 180, "native player pose receipt peer id")?;
    receipt.identity.validate()?;
    if match receipt.status {
        NetworkReceiptStatusV1::Accepted => receipt.code.is_some() || !receipt.message.is_empty(),
        NetworkReceiptStatusV1::Rejected => receipt.code.is_none(),
    } {
        return Err(NetworkError::new(
            NetworkErrorCode::WireType,
            "native player pose authority receipt shape is not canonical",
        ));
    }
    let mut hasher = CanonicalHasher::new("blockwild-network-receipt-v1");
    hasher.write_str(receipt.status.as_str());
    hasher.write_str(&receipt.command_id);
    hasher.write_str(&receipt.idempotency_key);
    hasher.write_str(&receipt.peer_id);
    hasher.write_str(&receipt.identity.state_hash.to_hex());
    if let Some(code) = receipt.code {
        hasher.write_str(code.as_str());
        hasher.write_str(&receipt.message);
    }
    if hasher.finish() != receipt.receipt_hash {
        return Err(NetworkError::new(
            NetworkErrorCode::HashMismatch,
            "native player pose authority receipt hash mismatch",
        ));
    }
    Ok(())
}

fn wrap(magic: [u8; 4], kind: u16, request_id: u64, payload: Vec<u8>) -> Result<Vec<u8>, NetworkError> {
    if payload.len() > NETWORK_BROWSER_MAX_WIRE_BYTES_V1 - NETWORK_BROWSER_HEADER_BYTES_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::Budget,
            "network browser payload exceeds V1 budget",
        ));
    }
    let mut output = Vec::with_capacity(NETWORK_BROWSER_HEADER_BYTES_V1 + payload.len());
    output.extend_from_slice(&magic);
    output.extend_from_slice(&NETWORK_BROWSER_PROTOCOL_V1.to_le_bytes());
    output.extend_from_slice(&kind.to_le_bytes());
    output.extend_from_slice(&request_id.to_le_bytes());
    output.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    output.extend_from_slice(browser_hash(&payload).as_bytes());
    output.extend_from_slice(&payload);
    Ok(output)
}

fn unwrap(magic: [u8; 4], bytes: &[u8]) -> Result<(u16, u64, &[u8]), NetworkError> {
    if bytes.len() < NETWORK_BROWSER_HEADER_BYTES_V1 || bytes.len() > NETWORK_BROWSER_MAX_WIRE_BYTES_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::Budget,
            "network browser message is outside V1 bounds",
        ));
    }
    if bytes[..4] != magic {
        return Err(NetworkError::new(
            NetworkErrorCode::WireMagic,
            "network browser magic mismatch",
        ));
    }
    let protocol = u16::from_le_bytes(bytes[4..6].try_into().expect("fixed slice"));
    if protocol != NETWORK_BROWSER_PROTOCOL_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::ProtocolMismatch,
            "network browser protocol mismatch",
        ));
    }
    let kind = u16::from_le_bytes(bytes[6..8].try_into().expect("fixed slice"));
    let request_id = u64::from_le_bytes(bytes[8..16].try_into().expect("fixed slice"));
    let length = u32::from_le_bytes(bytes[16..20].try_into().expect("fixed slice")) as usize;
    if length != bytes.len() - NETWORK_BROWSER_HEADER_BYTES_V1 {
        return Err(NetworkError::new(
            NetworkErrorCode::Truncated,
            "network browser payload length mismatch",
        ));
    }
    let expected_hash = CanonicalHash(bytes[20..36].try_into().expect("fixed slice"));
    let payload = &bytes[NETWORK_BROWSER_HEADER_BYTES_V1..];
    if browser_hash(payload) != expected_hash {
        return Err(NetworkError::new(
            NetworkErrorCode::HashMismatch,
            "network browser checksum mismatch",
        ));
    }
    Ok((kind, request_id, payload))
}

fn browser_hash(bytes: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-network-browser-runtime-v1");
    hasher.write_bytes(bytes);
    hasher.finish()
}

fn delta_code(code: DeltaApplyCodeV1) -> &'static str {
    match code {
        DeltaApplyCodeV1::Applied => "applied",
        DeltaApplyCodeV1::Duplicate => "duplicate",
        DeltaApplyCodeV1::SequenceGap => "sequence-gap",
        DeltaApplyCodeV1::SessionMismatch => "session-mismatch",
        DeltaApplyCodeV1::PeerMismatch => "peer-mismatch",
        DeltaApplyCodeV1::InterestMismatch => "interest-mismatch",
        DeltaApplyCodeV1::StaleFrom => "stale-from",
        DeltaApplyCodeV1::CommandAcknowledgementRegressed => "command-ack-regressed",
    }
}

fn parse_delta_code(value: &str) -> Result<DeltaApplyCodeV1, NetworkError> {
    match value {
        "applied" => Ok(DeltaApplyCodeV1::Applied),
        "duplicate" => Ok(DeltaApplyCodeV1::Duplicate),
        "sequence-gap" => Ok(DeltaApplyCodeV1::SequenceGap),
        "session-mismatch" => Ok(DeltaApplyCodeV1::SessionMismatch),
        "peer-mismatch" => Ok(DeltaApplyCodeV1::PeerMismatch),
        "interest-mismatch" => Ok(DeltaApplyCodeV1::InterestMismatch),
        "stale-from" => Ok(DeltaApplyCodeV1::StaleFrom),
        "command-ack-regressed" => Ok(DeltaApplyCodeV1::CommandAcknowledgementRegressed),
        _ => Err(NetworkError::new(
            NetworkErrorCode::InvalidEnum,
            "unknown delta result code",
        )),
    }
}

fn agent_code(code: AgentAuthorityCodeV1) -> &'static str {
    match code {
        AgentAuthorityCodeV1::Accepted => "accepted",
        AgentAuthorityCodeV1::UnknownAgent => "unknown-agent",
        AgentAuthorityCodeV1::ConnectionMismatch => "connection-mismatch",
        AgentAuthorityCodeV1::Pending => "pending",
        AgentAuthorityCodeV1::Paused => "paused",
        AgentAuthorityCodeV1::Revoked => "revoked",
        AgentAuthorityCodeV1::Expired => "expired",
        AgentAuthorityCodeV1::CapabilityDenied => "capability-denied",
        AgentAuthorityCodeV1::EnvelopeMismatch => "envelope-mismatch",
    }
}

fn parse_agent_code(value: &str) -> Result<AgentAuthorityCodeV1, NetworkError> {
    match value {
        "accepted" => Ok(AgentAuthorityCodeV1::Accepted),
        "unknown-agent" => Ok(AgentAuthorityCodeV1::UnknownAgent),
        "connection-mismatch" => Ok(AgentAuthorityCodeV1::ConnectionMismatch),
        "pending" => Ok(AgentAuthorityCodeV1::Pending),
        "paused" => Ok(AgentAuthorityCodeV1::Paused),
        "revoked" => Ok(AgentAuthorityCodeV1::Revoked),
        "expired" => Ok(AgentAuthorityCodeV1::Expired),
        "capability-denied" => Ok(AgentAuthorityCodeV1::CapabilityDenied),
        "envelope-mismatch" => Ok(AgentAuthorityCodeV1::EnvelopeMismatch),
        _ => Err(NetworkError::new(
            NetworkErrorCode::InvalidEnum,
            "unknown agent result code",
        )),
    }
}

fn handshake_code(value: &str) -> Result<HandshakeDecisionCodeV1, NetworkError> {
    match value {
        "ok" => Ok(HandshakeDecisionCodeV1::Ok),
        "schema-mismatch" => Ok(HandshakeDecisionCodeV1::SchemaMismatch),
        "protocol-mismatch" => Ok(HandshakeDecisionCodeV1::ProtocolMismatch),
        "session-mismatch" => Ok(HandshakeDecisionCodeV1::SessionMismatch),
        "role-conflict" => Ok(HandshakeDecisionCodeV1::RoleConflict),
        "engine-mismatch" => Ok(HandshakeDecisionCodeV1::EngineMismatch),
        "content-mismatch" => Ok(HandshakeDecisionCodeV1::ContentMismatch),
        "generator-mismatch" => Ok(HandshakeDecisionCodeV1::GeneratorMismatch),
        "command-budget" => Ok(HandshakeDecisionCodeV1::CommandBudget),
        _ => Err(NetworkError::new(
            NetworkErrorCode::InvalidEnum,
            "unknown handshake result code",
        )),
    }
}

fn capability(tag: u8) -> Result<NetworkCapabilityV1, NetworkError> {
    crate::NETWORK_CAPABILITY_ORDER_V1
        .get(tag as usize)
        .copied()
        .ok_or_else(|| NetworkError::new(NetworkErrorCode::InvalidEnum, "unknown capability tag"))
}

fn receipt_code(value: &str) -> Result<Option<NetworkReceiptCodeV1>, NetworkError> {
    match value {
        "" => Ok(None),
        "unknown-peer" => Ok(Some(NetworkReceiptCodeV1::UnknownPeer)),
        "connection-mismatch" => Ok(Some(NetworkReceiptCodeV1::ConnectionMismatch)),
        "peer-kind-mismatch" => Ok(Some(NetworkReceiptCodeV1::PeerKindMismatch)),
        "session-expired" => Ok(Some(NetworkReceiptCodeV1::SessionExpired)),
        "command-expired" => Ok(Some(NetworkReceiptCodeV1::CommandExpired)),
        "sequence" => Ok(Some(NetworkReceiptCodeV1::Sequence)),
        "stale-revision" => Ok(Some(NetworkReceiptCodeV1::StaleRevision)),
        "capability-denied" => Ok(Some(NetworkReceiptCodeV1::CapabilityDenied)),
        "lease-conflict" => Ok(Some(NetworkReceiptCodeV1::LeaseConflict)),
        "interest-denied" => Ok(Some(NetworkReceiptCodeV1::InterestDenied)),
        "invalid" => Ok(Some(NetworkReceiptCodeV1::Invalid)),
        _ => Err(NetworkError::new(NetworkErrorCode::InvalidEnum, "unknown receipt code")),
    }
}

const fn handshake_message(code: HandshakeDecisionCodeV1) -> &'static str {
    match code {
        HandshakeDecisionCodeV1::Ok => "Peer may join through host Rust authority.",
        HandshakeDecisionCodeV1::SchemaMismatch => "Save/network schema versions differ.",
        HandshakeDecisionCodeV1::ProtocolMismatch => "Network protocol versions differ.",
        HandshakeDecisionCodeV1::SessionMismatch => "Peers did not present the same session.",
        HandshakeDecisionCodeV1::RoleConflict => "A session requires exactly one host authority.",
        HandshakeDecisionCodeV1::EngineMismatch => "Engine versions are not compatible.",
        HandshakeDecisionCodeV1::ContentMismatch => "Authored content fingerprints differ.",
        HandshakeDecisionCodeV1::GeneratorMismatch => "World generator fingerprints differ.",
        HandshakeDecisionCodeV1::CommandBudget => "No compatible command payload budget exists.",
    }
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }
    fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn i32(&mut self, value: i32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn hash(&mut self, value: CanonicalHash) {
        self.bytes.extend_from_slice(value.as_bytes());
    }
    fn bytes(&mut self, value: &[u8]) -> Result<(), NetworkError> {
        self.u32(
            u32::try_from(value.len())
                .map_err(|_| NetworkError::new(NetworkErrorCode::Budget, "browser byte field exceeds u32"))?,
        );
        self.bytes.extend_from_slice(value);
        Ok(())
    }
    fn string(&mut self, value: &str) -> Result<(), NetworkError> {
        self.bytes(value.as_bytes())
    }
    fn identity(&mut self, value: &NetworkAuthorityIdentityV1) -> Result<(), NetworkError> {
        value.validate()?;
        self.string(&value.address.universe_id)?;
        self.string(&value.address.location_id)?;
        self.u64(value.revision.epoch);
        self.u64(value.revision.world);
        self.u64(value.revision.entities);
        self.u64(value.revision.gameplay);
        self.u64(value.revision.persistence);
        self.hash(value.state_hash);
        Ok(())
    }
    fn interest(&mut self, value: &NetworkInterestSetV1) -> Result<(), NetworkError> {
        value.validate()?;
        self.u64(value.sequence);
        self.u32(value.chunks.len() as u32);
        for chunk in &value.chunks {
            self.string(&chunk.address.universe_id)?;
            self.string(&chunk.address.location_id)?;
            self.i32(chunk.chunk_x);
            self.i32(chunk.chunk_z);
        }
        self.u32(value.entity_ids.len() as u32);
        for entity_id in &value.entity_ids {
            self.string(entity_id)?;
        }
        self.hash(value.interest_hash);
        Ok(())
    }
    fn receipt(&mut self, value: &NetworkCommandReceiptV1) -> Result<(), NetworkError> {
        self.u8(if value.status == NetworkReceiptStatusV1::Accepted {
            1
        } else {
            2
        });
        self.string(&value.command_id)?;
        self.string(&value.idempotency_key)?;
        self.string(&value.peer_id)?;
        self.string(value.code.map_or("", NetworkReceiptCodeV1::as_str))?;
        self.string(&value.message)?;
        self.identity(&value.identity)?;
        self.hash(value.receipt_hash);
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
            .ok_or_else(|| NetworkError::new(NetworkErrorCode::Truncated, "browser offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| NetworkError::new(NetworkErrorCode::Truncated, "network browser message is truncated"))?;
        self.offset = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, NetworkError> {
        Ok(self.take(1)?[0])
    }
    fn flag(&mut self) -> Result<bool, NetworkError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(NetworkError::new(
                NetworkErrorCode::WireType,
                "network browser boolean flag is not 0 or 1",
            )),
        }
    }
    fn u32(&mut self) -> Result<u32, NetworkError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }
    fn i32(&mut self) -> Result<i32, NetworkError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }
    fn u64(&mut self) -> Result<u64, NetworkError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().expect("fixed slice")))
    }
    fn hash(&mut self) -> Result<CanonicalHash, NetworkError> {
        Ok(CanonicalHash(self.take(16)?.try_into().expect("fixed slice")))
    }
    fn bytes(&mut self, maximum: usize) -> Result<Vec<u8>, NetworkError> {
        let length = self.u32()? as usize;
        if length > maximum {
            return Err(NetworkError::new(
                NetworkErrorCode::Budget,
                "browser byte field exceeds V1 budget",
            ));
        }
        Ok(self.take(length)?.to_vec())
    }
    fn string(&mut self) -> Result<String, NetworkError> {
        String::from_utf8(self.bytes(4096)?)
            .map_err(|_| NetworkError::new(NetworkErrorCode::WireType, "network browser string is not UTF-8"))
    }
    fn identity(&mut self) -> Result<NetworkAuthorityIdentityV1, NetworkError> {
        let address = crate::WorldAddressV1 {
            universe_id: self.string()?,
            location_id: self.string()?,
        };
        let revision = crate::NetworkAuthorityRevisionV1 {
            epoch: self.u64()?,
            world: self.u64()?,
            entities: self.u64()?,
            gameplay: self.u64()?,
            persistence: self.u64()?,
        };
        let expected_hash = self.hash()?;
        let identity = NetworkAuthorityIdentityV1::new(address, revision)?;
        if identity.state_hash != expected_hash {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "browser authority identity hash mismatch",
            ));
        }
        Ok(identity)
    }
    fn interest(&mut self) -> Result<NetworkInterestSetV1, NetworkError> {
        let sequence = self.u64()?;
        let chunk_count = self.u32()? as usize;
        if chunk_count > crate::NETWORK_MAX_INTEREST_CHUNKS_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::InterestSize,
                "browser interest exceeds its chunk budget",
            ));
        }
        let mut chunks = Vec::with_capacity(chunk_count);
        for _ in 0..chunk_count {
            chunks.push(NetworkInterestChunkV1 {
                address: WorldAddressV1 {
                    universe_id: self.string()?,
                    location_id: self.string()?,
                },
                chunk_x: self.i32()?,
                chunk_z: self.i32()?,
            });
        }
        let entity_count = self.u32()? as usize;
        if entity_count > crate::NETWORK_MAX_INTEREST_ENTITIES_V1 {
            return Err(NetworkError::new(
                NetworkErrorCode::InterestSize,
                "browser interest exceeds its entity budget",
            ));
        }
        let mut entity_ids = Vec::with_capacity(entity_count);
        for _ in 0..entity_count {
            entity_ids.push(self.string()?);
        }
        let expected_hash = self.hash()?;
        let interest = NetworkInterestSetV1::new(sequence, chunks, entity_ids)?;
        if interest.interest_hash != expected_hash {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "browser interest hash mismatch",
            ));
        }
        Ok(interest)
    }
    fn receipt(&mut self) -> Result<NetworkCommandReceiptV1, NetworkError> {
        let status = match self.u8()? {
            1 => NetworkReceiptStatusV1::Accepted,
            2 => NetworkReceiptStatusV1::Rejected,
            _ => {
                return Err(NetworkError::new(
                    NetworkErrorCode::InvalidEnum,
                    "unknown receipt status",
                ));
            }
        };
        Ok(NetworkCommandReceiptV1 {
            schema_version: crate::NETWORK_AUTHORITY_SCHEMA_V1,
            status,
            command_id: self.string()?,
            idempotency_key: self.string()?,
            peer_id: self.string()?,
            code: receipt_code(&self.string()?)?,
            message: self.string()?,
            identity: self.identity()?,
            receipt_hash: self.hash()?,
        })
    }
    fn finish(&self) -> Result<(), NetworkError> {
        if self.offset != self.bytes.len() {
            return Err(NetworkError::new(
                NetworkErrorCode::TrailingBytes,
                "network browser message contains trailing bytes",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        NetworkCommandSourceV1, NetworkDeltaRecordKindV1, NetworkDeltaRecordV1, NetworkDeltaSourceV1,
        canonical_network_fixture_v1,
    };

    fn high_byte_command() -> (crate::NetworkCanonicalFixtureV1, NetworkCommandV1) {
        let fixture = canonical_network_fixture_v1().unwrap();
        let source = &fixture.human_command;
        let command = NetworkCommandV1::new(NetworkCommandSourceV1 {
            session_id: source.session_id.clone(),
            command_id: source.command_id.clone(),
            idempotency_key: source.idempotency_key.clone(),
            peer_id: source.peer_id.clone(),
            connection_id: source.connection_id.clone(),
            actor_id: source.actor_id.clone(),
            peer_kind: source.peer_kind,
            kind: source.kind,
            required_capability: source.required_capability,
            sequence: source.sequence,
            expected: source.expected.clone(),
            expires_at: source.expires_at,
            lease_keys: source.lease_keys.clone(),
            payload: vec![0x00, 0x7f, 0x80, 0xff],
        })
        .unwrap();
        (fixture, command)
    }

    #[test]
    fn command_batch_fixture_is_exact_and_contains_high_bytes() {
        let (fixture, command) = high_byte_command();
        let bytes = prepare_network_command_batch_request_v1(
            0x0012_0304_0506_0708,
            &fixture.starting_identity,
            100,
            std::slice::from_ref(&command),
        )
        .unwrap();
        assert_eq!(
            decode_network_browser_request_v1(&bytes).unwrap(),
            NetworkBrowserRequestV1::CommandBatch {
                request_id: 0x0012_0304_0506_0708,
                current: fixture.starting_identity,
                now: 100,
                commands: vec![command]
            }
        );
        let expected =
            include_str!("../../../../tests/fixtures/rust-engine/r8-r9/network-browser-runtime-v1.hex").trim();
        if expected.is_empty() {
            panic!("NETWORK_FIXTURE={}", hex(&bytes));
        }
        assert_eq!(hex(&bytes), expected);
    }

    #[test]
    fn runtime_enforces_idempotency_stale_revisions_capabilities_and_interest() {
        let (fixture, command) = high_byte_command();
        let mut runtime = NetworkBrowserAuthorityRuntimeV1::new("session-r9".into()).unwrap();
        runtime.upsert_peer_grant(fixture.human_grant).unwrap();
        let request = prepare_network_command_batch_request_v1(
            1,
            &fixture.starting_identity,
            100,
            std::slice::from_ref(&command),
        )
        .unwrap();
        let first = decode_network_browser_response_v1(&runtime.process(&request).unwrap()).unwrap();
        let duplicate = decode_network_browser_response_v1(&runtime.process(&request).unwrap()).unwrap();
        let receipt = match first {
            NetworkBrowserResponseV1::CommandBatch { receipts, .. } => receipts[0].clone(),
            _ => panic!("wrong response"),
        };
        let replay = match duplicate {
            NetworkBrowserResponseV1::CommandBatch { receipts, .. } => receipts[0].clone(),
            _ => panic!("wrong response"),
        };
        assert!(receipt.accepted());
        assert_eq!(receipt, replay);

        let stale = NetworkCommandV1::new(NetworkCommandSourceV1 {
            sequence: 1,
            command_id: "cmd-stale".into(),
            idempotency_key: "idem-stale".into(),
            expected: crate::empty_network_identity_v1(fixture.starting_identity.address.clone()),
            ..source(&command)
        })
        .unwrap();
        let stale_request =
            prepare_network_command_batch_request_v1(2, &fixture.starting_identity, 100, &[stale]).unwrap();
        let stale_response = decode_network_browser_response_v1(&runtime.process(&stale_request).unwrap()).unwrap();
        match stale_response {
            NetworkBrowserResponseV1::CommandBatch { receipts, .. } => {
                assert_eq!(receipts[0].code, Some(NetworkReceiptCodeV1::StaleRevision))
            }
            _ => panic!("wrong response"),
        }
    }

    #[test]
    fn browser_agent_commands_share_network_idempotency_and_capability_authority() {
        let fixture = canonical_network_fixture_v1().unwrap();
        let mut runtime = NetworkBrowserAuthorityRuntimeV1::new("session-r9".into()).unwrap();
        runtime.upsert_peer_grant(fixture.agent_grant.clone()).unwrap();
        runtime
            .upsert_agent_grant(fixture.agent_capability_grant.clone())
            .unwrap();
        let request = prepare_network_agent_request_v1(
            31,
            &fixture.agent_command.expected,
            1_100,
            &fixture.agent_command,
            &fixture.agent_work,
        )
        .unwrap();
        let first = decode_network_browser_response_v1(&runtime.process(&request).unwrap()).unwrap();
        let duplicate = decode_network_browser_response_v1(&runtime.process(&request).unwrap()).unwrap();
        let accepted = |response: NetworkBrowserResponseV1| match response {
            NetworkBrowserResponseV1::AgentCommand { code, receipt, .. } => {
                assert_eq!(code, AgentAuthorityCodeV1::Accepted);
                receipt.expect("accepted agent receipt")
            }
            _ => panic!("wrong response"),
        };
        assert_eq!(accepted(first), accepted(duplicate));

        let mut denied = NetworkBrowserAuthorityRuntimeV1::new("session-r9".into()).unwrap();
        denied.upsert_peer_grant(fixture.agent_grant).unwrap();
        let before = denied.authority_fingerprint();
        let response = decode_network_browser_response_v1(&denied.process(&request).unwrap()).unwrap();
        match response {
            NetworkBrowserResponseV1::AgentCommand { code, receipt, .. } => {
                assert_eq!(code, AgentAuthorityCodeV1::UnknownAgent);
                assert!(receipt.is_none());
            }
            _ => panic!("wrong response"),
        }
        assert_eq!(denied.authority_fingerprint(), before);
    }

    #[test]
    fn malformed_batch_cannot_partially_advance_authority() {
        let (fixture, command) = high_byte_command();
        let mut runtime = NetworkBrowserAuthorityRuntimeV1::new("session-r9".into()).unwrap();
        runtime.upsert_peer_grant(fixture.human_grant).unwrap();
        let before = runtime.authority_fingerprint();
        let mut bytes =
            prepare_network_command_batch_request_v1(1, &fixture.starting_identity, 100, &[command]).unwrap();
        *bytes.last_mut().unwrap() ^= 0x80;
        assert!(runtime.process(&bytes).is_err());
        assert_eq!(runtime.authority_fingerprint(), before);
    }

    #[test]
    fn reconnect_delta_validation_distinguishes_keyframes_duplicates_and_gaps() {
        let fixture = canonical_network_fixture_v1().unwrap();
        let mut applied = fixture.delta.clone();
        applied.sequence = fixture.checkpoint.acknowledged_delta_sequence + 1;
        applied.keyframe = true;
        let (code, _) = validate_delta_delivery(&fixture.checkpoint, fixture.interest.interest_hash, &applied);
        assert_eq!(code, DeltaApplyCodeV1::Applied);
        let mut duplicate = fixture.delta.clone();
        duplicate.sequence = fixture.checkpoint.acknowledged_delta_sequence;
        assert_eq!(
            validate_delta_delivery(&fixture.checkpoint, fixture.interest.interest_hash, &duplicate).0,
            DeltaApplyCodeV1::Duplicate
        );
        let mut gap = fixture.delta.clone();
        gap.sequence = fixture.checkpoint.acknowledged_delta_sequence + 2;
        assert_eq!(
            validate_delta_delivery(&fixture.checkpoint, fixture.interest.interest_hash, &gap).0,
            DeltaApplyCodeV1::SequenceGap
        );
    }

    #[test]
    fn browser_runtime_owns_delta_progress_and_requires_an_initial_keyframe() {
        let fixture = canonical_network_fixture_v1().unwrap();
        let checkpoint = NetworkReconnectCheckpointV1::new(
            "session-r9".into(),
            "peer-1".into(),
            7,
            0,
            0,
            fixture.starting_identity.clone(),
            fixture.interest.interest_hash,
        )
        .unwrap();
        let keyframe = NetworkDeltaV1::new(NetworkDeltaSourceV1 {
            session_id: fixture.delta.session_id.clone(),
            delta_id: "delta:keyframe:1".into(),
            peer_id: fixture.delta.peer_id.clone(),
            keyframe: true,
            sequence: 1,
            acknowledged_command_sequence: fixture.delta.acknowledged_command_sequence,
            from: fixture.starting_identity.clone(),
            to: fixture.delta.to.clone(),
            interest_hash: fixture.interest.interest_hash,
            records: fixture.delta.records.clone(),
        })
        .unwrap();
        let mut runtime = NetworkBrowserAuthorityRuntimeV1::new("session-r9".into()).unwrap();
        let request = prepare_network_delta_delivery_request_v1(11, &checkpoint, &fixture.interest, &keyframe).unwrap();

        let applied = decode_network_browser_response_v1(&runtime.process(&request).unwrap()).unwrap();
        match applied {
            NetworkBrowserResponseV1::DeltaDelivery { code, sequence, .. } => {
                assert_eq!(code, DeltaApplyCodeV1::Applied);
                assert_eq!(sequence, 1);
            }
            _ => panic!("wrong response"),
        }
        let duplicate = decode_network_browser_response_v1(&runtime.process(&request).unwrap()).unwrap();
        match duplicate {
            NetworkBrowserResponseV1::DeltaDelivery { code, .. } => {
                assert_eq!(code, DeltaApplyCodeV1::Duplicate);
            }
            _ => panic!("wrong response"),
        }
        let durable = runtime
            .reconnect_checkpoint("session-r9", "peer-1", 7)
            .unwrap()
            .expect("receiver checkpoint");
        assert_eq!(durable.acknowledged_delta_sequence, 1);
        assert_eq!(durable.identity, keyframe.to);
    }

    #[test]
    fn browser_runtime_rebinds_interest_only_on_the_exact_next_keyframe() {
        fn deliver(
            runtime: &mut NetworkBrowserAuthorityRuntimeV1,
            request_id: u64,
            checkpoint: &NetworkReconnectCheckpointV1,
            interest: &NetworkInterestSetV1,
            delta: &NetworkDeltaV1,
        ) -> DeltaApplyCodeV1 {
            let request = prepare_network_delta_delivery_request_v1(request_id, checkpoint, interest, delta).unwrap();
            match decode_network_browser_response_v1(&runtime.process(&request).unwrap()).unwrap() {
                NetworkBrowserResponseV1::DeltaDelivery { code, .. } => code,
                _ => panic!("wrong response"),
            }
        }

        let fixture = canonical_network_fixture_v1().unwrap();
        let checkpoint = NetworkReconnectCheckpointV1::new(
            "session-r9".into(),
            "peer-1".into(),
            7,
            0,
            0,
            fixture.starting_identity.clone(),
            fixture.interest.interest_hash,
        )
        .unwrap();
        let record_a = NetworkDeltaRecordV1::new(
            NetworkDeltaRecordKindV1::World,
            "chunk:interest-a".into(),
            1,
            vec![0xa0],
        )
        .unwrap();
        let record_b = NetworkDeltaRecordV1::new(
            NetworkDeltaRecordKindV1::World,
            "chunk:interest-b".into(),
            1,
            vec![0xb0],
        )
        .unwrap();
        let initial = NetworkDeltaV1::new(NetworkDeltaSourceV1 {
            session_id: "session-r9".into(),
            delta_id: "delta:interest:initial".into(),
            peer_id: "peer-1".into(),
            keyframe: true,
            sequence: 1,
            acknowledged_command_sequence: 4,
            from: fixture.starting_identity,
            to: fixture.delta.to,
            interest_hash: fixture.interest.interest_hash,
            records: vec![record_a.clone()],
        })
        .unwrap();
        let mut runtime = NetworkBrowserAuthorityRuntimeV1::new("session-r9".into()).unwrap();
        let initial_request =
            prepare_network_delta_delivery_request_v1(40, &checkpoint, &fixture.interest, &initial).unwrap();
        let initial_response = decode_network_browser_response_v1(&runtime.process(&initial_request).unwrap()).unwrap();
        assert!(matches!(
            initial_response,
            NetworkBrowserResponseV1::DeltaDelivery {
                code: DeltaApplyCodeV1::Applied,
                sequence: 1,
                ..
            }
        ));

        let before = runtime
            .reconnect_checkpoint("session-r9", "peer-1", 7)
            .unwrap()
            .expect("initial receiver checkpoint");
        let moved_chunks = fixture
            .interest
            .chunks
            .iter()
            .cloned()
            .map(|mut chunk| {
                chunk.chunk_x += 1;
                chunk
            })
            .collect();
        let moved_interest = NetworkInterestSetV1::new(
            fixture.interest.sequence + 1,
            moved_chunks,
            fixture.interest.entity_ids.clone(),
        )
        .unwrap();
        let stale_interest = NetworkInterestSetV1::new(
            fixture.interest.sequence,
            fixture.interest.chunks.clone(),
            [
                fixture.interest.entity_ids.clone(),
                vec!["player:stale-interest".into()],
            ]
            .concat(),
        )
        .unwrap();
        let changed = |delta_id: &str, keyframe: bool, sequence: u64, acknowledged_command_sequence: u64| {
            NetworkDeltaV1::new(NetworkDeltaSourceV1 {
                session_id: "session-r9".into(),
                delta_id: delta_id.into(),
                peer_id: "peer-1".into(),
                keyframe,
                sequence,
                acknowledged_command_sequence,
                from: initial.to.clone(),
                to: initial.to.clone(),
                interest_hash: moved_interest.interest_hash,
                records: vec![record_b.clone()],
            })
            .unwrap()
        };
        assert_eq!(
            deliver(
                &mut runtime,
                41,
                &before,
                &moved_interest,
                &changed("delta:interest:ordinary", false, 2, 4)
            ),
            DeltaApplyCodeV1::InterestMismatch
        );
        let stale_transition = NetworkDeltaV1::new(NetworkDeltaSourceV1 {
            session_id: "session-r9".into(),
            delta_id: "delta:interest:non-increasing".into(),
            peer_id: "peer-1".into(),
            keyframe: true,
            sequence: 2,
            acknowledged_command_sequence: 4,
            from: initial.to.clone(),
            to: initial.to.clone(),
            interest_hash: stale_interest.interest_hash,
            records: initial.records.clone(),
        })
        .unwrap();
        assert_eq!(
            deliver(&mut runtime, 46, &before, &stale_interest, &stale_transition),
            DeltaApplyCodeV1::InterestMismatch
        );
        assert_eq!(
            deliver(
                &mut runtime,
                47,
                &before,
                &stale_interest,
                &changed("delta:interest:hash-disagreement", true, 2, 4),
            ),
            DeltaApplyCodeV1::InterestMismatch
        );
        assert_eq!(
            deliver(
                &mut runtime,
                42,
                &before,
                &moved_interest,
                &changed("delta:interest:duplicate", true, 1, 4)
            ),
            DeltaApplyCodeV1::Duplicate
        );
        assert_eq!(
            deliver(
                &mut runtime,
                43,
                &before,
                &moved_interest,
                &changed("delta:interest:gap", true, 3, 4)
            ),
            DeltaApplyCodeV1::SequenceGap
        );
        assert_eq!(
            deliver(
                &mut runtime,
                44,
                &before,
                &moved_interest,
                &changed("delta:interest:ack-regression", true, 2, 3),
            ),
            DeltaApplyCodeV1::CommandAcknowledgementRegressed
        );
        assert_eq!(
            runtime
                .reconnect_checkpoint("session-r9", "peer-1", 7)
                .unwrap()
                .expect("unchanged receiver checkpoint"),
            before
        );
        let receiver_before = runtime
            .delta_receivers
            .get(&("session-r9".into(), "peer-1".into(), 7))
            .expect("initial receiver state");
        assert_eq!(receiver_before.state().record_count(), 1);
        assert!(receiver_before.state().record(&record_a.key()).is_some());
        assert!(receiver_before.state().record(&record_b.key()).is_none());

        assert_eq!(
            deliver(
                &mut runtime,
                45,
                &before,
                &moved_interest,
                &changed("delta:interest:transition", true, 2, 4),
            ),
            DeltaApplyCodeV1::Applied
        );
        let transitioned = runtime
            .reconnect_checkpoint("session-r9", "peer-1", 7)
            .unwrap()
            .expect("transitioned receiver checkpoint");
        assert_eq!(transitioned.acknowledged_delta_sequence, 2);
        assert_eq!(transitioned.acknowledged_command_sequence, 4);
        assert_eq!(transitioned.interest_hash, moved_interest.interest_hash);
        assert_eq!(transitioned.identity, initial.to);
        let receiver_after = runtime
            .delta_receivers
            .get(&("session-r9".into(), "peer-1".into(), 7))
            .expect("transitioned receiver state");
        assert_eq!(receiver_after.state().record_count(), 1);
        assert!(receiver_after.state().record(&record_a.key()).is_none());
        assert!(receiver_after.state().record(&record_b.key()).is_some());

        let record_b_next = NetworkDeltaRecordV1::new(
            NetworkDeltaRecordKindV1::World,
            "chunk:interest-b".into(),
            2,
            vec![0xb1],
        )
        .unwrap();
        let ordinary = NetworkDeltaV1::new(NetworkDeltaSourceV1 {
            session_id: "session-r9".into(),
            delta_id: "delta:interest:ordinary-after-transition".into(),
            peer_id: "peer-1".into(),
            keyframe: false,
            sequence: 3,
            acknowledged_command_sequence: 4,
            from: initial.to.clone(),
            to: initial.to.clone(),
            interest_hash: moved_interest.interest_hash,
            records: vec![record_b_next.clone()],
        })
        .unwrap();
        assert_eq!(
            deliver(&mut runtime, 48, &transitioned, &moved_interest, &ordinary),
            DeltaApplyCodeV1::Applied
        );
        let final_checkpoint = runtime
            .reconnect_checkpoint("session-r9", "peer-1", 7)
            .unwrap()
            .expect("post-transition ordinary checkpoint");
        assert_eq!(final_checkpoint.acknowledged_delta_sequence, 3);
        let final_receiver = runtime
            .delta_receivers
            .get(&("session-r9".into(), "peer-1".into(), 7))
            .expect("post-transition ordinary receiver state");
        assert_eq!(final_receiver.state().record_count(), 1);
        assert_eq!(
            final_receiver.state().record(&record_b_next.key()),
            Some(&record_b_next)
        );
    }

    #[test]
    fn delta_delivery_fixture_is_exact_across_interest_and_high_byte_records() {
        let fixture = canonical_network_fixture_v1().unwrap();
        let checkpoint = NetworkReconnectCheckpointV1::new(
            "session-r9".into(),
            "peer-1".into(),
            7,
            0,
            0,
            fixture.starting_identity.clone(),
            fixture.interest.interest_hash,
        )
        .unwrap();
        let record = NetworkDeltaRecordV1::new(
            NetworkDeltaRecordKindV1::World,
            "chunk:0,-2".into(),
            42,
            vec![0x00, 0x7f, 0x80, 0xff],
        )
        .unwrap();
        let keyframe = NetworkDeltaV1::new(NetworkDeltaSourceV1 {
            session_id: "session-r9".into(),
            delta_id: "delta:keyframe:high-bytes".into(),
            peer_id: "peer-1".into(),
            keyframe: true,
            sequence: 1,
            acknowledged_command_sequence: 0,
            from: fixture.starting_identity,
            to: fixture.delta.to,
            interest_hash: fixture.interest.interest_hash,
            records: vec![record],
        })
        .unwrap();
        let bytes =
            prepare_network_delta_delivery_request_v1(0x0012_0304_0506_0708, &checkpoint, &fixture.interest, &keyframe)
                .unwrap();
        let expected =
            include_str!("../../../../tests/fixtures/rust-engine/r8-r9/network-delta-browser-runtime-v1.hex").trim();
        if expected == "GENERATE" {
            panic!("NETWORK_DELTA_FIXTURE={}", hex(&bytes));
        }
        assert_eq!(hex(&bytes), expected);
    }

    fn source(command: &NetworkCommandV1) -> NetworkCommandSourceV1 {
        NetworkCommandSourceV1 {
            session_id: command.session_id.clone(),
            command_id: command.command_id.clone(),
            idempotency_key: command.idempotency_key.clone(),
            peer_id: command.peer_id.clone(),
            connection_id: command.connection_id.clone(),
            actor_id: command.actor_id.clone(),
            peer_kind: command.peer_kind,
            kind: command.kind,
            required_capability: command.required_capability,
            sequence: command.sequence,
            expected: command.expected.clone(),
            expires_at: command.expires_at,
            lease_keys: command.lease_keys.clone(),
            payload: command.payload.clone(),
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
