use std::collections::{BTreeMap, BTreeSet};

use blockwild_types::{CanonicalHash, EntityId, PlayerId};

use crate::{
    ActorGrant, ActorRole, CaptureReadiness, CardCustody, CardDefinition, CardRarity, CardforgeCommand, CombatCommand,
    CombatantState, Container, CreatureCompatibilityRecord, DeckRules, Disposition, GameplayActor, GameplayAuthority,
    GameplayBatch, GameplayCommand, GameplayReceipt, GameplayState, InventoryCommand, ItemDefinition, ItemStack,
    PackDefinition, PackRecord, PackSlot, PerkDefinition, PlayerProgression, PrintingKey, ProgressionAction,
    ProgressionCommand, Recipe, SkillState, WeightedCard, WorldKey,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FixtureReport {
    pub accepted_batches: u32,
    pub final_revision: u64,
    pub state_hash: CanonicalHash,
    pub replay_hash: CanonicalHash,
}

#[must_use]
pub fn run_reference_fixture() -> FixtureReport {
    let mut authority = reference_authority();
    let actor = reference_actor();
    let player_inventory = crate::ContainerKey::player("player-1");
    let mut accepted = 0_u32;

    let commands = vec![
        vec![GameplayCommand::Inventory(InventoryCommand::Craft(
            crate::CraftCommand {
                recipe_id: "planks".into(),
                quantity: 2,
                station_id: None,
                source: player_inventory.clone(),
                destination: player_inventory.clone(),
                expected_source_revision: Some(0),
                expected_destination_revision: Some(0),
            },
        ))],
        vec![GameplayCommand::Combat(CombatCommand::Capture {
            source_id: "player-1".into(),
            creature_id: "creature-1".into(),
            expected_creature_revision: 0,
            orb_item_code: 3,
            tick: 10,
        })],
        vec![GameplayCommand::Combat(CombatCommand::Care {
            source_id: "player-1".into(),
            creature_id: "creature-1".into(),
            expected_creature_revision: 1,
            care_item_code: 4,
            amount: 20,
            tick: 20,
        })],
        vec![GameplayCommand::Progression(ProgressionCommand {
            action: ProgressionAction::UnlockPerk,
            owner_id: "player-1".into(),
            record_id: "player-1".into(),
            expected_record_revision: 0,
            option_id: "perk-husbandry-1".into(),
            quantity: 1,
            currency_id: None,
            payload: None,
        })],
        vec![GameplayCommand::Cardforge(CardforgeCommand::OpenPack {
            record_id: "pack-record-1".into(),
            owner_id: "player-1".into(),
            expected_revision: 0,
        })],
    ];

    for (index, commands) in commands.into_iter().enumerate() {
        let batch = GameplayBatch::new(
            format!("fixture-batch-{index}"),
            format!("fixture-key-{index}"),
            actor.clone(),
            authority.state.identity(),
            commands,
        );
        match authority.apply_batch(&batch) {
            GameplayReceipt::Accepted(_) => accepted += 1,
            GameplayReceipt::Rejected { rejection, .. } => {
                panic!("reference fixture rejected: {rejection:?}")
            }
        }
    }

    FixtureReport {
        accepted_batches: accepted,
        final_revision: authority.state.revision.sequence,
        state_hash: authority.state.state_hash(),
        replay_hash: authority.replay_hash(),
    }
}

pub(crate) fn reference_actor() -> GameplayActor {
    GameplayActor {
        actor_id: "player-1".into(),
        player_id: Some(PlayerId::new(1, 1)),
        entity_id: Some(EntityId::new(1, 1)),
        role: ActorRole::Host,
    }
}

pub(crate) fn reference_authority() -> GameplayAuthority {
    let mut state = GameplayState::new(WorldKey::new("fixture-universe", "fixture-world"), 1);
    state.tick = 1_000;
    for item in [
        ItemDefinition {
            code: 1,
            content_id: "wood".into(),
            max_stack: 64,
            tags: BTreeSet::new(),
        },
        ItemDefinition {
            code: 2,
            content_id: "plank".into(),
            max_stack: 64,
            tags: BTreeSet::new(),
        },
        ItemDefinition {
            code: 3,
            content_id: "capture-orb".into(),
            max_stack: 64,
            tags: BTreeSet::new(),
        },
        ItemDefinition {
            code: 4,
            content_id: "care-treat".into(),
            max_stack: 64,
            tags: BTreeSet::new(),
        },
    ] {
        state.inventory.register_item(item).expect("valid item");
    }
    let mut inventory = Container::new(crate::ContainerKey::player("player-1"), 16);
    inventory.slots[0] = Some(ItemStack::simple(1, 10));
    inventory.slots[1] = Some(ItemStack::simple(3, 2));
    inventory.slots[2] = Some(ItemStack::simple(4, 30));
    state.inventory.insert_container(inventory).expect("valid inventory");
    state
        .inventory
        .register_recipe(Recipe {
            recipe_id: "planks".into(),
            station_tag: None,
            inputs: vec![crate::Ingredient {
                item_code: 1,
                metadata_hash: None,
                count: 1,
            }],
            outputs: vec![ItemStack::simple(2, 4)],
            ticks: 1,
        })
        .expect("valid recipe");

    state.combat.combatants.insert(
        "player-1".into(),
        CombatantState {
            record_id: "player-1".into(),
            owner_id: Some("player-1".into()),
            revision: 0,
            position: crate::FixedVec3::default(),
            health: 100,
            max_health: 100,
            stamina: 100,
            mana: 100,
            armor: 0,
            resist_per_mille: BTreeMap::new(),
            statuses: BTreeMap::new(),
            cooldown_until: BTreeMap::new(),
            alive: true,
            vital_units: crate::CombatVitalUnits::LegacyWholeHeartsV1,
            entity_id: None,
        },
    );
    state.combat.combatants.insert(
        "creature-1".into(),
        CombatantState {
            record_id: "creature-1".into(),
            owner_id: None,
            revision: 0,
            position: crate::FixedVec3 {
                x_milli: 1_000,
                y_milli: 0,
                z_milli: 0,
            },
            health: 30,
            max_health: 100,
            stamina: 50,
            mana: 0,
            armor: 0,
            resist_per_mille: BTreeMap::new(),
            statuses: BTreeMap::new(),
            cooldown_until: BTreeMap::new(),
            alive: true,
            vital_units: crate::CombatVitalUnits::LegacyWholeHeartsV1,
            entity_id: None,
        },
    );
    state.combat.creatures.insert(
        "creature-1".into(),
        CreatureCompatibilityRecord {
            record_id: "creature-1".into(),
            creature_content_id: "frostquill".into(),
            variant_id: "standard".into(),
            disposition: Disposition::Aggressive,
            readiness: CaptureReadiness::Wild,
            captured_by: None,
            owner_id: None,
            bond: 0,
            care: 0,
            equipment_ids: Vec::new(),
            research_flags: BTreeSet::new(),
            pacification_score: 0,
            last_aggression_tick: 0,
            revision: 0,
        },
    );

    state.progression.players.insert(
        "player-1".into(),
        PlayerProgression {
            player_id: "player-1".into(),
            revision: 0,
            level: 1,
            perk_points: 1,
            skills: BTreeMap::from([("husbandry".into(), SkillState { rank: 5, xp: 0 })]),
            unlocked_perks: BTreeSet::new(),
            research_flags: BTreeSet::new(),
            fast_travel_charges: 2,
        },
    );
    state.progression.perks.insert(
        "perk-husbandry-1".into(),
        PerkDefinition {
            perk_id: "perk-husbandry-1".into(),
            skill_id: "husbandry".into(),
            required_rank: 5,
            cost: 1,
            prerequisites: BTreeSet::new(),
        },
    );

    let printing = PrintingKey {
        card_id: "frostquill-card".into(),
        variant_id: "standard".into(),
        finish_id: "normal".into(),
    };
    state
        .cardforge
        .register_card(CardDefinition {
            printing: printing.clone(),
            rarity: CardRarity::Common,
            class_ids: BTreeSet::from(["wild".into()]),
            type_ids: BTreeSet::from(["frost".into()]),
            deck_cost: 1,
            power: 1,
            health: 2,
            rules: None,
        })
        .expect("valid card");
    state
        .cardforge
        .register_pack(PackDefinition {
            pack_id: "field-pack".into(),
            slots: vec![
                PackSlot {
                    candidates: vec![WeightedCard {
                        printing: printing.clone(),
                        weight: 1
                    }]
                };
                5
            ],
        })
        .expect("valid pack");
    state.cardforge.pack_records.insert(
        "pack-record-1".into(),
        PackRecord {
            record_id: "pack-record-1".into(),
            owner_id: "player-1".into(),
            pack_id: "field-pack".into(),
            seed: "fixture-seed".into(),
            revision: 0,
            opened: false,
        },
    );
    state.cardforge.custody.insert(
        "player-1".into(),
        CardCustody {
            owner_id: "player-1".into(),
            revision: 0,
            case: BTreeMap::new(),
            archive: BTreeMap::new(),
            rewards_claimed: BTreeSet::new(),
        },
    );
    state.cardforge.deck_rules.insert(
        "standard".into(),
        DeckRules {
            min_cards: 1,
            max_cards: 60,
            max_copies: 4,
            max_cost: 120,
            allowed_classes: BTreeSet::new(),
            banned_cards: BTreeSet::new(),
        },
    );

    let mut authority = GameplayAuthority::new(state);
    authority
        .grant_actor("player-1", ActorGrant::host(PlayerId::new(1, 1), EntityId::new(1, 1)))
        .expect("valid grant");
    authority
}
