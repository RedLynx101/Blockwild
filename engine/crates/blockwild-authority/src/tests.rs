use std::collections::BTreeSet;

use crate::*;

const HASH_A: &str = "11111111111111111111111111111111";
const HASH_B: &str = "22222222222222222222222222222222";

fn address(location: &str) -> WorldAddressV1 {
    WorldAddressV1::new("1", location).expect("valid fixture address")
}

fn catalog() -> BlockCatalogV1 {
    BlockCatalogV1 {
        directional_blocks: BTreeSet::from([20]),
        waterlogged_blocks: BTreeSet::from([52]),
        water_block_id: 7,
    }
}

fn section_address(world: &WorldAddressV1, chunk_x: i32, chunk_z: i32, section_y: i16) -> WorldSectionAddressV1 {
    WorldSectionAddressV1 {
        world: world.clone(),
        chunk_x,
        chunk_z,
        section_y,
    }
}

fn empty_install(address: WorldSectionAddressV1, revision: u64) -> SectionInstallV1 {
    SectionInstallV1 {
        address,
        cells: vec![WorldCellV1::default(); WORLD_SECTION_CELL_COUNT_V1],
        source_revision: revision,
        source_hash: HASH_A.into(),
    }
}

fn empty_auxiliary(address: WorldChunkAddressV1) -> ChunkAuxiliaryDataV1 {
    ChunkAuxiliaryDataV1 {
        address,
        source_revision: 1,
        source_hash: HASH_A.into(),
        heightmap: vec![0; WORLD_CHUNK_COLUMN_COUNT_V1],
        biomes: vec![0; WORLD_CHUNK_COLUMN_COUNT_V1],
        section_block_counts: vec![0; WORLD_SECTION_COUNT_V1 as usize],
        sky_tops: vec![0; WORLD_CHUNK_COLUMN_COUNT_V1],
        light: vec![0; WORLD_CHUNK_CELL_COUNT_V1],
        light_indices: Vec::new(),
        leaf_indices: Vec::new(),
        markers: vec![("0,0,0".into(), "[\"0,0,0\",{\"type\":\"fixture\"}]".into())],
    }
}

fn batch(
    store: &WorldAuthorityStoreR4V1,
    batch_id: &str,
    commands: Vec<WorldMutationCommandR4V1>,
) -> WorldMutationBatchR4V1 {
    WorldMutationBatchR4V1 {
        schema_version: WORLD_AUTHORITY_SCHEMA_V1,
        batch_id: batch_id.into(),
        authority_id: "host-test".into(),
        address: store.active_address().clone(),
        expected_revision: store.revision(),
        commands,
    }
}

#[test]
fn canonical_store_hash_covers_cells_and_pending_residency() {
    let world = address("canonical");
    let mut first = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    let mut second = first.clone();
    assert_eq!(first.canonical_state_hash(), second.canonical_state_hash());

    first
        .install_section_for_replay(empty_install(section_address(&world, 0, 0, 4), 1))
        .expect("install");
    assert_ne!(first.canonical_state_hash(), second.canonical_state_hash());
    second
        .install_section_for_replay(empty_install(section_address(&world, 0, 0, 4), 1))
        .expect("install");
    assert_eq!(first.canonical_state_hash(), second.canonical_state_hash());

    let epoch = first.revision().epoch;
    first
        .scheduler_mut()
        .submit(ResidencyRequestV1 {
            request_id: 1,
            epoch,
            address: section_address(&world, 1, 0, 4),
            class: ResidencyPriorityClassV1::MovementForward,
            purpose: ResidencyPurposeV1::Generate,
            distance_squared: 16,
            direction_penalty: 2,
            sequence: 1,
        })
        .expect("queue");
    assert_ne!(first.canonical_state_hash(), second.canonical_state_hash());
}

#[test]
fn incremental_journal_digest_matches_equal_final_state_across_edit_order() {
    let world = address("journal-digest");
    let mut first = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("first store");
    let mut second = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("second store");
    let install = empty_install(section_address(&world, 0, 0, 4), 1);
    first
        .install_section_for_replay(install.clone())
        .expect("first install");
    second.install_section_for_replay(install).expect("second install");
    let left = CellPositionV1 { x: 1, y: 0, z: 1 };
    let right = CellPositionV1 { x: 2, y: 0, z: 1 };
    for (store, positions) in [(&mut first, [left, right]), (&mut second, [right, left])] {
        for (index, position) in positions.into_iter().enumerate() {
            let receipt = store.apply_mutation_batch(batch(
                store,
                &format!("ordered-{index}"),
                vec![WorldMutationCommandR4V1::SetBlock {
                    position,
                    block_id: 3,
                    facing: None,
                }],
            ));
            assert!(matches!(
                receipt,
                WorldMutationReceiptR4V1::Accepted { mutated: true, .. }
            ));
        }
    }
    assert_eq!(first.edit_journal(), second.edit_journal());
    assert_eq!(first.canonical_state_hash(), second.canonical_state_hash());

    for store in [&mut first, &mut second] {
        let receipt = store.apply_mutation_batch(batch(
            store,
            "replace",
            vec![WorldMutationCommandR4V1::SetBlock {
                position: left,
                block_id: 4,
                facing: None,
            }],
        ));
        assert!(matches!(
            receipt,
            WorldMutationReceiptR4V1::Accepted { mutated: true, .. }
        ));
    }
    assert_eq!(first.canonical_state_hash(), second.canonical_state_hash());
}

