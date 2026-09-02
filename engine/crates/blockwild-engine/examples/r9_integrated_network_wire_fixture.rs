use std::{collections::BTreeSet, env, fs};

use blockwild_authority::BlockCatalogV1;
use blockwild_engine::{
    IntegratedRuntimeConfigV2, IntegratedRuntimeV2, NetworkDeltaBuildRequestWireV1, NetworkReconnectRequestWireV1,
    decode_network_agent_grant_v1, decode_network_command_release_v1, decode_network_delta_build_request_v1,
    decode_network_peer_grant_v1, decode_network_peer_release_v1, decode_network_reconnect_request_v1,
    decode_network_replication_record_v1, encode_network_agent_grant_v1, encode_network_command_release_v1,
    encode_network_delta_build_request_v1, encode_network_peer_grant_v1, encode_network_peer_release_v1,
    encode_network_reconnect_request_v1, encode_network_replication_record_v1,
};
use blockwild_network::{
    AgentAuthorityCodeV1, AgentCapabilityGrantV1, AgentCapabilityV1, AgentLifecycleStatusV1, DeltaApplyCodeV1,
    InterestDeltaBuildSourceV1, NETWORK_MAX_COMMAND_BYTES_V1, NetworkAuthorityIdentityV1, NetworkAuthorityRevisionV1,
    NetworkBrowserRequestV1, NetworkBrowserResponseV1, NetworkCapabilityV1, NetworkCommandKindV1,
    NetworkCommandSourceV1, NetworkCommandV1, NetworkDeltaRecordKindV1, NetworkDeltaRecordV1, NetworkDeltaSourceV1,
    NetworkDeltaV1, NetworkHandshakeSourceV1, NetworkHandshakeV1, NetworkInterestChunkV1, NetworkInterestSetV1,
    NetworkPeerGrantV1, NetworkPeerKindV1, NetworkPeerRoleV1, NetworkPlayerPoseActionV1, NetworkPlayerPoseSourceV1,
    NetworkPlayerPoseV1, NetworkReconnectCheckpointV1, ReplicationScopeV1, ScopedDeltaRecordV1, WorldAddressV1,
    canonical_network_fixture_v1, decode_network_browser_request_v1, decode_network_browser_response_v1,
    decode_network_checkpoint_v1, decode_network_delta_v1, encode_agent_work_command_v1,
    encode_network_browser_response_v1, encode_network_checkpoint_v1, encode_network_command_v1,
    encode_network_delta_v1, encode_network_handshake_v1, encode_network_player_pose_v1,
    prepare_network_agent_request_v1, prepare_network_command_batch_request_v1,
    prepare_network_delta_delivery_request_v1, prepare_network_guest_pose_request_v1,
    prepare_network_handshake_request_v1,
};
use blockwild_runtime_wire::{DEFAULT_GENERATION_OPTIONS_JSON_V1, DEFAULT_TERRAIN_CONTENT_HASH_V2, wire_checksum_v1};
use blockwild_types::CanonicalHash;

const MAX_SAFE_U64: u64 = 9_007_199_254_740_991;
const WRAPPED_BODY_OFFSET: usize = 28;

#[derive(Debug)]
struct FixturePackets {
    peer_grant: Vec<u8>,
    agent_grant: Vec<u8>,
    replication_record: Vec<u8>,
    delta_build_request: Vec<u8>,
    reconnect_request: Vec<u8>,
    peer_release: Vec<u8>,
    command_release: Vec<u8>,
    delta_build_response: Vec<u8>,
    delta_packet: Vec<u8>,
    reconnect_present_response: Vec<u8>,
    reconnect_absent_response: Vec<u8>,
    reconnect_checkpoint: Vec<u8>,
    browser_handshake: BrowserHandshakePackets,
    browser_nested: BrowserNestedPackets,
    wasm_dispatch: WasmDispatchReceipts,
}

#[derive(Debug)]
struct BrowserHandshakePackets {
    request: Vec<u8>,
    host: Vec<u8>,
    peer: Vec<u8>,
}

#[derive(Debug)]
struct BrowserNestedPackets {
    command_batch_request: Vec<u8>,
    command_batch_command: Vec<u8>,
    delta_delivery_request: Vec<u8>,
    delta_delivery_checkpoint: Vec<u8>,
    delta_delivery_delta: Vec<u8>,
    agent_command_request: Vec<u8>,
    agent_command_envelope: Vec<u8>,
    agent_command_work: Vec<u8>,
    guest_pose_request: Vec<u8>,
    guest_pose_command: Vec<u8>,
    guest_pose_payload: Vec<u8>,
}

#[derive(Debug)]
struct WasmDispatchReceipts {
    peer_grant: Vec<u8>,
    agent_grant: Vec<u8>,
    replication_record: Vec<u8>,
    delta_build: Vec<u8>,
    reconnect: Vec<u8>,
    replication_remove: Vec<u8>,
    command_release: Vec<u8>,
    peer_release: Vec<u8>,
    browser_handshake: Vec<u8>,
    browser_command_batch: Vec<u8>,
    browser_delta_delivery: Vec<u8>,
    browser_agent_command: Vec<u8>,
    browser_guest_pose: Vec<u8>,
}

#[derive(Debug)]
struct BrowserNestedReceipts {
    browser_command_batch: Vec<u8>,
    browser_delta_delivery: Vec<u8>,
    browser_agent_command: Vec<u8>,
    browser_guest_pose: Vec<u8>,
}

fn main() {
    let packets = fixture_packets();
    verify_request_round_trips(&packets);
    verify_negative_vectors(&packets);
    let json = fixture_json(&packets);

    let args = env::args().skip(1).collect::<Vec<_>>();
    match args.as_slice() {
        [] => print!("{json}"),
        [flag, path] if flag == "--check" => {
            let checked = fs::read_to_string(path).unwrap_or_else(|error| panic!("failed to read {path}: {error}"));
            assert_eq!(
                normalize_newlines(&checked),
                normalize_newlines(&json),
                "checked R9 fixture differs from the deterministic Rust emitter",
            );
        }
        [flag, path] if flag == "--write" => {
            fs::write(path, json).unwrap_or_else(|error| panic!("failed to write {path}: {error}"));
        }
        _ => panic!("usage: r9_integrated_network_wire_fixture [--check|--write <fixture.json>]"),
    }
}

