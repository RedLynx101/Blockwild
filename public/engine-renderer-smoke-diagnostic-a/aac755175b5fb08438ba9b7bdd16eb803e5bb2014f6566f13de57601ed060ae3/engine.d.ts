/* tslint:disable */
/* eslint-disable */

export function blockwild_engine_create(config_envelope: Uint8Array): Uint8Array;

export function blockwild_engine_destroy(handle: number): Uint8Array;

export function blockwild_engine_ingest(handle: number, batch: Uint8Array): Uint8Array;

export function blockwild_engine_state_hash(handle: number): Uint8Array;

export function blockwild_engine_step(handle: number, monotonic_time_us: number, budget_us: number): Uint8Array;

export function blockwild_engine_take_events(handle: number): Uint8Array;

/**
 * Generate one complete generator-v18 chunk through the coarse BWR2 packet
 * contract. Malformed or unsupported requests fail closed as an empty result;
 * the browser bridge rejects that before any authoritative installation.
 */
export function blockwild_generate_chunk_v2(request: Uint8Array): Uint8Array;

/**
 * Checked-in exact-parity certificate for the fail-closed R3 corpus.
 */
export function blockwild_generation_parity_certificate_v2(): Uint8Array;

export function blockwild_locator_parity_certificate_v1(): Uint8Array;

export function blockwild_protocol_version(): number;

export function blockwild_query_dragon_lair_v1(request: Uint8Array): Uint8Array;

/**
 * Independently selects the nearest eligible settlement and its canonical
 * public arrival through the bounded Rust planner query contract.
 */
export function blockwild_query_settlements_v1(request: Uint8Array): Uint8Array;

/**
 * Run the real browser-WebGPU offscreen smoke path and return capability diagnostics.
 */
export function blockwild_render_smoke(): Promise<string>;

/**
 * Canonical scene bytes consumed by both the Three.js oracle and `wgpu` smoke path.
 */
export function blockwild_render_smoke_fixture(): Uint8Array;

/**
 * Return the validated BWRM V1 canonical root as 16 raw bytes. Empty output
 * means validation failed; this does not persist or adopt the envelope.
 */
export function blockwild_rich_save_migration_root_v1(envelope_bytes: Uint8Array): Uint8Array;

/**
 * Validate one complete BWRM V1 envelope against a caller-retained root and
 * return its canonical bytes. Empty output is the fail-closed result for a
 * malformed envelope, wrong root, or non-canonical encoding.
 */
export function blockwild_rich_save_migration_roundtrip_v1(envelope_bytes: Uint8Array, expected_root: Uint8Array): Uint8Array;

/**
 * Moves one Rust-owned platform attachment out of Wasm exactly once.
 */
export function blockwild_runtime_bulk_take_attachment_v2(handle: number, transfer_token: number): Uint8Array;

/**
 * Lower-priority detached platform lane. Rust owns request identity,
 * backpressure, retry policy, durable receipt validation, and dispatcher
 * revisions. TypeScript only executes one complete opaque BWPR and returns
 * its exact BWPA under the Rust-issued transfer token.
 */
export function blockwild_runtime_bulk_v2(handle: number, control_bytes: Uint8Array, attachment_bytes: Uint8Array): Uint8Array;

/**
 * Applies one reliable command envelope and returns one deterministic receipt.
 * Unknown domain payloads reject rather than being silently discarded.
 */
export function blockwild_runtime_command_v2(handle: number, request_bytes: Uint8Array): Uint8Array;

/**
 * Creates a fresh integrated runtime or atomically restores one exact R8
 * checkpoint before assigning a Worker-generation handle.
 */
export function blockwild_runtime_create_v2(request_bytes: Uint8Array): Uint8Array;

/**
 * Destroys the generational handle. A stale expected identity is rejected and
 * leaves the authority alive for an explicit synchronized retry.
 */
export function blockwild_runtime_destroy_v2(handle: number, request_bytes: Uint8Array): Uint8Array;

/**
 * Exports one exact, bounded Worker-replacement checkpoint. Large durable
 * browser saves remain on the detached chunked persistence lane.
 */
export function blockwild_runtime_export_save_v2(handle: number, request_bytes: Uint8Array): Uint8Array;

/**
 * Returns one bounded renderer-neutral extraction. Entity/model identity,
 * transforms, health, protection, input/HUD state, and diagnostics are copied
 * once per coarse extraction rather than queried per object.
 */
export function blockwild_runtime_extract_v2(handle: number, request_bytes: Uint8Array): Uint8Array;

/**
 * Creates the first canonical save set for a new native world without
 * fabricating a legacy WorldSave source. The control payload reuses the
 * bounded `FinalizeSave` identity/timestamp shape. Worlds that already own
 * compatibility source bytes fail closed so this route cannot delete them.
 */
export function blockwild_runtime_initialize_native_save_v2(handle: number, control_bytes: Uint8Array): Uint8Array;

