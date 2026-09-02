//! Independent Rust-authored BWG7 vectors. These prove transport parity, not
//! that every command is authorized against one shared gameplay state.
use std::{collections::BTreeMap, env, fmt::Write as _, fs, path::PathBuf};

use blockwild_engine::{
    decode_gameplay_batch_v1, encode_gameplay_actor_grant_v1, encode_gameplay_batch_v1, encode_gameplay_receipt_v1,
};
use blockwild_gameplay::*;
use blockwild_types::{CanonicalHash, EntityId, PlayerId};

pub const HIGH: u64 = 0xfedc_ba98_7654_3210;
const FIXTURE: &str = "tests/fixtures/rust-engine/integrated-runtime-v1/r7-gameplay-command-wire-v1.json";

pub fn hex(bytes: &[u8]) -> String {
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut result, "{byte:02x}").unwrap();
    }
    result
}

pub fn hash(byte: u8) -> CanonicalHash {
    CanonicalHash(std::array::from_fn(|i| byte.wrapping_add(i as u8)))
}

pub fn container(kind: ContainerKind, owned: bool) -> ContainerKey {
    ContainerKey {
        kind,
        id: format!("custody:{kind:?}:水"),
        owner_id: owned.then(|| "player:雪".into()),
    }
}

fn slot(kind: ContainerKind, present: bool) -> SlotRef {
    SlotRef {
        container: container(kind, present),
        slot: if present { u16::MAX } else { 0 },
        expected_container_revision: present.then_some(HIGH),
    }
}

fn expected() -> ExpectedStack {
    ExpectedStack {
        item_code: u32::MAX,
        metadata_hash: hash(0x91),
        minimum_count: MAX_ITEM_STACK,
    }
}

pub fn stack(present: bool) -> ItemStack {
    ItemStack {
        item_code: u32::MAX,
        count: MAX_ITEM_STACK,
        durability_millionths: present.then_some(1_000_000),
        metadata_hash: if present {
            metadata().hash
        } else {
            CanonicalHash::default()
        },
    }
}

pub fn metadata() -> ItemInstanceMetadataV1 {
    let mut value = ItemInstanceMetadataV1 {
        hash: CanonicalHash::default(),
        type_id: "item:雪".into(),
        schema_id: "instance:水".into(),
        schema_version: u16::MAX,
        content_version: u32::MAX,
        canonical_json_bytes: "{\"name\":\"雪\",\"power\":7}".as_bytes().to_vec(),
        unknown_extension_bytes: vec![0, 0xff, 0x80, 1],
    };
    value.hash = value.calculate_hash();
    value.validate_wire().unwrap();
    value
}

pub fn opaque() -> OpaquePayload {
    OpaquePayload {
        type_id: "opaque:λ".into(),
        schema: u16::MAX,
        bytes: vec![0, 0xff, 0x80, 0xef, 0xbb, 0xbf, 0x42],
    }
}

fn resource(kind: ResourceKind) -> ResourceKey {
    ResourceKey {
        kind,
        content_id: "resource:水".into(),
        item_code: (kind == ResourceKind::Item).then_some(u32::MAX),
        metadata_hash: hash(0x83),
    }
}

fn printing(card: &str) -> PrintingKey {
    PrintingKey {
        card_id: card.into(),
        variant_id: "variant:雪".into(),
        finish_id: "foil:λ".into(),
    }
}

fn position() -> FixedVec3 {
    FixedVec3 {
        x_milli: i32::MIN,
        y_milli: 123_456,
        z_milli: i32::MAX,
    }
}

pub fn batch(name: &str, commands: Vec<GameplayCommand>) -> GameplayBatch {
    GameplayBatch::new(
        format!("batch:{name}"),
        format!("once:{name}"),
        GameplayActor {
            actor_id: "actor:雪".into(),
            player_id: Some(PlayerId::new(0xffff_ffff, 0xfedc_ba98)),
            entity_id: Some(EntityId::new(0x8765_4321, 0xfedc_ba98)),
            role: ActorRole::Host,
        },
        AuthorityIdentity {
            world: WorldKey::new("world:λ", "surface:水"),
            revision: GameplayRevision {
                epoch: u32::MAX,
                sequence: u64::MAX,
                inventory: HIGH,
                machines: HIGH - 1,
                combat: HIGH - 2,
                progression: HIGH - 3,
                cardforge: HIGH - 4,
            },
            state_hash: hash(0xd1),
        },
        commands,
    )
}

pub struct Vector {
    pub name: String,
    pub covers: Vec<String>,
    pub batch: GameplayBatch,
}