fn fixture_packets() -> FixturePackets {
    let address = WorldAddressV1 {
        universe_id: "universe:雪:🦀".into(),
        location_id: "cavern:Ω:🌿".into(),
    };
    let interest = NetworkInterestSetV1::new(
        MAX_SAFE_U64,
        vec![
            NetworkInterestChunkV1 {
                address: address.clone(),
                chunk_x: i32::MIN,
                chunk_z: i32::MAX,
            },
            NetworkInterestChunkV1 {
                address: address.clone(),
                chunk_x: -1,
                chunk_z: 1,
            },
        ],
        vec!["entity:雪:🦀".into(), "entity:𐀀:Ω".into()],
    )
    .expect("canonical high-Unicode interest");

    let peer_grant_value = NetworkPeerGrantV1 {
        session_id: "session:雪:🦀".into(),
        peer_id: "peer:é:🧭".into(),
        connection_id: "connection:Ω:🌿".into(),
        actor_id: "actor:龍:🤖".into(),
        peer_kind: NetworkPeerKindV1::Agent,
        role: NetworkPeerRoleV1::Guest,
        capabilities: vec![
            NetworkCapabilityV1::Observe,
            NetworkCapabilityV1::Chat,
            NetworkCapabilityV1::Interact,
            NetworkCapabilityV1::Inventory,
            NetworkCapabilityV1::Build,
            NetworkCapabilityV1::Combat,
            NetworkCapabilityV1::CreatureCare,
            NetworkCapabilityV1::Trade,
            NetworkCapabilityV1::Travel,
            NetworkCapabilityV1::AgentWork,
        ],
        expires_at: MAX_SAFE_U64,
        next_sequence: MAX_SAFE_U64 - 1,
        interest: interest.clone(),
    };

    let agent_grant_value = AgentCapabilityGrantV1 {
        agent_id: "agent:雪:🤖".into(),
        peer_id: peer_grant_value.peer_id.clone(),
        connection_id: peer_grant_value.connection_id.clone(),
        status: AgentLifecycleStatusV1::Paused,
        requested: vec![
            AgentCapabilityV1::ObserveWorld,
            AgentCapabilityV1::MoveSelf,
            AgentCapabilityV1::InteractBasic,
            AgentCapabilityV1::InventorySelfRead,
            AgentCapabilityV1::InventorySelfWrite,
            AgentCapabilityV1::ContainerRead,
            AgentCapabilityV1::ContainerWrite,
            AgentCapabilityV1::PlayerLocationRead,
            AgentCapabilityV1::PlayerInventoryRead,
            AgentCapabilityV1::Build,
            AgentCapabilityV1::Harvest,
            AgentCapabilityV1::ChatSend,
            AgentCapabilityV1::VoiceSend,
            AgentCapabilityV1::Diagnostics,
            AgentCapabilityV1::WorldAdmin,
        ],
        granted: vec![
            AgentCapabilityV1::ObserveWorld,
            AgentCapabilityV1::InventorySelfRead,
            AgentCapabilityV1::Build,
            AgentCapabilityV1::Diagnostics,
        ],
        expires_at: MAX_SAFE_U64,
    };

    let record = NetworkDeltaRecordV1::new(
        NetworkDeltaRecordKindV1::Agent,
        "record:雪:🦀".into(),
        MAX_SAFE_U64,
        [vec![0, 0x7f, 0x80, 0xff], "payload:雪:🦀".as_bytes().to_vec()].concat(),
    )
    .expect("canonical replication record");
    let scoped_record = ScopedDeltaRecordV1 {
        scope: ReplicationScopeV1::Chunk(NetworkInterestChunkV1 {
            address: address.clone(),
            chunk_x: i32::MIN,
            chunk_z: i32::MAX,
        }),
        record: record.clone(),
    };

    let from = NetworkAuthorityIdentityV1::new(
        address.clone(),
        NetworkAuthorityRevisionV1 {
            epoch: MAX_SAFE_U64 - 10,
            world: MAX_SAFE_U64 - 9,
            entities: MAX_SAFE_U64 - 8,
            gameplay: MAX_SAFE_U64 - 7,
            persistence: MAX_SAFE_U64 - 6,
        },
    )
    .expect("from identity");
    let to = NetworkAuthorityIdentityV1::new(
        address,
        NetworkAuthorityRevisionV1 {
            epoch: MAX_SAFE_U64 - 10,
            world: MAX_SAFE_U64 - 8,
            entities: MAX_SAFE_U64 - 7,
            gameplay: MAX_SAFE_U64 - 6,
            persistence: MAX_SAFE_U64 - 5,
        },
    )
    .expect("to identity");
    let delta_source = InterestDeltaBuildSourceV1 {
        session_id: peer_grant_value.session_id.clone(),
        delta_id: "delta:雪:🦀".into(),
        peer_id: peer_grant_value.peer_id.clone(),
        keyframe: true,
        sequence: MAX_SAFE_U64 - 2,
        acknowledged_command_sequence: MAX_SAFE_U64 - 3,
        from: from.clone(),
        to: to.clone(),
    };
    let delta_build_value = NetworkDeltaBuildRequestWireV1 {
        source: delta_source.clone(),
        interest: interest.clone(),
    };
    let reconnect_value = NetworkReconnectRequestWireV1 {
        session_id: peer_grant_value.session_id.clone(),
        peer_id: peer_grant_value.peer_id.clone(),
        connection_generation: MAX_SAFE_U64,
    };

    let delta = NetworkDeltaV1::new(NetworkDeltaSourceV1 {
        session_id: delta_source.session_id,
        delta_id: delta_source.delta_id,
        peer_id: delta_source.peer_id,
        keyframe: delta_source.keyframe,
        sequence: delta_source.sequence,
        acknowledged_command_sequence: delta_source.acknowledged_command_sequence,
        from: delta_source.from,
        to: delta_source.to,
        interest_hash: interest.interest_hash,
        records: vec![record],
    })
    .expect("native response delta");
    let delta_packet = encode_network_delta_v1(&delta).expect("encode native response delta");
    assert_eq!(
        encode_network_delta_v1(&decode_network_delta_v1(&delta_packet).expect("decode native response delta"))
            .expect("re-encode native response delta"),
        delta_packet,
    );

    let checkpoint = NetworkReconnectCheckpointV1::new(
        reconnect_value.session_id.clone(),
        reconnect_value.peer_id.clone(),
        reconnect_value.connection_generation,
        MAX_SAFE_U64 - 3,
        MAX_SAFE_U64 - 2,
        to,
        interest.interest_hash,
    )
    .expect("native reconnect checkpoint");
    let reconnect_checkpoint = encode_network_checkpoint_v1(&checkpoint).expect("encode native reconnect checkpoint");
    assert_eq!(
        encode_network_checkpoint_v1(
            &decode_network_checkpoint_v1(&reconnect_checkpoint).expect("decode native reconnect checkpoint"),
        )
        .expect("re-encode native reconnect checkpoint"),
        reconnect_checkpoint,
    );

    let peer_grant = encode_network_peer_grant_v1(&peer_grant_value).expect("encode peer grant");
    let agent_grant = encode_network_agent_grant_v1(&agent_grant_value).expect("encode agent grant");
    let replication_record = encode_network_replication_record_v1(&scoped_record).expect("encode replication record");
    let delta_build_request = encode_network_delta_build_request_v1(&delta_build_value).expect("encode delta request");
    let reconnect_request = encode_network_reconnect_request_v1(&reconnect_value).expect("encode reconnect request");
    let peer_release = encode_network_peer_release_v1(&peer_grant_value.peer_id).expect("encode peer release");
    let command_release = encode_network_command_release_v1("command:雪:🦀").expect("encode command release");
    let browser_handshake = browser_handshake_packets();
    let browser_nested = browser_nested_packets();
    let mut wasm_dispatch = wasm_dispatch_receipts(
        &peer_grant,
        &agent_grant,
        &replication_record,
        &delta_build_request,
        &reconnect_request,
        &command_release,
        &peer_release,
        &browser_handshake.request,
    );
    let nested_receipts = browser_nested_receipts(&browser_nested);
    wasm_dispatch.browser_command_batch = nested_receipts.browser_command_batch;
    wasm_dispatch.browser_delta_delivery = nested_receipts.browser_delta_delivery;
    wasm_dispatch.browser_agent_command = nested_receipts.browser_agent_command;
    wasm_dispatch.browser_guest_pose = nested_receipts.browser_guest_pose;

    FixturePackets {
        peer_grant,
        agent_grant,
        replication_record,
        delta_build_request,
        reconnect_request,
        peer_release,
        command_release,
        delta_build_response: encode_delta_build_response(&delta_packet, u32::MAX, u32::MAX - 1, 1),
        delta_packet,
        reconnect_present_response: encode_reconnect_response(Some(&reconnect_checkpoint)),
        reconnect_absent_response: encode_reconnect_response(None),
        reconnect_checkpoint,
        browser_handshake,
        browser_nested,
        wasm_dispatch,
    }
}

