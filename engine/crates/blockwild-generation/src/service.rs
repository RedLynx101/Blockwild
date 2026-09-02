use crate::contract::{
    ChunkPayloadV2, GENERATOR_VERSION, GenerateChunkRequestV2, GenerationError, PROTOCOL_VERSION,
    REQUEST_SCHEMA_VERSION,
};
use crate::generator::TerrainGeneratorV18;
use blockwild_types::CanonicalHasher;
use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

#[cfg(target_arch = "wasm32")]
#[derive(Clone, Copy)]
struct GenerationTimer;

#[cfg(not(target_arch = "wasm32"))]
type GenerationTimer = Instant;

#[cfg(target_arch = "wasm32")]
fn start_generation_timer() -> GenerationTimer {
    GenerationTimer
}

#[cfg(not(target_arch = "wasm32"))]
fn start_generation_timer() -> GenerationTimer {
    Instant::now()
}

#[cfg(target_arch = "wasm32")]
fn elapsed_generation_microseconds(_started: GenerationTimer) -> u64 {
    // `std::time::Instant::now()` deliberately panics on
    // wasm32-unknown-unknown. Browser-facing callers own wall-clock metrics;
    // the platform-neutral generation service records a bounded zero here.
    0
}

#[cfg(not(target_arch = "wasm32"))]
fn elapsed_generation_microseconds(started: GenerationTimer) -> u64 {
    started.elapsed().as_micros().min(u128::from(u64::MAX)) as u64
}

#[derive(Clone, Debug)]
pub struct CancellationToken(Arc<AtomicBool>);