fn add(vectors: &mut Vec<Vector>, name: &str, covers: &[&str], command: GameplayCommand) {
    vectors.push(Vector {
        name: name.into(),
        covers: covers.iter().map(|value| (*value).into()).collect(),
        batch: batch(name, vec![command]),
    });
}

pub fn vectors() -> Vec<Vector> {
    let mut vectors = Vec::new();
    inventory_vectors(&mut vectors);
    machine_vectors(&mut vectors);
    combat_vectors(&mut vectors);
    progression_vectors(&mut vectors);
    cardforge_vectors(&mut vectors);
    add(
        &mut vectors,
        "schedule-advance",
        &["command.advance-schedule"],
        GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
            expected_tick: HIGH,
            to_tick: HIGH + 1,
            machine_budget: MAX_SCHEDULE_MACHINE_ADVANCES_V1,
        }),
    );
    let endpoint = batch(
        "schedule-wire-endpoints",
        vec![
            GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
                expected_tick: 0,
                to_tick: 0,
                machine_budget: 0,
            }),
            GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
                expected_tick: u64::MAX,
                to_tick: u64::MAX,
                machine_budget: u16::MAX,
            }),
        ],
    );
    vectors.push(Vector {
        name: "schedule-wire-endpoints".into(),
        covers: vec![
            "command.advance-schedule".into(),
            "batch.multiple-commands".into(),
            "strings.leading-bom".into(),
        ],
        batch: endpoint,
    });
    optional_field_vectors(&mut vectors);
    add(
        &mut vectors,
        "actor-zero-option-ids",
        &["command.advance-schedule", "actor-option-id.present-zero"],
        GameplayCommand::AdvanceSchedule(GameplayScheduleAdvanceV1 {
            expected_tick: 0,
            to_tick: 1,
            machine_budget: 1,
        }),
    );
    // All actor roles and both typed-ID option branches remain represented
    // without changing the command hashes, which intentionally omit identity.
    for (index, vector) in vectors.iter_mut().enumerate() {
        let role_index = if matches!(
            vector.name.as_str(),
            "schedule-wire-endpoints" | "actor-zero-option-ids"
        ) {
            0
        } else {
            index % 4
        };
        let (role, label) = match role_index {
            0 => (ActorRole::Host, "actor-role.host"),
            1 => (ActorRole::Guest, "actor-role.guest"),
            2 => (ActorRole::Agent, "actor-role.agent"),
            _ => (ActorRole::System, "actor-role.system"),
        };
        vector.batch.actor.role = role;
        if vector.name == "schedule-wire-endpoints" {
            vector.batch.batch_id = "\u{feff}".into();
            vector.batch.actor.actor_id = "\u{feff}actor:雪".into();
            vector.batch.identity.world.universe = "\u{feff}world:λ".into();
            vector.batch.actor.player_id = Some(PlayerId::new(u32::MAX, u32::MAX));
            vector.batch.actor.entity_id = Some(EntityId::new(u32::MAX, u32::MAX));
        }
        if role == ActorRole::System {
            vector.batch.actor.player_id = None;
            vector.batch.actor.entity_id = None;
        }
        if vector.name == "actor-zero-option-ids" {
            vector.batch.actor.player_id = Some(PlayerId::new(0, 0));
            vector.batch.actor.entity_id = Some(EntityId::new(0, 0));
        }
        vector.covers.push(label.into());
        vector.covers.push(format!(
            "actor-player.{}",
            if vector.batch.actor.player_id.is_some() {
                "some"
            } else {
                "none"
            }
        ));
        vector.covers.push(format!(
            "actor-entity.{}",
            if vector.batch.actor.entity_id.is_some() {
                "some"
            } else {
                "none"
            }
        ));
    }
    vectors
}