fn browser_handshake_packets() -> BrowserHandshakePackets {
    let host = NetworkHandshakeV1::new(NetworkHandshakeSourceV1 {
        session_id: "session:雪:🦀".into(),
        peer_id: "host:龍:🧭".into(),
        peer_kind: NetworkPeerKindV1::Human,
        role: NetworkPeerRoleV1::Host,
        engine_version: "1.13.0-rust-r9:雪".into(),
        content_hash: CanonicalHash([1; 16]),
        generator_hash: CanonicalHash([2; 16]),
        capabilities: vec![
            NetworkCapabilityV1::Chat,
            NetworkCapabilityV1::Observe,
            NetworkCapabilityV1::Interact,
            NetworkCapabilityV1::AgentWork,
        ],
        max_command_bytes: NETWORK_MAX_COMMAND_BYTES_V1 as u32,
    })
    .expect("canonical browser host handshake");
    let peer = NetworkHandshakeV1::new(NetworkHandshakeSourceV1 {
        session_id: host.session_id.clone(),
        peer_id: "browser-peer:é:🌿".into(),
        peer_kind: NetworkPeerKindV1::Human,
        role: NetworkPeerRoleV1::Guest,
        engine_version: host.engine_version.clone(),
        content_hash: host.content_hash,
        generator_hash: host.generator_hash,
        capabilities: vec![
            NetworkCapabilityV1::Interact,
            NetworkCapabilityV1::Observe,
            NetworkCapabilityV1::Chat,
        ],
        max_command_bytes: 131_072,
    })
    .expect("canonical browser peer handshake");
    BrowserHandshakePackets {
        request: prepare_network_handshake_request_v1(MAX_SAFE_U64 - 4, &host, &peer)
            .expect("encode outer browser handshake request"),
        host: encode_network_handshake_v1(&host).expect("encode nested host BWN1"),
        peer: encode_network_handshake_v1(&peer).expect("encode nested peer BWN1"),
    }
}

