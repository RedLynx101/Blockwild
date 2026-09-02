//! Canonical BWRM V1 envelopes for migration of rich browser world state.
//!
//! This module is deliberately integration-neutral: it validates and encodes a
//! migration plan, but it does not claim that any page has been durably stored
//! or adopted by the native runtime.

use crate::{PersistenceError, payload_hash};
use blockwild_types::{CanonicalHash, CanonicalHasher};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

pub const RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1: u16 = 1;
pub const RICH_SAVE_MIGRATION_MAX_SOURCE_BYTES_V1: usize = 64 * 1024 * 1024;
pub const RICH_SAVE_MIGRATION_MAX_PAGE_BYTES_V1: usize = 4 * 1024 * 1024;
pub const RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1: usize = 256 * 1024 * 1024;
pub const RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1: usize = 4_096;
pub const RICH_SAVE_MIGRATION_MAX_DOMAINS_V1: usize = 256;
pub const RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1: usize = 4_096;
pub const RICH_SAVE_MIGRATION_MAX_TOTAL_PAGES_V1: usize = 16_384;

const ENVELOPE_MAGIC_V1: [u8; 4] = *b"BWRM";
const MAX_ENCODED_ENVELOPE_BYTES_V1: usize = RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1 + 16 * 1024 * 1024;
const JAVASCRIPT_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RichSaveMigrationSourceV1 {
    pub source_key: String,
    pub source_format: String,
    pub save_version: u16,
    pub byte_length: u64,
    pub semantic_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RichSaveMigrationTargetV1 {
    pub universe_id: String,
    pub location_id: String,
    pub generator_hash: CanonicalHash,
    pub content_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RichSaveMigrationPageV1 {
    pub schema_version: u16,
    pub universe_id: String,
    pub location_id: String,
    pub source_semantic_hash: CanonicalHash,
    pub domain_id: String,
    pub codec_version: u16,
    pub page_index: u32,
    pub page_count: u32,
    pub item_start: u64,
    pub item_count: u64,
    pub byte_length: u32,
    pub payload_hash: CanonicalHash,
    pub page_hash: CanonicalHash,
    pub payload: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RichSaveMigrationDomainV1 {
    pub domain_id: String,
    pub codec_version: u16,
    pub properties: Vec<String>,
    pub page_count: u32,
    pub item_count: u64,
    pub byte_length: u64,
    pub pages: Vec<RichSaveMigrationPageV1>,
    pub semantic_root: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RichSaveMigrationEnvelopeV1 {
    pub schema_version: u16,
    pub source: RichSaveMigrationSourceV1,
    pub target: RichSaveMigrationTargetV1,
    pub source_properties: Vec<String>,
    pub domains: Vec<RichSaveMigrationDomainV1>,
    pub total_page_count: u32,
    pub total_page_bytes: u64,
    pub envelope_root: CanonicalHash,
}

/// External identity retained by the migration caller.
///
/// `source_properties` is the caller's independently derived, canonical list
/// of top-level source keys and must accompany `source_payload`. The BWRM wire
/// format intentionally contains no legacy source JSON, so this codec does not
/// parse or take custody of it.
#[derive(Clone, Copy, Debug, Default)]
pub struct RichSaveMigrationEnvelopeExpectationV1<'a> {
    pub envelope_root: Option<CanonicalHash>,
    pub universe_id: Option<&'a str>,
    pub location_id: Option<&'a str>,
    pub generator_hash: Option<CanonicalHash>,
    pub content_hash: Option<CanonicalHash>,
    pub source_key: Option<&'a str>,
    pub source_format: Option<&'a str>,
    pub source_save_version: Option<u16>,
    pub source_payload: Option<&'a [u8]>,
    pub source_properties: Option<&'a [String]>,
}

#[must_use]
pub fn rich_save_migration_payload_hash_v1(payload: &[u8]) -> CanonicalHash {
    payload_hash(payload)
}

#[must_use]
pub fn rich_save_migration_page_hash_v1(page: &RichSaveMigrationPageV1) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-rich-save-migration-page-v1");
    hasher.write_u16(page.schema_version);
    hasher.write_str(&page.universe_id);
    hasher.write_str(&page.location_id);
    write_hash_string(&mut hasher, page.source_semantic_hash);
    hasher.write_str(&page.domain_id);
    hasher.write_u16(page.codec_version);
    hasher.write_u32(page.page_index);
    hasher.write_u32(page.page_count);
    hasher.write_u64(page.item_start);
    hasher.write_u64(page.item_count);
    hasher.write_u32(page.byte_length);
    write_hash_string(&mut hasher, page.payload_hash);
    hasher.finish()
}

#[must_use]
pub fn rich_save_migration_domain_root_v1(domain: &RichSaveMigrationDomainV1) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-rich-save-migration-domain-v1");
    hasher.write_str(&domain.domain_id);
    hasher.write_u16(domain.codec_version);
    hasher.write_u32(domain.properties.len() as u32);
    for property in &domain.properties {
        hasher.write_str(property);
    }
    hasher.write_u32(domain.page_count);
    hasher.write_u64(domain.item_count);
    hasher.write_u64(domain.byte_length);
    for page in &domain.pages {
        write_hash_string(&mut hasher, page.page_hash);
    }
    hasher.finish()
}

#[must_use]
pub fn rich_save_migration_envelope_root_v1(envelope: &RichSaveMigrationEnvelopeV1) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-rich-save-migration-envelope-v1");
    hasher.write_u16(envelope.schema_version);
    hasher.write_str(&envelope.source.source_key);
    hasher.write_str(&envelope.source.source_format);
    hasher.write_u16(envelope.source.save_version);
    hasher.write_u64(envelope.source.byte_length);
    write_hash_string(&mut hasher, envelope.source.semantic_hash);
    hasher.write_str(&envelope.target.universe_id);
    hasher.write_str(&envelope.target.location_id);
    write_hash_string(&mut hasher, envelope.target.generator_hash);
    write_hash_string(&mut hasher, envelope.target.content_hash);
    hasher.write_u32(envelope.source_properties.len() as u32);
    for property in &envelope.source_properties {
        hasher.write_str(property);
    }
    hasher.write_u32(envelope.domains.len() as u32);
    for domain in &envelope.domains {
        hasher.write_str(&domain.domain_id);
        hasher.write_u16(domain.codec_version);
        hasher.write_u32(domain.page_count);
        hasher.write_u64(domain.item_count);
        hasher.write_u64(domain.byte_length);
        write_hash_string(&mut hasher, domain.semantic_root);
    }
    hasher.write_u32(envelope.total_page_count);
    hasher.write_u64(envelope.total_page_bytes);
    hasher.finish()
}