/**
 * Migrates a provably world-only legacy source after that exact source has
 * been streamed into `stage_id` through `StageSaveChunk`. The control is an
 * ordinary `FinalizeSave` bulk request, while `world_projection_bytes` is one
 * validated BWAS record. Non-zero legacy state flags fail closed and leave the
 * source stage intact for a richer host-domain adapter.
 */
export function blockwild_runtime_migrate_legacy_v2(handle: number, control_bytes: Uint8Array, legacy_non_world_state_flags: number, source_key: string, source_format: string, world_projection_bytes: Uint8Array): Uint8Array;

/**
 * Advances bounded fixed steps after atomically accepting the complete,
 * strictly sequenced input batch into Rust-owned authority.
 */
export function blockwild_runtime_step_v2(handle: number, request_bytes: Uint8Array): Uint8Array;

export function blockwild_schema_version(): number;

/**
 * Create one long-lived R4 authority. The request includes the complete
 * directional/waterlogging catalog required to preserve mutation semantics.
 */
export function blockwild_world_authority_create_r4(request_bytes: Uint8Array): Uint8Array;

/**
 * Destroy a live R4 authority. Destruction is identity-bound so an obsolete
 * worker cannot tear down a replacement authority that reused a request path.
 */
export function blockwild_world_authority_destroy_r4(handle: number, request_bytes: Uint8Array): Uint8Array;

/**
 * Execute a bounded R4 authority request against a live handle.
 */
export function blockwild_world_authority_request_r4(handle: number, request_bytes: Uint8Array): Uint8Array;

/**
 * Rebuild packed sky/R/G/B light for one complete section. `direct_sky_above`
 * is exactly 256 nibble levels in x + 16*z order. The result uses the same
 * `BWL1`/`BWI1`/`BWE1` coarse-payload convention as meshing.
 */
export function blockwild_world_light_section_v1(snapshot_bytes: Uint8Array, registry_bytes: Uint8Array, direct_sky_above: Uint8Array): Uint8Array;

/**
 * Validate and mesh one complete R2 section. The returned payload begins with
 * `BWM1` on success, `BWI1` when the whole section must fall back to the
 * TypeScript oracle, or `BWE1` on malformed input. This is intentionally one
 * coarse call per section, never one call per voxel.
 */
export function blockwild_world_mesh_section_v1(snapshot_bytes: Uint8Array, registry_bytes: Uint8Array): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly blockwild_engine_create: (a: number, b: number, c: number) => void;
    readonly blockwild_engine_destroy: (a: number, b: number) => void;
    readonly blockwild_engine_ingest: (a: number, b: number, c: number, d: number) => void;
    readonly blockwild_engine_state_hash: (a: number, b: number) => void;
    readonly blockwild_engine_step: (a: number, b: number, c: number, d: number) => void;
    readonly blockwild_engine_take_events: (a: number, b: number) => void;
    readonly blockwild_generate_chunk_v2: (a: number, b: number, c: number) => void;
    readonly blockwild_generation_parity_certificate_v2: (a: number) => void;
    readonly blockwild_locator_parity_certificate_v1: (a: number) => void;
    readonly blockwild_protocol_version: () => number;
    readonly blockwild_query_dragon_lair_v1: (a: number, b: number, c: number) => void;
    readonly blockwild_query_settlements_v1: (a: number, b: number, c: number) => void;
    readonly blockwild_render_smoke: () => number;
    readonly blockwild_render_smoke_fixture: (a: number) => void;
    readonly blockwild_rich_save_migration_root_v1: (a: number, b: number, c: number) => void;
    readonly blockwild_rich_save_migration_roundtrip_v1: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly blockwild_runtime_bulk_take_attachment_v2: (a: number, b: number, c: number) => void;
    readonly blockwild_runtime_bulk_v2: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly blockwild_runtime_command_v2: (a: number, b: number, c: number, d: number) => void;
    readonly blockwild_runtime_create_v2: (a: number, b: number, c: number) => void;
    readonly blockwild_runtime_destroy_v2: (a: number, b: number, c: number, d: number) => void;
    readonly blockwild_runtime_export_save_v2: (a: number, b: number, c: number, d: number) => void;
    readonly blockwild_runtime_extract_v2: (a: number, b: number, c: number, d: number) => void;
    readonly blockwild_runtime_initialize_native_save_v2: (a: number, b: number, c: number, d: number) => void;
    readonly blockwild_runtime_migrate_legacy_v2: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly blockwild_runtime_step_v2: (a: number, b: number, c: number, d: number) => void;
    readonly blockwild_world_authority_create_r4: (a: number, b: number, c: number) => void;
    readonly blockwild_world_authority_destroy_r4: (a: number, b: number, c: number, d: number) => void;
    readonly blockwild_world_authority_request_r4: (a: number, b: number, c: number, d: number) => void;
    readonly blockwild_world_light_section_v1: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly blockwild_world_mesh_section_v1: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly blockwild_schema_version: () => number;
    readonly __wasm_bindgen_func_elem_1852: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_920: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_920_2: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_920_3: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_1866: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export5: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
