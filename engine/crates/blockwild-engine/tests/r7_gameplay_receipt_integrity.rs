#[allow(dead_code)]
#[path = "../examples/r7_gameplay_wire_fixture.rs"]
mod fixture;

use blockwild_engine::{decode_gameplay_actor_grant_v1, decode_gameplay_receipt_v1, encode_gameplay_receipt_v1};
use blockwild_gameplay::{AuthorityIdentity, GameplayReceipt};
use blockwild_runtime_wire::wire_checksum_v1;

fn packet(family: &str) -> Vec<u8> {
    fixture::vectors()
        .into_iter()
        .find(|value| value.family == family)
        .unwrap()
        .bytes
}

fn reseal(bytes: &mut [u8]) {
    let checksum = wire_checksum_v1(&bytes[28..]);
    bytes[12..28].copy_from_slice(&checksum);
}

fn identity_bytes(value: &AuthorityIdentity) -> usize {
    4 + value.world.universe.len() + 4 + value.world.location.len() + 4 + 6 * 8 + 16
}

#[test]
fn gameplay_receipt_rejects_resealed_hash_and_changed_semantics() {
    let original = packet("gameplay-receipt-v1");
    let GameplayReceipt::Accepted(mut value) = decode_gameplay_receipt_v1(&original).unwrap() else {
        panic!("fixture must be accepted");
    };
    assert_eq!(value.receipt_hash, value.calculate_hash());
    let mut forged = original;
    let last = forged.len() - 1;
    forged[last] ^= 1;
    reseal(&mut forged);
    assert_eq!(
        decode_gameplay_receipt_v1(&forged).unwrap_err().code,
        "gameplay-receipt-hash"
    );

    value.resource_deltas[0].amount += 1;
    assert_eq!(
        encode_gameplay_receipt_v1(&GameplayReceipt::Accepted(value.clone()))
            .unwrap_err()
            .code,
        "gameplay-receipt-hash"
    );
    value.receipt_hash = value.calculate_hash();
    let receipt = GameplayReceipt::Accepted(value);
    let valid = encode_gameplay_receipt_v1(&receipt).unwrap();
    assert_eq!(decode_gameplay_receipt_v1(&valid).unwrap(), receipt);
}

#[test]
fn touched_domain_sets_reject_resealed_reordering_and_duplicates() {
    let original = packet("gameplay-receipt-v1");
    let GameplayReceipt::Accepted(value) = decode_gameplay_receipt_v1(&original).unwrap() else {
        panic!("fixture must be accepted");
    };
    assert!(value.touched_domains.len() >= 2);
    let offset = 28 + 1 + 4 + value.batch_id.len() + identity_bytes(&value.before) + identity_bytes(&value.after) + 4;
    for duplicate in [false, true] {
        let mut corrupt = original.clone();
        if duplicate {
            corrupt[offset + 1] = corrupt[offset];
        } else {
            corrupt.swap(offset, offset + 1);
        }
        reseal(&mut corrupt);
        assert_eq!(
            decode_gameplay_receipt_v1(&corrupt).unwrap_err().code,
            "gameplay-receipt"
        );
    }
}

#[test]
fn grant_scope_sets_reject_resealed_reordering_and_duplicates() {
    let original = packet("gameplay-actor-grant-v1");
    let (_, grant) = decode_gameplay_actor_grant_v1(&original).unwrap();
    assert!(grant.scopes.len() >= 2);
    let offset = original.len() - grant.scopes.len();
    for duplicate in [false, true] {
        let mut corrupt = original.clone();
        if duplicate {
            corrupt[offset + 1] = corrupt[offset];
        } else {
            corrupt.swap(offset, offset + 1);
        }
        reseal(&mut corrupt);
        assert_eq!(
            decode_gameplay_actor_grant_v1(&corrupt).unwrap_err().code,
            "gameplay-grant"
        );
    }
}
