import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { rustIntegratedRuntimeWireChecksumV1 } from "../app/game/rust-integrated-runtime-codec.ts";
import {
  decodeRustIntegratedNetworkAcknowledgementV1,
  type RustIntegratedNetworkAcknowledgementFamilyV1,
} from "../app/game/rust-integrated-runtime-network-lifecycle.ts";

type Fixture = Readonly<{
  requests: Readonly<Record<string, string>>;
  wasmDispatchReceipts: Readonly<Record<string, string>>;
}>;

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/rust-engine/integrated-runtime-v1/r9-network-wire-fixture.json", import.meta.url),
  "utf8",
)) as Fixture;

function fromHex(value: string) {
  assert.match(value, /^(?:[0-9a-f]{2})+$/u);
  return Uint8Array.from(
    { length: value.length / 2 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function hashBytes(value: string) {
  assert.match(value, /^[0-9a-f]{32}$/u);
  return Uint8Array.from(
    { length: 16 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function reencode(
  magic: string,
  requestPayloadHash: string,
  resultingRuntimeStateHash: string,
) {
  const output = new Uint8Array(38);
  output.set(new TextEncoder().encode(magic), 0);
  new DataView(output.buffer).setUint16(4, 1, true);
  output.set(hashBytes(requestPayloadHash), 6);
  output.set(hashBytes(resultingRuntimeStateHash), 22);
  return output;
}

test("checked native R9 acknowledgements decode and independently re-encode exactly", () => {
  const families = [
    ["peer-grant", "peerGrant", "peerGrant", "BWP9"],
    ["agent-grant", "agentGrant", "agentGrant", "BWJ9"],
    ["replication-upsert", "replicationRecord", "replicationRecord", "BWI9"],
    ["replication-remove", "replicationRecord", "replicationRemove", "BWR9"],
    ["command-release", "commandRelease", "commandRelease", "BWM9"],
    ["peer-release", "peerRelease", "peerRelease", "BWL9"],
  ] as const satisfies readonly (readonly [
    RustIntegratedNetworkAcknowledgementFamilyV1,
    string,
    string,
    string,
  ])[];

  for (const [family, requestKey, receiptKey, magic] of families) {
    const packet = fromHex(fixture.wasmDispatchReceipts[receiptKey]);
    const decoded = decodeRustIntegratedNetworkAcknowledgementV1(family, packet);
    assert.equal(
      decoded.requestPayloadHash,
      rustIntegratedRuntimeWireChecksumV1(fromHex(fixture.requests[requestKey])),
      `${family} request attestation`,
    );
    assert.match(decoded.resultingRuntimeStateHash, /^[0-9a-f]{32}$/u);
    assert.deepEqual(
      reencode(magic, decoded.requestPayloadHash, decoded.resultingRuntimeStateHash),
      packet,
      `${family} native bytes`,
    );
  }
});

test("R9 acknowledgement decoders reject the wrong family, truncation, and trailing bytes", () => {
  const peer = fromHex(fixture.wasmDispatchReceipts.peerGrant);
  assert.throws(
    () => decodeRustIntegratedNetworkAcknowledgementV1("agent-grant", peer),
    /header mismatch/u,
  );
  assert.throws(
    () => decodeRustIntegratedNetworkAcknowledgementV1("peer-grant", peer.subarray(0, peer.length - 1)),
    /truncated/u,
  );
  const trailing = new Uint8Array(peer.length + 1);
  trailing.set(peer);
  assert.throws(
    () => decodeRustIntegratedNetworkAcknowledgementV1("peer-grant", trailing),
    /trailing bytes/u,
  );
});
