//! Deterministic shadow engine used by R0/R1 worker and replay laboratories.

pub mod legacy_world_continuation;
mod runtime;
mod runtime_domain_schema_generated;
mod runtime_domain_wire;
mod runtime_player_final_bind_wire;
mod world_view_runtime;

pub use runtime::*;
pub use runtime_domain_schema_generated::*;
pub use runtime_domain_wire::*;
pub use runtime_player_final_bind_wire::*;
pub use world_view_runtime::*;

use std::collections::BTreeMap;

use blockwild_protocol::{Envelope, MessageKind, PROTOCOL_VERSION, ProtocolError, ProtocolErrorCode};
use blockwild_types::{CanonicalHash, CanonicalHasher, fnv1a_utf16, seed_stream};

pub const ENGINE_VERSION: u32 = 1;
const FIXED_STEP_US: u64 = 50_000;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EngineConfig {
    pub world_seed: String,
    pub content_hash: CanonicalHash,
    pub generator_hash: CanonicalHash,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            world_seed: "blockwild-rust-shadow".into(),
            content_hash: CanonicalHash::default(),
            generator_hash: CanonicalHash::default(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct StepSummary {
    pub tick: u64,
    pub steps: u32,
    pub commands_applied: u32,
    pub state_hash: CanonicalHash,
}

#[derive(Clone, Debug)]
pub struct Engine {
    config: EngineConfig,
    tick: u64,
    last_monotonic_time_us: u64,
    accumulator_us: u64,
    rng_state: u32,
    domains: BTreeMap<String, Vec<u8>>,
    locations: BTreeMap<u64, CanonicalHash>,
    pending_commands: Vec<Vec<u8>>,
    events: Vec<Envelope>,
    stopped: bool,
}

impl Engine {
    #[must_use]
    pub fn new(config: EngineConfig) -> Self {
        let rng_state = seed_stream(&config.world_seed, "engine");
        Self {
            config,
            tick: 0,
            last_monotonic_time_us: 0,
            accumulator_us: 0,
            rng_state,
            domains: BTreeMap::new(),
            locations: BTreeMap::new(),
            pending_commands: Vec::new(),
            events: Vec::new(),
            stopped: false,
        }
    }

    pub fn ingest(&mut self, bytes: &[u8]) -> Result<(), ProtocolError> {
        if self.stopped {
            return Err(ProtocolError::new(
                ProtocolErrorCode::EngineStopped,
                0,
                "engine is stopped",
            ));
        }
        let envelope = Envelope::decode(bytes)?;
        match envelope.header.kind {
            MessageKind::CommandBatch => self.pending_commands.push(envelope.payload),
            MessageKind::Heartbeat => self.events.push(Envelope::new(
                MessageKind::Heartbeat,
                envelope.header.request_id,
                self.tick as u32,
                envelope.header.ownership_token,
                self.tick.to_le_bytes().to_vec(),
            )),
            MessageKind::Shutdown => self.shutdown(),
            MessageKind::BufferRelease => self.events.push(Envelope::new(
                MessageKind::BufferRelease,
                envelope.header.request_id,
                self.tick as u32,
                envelope.header.ownership_token,
                Vec::new(),
            )),
            kind => {
                return Err(ProtocolError::new(
                    ProtocolErrorCode::InvalidPayload,
                    kind as u32,
                    "message kind is not accepted by engine ingest",
                ));
            }
        }
        Ok(())
    }

    pub fn step(&mut self, monotonic_time_us: u64, budget_us: u32) -> Result<StepSummary, ProtocolError> {
        if self.stopped {
            return Err(ProtocolError::new(
                ProtocolErrorCode::EngineStopped,
                0,
                "engine is stopped",
            ));
        }
        let delta = if self.last_monotonic_time_us == 0 {
            0
        } else {
            monotonic_time_us
                .saturating_sub(self.last_monotonic_time_us)
                .min(250_000)
        };
        self.last_monotonic_time_us = monotonic_time_us;
        self.accumulator_us = self.accumulator_us.saturating_add(delta);
        let max_steps = (u64::from(budget_us) / 250).clamp(1, 8) as u32;
        let due_steps = (self.accumulator_us / FIXED_STEP_US).min(u64::from(max_steps)) as u32;
        let commands = std::mem::take(&mut self.pending_commands);
        let commands_applied = commands.len() as u32;
        for command in commands {
            self.apply_command(&command);
        }
        for _ in 0..due_steps {
            self.tick = self.tick.wrapping_add(1);
            self.rng_state = xorshift32(self.rng_state);
            self.accumulator_us -= FIXED_STEP_US;
        }
        Ok(StepSummary {
            tick: self.tick,
            steps: due_steps,
            commands_applied,
            state_hash: self.state_hash(),
        })
    }

    pub fn apply_replay_frame(&mut self, tick: u64, command_batch: &[u8], platform_results: &[u8]) -> CanonicalHash {
        self.tick = tick;
        self.apply_command(command_batch);
        if !platform_results.is_empty() {
            self.domains.insert("platform".into(), platform_results.to_vec());
        }
        self.state_hash()
    }

    fn apply_command(&mut self, command: &[u8]) {
        let key = format!("command:{:08x}", fnv1a_utf16(&String::from_utf8_lossy(command)));
        self.domains.insert(key, command.to_vec());
    }

    pub fn set_domain(&mut self, name: impl Into<String>, bytes: Vec<u8>) {
        self.domains.insert(name.into(), bytes);
    }

    pub fn set_location_hash(&mut self, location_id: u64, hash: CanonicalHash) {
        self.locations.insert(location_id, hash);
    }

    #[must_use]
    pub fn domain_hashes(&self) -> BTreeMap<String, CanonicalHash> {
        self.domains
            .iter()
            .map(|(name, bytes)| {
                let mut hasher = CanonicalHasher::new(name);
                hasher.write_bytes(bytes);
                (name.clone(), hasher.finish())
            })
            .collect()
    }

    #[must_use]
    pub fn state_hash(&self) -> CanonicalHash {
        let mut root = CanonicalHasher::new("blockwild-authority-root-v1");
        root.write_u32(ENGINE_VERSION);
        root.write_u16(PROTOCOL_VERSION);
        root.write_str(&self.config.world_seed);
        root.write_bytes(self.config.content_hash.as_bytes());
        root.write_bytes(self.config.generator_hash.as_bytes());
        root.write_u64(self.tick);
        root.write_u32(self.rng_state);
        let domains = self.domain_hashes();
        root.write_u64(domains.len() as u64);
        for (name, hash) in domains {
            root.write_str(&name);
            root.write_bytes(hash.as_bytes());
        }
        root.write_u64(self.locations.len() as u64);
        for (location, hash) in &self.locations {
            root.write_u64(*location);
            root.write_bytes(hash.as_bytes());
        }
        root.finish()
    }

    pub fn take_events(&mut self) -> Vec<Envelope> {
        std::mem::take(&mut self.events)
    }

    pub fn shutdown(&mut self) {
        self.pending_commands.clear();
        self.stopped = true;
    }

    #[must_use]
    pub const fn is_stopped(&self) -> bool {
        self.stopped
    }
}

#[must_use]
pub const fn xorshift32(mut state: u32) -> u32 {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    if state == 0 { 0x6d2b_79f5 } else { state }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_hash_ignores_insertion_order() {
        let mut first = Engine::new(EngineConfig::default());
        first.set_domain("player", vec![1]);
        first.set_domain("world", vec![2]);
        first.set_location_hash(9, CanonicalHash([9; 16]));
        first.set_location_hash(3, CanonicalHash([3; 16]));
        let mut second = Engine::new(EngineConfig::default());
        second.set_domain("world", vec![2]);
        second.set_domain("player", vec![1]);
        second.set_location_hash(3, CanonicalHash([3; 16]));
        second.set_location_hash(9, CanonicalHash([9; 16]));
        assert_eq!(first.state_hash(), second.state_hash());
    }

    #[test]
    fn fixed_steps_are_bounded_and_monotonic() {
        let mut engine = Engine::new(EngineConfig::default());
        assert_eq!(engine.step(1_000_000, 1_000).unwrap().steps, 0);
        assert_eq!(engine.step(1_300_000, 1_000).unwrap().steps, 4);
        assert_eq!(engine.step(1_350_000, 10_000).unwrap().tick, 6);
    }

    #[test]
    fn heartbeat_is_batched_and_shutdown_is_terminal() {
        let mut engine = Engine::new(EngineConfig::default());
        let heartbeat = Envelope::new(MessageKind::Heartbeat, 7, 0, 42, Vec::new()).encode();
        engine.ingest(&heartbeat).unwrap();
        let events = engine.take_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].header.request_id, 7);
        let shutdown = Envelope::new(MessageKind::Shutdown, 8, 0, 42, Vec::new()).encode();
        engine.ingest(&shutdown).unwrap();
        assert!(engine.is_stopped());
        assert_eq!(
            engine.step(2_000_000, 1_000).unwrap_err().code,
            ProtocolErrorCode::EngineStopped
        );
    }
}
