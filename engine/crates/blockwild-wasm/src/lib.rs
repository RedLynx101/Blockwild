//! The only WebAssembly-facing Blockwild engine ABI.

mod integrated_runtime;
mod world_authority_r4;

pub use integrated_runtime::*;
pub use world_authority_r4::*;

use std::cell::RefCell;
use std::collections::BTreeMap;

use blockwild_engine::{Engine, EngineConfig};
use blockwild_protocol::{Envelope, MessageKind, PROTOCOL_VERSION, ProtocolError, ProtocolErrorCode, SCHEMA_VERSION};
#[cfg(feature = "renderer")]
use blockwild_render::{SceneFixture, smoke_offscreen};
use blockwild_world::{
    LightingSectionOutcomeV1, MeshSectionOutcomeV1, begin_section_lighting_v1, decode_material_registry_v1,
    decode_section_snapshot_v1, encode_lighting_result_v1, encode_mesh_packet_v1, encode_section_ineligibility_v1,
    encode_world_error_v1, mesh_opaque_section_v1,
};
use wasm_bindgen::prelude::*;

#[derive(Default)]
struct EngineStore {
    next_handle: u32,
    engines: BTreeMap<u32, Engine>,
}

impl EngineStore {
    fn insert(&mut self, engine: Engine) -> u32 {
        self.next_handle = self.next_handle.wrapping_add(1).max(1);
        while self.engines.contains_key(&self.next_handle) {
            self.next_handle = self.next_handle.wrapping_add(1).max(1);
        }
        let handle = self.next_handle;
        self.engines.insert(handle, engine);
        handle
    }
}

thread_local! {
    static ENGINES: RefCell<EngineStore> = RefCell::new(EngineStore::default());
}

#[wasm_bindgen]
#[must_use]
pub fn blockwild_protocol_version() -> u32 {
    PROTOCOL_VERSION as u32
}

#[wasm_bindgen]
#[must_use]
pub fn blockwild_schema_version() -> u32 {
    SCHEMA_VERSION as u32
}

/// Validate one complete BWRM V1 envelope against a caller-retained root and
/// return its canonical bytes. Empty output is the fail-closed result for a
/// malformed envelope, wrong root, or non-canonical encoding.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_rich_save_migration_roundtrip_v1(envelope_bytes: &[u8], expected_root: &[u8]) -> Vec<u8> {
    let Ok(expected_root) = <[u8; 16]>::try_from(expected_root) else {
        return Vec::new();
    };
    let expectation = blockwild_persistence::RichSaveMigrationEnvelopeExpectationV1 {
        envelope_root: Some(blockwild_types::CanonicalHash(expected_root)),
        ..Default::default()
    };
    let Ok(envelope) =
        blockwild_persistence::decode_rich_save_migration_envelope_v1_with_expectation(envelope_bytes, &expectation)
    else {
        return Vec::new();
    };
    blockwild_persistence::encode_rich_save_migration_envelope_v1(&envelope).unwrap_or_default()
}

/// Return the validated BWRM V1 canonical root as 16 raw bytes. Empty output
/// means validation failed; this does not persist or adopt the envelope.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_rich_save_migration_root_v1(envelope_bytes: &[u8]) -> Vec<u8> {
    blockwild_persistence::decode_rich_save_migration_envelope_v1(envelope_bytes)
        .map(|envelope| envelope.envelope_root.as_bytes().to_vec())
        .unwrap_or_default()
}

/// Generate one complete generator-v18 chunk through the coarse BWR2 packet
/// contract. Malformed or unsupported requests fail closed as an empty result;
/// the browser bridge rejects that before any authoritative installation.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_generate_chunk_v2(request: &[u8]) -> Vec<u8> {
    blockwild_generation::generate_packet_v2(request).unwrap_or_default()
}

/// Independently selects the nearest eligible settlement and its canonical
/// public arrival through the bounded Rust planner query contract.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_query_settlements_v1(request: &[u8]) -> Vec<u8> {
    blockwild_generation::query_settlements_packet_v1(request).unwrap_or_default()
}