pub fn validate_rich_save_migration_envelope_v1(
    envelope: &RichSaveMigrationEnvelopeV1,
    expected: &RichSaveMigrationEnvelopeExpectationV1<'_>,
) -> Result<(), PersistenceError> {
    if envelope.schema_version != RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1 {
        return Err(error("schema-version", "rich-save envelope schema is unsupported"));
    }
    validate_label(&envelope.source.source_key, 512, "source.sourceKey")?;
    validate_label(&envelope.source.source_format, 128, "source.sourceFormat")?;
    if envelope.source.save_version == 0 {
        return Err(error("integer-range", "source.saveVersion must be in 1..65535"));
    }
    if envelope.source.byte_length == 0 || envelope.source.byte_length > RICH_SAVE_MIGRATION_MAX_SOURCE_BYTES_V1 as u64
    {
        return Err(error("integer-range", "source.byteLength is outside its V1 bounds"));
    }
    validate_label(&envelope.target.universe_id, 64, "target.universeId")?;
    validate_label(&envelope.target.location_id, 128, "target.locationId")?;
    validate_ordered_strings(
        &envelope.source_properties,
        "sourceProperties",
        RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1,
        "duplicate-source-property",
        "source-property-order",
    )?;

    if envelope.domains.is_empty() || envelope.domains.len() > RICH_SAVE_MIGRATION_MAX_DOMAINS_V1 {
        return Err(error("domain-count", "envelope domain count is outside its V1 bounds"));
    }

    let mut domain_ids = HashSet::with_capacity(envelope.domains.len());
    let mut prior_domain: Option<&str> = None;
    let mut observed_page_count = 0_u32;
    let mut observed_page_bytes = 0_u64;
    for domain in &envelope.domains {
        validate_domain_id(&domain.domain_id, "domain.domainId")?;
        if !domain_ids.insert(domain.domain_id.as_str()) {
            return Err(error(
                "duplicate-domain",
                format!("duplicate domain {}", domain.domain_id),
            ));
        }
        if prior_domain.is_some_and(|prior| compare_ordinal(prior, &domain.domain_id) != Ordering::Less) {
            return Err(error("domain-order", "domains must be strictly ordinal-sorted"));
        }
        prior_domain = Some(&domain.domain_id);
        if domain.codec_version == 0 {
            return Err(error("integer-range", "domain codecVersion must be in 1..65535"));
        }
        validate_ordered_strings(
            &domain.properties,
            "domain.properties",
            RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1,
            "duplicate-property",
            "property-order",
        )?;
        if domain.page_count == 0 || domain.page_count as usize > RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1 {
            return Err(error("integer-range", "domain pageCount is outside its V1 bounds"));
        }
        if domain.item_count > JAVASCRIPT_MAX_SAFE_INTEGER {
            return Err(error(
                "integer-range",
                "domain itemCount exceeds JavaScript's exact integer range",
            ));
        }
        if domain.byte_length > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1 as u64 {
            return Err(error("integer-range", "domain byteLength is outside its V1 bounds"));
        }
        if domain.pages.len() != domain.page_count as usize {
            return Err(error(
                "omitted-page",
                format!("domain {} page count is incomplete", domain.domain_id),
            ));
        }

        let mut expected_item_start = 0_u64;
        let mut domain_page_bytes = 0_u64;
        let mut page_indices = HashSet::with_capacity(domain.pages.len());
        for (page_position, page) in domain.pages.iter().enumerate() {
            if page.schema_version != RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1 {
                return Err(error("page-schema", "migration page schema is unsupported"));
            }
            if page.page_index as usize >= RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1 {
                return Err(error("integer-range", "migration page index is outside its V1 bounds"));
            }
            if !page_indices.insert(page.page_index) {
                return Err(error(
                    "duplicate-page",
                    format!("domain {} repeats a page", domain.domain_id),
                ));
            }
            if page.page_index as usize != page_position {
                return Err(error(
                    "page-order",
                    "migration pages must be contiguous and index ordered",
                ));
            }
            if page.page_count != domain.page_count {
                return Err(error("page-count", "migration page has the wrong page count"));
            }
            if page.universe_id != envelope.target.universe_id || page.location_id != envelope.target.location_id {
                return Err(error("page-address", "migration page belongs to another world"));
            }
            if page.source_semantic_hash != envelope.source.semantic_hash {
                return Err(error("page-source", "migration page belongs to another source"));
            }
            if page.domain_id != domain.domain_id || page.codec_version != domain.codec_version {
                return Err(error("page-domain", "migration page has the wrong codec identity"));
            }
            if page.item_start > JAVASCRIPT_MAX_SAFE_INTEGER || page.item_count > JAVASCRIPT_MAX_SAFE_INTEGER {
                return Err(error(
                    "integer-range",
                    "migration page item range exceeds JavaScript's exact range",
                ));
            }
            if page.item_start != expected_item_start || page.item_count > JAVASCRIPT_MAX_SAFE_INTEGER - page.item_start
            {
                return Err(error("item-range", "migration page has a non-contiguous item range"));
            }
            expected_item_start += page.item_count;
            if page.byte_length as usize > RICH_SAVE_MIGRATION_MAX_PAGE_BYTES_V1 {
                return Err(error(
                    "integer-range",
                    "migration page byteLength is outside its V1 bounds",
                ));
            }
            if page.payload.len() != page.byte_length as usize {
                return Err(error(
                    "page-length",
                    "migration page payload length does not match its descriptor",
                ));
            }
            if payload_hash(&page.payload) != page.payload_hash {
                return Err(error("page-payload-hash", "migration page payload hash mismatch"));
            }
            if rich_save_migration_page_hash_v1(page) != page.page_hash {
                return Err(error("page-hash", "migration page descriptor hash mismatch"));
            }
            domain_page_bytes = domain_page_bytes
                .checked_add(u64::from(page.byte_length))
                .ok_or_else(|| error("page-size", "migration page byte total overflow"))?;
        }
        if expected_item_start != domain.item_count {
            return Err(error("domain-item-count", "domain item total does not match its pages"));
        }
        if domain_page_bytes != domain.byte_length {
            return Err(error(
                "domain-byte-length",
                "domain byte total does not match its pages",
            ));
        }
        if rich_save_migration_domain_root_v1(domain) != domain.semantic_root {
            return Err(error("domain-root", "migration domain semantic root mismatch"));
        }
        observed_page_count = observed_page_count
            .checked_add(domain.page_count)
            .ok_or_else(|| error("page-count", "envelope page count overflow"))?;
        observed_page_bytes = observed_page_bytes
            .checked_add(domain.byte_length)
            .ok_or_else(|| error("page-size", "envelope page byte total overflow"))?;
        if observed_page_count as usize > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGES_V1 {
            return Err(error("page-count", "envelope exceeds its total page count budget"));
        }
        if observed_page_bytes > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1 as u64 {
            return Err(error("page-size", "envelope exceeds its total page byte budget"));
        }
    }

    validate_property_accounting(&envelope.source_properties, &envelope.domains)?;
    if envelope.total_page_count == 0
        || envelope.total_page_count as usize > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGES_V1
        || envelope.total_page_count != observed_page_count
    {
        return Err(error(
            "page-count",
            "envelope total page count does not match its domains",
        ));
    }
    if envelope.total_page_bytes > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1 as u64
        || envelope.total_page_bytes != observed_page_bytes
    {
        return Err(error("page-size", "envelope total page bytes do not match its domains"));
    }
    if rich_save_migration_envelope_root_v1(envelope) != envelope.envelope_root {
        return Err(error("envelope-root", "envelope canonical root mismatch"));
    }
    validate_expectation(envelope, expected)
}

