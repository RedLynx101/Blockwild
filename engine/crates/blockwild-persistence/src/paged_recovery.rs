//! Paged checkpoint recovery that never requires one 256 MiB BWPA.

use crate::{
    Checkpoint, MAX_RECORDS_PER_CHECKPOINT_V1, PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1,
    PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1, PERSISTENCE_SCHEMA_V1, PersistenceError, RecordAddress,
    RecordDescriptor, RecordKind, payload_hash,
};
use blockwild_types::CanonicalHash;
use std::collections::{BTreeMap, BTreeSet};

/// A complete recovery may span multiple recovery-only pages, but its payload
/// custody remains bounded by the existing 256 MiB persistence snapshot/wire
/// contract. Page envelopes and descriptors are bounded independently.
pub const PAGED_RECOVERY_MAX_AGGREGATE_PAYLOAD_BYTES_V1: usize = PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PagedRecoveryHeadV1 {
    pub checkpoint_id: String,
    pub parent_checkpoint_id: Option<String>,
    pub world_id: String,
    pub journal_sequence: u64,
    pub generator_hash: CanonicalHash,
    pub content_hash: CanonicalHash,
    pub created_at: u64,
    pub record_count: u32,
    pub checkpoint_hash: CanonicalHash,
}

impl PagedRecoveryHeadV1 {
    #[must_use]
    pub fn from_checkpoint(checkpoint: &Checkpoint) -> Self {
        Self {
            checkpoint_id: checkpoint.checkpoint_id.clone(),
            parent_checkpoint_id: checkpoint.parent_checkpoint_id.clone(),
            world_id: checkpoint.world_id.clone(),
            journal_sequence: checkpoint.journal_sequence,
            generator_hash: checkpoint.generator_hash,
            content_hash: checkpoint.content_hash,
            created_at: checkpoint.created_at,
            record_count: checkpoint.records.len() as u32,
            checkpoint_hash: checkpoint.checkpoint_hash,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PagedRecoveryRecordV1 {
    pub descriptor: RecordDescriptor,
    pub payload: Option<Vec<u8>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PagedRecoveryPageV1 {
    pub checkpoint_id: String,
    pub start_record: u32,
    pub records: Vec<PagedRecoveryRecordV1>,
    pub next_record: Option<u32>,
}

pub fn encode_paged_recovery_head_v1(value: &PagedRecoveryHeadV1) -> Result<Vec<u8>, PersistenceError> {
    if value.record_count as usize > MAX_RECORDS_PER_CHECKPOINT_V1 {
        return Err(PersistenceError::new(
            "recovery-page",
            "recovery head record count exceeds its bound",
        ));
    }
    let mut writer = Writer::default();
    writer.raw(b"BWRH");
    writer.u16(PERSISTENCE_SCHEMA_V1);
    writer.string(&value.checkpoint_id)?;
    writer.u8(u8::from(value.parent_checkpoint_id.is_some()));
    if let Some(parent) = &value.parent_checkpoint_id {
        writer.string(parent)?;
    }
    writer.string(&value.world_id)?;
    writer.u64(value.journal_sequence);
    writer.hash(value.generator_hash);
    writer.hash(value.content_hash);
    writer.u64(value.created_at);
    writer.u32(value.record_count);
    writer.hash(value.checkpoint_hash);
    Ok(writer.finish())
}

pub fn decode_paged_recovery_head_v1(bytes: &[u8]) -> Result<PagedRecoveryHeadV1, PersistenceError> {
    let mut reader = Reader::new(bytes);
    if reader.take(4)? != b"BWRH" || reader.u16()? != PERSISTENCE_SCHEMA_V1 {
        return Err(PersistenceError::new(
            "recovery-page",
            "recovery head magic or schema mismatch",
        ));
    }
    let checkpoint_id = reader.string()?;
    let parent_checkpoint_id = if reader.flag()? { Some(reader.string()?) } else { None };
    let value = PagedRecoveryHeadV1 {
        checkpoint_id,
        parent_checkpoint_id,
        world_id: reader.string()?,
        journal_sequence: reader.u64()?,
        generator_hash: reader.hash()?,
        content_hash: reader.hash()?,
        created_at: reader.u64()?,
        record_count: reader.u32()?,
        checkpoint_hash: reader.hash()?,
    };
    reader.finish()?;
    if value.record_count as usize > MAX_RECORDS_PER_CHECKPOINT_V1 {
        return Err(PersistenceError::new(
            "recovery-page",
            "recovery head record count exceeds its bound",
        ));
    }
    Ok(value)
}

pub fn encode_paged_recovery_page_v1(value: &PagedRecoveryPageV1) -> Result<Vec<u8>, PersistenceError> {
    if value.records.len() > crate::PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1 as usize {
        return Err(PersistenceError::new(
            "recovery-page",
            "recovery page record count exceeds its bound",
        ));
    }
    let mut writer = Writer::default();
    writer.raw(b"BWRP");
    writer.u16(PERSISTENCE_SCHEMA_V1);
    writer.string(&value.checkpoint_id)?;
    writer.u32(value.start_record);
    writer.u32(value.records.len() as u32);
    for record in &value.records {
        writer.address(&record.descriptor.address)?;
        writer.u64(record.descriptor.revision);
        writer.u32(record.descriptor.byte_length);
        writer.hash(record.descriptor.payload_hash);
        writer.u8(u8::from(record.payload.is_some()));
        if let Some(payload) = &record.payload {
            if payload.len() != record.descriptor.byte_length as usize
                || payload_hash(payload) != record.descriptor.payload_hash
            {
                return Err(PersistenceError::new(
                    "corrupt",
                    "recovery page payload does not match its descriptor",
                ));
            }
            writer.bytes(payload)?;
        }
    }
    writer.u8(u8::from(value.next_record.is_some()));
    if let Some(next) = value.next_record {
        writer.u32(next);
    }
    let bytes = writer.finish();
    if bytes.len() > PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1 {
        return Err(PersistenceError::new(
            "recovery-page",
            "encoded recovery page exceeds the 64 MiB record plus 64 KiB overhead budget",
        ));
    }
    Ok(bytes)
}

pub fn decode_paged_recovery_page_v1(bytes: &[u8]) -> Result<PagedRecoveryPageV1, PersistenceError> {
    if bytes.len() > PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1 {
        return Err(PersistenceError::new(
            "recovery-page",
            "encoded recovery page exceeds the 64 MiB record plus 64 KiB overhead budget",
        ));
    }
    let mut reader = Reader::new(bytes);
    if reader.take(4)? != b"BWRP" || reader.u16()? != PERSISTENCE_SCHEMA_V1 {
        return Err(PersistenceError::new(
            "recovery-page",
            "recovery page magic or schema mismatch",
        ));
    }
    let checkpoint_id = reader.string()?;
    let start_record = reader.u32()?;
    let count = reader.u32()? as usize;
    if count > crate::PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1 as usize {
        return Err(PersistenceError::new(
            "recovery-page",
            "recovery page record count exceeds its bound",
        ));
    }
    let mut records = Vec::with_capacity(count);
    for _ in 0..count {
        let descriptor = RecordDescriptor {
            address: reader.address()?,
            revision: reader.u64()?,
            byte_length: reader.u32()?,
            payload_hash: reader.hash()?,
        };
        let payload = if reader.flag()? {
            Some(reader.bytes(crate::MAX_RECORD_BYTES_V1)?)
        } else {
            None
        };
        if let Some(payload) = &payload
            && (payload.len() != descriptor.byte_length as usize || payload_hash(payload) != descriptor.payload_hash)
        {
            return Err(PersistenceError::new(
                "corrupt",
                "recovery page payload does not match its descriptor",
            ));
        }
        records.push(PagedRecoveryRecordV1 { descriptor, payload });
    }
    let next_record = if reader.flag()? { Some(reader.u32()?) } else { None };
    reader.finish()?;
    Ok(PagedRecoveryPageV1 {
        checkpoint_id,
        start_record,
        records,
        next_record,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PagedRecoveryCompleteV1 {
    pub checkpoint: Checkpoint,
    pub payloads: BTreeMap<RecordAddress, Vec<u8>>,
    pub missing_record_keys: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PagedRecoveryAssemblerV1 {
    head: PagedRecoveryHeadV1,
    next_record: u32,
    descriptors: Vec<RecordDescriptor>,
    payloads: BTreeMap<RecordAddress, Vec<u8>>,
    payload_bytes: usize,
    missing: BTreeSet<String>,
}

impl PagedRecoveryAssemblerV1 {
    #[must_use]
    pub fn new(head: PagedRecoveryHeadV1) -> Self {
        Self {
            head,
            next_record: 0,
            descriptors: Vec::new(),
            payloads: BTreeMap::new(),
            payload_bytes: 0,
            missing: BTreeSet::new(),
        }
    }

    pub fn accept_page(
        &mut self,
        page: PagedRecoveryPageV1,
    ) -> Result<Option<PagedRecoveryCompleteV1>, PersistenceError> {
        self.accept_page_with_max_payload_bytes(page, PAGED_RECOVERY_MAX_AGGREGATE_PAYLOAD_BYTES_V1)
    }

    fn accept_page_with_max_payload_bytes(
        &mut self,
        page: PagedRecoveryPageV1,
        max_payload_bytes: usize,
    ) -> Result<Option<PagedRecoveryCompleteV1>, PersistenceError> {
        if page.checkpoint_id != self.head.checkpoint_id
            || page.start_record != self.next_record
            || page.records.is_empty()
        {
            return Err(PersistenceError::new(
                "recovery-page-order",
                "recovery page is stale, empty, or reordered",
            ));
        }
        let resulting_record_count = self
            .descriptors
            .len()
            .checked_add(page.records.len())
            .ok_or_else(|| PersistenceError::new("recovery-page", "recovery descriptor count overflow"))?;
        if resulting_record_count > self.head.record_count as usize
            || resulting_record_count > MAX_RECORDS_PER_CHECKPOINT_V1
        {
            return Err(PersistenceError::new(
                "recovery-completeness",
                "recovery page exceeds the declared checkpoint record count",
            ));
        }
        let resulting_cursor = u32::try_from(resulting_record_count)
            .map_err(|_| PersistenceError::new("recovery-page", "recovery descriptor count exceeds u32"))?;
        if page.next_record.is_some_and(|next| next != resulting_cursor)
            || (page.next_record.is_some() && resulting_cursor == self.head.record_count)
            || (page.next_record.is_none() && resulting_cursor != self.head.record_count)
        {
            return Err(PersistenceError::new(
                "recovery-page-order",
                "recovery page next cursor is inconsistent",
            ));
        }
        let existing_addresses = self
            .descriptors
            .iter()
            .map(|descriptor| descriptor.address.clone())
            .collect::<BTreeSet<_>>();
        let mut page_addresses = BTreeSet::new();
        let mut page_payload_bytes = 0_usize;
        for record in &page.records {
            if existing_addresses.contains(&record.descriptor.address)
                || !page_addresses.insert(record.descriptor.address.clone())
            {
                return Err(PersistenceError::new(
                    "duplicate-record",
                    "recovery page repeats a record",
                ));
            }
            if let Some(payload) = &record.payload {
                if payload.len() != record.descriptor.byte_length as usize
                    || payload_hash(payload) != record.descriptor.payload_hash
                {
                    return Err(PersistenceError::new(
                        "corrupt",
                        "recovery page payload does not match its descriptor",
                    ));
                }
                page_payload_bytes = page_payload_bytes.checked_add(payload.len()).ok_or_else(|| {
                    PersistenceError::new("recovery-capacity", "aggregate recovery byte count overflow")
                })?;
            }
        }
        let resulting_payload_bytes = self
            .payload_bytes
            .checked_add(page_payload_bytes)
            .ok_or_else(|| PersistenceError::new("recovery-capacity", "aggregate recovery byte count overflow"))?;
        if resulting_payload_bytes > max_payload_bytes {
            return Err(PersistenceError::new(
                "recovery-capacity",
                "aggregate recovery payload exceeds the 256 MiB persistence snapshot budget",
            ));
        }
        for record in page.records {
            let key = record.descriptor.address.canonical_key();
            if let Some(payload) = record.payload {
                self.payloads.insert(record.descriptor.address.clone(), payload);
            } else {
                self.missing.insert(key);
            }
            self.descriptors.push(record.descriptor);
        }
        self.payload_bytes = resulting_payload_bytes;
        self.next_record = resulting_cursor;
        if page.next_record.is_some() {
            return Ok(None);
        }
        let checkpoint = Checkpoint::new(
            self.head.checkpoint_id.clone(),
            self.head.parent_checkpoint_id.clone(),
            self.head.world_id.clone(),
            self.head.journal_sequence,
            self.head.generator_hash,
            self.head.content_hash,
            self.head.created_at,
            self.descriptors.clone(),
        )?;
        if checkpoint.checkpoint_hash != self.head.checkpoint_hash {
            return Err(PersistenceError::new(
                "corrupt",
                "paged recovery descriptors do not reconstruct the checkpoint hash",
            ));
        }
        Ok(Some(PagedRecoveryCompleteV1 {
            checkpoint,
            payloads: std::mem::take(&mut self.payloads),
            missing_record_keys: self.missing.iter().cloned().collect(),
        }))
    }
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}
impl Writer {
    fn raw(&mut self, v: &[u8]) {
        self.bytes.extend_from_slice(v)
    }
    fn u8(&mut self, v: u8) {
        self.bytes.push(v)
    }
    fn u16(&mut self, v: u16) {
        self.raw(&v.to_le_bytes())
    }
    fn u32(&mut self, v: u32) {
        self.raw(&v.to_le_bytes())
    }
    fn u64(&mut self, v: u64) {
        self.raw(&v.to_le_bytes())
    }
    fn hash(&mut self, v: CanonicalHash) {
        self.raw(v.as_bytes())
    }
    fn bytes(&mut self, v: &[u8]) -> Result<(), PersistenceError> {
        self.u32(
            u32::try_from(v.len()).map_err(|_| PersistenceError::new("recovery-page", "recovery field exceeds u32"))?,
        );
        self.raw(v);
        Ok(())
    }
    fn string(&mut self, v: &str) -> Result<(), PersistenceError> {
        self.bytes(v.as_bytes())
    }
    fn address(&mut self, v: &RecordAddress) -> Result<(), PersistenceError> {
        self.string(&v.universe_id)?;
        self.string(&v.location_id)?;
        self.u8(v.kind as u8);
        self.string(&v.record_id)
    }
    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}
struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], PersistenceError> {
        let e = self
            .offset
            .checked_add(n)
            .ok_or_else(|| PersistenceError::new("recovery-page", "recovery offset overflow"))?;
        let v = self
            .bytes
            .get(self.offset..e)
            .ok_or_else(|| PersistenceError::new("recovery-page", "recovery payload is truncated"))?;
        self.offset = e;
        Ok(v)
    }
    fn u8(&mut self) -> Result<u8, PersistenceError> {
        Ok(self.take(1)?[0])
    }
    fn flag(&mut self) -> Result<bool, PersistenceError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(PersistenceError::new("recovery-page", "recovery flag is invalid")),
        }
    }
    fn u16(&mut self) -> Result<u16, PersistenceError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("fixed slice")))
    }
    fn u32(&mut self) -> Result<u32, PersistenceError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }
    fn u64(&mut self) -> Result<u64, PersistenceError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().expect("fixed slice")))
    }
    fn hash(&mut self) -> Result<CanonicalHash, PersistenceError> {
        Ok(CanonicalHash(self.take(16)?.try_into().expect("fixed slice")))
    }
    fn bytes(&mut self, m: usize) -> Result<Vec<u8>, PersistenceError> {
        let n = self.u32()? as usize;
        if n > m {
            return Err(PersistenceError::new(
                "recovery-page",
                "recovery field exceeds its bound",
            ));
        }
        Ok(self.take(n)?.to_vec())
    }
    fn string(&mut self) -> Result<String, PersistenceError> {
        String::from_utf8(self.bytes(4096)?)
            .map_err(|_| PersistenceError::new("recovery-page", "recovery string is invalid UTF-8"))
    }
    fn address(&mut self) -> Result<RecordAddress, PersistenceError> {
        RecordAddress::new(
            self.string()?,
            self.string()?,
            RecordKind::from_tag(self.u8()?)?,
            self.string()?,
        )
    }
    fn finish(&self) -> Result<(), PersistenceError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(PersistenceError::new(
                "recovery-page",
                "recovery payload contains trailing bytes",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DEFAULT_DISPATCH_MAX_PACKET_BYTES_V1, MAX_RECORD_BYTES_V1, PersistencePlatformOperationV1,
        PersistencePlatformResponseV1, PersistencePlatformResultCodeV1, decode_persistence_platform_response_v1,
        encode_persistence_platform_response_v1,
    };
    #[test]
    fn recovery_pages_reconstruct_exact_checkpoint_without_monolithic_response() {
        let address = RecordAddress::new("u", "surface", RecordKind::Entity, "e").unwrap();
        let payload = vec![1, 2, 3];
        let checkpoint = Checkpoint::new(
            "cp",
            Some("parent".into()),
            "world",
            2,
            CanonicalHash([1; 16]),
            CanonicalHash([2; 16]),
            3,
            vec![RecordDescriptor {
                address,
                revision: 1,
                byte_length: 3,
                payload_hash: payload_hash(&payload),
            }],
        )
        .unwrap();
        let head = PagedRecoveryHeadV1::from_checkpoint(&checkpoint);
        assert_eq!(
            decode_paged_recovery_head_v1(&encode_paged_recovery_head_v1(&head).unwrap()).unwrap(),
            head
        );
        let page = PagedRecoveryPageV1 {
            checkpoint_id: "cp".into(),
            start_record: 0,
            records: vec![PagedRecoveryRecordV1 {
                descriptor: checkpoint.records[0].clone(),
                payload: Some(payload),
            }],
            next_record: None,
        };
        let decoded = decode_paged_recovery_page_v1(&encode_paged_recovery_page_v1(&page).unwrap()).unwrap();
        let complete = PagedRecoveryAssemblerV1::new(head)
            .accept_page(decoded)
            .unwrap()
            .unwrap();
        assert_eq!(complete.checkpoint, checkpoint);
        assert!(complete.missing_record_keys.is_empty());
    }

    #[test]
    fn one_maximum_record_fits_recovery_page_and_complete_bwpa_stays_below_dispatch_packet() {
        let address = RecordAddress::new("u", "surface", RecordKind::ChunkEdits, "native-world-state-v1").unwrap();
        let payload = vec![0x5a; MAX_RECORD_BYTES_V1];
        let page = PagedRecoveryPageV1 {
            checkpoint_id: "checkpoint:max-record".into(),
            start_record: 0,
            records: vec![PagedRecoveryRecordV1 {
                descriptor: RecordDescriptor {
                    address,
                    revision: 1,
                    byte_length: u32::try_from(payload.len()).unwrap(),
                    payload_hash: payload_hash(&payload),
                },
                payload: Some(payload),
            }],
            next_record: None,
        };
        let page_bytes = encode_paged_recovery_page_v1(&page).unwrap();
        assert!(page_bytes.len() > MAX_RECORD_BYTES_V1);
        assert!(page_bytes.len() <= PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1);
        let expected_page_bytes = page_bytes.len();
        let response = encode_persistence_platform_response_v1(&PersistencePlatformResponseV1 {
            request_id: 1,
            operation: PersistencePlatformOperationV1::ReadRecoveryPage,
            code: PersistencePlatformResultCodeV1::Accepted,
            storage_revision: 1,
            durable_hash: CanonicalHash([7; 16]),
            next_cursor: None,
            payload: page_bytes,
            message: "maximum record recovery page".into(),
        })
        .unwrap();
        assert!(response.len() < DEFAULT_DISPATCH_MAX_PACKET_BYTES_V1);
        let decoded = decode_persistence_platform_response_v1(&response).unwrap();
        assert_eq!(decoded.payload.len(), expected_page_bytes);
    }

    #[test]
    fn aggregate_recovery_budget_rejects_atomically_before_accumulating_another_page() {
        let first_payload = vec![1, 2];
        let second_payload = vec![3, 4];
        let checkpoint = Checkpoint::new(
            "bounded-cp",
            None,
            "world",
            1,
            CanonicalHash([1; 16]),
            CanonicalHash([2; 16]),
            3,
            vec![
                RecordDescriptor {
                    address: RecordAddress::new("u", "surface", RecordKind::Entity, "bounded-a").unwrap(),
                    revision: 1,
                    byte_length: first_payload.len() as u32,
                    payload_hash: payload_hash(&first_payload),
                },
                RecordDescriptor {
                    address: RecordAddress::new("u", "surface", RecordKind::Entity, "bounded-b").unwrap(),
                    revision: 1,
                    byte_length: second_payload.len() as u32,
                    payload_hash: payload_hash(&second_payload),
                },
            ],
        )
        .unwrap();
        let mut assembler = PagedRecoveryAssemblerV1::new(PagedRecoveryHeadV1::from_checkpoint(&checkpoint));
        assert!(
            assembler
                .accept_page_with_max_payload_bytes(
                    PagedRecoveryPageV1 {
                        checkpoint_id: checkpoint.checkpoint_id.clone(),
                        start_record: 0,
                        records: vec![PagedRecoveryRecordV1 {
                            descriptor: checkpoint.records[0].clone(),
                            payload: Some(first_payload),
                        }],
                        next_record: Some(1),
                    },
                    3,
                )
                .unwrap()
                .is_none()
        );
        let before = assembler.clone();
        let error = assembler
            .accept_page_with_max_payload_bytes(
                PagedRecoveryPageV1 {
                    checkpoint_id: checkpoint.checkpoint_id,
                    start_record: 1,
                    records: vec![PagedRecoveryRecordV1 {
                        descriptor: checkpoint.records[1].clone(),
                        payload: Some(second_payload),
                    }],
                    next_record: None,
                },
                3,
            )
            .unwrap_err();
        assert_eq!(error.code, "recovery-capacity");
        assert_eq!(
            error.message,
            "aggregate recovery payload exceeds the 256 MiB persistence snapshot budget"
        );
        assert_eq!(
            assembler, before,
            "capacity rejection must not retain partial page custody"
        );
    }
}