#[wasm_bindgen]
pub fn blockwild_query_dragon_lair_v1(request: &[u8]) -> Vec<u8> {
    blockwild_generation::query_dragon_lair_packet_v1(request).unwrap_or_default()
}

/// Checked-in exact-parity certificate for the fail-closed R3 corpus.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_generation_parity_certificate_v2() -> Vec<u8> {
    blockwild_generation::parity_certificate_json_v2().into_bytes()
}

#[wasm_bindgen]
#[must_use]
pub fn blockwild_locator_parity_certificate_v1() -> Vec<u8> {
    blockwild_generation::locator_parity_certificate_json_v1().into_bytes()
}

#[wasm_bindgen]
#[must_use]
pub fn blockwild_engine_create(config_envelope: &[u8]) -> Vec<u8> {
    let request = match Envelope::decode(config_envelope) {
        Ok(value) => value,
        Err(error) => return error.into_envelope(0, 0, 0).encode(),
    };
    if request.header.kind != MessageKind::CapabilityHello {
        return ProtocolError::new(
            ProtocolErrorCode::InvalidPayload,
            request.header.kind as u32,
            "create expects CapabilityHello",
        )
        .into_envelope(
            request.header.request_id,
            request.header.epoch,
            request.header.ownership_token,
        )
        .encode();
    }
    let world_seed = String::from_utf8(request.payload).unwrap_or_else(|_| "blockwild-rust-shadow".into());
    let handle = ENGINES.with(|store| {
        store.borrow_mut().insert(Engine::new(EngineConfig {
            world_seed,
            ..EngineConfig::default()
        }))
    });
    let mut payload = Vec::with_capacity(12);
    payload.extend_from_slice(&handle.to_le_bytes());
    payload.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    payload.extend_from_slice(&SCHEMA_VERSION.to_le_bytes());
    payload.extend_from_slice(&0_u32.to_le_bytes()); // baseline transferable-buffer capability flags
    Envelope::new(
        MessageKind::CapabilityAck,
        request.header.request_id,
        request.header.epoch,
        request.header.ownership_token,
        payload,
    )
    .encode()
}

#[wasm_bindgen]
#[must_use]
pub fn blockwild_engine_ingest(handle: u32, batch: &[u8]) -> Vec<u8> {
    with_engine(handle, batch, |engine, request| {
        engine.ingest(batch)?;
        Ok(Envelope::new(
            MessageKind::CapabilityAck,
            request.header.request_id,
            request.header.epoch,
            request.header.ownership_token,
            Vec::new(),
        ))
    })
}

#[wasm_bindgen]
#[must_use]
pub fn blockwild_engine_step(handle: u32, monotonic_time_us: f64, budget_us: u32) -> Vec<u8> {
    let monotonic = if monotonic_time_us.is_finite() && monotonic_time_us >= 0.0 {
        monotonic_time_us.min(9_007_199_254_740_991.0) as u64
    } else {
        0
    };
    ENGINES.with(|store| {
        let mut store = store.borrow_mut();
        let Some(engine) = store.engines.get_mut(&handle) else {
            return invalid_handle(handle).encode();
        };
        match engine.step(monotonic, budget_us) {
            Ok(summary) => {
                let mut payload = Vec::with_capacity(32);
                payload.extend_from_slice(&summary.tick.to_le_bytes());
                payload.extend_from_slice(&summary.steps.to_le_bytes());
                payload.extend_from_slice(&summary.commands_applied.to_le_bytes());
                payload.extend_from_slice(summary.state_hash.as_bytes());
                Envelope::new(MessageKind::Events, 0, summary.tick as u32, u64::from(handle), payload).encode()
            }
            Err(error) => error.into_envelope(0, 0, u64::from(handle)).encode(),
        }
    })
}