#[test]
fn generated_chunk_auxiliary_is_authoritative_while_resident_and_evicts_with_last_section() {
    let world = address("auxiliary");
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    let chunk = WorldChunkAddressV1 {
        world: world.clone(),
        chunk_x: -2,
        chunk_z: 3,
    };
    store
        .install_section_for_replay(empty_install(section_address(&world, -2, 3, 0), 1))
        .expect("section zero");
    store
        .install_section_for_replay(empty_install(section_address(&world, -2, 3, 1), 1))
        .expect("section one");
    store
        .install_chunk_auxiliary(empty_auxiliary(chunk.clone()))
        .expect("auxiliary");
    assert_eq!(store.chunk_auxiliary(&chunk).unwrap().markers.len(), 1);
    assert!(store.evict_section(&section_address(&world, -2, 3, 0)));
    assert!(
        store.chunk_auxiliary(&chunk).is_some(),
        "remaining section retains chunk metadata"
    );
    assert!(store.evict_section(&section_address(&world, -2, 3, 1)));
    assert!(
        store.chunk_auxiliary(&chunk).is_none(),
        "last section eviction releases metadata"
    );
}

#[test]
fn exact_chunk_eviction_is_bounded_idempotent_and_preserves_authored_edits() {
    let world = address("exact-chunk-eviction");
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    let chunk = WorldChunkAddressV1 {
        world: world.clone(),
        chunk_x: -2,
        chunk_z: 3,
    };
    for section_y in 0_i16..WORLD_SECTION_COUNT_V1 as i16 {
        store
            .install_section_for_replay(empty_install(section_address(&world, -2, 3, section_y), 1))
            .expect("section");
    }
    store
        .install_chunk_auxiliary(empty_auxiliary(chunk.clone()))
        .expect("auxiliary");
    let edited = CellPositionV1 { x: -31, y: 1, z: 49 };
    assert!(matches!(
        store.apply_mutation_batch(batch(
            &store,
            "edit-before-eviction",
            vec![WorldMutationCommandR4V1::SetBlock {
                position: edited,
                block_id: 3,
                facing: None,
            }],
        )),
        WorldMutationReceiptR4V1::Accepted { mutated: true, .. }
    ));
    assert_eq!(store.resident_chunk_coordinates(), vec![(-2, 3)]);
    let revision_before = store.revision();
    assert_eq!(store.evict_chunk(&chunk), WORLD_SECTION_COUNT_V1 as u16);
    assert_eq!(store.resident_section_count(), 0);
    assert!(store.chunk_auxiliary(&chunk).is_none());
    assert!(store.resident_chunk_coordinates().is_empty());
    assert_eq!(store.edit_journal().get(&edited).map(|cell| cell.block_id), Some(3));
    assert_eq!(store.revision().residency, revision_before.residency + 1);

    let revision_after = store.revision();
    assert_eq!(store.evict_chunk(&chunk), 0);
    assert_eq!(
        store.revision(),
        revision_after,
        "idempotent eviction does not advance authority"
    );

    store
        .install_section_for_replay(empty_install(section_address(&world, -2, 3, edited.section_y()), 2))
        .expect("reinstall");
    assert!(matches!(
        store.read_cell(edited),
        WorldCellReadV1::Loaded { cell, .. } if cell.block_id == 3
    ));

    let auxiliary_only = WorldChunkAddressV1 {
        world,
        chunk_x: 8,
        chunk_z: -5,
    };
    store
        .install_chunk_auxiliary(empty_auxiliary(auxiliary_only.clone()))
        .expect("auxiliary-only fixture");
    assert_eq!(store.resident_chunk_coordinates(), vec![(-2, 3), (8, -5)]);
    let auxiliary_revision = store.revision();
    assert_eq!(store.evict_chunk(&auxiliary_only), 0);
    assert!(store.chunk_auxiliary(&auxiliary_only).is_none());
    assert_eq!(store.revision().residency, auxiliary_revision.residency + 1);
}

