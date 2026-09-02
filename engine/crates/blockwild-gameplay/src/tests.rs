use std::collections::{BTreeMap, BTreeSet};

use blockwild_types::{CanonicalHash, EntityId, PlayerId};

use super::*;
use crate::fixture::{reference_actor, reference_authority};

fn batch(authority: &GameplayAuthority, suffix: &str, commands: Vec<GameplayCommand>) -> GameplayBatch {
    GameplayBatch::new(
        format!("batch-{suffix}"),
        format!("key-{suffix}"),
        reference_actor(),
        authority.state.identity(),
        commands,
    )
}

fn accepted(receipt: GameplayReceipt) -> AcceptedReceipt {
    match receipt {
        GameplayReceipt::Accepted(receipt) => receipt,
        GameplayReceipt::Rejected { rejection, .. } => panic!("unexpected rejection: {rejection:?}"),
    }
}

fn rejection(receipt: GameplayReceipt) -> Rejection {
    match receipt {
        GameplayReceipt::Rejected { rejection, .. } => rejection,
        GameplayReceipt::Accepted(receipt) => panic!("unexpected acceptance: {receipt:?}"),
    }
}

fn exact_inventory_import_fixture() -> (GameplayAuthority, GameplayActor, ImportPlayerInventoryV1) {
    let inventory = ContainerKey::player("player-import");
    let mut state = GameplayState::new(WorldKey::new("import-universe", "surface"), 4);
    state
        .inventory
        .register_item(ItemDefinition {
            code: 41,
            content_id: "moonberry".into(),
            max_stack: 64,
            tags: BTreeSet::new(),
        })
        .unwrap();
    state
        .inventory
        .register_item(ItemDefinition {
            code: 42,
            content_id: "named-creature-cage".into(),
            max_stack: 1,
            tags: BTreeSet::new(),
        })
        .unwrap();
    state
        .inventory
        .insert_container(Container::new(inventory.clone(), PLAYER_INVENTORY_IMPORT_SLOT_COUNT_V1))
        .unwrap();

    let mut metadata = ItemInstanceMetadataV1 {
        hash: CanonicalHash::default(),
        type_id: "blockwild.item.instance".into(),
        schema_id: "creature-cage".into(),
        schema_version: 1,
        content_version: 7,
        canonical_json_bytes:
            "{\"creature\":{\"name\":\"Mizu 水\",\"traits\":[\"swift\",{\"rare\":true}]},\"version\":1}"
                .as_bytes()
                .to_vec(),
        unknown_extension_bytes: vec![0, 0x80, 0xff, 7],
    };
    metadata.hash = metadata.calculate_hash();
    let slots = vec![
        Some(ItemStack::simple(41, 12)),
        None,
        Some(ItemStack {
            item_code: 42,
            count: 1,
            durability_millionths: Some(987_654),
            metadata_hash: metadata.hash,
        }),
        None,
        Some(ItemStack::simple(41, 3)),
        None,
        None,
        None,
        Some(ItemStack::simple(41, 1)),
    ];
    let command = ImportPlayerInventoryV1 {
        inventory,
        expected_revision: 0,
        slots,
        metadata: vec![metadata],
    };
    let actor = GameplayActor {
        actor_id: "gameplay-bootstrap-system".into(),
        player_id: None,
        entity_id: None,
        role: ActorRole::System,
    };
    let mut authority = GameplayAuthority::new(state);
    authority
        .grant_actor(actor.actor_id.clone(), ActorGrant::system())
        .unwrap();
    (authority, actor, command)
}

fn inventory_import_batch(
    authority: &GameplayAuthority,
    actor: GameplayActor,
    suffix: &str,
    command: ImportPlayerInventoryV1,
) -> GameplayBatch {
    GameplayBatch::new(
        format!("inventory-import-{suffix}"),
        format!("inventory-import-key-{suffix}"),
        actor,
        authority.state.identity(),
        vec![GameplayCommand::Inventory(InventoryCommand::ImportPlayerInventoryV1(
            command,
        ))],
    )
}

#[test]
fn system_inventory_import_preserves_exact_nine_slots_metadata_and_retry() {
    let (mut authority, actor, command) = exact_inventory_import_fixture();
    let request = inventory_import_batch(&authority, actor, "exact", command.clone());
    let first = accepted(authority.apply_batch(&request));
    let second = accepted(authority.apply_batch(&request));
    assert_eq!(first, second);
    assert_eq!(authority.replay().len(), 1);
    assert_eq!(first.touched_domains, BTreeSet::from([Domain::Inventory]));
    assert_eq!(first.events[0].kind, "player-inventory-imported-v1");
    assert_eq!(first.resource_deltas.iter().map(|delta| delta.amount).sum::<i64>(), 17);

    let imported = &authority.state.inventory.containers[&command.inventory];
    assert_eq!(imported.revision, 1);
    assert_eq!(imported.slots, command.slots);
    let metadata = &command.metadata[0];
    assert_eq!(metadata.hash.to_hex(), "fbfc2e7a712cd603f076be3090f3959f");
    let stored = &authority.state.inventory.item_instance_metadata[&metadata.hash];
    assert_eq!(stored.canonical_json_bytes, metadata.canonical_json_bytes);
    assert_eq!(stored.unknown_extension_bytes, [0, 0x80, 0xff, 7]);

    let snapshot = authority.encode_snapshot(&[0x80, 0xff]).unwrap();
    let decoded = decode_gameplay_authority_snapshot(&snapshot).unwrap();
    assert_eq!(decoded.schema_version, GAMEPLAY_SNAPSHOT_SCHEMA_VERSION);
    assert_eq!(decoded.authority.state, authority.state);
    assert_eq!(decoded.unknown_extension_bytes, [0x80, 0xff]);

    let mut restore_target = GameplayAuthority::new(GameplayState::new(WorldKey::new("other", "other"), 1));
    let before_failed_restore = restore_target.state.clone();
    let mut corrupt = snapshot.clone();
    let last = corrupt.len() - 1;
    corrupt[last] ^= 0x80;
    assert!(restore_target.install_snapshot(&corrupt).is_err());
    assert_eq!(restore_target.state, before_failed_restore);
    let report = restore_target.install_snapshot(&snapshot).unwrap();
    assert_eq!(report.schema_version, GAMEPLAY_SNAPSHOT_SCHEMA_VERSION);
    assert_eq!(restore_target.state, authority.state);
}

#[test]
fn inventory_import_is_system_only_even_for_inventory_admin() {
    let (mut authority, _, command) = exact_inventory_import_fixture();
    let actor = GameplayActor {
        actor_id: "inventory-admin".into(),
        player_id: Some(PlayerId::new(81, 1)),
        entity_id: Some(EntityId::new(82, 1)),
        role: ActorRole::Host,
    };
    authority
        .grant_actor(
            actor.actor_id.clone(),
            ActorGrant {
                player_id: actor.player_id,
                entity_id: actor.entity_id,
                role: actor.role,
                scopes: BTreeSet::from([Scope::InventoryAny]),
            },
        )
        .unwrap();
    let before = authority.state.clone();
    let request = inventory_import_batch(&authority, actor, "admin", command);
    assert_eq!(
        rejection(authority.apply_batch(&request)).code,
        RejectionCode::Unauthorized
    );
    assert_eq!(authority.state, before);
}

#[test]
fn inventory_import_conflict_and_invalid_payloads_roll_back_fully() {
    type ImportMutation = Box<dyn Fn(&mut GameplayAuthority, &mut ImportPlayerInventoryV1)>;
    let mutations: Vec<ImportMutation> = vec![
        Box::new(|_, command| command.expected_revision = 1),
        Box::new(|_, command| command.slots[0].as_mut().unwrap().count = 65),
        Box::new(|_, command| command.slots[0].as_mut().unwrap().item_code = 999_999),
        Box::new(|_, command| command.slots[2].as_mut().unwrap().durability_millionths = Some(1_000_001)),
        Box::new(|_, command| command.metadata.push(command.metadata[0].clone())),
        Box::new(|_, command| {
            command.metadata[0].canonical_json_bytes = b"{\"version\":1,\"creature\":{}}".to_vec();
            command.metadata[0].hash = command.metadata[0].calculate_hash();
            command.slots[2].as_mut().unwrap().metadata_hash = command.metadata[0].hash;
        }),
        Box::new(|_, command| {
            command.metadata[0].canonical_json_bytes = b"{not-json}".to_vec();
            command.metadata[0].hash = command.metadata[0].calculate_hash();
            command.slots[2].as_mut().unwrap().metadata_hash = command.metadata[0].hash;
        }),
        Box::new(|authority, command| {
            authority
                .state
                .inventory
                .containers
                .get_mut(&command.inventory)
                .unwrap()
                .slots[0] = Some(ItemStack::simple(41, 1));
        }),
    ];
    for (index, mutate) in mutations.into_iter().enumerate() {
        let (mut authority, actor, mut command) = exact_inventory_import_fixture();
        mutate(&mut authority, &mut command);
        let before = authority.state.clone();
        let request = inventory_import_batch(&authority, actor, &format!("invalid-{index}"), command);
        assert!(matches!(
            authority.apply_batch(&request),
            GameplayReceipt::Rejected { .. }
        ));
        assert_eq!(authority.state, before, "mutation {index} was not atomic");
        assert!(authority.replay().is_empty());
    }
}

#[test]
fn inventory_import_idempotency_key_conflict_does_not_mutate_twice() {
    let (mut authority, actor, command) = exact_inventory_import_fixture();
    let first = inventory_import_batch(&authority, actor.clone(), "key-conflict", command.clone());
    accepted(authority.apply_batch(&first));
    let after_first = authority.state.clone();
    let mut conflicting_command = command;
    conflicting_command.slots[0].as_mut().unwrap().count = 11;
    let mut conflicting = inventory_import_batch(&authority, actor, "different", conflicting_command);
    conflicting.idempotency_key = first.idempotency_key;
    assert_eq!(
        rejection(authority.apply_batch(&conflicting)).code,
        RejectionCode::Conflict
    );
    assert_eq!(authority.state, after_first);
    assert_eq!(authority.replay().len(), 1);
}

fn generated_drop_provenance() -> GeneratedDropProvenanceV1 {
    GeneratedDropProvenanceV1 {
        schema_version: BLOCK_ACTION_GENERATED_DROP_PROVENANCE_SCHEMA_VERSION_V1,
        manifest_hash: CanonicalHash([1; 16]),
        installed_registry_hash: CanonicalHash([2; 16]),
        catalog_blob_hash: CanonicalHash([3; 16]),
        action_report_hash: CanonicalHash([4; 16]),
        rng_semantics_hash: CanonicalHash([5; 16]),
        block_action_sequence: 41,
        origin_input_sequence: 39,
        block_id: 7,
        position: BlockActionLootCellV1 { x: -2, y: 63, z: 11 },
        loot_plan_hash: CanonicalHash([6; 16]),
        group_ordinal: 2,
    }
}

fn generated_drop_command() -> CreateGeneratedDropCustodyV1 {
    let provenance = generated_drop_provenance();
    CreateGeneratedDropCustodyV1::new(
        ContainerKey {
            kind: ContainerKind::Container,
            id: provenance.custody_id_v1(),
            owner_id: None,
        },
        ItemStack::simple(77, 5),
        provenance,
    )
}

fn generated_drop_authority() -> (GameplayAuthority, GameplayActor, ContainerKey) {
    let mut state = GameplayState::new(WorldKey::new("generated-drop-universe", "surface"), 17);
    state
        .inventory
        .register_item(ItemDefinition {
            code: 77,
            content_id: "generated-drop-item".into(),
            max_stack: 16,
            tags: BTreeSet::new(),
        })
        .unwrap();
    let player_inventory = ContainerKey::player("generated-drop-player");
    state
        .inventory
        .insert_container(Container::new(player_inventory.clone(), 9))
        .unwrap();
    let actor = GameplayActor {
        actor_id: "generated-drop-system".into(),
        player_id: None,
        entity_id: None,
        role: ActorRole::System,
    };
    let mut authority = GameplayAuthority::new(state);
    authority
        .grant_actor(actor.actor_id.clone(), ActorGrant::system())
        .unwrap();
    (authority, actor, player_inventory)
}