#[wasm_bindgen]
#[must_use]
pub fn blockwild_engine_take_events(handle: u32) -> Vec<u8> {
    ENGINES.with(|store| {
        let mut store = store.borrow_mut();
        let Some(engine) = store.engines.get_mut(&handle) else {
            return invalid_handle(handle).encode();
        };
        let events = engine.take_events();
        let mut payload = Vec::new();
        payload.extend_from_slice(&(events.len() as u32).to_le_bytes());
        for event in events {
            let encoded = event.encode();
            payload.extend_from_slice(&(encoded.len() as u32).to_le_bytes());
            payload.extend_from_slice(&encoded);
        }
        Envelope::new(MessageKind::Events, 0, 0, u64::from(handle), payload).encode()
    })
}

#[wasm_bindgen]
#[must_use]
pub fn blockwild_engine_state_hash(handle: u32) -> Vec<u8> {
    ENGINES.with(|store| {
        let store = store.borrow();
        let Some(engine) = store.engines.get(&handle) else {
            return invalid_handle(handle).encode();
        };
        Envelope::new(
            MessageKind::StateHash,
            0,
            0,
            u64::from(handle),
            engine.state_hash().as_bytes().to_vec(),
        )
        .encode()
    })
}

#[wasm_bindgen]
#[must_use]
pub fn blockwild_engine_destroy(handle: u32) -> Vec<u8> {
    ENGINES.with(|store| {
        let mut store = store.borrow_mut();
        let Some(mut engine) = store.engines.remove(&handle) else {
            return invalid_handle(handle).encode();
        };
        engine.shutdown();
        Envelope::new(MessageKind::Shutdown, 0, 0, u64::from(handle), Vec::new()).encode()
    })
}

/// Validate and mesh one complete R2 section. The returned payload begins with
/// `BWM1` on success, `BWI1` when the whole section must fall back to the
/// TypeScript oracle, or `BWE1` on malformed input. This is intentionally one
/// coarse call per section, never one call per voxel.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_world_mesh_section_v1(snapshot_bytes: &[u8], registry_bytes: &[u8]) -> Vec<u8> {
    let snapshot = match decode_section_snapshot_v1(snapshot_bytes) {
        Ok(snapshot) => snapshot,
        Err(error) => return encode_world_error_v1(&error),
    };
    let registry = match decode_material_registry_v1(registry_bytes) {
        Ok(registry) => registry,
        Err(error) => return encode_world_error_v1(&error),
    };
    match mesh_opaque_section_v1(&snapshot, &registry, None) {
        Ok(MeshSectionOutcomeV1::Eligible(packet)) => encode_mesh_packet_v1(&packet),
        Ok(MeshSectionOutcomeV1::Ineligible(reason)) => encode_section_ineligibility_v1(&reason),
        Err(error) => encode_world_error_v1(&error),
    }
}

/// Rebuild packed sky/R/G/B light for one complete section. `direct_sky_above`
/// is exactly 256 nibble levels in x + 16*z order. The result uses the same
/// `BWL1`/`BWI1`/`BWE1` coarse-payload convention as meshing.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_world_light_section_v1(
    snapshot_bytes: &[u8],
    registry_bytes: &[u8],
    direct_sky_above: &[u8],
) -> Vec<u8> {
    let snapshot = match decode_section_snapshot_v1(snapshot_bytes) {
        Ok(snapshot) => snapshot,
        Err(error) => return encode_world_error_v1(&error),
    };
    let registry = match decode_material_registry_v1(registry_bytes) {
        Ok(registry) => registry,
        Err(error) => return encode_world_error_v1(&error),
    };
    let mut task = match begin_section_lighting_v1(&snapshot, &registry, direct_sky_above.to_vec()) {
        Ok(LightingSectionOutcomeV1::Eligible(task)) => task,
        Ok(LightingSectionOutcomeV1::Ineligible(reason)) => return encode_section_ineligibility_v1(&reason),
        Err(error) => return encode_world_error_v1(&error),
    };
    while !task.step(u32::MAX).complete {}
    match task.finish() {
        Ok(result) => encode_lighting_result_v1(&result),
        Err(error) => encode_world_error_v1(&error),
    }
}