impl Default for CancellationToken {
    fn default() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StaleReason {
    EpochChanged,
    RevisionChanged,
    SupersededRequest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GenerationOutcome {
    Ready {
        chunk: Box<ChunkPayloadV2>,
        cache_hit: bool,
    },
    Stale {
        reason: StaleReason,
        epoch: u32,
        revision: u32,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GenerationServiceConfig {
    pub cache_entries: usize,
    pub maximum_edits: usize,
}

impl Default for GenerationServiceConfig {
    fn default() -> Self {
        Self {
            cache_entries: 96,
            maximum_edits: 49_152,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct GenerationDiagnostics {
    pub submitted: u64,
    pub completed: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub cancelled: u64,
    pub stale: u64,
    pub failed: u64,
    pub generated_microseconds: u64,
    pub cache_entries: usize,
}

#[derive(Default)]
struct MutableDiagnostics {
    submitted: u64,
    completed: u64,
    cache_hits: u64,
    cache_misses: u64,
    cancelled: u64,
    stale: u64,
    failed: u64,
    generated_microseconds: u64,
}

struct Cache {
    entries: BTreeMap<String, ChunkPayloadV2>,
    recency: VecDeque<String>,
}

impl Cache {
    fn new() -> Self {
        Self {
            entries: BTreeMap::new(),
            recency: VecDeque::new(),
        }
    }

    fn get(&mut self, key: &str) -> Option<ChunkPayloadV2> {
        let value = self.entries.get(key)?.clone();
        self.touch(key);
        Some(value)
    }

    fn insert(&mut self, key: String, value: ChunkPayloadV2, capacity: usize) {
        if capacity == 0 {
            return;
        }
        self.entries.insert(key.clone(), value);
        self.touch(&key);
        while self.entries.len() > capacity {
            if let Some(oldest) = self.recency.pop_front() {
                self.entries.remove(&oldest);
            }
        }
    }

    fn touch(&mut self, key: &str) {
        self.recency.retain(|entry| entry != key);
        self.recency.push_back(key.into());
    }
}

pub struct GenerationService {
    config: GenerationServiceConfig,
    cache: Mutex<Cache>,
    latest_task_by_lane: Mutex<BTreeMap<(u32, String), u32>>,
    diagnostics: Mutex<MutableDiagnostics>,
}

impl GenerationService {
    #[must_use]
    pub fn new(config: GenerationServiceConfig) -> Self {
        Self {
            config,
            cache: Mutex::new(Cache::new()),
            latest_task_by_lane: Mutex::new(BTreeMap::new()),
            diagnostics: Mutex::new(MutableDiagnostics::default()),
        }
    }

    pub fn generate(
        &self,
        request: &GenerateChunkRequestV2,
        cancellation: &CancellationToken,
        current_epoch: impl Fn() -> u32,
        current_revision: impl Fn() -> Option<u32>,
    ) -> Result<GenerationOutcome, GenerationError> {
        self.diagnostics.lock().expect("diagnostics mutex poisoned").submitted += 1;
        if request.edits.len() > self.config.maximum_edits {
            return self.fail(GenerationError::InvalidRequest(
                "edit count exceeds service bound".into(),
            ));
        }
        request.validate().inspect_err(|_| {
            self.diagnostics.lock().expect("diagnostics mutex poisoned").failed += 1;
        })?;
        if cancellation.is_cancelled() {
            self.diagnostics.lock().expect("diagnostics mutex poisoned").cancelled += 1;
            return Err(GenerationError::Cancelled);
        }
        let lane = (request.epoch, request.key.clone());
        self.latest_task_by_lane
            .lock()
            .expect("lane mutex poisoned")
            .insert(lane.clone(), request.task_id);
        let key = cache_key(request);
        let cached = self.cache.lock().expect("cache mutex poisoned").get(&key);
        let cache_hit = cached.is_some();
        let started = start_generation_timer();
        let chunk = if let Some(chunk) = cached {
            self.diagnostics.lock().expect("diagnostics mutex poisoned").cache_hits += 1;
            rebind(chunk, request)
        } else {
            self.diagnostics
                .lock()
                .expect("diagnostics mutex poisoned")
                .cache_misses += 1;
            let generator = TerrainGeneratorV18::from_request(request)?;
            let generated = match generator.generate(request, || cancellation.is_cancelled()) {
                Ok(value) => value,
                Err(GenerationError::Cancelled) => {
                    self.diagnostics.lock().expect("diagnostics mutex poisoned").cancelled += 1;
                    return Err(GenerationError::Cancelled);
                }
                Err(error) => return self.fail(error),
            };
            self.cache
                .lock()
                .expect("cache mutex poisoned")
                .insert(key, generated.clone(), self.config.cache_entries);
            generated
        };
        let elapsed = elapsed_generation_microseconds(started);
        self.diagnostics
            .lock()
            .expect("diagnostics mutex poisoned")
            .generated_microseconds += elapsed;
        let stale = if current_epoch() != request.epoch {
            Some(StaleReason::EpochChanged)
        } else if current_revision() != Some(request.revision) {
            Some(StaleReason::RevisionChanged)
        } else if self.latest_task_by_lane.lock().expect("lane mutex poisoned").get(&lane) != Some(&request.task_id) {
            Some(StaleReason::SupersededRequest)
        } else {
            None
        };
        if let Some(reason) = stale {
            self.diagnostics.lock().expect("diagnostics mutex poisoned").stale += 1;
            return Ok(GenerationOutcome::Stale {
                reason,
                epoch: request.epoch,
                revision: request.revision,
            });
        }
        chunk.validate(request).inspect_err(|_| {
            self.diagnostics.lock().expect("diagnostics mutex poisoned").failed += 1;
        })?;
        self.diagnostics.lock().expect("diagnostics mutex poisoned").completed += 1;
        Ok(GenerationOutcome::Ready {
            chunk: Box::new(chunk),
            cache_hit,
        })
    }

    fn fail<T>(&self, error: GenerationError) -> Result<T, GenerationError> {
        self.diagnostics.lock().expect("diagnostics mutex poisoned").failed += 1;
        Err(error)
    }

    #[must_use]
    pub fn diagnostics(&self) -> GenerationDiagnostics {
        let diagnostics = self.diagnostics.lock().expect("diagnostics mutex poisoned");
        GenerationDiagnostics {
            submitted: diagnostics.submitted,
            completed: diagnostics.completed,
            cache_hits: diagnostics.cache_hits,
            cache_misses: diagnostics.cache_misses,
            cancelled: diagnostics.cancelled,
            stale: diagnostics.stale,
            failed: diagnostics.failed,
            generated_microseconds: diagnostics.generated_microseconds,
            cache_entries: self.cache.lock().expect("cache mutex poisoned").entries.len(),
        }
    }
}

impl Default for GenerationService {
    fn default() -> Self {
        Self::new(GenerationServiceConfig::default())
    }
}

fn cache_key(request: &GenerateChunkRequestV2) -> String {
    let mut hasher = CanonicalHasher::new("blockwild-generation-cache-v2");
    for value in [
        &request.content_hash,
        &request.generator_hash,
        &request.seed_text,
        &request.generation_options_json,
        &request.key,
    ] {
        hasher.write_str(value);
    }
    for &(index, block) in &request.edits {
        hasher.write_u32(index);
        hasher.write_u16(block);
    }
    hasher.finish().to_hex()
}

fn rebind(mut chunk: ChunkPayloadV2, request: &GenerateChunkRequestV2) -> ChunkPayloadV2 {
    chunk.epoch = request.epoch;
    chunk.task_id = request.task_id;
    chunk.revision = request.revision;
    chunk.namespace.clone_from(&request.namespace);
    chunk.content_hash.clone_from(&request.content_hash);
    chunk.generator_hash.clone_from(&request.generator_hash);
    chunk.request_hash.clone_from(&request.request_hash);
    chunk.chunk_hash = chunk.canonical_hash().to_hex();
    chunk
}

#[must_use]
pub fn fixture_request(seed: &str, cx: i32, cz: i32, task_id: u32) -> GenerateChunkRequestV2 {
    let content_hash = identity_hash("blockwild-terrain-content-v2", &["typescript-block-registry-v1"]);
    let generator_hash = identity_hash(
        "blockwild-terrain-generator-v2",
        &[&format!("generator-{GENERATOR_VERSION}")],
    );
    let mut request = GenerateChunkRequestV2 {
        protocol_version: PROTOCOL_VERSION,
        schema_version: REQUEST_SCHEMA_VERSION,
        epoch: 1,
        task_id,
        revision: task_id,
        namespace: format!("terrain-v5|g{GENERATOR_VERSION}|{seed}|{{}}|{cx},{cz}|0"),
        content_hash,
        generator_hash,
        seed_text: seed.into(),
        generation_options_json: "{}".into(),
        key: format!("{cx},{cz}"),
        cx,
        cz,
        edits: Vec::new(),
        request_hash: String::new(),
    };
    request.request_hash = request.canonical_hash().to_hex();
    request
}

fn identity_hash(domain: &str, values: &[&str]) -> String {
    let mut hasher = CanonicalHasher::new(domain);
    for value in values {
        hasher.write_str(value);
    }
    hasher.finish().to_hex()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_rebinds_authority_without_reusing_old_metadata() {
        let service = GenerationService::default();
        let first = fixture_request("cache", -4, 9, 1);
        let second = fixture_request("cache", -4, 9, 2);
        assert!(matches!(
            service
                .generate(&first, &CancellationToken::default(), || 1, || Some(1))
                .unwrap(),
            GenerationOutcome::Ready { cache_hit: false, .. }
        ));
        let outcome = service
            .generate(&second, &CancellationToken::default(), || 1, || Some(2))
            .unwrap();
        match outcome {
            GenerationOutcome::Ready { chunk, cache_hit } => {
                assert!(cache_hit);
                assert_eq!(chunk.task_id, 2);
                assert_eq!(chunk.request_hash, second.request_hash);
            }
            GenerationOutcome::Stale { .. } => panic!("unexpected stale result"),
        }
    }

    #[test]
    fn stale_and_cancelled_results_never_commit() {
        let service = GenerationService::default();
        let request = fixture_request("stale", 1, -1, 7);
        let stale = service
            .generate(&request, &CancellationToken::default(), || 2, || Some(7))
            .unwrap();
        assert!(matches!(
            stale,
            GenerationOutcome::Stale {
                reason: StaleReason::EpochChanged,
                ..
            }
        ));
        let cancellation = CancellationToken::default();
        cancellation.cancel();
        assert_eq!(
            service.generate(&request, &cancellation, || 1, || Some(7)),
            Err(GenerationError::Cancelled)
        );
    }

    #[test]
    fn oversize_and_malformed_requests_fail_closed() {
        let service = GenerationService::new(GenerationServiceConfig {
            maximum_edits: 1,
            ..Default::default()
        });
        let mut request = fixture_request("bad", 0, 0, 1);
        request.edits = vec![(0, 1), (1, 2)];
        request.request_hash = request.canonical_hash().to_hex();
        assert!(matches!(
            service.generate(&request, &CancellationToken::default(), || 1, || Some(1)),
            Err(GenerationError::InvalidRequest(_))
        ));
    }
}
