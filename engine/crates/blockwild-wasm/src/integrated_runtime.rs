//! Coarse BWRQ/BWRS facade for one integrated native authority per Worker.
//!
//! The browser never calls this module per voxel or per entity. Every export
//! accepts one complete, checksummed runtime envelope and returns one awaited
//! response envelope. Unsupported domain codecs reject explicitly; they are
//! never interpreted as successful no-ops.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use blockwild_authority::BlockCatalogV1;
use blockwild_engine::{
    CONTENT_INSTALL_PAGE_TYPE_V1, CONTENT_INSTALL_RECEIPT_TYPE_V1, ENTITY_AUTHORITY_EXPORT_TYPE_V1,
    ENTITY_AUTHORITY_IMPORT_RECEIPT_TYPE_V1, ENTITY_AUTHORITY_IMPORT_TYPE_V2, ENTITY_AUTHORITY_SNAPSHOT_TYPE_V2,
    ENTITY_COMPATIBILITY_EXPORT_TYPE_V1, ENTITY_COMPATIBILITY_IMPORT_TYPE_V1, ENTITY_COMPATIBILITY_RECORD_TYPE_V1,
    INTEGRATED_RUNTIME_LEGACY_MIGRATION_SCHEMA_V1, IntegratedRuntimeBatchV2, IntegratedRuntimeConfigV2,
    IntegratedRuntimeError, IntegratedRuntimeIdentityV2, IntegratedRuntimeLegacyMigrationV1,
    IntegratedRuntimeReceiptV2, IntegratedRuntimeV2, PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
    PLAYER_BOOTSTRAP_STATUS_TYPE_V1, PLAYER_INVENTORY_IMPORT_RECEIPT_TYPE_V1, PLAYER_INVENTORY_IMPORT_TYPE_V1,
    RuntimeCommandCacheLookupV1, SIMULATION_CAMERA_CONFIG_RECEIPT_TYPE_V1, SIMULATION_CAMERA_CONFIG_TYPE_V1,
    SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V3, SIMULATION_PLAYER_BIND_TYPE_V3, TERRAIN_RESIDENCY_BATCH_TYPE_V1,
    TERRAIN_RESIDENCY_RECEIPT_TYPE_V1, TERRAIN_RESIDENCY_RECONCILE_BATCH_TYPE_V2,
    TERRAIN_RESIDENCY_RECONCILE_RECEIPT_TYPE_V2, WorldViewExtractionInputV1, decode_content_install_page_v1,
    decode_entity_authority_export_v1, decode_entity_authority_import_v2, decode_entity_command_batch_v1,
    decode_entity_compatibility_export_v1, decode_entity_compatibility_import_v1, decode_gameplay_actor_grant_v1,
    decode_gameplay_batch_v1, decode_network_agent_grant_v1, decode_network_command_release_v1,
    decode_network_delta_build_request_v1, decode_network_peer_grant_v1, decode_network_peer_release_v1,
    decode_network_reconnect_request_v1, decode_network_replication_record_v1, decode_player_bootstrap_status_query_v1,
    decode_player_inventory_import_v1, decode_runtime_camera_config_v1, decode_runtime_persistence_dispatch_v1,
    decode_runtime_player_binding_v1, decode_terrain_residency_batch_v1, decode_terrain_residency_reconcile_batch_v2,
    encode_content_install_receipt_v1, encode_entity_authority_import_receipt_v1, encode_entity_event_batch_v1,
    encode_gameplay_receipt_v1, encode_player_bootstrap_status_v1, encode_player_inventory_import_receipt_v1,
    encode_runtime_camera_config_receipt_v1, encode_runtime_persistence_dispatch_receipt_v1,
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
    PERSISTENCE_DISPATCH_TYPE_V1, PERSISTENCE_REQUEST_TYPE_V1, RUNTIME_BULK_MAX_PENDING_V1,
    RUNTIME_BULK_MAX_QUEUED_BYTES_V1, RuntimeBulkEncodedV1, RuntimeBulkRequestV1, RuntimeBulkResponseV1,
    RuntimeBulkSaveStageStateV1, RuntimeBulkStateV1, RuntimeCommandBatchV1, RuntimeCommandReceiptV1, RuntimeConfigV1,
    RuntimeDomainOperationV1, RuntimeDomainV1, RuntimeExtractionV1, RuntimeIdentityV1, RuntimeRequestV1,
    RuntimeResponseV1, RuntimeRevisionV1, SIMULATION_PLAYER_BIND_RECEIPT_TYPE_V2, SIMULATION_PLAYER_BIND_TYPE_V2,
    WireHash, command_receipt_hash_v1, decode_bulk_request_v1, decode_request_v1, encode_bulk_response_v1,
    encode_response_v1, extraction_checksum_v1, wire_checksum_v1,
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
const DOMAIN_VIEW_SCHEMA_V1: u16 = 1;
const DOMAIN_VIEW_MAX_RECORDS_V1: usize = 2_048;
// Eight views plus the independently capped 4 MiB BWR6 entity stream must fit
// the 8 MiB Worker control envelope with audio/diagnostic headroom.
const DOMAIN_VIEW_MAX_BYTES_V1: usize = 384 * 1_024;
const DOMAIN_VIEW_MAX_FIELDS_V1: usize = 2_048;
const DOMAIN_VIEW_MAX_BLOCKERS_V1: usize = 32;
const DOMAIN_VIEW_COUNT_V1: u16 = 8;
const AUDIO_EXTRACTION_SCHEMA_V2: u16 = 2;
const CAPABILITIES: [&str; 15] = [
    "awaited-receipts-v1",
    "bounded-entity-extraction-v1",
    "bounded-extraction-v1-pending-live-domain-views",
    "bounded-extraction-blockers-v1",
    "bulk-platform-v1",
    "content-bundle-install-v1",
    "entity-authority-snapshot-v2",
    "entity-command-v1",
    "entity-compatibility-bridge-v1",
    "fixed-step-input-v1-pending-live-cutover",
    "gameplay-command-v1",
    "integrated-runtime-v1",
    "network-authority-v1",
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
    runtimes: BTreeMap<u32, IntegratedRuntimeV2>,
    bulk_attachments: BTreeMap<(u32, u64), Vec<u8>>,
    extraction_cursors: BTreeMap<u32, RuntimeExtractionCursorV1>,
}

impl IntegratedRuntimeStoreV2 {
    fn insert(&mut self, runtime: IntegratedRuntimeV2) -> u32 {
        self.next_handle = self.next_handle.wrapping_add(1).max(1);
        while self.runtimes.contains_key(&self.next_handle) {
            self.next_handle = self.next_handle.wrapping_add(1).max(1);
        }
        let handle = self.next_handle;
        self.extraction_cursors.remove(&handle);
        self.runtimes.insert(handle, runtime);
        handle
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
        let mut extraction = RuntimeExtractionV1 {
            identity: identity.clone(),
            extraction_revision,
            render: encode_render_extraction_at(runtime, extraction_revision),
            hud: encode_hud_extraction_at(runtime, extraction_revision, camera.as_ref()),
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
    let mut candidate = runtime.clone();
    let mut receipts = Vec::with_capacity(batch.operations.len());
    let mut deferred_final_bind_receipts = Vec::<(usize, WireHash)>::new();
    for (index, operation) in batch.operations.iter().enumerate() {
        let expected_schema = match (operation.domain, operation.type_id.as_str()) {
            (RuntimeDomainV1::Simulation, SIMULATION_PLAYER_BIND_TYPE_V2) => 2,
            (RuntimeDomainV1::Simulation, SIMULATION_PLAYER_BIND_TYPE_V3) => 3,
            (RuntimeDomainV1::World, TERRAIN_RESIDENCY_RECONCILE_BATCH_TYPE_V2) => 2,
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
                    domain_ack(*b"BWB6", operation, &candidate),
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
                    domain_ack(*b"BWK7", operation, &candidate),
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
                    domain_ack(*b"BWP9", operation, &candidate),
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
                    domain_ack(*b"BWJ9", operation, &candidate),
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
                    domain_ack(*b"BWI9", operation, &candidate),
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
                    domain_ack(*b"BWR9", operation, &candidate),
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
                    domain_ack(*b"BWL9", operation, &candidate),
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
                    domain_ack(*b"BWM9", operation, &candidate),
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
    for (receipt_index, request_hash) in deferred_final_bind_receipts {
        receipts[receipt_index] = domain_operation_with_schema(
            RuntimeDomainV1::Simulation,
            SIMULATION_PLAYER_BIND_FINAL_RECEIPT_TYPE_V3,
            3,
            final_bind_ack(request_hash, &candidate),
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

fn domain_ack(magic: [u8; 4], operation: &RuntimeDomainOperationV1, runtime: &IntegratedRuntimeV2) -> Vec<u8> {
    let mut payload = Vec::with_capacity(38);
    payload.extend_from_slice(&magic);
    payload.extend_from_slice(&1_u16.to_le_bytes());
    payload.extend_from_slice(&operation.payload_hash.0);
    payload.extend_from_slice(runtime.state_hash().as_bytes());
    payload
}

fn final_bind_ack(request_hash: WireHash, runtime: &IntegratedRuntimeV2) -> Vec<u8> {
    let mut payload = Vec::with_capacity(38);
    payload.extend_from_slice(b"BWF6");
    payload.extend_from_slice(&1_u16.to_le_bytes());
    payload.extend_from_slice(&request_hash.0);
    payload.extend_from_slice(runtime.state_hash().as_bytes());
    payload
}

fn encode_delta_build_response(packet: &[u8], stats: &InterestSelectionStatsV1) -> Vec<u8> {
    let mut payload = Vec::with_capacity(22 + packet.len());
    payload.extend_from_slice(b"BWH9");
    payload.extend_from_slice(&1_u16.to_le_bytes());
    payload.extend_from_slice(&(stats.scope_probes as u32).to_le_bytes());
    payload.extend_from_slice(&(stats.candidate_records as u32).to_le_bytes());
    payload.extend_from_slice(&(stats.emitted_records as u32).to_le_bytes());
    payload.extend_from_slice(&(packet.len() as u32).to_le_bytes());
    payload.extend_from_slice(packet);
    payload
}

fn encode_reconnect_response(packet: Option<&[u8]>) -> Vec<u8> {
    let mut payload = Vec::with_capacity(11 + packet.map_or(0, <[u8]>::len));
    payload.extend_from_slice(b"BWC9");
    payload.extend_from_slice(&1_u16.to_le_bytes());
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

fn encode_render_extraction_at(runtime: &IntegratedRuntimeV2, extraction_revision: u64) -> Vec<u8> {
    let entities = runtime.entities();
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
        let encoded = encode_render_entity_record(runtime, &candidate);
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

fn encode_render_entity_record(runtime: &IntegratedRuntimeV2, source: &RenderEntityExtractionSourceV3<'_>) -> Vec<u8> {
    let record = source.record;
    let components = source.components;
    let model_key = record
        .custom
        .get("modelKey")
        .or_else(|| record.custom.get("model"))
        .map_or(record.kind_key.as_str(), String::as_str);
    let (model_hash, model_revision) = runtime
        .entity_model_content_identity(model_key, &record.kind_key)
        .unwrap_or_default();
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
    ($dropped:expr) => {{
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
        row
    }};
}

macro_rules! machine_anchor_world_view_row {
    ($machine:expr) => {{
        let machine = $machine;
        let anchor = &machine.anchor;
        let mut row = domain_row(5, format!("anchor:{}", anchor.machine_id), anchor.revision);
        string_field(&mut row, "machineId", &anchor.machine_id);
        string_field(&mut row, "presentationId", &anchor.presentation_id);
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
        ] {
            bool_field(&mut row, key, value);
        }
        u64_field(&mut row, "contactFlags", u64::from(player.contact_flags));
        u64_field(&mut row, "selectedSlot", u64::from(player.selected_slot));
        i64_field(&mut row, "lookPitch", i64::from(player.look_pitch));
        u64_field(&mut row, "buttons", u64::from(player.buttons));
        u64_field(&mut row, "flags", u64::from(player.flags));
        u64_field(&mut row, "lastInputSequence", player.last_input_sequence);
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
    let mut blockers = Vec::new();
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
    if let Some(world_view) = world_view {
        for dropped in &world_view.dropped_items {
            rows.push(dropped_item_world_view_row!(dropped));
        }
    }
    let blockers = if world_view.is_some() {
        Vec::new()
    } else {
        vec![
            "dropped-item-spatial-state-not-authoritative".into(),
            "world-view-extraction-invariant-rejected".into(),
        ]
    };
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
    if let Some(world_view) = world_view {
        for machine in &world_view.machines {
            rows.push(machine_anchor_world_view_row!(machine));
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
    for (record_id, combatant) in &state.combatants {
        let mut row = domain_row(1, format!("combatant:{record_id}"), combatant.revision);
        option_string_field(&mut row, "ownerId", combatant.owner_id.as_deref());
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
        string_field(&mut row, "contentId", &summon.content_id);
        string_field(&mut row, "ownerId", &summon.owner_id);
        u64_field(&mut row, "spawnedTick", summon.spawned_tick);
        bool_field(&mut row, "expiresTick.present", summon.expires_tick.is_some());
        if let Some(value) = summon.expires_tick {
            u64_field(&mut row, "expiresTick.value", value);
        }
        bool_field(&mut row, "grounded", summon.grounded);
        rows.push(row);
    }
    DomainViewV1 {
        domain: 5,
        revision: runtime.gameplay().state.revision.combat,
        status: DomainViewStatusV1::Partial,
        rows,
        blockers: vec!["combat-projectile-and-summon-render-presentation-not-authoritative".into()],
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

fn domain_views(runtime: &IntegratedRuntimeV2) -> Vec<DomainViewV1> {
    domain_views_with_world_view_result(runtime, runtime.world_view_extraction())
}

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
    encode_hud_extraction_at(runtime, runtime_extraction_revision(runtime), None)
}

fn encode_hud_extraction_at(
    runtime: &IntegratedRuntimeV2,
    extraction_revision: u64,
    camera: Option<&CameraExtractionV1>,
) -> Vec<u8> {
    let identity = runtime.identity();
    let world_view = runtime.world_view_extraction();
    let views = domain_views_with_context(runtime, world_view.as_ref().ok(), extraction_revision, camera);
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
    if extraction_promotion_ready(runtime) {
        values.retain(|value| value != "bounded-extraction-v1-pending-live-domain-views");
        values.push("bounded-extraction-v1".into());
    }
    if runtime.native_save_ready() {
        values.push("native-save-hydration-v1".into());
    }
    values
}

fn extraction_promotion_ready(runtime: &IntegratedRuntimeV2) -> bool {
    domain_views(runtime).iter().all(|view| {
        if view.status != DomainViewStatusV1::Complete
            || !view.blockers.is_empty()
            || view.rows.len() > DOMAIN_VIEW_MAX_RECORDS_V1
        {
            return false;
        }
        let mut bytes = 0_usize;
        for row in &view.rows {
            let Some(encoded) = encode_domain_row(row) else {
                return false;
            };
            bytes = bytes.saturating_add(encoded.len());
            if bytes > DOMAIN_VIEW_MAX_BYTES_V1 {
                return false;
            }
        }
        true
    })
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

fn encode(response: RuntimeResponseV1) -> Vec<u8> {
    encode_response_v1(&response).unwrap_or_default()
}

fn encode_bulk_control(
    handle: u32,
    response: RuntimeBulkResponseV1,
    attachments: &mut BTreeMap<(u32, u64), Vec<u8>>,
) -> Vec<u8> {
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
    let Ok(RuntimeBulkEncodedV1 { control, attachment }) = encode_bulk_response_v1(&response) else {
        return Vec::new();
    };
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
            return encode_bulk_response_v1(&RuntimeBulkResponseV1::Error {
                request_id,
                client_epoch,
                worker_epoch,
                code: code.into(),
                message: message.into(),
                current: Some(current),
            })
            .map_or_else(|_| Vec::new(), |encoded| encoded.control);
        }
        attachments.insert((handle, token), attachment);
    }
    control
}

#[cfg(test)]
mod tests {
    use blockwild_authority::{
        BlockCatalogV1, WorldAddressV1, WorldAuthorityRevisionV1, WorldAuthorityStoreR4V1,
        encode_compatibility_save_binary_v1,
    };
    use blockwild_engine::{
        ContainerKey, EntityAuthorityExportWireV1, EntityAuthorityImportWireV2, EntityCompatibilityExportWireV1,
        EntityCompatibilityImportWireV1, ImportPlayerInventoryV1, ItemStack, LEGACY_STATE_PLAYER_V1,
        PlayerBootstrapStatusQueryWireV1, PlayerInventoryImportWireV1, RuntimeCameraConfigWireV1,
        RuntimePersistenceDispatchWireV1, RuntimePlayerBindingWireV1, decode_entity_authority_import_receipt_v1,
        decode_entity_event_batch_v1, decode_player_bootstrap_status_v1, decode_player_inventory_import_receipt_v1,
        decode_runtime_camera_config_receipt_v1, encode_entity_authority_export_v1, encode_entity_authority_import_v2,
        encode_entity_command_batch_v1, encode_entity_compatibility_export_v1, encode_entity_compatibility_import_v1,
        encode_player_bootstrap_status_query_v1, encode_player_inventory_import_v1, encode_runtime_camera_config_v1,
        encode_runtime_persistence_dispatch_v1, encode_runtime_player_binding_v1,
    };
    use blockwild_entity::{
        ActionState, DespawnReason, ENTITY_COMMAND_SCHEMA, EntityClass, EntityCommand, EntityCommandBatch,
        EntityCompatibilityRecord, EntityComponents, EntityResidency, EquipmentSlotState, MountSeat,
        Vec3 as EntityVec3,
    };
    use blockwild_runtime_wire::{
        DEFAULT_GENERATION_OPTIONS_JSON_V1, DEFAULT_TERRAIN_CONTENT_HASH_V2, MAX_EXTRACTION_BYTES,
        RuntimeBulkRequestV1, RuntimeBulkResponseV1, RuntimeBulkStateV1, RuntimeInputFrameV1, RuntimeRequestV1,
        RuntimeRevisionV1, decode_bulk_response_v1, decode_response_v1, encode_bulk_request_v1, encode_request_v1,
        seal_runtime_command_batch_v1,
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

    fn insert_test_runtime(runtime: IntegratedRuntimeV2) -> (u32, RuntimeIdentityV1) {
        let identity = wire_identity(&runtime.identity());
        let handle = INTEGRATED_RUNTIMES.with(|store| store.borrow_mut().insert(runtime));
        (handle, identity)
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
        assert!(has_capability("fixed-step-input-v1-pending-live-cutover"));
        assert!(has_capability("bounded-extraction-v1-pending-live-domain-views"));
        assert!(!has_capability("fixed-step-input-v1"));
        assert!(!has_capability("bounded-extraction-v1"));
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
            &blockwild_runtime_migrate_legacy_v2(runtime_handle, &finalize_wire.control, 0, &projection),
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
            dropped_item_world_view_row!(&drop),
            machine_anchor_world_view_row!(&machine),
            celestial_body_world_view_row!(&celestial, 8),
        ];
        assert_eq!(rows.iter().map(|row| row.kind).collect::<Vec<_>>(), [6, 5, 5]);
        assert!(
            rows.iter()
                .all(|row| !row.fields.is_empty() && domain_row_revision(row) != 0)
        );
        assert!(rows[0].fields.contains_key("stack.metadataHash"));
        assert!(rows[1].fields.contains_key("light.luminousFluxMillilumens"));
        assert!(rows[2].fields.contains_key("angularRadiusMicrodegrees"));
        assert!(rows.iter().all(|row| encode_domain_row(row).is_some()));
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
        assert_eq!(first.hud, encode_hud_extraction_at(&baseline, 1, Some(&camera)));

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
        assert_eq!(legacy.hud, encode_hud_extraction_at(&baseline, 4, None));
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
        let render = encode_render_extraction_at(&runtime, 1);
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
    fn world_view_domains_close_only_serialized_authority_and_stay_pending() {
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
        assert!(!extraction_promotion_ready(&runtime));
        let capabilities = capabilities(&runtime);
        assert!(
            capabilities
                .iter()
                .any(|value| value == "bounded-extraction-v1-pending-live-domain-views")
        );
        assert!(
            capabilities
                .iter()
                .any(|value| value == "bounded-extraction-blockers-v1")
        );
        assert!(!capabilities.iter().any(|value| value == "bounded-extraction-v1"));

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
        encode_hud_extraction_at(&runtime, 1, Some(&camera))
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
