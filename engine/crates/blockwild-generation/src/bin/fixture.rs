use blockwild_generation::{CancellationToken, GenerationOutcome, GenerationService, GenerationServiceConfig};
use blockwild_types::CanonicalHasher;
use std::io::{Cursor, Read};
use std::time::Instant;

fn read_u32(cursor: &mut Cursor<&[u8]>) -> Result<u32, String> {
    let mut bytes = [0_u8; 4];
    cursor.read_exact(&mut bytes).map_err(|error| error.to_string())?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_packet_batch(bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let mut cursor = Cursor::new(bytes);
    let count = read_u32(&mut cursor)? as usize;
    if count == 0 || count > 4_096 {
        return Err("packet batch count is outside 1..=4096".to_owned());
    }
    let mut packets = Vec::with_capacity(count);
    for _ in 0..count {
        let length = read_u32(&mut cursor)? as usize;
        if length == 0 || length > 16 * 1024 * 1024 {
            return Err("packet batch entry exceeds the 16 MiB bound".to_owned());
        }
        let mut packet = vec![0_u8; length];
        cursor.read_exact(&mut packet).map_err(|error| error.to_string())?;
        packets.push(packet);
    }
    if cursor.position() != bytes.len() as u64 {
        return Err("packet batch contains trailing bytes".to_owned());
    }
    Ok(packets)
}

fn percentile(sorted: &[u128], fraction: f64) -> u128 {
    let rank = ((sorted.len() as f64 * fraction).ceil() as usize).clamp(1, sorted.len());
    sorted[rank - 1]
}

fn run_packet_benchmark(input: &str, output: &str) -> Result<(), String> {
    let input_bytes = std::fs::read(input).map_err(|error| error.to_string())?;
    let packets = read_packet_batch(&input_bytes)?;
    let cold_started = Instant::now();
    let cold_result = blockwild_generation::generate_packet_v2(&packets[0])
        .map_err(|error| format!("cold generation request was rejected: {error}"))?;
    let cold_us = cold_started.elapsed().as_micros();

    // Run the whole admitted sequence after one priming request. This measures
    // the same wire decode, deterministic generation, and result encoding path
    // used by Wasm without process startup or filesystem I/O in each sample.
    let mut results = Vec::with_capacity(packets.len());
    let mut durations = Vec::with_capacity(packets.len());
    for packet in &packets {
        let started = Instant::now();
        let result = blockwild_generation::generate_packet_v2(packet)
            .map_err(|error| format!("warm generation request was rejected: {error}"))?;
        durations.push(started.elapsed().as_micros());
        results.push(result);
    }
    let per_case_us = durations.clone();
    durations.sort_unstable();
    let mut output_bytes = Vec::new();
    output_bytes.extend_from_slice(&(results.len() as u32).to_le_bytes());
    for result in &results {
        output_bytes.extend_from_slice(&(result.len() as u32).to_le_bytes());
        output_bytes.extend_from_slice(result);
    }
    std::fs::write(output, &output_bytes).map_err(|error| error.to_string())?;
    println!(
        "{{\"schema\":1,\"samples\":{},\"coldUs\":{},\"warmMeanUs\":{},\"warmP50Us\":{},\"warmP95Us\":{},\"warmP99Us\":{},\"warmMaxUs\":{},\"requestBytes\":{},\"resultBytes\":{},\"coldResultBytes\":{},\"perCaseUs\":[{}]}}",
        durations.len(),
        cold_us,
        durations.iter().sum::<u128>() / durations.len() as u128,
        percentile(&durations, 0.50),
        percentile(&durations, 0.95),
        percentile(&durations, 0.99),
        durations.last().copied().unwrap_or_default(),
        input_bytes.len(),
        output_bytes.len(),
        cold_result.len(),
        per_case_us.iter().map(u128::to_string).collect::<Vec<_>>().join(","),
    );
    Ok(())
}

fn main() {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if arguments.first().map(String::as_str) == Some("--certificate") {
        println!("{}", blockwild_generation::parity_certificate_json_v2());
        return;
    }
    if arguments.first().map(String::as_str) == Some("--packet") {
        let input = arguments.get(1).expect("--packet requires an input path");
        let output = arguments.get(2).expect("--packet requires an output path");
        let request = std::fs::read(input).expect("read generation request");
        let result = blockwild_generation::generate_packet_v2(&request).expect("generate packet");
        std::fs::write(output, result).expect("write generation result");
        return;
    }
    if arguments.first().map(String::as_str) == Some("--settlement-query") {
        let input = arguments.get(1).expect("--settlement-query requires an input path");
        let output = arguments.get(2).expect("--settlement-query requires an output path");
        let request = std::fs::read(input).expect("read settlement query request");
        let result = blockwild_generation::query_settlements_packet_v1(&request).expect("query settlements packet");
        std::fs::write(output, result).expect("write settlement query result");
        return;
    }
    if arguments.first().map(String::as_str) == Some("--dragon-lair-query") {
        let input = arguments.get(1).expect("--dragon-lair-query requires an input path");
        let output = arguments.get(2).expect("--dragon-lair-query requires an output path");
        let request = std::fs::read(input).expect("read dragon-lair query request");
        let result = blockwild_generation::query_dragon_lair_packet_v1(&request).expect("query dragon-lair packet");
        std::fs::write(output, result).expect("write dragon-lair query result");
        return;
    }
    if arguments.first().map(String::as_str) == Some("--packet-benchmark") {
        let input = arguments.get(1).expect("--packet-benchmark requires an input path");
        let output = arguments.get(2).expect("--packet-benchmark requires an output path");
        run_packet_benchmark(input, output).expect("benchmark packet batch");
        return;
    }
    let cases = arguments
        .first()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(512)
        .clamp(1, 100_000);
    let service = GenerationService::new(GenerationServiceConfig {
        cache_entries: cases.min(256),
        ..Default::default()
    });
    let mut replay = CanonicalHasher::new("blockwild-generation-fixture-v18");
    let cold_started = Instant::now();
    for index in 0..cases {
        let cx = ((index as i32).wrapping_mul(7919) % 4093) - 2046;
        let cz = 2046 - ((index as i32).wrapping_mul(3571) % 4093);
        let request =
            blockwild_generation::fixture_request(&format!("fixture-seed-{}", index % 97), cx, cz, index as u32 + 1);
        let outcome = service
            .generate(&request, &CancellationToken::default(), || 1, || Some(request.revision))
            .expect("fixture generation");
        if let GenerationOutcome::Ready { chunk, .. } = outcome {
            replay.write_str(&chunk.chunk_hash);
        }
    }
    let cold = cold_started.elapsed();
    let warm_request = blockwild_generation::fixture_request("fixture-seed-0", -2046, 2046, cases as u32 + 1);
    let warm_started = Instant::now();
    let warm = service
        .generate(
            &warm_request,
            &CancellationToken::default(),
            || 1,
            || Some(warm_request.revision),
        )
        .expect("warm generation");
    let warm_elapsed = warm_started.elapsed();
    if let GenerationOutcome::Ready { chunk, cache_hit } = warm {
        replay.write_str(&chunk.chunk_hash);
        replay.write_u16(u16::from(cache_hit));
    }
    let diagnostics = service.diagnostics();
    println!(
        "cases={cases} cold_us={} warm_us={} cache_hits={} cache_misses={} replay_hash={}",
        cold.as_micros(),
        warm_elapsed.as_micros(),
        diagnostics.cache_hits,
        diagnostics.cache_misses,
        replay.finish().to_hex()
    );
}

#[cfg(test)]
mod tests {
    use super::read_packet_batch;

    fn batch(packets: &[&[u8]]) -> Vec<u8> {
        let mut result = Vec::new();
        result.extend_from_slice(&(packets.len() as u32).to_le_bytes());
        for packet in packets {
            result.extend_from_slice(&(packet.len() as u32).to_le_bytes());
            result.extend_from_slice(packet);
        }
        result
    }

    #[test]
    fn packet_batch_is_bounded_and_exact() {
        let encoded = batch(&[b"first", b"second"]);
        assert_eq!(
            read_packet_batch(&encoded).unwrap(),
            [b"first".to_vec(), b"second".to_vec()]
        );
        let mut trailing = encoded;
        trailing.push(0);
        assert!(read_packet_batch(&trailing).is_err());
        assert!(read_packet_batch(&0_u32.to_le_bytes()).is_err());
    }

    #[test]
    fn packet_batch_rejects_oversize_metadata_before_allocating() {
        let mut encoded = 1_u32.to_le_bytes().to_vec();
        encoded.extend_from_slice(&(16_u32 * 1024 * 1024 + 1).to_le_bytes());
        assert!(read_packet_batch(&encoded).is_err());
        assert!(read_packet_batch(&4_097_u32.to_le_bytes()).is_err());
    }
}
