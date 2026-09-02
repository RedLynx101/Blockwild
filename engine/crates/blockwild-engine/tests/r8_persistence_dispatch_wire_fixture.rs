#[allow(dead_code)]
#[path = "../examples/r8_persistence_dispatch_wire_fixture.rs"]
mod emitter;

use blockwild_engine::{
    RuntimePersistenceDispatchReceiptWireV1, RuntimePersistenceDispatchWireV1,
    decode_runtime_persistence_dispatch_receipt_v1, decode_runtime_persistence_dispatch_v1,
    encode_runtime_persistence_dispatch_receipt_v1, encode_runtime_persistence_dispatch_v1,
};
use blockwild_runtime_wire::{MAX_DOMAIN_PAYLOAD_BYTES, MAX_SAFE_U64, wire_checksum_v1};
use blockwild_types::CanonicalHash;

fn reseal(packet: &[u8], body: &[u8]) -> Vec<u8> {
    let mut result = packet[..28].to_vec();
    result[8..12].copy_from_slice(&(body.len() as u32).to_le_bytes());
    result[12..28].copy_from_slice(&wire_checksum_v1(body));
    result.extend_from_slice(body);
    result
}

#[test]
fn checked_r8_persistence_dispatch_fixture_matches_native_codecs() {
    let expected = std::fs::read_to_string(emitter::fixture_path()).expect("checked R8 persistence fixture exists");
    assert_eq!(expected.replace("\r\n", "\n"), emitter::fixture());
}

#[test]
fn r8_dispatch_all_variants_reject_corruption_and_noncanonical_envelopes() {
    for (name, value) in emitter::request_vectors() {
        let packet = encode_runtime_persistence_dispatch_v1(&value).unwrap();
        let mut corrupt = packet.clone();
        *corrupt.last_mut().unwrap() ^= 0x80;
        assert!(decode_runtime_persistence_dispatch_v1(&corrupt).is_err(), "{name}");
        for offset in [0, 4, 6, 8] {
            let mut invalid = packet.clone();
            invalid[offset] ^= 0x80;
            assert!(decode_runtime_persistence_dispatch_v1(&invalid).is_err(), "{name}");
        }
        assert!(decode_runtime_persistence_dispatch_v1(&packet[..packet.len() - 1]).is_err());
        let mut trailing_body = packet[28..].to_vec();
        trailing_body.push(0);
        assert!(decode_runtime_persistence_dispatch_v1(&reseal(&packet, &trailing_body)).is_err());
    }
    let close = encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::Close).unwrap();
    for tag in [0, 2, 3, 15, 255] {
        assert!(decode_runtime_persistence_dispatch_v1(&reseal(&close, &[tag])).is_err());
    }
}

#[test]
fn r8_dispatch_safe_integer_control_character_and_packet_limits_match_typescript() {
    let retry = encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::Retry {
        previous_request_id: MAX_SAFE_U64,
    })
    .unwrap();
    let mut body = retry[28..].to_vec();
    body[1..9].copy_from_slice(&(MAX_SAFE_U64 + 1).to_le_bytes());
    assert!(decode_runtime_persistence_dispatch_v1(&reseal(&retry, &body)).is_err());
    assert!(
        encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::Retry {
            previous_request_id: MAX_SAFE_U64 + 1,
        })
        .is_err()
    );
    for control in ['\0', '\u{1f}', '\u{7f}', '\u{85}', '\u{9f}'] {
        assert!(
            encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::Estimate {
                world_id: format!("w{control}"),
            })
            .is_err()
        );
        let identifier = format!("w{control}");
        let mut body = vec![6];
        body.extend_from_slice(&(identifier.len() as u32).to_le_bytes());
        body.extend_from_slice(identifier.as_bytes());
        assert!(decode_runtime_persistence_dispatch_v1(&reseal(&retry, &body)).is_err());
    }
    let largest = RuntimePersistenceDispatchWireV1::Commit {
        browser_request: vec![0; MAX_DOMAIN_PAYLOAD_BYTES - 28 - 5],
    };
    let packet = encode_runtime_persistence_dispatch_v1(&largest).unwrap();
    assert_eq!(packet.len(), MAX_DOMAIN_PAYLOAD_BYTES);
    assert_eq!(decode_runtime_persistence_dispatch_v1(&packet).unwrap(), largest);
    assert!(
        encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::Commit {
            browser_request: vec![0; MAX_DOMAIN_PAYLOAD_BYTES - 28 - 4],
        })
        .is_err()
    );
    assert!(
        encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::ImportChunk {
            world_id: "w".repeat(16 * 1024),
            import_id: "i".repeat(16 * 1024),
            offset: 0,
            total_bytes: MAX_DOMAIN_PAYLOAD_BYTES as u64,
            bytes: vec![0; MAX_DOMAIN_PAYLOAD_BYTES - 64],
        })
        .is_err()
    );
}