fn generated_drop_batch(
    authority: &GameplayAuthority,
    actor: GameplayActor,
    suffix: &str,
    command: CreateGeneratedDropCustodyV1,
) -> GameplayBatch {
    GameplayBatch::new(
        format!("generated-drop-{suffix}"),
        format!("generated-drop-key-{suffix}"),
        actor,
        authority.state.identity(),
        vec![GameplayCommand::Inventory(
            InventoryCommand::CreateGeneratedDropCustodyV1(command),
        )],
    )
}

#[test]
fn generated_drop_is_system_owned_custody_with_conservation_replay_and_checkpoint_proof() {
    let (mut authority, actor, player_inventory) = generated_drop_authority();
    let command = generated_drop_command();
    assert_eq!(command.request_hash.to_hex(), "83a090d59d372b15b05d98afda5e11b7");
    let request = generated_drop_batch(&authority, actor, "accepted", command.clone());
    let first = accepted(authority.apply_batch(&request));
    let retry = accepted(authority.apply_batch(&request));
    assert_eq!(retry, first);
    assert_eq!(authority.replay().len(), 1);
    assert_eq!(first.touched_domains, BTreeSet::from([Domain::Inventory]));
    assert_eq!(first.events.len(), 1);
    assert_eq!(first.events[0].kind, "generated-drop-custody-v1");
    assert_eq!(first.events[0].record_id.as_deref(), Some(command.custody.id.as_str()));
    assert_eq!(
        first.resource_deltas,
        [ResourceDelta {
            item_code: 77,
            metadata_hash: CanonicalHash::default(),
            amount: 5,
            reason: GENERATED_DROP_RESOURCE_REASON_V1.to_owned(),
        }]
    );
    assert_eq!(
        authority.state.inventory.containers[&command.custody].slots,
        [Some(command.stack)]
    );
    assert!(
        authority.state.inventory.containers[&player_inventory]
            .slots
            .iter()
            .all(Option::is_none)
    );
    let replay = &authority.replay()[0];
    assert_eq!(replay.sequence, first.after.revision.sequence);
    assert_eq!(replay.command_hash, request.command_hash);
    assert_eq!(replay.before_hash, first.before.state_hash);
    assert_eq!(replay.after_hash, first.after.state_hash);
    assert_eq!(replay.receipt_hash, first.receipt_hash);

    let snapshot = authority.encode_snapshot(&[0x80, 0xff]).unwrap();
    let decoded = decode_gameplay_authority_snapshot(&snapshot).unwrap();
    assert_eq!(decoded.authority.state, authority.state);
    assert_eq!(decoded.authority.replay(), authority.replay());
    assert_eq!(decoded.authority.replay_hash(), authority.replay_hash());
    assert_eq!(decoded.authority.encode_snapshot(&[0x80, 0xff]).unwrap(), snapshot);
}

#[test]
fn generated_drop_is_system_only_even_for_inventory_admin() {
    let (mut authority, _, _) = generated_drop_authority();
    let player_id = PlayerId::new(81, 1);
    let entity_id = EntityId::new(82, 1);
    let actor = GameplayActor {
        actor_id: "generated-drop-inventory-admin".into(),
        player_id: Some(player_id),
        entity_id: Some(entity_id),
        role: ActorRole::Host,
    };
    authority
        .grant_actor(
            actor.actor_id.clone(),
            ActorGrant {
                player_id: Some(player_id),
                entity_id: Some(entity_id),
                role: ActorRole::Host,
                scopes: BTreeSet::from([Scope::InventoryAny]),
            },
        )
        .unwrap();
    let before = authority.state.clone();
    let request = generated_drop_batch(&authority, actor, "admin", generated_drop_command());
    assert_eq!(
        rejection(authority.apply_batch(&request)).code,
        RejectionCode::Unauthorized
    );
    assert_eq!(authority.state, before);
    assert!(authority.replay().is_empty());
}

#[test]
fn generated_drop_rejects_hash_custody_stack_metadata_and_provenance_tamper_atomically() {
    type Mutation = Box<dyn Fn(&mut GameplayAuthority, &mut CreateGeneratedDropCustodyV1)>;
    let mutations: Vec<(Mutation, RejectionCode)> = vec![
        (
            Box::new(|_, command| command.request_hash = CanonicalHash([9; 16])),
            RejectionCode::Conflict,
        ),
        (
            Box::new(|_, command| command.custody.id = "wrong-generated-custody".into()),
            RejectionCode::InvalidCommand,
        ),
        (
            Box::new(|_, command| command.custody.owner_id = Some("generated-drop-player".into())),
            RejectionCode::InvalidCommand,
        ),
        (
            Box::new(|_, command| {
                command.provenance.schema_version = 2;
                command.request_hash = command.calculate_request_hash_v1();
            }),
            RejectionCode::InvalidCommand,
        ),
        (
            Box::new(|_, command| {
                command.provenance.loot_plan_hash = CanonicalHash::default();
                command.request_hash = command.calculate_request_hash_v1();
            }),
            RejectionCode::Conflict,
        ),
        (
            Box::new(|_, command| {
                command.provenance.group_ordinal = MAX_BLOCK_ACTION_GENERATED_DROPS_V1 as u16;
                command.request_hash = command.calculate_request_hash_v1();
            }),
            RejectionCode::Capacity,
        ),
        (
            Box::new(|_, command| {
                command.stack.item_code = 999_999;
                command.request_hash = command.calculate_request_hash_v1();
            }),
            RejectionCode::InvalidCommand,
        ),
        (
            Box::new(|_, command| {
                command.stack.count = 17;
                command.request_hash = command.calculate_request_hash_v1();
            }),
            RejectionCode::InvalidCommand,
        ),
        (
            Box::new(|_, command| {
                command.stack.durability_millionths = Some(1);
                command.request_hash = command.calculate_request_hash_v1();
            }),
            RejectionCode::InvalidCommand,
        ),
        (
            Box::new(|_, command| {
                command.stack.metadata_hash = CanonicalHash([8; 16]);
                command.request_hash = command.calculate_request_hash_v1();
            }),
            RejectionCode::InvalidCommand,
        ),
    ];
    for (index, (mutate, expected)) in mutations.into_iter().enumerate() {
        let (mut authority, actor, _) = generated_drop_authority();
        let mut command = generated_drop_command();
        mutate(&mut authority, &mut command);
        let before = authority.state.clone();
        let request = generated_drop_batch(&authority, actor, &format!("invalid-{index}"), command);
        assert_eq!(
            rejection(authority.apply_batch(&request)).code,
            expected,
            "mutation {index}"
        );
        assert_eq!(authority.state, before, "mutation {index} was not atomic");
        assert!(authority.replay().is_empty());
    }
}

#[test]
fn generated_drop_duplicate_and_container_capacity_reject_without_mutation() {
    let (mut authority, actor, _) = generated_drop_authority();
    let command = generated_drop_command();
    let first = generated_drop_batch(&authority, actor.clone(), "first", command.clone());
    accepted(authority.apply_batch(&first));
    let after_first = authority.state.clone();
    let duplicate = generated_drop_batch(&authority, actor, "duplicate", command);
    assert_eq!(
        rejection(authority.apply_batch(&duplicate)).code,
        RejectionCode::Conflict
    );
    assert_eq!(authority.state, after_first);
    assert_eq!(authority.replay().len(), 1);

    let mut inventory = InventoryState::default();
    inventory
        .register_item(ItemDefinition {
            code: 77,
            content_id: "generated-drop-item".into(),
            max_stack: 16,
            tags: BTreeSet::new(),
        })
        .unwrap();
    for index in 0..MAX_GENERATED_DROP_CUSTODY_CONTAINERS_V1 {
        inventory
            .insert_container(Container::new(
                ContainerKey {
                    kind: ContainerKind::Container,
                    id: format!("block-loot-custody-v1:{index}:0"),
                    owner_id: None,
                },
                1,
            ))
            .unwrap();
    }
    let before = inventory.clone();
    assert_eq!(
        inventory
            .create_generated_drop_custody_v1(&generated_drop_command())
            .unwrap_err()
            .code,
        RejectionCode::Capacity
    );
    assert_eq!(inventory, before);
}

fn block_action_inventory_fixture() -> (InventoryState, ContainerKey, ItemStack) {
    let mut state = InventoryState::default();
    for (code, id, max_stack) in [(10, "test-pick", 1), (20, "test-block", 64), (30, "filler", 64)] {
        state
            .register_item(ItemDefinition {
                code,
                content_id: id.into(),
                max_stack,
                tags: BTreeSet::new(),
            })
            .unwrap();
    }
    let key = ContainerKey::player("block-actor");
    let held = ItemStack {
        item_code: 10,
        count: 1,
        durability_millionths: Some(200_000),
        metadata_hash: CanonicalHash::default(),
    };
    let mut container = Container::new(key.clone(), 9);
    container.slots[0] = Some(held.clone());
    state.insert_container(container).unwrap();
    (state, key, held)
}

#[test]
fn canonical_pickup_plan_merges_then_uses_empty_slots_without_partial_mutation() {
    let mut state = InventoryState::default();
    state
        .register_item(ItemDefinition {
            code: 42,
            content_id: "pickup-crystal".into(),
            max_stack: 64,
            tags: BTreeSet::new(),
        })
        .unwrap();
    let custody_key = ContainerKey {
        kind: ContainerKind::Container,
        id: "drop-custody-plan".into(),
        owner_id: None,
    };
    let mut custody = Container::new(custody_key.clone(), 1);
    custody.slots[0] = Some(ItemStack::simple(42, 5));
    state.insert_container(custody).unwrap();
    let inventory_key = ContainerKey::player("pickup-player");
    let mut inventory = Container::new(inventory_key.clone(), 3);
    inventory.slots[0] = Some(ItemStack::simple(42, 62));
    state.insert_container(inventory).unwrap();
    let before = state.clone();
    let plan = state
        .canonical_pickup_transfers_v1(
            &SlotRef {
                container: custody_key,
                slot: 0,
                expected_container_revision: Some(0),
            },
            &inventory_key,
        )
        .unwrap();
    assert_eq!(plan, Some(vec![(0, 2), (1, 3)]));
    assert_eq!(state, before, "planning cannot expose a partial merge");
}

#[test]
fn canonical_pickup_plan_reports_full_capacity_without_mutation() {
    let mut state = InventoryState::default();
    state
        .register_item(ItemDefinition {
            code: 42,
            content_id: "pickup-crystal".into(),
            max_stack: 64,
            tags: BTreeSet::new(),
        })
        .unwrap();
    let custody_key = ContainerKey {
        kind: ContainerKind::Container,
        id: "drop-custody-full".into(),
        owner_id: None,
    };
    let mut custody = Container::new(custody_key.clone(), 1);
    custody.slots[0] = Some(ItemStack::simple(42, 1));
    state.insert_container(custody).unwrap();
    let inventory_key = ContainerKey::player("pickup-player-full");
    let mut inventory = Container::new(inventory_key.clone(), 2);
    inventory.slots.fill(Some(ItemStack::simple(42, 64)));
    state.insert_container(inventory).unwrap();
    let before = state.clone();
    assert_eq!(
        state
            .canonical_pickup_transfers_v1(
                &SlotRef {
                    container: custody_key,
                    slot: 0,
                    expected_container_revision: Some(0),
                },
                &inventory_key,
            )
            .unwrap(),
        None
    );
    assert_eq!(state, before);
}

#[test]
fn block_action_combines_tool_damage_and_loot_with_one_revision() {
    let (mut state, key, held) = block_action_inventory_fixture();
    let deltas = state
        .apply_block_action_v1(&ApplyBlockActionV1 {
            inventory: key.clone(),
            slot: 0,
            expected_container_revision: 0,
            expected_stack: Some(held),
            consume_count: 0,
            durability_cost_millionths: 100_000,
            created_stack: Some(ItemStack::simple(20, 1)),
            reason: "test-break".into(),
        })
        .unwrap();
    let container = &state.containers[&key];
    assert_eq!(container.revision, 1, "one block action advances custody exactly once");
    assert_eq!(
        container.slots[0].as_ref().unwrap().durability_millionths,
        Some(100_000)
    );
    assert!(
        container
            .slots
            .iter()
            .flatten()
            .any(|stack| stack.item_code == 20 && stack.count == 1)
    );
    assert_eq!(deltas.iter().map(|delta| delta.amount).sum::<i64>(), 1);
}