pub fn encode_rich_save_migration_envelope_v1(
    envelope: &RichSaveMigrationEnvelopeV1,
) -> Result<Vec<u8>, PersistenceError> {
    validate_rich_save_migration_envelope_v1(envelope, &RichSaveMigrationEnvelopeExpectationV1::default())?;
    let mut writer = Writer::default();
    writer.raw(&ENVELOPE_MAGIC_V1)?;
    writer.u16(envelope.schema_version)?;
    writer.string(&envelope.source.source_key)?;
    writer.string(&envelope.source.source_format)?;
    writer.u16(envelope.source.save_version)?;
    writer.u64(envelope.source.byte_length)?;
    writer.hash(envelope.source.semantic_hash)?;
    writer.string(&envelope.target.universe_id)?;
    writer.string(&envelope.target.location_id)?;
    writer.hash(envelope.target.generator_hash)?;
    writer.hash(envelope.target.content_hash)?;
    writer.u32(envelope.source_properties.len() as u32)?;
    for property in &envelope.source_properties {
        writer.string(property)?;
    }
    writer.u32(envelope.domains.len() as u32)?;
    for domain in &envelope.domains {
        writer.string(&domain.domain_id)?;
        writer.u16(domain.codec_version)?;
        writer.u32(domain.properties.len() as u32)?;
        for property in &domain.properties {
            writer.string(property)?;
        }
        writer.u32(domain.page_count)?;
        writer.u64(domain.item_count)?;
        writer.u64(domain.byte_length)?;
        writer.hash(domain.semantic_root)?;
        for page in &domain.pages {
            writer.u16(page.schema_version)?;
            writer.string(&page.universe_id)?;
            writer.string(&page.location_id)?;
            writer.hash(page.source_semantic_hash)?;
            writer.string(&page.domain_id)?;
            writer.u16(page.codec_version)?;
            writer.u32(page.page_index)?;
            writer.u32(page.page_count)?;
            writer.u64(page.item_start)?;
            writer.u64(page.item_count)?;
            writer.u32(page.byte_length)?;
            writer.hash(page.payload_hash)?;
            writer.hash(page.page_hash)?;
            writer.bytes(&page.payload)?;
        }
    }
    writer.u32(envelope.total_page_count)?;
    writer.u64(envelope.total_page_bytes)?;
    writer.hash(envelope.envelope_root)?;
    Ok(writer.finish())
}

pub fn decode_rich_save_migration_envelope_v1(bytes: &[u8]) -> Result<RichSaveMigrationEnvelopeV1, PersistenceError> {
    decode_rich_save_migration_envelope_v1_with_expectation(bytes, &RichSaveMigrationEnvelopeExpectationV1::default())
}