fn browser_nested_packets() -> BrowserNestedPackets {
    let fixture = canonical_network_fixture_v1().expect("canonical nested browser fixture");

    let command_batch_command = encode_network_command_v1(&fixture.human_command).expect("encode nested command");
    let command_batch_request = prepare_network_command_batch_request_v1(
        MAX_SAFE_U64 - 5,
        &fixture.starting_identity,
        100,
        std::slice::from_ref(&fixture.human_command),
    )
    .expect("encode outer command-batch request");

    let delta_delivery_checkpoint_value = NetworkReconnectCheckpointV1::new(
        "session-r9".into(),
        "peer-1".into(),
        7,
        0,
        0,
        fixture.starting_identity.clone(),
        fixture.interest.interest_hash,
    )
    .expect("canonical delta receiver checkpoint");
    let delta_delivery_delta_value = NetworkDeltaV1::new(NetworkDeltaSourceV1 {
        session_id: fixture.delta.session_id.clone(),
        delta_id: "delta:keyframe:1".into(),
        peer_id: fixture.delta.peer_id.clone(),
        keyframe: true,
        sequence: 1,
        acknowledged_command_sequence: fixture.delta.acknowledged_command_sequence,
        from: fixture.starting_identity.clone(),
        to: fixture.delta.to.clone(),
        interest_hash: fixture.interest.interest_hash,
        records: fixture.delta.records.clone(),
    })
    .expect("canonical browser keyframe");
    let delta_delivery_checkpoint =
        encode_network_checkpoint_v1(&delta_delivery_checkpoint_value).expect("encode nested checkpoint");
    let delta_delivery_delta = encode_network_delta_v1(&delta_delivery_delta_value).expect("encode nested keyframe");
    let delta_delivery_request = prepare_network_delta_delivery_request_v1(
        MAX_SAFE_U64 - 6,
        &delta_delivery_checkpoint_value,
        &fixture.interest,
        &delta_delivery_delta_value,
    )
    .expect("encode outer delta-delivery request");

    let agent_command_envelope =
        encode_network_command_v1(&fixture.agent_command).expect("encode nested agent envelope");
    let agent_command_work = encode_agent_work_command_v1(&fixture.agent_work).expect("encode nested agent work");
    let agent_command_request = prepare_network_agent_request_v1(
        MAX_SAFE_U64 - 7,
        &fixture.agent_command.expected,
        1_100,
        &fixture.agent_command,
        &fixture.agent_work,
    )
    .expect("encode outer agent-command request");

    let pose = NetworkPlayerPoseV1::new(NetworkPlayerPoseSourceV1 {
        player_id: "peer-1".into(),
        tick: 42,
        x_milliblocks: 12_387,
        y_milliblocks: 64_500,
        z_milliblocks: -9_876,
        yaw_milliradians: 1_571,
        pitch_milliradians: -314,
        velocity_x_milliblocks_per_second: 4_350,
        velocity_y_milliblocks_per_second: -125,
        velocity_z_milliblocks_per_second: 750,
        grounded: true,
        selected_slot: Some(3),
        shield_raised: true,
        crouching: false,
        sprinting: true,
        action: NetworkPlayerPoseActionV1::Mine,
        swimming_per_mille: Some(250),
        seated_per_mille: Some(1_000),
        boat_id: Some("boat:cedar-1".into()),
        boat_seat: Some(0),
        boat_forward_per_mille: Some(875),
        boat_turn_per_mille: Some(-250),
        mounted_creature_id: Some(42),
        mounted_creature_seat: Some(1),
    })
    .expect("canonical guest pose");
    let guest_pose_payload = encode_network_player_pose_v1(&pose).expect("encode nested guest pose");
    let guest_pose_command_value = NetworkCommandV1::new(NetworkCommandSourceV1 {
        session_id: "session-r9".into(),
        command_id: "pose:fixture:42".into(),
        idempotency_key: "pose-idem:fixture:42".into(),
        peer_id: "peer-1".into(),
        connection_id: "conn-human-1".into(),
        actor_id: "peer-1".into(),
        peer_kind: NetworkPeerKindV1::Human,
        kind: NetworkCommandKindV1::Pose,
        required_capability: NetworkCapabilityV1::Interact,
        sequence: 0,
        expected: fixture.delta.to.clone(),
        expires_at: 10_000,
        lease_keys: Vec::new(),
        payload: guest_pose_payload.clone(),
    })
    .expect("canonical guest pose command");
    let guest_pose_command =
        encode_network_command_v1(&guest_pose_command_value).expect("encode nested guest pose command");
    let guest_pose_request =
        prepare_network_guest_pose_request_v1(MAX_SAFE_U64 - 8, &fixture.delta.to, 1_000, &guest_pose_command_value)
            .expect("encode outer guest-pose request");

    BrowserNestedPackets {
        command_batch_request,
        command_batch_command,
        delta_delivery_request,
        delta_delivery_checkpoint,
        delta_delivery_delta,
        agent_command_request,
        agent_command_envelope,
        agent_command_work,
        guest_pose_request,
        guest_pose_command,
        guest_pose_payload,
    }
}

fn deterministic_runtime(session_id: &str) -> IntegratedRuntimeV2 {
    IntegratedRuntimeV2::new(IntegratedRuntimeConfigV2 {
        world_seed: "wasm-integrated".into(),
        universe_id: "1".into(),
        location_id: "surface".into(),
        session_id: session_id.into(),
        terrain_content_hash: CanonicalHash(DEFAULT_TERRAIN_CONTENT_HASH_V2.0),
        generation_options_json: DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
        content_hash: CanonicalHash([1; 16]),
        generator_hash: CanonicalHash([2; 16]),
        block_catalog: BlockCatalogV1 {
            directional_blocks: BTreeSet::new(),
            waterlogged_blocks: BTreeSet::new(),
            water_block_id: 7,
        },
    })
    .expect("create deterministic Wasm-dispatch fixture runtime")
}