#[test]
fn r8_receipt_rejects_resealed_unsafe_numbers_and_invalid_flags() {
    let receipt = RuntimePersistenceDispatchReceiptWireV1 {
        request_id: Some(MAX_SAFE_U64),
        persistence_revision: MAX_SAFE_U64,
        pending: u32::MAX,
        queued_bytes: MAX_SAFE_U64,
        state_hash: CanonicalHash([0x81; 16]),
        closed: true,
    };
    let packet = encode_runtime_persistence_dispatch_receipt_v1(&receipt).unwrap();
    assert_eq!(
        decode_runtime_persistence_dispatch_receipt_v1(&packet).unwrap(),
        receipt
    );
    for offset in [1, 9, 21] {
        let mut body = packet[28..].to_vec();
        body[offset..offset + 8].copy_from_slice(&(MAX_SAFE_U64 + 1).to_le_bytes());
        assert!(decode_runtime_persistence_dispatch_receipt_v1(&reseal(&packet, &body)).is_err());
    }
    for offset in [0, packet.len() - 29] {
        let mut body = packet[28..].to_vec();
        body[offset] = 2;
        assert!(decode_runtime_persistence_dispatch_receipt_v1(&reseal(&packet, &body)).is_err());
    }
    for invalid in [
        RuntimePersistenceDispatchReceiptWireV1 {
            request_id: Some(MAX_SAFE_U64 + 1),
            ..receipt.clone()
        },
        RuntimePersistenceDispatchReceiptWireV1 {
            persistence_revision: MAX_SAFE_U64 + 1,
            ..receipt.clone()
        },
        RuntimePersistenceDispatchReceiptWireV1 {
            queued_bytes: MAX_SAFE_U64 + 1,
            ..receipt
        },
    ] {
        assert!(encode_runtime_persistence_dispatch_receipt_v1(&invalid).is_err());
    }
}

#[test]
fn r8_identifiers_preserve_leading_bom_and_bom_only_utf8_data() {
    for identifier in ["\u{feff}world", "\u{feff}"] {
        let requests = [
            RuntimePersistenceDispatchWireV1::Estimate {
                world_id: identifier.into(),
            },
            RuntimePersistenceDispatchWireV1::Recover {
                world_id: "world".into(),
                checkpoint_id: Some(identifier.into()),
            },
            RuntimePersistenceDispatchWireV1::PreserveLegacyBackupChunk {
                world_id: "world".into(),
                backup_id: identifier.into(),
                offset: 0,
                total_bytes: 1,
                bytes: vec![7],
            },
            RuntimePersistenceDispatchWireV1::ImportChunk {
                world_id: "world".into(),
                import_id: identifier.into(),
                offset: 0,
                total_bytes: 1,
                bytes: vec![7],
            },
        ];
        for request in requests {
            let packet = encode_runtime_persistence_dispatch_v1(&request).unwrap();
            let decoded = decode_runtime_persistence_dispatch_v1(&packet).unwrap();
            assert_eq!(decoded, request);
            assert_eq!(encode_runtime_persistence_dispatch_v1(&decoded).unwrap(), packet);
        }
        let packet = encode_runtime_persistence_dispatch_v1(&RuntimePersistenceDispatchWireV1::Estimate {
            world_id: identifier.into(),
        })
        .unwrap();
        let mut expected_body = vec![6];
        expected_body.extend_from_slice(&(identifier.len() as u32).to_le_bytes());
        expected_body.extend_from_slice(identifier.as_bytes());
        assert_eq!(&packet[28..], expected_body);
        assert_eq!(&packet[33..36], &[0xef, 0xbb, 0xbf]);
    }
}