pub fn decode_rich_save_migration_envelope_v1_with_expectation(
    bytes: &[u8],
    expected: &RichSaveMigrationEnvelopeExpectationV1<'_>,
) -> Result<RichSaveMigrationEnvelopeV1, PersistenceError> {
    if bytes.len() < 6 || bytes.len() > MAX_ENCODED_ENVELOPE_BYTES_V1 {
        return Err(error(
            "envelope-size",
            "encoded rich-save envelope is truncated or exceeds its byte budget",
        ));
    }
    let mut reader = Reader::new(bytes);
    if reader.take(ENVELOPE_MAGIC_V1.len())? != ENVELOPE_MAGIC_V1 {
        return Err(error("magic", "rich-save envelope magic does not match"));
    }
    let schema_version = reader.u16()?;
    if schema_version != RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1 {
        return Err(error("schema-version", "rich-save envelope schema is unsupported"));
    }
    let source = RichSaveMigrationSourceV1 {
        source_key: reader.string("source.sourceKey", 512, false)?,
        source_format: reader.string("source.sourceFormat", 128, false)?,
        save_version: reader.u16()?,
        byte_length: reader.u64("source.byteLength")?,
        semantic_hash: reader.hash()?,
    };
    let target = RichSaveMigrationTargetV1 {
        universe_id: reader.string("target.universeId", 64, false)?,
        location_id: reader.string("target.locationId", 128, false)?,
        generator_hash: reader.hash()?,
        content_hash: reader.hash()?,
    };
    let source_property_count = reader.u32()? as usize;
    if source_property_count == 0 || source_property_count > RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1 {
        return Err(error(
            "source-properties",
            "encoded source property count is outside its bound",
        ));
    }
    let mut source_properties = Vec::with_capacity(source_property_count);
    for _ in 0..source_property_count {
        source_properties.push(reader.string("sourceProperties", 256, false)?);
    }
    let domain_count = reader.u32()? as usize;
    if domain_count == 0 || domain_count > RICH_SAVE_MIGRATION_MAX_DOMAINS_V1 {
        return Err(error("domain-count", "encoded domain count is outside its bound"));
    }
    let mut observed_pages = 0_usize;
    let mut observed_bytes = 0_u64;
    let mut domains = Vec::with_capacity(domain_count);
    for _ in 0..domain_count {
        let domain_id = reader.string("domain.domainId", 128, true)?;
        let codec_version = reader.u16()?;
        let property_count = reader.u32()? as usize;
        if property_count == 0 || property_count > RICH_SAVE_MIGRATION_MAX_SOURCE_PROPERTIES_V1 {
            return Err(error(
                "collection-size",
                "encoded domain property count is outside its bound",
            ));
        }
        let mut properties = Vec::with_capacity(property_count);
        for _ in 0..property_count {
            properties.push(reader.string("domain.properties", 256, false)?);
        }
        let page_count = reader.u32()?;
        if page_count == 0
            || page_count as usize > RICH_SAVE_MIGRATION_MAX_PAGES_PER_DOMAIN_V1
            || observed_pages > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGES_V1 - page_count as usize
        {
            return Err(error("page-count", "encoded domain page count is outside its bound"));
        }
        observed_pages += page_count as usize;
        let item_count = reader.u64("domain.itemCount")?;
        let byte_length = reader.u64("domain.byteLength")?;
        if byte_length > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1 as u64
            || observed_bytes > RICH_SAVE_MIGRATION_MAX_TOTAL_PAGE_BYTES_V1 as u64 - byte_length
        {
            return Err(error("page-size", "encoded domain byte length is outside its bound"));
        }
        observed_bytes += byte_length;
        let semantic_root = reader.hash()?;
        let mut pages = Vec::with_capacity(page_count as usize);
        for _ in 0..page_count {
            pages.push(RichSaveMigrationPageV1 {
                schema_version: reader.u16()?,
                universe_id: reader.string("page.universeId", 64, false)?,
                location_id: reader.string("page.locationId", 128, false)?,
                source_semantic_hash: reader.hash()?,
                domain_id: reader.string("page.domainId", 128, true)?,
                codec_version: reader.u16()?,
                page_index: reader.u32()?,
                page_count: reader.u32()?,
                item_start: reader.u64("page.itemStart")?,
                item_count: reader.u64("page.itemCount")?,
                byte_length: reader.u32()?,
                payload_hash: reader.hash()?,
                page_hash: reader.hash()?,
                payload: reader.bytes(RICH_SAVE_MIGRATION_MAX_PAGE_BYTES_V1)?,
            });
        }
        domains.push(RichSaveMigrationDomainV1 {
            domain_id,
            codec_version,
            properties,
            page_count,
            item_count,
            byte_length,
            pages,
            semantic_root,
        });
    }
    let envelope = RichSaveMigrationEnvelopeV1 {
        schema_version,
        source,
        target,
        source_properties,
        domains,
        total_page_count: reader.u32()?,
        total_page_bytes: reader.u64("envelope.totalPageBytes")?,
        envelope_root: reader.hash()?,
    };
    reader.finish()?;
    validate_rich_save_migration_envelope_v1(&envelope, expected)?;
    Ok(envelope)
}

fn validate_expectation(
    envelope: &RichSaveMigrationEnvelopeV1,
    expected: &RichSaveMigrationEnvelopeExpectationV1<'_>,
) -> Result<(), PersistenceError> {
    if expected
        .envelope_root
        .is_some_and(|root| root != envelope.envelope_root)
    {
        return Err(error(
            "expected-root",
            "envelope root does not match the expected migration root",
        ));
    }
    let identities = [
        (expected.universe_id, envelope.target.universe_id.as_str()),
        (expected.location_id, envelope.target.location_id.as_str()),
        (expected.source_key, envelope.source.source_key.as_str()),
        (expected.source_format, envelope.source.source_format.as_str()),
    ];
    if identities
        .into_iter()
        .any(|(wanted, actual)| wanted.is_some_and(|value| value != actual))
        || expected
            .generator_hash
            .is_some_and(|value| value != envelope.target.generator_hash)
        || expected
            .content_hash
            .is_some_and(|value| value != envelope.target.content_hash)
    {
        return Err(error(
            "expected-identity",
            "envelope identity does not match the expected identity",
        ));
    }
    if let Some(save_version) = expected.source_save_version {
        if save_version == 0 {
            return Err(error(
                "integer-range",
                "expected source save version must be in 1..65535",
            ));
        }
        if save_version != envelope.source.save_version {
            return Err(error(
                "expected-identity",
                "envelope source save version does not match",
            ));
        }
    }
    if expected.source_payload.is_some() && expected.source_properties.is_none() {
        return Err(error(
            "expected-source",
            "expected source bytes require an independently derived property oracle",
        ));
    }
    if let Some(source_payload) = expected.source_payload {
        if source_payload.is_empty() || source_payload.len() > RICH_SAVE_MIGRATION_MAX_SOURCE_BYTES_V1 {
            return Err(error("source-size", "canonical source is outside its V1 byte bounds"));
        }
        if source_payload.len() as u64 != envelope.source.byte_length
            || payload_hash(source_payload) != envelope.source.semantic_hash
        {
            return Err(error(
                "expected-source",
                "envelope source provenance does not match expected bytes",
            ));
        }
    }
    if let Some(source_properties) = expected.source_properties
        && source_properties != envelope.source_properties
    {
        return Err(error(
            "expected-source",
            "envelope property accounting does not match expected source properties",
        ));
    }
    Ok(())
}

