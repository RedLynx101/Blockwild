#[allow(dead_code)]
#[path = "../examples/r7_gameplay_wire_fixture.rs"]
mod fixture;

use blockwild_runtime_wire::wire_checksum_v1;

#[test]
fn all_registered_r7_native_vectors_remain_exact() {
    let checked = std::fs::read_to_string(fixture::fixture_path()).expect("checked R7 fixture");
    assert_eq!(checked.replace("\r\n", "\n"), fixture::fixture());
}

#[test]
fn every_native_family_rejects_truncation_schema_and_trailing_bytes() {
    for vector in fixture::vectors() {
        assert!((vector.decode)(&vector.bytes), "{}", vector.family);
        for length in [0, 5, vector.bytes.len() - 1] {
            assert!(
                !(vector.decode)(&vector.bytes[..length]),
                "{} truncation {length}",
                vector.family
            );
        }
        let ack = vector.family == "gameplay-actor-grant-receipt-v1";
        let mut schema = vector.bytes.clone();
        schema[if ack { 4 } else { 6 }] = 0xff;
        assert!(!(vector.decode)(&schema), "{} schema", vector.family);
        let mut trailing = vector.bytes.clone();
        trailing.push(0);
        if !ack {
            let size = (trailing.len() - 28) as u32;
            trailing[8..12].copy_from_slice(&size.to_le_bytes());
            let hash = wire_checksum_v1(&trailing[28..]);
            trailing[12..28].copy_from_slice(&hash);
        }
        assert!(!(vector.decode)(&trailing), "{} resealed trailing", vector.family);
        if !ack {
            let mut corrupt = vector.bytes.clone();
            *corrupt.last_mut().unwrap() ^= 1;
            assert!(!(vector.decode)(&corrupt), "{} checksum", vector.family);
        }
    }
}

#[test]
fn native_requests_reject_resealed_collection_and_string_bounds() {
    for family in [
        "content-install-page-v1",
        "gameplay-actor-grant-v1",
        "gameplay-command-v1",
    ] {
        let vector = fixture::vectors()
            .into_iter()
            .find(|vector| vector.family == family)
            .unwrap();
        let mut oversized = vector.bytes;
        oversized[28..32].copy_from_slice(&u32::MAX.to_le_bytes());
        let hash = wire_checksum_v1(&oversized[28..]);
        oversized[12..28].copy_from_slice(&hash);
        assert!(!(vector.decode)(&oversized), "{family} string bound");
    }
    // Known fixture trailers: 5 grant scopes, or one 19-byte schedule command plus a 16-byte hash.
    for (family, trailer_size) in [("gameplay-actor-grant-v1", 9), ("gameplay-command-v1", 39)] {
        let vector = fixture::vectors()
            .into_iter()
            .find(|vector| vector.family == family)
            .unwrap();
        let mut oversized = vector.bytes;
        let offset = oversized.len() - trailer_size;
        oversized[offset..offset + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        let hash = wire_checksum_v1(&oversized[28..]);
        oversized[12..28].copy_from_slice(&hash);
        assert!(!(vector.decode)(&oversized), "{family} collection bound");
    }
    for family in [
        "basic-dirt-action-receipt-v1",
        "native-block-edit-receipt-v1",
        "native-block-edit-receipt-v2",
        "native-drop-pickup-receipt-v1",
        "native-player-drop-receipt-v1",
    ] {
        let vector = fixture::vectors()
            .into_iter()
            .find(|vector| vector.family == family)
            .unwrap();
        let mut oversized = vector.bytes;
        let offset = oversized.len() - 8;
        oversized[offset..].copy_from_slice(&(1_u64 << 53).to_le_bytes());
        let hash = wire_checksum_v1(&oversized[28..]);
        oversized[12..28].copy_from_slice(&hash);
        assert!(!(vector.decode)(&oversized), "{family} unsafe cursor");
    }
}

#[test]
fn native_gameplay_rejection_tags_are_frozen_and_bounded() {
    assert_eq!(fixture::rejected_receipts().len(), 11);
    for mut bytes in fixture::rejected_receipts() {
        assert!(blockwild_engine::decode_gameplay_receipt_v1(&bytes).is_ok());
        // The final field is the 11-byte visible UTF-8 rejection message.
        let rejection_tag_offset = bytes.len() - 16;
        bytes[rejection_tag_offset] = u8::MAX;
        let hash = wire_checksum_v1(&bytes[28..]);
        bytes[12..28].copy_from_slice(&hash);
        assert!(blockwild_engine::decode_gameplay_receipt_v1(&bytes).is_err());
    }
}