/// Canonical scene bytes consumed by both the Three.js oracle and `wgpu` smoke path.
#[cfg(feature = "renderer")]
#[wasm_bindgen]
#[must_use]
pub fn blockwild_render_smoke_fixture() -> Vec<u8> {
    SceneFixture::smoke().envelope().encode()
}

/// Run the real browser-WebGPU offscreen smoke path and return capability diagnostics.
#[cfg(feature = "renderer")]
#[wasm_bindgen]
pub async fn blockwild_render_smoke() -> String {
    let diagnostic = smoke_offscreen().await;
    format!(
        "{{\"status\":\"{:?}\",\"backend\":\"{}\",\"adapter\":\"{}\",\"deviceType\":\"{}\",\"driver\":\"{}\",\"fixtureHash\":\"{}\",\"message\":\"{}\",\"maxTextureDimension2d\":{},\"maxStorageBufferBindingSize\":{}}}",
        diagnostic.status,
        json_escape(&diagnostic.backend),
        json_escape(&diagnostic.adapter_name),
        json_escape(&diagnostic.device_type),
        json_escape(&diagnostic.driver),
        diagnostic.fixture_hash.to_hex(),
        json_escape(&diagnostic.message),
        diagnostic.max_texture_dimension_2d,
        diagnostic.max_storage_buffer_binding_size,
    )
}

#[cfg(feature = "renderer")]
fn json_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                use core::fmt::Write as _;
                write!(&mut escaped, "\\u{:04x}", character as u32).expect("writing to String cannot fail");
            }
            character => escaped.push(character),
        }
    }
    escaped
}

fn with_engine(
    handle: u32,
    request_bytes: &[u8],
    operation: impl FnOnce(&mut Engine, &Envelope) -> Result<Envelope, ProtocolError>,
) -> Vec<u8> {
    let request = match Envelope::decode(request_bytes) {
        Ok(value) => value,
        Err(error) => return error.into_envelope(0, 0, u64::from(handle)).encode(),
    };
    ENGINES.with(|store| {
        let mut store = store.borrow_mut();
        let Some(engine) = store.engines.get_mut(&handle) else {
            return invalid_handle(handle).encode();
        };
        match operation(engine, &request) {
            Ok(response) => response.encode(),
            Err(error) => error
                .into_envelope(
                    request.header.request_id,
                    request.header.epoch,
                    request.header.ownership_token,
                )
                .encode(),
        }
    })
}