fn validate_property_accounting(
    source_properties: &[String],
    domains: &[RichSaveMigrationDomainV1],
) -> Result<(), PersistenceError> {
    let source: HashSet<&str> = source_properties.iter().map(String::as_str).collect();
    let mut owners: HashMap<&str, &str> = HashMap::with_capacity(source.len());
    for domain in domains {
        for property in &domain.properties {
            if !source.contains(property.as_str()) {
                return Err(error(
                    "unknown-property",
                    format!("domain {} owns non-source property {property}", domain.domain_id),
                ));
            }
            if let Some(owner) = owners.insert(property, &domain.domain_id) {
                return Err(error(
                    "multiply-owned-property",
                    format!(
                        "source property {property} is owned by both {owner} and {}",
                        domain.domain_id
                    ),
                ));
            }
        }
    }
    for property in source_properties {
        if !owners.contains_key(property.as_str()) {
            return Err(error(
                "missing-property",
                format!("source property {property} has no owner"),
            ));
        }
    }
    Ok(())
}

fn validate_ordered_strings(
    values: &[String],
    label: &str,
    maximum_count: usize,
    duplicate_code: &'static str,
    order_code: &'static str,
) -> Result<(), PersistenceError> {
    if values.is_empty() || values.len() > maximum_count {
        return Err(error(
            "collection-size",
            format!("{label} count is outside its V1 bounds"),
        ));
    }
    let mut prior: Option<&str> = None;
    for value in values {
        validate_label(value, 256, label)?;
        if let Some(previous) = prior {
            if previous == value {
                return Err(error(duplicate_code, format!("{label} contains a duplicate")));
            }
            if compare_ordinal(previous, value) != Ordering::Less {
                return Err(error(order_code, format!("{label} must be strictly ordinal-sorted")));
            }
        }
        prior = Some(value);
    }
    Ok(())
}

fn validate_label(value: &str, maximum_bytes: usize, label: &str) -> Result<(), PersistenceError> {
    if value.is_empty() || value.len() > maximum_bytes {
        return Err(error(
            "label",
            format!("{label} is empty or exceeds its UTF-8 byte bound"),
        ));
    }
    if value
        .chars()
        .any(|character| character <= '\u{1f}' || character == '\u{7f}')
    {
        return Err(error("label", format!("{label} contains a control character")));
    }
    Ok(())
}

fn validate_domain_id(value: &str, label: &str) -> Result<(), PersistenceError> {
    validate_label(value, 128, label)?;
    let mut bytes = value.bytes();
    let first = bytes.next().expect("non-empty label was validated");
    let canonical = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    if !canonical(first) || !bytes.all(|byte| canonical(byte) || matches!(byte, b'.' | b'_' | b'-')) {
        return Err(error("label", format!("{label} has a non-canonical form")));
    }
    Ok(())
}