#[test]
fn block_action_tool_break_and_metadata_or_capacity_failure_are_atomic() {
    let (mut state, key, held) = block_action_inventory_fixture();
    let deltas = state
        .apply_block_action_v1(&ApplyBlockActionV1 {
            inventory: key.clone(),
            slot: 0,
            expected_container_revision: 0,
            expected_stack: Some(held),
            consume_count: 0,
            durability_cost_millionths: 200_000,
            created_stack: None,
            reason: "test-break-tool".into(),
        })
        .unwrap();
    assert_eq!(state.containers[&key].revision, 1);
    assert!(state.containers[&key].slots[0].is_none());
    assert_eq!(deltas.iter().map(|delta| delta.amount).sum::<i64>(), -1);

    let (mut missing_metadata, key, held) = block_action_inventory_fixture();
    let before = missing_metadata.clone();
    let result = missing_metadata.apply_block_action_v1(&ApplyBlockActionV1 {
        inventory: key.clone(),
        slot: 0,
        expected_container_revision: 0,
        expected_stack: Some(held),
        consume_count: 0,
        durability_cost_millionths: 100_000,
        created_stack: Some(ItemStack {
            item_code: 20,
            count: 1,
            durability_millionths: None,
            metadata_hash: CanonicalHash([7; 16]),
        }),
        reason: "test-break-metadata".into(),
    });
    assert_eq!(result.unwrap_err().code, RejectionCode::InvalidCommand);
    assert_eq!(missing_metadata, before);

    let (mut full, key, held) = block_action_inventory_fixture();
    for slot in 1..9 {
        full.containers.get_mut(&key).unwrap().slots[slot] = Some(ItemStack::simple(30, 64));
    }
    let before = full.clone();
    assert_eq!(
        full.apply_block_action_v1(&ApplyBlockActionV1 {
            inventory: key,
            slot: 0,
            expected_container_revision: 0,
            expected_stack: Some(held),
            consume_count: 0,
            durability_cost_millionths: 100_000,
            created_stack: Some(ItemStack::simple(20, 1)),
            reason: "test-break-capacity".into(),
        })
        .unwrap_err()
        .code,
        RejectionCode::Capacity
    );
    assert_eq!(full, before);
}

#[test]
fn block_action_rejects_stacked_durable_tools_without_mutation() {
    let (mut state, key, mut held) = block_action_inventory_fixture();
    held.count = 2;
    state.containers.get_mut(&key).unwrap().slots[0] = Some(held.clone());
    let before = state.clone();
    assert_eq!(
        state
            .apply_block_action_v1(&ApplyBlockActionV1 {
                inventory: key,
                slot: 0,
                expected_container_revision: 0,
                expected_stack: Some(held),
                consume_count: 0,
                durability_cost_millionths: 1,
                created_stack: None,
                reason: "stacked-durable".into(),
            })
            .unwrap_err()
            .code,
        RejectionCode::InvalidCommand
    );
    assert_eq!(state, before);
}

fn locator_item_authority_fixture(count: u32) -> (GameplayAuthority, GameplayActor, ContainerKey, ItemStack) {
    let actor = GameplayActor {
        actor_id: "locator-player".into(),
        player_id: Some(PlayerId::new(7, 1)),
        entity_id: Some(EntityId::new(9, 1)),
        role: ActorRole::Host,
    };
    let inventory = ContainerKey::player(actor.actor_id.clone());
    let mut state = GameplayState::new(WorldKey::new("locator-universe", "surface"), 1);
    state
        .inventory
        .register_item(ItemDefinition {
            code: 77,
            content_id: "hearthroads-gazetteer".into(),
            max_stack: 8,
            tags: BTreeSet::new(),
        })
        .unwrap();
    let stack = ItemStack::simple(77, count);
    let mut container = Container::new(inventory.clone(), 9);
    container.slots[4] = Some(stack.clone());
    state.inventory.insert_container(container).unwrap();
    let mut authority = GameplayAuthority::new(state);
    authority
        .grant_actor(
            actor.actor_id.clone(),
            ActorGrant::host(actor.player_id.unwrap(), actor.entity_id.unwrap()),
        )
        .unwrap();
    (authority, actor, inventory, stack)
}

#[test]
fn locator_item_consume_is_exact_atomic_and_idempotent() {
    let (mut authority, actor, inventory, stack) = locator_item_authority_fixture(2);
    let request = GameplayBatch::new(
        "locator-consume",
        "locator-consume-key",
        actor,
        authority.state.identity(),
        vec![GameplayCommand::Inventory(InventoryCommand::ConsumeInventoryUnitV1(
            ConsumeInventoryUnitV1 {
                inventory: inventory.clone(),
                slot: 4,
                expected_container_revision: 0,
                expected_stack: stack.clone(),
            },
        ))],
    );
    let first = accepted(authority.apply_batch(&request));
    let retry = accepted(authority.apply_batch(&request));
    assert_eq!(first, retry);
    assert_eq!(authority.replay().len(), 1);
    assert_eq!(first.events[0].kind, "player-locator-item-consumed-v1");
    assert_eq!(first.resource_deltas.len(), 1);
    assert_eq!(first.resource_deltas[0].amount, -1);
    assert_eq!(first.resource_deltas[0].reason, PLAYER_LOCATOR_ITEM_CONSUME_REASON_V1);
    let container = &authority.state.inventory.containers[&inventory];
    assert_eq!(container.revision, 1);
    assert_eq!(container.slots[4], Some(ItemStack::simple(77, 1)));

    let before = authority.clone();
    let stale = GameplayBatch::new(
        "locator-consume-stale",
        "locator-consume-stale-key",
        request.actor,
        authority.state.identity(),
        vec![GameplayCommand::Inventory(InventoryCommand::ConsumeInventoryUnitV1(
            ConsumeInventoryUnitV1 {
                inventory,
                slot: 4,
                expected_container_revision: 0,
                expected_stack: stack,
            },
        ))],
    );
    assert_eq!(
        rejection(authority.apply_batch(&stale)).code,
        RejectionCode::StaleRevision
    );
    assert_eq!(authority.state, before.state);
    assert_eq!(authority.replay(), before.replay());
}

#[test]
fn locator_item_consume_clears_last_unit_and_rejects_cross_custody_or_revision_overflow() {
    let (mut authority, actor, inventory, stack) = locator_item_authority_fixture(1);
    let cross_custody = GameplayBatch::new(
        "locator-cross-custody",
        "locator-cross-custody",
        actor.clone(),
        authority.state.identity(),
        vec![GameplayCommand::Inventory(InventoryCommand::ConsumeInventoryUnitV1(
            ConsumeInventoryUnitV1 {
                inventory: ContainerKey::player("another-player"),
                slot: 4,
                expected_container_revision: 0,
                expected_stack: stack.clone(),
            },
        ))],
    );
    let before = authority.clone();
    assert_eq!(
        rejection(authority.apply_batch(&cross_custody)).code,
        RejectionCode::Unauthorized
    );
    assert_eq!(authority.state, before.state);
    assert_eq!(authority.replay(), before.replay());

    let exact = GameplayBatch::new(
        "locator-last-unit",
        "locator-last-unit",
        actor,
        authority.state.identity(),
        vec![GameplayCommand::Inventory(InventoryCommand::ConsumeInventoryUnitV1(
            ConsumeInventoryUnitV1 {
                inventory: inventory.clone(),
                slot: 4,
                expected_container_revision: 0,
                expected_stack: stack.clone(),
            },
        ))],
    );
    accepted(authority.apply_batch(&exact));
    assert_eq!(authority.state.inventory.containers[&inventory].slots[4], None);

    let (mut overflow, _, inventory, stack) = locator_item_authority_fixture(1);
    overflow
        .state
        .inventory
        .containers
        .get_mut(&inventory)
        .unwrap()
        .revision = u64::MAX;
    let before = overflow.state.inventory.clone();
    assert_eq!(
        overflow
            .state
            .inventory
            .consume_inventory_unit_v1(&ConsumeInventoryUnitV1 {
                inventory,
                slot: 4,
                expected_container_revision: u64::MAX,
                expected_stack: stack,
            })
            .unwrap_err()
            .code,
        RejectionCode::Capacity
    );
    assert_eq!(overflow.state.inventory, before);
}

#[test]
fn creative_slot_set_is_exact_idempotent_and_atomic() {
    let (mut authority, actor, inventory, prior_stack) = locator_item_authority_fixture(2);
    authority
        .state
        .inventory
        .register_item(ItemDefinition {
            code: 78,
            content_id: "creative-replacement".into(),
            max_stack: 4,
            tags: BTreeSet::new(),
        })
        .unwrap();
    let replacement = ItemStack::simple(78, 4);
    let request = GameplayBatch::new(
        "creative-slot-set",
        "creative-slot-set-key",
        actor.clone(),
        authority.state.identity(),
        vec![GameplayCommand::Inventory(
            InventoryCommand::SetCreativeInventorySlotV1(SetCreativeInventorySlotV1 {
                inventory: inventory.clone(),
                slot: 4,
                expected_container_revision: 0,
                expected_stack: Some(prior_stack.clone()),
                replacement_stack: replacement.clone(),
            }),
        )],
    );
    let first = accepted(authority.apply_batch(&request));
    let retry = accepted(authority.apply_batch(&request));
    assert_eq!(first, retry);
    assert_eq!(first.events[0].kind, "player-creative-slot-set-v1");
    assert_eq!(first.resource_deltas.len(), 2);
    assert!(
        first
            .resource_deltas
            .iter()
            .all(|delta| delta.reason == PLAYER_CREATIVE_SLOT_SET_REASON_V1)
    );
    assert_eq!(authority.replay().len(), 1);
    let container = &authority.state.inventory.containers[&inventory];
    assert_eq!(container.revision, 1);
    assert_eq!(container.slots[4], Some(replacement.clone()));

    for command in [
        SetCreativeInventorySlotV1 {
            inventory: inventory.clone(),
            slot: 4,
            expected_container_revision: 0,
            expected_stack: Some(prior_stack),
            replacement_stack: replacement.clone(),
        },
        SetCreativeInventorySlotV1 {
            inventory: inventory.clone(),
            slot: 4,
            expected_container_revision: 1,
            expected_stack: Some(replacement.clone()),
            replacement_stack: ItemStack::simple(78, 5),
        },
        SetCreativeInventorySlotV1 {
            inventory: inventory.clone(),
            slot: 4,
            expected_container_revision: 1,
            expected_stack: Some(replacement.clone()),
            replacement_stack: ItemStack::simple(999, 1),
        },
    ] {
        let before = authority.state.clone();
        assert!(
            authority
                .state
                .inventory
                .set_creative_inventory_slot_v1(&command)
                .is_err()
        );
        assert_eq!(authority.state, before);
    }

    let cross_custody = GameplayBatch::new(
        "creative-slot-cross-custody",
        "creative-slot-cross-custody",
        actor,
        authority.state.identity(),
        vec![GameplayCommand::Inventory(
            InventoryCommand::SetCreativeInventorySlotV1(SetCreativeInventorySlotV1 {
                inventory: ContainerKey::player("another-player"),
                slot: 4,
                expected_container_revision: 0,
                expected_stack: None,
                replacement_stack: ItemStack::simple(78, 1),
            }),
        )],
    );
    let before = authority.clone();
    assert_eq!(
        rejection(authority.apply_batch(&cross_custody)).code,
        RejectionCode::Unauthorized
    );
    assert_eq!(authority.state, before.state);
    assert_eq!(authority.replay(), before.replay());
}

#[test]
fn reference_fixture_is_deterministic_and_complete() {
    let first = run_reference_fixture();
    let second = run_reference_fixture();
    assert_eq!(first, second);
    assert_eq!(first.accepted_batches, 5);
    assert_eq!(first.final_revision, 5);
    assert_ne!(first.state_hash, CanonicalHash::default());
    assert_ne!(first.replay_hash, CanonicalHash::default());
}