fn inventory_vectors(vectors: &mut Vec<Vector>) {
    for present in [false, true] {
        let suffix = if present { "some" } else { "none" };
        add(
            vectors,
            &format!("inventory-transfer-{suffix}"),
            &[
                "inventory.transfer",
                &format!("transfer-expected.{suffix}"),
                &format!("slot-revision.{suffix}"),
                &format!("container-owner.{suffix}"),
                "container-kind.player",
                "container-kind.equipment",
            ],
            GameplayCommand::Inventory(InventoryCommand::Transfer(TransferCommand {
                from: slot(ContainerKind::Player, present),
                to: slot(ContainerKind::Equipment, !present),
                count: u32::MAX,
                expected: present.then(expected),
            })),
        );
        add(
            vectors,
            &format!("inventory-craft-{suffix}"),
            &[
                "inventory.craft",
                &format!("craft-station.{suffix}"),
                &format!("craft-source-revision.{suffix}"),
                &format!("craft-destination-revision.{suffix}"),
                "container-kind.container",
                "container-kind.machine",
            ],
            GameplayCommand::Inventory(InventoryCommand::Craft(CraftCommand {
                recipe_id: "recipe:雪".into(),
                quantity: u16::MAX,
                station_id: present.then(|| "station:水".into()),
                source: container(ContainerKind::Container, present),
                destination: container(ContainerKind::Machine, !present),
                expected_source_revision: present.then_some(HIGH),
                expected_destination_revision: present.then_some(u64::MAX),
            })),
        );
        add(
            vectors,
            &format!("inventory-furnace-{suffix}"),
            &["inventory.advance-furnace", &format!("furnace-fuel.{suffix}")],
            GameplayCommand::Inventory(InventoryCommand::AdvanceFurnace(FurnaceAdvanceCommand {
                furnace_id: "furnace:水".into(),
                expected_revision: HIGH,
                to_tick: u64::MAX,
                fuel_item: present.then(|| Ingredient {
                    item_code: u32::MAX,
                    metadata_hash: Some(hash(0x74)),
                    count: MAX_ITEM_STACK,
                }),
                fuel_ticks_per_item: u32::MAX,
            })),
        );
        add(
            vectors,
            &format!("inventory-create-drop-{suffix}"),
            &[
                "inventory.create-drop-custody",
                &format!("drop-expected.{suffix}"),
                "container-kind.waygrid",
                "container-kind.cardforge-case",
            ],
            GameplayCommand::Inventory(InventoryCommand::CreateDropCustody(CreateDropCustodyCommand {
                source: slot(ContainerKind::Waygrid, present),
                custody: container(ContainerKind::CardforgeCase, !present),
                expected: present.then(expected),
                request_hash: hash(0xb1),
            })),
        );
        add(
            vectors,
            &format!("inventory-create-player-{suffix}"),
            &["inventory.create-player-custody", &format!("player-back-slot.{suffix}")],
            GameplayCommand::Inventory(InventoryCommand::CreatePlayerCustody(CreatePlayerCustodyCommand {
                inventory: container(ContainerKind::Player, true),
                inventory_slots: 9,
                equipment: container(ContainerKind::Equipment, true),
                equipment_slots: 8,
                back_slot: present.then_some(7),
            })),
        );
        add(
            vectors,
            &format!("inventory-import-{suffix}"),
            &[
                "inventory.import-player-inventory-v1",
                &format!("import-slot.{suffix}"),
                &format!("import-metadata.{suffix}"),
                &format!("stack-durability.{suffix}"),
            ],
            GameplayCommand::Inventory(InventoryCommand::ImportPlayerInventoryV1(ImportPlayerInventoryV1 {
                inventory: container(ContainerKind::Player, true),
                expected_revision: HIGH,
                slots: if present {
                    vec![
                        Some(stack(true)),
                        None,
                        Some(stack(false)),
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                    ]
                } else {
                    vec![None; 9]
                },
                metadata: if present { vec![metadata()] } else { vec![] },
            })),
        );
        add(
            vectors,
            &format!("inventory-block-action-{suffix}"),
            &[
                "inventory.apply-block-action-v1",
                &format!("block-expected-stack.{suffix}"),
                &format!("block-created-stack.{suffix}"),
            ],
            GameplayCommand::Inventory(InventoryCommand::ApplyBlockActionV1(ApplyBlockActionV1 {
                inventory: container(ContainerKind::Player, true),
                slot: 8,
                expected_container_revision: HIGH,
                expected_stack: present.then(|| stack(true)),
                consume_count: u32::MAX,
                durability_cost_millionths: 1_000_000,
                created_stack: present.then(|| stack(false)),
                reason: "block:雪".into(),
            })),
        );
    }
    add(
        vectors,
        "inventory-furnace-fuel-no-metadata",
        &["inventory.advance-furnace", "ingredient-metadata.none"],
        GameplayCommand::Inventory(InventoryCommand::AdvanceFurnace(FurnaceAdvanceCommand {
            furnace_id: "furnace:水".into(),
            expected_revision: 0,
            to_tick: HIGH,
            fuel_item: Some(Ingredient {
                item_code: 7,
                metadata_hash: None,
                count: 1,
            }),
            fuel_ticks_per_item: 20,
        })),
    );
    // The some case above exercises the ingredient's independent hash option.
    vectors
        .iter_mut()
        .find(|v| v.name == "inventory-furnace-some")
        .unwrap()
        .covers
        .push("ingredient-metadata.some".into());
    add(
        vectors,
        "inventory-remove-empty-drop",
        &["inventory.remove-empty-drop-custody"],
        GameplayCommand::Inventory(InventoryCommand::RemoveEmptyDropCustody(
            RemoveEmptyDropCustodyCommand {
                custody: container(ContainerKind::Container, false),
                expected_revision: u64::MAX,
            },
        )),
    );
    let provenance = GeneratedDropProvenanceV1 {
        schema_version: 1,
        manifest_hash: hash(0x10),
        installed_registry_hash: hash(0x20),
        catalog_blob_hash: hash(0x30),
        action_report_hash: hash(0x40),
        rng_semantics_hash: hash(0x50),
        block_action_sequence: HIGH,
        origin_input_sequence: HIGH - 1,
        block_id: u16::MAX,
        position: BlockActionLootCellV1 {
            x: i32::MIN,
            y: -42,
            z: i32::MAX,
        },
        loot_plan_hash: hash(0x60),
        group_ordinal: 3,
    };
    provenance.validate_v1().unwrap();
    add(
        vectors,
        "inventory-generated-drop",
        &["inventory.create-generated-drop-custody-v1", "provenance.v1"],
        GameplayCommand::Inventory(InventoryCommand::CreateGeneratedDropCustodyV1(
            CreateGeneratedDropCustodyV1::new(container(ContainerKind::Container, false), stack(true), provenance),
        )),
    );
    add(
        vectors,
        "inventory-consume-unit",
        &["inventory.consume-inventory-unit-v1"],
        GameplayCommand::Inventory(InventoryCommand::ConsumeInventoryUnitV1(ConsumeInventoryUnitV1 {
            inventory: container(ContainerKind::Player, true),
            slot: 8,
            expected_container_revision: u64::MAX,
            expected_stack: stack(false),
        })),
    );
}