fn browser_nested_receipts(packets: &BrowserNestedPackets) -> BrowserNestedReceipts {
    let fixture = canonical_network_fixture_v1().expect("canonical nested browser fixture");

    let mut command_runtime = deterministic_runtime("session-r9");
    command_runtime
        .upsert_network_peer_grant(fixture.human_grant.clone())
        .expect("install command-batch peer grant");
    let browser_command_batch = command_runtime
        .process_network_browser_packet(&packets.command_batch_request)
        .expect("process complete outer BWRN command batch");

    let mut delta_runtime = deterministic_runtime("session-r9");
    let browser_delta_delivery = delta_runtime
        .process_network_browser_packet(&packets.delta_delivery_request)
        .expect("process complete outer BWRN delta delivery");

    let mut agent_runtime = deterministic_runtime("session-r9");
    agent_runtime
        .upsert_network_peer_grant(fixture.agent_grant.clone())
        .expect("install agent peer grant");
    agent_runtime
        .upsert_network_agent_grant(fixture.agent_capability_grant.clone())
        .expect("install agent capability grant");
    let browser_agent_command = agent_runtime
        .process_network_browser_packet(&packets.agent_command_request)
        .expect("process complete outer BWRN agent command");

    let mut pose_runtime = deterministic_runtime("session-r9");
    pose_runtime
        .upsert_network_peer_grant(NetworkPeerGrantV1 {
            actor_id: "peer-1".into(),
            ..fixture.human_grant.clone()
        })
        .expect("install guest-pose peer grant");
    pose_runtime
        .upsert_network_replication_record(ScopedDeltaRecordV1 {
            scope: ReplicationScopeV1::Entity("player:peer-1".into()),
            record: fixture.delta.records[0].clone(),
        })
        .expect("install guest-pose presentation record");
    let (presented, _) = pose_runtime
        .build_network_delta(
            InterestDeltaBuildSourceV1 {
                session_id: fixture.delta.session_id.clone(),
                delta_id: fixture.delta.delta_id.clone(),
                peer_id: fixture.delta.peer_id.clone(),
                keyframe: fixture.delta.keyframe,
                sequence: fixture.delta.sequence,
                acknowledged_command_sequence: fixture.delta.acknowledged_command_sequence,
                from: fixture.delta.from.clone(),
                to: fixture.delta.to.clone(),
            },
            &fixture.interest,
        )
        .expect("record guest-pose connection-bound presentation");
    assert_eq!(presented, fixture.delta);
    let browser_guest_pose = pose_runtime
        .process_network_browser_packet(&packets.guest_pose_request)
        .expect("process complete outer BWRN guest pose");

    BrowserNestedReceipts {
        browser_command_batch,
        browser_delta_delivery,
        browser_agent_command,
        browser_guest_pose,
    }
}

#[allow(clippy::too_many_arguments)]
fn wasm_dispatch_receipts(
    peer_grant: &[u8],
    agent_grant: &[u8],
    replication_record: &[u8],
    delta_build: &[u8],
    reconnect: &[u8],
    command_release: &[u8],
    peer_release: &[u8],
    browser_handshake: &[u8],
) -> WasmDispatchReceipts {
    let mut runtime = deterministic_runtime("session:雪:🦀");

    runtime
        .upsert_network_peer_grant(decode_network_peer_grant_v1(peer_grant).unwrap())
        .unwrap();
    let peer_grant_receipt = lifecycle_ack(b"BWP9", peer_grant, &runtime);

    runtime
        .upsert_network_agent_grant(decode_network_agent_grant_v1(agent_grant).unwrap())
        .unwrap();
    let agent_grant_receipt = lifecycle_ack(b"BWJ9", agent_grant, &runtime);

    let replication_value = decode_network_replication_record_v1(replication_record).unwrap();
    runtime
        .upsert_network_replication_record(replication_value.clone())
        .unwrap();
    let replication_record_receipt = lifecycle_ack(b"BWI9", replication_record, &runtime);

    let delta_request = decode_network_delta_build_request_v1(delta_build).unwrap();
    let (delta, stats) = runtime
        .build_network_delta(delta_request.source, &delta_request.interest)
        .unwrap();
    let delta_packet = encode_network_delta_v1(&delta).unwrap();
    let delta_build_receipt = encode_delta_build_response(
        &delta_packet,
        u32::try_from(stats.scope_probes).unwrap(),
        u32::try_from(stats.candidate_records).unwrap(),
        u32::try_from(stats.emitted_records).unwrap(),
    );

    let reconnect_request = decode_network_reconnect_request_v1(reconnect).unwrap();
    let reconnect_packet = runtime
        .network_reconnect_checkpoint(
            &reconnect_request.session_id,
            &reconnect_request.peer_id,
            reconnect_request.connection_generation,
        )
        .unwrap()
        .as_ref()
        .map(encode_network_checkpoint_v1)
        .transpose()
        .unwrap();
    let reconnect_receipt = encode_reconnect_response(reconnect_packet.as_deref());

    assert!(runtime.remove_network_replication_record(&replication_value.record));
    let replication_remove_receipt = lifecycle_ack(b"BWR9", replication_record, &runtime);
    let after_replication_remove = runtime.identity();
    assert!(!runtime.remove_network_replication_record(&replication_value.record));
    assert_eq!(runtime.identity(), after_replication_remove);

    runtime
        .release_network_command(&decode_network_command_release_v1(command_release).unwrap())
        .unwrap();
    let command_release_receipt = lifecycle_ack(b"BWM9", command_release, &runtime);

    runtime
        .release_network_peer(&decode_network_peer_release_v1(peer_release).unwrap())
        .unwrap();
    let peer_release_receipt = lifecycle_ack(b"BWL9", peer_release, &runtime);

    let browser_handshake_receipt = runtime
        .process_network_browser_packet(browser_handshake)
        .expect("process complete outer BWRN handshake");

    WasmDispatchReceipts {
        peer_grant: peer_grant_receipt,
        agent_grant: agent_grant_receipt,
        replication_record: replication_record_receipt,
        delta_build: delta_build_receipt,
        reconnect: reconnect_receipt,
        replication_remove: replication_remove_receipt,
        command_release: command_release_receipt,
        peer_release: peer_release_receipt,
        browser_handshake: browser_handshake_receipt,
        browser_command_batch: Vec::new(),
        browser_delta_delivery: Vec::new(),
        browser_agent_command: Vec::new(),
        browser_guest_pose: Vec::new(),
    }
}

fn lifecycle_ack(magic: &[u8; 4], request: &[u8], runtime: &IntegratedRuntimeV2) -> Vec<u8> {
    let mut payload = Vec::with_capacity(38);
    payload.extend_from_slice(magic);
    payload.extend_from_slice(&1_u16.to_le_bytes());
    payload.extend_from_slice(&wire_checksum_v1(request));
    payload.extend_from_slice(runtime.identity().state_hash.as_bytes());
    payload
}