#[test]
fn transfer_conserves_metadata_sensitive_resources_for_many_counts() {
    for count in 1..=10 {
        let mut state = InventoryState::default();
        state
            .register_item(ItemDefinition {
                code: 1,
                content_id: "item".into(),
                max_stack: 64,
                tags: BTreeSet::new(),
            })
            .unwrap();
        let left_key = ContainerKey {
            kind: ContainerKind::Player,
            id: "left".into(),
            owner_id: Some("owner".into()),
        };
        let right_key = ContainerKey {
            kind: ContainerKind::Player,
            id: "right".into(),
            owner_id: Some("owner".into()),
        };
        let mut left = Container::new(left_key.clone(), 1);
        left.slots[0] = Some(ItemStack::simple(1, 10));
        state.insert_container(left).unwrap();
        state.insert_container(Container::new(right_key.clone(), 1)).unwrap();
        let before = state.resource_totals();
        state
            .transfer(&TransferCommand {
                from: SlotRef {
                    container: left_key,
                    slot: 0,
                    expected_container_revision: Some(0),
                },
                to: SlotRef {
                    container: right_key,
                    slot: 0,
                    expected_container_revision: Some(0),
                },
                count,
                expected: Some(ExpectedStack {
                    item_code: 1,
                    metadata_hash: CanonicalHash::default(),
                    minimum_count: count,
                }),
            })
            .unwrap();
        assert_eq!(before, state.resource_totals());
    }
}

#[test]
fn equipment_rejects_items_without_required_tag() {
    let mut state = InventoryState::default();
    state
        .register_item(ItemDefinition {
            code: 1,
            content_id: "stone".into(),
            max_stack: 64,
            tags: BTreeSet::new(),
        })
        .unwrap();
    let source_key = ContainerKey::player("owner");
    let equipment_key = ContainerKey {
        kind: ContainerKind::Equipment,
        id: "equipment".into(),
        owner_id: Some("owner".into()),
    };
    let mut source = Container::new(source_key.clone(), 1);
    source.slots[0] = Some(ItemStack::simple(1, 1));
    state.insert_container(source).unwrap();
    let mut equipment = Container::new(equipment_key.clone(), 1);
    equipment.equipment_tags[0] = Some("helmet".into());
    state.insert_container(equipment).unwrap();
    let error = state
        .transfer(&TransferCommand {
            from: SlotRef {
                container: source_key,
                slot: 0,
                expected_container_revision: None,
            },
            to: SlotRef {
                container: equipment_key,
                slot: 0,
                expected_container_revision: None,
            },
            count: 1,
            expected: None,
        })
        .unwrap_err();
    assert_eq!(error.code, RejectionCode::RulesRejected);
}

#[test]
fn exact_idempotent_retry_returns_original_receipt_without_second_mutation() {
    let mut authority = reference_authority();
    let command = GameplayCommand::Inventory(InventoryCommand::Transfer(TransferCommand {
        from: SlotRef {
            container: ContainerKey::player("player-1"),
            slot: 0,
            expected_container_revision: Some(0),
        },
        to: SlotRef {
            container: ContainerKey::player("player-1"),
            slot: 5,
            expected_container_revision: Some(0),
        },
        count: 1,
        expected: None,
    }));
    let request = batch(&authority, "retry", vec![command]);
    let first = accepted(authority.apply_batch(&request));
    let second = accepted(authority.apply_batch(&request));
    assert_eq!(first, second);
    assert_eq!(authority.state.revision.sequence, 1);
    assert_eq!(authority.replay().len(), 1);
}

#[test]
fn idempotency_key_cannot_be_reused_for_other_commands() {
    let mut authority = reference_authority();
    let first = batch(
        &authority,
        "collision",
        vec![GameplayCommand::Inventory(InventoryCommand::Transfer(
            TransferCommand {
                from: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 0,
                    expected_container_revision: Some(0),
                },
                to: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 5,
                    expected_container_revision: Some(0),
                },
                count: 1,
                expected: None,
            },
        ))],
    );
    accepted(authority.apply_batch(&first));
    let mut second = GameplayBatch::new(
        "other",
        "key-collision",
        reference_actor(),
        authority.state.identity(),
        vec![GameplayCommand::Inventory(InventoryCommand::Transfer(
            TransferCommand {
                from: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 0,
                    expected_container_revision: Some(1),
                },
                to: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 6,
                    expected_container_revision: Some(1),
                },
                count: 2,
                expected: None,
            },
        ))],
    );
    second.idempotency_key = first.idempotency_key.clone();
    assert_eq!(rejection(authority.apply_batch(&second)).code, RejectionCode::Conflict);
}

#[test]
fn stale_identity_rejects_without_mutation() {
    let mut authority = reference_authority();
    let stale = authority.state.identity();
    let first = batch(
        &authority,
        "first",
        vec![GameplayCommand::Inventory(InventoryCommand::Transfer(
            TransferCommand {
                from: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 0,
                    expected_container_revision: Some(0),
                },
                to: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 5,
                    expected_container_revision: Some(0),
                },
                count: 1,
                expected: None,
            },
        ))],
    );
    accepted(authority.apply_batch(&first));
    let before = authority.state.state_hash();
    let second = GameplayBatch::new(
        "stale",
        "stale",
        reference_actor(),
        stale,
        vec![GameplayCommand::Inventory(InventoryCommand::Transfer(
            TransferCommand {
                from: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 0,
                    expected_container_revision: None,
                },
                to: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 6,
                    expected_container_revision: None,
                },
                count: 1,
                expected: None,
            },
        ))],
    );
    assert_eq!(
        rejection(authority.apply_batch(&second)).code,
        RejectionCode::StaleRevision
    );
    assert_eq!(authority.state.state_hash(), before);
}

#[test]
fn tampered_command_hash_is_rejected() {
    let mut authority = reference_authority();
    let mut request = batch(
        &authority,
        "tampered",
        vec![GameplayCommand::Progression(ProgressionCommand {
            action: ProgressionAction::FastTravel,
            owner_id: "player-1".into(),
            record_id: "player-1".into(),
            expected_record_revision: 0,
            option_id: "waystone".into(),
            quantity: 1,
            currency_id: None,
            payload: None,
        })],
    );
    request.command_hash = CanonicalHash([7; 16]);
    assert_eq!(
        rejection(authority.apply_batch(&request)).code,
        RejectionCode::InvalidCommand
    );
}

#[test]
fn oversized_batch_and_payload_are_rejected() {
    let mut authority = reference_authority();
    let template = GameplayCommand::Progression(ProgressionCommand {
        action: ProgressionAction::FastTravel,
        owner_id: "player-1".into(),
        record_id: "player-1".into(),
        expected_record_revision: 0,
        option_id: "waystone".into(),
        quantity: 1,
        currency_id: None,
        payload: None,
    });
    let too_many = batch(&authority, "many", vec![template; MAX_COMMANDS_PER_BATCH + 1]);
    assert_eq!(
        rejection(authority.apply_batch(&too_many)).code,
        RejectionCode::Capacity
    );
    let oversized = batch(
        &authority,
        "payload",
        vec![GameplayCommand::Combat(CombatCommand::Pacify {
            source_id: "player-1".into(),
            creature_id: "creature-1".into(),
            expected_creature_revision: 0,
            method: PacifyMethod::Outmaneuver,
            evidence: OpaquePayload {
                type_id: "evidence".into(),
                schema: 1,
                bytes: vec![0; MAX_PAYLOAD_BYTES + 1],
            },
            tick: 100,
        })],
    );
    assert_eq!(
        rejection(authority.apply_batch(&oversized)).code,
        RejectionCode::Capacity
    );
}

#[test]
fn failed_second_command_rolls_back_first_command_and_revisions() {
    let mut authority = reference_authority();
    let before = authority.state.clone();
    let request = batch(
        &authority,
        "rollback",
        vec![
            GameplayCommand::Inventory(InventoryCommand::Transfer(TransferCommand {
                from: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 0,
                    expected_container_revision: Some(0),
                },
                to: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 5,
                    expected_container_revision: Some(0),
                },
                count: 1,
                expected: None,
            })),
            GameplayCommand::Inventory(InventoryCommand::Transfer(TransferCommand {
                from: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 9,
                    expected_container_revision: None,
                },
                to: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 6,
                    expected_container_revision: None,
                },
                count: 999,
                expected: None,
            })),
        ],
    );
    assert_eq!(
        rejection(authority.apply_batch(&request)).code,
        RejectionCode::InsufficientResource
    );
    assert_eq!(authority.state, before);
    assert!(authority.replay().is_empty());
}

#[test]
fn actor_grant_and_self_scope_are_enforced() {
    let mut authority = reference_authority();
    let guest = GameplayActor {
        actor_id: "guest".into(),
        player_id: Some(PlayerId::new(2, 1)),
        entity_id: Some(EntityId::new(2, 1)),
        role: ActorRole::Guest,
    };
    authority
        .grant_actor(
            "guest",
            ActorGrant {
                player_id: guest.player_id,
                entity_id: guest.entity_id,
                role: ActorRole::Guest,
                scopes: BTreeSet::from([Scope::InventorySelf]),
            },
        )
        .unwrap();
    let request = GameplayBatch::new(
        "guest-batch",
        "guest-key",
        guest,
        authority.state.identity(),
        vec![GameplayCommand::Inventory(InventoryCommand::Transfer(
            TransferCommand {
                from: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 0,
                    expected_container_revision: Some(0),
                },
                to: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 5,
                    expected_container_revision: Some(0),
                },
                count: 1,
                expected: None,
            },
        ))],
    );
    assert_eq!(
        rejection(authority.apply_batch(&request)).code,
        RejectionCode::Unauthorized
    );
}

#[test]
fn hosting_the_authority_does_not_grant_gameplay_admin_privileges() {
    let mut authority = reference_authority();
    let foreign_key = ContainerKey::player("other-player");
    authority
        .state
        .inventory
        .insert_container(Container::new(foreign_key.clone(), 2))
        .unwrap();
    let request = batch(
        &authority,
        "host-is-not-admin",
        vec![GameplayCommand::Inventory(InventoryCommand::Transfer(
            TransferCommand {
                from: SlotRef {
                    container: ContainerKey::player("player-1"),
                    slot: 0,
                    expected_container_revision: Some(0),
                },
                to: SlotRef {
                    container: foreign_key,
                    slot: 0,
                    expected_container_revision: Some(0),
                },
                count: 1,
                expected: None,
            },
        ))],
    );
    assert_eq!(
        rejection(authority.apply_batch(&request)).code,
        RejectionCode::Unauthorized
    );
}

#[test]
fn capture_is_custody_then_care_bond_not_instant_friendship() {
    let mut authority = reference_authority();
    let capture = batch(
        &authority,
        "capture",
        vec![GameplayCommand::Combat(CombatCommand::Capture {
            source_id: "player-1".into(),
            creature_id: "creature-1".into(),
            expected_creature_revision: 0,
            orb_item_code: 3,
            tick: 10,
        })],
    );
    accepted(authority.apply_batch(&capture));
    let creature = &authority.state.combat.creatures["creature-1"];
    assert_eq!(creature.readiness, CaptureReadiness::Captured);
    assert!(creature.owner_id.is_none());
    let care = batch(
        &authority,
        "care",
        vec![GameplayCommand::Combat(CombatCommand::Care {
            source_id: "player-1".into(),
            creature_id: "creature-1".into(),
            expected_creature_revision: 1,
            care_item_code: 4,
            amount: 20,
            tick: 20,
        })],
    );
    accepted(authority.apply_batch(&care));
    let creature = &authority.state.combat.creatures["creature-1"];
    assert_eq!(creature.readiness, CaptureReadiness::Bonded);
    assert_eq!(creature.owner_id.as_deref(), Some("player-1"));
}

#[test]
fn non_damage_pacification_has_cooldown_and_visible_progress() {
    let mut authority = reference_authority();
    for index in 0_u64..3 {
        let expected = index;
        let request = batch(
            &authority,
            &format!("pacify-{index}"),
            vec![GameplayCommand::Combat(CombatCommand::Pacify {
                source_id: "player-1".into(),
                creature_id: "creature-1".into(),
                expected_creature_revision: expected,
                method: PacifyMethod::Outmaneuver,
                evidence: OpaquePayload {
                    type_id: "outmaneuver-window".into(),
                    schema: 1,
                    bytes: vec![u8::try_from(index).unwrap()],
                },
                tick: 100 + index,
            })],
        );
        accepted(authority.apply_batch(&request));
    }
    assert_eq!(
        authority.state.combat.creatures["creature-1"].readiness,
        CaptureReadiness::CalmByOutmaneuver
    );
}