#[test]
fn auxiliary_light_patch_is_section_granular_revision_checked_and_atomic() {
    let world = address("auxiliary-patch");
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    let chunk = WorldChunkAddressV1 {
        world,
        chunk_x: -2,
        chunk_z: 10,
    };
    store
        .install_chunk_auxiliary(empty_auxiliary(chunk.clone()))
        .expect("base auxiliary");
    let mut light = vec![0_u16; WORLD_SECTION_CELL_COUNT_V1];
    light[17] = 0xf321;
    store
        .patch_chunk_auxiliary(ChunkAuxiliaryPatchV1 {
            address: chunk.clone(),
            expected_source_revision: 1,
            expected_source_hash: HASH_A.into(),
            source_revision: 2,
            source_hash: HASH_B.into(),
            light_sections: vec![(10, light)],
            section_block_counts: vec![(10, 7)],
            sky_tops: vec![(255, 42)],
            light_indices: Some(vec![17]),
            leaf_indices: None,
            markers: None,
        })
        .expect("patch");
    let patched = store.chunk_auxiliary(&chunk).expect("patched auxiliary");
    assert_eq!(patched.source_revision, 2);
    assert_eq!(patched.light[10 * WORLD_SECTION_CELL_COUNT_V1 + 17], 0xf321);
    assert_eq!(patched.light[9 * WORLD_SECTION_CELL_COUNT_V1 + 17], 0);
    assert_eq!(patched.section_block_counts[10], 7);
    assert_eq!(patched.sky_tops[255], 42);
    assert_eq!(patched.light_indices, vec![17]);

    let state_before_stale = store.canonical_state_hash();
    let stale = store.patch_chunk_auxiliary(ChunkAuxiliaryPatchV1 {
        address: chunk.clone(),
        expected_source_revision: 1,
        expected_source_hash: HASH_A.into(),
        source_revision: 3,
        source_hash: "33333333333333333333333333333333".into(),
        light_sections: vec![(0, vec![1; WORLD_SECTION_CELL_COUNT_V1])],
        section_block_counts: Vec::new(),
        sky_tops: Vec::new(),
        light_indices: None,
        leaf_indices: None,
        markers: None,
    });
    assert_eq!(stale.expect_err("stale patch").code, "chunk-auxiliary-stale");
    assert_eq!(store.canonical_state_hash(), state_before_stale);
}

#[test]
fn address_keys_and_floor_coordinates_match_typescript_contract() {
    let world = WorldAddressV1::new("solar system", "Hope/orbit").expect("address");
    assert_eq!(world.key(), "solar%20system@Hope%2Forbit");
    let position = CellPositionV1 { x: -1, y: -64, z: -17 };
    assert_eq!(position.chunk_x(), -1);
    assert_eq!(position.chunk_z(), -2);
    assert_eq!(position.section_y(), 0);
    assert_eq!(position.local_x(), 15);
    assert_eq!(position.local_z(), 15);
    assert_eq!(position.local_y(), 0);
    assert_eq!(position.section_index(), 255);
}

#[test]
fn immutable_page_preserves_unloaded_air_and_vertical_boundaries() {
    let world = address("overworld");
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    store
        .install_section_for_replay(empty_install(section_address(&world, -1, -1, 0), 7))
        .expect("install");
    let page = WorldReadPageV1::capture(
        &store,
        ReadOriginV1 { x: -1, y: -65, z: -1 },
        ReadSizeV1 { x: 18, y: 194, z: 1 },
    )
    .expect("page");
    assert!(matches!(
        page.read(CellPositionV1 { x: -1, y: -65, z: -1 }).expect("below"),
        WorldCellReadV1::Loaded {
            boundary: WorldBoundaryKindV1::BedrockBelowWorld,
            ..
        }
    ));
    assert!(matches!(
        page.read(CellPositionV1 { x: -1, y: -64, z: -1 }).expect("air"),
        WorldCellReadV1::Loaded {
            cell: WorldCellV1 { block_id: 0, .. },
            boundary: WorldBoundaryKindV1::None,
            ..
        }
    ));
    assert!(matches!(
        page.read(CellPositionV1 { x: 16, y: 0, z: -1 }).expect("unloaded"),
        WorldCellReadV1::Unloaded { .. }
    ));
    assert!(matches!(
        page.read(CellPositionV1 { x: -1, y: 128, z: -1 }).expect("above"),
        WorldCellReadV1::Loaded {
            boundary: WorldBoundaryKindV1::AirAboveWorld,
            ..
        }
    ));
    let old_hash = page.snapshot_hash.clone();
    let receipt = store.apply_mutation_batch(batch(
        &store,
        "after-page",
        vec![WorldMutationCommandR4V1::SetBlock {
            position: CellPositionV1 { x: -1, y: -64, z: -1 },
            block_id: 2,
            facing: None,
        }],
    ));
    assert!(matches!(
        receipt,
        WorldMutationReceiptR4V1::Accepted { mutated: true, .. }
    ));
    assert_eq!(
        page.snapshot_hash, old_hash,
        "captured page does not alias live storage"
    );
    assert_eq!(
        page.read(CellPositionV1 { x: -1, y: -64, z: -1 }).expect("old cell"),
        WorldCellReadV1::Loaded {
            position: CellPositionV1 { x: -1, y: -64, z: -1 },
            cell: WorldCellV1::default(),
            boundary: WorldBoundaryKindV1::None,
        }
    );
}

