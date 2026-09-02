//! Deterministic whole-chunk terrain generation for Blockwild.

mod adventure;
mod contract;
mod dragon;
mod features;
mod generator;
mod lair_query;
mod legendary;
mod locator_wire;
mod noise;
mod option_json;
mod roads;
mod service;
mod settlement;
mod settlement_layout;
mod settlement_query;
mod underground;
mod wire;

pub use contract::{
    BiomeId, Block, ChunkPayloadV2, GENERATOR_VERSION, GenerateChunkRequestV2, GenerationError, GenerationOptions,
    GenerationProfile, MarkerRow, PROTOCOL_VERSION, ParityCertificate, REQUEST_SCHEMA_VERSION, RESULT_SCHEMA_VERSION,
    TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2, TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
};
pub use generator::{ColumnSample, TerrainGeneratorV18};
pub use service::{
    CancellationToken, GenerationDiagnostics, GenerationOutcome, GenerationService, GenerationServiceConfig,
    StaleReason, fixture_request,
};
pub use wire::{decode_request, decode_result, encode_request, encode_result};

/// Pure Wasm-facing whole-packet entry point. Platform adapters translate
/// errors into their existing engine envelope without exposing Rust layouts.
pub fn generate_packet_v2(bytes: &[u8]) -> Result<Vec<u8>, GenerationError> {
    let request = decode_request(bytes)?;
    let payload = TerrainGeneratorV18::from_request(&request)?.generate(&request, || false)?;
    encode_result(&payload)
}

/// Bounded authoritative settlement-origin query packet. The result includes
/// the Rust-selected public arrival from the same layout used by chunk stamps.
pub fn query_settlements_packet_v1(bytes: &[u8]) -> Result<Vec<u8>, GenerationError> {
    settlement_query::query_packet(bytes)
}

/// Bounded authoritative terrestrial/sea dragon-lair locator.
pub fn query_dragon_lair_packet_v1(bytes: &[u8]) -> Result<Vec<u8>, GenerationError> {
    lair_query::query_packet(bytes)
}

/// Generator-v18 promotion certificate minted from the checked-in,
/// fail-closed TypeScript/Rust corpus. CI recomputes the frozen 131 whole
/// chunks plus 24 normalized option cases and their independent replays.
#[must_use]
pub fn parity_certificate_json_v2() -> String {
    format!(
        "{{\"generatorVersion\":{GENERATOR_VERSION},\"generatorHash\":\"161eef7e34381d450067b7ebedbcb4e1\",\"contentHash\":\"cc59903be77dfe30109d15bfaf0e3022\",\"corpusHash\":\"{TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2}\",\"corpusCases\":{TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2},\"byteEqual\":true}}"
    )
}

/// Immutable evidence identity for the exact TypeScript/native/Wasm locator
/// parity corpus. The browser requires this independently from chunk parity.
#[must_use]
pub fn locator_parity_certificate_json_v1() -> String {
    "{\"schemaVersion\":1,\"corpusHash\":\"85d6e080c27222b8d06d25812d7d5535\",\"settlementCases\":114,\"lairCases\":16,\"byteEqual\":true}".into()
}

#[cfg(test)]
mod packet_tests {
    use super::*;

    #[test]
    fn wasm_packet_entry_point_is_deterministic_and_self_validating() {
        let request = fixture_request("packet", -31, 47, 1);
        let input = encode_request(&request).unwrap();
        let first = generate_packet_v2(&input).unwrap();
        let second = generate_packet_v2(&input).unwrap();
        assert_eq!(first, second);
        decode_result(&first).unwrap().validate(&request).unwrap();
    }

    #[test]
    fn shipped_certificate_identifies_the_fail_closed_promotion_corpus() {
        let certificate = parity_certificate_json_v2();
        assert!(certificate.contains("\"generatorVersion\":18"));
        assert!(certificate.contains("\"byteEqual\":true"));
        assert!(certificate.contains("\"corpusCases\":155"));
        assert!(certificate.contains("\"corpusHash\":\"5d4e6b1445b00f3430164d1a8093d8dc\""));
    }

    #[test]
    fn shipped_locator_certificate_is_independent_and_bounded() {
        let certificate = locator_parity_certificate_json_v1();
        assert!(certificate.contains("\"schemaVersion\":1"));
        assert!(certificate.contains("\"corpusHash\":\"85d6e080c27222b8d06d25812d7d5535\""));
        assert!(certificate.contains("\"settlementCases\":114"));
        assert!(certificate.contains("\"lairCases\":16"));
        assert!(certificate.contains("\"byteEqual\":true"));
    }
}