#[test]
fn pack_rng_and_replay_are_deterministic() {
    let mut first = reference_authority();
    let mut second = reference_authority();
    let command = GameplayCommand::Cardforge(CardforgeCommand::OpenPack {
        record_id: "pack-record-1".into(),
        owner_id: "player-1".into(),
        expected_revision: 0,
    });
    let first_request = batch(&first, "pack", vec![command.clone()]);
    let second_request = batch(&second, "pack", vec![command]);
    let first_receipt = accepted(first.apply_batch(&first_request));
    let second_receipt = accepted(second.apply_batch(&second_request));
    assert_eq!(first_receipt, second_receipt);
    assert_eq!(first.state, second.state);
    assert_eq!(first.replay_hash(), second.replay_hash());
}

#[test]
fn deck_legality_checks_custody_and_copy_limits() {
    let mut state = CardforgeState::default();
    let printing = PrintingKey {
        card_id: "card".into(),
        variant_id: "base".into(),
        finish_id: "normal".into(),
    };
    state
        .register_card(CardDefinition {
            printing: printing.clone(),
            rarity: CardRarity::Common,
            class_ids: BTreeSet::new(),
            type_ids: BTreeSet::new(),
            deck_cost: 1,
            power: 1,
            health: 1,
            rules: None,
        })
        .unwrap();
    state.custody.insert(
        "owner".into(),
        CardCustody {
            owner_id: "owner".into(),
            revision: 0,
            case: BTreeMap::from([(printing.clone(), 4)]),
            archive: BTreeMap::new(),
            rewards_claimed: BTreeSet::new(),
        },
    );
    state.deck_rules.insert(
        "rules".into(),
        DeckRules {
            min_cards: 1,
            max_cards: 10,
            max_copies: 2,
            max_cost: 10,
            allowed_classes: BTreeSet::new(),
            banned_cards: BTreeSet::new(),
        },
    );
    let error = state
        .apply(&CardforgeCommand::BuildDeck {
            deck_id: "deck".into(),
            owner_id: "owner".into(),
            rules_id: "rules".into(),
            cards: BTreeMap::from([(printing, 3)]),
            expected_revision: None,
        })
        .unwrap_err();
    assert_eq!(error.code, RejectionCode::RulesRejected);
}

#[test]
fn machine_transfer_is_atomic_and_conservative() {
    let resource = ResourceKey {
        kind: ResourceKind::Item,
        content_id: "ore".into(),
        item_code: Some(1),
        metadata_hash: CanonicalHash::default(),
    };
    let mut machines = MachineStateSet::default();
    for (id, amount) in [("source", 10), ("destination", 0)] {
        machines
            .insert_machine(MachineState {
                machine_id: id.into(),
                owner_id: Some("owner".into()),
                kind: MachineKind::Logistics,
                revision: 0,
                active: true,
                recipe_id: None,
                progress_ticks: 0,
                last_tick: 0,
                ports: BTreeMap::from([(
                    "main".into(),
                    MachinePort {
                        port_id: "main".into(),
                        mode: PortMode::Bidirectional,
                        accepted: BTreeSet::from([ResourceKind::Item]),
                        capacity: 64,
                        resources: if amount == 0 {
                            BTreeMap::new()
                        } else {
                            BTreeMap::from([(resource.clone(), amount)])
                        },
                    },
                )]),
                lease: None,
                settings: None,
            })
            .unwrap();
    }
    let before = machines.item_resource_totals();
    machines
        .apply(
            &MachineCommand::Transfer {
                from: ResourceEndpoint {
                    machine_id: "source".into(),
                    port_id: "main".into(),
                },
                to: ResourceEndpoint {
                    machine_id: "destination".into(),
                    port_id: "main".into(),
                },
                resource,
                amount: 6,
                expected_from_revision: 0,
                expected_to_revision: 0,
            },
            0,
        )
        .unwrap();
    assert_eq!(before, machines.item_resource_totals());
}

#[test]
fn activity_lease_bounds_dormant_machine_cycles_without_backlog() {
    let ore = ResourceKey {
        kind: ResourceKind::Item,
        content_id: "ore".into(),
        item_code: Some(1),
        metadata_hash: CanonicalHash::default(),
    };
    let ingot = ResourceKey {
        kind: ResourceKind::Item,
        content_id: "ingot".into(),
        item_code: Some(2),
        metadata_hash: CanonicalHash::default(),
    };
    let mut machines = MachineStateSet::default();
    machines
        .register_recipe(MachineRecipe {
            recipe_id: "smelt".into(),
            duration_ticks: 10,
            inputs: BTreeMap::from([(ore.clone(), 1)]),
            outputs: BTreeMap::from([(ingot.clone(), 1)]),
        })
        .unwrap();
    machines
        .insert_machine(MachineState {
            machine_id: "furnace".into(),
            owner_id: Some("owner".into()),
            kind: MachineKind::Furnace,
            revision: 0,
            active: true,
            recipe_id: Some("smelt".into()),
            progress_ticks: 0,
            last_tick: 0,
            ports: BTreeMap::from([
                (
                    "input".into(),
                    MachinePort {
                        port_id: "input".into(),
                        mode: PortMode::Input,
                        accepted: BTreeSet::from([ResourceKind::Item]),
                        capacity: 100,
                        resources: BTreeMap::from([(ore.clone(), 100)]),
                    },
                ),
                (
                    "output".into(),
                    MachinePort {
                        port_id: "output".into(),
                        mode: PortMode::Output,
                        accepted: BTreeSet::from([ResourceKind::Item]),
                        capacity: 100,
                        resources: BTreeMap::new(),
                    },
                ),
            ]),
            lease: Some(ActivityLease {
                lease_id: "lease".into(),
                owner_id: "owner".into(),
                start_tick: 0,
                end_tick: 100,
                max_cycles: 3,
            }),
            settings: None,
        })
        .unwrap();
    machines
        .apply(
            &MachineCommand::Advance {
                machine_id: "furnace".into(),
                expected_revision: 0,
                to_tick: 100,
            },
            100,
        )
        .unwrap();
    let machine = &machines.machines["furnace"];
    assert_eq!(machine.ports["input"].resources[&ore], 97);
    assert_eq!(machine.ports["output"].resources[&ingot], 3);
    assert_eq!(machine.progress_ticks, 0);
}

#[test]
fn furnace_advances_analytically_and_conserves_declared_recipe_delta() {
    let mut inventory = InventoryState::default();
    for (code, id) in [(1, "ore"), (2, "ingot"), (3, "fuel")] {
        inventory
            .register_item(ItemDefinition {
                code,
                content_id: id.into(),
                max_stack: 64,
                tags: BTreeSet::new(),
            })
            .unwrap();
    }
    let source_key = ContainerKey {
        kind: ContainerKind::Machine,
        id: "furnace-input".into(),
        owner_id: Some("owner".into()),
    };
    let destination_key = ContainerKey {
        kind: ContainerKind::Machine,
        id: "furnace-output".into(),
        owner_id: Some("owner".into()),
    };
    let mut source = Container::new(source_key.clone(), 4);
    source.slots[0] = Some(ItemStack::simple(1, 10));
    source.slots[1] = Some(ItemStack::simple(3, 10));
    inventory.insert_container(source).unwrap();
    inventory
        .insert_container(Container::new(destination_key.clone(), 4))
        .unwrap();
    inventory
        .register_recipe(Recipe {
            recipe_id: "smelt".into(),
            station_tag: Some("furnace".into()),
            inputs: vec![Ingredient {
                item_code: 1,
                metadata_hash: None,
                count: 1,
            }],
            outputs: vec![ItemStack::simple(2, 1)],
            ticks: 5,
        })
        .unwrap();
    inventory.furnaces.insert(
        "furnace".into(),
        FurnaceState {
            furnace_id: "furnace".into(),
            revision: 0,
            recipe_id: "smelt".into(),
            source: source_key,
            destination: destination_key.clone(),
            progress_ticks: 0,
            fuel_ticks: 20,
            last_tick: 0,
            active: true,
        },
    );
    let deltas = inventory
        .advance_furnace(&FurnaceAdvanceCommand {
            furnace_id: "furnace".into(),
            expected_revision: 0,
            to_tick: 10,
            fuel_item: None,
            fuel_ticks_per_item: 0,
        })
        .unwrap();
    assert_eq!(deltas.iter().map(|delta| delta.amount).sum::<i64>(), 0);
    assert_eq!(
        inventory.containers[&destination_key].slots[0].as_ref().unwrap().count,
        2
    );
}

fn combat_test_combatant(record_id: &str, x_milli: i32) -> CombatantState {
    CombatantState {
        record_id: record_id.into(),
        owner_id: None,
        revision: 0,
        position: FixedVec3 {
            x_milli,
            y_milli: 0,
            z_milli: 0,
        },
        health: 100,
        max_health: 100,
        stamina: 100,
        mana: 100,
        armor: 0,
        resist_per_mille: BTreeMap::new(),
        statuses: BTreeMap::new(),
        cooldown_until: BTreeMap::new(),
        alive: true,
        vital_units: CombatVitalUnits::LegacyWholeHeartsV1,
        entity_id: None,
    }
}

fn linked_player_combatant(record_id: &str, entity_id: EntityId) -> CombatantState {
    CombatantState {
        record_id: record_id.into(),
        owner_id: Some(record_id.into()),
        revision: 0,
        position: FixedVec3 {
            x_milli: 8_000,
            y_milli: 64_000,
            z_milli: 8_000,
        },
        health: 9_500,
        max_health: 10_000,
        stamina: 0,
        mana: 0,
        armor: 0,
        resist_per_mille: BTreeMap::new(),
        statuses: BTreeMap::new(),
        cooldown_until: BTreeMap::new(),
        alive: true,
        vital_units: CombatVitalUnits::MilliheartsV1,
        entity_id: Some(entity_id),
    }
}

#[test]
fn linked_player_combat_install_is_replay_safe_and_rejects_duplicate_entity_claims() {
    let entity_id = EntityId::new(7, 2);
    let mut authority = GameplayAuthority::new(GameplayState::new(WorldKey::new("world", "surface"), 1));
    let combatant = linked_player_combatant("actor:player", entity_id);
    let before_hash = authority.state.state_hash();
    assert!(authority.install_linked_combatant_v1(combatant.clone()).unwrap());
    let installed_hash = authority.state.state_hash();
    assert_ne!(installed_hash, before_hash);
    assert_eq!(
        (authority.state.revision.sequence, authority.state.revision.combat),
        (1, 1)
    );
    assert!(
        authority.state.combat.abilities.is_empty(),
        "bootstrap must not fabricate abilities"
    );

    let evolved = authority.state.combat.combatants.get_mut("actor:player").unwrap();
    evolved.revision = 3;
    evolved.position.x_milli = 12_500;
    evolved.stamina = 73;
    evolved.mana = 41;
    evolved.armor = 8;
    let evolved_hash = authority.state.state_hash();
    assert!(!authority.install_linked_combatant_v1(combatant).unwrap());
    let replayed = &authority.state.combat.combatants["actor:player"];
    assert_eq!(replayed.revision, 3);
    assert_eq!(replayed.position.x_milli, 12_500);
    assert_eq!((replayed.stamina, replayed.mana, replayed.armor), (73, 41, 8));
    assert_eq!(authority.state.state_hash(), evolved_hash);
    assert_ne!(evolved_hash, installed_hash);
    assert_eq!(
        (authority.state.revision.sequence, authority.state.revision.combat),
        (1, 1)
    );

    let error = authority
        .install_linked_combatant_v1(linked_player_combatant("actor:duplicate", entity_id))
        .unwrap_err();
    assert_eq!(error.code, RejectionCode::Conflict);
    assert!(!authority.state.combat.combatants.contains_key("actor:duplicate"));
}

#[test]
fn linked_player_combat_install_never_reinterprets_legacy_records() {
    let entity_id = EntityId::new(8, 2);
    let mut state = GameplayState::new(WorldKey::new("world", "surface"), 1);
    state
        .combat
        .combatants
        .insert("actor:legacy".into(), combat_test_combatant("actor:legacy", 0));
    let before = state.clone();
    let mut authority = GameplayAuthority::new(state);
    let error = authority
        .install_linked_combatant_v1(linked_player_combatant("actor:legacy", entity_id))
        .unwrap_err();
    assert_eq!(error.code, RejectionCode::Conflict);
    assert_eq!(authority.state, before);
}

