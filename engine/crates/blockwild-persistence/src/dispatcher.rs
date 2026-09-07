//! Bounded Rust-owned persistence request dispatcher.

use crate::{
    Checkpoint, DurableCommitReceiptV1, HistoricalFallbackReconciliationPlanV2, PersistenceBrowserCommitCodeV1,
    PersistenceBrowserResponseV1, PersistenceError, PersistencePlatformOperationV1, PersistencePlatformRequestV1,
    PersistencePlatformResponseV1, PersistencePlatformResultCodeV1, Transaction, decode_persistence_browser_request_v1,
    decode_persistence_browser_response_v1, decode_persistence_platform_request_v1,
    decode_persistence_platform_response_v1, encode_persistence_platform_request_v1,
    prepare_persistence_commit_request_v1,
};
use blockwild_types::{CanonicalHash, CanonicalHasher};
use std::collections::{BTreeMap, VecDeque};

pub const PERSISTENCE_DISPATCHER_SCHEMA_V1: u16 = 1;
pub const DEFAULT_DISPATCH_MAX_PENDING_V1: usize = 32;
pub const DEFAULT_DISPATCH_MAX_BYTES_V1: usize = 192 * 1024 * 1024;
pub const DEFAULT_DISPATCH_MAX_PACKET_BYTES_V1: usize = 128 * 1024 * 1024;
pub const DEFAULT_DISPATCH_MAX_COMPLETED_V1: usize = 256;
pub const DEFAULT_DISPATCH_MAX_RETRIES_V1: u8 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PersistenceDispatcherLimitsV1 {
    pub max_pending: usize,
    pub max_queued_bytes: usize,
    pub max_packet_bytes: usize,
    pub max_completed: usize,
    pub max_retries: u8,
}