#[test]
fn full_height_read_page_orders_all_twelve_sections_by_canonical_key() {
    let world = address("twelve-sections");
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    for section_y in 0..WORLD_SECTION_COUNT_V1 {
        store
            .install_section_for_replay(empty_install(
                section_address(&world, 0, 0, i16::try_from(section_y).expect("section fits i16")),
                u64::try_from(section_y).expect("non-negative section") + 1,
            ))
            .expect("install section");
    }

    let page = WorldReadPageV1::capture(
        &store,
        ReadOriginV1 { x: 0, y: -64, z: 0 },
        ReadSizeV1 { x: 1, y: 192, z: 1 },
    )
    .expect("full-height page");
    let keys = page
        .section_revisions
        .iter()
        .map(|section| section.address.key())
        .collect::<Vec<_>>();
    let mut sorted_keys = keys.clone();
    sorted_keys.sort();

    assert_eq!(keys.len(), WORLD_SECTION_COUNT_V1 as usize);
    assert_eq!(keys, sorted_keys, "page revisions use canonical key order");
    let section_two = keys.iter().position(|key| key.ends_with(":2")).expect("section 2");
    let section_ten = keys.iter().position(|key| key.ends_with(":10")).expect("section 10");
    assert!(section_ten < section_two, "canonical lexical order places 10 before 2");
    page.validate().expect("canonical full-height page");
}

#[test]
fn mutation_preflight_is_atomic_and_noops_preserve_revision() {
    let world = address("atomic");
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    store
        .install_section_for_replay(empty_install(section_address(&world, 0, 0, 4), 1))
        .expect("install");
    let before = store.identity();
    let rejected = store.apply_mutation_batch(batch(
        &store,
        "atomic-reject",
        vec![
            WorldMutationCommandR4V1::SetBlock {
                position: CellPositionV1 { x: 0, y: 0, z: 0 },
                block_id: 2,
                facing: None,
            },
            WorldMutationCommandR4V1::SetBlock {
                position: CellPositionV1 { x: 16, y: 0, z: 0 },
                block_id: 2,
                facing: None,
            },
        ],
    ));
    assert!(matches!(
        rejected,
        WorldMutationReceiptR4V1::Rejected {
            code: MutationRejectionCodeR4V1::UnloadedCell,
            ..
        }
    ));
    assert_eq!(store.identity(), before);
    assert_eq!(
        store.read_cell(CellPositionV1 { x: 0, y: 0, z: 0 }),
        WorldCellReadV1::Loaded {
            position: CellPositionV1 { x: 0, y: 0, z: 0 },
            cell: WorldCellV1::default(),
            boundary: WorldBoundaryKindV1::None,
        }
    );
    let no_op = store.apply_mutation_batch(batch(
        &store,
        "noop",
        vec![WorldMutationCommandR4V1::SetBlock {
            position: CellPositionV1 { x: 0, y: 0, z: 0 },
            block_id: 0,
            facing: None,
        }],
    ));
    assert!(matches!(
        no_op,
        WorldMutationReceiptR4V1::Accepted { mutated: false, .. }
    ));
    assert_eq!(store.identity(), before);
}