#[test]
fn linked_player_respawn_restores_exact_dead_combatant_once_and_rejects_stale_or_live_state() {
    let entity_id = EntityId::new(9, 2);
    let mut authority = GameplayAuthority::new(GameplayState::new(WorldKey::new("world", "surface"), 1));
    let mut combatant = linked_player_combatant("actor:respawn", entity_id);
    combatant.revision = 7;
    combatant.health = 0;
    combatant.alive = false;
    authority
        .state
        .combat
        .combatants
        .insert(combatant.record_id.clone(), combatant);
    authority.state.revision.sequence = 12;
    authority.state.revision.combat = 4;
    let before_replay = authority.replay().len();

    authority
        .restore_linked_combatant_after_death_v1("actor:respawn", entity_id, 7, 10_000, 3)
        .unwrap();

    let restored = &authority.state.combat.combatants["actor:respawn"];
    assert_eq!(
        (restored.health, restored.max_health, restored.alive),
        (10_000, 10_000, true)
    );
    assert_eq!(restored.revision, 8);
    assert_eq!(
        (authority.state.revision.sequence, authority.state.revision.combat),
        (13, 5)
    );
    assert_eq!(authority.replay().len(), before_replay + 1);
    assert_eq!(authority.replay().last().unwrap().actor_id, "system:player-respawn");

    let committed = authority.state.clone();
    let replay_hash = authority.replay_hash();
    let error = authority
        .restore_linked_combatant_after_death_v1("actor:respawn", entity_id, 7, 10_000, 3)
        .unwrap_err();
    assert_eq!(error.code, RejectionCode::Conflict);
    assert_eq!(authority.state, committed);
    assert_eq!(authority.replay_hash(), replay_hash);

    let mut wrong_link = authority.clone();
    let restored = wrong_link.state.combat.combatants.get_mut("actor:respawn").unwrap();
    restored.health = 0;
    restored.alive = false;
    restored.entity_id = Some(EntityId::new(10, 2));
    let before = wrong_link.state.clone();
    let error = wrong_link
        .restore_linked_combatant_after_death_v1("actor:respawn", entity_id, 8, 10_000, 4)
        .unwrap_err();
    assert_eq!(error.code, RejectionCode::Conflict);
    assert_eq!(wrong_link.state, before);
}

fn player_death_release(
    player_id: PlayerId,
    death_sequence: u64,
    source_lane: PlayerDeathCustodyLaneV1,
    source_slot: u16,
    expected_stack: ItemStack,
) -> PlayerDeathCustodyReleaseV1 {
    PlayerDeathCustodyReleaseV1 {
        source_lane,
        source_slot,
        expected_stack,
        custody: ContainerKey {
            kind: ContainerKind::Container,
            id: player_death_custody_id_v1(player_id, death_sequence, source_lane, source_slot),
            owner_id: None,
        },
    }
}

fn player_death_custody_fixture() -> (
    GameplayAuthority,
    PlayerDeathRespawnCustodyPlanV1,
    ItemInstanceMetadataV1,
) {
    let record_id = "actor:death-custody";
    let player_id = PlayerId::new(301, 7);
    let entity_id = EntityId::new(302, 7);
    let death_sequence = 23;
    let inventory_key = ContainerKey::player(record_id);
    let equipment_key = ContainerKey {
        kind: ContainerKind::Equipment,
        id: format!("{record_id}:equipment"),
        owner_id: Some(record_id.into()),
    };
    let mut state = GameplayState::new(WorldKey::new("death-world", "surface"), 3);
    state
        .inventory
        .register_item(ItemDefinition {
            code: 91,
            content_id: "death-stack".into(),
            max_stack: 64,
            tags: BTreeSet::new(),
        })
        .unwrap();
    state
        .inventory
        .register_item(ItemDefinition {
            code: 92,
            content_id: "death-durable".into(),
            max_stack: 1,
            tags: BTreeSet::from(["back".into()]),
        })
        .unwrap();
    let mut metadata = ItemInstanceMetadataV1 {
        hash: CanonicalHash::default(),
        type_id: "blockwild.item.instance".into(),
        schema_id: "death-custody-test".into(),
        schema_version: 1,
        content_version: 4,
        canonical_json_bytes: b"{\"name\":\"Exact drop\",\"version\":1}".to_vec(),
        unknown_extension_bytes: vec![0, 0x80, 0xff, 5],
    };
    metadata.hash = metadata.calculate_hash();
    state
        .inventory
        .item_instance_metadata
        .insert(metadata.hash, metadata.clone());

    let inventory_stacks = [
        (0_u16, ItemStack::simple(91, 12)),
        (
            4,
            ItemStack {
                item_code: 92,
                count: 1,
                durability_millionths: Some(987_654),
                metadata_hash: metadata.hash,
            },
        ),
    ];
    let equipment_stacks = [
        (2_u16, ItemStack::simple(91, 3)),
        (
            7,
            ItemStack {
                item_code: 92,
                count: 1,
                durability_millionths: Some(654_321),
                metadata_hash: metadata.hash,
            },
        ),
    ];
    let mut inventory = Container::new(inventory_key.clone(), PLAYER_DEATH_INVENTORY_SLOTS_V1);
    inventory.revision = 4;
    for (slot, stack) in &inventory_stacks {
        inventory.slots[usize::from(*slot)] = Some(stack.clone());
    }
    state.inventory.insert_container(inventory).unwrap();
    let mut equipment = Container::new(equipment_key.clone(), PLAYER_DEATH_EQUIPMENT_SLOTS_V1);
    equipment.revision = 6;
    equipment.equipment_tags[7] = Some("back".into());
    for (slot, stack) in &equipment_stacks {
        equipment.slots[usize::from(*slot)] = Some(stack.clone());
    }
    state.inventory.insert_container(equipment).unwrap();

    let mut combatant = linked_player_combatant(record_id, entity_id);
    combatant.revision = 7;
    combatant.health = 0;
    combatant.alive = false;
    state.combat.combatants.insert(record_id.into(), combatant);
    state.revision.sequence = 20;
    state.revision.combat = 8;
    state.revision.inventory = 11;
    let releases = inventory_stacks
        .into_iter()
        .map(|(slot, stack)| {
            player_death_release(
                player_id,
                death_sequence,
                PlayerDeathCustodyLaneV1::Inventory,
                slot,
                stack,
            )
        })
        .chain(equipment_stacks.into_iter().map(|(slot, stack)| {
            player_death_release(
                player_id,
                death_sequence,
                PlayerDeathCustodyLaneV1::Equipment,
                slot,
                stack,
            )
        }))
        .collect();
    let plan = PlayerDeathRespawnCustodyPlanV1 {
        record_id: record_id.into(),
        player_id,
        entity_id,
        expected_combatant_revision: 7,
        expected_max_health: 10_000,
        death_sequence,
        inventory: inventory_key,
        expected_inventory_revision: 4,
        equipment: equipment_key,
        expected_equipment_revision: 6,
        releases,
    };
    (GameplayAuthority::new(state), plan, metadata)
}

#[test]
fn death_custody_respawn_moves_full_stacks_in_canonical_order_with_one_revision_each() {
    let (mut authority, plan, metadata) = player_death_custody_fixture();
    let before_hash = authority.state.state_hash();
    let before_totals = authority.state.inventory.resource_totals();
    let before_metadata = authority.state.inventory.item_instance_metadata.clone();

    let receipt = authority.respawn_linked_combatant_with_death_custody_v1(&plan).unwrap();

    assert_eq!(receipt.before_state_hash, before_hash);
    assert_eq!(receipt.after_state_hash, authority.state.state_hash());
    assert_eq!(receipt.gameplay_sequence, 21);
    assert_eq!(receipt.combatant_revision, 8);
    assert!(receipt.inventory_changed);
    assert_eq!(receipt.releases, plan.releases);
    assert_eq!(
        receipt
            .releases
            .iter()
            .map(|release| (release.source_lane, release.source_slot))
            .collect::<Vec<_>>(),
        [
            (PlayerDeathCustodyLaneV1::Inventory, 0),
            (PlayerDeathCustodyLaneV1::Inventory, 4),
            (PlayerDeathCustodyLaneV1::Equipment, 2),
            (PlayerDeathCustodyLaneV1::Equipment, 7),
        ]
    );
    let inventory = &authority.state.inventory.containers[&plan.inventory];
    let equipment = &authority.state.inventory.containers[&plan.equipment];
    assert_eq!(inventory.revision, 5);
    assert_eq!(equipment.revision, 7);
    assert!(inventory.slots.iter().all(Option::is_none));
    assert!(equipment.slots.iter().all(Option::is_none));
    for release in &plan.releases {
        let custody = &authority.state.inventory.containers[&release.custody];
        assert_eq!(custody.revision, 0);
        assert_eq!(custody.slots, [Some(release.expected_stack.clone())]);
        assert_eq!(custody.key.kind, ContainerKind::Container);
        assert_eq!(custody.key.owner_id, None);
    }
    let durable = &authority.state.inventory.containers[&plan.releases[1].custody].slots[0];
    assert_eq!(durable.as_ref().unwrap().durability_millionths, Some(987_654));
    assert_eq!(durable.as_ref().unwrap().metadata_hash, metadata.hash);
    assert_eq!(authority.state.inventory.item_instance_metadata, before_metadata);
    assert_eq!(
        authority.state.inventory.item_instance_metadata[&metadata.hash].unknown_extension_bytes,
        [0, 0x80, 0xff, 5]
    );
    assert_eq!(authority.state.inventory.resource_totals(), before_totals);
    assert_eq!(
        (
            authority.state.revision.sequence,
            authority.state.revision.combat,
            authority.state.revision.inventory,
        ),
        (21, 9, 12)
    );
    let combatant = &authority.state.combat.combatants[&plan.record_id];
    assert_eq!(
        (combatant.health, combatant.alive, combatant.revision),
        (10_000, true, 8)
    );
    assert_eq!(authority.replay().len(), 1);
    let replay = &authority.replay()[0];
    assert_eq!(replay.before_hash, receipt.before_state_hash);
    assert_eq!(replay.after_hash, receipt.after_state_hash);
    assert_eq!(replay.command_hash, receipt.command_hash);
    assert_eq!(replay.receipt_hash, receipt.receipt_hash);

    let (mut repeated_authority, repeated_plan, _) = player_death_custody_fixture();
    let repeated_receipt = repeated_authority
        .respawn_linked_combatant_with_death_custody_v1(&repeated_plan)
        .unwrap();
    assert_eq!(receipt, repeated_receipt);
    assert_eq!(authority.state, repeated_authority.state);
    assert_eq!(authority.replay(), repeated_authority.replay());
}

#[test]
fn death_custody_respawn_is_idempotent_across_checkpoint_and_replay_roundtrip() {
    let (mut authority, plan, _) = player_death_custody_fixture();
    let first = authority.respawn_linked_combatant_with_death_custody_v1(&plan).unwrap();
    let committed_state = authority.state.clone();
    let committed_replay = authority.replay().to_vec();
    let retry = authority.respawn_linked_combatant_with_death_custody_v1(&plan).unwrap();
    assert_eq!(retry, first);
    assert_eq!(authority.state, committed_state);
    assert_eq!(authority.replay(), committed_replay);

    let snapshot = authority.encode_snapshot(&[0xde, 0xad]).unwrap();
    let decoded = decode_gameplay_authority_snapshot(&snapshot).unwrap();
    assert_eq!(decoded.authority.state, authority.state);
    assert_eq!(decoded.authority.replay(), authority.replay());
    assert_eq!(decoded.authority.encode_snapshot(&[0xde, 0xad]).unwrap(), snapshot);
    let mut restored = decoded.authority;
    let restored_retry = restored.respawn_linked_combatant_with_death_custody_v1(&plan).unwrap();
    assert_eq!(restored_retry, first);
    assert_eq!(restored.state, committed_state);
    assert_eq!(restored.replay(), committed_replay);

    let mut changed_plan = plan.clone();
    changed_plan.releases[0].expected_stack.count -= 1;
    let before = restored.state.clone();
    let before_replay = restored.replay().to_vec();
    assert_eq!(
        restored
            .respawn_linked_combatant_with_death_custody_v1(&changed_plan)
            .unwrap_err()
            .code,
        RejectionCode::Conflict
    );
    assert_eq!(restored.state, before);
    assert_eq!(restored.replay(), before_replay);
}