impl Default for PersistenceDispatcherLimitsV1 {
    fn default() -> Self {
        Self {
            max_pending: DEFAULT_DISPATCH_MAX_PENDING_V1,
            max_queued_bytes: DEFAULT_DISPATCH_MAX_BYTES_V1,
            max_packet_bytes: DEFAULT_DISPATCH_MAX_PACKET_BYTES_V1,
            max_completed: DEFAULT_DISPATCH_MAX_COMPLETED_V1,
            max_retries: DEFAULT_DISPATCH_MAX_RETRIES_V1,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum DispatchExpectationV1 {
    Commit {
        transaction_id: String,
        journal_sequence: u64,
        checkpoint_hash: CanonicalHash,
    },
    Platform(PersistencePlatformRequestV1),
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct QueuedDispatchV1 {
    request_id: u64,
    bytes: Vec<u8>,
    expectation: DispatchExpectationV1,
    attempt: u8,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistenceDispatchPacketV1 {
    pub transfer_token: u64,
    pub request_id: u64,
    pub attempt: u8,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PersistenceDispatchRetryV1 {
    pub request_id: u64,
    /// `None` is the commit lane; platform retries retain their exact
    /// operation so the integrated runtime can bind retry custody correctly.
    pub operation: Option<PersistencePlatformOperationV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PersistenceRetryDirectiveV1 {
    None,
    RetryAfterBackoff { delay_milliseconds: u32 },
    RecoverBeforeRetry,
    CompactBeforeRetry,
    ParentFallback,
    Stop,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PersistenceDispatchStatusV1 {
    Accepted,
    Empty,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistenceDispatchOutcomeV1 {
    pub transfer_token: u64,
    pub request_id: u64,
    pub status: PersistenceDispatchStatusV1,
    pub operation: Option<PersistencePlatformOperationV1>,
    pub durable_commit: Option<DurableCommitReceiptV1>,
    pub persistence_revision: u64,
    pub storage_revision: u64,
    pub durable_hash: CanonicalHash,
    pub next_cursor: Option<u64>,
    pub payload: Vec<u8>,
    pub retry: PersistenceRetryDirectiveV1,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CompletedDispatchV1 {
    response_hash: CanonicalHash,
    outcome: PersistenceDispatchOutcomeV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistenceDispatcherV1 {
    limits: PersistenceDispatcherLimitsV1,
    next_request_id: u64,
    next_transfer_token: u64,
    persistence_revision: u64,
    queued_bytes: usize,
    queue: VecDeque<QueuedDispatchV1>,
    in_flight: BTreeMap<u64, QueuedDispatchV1>,
    retryable: BTreeMap<u64, QueuedDispatchV1>,
    completed: BTreeMap<u64, CompletedDispatchV1>,
    completed_order: VecDeque<u64>,
    closed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PersistenceDispatcherDiagnosticsV1 {
    pub persistence_revision: u64,
    pub queued: usize,
    pub in_flight: usize,
    pub retryable: usize,
    pub queued_bytes: usize,
    pub completed_receipts: usize,
    pub closed: bool,
    pub state_hash: CanonicalHash,
}

impl PersistenceDispatcherV1 {
    pub fn new(limits: PersistenceDispatcherLimitsV1) -> Result<Self, PersistenceError> {
        validate_limits(limits)?;
        Ok(Self {
            limits,
            next_request_id: 1,
            next_transfer_token: 1,
            persistence_revision: 0,
            queued_bytes: 0,
            queue: VecDeque::new(),
            in_flight: BTreeMap::new(),
            retryable: BTreeMap::new(),
            completed: BTreeMap::new(),
            completed_order: VecDeque::new(),
            closed: false,
        })
    }

    #[must_use]
    pub const fn persistence_revision(&self) -> u64 {
        self.persistence_revision
    }

    #[must_use]
    pub fn pending_count(&self) -> usize {
        self.queue.len() + self.in_flight.len() + self.retryable.len()
    }

    #[must_use]
    pub const fn queued_bytes(&self) -> usize {
        self.queued_bytes
    }

    #[must_use]
    pub fn is_idle(&self) -> bool {
        self.queue.is_empty() && self.in_flight.is_empty() && self.retryable.is_empty()
    }

    #[must_use]
    pub const fn is_closed(&self) -> bool {
        self.closed
    }

    /// Stable counters for queue/backpressure and browser-lane benchmarks.
    #[must_use]
    pub fn diagnostics(&self) -> PersistenceDispatcherDiagnosticsV1 {
        PersistenceDispatcherDiagnosticsV1 {
            persistence_revision: self.persistence_revision,
            queued: self.queue.len(),
            in_flight: self.in_flight.len(),
            retryable: self.retryable.len(),
            queued_bytes: self.queued_bytes,
            completed_receipts: self.completed.len(),
            closed: self.closed,
            state_hash: self.state_hash(),
        }
    }

    pub fn prepare_commit(
        &mut self,
        transaction: &Transaction,
        checkpoint: &Checkpoint,
    ) -> Result<u64, PersistenceError> {
        let request_id = self.allocate_request_id()?;
        let bytes = prepare_persistence_commit_request_v1(request_id, transaction, checkpoint)?;
        self.enqueue(QueuedDispatchV1 {
            request_id,
            bytes,
            expectation: DispatchExpectationV1::Commit {
                transaction_id: transaction.transaction_id.clone(),
                journal_sequence: transaction.next_journal_sequence,
                checkpoint_hash: checkpoint.checkpoint_hash,
            },
            attempt: 0,
        })?;
        Ok(request_id)
    }

    pub fn recover(&mut self, world_id: &str, checkpoint_id: Option<&str>) -> Result<u64, PersistenceError> {
        let request_id = self.allocate_request_id()?;
        self.enqueue_platform(PersistencePlatformRequestV1::recover_head(
            request_id,
            world_id,
            checkpoint_id,
        )?)
    }

    pub fn read_recovery_page(
        &mut self,
        world_id: &str,
        checkpoint_id: &str,
        start_record: u64,
        max_records: u32,
        max_bytes: u32,
    ) -> Result<u64, PersistenceError> {
        let request_id = self.allocate_request_id()?;
        self.enqueue_platform(PersistencePlatformRequestV1::recovery_page(
            request_id,
            world_id,
            checkpoint_id,
            start_record,
            max_records,
            max_bytes,
        )?)
    }

    pub fn estimate(&mut self, world_id: &str) -> Result<u64, PersistenceError> {
        let request_id = self.allocate_request_id()?;
        self.enqueue_platform(PersistencePlatformRequestV1::estimate(request_id, world_id)?)
    }

    pub fn compact(
        &mut self,
        world_id: &str,
        checkpoint_id: &str,
        expected_head_hash: CanonicalHash,
        retain_parent_count: u16,
    ) -> Result<u64, PersistenceError> {
        let request_id = self.allocate_request_id()?;
        self.enqueue_platform(PersistencePlatformRequestV1::compact(
            request_id,
            world_id,
            checkpoint_id,
            expected_head_hash,
            retain_parent_count,
        )?)
    }

    pub fn delete(
        &mut self,
        world_id: &str,
        expected_head_hash: Option<CanonicalHash>,
        tombstone: CanonicalHash,
    ) -> Result<u64, PersistenceError> {
        let request_id = self.allocate_request_id()?;
        self.enqueue_platform(PersistencePlatformRequestV1::delete_world(
            request_id,
            world_id,
            expected_head_hash,
            tombstone,
        )?)
    }

    pub fn preserve_legacy_backup_chunk(
        &mut self,
        world_id: &str,
        backup_id: &str,
        offset: u64,
        total_bytes: u64,
        bytes: Vec<u8>,
    ) -> Result<u64, PersistenceError> {
        self.prepare_chunk(
            PersistencePlatformOperationV1::PreserveLegacyBackupChunk,
            world_id,
            backup_id,
            offset,
            total_bytes,
            bytes,
        )
    }

    pub fn import_chunk(
        &mut self,
        world_id: &str,
        import_id: &str,
        offset: u64,
        total_bytes: u64,
        bytes: Vec<u8>,
    ) -> Result<u64, PersistenceError> {
        self.prepare_chunk(
            PersistencePlatformOperationV1::ImportChunk,
            world_id,
            import_id,
            offset,
            total_bytes,
            bytes,
        )
    }

    pub fn export_page(
        &mut self,
        world_id: &str,
        checkpoint_id: &str,
        cursor: u64,
        max_bytes: u32,
    ) -> Result<u64, PersistenceError> {
        if max_bytes == 0 || max_bytes as usize > crate::PERSISTENCE_PLATFORM_CHUNK_BYTES_V1 {
            return Err(PersistenceError::new(
                "platform-page",
                "export page byte limit is outside its V1 bounds",
            ));
        }
        let request_id = self.allocate_request_id()?;
        let request = PersistencePlatformRequestV1::new(
            request_id,
            PersistencePlatformOperationV1::ExportPage,
            world_id,
            checkpoint_id,
            None,
            cursor,
            0,
            u64::from(max_bytes),
            Vec::new(),
        )?;
        self.enqueue_platform(request)
    }

    pub fn finalize_import(
        &mut self,
        world_id: &str,
        import_id: &str,
        archive_hash: CanonicalHash,
        total_bytes: u64,
    ) -> Result<u64, PersistenceError> {
        let request_id = self.allocate_request_id()?;
        let request = PersistencePlatformRequestV1::new(
            request_id,
            PersistencePlatformOperationV1::FinalizeImport,
            world_id,
            import_id,
            Some(archive_hash),
            0,
            0,
            total_bytes,
            Vec::new(),
        )?;
        self.enqueue_platform(request)
    }

    pub fn reconcile_historical_fallback(
        &mut self,
        plan: &HistoricalFallbackReconciliationPlanV2,
    ) -> Result<u64, PersistenceError> {
        let request_id = self.allocate_request_id()?;
        self.enqueue_platform(PersistencePlatformRequestV1::reconcile_historical_fallback(
            request_id, plan,
        )?)
    }

    pub fn poll(&mut self, max_bytes: usize) -> Result<Option<PersistenceDispatchPacketV1>, PersistenceError> {
        if max_bytes == 0 || max_bytes > self.limits.max_packet_bytes {
            return Err(PersistenceError::new(
                "dispatch-capacity",
                "poll byte bound is outside dispatcher limits",
            ));
        }
        let Some(front) = self.queue.front() else {
            if self.retryable.is_empty() {
                return Ok(None);
            }
            return Err(PersistenceError::new(
                "dispatch-retry-pending",
                "persistence dispatcher cannot report empty while Rust-approved retry work is pending",
            ));
        };
        if front.bytes.len() > max_bytes {
            return Err(PersistenceError::new(
                "dispatch-packet-too-large",
                format!("next BWPR requires {} bytes", front.bytes.len()),
            ));
        }
        let item = self.queue.pop_front().expect("front was present");
        let transfer_token = self.allocate_transfer_token()?;
        let packet = PersistenceDispatchPacketV1 {
            transfer_token,
            request_id: item.request_id,
            attempt: item.attempt,
            bytes: item.bytes.clone(),
        };
        self.in_flight.insert(transfer_token, item);
        Ok(Some(packet))
    }

    pub fn complete(
        &mut self,
        transfer_token: u64,
        response: &[u8],
    ) -> Result<PersistenceDispatchOutcomeV1, PersistenceError> {
        let response_hash = response_hash(response);
        if let Some(completed) = self.completed.get(&transfer_token) {
            if completed.response_hash == response_hash {
                return Ok(completed.outcome.clone());
            }
            return Err(PersistenceError::new(
                "dispatch-duplicate",
                "transfer token received a conflicting duplicate BWPA",
            ));
        }
        let item = self
            .in_flight
            .get(&transfer_token)
            .ok_or_else(|| {
                PersistenceError::new(
                    "dispatch-token",
                    "BWPA transfer token is unknown or no longer in flight",
                )
            })?
            .clone();
        let outcome = match &item.expectation {
            DispatchExpectationV1::Commit {
                transaction_id,
                journal_sequence,
                checkpoint_hash,
            } => self.complete_commit(
                transfer_token,
                &item,
                response,
                transaction_id,
                *journal_sequence,
                *checkpoint_hash,
            )?,
            DispatchExpectationV1::Platform(request) => {
                self.complete_platform(transfer_token, &item, response, request)?
            }
        };
        self.in_flight.remove(&transfer_token);
        self.queued_bytes = self.queued_bytes.saturating_sub(item.bytes.len());
        if outcome.retry != PersistenceRetryDirectiveV1::None && item.attempt < self.limits.max_retries {
            self.retryable.insert(item.request_id, item);
        }
        self.remember_completed(
            transfer_token,
            CompletedDispatchV1 {
                response_hash,
                outcome: outcome.clone(),
            },
        );
        Ok(outcome)
    }

    pub fn retry(&mut self, previous_request_id: u64) -> Result<PersistenceDispatchRetryV1, PersistenceError> {
        self.require_open()?;
        let mut candidate = self.clone();
        let mut item = candidate
            .retryable
            .remove(&previous_request_id)
            .ok_or_else(|| PersistenceError::new("dispatch-retry", "request has no Rust-approved retry plan"))?;
        if item.attempt >= self.limits.max_retries {
            return Err(PersistenceError::new(
                "dispatch-retry",
                "request exhausted its retry budget",
            ));
        }
        let operation = match &item.expectation {
            DispatchExpectationV1::Commit { .. } => None,
            DispatchExpectationV1::Platform(request) => Some(request.operation),
        };
        let request_id = candidate.allocate_request_id()?;
        item.attempt = item.attempt.saturating_add(1);
        item.request_id = request_id;
        match &mut item.expectation {
            DispatchExpectationV1::Commit { .. } => rewrite_request_id(&mut item.bytes, request_id)?,
            DispatchExpectationV1::Platform(request) => {
                request.request_id = request_id;
                item.bytes = encode_persistence_platform_request_v1(request)?;
            }
        }
        candidate.enqueue(item)?;
        *self = candidate;
        Ok(PersistenceDispatchRetryV1 { request_id, operation })
    }

    pub fn close(&mut self) {
        self.closed = true;
    }

    /// Encodes queue, in-flight tokens, retry decisions, and counters so a
    /// worker checkpoint can resume without reissuing an indeterminate write.
    pub fn checkpoint_state(&self) -> Result<Vec<u8>, PersistenceError> {
        let mut payload = StateWriter::default();
        payload.u64(self.limits.max_pending as u64);
        payload.u64(self.limits.max_queued_bytes as u64);
        payload.u64(self.limits.max_packet_bytes as u64);
        payload.u64(self.limits.max_completed as u64);
        payload.u8(self.limits.max_retries);
        payload.u64(self.next_request_id);
        payload.u64(self.next_transfer_token);
        payload.u64(self.persistence_revision);
        payload.u8(u8::from(self.closed));
        payload.u32(self.queue.len() as u32);
        for item in &self.queue {
            payload.item(item)?;
        }
        payload.u32(self.in_flight.len() as u32);
        for (token, item) in &self.in_flight {
            payload.u64(*token);
            payload.item(item)?;
        }
        payload.u32(self.retryable.len() as u32);
        for item in self.retryable.values() {
            payload.item(item)?;
        }
        let payload = payload.finish();
        let mut output = StateWriter::default();
        output.raw(b"BWDS");
        output.u16(PERSISTENCE_DISPATCHER_SCHEMA_V1);
        output.u64(payload.len() as u64);
        output.hash(response_hash(&payload));
        output.raw(&payload);
        Ok(output.finish())
    }

    pub fn restore_state(bytes: &[u8]) -> Result<Self, PersistenceError> {
        let mut outer = StateReader::new(bytes);
        if outer.take(4)? != b"BWDS" {
            return Err(PersistenceError::new(
                "dispatcher-state-magic",
                "dispatcher state magic mismatch",
            ));
        }
        if outer.u16()? != PERSISTENCE_DISPATCHER_SCHEMA_V1 {
            return Err(PersistenceError::new(
                "dispatcher-state-schema",
                "unsupported dispatcher state schema",
            ));
        }
        let length = usize::try_from(outer.u64()?)
            .map_err(|_| PersistenceError::new("dispatcher-state-size", "dispatcher state length exceeds usize"))?;
        let expected_hash = outer.hash()?;
        let payload = outer.take(length)?;
        outer.finish()?;
        if response_hash(payload) != expected_hash {
            return Err(PersistenceError::new(
                "dispatcher-state-checksum",
                "dispatcher state checksum mismatch",
            ));
        }
        let mut reader = StateReader::new(payload);
        let limits = PersistenceDispatcherLimitsV1 {
            max_pending: read_usize(&mut reader)?,
            max_queued_bytes: read_usize(&mut reader)?,
            max_packet_bytes: read_usize(&mut reader)?,
            max_completed: read_usize(&mut reader)?,
            max_retries: reader.u8()?,
        };
        validate_limits(limits)?;
        let next_request_id = reader.u64()?;
        let next_transfer_token = reader.u64()?;
        let persistence_revision = reader.u64()?;
        let closed = reader.flag()?;
        let queue_count = reader.count(limits.max_pending)?;
        let mut queue = VecDeque::with_capacity(queue_count);
        for _ in 0..queue_count {
            queue.push_back(reader.item(limits.max_packet_bytes)?);
        }
        let in_flight_count = reader.count(limits.max_pending)?;
        if queue_count.saturating_add(in_flight_count) > limits.max_pending {
            return Err(PersistenceError::new(
                "dispatcher-state-capacity",
                "restored pending count exceeds its bound",
            ));
        }
        let mut in_flight = BTreeMap::new();
        for _ in 0..in_flight_count {
            let token = reader.u64()?;
            if token == 0 || in_flight.insert(token, reader.item(limits.max_packet_bytes)?).is_some() {
                return Err(PersistenceError::new(
                    "dispatcher-state-token",
                    "restored dispatcher has duplicate or zero transfer token",
                ));
            }
        }
        let retryable_count = reader.count(limits.max_pending)?;
        if queue_count
            .saturating_add(in_flight_count)
            .saturating_add(retryable_count)
            > limits.max_pending
        {
            return Err(PersistenceError::new(
                "dispatcher-state-capacity",
                "restored pending count exceeds its bound",
            ));
        }
        let mut retryable = BTreeMap::new();
        for _ in 0..retryable_count {
            let item = reader.item(limits.max_packet_bytes)?;
            if retryable.insert(item.request_id, item).is_some() {
                return Err(PersistenceError::new(
                    "dispatcher-state-request",
                    "restored dispatcher has duplicate retry request ID",
                ));
            }
        }
        reader.finish()?;
        let queued_bytes = queue
            .iter()
            .chain(in_flight.values())
            .try_fold(0_usize, |total, item| {
                total
                    .checked_add(item.bytes.len())
                    .ok_or_else(|| PersistenceError::new("dispatcher-state-size", "restored queued bytes overflow"))
            })?;
        if queued_bytes > limits.max_queued_bytes {
            return Err(PersistenceError::new(
                "dispatcher-state-capacity",
                "restored queued bytes exceed their bound",
            ));
        }
        let value = Self {
            limits,
            next_request_id,
            next_transfer_token,
            persistence_revision,
            queued_bytes,
            queue,
            in_flight,
            retryable,
            completed: BTreeMap::new(),
            completed_order: VecDeque::new(),
            closed,
        };
        if value.next_request_id == 0 || value.next_transfer_token == 0 {
            return Err(PersistenceError::new(
                "dispatcher-state-id",
                "restored dispatcher ID counters are invalid",
            ));
        }
        Ok(value)
    }

    #[must_use]
    pub fn state_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild-persistence-dispatcher-state-v1");
        hasher.write_u16(PERSISTENCE_DISPATCHER_SCHEMA_V1);
        hasher.write_u64(self.next_request_id);
        hasher.write_u64(self.next_transfer_token);
        hasher.write_u64(self.persistence_revision);
        hasher.write_u16(u16::from(self.closed));
        hasher.write_u32(self.queue.len() as u32);
        for item in &self.queue {
            hash_item(&mut hasher, item);
        }
        hasher.write_u32(self.in_flight.len() as u32);
        for (token, item) in &self.in_flight {
            hasher.write_u64(*token);
            hash_item(&mut hasher, item);
        }
        hasher.write_u32(self.retryable.len() as u32);
        for item in self.retryable.values() {
            hash_item(&mut hasher, item);
        }
        hasher.finish()
    }

    fn prepare_chunk(
        &mut self,
        operation: PersistencePlatformOperationV1,
        world_id: &str,
        object_id: &str,
        offset: u64,
        total_bytes: u64,
        bytes: Vec<u8>,
    ) -> Result<u64, PersistenceError> {
        let request_id = self.allocate_request_id()?;
        self.enqueue_platform(PersistencePlatformRequestV1::chunk(
            request_id,
            operation,
            world_id,
            object_id,
            offset,
            total_bytes,
            bytes,
        )?)
    }

    fn enqueue_platform(&mut self, request: PersistencePlatformRequestV1) -> Result<u64, PersistenceError> {
        let request_id = request.request_id;
        let bytes = encode_persistence_platform_request_v1(&request)?;
        self.enqueue(QueuedDispatchV1 {
            request_id,
            bytes,
            expectation: DispatchExpectationV1::Platform(request),
            attempt: 0,
        })?;
        Ok(request_id)
    }

    fn enqueue(&mut self, item: QueuedDispatchV1) -> Result<(), PersistenceError> {
        self.require_open()?;
        if item.bytes.len() > self.limits.max_packet_bytes {
            return Err(PersistenceError::new(
                "dispatch-capacity",
                "BWPR exceeds dispatcher packet bound",
            ));
        }
        if self.pending_count() >= self.limits.max_pending {
            return Err(PersistenceError::new(
                "dispatch-backpressure",
                "persistence dispatcher pending queue is full",
            ));
        }
        let next_bytes = self
            .queued_bytes
            .checked_add(item.bytes.len())
            .ok_or_else(|| PersistenceError::new("dispatch-capacity", "dispatcher queued byte count overflow"))?;
        if next_bytes > self.limits.max_queued_bytes {
            return Err(PersistenceError::new(
                "dispatch-backpressure",
                "persistence dispatcher queued byte budget is full",
            ));
        }
        self.queued_bytes = next_bytes;
        self.queue.push_back(item);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn complete_commit(
        &mut self,
        transfer_token: u64,
        item: &QueuedDispatchV1,
        response: &[u8],
        expected_transaction_id: &str,
        expected_sequence: u64,
        expected_checkpoint_hash: CanonicalHash,
    ) -> Result<PersistenceDispatchOutcomeV1, PersistenceError> {
        let decoded = decode_persistence_browser_response_v1(response)?;
        match decoded {
            PersistenceBrowserResponseV1::Commit(value) => {
                if value.request_id != item.request_id
                    || value.transaction_id != expected_transaction_id
                    || value.checkpoint_hash != expected_checkpoint_hash
                {
                    return Err(PersistenceError::new(
                        "dispatch-response",
                        "commit BWPA does not match its Rust-issued BWPR",
                    ));
                }
                if value.code == PersistenceBrowserCommitCodeV1::Committed {
                    if value.journal_sequence != expected_sequence
                        || !value.verified_readback
                        || value.durable_hash == CanonicalHash::default()
                    {
                        return Err(PersistenceError::new(
                            "dispatch-response",
                            "accepted commit BWPA lacks an exact durable readback proof",
                        ));
                    }
                    self.persistence_revision = self.persistence_revision.saturating_add(1);
                    let receipt = DurableCommitReceiptV1 {
                        request_id: item.request_id,
                        transaction_id: value.transaction_id,
                        journal_sequence: value.journal_sequence,
                        durable_hash: value.durable_hash,
                        checkpoint_hash: value.checkpoint_hash,
                    };
                    Ok(PersistenceDispatchOutcomeV1 {
                        transfer_token,
                        request_id: item.request_id,
                        status: PersistenceDispatchStatusV1::Accepted,
                        operation: None,
                        durable_commit: Some(receipt),
                        persistence_revision: self.persistence_revision,
                        storage_revision: value.journal_sequence,
                        durable_hash: value.durable_hash,
                        next_cursor: None,
                        payload: Vec::new(),
                        retry: PersistenceRetryDirectiveV1::None,
                        code: "committed".into(),
                        message: value.message,
                    })
                } else {
                    if value.verified_readback || value.journal_sequence != expected_sequence.saturating_sub(1) {
                        return Err(PersistenceError::new(
                            "dispatch-response",
                            "rejected commit BWPA attempted to claim a durable advance",
                        ));
                    }
                    Ok(self.rejected_commit_outcome(transfer_token, item, value.code, value.message))
                }
            }
            PersistenceBrowserResponseV1::Error(value) => {
                if value.request_id != item.request_id {
                    return Err(PersistenceError::new(
                        "dispatch-response",
                        "error BWPA request ID mismatch",
                    ));
                }
                Ok(PersistenceDispatchOutcomeV1 {
                    transfer_token,
                    request_id: item.request_id,
                    status: PersistenceDispatchStatusV1::Rejected,
                    operation: None,
                    durable_commit: None,
                    persistence_revision: self.persistence_revision,
                    storage_revision: 0,
                    durable_hash: CanonicalHash::default(),
                    next_cursor: None,
                    payload: Vec::new(),
                    retry: retry_directive(
                        item.attempt,
                        self.limits.max_retries,
                        PersistenceBrowserCommitCodeV1::Unavailable,
                    ),
                    code: value.code,
                    message: value.message,
                })
            }
            PersistenceBrowserResponseV1::Recovery(_) => Err(PersistenceError::new(
                "dispatch-response",
                "commit BWPR received a recovery BWPA",
            )),
        }
    }

    fn rejected_commit_outcome(
        &self,
        transfer_token: u64,
        item: &QueuedDispatchV1,
        code: PersistenceBrowserCommitCodeV1,
        message: String,
    ) -> PersistenceDispatchOutcomeV1 {
        PersistenceDispatchOutcomeV1 {
            transfer_token,
            request_id: item.request_id,
            status: PersistenceDispatchStatusV1::Rejected,
            operation: None,
            durable_commit: None,
            persistence_revision: self.persistence_revision,
            storage_revision: 0,
            durable_hash: CanonicalHash::default(),
            next_cursor: None,
            payload: Vec::new(),
            retry: retry_directive(item.attempt, self.limits.max_retries, code),
            code: commit_code(code).into(),
            message,
        }
    }

    fn complete_platform(
        &mut self,
        transfer_token: u64,
        item: &QueuedDispatchV1,
        response: &[u8],
        request: &PersistencePlatformRequestV1,
    ) -> Result<PersistenceDispatchOutcomeV1, PersistenceError> {
        let value: PersistencePlatformResponseV1 = decode_persistence_platform_response_v1(response)?;
        value.validate_for(request)?;
        let status = match value.code {
            PersistencePlatformResultCodeV1::Accepted => PersistenceDispatchStatusV1::Accepted,
            PersistencePlatformResultCodeV1::Empty => PersistenceDispatchStatusV1::Empty,
            _ => PersistenceDispatchStatusV1::Rejected,
        };
        let durable_mutation = matches!(
            request.operation,
            PersistencePlatformOperationV1::Compact
                | PersistencePlatformOperationV1::DeleteWorld
                | PersistencePlatformOperationV1::PreserveLegacyBackupChunk
                | PersistencePlatformOperationV1::ImportChunk
                | PersistencePlatformOperationV1::FinalizeImport
                | PersistencePlatformOperationV1::ReconcileHistoricalFallback
        );
        if status == PersistenceDispatchStatusV1::Accepted && durable_mutation {
            self.persistence_revision = self.persistence_revision.saturating_add(1);
        }
        let retry = platform_retry(item.attempt, self.limits.max_retries, value.code);
        Ok(PersistenceDispatchOutcomeV1 {
            transfer_token,
            request_id: item.request_id,
            status,
            operation: Some(request.operation),
            durable_commit: None,
            persistence_revision: self.persistence_revision,
            storage_revision: value.storage_revision,
            durable_hash: value.durable_hash,
            next_cursor: value.next_cursor,
            payload: value.payload,
            retry,
            code: platform_code(value.code).into(),
            message: value.message,
        })
    }

    fn allocate_request_id(&mut self) -> Result<u64, PersistenceError> {
        self.require_open()?;
        let value = self.next_request_id;
        self.next_request_id = self
            .next_request_id
            .checked_add(1)
            .ok_or_else(|| PersistenceError::new("dispatch-id", "persistence request ID space exhausted"))?;
        Ok(value)
    }

    fn allocate_transfer_token(&mut self) -> Result<u64, PersistenceError> {
        let value = self.next_transfer_token;
        self.next_transfer_token = self
            .next_transfer_token
            .checked_add(1)
            .ok_or_else(|| PersistenceError::new("dispatch-token", "persistence transfer token space exhausted"))?;
        Ok(value)
    }

    fn remember_completed(&mut self, token: u64, value: CompletedDispatchV1) {
        self.completed.insert(token, value);
        self.completed_order.push_back(token);
        while self.completed_order.len() > self.limits.max_completed {
            if let Some(expired) = self.completed_order.pop_front() {
                self.completed.remove(&expired);
            }
        }
    }

    fn require_open(&self) -> Result<(), PersistenceError> {
        if self.closed {
            Err(PersistenceError::new(
                "dispatch-closed",
                "persistence dispatcher is closed",
            ))
        } else {
            Ok(())
        }
    }
}

fn validate_limits(limits: PersistenceDispatcherLimitsV1) -> Result<(), PersistenceError> {
    if limits.max_pending == 0
        || limits.max_queued_bytes == 0
        || limits.max_packet_bytes == 0
        || limits.max_packet_bytes > limits.max_queued_bytes
        || limits.max_completed == 0
    {
        return Err(PersistenceError::new(
            "dispatch-limits",
            "persistence dispatcher limits are invalid",
        ));
    }
    Ok(())
}

fn rewrite_request_id(bytes: &mut [u8], request_id: u64) -> Result<(), PersistenceError> {
    if bytes.len() < crate::PERSISTENCE_BROWSER_HEADER_BYTES_V1 {
        return Err(PersistenceError::new("dispatch-retry", "stored BWPR is truncated"));
    }
    bytes[8..16].copy_from_slice(&request_id.to_le_bytes());
    Ok(())
}

fn retry_directive(attempt: u8, maximum: u8, code: PersistenceBrowserCommitCodeV1) -> PersistenceRetryDirectiveV1 {
    if attempt >= maximum {
        return PersistenceRetryDirectiveV1::Stop;
    }
    match code {
        PersistenceBrowserCommitCodeV1::Committed => PersistenceRetryDirectiveV1::None,
        PersistenceBrowserCommitCodeV1::StaleSequence | PersistenceBrowserCommitCodeV1::RecordConflict => {
            PersistenceRetryDirectiveV1::RecoverBeforeRetry
        }
        PersistenceBrowserCommitCodeV1::Quota => PersistenceRetryDirectiveV1::CompactBeforeRetry,
        PersistenceBrowserCommitCodeV1::Corrupt => PersistenceRetryDirectiveV1::ParentFallback,
        PersistenceBrowserCommitCodeV1::Unavailable => PersistenceRetryDirectiveV1::RetryAfterBackoff {
            delay_milliseconds: 50_u32.saturating_mul(1_u32 << attempt.min(6)),
        },
    }
}

fn platform_retry(attempt: u8, maximum: u8, code: PersistencePlatformResultCodeV1) -> PersistenceRetryDirectiveV1 {
    if attempt >= maximum {
        return PersistenceRetryDirectiveV1::Stop;
    }
    match code {
        PersistencePlatformResultCodeV1::Accepted | PersistencePlatformResultCodeV1::Empty => {
            PersistenceRetryDirectiveV1::None
        }
        PersistencePlatformResultCodeV1::Conflict => PersistenceRetryDirectiveV1::RecoverBeforeRetry,
        PersistencePlatformResultCodeV1::Quota => PersistenceRetryDirectiveV1::CompactBeforeRetry,
        PersistencePlatformResultCodeV1::Corrupt => PersistenceRetryDirectiveV1::ParentFallback,
        PersistencePlatformResultCodeV1::Unavailable => PersistenceRetryDirectiveV1::RetryAfterBackoff {
            delay_milliseconds: 50_u32.saturating_mul(1_u32 << attempt.min(6)),
        },
    }
}

const fn commit_code(code: PersistenceBrowserCommitCodeV1) -> &'static str {
    match code {
        PersistenceBrowserCommitCodeV1::Committed => "committed",
        PersistenceBrowserCommitCodeV1::StaleSequence => "stale-sequence",
        PersistenceBrowserCommitCodeV1::RecordConflict => "record-conflict",
        PersistenceBrowserCommitCodeV1::Quota => "quota",
        PersistenceBrowserCommitCodeV1::Corrupt => "corrupt",
        PersistenceBrowserCommitCodeV1::Unavailable => "unavailable",
    }
}
const fn platform_code(code: PersistencePlatformResultCodeV1) -> &'static str {
    match code {
        PersistencePlatformResultCodeV1::Accepted => "accepted",
        PersistencePlatformResultCodeV1::Empty => "empty",
        PersistencePlatformResultCodeV1::Conflict => "conflict",
        PersistencePlatformResultCodeV1::Quota => "quota",
        PersistencePlatformResultCodeV1::Corrupt => "corrupt",
        PersistencePlatformResultCodeV1::Unavailable => "unavailable",
    }
}

fn response_hash(bytes: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-persistence-dispatch-response-v1");
    hasher.write_bytes(bytes);
    hasher.finish()
}
fn hash_item(hasher: &mut CanonicalHasher, item: &QueuedDispatchV1) {
    hasher.write_u64(item.request_id);
    hasher.write_u16(u16::from(item.attempt));
    hasher.write_bytes(&item.bytes);
}

#[derive(Default)]
struct StateWriter {
    bytes: Vec<u8>,
}

impl StateWriter {
    fn raw(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }
    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
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
    fn hash(&mut self, value: CanonicalHash) {
        self.raw(value.as_bytes());
    }
    fn bytes(&mut self, value: &[u8]) -> Result<(), PersistenceError> {
        self.u32(
            u32::try_from(value.len())
                .map_err(|_| PersistenceError::new("dispatcher-state-size", "dispatcher state field exceeds u32"))?,
        );
        self.raw(value);
        Ok(())
    }
    fn string(&mut self, value: &str) -> Result<(), PersistenceError> {
        self.bytes(value.as_bytes())
    }
    fn item(&mut self, item: &QueuedDispatchV1) -> Result<(), PersistenceError> {
        self.u64(item.request_id);
        self.u8(item.attempt);
        self.bytes(&item.bytes)?;
        match &item.expectation {
            DispatchExpectationV1::Commit {
                transaction_id,
                journal_sequence,
                checkpoint_hash,
            } => {
                self.u8(1);
                self.string(transaction_id)?;
                self.u64(*journal_sequence);
                self.hash(*checkpoint_hash);
            }
            DispatchExpectationV1::Platform(_) => self.u8(2),
        }
        Ok(())
    }
    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

struct StateReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> StateReader<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8], PersistenceError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| PersistenceError::new("dispatcher-state-overflow", "dispatcher state offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| PersistenceError::new("dispatcher-state-truncated", "dispatcher state is truncated"))?;
        self.offset = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, PersistenceError> {
        Ok(self.take(1)?[0])
    }
    fn flag(&mut self) -> Result<bool, PersistenceError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(PersistenceError::new(
                "dispatcher-state-flag",
                "dispatcher state flag is invalid",
            )),
        }
    }
    fn u16(&mut self) -> Result<u16, PersistenceError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("fixed slice")))
    }
    fn u32(&mut self) -> Result<u32, PersistenceError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }
    fn u64(&mut self) -> Result<u64, PersistenceError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().expect("fixed slice")))
    }
    fn hash(&mut self) -> Result<CanonicalHash, PersistenceError> {
        Ok(CanonicalHash(self.take(16)?.try_into().expect("fixed slice")))
    }
    fn bytes(&mut self, maximum: usize) -> Result<Vec<u8>, PersistenceError> {
        let length = self.u32()? as usize;
        if length > maximum {
            return Err(PersistenceError::new(
                "dispatcher-state-size",
                "dispatcher state field exceeds its bound",
            ));
        }
        Ok(self.take(length)?.to_vec())
    }
    fn string(&mut self) -> Result<String, PersistenceError> {
        String::from_utf8(self.bytes(4096)?)
            .map_err(|_| PersistenceError::new("dispatcher-state-utf8", "dispatcher state string is invalid UTF-8"))
    }
    fn count(&mut self, maximum: usize) -> Result<usize, PersistenceError> {
        let count = self.u32()? as usize;
        if count > maximum {
            return Err(PersistenceError::new(
                "dispatcher-state-capacity",
                "dispatcher state count exceeds its bound",
            ));
        }
        Ok(count)
    }
    fn item(&mut self, maximum_bytes: usize) -> Result<QueuedDispatchV1, PersistenceError> {
        let request_id = self.u64()?;
        let attempt = self.u8()?;
        let bytes = self.bytes(maximum_bytes)?;
        if request_id == 0
            || bytes.len() < crate::PERSISTENCE_BROWSER_HEADER_BYTES_V1
            || u64::from_le_bytes(bytes[8..16].try_into().expect("fixed slice")) != request_id
        {
            return Err(PersistenceError::new(
                "dispatcher-state-request",
                "stored BWPR request identity is invalid",
            ));
        }
        let expectation = match self.u8()? {
            1 => {
                let transaction_id = self.string()?;
                let journal_sequence = self.u64()?;
                let checkpoint_hash = self.hash()?;
                match decode_persistence_browser_request_v1(&bytes)? {
                    crate::PersistenceBrowserRequestV1::Commit {
                        transaction,
                        checkpoint,
                        ..
                    } if transaction.transaction_id == transaction_id
                        && transaction.next_journal_sequence == journal_sequence
                        && checkpoint.checkpoint_hash == checkpoint_hash => {}
                    _ => {
                        return Err(PersistenceError::new(
                            "dispatcher-state-request",
                            "stored commit BWPR disagrees with its expectation",
                        ));
                    }
                }
                DispatchExpectationV1::Commit {
                    transaction_id,
                    journal_sequence,
                    checkpoint_hash,
                }
            }
            2 => DispatchExpectationV1::Platform(decode_persistence_platform_request_v1(&bytes)?),
            _ => {
                return Err(PersistenceError::new(
                    "dispatcher-state-kind",
                    "stored dispatcher expectation kind is invalid",
                ));
            }
        };
        Ok(QueuedDispatchV1 {
            request_id,
            bytes,
            expectation,
            attempt,
        })
    }
    fn finish(&self) -> Result<(), PersistenceError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(PersistenceError::new(
                "dispatcher-state-trailing",
                "dispatcher state contains trailing bytes",
            ))
        }
    }
}