#[test]
fn atomic_block_facing_and_liquid_commit_propagates_every_dirty_domain() {
    let world = address("edits");
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    store
        .install_section_for_replay(empty_install(section_address(&world, 0, 0, 1), 5))
        .expect("install");
    let position = CellPositionV1 { x: 15, y: -48, z: 15 };
    let receipt = store.apply_mutation_batch(batch(
        &store,
        "all-metadata",
        vec![
            WorldMutationCommandR4V1::SetLiquid {
                position,
                liquid: LiquidMetadataV1 {
                    kind: WorldLiquidKindV1::Water,
                    level: 8,
                    source: true,
                    falling: false,
                    contains_water: true,
                    waterlogged: true,
                },
            },
            WorldMutationCommandR4V1::SetFacing { position, facing: 2 },
            WorldMutationCommandR4V1::SetBlock {
                position,
                block_id: 20,
                facing: Some(3),
            },
        ],
    ));
    let WorldMutationReceiptR4V1::Accepted {
        mutated: true,
        changes,
        dirty,
        immediate_event: Some(event),
        delta: Some(delta),
        ..
    } = receipt
    else {
        panic!("mutation should be accepted");
    };
    assert_eq!(changes.len(), 1);
    assert_eq!(
        changes[0].current.facing, 2,
        "canonical block command runs before explicit facing"
    );
    assert_eq!(changes[0].current.liquid.kind, WorldLiquidKindV1::Water);
    assert_eq!(dirty.subsystem_seeds.len(), 7);
    assert_eq!(
        dirty
            .subsystem_seeds
            .iter()
            .map(|seed| seed.subsystem)
            .collect::<Vec<_>>(),
        DIRTY_SUBSYSTEMS_R4_V1
    );
    assert!(dirty.sections.iter().any(|section| section.chunk_x == 1));
    assert!(dirty.sections.iter().any(|section| section.chunk_z == 1));
    assert!(dirty.sections.iter().any(|section| section.section_y == 0));
    assert_eq!(event.changes, changes);
    assert_eq!(delta.changes, changes);
    assert_eq!(store.drain_immediate_events(), vec![*event]);
    let revision = store
        .current_section_revision(&position.section_address(&world))
        .expect("revision");
    assert_eq!(revision.blocks, store.revision().mutation);
    assert_eq!(revision.metadata, store.revision().mutation);
    assert_eq!(revision.halo, store.revision().mutation);
}

#[test]
fn facing_and_waterlogged_rules_match_current_oracle_semantics() {
    let world = address("catalog");
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    let mut install = empty_install(section_address(&world, 0, 0, 4), 1);
    let position = CellPositionV1 { x: 3, y: 0, z: 3 };
    install.cells[position.section_index()] = WorldCellV1 {
        block_id: 52,
        ..WorldCellV1::default()
    };
    store.install_section_for_replay(install).expect("install");
    let harvested = store.apply_mutation_batch(batch(
        &store,
        "harvest",
        vec![WorldMutationCommandR4V1::SetBlock {
            position,
            block_id: 0,
            facing: None,
        }],
    ));
    assert!(matches!(
        harvested,
        WorldMutationReceiptR4V1::Accepted { mutated: true, .. }
    ));
    let WorldCellReadV1::Loaded { cell, .. } = store.read_cell(position) else {
        panic!("loaded")
    };
    assert_eq!(cell.block_id, 7, "waterlogged removal restores configured water block");
    let bad_facing = store.apply_mutation_batch(batch(
        &store,
        "bad-facing",
        vec![WorldMutationCommandR4V1::SetFacing { position, facing: 1 }],
    ));
    assert!(matches!(
        bad_facing,
        WorldMutationReceiptR4V1::Rejected {
            code: MutationRejectionCodeR4V1::FacingNotSupported,
            ..
        }
    ));
}

#[test]
fn scheduler_has_stable_priority_cancellation_and_stale_rejection() {
    let world = address("scheduler");
    let section = |x, class, sequence| ResidencyRequestV1 {
        request_id: sequence,
        epoch: 1,
        address: section_address(&world, x, 0, 4),
        class,
        purpose: ResidencyPurposeV1::Generate,
        distance_squared: x.unsigned_abs(),
        direction_penalty: 0,
        sequence,
    };
    let mut scheduler = SectionResidencySchedulerV1::new(1);
    scheduler
        .submit(section(2, ResidencyPriorityClassV1::Background, 1))
        .expect("submit");
    scheduler
        .submit(section(5, ResidencyPriorityClassV1::OccupiedSupport, 2))
        .expect("submit");
    scheduler
        .submit(section(1, ResidencyPriorityClassV1::OccupiedSupport, 3))
        .expect("submit");
    assert!(scheduler.cancel(3));
    let revision = WorldAuthorityRevisionV1 {
        epoch: 1,
        mutation: 0,
        residency: 0,
    };
    let first = scheduler
        .start_next(revision, HASH_A.into())
        .expect("start")
        .expect("job");
    assert_eq!(
        first.request.request_id, 2,
        "class dominates distance and cancelled work is skipped"
    );
    assert!(matches!(
        scheduler.finish(&first, revision),
        ResidencyCompletionV1::Accepted(_)
    ));
    let background = scheduler
        .start_next(revision, HASH_A.into())
        .expect("start")
        .expect("job");
    assert_eq!(background.request.request_id, 1);
    assert_eq!(
        scheduler.finish(
            &background,
            WorldAuthorityRevisionV1 {
                mutation: 1,
                ..revision
            }
        ),
        ResidencyCompletionV1::StaleRevision
    );
    scheduler.reset(2);
    assert_eq!(scheduler.queued_len(), 0);
    assert_eq!(scheduler.active_len(), 0);
}