fn invalid_handle(handle: u32) -> Envelope {
    ProtocolError::new(ProtocolErrorCode::InvalidHandle, handle, "unknown engine handle").into_envelope(
        0,
        0,
        u64::from(handle),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use blockwild_world::{
        OpaqueCubeMaterialV1, SectionSnapshotV1, TerrainMaterialRegistryV1, TerrainMaterialV1, TerrainSectionAddressV1,
        TerrainSectionRevisionV1, TerrainSectionSnapshotStreamsV1, encode_material_registry_v1,
        encode_section_snapshot_v1, halo_cell_index_v1,
    };

    #[test]
    fn facade_negotiates_steps_hashes_and_destroys() {
        let hello = Envelope::new(MessageKind::CapabilityHello, 7, 1, 99, b"test-world".to_vec()).encode();
        let ack = Envelope::decode(&blockwild_engine_create(&hello)).unwrap();
        assert_eq!(ack.header.kind, MessageKind::CapabilityAck);
        let handle = u32::from_le_bytes(ack.payload[..4].try_into().unwrap());
        let step = Envelope::decode(&blockwild_engine_step(handle, 1_000_000.0, 1_000)).unwrap();
        assert_eq!(step.header.kind, MessageKind::Events);
        let hash = Envelope::decode(&blockwild_engine_state_hash(handle)).unwrap();
        assert_eq!(hash.payload.len(), 16);
        let destroyed = Envelope::decode(&blockwild_engine_destroy(handle)).unwrap();
        assert_eq!(destroyed.header.kind, MessageKind::Shutdown);
        let missing = Envelope::decode(&blockwild_engine_state_hash(handle)).unwrap();
        assert_eq!(missing.header.kind, MessageKind::Error);
    }

    #[test]
    fn world_facade_processes_whole_sections_and_returns_tagged_fallbacks() {
        const HASH: &str = "0123456789abcdef0123456789abcdef";
        let registry = TerrainMaterialRegistryV1 {
            content_hash: HASH.into(),
            blocks: vec![
                Some(TerrainMaterialV1::Air),
                Some(TerrainMaterialV1::OpaqueFullCube(OpaqueCubeMaterialV1 {
                    side_tile: 1,
                    top_tile: 2,
                    bottom_tile: 3,
                    emitted_light: 0,
                    emissive_strength: 0.0,
                    light_dampening: 15,
                    ambient_occlusion: true,
                })),
                Some(TerrainMaterialV1::Specialty),
            ],
            biome_tints: vec![Some([1.0; 3])],
        };
        let registry_bytes = encode_material_registry_v1(&registry);
        let snapshot = SectionSnapshotV1::create(
            HASH.into(),
            TerrainSectionAddressV1 {
                universe_id: "1".into(),
                location_id: "overworld".into(),
                chunk_x: -1,
                chunk_z: 0,
                section_y: -4,
            },
            TerrainSectionRevisionV1 {
                section: 1,
                halo: 2,
                lighting: 3,
            },
            TerrainSectionSnapshotStreamsV1::empty(),
        )
        .unwrap();
        let snapshot_bytes = encode_section_snapshot_v1(&snapshot);
        assert_eq!(
            &blockwild_world_mesh_section_v1(&snapshot_bytes, &registry_bytes)[..4],
            b"BWM1"
        );
        assert_eq!(
            &blockwild_world_light_section_v1(&snapshot_bytes, &registry_bytes, &[0; 256])[..4],
            b"BWL1"
        );

        let mut specialty = snapshot;
        specialty.streams.blocks[halo_cell_index_v1(0, 0, 0).unwrap()] = 2;
        specialty.snapshot_hash = blockwild_world::hash_section_snapshot_v1(&specialty);
        assert_eq!(
            &blockwild_world_mesh_section_v1(&encode_section_snapshot_v1(&specialty), &registry_bytes)[..4],
            b"BWI1"
        );
        assert_eq!(&blockwild_world_mesh_section_v1(b"bad", &registry_bytes)[..4], b"BWE1");
    }

    #[test]
    fn generation_facade_preserves_the_native_packet_and_certificate() {
        let request = blockwild_generation::fixture_request("wasm-generation", -31, 47, 9);
        let encoded = blockwild_generation::encode_request(&request).unwrap();
        let result = blockwild_generate_chunk_v2(&encoded);
        blockwild_generation::decode_result(&result)
            .unwrap()
            .validate(&request)
            .unwrap();
        let certificate = String::from_utf8(blockwild_generation_parity_certificate_v2()).unwrap();
        assert!(certificate.contains("\"corpusCases\":155"));
        assert!(certificate.contains("\"corpusHash\":\"5d4e6b1445b00f3430164d1a8093d8dc\""));
        assert!(certificate.contains("\"byteEqual\":true"));
        assert!(blockwild_generate_chunk_v2(b"malformed").is_empty());
    }

    #[test]
    fn rich_save_migration_facade_fails_closed_before_native_adoption() {
        assert!(blockwild_rich_save_migration_root_v1(b"malformed").is_empty());
        assert!(blockwild_rich_save_migration_roundtrip_v1(b"malformed", &[0; 16]).is_empty());
        assert!(blockwild_rich_save_migration_roundtrip_v1(b"malformed", &[0; 15]).is_empty());
    }
}