fn optional_field_vectors(vectors: &mut Vec<Vector>) {
    // Pairwise option coverage, not a Cartesian product. These structural
    // vectors deliberately do not claim ownership/semantic application rights.
    for source in [
        "inventory-create-player-none",
        "inventory-import-some",
        "inventory-block-action-some",
        "inventory-remove-empty-drop",
        "inventory-generated-drop",
        "inventory-consume-unit",
        "machine-operate-claim-output",
    ] {
        let original = vectors.iter().find(|v| v.name == source).unwrap();
        let mut command = original.batch.commands[0].clone();
        let mut covers = original.covers.clone();
        let paths: &[&str] = match &mut command {
            GameplayCommand::Inventory(InventoryCommand::CreatePlayerCustody(value)) => {
                value.inventory.owner_id = None;
                value.equipment.owner_id = None;
                &[
                    "create-player-inventory-owner.none",
                    "create-player-equipment-owner.none",
                ]
            }
            GameplayCommand::Inventory(InventoryCommand::ImportPlayerInventoryV1(value)) => {
                value.inventory.owner_id = None;
                &["import-inventory-owner.none"]
            }
            GameplayCommand::Inventory(InventoryCommand::ApplyBlockActionV1(value)) => {
                value.inventory.owner_id = None;
                value.expected_stack = Some(stack(false));
                value.created_stack = Some(stack(true));
                &[
                    "block-inventory-owner.none",
                    "block-expected-durability.none",
                    "block-created-durability.some",
                ]
            }
            GameplayCommand::Inventory(InventoryCommand::RemoveEmptyDropCustody(value)) => {
                value.custody.owner_id = Some("owner:雪".into());
                &["remove-drop-owner.some"]
            }
            GameplayCommand::Inventory(InventoryCommand::CreateGeneratedDropCustodyV1(value)) => {
                value.custody.owner_id = Some("owner:雪".into());
                value.stack = stack(false);
                value.request_hash = value.calculate_request_hash_v1();
                &["generated-drop-owner.some", "generated-drop-durability.none"]
            }
            GameplayCommand::Inventory(InventoryCommand::ConsumeInventoryUnitV1(value)) => {
                value.inventory.owner_id = None;
                value.expected_stack = stack(true);
                &["consume-inventory-owner.none", "consume-durability.some"]
            }
            GameplayCommand::Machine(MachineCommand::Operate {
                operation: MachineOperation::ClaimOutput { resource: value, .. },
                ..
            }) => {
                *value = resource(ResourceKind::Energy);
                &["claim-output-resource-item-code.none"]
            }
            _ => unreachable!(),
        };
        vectors
            .iter_mut()
            .find(|vector| vector.name == source)
            .unwrap()
            .covers
            .extend(paths.iter().map(|path| {
                let (group, branch) = path.split_once('.').unwrap();
                format!("{group}.{}", if branch == "some" { "none" } else { "some" })
            }));
        covers.extend(paths.iter().map(|path| (*path).into()));
        let name = format!("{source}-alternate-options");
        vectors.push(Vector {
            batch: batch(&name, vec![command]),
            name,
            covers,
        });
    }
}

