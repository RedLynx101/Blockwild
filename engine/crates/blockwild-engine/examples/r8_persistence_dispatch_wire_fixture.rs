use std::{env, fs, path::PathBuf};

use blockwild_engine::{
    INTEGRATED_RUNTIME_DOMAIN_SCHEMA_FINGERPRINT_V1, RuntimePersistenceDispatchReceiptWireV1,
    RuntimePersistenceDispatchWireV1, decode_runtime_persistence_dispatch_receipt_v1,
    decode_runtime_persistence_dispatch_v1, encode_runtime_persistence_dispatch_receipt_v1,
    encode_runtime_persistence_dispatch_v1,
};
use blockwild_types::CanonicalHash;

const FIXTURE_RELATIVE_PATH: &str =
    "tests/fixtures/rust-engine/integrated-runtime-v1/r8-persistence-dispatch-wire-v1.json";

fn hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}").expect("writing to String is infallible");
    }
    output
}

pub fn fixture() -> String {
    let request = RuntimePersistenceDispatchWireV1::Estimate {
        world_id: "wørld:水".to_owned(),
    };
    let receipt = RuntimePersistenceDispatchReceiptWireV1 {
        request_id: Some(9_007_199_254_740_987),
        persistence_revision: 9_007_199_254_740_986,
        pending: 65_535,
        queued_bytes: 9_007_199_254_740_985,
        state_hash: CanonicalHash([
            0x80, 0x91, 0xa2, 0xb3, 0xc4, 0xd5, 0xe6, 0xf7, 0x08, 0x19, 0x2a, 0x3b, 0x4c, 0x5d, 0x6e, 0x7f,
        ]),
        closed: true,
    };
    let request_bytes = encode_runtime_persistence_dispatch_v1(&request).expect("request fixture encodes");
    let receipt_bytes = encode_runtime_persistence_dispatch_receipt_v1(&receipt).expect("receipt fixture encodes");
    assert_eq!(
        decode_runtime_persistence_dispatch_v1(&request_bytes).expect("request fixture decodes"),
        request,
    );
    assert_eq!(
        decode_runtime_persistence_dispatch_receipt_v1(&receipt_bytes).expect("receipt fixture decodes"),
        receipt,
    );
    let requests = request_vectors()
        .into_iter()
        .map(|(name, value)| {
            let bytes = encode_runtime_persistence_dispatch_v1(&value).expect("request vector encodes");
            assert_eq!(decode_runtime_persistence_dispatch_v1(&bytes).unwrap(), value);
            format!("    {{\"name\":\"{name}\",\"hex\":\"{}\"}}", hex(&bytes))
        })
        .collect::<Vec<_>>()
        .join(",\n");
    let no_request = RuntimePersistenceDispatchReceiptWireV1 {
        request_id: None,
        persistence_revision: 0,
        pending: 0,
        queued_bytes: 0,
        state_hash: CanonicalHash::default(),
        closed: false,
    };
    let no_request_bytes = encode_runtime_persistence_dispatch_receipt_v1(&no_request).unwrap();
    assert_eq!(
        decode_runtime_persistence_dispatch_receipt_v1(&no_request_bytes).unwrap(),
        no_request
    );
    format!(
        concat!(
            "{{\n",
            "  \"schema\": 1,\n",
            "  \"producer\": \"blockwild-engine/r8_persistence_dispatch_wire_fixture\",\n",
            "  \"requestHex\": \"{}\",\n",
            "  \"receiptHex\": \"{}\",\n",
            "  \"schemaFingerprint\": \"{}\",\n",
            "  \"requests\": [\n{}\n  ],\n",
            "  \"noRequestReceiptHex\": \"{}\"\n",
            "}}\n"
        ),
        hex(&request_bytes),
        hex(&receipt_bytes),
        INTEGRATED_RUNTIME_DOMAIN_SCHEMA_FINGERPRINT_V1,
        requests,
        hex(&no_request_bytes),
    )
}

pub fn request_vectors() -> Vec<(&'static str, RuntimePersistenceDispatchWireV1)> {
    use RuntimePersistenceDispatchWireV1::*;
    let world_id = "wørld:水".to_owned();
    let checkpoint_id = "checkpoint:水".to_owned();
    let hash = CanonicalHash([0x81; 16]);
    let maximum = 9_007_199_254_740_991;
    vec![
        (
            "commit",
            Commit {
                browser_request: vec![0, 0x7f, 0x80, 0xff],
            },
        ),
        (
            "recover-latest",
            Recover {
                world_id: world_id.clone(),
                checkpoint_id: None,
            },
        ),
        (
            "recover-checkpoint",
            Recover {
                world_id: world_id.clone(),
                checkpoint_id: Some(checkpoint_id.clone()),
            },
        ),
        (
            "read-recovery-page",
            ReadRecoveryPage {
                world_id: world_id.clone(),
                checkpoint_id: checkpoint_id.clone(),
                start_record: maximum,
                max_records: u32::MAX,
                max_bytes: u32::MAX,
            },
        ),
        (
            "estimate",
            Estimate {
                world_id: world_id.clone(),
            },
        ),
        (
            "compact",
            Compact {
                world_id: world_id.clone(),
                checkpoint_id: checkpoint_id.clone(),
                expected_head_hash: hash,
                retain_parent_count: u16::MAX,
            },
        ),
        (
            "delete-unconditional",
            Delete {
                world_id: world_id.clone(),
                expected_head_hash: None,
                tombstone: hash,
            },
        ),
        (
            "delete-conditional",
            Delete {
                world_id: world_id.clone(),
                expected_head_hash: Some(hash),
                tombstone: hash,
            },
        ),
        (
            "preserve-legacy-backup-chunk",
            PreserveLegacyBackupChunk {
                world_id: world_id.clone(),
                backup_id: "backup:水".into(),
                offset: maximum - 4,
                total_bytes: maximum,
                bytes: vec![0, 0x7f, 0x80, 0xff],
            },
        ),
        (
            "export-page",
            ExportPage {
                world_id: world_id.clone(),
                checkpoint_id,
                cursor: maximum,
                max_bytes: u32::MAX,
            },
        ),
        (
            "import-chunk",
            ImportChunk {
                world_id: world_id.clone(),
                import_id: "import:水".into(),
                offset: maximum - 4,
                total_bytes: maximum,
                bytes: vec![0, 0x7f, 0x80, 0xff],
            },
        ),
        (
            "finalize-import",
            FinalizeImport {
                world_id,
                import_id: "import:水".into(),
                archive_hash: hash,
                total_bytes: maximum,
            },
        ),
        (
            "retry",
            Retry {
                previous_request_id: maximum,
            },
        ),
        ("close", Close),
    ]
}

pub fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(FIXTURE_RELATIVE_PATH)
}

fn main() {
    let rendered = fixture();
    if env::args().any(|argument| argument == "--check") {
        let expected = fs::read_to_string(fixture_path()).expect("checked R8 persistence fixture exists");
        assert_eq!(expected.replace("\r\n", "\n"), rendered);
        println!("r8-persistence-dispatch-wire-fixture=ok");
    } else {
        print!("{rendered}");
    }
}