#[test]
fn residency_install_is_epoch_bound_and_applies_persistent_edits_after_reload() {
    let world = address("reload");
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    let section = section_address(&world, 0, 0, 4);
    store
        .install_section_for_replay(empty_install(section.clone(), 1))
        .expect("install");
    let position = CellPositionV1 { x: 2, y: 0, z: 2 };
    let edited = store.apply_mutation_batch(batch(
        &store,
        "persistent-edit",
        vec![WorldMutationCommandR4V1::SetBlock {
            position,
            block_id: 2,
            facing: None,
        }],
    ));
    assert!(matches!(
        edited,
        WorldMutationReceiptR4V1::Accepted { mutated: true, .. }
    ));
    assert!(store.evict_section(&section));
    assert!(matches!(store.read_cell(position), WorldCellReadV1::Unloaded { .. }));
    let revision = store.revision();
    store
        .scheduler_mut()
        .submit(ResidencyRequestV1 {
            request_id: 10,
            epoch: revision.epoch,
            address: section.clone(),
            class: ResidencyPriorityClassV1::OccupiedSupport,
            purpose: ResidencyPurposeV1::Generate,
            distance_squared: 0,
            direction_penalty: 0,
            sequence: 1,
        })
        .expect("submit");
    let token = store
        .scheduler_mut()
        .start_next(revision, HASH_A.into())
        .expect("start")
        .expect("token");
    let result = store
        .install_section(&token, empty_install(section, 9))
        .expect("install");
    assert!(matches!(result, ResidencyCompletionV1::Accepted(_)));
    let WorldCellReadV1::Loaded { cell, .. } = store.read_cell(position) else {
        panic!("loaded")
    };
    assert_eq!(cell.block_id, 2, "journal edit wins over regenerated base section");
}

#[test]
fn cache_identity_and_payload_validation_reject_stale_or_corrupt_data() {
    let identity = WorldChunkCacheIdentityV1 {
        address: WorldChunkAddressV1 {
            world: address("cache"),
            chunk_x: -2,
            chunk_z: 5,
        },
        generator_version: 18,
        generator_hash: HASH_A.into(),
        content_hash: HASH_B.into(),
        options_hash: HASH_A.into(),
        edit_halo_hash: HASH_B.into(),
    };
    let envelope = WorldChunkCacheEnvelopeV1::create(identity.clone(), 9, vec![5, 4, 3, 2, 1]).expect("cache");
    envelope.validate().expect("valid");
    assert_eq!(identity.key().expect("key"), envelope.key);
    assert_eq!(
        envelope.key, "world-cache-v1|1@cache:-2,5|g18|0bfc790fb7fd0396d0af5b9d2b893934",
        "cache key matches the current TypeScript contract fixture"
    );
    assert_eq!(
        envelope.checksum, "30f0449e4ab17ad010eeb8d944fb5fa4",
        "cache checksum matches the current TypeScript contract fixture"
    );
    let encoded = encode_chunk_cache_envelope_binary_v1(&envelope).expect("encode cache envelope");
    assert_eq!(
        decode_chunk_cache_envelope_binary_v1(&encoded).expect("decode cache envelope"),
        envelope
    );
    for length in 0..encoded.len().min(96) {
        assert!(decode_chunk_cache_envelope_binary_v1(&encoded[..length]).is_err());
    }
    let mut corrupt_wire = encoded.clone();
    let last = corrupt_wire.len() - 1;
    corrupt_wire[last] ^= 1;
    assert!(decode_chunk_cache_envelope_binary_v1(&corrupt_wire).is_err());
    let mut corrupt = envelope.clone();
    corrupt.payload[4] = 0;
    assert_eq!(corrupt.validate().expect_err("corrupt").code, "cache-checksum");
    let authority = WorldAuthorityIdentityV1 {
        address: identity.address.world.clone(),
        revision: WorldAuthorityRevisionV1 {
            epoch: 1,
            mutation: 2,
            residency: 3,
        },
        state_hash: HASH_A.into(),
    };
    let binding = CacheInstallBindingV1 {
        authority: authority.clone(),
        section_revision: WorldSectionRevisionV1 {
            blocks: 1,
            metadata: 1,
            halo: 1,
        },
        cache_key: envelope.key.clone(),
        cache_revision: envelope.revision,
    };
    assert!(binding.is_current(&authority, binding.section_revision, &envelope));
    let stale = WorldAuthorityIdentityV1 {
        revision: WorldAuthorityRevisionV1 {
            mutation: 3,
            ..authority.revision
        },
        ..authority
    };
    assert!(!binding.is_current(&stale, binding.section_revision, &envelope));
}