fn verify_request_round_trips(packets: &FixturePackets) {
    assert_eq!(
        encode_network_peer_grant_v1(&decode_network_peer_grant_v1(&packets.peer_grant).unwrap()).unwrap(),
        packets.peer_grant,
    );
    assert_eq!(
        encode_network_agent_grant_v1(&decode_network_agent_grant_v1(&packets.agent_grant).unwrap()).unwrap(),
        packets.agent_grant,
    );
    assert_eq!(
        encode_network_replication_record_v1(
            &decode_network_replication_record_v1(&packets.replication_record).unwrap(),
        )
        .unwrap(),
        packets.replication_record,
    );
    assert_eq!(
        encode_network_delta_build_request_v1(
            &decode_network_delta_build_request_v1(&packets.delta_build_request).unwrap(),
        )
        .unwrap(),
        packets.delta_build_request,
    );
    assert_eq!(
        encode_network_reconnect_request_v1(&decode_network_reconnect_request_v1(&packets.reconnect_request).unwrap(),)
            .unwrap(),
        packets.reconnect_request,
    );
    assert_eq!(
        encode_network_peer_release_v1(&decode_network_peer_release_v1(&packets.peer_release).unwrap()).unwrap(),
        packets.peer_release,
    );
    assert_eq!(
        encode_network_command_release_v1(&decode_network_command_release_v1(&packets.command_release).unwrap())
            .unwrap(),
        packets.command_release,
    );
    assert_eq!(&packets.browser_handshake.request[..4], b"BWRN");
    assert_eq!(&packets.browser_handshake.host[..4], b"BWN1");
    assert_eq!(&packets.browser_handshake.peer[..4], b"BWN1");
    let NetworkBrowserRequestV1::Handshake { request_id, host, peer } =
        decode_network_browser_request_v1(&packets.browser_handshake.request).unwrap()
    else {
        panic!("fixture outer BWRN must carry a handshake request")
    };
    assert_eq!(request_id, MAX_SAFE_U64 - 4);
    assert_eq!(
        encode_network_handshake_v1(&host).unwrap(),
        packets.browser_handshake.host
    );
    assert_eq!(
        encode_network_handshake_v1(&peer).unwrap(),
        packets.browser_handshake.peer
    );

    let decoded_browser_response =
        decode_network_browser_response_v1(&packets.wasm_dispatch.browser_handshake).unwrap();
    let NetworkBrowserResponseV1::Handshake {
        request_id,
        compatibility,
    } = &decoded_browser_response
    else {
        panic!("fixture outer BWNA must carry a handshake response")
    };
    assert_eq!(*request_id, MAX_SAFE_U64 - 4);
    assert!(compatibility.decision.compatible);
    assert_eq!(
        encode_network_browser_response_v1(&decoded_browser_response).unwrap(),
        packets.wasm_dispatch.browser_handshake,
    );

    let NetworkBrowserRequestV1::CommandBatch {
        request_id,
        current,
        now,
        commands,
    } = decode_network_browser_request_v1(&packets.browser_nested.command_batch_request).unwrap()
    else {
        panic!("fixture outer BWRN must carry a command-batch request")
    };
    assert_eq!((request_id, now), (MAX_SAFE_U64 - 5, 100));
    assert_eq!(current, canonical_network_fixture_v1().unwrap().starting_identity);
    assert_eq!(commands.len(), 1);
    assert_eq!(
        encode_network_command_v1(&commands[0]).unwrap(),
        packets.browser_nested.command_batch_command,
    );

    let NetworkBrowserRequestV1::DeltaDelivery {
        request_id,
        checkpoint,
        interest: _,
        delta,
    } = decode_network_browser_request_v1(&packets.browser_nested.delta_delivery_request).unwrap()
    else {
        panic!("fixture outer BWRN must carry a delta-delivery request")
    };
    assert_eq!(request_id, MAX_SAFE_U64 - 6);
    assert_eq!(
        encode_network_checkpoint_v1(&checkpoint).unwrap(),
        packets.browser_nested.delta_delivery_checkpoint,
    );
    assert_eq!(
        encode_network_delta_v1(&delta).unwrap(),
        packets.browser_nested.delta_delivery_delta,
    );

    let NetworkBrowserRequestV1::AgentCommand {
        request_id,
        current: _,
        now,
        envelope,
        work,
    } = decode_network_browser_request_v1(&packets.browser_nested.agent_command_request).unwrap()
    else {
        panic!("fixture outer BWRN must carry an agent-command request")
    };
    assert_eq!((request_id, now), (MAX_SAFE_U64 - 7, 1_100));
    assert_eq!(
        encode_network_command_v1(&envelope).unwrap(),
        packets.browser_nested.agent_command_envelope,
    );
    assert_eq!(
        encode_agent_work_command_v1(&work).unwrap(),
        packets.browser_nested.agent_command_work,
    );

    let NetworkBrowserRequestV1::GuestPose {
        request_id,
        current: _,
        now,
        command,
        pose,
    } = decode_network_browser_request_v1(&packets.browser_nested.guest_pose_request).unwrap()
    else {
        panic!("fixture outer BWRN must carry a guest-pose request")
    };
    assert_eq!((request_id, now), (MAX_SAFE_U64 - 8, 1_000));
    assert_eq!(
        encode_network_command_v1(&command).unwrap(),
        packets.browser_nested.guest_pose_command,
    );
    assert_eq!(
        encode_network_player_pose_v1(&pose).unwrap(),
        packets.browser_nested.guest_pose_payload,
    );

    for response in [
        &packets.wasm_dispatch.browser_command_batch,
        &packets.wasm_dispatch.browser_delta_delivery,
        &packets.wasm_dispatch.browser_agent_command,
        &packets.wasm_dispatch.browser_guest_pose,
    ] {
        let decoded = decode_network_browser_response_v1(response).unwrap();
        assert_eq!(encode_network_browser_response_v1(&decoded).unwrap(), *response);
    }
    let NetworkBrowserResponseV1::CommandBatch {
        request_id, receipts, ..
    } = decode_network_browser_response_v1(&packets.wasm_dispatch.browser_command_batch).unwrap()
    else {
        panic!("fixture BWNA must carry a command-batch response")
    };
    assert_eq!(request_id, MAX_SAFE_U64 - 5);
    assert_eq!(receipts.len(), 1);
    assert!(receipts[0].accepted());
    let NetworkBrowserResponseV1::DeltaDelivery {
        request_id,
        code,
        sequence,
        ..
    } = decode_network_browser_response_v1(&packets.wasm_dispatch.browser_delta_delivery).unwrap()
    else {
        panic!("fixture BWNA must carry a delta-delivery response")
    };
    assert_eq!(
        (request_id, code, sequence),
        (MAX_SAFE_U64 - 6, DeltaApplyCodeV1::Applied, 1)
    );
    let NetworkBrowserResponseV1::AgentCommand {
        request_id,
        code,
        receipt,
        ..
    } = decode_network_browser_response_v1(&packets.wasm_dispatch.browser_agent_command).unwrap()
    else {
        panic!("fixture BWNA must carry an agent-command response")
    };
    assert_eq!((request_id, code), (MAX_SAFE_U64 - 7, AgentAuthorityCodeV1::Accepted));
    assert!(receipt.is_some_and(|value| value.accepted()));
    let NetworkBrowserResponseV1::GuestPose {
        request_id,
        receipt,
        projection,
        ..
    } = decode_network_browser_response_v1(&packets.wasm_dispatch.browser_guest_pose).unwrap()
    else {
        panic!("fixture BWNA must carry a guest-pose response")
    };
    assert_eq!(request_id, MAX_SAFE_U64 - 8);
    assert!(receipt.accepted());
    assert!(projection.is_some());
}

