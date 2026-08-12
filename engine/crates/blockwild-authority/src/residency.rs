use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use blockwild_types::{CanonicalHash, CanonicalHasher};

use crate::{
    AuthorityError, AuthorityResult, JS_MAX_SAFE_INTEGER_V1, WORLD_SECTION_COUNT_V1, WorldAuthorityRevisionV1,
    WorldChunkAddressV1, WorldSectionAddressV1, validate_hash,
};

pub const WORLD_RESIDENCY_MAX_QUEUED_V1: usize = 65_536;
pub const WORLD_RESIDENCY_MAX_ACTIVE_V1: usize = 256;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum ResidencyPriorityClassV1 {
    OccupiedSupport = 0,
    PlayerEdited = 1,
    ImmediateOpaque = 2,
    ImmediateTranslucent = 3,
    MovementForward = 4,
    VisibleMid = 5,
    Background = 6,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResidencyPurposeV1 {
    Generate,
    CacheRead,
    Light,
    Mesh,
    Retain,
}

impl ResidencyPurposeV1 {
    const fn order(self) -> u8 {
        match self {
            Self::Generate => 0,
            Self::CacheRead => 1,
            Self::Light => 2,
            Self::Mesh => 3,
            Self::Retain => 4,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResidencyRequestV1 {
    pub request_id: u64,
    pub epoch: u64,
    pub address: WorldSectionAddressV1,
    pub class: ResidencyPriorityClassV1,
    pub purpose: ResidencyPurposeV1,
    pub distance_squared: u32,
    pub direction_penalty: u16,
    pub sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct QueueKey {
    class: ResidencyPriorityClassV1,
    distance_squared: u32,
    direction_penalty: u16,
    sequence: u64,
    purpose: u8,
    address: WorldSectionAddressV1,
    request_id: u64,
}

impl From<&ResidencyRequestV1> for QueueKey {
    fn from(value: &ResidencyRequestV1) -> Self {
        Self {
            class: value.class,
            distance_squared: value.distance_squared,
            direction_penalty: value.direction_penalty,
            sequence: value.sequence,
            purpose: value.purpose.order(),
            address: value.address.clone(),
            request_id: value.request_id,
        }
    }
}

impl Ord for QueueKey {
    fn cmp(&self, other: &Self) -> Ordering {
        (
            self.class,
            self.distance_squared,
            self.direction_penalty,
            self.sequence,
            self.purpose,
            &self.address,
            self.request_id,
        )
            .cmp(&(
                other.class,
                other.distance_squared,
                other.direction_penalty,
                other.sequence,
                other.purpose,
                &other.address,
                other.request_id,
            ))
    }
}

impl PartialOrd for QueueKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResidencyJobTokenV1 {
    pub request: ResidencyRequestV1,
    pub authority_revision: WorldAuthorityRevisionV1,
    pub source_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ResidencyCompletionV1 {
    Accepted(ResidencyJobTokenV1),
    StaleEpoch,
    StaleRevision,
    Cancelled,
    UnknownJob,
}

#[derive(Clone, Debug)]
pub struct SectionResidencySchedulerV1 {
    epoch: u64,
    queue: BTreeSet<QueueKey>,
    queued: BTreeMap<u64, ResidencyRequestV1>,
    active: BTreeMap<u64, ResidencyJobTokenV1>,
    cancelled: BTreeSet<u64>,
}

/// Exact, renderer-independent state required to replace a residency
/// scheduler without changing the world's canonical authority hash.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SectionResidencySnapshotV1 {
    pub epoch: u64,
    pub queued: Vec<ResidencyRequestV1>,
    pub active: Vec<ResidencyJobTokenV1>,
    pub cancelled: Vec<u64>,
}

impl SectionResidencySchedulerV1 {
    #[must_use]
    pub fn new(epoch: u64) -> Self {
        Self {
            epoch,
            queue: BTreeSet::new(),
            queued: BTreeMap::new(),
            active: BTreeMap::new(),
            cancelled: BTreeSet::new(),
        }
    }

    pub fn submit(&mut self, request: ResidencyRequestV1) -> AuthorityResult<()> {
        if request.epoch != self.epoch {
            return Err(AuthorityError::new(
                "stale-epoch",
                "residency request belongs to an obsolete epoch",
            ));
        }
        if request.request_id == 0 || request.sequence == 0 {
            return Err(AuthorityError::new(
                "invalid-residency-request",
                "request id and sequence must be positive",
            ));
        }
        if self.queued.contains_key(&request.request_id)
            || self.active.contains_key(&request.request_id)
            || self.cancelled.contains(&request.request_id)
        {
            return Err(AuthorityError::new(
                "duplicate-request",
                "residency request id already exists",
            ));
        }
        if self.queue.len() >= WORLD_RESIDENCY_MAX_QUEUED_V1 {
            return Err(AuthorityError::new("residency-capacity", "residency queue is full"));
        }
        self.queue.insert(QueueKey::from(&request));
        self.queued.insert(request.request_id, request);
        Ok(())
    }

    pub fn cancel(&mut self, request_id: u64) -> bool {
        if let Some(request) = self.queued.remove(&request_id) {
            self.queue.remove(&QueueKey::from(&request));
            // Queued work was never issued, so there can be no completion to
            // reject. Retaining a tombstone here would leak one canonical
            // scheduler entry for every cancelled queued request.
            self.cancelled.remove(&request_id);
            return true;
        }
        if self.active.contains_key(&request_id) {
            self.cancelled.insert(request_id);
            return true;
        }
        false
    }

    pub fn cancel_section(&mut self, address: &WorldSectionAddressV1) -> usize {
        let ids = self
            .queued
            .values()
            .chain(self.active.values().map(|token| &token.request))
            .filter(|request| &request.address == address)
            .map(|request| request.request_id)
            .collect::<Vec<_>>();
        let count = ids.len();
        for id in ids {
            self.cancel(id);
        }
        count
    }

    /// Removes every queued or active job for one chunk. Unlike `cancel`, this
    /// is terminal scheduler cleanup: an already-issued completion becomes an
    /// unknown job and cannot install, while no cancellation tombstone remains
    /// in the canonical scheduler state.
    pub fn remove_chunk(&mut self, address: &WorldChunkAddressV1) -> usize {
        let queued_ids = self
            .queued
            .values()
            .filter(|request| request.address.chunk() == *address)
            .map(|request| request.request_id)
            .collect::<Vec<_>>();
        let active_ids = self
            .active
            .values()
            .filter(|token| token.request.address.chunk() == *address)
            .map(|token| token.request.request_id)
            .collect::<Vec<_>>();
        let count = queued_ids.len().saturating_add(active_ids.len());
        for request_id in queued_ids {
            if let Some(request) = self.queued.remove(&request_id) {
                self.queue.remove(&QueueKey::from(&request));
            }
            self.cancelled.remove(&request_id);
        }
        for request_id in active_ids {
            self.active.remove(&request_id);
            self.cancelled.remove(&request_id);
        }
        let active_ids = self.active.keys().copied().collect::<BTreeSet<_>>();
        self.cancelled.retain(|request_id| active_ids.contains(request_id));
        count
    }

    pub(crate) fn job_addresses(&self) -> impl Iterator<Item = &WorldSectionAddressV1> {
        self.queued
            .values()
            .map(|request| &request.address)
            .chain(self.active.values().map(|token| &token.request.address))
    }

    pub(crate) fn has_orphaned_cancelled_jobs(&self) -> bool {
        self.cancelled
            .iter()
            .any(|request_id| !self.active.contains_key(request_id))
    }

    pub fn start_next(
        &mut self,
        authority_revision: WorldAuthorityRevisionV1,
        source_hash: String,
    ) -> AuthorityResult<Option<ResidencyJobTokenV1>> {
        validate_hash(&source_hash, "sourceHash")?;
        if self.active.len() >= WORLD_RESIDENCY_MAX_ACTIVE_V1 {
            return Ok(None);
        }
        let Some(key) = self.queue.pop_first() else {
            return Ok(None);
        };
        let request = self
            .queued
            .remove(&key.request_id)
            .ok_or_else(|| AuthorityError::new("residency-invariant", "queued request was missing"))?;
        if self.cancelled.remove(&request.request_id) {
            return self.start_next(authority_revision, source_hash);
        }
        let token = ResidencyJobTokenV1 {
            request,
            authority_revision,
            source_hash,
        };
        self.active.insert(token.request.request_id, token.clone());
        Ok(Some(token))
    }

    #[must_use]
    pub fn finish(
        &mut self,
        token: &ResidencyJobTokenV1,
        current_revision: WorldAuthorityRevisionV1,
    ) -> ResidencyCompletionV1 {
        let Some(active) = self.active.remove(&token.request.request_id) else {
            return ResidencyCompletionV1::UnknownJob;
        };
        if self.cancelled.remove(&token.request.request_id) {
            return ResidencyCompletionV1::Cancelled;
        }
        if active != *token {
            return ResidencyCompletionV1::UnknownJob;
        }
        if token.request.epoch != self.epoch || current_revision.epoch != self.epoch {
            return ResidencyCompletionV1::StaleEpoch;
        }
        if token.authority_revision != current_revision {
            return ResidencyCompletionV1::StaleRevision;
        }
        ResidencyCompletionV1::Accepted(token.clone())
    }

    pub fn reset(&mut self, epoch: u64) {
        self.epoch = epoch;
        self.queue.clear();
        self.queued.clear();
        self.active.clear();
        self.cancelled.clear();
    }

    #[must_use]
    pub fn exact_snapshot(&self) -> SectionResidencySnapshotV1 {
        SectionResidencySnapshotV1 {
            epoch: self.epoch,
            queued: self.queued.values().cloned().collect(),
            active: self.active.values().cloned().collect(),
            cancelled: self.cancelled.iter().copied().collect(),
        }
    }

    /// Reconstructs all deterministic queue ordering from the authoritative
    /// request records. Validation occurs before any scheduler is returned.
    pub fn from_exact_snapshot(snapshot: SectionResidencySnapshotV1) -> AuthorityResult<Self> {
        if snapshot.epoch == 0 || snapshot.epoch > JS_MAX_SAFE_INTEGER_V1 {
            return Err(AuthorityError::new(
                "residency-snapshot-epoch",
                "residency snapshot epoch is outside the supported range",
            ));
        }
        if snapshot.queued.len() > WORLD_RESIDENCY_MAX_QUEUED_V1
            || snapshot.active.len() > WORLD_RESIDENCY_MAX_ACTIVE_V1
            || snapshot.cancelled.len() > WORLD_RESIDENCY_MAX_QUEUED_V1 * 4
        {
            return Err(AuthorityError::new(
                "residency-snapshot-capacity",
                "residency snapshot exceeds bounded scheduler capacity",
            ));
        }
        let mut queue = BTreeSet::new();
        let mut queued = BTreeMap::new();
        let mut active = BTreeMap::new();
        for request in snapshot.queued {
            validate_snapshot_request(&request, snapshot.epoch)?;
            let key = QueueKey::from(&request);
            if !queue.insert(key) || queued.insert(request.request_id, request).is_some() {
                return Err(AuthorityError::new(
                    "residency-snapshot-duplicate",
                    "residency snapshot repeats a queued request",
                ));
            }
        }
        for token in snapshot.active {
            validate_snapshot_request(&token.request, snapshot.epoch)?;
            token.authority_revision.validate()?;
            validate_hash(&token.source_hash, "sourceHash")?;
            if queued.contains_key(&token.request.request_id)
                || active.insert(token.request.request_id, token).is_some()
            {
                return Err(AuthorityError::new(
                    "residency-snapshot-duplicate",
                    "residency snapshot repeats an active request id",
                ));
            }
        }
        let mut cancelled = BTreeSet::new();
        for request_id in snapshot.cancelled {
            if request_id == 0 || !cancelled.insert(request_id) || queued.contains_key(&request_id) {
                return Err(AuthorityError::new(
                    "residency-snapshot-cancelled",
                    "residency snapshot has an invalid cancelled request id",
                ));
            }
        }
        Ok(Self {
            epoch: snapshot.epoch,
            queue,
            queued,
            active,
            cancelled,
        })
    }

    #[must_use]
    pub fn queued_len(&self) -> usize {
        self.queued.len()
    }

    #[must_use]
    pub fn active_len(&self) -> usize {
        self.active.len()
    }

    #[must_use]
    pub fn canonical_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild-world-residency-scheduler-v1");
        hasher.write_u64(self.epoch);
        hasher.write_u32(self.queued.len() as u32);
        for request in self.queued.values() {
            write_request_hash(&mut hasher, request);
        }
        hasher.write_u32(self.active.len() as u32);
        for token in self.active.values() {
            write_request_hash(&mut hasher, &token.request);
            hasher.write_u64(token.authority_revision.epoch);
            hasher.write_u64(token.authority_revision.mutation);
            hasher.write_u64(token.authority_revision.residency);
            hasher.write_str(&token.source_hash);
        }
        hasher.write_u32(self.cancelled.len() as u32);
        for request_id in &self.cancelled {
            hasher.write_u64(*request_id);
        }
        hasher.finish()
    }
}

fn validate_snapshot_request(request: &ResidencyRequestV1, epoch: u64) -> AuthorityResult<()> {
    request.address.world.validate()?;
    if request.request_id == 0
        || request.sequence == 0
        || request.epoch != epoch
        || !(0..WORLD_SECTION_COUNT_V1 as i16).contains(&request.address.section_y)
    {
        return Err(AuthorityError::new(
            "residency-snapshot-request",
            "residency snapshot contains an invalid request",
        ));
    }
    Ok(())
}

fn write_request_hash(hasher: &mut CanonicalHasher, request: &ResidencyRequestV1) {
    hasher.write_u64(request.request_id);
    hasher.write_u64(request.epoch);
    hasher.write_str(&request.address.key());
    hasher.write_u16(request.class as u16);
    hasher.write_u16(u16::from(request.purpose.order()));
    hasher.write_u32(request.distance_squared);
    hasher.write_u16(request.direction_penalty);
    hasher.write_u64(request.sequence);
}