#[test]
fn empty_death_custody_restores_combat_without_advancing_inventory_or_source_revisions() {
    let (mut authority, mut plan, _) = player_death_custody_fixture();
    authority
        .state
        .inventory
        .containers
        .get_mut(&plan.inventory)
        .unwrap()
        .slots
        .fill(None);
    authority
        .state
        .inventory
        .containers
        .get_mut(&plan.equipment)
        .unwrap()
        .slots
        .fill(None);
    plan.releases.clear();
    let inventory_domain_revision = authority.state.revision.inventory;

    let receipt = authority.respawn_linked_combatant_with_death_custody_v1(&plan).unwrap();
    assert!(!receipt.inventory_changed);
    assert!(receipt.releases.is_empty());
    assert_eq!(authority.state.revision.inventory, inventory_domain_revision);
    assert_eq!(authority.state.inventory.containers[&plan.inventory].revision, 4);
    assert_eq!(authority.state.inventory.containers[&plan.equipment].revision, 6);
    assert_eq!(authority.state.inventory.containers.len(), 2);
    assert!(authority.state.combat.combatants[&plan.record_id].alive);

    let (mut keep_authority, keep_plan, _) = player_death_custody_fixture();
    let before_inventory = keep_authority.state.inventory.clone();
    let before_inventory_domain = keep_authority.state.revision.inventory;
    keep_authority
        .restore_linked_combatant_after_death_v1(
            &keep_plan.record_id,
            keep_plan.entity_id,
            keep_plan.expected_combatant_revision,
            keep_plan.expected_max_health,
            keep_plan.death_sequence,
        )
        .unwrap();
    assert_eq!(keep_authority.state.inventory, before_inventory);
    assert_eq!(keep_authority.state.revision.inventory, before_inventory_domain);
    assert!(keep_authority.state.combat.combatants[&keep_plan.record_id].alive);
}

#[test]
fn death_custody_preflight_rejects_stale_stack_metadata_identity_and_collision_atomically() {
    type Mutation = Box<dyn Fn(&mut GameplayAuthority, &mut PlayerDeathRespawnCustodyPlanV1)>;
    let mutations: Vec<Mutation> = vec![
        Box::new(|_, plan| plan.expected_inventory_revision += 1),
        Box::new(|_, plan| plan.releases.swap(0, 1)),
        Box::new(|_, plan| plan.releases[0].expected_stack.count -= 1),
        Box::new(|_, plan| plan.releases[0].custody.id.push_str(":wrong")),
        Box::new(|_, plan| plan.releases[0].custody.owner_id = Some(plan.record_id.clone())),
        Box::new(|authority, plan| {
            authority
                .state
                .inventory
                .item_instance_metadata
                .remove(&plan.releases[1].expected_stack.metadata_hash);
        }),
        Box::new(|authority, plan| {
            let custody = Container::new(plan.releases[0].custody.clone(), 1);
            authority
                .state
                .inventory
                .containers
                .insert(custody.key.clone(), custody);
        }),
        Box::new(|_, plan| plan.inventory.owner_id = Some("actor:other".into())),
    ];
    for mutate in mutations {
        let (mut authority, mut plan, _) = player_death_custody_fixture();
        mutate(&mut authority, &mut plan);
        let before_state = authority.state.clone();
        let before_replay = authority.replay().to_vec();
        assert!(authority.respawn_linked_combatant_with_death_custody_v1(&plan).is_err());
        assert_eq!(authority.state, before_state);
        assert_eq!(authority.replay(), before_replay);
    }
}

#[test]
fn death_custody_capacity_overflow_and_injected_staging_failure_are_atomic() {
    let (authority, plan, _) = player_death_custody_fixture();
    let mut injected = authority.state.inventory.clone();
    let before_injected = injected.clone();
    assert_eq!(
        injected
            .release_player_death_custody_with_injected_failure_for_test(&plan, 1)
            .unwrap_err()
            .code,
        RejectionCode::Conflict
    );
    assert_eq!(injected, before_injected);

    let mut overflow_authority = authority.clone();
    overflow_authority.state.revision.sequence = u64::MAX;
    let before_overflow = overflow_authority.state.clone();
    let before_replay = overflow_authority.replay().to_vec();
    assert_eq!(
        overflow_authority
            .respawn_linked_combatant_with_death_custody_v1(&plan)
            .unwrap_err()
            .code,
        RejectionCode::Capacity
    );
    assert_eq!(overflow_authority.state, before_overflow);
    assert_eq!(overflow_authority.replay(), before_replay);

    let mut source_overflow = authority.state.inventory.clone();
    source_overflow.containers.get_mut(&plan.inventory).unwrap().revision = u64::MAX;
    let mut source_overflow_plan = plan.clone();
    source_overflow_plan.expected_inventory_revision = u64::MAX;
    let before_source_overflow = source_overflow.clone();
    assert_eq!(
        source_overflow
            .release_player_death_custody_v1(&source_overflow_plan)
            .unwrap_err()
            .code,
        RejectionCode::Capacity
    );
    assert_eq!(source_overflow, before_source_overflow);

    let mut capacity = authority.state.inventory.clone();
    let target_existing = MAX_INVENTORY_CONTAINERS_V1 - plan.releases.len() + 1;
    for index in capacity.containers.len()..target_existing {
        let key = ContainerKey {
            kind: ContainerKind::Container,
            id: format!("death-capacity-{index}"),
            owner_id: None,
        };
        capacity.containers.insert(key.clone(), Container::new(key, 1));
    }
    let before_len = capacity.containers.len();
    let before_inventory = capacity.containers[&plan.inventory].clone();
    let before_equipment = capacity.containers[&plan.equipment].clone();
    assert_eq!(
        capacity.release_player_death_custody_v1(&plan).unwrap_err().code,
        RejectionCode::Capacity
    );
    assert_eq!(capacity.containers.len(), before_len);
    assert_eq!(capacity.containers[&plan.inventory], before_inventory);
    assert_eq!(capacity.containers[&plan.equipment], before_equipment);
}

#[test]
fn projectile_magic_applies_damage_status_and_cooldown_deterministically() {
    let mut combat = CombatState::default();
    combat
        .register_ability(AbilitySpec {
            ability_id: "frost-bolt".into(),
            damage_kind: DamageKind::Frost,
            base_damage: 20,
            range_milli: 5_000,
            cooldown_ticks: 20,
            stamina_cost: 0,
            mana_cost: 5,
            projectile_speed_milli: Some(500),
            status: Some(StatusTemplate {
                status_id: "chilled".into(),
                magnitude: 250,
                duration_ticks: 50,
                max_stacks: 3,
            }),
        })
        .unwrap();
    for (id, x) in [("mage", 0), ("target", 1_000)] {
        combat.combatants.insert(id.into(), combat_test_combatant(id, x));
    }
    combat
        .apply(&CombatCommand::UseAbility {
            source_id: "mage".into(),
            expected_source_revision: 0,
            target_id: "target".into(),
            expected_target_revision: 0,
            ability_id: "frost-bolt".into(),
            projectile_id: Some("bolt-1".into()),
            aim: FixedVec3 {
                x_milli: 500,
                y_milli: 0,
                z_milli: 0,
            },
            tick: 1,
        })
        .unwrap();
    combat
        .apply(&CombatCommand::ResolveProjectile {
            projectile_id: "bolt-1".into(),
            expected_revision: 0,
            target_id: Some("target".into()),
            impact: FixedVec3 {
                x_milli: 1_000,
                y_milli: 0,
                z_milli: 0,
            },
            tick: 2,
        })
        .unwrap();
    assert_eq!(combat.combatants["target"].health, 80);
    assert_eq!(combat.combatants["target"].statuses["chilled"].stacks, 1);
    assert_eq!(combat.combatants["mage"].mana, 95);
    assert_eq!(combat.combatants["mage"].cooldown_until["frost-bolt"], 21);
}

#[test]
fn precision_vital_direct_damage_rejects_atomically_and_legacy_damage_still_works() {
    let mut combat = CombatState::default();
    combat
        .register_ability(AbilitySpec {
            ability_id: "strike".into(),
            damage_kind: DamageKind::Physical,
            base_damage: 20,
            range_milli: 5_000,
            cooldown_ticks: 20,
            stamina_cost: 3,
            mana_cost: 4,
            projectile_speed_milli: None,
            status: None,
        })
        .unwrap();
    combat
        .combatants
        .insert("source".into(), combat_test_combatant("source", 0));
    combat
        .combatants
        .insert("target".into(), combat_test_combatant("target", 1_000));
    let target = combat.combatants.get_mut("target").unwrap();
    target.vital_units = CombatVitalUnits::MilliheartsV1;
    target.entity_id = Some(EntityId::new(71, 3));

    let command = CombatCommand::UseAbility {
        source_id: "source".into(),
        expected_source_revision: 0,
        target_id: "target".into(),
        expected_target_revision: 0,
        ability_id: "strike".into(),
        projectile_id: None,
        aim: FixedVec3::default(),
        tick: 1,
    };
    let before = combat.clone();
    let rejected = combat
        .apply(&command)
        .expect_err("precision direct damage must fail closed");
    assert_eq!(rejected.code, RejectionCode::InvalidCommand);
    assert_eq!(
        combat, before,
        "rejection cannot spend resources, author cooldowns, or deal damage"
    );

    let target = combat.combatants.get_mut("target").unwrap();
    target.vital_units = CombatVitalUnits::LegacyWholeHeartsV1;
    target.entity_id = None;
    combat.apply(&command).expect("legacy direct damage remains supported");
    assert_eq!(combat.combatants["source"].stamina, 97);
    assert_eq!(combat.combatants["source"].mana, 96);
    assert_eq!(combat.combatants["source"].cooldown_until["strike"], 21);
    assert_eq!(combat.combatants["target"].health, 80);
}

#[test]
fn precision_vital_projectile_damage_rejects_before_removal_and_can_retry_as_legacy() {
    let mut combat = CombatState::default();
    combat
        .register_ability(AbilitySpec {
            ability_id: "bolt".into(),
            damage_kind: DamageKind::Arcane,
            base_damage: 20,
            range_milli: 5_000,
            cooldown_ticks: 20,
            stamina_cost: 0,
            mana_cost: 5,
            projectile_speed_milli: Some(500),
            status: None,
        })
        .unwrap();
    combat
        .combatants
        .insert("source".into(), combat_test_combatant("source", 0));
    combat
        .combatants
        .insert("target".into(), combat_test_combatant("target", 1_000));
    combat
        .apply(&CombatCommand::UseAbility {
            source_id: "source".into(),
            expected_source_revision: 0,
            target_id: "target".into(),
            expected_target_revision: 0,
            ability_id: "bolt".into(),
            projectile_id: Some("bolt-precision-guard".into()),
            aim: FixedVec3 {
                x_milli: 500,
                y_milli: 0,
                z_milli: 0,
            },
            tick: 1,
        })
        .expect("legacy projectile spawn remains supported");
    let source = combat.combatants.get_mut("source").unwrap();
    source.vital_units = CombatVitalUnits::MilliheartsV1;
    source.entity_id = Some(EntityId::new(72, 3));

    let resolve = CombatCommand::ResolveProjectile {
        projectile_id: "bolt-precision-guard".into(),
        expected_revision: 0,
        target_id: Some("target".into()),
        impact: FixedVec3 {
            x_milli: 1_000,
            y_milli: 0,
            z_milli: 0,
        },
        tick: 2,
    };
    let before = combat.clone();
    let rejected = combat
        .apply(&resolve)
        .expect_err("precision projectile damage must fail closed");
    assert_eq!(rejected.code, RejectionCode::InvalidCommand);
    assert_eq!(
        combat, before,
        "rejection cannot remove the projectile or mutate either combatant"
    );

    let source = combat.combatants.get_mut("source").unwrap();
    source.vital_units = CombatVitalUnits::LegacyWholeHeartsV1;
    source.entity_id = None;
    combat
        .apply(&resolve)
        .expect("preserved legacy projectile remains resolvable");
    assert!(!combat.projectiles.contains_key("bolt-precision-guard"));
    assert_eq!(combat.combatants["target"].health, 80);
}