fn machine_vectors(vectors: &mut Vec<Vector>) {
    for (name, operation) in [
        ("configure", MachineOperation::Configure { settings: opaque() }),
        ("activate", MachineOperation::Activate),
        ("deactivate", MachineOperation::Deactivate),
        (
            "claim-output",
            MachineOperation::ClaimOutput {
                port_id: "port:水".into(),
                resource: resource(ResourceKind::Item),
                amount: u64::MAX,
            },
        ),
    ] {
        add(
            vectors,
            &format!("machine-operate-{name}"),
            &["machine.operate", &format!("machine-operation.{name}")],
            GameplayCommand::Machine(MachineCommand::Operate {
                machine_id: "machine:λ".into(),
                expected_revision: HIGH,
                operation,
            }),
        );
    }
    for (name, kind) in [
        ("item", ResourceKind::Item),
        ("liquid", ResourceKind::Liquid),
        ("gas", ResourceKind::Gas),
        ("energy", ResourceKind::Energy),
        ("heat", ResourceKind::Heat),
    ] {
        add(
            vectors,
            &format!("machine-transfer-{name}"),
            &[
                "machine.transfer",
                &format!("resource-kind.{name}"),
                if kind == ResourceKind::Item {
                    "resource-item-code.some"
                } else {
                    "resource-item-code.none"
                },
            ],
            GameplayCommand::Machine(MachineCommand::Transfer {
                from: ResourceEndpoint {
                    machine_id: "machine:from".into(),
                    port_id: "out".into(),
                },
                to: ResourceEndpoint {
                    machine_id: "machine:to".into(),
                    port_id: "in".into(),
                },
                resource: resource(kind),
                amount: u64::MAX,
                expected_from_revision: HIGH,
                expected_to_revision: HIGH - 1,
            }),
        );
    }
    add(
        vectors,
        "machine-advance",
        &["machine.advance"],
        GameplayCommand::Machine(MachineCommand::Advance {
            machine_id: "machine:λ".into(),
            expected_revision: HIGH,
            to_tick: u64::MAX,
        }),
    );
    add(
        vectors,
        "machine-grant-lease",
        &["machine.grant-lease"],
        GameplayCommand::Machine(MachineCommand::GrantLease {
            machine_id: "machine:λ".into(),
            expected_revision: HIGH,
            lease: ActivityLease {
                lease_id: "lease:雪".into(),
                owner_id: "owner:水".into(),
                start_tick: HIGH,
                end_tick: u64::MAX,
                max_cycles: u32::MAX,
            },
        }),
    );
    for (name, amount) in [("min", i64::MIN), ("max", i64::MAX), ("zero", 0)] {
        add(
            vectors,
            &format!("machine-power-transfer-{name}"),
            &["machine.power-transfer", &format!("signed-i64.{name}")],
            GameplayCommand::Machine(MachineCommand::PowerTransfer {
                network_id: "network:水".into(),
                expected_revision: HIGH,
                machine_id: "machine:λ".into(),
                amount,
            }),
        );
    }
}

