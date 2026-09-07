//! Coarse BWRQ/BWRS facade for one integrated native authority per Worker.
//!
//! The browser never calls this module per voxel or per entity. Every export
//! accepts one complete, checksummed runtime envelope and returns one awaited
//! response envelope. Unsupported domain codecs reject explicitly; they are
//! never interpreted as successful no-ops.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

use blockwild_authority::BlockCatalogV1;
use blockwild_engine::{
    BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1, BASIC_DIRT_ACTION_RECEIPT_TYPE_V1, CONTENT_INSTALL_PAGE_TYPE_V1,
    CONTENT_INSTALL_RECEIPT_TYPE_V1, CONTEXT_COMMAND_CONTINUITY_RECEIPT_TYPE_V2, CONTEXT_COMMAND_CONTINUITY_TYPE_V2,
    ENTITY_AUTHORITY_EXPORT_TYPE_V1, ENTITY_AUTHORITY_IMPORT_RECEIPT_TYPE_V1, ENTITY_AUTHORITY_IMPORT_TYPE_V2,
    ENTITY_AUTHORITY_SNAPSHOT_TYPE_V2, ENTITY_COMPATIBILITY_EXPORT_TYPE_V1, ENTITY_COMPATIBILITY_IMPORT_TYPE_V1,
    ENTITY_COMPATIBILITY_RECORD_TYPE_V1, HISTORICAL_EXTERNAL_KNOWN_STATE_FLAGS_V2,
    INTEGRATED_RUNTIME_LEGACY_MIGRATION_SCHEMA_V1, INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_ID_V1,
    INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_ID_V2, IntegratedRuntimeBatchV2, IntegratedRuntimeConfigV2,
    IntegratedRuntimeError, IntegratedRuntimeHistoricalExternalOperationV2,
    IntegratedRuntimeHistoricalExternalReceiptV2, IntegratedRuntimeIdentityV2, IntegratedRuntimeLegacyMigrationV1,
    IntegratedRuntimeReceiptV2, IntegratedRuntimeRenderPresentationBindingV1, IntegratedRuntimeV2,
    NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1, NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V2,
    NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1, NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2,
    NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1, NATIVE_DROP_PICKUP_RECEIPT_TYPE_V1,
    NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1, NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1,
    PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1, PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
    PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1, PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1,
    PLAYER_CREATIVE_SLOT_SET_RECEIPT_TYPE_V1, PLAYER_CREATIVE_SLOT_SET_TYPE_V1, PLAYER_GAME_MODE_SET_RECEIPT_TYPE_V1,
    PLAYER_GAME_MODE_SET_TYPE_V1, PLAYER_INVENTORY_IMPORT_RECEIPT_TYPE_V1, PLAYER_INVENTORY_IMPORT_TYPE_V1,
    PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_TYPE_V1, PLAYER_LOCATOR_ITEM_CONSUME_TYPE_V1, PLAYER_RESPAWN_RECEIPT_TYPE_V1,
    PLAYER_RESPAWN_TYPE_V1, PlayerDeathCustodyLaneV1, RuntimeCommandCacheLookupV1,
    SIMULATION_CAMERA_CONFIG_RECEIPT_TYPE_V1, SIMULATION_CAMERA_CONFIG_TYPE_V1,
    SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V3, SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V4,
    SIMULATION_PLAYER_BIND_TYPE_V3, SIMULATION_PLAYER_BIND_TYPE_V4, TERRAIN_RESIDENCY_BATCH_TYPE_V1,
    TERRAIN_RESIDENCY_RECEIPT_TYPE_V1, TERRAIN_RESIDENCY_RECONCILE_BATCH_TYPE_V2,
    TERRAIN_RESIDENCY_RECONCILE_RECEIPT_TYPE_V2, WorldViewExtractionInputV1, decode_content_install_page_v1,
    decode_entity_authority_export_v1, decode_entity_authority_import_v2, decode_entity_command_batch_v1,
    decode_entity_compatibility_export_v1, decode_entity_compatibility_import_v1, decode_gameplay_actor_grant_v1,
    decode_gameplay_batch_v1, decode_network_agent_grant_v1, decode_network_command_release_v1,
    decode_network_delta_build_request_v1, decode_network_peer_grant_v1, decode_network_peer_release_v1,
    decode_network_reconnect_request_v1, decode_network_replication_record_v1, decode_player_bootstrap_status_query_v1,
    decode_player_combat_bootstrap_status_query_v1, decode_player_creative_slot_set_v1, decode_player_game_mode_set_v1,
    decode_player_inventory_import_v1, decode_player_locator_item_consume_v1, decode_player_respawn_v1,
    decode_runtime_basic_dirt_action_receipt_query_v1, decode_runtime_camera_config_v1,
    decode_runtime_context_command_continuity_query_v2, decode_runtime_native_block_edit_receipt_query_v1,
    decode_runtime_native_block_edit_receipt_query_v2, decode_runtime_native_drop_pickup_receipt_query_v1,
    decode_runtime_native_player_drop_receipt_query_v1, decode_runtime_persistence_dispatch_v1,
    decode_runtime_persistence_status_query_v1, decode_runtime_player_binding_v1, decode_terrain_residency_batch_v1,
    decode_terrain_residency_reconcile_batch_v2, encode_content_install_receipt_v1,
    encode_entity_authority_import_receipt_v1, encode_entity_event_batch_v1, encode_gameplay_receipt_v1,
    encode_player_bootstrap_status_v1, encode_player_combat_bootstrap_status_v1,
    encode_player_creative_slot_set_receipt_v1, encode_player_game_mode_set_receipt_v1,
    encode_player_inventory_import_receipt_v1, encode_player_locator_item_consume_receipt_v1,
    encode_player_respawn_receipt_v1, encode_runtime_basic_dirt_action_projection_receipt_v1,
    encode_runtime_camera_config_receipt_v1, encode_runtime_context_command_continuity_receipt_v2,
    encode_runtime_native_block_edit_projection_receipt_v1, encode_runtime_native_block_edit_projection_receipt_v2,
    encode_runtime_native_drop_pickup_projection_receipt_v1, encode_runtime_native_player_drop_projection_receipt_v1,
    encode_runtime_persistence_dispatch_receipt_v1, encode_runtime_persistence_status_receipt_v1,
    encode_terrain_residency_receipt_v1, encode_terrain_residency_reconcile_receipt_v2,
    integrated_runtime_checkpoint_hash_v1, runtime_camera_config_state_hash_v1,
};
use blockwild_network::{InterestSelectionStatsV1, encode_network_checkpoint_v1, encode_network_delta_v1};
use blockwild_persistence::{PersistenceDispatchOutcomeV1, PersistenceDispatchStatusV1, PersistenceRetryDirectiveV1};
use blockwild_runtime_wire::{
    ENTITY_COMMAND_TYPE_V1, ENTITY_RECEIPT_TYPE_V1, GAMEPLAY_ACTOR_GRANT_RECEIPT_TYPE_V1, GAMEPLAY_ACTOR_GRANT_TYPE_V1,
    GAMEPLAY_COMMAND_TYPE_V1, GAMEPLAY_RECEIPT_TYPE_V1, MAX_SAFE_U64, NETWORK_AGENT_GRANT_TYPE_V1,
    NETWORK_COMMAND_RELEASE_RECEIPT_TYPE_V1, NETWORK_COMMAND_RELEASE_TYPE_V1, NETWORK_DELTA_BUILD_RESPONSE_TYPE_V1,
    NETWORK_DELTA_BUILD_TYPE_V1, NETWORK_GRANT_RECEIPT_TYPE_V1, NETWORK_PEER_GRANT_TYPE_V1,
    NETWORK_PEER_RELEASE_RECEIPT_TYPE_V1, NETWORK_PEER_RELEASE_TYPE_V1, NETWORK_RECONNECT_RESPONSE_TYPE_V1,
    NETWORK_RECONNECT_TYPE_V1, NETWORK_REPLICATION_RECEIPT_TYPE_V1, NETWORK_REPLICATION_REMOVE_TYPE_V1,
    NETWORK_REPLICATION_UPSERT_TYPE_V1, NETWORK_REQUEST_TYPE_V1, NETWORK_RESPONSE_TYPE_V1,
    PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1, PERSISTENCE_DISPATCH_RECEIPT_TYPE_V1,
    PERSISTENCE_DISPATCH_TYPE_V1, PERSISTENCE_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2, PERSISTENCE_REQUEST_TYPE_V1,
    PERSISTENCE_STATUS_RECEIPT_TYPE_V1, RUNTIME_BULK_MAX_PENDING_V1, RUNTIME_BULK_MAX_QUEUED_BYTES_V1,
    RuntimeBulkEncodedV1, RuntimeBulkRequestV1, RuntimeBulkResponseV1, RuntimeBulkSaveStageStateV1, RuntimeBulkStateV1,
    RuntimeCommandBatchV1, RuntimeCommandReceiptV1, RuntimeConfigV1, RuntimeDomainOperationV1, RuntimeDomainV1,
    RuntimeExtractionV1, RuntimeIdentityV1, RuntimeLegacyMigrationAttestationWireV1, RuntimeRequestV1,
    RuntimeResponseV1, RuntimeRevisionV1, RuntimeStepResponseV2, SIMULATION_PLAYER_BIND_RECEIPT_TYPE_V2,
    SIMULATION_PLAYER_BIND_TYPE_V2, WireHash, command_receipt_hash_v1, decode_bulk_request_v1, decode_request_v1,
    decode_step_request_v2, encode_bulk_response_v1, encode_response_v1, encode_step_response_v2,
    extraction_checksum_v1, seal_semantic_action_receipt_v2, wire_checksum_v1,
};
use blockwild_simulation::{CameraModeV1, CameraPoseV1, CameraProfileV1};
use blockwild_types::{CanonicalHash, CanonicalHasher};
use wasm_bindgen::prelude::*;

const WORKER_EPOCH: u32 = 1;
const WASM_ARTIFACT_ATTESTATION_PLACEHOLDER: &str = "loader-attested";
const ENTITY_EXTRACTION_SCHEMA_V3: u16 = 3;
const ENTITY_EXTRACTION_HEADER_BYTES_V3: usize = 51;
const MAX_ENTITY_EXTRACTION_RECORDS_V3: usize = 4_096;
const MAX_ENTITY_EXTRACTION_BYTES_V3: usize = 4 * 1_048_576;
const MAX_STEP_V2_RETRY_RECEIPTS: usize = 256;
const DOMAIN_VIEW_SCHEMA_V1: u16 = 1;
const DOMAIN_VIEW_MAX_RECORDS_V1: usize = 2_048;
// Eight views plus the independently capped 4 MiB BWR6 entity stream must fit
// the 8 MiB Worker control envelope with audio/diagnostic headroom.
const DOMAIN_VIEW_MAX_BYTES_V1: usize = 384 * 1_024;
const DOMAIN_VIEW_MAX_FIELDS_V1: usize = 2_048;
const DOMAIN_VIEW_MAX_BLOCKERS_V1: usize = 32;
const DOMAIN_VIEW_COUNT_V1: u16 = 8;
const AUDIO_EXTRACTION_SCHEMA_V2: u16 = 2;
const HISTORICAL_EXTERNAL_TRANSFER_TOKEN_BASE_V2: u64 = 4_600_000_000_000_000;
// `bounded-extraction-v1` attests the fixed, bounded extraction protocol. Live
// BWX/BWR6 completeness remains per-envelope evidence through domain statuses
// and `bounded-extraction-blockers-v1`; it never mutates the Ready capability set.
const CAPABILITIES: [&str; 25] = [
    "awaited-receipts-v1",
    "basic-dirt-action-receipt-v1",
    "bounded-entity-extraction-v1",
    "bounded-extraction-v1",
    "bounded-extraction-blockers-v1",
    "bulk-platform-v1",
    "content-bundle-install-v1",
    "creative-inventory-slot-v1",
    "entity-authority-snapshot-v2",
    "entity-command-v1",
    "entity-compatibility-bridge-v1",
    "fixed-step-input-v1",
    "gameplay-command-v1",
    "historical-external-save-v2",
    "historical-external-reconciliation-v2",
    "integrated-runtime-v1",
    "network-authority-v1",
    "player-game-mode-set-v1",
    "player-respawn-v1",
    INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_ID_V1,
    INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_ID_V2,
    "native-drop-pickup-receipt-v1",
    "native-player-drop-receipt-v1",
    "terrain-residency-v1",
    "terrain-residency-reconcile-v2",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RuntimeExtractionViewV1 {
    viewport: [u32; 2],
    view_revision: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RuntimeExtractionContextV1 {
    Legacy,
    View(RuntimeExtractionViewV1),
}

#[derive(Clone, Debug, Default)]
struct RuntimeExtractionCursorV1 {
    cursor: u64,
    last_authority: Option<RuntimeIdentityV1>,
    last_context: Option<RuntimeExtractionContextV1>,
    highest_view: Option<RuntimeExtractionViewV1>,
    last_full: Option<RuntimeExtractionV1>,
}

#[derive(Default)]
struct IntegratedRuntimeStoreV2 {
    next_handle: u32,
    next_historical_transfer_token: u64,
    runtimes: BTreeMap<u32, IntegratedRuntimeV2>,
    bulk_attachments: BTreeMap<(u32, u64), Vec<u8>>,
    extraction_cursors: BTreeMap<u32, RuntimeExtractionCursorV1>,
    // Bounded, nondurable transport replay only. Semantic sequence ownership
    // lives in IntegratedRuntimeV2 and is never reconstructed from this cache.
    step_v2_retries: BTreeMap<(u32, u32, u32), (WireHash, Vec<u8>)>,
    step_v2_retry_order: VecDeque<(u32, u32, u32)>,
}

impl IntegratedRuntimeStoreV2 {
    fn insert(&mut self, runtime: IntegratedRuntimeV2) -> u32 {
        self.next_handle = self.next_handle.wrapping_add(1).max(1);
        while self.runtimes.contains_key(&self.next_handle) {
            self.next_handle = self.next_handle.wrapping_add(1).max(1);
        }
        let handle = self.next_handle;
        self.extraction_cursors.remove(&handle);
        self.step_v2_retries
            .retain(|(runtime_handle, _, _), _| *runtime_handle != handle);
        self.step_v2_retry_order
            .retain(|(runtime_handle, _, _)| *runtime_handle != handle);
        self.runtimes.insert(handle, runtime);
        handle
    }

    fn allocate_historical_transfer_token(&mut self, handle: u32) -> u64 {
        if self.next_historical_transfer_token < HISTORICAL_EXTERNAL_TRANSFER_TOKEN_BASE_V2 {
            self.next_historical_transfer_token = HISTORICAL_EXTERNAL_TRANSFER_TOKEN_BASE_V2;
        }
        loop {
            let token = self.next_historical_transfer_token;
            self.next_historical_transfer_token = self
                .next_historical_transfer_token
                .checked_add(1)
                .filter(|value| *value <= MAX_SAFE_U64)
                .unwrap_or(HISTORICAL_EXTERNAL_TRANSFER_TOKEN_BASE_V2);
            if !self.bulk_attachments.contains_key(&(handle, token)) {
                return token;
            }
        }
    }

    fn cache_step_v2_retry(&mut self, key: (u32, u32, u32), request_hash: WireHash, response: Vec<u8>) {
        if !self.step_v2_retries.contains_key(&key) {
            self.step_v2_retry_order.push_back(key);
        }
        self.step_v2_retries.insert(key, (request_hash, response));
        while self.step_v2_retry_order.len() > MAX_STEP_V2_RETRY_RECEIPTS {
            if let Some(expired) = self.step_v2_retry_order.pop_front() {
                self.step_v2_retries.remove(&expired);
            }
        }
    }
}

thread_local! {
    static INTEGRATED_RUNTIMES: RefCell<IntegratedRuntimeStoreV2> = RefCell::new(IntegratedRuntimeStoreV2::default());
}

/// Creates a fresh integrated runtime or atomically restores one exact R8
/// checkpoint before assigning a Worker-generation handle.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_create_v2(request_bytes: &[u8]) -> Vec<u8> {
    let Ok(request) = decode_request_v1(request_bytes) else {
        return Vec::new();
    };
    match request {
        RuntimeRequestV1::Create {
            request_id,
            client_epoch,
            config,
        } => match create_runtime(config) {
            Ok(runtime) => {
                let identity = wire_identity(&runtime.identity());
                let capabilities = capabilities(&runtime);
                let handle = INTEGRATED_RUNTIMES.with(|store| store.borrow_mut().insert(runtime));
                encode(RuntimeResponseV1::Ready {
                    request_id,
                    client_epoch,
                    worker_epoch: WORKER_EPOCH,
                    runtime_handle: handle,
                    identity,
                    // Rust cannot self-prove the manifest hash that selected
                    // its bytes. The content-addressed loader replaces this
                    // placeholder before the browser service verifies it.
                    artifact_hash: WASM_ARTIFACT_ATTESTATION_PLACEHOLDER.into(),
                    instance_id: format!("integrated-runtime:{WORKER_EPOCH}:{handle}"),
                    capabilities,
                })
            }
            Err((code, message)) => encode_error(request_id, client_epoch, code, message, None),
        },
        RuntimeRequestV1::Restore {
            request_id,
            client_epoch,
            expected_checkpoint_hash,
            checkpoint,
        } => {
            let checkpoint_hash = canonical_hash(expected_checkpoint_hash);
            match IntegratedRuntimeV2::restore_runtime_checkpoint(&checkpoint, checkpoint_hash) {
                Ok(runtime) => {
                    let identity = wire_identity(&runtime.identity());
                    let capabilities = capabilities(&runtime);
                    let handle = INTEGRATED_RUNTIMES.with(|store| store.borrow_mut().insert(runtime));
                    encode(RuntimeResponseV1::Restored {
                        request_id,
                        client_epoch,
                        worker_epoch: WORKER_EPOCH,
                        runtime_handle: handle,
                        identity,
                        checkpoint_hash: wire_hash(checkpoint_hash),
                        artifact_hash: WASM_ARTIFACT_ATTESTATION_PLACEHOLDER.into(),
                        instance_id: format!("integrated-runtime:{WORKER_EPOCH}:{handle}"),
                        capabilities,
                    })
                }
                Err(error) => encode_error(request_id, client_epoch, error.code, error.message, None),
            }
        }
        request => encode_error(
            request.request_id(),
            request.client_epoch(),
            "wrong-operation",
            "integrated runtime creation accepts only create or restore requests",
            None,
        ),
    }
}

/// Applies one reliable command envelope and returns one deterministic receipt.
/// Unknown domain payloads reject rather than being silently discarded.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_command_v2(handle: u32, request_bytes: &[u8]) -> Vec<u8> {
    let Ok(request) = decode_request_v1(request_bytes) else {
        return Vec::new();
    };
    let (request_id, client_epoch, batch, recovery_only) = match request {
        RuntimeRequestV1::Command {
            request_id,
            client_epoch,
            batch,
        } => (request_id, client_epoch, batch, false),
        RuntimeRequestV1::RecoverCommand {
            request_id,
            client_epoch,
            batch,
        } => (request_id, client_epoch, batch, true),
        request => {
            return encode_error(
                request.request_id(),
                request.client_epoch(),
                "wrong-operation",
                "command export requires a normal or recovery command request",
                None,
            );
        }
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let Some(runtime) = store.runtimes.get(&handle).cloned() else {
            return encode_error(
                request_id,
                client_epoch,
                "invalid-handle",
                "unknown integrated runtime handle",
                None,
            );
        };
        let current = wire_identity(&runtime.identity());
        match runtime.lookup_runtime_command_receipt(&batch.actor_id, &batch.idempotency_key, batch.command_hash) {
            RuntimeCommandCacheLookupV1::Exact(receipt) => {
                if recovery_only && runtime_command_receipt_terminal_identity(&receipt) != &current {
                    return encode_error(
                        request_id,
                        client_epoch,
                        "idempotency-recovery-stale",
                        "cached command receipt is not terminal at the restored authority identity",
                        Some(current),
                    );
                }
                return encode(RuntimeResponseV1::CommandReceipt {
                    request_id,
                    client_epoch,
                    worker_epoch: WORKER_EPOCH,
                    receipt: *receipt,
                });
            }
            RuntimeCommandCacheLookupV1::Conflict if recovery_only => {
                return encode_error(
                    request_id,
                    client_epoch,
                    "idempotency-conflict",
                    "idempotency key was reused for different command bytes",
                    Some(current),
                );
            }
            RuntimeCommandCacheLookupV1::Conflict => {
                return encode(RuntimeResponseV1::CommandReceipt {
                    request_id,
                    client_epoch,
                    worker_epoch: WORKER_EPOCH,
                    receipt: rejected_command_receipt(
                        &batch,
                        "idempotency-conflict",
                        "idempotency key was reused for different command bytes",
                        current,
                    ),
                });
            }
            RuntimeCommandCacheLookupV1::Miss if recovery_only => {
                return encode_error(
                    request_id,
                    client_epoch,
                    "idempotency-recovery-miss",
                    "restored runtime has no durable receipt for this recovery-only command",
                    Some(current),
                );
            }
            RuntimeCommandCacheLookupV1::Miss => {}
        }
        let receipt = if batch.expected != current {
            rejected_command_receipt(
                &batch,
                "stale-runtime",
                "command was authored against an obsolete integrated authority identity",
                current,
            )
        } else if batch.actor_id == "runtime-content-installer"
            && batch.operations.len() == 1
            && batch.operations[0].domain == RuntimeDomainV1::Gameplay
            && batch.operations[0].type_id == CONTENT_INSTALL_PAGE_TYPE_V1
        {
            let mut candidate = runtime.clone();
            match candidate.execute_runtime_content_installer_command(&batch) {
                Ok(receipt) => {
                    store.runtimes.insert(handle, candidate);
                    return encode(RuntimeResponseV1::CommandReceipt {
                        request_id,
                        client_epoch,
                        worker_epoch: WORKER_EPOCH,
                        receipt,
                    });
                }
                Err(error) => rejected_command_receipt(&batch, &error.code, error.message, current),
            }
        } else {
            match dispatch_command(&runtime, &batch) {
                Ok((mut candidate, domain_receipts)) => {
                    let before = current;
                    let after = wire_identity(&candidate.identity());
                    let mut receipt = RuntimeCommandReceiptV1::Accepted {
                        command_id: batch.command_id.clone(),
                        idempotency_key: batch.idempotency_key.clone(),
                        command_hash: batch.command_hash,
                        before,
                        after,
                        domain_receipts,
                        receipt_hash: WireHash::default(),
                    };
                    set_runtime_command_receipt_hash(&mut receipt);
                    match candidate.cache_runtime_command_receipt(
                        &batch.actor_id,
                        &batch.idempotency_key,
                        batch.command_hash,
                        receipt.clone(),
                    ) {
                        Ok(()) => {
                            store.runtimes.insert(handle, candidate);
                            return encode(RuntimeResponseV1::CommandReceipt {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                receipt,
                            });
                        }
                        Err(error) => rejected_command_receipt(
                            &batch,
                            "idempotency-receipt-capacity",
                            error.message,
                            wire_identity(&runtime.identity()),
                        ),
                    }
                }
                Err((code, message)) => rejected_command_receipt(&batch, code, message, current),
            }
        };
        let mut metadata_candidate = runtime;
        if let Err(error) = metadata_candidate.cache_runtime_command_receipt(
            &batch.actor_id,
            &batch.idempotency_key,
            batch.command_hash,
            receipt.clone(),
        ) {
            return encode_error(
                request_id,
                client_epoch,
                "idempotency-receipt-capacity",
                error.message,
                Some(wire_identity(&metadata_candidate.identity())),
            );
        }
        store.runtimes.insert(handle, metadata_candidate);
        encode(RuntimeResponseV1::CommandReceipt {
            request_id,
            client_epoch,
            worker_epoch: WORKER_EPOCH,
            receipt,
        })
    })
}

/// Advances bounded fixed steps after atomically accepting the complete,
/// strictly sequenced input batch into Rust-owned authority.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_step_v2(handle: u32, request_bytes: &[u8]) -> Vec<u8> {
    if request_bytes
        .get(6..8)
        .is_some_and(|bytes| u16::from_le_bytes(bytes.try_into().expect("fixed schema bytes")) == 6)
    {
        return dispatch_step_request_v2(handle, request_bytes);
    }
    let Ok(request) = decode_request_v1(request_bytes) else {
        return Vec::new();
    };
    let RuntimeRequestV1::Step {
        request_id,
        client_epoch,
        expected,
        monotonic_time_us,
        budget_us,
        inputs,
    } = request
    else {
        return encode_error(
            request.request_id(),
            request.client_epoch(),
            "wrong-operation",
            "step export requires a fixed-step request",
            None,
        );
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let Some(runtime) = store.runtimes.get(&handle) else {
            return encode_error(
                request_id,
                client_epoch,
                "invalid-handle",
                "unknown integrated runtime handle",
                None,
            );
        };
        let current = wire_identity(&runtime.identity());
        if expected != current {
            return encode_error(
                request_id,
                client_epoch,
                "stale-runtime",
                "step references obsolete authority",
                Some(current),
            );
        }
        let mut candidate = runtime.clone();
        if let Err(error) = candidate.accept_inputs(&inputs) {
            return encode_error(request_id, client_epoch, &error.code, &error.message, Some(current));
        }
        match candidate.step(monotonic_time_us, budget_us) {
            Ok(summary) => {
                let identity = wire_identity(&candidate.identity());
                store.runtimes.insert(handle, candidate);
                encode(RuntimeResponseV1::StepResult {
                    request_id,
                    client_epoch,
                    worker_epoch: WORKER_EPOCH,
                    identity,
                    fixed_steps: u16::try_from(summary.fixed_steps).expect("fixed steps are capped at eight"),
                    inputs_applied: u16::try_from(summary.inputs_applied).expect("input frames are bounded"),
                    commands_processed: u16::try_from(summary.processed_batches)
                        .expect("processed batches are bounded"),
                    commands_accepted: u16::try_from(summary.accepted_batches).expect("accepted batches are bounded"),
                    action_receipts: summary.action_receipts,
                    replay_hash: wire_hash(summary.replay_hash),
                })
            }
            Err(error) => encode_error(request_id, client_epoch, &error.code, &error.message, Some(current)),
        }
    })
}

fn dispatch_step_request_v2(handle: u32, request_bytes: &[u8]) -> Vec<u8> {
    let Ok(request) = decode_step_request_v2(request_bytes) else {
        return Vec::new();
    };
    let request_hash = WireHash(wire_checksum_v1(request_bytes));
    let retry_key = (handle, request.client_epoch, request.request_id);
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        if let Some((cached_hash, cached_response)) = store.step_v2_retries.get(&retry_key) {
            if *cached_hash == request_hash {
                return cached_response.clone();
            }
            let current = store
                .runtimes
                .get(&handle)
                .map(|runtime| wire_identity(&runtime.identity()));
            return encode_error(
                request.request_id,
                request.client_epoch,
                "step-v2-request-conflict",
                "StepV2 request id was reused with different canonical bytes",
                current,
            );
        }
        let response = match store.runtimes.get(&handle).cloned() {
            None => encode_error(
                request.request_id,
                request.client_epoch,
                "invalid-handle",
                "unknown integrated runtime handle",
                None,
            ),
            Some(mut candidate) => {
                let current = wire_identity(&candidate.identity());
                if request.expected != current {
                    encode_error(
                        request.request_id,
                        request.client_epoch,
                        "stale-runtime",
                        "StepV2 references obsolete authority",
                        Some(current),
                    )
                } else {
                    match candidate.step_context_v2(
                        request.monotonic_time_us,
                        request.budget_us,
                        &request.inputs,
                        &request.context_commands,
                    ) {
                        Ok(summary) => {
                            let identity = wire_identity(&candidate.identity());
                            let replay_hash = wire_hash(summary.replay_hash);
                            let semantic_receipts = summary
                                .semantic_receipts
                                .into_iter()
                                .map(|receipt| {
                                    seal_semantic_action_receipt_v2(receipt, &identity, replay_hash)
                                        .map_err(|error| (error.code, error.message))
                                })
                                .collect::<Result<Vec<_>, _>>();
                            match semantic_receipts {
                                Ok(semantic_receipts) => {
                                    let encoded = encode_step_response_v2(&RuntimeStepResponseV2 {
                                        request_id: request.request_id,
                                        client_epoch: request.client_epoch,
                                        worker_epoch: WORKER_EPOCH,
                                        identity,
                                        fixed_steps: u16::try_from(summary.fixed_steps)
                                            .expect("fixed steps are capped at eight"),
                                        inputs_applied: u16::try_from(summary.inputs_applied)
                                            .expect("input frames are bounded"),
                                        commands_processed: u16::try_from(summary.processed_batches)
                                            .expect("processed batches are bounded"),
                                        commands_accepted: u16::try_from(summary.accepted_batches)
                                            .expect("accepted batches are bounded"),
                                        action_receipts: summary.action_receipts,
                                        replay_hash,
                                        semantic_receipts,
                                    });
                                    match encoded {
                                        Ok(encoded) => {
                                            store.runtimes.insert(handle, candidate);
                                            encoded
                                        }
                                        Err(error) => encode_error(
                                            request.request_id,
                                            request.client_epoch,
                                            error.code,
                                            error.message,
                                            Some(current),
                                        ),
                                    }
                                }
                                Err((code, message)) => {
                                    encode_error(request.request_id, request.client_epoch, code, message, Some(current))
                                }
                            }
                        }
                        Err(error) => encode_error(
                            request.request_id,
                            request.client_epoch,
                            error.code,
                            error.message,
                            Some(current),
                        ),
                    }
                }
            }
        };
        store.cache_step_v2_retry(retry_key, request_hash, response.clone());
        response
    })
}

/// Returns one bounded renderer-neutral extraction. Entity/model identity,
/// transforms, health, protection, input/HUD state, and diagnostics are copied
/// once per coarse extraction rather than queried per object.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_extract_v2(handle: u32, request_bytes: &[u8]) -> Vec<u8> {
    let Ok(request) = decode_request_v1(request_bytes) else {
        return Vec::new();
    };
    let (request_id, client_epoch, expected, after_revision, max_bytes, context) = match request {
        RuntimeRequestV1::Extract {
            request_id,
            client_epoch,
            expected,
            after_revision,
            max_bytes,
        } => (
            request_id,
            client_epoch,
            expected,
            after_revision,
            max_bytes,
            RuntimeExtractionContextV1::Legacy,
        ),
        RuntimeRequestV1::ExtractView {
            request_id,
            client_epoch,
            expected,
            after_revision,
            max_bytes,
            viewport_width,
            viewport_height,
            view_revision,
        } => (
            request_id,
            client_epoch,
            expected,
            after_revision,
            max_bytes,
            RuntimeExtractionContextV1::View(RuntimeExtractionViewV1 {
                viewport: [viewport_width, viewport_height],
                view_revision,
            }),
        ),
        request => {
            return encode_error(
                request.request_id(),
                request.client_epoch(),
                "wrong-operation",
                "extract export requires an extraction request",
                None,
            );
        }
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let Some(runtime) = store.runtimes.get(&handle) else {
            return encode_error(
                request_id,
                client_epoch,
                "invalid-handle",
                "unknown integrated runtime handle",
                None,
            );
        };
        let identity = wire_identity(&runtime.identity());
        if expected != identity {
            return encode_error(
                request_id,
                client_epoch,
                "stale-runtime",
                "extraction references obsolete authority",
                Some(identity),
            );
        }
        let cursor = store.extraction_cursors.get(&handle).cloned().unwrap_or_default();
        if after_revision > cursor.cursor {
            return encode_error(
                request_id,
                client_epoch,
                "extraction-revision-ahead",
                "extraction request references a presentation cursor the Worker has not emitted",
                Some(identity),
            );
        }
        if let RuntimeExtractionContextV1::View(view) = context
            && let Some(highest) = cursor.highest_view
        {
            if view.view_revision < highest.view_revision {
                return encode_error(
                    request_id,
                    client_epoch,
                    "view-revision-regression",
                    "view-aware extraction revision regressed below the last emitted browser view",
                    Some(identity),
                );
            }
            if view.view_revision == highest.view_revision && view.viewport != highest.viewport {
                return encode_error(
                    request_id,
                    client_epoch,
                    "view-revision-conflict",
                    "one browser view revision cannot identify two different viewports",
                    Some(identity),
                );
            }
        }
        let changed = cursor.last_authority.as_ref() != Some(&identity) || cursor.last_context != Some(context);
        if !changed {
            if after_revision < cursor.cursor {
                let Some(extraction) = cursor.last_full else {
                    return encode_error(
                        request_id,
                        client_epoch,
                        "extraction-cache-invariant",
                        "the current presentation cursor has no complete cached extraction",
                        Some(identity),
                    );
                };
                if extraction_channel_bytes(&extraction) > max_bytes as usize {
                    return encode_error(
                        request_id,
                        client_epoch,
                        "extraction-capacity",
                        "cached extraction exceeds the requested byte budget",
                        Some(identity),
                    );
                }
                return encode_extraction_response(request_id, client_epoch, extraction, identity);
            }
            let mut extraction = RuntimeExtractionV1 {
                identity: identity.clone(),
                extraction_revision: cursor.cursor,
                render: Vec::new(),
                hud: Vec::new(),
                audio: Vec::new(),
                platform_requests: Vec::new(),
                diagnostics: Vec::new(),
                extraction_hash: WireHash::default(),
            };
            extraction.extraction_hash = match extraction_checksum_v1(&extraction) {
                Ok(hash) => hash,
                Err(error) => {
                    return encode_error(request_id, client_epoch, error.code, error.message, Some(identity));
                }
            };
            return encode_extraction_response(request_id, client_epoch, extraction, identity);
        }
        let Some(extraction_revision) = cursor
            .cursor
            .checked_add(1)
            .filter(|revision| *revision <= MAX_SAFE_U64)
        else {
            return encode_error(
                request_id,
                client_epoch,
                "extraction-revision-exhausted",
                "the Worker presentation cursor cannot advance within the browser-safe range",
                Some(identity),
            );
        };
        let camera = match context {
            RuntimeExtractionContextV1::Legacy => None,
            RuntimeExtractionContextV1::View(view) => match camera_extraction(runtime, view) {
                Ok(camera) => Some(camera),
                Err(error) => {
                    return encode_error(request_id, client_epoch, error.code, error.message, Some(identity));
                }
            },
        };
        let world_view = runtime.world_view_extraction();
        let mut extraction = RuntimeExtractionV1 {
            identity: identity.clone(),
            extraction_revision,
            render: encode_render_extraction_at(runtime, extraction_revision, world_view.as_ref().ok()),
            hud: encode_hud_extraction_at(runtime, extraction_revision, world_view.as_ref().ok(), camera.as_ref()),
            audio: encode_audio_extraction(runtime),
            platform_requests: encode_platform_extraction(runtime),
            diagnostics: encode_diagnostics(runtime),
            extraction_hash: WireHash::default(),
        };
        if extraction_channel_bytes(&extraction) > max_bytes as usize {
            return encode_error(
                request_id,
                client_epoch,
                "extraction-capacity",
                "extraction exceeds the requested byte budget",
                Some(identity),
            );
        }
        extraction.extraction_hash = match extraction_checksum_v1(&extraction) {
            Ok(hash) => hash,
            Err(error) => {
                return encode_error(request_id, client_epoch, error.code, error.message, Some(identity));
            }
        };
        let response = RuntimeResponseV1::Extraction {
            request_id,
            client_epoch,
            worker_epoch: WORKER_EPOCH,
            extraction: extraction.clone(),
        };
        let encoded = match encode_response_v1(&response) {
            Ok(encoded) => encoded,
            Err(error) => {
                return encode_error(request_id, client_epoch, error.code, error.message, Some(identity));
            }
        };
        let highest_view = match context {
            RuntimeExtractionContextV1::Legacy => cursor.highest_view,
            RuntimeExtractionContextV1::View(view) => Some(view),
        };
        store.extraction_cursors.insert(
            handle,
            RuntimeExtractionCursorV1 {
                cursor: extraction_revision,
                last_authority: Some(identity),
                last_context: Some(context),
                highest_view,
                last_full: Some(extraction),
            },
        );
        encoded
    })
}

/// Exports one exact, bounded Worker-replacement checkpoint. Large durable
/// browser saves remain on the detached chunked persistence lane.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_export_save_v2(handle: u32, request_bytes: &[u8]) -> Vec<u8> {
    let Ok(request) = decode_request_v1(request_bytes) else {
        return Vec::new();
    };
    let RuntimeRequestV1::Checkpoint {
        request_id,
        client_epoch,
        expected,
    } = request
    else {
        return encode_error(
            request.request_id(),
            request.client_epoch(),
            "wrong-operation",
            "checkpoint export requires a checkpoint request",
            None,
        );
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let store = store.borrow();
        let Some(runtime) = store.runtimes.get(&handle) else {
            return encode_error(
                request_id,
                client_epoch,
                "invalid-handle",
                "unknown integrated runtime handle",
                None,
            );
        };
        let current = wire_identity(&runtime.identity());
        if expected != current {
            return encode_error(
                request_id,
                client_epoch,
                "stale-runtime",
                "checkpoint export references obsolete authority",
                Some(current),
            );
        }
        match runtime.export_runtime_checkpoint() {
            Ok(checkpoint) => {
                let checkpoint_hash = integrated_runtime_checkpoint_hash_v1(&checkpoint);
                let response = RuntimeResponseV1::Checkpoint {
                    request_id,
                    client_epoch,
                    worker_epoch: WORKER_EPOCH,
                    identity: current,
                    checkpoint,
                    checkpoint_hash: wire_hash(checkpoint_hash),
                };
                encode_response_v1(&response).unwrap_or_else(|error| {
                    encode_error(
                        request_id,
                        client_epoch,
                        "checkpoint-control-capacity",
                        format!(
                            "exact checkpoint exceeds the 8 MiB control lane; use the durable bulk save lane: {}",
                            error.message
                        ),
                        Some(wire_identity(&runtime.identity())),
                    )
                })
            }
            Err(error) => encode_error(request_id, client_epoch, error.code, error.message, Some(current)),
        }
    })
}

/// Lower-priority detached platform lane. Rust owns request identity,
/// backpressure, retry policy, durable receipt validation, and dispatcher
/// revisions. TypeScript only executes one complete opaque BWPR and returns
/// its exact BWPA under the Rust-issued transfer token.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_bulk_v2(handle: u32, control_bytes: &[u8], attachment_bytes: &[u8]) -> Vec<u8> {
    let Ok(request) = decode_bulk_request_v1(control_bytes, attachment_bytes) else {
        return Vec::new();
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let response = match store.runtimes.get_mut(&handle) {
            None => RuntimeBulkResponseV1::Error {
                request_id: request.request_id(),
                client_epoch: request.client_epoch(),
                worker_epoch: WORKER_EPOCH,
                code: "invalid-handle".into(),
                message: "unknown integrated runtime handle".into(),
                current: None,
            },
            Some(runtime) => {
                let current = RuntimeBulkStateV1::from(&wire_identity(&runtime.identity()));
                let expected = request.expected();
                if expected != &current {
                    RuntimeBulkResponseV1::Error {
                        request_id: request.request_id(),
                        client_epoch: request.client_epoch(),
                        worker_epoch: WORKER_EPOCH,
                        code: "stale-runtime".into(),
                        message: "bulk platform request references obsolete authority".into(),
                        current: Some(current),
                    }
                } else {
                    match request {
                        RuntimeBulkRequestV1::Poll {
                            request_id,
                            client_epoch,
                            max_bytes,
                            ..
                        } => match runtime.poll_persistence_platform(max_bytes as usize) {
                            Ok(Some(packet)) => RuntimeBulkResponseV1::PlatformRequest {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                current: RuntimeBulkStateV1::from(&wire_identity(&runtime.identity())),
                                transfer_token: packet.transfer_token,
                                type_id: PERSISTENCE_REQUEST_TYPE_V1.into(),
                                payload: packet.bytes,
                            },
                            Ok(None) => RuntimeBulkResponseV1::Empty {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                current,
                            },
                            Err(error) => RuntimeBulkResponseV1::Error {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                code: error.code,
                                message: error.message,
                                current: Some(RuntimeBulkStateV1::from(&wire_identity(&runtime.identity()))),
                            },
                        },
                        RuntimeBulkRequestV1::Complete {
                            request_id,
                            client_epoch,
                            transfer_token,
                            payload,
                            ..
                        } => match runtime.complete_persistence_platform(transfer_token, &payload) {
                            Ok(outcome) => RuntimeBulkResponseV1::Completed {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                current: RuntimeBulkStateV1::from(&wire_identity(&runtime.identity())),
                                transfer_token,
                                result_hash: persistence_outcome_hash(&outcome),
                            },
                            Err(error) => RuntimeBulkResponseV1::Error {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                code: error.code,
                                message: error.message,
                                current: Some(RuntimeBulkStateV1::from(&wire_identity(&runtime.identity()))),
                            },
                        },
                        RuntimeBulkRequestV1::StageSaveChunk {
                            request_id,
                            client_epoch,
                            stage_id,
                            chunk_index,
                            chunk_count,
                            total_bytes,
                            payload,
                            ..
                        } => match runtime.stage_compatibility_save_chunk(
                            &stage_id,
                            chunk_index,
                            chunk_count,
                            total_bytes,
                            &payload,
                        ) {
                            Ok(progress) => RuntimeBulkResponseV1::SaveProgress {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                current: RuntimeBulkStateV1::from(&wire_identity(&runtime.identity())),
                                stage_id: progress.stage_id,
                                state: RuntimeBulkSaveStageStateV1::Staged,
                                received_chunks: progress.received_chunks,
                                chunk_count: progress.chunk_count,
                                received_bytes: progress.received_bytes,
                                set_hash: WireHash(progress.set_hash.0),
                                manifest_hash: WireHash(progress.manifest_hash.0),
                                dispatcher_request_id: progress.dispatcher_request_id.unwrap_or_default(),
                                remaining_dirty_records: progress.remaining_dirty_records,
                            },
                            Err(error) => bulk_runtime_error(request_id, client_epoch, error, runtime),
                        },
                        RuntimeBulkRequestV1::FinalizeSave {
                            request_id,
                            client_epoch,
                            stage_id,
                            created_at,
                            ..
                        } => match runtime.finalize_compatibility_save(&stage_id, created_at) {
                            Ok(progress) => RuntimeBulkResponseV1::SaveProgress {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                current: RuntimeBulkStateV1::from(&wire_identity(&runtime.identity())),
                                stage_id: progress.stage_id,
                                state: RuntimeBulkSaveStageStateV1::Finalized,
                                received_chunks: progress.received_chunks,
                                chunk_count: progress.chunk_count,
                                received_bytes: progress.received_bytes,
                                set_hash: WireHash(progress.set_hash.0),
                                manifest_hash: WireHash(progress.manifest_hash.0),
                                dispatcher_request_id: progress.dispatcher_request_id.unwrap_or_default(),
                                remaining_dirty_records: progress.remaining_dirty_records,
                            },
                            Err(error) => bulk_runtime_error(request_id, client_epoch, error, runtime),
                        },
                        RuntimeBulkRequestV1::HydrateRecovery {
                            request_id,
                            client_epoch,
                            recovery_id,
                            ..
                        } => match runtime.hydrate_recovery(&recovery_id) {
                            Ok(summary) => RuntimeBulkResponseV1::Hydration {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                current: RuntimeBulkStateV1::from(&wire_identity(&runtime.identity())),
                                recovery_id: summary.recovery_id,
                                native_domains: summary.native_domains,
                                chunk_count: summary.chunk_count,
                                total_bytes: summary.total_bytes,
                                compatibility_hash: WireHash(summary.compatibility_hash.0),
                                legacy_migration: summary.legacy_migration.map(|value| {
                                    RuntimeLegacyMigrationAttestationWireV1 {
                                        migration_id: value.migration_id,
                                        created_at: value.created_at,
                                        source_key: value.source_key,
                                        source_format: value.source_format,
                                        source_byte_length: value.source_byte_length,
                                        source_hash: WireHash(value.source_hash.0),
                                        projection_hash: WireHash(value.projection_hash.0),
                                        projection_edit_count: value.projection_edit_count,
                                        projection_facing_count: value.projection_facing_count,
                                        native_world_semantic_hash: WireHash(value.native_world_semantic_hash.0),
                                        native_world_edit_count: value.native_world_edit_count,
                                        native_world_facing_count: value.native_world_facing_count,
                                        world_id: value.world_id,
                                        universe_id: value.universe_id,
                                        location_id: value.location_id,
                                        world_seed: value.world_seed,
                                        generator_hash: WireHash(value.generator_hash.0),
                                        content_hash: WireHash(value.content_hash.0),
                                        terrain_content_hash: WireHash(value.terrain_content_hash.0),
                                        generation_options_hash: WireHash(value.generation_options_hash.0),
                                        backup_byte_length: value.backup_byte_length,
                                        backup_hash: WireHash(value.backup_hash.0),
                                        backup_chunks: value.backup_chunks,
                                        native_record_set_hash: WireHash(value.native_record_set_hash.0),
                                        descriptor_hash: WireHash(value.descriptor_hash.0),
                                        save_set_hash: WireHash(value.save_set_hash.0),
                                        manifest_hash: WireHash(value.manifest_hash.0),
                                    }
                                }),
                            },
                            Err(error) => bulk_runtime_error(request_id, client_epoch, error, runtime),
                        },
                        RuntimeBulkRequestV1::ReadHydratedCompatibility {
                            request_id,
                            client_epoch,
                            recovery_id,
                            chunk_index,
                            ..
                        } => match runtime.read_hydrated_compatibility_chunk(&recovery_id, chunk_index) {
                            Ok(chunk) => RuntimeBulkResponseV1::Data {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                current: RuntimeBulkStateV1::from(&wire_identity(&runtime.identity())),
                                transfer_token: chunk.transfer_token,
                                type_id: PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1.into(),
                                chunk_index: chunk.chunk_index,
                                chunk_count: chunk.chunk_count,
                                payload: chunk.bytes,
                            },
                            Err(error) => bulk_runtime_error(request_id, client_epoch, error, runtime),
                        },
                        RuntimeBulkRequestV1::CancelSaveStage {
                            request_id,
                            client_epoch,
                            stage_id,
                            ..
                        } => match runtime.cancel_compatibility_save_stage(&stage_id) {
                            Ok(progress) => RuntimeBulkResponseV1::SaveProgress {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                current: RuntimeBulkStateV1::from(&wire_identity(&runtime.identity())),
                                stage_id: progress.stage_id,
                                state: RuntimeBulkSaveStageStateV1::Cancelled,
                                received_chunks: progress.received_chunks,
                                chunk_count: progress.chunk_count,
                                received_bytes: progress.received_bytes,
                                set_hash: WireHash::default(),
                                manifest_hash: WireHash::default(),
                                dispatcher_request_id: 0,
                                remaining_dirty_records: 0,
                            },
                            Err(error) => bulk_runtime_error(request_id, client_epoch, error, runtime),
                        },
                        RuntimeBulkRequestV1::PersistenceStatus {
                            request_id,
                            client_epoch,
                            payload,
                            ..
                        } => match decode_runtime_persistence_status_query_v1(&payload) {
                            Err(error) => RuntimeBulkResponseV1::Error {
                                request_id,
                                client_epoch,
                                worker_epoch: WORKER_EPOCH,
                                code: error.code.into(),
                                message: error.message,
                                current: Some(current),
                            },
                            Ok(()) => match runtime.persistence_status() {
                                Err(error) => bulk_runtime_error(request_id, client_epoch, error, runtime),
                                Ok(status) => match encode_runtime_persistence_status_receipt_v1(&status) {
                                    Err(error) => RuntimeBulkResponseV1::Error {
                                        request_id,
                                        client_epoch,
                                        worker_epoch: WORKER_EPOCH,
                                        code: error.code.into(),
                                        message: error.message,
                                        current: Some(current),
                                    },
                                    Ok(payload) => RuntimeBulkResponseV1::PersistenceStatus {
                                        request_id,
                                        client_epoch,
                                        worker_epoch: WORKER_EPOCH,
                                        current,
                                        type_id: PERSISTENCE_STATUS_RECEIPT_TYPE_V1.into(),
                                        payload,
                                    },
                                },
                            },
                        },
                    }
                }
            }
        };
        encode_bulk_control(handle, response, &mut store.bulk_attachments)
    })
}

/// Creates the first canonical save set for a new native world without
/// fabricating a legacy WorldSave source. The control payload reuses the
/// bounded `FinalizeSave` identity/timestamp shape. Worlds that already own
/// compatibility source bytes fail closed so this route cannot delete them.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_initialize_native_save_v2(handle: u32, control_bytes: &[u8]) -> Vec<u8> {
    let Ok(request) = decode_bulk_request_v1(control_bytes, &[]) else {
        return Vec::new();
    };
    let RuntimeBulkRequestV1::FinalizeSave {
        request_id,
        client_epoch,
        expected,
        stage_id,
        created_at,
    } = request
    else {
        return Vec::new();
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let response = match store.runtimes.get_mut(&handle) {
            None => RuntimeBulkResponseV1::Error {
                request_id,
                client_epoch,
                worker_epoch: WORKER_EPOCH,
                code: "invalid-handle".into(),
                message: "unknown integrated runtime handle".into(),
                current: None,
            },
            Some(runtime) => {
                let current = RuntimeBulkStateV1::from(&wire_identity(&runtime.identity()));
                if expected != current {
                    RuntimeBulkResponseV1::Error {
                        request_id,
                        client_epoch,
                        worker_epoch: WORKER_EPOCH,
                        code: "stale-runtime".into(),
                        message: "native save initialization references obsolete authority".into(),
                        current: Some(current),
                    }
                } else {
                    match runtime.finalize_native_save(&stage_id, created_at) {
                        Ok(progress) => RuntimeBulkResponseV1::SaveProgress {
                            request_id,
                            client_epoch,
                            worker_epoch: WORKER_EPOCH,
                            current: RuntimeBulkStateV1::from(&wire_identity(&runtime.identity())),
                            stage_id: progress.stage_id,
                            state: RuntimeBulkSaveStageStateV1::Finalized,
                            received_chunks: progress.received_chunks,
                            chunk_count: progress.chunk_count,
                            received_bytes: progress.received_bytes,
                            set_hash: WireHash(progress.set_hash.0),
                            manifest_hash: WireHash(progress.manifest_hash.0),
                            dispatcher_request_id: progress.dispatcher_request_id.unwrap_or_default(),
                            remaining_dirty_records: progress.remaining_dirty_records,
                        },
                        Err(error) => bulk_runtime_error(request_id, client_epoch, error, runtime),
                    }
                }
            }
        };
        encode_bulk_control(handle, response, &mut store.bulk_attachments)
    })
}

/// Migrates a provably world-only legacy source after that exact source has
/// been streamed into `stage_id` through `StageSaveChunk`. The control is an
/// ordinary `FinalizeSave` bulk request, while `world_projection_bytes` is one
/// validated BWAS record. Non-zero legacy state flags fail closed and leave the
/// source stage intact for a richer host-domain adapter.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_migrate_legacy_v2(
    handle: u32,
    control_bytes: &[u8],
    legacy_non_world_state_flags: u32,
    source_key: &str,
    source_format: &str,
    world_projection_bytes: &[u8],
) -> Vec<u8> {
    let Ok(request) = decode_bulk_request_v1(control_bytes, &[]) else {
        return Vec::new();
    };
    let RuntimeBulkRequestV1::FinalizeSave {
        request_id,
        client_epoch,
        expected,
        stage_id,
        created_at,
    } = request
    else {
        return Vec::new();
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let response = match store.runtimes.get_mut(&handle) {
            None => RuntimeBulkResponseV1::Error {
                request_id,
                client_epoch,
                worker_epoch: WORKER_EPOCH,
                code: "invalid-handle".into(),
                message: "unknown integrated runtime handle".into(),
                current: None,
            },
            Some(runtime) => {
                let current = RuntimeBulkStateV1::from(&wire_identity(&runtime.identity()));
                if expected != current {
                    RuntimeBulkResponseV1::Error {
                        request_id,
                        client_epoch,
                        worker_epoch: WORKER_EPOCH,
                        code: "stale-runtime".into(),
                        message: "legacy migration references obsolete authority".into(),
                        current: Some(current),
                    }
                } else if legacy_non_world_state_flags > u32::from(u16::MAX) {
                    RuntimeBulkResponseV1::Error {
                        request_id,
                        client_epoch,
                        worker_epoch: WORKER_EPOCH,
                        code: "legacy-migration-flags".into(),
                        message: "legacy migration state flags exceed the V1 mask".into(),
                        current: Some(current),
                    }
                } else {
                    match runtime.migrate_pristine_legacy_world(IntegratedRuntimeLegacyMigrationV1 {
                        schema_version: INTEGRATED_RUNTIME_LEGACY_MIGRATION_SCHEMA_V1,
                        migration_id: stage_id.clone(),
                        source_stage_id: stage_id.clone(),
                        source_key: source_key.to_owned(),
                        source_format: source_format.to_owned(),
                        created_at,
                        legacy_non_world_state_flags: legacy_non_world_state_flags as u16,
                        world_projection: world_projection_bytes.to_vec(),
                    }) {
                        Ok(progress) => RuntimeBulkResponseV1::SaveProgress {
                            request_id,
                            client_epoch,
                            worker_epoch: WORKER_EPOCH,
                            current: RuntimeBulkStateV1::from(&wire_identity(&runtime.identity())),
                            stage_id: progress.stage_id,
                            state: RuntimeBulkSaveStageStateV1::Finalized,
                            received_chunks: progress.received_chunks,
                            chunk_count: progress.chunk_count,
                            received_bytes: progress.received_bytes,
                            set_hash: WireHash(progress.set_hash.0),
                            manifest_hash: WireHash(progress.manifest_hash.0),
                            dispatcher_request_id: progress.dispatcher_request_id.unwrap_or_default(),
                            remaining_dirty_records: progress.remaining_dirty_records,
                        },
                        Err(error) => bulk_runtime_error(request_id, client_epoch, error, runtime),
                    }
                }
            }
        };
        encode_bulk_control(handle, response, &mut store.bulk_attachments)
    })
}

/// Op 11. The normal FinalizeSave control envelope carries identity, stage,
/// and timestamp only. BWHP and BWAS remain distinct bounded arguments so the
/// browser cannot smuggle a pre-bound BWHE native fingerprint set.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_migrate_historical_external_v2(
    handle: u32,
    control_bytes: &[u8],
    proposal_bytes: &[u8],
    world_projection_bytes: &[u8],
) -> Vec<u8> {
    let Ok(request) = decode_bulk_request_v1(control_bytes, &[]) else {
        return Vec::new();
    };
    let RuntimeBulkRequestV1::FinalizeSave {
        request_id,
        client_epoch,
        expected,
        stage_id,
        created_at,
    } = request
    else {
        return Vec::new();
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let transfer_token = store.allocate_historical_transfer_token(handle);
        let IntegratedRuntimeStoreV2 {
            runtimes,
            bulk_attachments,
            ..
        } = &mut *store;
        match runtimes.get_mut(&handle) {
            None => encode_bulk_control(
                handle,
                RuntimeBulkResponseV1::Error {
                    request_id,
                    client_epoch,
                    worker_epoch: WORKER_EPOCH,
                    code: "invalid-handle".into(),
                    message: "unknown integrated runtime handle".into(),
                    current: None,
                },
                bulk_attachments,
            ),
            Some(runtime) => {
                let current = RuntimeBulkStateV1::from(&wire_identity(&runtime.identity()));
                if expected != current {
                    encode_bulk_control(
                        handle,
                        RuntimeBulkResponseV1::Error {
                            request_id,
                            client_epoch,
                            worker_epoch: WORKER_EPOCH,
                            code: "stale-runtime".into(),
                            message: "historical external migration references obsolete authority".into(),
                            current: Some(current),
                        },
                        bulk_attachments,
                    )
                } else {
                    encode_historical_external_operation(
                        handle,
                        runtime,
                        bulk_attachments,
                        request_id,
                        client_epoch,
                        transfer_token,
                        |candidate| {
                            candidate.migrate_historical_external_v2(
                                &stage_id,
                                created_at,
                                proposal_bytes,
                                world_projection_bytes,
                            )
                        },
                    )
                }
            }
        }
    })
}

/// Op 12. Advances one durable BWHE head using the exact browser BWHP CAS
/// proposal, separately staged opaque successor document, and the canonical
/// wire bytes of the durable checkpoint it must extend.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_finalize_historical_external_save_v2(
    handle: u32,
    control_bytes: &[u8],
    proposal_bytes: &[u8],
    expected_prior_checkpoint_bytes: &[u8],
) -> Vec<u8> {
    let Ok(request) = decode_bulk_request_v1(control_bytes, &[]) else {
        return Vec::new();
    };
    let RuntimeBulkRequestV1::FinalizeSave {
        request_id,
        client_epoch,
        expected,
        stage_id,
        created_at,
    } = request
    else {
        return Vec::new();
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let transfer_token = store.allocate_historical_transfer_token(handle);
        let IntegratedRuntimeStoreV2 {
            runtimes,
            bulk_attachments,
            ..
        } = &mut *store;
        match runtimes.get_mut(&handle) {
            None => encode_bulk_control(
                handle,
                RuntimeBulkResponseV1::Error {
                    request_id,
                    client_epoch,
                    worker_epoch: WORKER_EPOCH,
                    code: "invalid-handle".into(),
                    message: "unknown integrated runtime handle".into(),
                    current: None,
                },
                bulk_attachments,
            ),
            Some(runtime) => {
                let current = RuntimeBulkStateV1::from(&wire_identity(&runtime.identity()));
                if expected != current {
                    encode_bulk_control(
                        handle,
                        RuntimeBulkResponseV1::Error {
                            request_id,
                            client_epoch,
                            worker_epoch: WORKER_EPOCH,
                            code: "stale-runtime".into(),
                            message: "historical external save references obsolete authority".into(),
                            current: Some(current),
                        },
                        bulk_attachments,
                    )
                } else {
                    encode_historical_external_operation(
                        handle,
                        runtime,
                        bulk_attachments,
                        request_id,
                        client_epoch,
                        transfer_token,
                        |candidate| {
                            candidate.finalize_historical_external_save_v2(
                                &stage_id,
                                created_at,
                                proposal_bytes,
                                expected_prior_checkpoint_bytes,
                            )
                        },
                    )
                }
            }
        }
    })
}

/// Op 13. Hydrates and attests a descriptor-bound external/native pair. It
/// deliberately reuses only the generic HydrateRecovery control shape.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_hydrate_historical_external_v2(handle: u32, control_bytes: &[u8]) -> Vec<u8> {
    let Ok(request) = decode_bulk_request_v1(control_bytes, &[]) else {
        return Vec::new();
    };
    let RuntimeBulkRequestV1::HydrateRecovery {
        request_id,
        client_epoch,
        expected,
        recovery_id,
    } = request
    else {
        return Vec::new();
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let transfer_token = store.allocate_historical_transfer_token(handle);
        let IntegratedRuntimeStoreV2 {
            runtimes,
            bulk_attachments,
            ..
        } = &mut *store;
        match runtimes.get_mut(&handle) {
            None => encode_bulk_control(
                handle,
                RuntimeBulkResponseV1::Error {
                    request_id,
                    client_epoch,
                    worker_epoch: WORKER_EPOCH,
                    code: "invalid-handle".into(),
                    message: "unknown integrated runtime handle".into(),
                    current: None,
                },
                bulk_attachments,
            ),
            Some(runtime) => {
                let current = RuntimeBulkStateV1::from(&wire_identity(&runtime.identity()));
                if expected != current {
                    encode_bulk_control(
                        handle,
                        RuntimeBulkResponseV1::Error {
                            request_id,
                            client_epoch,
                            worker_epoch: WORKER_EPOCH,
                            code: "stale-runtime".into(),
                            message: "historical external recovery references obsolete authority".into(),
                            current: Some(current),
                        },
                        bulk_attachments,
                    )
                } else {
                    encode_historical_external_operation(
                        handle,
                        runtime,
                        bulk_attachments,
                        request_id,
                        client_epoch,
                        transfer_token,
                        |candidate| candidate.hydrate_historical_external_recovery_v2(&recovery_id),
                    )
                }
            }
        }
    })
}

/// Op 14. Builds a Rust-authored BWFP repair from one exact BWHO browser
/// observation and the already hydrated direct-parent authority. FinalizeSave
/// supplies only expected runtime identity, fallback recovery id, and the
/// deterministic observed-latest timestamp; BWHO remains a distinct argument.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_reconcile_historical_external_fallback_v2(
    handle: u32,
    control_bytes: &[u8],
    observation_bytes: &[u8],
) -> Vec<u8> {
    let Ok(request) = decode_bulk_request_v1(control_bytes, &[]) else {
        return Vec::new();
    };
    let RuntimeBulkRequestV1::FinalizeSave {
        request_id,
        client_epoch,
        expected,
        stage_id: fallback_recovery_id,
        created_at,
    } = request
    else {
        return Vec::new();
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let transfer_token = store.allocate_historical_transfer_token(handle);
        let IntegratedRuntimeStoreV2 {
            runtimes,
            bulk_attachments,
            ..
        } = &mut *store;
        match runtimes.get_mut(&handle) {
            None => encode_bulk_control(
                handle,
                RuntimeBulkResponseV1::Error {
                    request_id,
                    client_epoch,
                    worker_epoch: WORKER_EPOCH,
                    code: "invalid-handle".into(),
                    message: "unknown integrated runtime handle".into(),
                    current: None,
                },
                bulk_attachments,
            ),
            Some(runtime) => {
                let current = RuntimeBulkStateV1::from(&wire_identity(&runtime.identity()));
                if expected != current {
                    encode_bulk_control(
                        handle,
                        RuntimeBulkResponseV1::Error {
                            request_id,
                            client_epoch,
                            worker_epoch: WORKER_EPOCH,
                            code: "stale-runtime".into(),
                            message: "historical fallback reconciliation references obsolete authority".into(),
                            current: Some(current),
                        },
                        bulk_attachments,
                    )
                } else {
                    encode_historical_external_operation(
                        handle,
                        runtime,
                        bulk_attachments,
                        request_id,
                        client_epoch,
                        transfer_token,
                        |candidate| {
                            candidate.reconcile_historical_external_fallback_v2(
                                &fallback_recovery_id,
                                created_at,
                                observation_bytes,
                            )
                        },
                    )
                }
            }
        }
    })
}

/// Moves one Rust-owned platform attachment out of Wasm exactly once.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_bulk_take_attachment_v2(handle: u32, transfer_token: f64) -> Vec<u8> {
    if !transfer_token.is_finite()
        || !(1.0..=9_007_199_254_740_991.0).contains(&transfer_token)
        || transfer_token.fract() != 0.0
    {
        return Vec::new();
    }
    let transfer_token = transfer_token as u64;
    INTEGRATED_RUNTIMES.with(|store| {
        store
            .borrow_mut()
            .bulk_attachments
            .remove(&(handle, transfer_token))
            .unwrap_or_default()
    })
}

/// Destroys the generational handle. A stale expected identity is rejected and
/// leaves the authority alive for an explicit synchronized retry.
#[wasm_bindgen]
#[must_use]
pub fn blockwild_runtime_destroy_v2(handle: u32, request_bytes: &[u8]) -> Vec<u8> {
    let Ok(request) = decode_request_v1(request_bytes) else {
        return Vec::new();
    };
    let RuntimeRequestV1::Shutdown {
        request_id,
        client_epoch,
        expected,
    } = request
    else {
        return encode_error(
            request.request_id(),
            request.client_epoch(),
            "wrong-operation",
            "destroy export requires a shutdown request",
            None,
        );
    };
    INTEGRATED_RUNTIMES.with(|store| {
        let mut store = store.borrow_mut();
        let Some(current) = store
            .runtimes
            .get(&handle)
            .map(|runtime| wire_identity(&runtime.identity()))
        else {
            return encode_error(
                request_id,
                client_epoch,
                "invalid-handle",
                "unknown integrated runtime handle",
                None,
            );
        };
        if expected.as_ref().is_some_and(|identity| identity != &current) {
            return encode_error(
                request_id,
                client_epoch,
                "stale-runtime",
                "shutdown references obsolete authority",
                Some(current),
            );
        }
        let mut runtime = store.runtimes.remove(&handle).expect("runtime handle was checked");
        store
            .bulk_attachments
            .retain(|(runtime_handle, _), _| *runtime_handle != handle);
        store.extraction_cursors.remove(&handle);
        store
            .step_v2_retries
            .retain(|(runtime_handle, _, _), _| *runtime_handle != handle);
        store
            .step_v2_retry_order
            .retain(|(runtime_handle, _, _)| *runtime_handle != handle);
        runtime.shutdown();
        encode(RuntimeResponseV1::Shutdown {
            request_id,
            client_epoch,
            worker_epoch: WORKER_EPOCH,
        })
    })
}

fn create_runtime(config: RuntimeConfigV1) -> Result<IntegratedRuntimeV2, (String, String)> {
    let content_hash = canonical_hash(config.content_hash);
    let generator_hash = canonical_hash(config.generator_hash);
    let terrain_content_hash = canonical_hash(config.terrain_content_hash);
    let runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
        world_seed: config.world_seed,
        universe_id: config.universe_id,
        location_id: config.location_id,
        session_id: config.session_id,
        terrain_content_hash,
        generation_options_json: config.generation_options_json,
        content_hash,
        generator_hash,
        block_catalog: BlockCatalogV1 {
            directional_blocks: config.directional_block_ids.into_iter().collect::<BTreeSet<_>>(),
            waterlogged_blocks: config.waterlogged_block_ids.into_iter().collect::<BTreeSet<_>>(),
            water_block_id: config.water_block_id,
        },
    })
    .map_err(|error| (error.code, error.message))?;
    Ok(runtime)
}

fn dispatch_command(
    runtime: &IntegratedRuntimeV2,
    batch: &RuntimeCommandBatchV1,
) -> Result<(IntegratedRuntimeV2, Vec<RuntimeDomainOperationV1>), (String, String)> {
    let combat_bind_count = batch
        .operations
        .iter()
        .filter(|operation| {
            operation.domain == RuntimeDomainV1::Simulation && operation.type_id == SIMULATION_PLAYER_BIND_TYPE_V4
        })
        .count();
    let player_bind_count = batch
        .operations
        .iter()
        .filter(|operation| {
            operation.domain == RuntimeDomainV1::Simulation
                && matches!(
                    operation.type_id.as_str(),
                    SIMULATION_PLAYER_BIND_TYPE_V2 | SIMULATION_PLAYER_BIND_TYPE_V3 | SIMULATION_PLAYER_BIND_TYPE_V4
                )
        })
        .count();
    if combat_bind_count > 1 || (combat_bind_count == 1 && player_bind_count != 1) {
        return Err((
            "player-combat-bind-count".into(),
            "a player combat bind V4 must be the outer transaction's only player-bind operation".into(),
        ));
    }
    let mut candidate = runtime.clone();
    let mut receipts = Vec::with_capacity(batch.operations.len());
    let mut deferred_final_bind_receipts = Vec::<(usize, WireHash)>::new();
    let mut deferred_combat_bind_receipts = Vec::<(usize, WireHash)>::new();
    for (index, operation) in batch.operations.iter().enumerate() {
        let expected_schema = match (operation.domain, operation.type_id.as_str()) {
            (RuntimeDomainV1::Simulation, SIMULATION_PLAYER_BIND_TYPE_V2) => {
                blockwild_engine::SIMULATION_PLAYER_BIND_V2_OPERATION_SCHEMA
            }
            (RuntimeDomainV1::Simulation, SIMULATION_PLAYER_BIND_TYPE_V3) => {
                blockwild_engine::SIMULATION_PLAYER_BIND_V3_OPERATION_SCHEMA
            }
            (RuntimeDomainV1::Simulation, SIMULATION_PLAYER_BIND_TYPE_V4) => {
                blockwild_engine::SIMULATION_PLAYER_BIND_V4_OPERATION_SCHEMA
            }
            (RuntimeDomainV1::Simulation, CONTEXT_COMMAND_CONTINUITY_TYPE_V2) => {
                blockwild_engine::CONTEXT_COMMAND_CONTINUITY_V2_OPERATION_SCHEMA
            }
            (RuntimeDomainV1::World, TERRAIN_RESIDENCY_RECONCILE_BATCH_TYPE_V2) => 2,
            (RuntimeDomainV1::Gameplay, NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2) => {
                blockwild_engine::NATIVE_BLOCK_EDIT_RECEIPT_V2_OPERATION_SCHEMA
            }
            _ => 1,
        };
        if operation.schema != expected_schema {
            return Err((
                "unsupported-domain-schema".into(),
                format!(
                    "{}:{} schema {} is not registered",
                    domain_name(operation.domain),
                    operation.type_id,
                    operation.schema
                ),
            ));
        }
        let response = match (operation.domain, operation.type_id.as_str()) {
            (RuntimeDomainV1::World, TERRAIN_RESIDENCY_BATCH_TYPE_V1) => {
                let request = decode_terrain_residency_batch_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let receipt = candidate
                    .ensure_terrain_residency(&request)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::World,
                    TERRAIN_RESIDENCY_RECEIPT_TYPE_V1,
                    encode_terrain_residency_receipt_v1(&receipt)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::World, TERRAIN_RESIDENCY_RECONCILE_BATCH_TYPE_V2) => {
                let request = decode_terrain_residency_reconcile_batch_v2(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let receipt = candidate
                    .reconcile_terrain_residency_on_transaction_candidate(&request)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation_with_schema(
                    RuntimeDomainV1::World,
                    TERRAIN_RESIDENCY_RECONCILE_RECEIPT_TYPE_V2,
                    2,
                    encode_terrain_residency_reconcile_receipt_v2(&receipt)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Simulation, SIMULATION_PLAYER_BIND_TYPE_V2) => {
                let binding = decode_runtime_player_binding_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                candidate
                    .bind_player(binding)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_RECEIPT_TYPE_V2,
                    2,
                    domain_ack(
                        blockwild_engine::SIMULATION_PLAYER_BIND_RECEIPT_V2_MAGIC,
                        blockwild_engine::SIMULATION_PLAYER_BIND_RECEIPT_V2_INNER_SCHEMA,
                        operation,
                        &candidate,
                    ),
                )
            }
            (RuntimeDomainV1::Simulation, SIMULATION_PLAYER_BIND_TYPE_V3) => {
                let binding = decode_runtime_player_binding_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                candidate
                    .bind_player(binding)
                    .map_err(|error| (error.code, error.message))?;
                deferred_final_bind_receipts.push((receipts.len(), operation.payload_hash));
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V3,
                    3,
                    final_bind_ack(operation.payload_hash, &candidate),
                )
            }
            (RuntimeDomainV1::Simulation, SIMULATION_PLAYER_BIND_TYPE_V4) => {
                let binding = decode_runtime_player_binding_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                candidate
                    .bind_player(binding)
                    .map_err(|error| (error.code, error.message))?;
                deferred_combat_bind_receipts.push((receipts.len(), operation.payload_hash));
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V4,
                    4,
                    final_combat_bind_ack(operation.payload_hash, &candidate),
                )
            }
            (RuntimeDomainV1::Simulation, SIMULATION_CAMERA_CONFIG_TYPE_V1) => {
                let request = decode_runtime_camera_config_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let receipt = candidate
                    .apply_camera_config(request, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_CAMERA_CONFIG_RECEIPT_TYPE_V1,
                    encode_runtime_camera_config_receipt_v1(&receipt)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Simulation, PLAYER_GAME_MODE_SET_TYPE_V1) => {
                let request = decode_player_game_mode_set_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                if batch.actor_id != request.actor_id {
                    return Err((
                        "player-game-mode-actor".into(),
                        "outer command actor does not own the player game-mode request".into(),
                    ));
                }
                let receipt = candidate
                    .set_player_game_mode(request, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Simulation,
                    PLAYER_GAME_MODE_SET_RECEIPT_TYPE_V1,
                    encode_player_game_mode_set_receipt_v1(&receipt)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Simulation, PLAYER_RESPAWN_TYPE_V1) => {
                let request =
                    decode_player_respawn_v1(&operation.payload).map_err(|error| (error.code.into(), error.message))?;
                if batch.actor_id != request.actor_id {
                    return Err((
                        "player-respawn-actor".into(),
                        "outer command actor does not own the player respawn request".into(),
                    ));
                }
                let receipt = candidate
                    .respawn_player_v1(request, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Simulation,
                    PLAYER_RESPAWN_RECEIPT_TYPE_V1,
                    encode_player_respawn_receipt_v1(&receipt).map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Simulation, PLAYER_BOOTSTRAP_STATUS_TYPE_V1) => {
                let query = decode_player_bootstrap_status_query_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let status = candidate
                    .player_bootstrap_status(&query, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Simulation,
                    PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
                    encode_player_bootstrap_status_v1(&status).map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Simulation, PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1) => {
                let query = decode_player_combat_bootstrap_status_query_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let status = candidate
                    .player_combat_bootstrap_status_v1(&query, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Simulation,
                    PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
                    encode_player_combat_bootstrap_status_v1(&status)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Simulation, CONTEXT_COMMAND_CONTINUITY_TYPE_V2) => {
                let query = decode_runtime_context_command_continuity_query_v2(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let status = candidate
                    .context_command_continuity_status_v2(&query, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    CONTEXT_COMMAND_CONTINUITY_RECEIPT_TYPE_V2,
                    2,
                    encode_runtime_context_command_continuity_receipt_v2(&status)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Gameplay, BASIC_DIRT_ACTION_RECEIPT_TYPE_V1) => {
                let query = decode_runtime_basic_dirt_action_receipt_query_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let status = candidate
                    .basic_dirt_action_projection_status_v1(&query, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1,
                    encode_runtime_basic_dirt_action_projection_receipt_v1(&status)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Gameplay, NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1) => {
                let query = decode_runtime_native_block_edit_receipt_query_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let status = candidate
                    .native_block_edit_projection_status_v1(&query, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1,
                    encode_runtime_native_block_edit_projection_receipt_v1(&status)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Gameplay, NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2) => {
                let query = decode_runtime_native_block_edit_receipt_query_v2(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let status = candidate
                    .native_block_edit_projection_status_v2(&query, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation_with_schema(
                    RuntimeDomainV1::Gameplay,
                    NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V2,
                    2,
                    encode_runtime_native_block_edit_projection_receipt_v2(&status)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Gameplay, NATIVE_DROP_PICKUP_RECEIPT_TYPE_V1) => {
                let query = decode_runtime_native_drop_pickup_receipt_query_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let status = candidate
                    .native_drop_pickup_projection_status_v1(&query, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1,
                    encode_runtime_native_drop_pickup_projection_receipt_v1(&status)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Gameplay, NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1) => {
                let query = decode_runtime_native_player_drop_receipt_query_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let status = candidate
                    .native_player_drop_projection_status_v1(&query, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1,
                    encode_runtime_native_player_drop_projection_receipt_v1(&status)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Entities, ENTITY_AUTHORITY_EXPORT_TYPE_V1) => {
                let request = decode_entity_authority_export_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let snapshot = candidate
                    .export_entity_authority_snapshot(request.expected_revision)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(RuntimeDomainV1::Entities, ENTITY_AUTHORITY_SNAPSHOT_TYPE_V2, snapshot)
            }
            (RuntimeDomainV1::Entities, ENTITY_AUTHORITY_IMPORT_TYPE_V2) => {
                let request = decode_entity_authority_import_v2(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let receipt = candidate
                    .import_entity_authority_snapshot(request.expected_revision, &request.snapshot)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Entities,
                    ENTITY_AUTHORITY_IMPORT_RECEIPT_TYPE_V1,
                    encode_entity_authority_import_receipt_v1(receipt)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Entities, ENTITY_COMPATIBILITY_EXPORT_TYPE_V1) => {
                let request = decode_entity_compatibility_export_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let record = candidate
                    .export_entity_compatibility_record(request.entity_id, request.expected_entity_revision)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(RuntimeDomainV1::Entities, ENTITY_COMPATIBILITY_RECORD_TYPE_V1, record)
            }
            (RuntimeDomainV1::Entities, ENTITY_COMPATIBILITY_IMPORT_TYPE_V1) => {
                let request = decode_entity_compatibility_import_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let receipt = candidate
                    .import_entity_compatibility_record(request)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Entities,
                    ENTITY_RECEIPT_TYPE_V1,
                    encode_entity_event_batch_v1(&receipt).map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Entities, ENTITY_COMMAND_TYPE_V1) => {
                let command = decode_entity_command_batch_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let mut root = IntegratedRuntimeBatchV2::empty(
                    format!("{}:entity:{index}", batch.command_id),
                    candidate.identity(),
                );
                root.entities.push(command);
                match candidate.commit(root) {
                    IntegratedRuntimeReceiptV2::Accepted(receipt) => {
                        let event = receipt.entities.first().ok_or_else(|| {
                            (
                                "entity-receipt".into(),
                                "entity command returned no native receipt".into(),
                            )
                        })?;
                        domain_operation(
                            RuntimeDomainV1::Entities,
                            ENTITY_RECEIPT_TYPE_V1,
                            encode_entity_event_batch_v1(event).map_err(|error| (error.code.into(), error.message))?,
                        )
                    }
                    IntegratedRuntimeReceiptV2::Rejected(rejection) => {
                        return Err((rejection.code, rejection.message));
                    }
                }
            }
            (RuntimeDomainV1::Gameplay, GAMEPLAY_ACTOR_GRANT_TYPE_V1) => {
                let (actor_id, grant) = decode_gameplay_actor_grant_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                candidate
                    .grant_gameplay_actor(actor_id, grant)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    GAMEPLAY_ACTOR_GRANT_RECEIPT_TYPE_V1,
                    domain_ack(
                        blockwild_engine::GAMEPLAY_ACTOR_GRANT_RECEIPT_V1_MAGIC,
                        blockwild_engine::GAMEPLAY_ACTOR_GRANT_RECEIPT_V1_INNER_SCHEMA,
                        operation,
                        &candidate,
                    ),
                )
            }
            (RuntimeDomainV1::Gameplay, CONTENT_INSTALL_PAGE_TYPE_V1) => {
                let command = decode_content_install_page_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let page_hash = CanonicalHash(wire_checksum_v1(&operation.payload));
                let receipt = candidate
                    .install_content_page(command, page_hash)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    CONTENT_INSTALL_RECEIPT_TYPE_V1,
                    encode_content_install_receipt_v1(&receipt).map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Gameplay, PLAYER_INVENTORY_IMPORT_TYPE_V1) => {
                let command = decode_player_inventory_import_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let receipt = candidate
                    .import_player_inventory(command, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    PLAYER_INVENTORY_IMPORT_RECEIPT_TYPE_V1,
                    encode_player_inventory_import_receipt_v1(&receipt)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Gameplay, PLAYER_CREATIVE_SLOT_SET_TYPE_V1) => {
                let command = decode_player_creative_slot_set_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let receipt = candidate
                    .set_player_creative_slot(command, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    PLAYER_CREATIVE_SLOT_SET_RECEIPT_TYPE_V1,
                    encode_player_creative_slot_set_receipt_v1(&receipt)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Gameplay, PLAYER_LOCATOR_ITEM_CONSUME_TYPE_V1) => {
                let command = decode_player_locator_item_consume_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let receipt = candidate
                    .consume_player_locator_item(command, CanonicalHash(operation.payload_hash.0))
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_TYPE_V1,
                    encode_player_locator_item_consume_receipt_v1(&receipt)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Gameplay, GAMEPLAY_COMMAND_TYPE_V1) => {
                let command =
                    decode_gameplay_batch_v1(&operation.payload).map_err(|error| (error.code.into(), error.message))?;
                let mut root = IntegratedRuntimeBatchV2::empty(
                    format!("{}:gameplay:{index}", batch.command_id),
                    candidate.identity(),
                );
                root.gameplay.push(command);
                match candidate.commit(root) {
                    IntegratedRuntimeReceiptV2::Accepted(receipt) => {
                        let gameplay = receipt.gameplay.first().ok_or_else(|| {
                            (
                                "gameplay-receipt".into(),
                                "gameplay command returned no native receipt".into(),
                            )
                        })?;
                        domain_operation(
                            RuntimeDomainV1::Gameplay,
                            GAMEPLAY_RECEIPT_TYPE_V1,
                            encode_gameplay_receipt_v1(gameplay).map_err(|error| (error.code.into(), error.message))?,
                        )
                    }
                    IntegratedRuntimeReceiptV2::Rejected(rejection) => {
                        return Err((rejection.code, rejection.message));
                    }
                }
            }
            (RuntimeDomainV1::Persistence, PERSISTENCE_DISPATCH_TYPE_V1) => {
                let command = decode_runtime_persistence_dispatch_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let receipt = candidate
                    .dispatch_persistence(command)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Persistence,
                    PERSISTENCE_DISPATCH_RECEIPT_TYPE_V1,
                    encode_runtime_persistence_dispatch_receipt_v1(&receipt)
                        .map_err(|error| (error.code.into(), error.message))?,
                )
            }
            (RuntimeDomainV1::Network, NETWORK_PEER_GRANT_TYPE_V1) => {
                let grant = decode_network_peer_grant_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                candidate
                    .upsert_network_peer_grant(grant)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Network,
                    NETWORK_GRANT_RECEIPT_TYPE_V1,
                    domain_ack(
                        blockwild_engine::NETWORK_PEER_GRANT_RECEIPT_V1_MAGIC,
                        blockwild_engine::NETWORK_PEER_GRANT_RECEIPT_V1_INNER_SCHEMA,
                        operation,
                        &candidate,
                    ),
                )
            }
            (RuntimeDomainV1::Network, NETWORK_AGENT_GRANT_TYPE_V1) => {
                let grant = decode_network_agent_grant_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                candidate
                    .upsert_network_agent_grant(grant)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Network,
                    NETWORK_GRANT_RECEIPT_TYPE_V1,
                    domain_ack(
                        blockwild_engine::NETWORK_AGENT_GRANT_RECEIPT_V1_MAGIC,
                        blockwild_engine::NETWORK_AGENT_GRANT_RECEIPT_V1_INNER_SCHEMA,
                        operation,
                        &candidate,
                    ),
                )
            }
            (RuntimeDomainV1::Network, NETWORK_REPLICATION_UPSERT_TYPE_V1) => {
                let value = decode_network_replication_record_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                candidate
                    .upsert_network_replication_record(value)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Network,
                    NETWORK_REPLICATION_RECEIPT_TYPE_V1,
                    domain_ack(
                        blockwild_engine::NETWORK_REPLICATION_UPSERT_RECEIPT_V1_MAGIC,
                        blockwild_engine::NETWORK_REPLICATION_UPSERT_RECEIPT_V1_INNER_SCHEMA,
                        operation,
                        &candidate,
                    ),
                )
            }
            (RuntimeDomainV1::Network, NETWORK_REPLICATION_REMOVE_TYPE_V1) => {
                let value = decode_network_replication_record_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                if !candidate.remove_network_replication_record(&value.record) {
                    return Err((
                        "network-record-missing".into(),
                        "replication record is not registered".into(),
                    ));
                }
                domain_operation(
                    RuntimeDomainV1::Network,
                    NETWORK_REPLICATION_RECEIPT_TYPE_V1,
                    domain_ack(
                        blockwild_engine::NETWORK_REPLICATION_REMOVE_RECEIPT_V1_MAGIC,
                        blockwild_engine::NETWORK_REPLICATION_REMOVE_RECEIPT_V1_INNER_SCHEMA,
                        operation,
                        &candidate,
                    ),
                )
            }
            (RuntimeDomainV1::Network, NETWORK_DELTA_BUILD_TYPE_V1) => {
                let value = decode_network_delta_build_request_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let (delta, stats) = candidate
                    .build_network_delta(value.source, &value.interest)
                    .map_err(|error| (error.code, error.message))?;
                let packet =
                    encode_network_delta_v1(&delta).map_err(|error| ("network-delta".into(), error.to_string()))?;
                domain_operation(
                    RuntimeDomainV1::Network,
                    NETWORK_DELTA_BUILD_RESPONSE_TYPE_V1,
                    encode_delta_build_response(&packet, &stats),
                )
            }
            (RuntimeDomainV1::Network, NETWORK_RECONNECT_TYPE_V1) => {
                let value = decode_network_reconnect_request_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                let checkpoint = candidate
                    .network_reconnect_checkpoint(&value.session_id, &value.peer_id, value.connection_generation)
                    .map_err(|error| (error.code, error.message))?;
                let packet = checkpoint
                    .as_ref()
                    .map(encode_network_checkpoint_v1)
                    .transpose()
                    .map_err(|error| ("network-reconnect".into(), error.to_string()))?;
                domain_operation(
                    RuntimeDomainV1::Network,
                    NETWORK_RECONNECT_RESPONSE_TYPE_V1,
                    encode_reconnect_response(packet.as_deref()),
                )
            }
            (RuntimeDomainV1::Network, NETWORK_PEER_RELEASE_TYPE_V1) => {
                let peer_id = decode_network_peer_release_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                candidate
                    .release_network_peer(&peer_id)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Network,
                    NETWORK_PEER_RELEASE_RECEIPT_TYPE_V1,
                    domain_ack(
                        blockwild_engine::NETWORK_PEER_RELEASE_RECEIPT_V1_MAGIC,
                        blockwild_engine::NETWORK_PEER_RELEASE_RECEIPT_V1_INNER_SCHEMA,
                        operation,
                        &candidate,
                    ),
                )
            }
            (RuntimeDomainV1::Network, NETWORK_COMMAND_RELEASE_TYPE_V1) => {
                let command_id = decode_network_command_release_v1(&operation.payload)
                    .map_err(|error| (error.code.into(), error.message))?;
                candidate
                    .release_network_command(&command_id)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(
                    RuntimeDomainV1::Network,
                    NETWORK_COMMAND_RELEASE_RECEIPT_TYPE_V1,
                    domain_ack(
                        blockwild_engine::NETWORK_COMMAND_RELEASE_RECEIPT_V1_MAGIC,
                        blockwild_engine::NETWORK_COMMAND_RELEASE_RECEIPT_V1_INNER_SCHEMA,
                        operation,
                        &candidate,
                    ),
                )
            }
            (RuntimeDomainV1::Network, NETWORK_REQUEST_TYPE_V1) => {
                let payload = candidate
                    .process_network_browser_packet(&operation.payload)
                    .map_err(|error| (error.code, error.message))?;
                domain_operation(RuntimeDomainV1::Network, NETWORK_RESPONSE_TYPE_V1, payload)
            }
            _ => {
                return Err((
                    "unsupported-domain-codec".into(),
                    format!(
                        "{}:{} schema {} is not registered in the integrated runtime",
                        domain_name(operation.domain),
                        operation.type_id,
                        operation.schema,
                    ),
                ));
            }
        };
        receipts.push(response);
    }
    for _ in &deferred_combat_bind_receipts {
        candidate
            .install_bound_player_combatant_v1()
            .map_err(|error| (error.code, error.message))?;
    }
    for (receipt_index, request_hash) in deferred_final_bind_receipts {
        receipts[receipt_index] = domain_operation_with_schema(
            RuntimeDomainV1::Simulation,
            SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V3,
            3,
            final_bind_ack(request_hash, &candidate),
        );
    }
    for (receipt_index, request_hash) in deferred_combat_bind_receipts {
        receipts[receipt_index] = domain_operation_with_schema(
            RuntimeDomainV1::Simulation,
            SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V4,
            4,
            final_combat_bind_ack(request_hash, &candidate),
        );
    }
    Ok((candidate, receipts))
}

fn domain_operation(domain: RuntimeDomainV1, type_id: &str, payload: Vec<u8>) -> RuntimeDomainOperationV1 {
    domain_operation_with_schema(domain, type_id, 1, payload)
}

fn domain_operation_with_schema(
    domain: RuntimeDomainV1,
    type_id: &str,
    schema: u16,
    payload: Vec<u8>,
) -> RuntimeDomainOperationV1 {
    let payload_hash = WireHash(wire_checksum_v1(&payload));
    RuntimeDomainOperationV1 {
        domain,
        type_id: type_id.into(),
        schema,
        payload,
        payload_hash,
    }
}

fn domain_ack(
    magic: [u8; 4],
    inner_schema: u16,
    operation: &RuntimeDomainOperationV1,
    runtime: &IntegratedRuntimeV2,
) -> Vec<u8> {
    let mut payload = Vec::with_capacity(38);
    payload.extend_from_slice(&magic);
    payload.extend_from_slice(&inner_schema.to_le_bytes());
    payload.extend_from_slice(&operation.payload_hash.0);
    payload.extend_from_slice(runtime.state_hash().as_bytes());
    payload
}

fn final_bind_ack(request_hash: WireHash, runtime: &IntegratedRuntimeV2) -> Vec<u8> {
    blockwild_engine::encode_runtime_player_final_bind_receipt_v1(
        blockwild_engine::RuntimePlayerFinalBindVersionV1::InventoryV3,
        blockwild_engine::RuntimePlayerFinalBindReceiptWireV1 {
            request_payload_hash: CanonicalHash(request_hash.0),
            terminal_state_hash: runtime.state_hash(),
        },
    )
}

fn final_combat_bind_ack(request_hash: WireHash, runtime: &IntegratedRuntimeV2) -> Vec<u8> {
    blockwild_engine::encode_runtime_player_final_bind_receipt_v1(
        blockwild_engine::RuntimePlayerFinalBindVersionV1::CombatV4,
        blockwild_engine::RuntimePlayerFinalBindReceiptWireV1 {
            request_payload_hash: CanonicalHash(request_hash.0),
            terminal_state_hash: runtime.state_hash(),
        },
    )
}

fn encode_delta_build_response(packet: &[u8], stats: &InterestSelectionStatsV1) -> Vec<u8> {
    let mut payload = Vec::with_capacity(22 + packet.len());
    payload.extend_from_slice(&blockwild_engine::NETWORK_DELTA_BUILD_RESPONSE_V1_MAGIC);
    payload.extend_from_slice(&blockwild_engine::NETWORK_DELTA_BUILD_RESPONSE_V1_INNER_SCHEMA.to_le_bytes());
    payload.extend_from_slice(&(stats.scope_probes as u32).to_le_bytes());
    payload.extend_from_slice(&(stats.candidate_records as u32).to_le_bytes());
    payload.extend_from_slice(&(stats.emitted_records as u32).to_le_bytes());
    payload.extend_from_slice(&(packet.len() as u32).to_le_bytes());
    payload.extend_from_slice(packet);
    payload
}

fn encode_reconnect_response(packet: Option<&[u8]>) -> Vec<u8> {
    let mut payload = Vec::with_capacity(11 + packet.map_or(0, <[u8]>::len));
    payload.extend_from_slice(&blockwild_engine::NETWORK_RECONNECT_RESPONSE_V1_MAGIC);
    payload.extend_from_slice(&blockwild_engine::NETWORK_RECONNECT_RESPONSE_V1_INNER_SCHEMA.to_le_bytes());
    payload.push(u8::from(packet.is_some()));
    if let Some(packet) = packet {
        payload.extend_from_slice(&(packet.len() as u32).to_le_bytes());
        payload.extend_from_slice(packet);
    }
    payload
}

fn set_runtime_command_receipt_hash(receipt: &mut RuntimeCommandReceiptV1) {
    let hash = command_receipt_hash_v1(receipt);
    match receipt {
        RuntimeCommandReceiptV1::Accepted { receipt_hash, .. }
        | RuntimeCommandReceiptV1::Rejected { receipt_hash, .. } => *receipt_hash = hash,
    }
}

fn runtime_command_receipt_terminal_identity(receipt: &RuntimeCommandReceiptV1) -> &RuntimeIdentityV1 {
    match receipt {
        RuntimeCommandReceiptV1::Accepted { after, .. } => after,
        RuntimeCommandReceiptV1::Rejected { current, .. } => current,
    }
}

fn rejected_command_receipt(
    batch: &RuntimeCommandBatchV1,
    code: impl Into<String>,
    message: impl Into<String>,
    current: RuntimeIdentityV1,
) -> RuntimeCommandReceiptV1 {
    let code = code.into();
    let message = message.into();
    let mut receipt = RuntimeCommandReceiptV1::Rejected {
        command_id: batch.command_id.clone(),
        idempotency_key: batch.idempotency_key.clone(),
        command_hash: batch.command_hash,
        code,
        message,
        current,
        receipt_hash: WireHash::default(),
    };
    set_runtime_command_receipt_hash(&mut receipt);
    receipt
}

fn canonical_hash(hash: WireHash) -> CanonicalHash {
    CanonicalHash(hash.0)
}

fn wire_hash(hash: CanonicalHash) -> WireHash {
    WireHash(hash.0)
}

fn persistence_outcome_hash(outcome: &PersistenceDispatchOutcomeV1) -> WireHash {
    let mut bytes = Vec::with_capacity(128 + outcome.payload.len() + outcome.code.len() + outcome.message.len());
    bytes.extend_from_slice(b"BWDO");
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&outcome.transfer_token.to_le_bytes());
    bytes.extend_from_slice(&outcome.request_id.to_le_bytes());
    bytes.push(match outcome.status {
        PersistenceDispatchStatusV1::Accepted => 1,
        PersistenceDispatchStatusV1::Empty => 2,
        PersistenceDispatchStatusV1::Rejected => 3,
    });
    bytes.extend_from_slice(
        &outcome
            .operation
            .map_or(0_u16, |operation| operation as u16)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(&outcome.persistence_revision.to_le_bytes());
    bytes.extend_from_slice(&outcome.storage_revision.to_le_bytes());
    bytes.extend_from_slice(outcome.durable_hash.as_bytes());
    bytes.push(u8::from(outcome.next_cursor.is_some()));
    if let Some(cursor) = outcome.next_cursor {
        bytes.extend_from_slice(&cursor.to_le_bytes());
    }
    bytes.push(match outcome.retry {
        PersistenceRetryDirectiveV1::None => 0,
        PersistenceRetryDirectiveV1::RetryAfterBackoff { .. } => 1,
        PersistenceRetryDirectiveV1::RecoverBeforeRetry => 2,
        PersistenceRetryDirectiveV1::CompactBeforeRetry => 3,
        PersistenceRetryDirectiveV1::ParentFallback => 4,
        PersistenceRetryDirectiveV1::Stop => 5,
    });
    if let PersistenceRetryDirectiveV1::RetryAfterBackoff { delay_milliseconds } = outcome.retry {
        bytes.extend_from_slice(&delay_milliseconds.to_le_bytes());
    }
    if let Some(receipt) = &outcome.durable_commit {
        bytes.push(1);
        bytes.extend_from_slice(&receipt.request_id.to_le_bytes());
        bytes.extend_from_slice(&(receipt.transaction_id.len() as u32).to_le_bytes());
        bytes.extend_from_slice(receipt.transaction_id.as_bytes());
        bytes.extend_from_slice(&receipt.journal_sequence.to_le_bytes());
        bytes.extend_from_slice(receipt.durable_hash.as_bytes());
        bytes.extend_from_slice(receipt.checkpoint_hash.as_bytes());
    } else {
        bytes.push(0);
    }
    for value in [&outcome.payload, outcome.code.as_bytes(), outcome.message.as_bytes()] {
        bytes.extend_from_slice(&(value.len() as u32).to_le_bytes());
        bytes.extend_from_slice(value);
    }
    WireHash(wire_checksum_v1(&bytes))
}

fn wire_identity(identity: &IntegratedRuntimeIdentityV2) -> RuntimeIdentityV1 {
    RuntimeIdentityV1 {
        universe_id: identity.universe_id.clone(),
        location_id: identity.location_id.clone(),
        revision: RuntimeRevisionV1 {
            epoch: identity.revision.epoch,
            world: identity.revision.world,
            entities: identity.revision.entities,
            gameplay: identity.revision.gameplay,
            persistence: identity.revision.persistence,
            network: identity.revision.network,
            simulation: identity.revision.simulation,
        },
        tick: identity.tick,
        state_hash: wire_hash(identity.state_hash),
    }
}

fn extraction_channel_bytes(extraction: &RuntimeExtractionV1) -> usize {
    [
        &extraction.render,
        &extraction.hud,
        &extraction.audio,
        &extraction.platform_requests,
        &extraction.diagnostics,
    ]
    .into_iter()
    .fold(0_usize, |total, bytes| total.saturating_add(bytes.len()))
}

fn encode_extraction_response(
    request_id: u32,
    client_epoch: u32,
    extraction: RuntimeExtractionV1,
    current: RuntimeIdentityV1,
) -> Vec<u8> {
    match encode_response_v1(&RuntimeResponseV1::Extraction {
        request_id,
        client_epoch,
        worker_epoch: WORKER_EPOCH,
        extraction,
    }) {
        Ok(encoded) => encoded,
        Err(error) => encode_error(request_id, client_epoch, error.code, error.message, Some(current)),
    }
}

fn encode_diagnostics(runtime: &IntegratedRuntimeV2) -> Vec<u8> {
    let revision = runtime.revision();
    let dispatcher = runtime.persistence_dispatcher().diagnostics();
    let persistence = runtime.persistence_authority().diagnostics();
    let generation = runtime.generation_diagnostics();
    let schedule = runtime.entity_schedule_diagnostics();
    let mut output = Vec::with_capacity(256);
    output.extend_from_slice(b"BWRX");
    output.extend_from_slice(&2_u16.to_le_bytes());
    output.extend_from_slice(&runtime.tick().to_le_bytes());
    for value in [
        revision.epoch,
        revision.world,
        revision.entities,
        revision.gameplay,
        revision.persistence,
        revision.network,
        revision.simulation,
    ] {
        output.extend_from_slice(&value.to_le_bytes());
    }
    output.extend_from_slice(runtime.state_hash().as_bytes());
    for value in [
        dispatcher.persistence_revision,
        dispatcher.queued as u64,
        dispatcher.in_flight as u64,
        dispatcher.retryable as u64,
        dispatcher.queued_bytes as u64,
        dispatcher.completed_receipts as u64,
        persistence.persistence_revision,
        persistence.journal_sequence,
        persistence.durable_records as u64,
        persistence.durable_bytes,
        persistence.dirty_records as u64,
        persistence.dirty_bytes,
        u64::from(persistence.transactions_since_compaction),
        persistence.journal_bytes_since_compaction,
        generation.submitted,
        generation.completed,
        generation.cache_hits,
        generation.cache_misses,
        generation.cancelled,
        generation.stale,
        generation.failed,
        generation.generated_microseconds,
        generation.cache_entries as u64,
        schedule.entity_jobs_completed,
        schedule.entity_jobs_rejected_stale,
        schedule.ecology_jobs_completed,
        schedule.ecology_jobs_rejected_stale,
        schedule.path_jobs_completed,
        schedule.path_jobs_rejected_stale,
    ] {
        output.extend_from_slice(&value.to_le_bytes());
    }
    for value in [
        dispatcher.closed,
        persistence.commit_in_flight,
        persistence.tombstoned,
        runtime.native_save_ready(),
        runtime.is_stopped(),
    ] {
        output.push(u8::from(value));
    }
    output.extend_from_slice(dispatcher.state_hash.as_bytes());
    output.extend_from_slice(persistence.state_hash.as_bytes());
    output
}

fn runtime_extraction_revision(runtime: &IntegratedRuntimeV2) -> u64 {
    let revision = runtime.revision();
    [
        runtime.tick(),
        revision.epoch,
        revision.world,
        revision.entities,
        revision.gameplay,
        revision.persistence,
        revision.network,
        revision.simulation,
    ]
    .into_iter()
    .fold(0_u64, u64::saturating_add)
}

#[derive(Clone, Debug)]
struct CameraExtractionV1 {
    view: RuntimeExtractionViewV1,
    bound_external_entity_id: String,
    bound_entity_id: u64,
    bound_actor_id: String,
    bound_player_id: u64,
    camera_revision: u64,
    camera_state_hash: CanonicalHash,
    mode: CameraModeV1,
    profile: CameraProfileV1,
    aiming: bool,
    pose: CameraPoseV1,
}

fn camera_extraction(
    runtime: &IntegratedRuntimeV2,
    view: RuntimeExtractionViewV1,
) -> Result<CameraExtractionV1, IntegratedRuntimeError> {
    let state = runtime.camera_state();
    let pose = runtime.camera_pose(view.viewport)?;
    if [
        pose.position.x,
        pose.position.y,
        pose.position.z,
        pose.orientation[0],
        pose.orientation[1],
        pose.orientation[2],
        pose.orientation[3],
        pose.vertical_fov_radians,
        pose.near,
        pose.far,
        pose.resolved_distance,
    ]
    .into_iter()
    .any(|value| !value.is_finite())
    {
        return Err(IntegratedRuntimeError::new(
            "camera-pose-number",
            "authoritative camera pose contains a non-finite renderer value",
        ));
    }
    let player = runtime.player().ok_or_else(|| {
        IntegratedRuntimeError::new(
            "camera-player-binding",
            "camera extraction requires a complete authoritative player binding",
        )
    })?;
    Ok(CameraExtractionV1 {
        view,
        bound_external_entity_id: player.binding.external_entity_id.clone(),
        bound_entity_id: player.entity_id.packed(),
        bound_actor_id: player.binding.actor_id.clone(),
        bound_player_id: player.binding.player_id.packed(),
        camera_revision: state.revision,
        camera_state_hash: runtime_camera_config_state_hash_v1(state.revision, state.mode, state.profile),
        mode: state.mode,
        profile: state.profile,
        aiming: runtime.camera_aiming(),
        pose,
    })
}

struct RenderEntityExtractionSourceV3<'a> {
    entity_id: u64,
    residency: u8,
    simulation_tier: u16,
    protection: u64,
    entity_revision: u64,
    record: &'a blockwild_entity::EntityCompatibilityRecord,
    components: &'a blockwild_entity::EntityComponents,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct DroppedItemRenderBindingV1<'a> {
    entity_revision: u64,
    binding: IntegratedRuntimeRenderPresentationBindingV1<'a>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct CombatRenderBindingV1<'a> {
    entity_revision: Option<u64>,
    binding: IntegratedRuntimeRenderPresentationBindingV1<'a>,
}

fn dropped_item_render_bindings_v1<'a>(
    runtime: &'a IntegratedRuntimeV2,
    world_view: Option<&'a WorldViewExtractionInputV1>,
) -> BTreeMap<u64, DroppedItemRenderBindingV1<'a>> {
    world_view.map_or_else(BTreeMap::new, |world_view| {
        world_view
            .dropped_items
            .iter()
            .map(|dropped| {
                (
                    dropped.spatial.entity_id.packed(),
                    DroppedItemRenderBindingV1 {
                        entity_revision: dropped.entity_revision,
                        binding: runtime.dropped_item_render_presentation_binding_v1(dropped.stack.item_code),
                    },
                )
            })
            .collect()
    })
}

fn combat_render_bindings_v1(runtime: &IntegratedRuntimeV2) -> BTreeMap<u64, CombatRenderBindingV1<'_>> {
    let mut bindings = BTreeMap::new();
    for projectile in runtime.gameplay().state.combat.projectiles.values() {
        let Some(link) = &projectile.presentation else {
            continue;
        };
        bindings.insert(
            link.entity_id.packed(),
            CombatRenderBindingV1 {
                entity_revision: runtime
                    .entities()
                    .hot()
                    .get(&link.entity_id)
                    .map(|entity| entity.entity_revision),
                binding: runtime.projectile_render_presentation_binding_v1(
                    &link.presentation_id,
                    link.content_domain,
                    &link.content_id,
                ),
            },
        );
    }
    for summon in runtime.gameplay().state.combat.summons.values() {
        let Some(link) = &summon.presentation else {
            continue;
        };
        bindings.insert(
            link.entity_id.packed(),
            CombatRenderBindingV1 {
                entity_revision: runtime
                    .entities()
                    .hot()
                    .get(&link.entity_id)
                    .map(|entity| entity.entity_revision),
                binding: runtime.summon_render_presentation_binding_v1(
                    &link.presentation_id,
                    link.content_domain,
                    &link.content_id,
                ),
            },
        );
    }
    bindings
}

fn encode_render_extraction_at(
    runtime: &IntegratedRuntimeV2,
    extraction_revision: u64,
    world_view: Option<&WorldViewExtractionInputV1>,
) -> Vec<u8> {
    let entities = runtime.entities();
    let dropped_item_bindings = dropped_item_render_bindings_v1(runtime, world_view);
    let combat_bindings = combat_render_bindings_v1(runtime);
    let total = entities.len();
    let mut records = Vec::with_capacity(total.min(MAX_ENTITY_EXTRACTION_RECORDS_V3).saturating_mul(256));
    let mut selected = 0_usize;
    let candidates = entities
        .hot()
        .iter()
        .map(|(id, entity)| RenderEntityExtractionSourceV3 {
            entity_id: id.packed(),
            residency: 0,
            simulation_tier: entity.tier as u16,
            protection: entity.protection.bits(),
            entity_revision: entity.entity_revision,
            record: &entity.record,
            components: &entity.components,
        })
        .chain(
            entities
                .cold()
                .iter()
                .map(|(id, entity)| RenderEntityExtractionSourceV3 {
                    entity_id: id.packed(),
                    residency: 1,
                    simulation_tier: blockwild_entity::SimulationTier::Dormant as u16,
                    protection: entity.protection.bits(),
                    entity_revision: entity.entity_revision,
                    record: &entity.record,
                    components: &entity.components,
                }),
        );
    for candidate in candidates {
        if selected >= MAX_ENTITY_EXTRACTION_RECORDS_V3 {
            break;
        }
        let encoded = encode_render_entity_record(runtime, &candidate, &dropped_item_bindings, &combat_bindings);
        if ENTITY_EXTRACTION_HEADER_BYTES_V3
            .saturating_add(records.len())
            .saturating_add(encoded.len())
            > MAX_ENTITY_EXTRACTION_BYTES_V3
        {
            break;
        }
        records.extend_from_slice(&encoded);
        selected += 1;
    }
    let mut output = Vec::with_capacity(ENTITY_EXTRACTION_HEADER_BYTES_V3 + records.len());
    output.extend_from_slice(b"BWR6");
    output.extend_from_slice(&ENTITY_EXTRACTION_SCHEMA_V3.to_le_bytes());
    output.extend_from_slice(&extraction_revision.to_le_bytes());
    output.extend_from_slice(&runtime.tick().to_le_bytes());
    output.extend_from_slice(runtime.content_manifest_hash().as_bytes());
    output.push(u8::from(runtime.content_ready()));
    output.extend_from_slice(
        &u32::try_from(total)
            .expect("entity authority is extraction-bounded")
            .to_le_bytes(),
    );
    output.extend_from_slice(
        &u32::try_from(selected)
            .expect("entity extraction record cap fits u32")
            .to_le_bytes(),
    );
    output.extend_from_slice(
        &u32::try_from(total - selected)
            .expect("entity authority is extraction-bounded")
            .to_le_bytes(),
    );
    output.extend_from_slice(&records);
    output
}

fn encode_render_entity_record(
    runtime: &IntegratedRuntimeV2,
    source: &RenderEntityExtractionSourceV3<'_>,
    dropped_item_bindings: &BTreeMap<u64, DroppedItemRenderBindingV1<'_>>,
    combat_bindings: &BTreeMap<u64, CombatRenderBindingV1<'_>>,
) -> Vec<u8> {
    let record = source.record;
    let components = source.components;
    let is_dropped_item = record.class == blockwild_entity::EntityClass::Construct && record.kind_key == "dropped-item";
    let default_model_key = record
        .custom
        .get("modelKey")
        .or_else(|| record.custom.get("model"))
        .map_or(record.kind_key.as_str(), String::as_str);
    let (model_key, model_hash, model_revision) = if let Some(CombatRenderBindingV1 {
        entity_revision,
        binding:
            IntegratedRuntimeRenderPresentationBindingV1::Exact {
                model_id,
                content_hash,
                content_version,
                ..
            },
    }) = combat_bindings.get(&source.entity_id)
        && *entity_revision == Some(source.entity_revision)
    {
        (*model_id, *content_hash, *content_version)
    } else if combat_bindings.contains_key(&source.entity_id) {
        ("unresolved:combat-presentation", CanonicalHash::default(), 0)
    } else if is_dropped_item {
        match dropped_item_bindings.get(&source.entity_id) {
            Some(DroppedItemRenderBindingV1 {
                entity_revision,
                binding:
                    IntegratedRuntimeRenderPresentationBindingV1::Exact {
                        model_id,
                        content_hash,
                        content_version,
                        ..
                    },
            }) if *entity_revision == source.entity_revision => (*model_id, *content_hash, *content_version),
            _ => ("unresolved:dropped-item", CanonicalHash::default(), 0),
        }
    } else {
        let (model_hash, model_revision) = runtime
            .entity_model_content_identity(default_model_key, &record.kind_key)
            .unwrap_or_default();
        (default_model_key, model_hash, model_revision)
    };
    let mut output = Vec::with_capacity(256);
    output.extend_from_slice(&source.entity_id.to_le_bytes());
    output.push(source.residency);
    output.push(record.class as u8);
    output.extend_from_slice(&source.simulation_tier.to_le_bytes());
    output.extend_from_slice(&source.protection.to_le_bytes());
    output.extend_from_slice(&source.entity_revision.to_le_bytes());
    write_extraction_string(&mut output, &record.external_entity_id);
    write_extraction_string(&mut output, &record.specimen_id);
    write_extraction_string(&mut output, &record.kind_key);
    write_extraction_optional_string(&mut output, record.variant_key.as_deref());
    write_extraction_optional_string(&mut output, record.name.as_deref());
    write_extraction_string(&mut output, model_key);
    output.extend_from_slice(&model_revision.to_le_bytes());
    output.extend_from_slice(model_hash.as_bytes());
    for value in [
        record.position.x,
        record.position.y,
        record.position.z,
        record.yaw,
        record.velocity.x,
        record.velocity.y,
        record.velocity.z,
        record.health,
        record.maximum_health,
    ] {
        output.extend_from_slice(&value.to_le_bytes());
    }
    output.push(u8::from(record.tamed));
    output.extend_from_slice(&record.age_ticks.to_le_bytes());
    output.push(components.locomotion.movement_mode as u8);
    output.push(u8::from(components.locomotion.grounded));
    output.push(u8::from(components.locomotion.submerged));
    output.extend_from_slice(&components.vitals.last_damage_tick.to_le_bytes());
    write_extraction_string(&mut output, &components.locomotion.action.key);
    output.extend_from_slice(&components.locomotion.action.phase.to_le_bytes());
    output.extend_from_slice(&components.locomotion.action.started_tick.to_le_bytes());
    output.extend_from_slice(&components.locomotion.action.ends_tick.to_le_bytes());
    write_extraction_optional_entity_id(&mut output, components.locomotion.action.target);
    write_extraction_equipment(&mut output, &components.equipment);
    write_extraction_mount(&mut output, &components.mount);
    write_extraction_research(&mut output, &record.research);
    output
}

#[derive(Clone, Debug)]
enum DomainViewValueV1 {
    Bool(bool),
    U64(u64),
    I64(i64),
    F64(f64),
    String(String),
    Hash(CanonicalHash),
    Bytes(Vec<u8>),
}

#[derive(Clone, Debug)]
struct DomainViewRowV1 {
    kind: u16,
    key: String,
    fields: BTreeMap<String, DomainViewValueV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
enum DomainViewStatusV1 {
    Complete = 0,
    Partial = 1,
    Absent = 2,
}

#[derive(Clone, Debug)]
struct DomainViewV1 {
    domain: u8,
    revision: u64,
    status: DomainViewStatusV1,
    rows: Vec<DomainViewRowV1>,
    blockers: Vec<String>,
}

fn domain_row(kind: u16, key: impl Into<String>, _source_revision: u64) -> DomainViewRowV1 {
    DomainViewRowV1 {
        kind,
        key: key.into(),
        fields: BTreeMap::new(),
    }
}

fn domain_field(row: &mut DomainViewRowV1, key: impl Into<String>, value: DomainViewValueV1) {
    let previous = row.fields.insert(key.into(), value);
    assert!(previous.is_none(), "domain extraction fields are canonical and unique");
}

fn bool_field(row: &mut DomainViewRowV1, key: impl Into<String>, value: bool) {
    domain_field(row, key, DomainViewValueV1::Bool(value));
}

fn u64_field(row: &mut DomainViewRowV1, key: impl Into<String>, value: u64) {
    domain_field(row, key, DomainViewValueV1::U64(value));
}

fn i64_field(row: &mut DomainViewRowV1, key: impl Into<String>, value: i64) {
    domain_field(row, key, DomainViewValueV1::I64(value));
}

fn f64_field(row: &mut DomainViewRowV1, key: impl Into<String>, value: f64) {
    domain_field(row, key, DomainViewValueV1::F64(value));
}

fn string_field(row: &mut DomainViewRowV1, key: impl Into<String>, value: impl Into<String>) {
    domain_field(row, key, DomainViewValueV1::String(value.into()));
}

fn hash_field(row: &mut DomainViewRowV1, key: impl Into<String>, value: CanonicalHash) {
    domain_field(row, key, DomainViewValueV1::Hash(value));
}

fn bytes_field(row: &mut DomainViewRowV1, key: impl Into<String>, value: &[u8]) {
    domain_field(row, key, DomainViewValueV1::Bytes(value.to_vec()));
}

fn option_string_field(row: &mut DomainViewRowV1, key: impl Into<String>, value: Option<&str>) {
    let key = key.into();
    bool_field(row, format!("{key}.present"), value.is_some());
    if let Some(value) = value {
        string_field(row, format!("{key}.value"), value);
    }
}

fn option_u64_field(row: &mut DomainViewRowV1, key: impl Into<String>, value: Option<u64>) {
    let key = key.into();
    bool_field(row, format!("{key}.present"), value.is_some());
    if let Some(value) = value {
        u64_field(row, format!("{key}.value"), value);
    }
}

fn canonical_player_sequence_marker_v1(value: &str) -> Option<u64> {
    let parsed = value.parse::<u64>().ok()?;
    (parsed > 0 && parsed <= MAX_SAFE_U64 && value == parsed.to_string()).then_some(parsed)
}

fn encode_domain_value(output: &mut Vec<u8>, value: &DomainViewValueV1) {
    match value {
        DomainViewValueV1::Bool(value) => {
            output.push(0);
            output.push(u8::from(*value));
        }
        DomainViewValueV1::U64(value) => {
            output.push(1);
            output.extend_from_slice(&value.to_le_bytes());
        }
        DomainViewValueV1::I64(value) => {
            output.push(2);
            output.extend_from_slice(&value.to_le_bytes());
        }
        DomainViewValueV1::F64(value) => {
            output.push(3);
            output.extend_from_slice(&value.to_le_bytes());
        }
        DomainViewValueV1::String(value) => {
            output.push(4);
            write_extraction_string(output, value);
        }
        DomainViewValueV1::Hash(value) => {
            output.push(5);
            output.extend_from_slice(value.as_bytes());
        }
        DomainViewValueV1::Bytes(value) => {
            output.push(6);
            write_extraction_bytes(output, value);
        }
    }
}

/// A row revision is a renderer-independent semantic revision, not a borrowed
/// authority counter. Hashing the exact typed field encoding makes it change
/// when any serialized kind, key, field name, value tag, or value changes,
/// while identical semantic rows remain stable across checkpoint restore.
fn domain_row_revision(row: &DomainViewRowV1) -> u64 {
    let mut hasher = CanonicalHasher::new("blockwild.r10.domain-row-revision.v1");
    hasher.write_u16(row.kind);
    hasher.write_str(&row.key);
    hasher.write_u16(row.fields.len() as u16);
    for (key, value) in &row.fields {
        hasher.write_str(key);
        let mut encoded_value = Vec::new();
        encode_domain_value(&mut encoded_value, value);
        hasher.write_bytes(&encoded_value);
    }
    u64::from_le_bytes(
        hasher.finish().as_bytes()[..8]
            .try_into()
            .expect("canonical hash lane is eight bytes"),
    )
}

fn encode_domain_row(row: &DomainViewRowV1) -> Option<Vec<u8>> {
    if row.fields.len() > DOMAIN_VIEW_MAX_FIELDS_V1 {
        return None;
    }
    let mut output = Vec::with_capacity(64 + row.fields.len().saturating_mul(32));
    output.extend_from_slice(&row.kind.to_le_bytes());
    write_extraction_string(&mut output, &row.key);
    output.extend_from_slice(&domain_row_revision(row).to_le_bytes());
    output.extend_from_slice(&(row.fields.len() as u16).to_le_bytes());
    for (key, value) in &row.fields {
        write_extraction_string(&mut output, key);
        encode_domain_value(&mut output, value);
    }
    (output.len() <= DOMAIN_VIEW_MAX_BYTES_V1).then_some(output)
}

fn encode_domain_view(mut view: DomainViewV1) -> Vec<u8> {
    view.rows
        .sort_by(|left, right| (left.kind, &left.key).cmp(&(right.kind, &right.key)));
    view.blockers.sort();
    view.blockers.dedup();
    assert!(view.blockers.len() <= DOMAIN_VIEW_MAX_BLOCKERS_V1);
    let total = view.rows.len();
    let mut payload = Vec::new();
    let mut selected = 0_usize;
    for row in &view.rows {
        if selected >= DOMAIN_VIEW_MAX_RECORDS_V1 {
            break;
        }
        let Some(encoded) = encode_domain_row(row) else { break };
        if payload.len().saturating_add(encoded.len()) > DOMAIN_VIEW_MAX_BYTES_V1 {
            break;
        }
        payload.extend_from_slice(&encoded);
        selected += 1;
    }
    let omitted = total.saturating_sub(selected);
    if omitted > 0 {
        view.status = DomainViewStatusV1::Partial;
        view.blockers.push("records-truncated-at-bounded-cursor".into());
        view.blockers.sort();
        view.blockers.dedup();
    }
    let mut hasher = CanonicalHasher::new("blockwild.r10.domain-view-payload.v1");
    hasher.write_bytes(&payload);
    let payload_hash = hasher.finish();
    let mut output = Vec::with_capacity(64 + payload.len());
    output.push(view.domain);
    output.extend_from_slice(&DOMAIN_VIEW_SCHEMA_V1.to_le_bytes());
    output.push(view.status as u8);
    output.extend_from_slice(&view.revision.to_le_bytes());
    output.extend_from_slice(&(total as u32).to_le_bytes());
    output.extend_from_slice(&(selected as u32).to_le_bytes());
    output.extend_from_slice(&(omitted as u32).to_le_bytes());
    output.extend_from_slice(&(selected as u32).to_le_bytes());
    output.extend_from_slice(&(view.blockers.len() as u16).to_le_bytes());
    for blocker in &view.blockers {
        write_extraction_string(&mut output, blocker);
    }
    output.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    output.extend_from_slice(payload_hash.as_bytes());
    output.extend_from_slice(&payload);
    output
}

fn container_view_key(kind: u16, owner_id: Option<&str>, id: &str) -> String {
    // The display key is the lower-hex rendering of an injective typed binary
    // tuple. Option presence and UTF-8 byte lengths are explicit, so embedded
    // punctuation and `None` versus `Some("")` cannot alias another key.
    let owner_length = owner_id.map_or(0, |value| value.len());
    let mut encoded = Vec::with_capacity(12 + owner_length + id.len());
    encoded.push(1);
    encoded.extend_from_slice(&kind.to_le_bytes());
    encoded.push(u8::from(owner_id.is_some()));
    if let Some(owner_id) = owner_id {
        encoded.extend_from_slice(&(owner_id.len() as u32).to_le_bytes());
        encoded.extend_from_slice(owner_id.as_bytes());
    }
    encoded.extend_from_slice(&(id.len() as u32).to_le_bytes());
    encoded.extend_from_slice(id.as_bytes());
    let mut key = String::with_capacity("container-key-v1/".len() + encoded.len() * 2);
    key.push_str("container-key-v1/");
    for byte in encoded {
        use std::fmt::Write as _;
        write!(&mut key, "{byte:02x}").expect("writing a container key to String cannot fail");
    }
    key
}

macro_rules! container_view_key {
    ($container:expr) => {
        container_view_key($container.kind as u16, $container.owner_id.as_deref(), &$container.id)
    };
}

macro_rules! printing_view_key {
    ($printing:expr) => {
        format!("{}:{}:{}", $printing.card_id, $printing.variant_id, $printing.finish_id)
    };
}

macro_rules! dropped_item_world_view_row {
    ($dropped:expr, $presentation:expr) => {{
        let dropped = $dropped;
        let spatial = &dropped.spatial;
        let stack = &dropped.stack;
        let mut row = domain_row(6, format!("drop:{}", spatial.drop_id), spatial.revision);
        string_field(&mut row, "dropId", &spatial.drop_id);
        u64_field(&mut row, "entityId", spatial.entity_id.packed());
        u64_field(&mut row, "entityRevision", dropped.entity_revision);
        string_field(&mut row, "custodyContainer", container_view_key!(&spatial.container));
        u64_field(&mut row, "custodySlot", u64::from(spatial.slot));
        u64_field(&mut row, "boundContainerRevision", spatial.bound_container_revision);
        for (key, value) in [
            ("position.xMilli", spatial.position.x_milli),
            ("position.yMilli", spatial.position.y_milli),
            ("position.zMilli", spatial.position.z_milli),
            ("velocity.xMilliPerSecond", spatial.velocity_milli_per_second.x_milli),
            ("velocity.yMilliPerSecond", spatial.velocity_milli_per_second.y_milli),
            ("velocity.zMilliPerSecond", spatial.velocity_milli_per_second.z_milli),
        ] {
            i64_field(&mut row, key, value);
        }
        u64_field(&mut row, "rotation.yawMicroturns", u64::from(spatial.rotation.yaw));
        u64_field(&mut row, "rotation.pitchMicroturns", u64::from(spatial.rotation.pitch));
        u64_field(&mut row, "rotation.rollMicroturns", u64::from(spatial.rotation.roll));
        u64_field(&mut row, "createdTick", spatial.created_tick);
        option_u64_field(&mut row, "expiresTick", spatial.expires_tick);
        option_string_field(&mut row, "pickupLockActorId", spatial.pickup_lock_actor_id.as_deref());
        u64_field(&mut row, "stack.itemCode", u64::from(stack.item_code));
        u64_field(&mut row, "stack.count", u64::from(stack.count));
        option_u64_field(&mut row, "stack.durability", stack.durability_millionths.map(u64::from));
        hash_field(&mut row, "stack.metadataHash", stack.metadata_hash);
        string_field(&mut row, "presentation.role", "dropped-item");
        string_field(&mut row, "presentation.contentDomain", "item");
        string_field(&mut row, "presentation.contentId", stack.item_code.to_string());
        match $presentation {
            IntegratedRuntimeRenderPresentationBindingV1::Exact {
                profile_id,
                model_id,
                content_hash,
                content_version,
            } => {
                string_field(&mut row, "presentation.status", "exact");
                string_field(&mut row, "presentation.profileId", profile_id);
                string_field(&mut row, "presentation.modelId", model_id);
                hash_field(&mut row, "presentation.contentHash", content_hash);
                u64_field(&mut row, "presentation.contentVersion", u64::from(content_version));
            }
            IntegratedRuntimeRenderPresentationBindingV1::Missing { blocker_id } => {
                string_field(&mut row, "presentation.status", "missing");
                string_field(&mut row, "presentation.blockerId", blocker_id);
            }
            IntegratedRuntimeRenderPresentationBindingV1::Unmapped => {
                string_field(&mut row, "presentation.status", "unmapped");
            }
        }
        row
    }};
}

macro_rules! machine_anchor_world_view_row {
    ($machine:expr, $presentation:expr) => {{
        let machine = $machine;
        let anchor = &machine.anchor;
        let mut row = domain_row(5, format!("anchor:{}", anchor.machine_id), anchor.revision);
        string_field(&mut row, "machineId", &anchor.machine_id);
        u64_field(&mut row, "anchorRevision", anchor.revision);
        string_field(&mut row, "presentationId", &anchor.presentation_id);
        string_field(&mut row, "presentation.role", "machine");
        match $presentation {
            IntegratedRuntimeRenderPresentationBindingV1::Exact {
                profile_id,
                model_id,
                content_hash,
                content_version,
            } => {
                string_field(&mut row, "presentation.status", "exact");
                string_field(&mut row, "presentation.profileId", profile_id);
                string_field(&mut row, "presentation.modelId", model_id);
                hash_field(&mut row, "presentation.contentHash", content_hash);
                u64_field(&mut row, "presentation.contentVersion", u64::from(content_version));
            }
            IntegratedRuntimeRenderPresentationBindingV1::Missing { blocker_id } => {
                string_field(&mut row, "presentation.status", "missing");
                string_field(&mut row, "presentation.blockerId", blocker_id);
            }
            IntegratedRuntimeRenderPresentationBindingV1::Unmapped => {
                string_field(&mut row, "presentation.status", "unmapped");
                string_field(
                    &mut row,
                    "presentation.blockerId",
                    "machine-presentation-profile-unmapped",
                );
            }
        }
        for (key, value) in [
            ("position.xMilli", anchor.position.x_milli),
            ("position.yMilli", anchor.position.y_milli),
            ("position.zMilli", anchor.position.z_milli),
        ] {
            i64_field(&mut row, key, value);
        }
        u64_field(&mut row, "rotation.yawMicroturns", u64::from(anchor.rotation.yaw));
        u64_field(&mut row, "rotation.pitchMicroturns", u64::from(anchor.rotation.pitch));
        u64_field(&mut row, "rotation.rollMicroturns", u64::from(anchor.rotation.roll));
        for (axis, extent) in ["x", "y", "z"].into_iter().zip(anchor.half_extents_milli) {
            u64_field(&mut row, format!("halfExtents.{axis}Milli"), u64::from(extent));
        }
        u64_field(&mut row, "gameplayRevision", machine.gameplay_revision);
        bool_field(&mut row, "gameplayActive", machine.active);
        bool_field(&mut row, "light.present", anchor.light.is_some());
        if let Some(light) = &anchor.light {
            u64_field(&mut row, "light.kind", light.kind as u64);
            u64_field(&mut row, "light.color.redMillionths", u64::from(light.color.red));
            u64_field(&mut row, "light.color.greenMillionths", u64::from(light.color.green));
            u64_field(&mut row, "light.color.blueMillionths", u64::from(light.color.blue));
            u64_field(
                &mut row,
                "light.luminousFluxMillilumens",
                light.luminous_flux_millilumens,
            );
            u64_field(&mut row, "light.rangeMilli", u64::from(light.range_milli));
            u64_field(
                &mut row,
                "light.innerConeMicroturns",
                u64::from(light.inner_cone_microturns),
            );
            u64_field(
                &mut row,
                "light.outerConeMicroturns",
                u64::from(light.outer_cone_microturns),
            );
            bool_field(&mut row, "light.castsShadows", light.casts_shadows);
            bool_field(&mut row, "light.enabled", light.enabled);
        }
        row
    }};
}

macro_rules! celestial_body_world_view_row {
    ($body:expr, $revision:expr) => {{
        let body = $body;
        let mut row = domain_row(5, format!("celestial-body:{}", body.body_id), $revision);
        string_field(&mut row, "bodyId", &body.body_id);
        option_string_field(&mut row, "parentBodyId", body.parent_body_id.as_deref());
        u64_field(&mut row, "kind", body.kind as u64);
        string_field(&mut row, "presentationId", &body.presentation_id);
        for (key, value) in [
            ("direction.xMillionths", body.direction.x_millionths),
            ("direction.yMillionths", body.direction.y_millionths),
            ("direction.zMillionths", body.direction.z_millionths),
        ] {
            i64_field(&mut row, key, i64::from(value));
        }
        u64_field(
            &mut row,
            "angularRadiusMicrodegrees",
            u64::from(body.angular_radius_microdegrees),
        );
        u64_field(
            &mut row,
            "illuminatedFractionMillionths",
            u64::from(body.illuminated_fraction_millionths),
        );
        u64_field(&mut row, "phaseMicroturns", u64::from(body.phase_microturns));
        u64_field(&mut row, "tint.redMillionths", u64::from(body.tint.red));
        u64_field(&mut row, "tint.greenMillionths", u64::from(body.tint.green));
        u64_field(&mut row, "tint.blueMillionths", u64::from(body.tint.blue));
        u64_field(&mut row, "radianceMillionths", u64::from(body.radiance_millionths));
        i64_field(&mut row, "renderOrder", i64::from(body.render_order));
        bool_field(&mut row, "occludesStars", body.occludes_stars);
        row
    }};
}

fn runtime_domain_view(runtime: &IntegratedRuntimeV2) -> DomainViewV1 {
    let identity = runtime.identity();
    let config = runtime.config();
    let mut row = domain_row(1, "runtime", identity.revision.epoch);
    string_field(&mut row, "universeId", &identity.universe_id);
    string_field(&mut row, "locationId", &identity.location_id);
    string_field(&mut row, "sessionId", &config.session_id);
    string_field(&mut row, "worldSeed", &config.world_seed);
    u64_field(&mut row, "tick", identity.tick);
    hash_field(&mut row, "stateHash", identity.state_hash);
    hash_field(&mut row, "contentHash", config.content_hash);
    hash_field(&mut row, "generatorHash", config.generator_hash);
    bool_field(&mut row, "contentReady", runtime.content_ready());
    for (key, value) in [
        ("revision.epoch", identity.revision.epoch),
        ("revision.world", identity.revision.world),
        ("revision.entities", identity.revision.entities),
        ("revision.gameplay", identity.revision.gameplay),
        ("revision.persistence", identity.revision.persistence),
        ("revision.network", identity.revision.network),
        ("revision.simulation", identity.revision.simulation),
    ] {
        u64_field(&mut row, key, value);
    }
    let content = runtime.content_attestation();
    bool_field(&mut row, "contentAttestation.present", content.is_some());
    if let Some(content) = content {
        string_field(&mut row, "contentAttestation.installId", &content.install_id);
        string_field(&mut row, "contentAttestation.sourceRevision", &content.source_revision);
        u64_field(
            &mut row,
            "contentAttestation.entries",
            u64::from(content.installed_entries),
        );
        u64_field(&mut row, "contentAttestation.bytes", content.installed_bytes);
    }
    DomainViewV1 {
        domain: 1,
        revision: identity.revision.epoch,
        status: DomainViewStatusV1::Complete,
        rows: vec![row],
        blockers: Vec::new(),
    }
}

fn camera_domain_row(camera: &CameraExtractionV1) -> DomainViewRowV1 {
    let mut row = domain_row(3, "camera", camera.view.view_revision);
    bool_field(&mut row, "aiming", camera.aiming);
    string_field(&mut row, "actorId", &camera.bound_actor_id);
    u64_field(&mut row, "entityId", camera.bound_entity_id);
    string_field(&mut row, "externalEntityId", &camera.bound_external_entity_id);
    u64_field(&mut row, "playerId", camera.bound_player_id);
    u64_field(&mut row, "cameraRevision", camera.camera_revision);
    hash_field(&mut row, "cameraStateHash", camera.camera_state_hash);
    bool_field(&mut row, "collided", camera.pose.collided);
    string_field(
        &mut row,
        "mode",
        match camera.mode {
            CameraModeV1::FirstPerson => "first",
            CameraModeV1::ThirdRear => "third-rear",
            CameraModeV1::ThirdFront => "third-front",
        },
    );
    for (key, value) in [
        ("orientation.x", camera.pose.orientation[0]),
        ("orientation.y", camera.pose.orientation[1]),
        ("orientation.z", camera.pose.orientation[2]),
        ("orientation.w", camera.pose.orientation[3]),
        ("position.x", camera.pose.position.x),
        ("position.y", camera.pose.position.y),
        ("position.z", camera.pose.position.z),
        ("profile.aimVerticalFovRadians", camera.profile.aim_vertical_fov_radians),
        (
            "profile.baseVerticalFovRadians",
            camera.profile.base_vertical_fov_radians,
        ),
        ("profile.collisionPadding", camera.profile.collision_padding),
        ("profile.collisionRadius", camera.profile.collision_radius),
        ("profile.eyeHeight", camera.profile.eye_height),
        ("profile.far", camera.profile.far),
        ("profile.minimumDistance", camera.profile.minimum_distance),
        ("profile.near", camera.profile.near),
        ("profile.rearShoulderOffset", camera.profile.rear_shoulder_offset),
        ("profile.thirdPersonDistance", camera.profile.third_person_distance),
        ("profile.thirdPersonPitchScale", camera.profile.third_person_pitch_scale),
        (
            "profile.thirdPersonTargetHeight",
            camera.profile.third_person_target_height,
        ),
        ("projection.far", camera.pose.far),
        ("projection.near", camera.pose.near),
        ("projection.verticalFovRadians", camera.pose.vertical_fov_radians),
        ("resolvedDistance", camera.pose.resolved_distance),
    ] {
        f64_field(&mut row, key, value);
    }
    hash_field(&mut row, "poseHash", camera.pose.pose_hash);
    u64_field(&mut row, "viewRevision", camera.view.view_revision);
    u64_field(&mut row, "viewport.height", u64::from(camera.pose.viewport[1]));
    u64_field(&mut row, "viewport.width", u64::from(camera.pose.viewport[0]));
    row
}

fn player_domain_view(
    runtime: &IntegratedRuntimeV2,
    world_view: Option<&WorldViewExtractionInputV1>,
    extraction_revision: u64,
    camera: Option<&CameraExtractionV1>,
) -> DomainViewV1 {
    let mut rows = Vec::new();
    let mut blockers = Vec::new();
    if let Some(player) = runtime.player() {
        let body = &player.body;
        let mut row = domain_row(1, &player.binding.external_entity_id, player.last_input_sequence);
        u64_field(&mut row, "entityId", player.entity_id.packed());
        for (key, value) in [
            ("position.x", body.position.x),
            ("position.y", body.position.y),
            ("position.z", body.position.z),
            ("velocity.x", body.velocity.x),
            ("velocity.y", body.velocity.y),
            ("velocity.z", body.velocity.z),
            ("radius", body.radius),
            ("height", body.height),
            ("mass", body.mass),
            ("fallDistance", body.fall_distance),
            ("oxygenSeconds", body.oxygen_seconds),
            ("drowningAccumulator", body.drowning_accumulator),
            ("swimEntryMomentumSpeed", body.swim_entry_momentum_speed),
            ("swimSurfaceBreachSeconds", body.swim_surface_breach_seconds),
            ("swimStrokeCooldownSeconds", body.swim_stroke_cooldown_seconds),
            ("maximumOxygenSeconds", player.binding.maximum_oxygen_seconds),
        ] {
            f64_field(&mut row, key, value);
        }
        for (key, value) in [
            ("grounded", body.grounded),
            ("crouching", body.crouching),
            ("swimSurfaceBreachReady", body.swim_surface_breach_ready),
            ("swimSurfaceBobActive", body.swim_surface_bob_active),
            ("swimShoreExitReady", body.swim_shore_exit_ready),
        ] {
            bool_field(&mut row, key, value);
        }
        u64_field(&mut row, "contactFlags", u64::from(player.contact_flags));
        u64_field(&mut row, "selectedSlot", u64::from(player.selected_slot));
        i64_field(&mut row, "lookPitch", i64::from(player.look_pitch));
        u64_field(&mut row, "buttons", u64::from(player.buttons));
        u64_field(&mut row, "flags", u64::from(player.flags));
        u64_field(&mut row, "lastInputSequence", player.last_input_sequence);
        u64_field(&mut row, "gameplaySequence", runtime.gameplay().state.revision.sequence);
        u64_field(
            &mut row,
            "gameplayCombatRevision",
            runtime.gameplay().state.revision.combat,
        );
        let respawn_readiness = runtime.player_respawn_readiness_v1();
        bool_field(&mut row, "queuedInputsEmpty", respawn_readiness.queued_inputs_empty);
        bool_field(
            &mut row,
            "pendingContextCommandsEmpty",
            respawn_readiness.pending_context_commands_empty,
        );
        bool_field(
            &mut row,
            "pendingMovementResultEmpty",
            respawn_readiness.pending_movement_result_empty,
        );
        bool_field(&mut row, "miningStateEmpty", respawn_readiness.mining_state_empty);
        if let Some(record) = runtime.entities().compatibility_record(player.entity_id) {
            let death_raw = record.custom.get("player.deathSequenceV1");
            let last_respawn_raw = record.custom.get("player.lastRespawnSequenceV1");
            let death_sequence = death_raw.and_then(|value| canonical_player_sequence_marker_v1(value));
            let last_respawn_sequence = last_respawn_raw.and_then(|value| canonical_player_sequence_marker_v1(value));
            bool_field(&mut row, "deathSequence.present", death_raw.is_some());
            if let Some(value) = death_sequence {
                u64_field(&mut row, "deathSequence.value", value);
            }
            bool_field(&mut row, "lastRespawnSequence.present", last_respawn_raw.is_some());
            if let Some(value) = last_respawn_sequence {
                u64_field(&mut row, "lastRespawnSequence.value", value);
            }
            let marker_shapes_valid = death_raw.is_none() == death_sequence.is_none()
                && last_respawn_raw.is_none() == last_respawn_sequence.is_none();
            let dead = record.health.to_bits() == 0.0_f32.to_bits();
            let live = record.health.is_finite() && record.health > 0.0;
            let lifecycle_valid = if dead {
                death_sequence.is_some_and(|death| death > last_respawn_sequence.unwrap_or(0))
            } else if live {
                match death_sequence {
                    None => last_respawn_sequence.is_none(),
                    Some(death) => last_respawn_sequence == Some(death),
                }
            } else {
                false
            };
            if !marker_shapes_valid || !lifecycle_valid {
                blockers.push("player-death-respawn-sequence-not-authoritative".into());
            }
        } else {
            option_u64_field(&mut row, "deathSequence", None);
            option_u64_field(&mut row, "lastRespawnSequence", None);
            blockers.push("player-death-respawn-sequence-not-authoritative".into());
        }
        let latest_death_respawn = runtime.native_player_death_respawn_receipt_for_player_v1(
            &player.binding.external_entity_id,
            player.binding.player_id,
        );
        bool_field(&mut row, "latestDeathRespawn.present", latest_death_respawn.is_some());
        if let Some(receipt) = latest_death_respawn {
            u64_field(&mut row, "latestDeathRespawn.respawnSequence", receipt.sequence);
            hash_field(&mut row, "latestDeathRespawn.receiptHash", receipt.receipt_hash);
            u64_field(
                &mut row,
                "latestDeathRespawn.generatedDropCount",
                receipt.drops.len() as u64,
            );
            u64_field(&mut row, "latestDeathRespawn.playerId", receipt.player_id.packed());
            u64_field(
                &mut row,
                "latestDeathRespawn.entityId",
                receipt.player_entity_id.packed(),
            );
            u64_field(&mut row, "latestDeathRespawn.deathSequence", receipt.death_sequence);
            string_field(
                &mut row,
                "latestDeathRespawn.inventoryContainer",
                container_view_key!(&receipt.inventory_container),
            );
            u64_field(
                &mut row,
                "latestDeathRespawn.inventoryBeforeRevision",
                receipt.inventory_before_revision,
            );
            u64_field(
                &mut row,
                "latestDeathRespawn.inventoryAfterRevision",
                receipt.inventory_after_revision,
            );
            string_field(
                &mut row,
                "latestDeathRespawn.equipmentContainer",
                container_view_key!(&receipt.equipment_container),
            );
            u64_field(
                &mut row,
                "latestDeathRespawn.equipmentBeforeRevision",
                receipt.equipment_before_revision,
            );
            u64_field(
                &mut row,
                "latestDeathRespawn.equipmentAfterRevision",
                receipt.equipment_after_revision,
            );
            hash_field(
                &mut row,
                "latestDeathRespawn.custodyAfterHash",
                receipt.custody_after_hash,
            );
            for (index, drop) in receipt.drops.iter().enumerate() {
                let prefix = format!("latestDeathRespawn.drop.{index:04}");
                u64_field(
                    &mut row,
                    format!("{prefix}.sourceLane"),
                    match drop.source_lane {
                        PlayerDeathCustodyLaneV1::Inventory => 0,
                        PlayerDeathCustodyLaneV1::Equipment => 1,
                    },
                );
                u64_field(&mut row, format!("{prefix}.sourceSlot"), u64::from(drop.source_slot));
                u64_field(
                    &mut row,
                    format!("{prefix}.stack.itemCode"),
                    u64::from(drop.stack.item_code),
                );
                u64_field(&mut row, format!("{prefix}.stack.count"), u64::from(drop.stack.count));
                option_u64_field(
                    &mut row,
                    format!("{prefix}.stack.durability"),
                    drop.stack.durability_millionths.map(u64::from),
                );
                hash_field(
                    &mut row,
                    format!("{prefix}.stack.metadataHash"),
                    drop.stack.metadata_hash,
                );
                string_field(&mut row, format!("{prefix}.dropId"), &drop.drop_id);
                u64_field(&mut row, format!("{prefix}.entityId"), drop.entity_id.packed());
                string_field(
                    &mut row,
                    format!("{prefix}.custodyContainer"),
                    container_view_key!(&drop.custody_container),
                );
                u64_field(&mut row, format!("{prefix}.custodySlot"), u64::from(drop.custody_slot));
                u64_field(&mut row, format!("{prefix}.custodyRevision"), drop.custody_revision);
                u64_field(&mut row, format!("{prefix}.spatialRevision"), drop.spatial_revision);
                for (suffix, value) in [
                    ("position.xMilli", drop.position.x_milli),
                    ("position.yMilli", drop.position.y_milli),
                    ("position.zMilli", drop.position.z_milli),
                    ("velocity.xMilliPerSecond", drop.velocity_milli_per_second.x_milli),
                    ("velocity.yMilliPerSecond", drop.velocity_milli_per_second.y_milli),
                    ("velocity.zMilliPerSecond", drop.velocity_milli_per_second.z_milli),
                ] {
                    i64_field(&mut row, format!("{prefix}.{suffix}"), value);
                }
                for (suffix, value) in [
                    ("rotation.yaw", drop.rotation.yaw),
                    ("rotation.pitch", drop.rotation.pitch),
                    ("rotation.roll", drop.rotation.roll),
                ] {
                    u64_field(&mut row, format!("{prefix}.{suffix}"), u64::from(value));
                }
                u64_field(&mut row, format!("{prefix}.createdTick"), drop.created_tick);
                option_u64_field(&mut row, format!("{prefix}.expiresTick"), drop.expires_tick);
                option_string_field(
                    &mut row,
                    format!("{prefix}.pickupLockActorId"),
                    drop.pickup_lock_actor_id.as_deref(),
                );
                u64_field(&mut row, format!("{prefix}.pickupUnlockTick"), drop.pickup_unlock_tick);
                hash_field(&mut row, format!("{prefix}.originHash"), drop.origin_hash);
                hash_field(
                    &mut row,
                    format!("{prefix}.content.configuredManifestHash"),
                    drop.content.configured_manifest_hash,
                );
                hash_field(
                    &mut row,
                    format!("{prefix}.content.installedManifestHash"),
                    drop.content.installed_manifest_hash,
                );
                hash_field(
                    &mut row,
                    format!("{prefix}.content.installedRegistryHash"),
                    drop.content.installed_registry_hash,
                );
                hash_field(
                    &mut row,
                    format!("{prefix}.content.itemContentHash"),
                    drop.content.item_content_hash,
                );
                u64_field(
                    &mut row,
                    format!("{prefix}.content.itemContentVersion"),
                    u64::from(drop.content.item_content_version),
                );
            }
        }
        if let Some(input) = runtime.last_applied_input() {
            u64_field(&mut row, "input.targetTick", input.target_tick);
            i64_field(&mut row, "input.moveX", i64::from(input.move_x));
            i64_field(&mut row, "input.moveZ", i64::from(input.move_z));
            i64_field(&mut row, "input.lookYaw", i64::from(input.look_yaw));
            i64_field(&mut row, "input.lookPitch", i64::from(input.look_pitch));
        }
        rows.push(row);
    }
    if let Some(world_view) = world_view {
        for player in &world_view.players {
            let binding = &player.binding;
            let mut row = domain_row(2, format!("binding:{}", binding.player_id.packed()), binding.revision);
            u64_field(&mut row, "playerId", binding.player_id.packed());
            string_field(&mut row, "actorId", &binding.actor_id);
            u64_field(&mut row, "entityId", binding.entity_id.packed());
            string_field(
                &mut row,
                "inventoryContainer",
                container_view_key!(&binding.inventory_container),
            );
            string_field(
                &mut row,
                "equipmentContainer",
                container_view_key!(&binding.equipment_container),
            );
            u64_field(&mut row, "selectedSlot", u64::from(binding.selected_slot));
            option_u64_field(&mut row, "backSlot", binding.back_slot.map(u64::from));
            u64_field(
                &mut row,
                "inventoryContainerRevision",
                player.inventory_container_revision,
            );
            u64_field(
                &mut row,
                "equipmentContainerRevision",
                player.equipment_container_revision,
            );
            u64_field(&mut row, "entityRevision", player.entity_revision);
            bool_field(&mut row, "held.present", player.held_stack.is_some());
            if let Some(stack) = &player.held_stack {
                u64_field(&mut row, "held.itemCode", u64::from(stack.item_code));
                u64_field(&mut row, "held.count", u64::from(stack.count));
                option_u64_field(&mut row, "held.durability", stack.durability_millionths.map(u64::from));
                hash_field(&mut row, "held.metadataHash", stack.metadata_hash);
            }
            rows.push(row);
        }
    }
    if let Some(camera) = camera {
        rows.push(camera_domain_row(camera));
    } else {
        blockers.push("camera-projection-and-orientation-not-authoritative".into());
    }
    if world_view.is_none() {
        blockers.extend([
            "player-inventory-container-binding-not-explicit".into(),
            "world-view-extraction-invariant-rejected".into(),
        ]);
    }
    DomainViewV1 {
        domain: 2,
        revision: extraction_revision,
        status: if blockers.is_empty() {
            DomainViewStatusV1::Complete
        } else {
            DomainViewStatusV1::Partial
        },
        rows,
        blockers,
    }
}

fn inventory_domain_view(
    runtime: &IntegratedRuntimeV2,
    world_view: Option<&WorldViewExtractionInputV1>,
) -> DomainViewV1 {
    let state = &runtime.gameplay().state.inventory;
    let mut rows = Vec::new();
    for (code, item) in &state.items {
        let mut row = domain_row(1, format!("item:{code}"), 0);
        u64_field(&mut row, "code", u64::from(*code));
        string_field(&mut row, "contentId", &item.content_id);
        u64_field(&mut row, "maxStack", u64::from(item.max_stack));
        for (index, tag) in item.tags.iter().enumerate() {
            string_field(&mut row, format!("tag.{index:04}"), tag);
        }
        rows.push(row);
    }
    for (key, container) in &state.containers {
        let stable = container_view_key!(key);
        let mut header = domain_row(2, format!("container:{stable}"), container.revision);
        u64_field(&mut header, "kind", key.kind as u64);
        string_field(&mut header, "id", &key.id);
        option_string_field(&mut header, "ownerId", key.owner_id.as_deref());
        u64_field(&mut header, "slotCount", container.slots.len() as u64);
        rows.push(header);
        for (index, stack) in container.slots.iter().enumerate() {
            let mut slot = domain_row(3, format!("slot:{stable}:{index:05}"), container.revision);
            u64_field(&mut slot, "index", index as u64);
            option_string_field(&mut slot, "equipmentTag", container.equipment_tags[index].as_deref());
            bool_field(&mut slot, "occupied", stack.is_some());
            if let Some(stack) = stack {
                u64_field(&mut slot, "itemCode", u64::from(stack.item_code));
                u64_field(&mut slot, "count", u64::from(stack.count));
                bool_field(&mut slot, "durability.present", stack.durability_millionths.is_some());
                if let Some(value) = stack.durability_millionths {
                    u64_field(&mut slot, "durability.value", u64::from(value));
                }
                hash_field(&mut slot, "metadataHash", stack.metadata_hash);
            }
            rows.push(slot);
        }
    }
    for (recipe_id, recipe) in &state.recipes {
        let mut row = domain_row(4, format!("recipe:{recipe_id}"), 0);
        option_string_field(&mut row, "stationTag", recipe.station_tag.as_deref());
        u64_field(&mut row, "ticks", u64::from(recipe.ticks));
        for (index, ingredient) in recipe.inputs.iter().enumerate() {
            u64_field(
                &mut row,
                format!("input.{index:04}.itemCode"),
                u64::from(ingredient.item_code),
            );
            u64_field(&mut row, format!("input.{index:04}.count"), u64::from(ingredient.count));
            bool_field(
                &mut row,
                format!("input.{index:04}.metadata.present"),
                ingredient.metadata_hash.is_some(),
            );
            if let Some(hash) = ingredient.metadata_hash {
                hash_field(&mut row, format!("input.{index:04}.metadata.value"), hash);
            }
        }
        for (index, stack) in recipe.outputs.iter().enumerate() {
            u64_field(
                &mut row,
                format!("output.{index:04}.itemCode"),
                u64::from(stack.item_code),
            );
            u64_field(&mut row, format!("output.{index:04}.count"), u64::from(stack.count));
            hash_field(&mut row, format!("output.{index:04}.metadataHash"), stack.metadata_hash);
        }
        rows.push(row);
    }
    for (furnace_id, furnace) in &state.furnaces {
        let mut row = domain_row(5, format!("furnace:{furnace_id}"), furnace.revision);
        string_field(&mut row, "recipeId", &furnace.recipe_id);
        string_field(&mut row, "source", container_view_key!(&furnace.source));
        string_field(&mut row, "destination", container_view_key!(&furnace.destination));
        u64_field(&mut row, "progressTicks", furnace.progress_ticks);
        u64_field(&mut row, "fuelTicks", furnace.fuel_ticks);
        u64_field(&mut row, "lastTick", furnace.last_tick);
        bool_field(&mut row, "active", furnace.active);
        rows.push(row);
    }
    let mut presentation_missing = false;
    let mut presentation_unmapped = false;
    if let Some(world_view) = world_view {
        for dropped in &world_view.dropped_items {
            let presentation = runtime.dropped_item_render_presentation_binding_v1(dropped.stack.item_code);
            presentation_missing |= matches!(
                presentation,
                IntegratedRuntimeRenderPresentationBindingV1::Missing { .. }
            );
            presentation_unmapped |= matches!(presentation, IntegratedRuntimeRenderPresentationBindingV1::Unmapped);
            rows.push(dropped_item_world_view_row!(dropped, presentation));
        }
    }
    let mut blockers = Vec::new();
    if world_view.is_none() {
        blockers.extend([
            "dropped-item-spatial-state-not-authoritative".into(),
            "dropped-item-presentation-unavailable".into(),
            "world-view-extraction-invariant-rejected".into(),
        ]);
    }
    if presentation_missing {
        blockers.push("dropped-item-presentation-missing".into());
    }
    if presentation_unmapped {
        blockers.push("dropped-item-presentation-unmapped".into());
    }
    DomainViewV1 {
        domain: 3,
        revision: runtime_extraction_revision(runtime),
        status: if blockers.is_empty() {
            DomainViewStatusV1::Complete
        } else {
            DomainViewStatusV1::Partial
        },
        rows,
        blockers,
    }
}

macro_rules! resource_fields {
    ($row:expr, $prefix:expr, $resource:expr, $amount:expr) => {{
        let prefix = $prefix;
        let resource = $resource;
        u64_field($row, format!("{prefix}.kind"), resource.kind as u64);
        string_field($row, format!("{prefix}.contentId"), &resource.content_id);
        bool_field($row, format!("{prefix}.itemCode.present"), resource.item_code.is_some());
        if let Some(code) = resource.item_code {
            u64_field($row, format!("{prefix}.itemCode.value"), u64::from(code));
        }
        hash_field($row, format!("{prefix}.metadataHash"), resource.metadata_hash);
        u64_field($row, format!("{prefix}.amount"), $amount);
    }};
}

fn machine_domain_view(runtime: &IntegratedRuntimeV2, world_view: Option<&WorldViewExtractionInputV1>) -> DomainViewV1 {
    let state = &runtime.gameplay().state.machines;
    let mut rows = Vec::new();
    for (machine_id, machine) in &state.machines {
        let mut row = domain_row(1, format!("machine:{machine_id}"), machine.revision);
        option_string_field(&mut row, "ownerId", machine.owner_id.as_deref());
        u64_field(&mut row, "kind", machine.kind as u64);
        bool_field(&mut row, "active", machine.active);
        option_string_field(&mut row, "recipeId", machine.recipe_id.as_deref());
        u64_field(&mut row, "progressTicks", machine.progress_ticks);
        u64_field(&mut row, "lastTick", machine.last_tick);
        bool_field(&mut row, "lease.present", machine.lease.is_some());
        if let Some(lease) = &machine.lease {
            string_field(&mut row, "lease.id", &lease.lease_id);
            string_field(&mut row, "lease.ownerId", &lease.owner_id);
            u64_field(&mut row, "lease.startTick", lease.start_tick);
            u64_field(&mut row, "lease.endTick", lease.end_tick);
            u64_field(&mut row, "lease.maxCycles", u64::from(lease.max_cycles));
        }
        bool_field(&mut row, "settings.present", machine.settings.is_some());
        if let Some(settings) = &machine.settings {
            string_field(&mut row, "settings.typeId", &settings.type_id);
            u64_field(&mut row, "settings.schema", u64::from(settings.schema));
            bytes_field(&mut row, "settings.bytes", &settings.bytes);
        }
        rows.push(row);
        for (port_id, port) in &machine.ports {
            let mut port_row = domain_row(2, format!("port:{machine_id}:{port_id}"), machine.revision);
            u64_field(&mut port_row, "mode", port.mode as u64);
            u64_field(&mut port_row, "capacity", port.capacity);
            u64_field(&mut port_row, "amount", port.amount());
            for (index, kind) in port.accepted.iter().enumerate() {
                u64_field(&mut port_row, format!("accepted.{index:03}"), *kind as u64);
            }
            for (index, (resource, amount)) in port.resources.iter().enumerate() {
                resource_fields!(&mut port_row, &format!("resource.{index:04}"), resource, *amount);
            }
            rows.push(port_row);
        }
    }
    for (recipe_id, recipe) in &state.recipes {
        let mut row = domain_row(3, format!("machine-recipe:{recipe_id}"), 0);
        u64_field(&mut row, "durationTicks", u64::from(recipe.duration_ticks));
        for (index, (resource, amount)) in recipe.inputs.iter().enumerate() {
            resource_fields!(&mut row, &format!("input.{index:04}"), resource, *amount);
        }
        for (index, (resource, amount)) in recipe.outputs.iter().enumerate() {
            resource_fields!(&mut row, &format!("output.{index:04}"), resource, *amount);
        }
        rows.push(row);
    }
    for (network_id, network) in &state.power_networks {
        let mut row = domain_row(4, format!("power:{network_id}"), network.revision);
        u64_field(&mut row, "stored", network.stored);
        u64_field(&mut row, "capacity", network.capacity);
        for (index, member) in network.members.iter().enumerate() {
            string_field(&mut row, format!("member.{index:04}"), member);
        }
        rows.push(row);
    }
    let mut presentation_missing = false;
    let mut presentation_unmapped = false;
    if let Some(world_view) = world_view {
        for machine in &world_view.machines {
            let presentation = runtime.machine_anchor_render_presentation_binding_v1(&machine.anchor.presentation_id);
            presentation_missing |= matches!(
                presentation,
                IntegratedRuntimeRenderPresentationBindingV1::Missing { .. }
            );
            presentation_unmapped |= matches!(presentation, IntegratedRuntimeRenderPresentationBindingV1::Unmapped);
            rows.push(machine_anchor_world_view_row!(machine, presentation));
        }
    }
    let mut blockers = vec!["world-prop-presentation-not-authoritative".into()];
    if world_view.is_none() {
        blockers.extend([
            "machine-light-profiles-not-authoritative".into(),
            "machine-spatial-anchors-not-authoritative".into(),
            "world-view-extraction-invariant-rejected".into(),
        ]);
    }
    if presentation_missing {
        blockers.push("machine-presentation-missing".into());
    }
    if presentation_unmapped {
        blockers.push("machine-presentation-unmapped".into());
    }
    DomainViewV1 {
        domain: 4,
        revision: runtime_extraction_revision(runtime),
        status: DomainViewStatusV1::Partial,
        rows,
        blockers,
    }
}

fn combat_domain_view(runtime: &IntegratedRuntimeV2) -> DomainViewV1 {
    let state = &runtime.gameplay().state.combat;
    let mut rows = Vec::new();
    let mut blockers = vec![
        "combat-projectile-and-summon-render-presentation-not-authoritative".into(),
        "combat-general-r7-r6-health-parity-not-authoritative".into(),
    ];
    for (record_id, combatant) in &state.combatants {
        let mut row = domain_row(1, format!("combatant:{record_id}"), combatant.revision);
        u64_field(&mut row, "combatantRevision", combatant.revision);
        option_string_field(&mut row, "ownerId", combatant.owner_id.as_deref());
        if let Some(entity_id) = combatant.entity_id {
            u64_field(&mut row, "entityId", entity_id.packed());
        }
        string_field(
            &mut row,
            "vitalUnits",
            match combatant.vital_units as u8 {
                0 => "legacy-whole-hearts-v1",
                1 => "millihearts-v1",
                _ => unreachable!("CombatVitalUnits is a closed native enum"),
            },
        );
        let cross_domain_parity = runtime.player().is_some_and(|player| {
            player.binding.actor_id == *record_id
                && combatant.entity_id == Some(player.entity_id)
                && runtime
                    .player_combat_bootstrap_status_v1(
                        &blockwild_engine::PlayerBootstrapStatusQueryWireV1 {
                            external_entity_id: player.binding.external_entity_id.clone(),
                            actor_id: player.binding.actor_id.clone(),
                            player_id: player.binding.player_id,
                        },
                        CanonicalHash::default(),
                    )
                    .ok()
                    .and_then(|status| status.combatant)
                    .is_some_and(|status| status.cross_domain_parity)
        });
        bool_field(&mut row, "crossDomainParity", cross_domain_parity);
        for (key, value) in [
            ("position.xMilli", combatant.position.x_milli),
            ("position.yMilli", combatant.position.y_milli),
            ("position.zMilli", combatant.position.z_milli),
        ] {
            i64_field(&mut row, key, i64::from(value));
        }
        for (key, value) in [
            ("health", combatant.health),
            ("maxHealth", combatant.max_health),
            ("stamina", combatant.stamina),
            ("mana", combatant.mana),
            ("armor", combatant.armor),
        ] {
            u64_field(&mut row, key, u64::from(value));
        }
        bool_field(&mut row, "alive", combatant.alive);
        for (kind, resistance) in &combatant.resist_per_mille {
            u64_field(
                &mut row,
                format!("resistance.{:02}", *kind as u8),
                u64::from(*resistance),
            );
        }
        for (status_id, status) in &combatant.statuses {
            string_field(&mut row, format!("status.{status_id}.sourceId"), &status.source_id);
            i64_field(
                &mut row,
                format!("status.{status_id}.magnitude"),
                i64::from(status.magnitude),
            );
            u64_field(&mut row, format!("status.{status_id}.expiresTick"), status.expires_tick);
            u64_field(&mut row, format!("status.{status_id}.stacks"), u64::from(status.stacks));
        }
        for (ability, tick) in &combatant.cooldown_until {
            u64_field(&mut row, format!("cooldown.{ability}"), *tick);
        }
        rows.push(row);
    }
    for (ability_id, ability) in &state.abilities {
        let mut row = domain_row(2, format!("ability:{ability_id}"), 0);
        u64_field(&mut row, "damageKind", ability.damage_kind as u64);
        u64_field(&mut row, "baseDamage", u64::from(ability.base_damage));
        u64_field(&mut row, "rangeMilli", u64::from(ability.range_milli));
        u64_field(&mut row, "cooldownTicks", u64::from(ability.cooldown_ticks));
        u64_field(&mut row, "staminaCost", u64::from(ability.stamina_cost));
        u64_field(&mut row, "manaCost", u64::from(ability.mana_cost));
        bool_field(
            &mut row,
            "projectileSpeed.present",
            ability.projectile_speed_milli.is_some(),
        );
        if let Some(value) = ability.projectile_speed_milli {
            u64_field(&mut row, "projectileSpeed.value", u64::from(value));
        }
        rows.push(row);
    }
    for (projectile_id, projectile) in &state.projectiles {
        let mut row = domain_row(3, format!("projectile:{projectile_id}"), projectile.revision);
        u64_field(&mut row, "authorityRevision", projectile.revision);
        string_field(&mut row, "sourceId", &projectile.source_id);
        option_string_field(&mut row, "targetId", projectile.target_id.as_deref());
        string_field(&mut row, "abilityId", &projectile.ability_id);
        for (key, value) in [
            ("position.xMilli", projectile.position.x_milli),
            ("position.yMilli", projectile.position.y_milli),
            ("position.zMilli", projectile.position.z_milli),
            ("velocity.xMilli", projectile.velocity.x_milli),
            ("velocity.yMilli", projectile.velocity.y_milli),
            ("velocity.zMilli", projectile.velocity.z_milli),
        ] {
            i64_field(&mut row, key, i64::from(value));
        }
        u64_field(&mut row, "spawnedTick", projectile.spawned_tick);
        u64_field(&mut row, "expiresTick", projectile.expires_tick);
        string_field(&mut row, "presentation.role", "projectile");
        if let Some(link) = &projectile.presentation {
            u64_field(&mut row, "entityId", link.entity_id.packed());
            string_field(&mut row, "presentation.contentDomain", "item");
            string_field(&mut row, "presentation.contentId", &link.content_id);
            string_field(&mut row, "presentation.presentationId", &link.presentation_id);
            if let Some(entity) = runtime.entities().hot().get(&link.entity_id) {
                u64_field(&mut row, "entityRevision", entity.entity_revision);
                match runtime.projectile_render_presentation_binding_v1(
                    &link.presentation_id,
                    link.content_domain,
                    &link.content_id,
                ) {
                    IntegratedRuntimeRenderPresentationBindingV1::Exact {
                        profile_id,
                        model_id,
                        content_hash,
                        content_version,
                    } => {
                        string_field(&mut row, "presentation.status", "exact");
                        string_field(&mut row, "presentation.profileId", profile_id);
                        string_field(&mut row, "presentation.modelId", model_id);
                        hash_field(&mut row, "presentation.contentHash", content_hash);
                        u64_field(&mut row, "presentation.contentVersion", u64::from(content_version));
                    }
                    IntegratedRuntimeRenderPresentationBindingV1::Missing { blocker_id } => {
                        string_field(&mut row, "presentation.status", "missing");
                        string_field(&mut row, "presentation.blockerId", blocker_id);
                        blockers.push("combat-projectile-presentation-missing".into());
                    }
                    IntegratedRuntimeRenderPresentationBindingV1::Unmapped => {
                        string_field(&mut row, "presentation.status", "unmapped");
                        string_field(
                            &mut row,
                            "presentation.blockerId",
                            "combat-projectile-presentation-unmapped",
                        );
                        blockers.push("combat-projectile-presentation-unmapped".into());
                    }
                }
            } else {
                string_field(&mut row, "presentation.status", "invalid-link");
                string_field(&mut row, "presentation.blockerId", "combat-projectile-r6-link-missing");
                blockers.push("combat-projectile-r6-link-missing".into());
            }
        } else {
            string_field(&mut row, "presentation.status", "unlinked");
            string_field(&mut row, "presentation.blockerId", "combat-projectile-r6-link-missing");
            blockers.push("combat-projectile-r6-link-missing".into());
        }
        rows.push(row);
    }
    for (record_id, creature) in &state.creatures {
        let mut row = domain_row(4, format!("creature:{record_id}"), creature.revision);
        string_field(&mut row, "contentId", &creature.creature_content_id);
        string_field(&mut row, "variantId", &creature.variant_id);
        u64_field(&mut row, "disposition", creature.disposition as u64);
        u64_field(&mut row, "readiness", creature.readiness as u64);
        option_string_field(&mut row, "capturedBy", creature.captured_by.as_deref());
        option_string_field(&mut row, "ownerId", creature.owner_id.as_deref());
        u64_field(&mut row, "bond", u64::from(creature.bond));
        u64_field(&mut row, "care", u64::from(creature.care));
        u64_field(&mut row, "pacificationScore", u64::from(creature.pacification_score));
        u64_field(&mut row, "lastAggressionTick", creature.last_aggression_tick);
        for (index, equipment) in creature.equipment_ids.iter().enumerate() {
            string_field(&mut row, format!("equipment.{index:04}"), equipment);
        }
        for (index, flag) in creature.research_flags.iter().enumerate() {
            string_field(&mut row, format!("research.{index:04}"), flag);
        }
        rows.push(row);
    }
    for (summon_id, summon) in &state.summons {
        let mut row = domain_row(5, format!("summon:{summon_id}"), summon.revision);
        u64_field(&mut row, "authorityRevision", summon.revision);
        string_field(&mut row, "contentId", &summon.content_id);
        string_field(&mut row, "ownerId", &summon.owner_id);
        u64_field(&mut row, "spawnedTick", summon.spawned_tick);
        bool_field(&mut row, "expiresTick.present", summon.expires_tick.is_some());
        if let Some(value) = summon.expires_tick {
            u64_field(&mut row, "expiresTick.value", value);
        }
        bool_field(&mut row, "grounded", summon.grounded);
        if let Some(position) = summon.position {
            for (key, value) in [
                ("position.xMilli", position.x_milli),
                ("position.yMilli", position.y_milli),
                ("position.zMilli", position.z_milli),
            ] {
                i64_field(&mut row, key, i64::from(value));
            }
        }
        string_field(&mut row, "presentation.role", "summon");
        if let Some(link) = &summon.presentation {
            u64_field(&mut row, "entityId", link.entity_id.packed());
            string_field(&mut row, "presentation.contentDomain", "creature-profile");
            string_field(&mut row, "presentation.contentId", &link.content_id);
            string_field(&mut row, "presentation.presentationId", &link.presentation_id);
            if let Some(entity) = runtime.entities().hot().get(&link.entity_id) {
                u64_field(&mut row, "entityRevision", entity.entity_revision);
                match runtime.summon_render_presentation_binding_v1(
                    &link.presentation_id,
                    link.content_domain,
                    &link.content_id,
                ) {
                    IntegratedRuntimeRenderPresentationBindingV1::Exact {
                        profile_id,
                        model_id,
                        content_hash,
                        content_version,
                    } => {
                        string_field(&mut row, "presentation.status", "exact");
                        string_field(&mut row, "presentation.profileId", profile_id);
                        string_field(&mut row, "presentation.modelId", model_id);
                        hash_field(&mut row, "presentation.contentHash", content_hash);
                        u64_field(&mut row, "presentation.contentVersion", u64::from(content_version));
                    }
                    IntegratedRuntimeRenderPresentationBindingV1::Missing { blocker_id } => {
                        string_field(&mut row, "presentation.status", "missing");
                        string_field(&mut row, "presentation.blockerId", blocker_id);
                        blockers.push("combat-summon-presentation-missing".into());
                    }
                    IntegratedRuntimeRenderPresentationBindingV1::Unmapped => {
                        string_field(&mut row, "presentation.status", "unmapped");
                        string_field(
                            &mut row,
                            "presentation.blockerId",
                            "combat-summon-presentation-unmapped",
                        );
                        blockers.push("combat-summon-presentation-unmapped".into());
                    }
                }
            } else {
                string_field(&mut row, "presentation.status", "invalid-link");
                string_field(&mut row, "presentation.blockerId", "combat-summon-r6-link-missing");
                blockers.push("combat-summon-r6-link-missing".into());
            }
        } else {
            string_field(&mut row, "presentation.status", "unlinked");
            string_field(&mut row, "presentation.blockerId", "combat-summon-r6-link-missing");
            blockers.push("combat-summon-r6-link-missing".into());
        }
        rows.push(row);
    }
    DomainViewV1 {
        domain: 5,
        revision: runtime.gameplay().state.revision.combat,
        status: DomainViewStatusV1::Partial,
        rows,
        blockers,
    }
}

fn progression_domain_view(runtime: &IntegratedRuntimeV2) -> DomainViewV1 {
    let state = &runtime.gameplay().state.progression;
    let mut rows = Vec::new();
    for (player_id, player) in &state.players {
        let mut row = domain_row(1, format!("player:{player_id}"), player.revision);
        u64_field(&mut row, "level", u64::from(player.level));
        u64_field(&mut row, "perkPoints", u64::from(player.perk_points));
        u64_field(&mut row, "fastTravelCharges", u64::from(player.fast_travel_charges));
        for (skill_id, skill) in &player.skills {
            u64_field(&mut row, format!("skill.{skill_id}.rank"), u64::from(skill.rank));
            u64_field(&mut row, format!("skill.{skill_id}.xp"), skill.xp);
        }
        for (index, perk) in player.unlocked_perks.iter().enumerate() {
            string_field(&mut row, format!("perk.{index:04}"), perk);
        }
        for (index, flag) in player.research_flags.iter().enumerate() {
            string_field(&mut row, format!("research.{index:04}"), flag);
        }
        rows.push(row);
    }
    for (perk_id, perk) in &state.perks {
        let mut row = domain_row(2, format!("perk:{perk_id}"), 0);
        string_field(&mut row, "skillId", &perk.skill_id);
        u64_field(&mut row, "requiredRank", u64::from(perk.required_rank));
        u64_field(&mut row, "cost", u64::from(perk.cost));
        for (index, prerequisite) in perk.prerequisites.iter().enumerate() {
            string_field(&mut row, format!("prerequisite.{index:04}"), prerequisite);
        }
        rows.push(row);
    }
    for (record_id, quest) in &state.quests {
        let mut row = domain_row(3, format!("quest:{record_id}"), quest.revision);
        string_field(&mut row, "ownerId", &quest.owner_id);
        string_field(&mut row, "questId", &quest.quest_id);
        u64_field(&mut row, "stage", u64::from(quest.stage));
        bool_field(&mut row, "completed", quest.completed);
        for (index, choice) in quest.choices.iter().enumerate() {
            string_field(&mut row, format!("choice.{index:04}"), choice);
        }
        for (index, flag) in quest.flags.iter().enumerate() {
            string_field(&mut row, format!("flag.{index:04}"), flag);
        }
        rows.push(row);
    }
    for (record_id, alignment) in &state.factions {
        let family = "faction";
        let mut row = domain_row(4, format!("{family}:{record_id}"), alignment.revision);
        string_field(&mut row, "family", family);
        string_field(&mut row, "ownerId", &alignment.owner_id);
        string_field(&mut row, "contentId", &alignment.content_id);
        i64_field(&mut row, "standing", i64::from(alignment.standing));
        u64_field(&mut row, "rank", u64::from(alignment.rank));
        for (index, flag) in alignment.flags.iter().enumerate() {
            string_field(&mut row, format!("flag.{index:04}"), flag);
        }
        rows.push(row);
    }
    for (record_id, alignment) in &state.guilds {
        let family = "guild";
        let mut row = domain_row(4, format!("{family}:{record_id}"), alignment.revision);
        string_field(&mut row, "family", family);
        string_field(&mut row, "ownerId", &alignment.owner_id);
        string_field(&mut row, "contentId", &alignment.content_id);
        i64_field(&mut row, "standing", i64::from(alignment.standing));
        u64_field(&mut row, "rank", u64::from(alignment.rank));
        for (index, flag) in alignment.flags.iter().enumerate() {
            string_field(&mut row, format!("flag.{index:04}"), flag);
        }
        rows.push(row);
    }
    for (owner_id, wallet) in &state.wallets {
        let mut row = domain_row(5, format!("wallet:{owner_id}"), wallet.revision);
        for (currency, balance) in &wallet.balances {
            u64_field(&mut row, format!("balance.{currency}"), *balance);
        }
        rows.push(row);
    }
    for (listing_id, listing) in &state.listings {
        let mut row = domain_row(6, format!("listing:{listing_id}"), listing.revision);
        string_field(&mut row, "sellerId", &listing.seller_id);
        string_field(&mut row, "contentId", &listing.content_id);
        string_field(&mut row, "currencyId", &listing.currency_id);
        u64_field(&mut row, "unitPrice", listing.unit_price);
        u64_field(&mut row, "available", u64::from(listing.available));
        rows.push(row);
    }
    for (settlement_id, settlement) in &state.settlements {
        let mut row = domain_row(7, format!("settlement:{settlement_id}"), settlement.revision);
        string_field(&mut row, "factionId", &settlement.faction_id);
        u64_field(&mut row, "prosperity", u64::from(settlement.prosperity));
        u64_field(&mut row, "safety", u64::from(settlement.safety));
        u64_field(&mut row, "population", u64::from(settlement.population));
        for (index, upgrade) in settlement.upgrades.iter().enumerate() {
            string_field(&mut row, format!("upgrade.{index:04}"), upgrade);
        }
        rows.push(row);
    }
    for (dragon_id, dragon) in &state.dragons {
        let mut row = domain_row(8, format!("dragon:{dragon_id}"), dragon.revision);
        string_field(&mut row, "ownerId", &dragon.owner_id);
        string_field(&mut row, "speciesId", &dragon.species_id);
        string_field(&mut row, "variantId", &dragon.variant_id);
        u64_field(&mut row, "level", u64::from(dragon.level));
        u64_field(&mut row, "xp", dragon.xp);
        u64_field(&mut row, "bond", u64::from(dragon.bond));
        for (index, movement) in dragon.unlocked_moves.iter().enumerate() {
            string_field(&mut row, format!("move.{index:04}"), movement);
        }
        for (index, equipment) in dragon.equipment_ids.iter().enumerate() {
            string_field(&mut row, format!("equipment.{index:04}"), equipment);
        }
        rows.push(row);
    }
    for (encounter_id, encounter) in &state.legendary {
        let mut row = domain_row(9, format!("legendary:{encounter_id}"), encounter.revision);
        string_field(&mut row, "creatureId", &encounter.creature_id);
        u64_field(&mut row, "phase", u64::from(encounter.phase));
        bool_field(&mut row, "resolved", encounter.resolved);
        for (index, player) in encounter.eligible_players.iter().enumerate() {
            string_field(&mut row, format!("eligible.{index:04}"), player);
        }
        for (index, flag) in encounter.flags.iter().enumerate() {
            string_field(&mut row, format!("flag.{index:04}"), flag);
        }
        rows.push(row);
    }
    for (owner_id, history) in &state.dialogue_history {
        let mut row = domain_row(10, format!("dialogue:{owner_id}"), history.len() as u64);
        for (index, choice) in history.iter().enumerate() {
            string_field(&mut row, format!("choice.{index:04}"), choice);
        }
        rows.push(row);
    }
    DomainViewV1 {
        domain: 6,
        revision: runtime.gameplay().state.revision.progression,
        status: DomainViewStatusV1::Complete,
        rows,
        blockers: Vec::new(),
    }
}

fn cardforge_domain_view(runtime: &IntegratedRuntimeV2) -> DomainViewV1 {
    let state = &runtime.gameplay().state.cardforge;
    let mut rows = Vec::new();
    for (printing, card) in &state.cards {
        let stable = printing_view_key!(printing);
        let mut row = domain_row(1, format!("card:{stable}"), 0);
        u64_field(&mut row, "rarity", card.rarity as u64);
        u64_field(&mut row, "deckCost", u64::from(card.deck_cost));
        u64_field(&mut row, "power", u64::from(card.power));
        u64_field(&mut row, "health", u64::from(card.health));
        for (index, class_id) in card.class_ids.iter().enumerate() {
            string_field(&mut row, format!("class.{index:04}"), class_id);
        }
        for (index, type_id) in card.type_ids.iter().enumerate() {
            string_field(&mut row, format!("type.{index:04}"), type_id);
        }
        if let Some(rules) = &card.rules {
            string_field(&mut row, "rules.typeId", &rules.type_id);
            u64_field(&mut row, "rules.schema", u64::from(rules.schema));
            bytes_field(&mut row, "rules.bytes", &rules.bytes);
        }
        rows.push(row);
    }
    for (pack_id, pack) in &state.packs {
        let mut row = domain_row(2, format!("pack:{pack_id}"), 0);
        for (slot_index, slot) in pack.slots.iter().enumerate() {
            for (candidate_index, candidate) in slot.candidates.iter().enumerate() {
                string_field(
                    &mut row,
                    format!("slot.{slot_index:03}.candidate.{candidate_index:04}.printing"),
                    printing_view_key!(&candidate.printing),
                );
                u64_field(
                    &mut row,
                    format!("slot.{slot_index:03}.candidate.{candidate_index:04}.weight"),
                    u64::from(candidate.weight),
                );
            }
        }
        rows.push(row);
    }
    for (record_id, record) in &state.pack_records {
        let mut row = domain_row(3, format!("pack-record:{record_id}"), record.revision);
        string_field(&mut row, "ownerId", &record.owner_id);
        string_field(&mut row, "packId", &record.pack_id);
        string_field(&mut row, "seed", &record.seed);
        bool_field(&mut row, "opened", record.opened);
        rows.push(row);
    }
    for (owner_id, custody) in &state.custody {
        let mut row = domain_row(4, format!("custody:{owner_id}"), custody.revision);
        for (index, reward) in custody.rewards_claimed.iter().enumerate() {
            string_field(&mut row, format!("reward.{index:04}"), reward);
        }
        rows.push(row);
        for (printing, count) in &custody.case {
            let mut holding = domain_row(
                5,
                format!("holding:{owner_id}:case:{}", printing_view_key!(printing)),
                custody.revision,
            );
            u64_field(&mut holding, "count", u64::from(*count));
            rows.push(holding);
        }
        for (printing, count) in &custody.archive {
            let mut holding = domain_row(
                5,
                format!("holding:{owner_id}:archive:{}", printing_view_key!(printing)),
                custody.revision,
            );
            u64_field(&mut holding, "count", u64::from(*count));
            rows.push(holding);
        }
    }
    for (rules_id, rules) in &state.deck_rules {
        let mut row = domain_row(6, format!("deck-rules:{rules_id}"), 0);
        u64_field(&mut row, "minCards", u64::from(rules.min_cards));
        u64_field(&mut row, "maxCards", u64::from(rules.max_cards));
        u64_field(&mut row, "maxCopies", u64::from(rules.max_copies));
        u64_field(&mut row, "maxCost", u64::from(rules.max_cost));
        for (index, class) in rules.allowed_classes.iter().enumerate() {
            string_field(&mut row, format!("allowedClass.{index:04}"), class);
        }
        for (index, card) in rules.banned_cards.iter().enumerate() {
            string_field(&mut row, format!("bannedCard.{index:04}"), card);
        }
        rows.push(row);
    }
    for (deck_id, deck) in &state.decks {
        let mut row = domain_row(7, format!("deck:{deck_id}"), deck.revision);
        string_field(&mut row, "ownerId", &deck.owner_id);
        string_field(&mut row, "rulesId", &deck.rules_id);
        for (printing, count) in &deck.cards {
            u64_field(
                &mut row,
                format!("card.{}", printing_view_key!(printing)),
                u64::from(*count),
            );
        }
        rows.push(row);
    }
    for (match_id, battle) in &state.battles {
        let mut row = domain_row(8, format!("battle:{match_id}"), battle.revision);
        u64_field(&mut row, "sequence", u64::from(battle.sequence));
        u64_field(&mut row, "activePlayer", u64::from(battle.active_player));
        option_string_field(&mut row, "winner", battle.winner.as_deref());
        for (index, player) in battle.players.iter().enumerate() {
            string_field(&mut row, format!("player.{index}.ownerId"), &player.owner_id);
            string_field(&mut row, format!("player.{index}.deckId"), &player.deck_id);
            u64_field(&mut row, format!("player.{index}.health"), u64::from(player.health));
            u64_field(&mut row, format!("player.{index}.resource"), u64::from(player.resource));
            for (card_index, printing) in player.hand.iter().enumerate() {
                string_field(
                    &mut row,
                    format!("player.{index}.hand.{card_index:04}"),
                    printing_view_key!(printing),
                );
            }
            for (card_index, printing) in player.draw_pile.iter().enumerate() {
                string_field(
                    &mut row,
                    format!("player.{index}.draw.{card_index:04}"),
                    printing_view_key!(printing),
                );
            }
            for (card_index, printing) in player.board.iter().enumerate() {
                string_field(
                    &mut row,
                    format!("player.{index}.board.{card_index:04}"),
                    printing_view_key!(printing),
                );
            }
        }
        rows.push(row);
    }
    DomainViewV1 {
        domain: 7,
        revision: runtime.gameplay().state.revision.cardforge,
        status: DomainViewStatusV1::Complete,
        rows,
        blockers: Vec::new(),
    }
}

fn environment_domain_view(
    runtime: &IntegratedRuntimeV2,
    world_view: Option<&WorldViewExtractionInputV1>,
) -> DomainViewV1 {
    let identity = runtime.identity();
    let mut row = domain_row(1, "location", identity.revision.world);
    string_field(&mut row, "universeId", &identity.universe_id);
    string_field(&mut row, "locationId", &identity.location_id);
    let Some(world_view) = world_view else {
        return DomainViewV1 {
            domain: 8,
            revision: identity.revision.world,
            status: DomainViewStatusV1::Absent,
            rows: vec![row],
            blockers: vec![
                "atmosphere-and-gravity-profile-not-authoritative".into(),
                "celestial-sky-state-not-authoritative".into(),
                "weather-lighting-and-fog-not-authoritative".into(),
                "world-view-extraction-invariant-rejected".into(),
            ],
        };
    };
    string_field(&mut row, "world.universeId", &world_view.identity.world.universe);
    string_field(&mut row, "world.locationId", &world_view.identity.world.location);
    hash_field(&mut row, "worldViewStateHash", world_view.identity.state_hash);
    hash_field(&mut row, "gameplayStateHash", world_view.gameplay_state_hash);
    hash_field(&mut row, "entityStateHash", world_view.entity_state_hash);
    hash_field(&mut row, "extractionHash", world_view.extraction_hash);
    for (key, value) in [
        ("revision.epoch", u64::from(world_view.identity.revision.epoch)),
        ("revision.sequence", world_view.identity.revision.sequence),
        ("revision.clock", world_view.identity.revision.clock),
        ("revision.machineAnchors", world_view.identity.revision.machine_anchors),
        ("revision.droppedItems", world_view.identity.revision.dropped_items),
        ("revision.playerBindings", world_view.identity.revision.player_bindings),
        ("revision.environment", world_view.identity.revision.environment),
        (
            "revision.atmosphereGravity",
            world_view.identity.revision.atmosphere_gravity,
        ),
        ("revision.celestial", world_view.identity.revision.celestial),
    ] {
        u64_field(&mut row, key, value);
    }
    let mut rows = vec![row];

    let environment = &world_view.environment;
    let mut lighting = domain_row(2, "environment-lighting", environment.revision);
    u64_field(&mut lighting, "observedTick", environment.observed_tick);
    u64_field(&mut lighting, "weather", environment.weather as u64);
    u64_field(&mut lighting, "weatherSeed", environment.weather_seed);
    u64_field(
        &mut lighting,
        "precipitationMillionths",
        u64::from(environment.precipitation_millionths),
    );
    u64_field(
        &mut lighting,
        "cloudCoverMillionths",
        u64::from(environment.cloud_cover_millionths),
    );
    u64_field(
        &mut lighting,
        "fogDensityMillionths",
        u64::from(environment.fog_density_millionths),
    );
    for (key, value) in [
        ("wind.xMilliPerSecond", environment.wind_milli_per_second.x_milli),
        ("wind.yMilliPerSecond", environment.wind_milli_per_second.y_milli),
        ("wind.zMilliPerSecond", environment.wind_milli_per_second.z_milli),
    ] {
        i64_field(&mut lighting, key, value);
    }
    for (key, value) in [
        ("ambient.redMillionths", environment.ambient_color.red),
        ("ambient.greenMillionths", environment.ambient_color.green),
        ("ambient.blueMillionths", environment.ambient_color.blue),
        ("ambientIrradianceMillionths", environment.ambient_irradiance_millionths),
        ("sky.redMillionths", environment.sky_color.red),
        ("sky.greenMillionths", environment.sky_color.green),
        ("sky.blueMillionths", environment.sky_color.blue),
        ("skyIrradianceMillionths", environment.sky_irradiance_millionths),
        (
            "lightningProbabilityMillionths",
            environment.lightning_probability_millionths,
        ),
    ] {
        u64_field(&mut lighting, key, u64::from(value));
    }
    rows.push(lighting);

    let atmosphere = &world_view.atmosphere_gravity;
    let mut atmosphere_row = domain_row(3, "atmosphere-gravity", atmosphere.revision);
    u64_field(
        &mut atmosphere_row,
        "pressureMillipascals",
        atmosphere.pressure_millipascals,
    );
    u64_field(
        &mut atmosphere_row,
        "temperatureMillikelvin",
        u64::from(atmosphere.temperature_millikelvin),
    );
    for (key, value) in [
        ("composition.oxygenMillionths", atmosphere.composition.oxygen),
        ("composition.nitrogenMillionths", atmosphere.composition.nitrogen),
        (
            "composition.carbonDioxideMillionths",
            atmosphere.composition.carbon_dioxide,
        ),
        ("composition.argonMillionths", atmosphere.composition.argon),
        ("composition.otherMillionths", atmosphere.composition.other),
        ("composition.toxicMillionths", atmosphere.composition.toxic),
        ("opticalExtinctionMillionths", atmosphere.optical_extinction_millionths),
    ] {
        u64_field(&mut atmosphere_row, key, u64::from(value));
    }
    u64_field(
        &mut atmosphere_row,
        "gravity.accelerationMicrometresPerSecondSquared",
        atmosphere.gravity.acceleration_micrometres_per_second_squared,
    );
    for (key, value) in [
        (
            "gravity.direction.xMillionths",
            atmosphere.gravity.direction.x_millionths,
        ),
        (
            "gravity.direction.yMillionths",
            atmosphere.gravity.direction.y_millionths,
        ),
        (
            "gravity.direction.zMillionths",
            atmosphere.gravity.direction.z_millionths,
        ),
    ] {
        i64_field(&mut atmosphere_row, key, i64::from(value));
    }
    bool_field(&mut atmosphere_row, "humanBreathable", atmosphere.is_human_breathable());
    rows.push(atmosphere_row);

    let celestial = &world_view.celestial;
    let mut celestial_header = domain_row(4, "celestial-sky", celestial.revision);
    u64_field(&mut celestial_header, "ephemerisTick", celestial.ephemeris_tick);
    u64_field(&mut celestial_header, "starfieldSeed", celestial.starfield_seed);
    u64_field(&mut celestial_header, "bodyCount", celestial.bodies.len() as u64);
    rows.push(celestial_header);
    for body in celestial.bodies.values() {
        rows.push(celestial_body_world_view_row!(body, celestial.revision));
    }
    DomainViewV1 {
        domain: 8,
        revision: world_view.identity.revision.sequence,
        status: DomainViewStatusV1::Complete,
        rows,
        blockers: Vec::new(),
    }
}

#[cfg(test)]
fn domain_views(runtime: &IntegratedRuntimeV2) -> Vec<DomainViewV1> {
    domain_views_with_world_view_result(runtime, runtime.world_view_extraction())
}

#[cfg(test)]
fn domain_views_with_world_view_result(
    runtime: &IntegratedRuntimeV2,
    world_view: Result<WorldViewExtractionInputV1, IntegratedRuntimeError>,
) -> Vec<DomainViewV1> {
    domain_views_with_context(
        runtime,
        world_view.as_ref().ok(),
        runtime_extraction_revision(runtime),
        None,
    )
}

#[cfg(test)]
fn domain_views_with_world_view(
    runtime: &IntegratedRuntimeV2,
    world_view: Option<&WorldViewExtractionInputV1>,
) -> Vec<DomainViewV1> {
    domain_views_with_context(runtime, world_view, runtime_extraction_revision(runtime), None)
}

fn domain_views_with_context(
    runtime: &IntegratedRuntimeV2,
    world_view: Option<&WorldViewExtractionInputV1>,
    extraction_revision: u64,
    camera: Option<&CameraExtractionV1>,
) -> Vec<DomainViewV1> {
    vec![
        runtime_domain_view(runtime),
        player_domain_view(runtime, world_view, extraction_revision, camera),
        inventory_domain_view(runtime, world_view),
        machine_domain_view(runtime, world_view),
        combat_domain_view(runtime),
        progression_domain_view(runtime),
        cardforge_domain_view(runtime),
        environment_domain_view(runtime, world_view),
    ]
}

#[cfg(test)]
fn encode_hud_extraction(runtime: &IntegratedRuntimeV2) -> Vec<u8> {
    let world_view = runtime.world_view_extraction();
    encode_hud_extraction_at(
        runtime,
        runtime_extraction_revision(runtime),
        world_view.as_ref().ok(),
        None,
    )
}

fn encode_hud_extraction_at(
    runtime: &IntegratedRuntimeV2,
    extraction_revision: u64,
    world_view: Option<&WorldViewExtractionInputV1>,
    camera: Option<&CameraExtractionV1>,
) -> Vec<u8> {
    let identity = runtime.identity();
    let views = domain_views_with_context(runtime, world_view, extraction_revision, camera);
    assert_eq!(views.len(), usize::from(DOMAIN_VIEW_COUNT_V1));
    let mut output = Vec::with_capacity(512);
    output.extend_from_slice(b"BWX0");
    output.extend_from_slice(&DOMAIN_VIEW_SCHEMA_V1.to_le_bytes());
    output.extend_from_slice(&extraction_revision.to_le_bytes());
    output.extend_from_slice(&identity.tick.to_le_bytes());
    output.extend_from_slice(identity.state_hash.as_bytes());
    output.extend_from_slice(runtime.content_manifest_hash().as_bytes());
    output.push(u8::from(runtime.content_ready()));
    output.extend_from_slice(&DOMAIN_VIEW_COUNT_V1.to_le_bytes());
    for view in views {
        output.extend_from_slice(&encode_domain_view(view));
    }
    output
}

fn encode_audio_extraction(runtime: &IntegratedRuntimeV2) -> Vec<u8> {
    let events = runtime.effect_events();
    let selected = events.len().min(256);
    let omitted = events.len().saturating_sub(selected);
    let mut output = Vec::with_capacity(16 + selected.saturating_mul(48));
    output.extend_from_slice(b"BWAU");
    output.extend_from_slice(&AUDIO_EXTRACTION_SCHEMA_V2.to_le_bytes());
    output.extend_from_slice(&runtime.tick().to_le_bytes());
    output.extend_from_slice(&(events.len() as u32).to_le_bytes());
    output.extend_from_slice(&(selected as u32).to_le_bytes());
    output.extend_from_slice(&(omitted as u32).to_le_bytes());
    for event in events.iter().skip(omitted) {
        output.extend_from_slice(&event.sequence.to_le_bytes());
        output.extend_from_slice(&event.tick.to_le_bytes());
        write_extraction_string(&mut output, &event.entity_external_id);
        output.push(event.kind as u8);
        output.extend_from_slice(&event.amount.to_le_bytes());
    }
    output
}

fn encode_platform_extraction(runtime: &IntegratedRuntimeV2) -> Vec<u8> {
    let diagnostics = runtime.persistence_dispatcher().diagnostics();
    let pending = diagnostics.queued.saturating_add(diagnostics.in_flight);
    if pending == 0 {
        return Vec::new();
    }
    let mut output = Vec::with_capacity(42);
    output.extend_from_slice(b"BWPQ");
    output.extend_from_slice(&1_u16.to_le_bytes());
    output.extend_from_slice(
        &u32::try_from(pending)
            .expect("persistence dispatcher pending count is bounded")
            .to_le_bytes(),
    );
    output.extend_from_slice(&(diagnostics.queued_bytes as u64).to_le_bytes());
    output.extend_from_slice(&diagnostics.persistence_revision.to_le_bytes());
    output.extend_from_slice(diagnostics.state_hash.as_bytes());
    output
}

fn write_extraction_string(output: &mut Vec<u8>, value: &str) {
    let length = u32::try_from(value.len()).expect("validated entity string fits u32");
    output.extend_from_slice(&length.to_le_bytes());
    output.extend_from_slice(value.as_bytes());
}

fn write_extraction_optional_string(output: &mut Vec<u8>, value: Option<&str>) {
    output.push(u8::from(value.is_some()));
    if let Some(value) = value {
        write_extraction_string(output, value);
    }
}

fn write_extraction_optional_entity_id(output: &mut Vec<u8>, value: Option<blockwild_types::EntityId>) {
    output.push(u8::from(value.is_some()));
    if let Some(value) = value {
        output.extend_from_slice(&value.packed().to_le_bytes());
    }
}

fn write_extraction_optional_u8(output: &mut Vec<u8>, value: Option<u8>) {
    output.push(u8::from(value.is_some()));
    if let Some(value) = value {
        output.push(value);
    }
}

fn write_extraction_bytes(output: &mut Vec<u8>, value: &[u8]) {
    let length = u32::try_from(value.len()).expect("validated entity component bytes fit u32");
    output.extend_from_slice(&length.to_le_bytes());
    output.extend_from_slice(value);
}

fn write_extraction_equipment(
    output: &mut Vec<u8>,
    equipment: &BTreeMap<String, blockwild_entity::EquipmentSlotState>,
) {
    output.extend_from_slice(
        &u32::try_from(equipment.len())
            .expect("validated entity equipment count fits u32")
            .to_le_bytes(),
    );
    for (slot_key, slot) in equipment {
        write_extraction_string(output, slot_key);
        write_extraction_string(output, &slot.item_key);
        output.extend_from_slice(&slot.count.to_le_bytes());
        output.extend_from_slice(&slot.durability.to_le_bytes());
        output.extend_from_slice(
            &u32::try_from(slot.custom.len())
                .expect("validated equipment metadata count fits u32")
                .to_le_bytes(),
        );
        for (key, value) in &slot.custom {
            write_extraction_string(output, key);
            write_extraction_bytes(output, value);
        }
    }
}

fn write_extraction_mount(output: &mut Vec<u8>, mount: &blockwild_entity::MountState) {
    write_extraction_optional_entity_id(output, mount.parent_mount);
    write_extraction_optional_u8(output, mount.occupied_seat);
    output.push(u8::from(mount.accepts_riders));
    write_extraction_optional_string(output, mount.saddle_key.as_deref());
    output.extend_from_slice(
        &u32::try_from(mount.seats.len())
            .expect("validated mount seat count fits u32")
            .to_le_bytes(),
    );
    for seat in &mount.seats {
        output.push(seat.index);
        write_extraction_string(output, &seat.role);
        for value in [seat.offset.x, seat.offset.y, seat.offset.z] {
            output.extend_from_slice(&value.to_le_bytes());
        }
        write_extraction_optional_entity_id(output, seat.occupant);
        output.extend_from_slice(&seat.control_weight_milli.to_le_bytes());
    }
}

fn write_extraction_research(output: &mut Vec<u8>, research: &BTreeMap<String, u32>) {
    output.extend_from_slice(
        &u32::try_from(research.len())
            .expect("validated entity research count fits u32")
            .to_le_bytes(),
    );
    for (key, value) in research {
        write_extraction_string(output, key);
        output.extend_from_slice(&value.to_le_bytes());
    }
}

fn capabilities(runtime: &IntegratedRuntimeV2) -> Vec<String> {
    let mut values = CAPABILITIES.iter().map(|value| (*value).to_owned()).collect::<Vec<_>>();
    if runtime.native_save_ready() {
        values.push("native-save-hydration-v1".into());
    }
    values
}

fn domain_name(domain: blockwild_runtime_wire::RuntimeDomainV1) -> &'static str {
    match domain {
        blockwild_runtime_wire::RuntimeDomainV1::World => "world",
        blockwild_runtime_wire::RuntimeDomainV1::Simulation => "simulation",
        blockwild_runtime_wire::RuntimeDomainV1::Entities => "entities",
        blockwild_runtime_wire::RuntimeDomainV1::Gameplay => "gameplay",
        blockwild_runtime_wire::RuntimeDomainV1::Persistence => "persistence",
        blockwild_runtime_wire::RuntimeDomainV1::Network => "network",
    }
}

fn encode_error(
    request_id: u32,
    client_epoch: u32,
    code: impl Into<String>,
    message: impl Into<String>,
    current: Option<RuntimeIdentityV1>,
) -> Vec<u8> {
    encode(RuntimeResponseV1::Error {
        request_id,
        client_epoch,
        worker_epoch: WORKER_EPOCH,
        code: code.into(),
        message: message.into(),
        current,
    })
}

fn bulk_runtime_error(
    request_id: u32,
    client_epoch: u32,
    error: IntegratedRuntimeError,
    runtime: &IntegratedRuntimeV2,
) -> RuntimeBulkResponseV1 {
    RuntimeBulkResponseV1::Error {
        request_id,
        client_epoch,
        worker_epoch: WORKER_EPOCH,
        code: error.code,
        message: error.message,
        current: Some(RuntimeBulkStateV1::from(&wire_identity(&runtime.identity()))),
    }
}

fn encode_historical_external_receipt_v2(
    receipt: &IntegratedRuntimeHistoricalExternalReceiptV2,
) -> Result<Vec<u8>, IntegratedRuntimeError> {
    let (operation_tag, operation_id, maximum_id_bytes, dispatcher_required, dirty_required) = match receipt.operation {
        IntegratedRuntimeHistoricalExternalOperationV2::InitialMigration => (
            1_u8,
            receipt.stage_id.as_deref().filter(|_| receipt.recovery_id.is_none()),
            180_usize,
            true,
            true,
        ),
        IntegratedRuntimeHistoricalExternalOperationV2::ExternalSave => (
            2_u8,
            receipt.stage_id.as_deref().filter(|_| receipt.recovery_id.is_none()),
            180_usize,
            true,
            true,
        ),
        IntegratedRuntimeHistoricalExternalOperationV2::Recovery => (
            3_u8,
            receipt.recovery_id.as_deref().filter(|_| receipt.stage_id.is_none()),
            256_usize,
            false,
            false,
        ),
        IntegratedRuntimeHistoricalExternalOperationV2::Reconciliation => (
            4_u8,
            receipt.recovery_id.as_deref().filter(|_| receipt.stage_id.is_none()),
            256_usize,
            true,
            false,
        ),
    };
    let operation_id = operation_id.ok_or_else(|| {
        IntegratedRuntimeError::new(
            "historical-external-operation-id",
            "historical external receipt operation identity is missing or ambiguous",
        )
    })?;
    let operation_id_bytes = operation_id.as_bytes();
    if operation_id_bytes.is_empty() || operation_id_bytes.len() > maximum_id_bytes {
        return Err(IntegratedRuntimeError::new(
            "historical-external-operation-id",
            "historical external receipt operation identity exceeds its wire bound",
        ));
    }
    let dispatcher_request_id = receipt.dispatcher_request_id.unwrap_or_default();
    if receipt.external_state_flags == 0
        || receipt.external_state_flags & !HISTORICAL_EXTERNAL_KNOWN_STATE_FLAGS_V2 != 0
        || receipt.external_document_byte_length == 0
        || receipt.external_document_revision == 0
        || receipt.external_chunk_count == 0
        || receipt.external_chunk_count > 64
        || receipt.projection_byte_length == 0
        || receipt.projection_byte_length > 32 * 1024 * 1024
        || dispatcher_required != (dispatcher_request_id != 0)
        || dirty_required != (receipt.remaining_dirty_records != 0)
        || (receipt.operation == IntegratedRuntimeHistoricalExternalOperationV2::Reconciliation)
            != receipt.reconciliation.is_some()
    {
        return Err(IntegratedRuntimeError::new(
            "historical-external-receipt",
            "historical external receipt dimensions or persistence custody are invalid",
        ));
    }
    let operation_id_length = u16::try_from(operation_id_bytes.len()).map_err(|_| {
        IntegratedRuntimeError::new(
            "historical-external-operation-id",
            "historical external receipt operation identity exceeds u16",
        )
    })?;
    let mut output = Vec::with_capacity(256 + operation_id_bytes.len());
    output.extend_from_slice(b"BWHR");
    output.extend_from_slice(&2_u16.to_le_bytes());
    output.push(operation_tag);
    output.push(1); // typescript-historical-save-compatibility-v1
    output.push(0); // native player/rich-state adoption flags
    output.push(0); // reserved
    output.extend_from_slice(&receipt.external_state_flags.to_le_bytes());
    output.extend_from_slice(&operation_id_length.to_le_bytes());
    output.extend_from_slice(operation_id_bytes);
    output.extend_from_slice(&receipt.created_at.to_le_bytes());
    output.extend_from_slice(receipt.descriptor_hash.as_bytes());
    output.extend_from_slice(receipt.external_document_hash.as_bytes());
    output.extend_from_slice(&receipt.external_document_byte_length.to_le_bytes());
    output.extend_from_slice(&receipt.external_document_revision.to_le_bytes());
    output.extend_from_slice(&receipt.external_chunk_count.to_le_bytes());
    output.extend_from_slice(receipt.external_chunk_set_hash.as_bytes());
    output.extend_from_slice(receipt.projection_hash.as_bytes());
    output.extend_from_slice(&receipt.projection_byte_length.to_le_bytes());
    output.extend_from_slice(receipt.native_world_semantic_hash.as_bytes());
    output.extend_from_slice(&receipt.native_world_edit_count.to_le_bytes());
    output.extend_from_slice(&receipt.native_world_facing_count.to_le_bytes());
    output.extend_from_slice(receipt.save_set_hash.as_bytes());
    output.extend_from_slice(receipt.manifest_hash.as_bytes());
    output.extend_from_slice(&dispatcher_request_id.to_le_bytes());
    output.extend_from_slice(&receipt.remaining_dirty_records.to_le_bytes());
    match &receipt.reconciliation {
        None => output.push(0),
        Some(reconciliation) => {
            let ids = [
                reconciliation.observed_latest_checkpoint_id.as_str(),
                reconciliation.fallback_checkpoint_id.as_str(),
                reconciliation.target_checkpoint_id.as_str(),
            ];
            if ids.iter().any(|value| value.is_empty() || value.len() > 180)
                || reconciliation.observed_latest_journal_sequence
                    != reconciliation.fallback_journal_sequence.saturating_add(1)
                || reconciliation.target_journal_sequence
                    != reconciliation.observed_latest_journal_sequence.saturating_add(1)
            {
                return Err(IntegratedRuntimeError::new(
                    "historical-external-reconciliation",
                    "historical reconciliation receipt has invalid checkpoint lineage",
                ));
            }
            output.push(1);
            output.extend_from_slice(reconciliation.observation_hash.as_bytes());
            output.extend_from_slice(&reconciliation.expected_storage_revision.to_le_bytes());
            for (id, hash, sequence) in [
                (
                    &reconciliation.observed_latest_checkpoint_id,
                    reconciliation.observed_latest_checkpoint_hash,
                    reconciliation.observed_latest_journal_sequence,
                ),
                (
                    &reconciliation.fallback_checkpoint_id,
                    reconciliation.fallback_checkpoint_hash,
                    reconciliation.fallback_journal_sequence,
                ),
                (
                    &reconciliation.target_checkpoint_id,
                    reconciliation.target_checkpoint_hash,
                    reconciliation.target_journal_sequence,
                ),
            ] {
                let length = u16::try_from(id.len()).map_err(|_| {
                    IntegratedRuntimeError::new(
                        "historical-external-reconciliation",
                        "historical reconciliation checkpoint id exceeds u16",
                    )
                })?;
                output.extend_from_slice(&length.to_le_bytes());
                output.extend_from_slice(id.as_bytes());
                output.extend_from_slice(hash.as_bytes());
                output.extend_from_slice(&sequence.to_le_bytes());
            }
            output.extend_from_slice(reconciliation.plan_hash.as_bytes());
        }
    }
    Ok(output)
}

fn historical_external_data_response_v2(
    request_id: u32,
    client_epoch: u32,
    transfer_token: u64,
    receipt: &IntegratedRuntimeHistoricalExternalReceiptV2,
    runtime: &IntegratedRuntimeV2,
) -> Result<RuntimeBulkResponseV1, IntegratedRuntimeError> {
    let payload = encode_historical_external_receipt_v2(receipt).map_err(|error| {
        IntegratedRuntimeError::new(
            "bulk-encode",
            format!("historical external response encoding failed: {}", error.message),
        )
    })?;
    Ok(RuntimeBulkResponseV1::Data {
        request_id,
        client_epoch,
        worker_epoch: WORKER_EPOCH,
        current: RuntimeBulkStateV1::from(&wire_identity(&runtime.identity())),
        transfer_token,
        type_id: PERSISTENCE_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2.into(),
        chunk_index: 0,
        chunk_count: 1,
        payload,
    })
}

fn bulk_response_current(response: &RuntimeBulkResponseV1) -> Option<RuntimeBulkStateV1> {
    match response {
        RuntimeBulkResponseV1::Empty { current, .. }
        | RuntimeBulkResponseV1::PlatformRequest { current, .. }
        | RuntimeBulkResponseV1::Completed { current, .. }
        | RuntimeBulkResponseV1::SaveProgress { current, .. }
        | RuntimeBulkResponseV1::Hydration { current, .. }
        | RuntimeBulkResponseV1::Data { current, .. }
        | RuntimeBulkResponseV1::PersistenceStatus { current, .. } => Some(current.clone()),
        RuntimeBulkResponseV1::Error { current, .. } => current.clone(),
    }
}

fn encode_bulk_error_value(error: RuntimeBulkResponseV1) -> Vec<u8> {
    match encode_bulk_response_v1(&error) {
        Ok(encoded) => encoded.control,
        Err(_) => {
            let fallback = RuntimeBulkResponseV1::Error {
                request_id: error.request_id().max(1),
                client_epoch: error.client_epoch().max(1),
                worker_epoch: error.worker_epoch(),
                code: "bulk-encode".into(),
                message: "bulk response encoding failed".into(),
                current: None,
            };
            encode_bulk_response_v1(&fallback)
                .expect("bounded bulk error response must remain encodable")
                .control
        }
    }
}

fn encode_historical_external_operation<F>(
    handle: u32,
    runtime: &mut IntegratedRuntimeV2,
    attachments: &mut BTreeMap<(u32, u64), Vec<u8>>,
    request_id: u32,
    client_epoch: u32,
    transfer_token: u64,
    operation: F,
) -> Vec<u8>
where
    F: FnOnce(&mut IntegratedRuntimeV2) -> Result<IntegratedRuntimeHistoricalExternalReceiptV2, IntegratedRuntimeError>,
{
    let mut candidate = runtime.clone();
    match operation(&mut candidate) {
        Ok(receipt) => {
            let response = match historical_external_data_response_v2(
                request_id,
                client_epoch,
                transfer_token,
                &receipt,
                &candidate,
            ) {
                Ok(response) => response,
                Err(error) => {
                    let response = bulk_runtime_error(request_id, client_epoch, error, runtime);
                    return encode_bulk_control(handle, response, attachments);
                }
            };
            match encode_bulk_control_result(handle, response, attachments) {
                Ok(control) => {
                    *runtime = candidate;
                    control
                }
                Err(error) => encode_bulk_error_value(error),
            }
        }
        Err(error) => {
            let response = bulk_runtime_error(request_id, client_epoch, error, runtime);
            encode_bulk_control(handle, response, attachments)
        }
    }
}

fn encode(response: RuntimeResponseV1) -> Vec<u8> {
    encode_response_v1(&response).unwrap_or_default()
}

#[allow(clippy::result_large_err)]
fn encode_bulk_control_result(
    handle: u32,
    response: RuntimeBulkResponseV1,
    attachments: &mut BTreeMap<(u32, u64), Vec<u8>>,
) -> Result<Vec<u8>, RuntimeBulkResponseV1> {
    let attachment_metadata = match &response {
        RuntimeBulkResponseV1::PlatformRequest {
            request_id,
            client_epoch,
            worker_epoch,
            current,
            transfer_token,
            ..
        }
        | RuntimeBulkResponseV1::Data {
            request_id,
            client_epoch,
            worker_epoch,
            current,
            transfer_token,
            ..
        } => Some((
            *request_id,
            *client_epoch,
            *worker_epoch,
            current.clone(),
            *transfer_token,
        )),
        _ => None,
    };
    let RuntimeBulkEncodedV1 { control, attachment } =
        encode_bulk_response_v1(&response).map_err(|error| RuntimeBulkResponseV1::Error {
            request_id: response.request_id(),
            client_epoch: response.client_epoch(),
            worker_epoch: response.worker_epoch(),
            code: "bulk-encode".into(),
            message: format!("bulk response encoding failed: {}", error.message),
            current: bulk_response_current(&response),
        })?;
    if let Some((request_id, client_epoch, worker_epoch, current, token)) = attachment_metadata
        && !attachment.is_empty()
    {
        let pending = attachments
            .keys()
            .filter(|(runtime_handle, _)| *runtime_handle == handle)
            .count();
        let queued_bytes = attachments
            .iter()
            .filter(|((runtime_handle, _), _)| *runtime_handle == handle)
            .fold(0_usize, |total, (_, bytes)| total.saturating_add(bytes.len()));
        let rejection = if attachments.contains_key(&(handle, token)) {
            Some((
                "bulk-attachment-collision",
                "Rust reused a live bulk platform transfer token",
            ))
        } else if pending >= RUNTIME_BULK_MAX_PENDING_V1
            || queued_bytes.saturating_add(attachment.len()) > RUNTIME_BULK_MAX_QUEUED_BYTES_V1
        {
            Some((
                "bulk-attachment-capacity",
                "Rust bulk platform attachment storage is full",
            ))
        } else {
            None
        };
        if let Some((code, message)) = rejection {
            return Err(RuntimeBulkResponseV1::Error {
                request_id,
                client_epoch,
                worker_epoch,
                code: code.into(),
                message: message.into(),
                current: Some(current),
            });
        }
        attachments.insert((handle, token), attachment);
    }
    Ok(control)
}

fn encode_bulk_control(
    handle: u32,
    response: RuntimeBulkResponseV1,
    attachments: &mut BTreeMap<(u32, u64), Vec<u8>>,
) -> Vec<u8> {
    match encode_bulk_control_result(handle, response, attachments) {
        Ok(control) => control,
        Err(error) => encode_bulk_error_value(error),
    }
}

#[cfg(test)]
mod tests {
    use blockwild_authority::{
        BlockCatalogV1, CellPositionV1, LiquidMetadataV1, SectionInstallV1, WORLD_SECTION_CELL_COUNT_V1,
        WorldAddressV1, WorldAuthorityRevisionV1, WorldAuthorityStoreR4V1, WorldCellReadV1, WorldCellV1,
        WorldLiquidKindV1, WorldSectionAddressV1, encode_compatibility_save_binary_v1,
    };
    use blockwild_engine::{
        ActorRole, ContainerKey, ContainerKind, ContentArtifact, ContentDomain, ContentInstallPageWireV1,
        EntityAuthorityExportWireV1, EntityAuthorityImportWireV2, EntityCompatibilityExportWireV1,
        EntityCompatibilityImportWireV1, GameplayActor, GameplayBatch, GameplayCommand, ImportPlayerInventoryV1,
        InventoryCommand, ItemStack, LEGACY_STATE_PLAYER_V1, PlayerBootstrapStatusQueryWireV1,
        PlayerCreativeSlotSetWireV1, PlayerGameModeSetWireV1, PlayerInventoryImportWireV1,
        PlayerLocatorItemConsumeWireV1, PlayerLocatorItemPurposeV1, PlayerRespawnWireV1,
        RuntimeBasicDirtActionReceiptQueryWireV1, RuntimeCameraConfigWireV1, RuntimeNativeBlockEditReceiptQueryWireV1,
        RuntimeNativeBlockEditReceiptQueryWireV2, RuntimeNativeDropPickupReceiptQueryWireV1,
        RuntimeNativePlayerDropReceiptQueryWireV1, RuntimePersistenceDispatchWireV1, RuntimePlayerBindingWireV1,
        SlotRef, TransferCommand, compile_content_bundle, decode_entity_authority_import_receipt_v1,
        decode_entity_event_batch_v1, decode_player_bootstrap_status_v1, decode_player_combat_bootstrap_status_v1,
        decode_player_creative_slot_set_receipt_v1, decode_player_game_mode_set_receipt_v1,
        decode_player_inventory_import_receipt_v1, decode_player_locator_item_consume_receipt_v1,
        decode_player_respawn_receipt_v1, decode_runtime_basic_dirt_action_projection_receipt_v1,
        decode_runtime_camera_config_receipt_v1, decode_runtime_native_block_edit_projection_receipt_v1,
        decode_runtime_native_block_edit_projection_receipt_v2,
        decode_runtime_native_drop_pickup_projection_receipt_v1,
        decode_runtime_native_player_drop_projection_receipt_v1, decode_runtime_persistence_status_receipt_v1,
        encode_content_install_page_v1, encode_entity_authority_export_v1, encode_entity_authority_import_v2,
        encode_entity_command_batch_v1, encode_entity_compatibility_export_v1, encode_entity_compatibility_import_v1,
        encode_player_bootstrap_status_query_v1, encode_player_combat_bootstrap_status_query_v1,
        encode_player_creative_slot_set_v1, encode_player_game_mode_set_v1, encode_player_inventory_import_v1,
        encode_player_locator_item_consume_v1, encode_player_respawn_v1,
        encode_runtime_basic_dirt_action_receipt_query_v1, encode_runtime_camera_config_v1,
        encode_runtime_native_block_edit_receipt_query_v1, encode_runtime_native_block_edit_receipt_query_v2,
        encode_runtime_native_drop_pickup_receipt_query_v1, encode_runtime_native_player_drop_receipt_query_v1,
        encode_runtime_persistence_dispatch_v1, encode_runtime_persistence_status_query_v1,
        encode_runtime_player_binding_v1,
    };
    use blockwild_entity::{
        ActionState, DespawnReason, ENTITY_COMMAND_SCHEMA, EntityClass, EntityCommand, EntityCommandBatch,
        EntityCompatibilityRecord, EntityComponents, EntityResidency, EquipmentSlotState, MountSeat,
        Vec3 as EntityVec3,
    };
    use blockwild_runtime_wire::{
        DEFAULT_GENERATION_OPTIONS_JSON_V1, DEFAULT_TERRAIN_CONTENT_HASH_V2, MAX_EXTRACTION_BYTES,
        RUNTIME_INPUT_BUTTON_DROP_V1, RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1, RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1,
        RUNTIME_INPUT_FLAG_CREATIVE_V1, RuntimeBulkRequestV1, RuntimeBulkResponseV1, RuntimeBulkStateV1,
        RuntimeContextCommandActionV2, RuntimeContextCommandV2, RuntimeInputFrameV1, RuntimeRequestV1,
        RuntimeRevisionV1, RuntimeSemanticActionReasonV2, RuntimeStepRequestV2, decode_bulk_response_v1,
        decode_response_v1, decode_step_response_v2, encode_bulk_request_v1, encode_request_v1, encode_step_request_v2,
        seal_context_command_v2, seal_runtime_command_batch_v1,
    };
    use blockwild_simulation::CameraProfileV1;

    use super::*;

    struct ExtractionReader<'a> {
        bytes: &'a [u8],
        offset: usize,
    }

    impl<'a> ExtractionReader<'a> {
        const fn new(bytes: &'a [u8]) -> Self {
            Self { bytes, offset: 0 }
        }

        fn take(&mut self, length: usize) -> &'a [u8] {
            let end = self.offset.checked_add(length).expect("extraction offset overflow");
            let value = self.bytes.get(self.offset..end).expect("complete extraction field");
            self.offset = end;
            value
        }

        fn u8(&mut self) -> u8 {
            self.take(1)[0]
        }

        fn u16(&mut self) -> u16 {
            u16::from_le_bytes(self.take(2).try_into().unwrap())
        }

        fn u32(&mut self) -> u32 {
            u32::from_le_bytes(self.take(4).try_into().unwrap())
        }

        fn u64(&mut self) -> u64 {
            u64::from_le_bytes(self.take(8).try_into().unwrap())
        }

        fn f32(&mut self) -> f32 {
            f32::from_le_bytes(self.take(4).try_into().unwrap())
        }

        fn string(&mut self) -> String {
            let length = usize::try_from(self.u32()).unwrap();
            String::from_utf8(self.take(length).to_vec()).unwrap()
        }

        fn optional_string(&mut self) -> Option<String> {
            (self.u8() == 1).then(|| self.string())
        }

        fn optional_entity_id(&mut self) -> Option<u64> {
            (self.u8() == 1).then(|| self.u64())
        }

        fn finish(self) {
            assert_eq!(self.offset, self.bytes.len());
        }
    }

    fn dispatch_single_operation(
        runtime_handle: u32,
        request_id: u32,
        expected: RuntimeIdentityV1,
        command_id: &str,
        operation: RuntimeDomainOperationV1,
    ) -> (RuntimeIdentityV1, RuntimeDomainOperationV1) {
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: command_id.into(),
            idempotency_key: command_id.into(),
            actor_id: "platform:test".into(),
            expected,
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let response = decode_response_v1(&blockwild_runtime_command_v2(
            runtime_handle,
            &encode_request_v1(&RuntimeRequestV1::Command {
                request_id,
                client_epoch: 1,
                batch,
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::CommandReceipt {
            receipt:
                RuntimeCommandReceiptV1::Accepted {
                    after,
                    mut domain_receipts,
                    ..
                },
            ..
        } = response
        else {
            panic!("expected accepted operation response: {response:?}")
        };
        assert_eq!(domain_receipts.len(), 1);
        (after, domain_receipts.remove(0))
    }

    fn create_request(request_id: u32) -> RuntimeRequestV1 {
        RuntimeRequestV1::Create {
            request_id,
            client_epoch: 1,
            config: RuntimeConfigV1 {
                world_seed: "wasm-integrated".into(),
                universe_id: "1".into(),
                location_id: "surface".into(),
                session_id: "test".into(),
                terrain_content_hash: DEFAULT_TERRAIN_CONTENT_HASH_V2,
                generation_options_json: DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
                content_hash: WireHash([1; 16]),
                generator_hash: WireHash([2; 16]),
                water_block_id: 7,
                directional_block_ids: vec![],
                waterlogged_block_ids: vec![],
            },
        }
    }

    fn checked_r9_fixture_hex_v1(section: &str, field: &str) -> Vec<u8> {
        const FIXTURE: &str =
            include_str!("../../../../tests/fixtures/rust-engine/integrated-runtime-v1/r9-network-wire-fixture.json");
        let section_marker = format!("\"{section}\": {{");
        let section_start = FIXTURE.find(&section_marker).expect("checked R9 fixture section") + section_marker.len();
        let field_marker = format!("\"{field}\": \"");
        let field_start = FIXTURE[section_start..]
            .find(&field_marker)
            .expect("checked R9 fixture field")
            + section_start
            + field_marker.len();
        let hex = &FIXTURE[field_start..field_start + FIXTURE[field_start..].find('"').expect("fixture terminator")];
        assert!(hex.len().is_multiple_of(2), "R9 fixture must contain complete bytes");
        hex.as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                u8::from_str_radix(std::str::from_utf8(pair).expect("fixture hex is ASCII"), 16)
                    .expect("fixture contains canonical hex")
            })
            .collect()
    }

    fn r9_network_operation(type_id: &str, payload: Vec<u8>) -> RuntimeDomainOperationV1 {
        RuntimeDomainOperationV1 {
            domain: RuntimeDomainV1::Network,
            type_id: type_id.into(),
            schema: 1,
            payload_hash: WireHash(wire_checksum_v1(&payload)),
            payload,
        }
    }

    fn r9_command_batch(
        command_id: &str,
        expected: RuntimeIdentityV1,
        operation: RuntimeDomainOperationV1,
    ) -> RuntimeCommandBatchV1 {
        seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: command_id.into(),
            idempotency_key: command_id.into(),
            actor_id: "platform:r9-wire-fixture".into(),
            expected,
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .expect("seal checked R9 fixture command")
    }

    fn dispatch_checked_r9_operation(
        runtime_handle: u32,
        request_id: u32,
        expected: RuntimeIdentityV1,
        command_id: &str,
        type_id: &str,
        payload: Vec<u8>,
    ) -> (RuntimeIdentityV1, RuntimeDomainOperationV1) {
        let operation = r9_network_operation(type_id, payload);
        let request = RuntimeRequestV1::Command {
            request_id,
            client_epoch: 1,
            batch: r9_command_batch(command_id, expected.clone(), operation),
        };
        let request_wire = encode_request_v1(&request).unwrap();
        assert_eq!(&request_wire[..4], b"BWRQ");
        let response_wire = blockwild_runtime_command_v2(runtime_handle, &request_wire);
        assert_eq!(&response_wire[..4], b"BWRS");
        let RuntimeResponseV1::CommandReceipt {
            request_id: actual_request_id,
            client_epoch,
            worker_epoch,
            receipt,
        } = decode_response_v1(&response_wire).unwrap()
        else {
            panic!("expected checked R9 command receipt")
        };
        assert_eq!(
            (actual_request_id, client_epoch, worker_epoch),
            (request_id, 1, WORKER_EPOCH)
        );
        let receipt_hash = match &receipt {
            RuntimeCommandReceiptV1::Accepted { receipt_hash, .. }
            | RuntimeCommandReceiptV1::Rejected { receipt_hash, .. } => *receipt_hash,
        };
        assert_eq!(receipt_hash, command_receipt_hash_v1(&receipt));
        let RuntimeCommandReceiptV1::Accepted {
            before,
            after,
            mut domain_receipts,
            ..
        } = receipt
        else {
            panic!("checked R9 lifecycle request must be accepted")
        };
        assert_eq!(before, expected);
        assert_eq!(domain_receipts.len(), 1);
        let domain_receipt = domain_receipts.remove(0);
        assert_eq!(domain_receipt.domain, RuntimeDomainV1::Network);
        assert_eq!(domain_receipt.schema, 1);
        assert_eq!(
            domain_receipt.payload_hash,
            WireHash(wire_checksum_v1(&domain_receipt.payload))
        );
        (after, domain_receipt)
    }

    #[allow(clippy::too_many_arguments)]
    fn dispatch_rejected_r9_operation(
        runtime_handle: u32,
        request_id: u32,
        expected: RuntimeIdentityV1,
        command_id: &str,
        type_id: &str,
        payload: Vec<u8>,
        expected_code: &str,
    ) {
        let request = RuntimeRequestV1::Command {
            request_id,
            client_epoch: 1,
            batch: r9_command_batch(command_id, expected.clone(), r9_network_operation(type_id, payload)),
        };
        let request_wire = encode_request_v1(&request).unwrap();
        assert_eq!(&request_wire[..4], b"BWRQ");
        let response_wire = blockwild_runtime_command_v2(runtime_handle, &request_wire);
        assert_eq!(&response_wire[..4], b"BWRS");
        let RuntimeResponseV1::CommandReceipt {
            request_id: actual_request_id,
            client_epoch,
            worker_epoch,
            receipt,
        } = decode_response_v1(&response_wire).unwrap()
        else {
            panic!("expected checked rejected R9 command receipt")
        };
        assert_eq!(
            (actual_request_id, client_epoch, worker_epoch),
            (request_id, 1, WORKER_EPOCH)
        );
        assert_eq!(
            match &receipt {
                RuntimeCommandReceiptV1::Accepted { receipt_hash, .. }
                | RuntimeCommandReceiptV1::Rejected { receipt_hash, .. } => *receipt_hash,
            },
            command_receipt_hash_v1(&receipt)
        );
        let RuntimeCommandReceiptV1::Rejected { code, current, .. } = receipt else {
            panic!("checked R9 failure must reject")
        };
        assert_eq!(code, expected_code);
        assert_eq!(current, expected);
    }

    fn assert_r9_ack(
        receipt: &RuntimeDomainOperationV1,
        type_id: &str,
        magic: &[u8; 4],
        request: &[u8],
        after: &RuntimeIdentityV1,
        fixture_field: &str,
    ) {
        assert_eq!(receipt.type_id, type_id);
        let mut expected = Vec::with_capacity(38);
        expected.extend_from_slice(magic);
        expected.extend_from_slice(&1_u16.to_le_bytes());
        expected.extend_from_slice(&wire_checksum_v1(request));
        expected.extend_from_slice(&after.state_hash.0);
        assert_eq!(receipt.payload, expected);
        assert_eq!(
            receipt.payload,
            checked_r9_fixture_hex_v1("wasmDispatchReceipts", fixture_field)
        );
    }

    fn assert_only_network_revision_advanced(before: &RuntimeIdentityV1, after: &RuntimeIdentityV1) {
        assert_eq!(
            after.revision,
            RuntimeRevisionV1 {
                network: before.revision.network + 1,
                ..before.revision
            }
        );
        assert_eq!(after.tick, before.tick);
        assert_ne!(after.state_hash, before.state_hash);
    }

    fn insert_test_runtime(runtime: IntegratedRuntimeV2) -> (u32, RuntimeIdentityV1) {
        let identity = wire_identity(&runtime.identity());
        let handle = INTEGRATED_RUNTIMES.with(|store| store.borrow_mut().insert(runtime));
        (handle, identity)
    }

    fn checked_r9_fixture_runtime(session_id: &str) -> IntegratedRuntimeV2 {
        let RuntimeRequestV1::Create { config, .. } = create_request(0) else {
            unreachable!()
        };
        IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
            world_seed: config.world_seed,
            universe_id: config.universe_id,
            location_id: config.location_id,
            session_id: session_id.into(),
            terrain_content_hash: CanonicalHash(config.terrain_content_hash.0),
            generation_options_json: config.generation_options_json,
            content_hash: CanonicalHash(config.content_hash.0),
            generator_hash: CanonicalHash(config.generator_hash.0),
            block_catalog: BlockCatalogV1 {
                directional_blocks: BTreeSet::new(),
                waterlogged_blocks: BTreeSet::new(),
                water_block_id: config.water_block_id,
            },
        })
        .expect("create checked R9 fixture runtime")
    }

    fn shutdown_checked_r9_runtime(runtime_handle: u32, request_id: u32) {
        let shutdown = RuntimeRequestV1::Shutdown {
            request_id,
            client_epoch: 1,
            expected: None,
        };
        let request = encode_request_v1(&shutdown).unwrap();
        assert_eq!(&request[..4], b"BWRQ");
        let response = blockwild_runtime_destroy_v2(runtime_handle, &request);
        assert_eq!(&response[..4], b"BWRS");
        assert!(matches!(
            decode_response_v1(&response).unwrap(),
            RuntimeResponseV1::Shutdown { .. }
        ));
    }

    fn runtime_with_bound_locator_item_count_v1(creative_mode: bool, held_count: u32) -> IntegratedRuntimeV2 {
        let item = ContentArtifact {
            domain: ContentDomain::Item,
            id: "603".into(),
            schema_id: "item-definition".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["item:603".into()],
            canonical_bytes:
                br#"{"id":603,"maxStack":8,"name":"Hearthroads Route Folio","useKind":"settlement-chart"}"#.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let artifacts = vec![item];
        let bundle = compile_content_bundle("wasm-locator-content-v1", artifacts.clone()).unwrap();
        let mut config = create_request(1);
        let RuntimeRequestV1::Create { config: wire, .. } = &mut config else {
            unreachable!()
        };
        wire.content_hash = WireHash(bundle.manifest.manifest_hash.0);
        let runtime_config = IntegratedRuntimeConfigV2 {
            world_seed: wire.world_seed.clone(),
            universe_id: wire.universe_id.clone(),
            location_id: wire.location_id.clone(),
            session_id: wire.session_id.clone(),
            terrain_content_hash: CanonicalHash(wire.terrain_content_hash.0),
            generation_options_json: wire.generation_options_json.clone(),
            content_hash: CanonicalHash(wire.content_hash.0),
            generator_hash: CanonicalHash(wire.generator_hash.0),
            block_catalog: BlockCatalogV1::default(),
        };
        let mut runtime = IntegratedRuntimeV2::new(runtime_config).unwrap();
        let page = ContentInstallPageWireV1 {
            install_id: "wasm-locator-content-install".into(),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision,
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains,
            page_index: 0,
            page_count: 1,
            artifacts,
        };
        let page_bytes = encode_content_install_page_v1(&page).unwrap();
        runtime
            .install_content_page(page, CanonicalHash(wire_checksum_v1(&page_bytes)))
            .unwrap();

        let mut record = EntityCompatibilityRecord::new("player:locator", "player:locator", "player");
        record.class = EntityClass::Player;
        record.position = EntityVec3::new(8.0, 64.0, 8.0);
        record.health = 20.0;
        record.maximum_health = 20.0;
        let entity_payload = encode_entity_compatibility_import_v1(&EntityCompatibilityImportWireV1 {
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            desired_id: None,
            residency: EntityResidency::Hot,
            record,
        })
        .unwrap();
        let binding_payload = encode_runtime_player_binding_v1(&RuntimePlayerBindingWireV1 {
            external_entity_id: "player:locator".into(),
            actor_id: "player:locator".into(),
            player_id: blockwild_types::PlayerId::new(7, 1),
            creative_mode,
            radius: 0.35,
            standing_height: 1.8,
            crouching_height: 1.35,
            mass: 80.0,
            walk_speed: 4.3,
            sprint_speed: 6.2,
            creative_flight_speed: 8.0,
            maximum_oxygen_seconds: 15.0,
        })
        .unwrap();
        let mut slots = vec![None; 9];
        if held_count > 0 {
            slots[0] = Some(ItemStack::simple(603, held_count));
        }
        let inventory_payload = encode_player_inventory_import_v1(&PlayerInventoryImportWireV1 {
            import: ImportPlayerInventoryV1 {
                inventory: ContainerKey::player("player:locator"),
                expected_revision: 0,
                slots,
                metadata: Vec::new(),
            },
            selected_slot: 0,
        })
        .unwrap();
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-locator-bootstrap".into(),
            idempotency_key: "wasm-locator-bootstrap".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![
                domain_operation(
                    RuntimeDomainV1::Entities,
                    ENTITY_COMPATIBILITY_IMPORT_TYPE_V1,
                    entity_payload,
                ),
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_TYPE_V3,
                    3,
                    binding_payload,
                ),
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    PLAYER_INVENTORY_IMPORT_TYPE_V1,
                    inventory_payload,
                ),
            ],
            command_hash: WireHash::default(),
        })
        .unwrap();
        dispatch_command(&runtime, &batch).unwrap().0
    }

    #[test]
    fn wasm_content_installer_handler_receipt_survives_checkpoint_recovery() {
        let artifact = ContentArtifact {
            domain: ContentDomain::Item,
            id: "603".into(),
            schema_id: "item-definition".into(),
            schema_version: 1,
            content_version: 1,
            aliases: vec!["item:603".into()],
            canonical_bytes: br#"{"id":603,"maxStack":64,"name":"Handler Provenance Fixture"}"#.to_vec(),
            unknown_extension_bytes: Vec::new(),
        };
        let bundle = compile_content_bundle("wasm-handler-provenance-v1", vec![artifact.clone()]).unwrap();
        let mut create = create_request(31);
        let RuntimeRequestV1::Create { config, .. } = &mut create else {
            unreachable!()
        };
        config.content_hash = WireHash(bundle.manifest.manifest_hash.0);
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            ..
        } = decode_response_v1(&blockwild_runtime_create_v2(&encode_request_v1(&create).unwrap())).unwrap()
        else {
            panic!("expected ready runtime")
        };
        let page = ContentInstallPageWireV1 {
            install_id: format!("install:{}", bundle.manifest.manifest_hash.to_hex()),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision,
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains,
            page_index: 0,
            page_count: 1,
            artifacts: vec![artifact],
        };
        let page_bytes = encode_content_install_page_v1(&page).unwrap();
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "handler-content:0".into(),
            idempotency_key: format!("{}:0", page.install_id),
            actor_id: "runtime-content-installer".into(),
            expected: identity,
            operations: vec![domain_operation(
                RuntimeDomainV1::Gameplay,
                CONTENT_INSTALL_PAGE_TYPE_V1,
                page_bytes,
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let RuntimeResponseV1::CommandReceipt { receipt: accepted, .. } =
            decode_response_v1(&blockwild_runtime_command_v2(
                runtime_handle,
                &encode_request_v1(&RuntimeRequestV1::Command {
                    request_id: 32,
                    client_epoch: 1,
                    batch: batch.clone(),
                })
                .unwrap(),
            ))
            .unwrap()
        else {
            panic!("expected accepted handler-path content receipt")
        };
        assert!(matches!(accepted, RuntimeCommandReceiptV1::Accepted { .. }));
        let checkpoint = INTEGRATED_RUNTIMES.with(|store| {
            store.borrow().runtimes[&runtime_handle]
                .export_runtime_checkpoint()
                .unwrap()
        });
        let checkpoint_hash = WireHash(integrated_runtime_checkpoint_hash_v1(&checkpoint).0);
        let RuntimeResponseV1::Restored {
            runtime_handle: restored_handle,
            ..
        } = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&RuntimeRequestV1::Restore {
                request_id: 33,
                client_epoch: 1,
                expected_checkpoint_hash: checkpoint_hash,
                checkpoint,
            })
            .unwrap(),
        ))
        .unwrap()
        else {
            panic!("expected checkpoint restore")
        };
        let RuntimeResponseV1::CommandReceipt { receipt: recovered, .. } =
            decode_response_v1(&blockwild_runtime_command_v2(
                restored_handle,
                &encode_request_v1(&RuntimeRequestV1::RecoverCommand {
                    request_id: 34,
                    client_epoch: 1,
                    batch,
                })
                .unwrap(),
            ))
            .unwrap()
        else {
            panic!("expected exact recovered content installer receipt")
        };
        assert_eq!(recovered, accepted);
    }

    fn runtime_with_bound_locator_item_v1(creative_mode: bool) -> IntegratedRuntimeV2 {
        runtime_with_bound_locator_item_count_v1(creative_mode, 2)
    }

    fn runtime_with_dead_bound_combat_player_with_count_v1(
        held_count: u32,
        split_one_into_equipment: bool,
    ) -> IntegratedRuntimeV2 {
        let mut runtime = runtime_with_bound_locator_item_count_v1(false, held_count);
        let entity_id = runtime.player().expect("bound player").entity_id;
        if split_one_into_equipment {
            assert!(held_count >= 2, "split custody fixture requires two inventory units");
            let inventory = ContainerKey::player("player:locator");
            let equipment = ContainerKey {
                kind: ContainerKind::Equipment,
                id: "player:locator:equipment".into(),
                owner_id: Some("player:locator".into()),
            };
            let inventory_revision = runtime.gameplay().state.inventory.containers[&inventory].revision;
            let equipment_revision = runtime.gameplay().state.inventory.containers[&equipment].revision;
            let gameplay = GameplayBatch::new(
                "wasm-respawn-split-custody",
                "wasm-respawn-split-custody",
                GameplayActor {
                    actor_id: "player:locator".into(),
                    player_id: Some(blockwild_types::PlayerId::new(7, 1)),
                    entity_id: Some(entity_id),
                    role: ActorRole::Host,
                },
                runtime.gameplay().state.identity(),
                vec![GameplayCommand::Inventory(InventoryCommand::Transfer(
                    TransferCommand {
                        from: SlotRef {
                            container: inventory,
                            slot: 0,
                            expected_container_revision: Some(inventory_revision),
                        },
                        to: SlotRef {
                            container: equipment,
                            slot: 0,
                            expected_container_revision: Some(equipment_revision),
                        },
                        count: 1,
                        expected: None,
                    },
                ))],
            );
            let mut root = IntegratedRuntimeBatchV2::empty("wasm-respawn-split-custody", runtime.identity());
            root.gameplay.push(gameplay);
            assert!(runtime.commit(root).accepted());
        }
        let mut record = runtime
            .entities()
            .compatibility_record(entity_id)
            .expect("bound R6 player")
            .clone();
        record.health = 1.0;
        record.maximum_health = 1.0;
        let mut vitals_batch = IntegratedRuntimeBatchV2::empty("wasm-respawn-prime-vitals", runtime.identity());
        vitals_batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 2,
            expected_revision: runtime.entities().revision(),
            tick: runtime.identity().tick,
            commands: vec![EntityCommand::ReplaceCompatibilityRecord {
                id: entity_id,
                value: record,
            }],
        });
        assert!(runtime.commit(vitals_batch).accepted());
        runtime.install_bound_player_combatant_v1().unwrap();

        let address = runtime.world().active_address().clone();
        for section_y in [7_i16, 8_i16] {
            let mut cells = vec![WorldCellV1::default(); WORLD_SECTION_CELL_COUNT_V1];
            if section_y == 7 {
                for z in 7_usize..=8 {
                    for x in 7_usize..=8 {
                        cells[x + 16 * (z + 16 * 15)] = WorldCellV1 {
                            block_id: 1,
                            ..WorldCellV1::default()
                        };
                    }
                }
            } else {
                for local_y in 0_usize..=2 {
                    for z in 7_usize..=8 {
                        for x in 7_usize..=8 {
                            cells[x + 16 * (z + 16 * local_y)].liquid = LiquidMetadataV1 {
                                kind: WorldLiquidKindV1::Water,
                                level: 0,
                                source: true,
                                falling: false,
                                contains_water: true,
                                waterlogged: false,
                            };
                        }
                    }
                }
            }
            runtime
                .world_mut_for_platform_install()
                .install_section_for_replay(SectionInstallV1 {
                    address: WorldSectionAddressV1 {
                        world: address.clone(),
                        chunk_x: 0,
                        chunk_z: 0,
                        section_y,
                    },
                    cells,
                    source_revision: u64::from(section_y as u16),
                    source_hash: format!("{:032x}", 0x7000_u64 + u64::from(section_y as u16)),
                })
                .unwrap();
        }
        let submerged_cell = runtime.world().read_cell(CellPositionV1 { x: 8, y: 66, z: 8 });
        assert!(
            matches!(
                submerged_cell,
                WorldCellReadV1::Loaded {
                    cell: WorldCellV1 {
                        liquid: LiquidMetadataV1 {
                            kind: WorldLiquidKindV1::Water,
                            ..
                        },
                        ..
                    },
                    ..
                }
            ),
            "unexpected submerged fixture cell: {submerged_cell:?}"
        );

        for step in 0_u64..100 {
            runtime
                .step_context_v2(1_000_000 + step * 250_000, 8_000, &[], &[])
                .unwrap();
            if !runtime.gameplay().state.combat.combatants["player:locator"].alive {
                break;
            }
        }
        let combatant = &runtime.gameplay().state.combat.combatants["player:locator"];
        let player = runtime.player().unwrap();
        assert_eq!(
            combatant.health, 0,
            "player body after drowning fixture: {:?}",
            player.body
        );
        assert!(!combatant.alive);
        assert_eq!(
            runtime.entities().compatibility_record(entity_id).unwrap().custom["player.deathSequenceV1"],
            "1"
        );
        runtime
    }

    fn runtime_with_dead_bound_combat_player_v1() -> IntegratedRuntimeV2 {
        runtime_with_dead_bound_combat_player_with_count_v1(2, false)
    }

    fn respawn_request_v1(runtime: &IntegratedRuntimeV2) -> PlayerRespawnWireV1 {
        let player = runtime.player().expect("bound player");
        let entity = runtime
            .entities()
            .hot()
            .get(&player.entity_id)
            .expect("bound R6 player");
        let combatant = &runtime.gameplay().state.combat.combatants[&player.binding.actor_id];
        PlayerRespawnWireV1 {
            expected: runtime.identity(),
            external_entity_id: player.binding.external_entity_id.clone(),
            actor_id: player.binding.actor_id.clone(),
            player_id: player.binding.player_id,
            entity_id: player.entity_id,
            expected_entity_revision: entity.entity_revision,
            expected_gameplay_sequence: runtime.gameplay().state.revision.sequence,
            expected_gameplay_combat_revision: runtime.gameplay().state.revision.combat,
            expected_combatant_revision: combatant.revision,
            expected_death_sequence: entity.record.custom["player.deathSequenceV1"].parse().unwrap(),
            expected_max_health: combatant.max_health,
            respawn_position: Default::default(),
            keep_inventory: true,
        }
    }

    fn runtime_with_basic_dirt_actions_v1(creative_mode: bool, held_count: u32) -> IntegratedRuntimeV2 {
        let mut artifacts = vec![
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "2".into(),
                schema_id: "item-definition".into(),
                schema_version: 1,
                content_version: 1,
                aliases: vec!["item:2".into()],
                canonical_bytes: br#"{"id":2,"maxStack":64,"name":"Dirt","placeBlock":2}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
            ContentArtifact {
                domain: ContentDomain::Item,
                id: "block-actions".into(),
                schema_id: "block-action-catalog".into(),
                schema_version: 2,
                content_version: 1,
                aliases: vec!["item:block-actions".into()],
                canonical_bytes: br#"{"authorityBlockers":["authoritative-rng-context-unbound","dynamic-session-dispatch-runtime","game-mode-host-custody-runtime","legacy-computed-loot-source-runtime","world-support-collision-runtime"],"profiles":[{"breakProfile":{"contextualOverride":"none","durabilityCost":{"kind":"none"},"loot":{"mode":"none","rules":[],"selfDropMode":"absent","silkTouch":"not-authored"},"replacement":"blocked","wrongTool":"break-no-loot"},"hardness":0,"id":0,"placementIntent":"none","preferredTool":"hand","replaceable":true,"requiredTier":0,"solid":false,"topologyFlags":[]},{"authorityBlockers":["authoritative-rng-context-unbound"],"breakProfile":{"contextualOverride":"none","durabilityCost":{"amount":1,"kind":"constant"},"loot":{"mode":"all","rules":[{"chanceMillionths":1000000,"chanceModifier":"none","count":{"kind":"constant","value":1},"id":"dirt","item":2,"ordinal":0,"rollScope":"random-drop-v1"}],"selfDropMode":"absent","silkTouch":"not-authored"},"replacement":"air","wrongTool":"break-no-loot"},"hardness":0.1,"id":2,"item":2,"placementIntent":"direct","placementItems":[2],"preferredTool":"hand","replaceable":false,"requiredTier":0,"solid":true,"topologyFlags":[]}],"rngSemantics":{"algorithm":"xorshift32","exclusiveSelection":"less-than-cumulative-v1","ordering":"stable-profile-rule-order-v1","plantYieldClampMaximumMillionths":999900,"randomDropGate":"less-than-or-equal-v1","seedDerivation":"blockwild-seed-stream-v1","stream":"block-action-loot-v1","unit":"u32-open-upper-v1"},"schema":2}"#.to_vec(),
                unknown_extension_bytes: Vec::new(),
            },
        ];
        artifacts.sort_by(|left, right| (left.domain, left.id.as_str()).cmp(&(right.domain, right.id.as_str())));
        let bundle = compile_content_bundle("wasm-basic-dirt-actions-v1", artifacts.clone()).unwrap();
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
            content_hash: bundle.manifest.manifest_hash,
            ..IntegratedRuntimeConfigV2::default()
        })
        .unwrap();
        let address = runtime.world().active_address().clone();
        for section_y in [4_i16, 7_i16, 8_i16] {
            let mut cells = vec![WorldCellV1::default(); WORLD_SECTION_CELL_COUNT_V1];
            if section_y == 7 {
                for z in 0..16 {
                    for x in 0..16 {
                        cells[x + 16 * (z + 16 * 15)] = WorldCellV1 {
                            block_id: 2,
                            ..WorldCellV1::default()
                        };
                    }
                }
            }
            if section_y == 8 {
                cells[8 + 16 * (5 + 16)] = WorldCellV1 {
                    block_id: 2,
                    ..WorldCellV1::default()
                };
            }
            runtime
                .world_mut_for_platform_install()
                .install_section_for_replay(SectionInstallV1 {
                    address: WorldSectionAddressV1 {
                        world: address.clone(),
                        chunk_x: 0,
                        chunk_z: 0,
                        section_y,
                    },
                    cells,
                    source_revision: u64::from(section_y as u16),
                    source_hash: format!("{section_y:032x}"),
                })
                .unwrap();
        }
        let page = ContentInstallPageWireV1 {
            install_id: "wasm-basic-dirt-actions-install".into(),
            manifest_schema: bundle.manifest.schema_version,
            source_revision: bundle.manifest.source_revision,
            manifest_hash: bundle.manifest.manifest_hash,
            domains: bundle.manifest.domains,
            page_index: 0,
            page_count: 1,
            artifacts,
        };
        let page_bytes = encode_content_install_page_v1(&page).unwrap();
        runtime
            .install_content_page(page, CanonicalHash(wire_checksum_v1(&page_bytes)))
            .unwrap();

        let mut record = EntityCompatibilityRecord::new("player:dirt", "player:dirt", "player");
        record.class = EntityClass::Player;
        record.position = EntityVec3::new(8.0, 63.5, 8.0);
        record.health = 20.0;
        record.maximum_health = 20.0;
        record.custom.insert("physics.grounded".into(), "true".into());
        let entity_payload = encode_entity_compatibility_import_v1(&EntityCompatibilityImportWireV1 {
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            desired_id: None,
            residency: EntityResidency::Hot,
            record,
        })
        .unwrap();
        let binding_payload = encode_runtime_player_binding_v1(&RuntimePlayerBindingWireV1 {
            external_entity_id: "player:dirt".into(),
            actor_id: "player:dirt".into(),
            player_id: blockwild_types::PlayerId::new(1, 1),
            creative_mode,
            radius: 0.35,
            standing_height: 1.8,
            crouching_height: 1.35,
            mass: 80.0,
            walk_speed: 4.3,
            sprint_speed: 6.2,
            creative_flight_speed: 8.0,
            maximum_oxygen_seconds: 15.0,
        })
        .unwrap();
        let mut slots = vec![None; 9];
        slots[0] = Some(ItemStack::simple(2, held_count));
        let inventory_payload = encode_player_inventory_import_v1(&PlayerInventoryImportWireV1 {
            import: ImportPlayerInventoryV1 {
                inventory: ContainerKey::player("player:dirt"),
                expected_revision: 0,
                slots,
                metadata: Vec::new(),
            },
            selected_slot: 0,
        })
        .unwrap();
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-basic-dirt-bootstrap".into(),
            idempotency_key: "wasm-basic-dirt-bootstrap".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![
                domain_operation(
                    RuntimeDomainV1::Entities,
                    ENTITY_COMPATIBILITY_IMPORT_TYPE_V1,
                    entity_payload,
                ),
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_TYPE_V3,
                    3,
                    binding_payload,
                ),
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    PLAYER_INVENTORY_IMPORT_TYPE_V1,
                    inventory_payload,
                ),
            ],
            command_hash: WireHash::default(),
        })
        .unwrap();
        dispatch_command(&runtime, &batch).unwrap().0
    }

    fn basic_dirt_query_operation_v1(runtime: &IntegratedRuntimeV2, after_sequence: u64) -> RuntimeDomainOperationV1 {
        domain_operation(
            RuntimeDomainV1::Gameplay,
            BASIC_DIRT_ACTION_RECEIPT_TYPE_V1,
            encode_runtime_basic_dirt_action_receipt_query_v1(&RuntimeBasicDirtActionReceiptQueryWireV1 {
                expected: runtime.identity(),
                after_sequence,
            })
            .unwrap(),
        )
    }

    fn dispatch_basic_dirt_query_v1(
        runtime: &IntegratedRuntimeV2,
        after_sequence: u64,
        command_id: &str,
    ) -> Result<blockwild_engine::RuntimeBasicDirtActionProjectionReceiptWireV1, (String, String)> {
        let operation = basic_dirt_query_operation_v1(runtime, after_sequence);
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: command_id.into(),
            idempotency_key: command_id.into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (candidate, receipts) = dispatch_command(runtime, &batch)?;
        assert_eq!(candidate.identity(), runtime.identity());
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].domain, RuntimeDomainV1::Gameplay);
        assert_eq!(receipts[0].type_id, BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1);
        assert_eq!(receipts[0].schema, 1);
        decode_runtime_basic_dirt_action_projection_receipt_v1(&receipts[0].payload)
            .map_err(|error| (error.code.into(), error.message))
    }

    fn dispatch_native_block_edit_query_v1(
        runtime: &IntegratedRuntimeV2,
        after_sequence: u64,
        command_id: &str,
    ) -> Result<blockwild_engine::RuntimeNativeBlockEditProjectionReceiptWireV1, (String, String)> {
        let query = encode_runtime_native_block_edit_receipt_query_v1(&RuntimeNativeBlockEditReceiptQueryWireV1 {
            expected: runtime.identity(),
            after_sequence,
        })
        .unwrap();
        assert_eq!(&query[..4], b"BWZ7");
        let operation = domain_operation(RuntimeDomainV1::Gameplay, NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1, query);
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: command_id.into(),
            idempotency_key: command_id.into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (candidate, receipts) = dispatch_command(runtime, &batch)?;
        assert_eq!(candidate.identity(), runtime.identity());
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].domain, RuntimeDomainV1::Gameplay);
        assert_eq!(receipts[0].type_id, NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1);
        assert_eq!(receipts[0].schema, 1);
        assert_eq!(&receipts[0].payload[..4], b"BWY7");
        decode_runtime_native_block_edit_projection_receipt_v1(&receipts[0].payload)
            .map_err(|error| (error.code.into(), error.message))
    }

    fn dispatch_native_block_edit_query_v2(
        runtime: &IntegratedRuntimeV2,
        after_sequence: u64,
        command_id: &str,
    ) -> Result<blockwild_engine::RuntimeNativeBlockEditProjectionReceiptWireV2, (String, String)> {
        let query = encode_runtime_native_block_edit_receipt_query_v2(&RuntimeNativeBlockEditReceiptQueryWireV2 {
            expected: runtime.identity(),
            after_sequence,
        })
        .unwrap();
        assert_eq!(&query[..4], b"BWZ8");
        let operation =
            domain_operation_with_schema(RuntimeDomainV1::Gameplay, NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2, 2, query);
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: command_id.into(),
            idempotency_key: command_id.into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (candidate, receipts) = dispatch_command(runtime, &batch)?;
        assert_eq!(candidate.identity(), runtime.identity());
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].domain, RuntimeDomainV1::Gameplay);
        assert_eq!(receipts[0].type_id, NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V2);
        assert_eq!(receipts[0].schema, 2);
        assert_eq!(&receipts[0].payload[..4], b"BWY8");
        decode_runtime_native_block_edit_projection_receipt_v2(&receipts[0].payload)
            .map_err(|error| (error.code.into(), error.message))
    }

    fn dispatch_native_drop_pickup_query_v1(
        runtime: &IntegratedRuntimeV2,
        after_sequence: u64,
        command_id: &str,
    ) -> Result<blockwild_engine::RuntimeNativeDropPickupProjectionReceiptWireV1, (String, String)> {
        let operation = domain_operation(
            RuntimeDomainV1::Gameplay,
            NATIVE_DROP_PICKUP_RECEIPT_TYPE_V1,
            encode_runtime_native_drop_pickup_receipt_query_v1(&RuntimeNativeDropPickupReceiptQueryWireV1 {
                expected: runtime.identity(),
                after_sequence,
            })
            .unwrap(),
        );
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: command_id.into(),
            idempotency_key: command_id.into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (candidate, receipts) = dispatch_command(runtime, &batch)?;
        assert_eq!(candidate.identity(), runtime.identity());
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].domain, RuntimeDomainV1::Gameplay);
        assert_eq!(receipts[0].type_id, NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1);
        assert_eq!(receipts[0].schema, 1);
        decode_runtime_native_drop_pickup_projection_receipt_v1(&receipts[0].payload)
            .map_err(|error| (error.code.into(), error.message))
    }

    fn dispatch_native_player_drop_query_v1(
        runtime: &IntegratedRuntimeV2,
        after_sequence: u64,
        command_id: &str,
    ) -> Result<blockwild_engine::RuntimeNativePlayerDropProjectionReceiptWireV1, (String, String)> {
        let operation = domain_operation(
            RuntimeDomainV1::Gameplay,
            NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1,
            encode_runtime_native_player_drop_receipt_query_v1(&RuntimeNativePlayerDropReceiptQueryWireV1 {
                expected: runtime.identity(),
                after_sequence,
            })
            .unwrap(),
        );
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: command_id.into(),
            idempotency_key: command_id.into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (candidate, receipts) = dispatch_command(runtime, &batch)?;
        assert_eq!(candidate.identity(), runtime.identity());
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].domain, RuntimeDomainV1::Gameplay);
        assert_eq!(receipts[0].type_id, NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1);
        assert_eq!(receipts[0].schema, 1);
        decode_runtime_native_player_drop_projection_receipt_v1(&receipts[0].payload)
            .map_err(|error| (error.code.into(), error.message))
    }

    fn step_runtime_through_wasm_v1(
        runtime_handle: u32,
        request_id: u32,
        expected: RuntimeIdentityV1,
        monotonic_time_us: u64,
        inputs: Vec<RuntimeInputFrameV1>,
    ) -> (RuntimeIdentityV1, u16) {
        let response = decode_response_v1(&blockwild_runtime_step_v2(
            runtime_handle,
            &encode_request_v1(&RuntimeRequestV1::Step {
                request_id,
                client_epoch: 1,
                expected,
                monotonic_time_us,
                budget_us: 2_000,
                inputs,
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::StepResult {
            identity, fixed_steps, ..
        } = response
        else {
            panic!("expected fixed-step response: {response:?}")
        };
        (identity, fixed_steps)
    }

    fn poll_runtime_platform_through_wasm_v1(
        runtime_handle: u32,
        request_id: u32,
        expected: RuntimeBulkStateV1,
    ) -> (RuntimeBulkStateV1, u64, String, Vec<u8>) {
        let wire = encode_bulk_request_v1(&RuntimeBulkRequestV1::Poll {
            request_id,
            client_epoch: 1,
            expected,
            max_bytes: 128 * 1024 * 1024,
        })
        .unwrap();
        let control = blockwild_runtime_bulk_v2(runtime_handle, &wire.control, &wire.attachment);
        let transfer_token = u64::from_le_bytes(
            control
                .get(144..152)
                .expect("bulk platform response carries transfer metadata")
                .try_into()
                .unwrap(),
        );
        let attachment = blockwild_runtime_bulk_take_attachment_v2(runtime_handle, transfer_token as f64);
        let response = decode_bulk_response_v1(&control, &attachment).unwrap();
        let RuntimeBulkResponseV1::PlatformRequest {
            current,
            transfer_token: response_token,
            type_id,
            payload,
            ..
        } = response
        else {
            panic!("expected persistence platform request: {response:?}")
        };
        assert_eq!(response_token, transfer_token);
        (current, transfer_token, type_id, payload)
    }

    fn complete_runtime_platform_through_wasm_v1(
        runtime_handle: u32,
        request_id: u32,
        expected: RuntimeBulkStateV1,
        transfer_token: u64,
        payload: Vec<u8>,
    ) -> RuntimeBulkStateV1 {
        let wire = encode_bulk_request_v1(&RuntimeBulkRequestV1::Complete {
            request_id,
            client_epoch: 1,
            expected,
            transfer_token,
            type_id: blockwild_runtime_wire::PERSISTENCE_RESPONSE_TYPE_V1.into(),
            payload,
        })
        .unwrap();
        let response = decode_bulk_response_v1(
            &blockwild_runtime_bulk_v2(runtime_handle, &wire.control, &wire.attachment),
            &[],
        )
        .unwrap();
        let RuntimeBulkResponseV1::Completed {
            current,
            transfer_token: response_token,
            ..
        } = response
        else {
            panic!("expected persistence platform completion: {response:?}")
        };
        assert_eq!(response_token, transfer_token);
        current
    }

    fn extract_view_request(
        request_id: u32,
        expected: RuntimeIdentityV1,
        after_revision: u64,
        viewport: [u32; 2],
        view_revision: u64,
        max_bytes: u32,
    ) -> RuntimeRequestV1 {
        RuntimeRequestV1::ExtractView {
            request_id,
            client_epoch: 1,
            expected,
            after_revision,
            max_bytes,
            viewport_width: viewport[0],
            viewport_height: viewport[1],
            view_revision,
        }
    }

    fn extract_response(handle: u32, request: RuntimeRequestV1) -> RuntimeResponseV1 {
        decode_response_v1(&blockwild_runtime_extract_v2(
            handle,
            &encode_request_v1(&request).expect("valid extraction request"),
        ))
        .expect("valid extraction response")
    }

    fn extraction_from(response: RuntimeResponseV1) -> RuntimeExtractionV1 {
        let RuntimeResponseV1::Extraction { extraction, .. } = response else {
            panic!("expected extraction response: {response:?}")
        };
        extraction
    }

    fn response_error_code(response: RuntimeResponseV1) -> String {
        let RuntimeResponseV1::Error { code, .. } = response else {
            panic!("expected error response: {response:?}")
        };
        code
    }

    fn camera_config_operation(expected_camera_revision: u64, mode: CameraModeV1) -> RuntimeDomainOperationV1 {
        domain_operation(
            RuntimeDomainV1::Simulation,
            SIMULATION_CAMERA_CONFIG_TYPE_V1,
            encode_runtime_camera_config_v1(&RuntimeCameraConfigWireV1 {
                expected_camera_revision,
                mode,
                profile: CameraProfileV1::default(),
            })
            .expect("valid camera configuration"),
        )
    }

    #[test]
    fn player_sequence_markers_require_nonzero_canonical_js_safe_u64() {
        assert_eq!(canonical_player_sequence_marker_v1("1"), Some(1));
        assert_eq!(
            canonical_player_sequence_marker_v1(&MAX_SAFE_U64.to_string()),
            Some(MAX_SAFE_U64)
        );
        for malformed in [
            "",
            "0",
            "00",
            "01",
            "+1",
            "-1",
            " 1",
            "1 ",
            "9007199254740992",
            "18446744073709551616",
        ] {
            assert_eq!(
                canonical_player_sequence_marker_v1(malformed),
                None,
                "marker {malformed:?} must fail closed"
            );
        }
    }

    #[test]
    fn create_extract_and_destroy_use_one_live_generational_handle() {
        let request = create_request(1);
        let response = decode_response_v1(&blockwild_runtime_create_v2(&encode_request_v1(&request).unwrap())).unwrap();
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            capabilities,
            ..
        } = response
        else {
            panic!("expected ready")
        };
        let has_capability = |expected: &str| capabilities.iter().any(|capability| capability == expected);
        assert!(has_capability("fixed-step-input-v1"));
        assert!(has_capability("basic-dirt-action-receipt-v1"));
        assert!(has_capability("native-block-edit-receipt-v1"));
        assert!(has_capability("native-block-edit-receipt-v2"));
        assert!(has_capability("native-drop-pickup-receipt-v1"));
        assert!(has_capability("native-player-drop-receipt-v1"));
        assert!(has_capability("player-game-mode-set-v1"));
        assert!(has_capability("player-respawn-v1"));
        assert!(has_capability("bounded-extraction-v1"));
        assert!(has_capability("bounded-extraction-blockers-v1"));
        assert!(!has_capability("fixed-step-input-v1-pending-live-cutover"));
        assert!(has_capability("bounded-entity-extraction-v1"));
        assert!(has_capability("bulk-platform-v1"));
        assert!(has_capability("content-bundle-install-v1"));
        assert!(has_capability("terrain-residency-v1"));
        assert!(has_capability("terrain-residency-reconcile-v2"));
        assert!(!has_capability("content-authority-v1"));
        assert!(has_capability("entity-authority-snapshot-v2"));
        assert!(has_capability("entity-compatibility-bridge-v1"));
        assert!(has_capability("native-save-hydration-v1"));
        let extract = RuntimeRequestV1::Extract {
            request_id: 2,
            client_epoch: 1,
            expected: identity.clone(),
            after_revision: 0,
            max_bytes: blockwild_runtime_wire::MAX_EXTRACTION_BYTES as u32,
        };
        let extracted = decode_response_v1(&blockwild_runtime_extract_v2(
            runtime_handle,
            &encode_request_v1(&extract).unwrap(),
        ))
        .unwrap();
        assert!(matches!(extracted, RuntimeResponseV1::Extraction { .. }));
        let shutdown = RuntimeRequestV1::Shutdown {
            request_id: 3,
            client_epoch: 1,
            expected: Some(identity),
        };
        let stopped = decode_response_v1(&blockwild_runtime_destroy_v2(
            runtime_handle,
            &encode_request_v1(&shutdown).unwrap(),
        ))
        .unwrap();
        assert!(matches!(stopped, RuntimeResponseV1::Shutdown { .. }));
        let missing = decode_response_v1(&blockwild_runtime_destroy_v2(
            runtime_handle,
            &encode_request_v1(&shutdown).unwrap(),
        ))
        .unwrap();
        assert!(matches!(missing, RuntimeResponseV1::Error { .. }));
    }

    #[test]
    fn checked_r9_network_requests_cross_real_bwrq_bwrs_dispatch() {
        let mut create = create_request(12_001);
        let RuntimeRequestV1::Create { config, .. } = &mut create else {
            unreachable!()
        };
        config.session_id = "session:雪:🦀".into();
        let create_wire = encode_request_v1(&create).unwrap();
        assert_eq!(&create_wire[..4], b"BWRQ");
        let ready_wire = blockwild_runtime_create_v2(&create_wire);
        assert_eq!(&ready_wire[..4], b"BWRS");
        let RuntimeResponseV1::Ready {
            request_id,
            client_epoch,
            worker_epoch,
            runtime_handle,
            identity: ready_identity,
            capabilities,
            ..
        } = decode_response_v1(&ready_wire).unwrap()
        else {
            panic!("expected ready response")
        };
        assert_eq!((request_id, client_epoch, worker_epoch), (12_001, 1, WORKER_EPOCH));
        assert!(
            capabilities
                .iter()
                .any(|capability| capability == "network-authority-v1")
        );

        let peer_grant = checked_r9_fixture_hex_v1("requests", "peerGrant");
        let agent_grant = checked_r9_fixture_hex_v1("requests", "agentGrant");
        let replication_record = checked_r9_fixture_hex_v1("requests", "replicationRecord");
        let delta_build = checked_r9_fixture_hex_v1("requests", "deltaBuild");
        let reconnect = checked_r9_fixture_hex_v1("requests", "reconnect");
        let command_release = checked_r9_fixture_hex_v1("requests", "commandRelease");
        let peer_release = checked_r9_fixture_hex_v1("requests", "peerRelease");
        let browser_handshake = checked_r9_fixture_hex_v1("browserHandshake", "outerRequestHex");
        let browser_host = checked_r9_fixture_hex_v1("browserHandshake", "nestedHostBwn1Hex");
        let browser_peer = checked_r9_fixture_hex_v1("browserHandshake", "nestedPeerBwn1Hex");
        let browser_command_batch = checked_r9_fixture_hex_v1("browserCommandBatch", "outerRequestHex");
        let browser_command = checked_r9_fixture_hex_v1("browserCommandBatch", "nestedCommandBwn1Hex");
        let browser_delta_delivery = checked_r9_fixture_hex_v1("browserDeltaDelivery", "outerRequestHex");
        let browser_delta_checkpoint = checked_r9_fixture_hex_v1("browserDeltaDelivery", "nestedCheckpointBwn1Hex");
        let browser_delta = checked_r9_fixture_hex_v1("browserDeltaDelivery", "nestedDeltaBwn1Hex");
        let browser_agent_command = checked_r9_fixture_hex_v1("browserAgentCommand", "outerRequestHex");
        let browser_agent_envelope = checked_r9_fixture_hex_v1("browserAgentCommand", "nestedEnvelopeBwn1Hex");
        let browser_agent_work = checked_r9_fixture_hex_v1("browserAgentCommand", "nestedWorkBwa1Hex");
        let browser_guest_pose = checked_r9_fixture_hex_v1("browserGuestPose", "outerRequestHex");
        let browser_pose_command = checked_r9_fixture_hex_v1("browserGuestPose", "nestedCommandBwn1Hex");
        let browser_pose = checked_r9_fixture_hex_v1("browserGuestPose", "nestedPoseBwnpHex");
        assert_eq!(&peer_grant[..4], b"BWP9");
        assert_eq!(&agent_grant[..4], b"BWJ9");
        assert_eq!(&replication_record[..4], b"BWI9");
        assert_eq!(&delta_build[..4], b"BWD9");
        assert_eq!(&reconnect[..4], b"BWC9");
        assert_eq!(&command_release[..4], b"BWM9");
        assert_eq!(&peer_release[..4], b"BWL9");
        assert_eq!(&browser_handshake[..4], b"BWRN");
        assert_eq!(&browser_host[..4], b"BWN1");
        assert_eq!(&browser_peer[..4], b"BWN1");
        assert_eq!(&browser_command_batch[..4], b"BWRN");
        assert_eq!(&browser_command[..4], b"BWN1");
        assert_eq!(&browser_delta_delivery[..4], b"BWRN");
        assert_eq!(&browser_delta_checkpoint[..4], b"BWN1");
        assert_eq!(&browser_delta[..4], b"BWN1");
        assert_eq!(&browser_agent_command[..4], b"BWRN");
        assert_eq!(&browser_agent_envelope[..4], b"BWN1");
        assert_eq!(&browser_agent_work[..4], b"BWA1");
        assert_eq!(&browser_guest_pose[..4], b"BWRN");
        assert_eq!(&browser_pose_command[..4], b"BWN1");
        assert_eq!(&browser_pose[..4], b"BWNP");
        let blockwild_network::NetworkBrowserRequestV1::Handshake { request_id, host, peer } =
            blockwild_network::decode_network_browser_request_v1(&browser_handshake).unwrap()
        else {
            panic!("checked outer BWRN must contain a handshake")
        };
        assert_eq!(request_id, 9_007_199_254_740_987);
        assert_eq!(
            blockwild_network::encode_network_handshake_v1(&host).unwrap(),
            browser_host
        );
        assert_eq!(
            blockwild_network::encode_network_handshake_v1(&peer).unwrap(),
            browser_peer
        );
        let blockwild_network::NetworkBrowserRequestV1::CommandBatch {
            request_id, commands, ..
        } = blockwild_network::decode_network_browser_request_v1(&browser_command_batch).unwrap()
        else {
            panic!("checked outer BWRN must contain a command batch")
        };
        assert_eq!(request_id, 9_007_199_254_740_986);
        assert_eq!(commands.len(), 1);
        assert_eq!(
            blockwild_network::encode_network_command_v1(&commands[0]).unwrap(),
            browser_command
        );
        let blockwild_network::NetworkBrowserRequestV1::DeltaDelivery {
            request_id,
            checkpoint,
            delta,
            ..
        } = blockwild_network::decode_network_browser_request_v1(&browser_delta_delivery).unwrap()
        else {
            panic!("checked outer BWRN must contain a delta delivery")
        };
        assert_eq!(request_id, 9_007_199_254_740_985);
        assert_eq!(
            blockwild_network::encode_network_checkpoint_v1(&checkpoint).unwrap(),
            browser_delta_checkpoint
        );
        assert_eq!(
            blockwild_network::encode_network_delta_v1(&delta).unwrap(),
            browser_delta
        );
        let blockwild_network::NetworkBrowserRequestV1::AgentCommand {
            request_id,
            envelope,
            work,
            ..
        } = blockwild_network::decode_network_browser_request_v1(&browser_agent_command).unwrap()
        else {
            panic!("checked outer BWRN must contain an agent command")
        };
        assert_eq!(request_id, 9_007_199_254_740_984);
        assert_eq!(
            blockwild_network::encode_network_command_v1(&envelope).unwrap(),
            browser_agent_envelope
        );
        assert_eq!(
            blockwild_network::encode_agent_work_command_v1(&work).unwrap(),
            browser_agent_work
        );
        let blockwild_network::NetworkBrowserRequestV1::GuestPose {
            request_id,
            command,
            pose,
            ..
        } = blockwild_network::decode_network_browser_request_v1(&browser_guest_pose).unwrap()
        else {
            panic!("checked outer BWRN must contain a guest pose")
        };
        assert_eq!(request_id, 9_007_199_254_740_983);
        assert_eq!(
            blockwild_network::encode_network_command_v1(&command).unwrap(),
            browser_pose_command
        );
        assert_eq!(
            blockwild_network::encode_network_player_pose_v1(&pose).unwrap(),
            browser_pose
        );

        let (after_peer_grant, peer_grant_receipt) = dispatch_checked_r9_operation(
            runtime_handle,
            12_002,
            ready_identity.clone(),
            "r9-fixture:peer-grant",
            NETWORK_PEER_GRANT_TYPE_V1,
            peer_grant.clone(),
        );
        assert_only_network_revision_advanced(&ready_identity, &after_peer_grant);
        assert_r9_ack(
            &peer_grant_receipt,
            NETWORK_GRANT_RECEIPT_TYPE_V1,
            b"BWP9",
            &peer_grant,
            &after_peer_grant,
            "peerGrant",
        );

        let (after_agent_grant, agent_grant_receipt) = dispatch_checked_r9_operation(
            runtime_handle,
            12_003,
            after_peer_grant.clone(),
            "r9-fixture:agent-grant",
            NETWORK_AGENT_GRANT_TYPE_V1,
            agent_grant.clone(),
        );
        assert_only_network_revision_advanced(&after_peer_grant, &after_agent_grant);
        assert_r9_ack(
            &agent_grant_receipt,
            NETWORK_GRANT_RECEIPT_TYPE_V1,
            b"BWJ9",
            &agent_grant,
            &after_agent_grant,
            "agentGrant",
        );

        let (after_replication, replication_receipt) = dispatch_checked_r9_operation(
            runtime_handle,
            12_004,
            after_agent_grant.clone(),
            "r9-fixture:replication-upsert",
            NETWORK_REPLICATION_UPSERT_TYPE_V1,
            replication_record.clone(),
        );
        assert_only_network_revision_advanced(&after_agent_grant, &after_replication);
        assert_r9_ack(
            &replication_receipt,
            NETWORK_REPLICATION_RECEIPT_TYPE_V1,
            b"BWI9",
            &replication_record,
            &after_replication,
            "replicationRecord",
        );

        let (after_delta, delta_receipt) = dispatch_checked_r9_operation(
            runtime_handle,
            12_005,
            after_replication.clone(),
            "r9-fixture:delta-build",
            NETWORK_DELTA_BUILD_TYPE_V1,
            delta_build.clone(),
        );
        assert_only_network_revision_advanced(&after_replication, &after_delta);
        assert_eq!(delta_receipt.type_id, NETWORK_DELTA_BUILD_RESPONSE_TYPE_V1);
        assert_eq!(
            delta_receipt.payload,
            checked_r9_fixture_hex_v1("wasmDispatchReceipts", "deltaBuild")
        );

        let (after_reconnect, reconnect_receipt) = dispatch_checked_r9_operation(
            runtime_handle,
            12_006,
            after_delta.clone(),
            "r9-fixture:reconnect",
            NETWORK_RECONNECT_TYPE_V1,
            reconnect.clone(),
        );
        assert_eq!(
            after_reconnect, after_delta,
            "missing reconnect checkpoint is read-only"
        );
        assert_eq!(reconnect_receipt.type_id, NETWORK_RECONNECT_RESPONSE_TYPE_V1);
        assert_eq!(
            reconnect_receipt.payload,
            checked_r9_fixture_hex_v1("wasmDispatchReceipts", "reconnect")
        );

        let (after_replication_remove, replication_remove_receipt) = dispatch_checked_r9_operation(
            runtime_handle,
            12_007,
            after_reconnect.clone(),
            "r9-fixture:replication-remove",
            NETWORK_REPLICATION_REMOVE_TYPE_V1,
            replication_record.clone(),
        );
        assert_only_network_revision_advanced(&after_reconnect, &after_replication_remove);
        assert_r9_ack(
            &replication_remove_receipt,
            NETWORK_REPLICATION_RECEIPT_TYPE_V1,
            b"BWR9",
            &replication_record,
            &after_replication_remove,
            "replicationRemove",
        );
        dispatch_rejected_r9_operation(
            runtime_handle,
            12_008,
            after_replication_remove.clone(),
            "r9-fixture:replication-remove:missing",
            NETWORK_REPLICATION_REMOVE_TYPE_V1,
            replication_record.clone(),
            "network-record-missing",
        );

        let (after_command_release, command_release_receipt) = dispatch_checked_r9_operation(
            runtime_handle,
            12_009,
            after_replication_remove.clone(),
            "r9-fixture:command-release",
            NETWORK_COMMAND_RELEASE_TYPE_V1,
            command_release.clone(),
        );
        assert_only_network_revision_advanced(&after_replication_remove, &after_command_release);
        assert_r9_ack(
            &command_release_receipt,
            NETWORK_COMMAND_RELEASE_RECEIPT_TYPE_V1,
            b"BWM9",
            &command_release,
            &after_command_release,
            "commandRelease",
        );

        let (after_peer_release, peer_release_receipt) = dispatch_checked_r9_operation(
            runtime_handle,
            12_010,
            after_command_release.clone(),
            "r9-fixture:peer-release",
            NETWORK_PEER_RELEASE_TYPE_V1,
            peer_release.clone(),
        );
        assert_only_network_revision_advanced(&after_command_release, &after_peer_release);
        assert_r9_ack(
            &peer_release_receipt,
            NETWORK_PEER_RELEASE_RECEIPT_TYPE_V1,
            b"BWL9",
            &peer_release,
            &after_peer_release,
            "peerRelease",
        );

        let (after_browser_handshake, browser_handshake_receipt) = dispatch_checked_r9_operation(
            runtime_handle,
            12_011,
            after_peer_release.clone(),
            "r9-fixture:browser-handshake",
            NETWORK_REQUEST_TYPE_V1,
            browser_handshake.clone(),
        );
        assert_only_network_revision_advanced(&after_peer_release, &after_browser_handshake);
        assert_eq!(browser_handshake_receipt.type_id, NETWORK_RESPONSE_TYPE_V1);
        assert_eq!(&browser_handshake_receipt.payload[..4], b"BWNA");
        assert_eq!(
            browser_handshake_receipt.payload,
            checked_r9_fixture_hex_v1("wasmDispatchReceipts", "browserHandshake")
        );
        let blockwild_network::NetworkBrowserResponseV1::Handshake {
            request_id,
            compatibility,
        } = blockwild_network::decode_network_browser_response_v1(&browser_handshake_receipt.payload).unwrap()
        else {
            panic!("checked BWNA must contain a handshake response")
        };
        assert_eq!(request_id, 9_007_199_254_740_987);
        assert!(compatibility.decision.compatible);

        let mut malformed_browser_handshake = browser_handshake;
        *malformed_browser_handshake.last_mut().unwrap() ^= 1;
        dispatch_rejected_r9_operation(
            runtime_handle,
            12_012,
            after_browser_handshake.clone(),
            "r9-fixture:browser-handshake:checksum",
            NETWORK_REQUEST_TYPE_V1,
            malformed_browser_handshake,
            "network-error",
        );

        let mut malformed_peer_grant = peer_grant.clone();
        *malformed_peer_grant.last_mut().unwrap() ^= 1;
        dispatch_rejected_r9_operation(
            runtime_handle,
            12_013,
            after_browser_handshake.clone(),
            "r9-fixture:peer-grant:checksum",
            NETWORK_PEER_GRANT_TYPE_V1,
            malformed_peer_grant,
            "domain-checksum",
        );

        let stale = RuntimeRequestV1::Command {
            request_id: 12_014,
            client_epoch: 1,
            batch: r9_command_batch(
                "r9-fixture:peer-grant:stale",
                ready_identity,
                r9_network_operation(NETWORK_PEER_GRANT_TYPE_V1, peer_grant),
            ),
        };
        let stale_wire = encode_request_v1(&stale).unwrap();
        assert_eq!(&stale_wire[..4], b"BWRQ");
        let stale_response_wire = blockwild_runtime_command_v2(runtime_handle, &stale_wire);
        assert_eq!(&stale_response_wire[..4], b"BWRS");
        let RuntimeResponseV1::CommandReceipt {
            receipt: RuntimeCommandReceiptV1::Rejected { code, current, .. },
            ..
        } = decode_response_v1(&stale_response_wire).unwrap()
        else {
            panic!("stale BWP9 command must reject before dispatch")
        };
        assert_eq!(code, "stale-runtime");
        assert_eq!(current, after_browser_handshake);

        let shutdown = RuntimeRequestV1::Shutdown {
            request_id: 12_015,
            client_epoch: 1,
            expected: None,
        };
        let shutdown_wire = encode_request_v1(&shutdown).unwrap();
        assert_eq!(&shutdown_wire[..4], b"BWRQ");
        let shutdown_response = blockwild_runtime_destroy_v2(runtime_handle, &shutdown_wire);
        assert_eq!(&shutdown_response[..4], b"BWRS");
        assert!(matches!(
            decode_response_v1(&shutdown_response).unwrap(),
            RuntimeResponseV1::Shutdown { .. }
        ));

        let canonical = blockwild_network::canonical_network_fixture_v1().unwrap();

        let mut command_runtime = checked_r9_fixture_runtime("session-r9");
        command_runtime
            .upsert_network_peer_grant(canonical.human_grant.clone())
            .unwrap();
        let (command_handle, before_command_batch) = insert_test_runtime(command_runtime);
        let (after_command_batch, command_batch_receipt) = dispatch_checked_r9_operation(
            command_handle,
            12_020,
            before_command_batch.clone(),
            "r9-fixture:browser-command-batch",
            NETWORK_REQUEST_TYPE_V1,
            browser_command_batch.clone(),
        );
        assert_only_network_revision_advanced(&before_command_batch, &after_command_batch);
        assert_eq!(command_batch_receipt.type_id, NETWORK_RESPONSE_TYPE_V1);
        assert_eq!(
            command_batch_receipt.payload,
            checked_r9_fixture_hex_v1("wasmDispatchReceipts", "browserCommandBatch")
        );
        let blockwild_network::NetworkBrowserResponseV1::CommandBatch {
            request_id, receipts, ..
        } = blockwild_network::decode_network_browser_response_v1(&command_batch_receipt.payload).unwrap()
        else {
            panic!("checked BWNA must contain a command-batch response")
        };
        assert_eq!(request_id, 9_007_199_254_740_986);
        assert_eq!(receipts.len(), 1);
        assert!(receipts[0].accepted());
        let mut malformed_command_batch = browser_command_batch;
        *malformed_command_batch.last_mut().unwrap() ^= 1;
        dispatch_rejected_r9_operation(
            command_handle,
            12_021,
            after_command_batch,
            "r9-fixture:browser-command-batch:checksum",
            NETWORK_REQUEST_TYPE_V1,
            malformed_command_batch,
            "network-error",
        );
        shutdown_checked_r9_runtime(command_handle, 12_022);

        let delta_runtime = checked_r9_fixture_runtime("session-r9");
        let (delta_handle, before_delta_delivery) = insert_test_runtime(delta_runtime);
        let (after_delta_delivery, delta_delivery_receipt) = dispatch_checked_r9_operation(
            delta_handle,
            12_023,
            before_delta_delivery.clone(),
            "r9-fixture:browser-delta-delivery",
            NETWORK_REQUEST_TYPE_V1,
            browser_delta_delivery.clone(),
        );
        assert_only_network_revision_advanced(&before_delta_delivery, &after_delta_delivery);
        assert_eq!(delta_delivery_receipt.type_id, NETWORK_RESPONSE_TYPE_V1);
        assert_eq!(
            delta_delivery_receipt.payload,
            checked_r9_fixture_hex_v1("wasmDispatchReceipts", "browserDeltaDelivery")
        );
        let blockwild_network::NetworkBrowserResponseV1::DeltaDelivery {
            request_id,
            code,
            sequence,
            ..
        } = blockwild_network::decode_network_browser_response_v1(&delta_delivery_receipt.payload).unwrap()
        else {
            panic!("checked BWNA must contain a delta-delivery response")
        };
        assert_eq!(
            (request_id, code, sequence),
            (9_007_199_254_740_985, blockwild_network::DeltaApplyCodeV1::Applied, 1)
        );
        let mut malformed_delta_delivery = browser_delta_delivery;
        *malformed_delta_delivery.last_mut().unwrap() ^= 1;
        dispatch_rejected_r9_operation(
            delta_handle,
            12_024,
            after_delta_delivery,
            "r9-fixture:browser-delta-delivery:checksum",
            NETWORK_REQUEST_TYPE_V1,
            malformed_delta_delivery,
            "network-error",
        );
        shutdown_checked_r9_runtime(delta_handle, 12_025);

        let mut agent_runtime = checked_r9_fixture_runtime("session-r9");
        agent_runtime
            .upsert_network_peer_grant(canonical.agent_grant.clone())
            .unwrap();
        agent_runtime
            .upsert_network_agent_grant(canonical.agent_capability_grant.clone())
            .unwrap();
        let (agent_handle, before_agent_command) = insert_test_runtime(agent_runtime);
        let (after_agent_command, agent_command_receipt) = dispatch_checked_r9_operation(
            agent_handle,
            12_026,
            before_agent_command.clone(),
            "r9-fixture:browser-agent-command",
            NETWORK_REQUEST_TYPE_V1,
            browser_agent_command.clone(),
        );
        assert_only_network_revision_advanced(&before_agent_command, &after_agent_command);
        assert_eq!(agent_command_receipt.type_id, NETWORK_RESPONSE_TYPE_V1);
        assert_eq!(
            agent_command_receipt.payload,
            checked_r9_fixture_hex_v1("wasmDispatchReceipts", "browserAgentCommand")
        );
        let blockwild_network::NetworkBrowserResponseV1::AgentCommand {
            request_id,
            code,
            receipt,
            ..
        } = blockwild_network::decode_network_browser_response_v1(&agent_command_receipt.payload).unwrap()
        else {
            panic!("checked BWNA must contain an agent-command response")
        };
        assert_eq!(request_id, 9_007_199_254_740_984);
        assert_eq!(code, blockwild_network::AgentAuthorityCodeV1::Accepted);
        assert!(receipt.is_some_and(|value| value.accepted()));
        let mut malformed_agent_command = browser_agent_command;
        *malformed_agent_command.last_mut().unwrap() ^= 1;
        dispatch_rejected_r9_operation(
            agent_handle,
            12_027,
            after_agent_command,
            "r9-fixture:browser-agent-command:checksum",
            NETWORK_REQUEST_TYPE_V1,
            malformed_agent_command,
            "network-error",
        );
        shutdown_checked_r9_runtime(agent_handle, 12_028);

        let mut pose_runtime = checked_r9_fixture_runtime("session-r9");
        pose_runtime
            .upsert_network_peer_grant(blockwild_network::NetworkPeerGrantV1 {
                actor_id: "peer-1".into(),
                ..canonical.human_grant.clone()
            })
            .unwrap();
        pose_runtime
            .upsert_network_replication_record(blockwild_network::ScopedDeltaRecordV1 {
                scope: blockwild_network::ReplicationScopeV1::Entity("player:peer-1".into()),
                record: canonical.delta.records[0].clone(),
            })
            .unwrap();
        let (presented, _) = pose_runtime
            .build_network_delta(
                blockwild_network::InterestDeltaBuildSourceV1 {
                    session_id: canonical.delta.session_id.clone(),
                    delta_id: canonical.delta.delta_id.clone(),
                    peer_id: canonical.delta.peer_id.clone(),
                    keyframe: canonical.delta.keyframe,
                    sequence: canonical.delta.sequence,
                    acknowledged_command_sequence: canonical.delta.acknowledged_command_sequence,
                    from: canonical.delta.from.clone(),
                    to: canonical.delta.to.clone(),
                },
                &canonical.interest,
            )
            .unwrap();
        assert_eq!(presented, canonical.delta);
        let (pose_handle, before_guest_pose) = insert_test_runtime(pose_runtime);
        let (after_guest_pose, guest_pose_receipt) = dispatch_checked_r9_operation(
            pose_handle,
            12_029,
            before_guest_pose.clone(),
            "r9-fixture:browser-guest-pose",
            NETWORK_REQUEST_TYPE_V1,
            browser_guest_pose.clone(),
        );
        assert_only_network_revision_advanced(&before_guest_pose, &after_guest_pose);
        assert_eq!(guest_pose_receipt.type_id, NETWORK_RESPONSE_TYPE_V1);
        assert_eq!(
            guest_pose_receipt.payload,
            checked_r9_fixture_hex_v1("wasmDispatchReceipts", "browserGuestPose")
        );
        let blockwild_network::NetworkBrowserResponseV1::GuestPose {
            request_id,
            receipt,
            projection,
            ..
        } = blockwild_network::decode_network_browser_response_v1(&guest_pose_receipt.payload).unwrap()
        else {
            panic!("checked BWNA must contain a guest-pose response")
        };
        assert_eq!(request_id, 9_007_199_254_740_983);
        assert!(receipt.accepted());
        let projection = projection.expect("accepted guest pose projection");
        assert_eq!(projection.command_hash, command.command_hash);
        assert_eq!(projection.receipt_hash, receipt.receipt_hash);
        assert_eq!(projection.presented_delta_sequence, canonical.delta.sequence);
        assert_eq!(projection.presented_identity_hash, canonical.delta.to.state_hash);
        assert_eq!(projection.record_revision, 1);
        assert_eq!(projection.previous_record_hash, CanonicalHash::default());
        assert_eq!(projection.pose, pose);
        let mut malformed_guest_pose = browser_guest_pose;
        *malformed_guest_pose.last_mut().unwrap() ^= 1;
        dispatch_rejected_r9_operation(
            pose_handle,
            12_030,
            after_guest_pose,
            "r9-fixture:browser-guest-pose:checksum",
            NETWORK_REQUEST_TYPE_V1,
            malformed_guest_pose,
            "network-error",
        );
        shutdown_checked_r9_runtime(pose_handle, 12_031);
    }

    #[test]
    fn camera_config_dispatch_returns_exact_bwr5_and_rolls_back_the_outer_candidate() {
        let (handle, identity) =
            insert_test_runtime(IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap());
        let operation = camera_config_operation(0, CameraModeV1::ThirdRear);
        let request_payload_hash = CanonicalHash(operation.payload_hash.0);
        let (after, receipt) = dispatch_single_operation(handle, 801, identity, "camera-config:first", operation);
        assert_eq!(receipt.domain, RuntimeDomainV1::Simulation);
        assert_eq!(receipt.type_id, SIMULATION_CAMERA_CONFIG_RECEIPT_TYPE_V1);
        assert_eq!(receipt.schema, 1);
        assert_eq!(receipt.payload_hash, WireHash(wire_checksum_v1(&receipt.payload)));
        let decoded = decode_runtime_camera_config_receipt_v1(&receipt.payload).unwrap();
        assert_eq!(decoded.request_payload_hash, request_payload_hash);
        assert_eq!(
            (decoded.previous_camera_revision, decoded.resulting_camera_revision),
            (0, 1)
        );
        assert_eq!(decoded.mode, CameraModeV1::ThirdRear);

        let (idempotent_after, idempotent_receipt) = dispatch_single_operation(
            handle,
            802,
            after.clone(),
            "camera-config:idempotent",
            camera_config_operation(1, CameraModeV1::ThirdRear),
        );
        assert_eq!(idempotent_after, after);
        let idempotent = decode_runtime_camera_config_receipt_v1(&idempotent_receipt.payload).unwrap();
        assert_eq!(
            (
                idempotent.previous_camera_revision,
                idempotent.resulting_camera_revision
            ),
            (1, 1)
        );

        let (rollback_handle, rollback_identity) =
            insert_test_runtime(IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap());
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "camera-config:rollback".into(),
            idempotency_key: "camera-config:rollback".into(),
            actor_id: "platform:test".into(),
            expected: rollback_identity,
            operations: vec![
                camera_config_operation(0, CameraModeV1::ThirdFront),
                domain_operation(
                    RuntimeDomainV1::Simulation,
                    "blockwild.simulation.unsupported.v1",
                    Vec::new(),
                ),
            ],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let response = decode_response_v1(&blockwild_runtime_command_v2(
            rollback_handle,
            &encode_request_v1(&RuntimeRequestV1::Command {
                request_id: 803,
                client_epoch: 1,
                batch,
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::CommandReceipt {
            receipt: RuntimeCommandReceiptV1::Rejected { code, .. },
            ..
        } = response
        else {
            panic!("expected rejected camera transaction: {response:?}")
        };
        assert_eq!(code, "unsupported-domain-codec");
        INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let runtime = store.runtimes.get(&rollback_handle).unwrap();
            assert_eq!(runtime.camera_state().revision, 0);
            assert_eq!(runtime.camera_state().mode, CameraModeV1::FirstPerson);
        });
    }

    #[test]
    fn basic_dirt_query_dispatch_is_read_only_cursor_exact_and_projects_held_mining_drop() {
        let empty = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let empty_identity = empty.identity();
        let empty_receipt = dispatch_basic_dirt_query_v1(&empty, 0, "basic-dirt-query:empty").unwrap();
        assert_eq!(empty.identity(), empty_identity);
        assert_eq!(empty_receipt.identity, empty_identity);
        assert_eq!(empty_receipt.cursor_after, 0);
        assert!(empty_receipt.receipt.is_none());
        let empty_seed = dispatch_basic_dirt_query_v1(&empty, MAX_SAFE_U64, "basic-dirt-query:empty-seed").unwrap();
        assert_eq!(empty_seed.cursor_after, 0);
        assert!(empty_seed.receipt.is_none());
        let empty_native = dispatch_native_block_edit_query_v1(&empty, 0, "native-block-edit-query:empty").unwrap();
        assert_eq!(empty_native.identity, empty_identity);
        assert_eq!(empty_native.cursor_after, 0);
        assert!(empty_native.receipt.is_none());
        let empty_native_v2 =
            dispatch_native_block_edit_query_v2(&empty, 0, "native-block-edit-v2-query:empty").unwrap();
        assert_eq!(empty_native_v2.identity, empty_identity);
        assert_eq!(empty_native_v2.cursor_after, 0);
        assert!(empty_native_v2.receipt.is_none());
        assert!(empty_native_v2.dirty_evidence.is_none());

        let mut runtime = runtime_with_basic_dirt_actions_v1(false, 2);
        runtime.step_context_v2(1, 2_000, &[], &[]).unwrap();
        let placement_input = RuntimeInputFrameV1 {
            sequence: 1,
            target_tick: 1,
            buttons: RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1,
            selected_slot: 0,
            ..RuntimeInputFrameV1::default()
        };
        let placement_step = runtime.step_context_v2(50_001, 2_000, &[placement_input], &[]).unwrap();
        assert_eq!(placement_step.fixed_steps, 1);
        assert_eq!(runtime.next_basic_dirt_action_sequence_v1(), Some(2));

        let placement_identity = runtime.identity();
        let placement = dispatch_basic_dirt_query_v1(&runtime, 0, "basic-dirt-query:placement").unwrap();
        assert_eq!(runtime.identity(), placement_identity);
        assert_eq!(placement.identity, placement_identity);
        assert_eq!(placement.cursor_after, 1);
        let placement = placement.receipt.unwrap();
        assert_eq!(placement.sequence, 1);
        assert_eq!(
            placement.action,
            blockwild_engine::IntegratedRuntimeBasicDirtActionKindV1::Place
        );
        assert_eq!(placement.inventory.before_stack, Some(ItemStack::simple(2, 2)));
        assert_eq!(placement.inventory.after_stack, Some(ItemStack::simple(2, 1)));
        assert!(placement.generated_drops.is_empty());
        let native_placement =
            dispatch_native_block_edit_query_v1(&runtime, 0, "native-block-edit-query:placement").unwrap();
        assert_eq!(runtime.identity(), placement_identity);
        assert_eq!(native_placement.identity, placement_identity);
        assert_eq!(native_placement.cursor_after, 1);
        let native_placement = native_placement.receipt.unwrap();
        assert_eq!(native_placement.sequence, 1);
        assert_eq!(
            native_placement.action,
            blockwild_engine::IntegratedRuntimeNativeBlockEditActionKindV1::Place
        );
        assert_eq!(native_placement.prior_block_id, 0);
        assert_eq!(native_placement.replacement_block_id, 2);
        assert_eq!(native_placement.inventory.before_stack, Some(ItemStack::simple(2, 2)));
        assert_eq!(native_placement.inventory.after_stack, Some(ItemStack::simple(2, 1)));
        let native_placement_v2 =
            dispatch_native_block_edit_query_v2(&runtime, 0, "native-block-edit-v2-query:placement").unwrap();
        assert_eq!(native_placement_v2.cursor_after, 1);
        assert_eq!(native_placement_v2.receipt.as_ref(), Some(&native_placement));
        let placement_dirty = native_placement_v2.dirty_evidence.unwrap();
        assert_eq!(placement_dirty.sequence, native_placement.sequence);
        assert_eq!(placement_dirty.receipt_hash, native_placement.receipt_hash);
        assert_eq!(
            placement_dirty.columns,
            vec![(native_placement.position.x, native_placement.position.z)]
        );
        assert_eq!(placement_dirty.subsystem_seeds.len(), 7);

        let placement_retry = dispatch_basic_dirt_query_v1(&runtime, 0, "basic-dirt-query:placement").unwrap();
        assert_eq!(placement_retry.cursor_after, 1);
        assert_eq!(placement_retry.receipt.unwrap(), placement);
        assert_eq!(runtime.identity(), placement_identity);

        let release = RuntimeInputFrameV1 {
            sequence: 2,
            target_tick: 2,
            selected_slot: 0,
            ..RuntimeInputFrameV1::default()
        };
        runtime.step_context_v2(100_001, 2_000, &[release], &[]).unwrap();
        let held_mine = RuntimeInputFrameV1 {
            sequence: 3,
            target_tick: 3,
            buttons: RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1,
            selected_slot: 0,
            ..RuntimeInputFrameV1::default()
        };
        runtime.step_context_v2(150_001, 2_000, &[held_mine], &[]).unwrap();
        assert_eq!(runtime.next_basic_dirt_action_sequence_v1(), Some(2));
        runtime.step_context_v2(200_001, 2_000, &[], &[]).unwrap();
        runtime.step_context_v2(250_001, 2_000, &[], &[]).unwrap();
        let before_completion = dispatch_basic_dirt_query_v1(&runtime, 1, "basic-dirt-query:still-held").unwrap();
        assert_eq!(before_completion.cursor_after, 1);
        assert!(before_completion.receipt.is_none());
        runtime.step_context_v2(300_001, 2_000, &[], &[]).unwrap();
        assert_eq!(runtime.next_basic_dirt_action_sequence_v1(), Some(3));

        let mined_identity = runtime.identity();
        let mined = dispatch_basic_dirt_query_v1(&runtime, 1, "basic-dirt-query:mined").unwrap();
        assert_eq!(runtime.identity(), mined_identity);
        assert_eq!(mined.identity, mined_identity);
        assert_eq!(mined.cursor_after, 2);
        let mined = mined.receipt.unwrap();
        assert_eq!(mined.sequence, 2);
        assert_eq!(mined.origin_input_sequence, 3);
        assert_eq!(mined.completion_tick, 6);
        assert_eq!(
            mined.action,
            blockwild_engine::IntegratedRuntimeBasicDirtActionKindV1::Mine
        );
        assert_eq!(mined.inventory.before_stack, Some(ItemStack::simple(2, 1)));
        assert_eq!(mined.inventory.after_stack, Some(ItemStack::simple(2, 1)));
        assert_eq!(mined.generated_drops.len(), 1);
        let drop = &mined.generated_drops[0];
        assert_eq!(drop.stack, ItemStack::simple(2, 1));
        assert_ne!(drop.entity_id.packed(), 0);
        assert_eq!(drop.provenance.origin_input_sequence, 3);
        assert_eq!(drop.provenance.block_id, 2);
        assert_ne!(drop.provenance.loot_plan_hash, CanonicalHash::default());
        assert_ne!(
            (drop.position.x_milli, drop.position.y_milli, drop.position.z_milli),
            (0, 0, 0)
        );
        assert!(drop.rotation.yaw < 1_000_000);
        assert_eq!(mined.native_receipt_v1().receipt_hash, mined.receipt_hash);
        let native_mined = dispatch_native_block_edit_query_v1(&runtime, 1, "native-block-edit-query:mined").unwrap();
        assert_eq!(runtime.identity(), mined_identity);
        assert_eq!(native_mined.identity, mined_identity);
        assert_eq!(native_mined.cursor_after, 2);
        let native_mined = native_mined.receipt.unwrap();
        assert_eq!(native_mined.sequence, 2);
        assert_eq!(native_mined.origin_input_sequence, 3);
        assert_eq!(
            native_mined.action,
            blockwild_engine::IntegratedRuntimeNativeBlockEditActionKindV1::Mine
        );
        assert_eq!(native_mined.prior_block_id, 2);
        assert_eq!(native_mined.replacement_block_id, 0);
        assert_eq!(native_mined.generated_drops.len(), 1);
        assert_eq!(native_mined.generated_drops[0].provenance, drop.provenance);
        assert_eq!(native_mined.generated_drops[0].entity_id, drop.entity_id);
        assert_eq!(native_mined.generated_drops[0].stack, drop.stack);
        let native_mined_v2 =
            dispatch_native_block_edit_query_v2(&runtime, 1, "native-block-edit-v2-query:mined").unwrap();
        assert_eq!(native_mined_v2.cursor_after, 2);
        assert_eq!(native_mined_v2.receipt.as_ref(), Some(&native_mined));
        assert_eq!(
            native_mined_v2
                .dirty_evidence
                .as_ref()
                .map(|evidence| evidence.sequence),
            Some(2)
        );

        let seed = dispatch_basic_dirt_query_v1(&runtime, MAX_SAFE_U64, "basic-dirt-query:seed").unwrap();
        assert_eq!(seed.cursor_after, 2);
        assert!(seed.receipt.is_none());
        let native_seed =
            dispatch_native_block_edit_query_v1(&runtime, MAX_SAFE_U64, "native-block-edit-query:seed").unwrap();
        assert_eq!(native_seed.cursor_after, 2);
        assert!(native_seed.receipt.is_none());
        let native_seed_v2 =
            dispatch_native_block_edit_query_v2(&runtime, MAX_SAFE_U64, "native-block-edit-v2-query:seed").unwrap();
        assert_eq!(native_seed_v2.cursor_after, 2);
        assert!(native_seed_v2.receipt.is_none());
        assert!(native_seed_v2.dirty_evidence.is_none());
        assert_eq!(
            dispatch_native_block_edit_query_v2(&runtime, 3, "native-block-edit-v2-query:future")
                .unwrap_err()
                .0,
            "native-block-edit-cursor-future"
        );
        assert_eq!(
            dispatch_native_block_edit_query_v1(&runtime, 3, "native-block-edit-query:future")
                .unwrap_err()
                .0,
            "native-block-edit-cursor-future"
        );
        assert_eq!(
            dispatch_basic_dirt_query_v1(&runtime, 3, "basic-dirt-query:future")
                .unwrap_err()
                .0,
            "basic-dirt-action-cursor-future"
        );

        let mut stale_expected = runtime.identity();
        stale_expected.tick = stale_expected.tick.saturating_add(1);
        let stale_operation = domain_operation(
            RuntimeDomainV1::Gameplay,
            BASIC_DIRT_ACTION_RECEIPT_TYPE_V1,
            encode_runtime_basic_dirt_action_receipt_query_v1(&RuntimeBasicDirtActionReceiptQueryWireV1 {
                expected: stale_expected,
                after_sequence: 2,
            })
            .unwrap(),
        );
        let stale_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "basic-dirt-query:stale-identity".into(),
            idempotency_key: "basic-dirt-query:stale-identity".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![stale_operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let Err(stale_error) = dispatch_command(&runtime, &stale_batch) else {
            panic!("stale Basic Dirt query unexpectedly dispatched")
        };
        assert_eq!(stale_error.0, "basic-dirt-action-query-stale");
        assert_eq!(runtime.identity(), mined_identity);
    }

    #[test]
    fn native_drop_pickup_query_dispatch_is_read_only_seedable_and_identity_bound() {
        let runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let identity = runtime.identity();
        let query_bytes =
            encode_runtime_native_drop_pickup_receipt_query_v1(&RuntimeNativeDropPickupReceiptQueryWireV1 {
                expected: identity.clone(),
                after_sequence: 0,
            })
            .unwrap();
        let current = dispatch_native_drop_pickup_query_v1(&runtime, 0, "native-drop-pickup-query:empty").unwrap();
        assert_eq!(runtime.identity(), identity);
        assert_eq!(current.identity, identity);
        assert_eq!(
            current.request_payload_hash,
            CanonicalHash(wire_checksum_v1(&query_bytes))
        );
        assert_eq!(current.cursor_after, 0);
        assert!(current.receipt.is_none());

        let retry = dispatch_native_drop_pickup_query_v1(&runtime, 0, "native-drop-pickup-query:retry").unwrap();
        assert_eq!(retry.cursor_after, 0);
        assert!(retry.receipt.is_none());
        let seed =
            dispatch_native_drop_pickup_query_v1(&runtime, MAX_SAFE_U64, "native-drop-pickup-query:seed").unwrap();
        assert_eq!(seed.cursor_after, 0);
        assert!(seed.receipt.is_none());
        assert_eq!(
            dispatch_native_drop_pickup_query_v1(&runtime, 1, "native-drop-pickup-query:future")
                .unwrap_err()
                .0,
            "native-drop-pickup-cursor-future"
        );

        let mut stale_expected = runtime.identity();
        stale_expected.tick = stale_expected.tick.saturating_add(1);
        let stale_operation = domain_operation(
            RuntimeDomainV1::Gameplay,
            NATIVE_DROP_PICKUP_RECEIPT_TYPE_V1,
            encode_runtime_native_drop_pickup_receipt_query_v1(&RuntimeNativeDropPickupReceiptQueryWireV1 {
                expected: stale_expected,
                after_sequence: 0,
            })
            .unwrap(),
        );
        let stale_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "native-drop-pickup-query:stale".into(),
            idempotency_key: "native-drop-pickup-query:stale".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![stale_operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let Err(stale) = dispatch_command(&runtime, &stale_batch) else {
            panic!("stale native drop pickup query unexpectedly dispatched")
        };
        assert_eq!(stale.0, "native-drop-pickup-query-stale");
        assert_eq!(runtime.identity(), identity);
    }

    #[test]
    fn native_player_drop_query_dispatch_is_read_only_cursor_exact_and_bws9_bound() {
        let mut runtime = runtime_with_basic_dirt_actions_v1(false, 2);
        let empty_identity = runtime.identity();
        let empty = dispatch_native_player_drop_query_v1(&runtime, 0, "native-player-drop-query:empty").unwrap();
        assert_eq!(runtime.identity(), empty_identity);
        assert_eq!(empty.identity, empty_identity);
        assert_eq!(empty.cursor_after, 0);
        assert!(empty.receipt.is_none());

        let seed = dispatch_native_player_drop_query_v1(&runtime, MAX_SAFE_U64, "native-player-drop-query:empty-seed")
            .unwrap();
        assert_eq!(seed.cursor_after, 0);
        assert!(seed.receipt.is_none());

        runtime.step_context_v2(1, 2_000, &[], &[]).unwrap();
        let step = runtime
            .step_context_v2(
                50_001,
                2_000,
                &[RuntimeInputFrameV1 {
                    sequence: 1,
                    target_tick: 1,
                    buttons: RUNTIME_INPUT_BUTTON_DROP_V1,
                    selected_slot: 0,
                    ..RuntimeInputFrameV1::default()
                }],
                &[],
            )
            .unwrap();
        assert_eq!(step.fixed_steps, 1);
        assert_eq!(runtime.next_native_player_drop_sequence_v1(), Some(2));

        let projected_identity = runtime.identity();
        let projected =
            dispatch_native_player_drop_query_v1(&runtime, 0, "native-player-drop-query:projected").unwrap();
        assert_eq!(runtime.identity(), projected_identity);
        assert_eq!(projected.identity, projected_identity);
        assert_eq!(projected.cursor_after, 1);
        let receipt = projected.receipt.unwrap();
        assert_eq!(receipt.sequence, 1);
        assert_eq!(receipt.origin_input_sequence, 1);
        assert_eq!(receipt.inventory.selected_slot, 0);
        assert_eq!(receipt.inventory.before_stack, Some(ItemStack::simple(2, 2)));
        assert_eq!(receipt.inventory.after_stack, Some(ItemStack::simple(2, 1)));
        assert_eq!(receipt.drop.stack, ItemStack::simple(2, 1));
        assert_ne!(receipt.drop.origin_hash, CanonicalHash::default());
        assert_ne!(receipt.receipt_hash, CanonicalHash::default());

        let retry = dispatch_native_player_drop_query_v1(&runtime, 0, "native-player-drop-query:retry").unwrap();
        assert_eq!(retry.cursor_after, 1);
        assert_eq!(retry.receipt.unwrap(), receipt);
        let seeded =
            dispatch_native_player_drop_query_v1(&runtime, MAX_SAFE_U64, "native-player-drop-query:seed").unwrap();
        assert_eq!(seeded.cursor_after, 1);
        assert!(seeded.receipt.is_none());
        assert_eq!(
            dispatch_native_player_drop_query_v1(&runtime, 2, "native-player-drop-query:future")
                .unwrap_err()
                .0,
            "native-player-drop-cursor-future"
        );

        let mut stale_expected = runtime.identity();
        stale_expected.tick = stale_expected.tick.saturating_add(1);
        let stale_operation = domain_operation(
            RuntimeDomainV1::Gameplay,
            NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1,
            encode_runtime_native_player_drop_receipt_query_v1(&RuntimeNativePlayerDropReceiptQueryWireV1 {
                expected: stale_expected,
                after_sequence: 1,
            })
            .unwrap(),
        );
        let stale_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "native-player-drop-query:stale".into(),
            idempotency_key: "native-player-drop-query:stale".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![stale_operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let Err(stale) = dispatch_command(&runtime, &stale_batch) else {
            panic!("stale native player-drop query unexpectedly dispatched")
        };
        assert_eq!(stale.0, "native-player-drop-query-stale");
        assert_eq!(runtime.identity(), projected_identity);
    }

    #[test]
    fn basic_dirt_receipt_survives_finalized_native_save_and_fresh_paged_hydration() {
        let source = runtime_with_basic_dirt_actions_v1(false, 2);
        let source_config = source.config().clone();
        let (source_handle, mut source_identity) = insert_test_runtime(source);

        let (next, fixed_steps) = step_runtime_through_wasm_v1(source_handle, 8_100, source_identity, 1, Vec::new());
        assert_eq!(fixed_steps, 0);
        source_identity = next;
        let (next, fixed_steps) = step_runtime_through_wasm_v1(
            source_handle,
            8_101,
            source_identity,
            50_001,
            vec![RuntimeInputFrameV1 {
                sequence: 1,
                target_tick: 1,
                buttons: RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1,
                selected_slot: 0,
                ..RuntimeInputFrameV1::default()
            }],
        );
        assert_eq!(fixed_steps, 1);
        source_identity = next;
        let (next, fixed_steps) = step_runtime_through_wasm_v1(
            source_handle,
            8_102,
            source_identity,
            100_001,
            vec![RuntimeInputFrameV1 {
                sequence: 2,
                target_tick: 2,
                selected_slot: 0,
                ..RuntimeInputFrameV1::default()
            }],
        );
        assert_eq!(fixed_steps, 1);
        source_identity = next;
        let (next, fixed_steps) = step_runtime_through_wasm_v1(
            source_handle,
            8_103,
            source_identity,
            150_001,
            vec![RuntimeInputFrameV1 {
                sequence: 3,
                target_tick: 3,
                buttons: RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1,
                selected_slot: 0,
                ..RuntimeInputFrameV1::default()
            }],
        );
        assert_eq!(fixed_steps, 1);
        source_identity = next;
        for (request_id, monotonic_time_us) in [(8_104, 200_001), (8_105, 250_001), (8_106, 300_001)] {
            let (next, fixed_steps) = step_runtime_through_wasm_v1(
                source_handle,
                request_id,
                source_identity,
                monotonic_time_us,
                Vec::new(),
            );
            assert_eq!(fixed_steps, 1);
            source_identity = next;
        }
        INTEGRATED_RUNTIMES.with(|store| {
            assert_eq!(
                store.borrow().runtimes[&source_handle].next_basic_dirt_action_sequence_v1(),
                Some(3)
            );
        });

        let source_query_identity = INTEGRATED_RUNTIMES.with(|store| {
            let identity = store.borrow().runtimes[&source_handle].identity();
            assert_eq!(wire_identity(&identity), source_identity);
            identity
        });
        let source_query_operation = domain_operation(
            RuntimeDomainV1::Gameplay,
            BASIC_DIRT_ACTION_RECEIPT_TYPE_V1,
            encode_runtime_basic_dirt_action_receipt_query_v1(&RuntimeBasicDirtActionReceiptQueryWireV1 {
                expected: source_query_identity,
                after_sequence: 1,
            })
            .unwrap(),
        );
        let (source_after_query, source_query_receipt) = dispatch_single_operation(
            source_handle,
            8_107,
            source_identity.clone(),
            "basic-dirt-durable:source-query",
            source_query_operation,
        );
        assert_eq!(source_after_query, source_identity);
        assert_eq!(
            source_query_receipt.type_id,
            BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1
        );
        let source_projection =
            decode_runtime_basic_dirt_action_projection_receipt_v1(&source_query_receipt.payload).unwrap();
        assert_eq!(source_projection.cursor_after, 2);
        let expected_mined = source_projection.receipt.expect("held mining receipt before save");
        assert_eq!(
            expected_mined.action,
            blockwild_engine::IntegratedRuntimeBasicDirtActionKindV1::Mine
        );
        assert_eq!(expected_mined.inventory.before_stack, Some(ItemStack::simple(2, 1)));
        assert_eq!(expected_mined.inventory.after_stack, Some(ItemStack::simple(2, 1)));
        assert_eq!(expected_mined.generated_drops.len(), 1);
        let expected_drop = expected_mined.generated_drops[0].clone();

        let finalize_wire = encode_bulk_request_v1(&RuntimeBulkRequestV1::FinalizeSave {
            request_id: 8_108,
            client_epoch: 1,
            expected: RuntimeBulkStateV1::from(&source_identity),
            stage_id: "basic-dirt-durable-save".into(),
            created_at: 8_108,
        })
        .unwrap();
        let finalized = decode_bulk_response_v1(
            &blockwild_runtime_initialize_native_save_v2(source_handle, &finalize_wire.control),
            &[],
        )
        .unwrap();
        let RuntimeBulkResponseV1::SaveProgress {
            current: finalized_current,
            state: RuntimeBulkSaveStageStateV1::Finalized,
            dispatcher_request_id,
            ..
        } = finalized
        else {
            panic!("expected finalized native save: {finalized:?}")
        };
        assert_ne!(dispatcher_request_id, 0);

        let (commit_current, commit_token, commit_type, commit_payload) =
            poll_runtime_platform_through_wasm_v1(source_handle, 8_109, finalized_current);
        assert_eq!(commit_type, PERSISTENCE_REQUEST_TYPE_V1);
        let commit_request = blockwild_persistence::decode_persistence_browser_request_v1(&commit_payload).unwrap();
        let blockwild_persistence::PersistenceBrowserRequestV1::Commit {
            request_id: commit_request_id,
            transaction,
            checkpoint,
        } = commit_request
        else {
            panic!("expected durable native commit")
        };
        let durable_checkpoint = checkpoint.clone();
        let mut durable_payloads = BTreeMap::new();
        for mutation in &transaction.mutations {
            match mutation {
                blockwild_persistence::Mutation::Put { address, payload, .. } => {
                    assert!(durable_payloads.insert(address.clone(), payload.clone()).is_none());
                }
                blockwild_persistence::Mutation::Delete { address, .. } => {
                    durable_payloads.remove(address);
                }
            }
        }
        assert_eq!(durable_payloads.len(), durable_checkpoint.records.len());
        assert!(
            durable_checkpoint
                .records
                .iter()
                .all(|descriptor| durable_payloads.contains_key(&descriptor.address))
        );
        let commit_response = blockwild_persistence::encode_persistence_browser_response_v1(
            &blockwild_persistence::PersistenceBrowserResponseV1::Commit(
                blockwild_persistence::PersistenceBrowserCommitResultV1 {
                    request_id: commit_request_id,
                    code: blockwild_persistence::PersistenceBrowserCommitCodeV1::Committed,
                    transaction_id: transaction.transaction_id,
                    journal_sequence: transaction.next_journal_sequence,
                    durable_hash: CanonicalHash([0x81; 16]),
                    checkpoint_hash: durable_checkpoint.checkpoint_hash,
                    verified_readback: true,
                    message: "Basic Dirt durable roundtrip fixture".into(),
                },
            ),
        )
        .unwrap();
        let committed_current = complete_runtime_platform_through_wasm_v1(
            source_handle,
            8_110,
            commit_current,
            commit_token,
            commit_response,
        );
        let idle_wire = encode_bulk_request_v1(&RuntimeBulkRequestV1::Poll {
            request_id: 8_111,
            client_epoch: 1,
            expected: committed_current,
            max_bytes: 128 * 1024 * 1024,
        })
        .unwrap();
        let idle = decode_bulk_response_v1(
            &blockwild_runtime_bulk_v2(source_handle, &idle_wire.control, &idle_wire.attachment),
            &[],
        )
        .unwrap();
        let RuntimeBulkResponseV1::Empty {
            current: idle_current, ..
        } = idle
        else {
            panic!("expected durable save dispatcher to drain: {idle:?}")
        };
        let source_saved_identity = INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let runtime = &store.runtimes[&source_handle];
            let identity = wire_identity(&runtime.identity());
            assert_eq!(RuntimeBulkStateV1::from(&identity), idle_current);
            assert!(runtime.persistence_status().unwrap().terminal_checkpoint.is_some());
            identity
        });

        let shutdown = decode_response_v1(&blockwild_runtime_destroy_v2(
            source_handle,
            &encode_request_v1(&RuntimeRequestV1::Shutdown {
                request_id: 8_112,
                client_epoch: 1,
                expected: Some(source_saved_identity),
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(shutdown, RuntimeResponseV1::Shutdown { .. }));

        let (restored_handle, fresh_identity) = insert_test_runtime(IntegratedRuntimeV2::new(source_config).unwrap());
        let recover_payload = encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::Recover {
            world_id: durable_checkpoint.world_id.clone(),
            checkpoint_id: Some(durable_checkpoint.checkpoint_id.clone()),
        })
        .unwrap();
        let (recover_queued_identity, recover_receipt) = dispatch_single_operation(
            restored_handle,
            8_113,
            fresh_identity,
            "basic-dirt-durable:recover-head",
            domain_operation(
                RuntimeDomainV1::Persistence,
                PERSISTENCE_DISPATCH_TYPE_V1,
                recover_payload,
            ),
        );
        assert_eq!(recover_receipt.type_id, PERSISTENCE_DISPATCH_RECEIPT_TYPE_V1);
        let (recover_current, recover_token, recover_type, recover_request_bytes) =
            poll_runtime_platform_through_wasm_v1(
                restored_handle,
                8_114,
                RuntimeBulkStateV1::from(&recover_queued_identity),
            );
        assert_eq!(recover_type, PERSISTENCE_REQUEST_TYPE_V1);
        let recover_request =
            blockwild_persistence::decode_persistence_platform_request_v1(&recover_request_bytes).unwrap();
        assert_eq!(
            recover_request.operation,
            blockwild_persistence::PersistencePlatformOperationV1::RecoverHead
        );
        assert_eq!(recover_request.world_id, durable_checkpoint.world_id);
        assert_eq!(recover_request.object_id, durable_checkpoint.checkpoint_id);
        let recover_response = blockwild_persistence::encode_persistence_platform_response_v1(
            &blockwild_persistence::PersistencePlatformResponseV1 {
                request_id: recover_request.request_id,
                operation: recover_request.operation,
                code: blockwild_persistence::PersistencePlatformResultCodeV1::Accepted,
                storage_revision: durable_checkpoint.journal_sequence,
                durable_hash: durable_checkpoint.checkpoint_hash,
                next_cursor: None,
                payload: blockwild_persistence::encode_paged_recovery_head_v1(
                    &blockwild_persistence::PagedRecoveryHeadV1::from_checkpoint(&durable_checkpoint),
                )
                .unwrap(),
                message: "exact native recovery head".into(),
            },
        )
        .unwrap();
        let _ = complete_runtime_platform_through_wasm_v1(
            restored_handle,
            8_115,
            recover_current,
            recover_token,
            recover_response,
        );

        let recovery_records = durable_checkpoint
            .records
            .iter()
            .map(|descriptor| blockwild_persistence::PagedRecoveryRecordV1 {
                descriptor: descriptor.clone(),
                payload: Some(
                    durable_payloads
                        .get(&descriptor.address)
                        .expect("durable checkpoint payload")
                        .clone(),
                ),
            })
            .collect::<Vec<_>>();
        let recovery_page = blockwild_persistence::PagedRecoveryPageV1 {
            checkpoint_id: durable_checkpoint.checkpoint_id.clone(),
            start_record: 0,
            records: recovery_records,
            next_record: None,
        };
        let recovery_page_bytes = blockwild_persistence::encode_paged_recovery_page_v1(&recovery_page).unwrap();
        let after_head_identity =
            INTEGRATED_RUNTIMES.with(|store| wire_identity(&store.borrow().runtimes[&restored_handle].identity()));
        let read_page_payload =
            encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::ReadRecoveryPage {
                world_id: durable_checkpoint.world_id.clone(),
                checkpoint_id: durable_checkpoint.checkpoint_id.clone(),
                start_record: 0,
                max_records: u32::try_from(durable_checkpoint.records.len()).unwrap(),
                max_bytes: u32::try_from(blockwild_persistence::PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1).unwrap(),
            })
            .unwrap();
        let (page_queued_identity, page_receipt) = dispatch_single_operation(
            restored_handle,
            8_116,
            after_head_identity,
            "basic-dirt-durable:recover-page",
            domain_operation(
                RuntimeDomainV1::Persistence,
                PERSISTENCE_DISPATCH_TYPE_V1,
                read_page_payload,
            ),
        );
        assert_eq!(page_receipt.type_id, PERSISTENCE_DISPATCH_RECEIPT_TYPE_V1);
        let (page_current, page_token, page_type, page_request_bytes) = poll_runtime_platform_through_wasm_v1(
            restored_handle,
            8_117,
            RuntimeBulkStateV1::from(&page_queued_identity),
        );
        assert_eq!(page_type, PERSISTENCE_REQUEST_TYPE_V1);
        let page_request = blockwild_persistence::decode_persistence_platform_request_v1(&page_request_bytes).unwrap();
        assert_eq!(
            page_request.operation,
            blockwild_persistence::PersistencePlatformOperationV1::ReadRecoveryPage
        );
        assert_eq!(page_request.cursor, 0);
        assert_eq!(
            page_request.limit,
            u32::try_from(durable_checkpoint.records.len()).unwrap()
        );
        assert!(recovery_page_bytes.len() <= usize::try_from(page_request.total_bytes).unwrap());
        let page_response = blockwild_persistence::encode_persistence_platform_response_v1(
            &blockwild_persistence::PersistencePlatformResponseV1 {
                request_id: page_request.request_id,
                operation: page_request.operation,
                code: blockwild_persistence::PersistencePlatformResultCodeV1::Accepted,
                storage_revision: durable_checkpoint.journal_sequence,
                durable_hash: durable_checkpoint.checkpoint_hash,
                next_cursor: None,
                payload: recovery_page_bytes,
                message: "exact native recovery page".into(),
            },
        )
        .unwrap();
        let _ =
            complete_runtime_platform_through_wasm_v1(restored_handle, 8_118, page_current, page_token, page_response);

        let before_hydration_identity =
            INTEGRATED_RUNTIMES.with(|store| wire_identity(&store.borrow().runtimes[&restored_handle].identity()));
        let hydrate_wire = encode_bulk_request_v1(&RuntimeBulkRequestV1::HydrateRecovery {
            request_id: 8_119,
            client_epoch: 1,
            expected: RuntimeBulkStateV1::from(&before_hydration_identity),
            recovery_id: durable_checkpoint.checkpoint_id.clone(),
        })
        .unwrap();
        let hydrated = decode_bulk_response_v1(
            &blockwild_runtime_bulk_v2(restored_handle, &hydrate_wire.control, &hydrate_wire.attachment),
            &[],
        )
        .unwrap();
        let RuntimeBulkResponseV1::Hydration {
            current: hydrated_current,
            recovery_id,
            native_domains,
            ..
        } = hydrated
        else {
            panic!("expected native durable hydration: {hydrated:?}")
        };
        assert_eq!(recovery_id, durable_checkpoint.checkpoint_id);
        assert_eq!(native_domains, 6);
        let (hydrated_identity, hydrated_query_identity) = INTEGRATED_RUNTIMES.with(|store| {
            let identity = store.borrow().runtimes[&restored_handle].identity();
            (wire_identity(&identity), identity)
        });
        assert_eq!(RuntimeBulkStateV1::from(&hydrated_identity), hydrated_current);

        let restored_query_operation = domain_operation(
            RuntimeDomainV1::Gameplay,
            BASIC_DIRT_ACTION_RECEIPT_TYPE_V1,
            encode_runtime_basic_dirt_action_receipt_query_v1(&RuntimeBasicDirtActionReceiptQueryWireV1 {
                expected: hydrated_query_identity.clone(),
                after_sequence: 1,
            })
            .unwrap(),
        );
        let (after_query, restored_query_receipt) = dispatch_single_operation(
            restored_handle,
            8_120,
            hydrated_identity.clone(),
            "basic-dirt-durable:restored-query",
            restored_query_operation,
        );
        assert_eq!(after_query, hydrated_identity);
        assert_eq!(
            restored_query_receipt.type_id,
            BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1
        );
        let restored_projection =
            decode_runtime_basic_dirt_action_projection_receipt_v1(&restored_query_receipt.payload).unwrap();
        assert_eq!(restored_projection.identity, hydrated_query_identity);
        assert_eq!(restored_projection.cursor_after, 2);
        let restored_mined = restored_projection.receipt.expect("restored held mining receipt");
        assert_eq!(restored_mined, expected_mined);
        assert_eq!(restored_mined.generated_drops[0], expected_drop);

        INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let runtime = &store.runtimes[&restored_handle];
            assert_eq!(runtime.identity(), hydrated_query_identity);
            assert_eq!(runtime.next_basic_dirt_action_sequence_v1(), Some(3));
            let blockwild_authority::WorldCellReadV1::Loaded { cell, .. } =
                runtime.world().read_cell(restored_mined.position)
            else {
                panic!("restored Basic Dirt receipt cell must be resident")
            };
            assert_eq!(cell.block_id, restored_mined.replacement_block_id);
            let inventory = &runtime.gameplay().state.inventory.containers[&restored_mined.inventory.container];
            assert_eq!(inventory.revision, restored_mined.inventory.after_revision);
            assert_eq!(
                inventory.slots[usize::from(restored_mined.inventory.slot)],
                restored_mined.inventory.after_stack
            );
            let extraction = runtime.world_view_extraction().unwrap();
            let live_drop = extraction
                .dropped_items
                .iter()
                .find(|drop| drop.spatial.entity_id == expected_drop.entity_id)
                .expect("restored generated drop remains in native world-view custody");
            assert_eq!(live_drop.stack, expected_drop.stack);
            assert_eq!(live_drop.spatial.position, expected_drop.position);
            assert_eq!(
                live_drop.spatial.velocity_milli_per_second,
                expected_drop.velocity_milli_per_second
            );
            assert_eq!(live_drop.spatial.rotation, expected_drop.rotation);
        });

        let cleanup = decode_response_v1(&blockwild_runtime_destroy_v2(
            restored_handle,
            &encode_request_v1(&RuntimeRequestV1::Shutdown {
                request_id: 8_121,
                client_epoch: 1,
                expected: Some(hydrated_identity),
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(cleanup, RuntimeResponseV1::Shutdown { .. }));
    }

    #[test]
    fn basic_dirt_query_dispatch_rejects_a_cursor_before_the_retained_tail() {
        let mut runtime = runtime_with_basic_dirt_actions_v1(true, 1);
        let mut monotonic_time_us = 1_u64;
        let mut input_sequence = 0_u64;
        let mut target_tick = 0_u64;
        runtime.step_context_v2(monotonic_time_us, 2_000, &[], &[]).unwrap();
        for cycle in 0_u64..129 {
            input_sequence += 1;
            target_tick += 1;
            monotonic_time_us += 50_000;
            runtime
                .step_context_v2(
                    monotonic_time_us,
                    2_000,
                    &[RuntimeInputFrameV1 {
                        sequence: input_sequence,
                        target_tick,
                        buttons: RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1,
                        selected_slot: 0,
                        ..RuntimeInputFrameV1::default()
                    }],
                    &[],
                )
                .unwrap();
            input_sequence += 1;
            target_tick += 1;
            monotonic_time_us += 50_000;
            runtime
                .step_context_v2(
                    monotonic_time_us,
                    2_000,
                    &[RuntimeInputFrameV1 {
                        sequence: input_sequence,
                        target_tick,
                        buttons: RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1,
                        selected_slot: 0,
                        ..RuntimeInputFrameV1::default()
                    }],
                    &[],
                )
                .unwrap();
            let expected_after_mine = cycle * 2 + 3;
            for _ in 0..3 {
                target_tick += 1;
                monotonic_time_us += 50_000;
                runtime.step_context_v2(monotonic_time_us, 2_000, &[], &[]).unwrap();
                if runtime.next_basic_dirt_action_sequence_v1() == Some(expected_after_mine) {
                    break;
                }
            }
            assert_eq!(runtime.next_basic_dirt_action_sequence_v1(), Some(expected_after_mine));
        }
        assert_eq!(runtime.next_basic_dirt_action_sequence_v1(), Some(259));
        assert_eq!(runtime.basic_dirt_action_receipts_v1().len(), 256);
        assert_eq!(runtime.basic_dirt_action_receipts_v1().front().unwrap().sequence, 3);
        let identity = runtime.identity();
        let Err(error) = dispatch_basic_dirt_query_v1(&runtime, 0, "basic-dirt-query:stale-tail") else {
            panic!("stale Basic Dirt cursor unexpectedly dispatched")
        };
        assert_eq!(error.0, "basic-dirt-action-cursor-stale");
        assert_eq!(runtime.identity(), identity);
        let current = dispatch_basic_dirt_query_v1(&runtime, 2, "basic-dirt-query:retained-tail").unwrap();
        assert_eq!(current.cursor_after, 3);
        assert_eq!(current.receipt.unwrap().sequence, 3);
        let seed = dispatch_basic_dirt_query_v1(&runtime, MAX_SAFE_U64, "basic-dirt-query:retained-seed").unwrap();
        assert_eq!(seed.cursor_after, 258);
        assert!(seed.receipt.is_none());
    }

    #[test]
    fn bootstrap_status_and_three_operation_player_install_are_atomic_with_terminal_bind_receipt() {
        let RuntimeRequestV1::Create { config, .. } = create_request(901) else {
            unreachable!("fixture is a create request")
        };
        let runtime = create_runtime(config).unwrap();
        let initial = runtime.identity();
        let query = PlayerBootstrapStatusQueryWireV1 {
            external_entity_id: "player:\u{6c34}".into(),
            actor_id: "actor:\u{6c34}".into(),
            player_id: blockwild_types::PlayerId::new(0x89ab_cdef, 0xfedc_ba98),
        };
        let status_payload = encode_player_bootstrap_status_query_v1(&query).unwrap();
        let status_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "bootstrap-status-pristine".into(),
            idempotency_key: "bootstrap-status-pristine".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&initial),
            operations: vec![domain_operation(
                RuntimeDomainV1::Simulation,
                PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
                status_payload,
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (unchanged, status_receipts) = dispatch_command(&runtime, &status_batch).unwrap();
        assert_eq!(unchanged.identity(), initial);
        let status = decode_player_bootstrap_status_v1(&status_receipts[0].payload).unwrap();
        assert_eq!(status.next_sequence, Some(1));
        assert_eq!(status.next_input_sequence, Some(1));
        assert!(status.queued_inputs_empty);

        let mut record = EntityCompatibilityRecord::new("player:\u{6c34}", "specimen:\u{6c34}", "player");
        record.class = EntityClass::Player;
        record.position = EntityVec3::new(8.0, 64.0, 8.0);
        record.health = 20.0;
        record.maximum_health = 20.0;
        let entity_payload = encode_entity_compatibility_import_v1(&EntityCompatibilityImportWireV1 {
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            desired_id: None,
            residency: EntityResidency::Hot,
            record,
        })
        .unwrap();
        let binding_payload = encode_runtime_player_binding_v1(&RuntimePlayerBindingWireV1 {
            external_entity_id: query.external_entity_id.clone(),
            actor_id: query.actor_id.clone(),
            player_id: query.player_id,
            creative_mode: true,
            radius: 0.35,
            standing_height: 1.8,
            crouching_height: 1.35,
            mass: 80.0,
            walk_speed: 4.3,
            sprint_speed: 6.2,
            creative_flight_speed: 8.0,
            maximum_oxygen_seconds: 15.0,
        })
        .unwrap();
        let inventory_payload = encode_player_inventory_import_v1(&PlayerInventoryImportWireV1 {
            import: ImportPlayerInventoryV1 {
                inventory: ContainerKey::player(query.actor_id.clone()),
                expected_revision: 0,
                slots: vec![None; 9],
                metadata: Vec::new(),
            },
            selected_slot: 6,
        })
        .unwrap();
        let operations = vec![
            domain_operation(
                RuntimeDomainV1::Entities,
                ENTITY_COMPATIBILITY_IMPORT_TYPE_V1,
                entity_payload.clone(),
            ),
            domain_operation_with_schema(
                RuntimeDomainV1::Simulation,
                SIMULATION_PLAYER_BIND_TYPE_V3,
                3,
                binding_payload.clone(),
            ),
            domain_operation(
                RuntimeDomainV1::Gameplay,
                PLAYER_INVENTORY_IMPORT_TYPE_V1,
                inventory_payload,
            ),
        ];
        let install_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "bootstrap-install".into(),
            idempotency_key: "bootstrap-install".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&initial),
            operations,
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (installed, receipts) = dispatch_command(&runtime, &install_batch).unwrap();
        assert_eq!(receipts.len(), 3);
        assert_eq!(receipts[0].type_id, ENTITY_RECEIPT_TYPE_V1);
        assert_eq!(receipts[1].type_id, SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V3);
        assert_eq!(receipts[1].schema, 3);
        assert_eq!(&receipts[1].payload[..4], b"BWF6");
        assert_eq!(&receipts[1].payload[6..22], &wire_checksum_v1(&binding_payload));
        assert_eq!(&receipts[1].payload[22..38], installed.state_hash().as_bytes());
        let inventory_receipt = decode_player_inventory_import_receipt_v1(&receipts[2].payload).unwrap();
        assert_eq!(inventory_receipt.inventory_revision, 1);
        assert_eq!(inventory_receipt.selected_slot, 6);
        let installed_status = installed
            .player_bootstrap_status(&query, CanonicalHash([0x85; 16]))
            .unwrap();
        assert_eq!(installed_status.world_view_binding.unwrap().selected_slot, 6);
        assert_eq!(installed_status.custody.unwrap().inventory_revision, 1);

        let mut invalid_slots = vec![None; 9];
        invalid_slots[0] = Some(ItemStack::simple(999, 1));
        let invalid_inventory = encode_player_inventory_import_v1(&PlayerInventoryImportWireV1 {
            import: ImportPlayerInventoryV1 {
                inventory: ContainerKey::player(query.actor_id.clone()),
                expected_revision: 0,
                slots: invalid_slots,
                metadata: Vec::new(),
            },
            selected_slot: 0,
        })
        .unwrap();
        let rollback_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "bootstrap-rollback".into(),
            idempotency_key: "bootstrap-rollback".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&initial),
            operations: vec![
                domain_operation(
                    RuntimeDomainV1::Entities,
                    ENTITY_COMPATIBILITY_IMPORT_TYPE_V1,
                    entity_payload,
                ),
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_TYPE_V3,
                    3,
                    binding_payload,
                ),
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    PLAYER_INVENTORY_IMPORT_TYPE_V1,
                    invalid_inventory,
                ),
            ],
            command_hash: WireHash::default(),
        })
        .unwrap();
        assert!(dispatch_command(&runtime, &rollback_batch).is_err());
        assert_eq!(runtime.identity(), initial);
    }

    #[test]
    fn creative_slot_outer_dispatch_is_exact_and_rejects_stale_or_noncreative_atomically() {
        let runtime = runtime_with_bound_locator_item_v1(true);
        assert!(
            capabilities(&runtime)
                .iter()
                .any(|value| value == "creative-inventory-slot-v1")
        );
        let inventory = ContainerKey::player("player:locator");
        let request = PlayerCreativeSlotSetWireV1 {
            inventory: inventory.clone(),
            selected_slot: 0,
            expected_inventory_revision: 1,
            expected_stack: Some(ItemStack::simple(603, 2)),
            replacement_stack: ItemStack::simple(603, 8),
        };
        let payload = encode_player_creative_slot_set_v1(&request).unwrap();
        let generic_before = runtime.identity();
        let generic = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-creative-slot-generic-rejected".into(),
            idempotency_key: "wasm-creative-slot-generic-rejected".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&generic_before),
            operations: vec![domain_operation(
                RuntimeDomainV1::Gameplay,
                GAMEPLAY_COMMAND_TYPE_V1,
                payload.clone(),
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        assert!(dispatch_command(&runtime, &generic).is_err());
        assert_eq!(runtime.identity(), generic_before);

        let operation = domain_operation(RuntimeDomainV1::Gameplay, PLAYER_CREATIVE_SLOT_SET_TYPE_V1, payload);
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-creative-slot-set".into(),
            idempotency_key: "wasm-creative-slot-set".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (applied, receipts) = dispatch_command(&runtime, &batch).unwrap();
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].type_id, PLAYER_CREATIVE_SLOT_SET_RECEIPT_TYPE_V1);
        let receipt = decode_player_creative_slot_set_receipt_v1(&receipts[0].payload).unwrap();
        assert_eq!(receipt.prior_stack, request.expected_stack);
        assert_eq!(receipt.replacement_stack, request.replacement_stack);
        assert_eq!(receipt.previous_inventory_revision, 1);
        assert_eq!(receipt.resulting_inventory_revision, 2);
        assert_eq!(
            applied.gameplay().state.inventory.containers[&inventory].slots[0],
            Some(ItemStack::simple(603, 8))
        );

        let mut stale_request = request.clone();
        stale_request.replacement_stack = ItemStack::simple(603, 7);
        let stale_payload = encode_player_creative_slot_set_v1(&stale_request).unwrap();
        let stale = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-creative-slot-stale".into(),
            idempotency_key: "wasm-creative-slot-stale".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&applied.identity()),
            operations: vec![domain_operation(
                RuntimeDomainV1::Gameplay,
                PLAYER_CREATIVE_SLOT_SET_TYPE_V1,
                stale_payload,
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        assert!(dispatch_command(&applied, &stale).is_err());
        assert_eq!(
            applied.gameplay().state.inventory.containers[&inventory].slots[0],
            Some(ItemStack::simple(603, 8))
        );

        let noncreative = runtime_with_bound_locator_item_v1(false);
        let noncreative_before = noncreative.identity();
        let payload = encode_player_creative_slot_set_v1(&request).unwrap();
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-creative-slot-noncreative".into(),
            idempotency_key: "wasm-creative-slot-noncreative".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&noncreative_before),
            operations: vec![domain_operation(
                RuntimeDomainV1::Gameplay,
                PLAYER_CREATIVE_SLOT_SET_TYPE_V1,
                payload,
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        assert!(dispatch_command(&noncreative, &batch).is_err());
        assert_eq!(noncreative.identity(), noncreative_before);
    }

    #[test]
    fn player_game_mode_outer_dispatch_is_simulation_only_actor_bound_and_atomic() {
        let runtime = runtime_with_bound_locator_item_v1(true);
        assert!(
            capabilities(&runtime)
                .iter()
                .any(|value| value == "player-game-mode-set-v1")
        );
        let request = PlayerGameModeSetWireV1 {
            external_entity_id: "player:locator".into(),
            actor_id: "player:locator".into(),
            player_id: blockwild_types::PlayerId::new(7, 1),
            expected_creative_mode: true,
            expected_flags: RUNTIME_INPUT_FLAG_CREATIVE_V1,
            requested_creative_mode: false,
        };
        let payload = encode_player_game_mode_set_v1(&request).unwrap();
        let before = runtime.identity();

        for (domain, type_id) in [
            (RuntimeDomainV1::Gameplay, GAMEPLAY_COMMAND_TYPE_V1),
            (RuntimeDomainV1::Gameplay, PLAYER_GAME_MODE_SET_TYPE_V1),
            (RuntimeDomainV1::Simulation, SIMULATION_CAMERA_CONFIG_TYPE_V1),
        ] {
            let generic = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
                command_id: format!("wasm-player-mode-generic-{domain:?}-{type_id}"),
                idempotency_key: format!("wasm-player-mode-generic-{domain:?}-{type_id}"),
                actor_id: request.actor_id.clone(),
                expected: wire_identity(&before),
                operations: vec![domain_operation(domain, type_id, payload.clone())],
                command_hash: WireHash::default(),
            })
            .unwrap();
            assert!(dispatch_command(&runtime, &generic).is_err());
            assert_eq!(runtime.identity(), before);
        }

        let wrong_actor = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-mode-wrong-actor".into(),
            idempotency_key: "wasm-player-mode-wrong-actor".into(),
            actor_id: "player:other".into(),
            expected: wire_identity(&before),
            operations: vec![domain_operation(
                RuntimeDomainV1::Simulation,
                PLAYER_GAME_MODE_SET_TYPE_V1,
                payload.clone(),
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let Err(error) = dispatch_command(&runtime, &wrong_actor) else {
            panic!("mismatched outer actor unexpectedly changed player game mode")
        };
        assert_eq!(error.0, "player-game-mode-actor");
        assert_eq!(runtime.identity(), before);

        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-mode-survival".into(),
            idempotency_key: "wasm-player-mode-survival".into(),
            actor_id: request.actor_id.clone(),
            expected: wire_identity(&before),
            operations: vec![domain_operation(
                RuntimeDomainV1::Simulation,
                PLAYER_GAME_MODE_SET_TYPE_V1,
                payload.clone(),
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (survival, receipts) = dispatch_command(&runtime, &batch).unwrap();
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].domain, RuntimeDomainV1::Simulation);
        assert_eq!(receipts[0].type_id, PLAYER_GAME_MODE_SET_RECEIPT_TYPE_V1);
        let receipt = decode_player_game_mode_set_receipt_v1(&receipts[0].payload).unwrap();
        assert_eq!(receipt.before, before);
        assert_eq!(receipt.after, survival.identity());
        assert!(!receipt.resulting_creative_mode);
        assert_eq!(receipt.resulting_flags, 0);
        assert_eq!(
            receipt.after.revision.simulation,
            receipt.before.revision.simulation + 1
        );
        assert_eq!(receipt.after.revision.gameplay, receipt.before.revision.gameplay);

        let stale_before = survival.identity();
        let stale = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-mode-stale".into(),
            idempotency_key: "wasm-player-mode-stale".into(),
            actor_id: request.actor_id.clone(),
            expected: wire_identity(&stale_before),
            operations: vec![domain_operation(
                RuntimeDomainV1::Simulation,
                PLAYER_GAME_MODE_SET_TYPE_V1,
                payload,
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        assert!(dispatch_command(&survival, &stale).is_err());
        assert_eq!(survival.identity(), stale_before);

        let to_builder = PlayerGameModeSetWireV1 {
            expected_creative_mode: false,
            expected_flags: 0,
            requested_creative_mode: true,
            ..request
        };
        let payload = encode_player_game_mode_set_v1(&to_builder).unwrap();
        let builder_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-mode-builder".into(),
            idempotency_key: "wasm-player-mode-builder".into(),
            actor_id: to_builder.actor_id,
            expected: wire_identity(&survival.identity()),
            operations: vec![domain_operation(
                RuntimeDomainV1::Simulation,
                PLAYER_GAME_MODE_SET_TYPE_V1,
                payload,
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (builder, receipts) = dispatch_command(&survival, &builder_batch).unwrap();
        let receipt = decode_player_game_mode_set_receipt_v1(&receipts[0].payload).unwrap();
        assert!(receipt.resulting_creative_mode);
        assert_eq!(receipt.resulting_flags, RUNTIME_INPUT_FLAG_CREATIVE_V1);
        assert!(builder.player().unwrap().binding.creative_mode);
        assert_eq!(builder.player().unwrap().flags, RUNTIME_INPUT_FLAG_CREATIVE_V1);
    }

    #[test]
    fn player_respawn_outer_dispatch_is_malformed_actor_stale_and_replay_safe() {
        let runtime = runtime_with_dead_bound_combat_player_v1();
        let request = respawn_request_v1(&runtime);
        let before = runtime.identity();
        let before_inventory =
            runtime.gameplay().state.inventory.containers[&ContainerKey::player(request.actor_id.clone())].clone();
        let dead_world_view = runtime.world_view_extraction().unwrap();
        let dead_views = domain_views_with_world_view(&runtime, Some(&dead_world_view));
        let dead_player = dead_views[1]
            .rows
            .iter()
            .find(|row| row.kind == 1)
            .expect("dead native player runtime row");
        assert!(matches!(
            dead_player.fields.get("deathSequence.present"),
            Some(DomainViewValueV1::Bool(true))
        ));
        assert!(matches!(
            dead_player.fields.get("deathSequence.value"),
            Some(DomainViewValueV1::U64(1))
        ));
        assert!(matches!(
            dead_player.fields.get("lastRespawnSequence.present"),
            Some(DomainViewValueV1::Bool(false))
        ));
        assert!(!dead_player.fields.contains_key("lastRespawnSequence.value"));
        assert!(
            !dead_views[1]
                .blockers
                .iter()
                .any(|blocker| blocker == "player-death-respawn-sequence-not-authoritative")
        );

        let malformed = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-respawn-malformed".into(),
            idempotency_key: "wasm-player-respawn-malformed".into(),
            actor_id: request.actor_id.clone(),
            expected: wire_identity(&before),
            operations: vec![domain_operation(
                RuntimeDomainV1::Simulation,
                PLAYER_RESPAWN_TYPE_V1,
                b"not-a-respawn".to_vec(),
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        assert!(dispatch_command(&runtime, &malformed).is_err());
        assert_eq!(runtime.identity(), before);

        let payload = encode_player_respawn_v1(&request).unwrap();
        let operation = domain_operation(RuntimeDomainV1::Simulation, PLAYER_RESPAWN_TYPE_V1, payload);
        let wrong_actor = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-respawn-wrong-actor".into(),
            idempotency_key: "wasm-player-respawn-wrong-actor".into(),
            actor_id: "player:other".into(),
            expected: wire_identity(&before),
            operations: vec![operation.clone()],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let Err(wrong_actor_error) = dispatch_command(&runtime, &wrong_actor) else {
            panic!("wrong outer actor unexpectedly respawned the player");
        };
        assert_eq!(wrong_actor_error.0, "player-respawn-actor");
        assert_eq!(runtime.identity(), before);

        let mut stale_request = request.clone();
        stale_request.expected.tick = stale_request.expected.tick.saturating_sub(1);
        let stale = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-respawn-stale".into(),
            idempotency_key: "wasm-player-respawn-stale".into(),
            actor_id: request.actor_id.clone(),
            expected: wire_identity(&before),
            operations: vec![domain_operation(
                RuntimeDomainV1::Simulation,
                PLAYER_RESPAWN_TYPE_V1,
                encode_player_respawn_v1(&stale_request).unwrap(),
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let Err(stale_error) = dispatch_command(&runtime, &stale) else {
            panic!("stale inner respawn identity unexpectedly committed");
        };
        assert_eq!(stale_error.0, "player-respawn-stale");
        assert_eq!(runtime.identity(), before);

        let mut clear_inventory_request = request.clone();
        clear_inventory_request.keep_inventory = false;
        let clear_inventory = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-respawn-clear-inventory".into(),
            idempotency_key: "wasm-player-respawn-clear-inventory".into(),
            actor_id: request.actor_id.clone(),
            expected: wire_identity(&before),
            operations: vec![domain_operation(
                RuntimeDomainV1::Simulation,
                PLAYER_RESPAWN_TYPE_V1,
                encode_player_respawn_v1(&clear_inventory_request).unwrap(),
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (cleared, clear_receipts) = dispatch_command(&runtime, &clear_inventory).unwrap();
        let clear_receipt = decode_player_respawn_receipt_v1(&clear_receipts[0].payload).unwrap();
        assert!(!clear_receipt.keep_inventory);
        assert_eq!(clear_receipt.generated_drop_count, 1);
        assert_eq!(
            clear_receipt.inventory_after_revision,
            clear_receipt.inventory_before_revision + 1
        );
        assert_eq!(
            clear_receipt.equipment_after_revision,
            clear_receipt.equipment_before_revision
        );
        assert_ne!(clear_receipt.custody_before_hash, clear_receipt.custody_after_hash);
        assert_eq!(cleared.world_view().state.dropped_items.len(), 1);
        assert_eq!(runtime.identity(), before);

        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-respawn".into(),
            idempotency_key: "wasm-player-respawn".into(),
            actor_id: request.actor_id.clone(),
            expected: wire_identity(&before),
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (handle, _) = insert_test_runtime(runtime);
        let command_bytes = encode_request_v1(&RuntimeRequestV1::Command {
            request_id: 9_101,
            client_epoch: 72,
            batch: batch.clone(),
        })
        .unwrap();
        let first_bytes = blockwild_runtime_command_v2(handle, &command_bytes);
        let retry_bytes = blockwild_runtime_command_v2(handle, &command_bytes);
        assert_eq!(
            retry_bytes, first_bytes,
            "transport retry must replay the exact receipt bytes"
        );
        let RuntimeResponseV1::CommandReceipt { receipt: accepted, .. } = decode_response_v1(&first_bytes).unwrap()
        else {
            panic!("expected accepted player respawn command");
        };
        let RuntimeCommandReceiptV1::Accepted { domain_receipts, .. } = &accepted else {
            panic!("expected accepted player respawn receipt");
        };
        assert_eq!(domain_receipts.len(), 1);
        assert_eq!(domain_receipts[0].type_id, PLAYER_RESPAWN_RECEIPT_TYPE_V1);
        let receipt = decode_player_respawn_receipt_v1(&domain_receipts[0].payload).unwrap();
        assert_eq!((receipt.prior_health, receipt.resulting_health), (0, 1_000));
        assert_eq!((receipt.prior_alive, receipt.resulting_alive), (false, true));
        assert!(receipt.keep_inventory);
        assert_eq!(receipt.generated_drop_count, 0);
        assert_eq!(receipt.inventory_before_revision, receipt.inventory_after_revision);
        assert_eq!(receipt.equipment_before_revision, receipt.equipment_after_revision);
        assert_eq!(receipt.custody_before_hash, receipt.custody_after_hash);

        let recovery = decode_response_v1(&blockwild_runtime_command_v2(
            handle,
            &encode_request_v1(&RuntimeRequestV1::RecoverCommand {
                request_id: 9_102,
                client_epoch: 72,
                batch,
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(
            recovery,
            RuntimeResponseV1::CommandReceipt { receipt, .. } if receipt == accepted
        ));

        INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let applied = &store.runtimes[&handle];
            let combatant = &applied.gameplay().state.combat.combatants["player:locator"];
            assert_eq!(combatant.health, 1_000);
            assert!(combatant.alive);
            assert_eq!(
                applied.gameplay().state.inventory.containers[&ContainerKey::player("player:locator")],
                before_inventory
            );
            let live_world_view = applied.world_view_extraction().unwrap();
            let live_views = domain_views_with_world_view(applied, Some(&live_world_view));
            let live_player = live_views[1]
                .rows
                .iter()
                .find(|row| row.kind == 1)
                .expect("respawned native player runtime row");
            assert!(matches!(
                live_player.fields.get("deathSequence.value"),
                Some(DomainViewValueV1::U64(1))
            ));
            assert!(matches!(
                live_player.fields.get("lastRespawnSequence.value"),
                Some(DomainViewValueV1::U64(1))
            ));
            assert!(
                !live_views[1]
                    .blockers
                    .iter()
                    .any(|blocker| blocker == "player-death-respawn-sequence-not-authoritative")
            );
        });
    }

    #[test]
    fn player_respawn_false_empty_custody_is_exact_and_checkpoint_stable() {
        let mut runtime = runtime_with_dead_bound_combat_player_with_count_v1(0, false);
        let bound_player = runtime.player().expect("dead bound player");
        let bootstrap_query = PlayerBootstrapStatusQueryWireV1 {
            external_entity_id: bound_player.binding.external_entity_id.clone(),
            actor_id: bound_player.binding.actor_id.clone(),
            player_id: bound_player.binding.player_id,
        };
        let dead_status = runtime
            .player_bootstrap_status(&bootstrap_query, CanonicalHash([0xc1; 16]))
            .unwrap();
        let neutral = RuntimeInputFrameV1 {
            sequence: 1,
            target_tick: runtime.identity().tick.checked_add(1).unwrap(),
            look_yaw: 1_234,
            look_pitch: -567,
            ..RuntimeInputFrameV1::default()
        };
        let summary = runtime
            .step_context_v2(
                dead_status.last_monotonic_time_us.checked_add(50_000).unwrap(),
                8_000,
                &[neutral],
                &[],
            )
            .unwrap();
        assert_eq!(summary.inputs_applied, 1);
        assert_eq!(runtime.last_applied_input(), Some(neutral));
        assert_eq!(runtime.player().unwrap().last_input_sequence, neutral.sequence);

        let mut request = respawn_request_v1(&runtime);
        request.keep_inventory = false;
        let before = runtime.identity();
        let operation = domain_operation(
            RuntimeDomainV1::Simulation,
            PLAYER_RESPAWN_TYPE_V1,
            encode_player_respawn_v1(&request).unwrap(),
        );
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-respawn-empty-custody".into(),
            idempotency_key: "wasm-player-respawn-empty-custody".into(),
            actor_id: request.actor_id.clone(),
            expected: wire_identity(&before),
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (applied, receipts) = dispatch_command(&runtime, &batch).unwrap();
        assert_eq!(receipts.len(), 1);
        let receipt = decode_player_respawn_receipt_v1(&receipts[0].payload).unwrap();
        assert!(!receipt.keep_inventory);
        assert_eq!(receipt.generated_drop_count, 0);
        assert_eq!(receipt.after.revision.entities, before.revision.entities + 1);
        assert_eq!(receipt.after.revision.gameplay, before.revision.gameplay + 1);
        assert_eq!(receipt.after.revision.simulation, before.revision.simulation + 1);
        assert_eq!(receipt.inventory_before_revision, receipt.inventory_after_revision);
        assert_eq!(receipt.equipment_before_revision, receipt.equipment_after_revision);
        assert_eq!(receipt.custody_before_hash, receipt.custody_after_hash);

        let parent = applied
            .native_player_death_respawn_receipt_for_player_v1(&request.external_entity_id, request.player_id)
            .expect("empty false-policy respawn retains its durable parent");
        assert_eq!(parent.sequence, 1);
        assert_eq!(parent.death_sequence, request.expected_death_sequence);
        assert!(parent.drops.is_empty());
        assert_eq!(parent.receipt_hash, parent.calculate_hash_v1());
        assert_eq!(applied.next_native_player_death_respawn_sequence_v1(), Some(2));

        let world_view = applied.world_view_extraction().unwrap();
        let views = domain_views_with_world_view(&applied, Some(&world_view));
        let player = views[1]
            .rows
            .iter()
            .find(|row| row.kind == 1)
            .expect("respawned player runtime row");
        assert!(matches!(
            player.fields.get("latestDeathRespawn.present"),
            Some(DomainViewValueV1::Bool(true))
        ));
        assert!(matches!(
            player.fields.get("latestDeathRespawn.respawnSequence"),
            Some(DomainViewValueV1::U64(1))
        ));
        assert!(matches!(
            player.fields.get("latestDeathRespawn.generatedDropCount"),
            Some(DomainViewValueV1::U64(0))
        ));
        assert!(matches!(
            player.fields.get("latestDeathRespawn.inventoryContainer"),
            Some(DomainViewValueV1::String(value))
                if value == &container_view_key!(&parent.inventory_container)
        ));
        assert!(matches!(
            player.fields.get("latestDeathRespawn.equipmentContainer"),
            Some(DomainViewValueV1::String(value))
                if value == &container_view_key!(&parent.equipment_container)
        ));
        assert!(matches!(
            player.fields.get("deathSequence.value"),
            Some(DomainViewValueV1::U64(value)) if *value == request.expected_death_sequence
        ));
        assert!(matches!(
            player.fields.get("lastRespawnSequence.value"),
            Some(DomainViewValueV1::U64(value)) if *value == request.expected_death_sequence
        ));
        assert!(matches!(
            player.fields.get("lastInputSequence"),
            Some(DomainViewValueV1::U64(value)) if *value == neutral.sequence
        ));
        assert!(matches!(
            player.fields.get("input.targetTick"),
            Some(DomainViewValueV1::U64(value)) if *value == neutral.target_tick
        ));
        assert!(matches!(
            player.fields.get("input.lookYaw"),
            Some(DomainViewValueV1::I64(value)) if *value == i64::from(neutral.look_yaw)
        ));
        assert!(matches!(
            player.fields.get("input.lookPitch"),
            Some(DomainViewValueV1::I64(value)) if *value == i64::from(neutral.look_pitch)
        ));
        assert!(matches!(
            player.fields.get("pendingMovementResultEmpty"),
            Some(DomainViewValueV1::Bool(true))
        ));

        let before_checkpoint = applied.identity();
        let before_bwx0 = encode_hud_extraction(&applied);
        let checkpoint = applied.export_runtime_checkpoint().unwrap();
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert_eq!(restored.identity(), before_checkpoint);
        assert_eq!(encode_hud_extraction(&restored), before_bwx0);
        assert_eq!(restored.last_applied_input(), Some(neutral));
        assert_eq!(restored.player().unwrap().last_input_sequence, neutral.sequence);
        let restored_status = restored
            .player_bootstrap_status(&bootstrap_query, CanonicalHash([0xc2; 16]))
            .unwrap();
        assert_eq!(restored_status.last_input_sequence, Some(neutral.sequence));
        assert_eq!(restored_status.next_input_sequence, neutral.sequence.checked_add(1));
        assert_eq!(restored_status.last_applied_input, Some(neutral));
        assert_eq!(
            restored.native_player_death_respawn_receipt_for_player_v1(&request.external_entity_id, request.player_id,),
            Some(parent)
        );
    }

    #[test]
    fn player_respawn_false_full_custody_retries_restores_and_preserves_pickup_provenance() {
        let runtime = runtime_with_dead_bound_combat_player_with_count_v1(2, true);
        let mut request = respawn_request_v1(&runtime);
        request.keep_inventory = false;
        let dead_record = runtime.entities().compatibility_record(request.entity_id).unwrap();
        request.respawn_position.x_milli = (f64::from(dead_record.position.x) * 1_000.0).round() as i64;
        request.respawn_position.y_milli = (f64::from(dead_record.position.y) * 1_000.0).round() as i64;
        request.respawn_position.z_milli = (f64::from(dead_record.position.z) * 1_000.0).round() as i64;
        let before = runtime.identity();
        let operation = domain_operation(
            RuntimeDomainV1::Simulation,
            PLAYER_RESPAWN_TYPE_V1,
            encode_player_respawn_v1(&request).unwrap(),
        );
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-respawn-full-custody".into(),
            idempotency_key: "wasm-player-respawn-full-custody".into(),
            actor_id: request.actor_id.clone(),
            expected: wire_identity(&before),
            operations: vec![operation],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (handle, _) = insert_test_runtime(runtime);
        let command_bytes = encode_request_v1(&RuntimeRequestV1::Command {
            request_id: 9_201,
            client_epoch: 73,
            batch: batch.clone(),
        })
        .unwrap();
        let first_bytes = blockwild_runtime_command_v2(handle, &command_bytes);
        assert_eq!(blockwild_runtime_command_v2(handle, &command_bytes), first_bytes);
        let RuntimeResponseV1::CommandReceipt { receipt: accepted, .. } = decode_response_v1(&first_bytes).unwrap()
        else {
            panic!("expected accepted false-policy respawn command");
        };
        let RuntimeCommandReceiptV1::Accepted { domain_receipts, .. } = &accepted else {
            panic!("expected accepted false-policy respawn receipt");
        };
        let receipt = decode_player_respawn_receipt_v1(&domain_receipts[0].payload).unwrap();
        assert!(!receipt.keep_inventory);
        assert_eq!(receipt.generated_drop_count, 2);
        assert_eq!(receipt.after.revision.entities, before.revision.entities + 1);
        assert_eq!(receipt.after.revision.gameplay, before.revision.gameplay + 2);
        assert_eq!(receipt.after.revision.simulation, before.revision.simulation + 1);
        assert_eq!(receipt.inventory_after_revision, receipt.inventory_before_revision + 1);
        assert_eq!(receipt.equipment_after_revision, receipt.equipment_before_revision + 1);
        assert_ne!(receipt.custody_after_hash, receipt.custody_before_hash);

        let recovery = decode_response_v1(&blockwild_runtime_command_v2(
            handle,
            &encode_request_v1(&RuntimeRequestV1::RecoverCommand {
                request_id: 9_202,
                client_epoch: 73,
                batch,
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(
            recovery,
            RuntimeResponseV1::CommandReceipt { receipt, .. } if receipt == accepted
        ));

        let (parent, checkpoint, checkpoint_bwx0) = INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let applied = &store.runtimes[&handle];
            let parent = applied
                .native_player_death_respawn_receipt_for_player_v1(&request.external_entity_id, request.player_id)
                .expect("full false-policy respawn parent");
            // The durable native parent and BWE7 wire receipt seal different
            // canonical domains. Their shared transaction fields join them;
            // their hashes must never be treated as interchangeable.
            assert_ne!(parent.receipt_hash, CanonicalHash::default());
            assert_ne!(receipt.receipt_hash, CanonicalHash::default());
            assert_ne!(parent.receipt_hash, receipt.receipt_hash);
            assert_eq!(parent.player_id, receipt.player_id);
            assert_eq!(parent.player_entity_id, receipt.entity_id);
            assert_eq!(parent.death_sequence, receipt.death_sequence);
            assert_eq!(parent.inventory_before_revision, receipt.inventory_before_revision);
            assert_eq!(parent.inventory_after_revision, receipt.inventory_after_revision);
            assert_eq!(parent.equipment_before_revision, receipt.equipment_before_revision);
            assert_eq!(parent.equipment_after_revision, receipt.equipment_after_revision);
            assert_eq!(parent.custody_after_hash, receipt.custody_after_hash);
            assert_eq!(parent.drops.len(), receipt.generated_drop_count as usize);
            assert_eq!(parent.drops.len(), 2);
            assert_eq!(parent.drops[0].source_lane, PlayerDeathCustodyLaneV1::Inventory);
            assert_eq!(parent.drops[0].source_slot, 0);
            assert_eq!(parent.drops[1].source_lane, PlayerDeathCustodyLaneV1::Equipment);
            assert_eq!(parent.drops[1].source_slot, 0);
            assert_eq!(parent.drops[0].stack, ItemStack::simple(603, 1));
            assert_eq!(parent.drops[1].stack, ItemStack::simple(603, 1));
            assert_eq!(parent.receipt_hash, parent.calculate_hash_v1());
            for drop in &parent.drops {
                assert_eq!(drop.origin_hash, parent.calculate_drop_origin_hash_v1(drop));
                assert_eq!(drop.custody_revision, 0);
                assert_eq!(drop.spatial_revision, 0);
                assert_eq!(
                    applied.gameplay().state.inventory.containers[&drop.custody_container].slots[0],
                    Some(drop.stack.clone())
                );
                assert_eq!(
                    applied.world_view().state.dropped_items[&drop.drop_id].entity_id,
                    drop.entity_id
                );
                assert_eq!(
                    applied.entities().compatibility_record(drop.entity_id).unwrap().custom
                        ["playerDeathDrop.originHash"],
                    drop.origin_hash.to_hex()
                );
            }
            let player_inventory = &applied.gameplay().state.inventory.containers[&parent.inventory_container];
            let player_equipment = &applied.gameplay().state.inventory.containers[&parent.equipment_container];
            assert!(player_inventory.slots.iter().all(Option::is_none));
            assert!(player_equipment.slots.iter().all(Option::is_none));

            let world_view = applied.world_view_extraction().unwrap();
            let views = domain_views_with_world_view(applied, Some(&world_view));
            let player = views[1].rows.iter().find(|row| row.kind == 1).unwrap();
            assert!(matches!(
                player.fields.get("latestDeathRespawn.generatedDropCount"),
                Some(DomainViewValueV1::U64(2))
            ));
            assert!(matches!(
                player.fields.get("latestDeathRespawn.inventoryContainer"),
                Some(DomainViewValueV1::String(value))
                    if value == &container_view_key!(&parent.inventory_container)
            ));
            assert!(matches!(
                player.fields.get("latestDeathRespawn.equipmentContainer"),
                Some(DomainViewValueV1::String(value))
                    if value == &container_view_key!(&parent.equipment_container)
            ));
            assert!(matches!(
                player.fields.get("latestDeathRespawn.drop.0000.sourceLane"),
                Some(DomainViewValueV1::U64(0))
            ));
            assert!(matches!(
                player.fields.get("latestDeathRespawn.drop.0001.sourceLane"),
                Some(DomainViewValueV1::U64(1))
            ));
            assert!(matches!(
                player.fields.get("latestDeathRespawn.drop.0000.entityId"),
                Some(DomainViewValueV1::U64(value)) if *value == parent.drops[0].entity_id.packed()
            ));
            assert!(matches!(
                player.fields.get("latestDeathRespawn.drop.0001.originHash"),
                Some(DomainViewValueV1::Hash(value)) if *value == parent.drops[1].origin_hash
            ));
            assert!(matches!(
                player.fields.get("latestDeathRespawn.drop.0000.custodySlot"),
                Some(DomainViewValueV1::U64(value)) if *value == u64::from(parent.drops[0].custody_slot)
            ));
            assert!(matches!(
                player.fields.get("latestDeathRespawn.drop.0001.custodySlot"),
                Some(DomainViewValueV1::U64(value)) if *value == u64::from(parent.drops[1].custody_slot)
            ));
            let checkpoint = applied.export_runtime_checkpoint().unwrap();
            (parent, checkpoint, encode_hud_extraction(applied))
        });

        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
            &checkpoint,
            integrated_runtime_checkpoint_hash_v1(&checkpoint),
        )
        .unwrap();
        assert_eq!(
            restored.native_player_death_respawn_receipt_for_player_v1(&request.external_entity_id, request.player_id,),
            Some(parent.clone())
        );
        assert_eq!(encode_hud_extraction(&restored), checkpoint_bwx0);

        INTEGRATED_RUNTIMES.with(|store| {
            let mut store = store.borrow_mut();
            let applied = store.runtimes.get_mut(&handle).unwrap();
            let query = PlayerBootstrapStatusQueryWireV1 {
                external_entity_id: request.external_entity_id.clone(),
                actor_id: request.actor_id.clone(),
                player_id: request.player_id,
            };
            let mut now = applied
                .player_bootstrap_status(&query, CanonicalHash([0xd1; 16]))
                .unwrap()
                .last_monotonic_time_us;
            for _ in 0..64 {
                now = now.saturating_add(50_000);
                applied.step_context_v2(now, 8_000, &[], &[]).unwrap();
                if applied.native_drop_pickup_receipts_v1().len() == parent.drops.len() {
                    break;
                }
            }
            assert_eq!(applied.native_drop_pickup_receipts_v1().len(), 2);
            assert!(applied.world_view().state.dropped_items.is_empty());
            for (pickup, child) in applied.native_drop_pickup_receipts_v1().iter().zip(&parent.drops) {
                assert!(matches!(
                    &pickup.source.origin,
                    blockwild_engine::IntegratedRuntimeNativeDropPickupOriginV1::PlayerDeathDrop {
                        respawn_sequence,
                        respawn_receipt_hash,
                        source_lane,
                        source_slot,
                    } if *respawn_sequence == parent.sequence
                        && *respawn_receipt_hash == parent.receipt_hash
                        && *source_lane == child.source_lane
                        && *source_slot == child.source_slot
                ));
                assert_eq!(pickup.source.custody_slot, child.custody_slot);
            }
            let pickup_checkpoint = applied.export_runtime_checkpoint().unwrap();
            let pickup_restored = IntegratedRuntimeV2::restore_runtime_checkpoint(
                &pickup_checkpoint,
                integrated_runtime_checkpoint_hash_v1(&pickup_checkpoint),
            )
            .unwrap();
            assert_eq!(
                pickup_restored.native_drop_pickup_receipts_v1(),
                applied.native_drop_pickup_receipts_v1()
            );
            assert_eq!(
                pickup_restored
                    .native_player_death_respawn_receipt_for_player_v1(&request.external_entity_id, request.player_id,),
                Some(parent.clone())
            );
        });
    }

    #[test]
    fn locator_item_outer_dispatch_retries_recovers_and_rolls_back_later_failure() {
        let runtime = runtime_with_bound_locator_item_v1(true);
        let inventory = ContainerKey::player("player:locator");
        let request = PlayerLocatorItemConsumeWireV1 {
            inventory: inventory.clone(),
            selected_slot: 0,
            expected_inventory_revision: 1,
            expected_stack: ItemStack::simple(603, 2),
            purpose: PlayerLocatorItemPurposeV1::SettlementChart,
            locator_result_hash: CanonicalHash([0x71; 16]),
        };
        let payload = encode_player_locator_item_consume_v1(&request).unwrap();
        let operation = domain_operation(RuntimeDomainV1::Gameplay, PLAYER_LOCATOR_ITEM_CONSUME_TYPE_V1, payload);
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-locator-consume".into(),
            idempotency_key: "wasm-locator-consume".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![operation.clone()],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (applied, receipts) = dispatch_command(&runtime, &batch).unwrap();
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].type_id, PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_TYPE_V1);
        let receipt = decode_player_locator_item_consume_receipt_v1(&receipts[0].payload).unwrap();
        assert_eq!(receipt.consumed_stack, ItemStack::simple(603, 1));
        assert_eq!(receipt.remaining_stack, Some(ItemStack::simple(603, 1)));
        assert_eq!(receipt.previous_inventory_revision, 1);
        assert_eq!(receipt.resulting_inventory_revision, 2);

        let checkpoint = applied.export_runtime_checkpoint().unwrap();
        let checkpoint_hash = integrated_runtime_checkpoint_hash_v1(&checkpoint);
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(&checkpoint, checkpoint_hash).unwrap();
        assert_eq!(restored.identity(), applied.identity());
        assert_eq!(restored.replay_hash(), applied.replay_hash());
        assert_eq!(
            restored.gameplay().state.inventory.containers[&inventory],
            applied.gameplay().state.inventory.containers[&inventory]
        );

        let (handle, expected) = insert_test_runtime(runtime.clone());
        let request_bytes = encode_request_v1(&RuntimeRequestV1::Command {
            request_id: 9_001,
            client_epoch: 71,
            batch: batch.clone(),
        })
        .unwrap();
        let first = blockwild_runtime_command_v2(handle, &request_bytes);
        let retry = blockwild_runtime_command_v2(handle, &request_bytes);
        assert_eq!(retry, first);
        let first = decode_response_v1(&first).unwrap();
        let RuntimeResponseV1::CommandReceipt { receipt: accepted, .. } = first else {
            panic!("expected accepted locator item command")
        };
        let RuntimeCommandReceiptV1::Accepted { after, .. } = &accepted else {
            panic!("expected accepted locator item command")
        };
        assert_ne!(after, &expected);
        let terminal = after.clone();
        let inventory_after_first = INTEGRATED_RUNTIMES
            .with(|store| store.borrow().runtimes[&handle].gameplay().state.inventory.containers[&inventory].clone());

        let recovery = decode_response_v1(&blockwild_runtime_command_v2(
            handle,
            &encode_request_v1(&RuntimeRequestV1::RecoverCommand {
                request_id: 9_002,
                client_epoch: 71,
                batch: batch.clone(),
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(
            recovery,
            RuntimeResponseV1::CommandReceipt { receipt, .. } if receipt == accepted
        ));

        let mut conflicting = batch.clone();
        conflicting.command_id = "wasm-locator-consume-conflict".into();
        conflicting.command_hash = WireHash::default();
        let conflicting = seal_runtime_command_batch_v1(conflicting).unwrap();
        assert!(matches!(
            decode_response_v1(&blockwild_runtime_command_v2(
                handle,
                &encode_request_v1(&RuntimeRequestV1::RecoverCommand {
                    request_id: 9_003,
                    client_epoch: 71,
                    batch: conflicting,
                })
                .unwrap(),
            ))
            .unwrap(),
            RuntimeResponseV1::Error { code, .. } if code == "idempotency-conflict"
        ));

        let queued = decode_response_v1(&blockwild_runtime_step_v2(
            handle,
            &encode_request_v1(&RuntimeRequestV1::Step {
                request_id: 9_004,
                client_epoch: 71,
                expected: terminal,
                monotonic_time_us: 1_000_000,
                budget_us: 8_000,
                inputs: Vec::new(),
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::StepResult {
            identity: queued_identity,
            ..
        } = queued
        else {
            panic!("expected queued locator recovery step")
        };
        let advanced = decode_response_v1(&blockwild_runtime_step_v2(
            handle,
            &encode_request_v1(&RuntimeRequestV1::Step {
                request_id: 9_005,
                client_epoch: 71,
                expected: queued_identity,
                monotonic_time_us: 1_050_000,
                budget_us: 8_000,
                inputs: Vec::new(),
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::StepResult {
            identity: advanced_identity,
            ..
        } = advanced
        else {
            panic!("expected advanced locator recovery step")
        };
        assert_ne!(&advanced_identity, after);

        let historical = decode_response_v1(&blockwild_runtime_command_v2(
            handle,
            &encode_request_v1(&RuntimeRequestV1::Command {
                request_id: 9_006,
                client_epoch: 71,
                batch: batch.clone(),
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(
            historical,
            RuntimeResponseV1::CommandReceipt { receipt, .. } if receipt == accepted
        ));
        let stale_recovery = decode_response_v1(&blockwild_runtime_command_v2(
            handle,
            &encode_request_v1(&RuntimeRequestV1::RecoverCommand {
                request_id: 9_007,
                client_epoch: 71,
                batch: batch.clone(),
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(
            stale_recovery,
            RuntimeResponseV1::Error { code, current: Some(current), .. }
                if code == "idempotency-recovery-stale" && current == advanced_identity
        ));
        INTEGRATED_RUNTIMES.with(|store| {
            assert_eq!(
                store.borrow().runtimes[&handle].gameplay().state.inventory.containers[&inventory],
                inventory_after_first,
                "historical cache hits and exact-stale recovery must not debit a second locator item"
            );
        });

        let rollback_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-locator-rollback".into(),
            idempotency_key: "wasm-locator-rollback".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&runtime.identity()),
            operations: vec![
                operation,
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    "blockwild.gameplay.unsupported-after-locator.v1",
                    Vec::new(),
                ),
            ],
            command_hash: WireHash::default(),
        })
        .unwrap();
        assert!(dispatch_command(&runtime, &rollback_batch).is_err());
        assert_eq!(runtime.gameplay().state.inventory.containers[&inventory].revision, 1);
        assert_eq!(
            runtime.gameplay().state.inventory.containers[&inventory].slots[0],
            Some(ItemStack::simple(603, 2))
        );
    }

    #[test]
    fn combat_bind_v4_installs_after_inventory_and_later_failure_rolls_back_every_domain() {
        let RuntimeRequestV1::Create { config, .. } = create_request(951) else {
            unreachable!("fixture is a create request")
        };
        let runtime = create_runtime(config).unwrap();
        let initial = runtime.identity();
        let query = PlayerBootstrapStatusQueryWireV1 {
            external_entity_id: "player:combat".into(),
            actor_id: "actor:combat".into(),
            player_id: blockwild_types::PlayerId::new(0x1234_5678, 0x9abc_def0),
        };
        let mut record = EntityCompatibilityRecord::new("player:combat", "specimen:combat", "player");
        record.class = EntityClass::Player;
        record.position = EntityVec3::new(8.0, 64.0, 8.0);
        record.health = 9.5;
        record.maximum_health = 10.0;
        let entity_payload = encode_entity_compatibility_import_v1(&EntityCompatibilityImportWireV1 {
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            desired_id: Some(blockwild_types::EntityId::new(17, 3)),
            residency: EntityResidency::Hot,
            record,
        })
        .unwrap();
        let binding_payload = encode_runtime_player_binding_v1(&RuntimePlayerBindingWireV1 {
            external_entity_id: query.external_entity_id.clone(),
            actor_id: query.actor_id.clone(),
            player_id: query.player_id,
            creative_mode: false,
            radius: 0.35,
            standing_height: 1.8,
            crouching_height: 1.35,
            mass: 80.0,
            walk_speed: 4.3,
            sprint_speed: 6.2,
            creative_flight_speed: 8.0,
            maximum_oxygen_seconds: 15.0,
        })
        .unwrap();
        let inventory_request = PlayerInventoryImportWireV1 {
            import: ImportPlayerInventoryV1 {
                inventory: ContainerKey::player(query.actor_id.clone()),
                expected_revision: 0,
                slots: vec![None; 9],
                metadata: Vec::new(),
            },
            selected_slot: 4,
        };
        let duplicate_bind_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "combat-bootstrap-duplicate-bind".into(),
            idempotency_key: "combat-bootstrap-duplicate-bind".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&initial),
            operations: vec![
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_TYPE_V4,
                    4,
                    binding_payload.clone(),
                ),
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_TYPE_V4,
                    4,
                    binding_payload.clone(),
                ),
            ],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let Err(duplicate_error) = dispatch_command(&runtime, &duplicate_bind_batch) else {
            panic!("duplicate V4 bind unexpectedly succeeded");
        };
        assert_eq!(duplicate_error.0, "player-combat-bind-count");
        assert_eq!(runtime.identity(), initial);
        let mixed_version_bind_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "combat-bootstrap-mixed-version-bind".into(),
            idempotency_key: "combat-bootstrap-mixed-version-bind".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&initial),
            operations: vec![
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_TYPE_V4,
                    4,
                    binding_payload.clone(),
                ),
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_TYPE_V3,
                    3,
                    binding_payload.clone(),
                ),
            ],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let Err(mixed_version_error) = dispatch_command(&runtime, &mixed_version_bind_batch) else {
            panic!("mixed-version player binds unexpectedly succeeded");
        };
        assert_eq!(mixed_version_error.0, "player-combat-bind-count");
        assert_eq!(runtime.identity(), initial);
        assert!(runtime.player().is_none());
        assert!(runtime.gameplay().state.combat.combatants.is_empty());
        let operations = vec![
            domain_operation(
                RuntimeDomainV1::Entities,
                ENTITY_COMPATIBILITY_IMPORT_TYPE_V1,
                entity_payload.clone(),
            ),
            domain_operation_with_schema(
                RuntimeDomainV1::Simulation,
                SIMULATION_PLAYER_BIND_TYPE_V4,
                4,
                binding_payload.clone(),
            ),
            domain_operation(
                RuntimeDomainV1::Gameplay,
                PLAYER_INVENTORY_IMPORT_TYPE_V1,
                encode_player_inventory_import_v1(&inventory_request).unwrap(),
            ),
        ];
        let install_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "combat-bootstrap-install".into(),
            idempotency_key: "combat-bootstrap-install".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&initial),
            operations,
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (installed, receipts) = dispatch_command(&runtime, &install_batch).unwrap();
        assert_eq!(receipts.len(), 3);
        assert_eq!(receipts[1].type_id, SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V4);
        assert_eq!(receipts[1].schema, 4);
        assert_eq!(&receipts[1].payload[..4], b"BWF7");
        assert_eq!(&receipts[1].payload[6..22], &wire_checksum_v1(&binding_payload));
        assert_eq!(&receipts[1].payload[22..38], installed.state_hash().as_bytes());
        assert!(installed.gameplay().state.combat.abilities.is_empty());
        let combatant = &installed.gameplay().state.combat.combatants[&query.actor_id];
        assert_eq!((combatant.health, combatant.max_health), (9_500, 10_000));
        assert_eq!(combatant.entity_id, Some(blockwild_types::EntityId::new(17, 3)));
        assert_eq!(combatant.vital_units as u8, 1);

        let status_payload = encode_player_combat_bootstrap_status_query_v1(&query).unwrap();
        let status_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "combat-bootstrap-status".into(),
            idempotency_key: "combat-bootstrap-status".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&installed.identity()),
            operations: vec![domain_operation(
                RuntimeDomainV1::Simulation,
                PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1,
                status_payload,
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let (unchanged, status_receipts) = dispatch_command(&installed, &status_batch).unwrap();
        assert_eq!(unchanged.identity(), installed.identity());
        assert_eq!(
            status_receipts[0].type_id,
            PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1
        );
        let status = decode_player_combat_bootstrap_status_v1(&status_receipts[0].payload).unwrap();
        assert_eq!(
            status.status,
            blockwild_engine::PlayerCombatBootstrapStatusV1::ExactLinked
        );
        assert!(status.combatant.unwrap().cross_domain_parity);

        let mut invalid_slots = vec![None; 9];
        invalid_slots[0] = Some(ItemStack::simple(999, 1));
        let invalid_inventory = encode_player_inventory_import_v1(&PlayerInventoryImportWireV1 {
            import: ImportPlayerInventoryV1 {
                inventory: ContainerKey::player(query.actor_id.clone()),
                expected_revision: 0,
                slots: invalid_slots,
                metadata: Vec::new(),
            },
            selected_slot: 0,
        })
        .unwrap();
        let rollback_batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "combat-bootstrap-rollback".into(),
            idempotency_key: "combat-bootstrap-rollback".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&initial),
            operations: vec![
                domain_operation(
                    RuntimeDomainV1::Entities,
                    ENTITY_COMPATIBILITY_IMPORT_TYPE_V1,
                    entity_payload,
                ),
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_TYPE_V4,
                    4,
                    binding_payload,
                ),
                domain_operation(
                    RuntimeDomainV1::Gameplay,
                    PLAYER_INVENTORY_IMPORT_TYPE_V1,
                    invalid_inventory,
                ),
            ],
            command_hash: WireHash::default(),
        })
        .unwrap();
        assert!(dispatch_command(&runtime, &rollback_batch).is_err());
        assert_eq!(runtime.identity(), initial);
        assert!(runtime.entities().hot().is_empty());
        assert!(runtime.player().is_none());
        assert!(runtime.gameplay().state.combat.combatants.is_empty());
        let player_status = runtime
            .player_bootstrap_status(&query, CanonicalHash([0x94; 16]))
            .unwrap();
        assert!(player_status.entity.is_none());
        assert!(player_status.runtime_player.is_none());
        assert!(player_status.world_view_binding.is_none());
        assert!(player_status.custody.is_none());
        let absent = runtime
            .player_combat_bootstrap_status_v1(&query, CanonicalHash([0x95; 16]))
            .unwrap();
        assert_eq!(absent.status, blockwild_engine::PlayerCombatBootstrapStatusV1::Absent);
    }

    #[test]
    fn terrain_residency_command_generates_then_attests_an_idempotent_repeat() {
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            capabilities,
            ..
        } = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(101)).unwrap(),
        ))
        .unwrap()
        else {
            panic!("expected ready runtime")
        };
        assert!(capabilities.iter().any(|value| value == "terrain-residency-v1"));

        let request = blockwild_engine::IntegratedTerrainResidencyBatchV1 {
            expected_world_revision: WorldAuthorityRevisionV1 {
                epoch: identity.revision.epoch,
                mutation: 0,
                residency: 0,
            },
            generation_options_json: DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
            chunks: vec![blockwild_engine::IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 }],
        };
        let payload = blockwild_engine::encode_terrain_residency_batch_v1(&request).unwrap();
        let operation = RuntimeDomainOperationV1 {
            domain: RuntimeDomainV1::World,
            type_id: TERRAIN_RESIDENCY_BATCH_TYPE_V1.into(),
            schema: 1,
            payload_hash: WireHash(wire_checksum_v1(&payload)),
            payload,
        };
        let (generated_identity, receipt) =
            dispatch_single_operation(runtime_handle, 102, identity, "terrain-residency:generate", operation);
        assert_eq!(receipt.type_id, TERRAIN_RESIDENCY_RECEIPT_TYPE_V1);
        let generated = blockwild_engine::decode_terrain_residency_receipt_v1(&receipt.payload).unwrap();
        assert_eq!(generated.generated_chunks, 1);
        assert_eq!(generated.already_resident_chunks, 0);
        assert_eq!(generated.world_revision.residency, generated_identity.revision.world);

        let repeat_request = blockwild_engine::IntegratedTerrainResidencyBatchV1 {
            expected_world_revision: generated.world_revision,
            generation_options_json: DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
            chunks: vec![blockwild_engine::IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 }],
        };
        let payload = blockwild_engine::encode_terrain_residency_batch_v1(&repeat_request).unwrap();
        let operation = RuntimeDomainOperationV1 {
            domain: RuntimeDomainV1::World,
            type_id: TERRAIN_RESIDENCY_BATCH_TYPE_V1.into(),
            schema: 1,
            payload_hash: WireHash(wire_checksum_v1(&payload)),
            payload,
        };
        let (repeat_identity, receipt) = dispatch_single_operation(
            runtime_handle,
            103,
            generated_identity.clone(),
            "terrain-residency:repeat",
            operation,
        );
        let repeated = blockwild_engine::decode_terrain_residency_receipt_v1(&receipt.payload).unwrap();
        assert_eq!(repeated.generated_chunks, 0);
        assert_eq!(repeated.already_resident_chunks, 1);
        assert_eq!(repeat_identity, generated_identity);
    }

    #[test]
    fn terrain_residency_reconcile_command_replaces_the_exact_set() {
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            capabilities,
            ..
        } = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(104)).unwrap(),
        ))
        .unwrap()
        else {
            panic!("expected ready runtime")
        };
        assert!(
            capabilities
                .iter()
                .any(|value| value == "terrain-residency-reconcile-v2")
        );
        let first_request = blockwild_engine::IntegratedTerrainResidencyReconcileBatchV2 {
            expected_world_revision: WorldAuthorityRevisionV1 {
                epoch: identity.revision.epoch,
                mutation: 0,
                residency: 0,
            },
            generation_options_json: DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
            desired_chunks: vec![blockwild_engine::IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 }],
        };
        let payload = blockwild_engine::encode_terrain_residency_reconcile_batch_v2(&first_request).unwrap();
        let (first_identity, first_receipt) = dispatch_single_operation(
            runtime_handle,
            105,
            identity,
            "terrain-reconcile:first",
            domain_operation_with_schema(
                RuntimeDomainV1::World,
                TERRAIN_RESIDENCY_RECONCILE_BATCH_TYPE_V2,
                2,
                payload,
            ),
        );
        assert_eq!(first_receipt.type_id, TERRAIN_RESIDENCY_RECONCILE_RECEIPT_TYPE_V2);
        assert_eq!(first_receipt.schema, 2);
        let first = blockwild_engine::decode_terrain_residency_reconcile_receipt_v2(&first_receipt.payload).unwrap();
        assert_eq!(
            (
                first.generated_chunk_count,
                first.evicted_chunk_count,
                first.resident_sections
            ),
            (1, 0, 12)
        );
        assert_eq!(first.world_revision.residency, first_identity.revision.world);

        let second_request = blockwild_engine::IntegratedTerrainResidencyReconcileBatchV2 {
            expected_world_revision: first.world_revision,
            generation_options_json: DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
            desired_chunks: vec![blockwild_engine::IntegratedTerrainChunkCoordinateV1 {
                chunk_x: 10,
                chunk_z: -4,
            }],
        };
        let payload = blockwild_engine::encode_terrain_residency_reconcile_batch_v2(&second_request).unwrap();
        let (second_identity, second_receipt) = dispatch_single_operation(
            runtime_handle,
            106,
            first_identity,
            "terrain-reconcile:teleport",
            domain_operation_with_schema(
                RuntimeDomainV1::World,
                TERRAIN_RESIDENCY_RECONCILE_BATCH_TYPE_V2,
                2,
                payload,
            ),
        );
        let second = blockwild_engine::decode_terrain_residency_reconcile_receipt_v2(&second_receipt.payload).unwrap();
        assert_eq!(
            (
                second.generated_chunk_count,
                second.retained_chunk_count,
                second.evicted_chunk_count
            ),
            (1, 0, 1)
        );
        assert_eq!(second.desired_chunks, second_request.desired_chunks);
        assert_eq!(second.evicted_chunks, first_request.desired_chunks);
        assert_eq!(second.resident_sections, 12);
        assert_eq!(second.world_revision.residency, second_identity.revision.world);
    }

    #[test]
    fn terrain_reconcile_uses_outer_command_candidate_and_rolls_back_later_failure() {
        let RuntimeRequestV1::Create { config, .. } = create_request(107) else {
            unreachable!("fixture is a create request")
        };
        let runtime = create_runtime(config).unwrap();
        let before = runtime.identity();
        let reconcile = blockwild_engine::IntegratedTerrainResidencyReconcileBatchV2 {
            expected_world_revision: runtime.world().revision(),
            generation_options_json: DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
            desired_chunks: vec![blockwild_engine::IntegratedTerrainChunkCoordinateV1 { chunk_x: 0, chunk_z: 0 }],
        };
        let payload = blockwild_engine::encode_terrain_residency_reconcile_batch_v2(&reconcile).unwrap();
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "terrain-reconcile:rollback".into(),
            idempotency_key: "terrain-reconcile:rollback".into(),
            actor_id: "platform:test".into(),
            expected: wire_identity(&before),
            operations: vec![
                domain_operation_with_schema(
                    RuntimeDomainV1::World,
                    TERRAIN_RESIDENCY_RECONCILE_BATCH_TYPE_V2,
                    2,
                    payload,
                ),
                domain_operation(RuntimeDomainV1::World, "blockwild.world.unsupported.r4.v1", Vec::new()),
            ],
            command_hash: WireHash::default(),
        })
        .unwrap();
        assert!(dispatch_command(&runtime, &batch).is_err());
        assert_eq!(runtime.identity(), before);
        assert_eq!(runtime.world().resident_section_count(), 0);
    }

    #[test]
    fn checkpoint_export_destroy_restore_is_exact_and_corruption_fails_closed() {
        let created = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(11)).unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            ..
        } = created
        else {
            panic!("expected ready response")
        };
        let exported = decode_response_v1(&blockwild_runtime_export_save_v2(
            runtime_handle,
            &encode_request_v1(&RuntimeRequestV1::Checkpoint {
                request_id: 12,
                client_epoch: 1,
                expected: identity.clone(),
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Checkpoint {
            identity: checkpoint_identity,
            checkpoint,
            checkpoint_hash,
            ..
        } = exported
        else {
            panic!("expected checkpoint response: {exported:?}")
        };
        assert_eq!(checkpoint_identity, identity);
        let stopped = decode_response_v1(&blockwild_runtime_destroy_v2(
            runtime_handle,
            &encode_request_v1(&RuntimeRequestV1::Shutdown {
                request_id: 13,
                client_epoch: 1,
                expected: Some(identity.clone()),
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(stopped, RuntimeResponseV1::Shutdown { .. }));

        let restored = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&RuntimeRequestV1::Restore {
                request_id: 14,
                client_epoch: 1,
                expected_checkpoint_hash: checkpoint_hash,
                checkpoint: checkpoint.clone(),
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Restored {
            runtime_handle: restored_handle,
            identity: restored_identity,
            capabilities,
            ..
        } = restored
        else {
            panic!("expected restored response: {restored:?}")
        };
        assert_eq!(restored_identity, identity);
        assert!(capabilities.iter().any(|value| value == "native-save-hydration-v1"));

        let mut corrupt = checkpoint;
        let middle = corrupt.len() / 2;
        corrupt[middle] ^= 0x5a;
        let rejected = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&RuntimeRequestV1::Restore {
                request_id: 15,
                client_epoch: 1,
                expected_checkpoint_hash: checkpoint_hash,
                checkpoint: corrupt,
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Error { code, .. } = rejected else {
            panic!("corrupt checkpoint must reject")
        };
        assert_eq!(code, "checkpoint-hash");
        let cleanup = RuntimeRequestV1::Shutdown {
            request_id: 16,
            client_epoch: 1,
            expected: Some(restored_identity),
        };
        assert!(matches!(
            decode_response_v1(&blockwild_runtime_destroy_v2(
                restored_handle,
                &encode_request_v1(&cleanup).unwrap(),
            ))
            .unwrap(),
            RuntimeResponseV1::Shutdown { .. }
        ));
    }

    #[test]
    fn durable_command_receipt_recovers_exactly_on_a_fresh_handle_and_never_replays_misses() {
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity: before,
            ..
        } = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(180)).unwrap(),
        ))
        .unwrap()
        else {
            panic!("expected ready")
        };
        let mut record = EntityCompatibilityRecord::new("cache:entity", "cache:entity", "cache-test");
        record.class = EntityClass::Creature;
        let payload = encode_entity_command_batch_v1(&EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            commands: vec![EntityCommand::Spawn {
                record,
                residency: EntityResidency::Hot,
            }],
        })
        .unwrap();
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "cache-command".into(),
            idempotency_key: "cache-command".into(),
            actor_id: "cache-actor".into(),
            expected: before.clone(),
            operations: vec![domain_operation(
                RuntimeDomainV1::Entities,
                ENTITY_COMMAND_TYPE_V1,
                payload,
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let accepted_response = decode_response_v1(&blockwild_runtime_command_v2(
            runtime_handle,
            &encode_request_v1(&RuntimeRequestV1::Command {
                request_id: 181,
                client_epoch: 1,
                batch: batch.clone(),
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::CommandReceipt { receipt: accepted, .. } = accepted_response else {
            panic!("expected cached accepted receipt")
        };
        let RuntimeCommandReceiptV1::Accepted { after: terminal, .. } = &accepted else {
            panic!("expected cached accepted receipt")
        };
        let terminal = terminal.clone();
        let RuntimeResponseV1::Checkpoint {
            checkpoint,
            checkpoint_hash,
            ..
        } = decode_response_v1(&blockwild_runtime_export_save_v2(
            runtime_handle,
            &encode_request_v1(&RuntimeRequestV1::Checkpoint {
                request_id: 182,
                client_epoch: 1,
                expected: terminal.clone(),
            })
            .unwrap(),
        ))
        .unwrap()
        else {
            panic!("expected checkpoint")
        };
        assert!(matches!(
            decode_response_v1(&blockwild_runtime_destroy_v2(
                runtime_handle,
                &encode_request_v1(&RuntimeRequestV1::Shutdown {
                    request_id: 183,
                    client_epoch: 1,
                    expected: Some(terminal.clone()),
                })
                .unwrap(),
            ))
            .unwrap(),
            RuntimeResponseV1::Shutdown { .. }
        ));
        let RuntimeResponseV1::Restored {
            runtime_handle: restored_handle,
            identity: restored_identity,
            ..
        } = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&RuntimeRequestV1::Restore {
                request_id: 184,
                client_epoch: 2,
                expected_checkpoint_hash: checkpoint_hash,
                checkpoint,
            })
            .unwrap(),
        ))
        .unwrap()
        else {
            panic!("expected restored runtime")
        };
        assert_eq!(restored_identity, terminal);

        let exact = decode_response_v1(&blockwild_runtime_command_v2(
            restored_handle,
            &encode_request_v1(&RuntimeRequestV1::RecoverCommand {
                request_id: 185,
                client_epoch: 2,
                batch: batch.clone(),
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(
            exact,
            RuntimeResponseV1::CommandReceipt { receipt, .. } if receipt == accepted
        ));

        let mut miss_batch = batch.clone();
        miss_batch.command_id = "cache-miss".into();
        miss_batch.idempotency_key = "cache-miss".into();
        miss_batch.command_hash = WireHash::default();
        let miss_batch = seal_runtime_command_batch_v1(miss_batch).unwrap();
        let miss = decode_response_v1(&blockwild_runtime_command_v2(
            restored_handle,
            &encode_request_v1(&RuntimeRequestV1::RecoverCommand {
                request_id: 186,
                client_epoch: 2,
                batch: miss_batch,
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(
            miss,
            RuntimeResponseV1::Error { code, current: Some(current), .. }
                if code == "idempotency-recovery-miss" && current == restored_identity
        ));

        let mut conflict_batch = batch.clone();
        conflict_batch.command_id = "cache-conflict".into();
        conflict_batch.command_hash = WireHash::default();
        let conflict_batch = seal_runtime_command_batch_v1(conflict_batch).unwrap();
        let conflict = decode_response_v1(&blockwild_runtime_command_v2(
            restored_handle,
            &encode_request_v1(&RuntimeRequestV1::RecoverCommand {
                request_id: 187,
                client_epoch: 2,
                batch: conflict_batch,
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(
            conflict,
            RuntimeResponseV1::Error { code, current: Some(current), .. }
                if code == "idempotency-conflict" && current == restored_identity
        ));

        let queued = decode_response_v1(&blockwild_runtime_step_v2(
            restored_handle,
            &encode_request_v1(&RuntimeRequestV1::Step {
                request_id: 188,
                client_epoch: 2,
                expected: restored_identity.clone(),
                monotonic_time_us: 1_000_000,
                budget_us: 8_000,
                inputs: Vec::new(),
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::StepResult {
            identity: queued_identity,
            ..
        } = queued
        else {
            panic!("expected queued step")
        };
        let stepped = decode_response_v1(&blockwild_runtime_step_v2(
            restored_handle,
            &encode_request_v1(&RuntimeRequestV1::Step {
                request_id: 189,
                client_epoch: 2,
                expected: queued_identity,
                monotonic_time_us: 1_050_000,
                budget_us: 8_000,
                inputs: Vec::new(),
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::StepResult {
            identity: advanced_identity,
            ..
        } = stepped
        else {
            panic!("expected advanced step")
        };
        assert_ne!(advanced_identity, restored_identity);

        let ordinary_historical = decode_response_v1(&blockwild_runtime_command_v2(
            restored_handle,
            &encode_request_v1(&RuntimeRequestV1::Command {
                request_id: 190,
                client_epoch: 2,
                batch: batch.clone(),
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(
            ordinary_historical,
            RuntimeResponseV1::CommandReceipt { receipt, .. } if receipt == accepted
        ));
        let stale = decode_response_v1(&blockwild_runtime_command_v2(
            restored_handle,
            &encode_request_v1(&RuntimeRequestV1::RecoverCommand {
                request_id: 191,
                client_epoch: 2,
                batch,
            })
            .unwrap(),
        ))
        .unwrap();
        assert!(matches!(
            stale,
            RuntimeResponseV1::Error { code, current: Some(current), .. }
                if code == "idempotency-recovery-stale" && current == advanced_identity
        ));
    }

    #[test]
    fn wasm_new_world_initializes_a_native_only_save_without_legacy_bytes() {
        let created = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(160)).unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            ..
        } = created
        else {
            panic!("expected ready response")
        };
        let request = RuntimeBulkRequestV1::FinalizeSave {
            request_id: 161,
            client_epoch: 1,
            expected: RuntimeBulkStateV1::from(&identity),
            stage_id: "native-new-world".into(),
            created_at: 101,
        };
        let wire = encode_bulk_request_v1(&request).unwrap();
        let initialized = decode_bulk_response_v1(
            &blockwild_runtime_initialize_native_save_v2(runtime_handle, &wire.control),
            &[],
        )
        .unwrap();
        let RuntimeBulkResponseV1::SaveProgress {
            state,
            received_chunks,
            chunk_count,
            received_bytes,
            dispatcher_request_id,
            set_hash,
            manifest_hash,
            mut current,
            ..
        } = initialized
        else {
            panic!("expected native save progress: {initialized:?}")
        };
        assert_eq!(state, RuntimeBulkSaveStageStateV1::Finalized);
        assert_eq!(received_chunks, 0);
        assert_eq!(chunk_count, 0);
        assert_eq!(received_bytes, 0);
        assert_ne!(dispatcher_request_id, 0);

        for request_id in 162..180 {
            let poll = RuntimeBulkRequestV1::Poll {
                request_id,
                client_epoch: 1,
                expected: current.clone(),
                max_bytes: 128 * 1024 * 1024,
            };
            let wire = encode_bulk_request_v1(&poll).unwrap();
            let control = blockwild_runtime_bulk_v2(runtime_handle, &wire.control, &wire.attachment);
            let attachment_metadata = if control.len() >= 152 {
                u64::from_le_bytes(control[144..152].try_into().unwrap())
            } else {
                0
            };
            let attachment = if attachment_metadata == 0 {
                Vec::new()
            } else {
                blockwild_runtime_bulk_take_attachment_v2(runtime_handle, attachment_metadata as f64)
            };
            match decode_bulk_response_v1(&control, &attachment).unwrap() {
                RuntimeBulkResponseV1::Empty { current: idle, .. } => {
                    current = idle;
                    break;
                }
                RuntimeBulkResponseV1::PlatformRequest {
                    current: in_flight,
                    transfer_token,
                    payload,
                    ..
                } => {
                    let request = blockwild_persistence::decode_persistence_browser_request_v1(&payload).unwrap();
                    let blockwild_persistence::PersistenceBrowserRequestV1::Commit {
                        request_id: commit_request_id,
                        transaction,
                        checkpoint,
                    } = request
                    else {
                        panic!("expected native authority commit")
                    };
                    let response = blockwild_persistence::encode_persistence_browser_response_v1(
                        &blockwild_persistence::PersistenceBrowserResponseV1::Commit(
                            blockwild_persistence::PersistenceBrowserCommitResultV1 {
                                request_id: commit_request_id,
                                code: blockwild_persistence::PersistenceBrowserCommitCodeV1::Committed,
                                transaction_id: transaction.transaction_id,
                                journal_sequence: transaction.next_journal_sequence,
                                durable_hash: CanonicalHash([0x77; 16]),
                                checkpoint_hash: checkpoint.checkpoint_hash,
                                verified_readback: true,
                                message: "durable status fixture".into(),
                            },
                        ),
                    )
                    .unwrap();
                    let complete = RuntimeBulkRequestV1::Complete {
                        request_id: request_id + 100,
                        client_epoch: 1,
                        expected: in_flight,
                        transfer_token,
                        type_id: blockwild_runtime_wire::PERSISTENCE_RESPONSE_TYPE_V1.into(),
                        payload: response,
                    };
                    let wire = encode_bulk_request_v1(&complete).unwrap();
                    let response = decode_bulk_response_v1(
                        &blockwild_runtime_bulk_v2(runtime_handle, &wire.control, &wire.attachment),
                        &[],
                    )
                    .unwrap();
                    let RuntimeBulkResponseV1::Completed { current: completed, .. } = response else {
                        panic!("expected native commit completion: {response:?}")
                    };
                    current = completed;
                }
                response => panic!("unexpected native save drain response: {response:?}"),
            }
        }

        let before = INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let runtime = &store.runtimes[&runtime_handle];
            (
                wire_identity(&runtime.identity()),
                runtime.export_runtime_checkpoint().unwrap(),
                runtime.persistence_status().unwrap(),
            )
        });
        assert_eq!(RuntimeBulkStateV1::from(&before.0), current);
        let query = encode_runtime_persistence_status_query_v1().unwrap();
        let read_status = |request_id| {
            let request = RuntimeBulkRequestV1::PersistenceStatus {
                request_id,
                client_epoch: 1,
                expected: current.clone(),
                type_id: blockwild_runtime_wire::PERSISTENCE_STATUS_TYPE_V1.into(),
                payload: query.clone(),
            };
            let wire = encode_bulk_request_v1(&request).unwrap();
            decode_bulk_response_v1(
                &blockwild_runtime_bulk_v2(runtime_handle, &wire.control, &wire.attachment),
                &[],
            )
            .unwrap()
        };
        let first = read_status(190);
        let RuntimeBulkResponseV1::PersistenceStatus {
            current: first_current,
            type_id,
            payload: first_payload,
            ..
        } = first
        else {
            panic!("expected persistence status response: {first:?}")
        };
        assert_eq!(first_current, current);
        assert_eq!(type_id, PERSISTENCE_STATUS_RECEIPT_TYPE_V1);
        let attestation = decode_runtime_persistence_status_receipt_v1(&first_payload).unwrap();
        let terminal = attestation.terminal_checkpoint.unwrap();
        assert_eq!(terminal.save_set_hash, canonical_hash(set_hash));
        assert_eq!(terminal.manifest_hash, canonical_hash(manifest_hash));
        let second = read_status(191);
        let RuntimeBulkResponseV1::PersistenceStatus {
            current: second_current,
            payload: second_payload,
            ..
        } = second
        else {
            panic!("expected repeated persistence status response: {second:?}")
        };
        assert_eq!(second_current, current);
        assert_eq!(second_payload, first_payload);
        let after = INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let runtime = &store.runtimes[&runtime_handle];
            (
                wire_identity(&runtime.identity()),
                runtime.export_runtime_checkpoint().unwrap(),
                runtime.persistence_status().unwrap(),
            )
        });
        assert_eq!(after, before, "repeat status reads are exact and identity-neutral");
    }

    #[test]
    fn wasm_legacy_migration_is_world_only_staged_and_fail_closed_for_rich_saves() {
        let created = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(17)).unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            ..
        } = created
        else {
            panic!("expected ready response")
        };
        let source = br#"{"schema":6,"world":"legacy"}"#.to_vec();
        let staged_request = RuntimeBulkRequestV1::StageSaveChunk {
            request_id: 18,
            client_epoch: 1,
            expected: RuntimeBulkStateV1::from(&identity),
            stage_id: "legacy-wasm".into(),
            chunk_index: 0,
            chunk_count: 1,
            total_bytes: source.len() as u64,
            payload: source,
        };
        let staged_wire = encode_bulk_request_v1(&staged_request).unwrap();
        let staged = decode_bulk_response_v1(
            &blockwild_runtime_bulk_v2(runtime_handle, &staged_wire.control, &staged_wire.attachment),
            &[],
        )
        .unwrap();
        let RuntimeBulkResponseV1::SaveProgress { current, .. } = staged else {
            panic!("expected staged source: {staged:?}")
        };
        let finalize = RuntimeBulkRequestV1::FinalizeSave {
            request_id: 19,
            client_epoch: 1,
            expected: current.clone(),
            stage_id: "legacy-wasm".into(),
            created_at: 100,
        };
        let finalize_wire = encode_bulk_request_v1(&finalize).unwrap();
        let address = WorldAddressV1::new("1", "surface").unwrap();
        let authority = WorldAuthorityStoreR4V1::new(address, BlockCatalogV1::default()).unwrap();
        let projection = encode_compatibility_save_binary_v1(&authority.export_compatibility_save()).unwrap();

        let blocked = decode_bulk_response_v1(
            &blockwild_runtime_migrate_legacy_v2(
                runtime_handle,
                &finalize_wire.control,
                u32::from(LEGACY_STATE_PLAYER_V1),
                "blockwild-world-data-v1:test",
                "blockwild-world-save-canonical-v1",
                &projection,
            ),
            &[],
        )
        .unwrap();
        assert!(matches!(
            blocked,
            RuntimeBulkResponseV1::Error { code, current: Some(blocked_current), .. }
                if code == "legacy-migration-rich-save" && blocked_current == current
        ));

        let migrated = decode_bulk_response_v1(
            &blockwild_runtime_migrate_legacy_v2(
                runtime_handle,
                &finalize_wire.control,
                0,
                "blockwild-world-data-v1:test",
                "blockwild-world-save-canonical-v1",
                &projection,
            ),
            &[],
        )
        .unwrap();
        assert!(matches!(
            migrated,
            RuntimeBulkResponseV1::SaveProgress {
                state: RuntimeBulkSaveStageStateV1::Finalized,
                dispatcher_request_id: 1,
                ..
            }
        ));
    }

    #[test]
    fn nonempty_input_is_accepted_once_and_applied_at_its_target_tick() {
        let response = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(21)).unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            ..
        } = response
        else {
            panic!("expected ready")
        };
        let mut record = EntityCompatibilityRecord::new("player:wasm", "player:wasm", "player");
        record.class = EntityClass::Player;
        record.position = EntityVec3::new(8.0, 64.0, 8.0);
        record.health = 20.0;
        record.maximum_health = 20.0;
        let entity_payload = encode_entity_command_batch_v1(&EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            commands: vec![EntityCommand::Spawn {
                record,
                residency: EntityResidency::Hot,
            }],
        })
        .unwrap();
        let binding_payload = encode_runtime_player_binding_v1(&RuntimePlayerBindingWireV1 {
            external_entity_id: "player:wasm".into(),
            actor_id: "player:wasm".into(),
            player_id: blockwild_types::PlayerId::new(1, 1),
            creative_mode: true,
            radius: 0.35,
            standing_height: 1.8,
            crouching_height: 1.35,
            mass: 80.0,
            walk_speed: 4.3,
            sprint_speed: 6.2,
            creative_flight_speed: 8.0,
            maximum_oxygen_seconds: 15.0,
        })
        .unwrap();
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "wasm-player-install".into(),
            idempotency_key: "wasm-player-install".into(),
            actor_id: "platform:player".into(),
            expected: identity,
            operations: vec![
                domain_operation(RuntimeDomainV1::Entities, ENTITY_COMMAND_TYPE_V1, entity_payload),
                domain_operation_with_schema(
                    RuntimeDomainV1::Simulation,
                    SIMULATION_PLAYER_BIND_TYPE_V2,
                    2,
                    binding_payload,
                ),
            ],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let installed = decode_response_v1(&blockwild_runtime_command_v2(
            runtime_handle,
            &encode_request_v1(&RuntimeRequestV1::Command {
                request_id: 22,
                client_epoch: 1,
                batch,
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::CommandReceipt {
            receipt: RuntimeCommandReceiptV1::Accepted { after: identity, .. },
            ..
        } = installed
        else {
            panic!("expected player installation receipt")
        };
        let step = RuntimeRequestV1::Step {
            request_id: 23,
            client_epoch: 1,
            expected: identity.clone(),
            monotonic_time_us: 1_000_000,
            budget_us: 8_000,
            inputs: vec![RuntimeInputFrameV1 {
                sequence: 1,
                target_tick: identity.tick + 1,
                move_x: 1_000,
                ..RuntimeInputFrameV1::default()
            }],
        };
        let queued = decode_response_v1(&blockwild_runtime_step_v2(
            runtime_handle,
            &encode_request_v1(&step).unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::StepResult {
            identity: queued_identity,
            inputs_applied: 0,
            ..
        } = queued
        else {
            panic!("expected queued input step")
        };
        assert_ne!(queued_identity.state_hash, identity.state_hash);
        let apply = RuntimeRequestV1::Step {
            request_id: 24,
            client_epoch: 1,
            expected: queued_identity,
            monotonic_time_us: 1_050_000,
            budget_us: 8_000,
            inputs: vec![],
        };
        let applied = decode_response_v1(&blockwild_runtime_step_v2(
            runtime_handle,
            &encode_request_v1(&apply).unwrap(),
        ))
        .unwrap();
        assert!(
            matches!(
                &applied,
                RuntimeResponseV1::StepResult {
                    inputs_applied: 1,
                    fixed_steps: 1,
                    ..
                }
            ),
            "unexpected step response: {applied:?}"
        );
    }

    #[test]
    fn step_v2_exact_retry_is_transport_only_and_semantic_sequence_dispatches_once() {
        let source = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let checkpoint = source.export_runtime_checkpoint().unwrap();
        let checkpoint_hash = integrated_runtime_checkpoint_hash_v1(&checkpoint);
        let (handle, identity) = insert_test_runtime(source);
        let command = seal_context_command_v2(RuntimeContextCommandV2 {
            sequence: 1,
            target_tick: 1,
            action: RuntimeContextCommandActionV2::MountedAbility {
                mount_entity_id: u64::MAX,
                mount_entity_revision: 9,
                seat_index: 1,
                ability_slot: 2,
            },
            command_hash: WireHash::default(),
        })
        .unwrap();
        let queued_request = encode_step_request_v2(&RuntimeStepRequestV2 {
            request_id: 701,
            client_epoch: 91,
            expected: identity,
            monotonic_time_us: 1_000_000,
            budget_us: 8_000,
            inputs: vec![],
            context_commands: vec![command.clone()],
        })
        .unwrap();
        let queued_bytes = blockwild_runtime_step_v2(handle, &queued_request);
        let queued = decode_step_response_v2(&queued_bytes).unwrap();
        assert_eq!(queued.fixed_steps, 0);
        assert!(queued.semantic_receipts.is_empty());
        assert_eq!(blockwild_runtime_step_v2(handle, &queued_request), queued_bytes);
        let conflicting_retry = encode_step_request_v2(&RuntimeStepRequestV2 {
            request_id: 701,
            client_epoch: 91,
            expected: queued.identity.clone(),
            monotonic_time_us: 1_000_001,
            budget_us: 8_000,
            inputs: vec![],
            context_commands: vec![],
        })
        .unwrap();
        assert_eq!(
            response_error_code(decode_response_v1(&blockwild_runtime_step_v2(handle, &conflicting_retry)).unwrap()),
            "step-v2-request-conflict"
        );

        let duplicate_request = encode_step_request_v2(&RuntimeStepRequestV2 {
            request_id: 702,
            client_epoch: 91,
            expected: queued.identity.clone(),
            monotonic_time_us: 1_000_001,
            budget_us: 8_000,
            inputs: vec![],
            context_commands: vec![command],
        })
        .unwrap();
        assert_eq!(
            response_error_code(decode_response_v1(&blockwild_runtime_step_v2(handle, &duplicate_request)).unwrap()),
            "context-command-sequence"
        );

        let drain_request = encode_step_request_v2(&RuntimeStepRequestV2 {
            request_id: 703,
            client_epoch: 91,
            expected: queued.identity,
            monotonic_time_us: 1_050_000,
            budget_us: 8_000,
            inputs: vec![],
            context_commands: vec![],
        })
        .unwrap();
        let drained = decode_step_response_v2(&blockwild_runtime_step_v2(handle, &drain_request)).unwrap();
        assert_eq!(drained.fixed_steps, 1);
        assert_eq!(drained.semantic_receipts.len(), 1);
        assert_eq!(drained.semantic_receipts[0].command_sequence, 1);
        assert_eq!(
            drained.semantic_receipts[0].reason,
            RuntimeSemanticActionReasonV2::Blocked
        );
        assert_eq!(drained.semantic_receipts[0].resolved_entity, None);

        let later_request = encode_step_request_v2(&RuntimeStepRequestV2 {
            request_id: 704,
            client_epoch: 91,
            expected: drained.identity,
            monotonic_time_us: 1_100_000,
            budget_us: 8_000,
            inputs: vec![],
            context_commands: vec![],
        })
        .unwrap();
        let later = decode_step_response_v2(&blockwild_runtime_step_v2(handle, &later_request)).unwrap();
        assert!(later.semantic_receipts.is_empty());

        let shutdown = RuntimeRequestV1::Shutdown {
            request_id: 705,
            client_epoch: 91,
            expected: Some(later.identity),
        };
        assert!(matches!(
            decode_response_v1(&blockwild_runtime_destroy_v2(
                handle,
                &encode_request_v1(&shutdown).unwrap()
            ))
            .unwrap(),
            RuntimeResponseV1::Shutdown { .. }
        ));
        assert_eq!(
            response_error_code(decode_response_v1(&blockwild_runtime_step_v2(handle, &queued_request)).unwrap()),
            "invalid-handle",
            "destroyed handles must not replay a cached StepV2 success"
        );
        INTEGRATED_RUNTIMES.with(|store| store.borrow_mut().next_handle = handle.saturating_sub(1));
        let restored = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&RuntimeRequestV1::Restore {
                request_id: 706,
                client_epoch: 91,
                expected_checkpoint_hash: WireHash(checkpoint_hash.0),
                checkpoint,
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Restored {
            runtime_handle: reused_handle,
            identity: reused_identity,
            ..
        } = restored
        else {
            panic!("expected restored runtime: {restored:?}")
        };
        assert_eq!(reused_handle, handle);
        INTEGRATED_RUNTIMES.with(|store| {
            assert!(
                !store.borrow().step_v2_retries.contains_key(&(handle, 91, 701)),
                "fresh handle insertion must clear every prior-generation retry entry"
            );
        });
        let fresh_request = encode_step_request_v2(&RuntimeStepRequestV2 {
            request_id: 701,
            client_epoch: 91,
            expected: reused_identity,
            monotonic_time_us: 1_000_000,
            budget_us: 8_000,
            inputs: vec![],
            context_commands: vec![],
        })
        .unwrap();
        assert!(decode_step_response_v2(&blockwild_runtime_step_v2(reused_handle, &fresh_request)).is_ok());
    }

    #[test]
    fn step_v2_retry_cache_is_bounded_and_evicts_oldest_transport_receipt() {
        let mut store = IntegratedRuntimeStoreV2::default();
        for request_id in 1..=u32::try_from(MAX_STEP_V2_RETRY_RECEIPTS + 1).unwrap() {
            store.cache_step_v2_retry(
                (7, 9, request_id),
                WireHash([request_id as u8; 16]),
                request_id.to_le_bytes().to_vec(),
            );
        }
        assert_eq!(store.step_v2_retries.len(), MAX_STEP_V2_RETRY_RECEIPTS);
        assert_eq!(store.step_v2_retry_order.len(), MAX_STEP_V2_RETRY_RECEIPTS);
        assert!(!store.step_v2_retries.contains_key(&(7, 9, 1)));
        assert_eq!(store.step_v2_retry_order.front(), Some(&(7, 9, 2)));
        assert!(
            store
                .step_v2_retries
                .contains_key(&(7, 9, u32::try_from(MAX_STEP_V2_RETRY_RECEIPTS + 1).unwrap()))
        );
    }

    #[test]
    fn bulk_dispatcher_polls_and_completes_one_exact_platform_request() {
        let response = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(11)).unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            ..
        } = response
        else {
            panic!("expected ready")
        };
        let dispatch_payload = encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::Estimate {
            world_id: "world:wasm".into(),
        })
        .unwrap();
        let batch = seal_runtime_command_batch_v1(RuntimeCommandBatchV1 {
            command_id: "persistence-estimate".into(),
            idempotency_key: "persistence-estimate".into(),
            actor_id: "platform:persistence".into(),
            expected: identity,
            operations: vec![domain_operation(
                RuntimeDomainV1::Persistence,
                PERSISTENCE_DISPATCH_TYPE_V1,
                dispatch_payload,
            )],
            command_hash: WireHash::default(),
        })
        .unwrap();
        let dispatched = decode_response_v1(&blockwild_runtime_command_v2(
            runtime_handle,
            &encode_request_v1(&RuntimeRequestV1::Command {
                request_id: 12,
                client_epoch: 1,
                batch,
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::CommandReceipt {
            receipt: RuntimeCommandReceiptV1::Accepted { after: identity, .. },
            ..
        } = dispatched
        else {
            panic!("expected persistence dispatch receipt")
        };
        let poll = RuntimeBulkRequestV1::Poll {
            request_id: 12,
            client_epoch: 1,
            expected: RuntimeBulkStateV1::from(&identity),
            max_bytes: 8 * 1024 * 1024,
        };
        let encoded = encode_bulk_request_v1(&poll).unwrap();
        let control = blockwild_runtime_bulk_v2(runtime_handle, &encoded.control, &encoded.attachment);
        let transfer_token = u64::from_le_bytes(control[144..152].try_into().unwrap());
        let attachment = blockwild_runtime_bulk_take_attachment_v2(runtime_handle, transfer_token as f64);
        let platform = decode_bulk_response_v1(&control, &attachment).unwrap();
        let RuntimeBulkResponseV1::PlatformRequest { current, payload, .. } = platform else {
            panic!("expected dispatcher BWPR")
        };
        let request = blockwild_persistence::decode_persistence_platform_request_v1(&payload).unwrap();
        assert_eq!(
            request.operation,
            blockwild_persistence::PersistencePlatformOperationV1::Estimate
        );
        let response = blockwild_persistence::encode_persistence_platform_response_v1(
            &blockwild_persistence::PersistencePlatformResponseV1 {
                request_id: request.request_id,
                operation: request.operation,
                code: blockwild_persistence::PersistencePlatformResultCodeV1::Accepted,
                storage_revision: 7,
                durable_hash: CanonicalHash([9; 16]),
                next_cursor: None,
                payload: vec![],
                message: "estimated".into(),
            },
        )
        .unwrap();
        let complete = RuntimeBulkRequestV1::Complete {
            request_id: 13,
            client_epoch: 1,
            expected: current,
            transfer_token,
            type_id: blockwild_runtime_wire::PERSISTENCE_RESPONSE_TYPE_V1.into(),
            payload: response,
        };
        let encoded = encode_bulk_request_v1(&complete).unwrap();
        let control = blockwild_runtime_bulk_v2(runtime_handle, &encoded.control, &encoded.attachment);
        assert!(matches!(
            decode_bulk_response_v1(&control, &[]).unwrap(),
            RuntimeBulkResponseV1::Completed { transfer_token: completed, .. } if completed == transfer_token
        ));
    }

    #[test]
    fn bulk_dispatcher_preserves_oversized_poll_and_transfers_exact_packet_once() {
        const ONE_MIB: usize = 1024 * 1024;

        let response = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(111)).unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            ..
        } = response
        else {
            panic!("expected ready")
        };

        let world_id = "world:wasm-bulk-limit".to_string();
        let import_id = "import:wasm-bulk-limit".to_string();
        let empty_dispatch = encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::ImportChunk {
            world_id: world_id.clone(),
            import_id: import_id.clone(),
            offset: 0,
            total_bytes: 0,
            bytes: Vec::new(),
        })
        .unwrap();
        let chunk_len = blockwild_runtime_wire::MAX_DOMAIN_PAYLOAD_BYTES
            .checked_sub(empty_dispatch.len())
            .unwrap();
        let chunk = vec![0xa7; chunk_len];
        let dispatch_payload = encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::ImportChunk {
            world_id: world_id.clone(),
            import_id: import_id.clone(),
            offset: 0,
            total_bytes: chunk_len as u64,
            bytes: chunk.clone(),
        })
        .unwrap();
        assert_eq!(dispatch_payload.len(), blockwild_runtime_wire::MAX_DOMAIN_PAYLOAD_BYTES);

        let (queued_identity, receipt) = dispatch_single_operation(
            runtime_handle,
            112,
            identity,
            "persistence-import-near-bulk-limit",
            domain_operation(
                RuntimeDomainV1::Persistence,
                PERSISTENCE_DISPATCH_TYPE_V1,
                dispatch_payload,
            ),
        );
        assert_eq!(receipt.type_id, PERSISTENCE_DISPATCH_RECEIPT_TYPE_V1);
        let dispatch_receipt =
            blockwild_engine::decode_runtime_persistence_dispatch_receipt_v1(&receipt.payload).unwrap();
        let dispatcher_request_id = dispatch_receipt.request_id.unwrap();
        let expected_request = blockwild_persistence::PersistencePlatformRequestV1::chunk(
            dispatcher_request_id,
            blockwild_persistence::PersistencePlatformOperationV1::ImportChunk,
            &world_id,
            &import_id,
            0,
            chunk_len as u64,
            chunk,
        )
        .unwrap();
        let expected_packet = blockwild_persistence::encode_persistence_platform_request_v1(&expected_request).unwrap();
        let encoded_len = expected_packet.len();
        assert!(encoded_len > ONE_MIB);
        assert!(encoded_len < 4 * ONE_MIB);
        assert_eq!(dispatch_receipt.persistence_revision, 0);
        assert_eq!(dispatch_receipt.pending, 1);
        assert_eq!(dispatch_receipt.queued_bytes, encoded_len as u64);
        assert!(!dispatch_receipt.closed);

        let before = INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let runtime = &store.runtimes[&runtime_handle];
            (
                wire_identity(&runtime.identity()),
                runtime.persistence_dispatcher().diagnostics(),
                runtime.persistence_dispatcher_checkpoint(),
            )
        });
        assert_eq!(before.0, queued_identity);
        assert_eq!(before.1.persistence_revision, 0);
        assert_eq!(before.1.queued, 1);
        assert_eq!(before.1.in_flight, 0);
        assert_eq!(before.1.retryable, 0);
        assert_eq!(before.1.queued_bytes, encoded_len);
        assert_eq!(before.1.completed_receipts, 0);
        assert!(!before.1.closed);
        assert_eq!(before.1.state_hash, dispatch_receipt.state_hash);

        let limited_poll = RuntimeBulkRequestV1::Poll {
            request_id: 113,
            client_epoch: 1,
            expected: RuntimeBulkStateV1::from(&before.0),
            max_bytes: ONE_MIB as u32,
        };
        let limited_wire = encode_bulk_request_v1(&limited_poll).unwrap();
        let limited = decode_bulk_response_v1(
            &blockwild_runtime_bulk_v2(runtime_handle, &limited_wire.control, &limited_wire.attachment),
            &[],
        )
        .unwrap();
        let RuntimeBulkResponseV1::Error {
            request_id,
            client_epoch,
            worker_epoch,
            code,
            message,
            current: Some(error_current),
        } = limited
        else {
            panic!("expected bounded poll error: {limited:?}")
        };
        assert_eq!((request_id, client_epoch, worker_epoch), (113, 1, WORKER_EPOCH));
        assert_eq!(code, "persistence-dispatch-error");
        assert_eq!(
            message,
            format!("dispatch-packet-too-large: next BWPR requires {encoded_len} bytes")
        );
        assert_eq!(error_current, RuntimeBulkStateV1::from(&before.0));
        let after_limited = INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let runtime = &store.runtimes[&runtime_handle];
            (
                wire_identity(&runtime.identity()),
                runtime.persistence_dispatcher().diagnostics(),
                runtime.persistence_dispatcher_checkpoint(),
            )
        });
        assert_eq!(
            after_limited, before,
            "undersized poll must be byte-exactly non-mutating"
        );

        let exact_poll = RuntimeBulkRequestV1::Poll {
            request_id: 114,
            client_epoch: 1,
            expected: RuntimeBulkStateV1::from(&before.0),
            max_bytes: u32::try_from(encoded_len).unwrap(),
        };
        let exact_wire = encode_bulk_request_v1(&exact_poll).unwrap();
        let control = blockwild_runtime_bulk_v2(runtime_handle, &exact_wire.control, &exact_wire.attachment);
        let attachment_token = u64::from_le_bytes(control[144..152].try_into().unwrap());
        let attachment = blockwild_runtime_bulk_take_attachment_v2(runtime_handle, attachment_token as f64);
        assert_eq!(attachment, expected_packet);
        let platform = decode_bulk_response_v1(&control, &attachment).unwrap();
        let RuntimeBulkResponseV1::PlatformRequest {
            request_id,
            client_epoch,
            worker_epoch,
            current,
            transfer_token,
            type_id,
            payload,
        } = platform
        else {
            panic!("expected exact near-limit dispatcher BWPR: {platform:?}")
        };
        assert_eq!((request_id, client_epoch, worker_epoch), (114, 1, WORKER_EPOCH));
        assert_eq!(transfer_token, attachment_token);
        assert_eq!(type_id, PERSISTENCE_REQUEST_TYPE_V1);
        assert_eq!(payload, expected_packet);
        assert_eq!(
            blockwild_persistence::decode_persistence_platform_request_v1(&payload).unwrap(),
            expected_request
        );

        let after_transfer = INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let runtime = &store.runtimes[&runtime_handle];
            (
                wire_identity(&runtime.identity()),
                runtime.persistence_dispatcher().diagnostics(),
            )
        });
        assert_eq!(current, RuntimeBulkStateV1::from(&after_transfer.0));
        assert_eq!(after_transfer.0.universe_id, before.0.universe_id);
        assert_eq!(after_transfer.0.location_id, before.0.location_id);
        assert_eq!(after_transfer.0.revision, before.0.revision);
        assert_eq!(after_transfer.0.tick, before.0.tick);
        assert_ne!(after_transfer.0.state_hash, before.0.state_hash);
        assert_eq!(after_transfer.1.persistence_revision, before.1.persistence_revision);
        assert_eq!(after_transfer.1.queued, 0);
        assert_eq!(after_transfer.1.in_flight, 1);
        assert_eq!(after_transfer.1.retryable, before.1.retryable);
        assert_eq!(after_transfer.1.queued_bytes, before.1.queued_bytes);
        assert_eq!(after_transfer.1.completed_receipts, before.1.completed_receipts);
        assert_eq!(after_transfer.1.closed, before.1.closed);
        assert_ne!(after_transfer.1.state_hash, before.1.state_hash);

        let empty_poll = RuntimeBulkRequestV1::Poll {
            request_id: 115,
            client_epoch: 1,
            expected: current.clone(),
            max_bytes: u32::try_from(encoded_len).unwrap(),
        };
        let empty_wire = encode_bulk_request_v1(&empty_poll).unwrap();
        let empty = decode_bulk_response_v1(
            &blockwild_runtime_bulk_v2(runtime_handle, &empty_wire.control, &empty_wire.attachment),
            &[],
        )
        .unwrap();
        let RuntimeBulkResponseV1::Empty {
            request_id,
            client_epoch,
            worker_epoch,
            current: empty_current,
        } = empty
        else {
            panic!("expected empty poll after exact transfer: {empty:?}")
        };
        assert_eq!((request_id, client_epoch, worker_epoch), (115, 1, WORKER_EPOCH));
        assert_eq!(empty_current, current);
        assert!(blockwild_runtime_bulk_take_attachment_v2(runtime_handle, transfer_token as f64).is_empty());
        let after_empty = INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let runtime = &store.runtimes[&runtime_handle];
            (
                wire_identity(&runtime.identity()),
                runtime.persistence_dispatcher().diagnostics(),
            )
        });
        assert_eq!(
            after_empty, after_transfer,
            "the exact BWPR remains in flight and is not reissued"
        );
    }

    #[test]
    fn bulk_save_stage_is_idempotent_conflict_safe_and_stale_closed() {
        let response = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(71)).unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            capabilities,
            ..
        } = response
        else {
            panic!("expected ready")
        };
        assert!(capabilities.iter().any(|value| value == "native-save-hydration-v1"));
        assert!(
            !capabilities
                .iter()
                .any(|value| value == "native-save-hydration-v1-pending-r6-r7-records")
        );

        let stage = |request_id, expected, payload: Vec<u8>| RuntimeBulkRequestV1::StageSaveChunk {
            request_id,
            client_epoch: 1,
            expected,
            stage_id: "sävë-一-🌿".into(),
            chunk_index: 0,
            chunk_count: 1,
            total_bytes: 4,
            payload,
        };
        let call = |request: RuntimeBulkRequestV1| {
            let encoded = encode_bulk_request_v1(&request).unwrap();
            let control = blockwild_runtime_bulk_v2(runtime_handle, &encoded.control, &encoded.attachment);
            decode_bulk_response_v1(&control, &[]).unwrap()
        };
        let original = RuntimeBulkStateV1::from(&identity);
        let staged = call(stage(72, original.clone(), vec![0, 0x80, 0xff, 0x7f]));
        let RuntimeBulkResponseV1::SaveProgress {
            current,
            state: RuntimeBulkSaveStageStateV1::Staged,
            received_chunks: 1,
            ..
        } = staged
        else {
            panic!("expected staged receipt")
        };
        assert_ne!(current.state_hash, original.state_hash);

        let duplicate = call(stage(73, current.clone(), vec![0, 0x80, 0xff, 0x7f]));
        assert!(matches!(
            duplicate,
            RuntimeBulkResponseV1::SaveProgress { current: duplicate_current, .. }
                if duplicate_current == current
        ));
        let conflict = call(stage(74, current.clone(), vec![0, 0x80, 0xfe, 0x7f]));
        assert!(matches!(
            conflict,
            RuntimeBulkResponseV1::Error { code, current: Some(error_current), .. }
                if code == "save-stage-conflict" && error_current == current
        ));
        let stale = call(RuntimeBulkRequestV1::FinalizeSave {
            request_id: 75,
            client_epoch: 1,
            expected: original,
            stage_id: "sävë-一-🌿".into(),
            created_at: 9,
        });
        assert!(matches!(
            stale,
            RuntimeBulkResponseV1::Error { code, .. } if code == "stale-runtime"
        ));
        let cancelled = call(RuntimeBulkRequestV1::CancelSaveStage {
            request_id: 76,
            client_epoch: 1,
            expected: current,
            stage_id: "sävë-一-🌿".into(),
        });
        let RuntimeBulkResponseV1::SaveProgress {
            current,
            state: RuntimeBulkSaveStageStateV1::Cancelled,
            ..
        } = cancelled
        else {
            panic!("expected cancellation receipt")
        };
        let unavailable = call(RuntimeBulkRequestV1::HydrateRecovery {
            request_id: 77,
            client_epoch: 1,
            expected: current,
            recovery_id: "missing".into(),
        });
        assert!(matches!(
            unavailable,
            RuntimeBulkResponseV1::Error { code, .. } if code == "recovery-incomplete"
        ));
    }

    #[test]
    fn bulk_attachment_store_rejects_live_token_reuse_and_unconsumed_backlog() {
        let handle = 44;
        let current = RuntimeBulkStateV1 {
            revision: RuntimeRevisionV1::default(),
            tick: 1,
            state_hash: WireHash([1; 16]),
        };
        let platform_response = |request_id, transfer_token| RuntimeBulkResponseV1::PlatformRequest {
            request_id,
            client_epoch: 1,
            worker_epoch: WORKER_EPOCH,
            current: current.clone(),
            transfer_token,
            type_id: blockwild_runtime_wire::PERSISTENCE_REQUEST_TYPE_V1.into(),
            payload: vec![0x80, 0xff],
        };
        let mut attachments = BTreeMap::new();
        attachments.insert((handle, 1), vec![1]);

        let duplicate = encode_bulk_control(handle, platform_response(31, 1), &mut attachments);
        assert!(matches!(
            decode_bulk_response_v1(&duplicate, &[]).unwrap(),
            RuntimeBulkResponseV1::Error { code, .. } if code == "bulk-attachment-collision"
        ));
        assert_eq!(attachments.get(&(handle, 1)).map(Vec::as_slice), Some([1].as_slice()));

        attachments.insert((handle, 2), vec![2]);
        let over_capacity = encode_bulk_control(handle, platform_response(32, 3), &mut attachments);
        assert!(matches!(
            decode_bulk_response_v1(&over_capacity, &[]).unwrap(),
            RuntimeBulkResponseV1::Error { code, .. } if code == "bulk-attachment-capacity"
        ));
        assert_eq!(attachments.len(), RUNTIME_BULK_MAX_PENDING_V1);

        let mut hydrated = BTreeMap::new();
        let data = RuntimeBulkResponseV1::Data {
            request_id: 33,
            client_epoch: 1,
            worker_epoch: WORKER_EPOCH,
            current,
            transfer_token: 44,
            type_id: PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1.into(),
            chunk_index: 0,
            chunk_count: 1,
            payload: vec![0x80, 0xff],
        };
        let control = encode_bulk_control(handle, data, &mut hydrated);
        assert_eq!(hydrated.remove(&(handle, 44)), Some(vec![0x80, 0xff]));
        assert!(matches!(
            decode_bulk_response_v1(&control, &[0x80, 0xff]).unwrap(),
            RuntimeBulkResponseV1::Data { transfer_token: 44, .. }
        ));
    }

    #[test]
    fn historical_special_export_response_round_trips_and_retains_exact_attachment() {
        let runtime = checked_r9_fixture_runtime("historical-wire-response");
        let receipt = IntegratedRuntimeHistoricalExternalReceiptV2 {
            operation: IntegratedRuntimeHistoricalExternalOperationV2::InitialMigration,
            stage_id: Some("historical-stage".into()),
            recovery_id: None,
            created_at: 11,
            external_state_flags: 1,
            descriptor_hash: CanonicalHash([1; 16]),
            external_document_hash: CanonicalHash([2; 16]),
            external_document_byte_length: 1,
            external_document_revision: 1,
            external_chunk_count: 1,
            external_chunk_set_hash: CanonicalHash([3; 16]),
            projection_hash: CanonicalHash([4; 16]),
            projection_byte_length: 1,
            native_world_semantic_hash: CanonicalHash([5; 16]),
            native_world_edit_count: 1,
            native_world_facing_count: 1,
            save_set_hash: CanonicalHash([6; 16]),
            manifest_hash: CanonicalHash([7; 16]),
            dispatcher_request_id: Some(1),
            remaining_dirty_records: 1,
            reconciliation: None,
        };
        let response = historical_external_data_response_v2(41, 2, 77, &receipt, &runtime).unwrap();
        let mut attachments = BTreeMap::new();
        let control = encode_bulk_control(9, response, &mut attachments);
        let attachment = attachments.remove(&(9, 77)).expect("historical attachment retained");
        assert!((64..=16 * 1024).contains(&control.len()));
        assert!(!attachment.is_empty());
        assert_eq!(&attachment[..4], b"BWHR");
        let RuntimeBulkResponseV1::Data {
            type_id,
            transfer_token,
            chunk_index,
            chunk_count,
            payload,
            ..
        } = decode_bulk_response_v1(&control, &attachment).expect("historical response wire round trip")
        else {
            panic!("historical special export must return data")
        };
        assert_eq!(type_id, PERSISTENCE_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2);
        assert_eq!(transfer_token, 77);
        assert_eq!((chunk_index, chunk_count), (0, 1));
        assert_eq!(payload, attachment);
    }

    #[test]
    fn public_historical_special_export_apis_use_bounded_error_controls() {
        let make_runtime = |session_id: &str| {
            let runtime = checked_r9_fixture_runtime(session_id);
            insert_test_runtime(runtime)
        };
        let (migrate_handle, migrate_identity) = make_runtime("historical-public-migrate");
        let (finalize_handle, finalize_identity) = make_runtime("historical-public-finalize");
        let (hydrate_handle, hydrate_identity) = make_runtime("historical-public-hydrate");
        let (reconcile_handle, reconcile_identity) = make_runtime("historical-public-reconcile");
        let finalize_request = |request_id: u32, expected: RuntimeIdentityV1| {
            encode_bulk_request_v1(&RuntimeBulkRequestV1::FinalizeSave {
                request_id,
                client_epoch: 1,
                expected: RuntimeBulkStateV1::from(&expected),
                stage_id: "missing-stage".into(),
                created_at: 1,
            })
            .unwrap()
            .control
        };
        let hydrate_request = |request_id: u32, expected: RuntimeIdentityV1| {
            encode_bulk_request_v1(&RuntimeBulkRequestV1::HydrateRecovery {
                request_id,
                client_epoch: 1,
                expected: RuntimeBulkStateV1::from(&expected),
                recovery_id: "missing-recovery".into(),
            })
            .unwrap()
            .control
        };
        let assert_error = |control: Vec<u8>| {
            assert!((64..=16 * 1024).contains(&control.len()));
            assert!(matches!(
                decode_bulk_response_v1(&control, &[]).expect("bounded public historical error"),
                RuntimeBulkResponseV1::Error { .. }
            ));
        };
        assert_error(blockwild_runtime_migrate_historical_external_v2(
            migrate_handle,
            &finalize_request(101, migrate_identity),
            b"invalid-proposal",
            b"invalid-projection",
        ));
        assert_error(blockwild_runtime_finalize_historical_external_save_v2(
            finalize_handle,
            &finalize_request(102, finalize_identity),
            b"invalid-proposal",
            b"invalid-checkpoint",
        ));
        assert_error(blockwild_runtime_hydrate_historical_external_v2(
            hydrate_handle,
            &hydrate_request(103, hydrate_identity),
        ));
        assert_error(blockwild_runtime_reconcile_historical_external_fallback_v2(
            reconcile_handle,
            &finalize_request(104, reconcile_identity),
            b"invalid-observation",
        ));
    }

    #[test]
    fn historical_special_export_encode_failure_is_structured_atomic_and_attachment_free() {
        let mut runtime = checked_r9_fixture_runtime("historical-wire-atomicity");
        let identity_before = runtime.identity();
        let checkpoint_before = runtime.export_runtime_checkpoint().expect("baseline checkpoint");
        let mut attachments = BTreeMap::new();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            encode_historical_external_operation(10, &mut runtime, &mut attachments, 42, 2, 77, |candidate| {
                candidate
                    .stage_compatibility_save_chunk("atomic-stage", 0, 1, 1, &[1])
                    .map(|_| IntegratedRuntimeHistoricalExternalReceiptV2 {
                        operation: IntegratedRuntimeHistoricalExternalOperationV2::InitialMigration,
                        stage_id: None,
                        recovery_id: None,
                        created_at: 11,
                        external_state_flags: 1,
                        descriptor_hash: CanonicalHash([1; 16]),
                        external_document_hash: CanonicalHash([2; 16]),
                        external_document_byte_length: 1,
                        external_document_revision: 1,
                        external_chunk_count: 1,
                        external_chunk_set_hash: CanonicalHash([3; 16]),
                        projection_hash: CanonicalHash([4; 16]),
                        projection_byte_length: 1,
                        native_world_semantic_hash: CanonicalHash([5; 16]),
                        native_world_edit_count: 1,
                        native_world_facing_count: 1,
                        save_set_hash: CanonicalHash([6; 16]),
                        manifest_hash: CanonicalHash([7; 16]),
                        dispatcher_request_id: Some(1),
                        remaining_dirty_records: 1,
                        reconciliation: None,
                    })
            })
        }));
        assert!(result.is_ok(), "forced wire failure must not panic");
        let control = result.unwrap();
        assert!(!control.is_empty());
        assert!(matches!(
            decode_bulk_response_v1(&control, &[]).expect("structured encode error"),
            RuntimeBulkResponseV1::Error { code, .. } if code == "bulk-encode"
        ));
        assert_eq!(runtime.identity(), identity_before);
        assert_eq!(
            runtime.export_runtime_checkpoint().expect("post-failure checkpoint"),
            checkpoint_before
        );
        assert!(attachments.is_empty(), "failed response must not retain attachment");
    }

    #[test]
    fn authority_snapshot_and_compatibility_operations_round_trip_through_wasm() {
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            ..
        } = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(81)).unwrap(),
        ))
        .unwrap()
        else {
            panic!("expected source runtime")
        };
        let mut record = EntityCompatibilityRecord::new("creature:\u{6c34}", "specimen:\u{1f40b}", "tide-whale");
        record.custom.insert("opaque".into(), "\u{6c34}\u{ff}".into());
        record.research.insert("ecology".into(), 4);
        let spawn = encode_entity_command_batch_v1(&EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            commands: vec![EntityCommand::Spawn {
                record: record.clone(),
                residency: EntityResidency::Cold,
            }],
        })
        .unwrap();
        let (identity, spawn_receipt) = dispatch_single_operation(
            runtime_handle,
            82,
            identity,
            "snapshot-source-spawn",
            domain_operation(RuntimeDomainV1::Entities, ENTITY_COMMAND_TYPE_V1, spawn),
        );
        let events = decode_entity_event_batch_v1(&spawn_receipt.payload).unwrap();
        let event = events.events.first().unwrap();

        let export = encode_entity_authority_export_v1(EntityAuthorityExportWireV1 {
            expected_revision: identity.revision.entities,
        })
        .unwrap();
        let (identity, snapshot_receipt) = dispatch_single_operation(
            runtime_handle,
            83,
            identity,
            "snapshot-export",
            domain_operation(RuntimeDomainV1::Entities, ENTITY_AUTHORITY_EXPORT_TYPE_V1, export),
        );
        assert_eq!(snapshot_receipt.type_id, ENTITY_AUTHORITY_SNAPSHOT_TYPE_V2);
        assert_eq!(&snapshot_receipt.payload[..4], b"BWEA");

        let compatibility = encode_entity_compatibility_export_v1(EntityCompatibilityExportWireV1 {
            entity_id: event.entity_id,
            expected_entity_revision: event.entity_revision,
        })
        .unwrap();
        let (_, compatibility_receipt) = dispatch_single_operation(
            runtime_handle,
            84,
            identity,
            "compatibility-export",
            domain_operation(
                RuntimeDomainV1::Entities,
                ENTITY_COMPATIBILITY_EXPORT_TYPE_V1,
                compatibility,
            ),
        );
        assert_eq!(compatibility_receipt.type_id, ENTITY_COMPATIBILITY_RECORD_TYPE_V1);
        assert_eq!(
            blockwild_entity::decode_compatibility_record(&compatibility_receipt.payload).unwrap(),
            record
        );

        let RuntimeResponseV1::Ready {
            runtime_handle: restored_handle,
            identity: restored_identity,
            ..
        } = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(85)).unwrap(),
        ))
        .unwrap()
        else {
            panic!("expected restore runtime")
        };
        let import = encode_entity_authority_import_v2(&EntityAuthorityImportWireV2 {
            expected_revision: 0,
            snapshot: snapshot_receipt.payload,
        })
        .unwrap();
        let (restored_identity, import_receipt) = dispatch_single_operation(
            restored_handle,
            86,
            restored_identity,
            "snapshot-import",
            domain_operation(RuntimeDomainV1::Entities, ENTITY_AUTHORITY_IMPORT_TYPE_V2, import),
        );
        assert_eq!(import_receipt.type_id, ENTITY_AUTHORITY_IMPORT_RECEIPT_TYPE_V1);
        let imported = decode_entity_authority_import_receipt_v1(&import_receipt.payload).unwrap();
        assert_eq!(imported.entity_count, 1);
        assert_eq!(imported.revision, restored_identity.revision.entities);

        let RuntimeResponseV1::Ready {
            runtime_handle: compatibility_handle,
            identity: compatibility_identity,
            ..
        } = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(87)).unwrap(),
        ))
        .unwrap()
        else {
            panic!("expected compatibility runtime")
        };
        let import = encode_entity_compatibility_import_v1(&EntityCompatibilityImportWireV1 {
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            desired_id: None,
            residency: EntityResidency::Hot,
            record,
        })
        .unwrap();
        let (compatibility_identity, import_receipt) = dispatch_single_operation(
            compatibility_handle,
            88,
            compatibility_identity,
            "compatibility-import",
            domain_operation(RuntimeDomainV1::Entities, ENTITY_COMPATIBILITY_IMPORT_TYPE_V1, import),
        );
        assert_eq!(import_receipt.type_id, ENTITY_RECEIPT_TYPE_V1);
        let events = decode_entity_event_batch_v1(&import_receipt.payload).unwrap();
        assert_eq!(events.events.len(), 1);
        assert_eq!(events.revision, compatibility_identity.revision.entities);
    }

    #[test]
    fn entity_extraction_v3_carries_complete_renderer_authority() {
        let RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            ..
        } = decode_response_v1(&blockwild_runtime_create_v2(
            &encode_request_v1(&create_request(91)).unwrap(),
        ))
        .unwrap()
        else {
            panic!("expected extraction runtime")
        };
        let mut record = EntityCompatibilityRecord::new("creature:render", "specimen:render", "asterjaw");
        record.position = EntityVec3::new(1.5, 2.5, 3.5);
        record.yaw = 0.75;
        record.velocity = EntityVec3::new(4.5, 5.5, 6.5);
        record.health = 7.5;
        record.maximum_health = 8.5;
        record.age_ticks = 99;
        record.tamed = true;
        record.variant_key = Some("glasswake".into());
        record.name = Some("Mizu \u{6c34}".into());
        record.custom.insert("modelKey".into(), "model:asterjaw".into());
        record.research.insert("care".into(), 3);
        record.equipment.insert("saddle".into(), "item:saddle".into());
        let mut components = EntityComponents::from_compatibility(
            &record,
            blockwild_entity::ProtectionState::from_bits(blockwild_entity::ProtectionState::TAMED),
        );
        components.locomotion.movement_mode = blockwild_entity::MovementMode::Swim;
        components.locomotion.grounded = false;
        components.locomotion.submerged = true;
        components.vitals.last_damage_tick = 71;
        components.locomotion.action = ActionState {
            key: "breach".into(),
            phase: 2,
            started_tick: 70,
            ends_tick: 110,
            target: Some(blockwild_types::EntityId::new(9, 1)),
        };
        components.equipment.insert(
            "saddle".into(),
            EquipmentSlotState {
                item_key: "item:saddle".into(),
                count: 1,
                durability: 42,
                custom: BTreeMap::from([("dye".into(), vec![0x80, 0xff])]),
            },
        );
        components.mount.parent_mount = Some(blockwild_types::EntityId::new(8, 1));
        components.mount.occupied_seat = Some(1);
        components.mount.accepts_riders = true;
        components.mount.saddle_key = Some("item:saddle".into());
        components.mount.seats = vec![MountSeat {
            index: 1,
            role: "rider".into(),
            offset: EntityVec3::new(0.0, 1.25, -0.5),
            occupant: Some(blockwild_types::EntityId::new(7, 1)),
            control_weight_milli: 1_000,
        }];
        let spawn = encode_entity_command_batch_v1(&EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            commands: vec![EntityCommand::SpawnTyped {
                record,
                components,
                residency: EntityResidency::Hot,
            }],
        })
        .unwrap();
        let (identity, receipt) = dispatch_single_operation(
            runtime_handle,
            92,
            identity,
            "extraction-spawn",
            domain_operation(RuntimeDomainV1::Entities, ENTITY_COMMAND_TYPE_V1, spawn),
        );
        let entity_event = decode_entity_event_batch_v1(&receipt.payload).unwrap();
        let event = entity_event.events.first().unwrap();
        let extracted = decode_response_v1(&blockwild_runtime_extract_v2(
            runtime_handle,
            &encode_request_v1(&RuntimeRequestV1::Extract {
                request_id: 93,
                client_epoch: 1,
                expected: identity,
                after_revision: 0,
                max_bytes: 1024 * 1024,
            })
            .unwrap(),
        ))
        .unwrap();
        let RuntimeResponseV1::Extraction { extraction, .. } = extracted else {
            panic!("expected extraction response")
        };
        assert!(extraction.render.len() <= MAX_ENTITY_EXTRACTION_BYTES_V3);
        let mut reader = ExtractionReader::new(&extraction.render);
        assert_eq!(reader.take(4), b"BWR6");
        assert_eq!(reader.u16(), ENTITY_EXTRACTION_SCHEMA_V3);
        assert_eq!(reader.u64(), extraction.extraction_revision);
        assert_eq!(reader.u64(), extraction.identity.tick);
        assert_eq!(reader.take(16), [1; 16]);
        assert_eq!(reader.u8(), 0, "configured content is not installed yet");
        let total = reader.u32();
        let selected = reader.u32();
        let omitted = reader.u32();
        assert_eq!((total, selected, omitted), (1, 1, 0));
        assert_eq!(selected + omitted, total);
        assert_eq!(reader.u64(), event.entity_id.packed());
        assert_eq!(reader.u8(), 0);
        assert_eq!(reader.u8(), EntityClass::Creature as u8);
        assert_eq!(reader.u16(), blockwild_entity::SimulationTier::Nearby as u16);
        assert_eq!(
            reader.u64(),
            blockwild_entity::ProtectionState::TAMED | blockwild_entity::ProtectionState::NAMED
        );
        assert_eq!(reader.u64(), event.entity_revision);
        assert_eq!(reader.string(), "creature:render");
        assert_eq!(reader.string(), "specimen:render");
        assert_eq!(reader.string(), "asterjaw");
        assert_eq!(reader.optional_string().as_deref(), Some("glasswake"));
        assert_eq!(reader.optional_string().as_deref(), Some("Mizu \u{6c34}"));
        assert_eq!(reader.string(), "model:asterjaw");
        assert_eq!(reader.u32(), 0);
        assert_eq!(reader.take(16), [0; 16]);
        assert_eq!(
            (0..9).map(|_| reader.f32()).collect::<Vec<_>>(),
            vec![1.5, 2.5, 3.5, 0.75, 4.5, 5.5, 6.5, 7.5, 8.5]
        );
        assert_eq!(reader.u8(), 1);
        assert_eq!(reader.u64(), 99);
        assert_eq!(reader.u8(), blockwild_entity::MovementMode::Swim as u8);
        assert_eq!(reader.u8(), 0);
        assert_eq!(reader.u8(), 1);
        assert_eq!(reader.u64(), 71);
        assert_eq!(reader.string(), "breach");
        assert_eq!(reader.u16(), 2);
        assert_eq!(reader.u64(), 70);
        assert_eq!(reader.u64(), 110);
        assert_eq!(
            reader.optional_entity_id(),
            Some(blockwild_types::EntityId::new(9, 1).packed())
        );
        assert_eq!(reader.u32(), 1);
        assert_eq!(reader.string(), "saddle");
        assert_eq!(reader.string(), "item:saddle");
        assert_eq!(reader.u16(), 1);
        assert_eq!(reader.u32(), 42);
        assert_eq!(reader.u32(), 1);
        assert_eq!(reader.string(), "dye");
        let custom_length = usize::try_from(reader.u32()).unwrap();
        assert_eq!(reader.take(custom_length), [0x80, 0xff]);
        assert_eq!(
            reader.optional_entity_id(),
            Some(blockwild_types::EntityId::new(8, 1).packed())
        );
        assert_eq!(reader.u8(), 1);
        assert_eq!(reader.u8(), 1);
        assert_eq!(reader.u8(), 1);
        assert_eq!(reader.optional_string().as_deref(), Some("item:saddle"));
        assert_eq!(reader.u32(), 1);
        assert_eq!(reader.u8(), 1);
        assert_eq!(reader.string(), "rider");
        assert_eq!((reader.f32(), reader.f32(), reader.f32()), (0.0, 1.25, -0.5));
        assert_eq!(
            reader.optional_entity_id(),
            Some(blockwild_types::EntityId::new(7, 1).packed())
        );
        assert_eq!(reader.u16(), 1_000);
        assert_eq!(reader.u32(), 1);
        assert_eq!(reader.string(), "care");
        assert_eq!(reader.u32(), 3);
        reader.finish();
    }

    #[test]
    fn domain_row_wire_matches_the_shared_typescript_fixture() {
        let mut row = domain_row(7, "golden", 9);
        bool_field(&mut row, "bool", true);
        bytes_field(&mut row, "bytes", &[0, 1, 0x80]);
        f64_field(&mut row, "f64", 1.5);
        hash_field(
            &mut row,
            "hash",
            CanonicalHash([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
        );
        i64_field(&mut row, "i64", -2);
        string_field(&mut row, "string", "\u{e9}");
        u64_field(&mut row, "u64", 0x0102_0304_0506_0708);
        let encoded = encode_domain_row(&row).expect("bounded golden domain row");
        let actual = encoded.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let expected =
            include_str!("../../../../tests/fixtures/rust-engine/r10-authoritative-extraction/domain-row-v1.hex")
                .trim();
        assert_eq!(actual, expected);
    }

    #[test]
    fn domain_row_revision_attests_kind_key_field_names_tags_and_values() {
        let mut row = domain_row(7, "record:\u{e000}", 99);
        bool_field(&mut row, "bool", true);
        bytes_field(&mut row, "bytes", &[0, 1, 0x80]);
        f64_field(&mut row, "f64", 1.5);
        hash_field(&mut row, "hash", CanonicalHash([7; 16]));
        i64_field(&mut row, "i64", -2);
        string_field(&mut row, "string", "\u{1f600}");
        u64_field(&mut row, "u64", 17);
        let revision = domain_row_revision(&row);

        let mut changed = row.clone();
        changed.kind += 1;
        assert_ne!(domain_row_revision(&changed), revision);
        let mut changed = row.clone();
        changed.key.push('x');
        assert_ne!(domain_row_revision(&changed), revision);
        let mut changed = row.clone();
        let value = changed.fields.remove("bool").unwrap();
        changed.fields.insert("bool-renamed".into(), value);
        assert_ne!(domain_row_revision(&changed), revision);

        for (field, replacement) in [
            ("bool", DomainViewValueV1::Bool(false)),
            ("bytes", DomainViewValueV1::Bytes(vec![0, 1, 0x81])),
            ("f64", DomainViewValueV1::F64(1.500_000_000_000_000_2)),
            ("hash", DomainViewValueV1::Hash(CanonicalHash([8; 16]))),
            ("i64", DomainViewValueV1::I64(-3)),
            ("string", DomainViewValueV1::String("\u{1f601}".into())),
            ("u64", DomainViewValueV1::U64(18)),
        ] {
            let mut changed = row.clone();
            changed.fields.insert(field.into(), replacement);
            assert_ne!(domain_row_revision(&changed), revision, "field {field}");
        }
        let mut changed_tag = row;
        changed_tag.fields.insert("u64".into(), DomainViewValueV1::I64(17));
        assert_ne!(domain_row_revision(&changed_tag), revision, "value tags are semantic");
    }

    #[test]
    fn domain_row_revision_is_semantic_not_a_borrowed_source_counter() {
        assert_eq!(
            domain_row_revision(&domain_row(1, "semantic", 1)),
            domain_row_revision(&domain_row(1, "semantic", 9))
        );
    }

    #[test]
    fn container_view_keys_are_typed_length_prefixed_and_injective() {
        let keys = BTreeSet::from([
            container_view_key(0, None, "owner:id"),
            container_view_key(0, Some(""), "owner:id"),
            container_view_key(0, Some("owner"), "id"),
            container_view_key(0, Some("owner:id"), ""),
            container_view_key(1, Some("owner"), "id"),
            container_view_key(1, Some("\u{6c34}:\u{1f600}"), "id:\u{e000}"),
        ]);
        assert_eq!(keys.len(), 6);
        assert!(keys.iter().all(|key| key.starts_with("container-key-v1/")));
    }

    #[test]
    fn joined_drop_machine_light_and_celestial_record_builders_are_nonempty() {
        struct Packed(u64);
        impl Packed {
            const fn packed(&self) -> u64 {
                self.0
            }
        }
        struct ContainerFixture {
            kind: u16,
            owner_id: Option<String>,
            id: String,
        }
        struct VectorFixture {
            x_milli: i64,
            y_milli: i64,
            z_milli: i64,
        }
        struct RotationFixture {
            yaw: u32,
            pitch: u32,
            roll: u32,
        }
        struct StackFixture {
            item_code: u32,
            count: u32,
            durability_millionths: Option<u32>,
            metadata_hash: CanonicalHash,
        }
        struct SpatialFixture {
            drop_id: String,
            revision: u64,
            entity_id: Packed,
            container: ContainerFixture,
            slot: u16,
            bound_container_revision: u64,
            position: VectorFixture,
            velocity_milli_per_second: VectorFixture,
            rotation: RotationFixture,
            created_tick: u64,
            expires_tick: Option<u64>,
            pickup_lock_actor_id: Option<String>,
        }
        struct DropFixture {
            spatial: SpatialFixture,
            stack: StackFixture,
            entity_revision: u64,
        }
        struct ColorFixture {
            red: u32,
            green: u32,
            blue: u32,
        }
        struct LightFixture {
            kind: u8,
            color: ColorFixture,
            luminous_flux_millilumens: u64,
            range_milli: u32,
            inner_cone_microturns: u32,
            outer_cone_microturns: u32,
            casts_shadows: bool,
            enabled: bool,
        }
        struct AnchorFixture {
            machine_id: String,
            revision: u64,
            presentation_id: String,
            position: VectorFixture,
            rotation: RotationFixture,
            half_extents_milli: [u32; 3],
            light: Option<LightFixture>,
        }
        struct MachineFixture {
            anchor: AnchorFixture,
            gameplay_revision: u64,
            active: bool,
        }
        struct DirectionFixture {
            x_millionths: i32,
            y_millionths: i32,
            z_millionths: i32,
        }
        struct BodyFixture {
            body_id: String,
            parent_body_id: Option<String>,
            kind: u8,
            presentation_id: String,
            direction: DirectionFixture,
            angular_radius_microdegrees: u32,
            illuminated_fraction_millionths: u32,
            phase_microturns: u32,
            tint: ColorFixture,
            radiance_millionths: u32,
            render_order: i32,
            occludes_stars: bool,
        }

        let drop = DropFixture {
            spatial: SpatialFixture {
                drop_id: "drop:\u{6c34}:\u{1f600}".into(),
                revision: 3,
                entity_id: Packed(0x1_0000_0007),
                container: ContainerFixture {
                    kind: 2,
                    owner_id: Some("owner:drop".into()),
                    id: "custody:drop".into(),
                },
                slot: 0,
                bound_container_revision: 4,
                position: VectorFixture {
                    x_milli: 1_500,
                    y_milli: 64_000,
                    z_milli: -2_500,
                },
                velocity_milli_per_second: VectorFixture {
                    x_milli: 200,
                    y_milli: 300,
                    z_milli: -400,
                },
                rotation: RotationFixture {
                    yaw: 125_000,
                    pitch: 25_000,
                    roll: 0,
                },
                created_tick: 9,
                expires_tick: Some(109),
                pickup_lock_actor_id: Some("actor:drop".into()),
            },
            stack: StackFixture {
                item_code: 42,
                count: 3,
                durability_millionths: Some(875_000),
                metadata_hash: CanonicalHash([0x42; 16]),
            },
            entity_revision: 5,
        };
        let machine = MachineFixture {
            anchor: AnchorFixture {
                machine_id: "machine:lamp".into(),
                revision: 6,
                presentation_id: "machine.lamp.v1".into(),
                position: VectorFixture {
                    x_milli: 4_000,
                    y_milli: 65_000,
                    z_milli: 8_000,
                },
                rotation: RotationFixture {
                    yaw: 250_000,
                    pitch: 0,
                    roll: 0,
                },
                half_extents_milli: [500, 1_000, 500],
                light: Some(LightFixture {
                    kind: 0,
                    color: ColorFixture {
                        red: 1_000_000,
                        green: 700_000,
                        blue: 300_000,
                    },
                    luminous_flux_millilumens: 900_000,
                    range_milli: 12_000,
                    inner_cone_microturns: 0,
                    outer_cone_microturns: 0,
                    casts_shadows: true,
                    enabled: true,
                }),
            },
            gameplay_revision: 7,
            active: true,
        };
        let celestial = BodyFixture {
            body_id: "star:\u{1f31f}".into(),
            parent_body_id: None,
            kind: 0,
            presentation_id: "celestial.waystar".into(),
            direction: DirectionFixture {
                x_millionths: 0,
                y_millionths: 1_000_000,
                z_millionths: 0,
            },
            angular_radius_microdegrees: 250_000,
            illuminated_fraction_millionths: 1_000_000,
            phase_microturns: 0,
            tint: ColorFixture {
                red: 1_000_000,
                green: 950_000,
                blue: 850_000,
            },
            radiance_millionths: 5_000_000,
            render_order: -1,
            occludes_stars: true,
        };

        let rows = [
            dropped_item_world_view_row!(&drop, IntegratedRuntimeRenderPresentationBindingV1::Unmapped),
            machine_anchor_world_view_row!(&machine, IntegratedRuntimeRenderPresentationBindingV1::Unmapped),
            celestial_body_world_view_row!(&celestial, 8),
        ];
        assert_eq!(rows.iter().map(|row| row.kind).collect::<Vec<_>>(), [6, 5, 5]);
        assert!(
            rows.iter()
                .all(|row| !row.fields.is_empty() && domain_row_revision(row) != 0)
        );
        assert!(rows[0].fields.contains_key("stack.metadataHash"));
        assert!(matches!(
            rows[0].fields.get("presentation.status"),
            Some(DomainViewValueV1::String(value)) if value == "unmapped"
        ));
        assert!(matches!(
            rows[0].fields.get("presentation.contentId"),
            Some(DomainViewValueV1::String(value)) if value == "42"
        ));
        assert!(rows[1].fields.contains_key("light.luminousFluxMillilumens"));
        assert!(matches!(
            rows[1].fields.get("presentation.status"),
            Some(DomainViewValueV1::String(value)) if value == "unmapped"
        ));
        assert!(matches!(
            rows[1].fields.get("presentation.blockerId"),
            Some(DomainViewValueV1::String(value)) if value == "machine-presentation-profile-unmapped"
        ));
        assert!(rows[2].fields.contains_key("angularRadiusMicrodegrees"));
        assert!(rows.iter().all(|row| encode_domain_row(row).is_some()));

        let identity = CanonicalHash([0x55; 16]);
        let exact = dropped_item_world_view_row!(
            &drop,
            IntegratedRuntimeRenderPresentationBindingV1::Exact {
                profile_id: "drop:test",
                model_id: "test-drop-model",
                content_hash: identity,
                content_version: 7,
            }
        );
        assert!(matches!(
            exact.fields.get("presentation.profileId"),
            Some(DomainViewValueV1::String(value)) if value == "drop:test"
        ));
        assert!(matches!(
            exact.fields.get("presentation.modelId"),
            Some(DomainViewValueV1::String(value)) if value == "test-drop-model"
        ));
        assert!(matches!(
            exact.fields.get("presentation.contentHash"),
            Some(DomainViewValueV1::Hash(value)) if *value == identity
        ));
        let missing = dropped_item_world_view_row!(
            &drop,
            IntegratedRuntimeRenderPresentationBindingV1::Missing {
                blocker_id: "missing:dropped-item:test",
            }
        );
        assert!(matches!(
            missing.fields.get("presentation.blockerId"),
            Some(DomainViewValueV1::String(value)) if value == "missing:dropped-item:test"
        ));
        let exact_machine = machine_anchor_world_view_row!(
            &machine,
            IntegratedRuntimeRenderPresentationBindingV1::Exact {
                profile_id: "machine:test",
                model_id: "test-machine-model",
                content_hash: identity,
                content_version: 7,
            }
        );
        assert!(matches!(
            exact_machine.fields.get("presentation.profileId"),
            Some(DomainViewValueV1::String(value)) if value == "machine:test"
        ));
        assert!(matches!(
            exact_machine.fields.get("presentation.modelId"),
            Some(DomainViewValueV1::String(value)) if value == "test-machine-model"
        ));
        assert!(matches!(
            exact_machine.fields.get("presentation.contentHash"),
            Some(DomainViewValueV1::Hash(value)) if *value == identity
        ));
        let missing_machine = machine_anchor_world_view_row!(
            &machine,
            IntegratedRuntimeRenderPresentationBindingV1::Missing {
                blocker_id: "missing:machine:test",
            }
        );
        assert!(matches!(
            missing_machine.fields.get("presentation.blockerId"),
            Some(DomainViewValueV1::String(value)) if value == "missing:machine:test"
        ));
    }

    #[test]
    fn dropped_item_bwr6_identity_is_exact_or_zero_without_creature_fallback() {
        let runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let mut record = EntityCompatibilityRecord::new("drop:test", "drop:test", "dropped-item");
        record.class = EntityClass::Construct;
        record
            .custom
            .insert("modelKey".into(), "creature-looking-fallback".into());
        let components = EntityComponents::from_compatibility(&record, blockwild_entity::ProtectionState::from_bits(0));
        let source = RenderEntityExtractionSourceV3 {
            entity_id: 0x1_0000_0001,
            residency: 0,
            simulation_tier: 0,
            protection: 0,
            entity_revision: 5,
            record: &record,
            components: &components,
        };
        let identity = CanonicalHash([0x55; 16]);
        let read_model = |bytes: &[u8]| {
            let mut reader = ExtractionReader::new(bytes);
            reader.u64();
            reader.take(1 + 1 + 2 + 8 + 8);
            reader.string();
            reader.string();
            reader.string();
            reader.optional_string();
            reader.optional_string();
            (
                reader.string(),
                reader.u32(),
                CanonicalHash(reader.take(16).try_into().unwrap()),
            )
        };
        let exact = BTreeMap::from([(
            source.entity_id,
            DroppedItemRenderBindingV1 {
                entity_revision: source.entity_revision,
                binding: IntegratedRuntimeRenderPresentationBindingV1::Exact {
                    profile_id: "drop:test",
                    model_id: "test-drop-model",
                    content_hash: identity,
                    content_version: 7,
                },
            },
        )]);
        assert_eq!(
            read_model(&encode_render_entity_record(
                &runtime,
                &source,
                &exact,
                &BTreeMap::new()
            )),
            ("test-drop-model".into(), 7, identity)
        );

        for binding in [
            IntegratedRuntimeRenderPresentationBindingV1::Missing {
                blocker_id: "missing:dropped-item:test",
            },
            IntegratedRuntimeRenderPresentationBindingV1::Unmapped,
        ] {
            let unresolved = BTreeMap::from([(
                source.entity_id,
                DroppedItemRenderBindingV1 {
                    entity_revision: source.entity_revision,
                    binding,
                },
            )]);
            assert_eq!(
                read_model(&encode_render_entity_record(
                    &runtime,
                    &source,
                    &unresolved,
                    &BTreeMap::new()
                )),
                ("unresolved:dropped-item".into(), 0, CanonicalHash::default())
            );
        }

        let stale = BTreeMap::from([(
            source.entity_id,
            DroppedItemRenderBindingV1 {
                entity_revision: source.entity_revision + 1,
                binding: IntegratedRuntimeRenderPresentationBindingV1::Exact {
                    profile_id: "drop:test",
                    model_id: "test-drop-model",
                    content_hash: identity,
                    content_version: 7,
                },
            },
        )]);
        assert_eq!(
            read_model(&encode_render_entity_record(
                &runtime,
                &source,
                &stale,
                &BTreeMap::new()
            )),
            ("unresolved:dropped-item".into(), 0, CanonicalHash::default())
        );
    }

    #[test]
    fn empty_authoritative_machine_anchor_set_has_no_machine_presentation_blocker() {
        let runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let world_view = runtime.world_view_extraction().unwrap();
        assert!(world_view.machines.is_empty());
        let view = machine_domain_view(&runtime, Some(&world_view));
        assert_eq!(view.status, DomainViewStatusV1::Partial);
        assert_eq!(view.blockers, ["world-prop-presentation-not-authoritative"]);
        assert!(
            !view
                .blockers
                .iter()
                .any(|blocker| blocker.starts_with("machine-presentation-"))
        );
    }

    #[test]
    fn domain_view_wire_orders_bmp_non_bmp_text_as_rust_utf8_bytes() {
        let bmp = "\u{e000}";
        let non_bmp = "\u{1f600}";
        assert!(bmp.as_bytes() < non_bmp.as_bytes());
        let mut bmp_row = domain_row(1, bmp, 0);
        string_field(&mut bmp_row, bmp, "bmp");
        string_field(&mut bmp_row, non_bmp, "non-bmp");
        let encoded = encode_domain_view(DomainViewV1 {
            domain: 1,
            revision: 1,
            status: DomainViewStatusV1::Partial,
            rows: vec![domain_row(1, non_bmp, 0), bmp_row],
            blockers: vec![non_bmp.into(), bmp.into()],
        });
        let mut reader = ExtractionReader::new(&encoded);
        assert_eq!(reader.u8(), 1);
        assert_eq!(reader.u16(), DOMAIN_VIEW_SCHEMA_V1);
        assert_eq!(reader.u8(), DomainViewStatusV1::Partial as u8);
        reader.u64();
        assert_eq!((reader.u32(), reader.u32(), reader.u32(), reader.u32()), (2, 2, 0, 2));
        assert_eq!(reader.u16(), 2);
        assert_eq!(reader.string(), bmp);
        assert_eq!(reader.string(), non_bmp);
        let payload_length = usize::try_from(reader.u32()).unwrap();
        reader.take(16);
        let payload = reader.take(payload_length);
        reader.finish();
        let mut payload_reader = ExtractionReader::new(payload);
        assert_eq!(payload_reader.u16(), 1);
        assert_eq!(payload_reader.string(), bmp);
        payload_reader.u64();
        assert_eq!(payload_reader.u16(), 2);
        assert_eq!(payload_reader.string(), bmp);
        payload_reader.take(1 + 4 + 3);
        assert_eq!(payload_reader.string(), non_bmp);
    }

    fn runtime_with_bound_extraction_player() -> IntegratedRuntimeV2 {
        let mut runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let mut record = EntityCompatibilityRecord::new("player:extraction", "player:extraction", "player");
        record.class = EntityClass::Player;
        record.position = EntityVec3::new(8.0, 64.0, 8.0);
        record.health = 20.0;
        record.maximum_health = 20.0;
        let mut spawn = IntegratedRuntimeBatchV2::empty("spawn-extraction-player", runtime.identity());
        spawn.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            commands: vec![EntityCommand::Spawn {
                record,
                residency: EntityResidency::Hot,
            }],
        });
        assert!(runtime.commit(spawn).accepted());
        runtime
            .bind_player(RuntimePlayerBindingWireV1 {
                external_entity_id: "player:extraction".into(),
                actor_id: "player:extraction".into(),
                player_id: blockwild_types::PlayerId::new(7, 3),
                creative_mode: false,
                radius: 0.35,
                standing_height: 1.8,
                crouching_height: 1.35,
                mass: 80.0,
                walk_speed: 4.3,
                sprint_speed: 6.2,
                creative_flight_speed: 8.0,
                maximum_oxygen_seconds: 15.0,
            })
            .unwrap();
        runtime
            .import_player_inventory(
                PlayerInventoryImportWireV1 {
                    import: ImportPlayerInventoryV1 {
                        inventory: ContainerKey::player("player:extraction"),
                        expected_revision: 0,
                        slots: vec![None; 9],
                        metadata: Vec::new(),
                    },
                    selected_slot: 0,
                },
                CanonicalHash([0x6e; 16]),
            )
            .unwrap();
        runtime.install_bound_player_combatant_v1().unwrap();
        runtime
    }

    #[test]
    fn view_aware_extraction_cursor_is_worker_owned_retry_exact_and_context_sensitive() {
        let baseline = runtime_with_bound_extraction_player();
        let (handle, identity) = insert_test_runtime(baseline.clone());
        let view = RuntimeExtractionViewV1 {
            viewport: [1_280, 720],
            view_revision: 11,
        };
        let first = extraction_from(extract_response(
            handle,
            extract_view_request(
                1_001,
                identity.clone(),
                0,
                view.viewport,
                view.view_revision,
                MAX_EXTRACTION_BYTES as u32,
            ),
        ));
        assert_eq!(first.extraction_revision, 1);
        assert!(!first.render.is_empty());
        let camera = camera_extraction(&baseline, view).unwrap();
        let baseline_world_view = baseline.world_view_extraction().unwrap();
        assert_eq!(
            first.hud,
            encode_hud_extraction_at(&baseline, 1, Some(&baseline_world_view), Some(&camera))
        );

        let retry = extraction_from(extract_response(
            handle,
            extract_view_request(
                1_002,
                identity.clone(),
                0,
                view.viewport,
                view.view_revision,
                MAX_EXTRACTION_BYTES as u32,
            ),
        ));
        assert_eq!(
            retry, first,
            "a lost-response retry must replay the exact cached extraction"
        );
        let empty = extraction_from(extract_response(
            handle,
            extract_view_request(
                1_003,
                identity.clone(),
                1,
                view.viewport,
                view.view_revision,
                MAX_EXTRACTION_BYTES as u32,
            ),
        ));
        assert_eq!(empty.extraction_revision, 1);
        assert_eq!(extraction_channel_bytes(&empty), 0);

        let resized_view = RuntimeExtractionViewV1 {
            viewport: [1_920, 1_080],
            view_revision: 12,
        };
        let resized = extraction_from(extract_response(
            handle,
            extract_view_request(
                1_004,
                identity.clone(),
                1,
                resized_view.viewport,
                resized_view.view_revision,
                MAX_EXTRACTION_BYTES as u32,
            ),
        ));
        assert_eq!(resized.extraction_revision, 2);
        assert_ne!(resized.hud, first.hud);
        assert_eq!(
            response_error_code(extract_response(
                handle,
                extract_view_request(1_005, identity.clone(), 2, [800, 600], 12, MAX_EXTRACTION_BYTES as u32),
            )),
            "view-revision-conflict"
        );
        assert_eq!(
            response_error_code(extract_response(
                handle,
                extract_view_request(
                    1_006,
                    identity.clone(),
                    2,
                    [1_280, 720],
                    11,
                    MAX_EXTRACTION_BYTES as u32
                ),
            )),
            "view-revision-regression"
        );

        assert_eq!(
            response_error_code(extract_response(
                handle,
                extract_view_request(1_007, identity.clone(), 2, [1_920, 1_080], 13, 1),
            )),
            "extraction-capacity"
        );
        INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let cursor = store.extraction_cursors.get(&handle).unwrap();
            assert_eq!(cursor.cursor, 2);
            assert_eq!(cursor.highest_view, Some(resized_view));
        });
        let next_view = RuntimeExtractionViewV1 {
            viewport: [1_920, 1_080],
            view_revision: 13,
        };
        let next = extraction_from(extract_response(
            handle,
            extract_view_request(
                1_008,
                identity.clone(),
                2,
                next_view.viewport,
                next_view.view_revision,
                MAX_EXTRACTION_BYTES as u32,
            ),
        ));
        assert_eq!(next.extraction_revision, 3);

        let legacy = extraction_from(extract_response(
            handle,
            RuntimeRequestV1::Extract {
                request_id: 1_009,
                client_epoch: 1,
                expected: identity.clone(),
                after_revision: 3,
                max_bytes: MAX_EXTRACTION_BYTES as u32,
            },
        ));
        assert_eq!(legacy.extraction_revision, 4);
        assert_eq!(
            legacy.hud,
            encode_hud_extraction_at(&baseline, 4, Some(&baseline_world_view), None)
        );
        let legacy_player =
            domain_views_with_context(&baseline, baseline.world_view_extraction().as_ref().ok(), 4, None).remove(1);
        assert_eq!(legacy_player.status, DomainViewStatusV1::Partial);
        assert_eq!(
            legacy_player.blockers,
            ["camera-projection-and-orientation-not-authoritative"]
        );
        assert!(!legacy_player.rows.iter().any(|row| row.kind == 3));

        let resumed = extraction_from(extract_response(
            handle,
            extract_view_request(
                1_010,
                identity.clone(),
                4,
                next_view.viewport,
                next_view.view_revision,
                MAX_EXTRACTION_BYTES as u32,
            ),
        ));
        assert_eq!(resumed.extraction_revision, 5);
        let cached = extraction_from(extract_response(
            handle,
            extract_view_request(
                1_011,
                identity.clone(),
                4,
                next_view.viewport,
                next_view.view_revision,
                MAX_EXTRACTION_BYTES as u32,
            ),
        ));
        assert_eq!(cached, resumed);
        assert_eq!(
            response_error_code(extract_response(
                handle,
                extract_view_request(
                    1_012,
                    identity.clone(),
                    4,
                    next_view.viewport,
                    next_view.view_revision,
                    1
                ),
            )),
            "extraction-capacity"
        );
        assert_eq!(
            response_error_code(extract_response(
                handle,
                extract_view_request(
                    1_013,
                    identity,
                    6,
                    next_view.viewport,
                    next_view.view_revision,
                    MAX_EXTRACTION_BYTES as u32,
                ),
            )),
            "extraction-revision-ahead"
        );
    }

    #[test]
    fn view_aware_pose_and_capacity_failures_do_not_advance_the_sidecar() {
        let runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let (handle, identity) = insert_test_runtime(runtime);
        assert_eq!(
            response_error_code(extract_response(
                handle,
                extract_view_request(1_101, identity.clone(), 0, [800, 600], 1, MAX_EXTRACTION_BYTES as u32),
            )),
            "camera-player-binding"
        );
        INTEGRATED_RUNTIMES.with(|store| {
            assert!(!store.borrow().extraction_cursors.contains_key(&handle));
        });

        let legacy = extraction_from(extract_response(
            handle,
            RuntimeRequestV1::Extract {
                request_id: 1_102,
                client_epoch: 1,
                expected: identity.clone(),
                after_revision: 0,
                max_bytes: MAX_EXTRACTION_BYTES as u32,
            },
        ));
        assert_eq!(legacy.extraction_revision, 1);
        assert_eq!(
            response_error_code(extract_response(
                handle,
                extract_view_request(1_103, identity, 1, [800, 600], 1, MAX_EXTRACTION_BYTES as u32),
            )),
            "camera-player-binding"
        );
        INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let cursor = store.extraction_cursors.get(&handle).unwrap();
            assert_eq!(cursor.cursor, 1);
            assert_eq!(cursor.last_context, Some(RuntimeExtractionContextV1::Legacy));
            assert!(cursor.highest_view.is_none());
        });
    }

    #[test]
    fn camera_row_is_complete_for_every_mode_and_carries_authoritative_aiming() {
        let mut runtime = runtime_with_bound_extraction_player();
        let player = runtime.player().unwrap().clone();
        let world_view = runtime.world_view_extraction().unwrap();
        let world_player = world_view
            .players
            .iter()
            .find(|value| value.binding.player_id == player.binding.player_id)
            .unwrap();
        assert_eq!(world_player.binding.actor_id, player.binding.actor_id);
        assert_eq!(world_player.binding.entity_id, player.entity_id);
        assert_eq!(
            runtime
                .entities()
                .hot()
                .get(&player.entity_id)
                .unwrap()
                .record
                .external_entity_id,
            player.binding.external_entity_id
        );
        let render = encode_render_extraction_at(&runtime, 1, Some(&world_view));
        let mut render_reader = ExtractionReader::new(&render);
        assert_eq!(render_reader.take(4), b"BWR6");
        assert_eq!(render_reader.u16(), ENTITY_EXTRACTION_SCHEMA_V3);
        render_reader.u64();
        render_reader.u64();
        render_reader.take(16);
        render_reader.u8();
        assert_eq!(
            (render_reader.u32(), render_reader.u32(), render_reader.u32()),
            (1, 1, 0)
        );
        assert_eq!(render_reader.u64(), player.entity_id.packed());
        render_reader.take(1 + 1 + 2 + 8 + 8);
        assert_eq!(render_reader.string(), player.binding.external_entity_id);
        let mut expected_camera_revision = 0;
        for (index, (mode, label)) in [
            (CameraModeV1::FirstPerson, "first"),
            (CameraModeV1::ThirdRear, "third-rear"),
            (CameraModeV1::ThirdFront, "third-front"),
        ]
        .into_iter()
        .enumerate()
        {
            if runtime.camera_state().mode != mode {
                let receipt = runtime
                    .apply_camera_config(
                        RuntimeCameraConfigWireV1 {
                            expected_camera_revision,
                            mode,
                            profile: CameraProfileV1::default(),
                        },
                        CanonicalHash([index as u8; 16]),
                    )
                    .unwrap();
                expected_camera_revision = receipt.resulting_camera_revision;
            }
            let view = RuntimeExtractionViewV1 {
                viewport: [1_280, 720],
                view_revision: index as u64 + 1,
            };
            let mut camera = camera_extraction(&runtime, view).unwrap();
            camera.aiming = index == 2;
            let row = camera_domain_row(&camera);
            assert_eq!((row.kind, row.key.as_str(), row.fields.len()), (3, "camera", 36));
            assert!(
                matches!(row.fields.get("aiming"), Some(DomainViewValueV1::Bool(value)) if *value == camera.aiming)
            );
            assert!(
                matches!(row.fields.get("actorId"), Some(DomainViewValueV1::String(value)) if value == "player:extraction")
            );
            assert!(
                matches!(row.fields.get("externalEntityId"), Some(DomainViewValueV1::String(value)) if value == "player:extraction")
            );
            assert!(
                matches!(row.fields.get("entityId"), Some(DomainViewValueV1::U64(value)) if *value == camera.bound_entity_id)
            );
            assert!(
                matches!(row.fields.get("playerId"), Some(DomainViewValueV1::U64(value)) if *value == blockwild_types::PlayerId::new(7, 3).packed())
            );
            assert!(matches!(row.fields.get("mode"), Some(DomainViewValueV1::String(value)) if value == label));
            assert!(
                matches!(row.fields.get("cameraRevision"), Some(DomainViewValueV1::U64(value)) if *value == expected_camera_revision)
            );
            assert!(
                matches!(row.fields.get("viewRevision"), Some(DomainViewValueV1::U64(value)) if *value == view.view_revision)
            );
            assert!(matches!(
                row.fields.get("viewport.width"),
                Some(DomainViewValueV1::U64(1_280))
            ));
            assert!(matches!(
                row.fields.get("viewport.height"),
                Some(DomainViewValueV1::U64(720))
            ));
            assert!(
                matches!(row.fields.get("poseHash"), Some(DomainViewValueV1::Hash(value)) if *value == camera.pose.pose_hash)
            );
            for (key, expected) in [
                ("profile.eyeHeight", camera.profile.eye_height),
                (
                    "profile.thirdPersonTargetHeight",
                    camera.profile.third_person_target_height,
                ),
                ("profile.thirdPersonDistance", camera.profile.third_person_distance),
                ("profile.thirdPersonPitchScale", camera.profile.third_person_pitch_scale),
                ("profile.rearShoulderOffset", camera.profile.rear_shoulder_offset),
                ("profile.collisionRadius", camera.profile.collision_radius),
                ("profile.collisionPadding", camera.profile.collision_padding),
                ("profile.minimumDistance", camera.profile.minimum_distance),
                (
                    "profile.baseVerticalFovRadians",
                    camera.profile.base_vertical_fov_radians,
                ),
                ("profile.aimVerticalFovRadians", camera.profile.aim_vertical_fov_radians),
                ("profile.near", camera.profile.near),
                ("profile.far", camera.profile.far),
            ] {
                assert!(
                    matches!(row.fields.get(key), Some(DomainViewValueV1::F64(value)) if value.to_bits() == expected.to_bits())
                );
            }
            for key in [
                "orientation.w",
                "orientation.x",
                "orientation.y",
                "orientation.z",
                "position.x",
                "position.y",
                "position.z",
                "profile.aimVerticalFovRadians",
                "profile.baseVerticalFovRadians",
                "profile.collisionPadding",
                "profile.collisionRadius",
                "profile.eyeHeight",
                "profile.far",
                "profile.minimumDistance",
                "profile.near",
                "profile.rearShoulderOffset",
                "profile.thirdPersonDistance",
                "profile.thirdPersonPitchScale",
                "profile.thirdPersonTargetHeight",
                "projection.far",
                "projection.near",
                "projection.verticalFovRadians",
                "resolvedDistance",
            ] {
                match row.fields.get(key) {
                    Some(DomainViewValueV1::F64(value)) if value.is_finite() => {}
                    value => panic!("camera field {key} is not a finite f64: {value:?}"),
                }
            }
        }
    }

    #[test]
    fn view_sidecar_is_checkpoint_neutral_and_resets_on_restore_handle() {
        let runtime = runtime_with_bound_extraction_player();
        let before_identity = runtime.identity();
        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let checkpoint_hash = integrated_runtime_checkpoint_hash_v1(&checkpoint);
        let (handle, identity) = insert_test_runtime(runtime);
        let extraction = extraction_from(extract_response(
            handle,
            extract_view_request(1_201, identity, 0, [16_384, 16_384], 77, MAX_EXTRACTION_BYTES as u32),
        ));
        assert_eq!(extraction.extraction_revision, 1);
        INTEGRATED_RUNTIMES.with(|store| {
            let store = store.borrow();
            let resident = store.runtimes.get(&handle).unwrap();
            assert_eq!(resident.identity(), before_identity);
            assert_eq!(resident.export_runtime_checkpoint().unwrap(), checkpoint);
        });

        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(&checkpoint, checkpoint_hash).unwrap();
        let (restored_handle, restored_identity) = insert_test_runtime(restored);
        let restored_extraction = extraction_from(extract_response(
            restored_handle,
            extract_view_request(
                1_202,
                restored_identity,
                0,
                [16_384, 16_384],
                77,
                MAX_EXTRACTION_BYTES as u32,
            ),
        ));
        assert_eq!(restored_extraction.extraction_revision, 1);
    }

    #[test]
    fn static_bounded_extraction_capability_keeps_partial_and_unavailable_blockers_explicit() {
        let runtime = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let views = domain_views(&runtime);
        assert_eq!(
            views.iter().map(|view| view.domain).collect::<Vec<_>>(),
            (1..=8).collect::<Vec<_>>()
        );
        assert_eq!(views[0].status, DomainViewStatusV1::Complete);
        assert_eq!(
            views[1].blockers,
            ["camera-projection-and-orientation-not-authoritative"]
        );
        assert_eq!(views[2].status, DomainViewStatusV1::Complete);
        assert!(views[2].blockers.is_empty());
        assert_eq!(views[3].blockers, ["world-prop-presentation-not-authoritative"]);
        assert!(
            views[4]
                .blockers
                .iter()
                .any(|value| value == "combat-projectile-and-summon-render-presentation-not-authoritative")
        );
        assert_eq!(views[7].status, DomainViewStatusV1::Complete);
        assert!(views[7].blockers.is_empty());
        assert_eq!(
            views[7].rows.iter().map(|row| row.kind).collect::<Vec<_>>(),
            [1, 2, 3, 4]
        );

        let unavailable = domain_views_with_world_view(&runtime, None);
        assert_eq!(unavailable[1].status, DomainViewStatusV1::Partial);
        assert!(
            unavailable[1]
                .blockers
                .iter()
                .any(|value| value == "player-inventory-container-binding-not-explicit")
        );
        assert_eq!(unavailable[2].status, DomainViewStatusV1::Partial);
        assert!(
            unavailable[2]
                .blockers
                .iter()
                .any(|value| value == "dropped-item-spatial-state-not-authoritative")
        );
        assert_eq!(unavailable[7].status, DomainViewStatusV1::Absent);
        assert!(
            unavailable[7]
                .blockers
                .iter()
                .any(|value| value == "world-view-extraction-invariant-rejected")
        );
        let capability_values = capabilities(&runtime);
        assert!(capability_values.iter().any(|value| value == "bounded-extraction-v1"));
        assert!(
            capability_values
                .iter()
                .any(|value| value == "bounded-extraction-blockers-v1")
        );
        assert!(
            !capability_values
                .iter()
                .any(|value| value == "bounded-extraction-v1-pending-live-domain-views")
        );

        let bound_runtime = runtime_with_bound_extraction_player();
        let extraction_capabilities = |candidate: &IntegratedRuntimeV2| {
            capabilities(candidate)
                .into_iter()
                .filter(|value| value.starts_with("bounded-extraction"))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            extraction_capabilities(&runtime),
            extraction_capabilities(&bound_runtime),
            "protocol support is static even while each envelope reports its own domain blockers"
        );

        let bundle = encode_hud_extraction(&runtime);
        assert_eq!(&bundle[..4], b"BWX0");
        assert!(bundle.len() < DOMAIN_VIEW_COUNT_V1 as usize * DOMAIN_VIEW_MAX_BYTES_V1);
        assert_eq!(&encode_audio_extraction(&runtime)[..4], b"BWAU");
        assert_eq!(&encode_diagnostics(&runtime)[..4], b"BWRX");
    }

    #[test]
    fn player_and_environment_joins_are_checkpoint_stable_and_exact() {
        let runtime = runtime_with_bound_extraction_player();
        let extraction = runtime.world_view_extraction().unwrap();
        assert_eq!(extraction.players.len(), 1);
        let views = domain_views_with_world_view(&runtime, Some(&extraction));
        let runtime_player = views[1]
            .rows
            .iter()
            .find(|row| row.kind == 1)
            .expect("native player runtime row");
        assert!(matches!(
            runtime_player.fields.get("deathSequence.present"),
            Some(DomainViewValueV1::Bool(false))
        ));
        assert!(!runtime_player.fields.contains_key("deathSequence.value"));
        assert!(matches!(
            runtime_player.fields.get("lastRespawnSequence.present"),
            Some(DomainViewValueV1::Bool(false))
        ));
        assert!(!runtime_player.fields.contains_key("lastRespawnSequence.value"));
        assert!(matches!(
            runtime_player.fields.get("latestDeathRespawn.present"),
            Some(DomainViewValueV1::Bool(false))
        ));
        assert!(!runtime_player.fields.contains_key("latestDeathRespawn.respawnSequence"));
        assert!(matches!(
            runtime_player.fields.get("gameplaySequence"),
            Some(DomainViewValueV1::U64(value))
                if *value == runtime.gameplay().state.revision.sequence
        ));
        assert!(matches!(
            runtime_player.fields.get("gameplayCombatRevision"),
            Some(DomainViewValueV1::U64(value))
                if *value == runtime.gameplay().state.revision.combat
        ));
        for key in [
            "queuedInputsEmpty",
            "pendingContextCommandsEmpty",
            "pendingMovementResultEmpty",
            "miningStateEmpty",
        ] {
            assert!(matches!(
                runtime_player.fields.get(key),
                Some(DomainViewValueV1::Bool(true))
            ));
        }
        let binding = views[1]
            .rows
            .iter()
            .find(|row| row.kind == 2)
            .expect("player binding row");
        assert_eq!(
            binding.key,
            format!("binding:{}", blockwild_types::PlayerId::new(7, 3).packed())
        );
        assert!(matches!(
            binding.fields.get("inventoryContainer"),
            Some(DomainViewValueV1::String(value))
                if value == &container_view_key(0, Some("player:extraction"), "player:extraction")
        ));
        assert!(matches!(
            binding.fields.get("equipmentContainer"),
            Some(DomainViewValueV1::String(value))
                if value == &container_view_key(1, Some("player:extraction"), "player:extraction:equipment")
        ));
        assert!(matches!(
            binding.fields.get("held.present"),
            Some(DomainViewValueV1::Bool(false))
        ));
        assert!(matches!(
            binding.fields.get("backSlot.value"),
            Some(DomainViewValueV1::U64(7))
        ));

        let combatant = views[4]
            .rows
            .iter()
            .find(|row| row.kind == 1 && row.key == "combatant:player:extraction")
            .expect("exact linked player combatant row");
        let native_combatant_revision = runtime.gameplay().state.combat.combatants["player:extraction"].revision;
        assert!(matches!(
            combatant.fields.get("combatantRevision"),
            Some(DomainViewValueV1::U64(value)) if *value == native_combatant_revision
        ));
        let entity_id = runtime.player().unwrap().entity_id.packed();
        assert!(matches!(
            combatant.fields.get("entityId"),
            Some(DomainViewValueV1::U64(value)) if *value == entity_id
        ));
        assert!(matches!(
            combatant.fields.get("vitalUnits"),
            Some(DomainViewValueV1::String(value)) if value == "millihearts-v1"
        ));
        assert!(matches!(
            combatant.fields.get("crossDomainParity"),
            Some(DomainViewValueV1::Bool(true))
        ));
        assert!(matches!(
            combatant.fields.get("health"),
            Some(DomainViewValueV1::U64(20_000))
        ));
        assert!(matches!(
            combatant.fields.get("maxHealth"),
            Some(DomainViewValueV1::U64(20_000))
        ));
        assert!(matches!(
            combatant.fields.get("alive"),
            Some(DomainViewValueV1::Bool(true))
        ));

        let environment = &views[7];
        assert_eq!(environment.status, DomainViewStatusV1::Complete);
        assert!(environment.blockers.is_empty());
        assert!(environment.rows.iter().any(|row| {
            row.kind == 2
                && matches!(row.fields.get("weather"), Some(DomainViewValueV1::U64(0)))
                && row.fields.contains_key("fogDensityMillionths")
        }));
        assert!(environment.rows.iter().any(|row| {
            row.kind == 3
                && matches!(row.fields.get("humanBreathable"), Some(DomainViewValueV1::Bool(true)))
                && row.fields.contains_key("gravity.direction.yMillionths")
        }));
        assert!(
            environment
                .rows
                .iter()
                .any(|row| { row.kind == 4 && matches!(row.fields.get("bodyCount"), Some(DomainViewValueV1::U64(0))) })
        );

        let before_identity = runtime.identity();
        let before_bundle = encode_hud_extraction(&runtime);
        let checkpoint = runtime.export_runtime_checkpoint().unwrap();
        let checkpoint_hash = integrated_runtime_checkpoint_hash_v1(&checkpoint);
        let restored = IntegratedRuntimeV2::restore_runtime_checkpoint(&checkpoint, checkpoint_hash).unwrap();
        assert_eq!(restored.identity(), before_identity);
        assert_eq!(restored.world_view_extraction().unwrap(), extraction);
        assert_eq!(encode_hud_extraction(&restored), before_bundle);
    }

    fn bound_world_view_bwx0_fixture_hex() -> String {
        encode_hud_extraction(&runtime_with_bound_extraction_player())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn bound_camera_view_bwx0_fixture_hex() -> String {
        let runtime = runtime_with_bound_extraction_player();
        let camera = camera_extraction(
            &runtime,
            RuntimeExtractionViewV1 {
                viewport: [1_280, 720],
                view_revision: 11,
            },
        )
        .unwrap();
        let world_view = runtime.world_view_extraction().unwrap();
        encode_hud_extraction_at(&runtime, 1, Some(&world_view), Some(&camera))
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    #[test]
    fn bound_world_view_bwx0_matches_shared_typescript_fixture() {
        let actual = bound_world_view_bwx0_fixture_hex();
        let expected = include_str!(
            "../../../../tests/fixtures/rust-engine/r10-authoritative-extraction/bound-world-view-bwx0-v1.hex"
        )
        .trim();
        assert_eq!(actual, expected);
    }

    #[test]
    fn bound_camera_view_bwx0_matches_shared_typescript_fixture() {
        let actual = bound_camera_view_bwx0_fixture_hex();
        let expected = include_str!(
            "../../../../tests/fixtures/rust-engine/r10-authoritative-extraction/bound-camera-view-bwx0-v1.hex"
        )
        .trim();
        assert_eq!(actual, expected);
    }

    #[test]
    #[ignore = "maintainer-only fixture regeneration"]
    fn regenerate_bound_world_view_bwx0_fixture() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/rust-engine/r10-authoritative-extraction/bound-world-view-bwx0-v1.hex");
        assert!(
            target.is_file(),
            "fixture path must already exist: {}",
            target.display()
        );
        std::fs::write(&target, format!("{}\n", bound_world_view_bwx0_fixture_hex()))
            .expect("write canonical BWX0 fixture");
    }

    #[test]
    #[ignore = "maintainer-only fixture regeneration"]
    fn regenerate_bound_camera_view_bwx0_fixture() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/rust-engine/r10-authoritative-extraction/bound-camera-view-bwx0-v1.hex");
        assert!(
            target.is_file(),
            "fixture path must already exist: {}",
            target.display()
        );
        std::fs::write(&target, format!("{}\n", bound_camera_view_bwx0_fixture_hex()))
            .expect("write canonical view-aware BWX0 fixture");
    }

    #[test]
    fn rejected_world_view_join_fails_every_joined_domain_closed() {
        let mut runtime = runtime_with_bound_extraction_player();
        let before = runtime.identity();
        let mut orphaning = IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2::default()).unwrap();
        let mut batch = IntegratedRuntimeBatchV2::empty("spawn-orphaning-snapshot", orphaning.identity());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 1,
            expected_revision: 0,
            tick: 0,
            commands: vec![EntityCommand::Spawn {
                record: EntityCompatibilityRecord::new("temporary", "temporary", "temporary"),
                residency: EntityResidency::Cold,
            }],
        });
        let receipt = orphaning.commit(batch);
        let IntegratedRuntimeReceiptV2::Accepted(receipt) = receipt else {
            panic!("orphaning fixture spawn rejected")
        };
        let entity_id = receipt.entities[0].events[0].entity_id;
        let mut batch = IntegratedRuntimeBatchV2::empty("despawn-orphaning-snapshot", orphaning.identity());
        batch.entities.push(EntityCommandBatch {
            schema: ENTITY_COMMAND_SCHEMA,
            sequence: 2,
            expected_revision: 1,
            tick: 0,
            commands: vec![EntityCommand::Despawn {
                id: entity_id,
                reason: DespawnReason::Admin,
            }],
        });
        assert!(orphaning.commit(batch).accepted());
        let orphaning_snapshot = orphaning.export_entity_authority_snapshot(2).unwrap();
        let join_error = runtime
            .import_entity_authority_snapshot(runtime.entities().revision(), &orphaning_snapshot)
            .expect_err("the empty snapshot must not orphan a world-view player binding");
        assert_eq!(join_error.code, "entity-snapshot-world-view");
        assert_eq!(runtime.identity(), before, "the rejected join is atomic");
        let views = domain_views_with_world_view_result(
            &runtime,
            Err(IntegratedRuntimeError::new("world-view-extraction", join_error.message)),
        );
        for index in [1_usize, 2, 3, 7] {
            assert!(
                views[index]
                    .blockers
                    .iter()
                    .any(|blocker| blocker == "world-view-extraction-invariant-rejected"),
                "domain {} did not fail closed",
                views[index].domain
            );
            assert_ne!(views[index].status, DomainViewStatusV1::Complete);
        }
        assert!(views[1].rows.iter().all(|row| row.kind != 2));
        assert!(views[2].rows.iter().all(|row| row.kind != 6));
        assert!(views[3].rows.iter().all(|row| row.kind != 5));
        assert!(views[7].rows.iter().all(|row| row.kind == 1));
    }

    #[test]
    fn domain_view_wire_is_canonical_and_bounded() {
        let rows = [domain_row(2, "z", 3), domain_row(1, "b", 2), domain_row(1, "a", 1)];
        let encoded = encode_domain_view(DomainViewV1 {
            domain: 8,
            revision: 9,
            status: DomainViewStatusV1::Complete,
            rows: rows.into(),
            blockers: Vec::new(),
        });
        let mut reader = ExtractionReader::new(&encoded);
        assert_eq!(reader.u8(), 8);
        assert_eq!(reader.u16(), DOMAIN_VIEW_SCHEMA_V1);
        assert_eq!(reader.u8(), DomainViewStatusV1::Complete as u8);
        assert_eq!(reader.u64(), 9);
        assert_eq!((reader.u32(), reader.u32(), reader.u32(), reader.u32()), (3, 3, 0, 3));
        assert_eq!(reader.u16(), 0);
        let payload_length = usize::try_from(reader.u32()).unwrap();
        reader.take(16);
        let payload = reader.take(payload_length);
        reader.finish();
        let mut payload_reader = ExtractionReader::new(payload);
        let mut actual = Vec::new();
        for _ in 0..3 {
            let kind = payload_reader.u16();
            let key = payload_reader.string();
            payload_reader.u64();
            assert_eq!(payload_reader.u16(), 0);
            actual.push((kind, key));
        }
        payload_reader.finish();
        assert_eq!(actual, [(1, "a".into()), (1, "b".into()), (2, "z".into())]);

        let bounded = encode_domain_view(DomainViewV1 {
            domain: 3,
            revision: 1,
            status: DomainViewStatusV1::Complete,
            rows: (0..=DOMAIN_VIEW_MAX_RECORDS_V1)
                .map(|index| domain_row(1, format!("row:{index:05}"), index as u64))
                .collect(),
            blockers: Vec::new(),
        });
        let mut reader = ExtractionReader::new(&bounded);
        assert_eq!(reader.u8(), 3);
        assert_eq!(reader.u16(), DOMAIN_VIEW_SCHEMA_V1);
        assert_eq!(reader.u8(), DomainViewStatusV1::Partial as u8);
        assert_eq!(reader.u64(), 1);
        assert_eq!(reader.u32(), (DOMAIN_VIEW_MAX_RECORDS_V1 + 1) as u32);
        assert_eq!(reader.u32(), DOMAIN_VIEW_MAX_RECORDS_V1 as u32);
        assert_eq!(reader.u32(), 1);
        assert_eq!(reader.u32(), DOMAIN_VIEW_MAX_RECORDS_V1 as u32);
        assert_eq!(reader.u16(), 1);
        assert_eq!(reader.string(), "records-truncated-at-bounded-cursor");
        assert!(usize::try_from(reader.u32()).unwrap() <= DOMAIN_VIEW_MAX_BYTES_V1);
    }
}