#[test]
fn linked_projectile_cumulative_fixed_step_remainder_is_signed_and_exact() {
    let run = |velocity: i32, steps: u64| {
        let mut position = FixedVec3::default();
        for revision in 0..steps {
            position = advance_projectile_position_v1(
                position,
                FixedVec3 {
                    x_milli: velocity,
                    ..FixedVec3::default()
                },
                revision,
                1,
            )
            .unwrap();
        }
        position.x_milli
    };

    assert_eq!(run(1, 19), 0);
    assert_eq!(run(-1, 19), 0);
    assert_eq!(run(1, 20), 1);
    assert_eq!(run(-1, 20), -1);
    assert_eq!(run(1, 21), 1);
    assert_eq!(run(-1, 21), -1);
}

#[test]
fn linked_summon_is_system_only_until_spell_resource_authority_exists() {
    let mut authority = reference_authority();
    let before = authority.state.identity();
    let receipt = authority.apply_batch(&batch(
        &authority,
        "linked-summon-player-rejected",
        vec![GameplayCommand::Combat(CombatCommand::SummonLinked {
            source_id: "player-one".into(),
            summon_id: "summon-水".into(),
            entity_id: EntityId::new(u32::MAX, u32::MAX),
            content_domain: ContentDomain::CreatureProfile,
            content_id: "creature-水".into(),
            presentation_id: "summon-水-profile".into(),
            position: FixedVec3::default(),
            duration_ticks: Some(20),
            grounding_item_code: None,
            tick: authority.state.tick,
        })],
    ));
    assert_eq!(rejection(receipt).code, RejectionCode::Unauthorized);
    assert_eq!(authority.state.identity(), before);
}

#[test]
fn malformed_identifiers_and_wrong_world_are_rejected() {
    let mut authority = reference_authority();
    let mut malformed = batch(
        &authority,
        "ok",
        vec![GameplayCommand::Progression(ProgressionCommand {
            action: ProgressionAction::FastTravel,
            owner_id: "player-1".into(),
            record_id: "player-1".into(),
            expected_record_revision: 0,
            option_id: "waystone".into(),
            quantity: 1,
            currency_id: None,
            payload: None,
        })],
    );
    malformed.batch_id = "bad\nname".into();
    assert_eq!(
        rejection(authority.apply_batch(&malformed)).code,
        RejectionCode::InvalidCommand
    );
    let mut wrong = batch(
        &authority,
        "wrong",
        vec![GameplayCommand::Progression(ProgressionCommand {
            action: ProgressionAction::FastTravel,
            owner_id: "player-1".into(),
            record_id: "player-1".into(),
            expected_record_revision: 0,
            option_id: "waystone".into(),
            quantity: 1,
            currency_id: None,
            payload: None,
        })],
    );
    wrong.identity.world.location = "other".into();
    assert_eq!(rejection(authority.apply_batch(&wrong)).code, RejectionCode::WrongWorld);
}

fn schedule_system_actor() -> GameplayActor {
    GameplayActor {
        actor_id: "gameplay-scheduler".into(),
        player_id: None,
        entity_id: None,
        role: ActorRole::System,
    }
}

fn schedule_batch(
    authority: &GameplayAuthority,
    suffix: &str,
    expected_tick: Tick,
    to_tick: Tick,
    machine_budget: u16,
) -> GameplayBatch {
    GameplayBatch::new(
        format!("schedule-batch-{suffix}"),
        format!("schedule-key-{suffix}"),
        schedule_system_actor(),
        authority.state.identity(),
        vec![GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
            expected_tick,
            to_tick,
            machine_budget,
        })],
    )
}

fn schedule_authority() -> (GameplayAuthority, ResourceKey, ResourceKey) {
    let fuel = ResourceKey {
        kind: ResourceKind::Energy,
        content_id: "schedule-test-energy".into(),
        item_code: None,
        metadata_hash: CanonicalHash::default(),
    };
    let heat = ResourceKey {
        kind: ResourceKind::Heat,
        content_id: "schedule-test-heat".into(),
        item_code: None,
        metadata_hash: CanonicalHash::default(),
    };
    let mut machines = MachineStateSet::default();
    machines
        .register_recipe(MachineRecipe {
            recipe_id: "schedule-test-recipe".into(),
            duration_ticks: 1,
            inputs: BTreeMap::from([(fuel.clone(), 1)]),
            outputs: BTreeMap::from([(heat.clone(), 2)]),
        })
        .unwrap();
    for (machine_id, capacity) in [("a-blocked", 10), ("b-ready", 100), ("c-ready", 100)] {
        machines
            .insert_machine(MachineState {
                machine_id: machine_id.into(),
                owner_id: None,
                kind: MachineKind::Custom,
                revision: 0,
                active: true,
                recipe_id: Some("schedule-test-recipe".into()),
                progress_ticks: 0,
                last_tick: 0,
                ports: BTreeMap::from([(
                    "process".into(),
                    MachinePort {
                        port_id: "process".into(),
                        mode: PortMode::Bidirectional,
                        accepted: BTreeSet::from([ResourceKind::Energy, ResourceKind::Heat]),
                        capacity,
                        resources: BTreeMap::from([(fuel.clone(), 10)]),
                    },
                )]),
                lease: None,
                settings: None,
            })
            .unwrap();
    }
    let mut state = GameplayState::new(WorldKey::new("schedule-universe", "schedule-location"), 9);
    state.machines = machines;
    let mut authority = GameplayAuthority::new(state);
    authority
        .grant_actor("gameplay-scheduler", ActorGrant::system())
        .unwrap();
    (authority, fuel, heat)
}

#[test]
fn schedule_advance_is_system_only_and_rejects_without_mutation() {
    let (mut authority, _, _) = schedule_authority();
    let player_id = PlayerId::new(7, 1);
    let entity_id = EntityId::new(7, 1);
    authority
        .grant_actor("host-player", ActorGrant::host(player_id, entity_id))
        .unwrap();
    let before_hash = authority.state.state_hash();
    let before_replay = authority.replay_hash();
    let batch = GameplayBatch::new(
        "host-schedule-batch",
        "host-schedule-key",
        GameplayActor {
            actor_id: "host-player".into(),
            player_id: Some(player_id),
            entity_id: Some(entity_id),
            role: ActorRole::Host,
        },
        authority.state.identity(),
        vec![GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
            expected_tick: 0,
            to_tick: 1,
            machine_budget: 1,
        })],
    );

    assert_eq!(
        rejection(authority.apply_batch(&batch)).code,
        RejectionCode::Unauthorized
    );
    assert_eq!(authority.state.state_hash(), before_hash);
    assert_eq!(authority.replay_hash(), before_replay);
    assert!(authority.replay().is_empty());
}

#[test]
fn schedule_advance_validates_clock_and_budget_with_atomic_rollback() {
    let (mut authority, _, _) = schedule_authority();
    let before = authority.state.clone();
    for (suffix, expected_tick, to_tick, budget, code) in [
        ("stale", 1, 2, 1, RejectionCode::StaleRevision),
        ("not-forward", 0, 0, 1, RejectionCode::InvalidCommand),
        ("zero-budget", 0, 1, 0, RejectionCode::Capacity),
        (
            "oversize-budget",
            0,
            1,
            MAX_SCHEDULE_MACHINE_ADVANCES_V1 + 1,
            RejectionCode::Capacity,
        ),
    ] {
        let invalid = schedule_batch(&authority, suffix, expected_tick, to_tick, budget);
        assert_eq!(rejection(authority.apply_batch(&invalid)).code, code);
        assert_eq!(authority.state, before);
        assert!(authority.replay().is_empty());
    }

    let later_failure = GameplayBatch::new(
        "schedule-batch-later-failure",
        "schedule-key-later-failure",
        schedule_system_actor(),
        authority.state.identity(),
        vec![
            GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
                expected_tick: 0,
                to_tick: 1,
                machine_budget: 1,
            }),
            GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
                expected_tick: 0,
                to_tick: 2,
                machine_budget: 1,
            }),
        ],
    );
    assert_eq!(
        rejection(authority.apply_batch(&later_failure)).code,
        RejectionCode::StaleRevision
    );
    assert_eq!(authority.state, before);
    assert!(authority.replay().is_empty());
}

#[test]
fn schedule_advance_uses_canonical_attempt_budget_and_replay() {
    let (mut authority, fuel, heat) = schedule_authority();
    let first_batch = schedule_batch(&authority, "tick-1", 0, 1, 1);
    let first = accepted(authority.apply_batch(&first_batch));

    assert_eq!(authority.state.tick, 1);
    assert_eq!(authority.state.combat.tick, 1);
    assert_eq!(authority.state.revision.sequence, 1);
    assert_eq!(authority.state.revision.combat, 1);
    assert_eq!(authority.state.revision.machines, 0);
    assert_eq!(authority.state.machines.machines["a-blocked"].last_tick, 0);
    assert_eq!(authority.state.machines.machines["b-ready"].last_tick, 0);
    assert_eq!(first.touched_domains, BTreeSet::from([Domain::Combat]));
    assert_eq!(first.events.len(), 1);
    assert_eq!(first.events[0].kind, "schedule-advanced");

    let first_state_hash = authority.state.state_hash();
    let first_replay_hash = authority.replay_hash();
    assert_eq!(accepted(authority.apply_batch(&first_batch)), first);
    assert_eq!(authority.state.state_hash(), first_state_hash);
    assert_eq!(authority.replay_hash(), first_replay_hash);
    assert_eq!(authority.replay().len(), 1);

    let second_batch = schedule_batch(&authority, "tick-2", 1, 2, 3);
    let second = accepted(authority.apply_batch(&second_batch));
    let ready = &authority.state.machines.machines["b-ready"];
    assert_eq!(authority.state.tick, 2);
    assert_eq!(authority.state.combat.tick, 2);
    assert_eq!(authority.state.revision.sequence, 2);
    assert_eq!(authority.state.revision.combat, 2);
    assert_eq!(authority.state.revision.machines, 1);
    assert_eq!(authority.state.machines.machines["a-blocked"].last_tick, 0);
    assert_eq!(ready.last_tick, 2);
    assert_eq!(ready.revision, 1);
    assert_eq!(ready.ports["process"].resources[&fuel], 8);
    assert_eq!(ready.ports["process"].resources[&heat], 4);
    assert_eq!(authority.state.machines.machines["c-ready"].last_tick, 2);
    assert_eq!(
        second.touched_domains,
        BTreeSet::from([Domain::Machines, Domain::Combat])
    );
    assert_eq!(
        second
            .events
            .iter()
            .map(|event| event.kind.as_str())
            .collect::<Vec<_>>(),
        vec![
            "schedule-advanced",
            "schedule-machine-advanced",
            "schedule-machine-advanced"
        ]
    );
    assert_eq!(
        second
            .events
            .iter()
            .map(|event| event.event_id.as_str())
            .collect::<BTreeSet<_>>()
            .len(),
        second.events.len()
    );
    assert_eq!(authority.replay().len(), 2);
}

#[test]
fn schedule_snapshot_roundtrip_preserves_retry_and_future_progress() {
    let (mut authority, _, _) = schedule_authority();
    let first_batch = schedule_batch(&authority, "snapshot-1", 0, 1, 2);
    let first_receipt = accepted(authority.apply_batch(&first_batch));
    let extensions = [0, 0x80, 0xff, 7, 9];
    let encoded = authority.encode_snapshot(&extensions).unwrap();
    let decoded = decode_gameplay_authority_snapshot(&encoded).unwrap();
    assert_eq!(decoded.unknown_extension_bytes, extensions);
    assert_eq!(decoded.authority.state, authority.state);
    assert_eq!(decoded.authority.replay_hash(), authority.replay_hash());
    assert_eq!(decoded.authority.encode_snapshot(&extensions).unwrap(), encoded);

    let mut restored = decoded.authority;
    let restored_hash = restored.state.state_hash();
    let restored_replay = restored.replay_hash();
    assert_eq!(accepted(restored.apply_batch(&first_batch)), first_receipt);
    assert_eq!(restored.state.state_hash(), restored_hash);
    assert_eq!(restored.replay_hash(), restored_replay);

    let next_batch = schedule_batch(&restored, "snapshot-2", 1, 2, 2);
    accepted(restored.apply_batch(&next_batch));
    assert_eq!(restored.state.tick, 2);
    assert_eq!(restored.state.combat.tick, 2);
    assert_eq!(restored.replay().len(), 2);
}