fn combat_vectors(vectors: &mut Vec<Vector>) {
    for present in [false, true] {
        let suffix = if present { "some" } else { "none" };
        add(
            vectors,
            &format!("combat-use-ability-{suffix}"),
            &["combat.use-ability", &format!("ability-projectile.{suffix}")],
            GameplayCommand::Combat(CombatCommand::UseAbility {
                source_id: "source:雪".into(),
                expected_source_revision: HIGH,
                target_id: "target:水".into(),
                expected_target_revision: HIGH - 1,
                ability_id: "ability:λ".into(),
                projectile_id: present.then(|| "projectile:雪".into()),
                aim: position(),
                tick: u64::MAX,
            }),
        );
        add(
            vectors,
            &format!("combat-resolve-projectile-{suffix}"),
            &["combat.resolve-projectile", &format!("projectile-target.{suffix}")],
            GameplayCommand::Combat(CombatCommand::ResolveProjectile {
                projectile_id: "projectile:雪".into(),
                expected_revision: HIGH,
                target_id: present.then(|| "target:水".into()),
                impact: position(),
                tick: u64::MAX,
            }),
        );
        add(
            vectors,
            &format!("combat-resolve-linked-projectile-{suffix}"),
            &[
                "combat.resolve-linked-projectile",
                &format!("linked-projectile-target.{suffix}"),
            ],
            GameplayCommand::Combat(CombatCommand::ResolveLinkedProjectile {
                projectile_id: "projectile:雪".into(),
                expected_revision: HIGH,
                target_id: present.then(|| "target:水".into()),
                impact: position(),
                tick: u64::MAX,
            }),
        );
        add(
            vectors,
            &format!("combat-summon-{suffix}"),
            &[
                "combat.summon",
                &format!("summon-duration.{suffix}"),
                &format!("summon-grounding-item.{suffix}"),
            ],
            GameplayCommand::Combat(CombatCommand::Summon {
                source_id: "source:雪".into(),
                summon_id: "summon:水".into(),
                content_id: "creature:λ".into(),
                duration_ticks: present.then_some(u32::MAX),
                grounding_item_code: present.then_some(u32::MAX),
                tick: HIGH,
            }),
        );
        add(
            vectors,
            &format!("combat-summon-linked-{suffix}"),
            &[
                "combat.summon-linked",
                &format!("linked-summon-duration.{suffix}"),
                &format!("linked-summon-grounding-item.{suffix}"),
            ],
            GameplayCommand::Combat(CombatCommand::SummonLinked {
                source_id: "source:雪".into(),
                summon_id: "summon:水".into(),
                entity_id: EntityId::new(u32::MAX, u32::MAX),
                content_domain: ContentDomain::CreatureProfile,
                content_id: "creature:λ".into(),
                presentation_id: "render:雪".into(),
                position: position(),
                duration_ticks: present.then_some(u32::MAX),
                grounding_item_code: present.then_some(u32::MAX),
                tick: HIGH,
            }),
        );
    }
    // Wire tags support every content domain. Gameplay application separately
    // restricts projectile content to Item and linked summons to CreatureProfile.
    for domain in ALL_CONTENT_DOMAINS {
        add(
            vectors,
            &format!("combat-use-linked-projectile-{}", domain.as_id()),
            &[
                "combat.use-linked-projectile",
                &format!("content-domain.{}", domain.as_id()),
            ],
            GameplayCommand::Combat(CombatCommand::UseLinkedProjectile {
                source_id: "source:雪".into(),
                expected_source_revision: HIGH,
                target_id: "target:水".into(),
                expected_target_revision: HIGH - 1,
                ability_id: "ability:λ".into(),
                projectile_id: "projectile:雪".into(),
                entity_id: EntityId::new(u32::MAX, u32::MAX),
                content_domain: domain,
                content_id: "content:水".into(),
                presentation_id: "render:λ".into(),
                aim: position(),
                tick: u64::MAX,
            }),
        );
    }
    add(
        vectors,
        "combat-advance-linked-projectile",
        &["combat.advance-linked-projectile"],
        GameplayCommand::Combat(CombatCommand::AdvanceLinkedProjectile {
            projectile_id: "projectile:雪".into(),
            expected_revision: HIGH,
            position: position(),
            tick: u64::MAX,
        }),
    );
    add(
        vectors,
        "combat-capture",
        &["combat.capture"],
        GameplayCommand::Combat(CombatCommand::Capture {
            source_id: "source:雪".into(),
            creature_id: "creature:水".into(),
            expected_creature_revision: HIGH,
            orb_item_code: u32::MAX,
            tick: u64::MAX,
        }),
    );
    for (name, method) in [
        ("outmaneuver", PacifyMethod::Outmaneuver),
        ("lure-and-care", PacifyMethod::LureAndCare),
    ] {
        add(
            vectors,
            &format!("combat-pacify-{name}"),
            &["combat.pacify", &format!("pacify-method.{name}")],
            GameplayCommand::Combat(CombatCommand::Pacify {
                source_id: "source:雪".into(),
                creature_id: "creature:水".into(),
                expected_creature_revision: HIGH,
                method,
                evidence: opaque(),
                tick: u64::MAX,
            }),
        );
    }
    add(
        vectors,
        "combat-care",
        &["combat.care"],
        GameplayCommand::Combat(CombatCommand::Care {
            source_id: "source:雪".into(),
            creature_id: "creature:水".into(),
            expected_creature_revision: HIGH,
            care_item_code: u32::MAX,
            amount: u16::MAX,
            tick: u64::MAX,
        }),
    );
    add(
        vectors,
        "combat-advance",
        &["combat.advance"],
        GameplayCommand::Combat(CombatCommand::Advance { to_tick: u64::MAX }),
    );
}

