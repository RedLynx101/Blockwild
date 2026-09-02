//! Fixed-width final player-binding acknowledgements. The outer operation schema
//! (v3/v4) is intentionally distinct from the shared inner schema (v1).

use blockwild_runtime_wire::WireError;
use blockwild_types::CanonicalHash;

use crate::{
    SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V3_INNER_SCHEMA, SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V3_MAGIC,
    SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V4_INNER_SCHEMA, SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V4_MAGIC,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimePlayerFinalBindVersionV1 {
    InventoryV3,
    CombatV4,
}

impl RuntimePlayerFinalBindVersionV1 {
    fn descriptor(self) -> ([u8; 4], u16) {
        match self {
            Self::InventoryV3 => (
                SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V3_MAGIC,
                SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V3_INNER_SCHEMA,
            ),
            Self::CombatV4 => (
                SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V4_MAGIC,
                SIMULATION_PLAYER_BIND_FINAL_RECEIPT_V4_INNER_SCHEMA,
            ),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RuntimePlayerFinalBindReceiptWireV1 {
    pub request_payload_hash: CanonicalHash,
    pub terminal_state_hash: CanonicalHash,
}

#[must_use]
pub fn encode_runtime_player_final_bind_receipt_v1(
    version: RuntimePlayerFinalBindVersionV1,
    value: RuntimePlayerFinalBindReceiptWireV1,
) -> Vec<u8> {
    let (magic, inner_schema) = version.descriptor();
    let mut bytes = Vec::with_capacity(38);
    bytes.extend_from_slice(&magic);
    bytes.extend_from_slice(&inner_schema.to_le_bytes());
    bytes.extend_from_slice(value.request_payload_hash.as_bytes());
    bytes.extend_from_slice(value.terminal_state_hash.as_bytes());
    bytes
}

/// Structural decode only: the enclosing runtime response authenticates these
/// hashes. Callers must compare them with the exact request and terminal state.
pub fn decode_runtime_player_final_bind_receipt_v1(
    version: RuntimePlayerFinalBindVersionV1,
    bytes: &[u8],
) -> Result<RuntimePlayerFinalBindReceiptWireV1, WireError> {
    let (magic, inner_schema) = version.descriptor();
    if bytes.len() != 38 || bytes[..4] != magic || bytes[4..6] != inner_schema.to_le_bytes() {
        return Err(WireError::new(
            "player-final-bind-header",
            "final bind acknowledgement has the wrong size, magic, or inner schema",
        ));
    }
    let mut request_payload_hash = [0; 16];
    let mut terminal_state_hash = [0; 16];
    request_payload_hash.copy_from_slice(&bytes[6..22]);
    terminal_state_hash.copy_from_slice(&bytes[22..38]);
    Ok(RuntimePlayerFinalBindReceiptWireV1 {
        request_payload_hash: CanonicalHash(request_payload_hash),
        terminal_state_hash: CanonicalHash(terminal_state_hash),
    })
}
