use std::collections::BTreeMap;

use blockwild_types::{CanonicalHash, CanonicalHasher};

use crate::{
    NetworkAuthorityIdentityV1, NetworkAuthorityRevisionV1, NetworkAuthorityV1, NetworkCommandReceiptV1,
    NetworkCommandV1, NetworkDeltaRecordKindV1, NetworkDeltaRecordV1, NetworkDeltaV1, NetworkError, NetworkErrorCode,
    NetworkInterestSetV1, NetworkPeerGrantV1, NetworkReceiptStatusV1, NetworkReconnectCheckpointV1, WorldAddressV1,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplicatedStateV1 {
    pub identity: NetworkAuthorityIdentityV1,
    records: BTreeMap<String, NetworkDeltaRecordV1>,
}

impl ReplicatedStateV1 {
    #[must_use]
    pub fn new(identity: NetworkAuthorityIdentityV1) -> Self {
        Self {
            identity,
            records: BTreeMap::new(),
        }
    }

    #[must_use]
    pub fn record(&self, key: &str) -> Option<&NetworkDeltaRecordV1> {
        self.records.get(key)
    }

    #[must_use]
    pub fn record_count(&self) -> usize {
        self.records.len()
    }

    #[must_use]
    pub fn canonical_state_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild-network-replicated-state-v1");
        hasher.write_str(&self.identity.address.universe_id);
        hasher.write_str(&self.identity.address.location_id);
        hasher.write_str(&self.identity.state_hash.to_hex());
        hasher.write_u32(self.records.len() as u32);
        for (key, record) in &self.records {
            hasher.write_str(key);
            hasher.write_u64(record.revision);
            hasher.write_str(&record.payload_hash.to_hex());
            hasher.write_bytes(&record.payload);
        }
        hasher.finish()
    }

    pub fn apply_delta(&mut self, delta: &NetworkDeltaV1) -> Result<(), NetworkError> {
        delta.validate()?;
        if !delta.keyframe && delta.from != self.identity {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "delta starts from a different authority identity",
            ));
        }
        let mut next_records = if delta.keyframe {
            BTreeMap::new()
        } else {
            self.records.clone()
        };
        for record in &delta.records {
            if record.kind == NetworkDeltaRecordKindV1::Tombstone {
                next_records.retain(|_, current| current.record_id != record.record_id);
                continue;
            }
            let key = record.key();
            if next_records
                .get(&key)
                .is_some_and(|current| current.revision > record.revision)
            {
                return Err(NetworkError::new(
                    NetworkErrorCode::HashMismatch,
                    "delta contains a stale record revision",
                ));
            }
            next_records.insert(key, record.clone());
        }
        self.records = next_records;
        self.identity = delta.to.clone();
        Ok(())
    }

    pub fn apply_authoritative_records(
        &mut self,
        records: &[NetworkDeltaRecordV1],
        next_revision: NetworkAuthorityRevisionV1,
    ) -> Result<(), NetworkError> {
        if !revision_is_monotonic(self.identity.revision, next_revision) {
            return Err(NetworkError::new(
                NetworkErrorCode::InvalidInteger,
                "authoritative revision regressed",
            ));
        }
        let mut next = self.clone();
        for record in records {
            let rebuilt = NetworkDeltaRecordV1::new(
                record.kind,
                record.record_id.clone(),
                record.revision,
                record.payload.clone(),
            )?;
            if rebuilt != *record {
                return Err(NetworkError::new(
                    NetworkErrorCode::HashMismatch,
                    "authoritative record hash mismatch",
                ));
            }
            if record.kind == NetworkDeltaRecordKindV1::Tombstone {
                next.records.retain(|_, current| current.record_id != record.record_id);
            } else {
                let key = record.key();
                if next
                    .records
                    .get(&key)
                    .is_some_and(|current| current.revision > record.revision)
                {
                    return Err(NetworkError::new(
                        NetworkErrorCode::HashMismatch,
                        "authoritative record revision regressed",
                    ));
                }
                next.records.insert(key, record.clone());
            }
        }
        next.identity = NetworkAuthorityIdentityV1::new(self.identity.address.clone(), next_revision)?;
        *self = next;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeltaApplyCodeV1 {
    Applied,
    Duplicate,
    SequenceGap,
    SessionMismatch,
    PeerMismatch,
    InterestMismatch,
    StaleFrom,
    CommandAcknowledgementRegressed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeltaApplyOutcomeV1 {
    pub code: DeltaApplyCodeV1,
    pub sequence: u64,
    pub state_hash: CanonicalHash,
}

#[derive(Clone, Debug)]
pub struct DeltaReceiverV1 {
    session_id: String,
    peer_id: String,
    connection_generation: u64,
    interest: NetworkInterestSetV1,
    expected_sequence: u64,
    acknowledged_command_sequence: u64,
    state: ReplicatedStateV1,
}

impl DeltaReceiverV1 {
    pub fn new(
        session_id: String,
        peer_id: String,
        connection_generation: u64,
        interest: NetworkInterestSetV1,
        expected_sequence: u64,
        acknowledged_command_sequence: u64,
        state: ReplicatedStateV1,
    ) -> Result<Self, NetworkError> {
        interest.validate()?;
        state.identity.validate()?;
        Ok(Self {
            session_id,
            peer_id,
            connection_generation,
            interest,
            expected_sequence,
            acknowledged_command_sequence,
            state,
        })
    }

    pub fn from_checkpoint(
        checkpoint: &NetworkReconnectCheckpointV1,
        interest: NetworkInterestSetV1,
        state: ReplicatedStateV1,
    ) -> Result<Self, NetworkError> {
        checkpoint.validate()?;
        interest.validate()?;
        if checkpoint.interest_hash != interest.interest_hash || checkpoint.identity != state.identity {
            return Err(NetworkError::new(
                NetworkErrorCode::HashMismatch,
                "reconnect checkpoint does not match interest or replicated state",
            ));
        }
        let expected_sequence = checkpoint
            .acknowledged_delta_sequence
            .checked_add(1)
            .ok_or_else(|| NetworkError::new(NetworkErrorCode::InvalidInteger, "reconnect delta sequence overflow"))?;
        Self::new(
            checkpoint.session_id.clone(),
            checkpoint.peer_id.clone(),
            checkpoint.connection_generation,
            interest,
            expected_sequence,
            checkpoint.acknowledged_command_sequence,
            state,
        )
    }

    #[must_use]
    pub fn state(&self) -> &ReplicatedStateV1 {
        &self.state
    }

    pub fn apply(&mut self, delta: &NetworkDeltaV1) -> Result<DeltaApplyOutcomeV1, NetworkError> {
        delta.validate()?;
        let unchanged = |code| DeltaApplyOutcomeV1 {
            code,
            sequence: self.expected_sequence,
            state_hash: self.state.canonical_state_hash(),
        };
        if delta.session_id != self.session_id {
            return Ok(unchanged(DeltaApplyCodeV1::SessionMismatch));
        }
        if delta.peer_id != self.peer_id {
            return Ok(unchanged(DeltaApplyCodeV1::PeerMismatch));
        }
        if delta.interest_hash != self.interest.interest_hash {
            return Ok(unchanged(DeltaApplyCodeV1::InterestMismatch));
        }
        if delta.sequence < self.expected_sequence {
            return Ok(unchanged(DeltaApplyCodeV1::Duplicate));
        }
        if delta.sequence > self.expected_sequence {
            return Ok(unchanged(DeltaApplyCodeV1::SequenceGap));
        }
        if !delta.keyframe && delta.from != self.state.identity {
            return Ok(unchanged(DeltaApplyCodeV1::StaleFrom));
        }
        if delta.acknowledged_command_sequence < self.acknowledged_command_sequence {
            return Ok(unchanged(DeltaApplyCodeV1::CommandAcknowledgementRegressed));
        }
        let mut next_state = self.state.clone();
        next_state.apply_delta(delta)?;
        self.state = next_state;
        self.expected_sequence = self
            .expected_sequence
            .checked_add(1)
            .ok_or_else(|| NetworkError::new(NetworkErrorCode::InvalidInteger, "delta sequence overflow"))?;
        self.acknowledged_command_sequence = delta.acknowledged_command_sequence;
        Ok(DeltaApplyOutcomeV1 {
            code: DeltaApplyCodeV1::Applied,
            sequence: delta.sequence,
            state_hash: self.state.canonical_state_hash(),
        })
    }

    /// Apply a delta carrying the host-authorized interest window for this
    /// presentation. An interest change is admitted only by the exact next
    /// keyframe, because keyframes atomically replace the scoped replicated
    /// records. Any rejected transition leaves both the receiver cursor and
    /// its prior interest window unchanged.
    pub fn apply_with_interest(
        &mut self,
        interest: NetworkInterestSetV1,
        delta: &NetworkDeltaV1,
    ) -> Result<DeltaApplyOutcomeV1, NetworkError> {
        interest.validate()?;
        if interest.interest_hash == self.interest.interest_hash {
            return self.apply(delta);
        }
        delta.validate()?;
        let unchanged = |code| DeltaApplyOutcomeV1 {
            code,
            sequence: self.expected_sequence,
            state_hash: self.state.canonical_state_hash(),
        };
        if delta.session_id != self.session_id {
            return Ok(unchanged(DeltaApplyCodeV1::SessionMismatch));
        }
        if delta.peer_id != self.peer_id {
            return Ok(unchanged(DeltaApplyCodeV1::PeerMismatch));
        }
        if delta.interest_hash != interest.interest_hash
            || !delta.keyframe
            || interest.sequence <= self.interest.sequence
        {
            return Ok(unchanged(DeltaApplyCodeV1::InterestMismatch));
        }
        if delta.sequence < self.expected_sequence {
            return Ok(unchanged(DeltaApplyCodeV1::Duplicate));
        }
        if delta.sequence > self.expected_sequence {
            return Ok(unchanged(DeltaApplyCodeV1::SequenceGap));
        }
        if delta.acknowledged_command_sequence < self.acknowledged_command_sequence {
            return Ok(unchanged(DeltaApplyCodeV1::CommandAcknowledgementRegressed));
        }
        let mut transitioned = Self::new(
            self.session_id.clone(),
            self.peer_id.clone(),
            self.connection_generation,
            interest,
            self.expected_sequence,
            self.acknowledged_command_sequence,
            self.state.clone(),
        )?;
        let outcome = transitioned.apply(delta)?;
        if outcome.code == DeltaApplyCodeV1::Applied {
            *self = transitioned;
        }
        Ok(outcome)
    }

    pub fn reconnect_checkpoint(&self) -> Result<NetworkReconnectCheckpointV1, NetworkError> {
        NetworkReconnectCheckpointV1::new(
            self.session_id.clone(),
            self.peer_id.clone(),
            self.connection_generation,
            self.acknowledged_command_sequence,
            self.expected_sequence.saturating_sub(1),
            self.state.identity.clone(),
            self.interest.interest_hash,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkReplayStepV1 {
    pub now: u64,
    pub command: NetworkCommandV1,
    pub authoritative_records: Vec<NetworkDeltaRecordV1>,
    pub next_revision: NetworkAuthorityRevisionV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkReplayFixtureV1 {
    pub session_id: String,
    pub starting_identity: NetworkAuthorityIdentityV1,
    pub grants: Vec<NetworkPeerGrantV1>,
    pub steps: Vec<NetworkReplayStepV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkReplayResultV1 {
    pub receipts: Vec<NetworkCommandReceiptV1>,
    pub state_hashes: Vec<CanonicalHash>,
    pub final_identity: NetworkAuthorityIdentityV1,
    pub final_state_hash: CanonicalHash,
    pub replay_hash: CanonicalHash,
}

pub fn run_network_replay_v1(fixture: &NetworkReplayFixtureV1) -> Result<NetworkReplayResultV1, NetworkError> {
    fixture.starting_identity.validate()?;
    let mut authority = NetworkAuthorityV1::new(fixture.session_id.clone())?;
    for grant in &fixture.grants {
        authority.upsert_grant(grant.clone())?;
    }
    let mut state = ReplicatedStateV1::new(fixture.starting_identity.clone());
    let mut receipts = Vec::with_capacity(fixture.steps.len());
    let mut state_hashes = Vec::with_capacity(fixture.steps.len());
    for step in &fixture.steps {
        let receipt = authority.authorize(&step.command, &state.identity, step.now)?;
        if receipt.status == NetworkReceiptStatusV1::Accepted {
            state.apply_authoritative_records(&step.authoritative_records, step.next_revision)?;
            authority.release_command(&step.command.command_id);
        } else if !step.authoritative_records.is_empty() || step.next_revision != state.identity.revision {
            return Err(NetworkError::new(
                NetworkErrorCode::ProtocolMismatch,
                "rejected replay command attempted to mutate state",
            ));
        }
        receipts.push(receipt);
        state_hashes.push(state.canonical_state_hash());
    }
    let final_state_hash = state.canonical_state_hash();
    let mut hasher = CanonicalHasher::new("blockwild-network-host-replay-v1");
    hasher.write_str(&fixture.session_id);
    hasher.write_str(&fixture.starting_identity.state_hash.to_hex());
    hasher.write_u32(receipts.len() as u32);
    for (receipt, state_hash) in receipts.iter().zip(&state_hashes) {
        hasher.write_str(&receipt.receipt_hash.to_hex());
        hasher.write_str(&state_hash.to_hex());
    }
    hasher.write_str(&final_state_hash.to_hex());
    Ok(NetworkReplayResultV1 {
        receipts,
        state_hashes,
        final_identity: state.identity,
        final_state_hash,
        replay_hash: hasher.finish(),
    })
}

#[must_use]
pub fn empty_network_identity_v1(address: WorldAddressV1) -> NetworkAuthorityIdentityV1 {
    NetworkAuthorityIdentityV1::new(address, NetworkAuthorityRevisionV1::default())
        .expect("valid authored fixture address")
}

const fn revision_is_monotonic(current: NetworkAuthorityRevisionV1, next: NetworkAuthorityRevisionV1) -> bool {
    next.epoch >= current.epoch
        && next.world >= current.world
        && next.entities >= current.entities
        && next.gameplay >= current.gameplay
        && next.persistence >= current.persistence
}