fn progression_vectors(vectors: &mut Vec<Vector>) {
    for (index, (name, action)) in [
        ("unlock-perk", ProgressionAction::UnlockPerk),
        ("quest-choice", ProgressionAction::QuestChoice),
        ("faction-choice", ProgressionAction::FactionChoice),
        ("guild-action", ProgressionAction::GuildAction),
        ("trade", ProgressionAction::Trade),
        ("fast-travel", ProgressionAction::FastTravel),
        ("dialogue-choice", ProgressionAction::DialogueChoice),
        ("dragon-training", ProgressionAction::DragonTraining),
        ("settlement-action", ProgressionAction::SettlementAction),
        ("legendary-action", ProgressionAction::LegendaryAction),
    ]
    .into_iter()
    .enumerate()
    {
        let currency = index % 2 == 0;
        let payload = index % 3 == 0;
        add(
            vectors,
            &format!("progression-{name}"),
            &[
                &format!("progression.{name}"),
                if currency {
                    "progression-currency.some"
                } else {
                    "progression-currency.none"
                },
                if payload {
                    "progression-payload.some"
                } else {
                    "progression-payload.none"
                },
            ],
            GameplayCommand::Progression(ProgressionCommand {
                action,
                owner_id: "owner:雪".into(),
                record_id: "record:水".into(),
                expected_record_revision: HIGH,
                option_id: "option:λ".into(),
                quantity: u32::MAX,
                currency_id: currency.then(|| "currency:水".into()),
                payload: payload.then(opaque),
            }),
        );
    }
}

fn cardforge_vectors(vectors: &mut Vec<Vector>) {
    add(
        vectors,
        "cardforge-open-pack",
        &["cardforge.open-pack"],
        GameplayCommand::Cardforge(CardforgeCommand::OpenPack {
            record_id: "pack:雪".into(),
            owner_id: "owner:水".into(),
            expected_revision: HIGH,
        }),
    );
    for present in [false, true] {
        let suffix = if present { "some" } else { "none" };
        add(
            vectors,
            &format!("cardforge-move-card-{present}"),
            &[
                "cardforge.move-card",
                if present {
                    "move-to-archive.true"
                } else {
                    "move-to-archive.false"
                },
            ],
            GameplayCommand::Cardforge(CardforgeCommand::MoveCard {
                owner_id: "owner:水".into(),
                printing: printing("card:雪"),
                count: u32::MAX,
                to_archive: present,
                expected_custody_revision: HIGH,
            }),
        );
        add(
            vectors,
            &format!("cardforge-build-deck-{suffix}"),
            &[
                "cardforge.build-deck",
                &format!("deck-revision.{suffix}"),
                if present {
                    "deck-cards.nonempty"
                } else {
                    "deck-cards.empty"
                },
            ],
            GameplayCommand::Cardforge(CardforgeCommand::BuildDeck {
                deck_id: "deck:水".into(),
                owner_id: "owner:雪".into(),
                rules_id: "rules:λ".into(),
                cards: if present {
                    BTreeMap::from([
                        (printing("card:水"), u16::MAX),
                        (printing("card:a"), 1),
                        (printing("card:𐀀"), 7),
                        (printing("card:\u{e000}"), 11),
                    ])
                } else {
                    BTreeMap::new()
                },
                expected_revision: present.then_some(HIGH),
            }),
        );
    }
    add(
        vectors,
        "cardforge-archive-duplicate",
        &["cardforge.archive-duplicate"],
        GameplayCommand::Cardforge(CardforgeCommand::ArchiveDuplicate {
            owner_id: "owner:水".into(),
            printing: printing("card:雪"),
            keep: u32::MAX,
            expected_custody_revision: HIGH,
        }),
    );
    add(
        vectors,
        "cardforge-start-match",
        &["cardforge.start-match"],
        GameplayCommand::Cardforge(CardforgeCommand::StartMatch {
            match_id: "match:水".into(),
            player_one: "player:雪".into(),
            deck_one: "deck:a".into(),
            player_two: "player:λ".into(),
            deck_two: "deck:b".into(),
        }),
    );
    for (name, action) in [
        ("draw", BattleAction::Draw),
        ("play", BattleAction::Play { hand_index: u16::MAX }),
        ("attack-player", BattleAction::AttackPlayer { board_index: u16::MAX }),
        ("end-turn", BattleAction::EndTurn),
        ("concede", BattleAction::Concede),
    ] {
        add(
            vectors,
            &format!("cardforge-match-action-{name}"),
            &["cardforge.match-action", &format!("battle-action.{name}")],
            GameplayCommand::Cardforge(CardforgeCommand::MatchAction {
                match_id: "match:水".into(),
                owner_id: "owner:雪".into(),
                expected_revision: HIGH,
                action,
            }),
        );
    }
    add(
        vectors,
        "cardforge-claim-reward",
        &["cardforge.claim-reward"],
        GameplayCommand::Cardforge(CardforgeCommand::ClaimReward {
            owner_id: "owner:水".into(),
            reward_id: "reward:雪".into(),
            expected_custody_revision: HIGH,
        }),
    );
}

