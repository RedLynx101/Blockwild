#[allow(dead_code)]
#[path = "../examples/r6_entity_authority_hash_fixture.rs"]
mod emitter;

#[test]
fn checked_r6_semantic_hashes_match_complete_native_authorities() {
    let checked = std::fs::read_to_string(emitter::fixture_path()).expect("checked R6 semantic hash fixture exists");
    assert_eq!(checked.replace("\r\n", "\n"), emitter::fixture());
}

#[test]
fn native_free_set_normalizes_wire_order_but_hashes_retained_allocator_history() {
    use blockwild_entity::{decode_entity_authority_snapshot, encode_entity_authority_snapshot};
    let authority = emitter::rich_authority();
    let canonical = encode_entity_authority_snapshot(&authority).unwrap();
    let mut reordered = canonical.clone();
    let slots_offset = if reordered[14] == 1 { 23 } else { 15 };
    let slots = u32::from_le_bytes(reordered[slots_offset..slots_offset + 4].try_into().unwrap()) as usize;
    let free_offset = slots_offset + 4 + slots * 5;
    let count = u32::from_le_bytes(reordered[free_offset..free_offset + 4].try_into().unwrap()) as usize;
    assert!(count > 1);
    for byte in 0..4 {
        reordered.swap(free_offset + 4 + byte, free_offset + count * 4 + byte);
    }
    let restored = decode_entity_authority_snapshot(&reordered).unwrap();
    assert_eq!(restored.canonical_hash(), authority.canonical_hash());
    assert_eq!(encode_entity_authority_snapshot(&restored).unwrap(), canonical);
    let free_generation_offset = slots_offset + 4 + 5;
    reordered[free_generation_offset..free_generation_offset + 4].copy_from_slice(&2_u32.to_le_bytes());
    let changed = decode_entity_authority_snapshot(&reordered).unwrap();
    assert_ne!(changed.canonical_hash(), authority.canonical_hash());
}

#[test]
fn native_hash_uses_domain_framing_and_rejects_invalid_snapshot_structure() {
    use blockwild_entity::{decode_entity_authority_snapshot, encode_entity_authority_snapshot};
    use blockwild_types::CanonicalHasher;
    let authority = emitter::rich_authority();
    let snapshot = encode_entity_authority_snapshot(&authority).unwrap();
    let mut expected = CanonicalHasher::new("blockwild.entity.authority.v2");
    expected.write_bytes(&snapshot);
    assert_eq!(expected.finish(), authority.canonical_hash());
    let mut other_domain = CanonicalHasher::new("blockwild.entity.authority.v1");
    other_domain.write_bytes(&snapshot);
    assert_ne!(other_domain.finish(), authority.canonical_hash());
    let mut bad_schema = snapshot.clone();
    bad_schema[4] = 3;
    assert!(decode_entity_authority_snapshot(&bad_schema).is_err());
    let mut bad_reserved_slot = snapshot.clone();
    bad_reserved_slot[27] = 1;
    assert!(decode_entity_authority_snapshot(&bad_reserved_slot).is_err());
    let mut bad_free_set = snapshot.clone();
    let free_offset = 23 + 4 + 7 * 5;
    bad_free_set[free_offset + 8..free_offset + 12].copy_from_slice(&1_u32.to_le_bytes());
    assert!(decode_entity_authority_snapshot(&bad_free_set).is_err());
    assert!(decode_entity_authority_snapshot(&snapshot[..snapshot.len() - 1]).is_err());
}
