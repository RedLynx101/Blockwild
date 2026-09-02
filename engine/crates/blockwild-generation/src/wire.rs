use crate::contract::{ChunkPayloadV2, GenerateChunkRequestV2, GenerationError, MarkerRow};

const REQUEST_MAGIC: [u8; 4] = *b"BWG2";
const RESULT_MAGIC: [u8; 4] = *b"BWR2";
const MAX_STRING: usize = 1 << 20;
const MAX_PACKET: usize = 16 << 20;

pub fn encode_request(request: &GenerateChunkRequestV2) -> Result<Vec<u8>, GenerationError> {
    request.validate()?;
    let mut writer = Writer::new(REQUEST_MAGIC);
    writer.u16(request.protocol_version);
    writer.u16(request.schema_version);
    writer.u32(request.epoch);
    writer.u32(request.task_id);
    writer.u32(request.revision);
    for value in [
        &request.namespace,
        &request.content_hash,
        &request.generator_hash,
        &request.seed_text,
        &request.generation_options_json,
        &request.key,
    ] {
        writer.string(value)?;
    }
    writer.i32(request.cx);
    writer.i32(request.cz);
    writer.u32(request.edits.len() as u32);
    for &(index, block) in &request.edits {
        writer.u32(index);
        writer.u16(block);
    }
    writer.string(&request.request_hash)?;
    writer.finish()
}

pub fn decode_request(bytes: &[u8]) -> Result<GenerateChunkRequestV2, GenerationError> {
    let mut reader = Reader::new(bytes, REQUEST_MAGIC)?;
    let request = GenerateChunkRequestV2 {
        protocol_version: reader.u16()?,
        schema_version: reader.u16()?,
        epoch: reader.u32()?,
        task_id: reader.u32()?,
        revision: reader.u32()?,
        namespace: reader.string()?,
        content_hash: reader.string()?,
        generator_hash: reader.string()?,
        seed_text: reader.string()?,
        generation_options_json: reader.string()?,
        key: reader.string()?,
        cx: reader.i32()?,
        cz: reader.i32()?,
        edits: {
            let count = reader.count(49_152)?;
            let mut values = Vec::with_capacity(count);
            for _ in 0..count {
                values.push((reader.u32()?, reader.u16()?));
            }
            values
        },
        request_hash: reader.string()?,
    };
    reader.done()?;
    request.validate()?;
    Ok(request)
}

pub fn encode_result(result: &ChunkPayloadV2) -> Result<Vec<u8>, GenerationError> {
    let mut writer = Writer::new(RESULT_MAGIC);
    writer.u16(result.protocol_version);
    writer.u16(result.schema_version);
    writer.u32(result.epoch);
    writer.u32(result.task_id);
    writer.u32(result.revision);
    for value in [
        &result.namespace,
        &result.content_hash,
        &result.generator_hash,
        &result.request_hash,
        &result.key,
    ] {
        writer.string(value)?;
    }
    writer.i32(result.cx);
    writer.i32(result.cz);
    writer.u16_slice(&result.blocks);
    writer.i16_slice(&result.heightmap);
    writer.u8_slice(&result.biomes);
    writer.u16_slice(&result.section_block_counts);
    writer.i16_slice(&result.sky_tops);
    writer.u16_slice(&result.light);
    writer.u32_slice(&result.light_indices);
    writer.u32_slice(&result.leaf_indices);
    writer.u32(result.markers.len() as u32);
    for marker in &result.markers {
        writer.string(&marker.key)?;
        writer.string(&marker.canonical_json)?;
    }
    writer.string(&result.chunk_hash)?;
    writer.finish()
}

pub fn decode_result(bytes: &[u8]) -> Result<ChunkPayloadV2, GenerationError> {
    let mut reader = Reader::new(bytes, RESULT_MAGIC)?;
    let result = ChunkPayloadV2 {
        protocol_version: reader.u16()?,
        schema_version: reader.u16()?,
        epoch: reader.u32()?,
        task_id: reader.u32()?,
        revision: reader.u32()?,
        namespace: reader.string()?,
        content_hash: reader.string()?,
        generator_hash: reader.string()?,
        request_hash: reader.string()?,
        key: reader.string()?,
        cx: reader.i32()?,
        cz: reader.i32()?,
        blocks: reader.u16_vec(49_152)?,
        heightmap: reader.i16_vec(256)?,
        biomes: reader.u8_vec(256)?,
        section_block_counts: reader.u16_vec(12)?,
        sky_tops: reader.i16_vec(256)?,
        light: reader.u16_vec(49_152)?,
        light_indices: reader.u32_vec(49_152)?,
        leaf_indices: reader.u32_vec(49_152)?,
        markers: {
            let count = reader.count(16_384)?;
            let mut markers = Vec::with_capacity(count);
            for _ in 0..count {
                markers.push(MarkerRow {
                    key: reader.string()?,
                    canonical_json: reader.string()?,
                });
            }
            markers
        },
        chunk_hash: reader.string()?,
    };
    reader.done()?;
    Ok(result)
}

struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn new(magic: [u8; 4]) -> Self {
        Self { bytes: magic.to_vec() }
    }
    fn u8_slice(&mut self, values: &[u8]) {
        self.u32(values.len() as u32);
        self.bytes.extend_from_slice(values);
    }
    fn u16(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn i16_slice(&mut self, values: &[i16]) {
        self.u32(values.len() as u32);
        for value in values {
            self.bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    fn u16_slice(&mut self, values: &[u16]) {
        self.u32(values.len() as u32);
        for value in values {
            self.u16(*value);
        }
    }
    fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn i32(&mut self, value: i32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn u32_slice(&mut self, values: &[u32]) {
        self.u32(values.len() as u32);
        for value in values {
            self.u32(*value);
        }
    }
    fn string(&mut self, value: &str) -> Result<(), GenerationError> {
        if value.len() > MAX_STRING {
            return Err(GenerationError::Wire("string exceeds wire bound".into()));
        }
        self.u32(value.len() as u32);
        self.bytes.extend_from_slice(value.as_bytes());
        Ok(())
    }
    fn finish(self) -> Result<Vec<u8>, GenerationError> {
        if self.bytes.len() > MAX_PACKET {
            Err(GenerationError::Wire("packet exceeds wire bound".into()))
        } else {
            Ok(self.bytes)
        }
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8], magic: [u8; 4]) -> Result<Self, GenerationError> {
        if bytes.len() > MAX_PACKET || bytes.get(..4) != Some(&magic) {
            return Err(GenerationError::Wire("bad packet magic or size".into()));
        }
        Ok(Self { bytes, cursor: 4 })
    }
    fn take(&mut self, count: usize) -> Result<&'a [u8], GenerationError> {
        let end = self
            .cursor
            .checked_add(count)
            .ok_or_else(|| GenerationError::Wire("packet offset overflow".into()))?;
        let value = self
            .bytes
            .get(self.cursor..end)
            .ok_or_else(|| GenerationError::Wire("truncated packet".into()))?;
        self.cursor = end;
        Ok(value)
    }
    fn u16(&mut self) -> Result<u16, GenerationError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("fixed length")))
    }
    fn u32(&mut self) -> Result<u32, GenerationError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("fixed length")))
    }
    fn i32(&mut self) -> Result<i32, GenerationError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().expect("fixed length")))
    }
    fn count(&mut self, maximum: usize) -> Result<usize, GenerationError> {
        let count = self.u32()? as usize;
        if count > maximum {
            Err(GenerationError::Wire("collection exceeds wire bound".into()))
        } else {
            Ok(count)
        }
    }
    fn string(&mut self) -> Result<String, GenerationError> {
        let count = self.count(MAX_STRING)?;
        String::from_utf8(self.take(count)?.to_vec()).map_err(|_| GenerationError::Wire("invalid UTF-8".into()))
    }
    fn u8_vec(&mut self, maximum: usize) -> Result<Vec<u8>, GenerationError> {
        let count = self.count(maximum)?;
        Ok(self.take(count)?.to_vec())
    }
    fn u16_vec(&mut self, maximum: usize) -> Result<Vec<u16>, GenerationError> {
        let count = self.count(maximum)?;
        (0..count).map(|_| self.u16()).collect()
    }
    fn i16_vec(&mut self, maximum: usize) -> Result<Vec<i16>, GenerationError> {
        let count = self.count(maximum)?;
        (0..count)
            .map(|_| Ok(i16::from_le_bytes(self.take(2)?.try_into().expect("fixed length"))))
            .collect()
    }
    fn u32_vec(&mut self, maximum: usize) -> Result<Vec<u32>, GenerationError> {
        let count = self.count(maximum)?;
        (0..count).map(|_| self.u32()).collect()
    }
    fn done(&self) -> Result<(), GenerationError> {
        if self.cursor == self.bytes.len() {
            Ok(())
        } else {
            Err(GenerationError::Wire("trailing packet bytes".into()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generator::TerrainGeneratorV18;
    use crate::service::fixture_request;

    fn encode_request_without_validation(request: &GenerateChunkRequestV2) -> Vec<u8> {
        let mut writer = Writer::new(REQUEST_MAGIC);
        writer.u16(request.protocol_version);
        writer.u16(request.schema_version);
        writer.u32(request.epoch);
        writer.u32(request.task_id);
        writer.u32(request.revision);
        for value in [
            &request.namespace,
            &request.content_hash,
            &request.generator_hash,
            &request.seed_text,
            &request.generation_options_json,
            &request.key,
        ] {
            writer.string(value).unwrap();
        }
        writer.i32(request.cx);
        writer.i32(request.cz);
        writer.u32(request.edits.len() as u32);
        for &(index, block) in &request.edits {
            writer.u32(index);
            writer.u16(block);
        }
        writer.string(&request.request_hash).unwrap();
        writer.finish().unwrap()
    }

    #[test]
    fn request_and_result_round_trip_without_platform_types() {
        let request = fixture_request("wire", -7, 11, 9);
        assert_eq!(decode_request(&encode_request(&request).unwrap()).unwrap(), request);
        let result = TerrainGeneratorV18::from_request(&request)
            .unwrap()
            .generate(&request, || false)
            .unwrap();
        assert_eq!(decode_result(&encode_result(&result).unwrap()).unwrap(), result);
    }

    #[test]
    fn malformed_and_trailing_packets_fail_closed() {
        assert!(decode_request(b"nope").is_err());
        let request = fixture_request("wire", 0, 0, 1);
        let mut bytes = encode_request(&request).unwrap();
        bytes.push(0);
        assert!(decode_request(&bytes).is_err());
    }

    #[test]
    fn decode_rejects_a_correctly_rehashed_nested_option_spoof() {
        let mut request = fixture_request("wire-spoof", 0, 0, 1);
        request.generation_options_json = r#"{"origin":{"profile":"legacy-v14"}}"#.into();
        request.request_hash = request.canonical_hash().to_hex();
        assert_eq!(request.canonical_hash().to_hex(), request.request_hash);
        assert!(encode_request(&request).is_err());
        assert!(decode_request(&encode_request_without_validation(&request)).is_err());
    }
}