pub fn browser_lifecycle() -> (GameplayBatch, GameplayReceipt) {
    let mut authority = GameplayAuthority::new(GameplayState::new(WorldKey::new("schema-browser", "surface"), 1));
    authority.grant_actor("schema:system", ActorGrant::system()).unwrap();
    let batch = GameplayBatch::new(
        "schema:create-custody",
        "schema:create-custody:once",
        GameplayActor {
            actor_id: "schema:system".into(),
            player_id: None,
            entity_id: None,
            role: ActorRole::System,
        },
        authority.state.identity(),
        vec![GameplayCommand::Inventory(InventoryCommand::CreatePlayerCustody(
            CreatePlayerCustodyCommand {
                inventory: ContainerKey::player("schema:player"),
                inventory_slots: 9,
                equipment: ContainerKey {
                    kind: ContainerKind::Equipment,
                    id: "schema:player:equipment".into(),
                    owner_id: Some("schema:player".into()),
                },
                equipment_slots: 8,
                back_slot: None,
            },
        ))],
    );
    let receipt = authority.apply_batch(&batch);
    assert!(matches!(receipt, GameplayReceipt::Accepted(_)), "{receipt:?}");
    (batch, receipt)
}

pub fn zero_actor_grant() -> ActorGrant {
    ActorGrant::host(PlayerId::new(0, 0), EntityId::new(0, 0))
}

pub fn fixture() -> String {
    let vectors = vectors();
    let mut coverage = BTreeMap::<&str, Vec<&str>>::new();
    for vector in &vectors {
        for label in &vector.covers {
            let (group, branch) = label.split_once('.').unwrap();
            coverage.entry(group).or_default().push(branch);
        }
    }
    let mut result = String::from(
        "{\n  \"schema\": 1,\n  \"producer\": \"blockwild-engine native BWG7 codec and GameplayBatch::calculate_command_hash\",\n  \"scope\": \"Structural transport vectors; only browserLifecycle claims gameplay acceptance. Inventory tag 10 remains dedicated-only.\",\n  \"coverage\": {\n",
    );
    let group_count = coverage.len();
    for (index, (group, branches)) in coverage.iter_mut().enumerate() {
        branches.sort_unstable();
        branches.dedup();
        writeln!(
            &mut result,
            "    \"{group}\": {branches:?}{}",
            if index + 1 == group_count { "" } else { "," }
        )
        .unwrap();
    }
    result.push_str("  },\n");
    writeln!(
        &mut result,
        "  \"zeroActorGrantHex\": \"{}\",",
        hex(&encode_gameplay_actor_grant_v1("actor:zero-options", &zero_actor_grant()).unwrap())
    )
    .unwrap();
    result.push_str("  \"vectors\": [\n");
    for (index, vector) in vectors.iter().enumerate() {
        let bytes = encode_gameplay_batch_v1(&vector.batch).expect("native vector encodes");
        assert_eq!(
            decode_gameplay_batch_v1(&bytes).unwrap(),
            vector.batch,
            "{}",
            vector.name
        );
        writeln!(
            &mut result,
            "    {{\"name\":\"{}\",\"covers\":{:?},\"hex\":\"{}\",\"commandHash\":\"{}\"}}{}",
            vector.name,
            vector.covers,
            hex(&bytes),
            vector.batch.command_hash.to_hex(),
            if index + 1 == vectors.len() { "" } else { "," }
        )
        .unwrap();
    }
    let (batch, receipt) = browser_lifecycle();
    let grant = encode_gameplay_actor_grant_v1("schema:system", &ActorGrant::system()).unwrap();
    writeln!(&mut result, "  ],\n  \"browserLifecycle\": {{\n    \"initialIdentity\": {{\"world\":{{\"universe\":\"schema-browser\",\"location\":\"surface\"}},\"revision\":{{\"epoch\":1,\"sequence\":\"0\",\"inventory\":\"0\",\"machines\":\"0\",\"combat\":\"0\",\"progression\":\"0\",\"cardforge\":\"0\"}},\"stateHash\":\"{}\"}},\n    \"grantHex\": \"{}\",\n    \"batchHex\": \"{}\",\n    \"commandHash\": \"{}\",\n    \"receiptHex\": \"{}\"\n  }}\n}}", batch.identity.state_hash.to_hex(), hex(&grant), hex(&encode_gameplay_batch_v1(&batch).unwrap()), batch.command_hash.to_hex(), hex(&encode_gameplay_receipt_v1(&receipt).unwrap())).unwrap();
    result
}

pub fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..").join(FIXTURE)
}

fn main() {
    let output = fixture();
    if env::args().any(|argument| argument == "--check") {
        assert_eq!(
            fs::read_to_string(fixture_path())
                .expect("checked fixture exists")
                .replace("\r\n", "\n"),
            output,
            "R7 fixture must be refreshed from native production codecs"
        );
        println!("R7 BWG7 fixture is current ({} vectors)", vectors().len());
    } else {
        print!("{output}");
    }
}
