#[allow(dead_code)]
#[path = "../examples/r6_entity_domain_wire_fixture.rs"]
mod emitter;

#[test]
fn checked_r6_all_family_wire_vectors_match_native_codecs() {
    let checked = std::fs::read_to_string(emitter::fixture_path()).expect("checked R6 fixture exists");
    assert_eq!(checked.replace("\r\n", "\n"), emitter::fixture());
}
