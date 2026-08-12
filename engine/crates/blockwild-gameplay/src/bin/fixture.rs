use std::{collections::BTreeMap, path::Path};

use blockwild_gameplay::{
    CombatVitalUnits, CombatantState, FixedVec3, GameplayAuthority, GameplayState, WorldKey,
    canonical_gameplay_snapshot_hash, decode_gameplay_authority_snapshot,
};
use blockwild_types::EntityId;

fn main() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("snapshot-v4") {
        let target = args.next().expect("snapshot-v4 requires a target JSON path");
        assert!(args.next().is_none(), "snapshot-v4 accepts exactly one target path");
        write_snapshot_v4_fixture(Path::new(&target));
        return;
    }

    let iterations = std::env::args()
        .nth(1)
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(100);
    let started = std::time::Instant::now();
    let mut report = blockwild_gameplay::run_reference_fixture();
    for _ in 1..iterations {
        report = blockwild_gameplay::run_reference_fixture();
    }
    let elapsed = started.elapsed();
    println!("iterations={iterations}");
    println!("accepted_batches={}", report.accepted_batches);
    println!("final_revision={}", report.final_revision);
    println!("state_hash={}", report.state_hash.to_hex());
    println!("replay_hash={}", report.replay_hash.to_hex());
    println!("elapsed_us={}", elapsed.as_micros());
}

fn write_snapshot_v4_fixture(target: &Path) {
    const HEADER_BYTES: usize = 68;
    const EXTENSION: [u8; 7] = [0, 0x80, 0xff, 7, 9, 0xc3, 0xa9];
    const UNIVERSE: &str = "browser-fixture-é";
    const LOCATION: &str = "surface-世界-🌌";

    let entity_id = EntityId::new(u32::MAX - 7, u32::MAX);
    let mut state = GameplayState::new(WorldKey::new(UNIVERSE, LOCATION), 7);
    state.tick = 1_000;
    state.combat.combatants.insert(
        "hero-é".into(),
        CombatantState {
            record_id: "hero-é".into(),
            owner_id: Some("player-é".into()),
            revision: 4,
            position: FixedVec3 {
                x_milli: -500,
                y_milli: 2_000,
                z_milli: 7,
            },
            health: 19_500,
            max_health: 20_000,
            stamina: 100,
            mana: 50,
            armor: 0,
            resist_per_mille: BTreeMap::new(),
            statuses: BTreeMap::new(),
            cooldown_until: BTreeMap::new(),
            alive: true,
            vital_units: CombatVitalUnits::MilliheartsV1,
            entity_id: Some(entity_id),
        },
    );
    let authority = GameplayAuthority::new(state);
    let bytes = authority
        .encode_snapshot(&EXTENSION)
        .expect("canonical V4 fixture encodes");
    let decoded = decode_gameplay_authority_snapshot(&bytes).expect("canonical V4 fixture decodes");
    assert_eq!(decoded.schema_version, 4);
    assert_eq!(decoded.unknown_extension_bytes, EXTENSION);
    let combatant = decoded
        .authority
        .state
        .combat
        .combatants
        .get("hero-é")
        .expect("canonical V4 combatant remains present");
    assert_eq!(combatant.vital_units, CombatVitalUnits::MilliheartsV1);
    assert_eq!(combatant.entity_id, Some(entity_id));
    assert_eq!(combatant.health, 19_500);
    assert_eq!(combatant.max_health, 20_000);

    let state_hash = decoded.authority.state.state_hash().to_hex();
    let replay_hash = decoded.authority.replay_hash().to_hex();
    let payload_hash = encode_hex(&bytes[52..HEADER_BYTES]);
    let snapshot_hash = canonical_gameplay_snapshot_hash(&bytes).to_hex();
    let snapshot_hex = encode_hex(&bytes);
    let json = format!(
        concat!(
            "{{\n",
            "  \"generator\": \"blockwild-gameplay GameplayAuthority::encode_snapshot schema 4\",\n",
            "  \"schema\": 4,\n",
            "  \"bytes\": {},\n",
            "  \"universe\": \"{}\",\n",
            "  \"location\": \"{}\",\n",
            "  \"combatantId\": \"hero-é\",\n",
            "  \"entityIdPacked\": \"{}\",\n",
            "  \"vitalUnits\": \"millihearts-v1\",\n",
            "  \"health\": 19500,\n",
            "  \"maximumHealth\": 20000,\n",
            "  \"opaqueExtensionHex\": \"{}\",\n",
            "  \"stateHash\": \"{}\",\n",
            "  \"replayHash\": \"{}\",\n",
            "  \"payloadHash\": \"{}\",\n",
            "  \"snapshotHash\": \"{}\",\n",
            "  \"snapshotHex\": \"{}\"\n",
            "}}\n"
        ),
        bytes.len(),
        UNIVERSE,
        LOCATION,
        entity_id.packed(),
        encode_hex(&EXTENSION),
        state_hash,
        replay_hash,
        payload_hash,
        snapshot_hash,
        snapshot_hex,
    );
    std::fs::write(target, json).expect("write canonical V4 gameplay fixture");
    println!("wrote={}", target.display());
    println!("bytes={}", bytes.len());
    println!("snapshot_hash={snapshot_hash}");
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}