#[test]
fn save_and_delta_binary_codecs_round_trip_and_fail_closed() {
    let world = address("codec");
    let save = create_compatibility_save(
        world.clone(),
        WorldAuthorityRevisionV1 {
            epoch: 1,
            mutation: 9,
            residency: 3,
        },
        vec![CompatibilityChunkEditsV1 {
            chunk_x: -1,
            chunk_z: 0,
            entries: vec![(4, 2), (1, 1)],
        }],
        vec![CompatibilityFacingV1 {
            position: CellPositionV1 { x: -1, y: -2, z: 0 },
            facing: 1,
        }],
        vec![CompatibilityLiquidV1 {
            position: CellPositionV1 { x: -1, y: -2, z: 0 },
            liquid: LiquidMetadataV1 {
                kind: WorldLiquidKindV1::Water,
                level: 8,
                source: true,
                falling: false,
                contains_water: true,
                waterlogged: false,
            },
        }],
    );
    let bytes = encode_compatibility_save_binary_v1(&save).expect("encode");
    assert_eq!(decode_compatibility_save_binary_v1(&bytes).expect("decode"), save);
    let mut corrupt = bytes.clone();
    let last = corrupt.len() - 1;
    corrupt[last] ^= 1;
    assert!(decode_compatibility_save_binary_v1(&corrupt).is_err());
    assert!(
        save.compatibility_json_bytes()
            .expect("json")
            .starts_with(b"{\"address\":")
    );
    let mut duplicate_save = save.clone();
    let duplicate_entry = duplicate_save.edits[0].entries[0];
    duplicate_save.edits[0].entries.push(duplicate_entry);
    assert_eq!(duplicate_save.validate().expect_err("duplicate edit").code, "save-edit");

    let delta = WorldNetworkDeltaR4V1 {
        schema_version: 1,
        address: world,
        batch_id: "delta".into(),
        from_revision: WorldAuthorityRevisionV1 {
            epoch: 1,
            mutation: 8,
            residency: 3,
        },
        to_revision: WorldAuthorityRevisionV1 {
            epoch: 1,
            mutation: 9,
            residency: 3,
        },
        changes: vec![WorldCommittedCellR4V1 {
            position: CellPositionV1 { x: -1, y: 0, z: 0 },
            previous: WorldCellV1::default(),
            current: WorldCellV1 {
                block_id: 2,
                ..WorldCellV1::default()
            },
        }],
        checksum: String::new(),
    };
    let receipt_delta = {
        let world = address("codec-delta");
        let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
        store
            .install_section_for_replay(empty_install(section_address(&world, -1, 0, 4), 1))
            .expect("install");
        let WorldMutationReceiptR4V1::Accepted { delta: Some(delta), .. } = store.apply_mutation_batch(batch(
            &store,
            "delta",
            vec![WorldMutationCommandR4V1::SetBlock {
                position: CellPositionV1 { x: -1, y: 0, z: 0 },
                block_id: 2,
                facing: None,
            }],
        )) else {
            panic!("delta")
        };
        *delta
    };
    let delta_bytes = encode_network_delta_binary_v1(&receipt_delta).expect("encode delta");
    assert_eq!(
        decode_network_delta_binary_v1(&delta_bytes).expect("decode delta"),
        receipt_delta
    );
    assert!(validate_network_delta(&delta).is_err(), "empty checksum is rejected");
    let mut outside_world = receipt_delta.clone();
    outside_world.changes[0].position.y = WORLD_MAX_Y_V1 + 1;
    assert_eq!(
        validate_network_delta(&outside_world)
            .expect_err("out-of-world delta")
            .code,
        "delta-position"
    );
    for length in 0..delta_bytes.len().min(96) {
        assert!(decode_network_delta_binary_v1(&delta_bytes[..length]).is_err());
    }
}