fn compare_ordinal(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn write_hash_string(hasher: &mut CanonicalHasher, value: CanonicalHash) {
    hasher.write_str(&value.to_hex());
}

fn error(code: &'static str, message: impl Into<String>) -> PersistenceError {
    PersistenceError::new(code, message)
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn raw(&mut self, bytes: &[u8]) -> Result<(), PersistenceError> {
        let length = self
            .bytes
            .len()
            .checked_add(bytes.len())
            .ok_or_else(|| error("envelope-size", "encoded rich-save envelope length overflow"))?;
        if length > MAX_ENCODED_ENVELOPE_BYTES_V1 {
            return Err(error(
                "envelope-size",
                "encoded rich-save envelope exceeds its byte budget",
            ));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }

    fn u16(&mut self, value: u16) -> Result<(), PersistenceError> {
        self.raw(&value.to_le_bytes())
    }

    fn u32(&mut self, value: u32) -> Result<(), PersistenceError> {
        self.raw(&value.to_le_bytes())
    }

    fn u64(&mut self, value: u64) -> Result<(), PersistenceError> {
        self.raw(&value.to_le_bytes())
    }

    fn string(&mut self, value: &str) -> Result<(), PersistenceError> {
        let length =
            u16::try_from(value.len()).map_err(|_| error("envelope-size", "rich-save envelope string exceeds u16"))?;
        self.u16(length)?;
        self.raw(value.as_bytes())
    }

    fn hash(&mut self, value: CanonicalHash) -> Result<(), PersistenceError> {
        self.raw(value.as_bytes())
    }

    fn bytes(&mut self, value: &[u8]) -> Result<(), PersistenceError> {
        let length = u32::try_from(value.len()).map_err(|_| error("envelope-size", "rich-save page exceeds u32"))?;
        self.u32(length)?;
        self.raw(value)
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

    fn take(&mut self, length: usize) -> Result<&'a [u8], PersistenceError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| error("truncated", "rich-save envelope offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| error("truncated", "rich-save envelope is truncated"))?;
        self.offset = end;
        Ok(value)
    }

    fn u16(&mut self) -> Result<u16, PersistenceError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("fixed slice")))
    }

    fn u32(&mut self) -> Result<u32, PersistenceError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }

    fn u64(&mut self, label: &str) -> Result<u64, PersistenceError> {
        let value = u64::from_le_bytes(self.take(8)?.try_into().expect("fixed slice"));
        if value > JAVASCRIPT_MAX_SAFE_INTEGER {
            return Err(error(
                "integer-range",
                format!("{label} exceeds JavaScript's exact integer range"),
            ));
        }
        Ok(value)
    }

    fn string(&mut self, label: &str, maximum_bytes: usize, domain_id: bool) -> Result<String, PersistenceError> {
        let length = self.u16()? as usize;
        if length > maximum_bytes {
            return Err(error("label", format!("{label} exceeds its UTF-8 byte bound")));
        }
        let value = std::str::from_utf8(self.take(length)?)
            .map_err(|_| error("utf8", format!("{label} is not valid canonical UTF-8")))?
            .to_owned();
        if domain_id {
            validate_domain_id(&value, label)?;
        } else {
            validate_label(&value, maximum_bytes, label)?;
        }
        Ok(value)
    }

    fn hash(&mut self) -> Result<CanonicalHash, PersistenceError> {
        Ok(CanonicalHash(self.take(16)?.try_into().expect("fixed slice")))
    }

    fn bytes(&mut self, maximum: usize) -> Result<Vec<u8>, PersistenceError> {
        let length = self.u32()? as usize;
        if length > maximum {
            return Err(error("page-size", "encoded page exceeds its byte budget"));
        }
        Ok(self.take(length)?.to_vec())
    }

    fn finish(&self) -> Result<(), PersistenceError> {
        if self.offset != self.bytes.len() {
            return Err(error("trailing-bytes", "rich-save envelope contains trailing bytes"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE_HEX: &str = concat!(
        "7b22626c6f636b466163696e6773223a7b22302c2d36342c30223a317d2c226564697473223a7b22302c30223a5b5b302c33315d5d7d2c",
        "2267656e657261746f7256657273696f6e223a31382c226c69717569644c6576656c73223a5b5b22302c2d36342c30222c7b2266616c6c",
        "696e67223a66616c73652c226b696e64223a227761746572222c226c6576656c223a302c22736f75726365223a747275657d5d5d2c2273",
        "656564223a22726963682d736176652d66697874757265222c2276657273696f6e223a327d",
    );
    const TYPESCRIPT_ENCODED_HEX: &str = concat!(
        "4257524d01002900626c6f636b77696c642d776f726c642d646174612d76313a726963682d736176652d666978747572652100626c6f636b77696c642d776f726c642d736176652d63616e6f6e6963616c2d76310200ca000000000000005929d861d97bd46cd0b31836b47625211700776f726c643a726963682d736176652d6669787475726509006f766572776f726c640123456789abcdef0123456789abcdeffedcba9876543210fedcba9876543210060000000c00626c6f636b466163696e677305006564697473100067656e657261746f7256657273696f6e0c006c69717569644c6576656c73040073656564070076657273696f6e0300000007006c6971756964730100010000000c006c69717569644c6576656c73010000000100000000000000040000000000000032944dee4ba8a02b90a1a9ff717a647701001700776f726c643a726963682d736176652d6669787475726509006f766572776f726c645929d861d97bd46cd0b31836b476252107006c697175696473010000000000010000000000000000000000010000000000000004000000c7b7ea12837ee68ef02e3322838f372f2b16c145702d104560e9e340f454d1ea04000000770080ff",
        "08006d65746164617461010003000000100067656e657261746f7256657273696f6e040073656564070076657273696f6e0100000003000000000000000100000000000000bc3149c2c6654e40406df79ad6a127b801001700776f726c643a726963682d736176652d6669787475726509006f766572776f726c645929d861d97bd46cd0b31836b476252108006d657461646174610100000000000100000000000000000000000300000000000000010000000f2df581d1f5ea4b503b576e2f966072df005d92f2bfe4c6a0da4245d7f5c56d01000000010500776f726c640400020000000c00626c6f636b466163696e67730500656469747302000000030000000000000005000000000000004bb1cc61ffcf5c35d07ff4418f1c533601001700776f726c643a726963682d736176652d6669787475726509006f766572776f726c645929d861d97bd46cd0b31836b47625210500776f726c64040000000000020000000000000000000000020000000000000003000000f1b71780a4b35c71a07b06236ce496ecc76b42f26d144b0eb03fa1591a57028c0300000010111201001700776f726c643a726963682d736176652d6669787475726509006f766572776f726c645929d861d97bd46cd0b31836b47625210500776f726c640400010000000200000002000000000000000100000000000000020000003c41e55d0a5ec53f10c1441e039291cbaac7d9327bff13f9a02506b266f6dbc5020000002021040000000a000000000000002b8ba716658e2110c83a5732cadf32f6",
    );

    fn decode_hex(value: &str) -> Vec<u8> {
        assert_eq!(value.len() % 2, 0);
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let text = std::str::from_utf8(pair).unwrap();
                u8::from_str_radix(text, 16).unwrap()
            })
            .collect()
    }

    fn hash(value: &str) -> CanonicalHash {
        CanonicalHash(decode_hex(value).try_into().unwrap())
    }

    fn page(
        source_hash: CanonicalHash,
        domain_id: &str,
        codec_version: u16,
        page_index: u32,
        page_count: u32,
        item_range: (u64, u64),
        payload: &[u8],
    ) -> RichSaveMigrationPageV1 {
        let mut page = RichSaveMigrationPageV1 {
            schema_version: RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1,
            universe_id: "world:rich-save-fixture".into(),
            location_id: "overworld".into(),
            source_semantic_hash: source_hash,
            domain_id: domain_id.into(),
            codec_version,
            page_index,
            page_count,
            item_start: item_range.0,
            item_count: item_range.1,
            byte_length: payload.len() as u32,
            payload_hash: payload_hash(payload),
            page_hash: CanonicalHash::default(),
            payload: payload.to_vec(),
        };
        page.page_hash = rich_save_migration_page_hash_v1(&page);
        page
    }

    fn domain(
        domain_id: &str,
        codec_version: u16,
        properties: &[&str],
        pages: Vec<RichSaveMigrationPageV1>,
    ) -> RichSaveMigrationDomainV1 {
        let mut domain = RichSaveMigrationDomainV1 {
            domain_id: domain_id.into(),
            codec_version,
            properties: properties.iter().map(|value| (*value).into()).collect(),
            page_count: pages.len() as u32,
            item_count: pages.iter().map(|page| page.item_count).sum(),
            byte_length: pages.iter().map(|page| u64::from(page.byte_length)).sum(),
            pages,
            semantic_root: CanonicalHash::default(),
        };
        domain.semantic_root = rich_save_migration_domain_root_v1(&domain);
        domain
    }

    fn fixture() -> RichSaveMigrationEnvelopeV1 {
        let source_payload = decode_hex(SOURCE_HEX);
        let source_hash = payload_hash(&source_payload);
        let liquids = domain(
            "liquids",
            1,
            &["liquidLevels"],
            vec![page(source_hash, "liquids", 1, 0, 1, (0, 1), &[0x77, 0x00, 0x80, 0xff])],
        );
        let metadata = domain(
            "metadata",
            1,
            &["generatorVersion", "seed", "version"],
            vec![page(source_hash, "metadata", 1, 0, 1, (0, 3), &[0x01])],
        );
        let world = domain(
            "world",
            4,
            &["blockFacings", "edits"],
            vec![
                page(source_hash, "world", 4, 0, 2, (0, 2), &[0x10, 0x11, 0x12]),
                page(source_hash, "world", 4, 1, 2, (2, 1), &[0x20, 0x21]),
            ],
        );
        let mut envelope = RichSaveMigrationEnvelopeV1 {
            schema_version: RICH_SAVE_MIGRATION_ENVELOPE_SCHEMA_V1,
            source: RichSaveMigrationSourceV1 {
                source_key: "blockwild-world-data-v1:rich-save-fixture".into(),
                source_format: "blockwild-world-save-canonical-v1".into(),
                save_version: 2,
                byte_length: source_payload.len() as u64,
                semantic_hash: source_hash,
            },
            target: RichSaveMigrationTargetV1 {
                universe_id: "world:rich-save-fixture".into(),
                location_id: "overworld".into(),
                generator_hash: hash("0123456789abcdef0123456789abcdef"),
                content_hash: hash("fedcba9876543210fedcba9876543210"),
            },
            source_properties: [
                "blockFacings",
                "edits",
                "generatorVersion",
                "liquidLevels",
                "seed",
                "version",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            domains: vec![liquids, metadata, world],
            total_page_count: 4,
            total_page_bytes: 10,
            envelope_root: CanonicalHash::default(),
        };
        envelope.envelope_root = rich_save_migration_envelope_root_v1(&envelope);
        envelope
    }

    fn assert_code(result: Result<(), PersistenceError>, code: &str) {
        assert_eq!(result.unwrap_err().code, code);
    }

    #[test]
    fn typescript_fixture_is_byte_exact_and_roots_are_frozen() {
        let source_payload = decode_hex(SOURCE_HEX);
        let expected_fixture = fixture();
        assert_eq!(
            expected_fixture.source.semantic_hash.to_hex(),
            "5929d861d97bd46cd0b31836b4762521"
        );
        assert_eq!(
            expected_fixture.envelope_root.to_hex(),
            "2b8ba716658e2110c83a5732cadf32f6"
        );
        assert_eq!(
            expected_fixture.domains[0].semantic_root.to_hex(),
            "32944dee4ba8a02b90a1a9ff717a6477"
        );
        assert_eq!(
            expected_fixture.domains[1].semantic_root.to_hex(),
            "bc3149c2c6654e40406df79ad6a127b8"
        );
        assert_eq!(
            expected_fixture.domains[2].semantic_root.to_hex(),
            "4bb1cc61ffcf5c35d07ff4418f1c5336"
        );

        let encoded = decode_hex(TYPESCRIPT_ENCODED_HEX);
        let expectation = RichSaveMigrationEnvelopeExpectationV1 {
            envelope_root: Some(expected_fixture.envelope_root),
            universe_id: Some("world:rich-save-fixture"),
            location_id: Some("overworld"),
            generator_hash: Some(expected_fixture.target.generator_hash),
            content_hash: Some(expected_fixture.target.content_hash),
            source_key: Some("blockwild-world-data-v1:rich-save-fixture"),
            source_format: Some("blockwild-world-save-canonical-v1"),
            source_save_version: Some(2),
            source_payload: Some(&source_payload),
            source_properties: Some(&expected_fixture.source_properties),
        };
        let decoded = decode_rich_save_migration_envelope_v1_with_expectation(&encoded, &expectation).unwrap();
        assert_eq!(decoded, expected_fixture);
        assert_eq!(encode_rich_save_migration_envelope_v1(&decoded).unwrap(), encoded);
    }

    #[test]
    fn property_accounting_fails_closed() {
        let mut missing = fixture();
        missing.domains.remove(0);
        assert_code(
            validate_rich_save_migration_envelope_v1(&missing, &Default::default()),
            "missing-property",
        );

        let mut duplicate = fixture();
        duplicate.domains[2].properties.insert(1, "blockFacings".into());
        assert_code(
            validate_rich_save_migration_envelope_v1(&duplicate, &Default::default()),
            "duplicate-property",
        );

        let mut multiply_owned = fixture();
        multiply_owned.domains[1].properties.insert(0, "edits".into());
        multiply_owned.domains[1].semantic_root = rich_save_migration_domain_root_v1(&multiply_owned.domains[1]);
        assert_code(
            validate_rich_save_migration_envelope_v1(&multiply_owned, &Default::default()),
            "multiply-owned-property",
        );

        let mut unknown = fixture();
        unknown.domains[0].properties[0] = "futureState".into();
        unknown.domains[0].semantic_root = rich_save_migration_domain_root_v1(&unknown.domains[0]);
        assert_code(
            validate_rich_save_migration_envelope_v1(&unknown, &Default::default()),
            "unknown-property",
        );

        let mut duplicate_source = fixture();
        duplicate_source.source_properties.insert(1, "blockFacings".into());
        assert_code(
            validate_rich_save_migration_envelope_v1(&duplicate_source, &Default::default()),
            "duplicate-source-property",
        );
    }

    #[test]
    fn descriptor_order_and_page_completeness_fail_closed() {
        let mut reordered_domains = fixture();
        reordered_domains.domains.reverse();
        assert_code(
            validate_rich_save_migration_envelope_v1(&reordered_domains, &Default::default()),
            "domain-order",
        );

        let mut reordered_pages = fixture();
        reordered_pages.domains[2].pages.reverse();
        assert_code(
            validate_rich_save_migration_envelope_v1(&reordered_pages, &Default::default()),
            "page-order",
        );

        let mut duplicate_page = fixture();
        duplicate_page.domains[2].pages[1] = duplicate_page.domains[2].pages[0].clone();
        assert_code(
            validate_rich_save_migration_envelope_v1(&duplicate_page, &Default::default()),
            "duplicate-page",
        );

        let mut omitted_page = fixture();
        omitted_page.domains[2].pages.pop();
        assert_code(
            validate_rich_save_migration_envelope_v1(&omitted_page, &Default::default()),
            "omitted-page",
        );
    }

    #[test]
    fn address_source_hash_and_range_tampering_fail_closed() {
        let mut cross_world = fixture();
        cross_world.domains[2].pages[0].universe_id = "world:other".into();
        assert_code(
            validate_rich_save_migration_envelope_v1(&cross_world, &Default::default()),
            "page-address",
        );

        let mut cross_source = fixture();
        cross_source.domains[2].pages[0].source_semantic_hash = CanonicalHash::default();
        assert_code(
            validate_rich_save_migration_envelope_v1(&cross_source, &Default::default()),
            "page-source",
        );

        let mut payload = fixture();
        payload.domains[2].pages[0].payload[0] ^= 0xff;
        assert_code(
            validate_rich_save_migration_envelope_v1(&payload, &Default::default()),
            "page-payload-hash",
        );

        let mut page_hash = fixture();
        page_hash.domains[2].pages[0].page_hash = CanonicalHash::default();
        assert_code(
            validate_rich_save_migration_envelope_v1(&page_hash, &Default::default()),
            "page-hash",
        );

        let mut domain_root = fixture();
        domain_root.domains[2].semantic_root = CanonicalHash::default();
        assert_code(
            validate_rich_save_migration_envelope_v1(&domain_root, &Default::default()),
            "domain-root",
        );

        let mut envelope_root = fixture();
        envelope_root.envelope_root = CanonicalHash::default();
        assert_code(
            validate_rich_save_migration_envelope_v1(&envelope_root, &Default::default()),
            "envelope-root",
        );

        let mut range = fixture();
        range.domains[2].pages[0].item_start = JAVASCRIPT_MAX_SAFE_INTEGER + 1;
        assert_code(
            validate_rich_save_migration_envelope_v1(&range, &Default::default()),
            "integer-range",
        );
    }

    #[test]
    fn expected_identity_and_source_oracles_fail_closed() {
        let fixture = fixture();
        let wrong_root = RichSaveMigrationEnvelopeExpectationV1 {
            envelope_root: Some(CanonicalHash::default()),
            ..Default::default()
        };
        assert_code(
            validate_rich_save_migration_envelope_v1(&fixture, &wrong_root),
            "expected-root",
        );
        let wrong_world = RichSaveMigrationEnvelopeExpectationV1 {
            universe_id: Some("world:other"),
            ..Default::default()
        };
        assert_code(
            validate_rich_save_migration_envelope_v1(&fixture, &wrong_world),
            "expected-identity",
        );
        let wrong_source = [0_u8; 202];
        let wrong_source = RichSaveMigrationEnvelopeExpectationV1 {
            source_payload: Some(&wrong_source),
            source_properties: Some(&fixture.source_properties),
            ..Default::default()
        };
        assert_code(
            validate_rich_save_migration_envelope_v1(&fixture, &wrong_source),
            "expected-source",
        );
        let wrong_properties = vec!["version".to_owned()];
        let wrong_properties = RichSaveMigrationEnvelopeExpectationV1 {
            source_properties: Some(&wrong_properties),
            ..Default::default()
        };
        assert_code(
            validate_rich_save_migration_envelope_v1(&fixture, &wrong_properties),
            "expected-source",
        );
    }

    #[test]
    fn binary_decoder_rejects_truncation_trailing_bytes_and_corruption() {
        let encoded = decode_hex(TYPESCRIPT_ENCODED_HEX);
        assert_eq!(
            decode_rich_save_migration_envelope_v1(&encoded[..encoded.len() - 1])
                .unwrap_err()
                .code,
            "truncated"
        );

        let mut trailing = encoded.clone();
        trailing.push(1);
        assert_eq!(
            decode_rich_save_migration_envelope_v1(&trailing).unwrap_err().code,
            "trailing-bytes"
        );

        let mut magic = encoded.clone();
        magic[0] ^= 0xff;
        assert_eq!(
            decode_rich_save_migration_envelope_v1(&magic).unwrap_err().code,
            "magic"
        );

        let mut schema = encoded.clone();
        schema[4] = 2;
        assert_eq!(
            decode_rich_save_migration_envelope_v1(&schema).unwrap_err().code,
            "schema-version"
        );

        let mut corrupt_payload = encoded;
        let marker = [0x77, 0x00, 0x80, 0xff];
        let offset = corrupt_payload
            .windows(marker.len())
            .position(|window| window == marker)
            .unwrap();
        corrupt_payload[offset] ^= 0x40;
        assert_eq!(
            decode_rich_save_migration_envelope_v1(&corrupt_payload)
                .unwrap_err()
                .code,
            "page-payload-hash"
        );
    }

    #[test]
    fn utf16_ordinal_property_order_matches_typescript() {
        let supplementary = "\u{10000}".to_owned();
        let bmp = "\u{e000}".to_owned();
        assert_eq!(compare_ordinal(&supplementary, &bmp), Ordering::Less);
        let values = vec![supplementary, bmp];
        validate_ordered_strings(&values, "properties", 2, "duplicate", "order").unwrap();
    }
}
