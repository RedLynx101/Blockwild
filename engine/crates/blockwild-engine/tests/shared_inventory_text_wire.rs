use blockwild_engine::{decode_gameplay_actor_grant_v1, encode_gameplay_actor_grant_v1};
use blockwild_gameplay::{ActorGrant, ItemInstanceMetadataV1};
use blockwild_types::CanonicalHash;

#[test]
fn native_grant_identifiers_preserve_leading_and_bom_only_text() {
    for actor in ["\u{feff}", "\u{feff}player:水", "player:\u{feff}", "player:🦊"] {
        let packet = encode_gameplay_actor_grant_v1(actor, &ActorGrant::system()).unwrap();
        assert_eq!(&packet[32..32 + actor.len()], actor.as_bytes());
        let (decoded, grant) = decode_gameplay_actor_grant_v1(&packet).unwrap();
        assert_eq!(decoded, actor);
        assert_eq!(encode_gameplay_actor_grant_v1(&decoded, &grant).unwrap(), packet);
    }
}

#[test]
fn native_metadata_json_rejects_bom_even_with_recomputed_descriptor_hash() {
    let mut metadata = ItemInstanceMetadataV1 {
        hash: CanonicalHash::default(),
        type_id: "item-instance".into(),
        schema_id: "item-instance-v1".into(),
        schema_version: 1,
        content_version: 1,
        canonical_json_bytes: b"{}".to_vec(),
        unknown_extension_bytes: Vec::new(),
    };
    metadata.hash = metadata.calculate_hash();
    assert!(metadata.validate_wire().is_ok());
    metadata.canonical_json_bytes = "\u{feff}{}".as_bytes().to_vec();
    metadata.hash = metadata.calculate_hash();
    assert!(metadata.validate_wire().is_err());
}