fn read_usize(reader: &mut StateReader<'_>) -> Result<usize, PersistenceError> {
    usize::try_from(reader.u64()?)
        .map_err(|_| PersistenceError::new("dispatcher-state-size", "dispatcher limit exceeds usize"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        MutationInput, PersistenceBrowserCommitResultV1, RecordAddress, RecordDescriptor, RecordKind,
        encode_persistence_browser_response_v1, encode_persistence_platform_response_v1,
    };

    fn hash(byte: u8) -> CanonicalHash {
        CanonicalHash([byte; 16])
    }
    fn commit_fixture() -> (Transaction, Checkpoint) {
        let address = RecordAddress::new("u", "surface", RecordKind::Entity, "e").unwrap();
        let transaction = Transaction::new(
            "tx",
            "world",
            "root",
            0,
            1,
            vec![MutationInput::Put {
                address: address.clone(),
                expected_record_revision: None,
                next_record_revision: 1,
                payload: vec![1],
            }],
        )
        .unwrap();
        let payload_hash = match &transaction.mutations[0] {
            crate::Mutation::Put { payload_hash, .. } => *payload_hash,
            _ => unreachable!(),
        };
        let checkpoint = Checkpoint::new(
            "cp",
            None,
            "world",
            1,
            hash(1),
            hash(2),
            1,
            vec![RecordDescriptor {
                address,
                revision: 1,
                byte_length: 1,
                payload_hash,
            }],
        )
        .unwrap();
        (transaction, checkpoint)
    }

    #[test]
    fn commit_revision_advances_once_only_after_exact_durable_bwpa() {
        let mut dispatcher = PersistenceDispatcherV1::new(PersistenceDispatcherLimitsV1::default()).unwrap();
        let (transaction, checkpoint) = commit_fixture();
        let request_id = dispatcher.prepare_commit(&transaction, &checkpoint).unwrap();
        let packet = dispatcher.poll(dispatcher.limits.max_packet_bytes).unwrap().unwrap();
        let response = encode_persistence_browser_response_v1(&PersistenceBrowserResponseV1::Commit(
            PersistenceBrowserCommitResultV1 {
                request_id,
                code: PersistenceBrowserCommitCodeV1::Committed,
                transaction_id: "tx".into(),
                journal_sequence: 1,
                durable_hash: hash(9),
                checkpoint_hash: checkpoint.checkpoint_hash,
                verified_readback: true,
                message: "ok".into(),
            },
        ))
        .unwrap();
        let first = dispatcher.complete(packet.transfer_token, &response).unwrap();
        assert_eq!(first.persistence_revision, 1);
        assert!(first.durable_commit.is_some());
        assert_eq!(dispatcher.complete(packet.transfer_token, &response).unwrap(), first);
        assert_eq!(dispatcher.persistence_revision(), 1);
        let mut conflict = response.clone();
        *conflict.last_mut().unwrap() ^= 1;
        assert_eq!(
            dispatcher.complete(packet.transfer_token, &conflict).unwrap_err().code,
            "dispatch-duplicate"
        );
    }

    #[test]
    fn quota_rejection_does_not_advance_and_uses_rust_compaction_retry_policy() {
        let mut dispatcher = PersistenceDispatcherV1::new(PersistenceDispatcherLimitsV1::default()).unwrap();
        let request_id = dispatcher.estimate("world").unwrap();
        let packet = dispatcher.poll(1024).unwrap().unwrap();
        let response = encode_persistence_platform_response_v1(&PersistencePlatformResponseV1 {
            request_id,
            operation: PersistencePlatformOperationV1::Estimate,
            code: PersistencePlatformResultCodeV1::Quota,
            storage_revision: 0,
            durable_hash: CanonicalHash::default(),
            next_cursor: None,
            payload: Vec::new(),
            message: "quota".into(),
        })
        .unwrap();
        let outcome = dispatcher.complete(packet.transfer_token, &response).unwrap();
        assert_eq!(outcome.persistence_revision, 0);
        assert_eq!(outcome.retry, PersistenceRetryDirectiveV1::CompactBeforeRetry);
        assert_eq!(dispatcher.pending_count(), 1);
        assert!(!dispatcher.is_idle());
        assert_eq!(dispatcher.poll(1024).unwrap_err().code, "dispatch-retry-pending");
        assert_eq!(
            dispatcher.retry(request_id).unwrap(),
            PersistenceDispatchRetryV1 {
                request_id: request_id + 1,
                operation: Some(PersistencePlatformOperationV1::Estimate),
            }
        );
        assert_eq!(dispatcher.pending_count(), 1);
    }

    #[test]
    fn wrong_request_response_race_leaves_request_in_flight_for_valid_completion() {
        let mut dispatcher = PersistenceDispatcherV1::new(PersistenceDispatcherLimitsV1::default()).unwrap();
        let request_id = dispatcher.estimate("world").unwrap();
        let packet = dispatcher.poll(1024).unwrap().unwrap();
        let wrong = encode_persistence_platform_response_v1(&PersistencePlatformResponseV1 {
            request_id: request_id + 1,
            operation: PersistencePlatformOperationV1::Estimate,
            code: PersistencePlatformResultCodeV1::Accepted,
            storage_revision: 0,
            durable_hash: CanonicalHash::default(),
            next_cursor: None,
            payload: Vec::new(),
            message: "wrong".into(),
        })
        .unwrap();
        assert_eq!(
            dispatcher.complete(packet.transfer_token, &wrong).unwrap_err().code,
            "platform-response"
        );
        assert_eq!(dispatcher.pending_count(), 1);
        let correct = encode_persistence_platform_response_v1(&PersistencePlatformResponseV1 {
            request_id,
            operation: PersistencePlatformOperationV1::Estimate,
            code: PersistencePlatformResultCodeV1::Accepted,
            storage_revision: 0,
            durable_hash: CanonicalHash::default(),
            next_cursor: None,
            payload: Vec::new(),
            message: "ok".into(),
        })
        .unwrap();
        assert_eq!(
            dispatcher.complete(packet.transfer_token, &correct).unwrap().status,
            PersistenceDispatchStatusV1::Accepted
        );
    }

    #[test]
    fn historical_reconciliation_acknowledgement_must_exactly_bind_the_active_repair_intent() {
        let mut dispatcher = PersistenceDispatcherV1::new(PersistenceDispatcherLimitsV1::default()).unwrap();
        let target = hash(7);
        let request = PersistencePlatformRequestV1::new(
            1,
            PersistencePlatformOperationV1::ReconcileHistoricalFallback,
            "world",
            target.to_hex(),
            Some(hash(6)),
            5,
            1,
            1,
            vec![0x42],
        )
        .unwrap();
        dispatcher.enqueue_platform(request).unwrap();
        let packet = dispatcher.poll(1024).unwrap().unwrap();

        let invalid = [
            PersistencePlatformResponseV1 {
                request_id: 1,
                operation: PersistencePlatformOperationV1::ReconcileHistoricalFallback,
                code: PersistencePlatformResultCodeV1::Accepted,
                storage_revision: 5,
                durable_hash: target,
                next_cursor: None,
                payload: Vec::new(),
                message: "stale revision".into(),
            },
            PersistencePlatformResponseV1 {
                request_id: 1,
                operation: PersistencePlatformOperationV1::ReconcileHistoricalFallback,
                code: PersistencePlatformResultCodeV1::Accepted,
                storage_revision: 6,
                durable_hash: hash(8),
                next_cursor: None,
                payload: Vec::new(),
                message: "forged target".into(),
            },
            PersistencePlatformResponseV1 {
                request_id: 1,
                operation: PersistencePlatformOperationV1::ReconcileHistoricalFallback,
                code: PersistencePlatformResultCodeV1::Accepted,
                storage_revision: 6,
                durable_hash: target,
                next_cursor: Some(1),
                payload: Vec::new(),
                message: "gapped cursor".into(),
            },
            PersistencePlatformResponseV1 {
                request_id: 1,
                operation: PersistencePlatformOperationV1::ReconcileHistoricalFallback,
                code: PersistencePlatformResultCodeV1::Accepted,
                storage_revision: 6,
                durable_hash: target,
                next_cursor: None,
                payload: vec![0x01],
                message: "partial payload".into(),
            },
            PersistencePlatformResponseV1 {
                request_id: 1,
                operation: PersistencePlatformOperationV1::ReconcileHistoricalFallback,
                code: PersistencePlatformResultCodeV1::Conflict,
                storage_revision: 0,
                durable_hash: target,
                next_cursor: None,
                payload: Vec::new(),
                message: "forged rejection attestation".into(),
            },
        ];
        for response in invalid {
            let bytes = encode_persistence_platform_response_v1(&response).unwrap();
            assert_eq!(
                dispatcher.complete(packet.transfer_token, &bytes).unwrap_err().code,
                "platform-response"
            );
            assert_eq!(
                dispatcher.pending_count(),
                1,
                "invalid acknowledgement keeps the repair intent in flight"
            );
            assert_eq!(
                dispatcher.persistence_revision(),
                0,
                "invalid acknowledgement cannot promote authority"
            );
        }

        let accepted = encode_persistence_platform_response_v1(&PersistencePlatformResponseV1 {
            request_id: 1,
            operation: PersistencePlatformOperationV1::ReconcileHistoricalFallback,
            code: PersistencePlatformResultCodeV1::Accepted,
            storage_revision: 6,
            durable_hash: target,
            next_cursor: None,
            payload: Vec::new(),
            message: "exact repair acknowledgement".into(),
        })
        .unwrap();
        let outcome = dispatcher.complete(packet.transfer_token, &accepted).unwrap();
        assert_eq!(outcome.status, PersistenceDispatchStatusV1::Accepted);
        assert_eq!(dispatcher.persistence_revision(), 1);
        assert_eq!(
            dispatcher.complete(packet.transfer_token, &accepted).unwrap(),
            outcome,
            "the exact duplicate is idempotent"
        );
    }

    #[test]
    fn forced_close_snapshot_restores_in_flight_token_without_reissuing_it() {
        let mut dispatcher = PersistenceDispatcherV1::new(PersistenceDispatcherLimitsV1::default()).unwrap();
        let request_id = dispatcher.estimate("world").unwrap();
        let packet = dispatcher.poll(1024).unwrap().unwrap();
        let snapshot = dispatcher.checkpoint_state().unwrap();
        let mut restored = PersistenceDispatcherV1::restore_state(&snapshot).unwrap();
        assert_eq!(restored.state_hash(), dispatcher.state_hash());
        assert_eq!(
            restored.poll(1024).unwrap(),
            None,
            "in-flight work is not replayed after a crash"
        );
        let response = encode_persistence_platform_response_v1(&PersistencePlatformResponseV1 {
            request_id,
            operation: PersistencePlatformOperationV1::Estimate,
            code: PersistencePlatformResultCodeV1::Accepted,
            storage_revision: 0,
            durable_hash: CanonicalHash::default(),
            next_cursor: None,
            payload: Vec::new(),
            message: "ok".into(),
        })
        .unwrap();
        assert_eq!(
            restored.complete(packet.transfer_token, &response).unwrap().status,
            PersistenceDispatchStatusV1::Accepted
        );
        assert!(restored.is_idle());
        let mut corrupt = snapshot;
        *corrupt.last_mut().unwrap() ^= 1;
        assert_eq!(
            PersistenceDispatcherV1::restore_state(&corrupt).unwrap_err().code,
            "dispatcher-state-checksum"
        );
    }
}