#[test]
fn current_save_import_restores_exact_edit_state_before_sections_become_resident() {
    let world = address("import");
    let position = CellPositionV1 { x: -1, y: 0, z: -1 };
    let save = create_compatibility_save(
        world.clone(),
        WorldAuthorityRevisionV1 {
            epoch: 7,
            mutation: 99,
            residency: 14,
        },
        vec![CompatibilityChunkEditsV1 {
            chunk_x: -1,
            chunk_z: -1,
            entries: vec![(16_639, 20)],
        }],
        vec![CompatibilityFacingV1 { position, facing: 3 }],
        vec![CompatibilityLiquidV1 {
            position,
            liquid: LiquidMetadataV1 {
                kind: WorldLiquidKindV1::Water,
                level: 8,
                source: true,
                falling: false,
                contains_water: true,
                waterlogged: true,
            },
        }],
    );
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    let previous_identity = store.identity();
    let stale_batch = batch(
        &store,
        "pre-import-identity",
        vec![WorldMutationCommandR4V1::SetBlock {
            position,
            block_id: 20,
            facing: Some(3),
        }],
    );
    store
        .import_compatibility_save(&save, false)
        .expect("import current save");
    assert_eq!(
        store.revision().epoch,
        2,
        "live import advances the worker epoch instead of resurrecting disk identity"
    );
    assert_eq!(store.revision().mutation, 99);
    assert_eq!(store.revision().residency, 0);
    assert!(store.identity().revision.epoch > previous_identity.revision.epoch);
    assert!(matches!(
        store.apply_mutation_batch(stale_batch),
        WorldMutationReceiptR4V1::Rejected {
            code: MutationRejectionCodeR4V1::StaleRevision,
            ..
        }
    ));
    assert!(matches!(store.read_cell(position), WorldCellReadV1::Unloaded { .. }));
    store
        .install_section_for_replay(empty_install(section_address(&world, -1, -1, 4), 3))
        .expect("install regenerated base");
    let WorldCellReadV1::Loaded { cell, .. } = store.read_cell(position) else {
        panic!("edit should become resident")
    };
    assert_eq!(cell.block_id, 20);
    assert_eq!(cell.facing, 3);
    assert_eq!(cell.liquid.kind, WorldLiquidKindV1::Water);
    let exported = store.export_compatibility_save();
    assert_eq!(exported.edits, save.edits);
    assert_eq!(exported.facings, save.facings);
    assert_eq!(exported.liquids, save.liquids);
    let imported_epoch = store.revision().epoch;
    store
        .switch_active_location(address("after-import"))
        .expect("switch after import");
    assert!(
        store.revision().epoch > imported_epoch,
        "future epochs remain monotonic after import"
    );
}

#[test]
fn page_indices_are_x_then_z_then_y_for_many_dimensions() {
    let world = address("indices");
    let mut store = WorldAuthorityStoreR4V1::new(world.clone(), catalog()).expect("store");
    store
        .install_section_for_replay(empty_install(section_address(&world, 0, 0, 4), 1))
        .expect("install");
    for x_size in 1..=7 {
        for y_size in 1..=5 {
            for z_size in 1..=6 {
                let page = WorldReadPageV1::capture(
                    &store,
                    ReadOriginV1 { x: 0, y: 0, z: 0 },
                    ReadSizeV1 {
                        x: x_size,
                        y: y_size,
                        z: z_size,
                    },
                )
                .expect("page");
                for y in 0..i32::from(y_size) {
                    for z in 0..i32::from(z_size) {
                        for x in 0..i32::from(x_size) {
                            assert_eq!(
                                page.index(CellPositionV1 { x, y, z }).expect("index"),
                                x as usize
                                    + z as usize * usize::from(x_size)
                                    + y as usize * usize::from(x_size) * usize::from(z_size)
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn world_switch_clears_residency_jobs_pages_and_events_but_keeps_sharded_edits() {
    let first = address("Talon");
    let second = address("Hope");
    let mut store = WorldAuthorityStoreR4V1::new(first.clone(), catalog()).expect("store");
    store
        .install_section_for_replay(empty_install(section_address(&first, 0, 0, 4), 1))
        .expect("install");
    let receipt = store.apply_mutation_batch(batch(
        &store,
        "talon-edit",
        vec![WorldMutationCommandR4V1::SetBlock {
            position: CellPositionV1 { x: 1, y: 0, z: 1 },
            block_id: 2,
            facing: None,
        }],
    ));
    assert!(matches!(
        receipt,
        WorldMutationReceiptR4V1::Accepted { mutated: true, .. }
    ));
    store.switch_active_location(second.clone()).expect("switch");
    assert_eq!(store.active_address(), &second);
    assert_eq!(store.resident_section_count(), 0);
    assert!(store.drain_immediate_events().is_empty());
    store.switch_active_location(first.clone()).expect("switch back");
    assert_eq!(store.resident_section_count(), 0);
    assert_eq!(
        store.edit_journal().len(),
        1,
        "location journal survives residency cleanup"
    );
    assert!(matches!(
        store.read_cell(CellPositionV1 { x: 1, y: 0, z: 1 }),
        WorldCellReadV1::Unloaded { .. }
    ));
}

#[test]
fn fixture_replay_is_deterministic() {
    let first = run_authority_fixture_v1().expect("fixture");
    let second = run_authority_fixture_v1().expect("fixture");
    assert_eq!(first, second);
    assert_eq!(
        first.lines(),
        include_str!("../../../../tests/fixtures/rust-engine/r4-authority/fixture.txt")
    );
}