fn verify_negative_vectors(packets: &FixturePackets) {
    let mut checksum_tamper = packets.command_release.clone();
    *checksum_tamper.last_mut().expect("command release body") ^= 0x01;
    assert!(decode_network_command_release_v1(&checksum_tamper).is_err());

    let mut trailing = packets.command_release.clone();
    trailing.push(0);
    assert!(decode_network_command_release_v1(&trailing).is_err());

    let mut peer_kind = packets.peer_grant.clone();
    let peer_kind_offset = four_string_body_end(&peer_kind);
    peer_kind[peer_kind_offset] = u8::MAX;
    reseal(&mut peer_kind);
    assert!(decode_network_peer_grant_v1(&peer_kind).is_err());

    let mut agent_status = packets.agent_grant.clone();
    let agent_status_offset = three_string_body_end(&agent_status);
    agent_status[agent_status_offset] = u8::MAX;
    reseal(&mut agent_status);
    assert!(decode_network_agent_grant_v1(&agent_status).is_err());

    let mut scope_tag = packets.replication_record.clone();
    scope_tag[WRAPPED_BODY_OFFSET] = u8::MAX;
    reseal(&mut scope_tag);
    assert!(decode_network_replication_record_v1(&scope_tag).is_err());

    let mut record_tag = packets.replication_record.clone();
    let record_tag_offset = chunk_scope_body_end(&record_tag);
    record_tag[record_tag_offset] = u8::MAX;
    reseal(&mut record_tag);
    assert!(decode_network_replication_record_v1(&record_tag).is_err());

    let mut browser_checksum = packets.browser_handshake.request.clone();
    *browser_checksum.last_mut().expect("browser handshake body") ^= 0x01;
    assert!(decode_network_browser_request_v1(&browser_checksum).is_err());

    for request in [
        &packets.browser_nested.command_batch_request,
        &packets.browser_nested.delta_delivery_request,
        &packets.browser_nested.agent_command_request,
        &packets.browser_nested.guest_pose_request,
    ] {
        let mut checksum = request.clone();
        *checksum.last_mut().expect("nested browser request body") ^= 0x01;
        assert!(decode_network_browser_request_v1(&checksum).is_err());
    }

    let mut browser_trailing = packets.browser_nested.command_batch_request.clone();
    browser_trailing.push(0);
    assert!(decode_network_browser_request_v1(&browser_trailing).is_err());

    let mut browser_unknown_kind = packets.browser_nested.command_batch_request.clone();
    browser_unknown_kind[6..8].copy_from_slice(&u16::MAX.to_le_bytes());
    assert!(decode_network_browser_request_v1(&browser_unknown_kind).is_err());
}

fn fixture_json(packets: &FixturePackets) -> String {
    format!(
        concat!(
            "{{\n",
            "  \"schema\": \"blockwild.integrated-network-r9-wire-fixture.v1\",\n",
            "  \"producer\": \"blockwild-engine\",\n",
            "  \"wasmDispatchExercised\": true,\n",
            "  \"wasmDispatchFamilies\": [\"peerGrant\", \"agentGrant\", \"replicationRecord\", \"deltaBuild\", \"reconnect\", \"replicationRemove\", \"commandRelease\", \"peerRelease\", \"browserRequest\"],\n",
            "  \"wasmDispatchEvidence\": \"blockwild-wasm::integrated_runtime::tests::checked_r9_network_requests_cross_real_bwrq_bwrs_dispatch\",\n",
            "  \"browserRequestKindsCovered\": [\"handshake\", \"command-batch\", \"delta-delivery\", \"agent-command\", \"guest-pose\"],\n",
            "  \"uncoveredBrowserRequestKinds\": [],\n",
            "  \"browserCoverageBoundary\": \"One deterministic accepted vector crosses real BWRQ/BWRS dispatch for each nested BWRN kind; the broader outcome matrix and formal migration authority remain outside this fixture.\",\n",
            "  \"publicTypeScriptNestedCodecGaps\": [],\n",
            "  \"requests\": {{\n",
            "    \"peerGrant\": \"{}\",\n",
            "    \"agentGrant\": \"{}\",\n",
            "    \"replicationRecord\": \"{}\",\n",
            "    \"deltaBuild\": \"{}\",\n",
            "    \"reconnect\": \"{}\",\n",
            "    \"peerRelease\": \"{}\",\n",
            "    \"commandRelease\": \"{}\"\n",
            "  }},\n",
            "  \"browserHandshake\": {{\n",
            "    \"outerRequestHex\": \"{}\",\n",
            "    \"nestedHostBwn1Hex\": \"{}\",\n",
            "    \"nestedPeerBwn1Hex\": \"{}\"\n",
            "  }},\n",
            "  \"browserCommandBatch\": {{\n",
            "    \"outerRequestHex\": \"{}\",\n",
            "    \"nestedCommandBwn1Hex\": \"{}\"\n",
            "  }},\n",
            "  \"browserDeltaDelivery\": {{\n",
            "    \"outerRequestHex\": \"{}\",\n",
            "    \"nestedCheckpointBwn1Hex\": \"{}\",\n",
            "    \"nestedDeltaBwn1Hex\": \"{}\"\n",
            "  }},\n",
            "  \"browserAgentCommand\": {{\n",
            "    \"outerRequestHex\": \"{}\",\n",
            "    \"nestedEnvelopeBwn1Hex\": \"{}\",\n",
            "    \"nestedWorkBwa1Hex\": \"{}\"\n",
            "  }},\n",
            "  \"browserGuestPose\": {{\n",
            "    \"outerRequestHex\": \"{}\",\n",
            "    \"nestedCommandBwn1Hex\": \"{}\",\n",
            "    \"nestedPoseBwnpHex\": \"{}\"\n",
            "  }},\n",
            "  \"nativeResponses\": {{\n",
            "    \"deltaBuild\": {{\n",
            "      \"hex\": \"{}\",\n",
            "      \"scopeProbes\": 4294967295,\n",
            "      \"candidateRecords\": 4294967294,\n",
            "      \"emittedRecords\": 1,\n",
            "      \"deltaPacketHex\": \"{}\"\n",
            "    }},\n",
            "    \"reconnectPresent\": {{\n",
            "      \"hex\": \"{}\",\n",
            "      \"checkpointPacketHex\": \"{}\"\n",
            "    }},\n",
            "    \"reconnectAbsent\": {{ \"hex\": \"{}\" }}\n",
            "  }},\n",
            "  \"wasmDispatchReceipts\": {{\n",
            "    \"peerGrant\": \"{}\",\n",
            "    \"agentGrant\": \"{}\",\n",
            "    \"replicationRecord\": \"{}\",\n",
            "    \"deltaBuild\": \"{}\",\n",
            "    \"reconnect\": \"{}\",\n",
            "    \"replicationRemove\": \"{}\",\n",
            "    \"commandRelease\": \"{}\",\n",
            "    \"peerRelease\": \"{}\",\n",
            "    \"browserHandshake\": \"{}\",\n",
            "    \"browserCommandBatch\": \"{}\",\n",
            "    \"browserDeltaDelivery\": \"{}\",\n",
            "    \"browserAgentCommand\": \"{}\",\n",
            "    \"browserGuestPose\": \"{}\"\n",
            "  }}\n",
            "}}\n",
        ),
        hex(&packets.peer_grant),
        hex(&packets.agent_grant),
        hex(&packets.replication_record),
        hex(&packets.delta_build_request),
        hex(&packets.reconnect_request),
        hex(&packets.peer_release),
        hex(&packets.command_release),
        hex(&packets.browser_handshake.request),
        hex(&packets.browser_handshake.host),
        hex(&packets.browser_handshake.peer),
        hex(&packets.browser_nested.command_batch_request),
        hex(&packets.browser_nested.command_batch_command),
        hex(&packets.browser_nested.delta_delivery_request),
        hex(&packets.browser_nested.delta_delivery_checkpoint),
        hex(&packets.browser_nested.delta_delivery_delta),
        hex(&packets.browser_nested.agent_command_request),
        hex(&packets.browser_nested.agent_command_envelope),
        hex(&packets.browser_nested.agent_command_work),
        hex(&packets.browser_nested.guest_pose_request),
        hex(&packets.browser_nested.guest_pose_command),
        hex(&packets.browser_nested.guest_pose_payload),
        hex(&packets.delta_build_response),
        hex(&packets.delta_packet),
        hex(&packets.reconnect_present_response),
        hex(&packets.reconnect_checkpoint),
        hex(&packets.reconnect_absent_response),
        hex(&packets.wasm_dispatch.peer_grant),
        hex(&packets.wasm_dispatch.agent_grant),
        hex(&packets.wasm_dispatch.replication_record),
        hex(&packets.wasm_dispatch.delta_build),
        hex(&packets.wasm_dispatch.reconnect),
        hex(&packets.wasm_dispatch.replication_remove),
        hex(&packets.wasm_dispatch.command_release),
        hex(&packets.wasm_dispatch.peer_release),
        hex(&packets.wasm_dispatch.browser_handshake),
        hex(&packets.wasm_dispatch.browser_command_batch),
        hex(&packets.wasm_dispatch.browser_delta_delivery),
        hex(&packets.wasm_dispatch.browser_agent_command),
        hex(&packets.wasm_dispatch.browser_guest_pose),
    )
}

fn encode_delta_build_response(
    packet: &[u8],
    scope_probes: u32,
    candidate_records: u32,
    emitted_records: u32,
) -> Vec<u8> {
    let mut payload = Vec::with_capacity(22 + packet.len());
    payload.extend_from_slice(b"BWH9");
    payload.extend_from_slice(&1_u16.to_le_bytes());
    payload.extend_from_slice(&scope_probes.to_le_bytes());
    payload.extend_from_slice(&candidate_records.to_le_bytes());
    payload.extend_from_slice(&emitted_records.to_le_bytes());
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

fn four_string_body_end(bytes: &[u8]) -> usize {
    skip_strings(bytes, WRAPPED_BODY_OFFSET, 4)
}

fn three_string_body_end(bytes: &[u8]) -> usize {
    skip_strings(bytes, WRAPPED_BODY_OFFSET, 3)
}

fn chunk_scope_body_end(bytes: &[u8]) -> usize {
    assert_eq!(
        bytes[WRAPPED_BODY_OFFSET], 2,
        "fixture must use a chunk replication scope"
    );
    skip_strings(bytes, WRAPPED_BODY_OFFSET + 1, 2) + 8
}

fn skip_strings(bytes: &[u8], mut cursor: usize, count: usize) -> usize {
    for _ in 0..count {
        let length = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4 + length;
    }
    cursor
}

fn reseal(bytes: &mut [u8]) {
    let body_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    let checksum = wire_checksum_v1(&bytes[WRAPPED_BODY_OFFSET..WRAPPED_BODY_OFFSET + body_length]);
    bytes[12..WRAPPED_BODY_OFFSET].copy_from_slice(&checksum);
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn normalize_newlines(value: &str) -> String {
    value.replace("\r\n", "\n").trim_end().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_vectors_are_native_round_trippable_and_fail_closed() {
        let packets = fixture_packets();
        verify_request_round_trips(&packets);
        verify_negative_vectors(&packets);
    }
}
