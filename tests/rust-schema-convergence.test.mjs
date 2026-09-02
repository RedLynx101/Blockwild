import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  integratedRuntimeSchemaFingerprint,
  verifyIntegratedRuntimeSchemaConvergence,
  withIntegratedRuntimeSchemaFingerprint,
} from "../scripts/verify-integrated-runtime-schema-convergence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "engine", "schema", "integrated-runtime-r5-r9.v1.json");

function sourceManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function rustPublicStringConstants(...sources) {
  const values = new Map();
  const aliases = new Map();
  for (const source of sources) {
    for (const match of source.matchAll(/pub const\s+([A-Z][A-Z0-9_]+):\s*&str\s*=\s*"([^"]+)";/gu)) {
      values.set(match[1], match[2]);
    }
    for (const match of source.matchAll(/pub const\s+([A-Z][A-Z0-9_]+):\s*&str\s*=\s*([A-Z][A-Z0-9_]+);/gu)) {
      aliases.set(match[1], match[2]);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, target] of aliases) {
      if (!values.has(name) && values.has(target)) {
        values.set(name, values.get(target));
        changed = true;
      }
    }
  }
  return values;
}

async function verifyMutation(mutator, { refreshFingerprint = true } = {}) {
  let source = structuredClone(sourceManifest());
  mutator(source);
  if (refreshFingerprint) source = withIntegratedRuntimeSchemaFingerprint(source);
  const fixture = path.join(tmpdir(), `blockwild-schema-convergence-${randomUUID()}.json`);
  writeFileSync(fixture, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  try {
    return await verifyIntegratedRuntimeSchemaConvergence({ root, manifestPath: fixture });
  } finally {
    unlinkSync(fixture);
  }
}

test("the integrated R5-R9 domain-operation wire manifest is exact, fingerprinted, and complete", async () => {
  const source = sourceManifest();
  const report = await verifyIntegratedRuntimeSchemaConvergence({ root, manifestPath });
  assert.equal(report.valid, true, report.blockers.join("\n"));
  assert.equal(report.complete, true);
  assert.equal(report.completeDomains, 5);
  assert.deepEqual(report.partialDomains, []);
  assert.equal(report.fingerprint.valid, true);
  assert.equal(source.fingerprint.value, integratedRuntimeSchemaFingerprint(source));

  const cameraRequest = source.domains[0].families.requests.find((family) => family.id === "simulation-camera-config-v1");
  const cameraReceipt = source.domains[0].families.receipts.find((family) => family.id === "simulation-camera-config-receipt-v1");
  assert.deepEqual(cameraRequest, {
    id: "simulation-camera-config-v1",
    direction: "request",
    magic: "BWC5",
    typeId: "blockwild.simulation.camera-config.r5.v1",
    operationSchema: 1,
    innerSchema: 1,
    normalPath: true,
  });
  assert.deepEqual(cameraReceipt, {
    id: "simulation-camera-config-receipt-v1",
    direction: "receipt",
    magic: "BWR5",
    typeId: "blockwild.simulation.camera-config-receipt.r5.v1",
    operationSchema: 1,
    innerSchema: 1,
    normalPath: true,
  });

  const r7 = source.domains.find((domain) => domain.phase === "R7");
  assert.deepEqual(
    r7.families.requests.filter((family) => [
      "native-drop-pickup-receipt-v1",
      "native-player-drop-receipt-v1",
    ].includes(family.id)),
    [
      {
        id: "native-drop-pickup-receipt-v1",
        direction: "request",
        magic: "BWQ8",
        typeId: "blockwild.gameplay.native-drop-pickup-receipt.r7.v1",
        operationSchema: 1,
        innerSchema: 1,
        normalPath: true,
      },
      {
        id: "native-player-drop-receipt-v1",
        direction: "request",
        magic: "BWQ9",
        typeId: "blockwild.gameplay.native-player-drop-receipt.r7.v1",
        operationSchema: 1,
        innerSchema: 1,
        normalPath: true,
      },
    ],
  );
  assert.deepEqual(
    r7.families.receipts.filter((family) => [
      "native-drop-pickup-projection-receipt-v1",
      "native-player-drop-projection-receipt-v1",
    ].includes(family.id)),
    [
      {
        id: "native-drop-pickup-projection-receipt-v1",
        direction: "receipt",
        magic: "BWR8",
        typeId: "blockwild.gameplay.native-drop-pickup-projection-receipt.r7.v1",
        operationSchema: 1,
        innerSchema: 1,
        normalPath: true,
      },
      {
        id: "native-player-drop-projection-receipt-v1",
        direction: "receipt",
        magic: "BWS9",
        typeId: "blockwild.gameplay.native-player-drop-projection-receipt.r7.v1",
        operationSchema: 1,
        innerSchema: 1,
        normalPath: true,
      },
    ],
  );

  const r9 = source.domains.find((domain) => domain.phase === "R9");
  assert.deepEqual(
    Object.fromEntries(r9.families.requests.map(({ id, magic }) => [id, magic])),
    {
      "network-agent-grant-v1": "BWJ9",
      "network-command-release-v1": "BWM9",
      "network-delta-build-v1": "BWD9",
      "network-peer-grant-v1": "BWP9",
      "network-peer-release-v1": "BWL9",
      "network-reconnect-v1": "BWC9",
      "network-replication-remove-v1": "BWI9",
      "network-replication-upsert-v1": "BWI9",
      "network-browser-request-v1": "BWRN",
    },
  );
  assert.deepEqual(
    Object.fromEntries(r9.families.receipts.map(({ id, magic }) => [id, magic])),
    {
      "network-agent-grant-receipt-v1": "BWJ9",
      "network-command-release-receipt-v1": "BWM9",
      "network-delta-build-response-v1": "BWH9",
      "network-peer-grant-receipt-v1": "BWP9",
      "network-peer-release-receipt-v1": "BWL9",
      "network-reconnect-response-v1": "BWC9",
      "network-replication-remove-receipt-v1": "BWR9",
      "network-replication-upsert-receipt-v1": "BWI9",
      "network-browser-response-v1": "BWNA",
    },
  );
});

test("the R5-R8 manifest request registry exactly covers every Wasm domain dispatch arm", () => {
  const manifest = sourceManifest();
  const runtimeDomainSource = readFileSync(
    path.join(root, "engine/crates/blockwild-runtime-wire/src/domain.rs"),
    "utf8",
  );
  const engineWireSource = readFileSync(
    path.join(root, "engine/crates/blockwild-engine/src/runtime_domain_wire.rs"),
    "utf8",
  );
  const generatedSource = readFileSync(
    path.join(root, "engine/crates/blockwild-engine/src/runtime_domain_schema_generated.rs"),
    "utf8",
  );
  const wasmSource = readFileSync(
    path.join(root, "engine/crates/blockwild-wasm/src/integrated_runtime.rs"),
    "utf8",
  );
  const typeIds = rustPublicStringConstants(runtimeDomainSource, engineWireSource, generatedSource);
  const scopedDomains = [
    { rust: "Simulation", phase: "R5", manifest: "simulation", count: 9 },
    { rust: "Entities", phase: "R6", manifest: "entities", count: 5 },
    { rust: "Gameplay", phase: "R7", manifest: "gameplay", count: 11 },
    { rust: "Persistence", phase: "R8", manifest: "persistence", count: 1 },
  ];
  const dispatchStart = wasmSource.indexOf("let response = match (operation.domain, operation.type_id.as_str())");
  assert.notEqual(dispatchStart, -1);
  const dispatchSource = wasmSource.slice(dispatchStart, wasmSource.indexOf("receipts.push(response)", dispatchStart));
  const dispatchArms = [...dispatchSource.matchAll(
    /\(RuntimeDomainV1::(Simulation|Entities|Gameplay|Persistence),\s*([A-Z][A-Z0-9_]+)\)\s*=>\s*\{/gu,
  )].map((match) => ({ domain: match[1], constant: match[2] }));
  const schemaConstants = new Map([...generatedSource.matchAll(/pub const ([A-Z0-9_]+): u16 = ([1-9][0-9]*);/gu)]
    .map((match) => [match[1], Number(match[2])]));
  const schemaOverrides = new Map([...wasmSource.slice(0, dispatchStart).matchAll(
    /\(RuntimeDomainV1::(Simulation|Entities|Gameplay|Persistence),\s*([A-Z][A-Z0-9_]+)\)\s*=>\s*\{?\s*(?:blockwild_engine::([A-Z0-9_]+)|([1-9][0-9]*))/gu,
  )].map((match) => {
    const value = match[3] ? schemaConstants.get(match[3]) : Number(match[4]);
    assert.ok(value, `unresolved operation schema ${match[3]}`);
    return [`${match[1]}/${match[2]}`, value];
  }));

  assert.equal(dispatchArms.length, 26, "the scoped Wasm dispatch registry changed without a schema update");
  assert.equal(new Set(dispatchArms.map(({ domain, constant }) => `${domain}/${constant}`)).size, 26);
  for (const expected of scopedDomains) {
    const arms = dispatchArms.filter(({ domain }) => domain === expected.rust);
    const domain = manifest.domains.find((candidate) => candidate.phase === expected.phase);
    assert.equal(domain?.domain, expected.manifest);
    assert.equal(arms.length, expected.count, `${expected.rust} Wasm request-arm count changed`);
    assert.equal(domain.families.requests.length, expected.count, `${expected.phase} manifest request count drifted`);
    const sourceTypeIds = arms.map(({ constant }) => {
      const typeId = typeIds.get(constant);
      assert.ok(typeId, `${constant} is not resolvable to a production type id`);
      return typeId;
    });
    assert.deepEqual(
      domain.families.requests.map((family) => family.typeId).sort(),
      sourceTypeIds.sort(),
      `${expected.phase} does not exactly cover its Wasm request type registry`,
    );
    for (const { domain: rustDomain, constant } of arms) {
      const typeId = typeIds.get(constant);
      const family = domain.families.requests.find((candidate) => candidate.typeId === typeId);
      assert.equal(
        family.operationSchema,
        schemaOverrides.get(`${rustDomain}/${constant}`) ?? 1,
        `${family.id} confuses its outer operation schema with another wire layer`,
      );
    }
  }
});

test("versioned R5-R8 families consume generated descriptors without confusing outer and inner schemas", () => {
  const manifest = sourceManifest();
  const families = new Map(manifest.domains.flatMap((domain) => [
    ...domain.families.requests,
    ...domain.families.receipts,
  ]).map((family) => [family.id, family]));
  const exactFamily = (id, expected) => assert.deepEqual(families.get(id), {
    id,
    normalPath: true,
    ...expected,
  });

  exactFamily("simulation-player-bind-v4", {
    direction: "request",
    magic: "BWB6",
    typeId: "blockwild.simulation.player-bind.r5.v4",
    operationSchema: 4,
    innerSchema: 1,
  });
  exactFamily("simulation-player-bind-final-receipt-v4", {
    direction: "receipt",
    magic: "BWF7",
    typeId: "blockwild.simulation.player-bind-final-receipt.r5.v4",
    operationSchema: 4,
    innerSchema: 1,
  });
  exactFamily("entity-authority-import-v2", {
    direction: "request",
    magic: "BWI6",
    typeId: "blockwild.entities.authority-import.r6.v2",
    operationSchema: 1,
    innerSchema: 1,
  });
  exactFamily("entity-authority-snapshot-v2", {
    direction: "receipt",
    magic: "BWEA",
    typeId: "blockwild.entities.authority-snapshot.r6.v2",
    operationSchema: 1,
    innerSchema: 2,
  });
  exactFamily("entity-compatibility-import-v1", {
    direction: "request",
    magic: "BWI5",
    typeId: "blockwild.entities.compatibility-import.r6.v1",
    operationSchema: 1,
    innerSchema: 1,
  });
  exactFamily("entity-receipt-v1", {
    direction: "receipt",
    magic: "BWA6",
    typeId: "blockwild.entities.event-batch.r6.v1",
    operationSchema: 1,
    innerSchema: 1,
  });
  exactFamily("native-block-edit-receipt-v2", {
    direction: "request",
    magic: "BWZ8",
    typeId: "blockwild.gameplay.native-block-edit-receipt.r7.v2",
    operationSchema: 2,
    innerSchema: 1,
  });
  exactFamily("native-block-edit-projection-receipt-v2", {
    direction: "receipt",
    magic: "BWY8",
    typeId: "blockwild.gameplay.native-block-edit-projection-receipt.r7.v2",
    operationSchema: 2,
    innerSchema: 1,
  });
  exactFamily("gameplay-command-v1", {
    direction: "request",
    magic: "BWG7",
    typeId: "blockwild.gameplay.command-batch.r7.v1",
    operationSchema: 1,
    innerSchema: 1,
  });
  exactFamily("gameplay-receipt-v1", {
    direction: "receipt",
    magic: "BWA7",
    typeId: "blockwild.gameplay.command-receipt.r7.v1",
    operationSchema: 1,
    innerSchema: 1,
  });
  exactFamily("persistence-dispatch-v1", {
    direction: "request",
    magic: "BWD8",
    typeId: "blockwild.persistence.dispatch.r8.v1",
    operationSchema: 1,
    innerSchema: 1,
  });
  exactFamily("persistence-dispatch-receipt-v1", {
    direction: "receipt",
    magic: "BWA8",
    typeId: "blockwild.persistence.dispatch-receipt.r8.v1",
    operationSchema: 1,
    innerSchema: 1,
  });

  const engineWireSource = readFileSync(
    path.join(root, "engine/crates/blockwild-engine/src/runtime_domain_wire.rs"),
    "utf8",
  );
  const entitySnapshotSource = readFileSync(
    path.join(root, "engine/crates/blockwild-entity/src/snapshot.rs"),
    "utf8",
  );
  const wasmSource = readFileSync(
    path.join(root, "engine/crates/blockwild-wasm/src/integrated_runtime.rs"),
    "utf8",
  );
  const entityTypeScriptSource = readFileSync(
    path.join(root, "app/game/rust-integrated-runtime-entities.ts"),
    "utf8",
  );
  const playerBootstrapTypeScriptSource = readFileSync(
    path.join(root, "app/game/rust-integrated-runtime-player-bootstrap.ts"),
    "utf8",
  );
  assert.match(
    engineWireSource,
    /fn runtime_player_binding_wire_v1\(\)[\s\S]*?SIMULATION_PLAYER_BIND_V2_MAGIC[\s\S]*?SIMULATION_PLAYER_BIND_V2_INNER_SCHEMA[\s\S]*?pub fn encode_runtime_player_binding_v1/u,
  );
  assert.match(
    engineWireSource,
    /encode_player_bootstrap_status_query_v1[\s\S]*?PLAYER_BOOTSTRAP_STATUS_V1_MAGIC[\s\S]*?PLAYER_BOOTSTRAP_STATUS_V1_INNER_SCHEMA/u,
  );
  assert.match(
    engineWireSource,
    /encode_runtime_context_command_continuity_query_v2[\s\S]*?CONTEXT_COMMAND_CONTINUITY_V2_MAGIC[\s\S]*?CONTEXT_COMMAND_CONTINUITY_V2_INNER_SCHEMA/u,
  );
  assert.match(
    engineWireSource,
    /encode_player_game_mode_set_v1[\s\S]*?PLAYER_GAME_MODE_SET_V1_MAGIC[\s\S]*?PLAYER_GAME_MODE_SET_V1_INNER_SCHEMA/u,
  );
  assert.doesNotMatch(
    engineWireSource,
    /const (?:PLAYER_BINDING_MAGIC|PLAYER_BOOTSTRAP_STATUS_QUERY_MAGIC|PLAYER_BOOTSTRAP_STATUS_RECEIPT_MAGIC|PLAYER_COMBAT_BOOTSTRAP_STATUS_QUERY_MAGIC_V1|PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_MAGIC_V1|CONTEXT_COMMAND_CONTINUITY_QUERY_MAGIC_V2|CONTEXT_COMMAND_CONTINUITY_RECEIPT_MAGIC_V2|PLAYER_GAME_MODE_SET_MAGIC|PLAYER_GAME_MODE_SET_RECEIPT_MAGIC):/u,
  );
  const rustCodecSource = (functionName) => {
    const marker = `pub fn ${functionName}`;
    const start = engineWireSource.indexOf(marker);
    assert.notEqual(start, -1, `${functionName} is missing from runtime_domain_wire.rs`);
    const next = engineWireSource.indexOf("\npub fn ", start + marker.length);
    return engineWireSource.slice(start, next === -1 ? undefined : next);
  };
  for (const [functionName, magic, innerSchema] of [
    ["encode_entity_authority_export_v1", "ENTITY_AUTHORITY_EXPORT_V1_MAGIC", "ENTITY_AUTHORITY_EXPORT_V1_INNER_SCHEMA"],
    ["encode_entity_authority_import_v2", "ENTITY_AUTHORITY_IMPORT_V2_MAGIC", "ENTITY_AUTHORITY_IMPORT_V2_INNER_SCHEMA"],
    ["encode_entity_authority_import_receipt_v1", "ENTITY_AUTHORITY_IMPORT_RECEIPT_V1_MAGIC", "ENTITY_AUTHORITY_IMPORT_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_entity_compatibility_export_v1", "ENTITY_COMPATIBILITY_EXPORT_V1_MAGIC", "ENTITY_COMPATIBILITY_EXPORT_V1_INNER_SCHEMA"],
    ["encode_entity_compatibility_import_v1", "ENTITY_COMPATIBILITY_IMPORT_V1_MAGIC", "ENTITY_COMPATIBILITY_IMPORT_V1_INNER_SCHEMA"],
    ["encode_entity_command_batch_v1", "ENTITY_COMMAND_V1_MAGIC", "ENTITY_COMMAND_V1_INNER_SCHEMA"],
    ["encode_entity_event_batch_v1", "ENTITY_RECEIPT_V1_MAGIC", "ENTITY_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_runtime_basic_dirt_action_receipt_query_v1", "BASIC_DIRT_ACTION_RECEIPT_V1_MAGIC", "BASIC_DIRT_ACTION_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_runtime_basic_dirt_action_projection_receipt_v1", "BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_MAGIC", "BASIC_DIRT_ACTION_PROJECTION_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_runtime_native_block_edit_receipt_query_v1", "NATIVE_BLOCK_EDIT_RECEIPT_V1_MAGIC", "NATIVE_BLOCK_EDIT_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_runtime_native_block_edit_projection_receipt_v1", "NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V1_MAGIC", "NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_runtime_native_block_edit_receipt_query_v2", "NATIVE_BLOCK_EDIT_RECEIPT_V2_MAGIC", "NATIVE_BLOCK_EDIT_RECEIPT_V2_INNER_SCHEMA"],
    ["encode_runtime_native_block_edit_projection_receipt_v2", "NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V2_MAGIC", "NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_V2_INNER_SCHEMA"],
    ["encode_runtime_native_player_drop_receipt_query_v1", "NATIVE_PLAYER_DROP_RECEIPT_V1_MAGIC", "NATIVE_PLAYER_DROP_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_runtime_native_player_drop_projection_receipt_v1", "NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_V1_MAGIC", "NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_runtime_native_drop_pickup_receipt_query_v1", "NATIVE_DROP_PICKUP_RECEIPT_V1_MAGIC", "NATIVE_DROP_PICKUP_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_runtime_native_drop_pickup_projection_receipt_v1", "NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_V1_MAGIC", "NATIVE_DROP_PICKUP_PROJECTION_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_player_inventory_import_v1", "PLAYER_INVENTORY_IMPORT_V1_MAGIC", "PLAYER_INVENTORY_IMPORT_V1_INNER_SCHEMA"],
    ["encode_player_inventory_import_receipt_v1", "PLAYER_INVENTORY_IMPORT_RECEIPT_V1_MAGIC", "PLAYER_INVENTORY_IMPORT_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_player_locator_item_consume_v1", "PLAYER_LOCATOR_ITEM_CONSUME_V1_MAGIC", "PLAYER_LOCATOR_ITEM_CONSUME_V1_INNER_SCHEMA"],
    ["encode_player_locator_item_consume_receipt_v1", "PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_V1_MAGIC", "PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_player_creative_slot_set_v1", "PLAYER_CREATIVE_SLOT_SET_V1_MAGIC", "PLAYER_CREATIVE_SLOT_SET_V1_INNER_SCHEMA"],
    ["encode_player_creative_slot_set_receipt_v1", "PLAYER_CREATIVE_SLOT_SET_RECEIPT_V1_MAGIC", "PLAYER_CREATIVE_SLOT_SET_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_content_install_page_v1", "CONTENT_INSTALL_PAGE_V1_MAGIC", "CONTENT_INSTALL_PAGE_V1_INNER_SCHEMA"],
    ["encode_content_install_receipt_v1", "CONTENT_INSTALL_RECEIPT_V1_MAGIC", "CONTENT_INSTALL_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_gameplay_actor_grant_v1", "GAMEPLAY_ACTOR_GRANT_V1_MAGIC", "GAMEPLAY_ACTOR_GRANT_V1_INNER_SCHEMA"],
    ["encode_gameplay_batch_v1", "GAMEPLAY_COMMAND_V1_MAGIC", "GAMEPLAY_COMMAND_V1_INNER_SCHEMA"],
    ["encode_gameplay_receipt_v1", "GAMEPLAY_RECEIPT_V1_MAGIC", "GAMEPLAY_RECEIPT_V1_INNER_SCHEMA"],
    ["encode_runtime_persistence_dispatch_v1", "PERSISTENCE_DISPATCH_V1_MAGIC", "PERSISTENCE_DISPATCH_V1_INNER_SCHEMA"],
    ["encode_runtime_persistence_dispatch_receipt_v1", "PERSISTENCE_DISPATCH_RECEIPT_V1_MAGIC", "PERSISTENCE_DISPATCH_RECEIPT_V1_INNER_SCHEMA"],
  ]) {
    const source = rustCodecSource(functionName);
    assert.match(source, new RegExp(`wrap_schema\\([\\s\\S]*?${magic},[\\s\\S]*?${innerSchema},`, "u"));
  }
  assert.doesNotMatch(
    engineWireSource,
    /const (?:ENTITY_(?:AUTHORITY|COMPATIBILITY|COMMAND|RECEIPT)|GAMEPLAY_(?:GRANT|COMMAND|RECEIPT)|PERSISTENCE_DISPATCH|CONTENT_INSTALL|BASIC_DIRT_ACTION|NATIVE_(?:BLOCK_EDIT|DROP_PICKUP|PLAYER_DROP)|PLAYER_(?:INVENTORY_IMPORT|LOCATOR_ITEM_CONSUME|CREATIVE_SLOT_SET)).*MAGIC/u,
  );
  assert.doesNotMatch(engineWireSource, /"blockwild\.(?:entities|gameplay|persistence)\./u);
  assert.match(
    entityTypeScriptSource,
    /rustIntegratedRuntimeDomainWireFamilyV1\(\s*"entity-compatibility-import-v1"/u,
  );
  assert.match(entityTypeScriptSource, /rustIntegratedRuntimeDomainWireFamilyV1\("entity-receipt-v1"\)/u);
  assert.match(
    entityTypeScriptSource,
    /RUST_INTEGRATED_ENTITY_COMPATIBILITY_IMPORT_TYPE_V1 = ENTITY_COMPATIBILITY_IMPORT_SCHEMA_V1\.typeId/u,
  );
  assert.match(
    entityTypeScriptSource,
    /operation\.schema !== ENTITY_EVENT_RECEIPT_SCHEMA_V1\.operationSchema/u,
  );
  assert.doesNotMatch(entityTypeScriptSource, /Uint8Array\.of\(0x42, 0x57, 0x(?:49|41), 0x(?:35|36)\)/u);
  assert.doesNotMatch(entityTypeScriptSource, /"blockwild\.entities\./u);
  assert.match(
    playerBootstrapTypeScriptSource,
    /domain: "entities",[\s\S]*?schema: ENTITY_COMPATIBILITY_IMPORT_SCHEMA_V1\.operationSchema/u,
  );
  assert.match(entitySnapshotSource, /ENTITY_AUTHORITY_SNAPSHOT_SCHEMA: u16 = 2;/u);
  assert.match(entitySnapshotSource, /AUTHORITY_MAGIC: &\[u8; 4\] = b"BWEA";/u);
  assert.match(wasmSource, /fn final_combat_bind_ack[\s\S]*?encode_runtime_player_final_bind_receipt_v1\([\s\S]*?RuntimePlayerFinalBindVersionV1::CombatV4/u);
});

test("the R9 manifest type registry exactly covers every Wasm Network dispatch arm", () => {
  const manifest = sourceManifest();
  const r9 = manifest.domains.find((domain) => domain.phase === "R9");
  const domainSource = readFileSync(
    path.join(root, "engine/crates/blockwild-runtime-wire/src/domain.rs"),
    "utf8",
  );
  const wasmSource = readFileSync(
    path.join(root, "engine/crates/blockwild-wasm/src/integrated_runtime.rs"),
    "utf8",
  );
  const typeIds = new Map([...domainSource.matchAll(
    /pub const (NETWORK_[A-Z0-9_]+_TYPE_V1): &str = "([^"]+)";/gu,
  )].map((match) => [match[1], match[2]]));
  const requestConstants = [...wasmSource.matchAll(
    /\(RuntimeDomainV1::Network,\s*(NETWORK_[A-Z0-9_]+_TYPE_V1)\)\s*=>/gu,
  )].map((match) => match[1]);
  const receiptConstants = [...wasmSource.matchAll(
    /domain_operation\(\s*RuntimeDomainV1::Network,\s*(NETWORK_[A-Z0-9_]+_TYPE_V1)/gu,
  )].map((match) => match[1]);

  assert.equal(requestConstants.length, 9, "the Network dispatch registry changed without a schema update");
  assert.equal(receiptConstants.length, 9, "the Network receipt registry changed without a schema update");
  assert.deepEqual(
    requestConstants.map((name) => typeIds.get(name)).sort(),
    r9.families.requests.map((family) => family.typeId).sort(),
  );
  assert.deepEqual(
    receiptConstants.map((name) => typeIds.get(name)).sort(),
    r9.families.receipts.map((family) => family.typeId).sort(),
  );
});

test("the schema verifier CLI accepts the completed domain-operation manifest in strict mode", () => {
  const packageData = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageData.scripts["verify:rust-schema-convergence"],
    "node scripts/generate-integrated-runtime-domain-schema.mjs --check && node scripts/verify-integrated-runtime-schema-convergence.mjs --require-complete");
  const accepted = spawnSync(process.execPath, ["scripts/verify-integrated-runtime-schema-convergence.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).complete, true);

  const strict = spawnSync(process.execPath, [
    "scripts/verify-integrated-runtime-schema-convergence.mjs",
    "--require-complete",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(strict.status, 0, strict.stderr);
  assert.equal(JSON.parse(strict.stdout).valid, true);
  assert.equal(JSON.parse(strict.stdout).complete, true);
});

test("the schema verifier still accepts explicit partial evidence but strict mode fails closed", () => {
  const source = sourceManifest();
  source.domains[1].assurance.hashes.status = "partial";
  source.domains[1].completion = { status: "partial", complete: false, remaining: ["synthetic-semantic-hash-gap"] };
  const fixture = path.join(tmpdir(), `blockwild-schema-partial-${randomUUID()}.json`);
  writeFileSync(fixture, JSON.stringify(source), "utf8");
  try {
    for (const strict of [false, true]) {
      const result = spawnSync(process.execPath, [
        "scripts/verify-integrated-runtime-schema-convergence.mjs", "--manifest", fixture,
        ...(strict ? ["--require-complete"] : []),
      ], { cwd: root, encoding: "utf8" });
      assert.equal(result.status, strict ? 1 : 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.valid, true);
      assert.equal(report.complete, false);
      assert.equal(report.completeDomains, 4);
      assert.deepEqual(report.partialDomains, ["R6/entities"]);
    }
  } finally {
    unlinkSync(fixture);
  }
});

test("schema convergence rejects malformed exact shapes and duplicate rows or families", async (t) => {
  const cases = [
    ["extra root field", (source) => { source.note = "not in schema v1"; }, /exact schema-v1 root shape/],
    ["duplicate domain", (source) => { source.domains[1] = structuredClone(source.domains[0]); }, /domain rows contain duplicates/],
    ["duplicate family", (source) => {
      source.domains[0].families.requests.push(structuredClone(source.domains[0].families.requests[0]));
    }, /duplicate family ids/],
    ["cross-domain duplicate family", (source) => {
      source.domains[1].families.requests[0].id = source.domains[0].families.requests[0].id;
    }, /not globally unique across R5-R9/],
    ["wrong family direction", (source) => {
      source.domains[0].families.requests[0].direction = "receipt";
    }, /direction must equal request/],
  ];
  for (const [name, mutate, expected] of cases) {
    await t.test(name, async () => {
      const report = await verifyMutation(mutate);
      assert.equal(report.valid, false);
      assert.match(report.blockers.join("\n"), expected);
    });
  }
});

test("schema convergence rejects nonportable, missing, or wrongly classified evidence paths", async (t) => {
  const cases = [
    ["nonportable", (source) => { source.domains[0].canonicalPaths.typescript[0] = "../outside.ts"; }, /not a portable repository-relative path/],
    ["missing", (source) => { source.domains[0].canonicalPaths.typescript[0] = "app/game/definitely-missing-schema.ts"; }, /is missing/],
    ["fixture class", (source) => { source.domains[0].evidence.fixtures[0] = "tests/rust-simulation-contract.test.ts"; }, /wrong evidence class/],
    ["test class", (source) => { source.domains[0].evidence.tests[0] = "tests/fixtures/rust-engine/r5/simulation-input-hashes.json"; }, /wrong evidence class/],
  ];
  for (const [name, mutate, expected] of cases) {
    await t.test(name, async () => {
      const report = await verifyMutation(mutate);
      assert.equal(report.valid, false);
      assert.match(report.blockers.join("\n"), expected);
    });
  }
});

test("schema convergence requires non-empty test and fixture evidence for every domain", async (t) => {
  for (const [name, slot] of [["fixtures", "fixtures"], ["tests", "tests"]]) {
    await t.test(name, async () => {
      const report = await verifyMutation((source) => { source.domains[2].evidence[slot] = []; });
      assert.equal(report.valid, false);
      assert.match(report.blockers.join("\n"), new RegExp(`R7/gameplay\\.evidence\\.${slot} must be a non-empty`));
    });
  }
});

test("schema convergence rejects bogus completion claims", async (t) => {
  await t.test("partial assurance", async () => {
    const report = await verifyMutation((source) => {
      source.domains[0].assurance.bounds.status = "partial";
      source.domains[0].completion = { status: "complete", complete: true, remaining: [] };
    });
    assert.equal(report.valid, false);
    assert.match(report.blockers.join("\n"), /claims completion without verified bounds, hashes, and fingerprint/);
  });

  await t.test("unmapped family", async () => {
    const report = await verifyMutation((source) => {
      const domain = source.domains[0];
      domain.assurance.bounds.status = "verified";
      domain.completion = { status: "complete", complete: true, remaining: [] };
      domain.families.requests[0].magic = null;
      domain.families.requests[0].normalPath = false;
    });
    assert.equal(report.valid, false);
    assert.match(report.blockers.join("\n"), /claims completion with an unmapped family descriptor/);
  });

  await t.test("partial row without a concrete gap", async () => {
    const report = await verifyMutation((source) => {
      source.domains[1].completion = { status: "partial", complete: false, remaining: [] };
    });
    assert.equal(report.valid, false);
    assert.match(report.blockers.join("\n"), /is partial but does not identify remaining work/);
  });
});

test("schema convergence detects fingerprint drift", async () => {
  const report = await verifyMutation((source) => { source.protocol.runtimeSchema += 1; }, { refreshFingerprint: false });
  assert.equal(report.valid, false);
  assert.equal(report.fingerprint.valid, false);
  assert.match(report.blockers.join("\n"), /manifest fingerprint drift detected/);
});

test("schema fingerprint seals the wire contract without evidence-bookkeeping churn", () => {
  const source = sourceManifest();
  const baseline = integratedRuntimeSchemaFingerprint(source);
  const bookkeeping = structuredClone(source);
  bookkeeping.protocol.requestEnvelope.canonicalRustPath = "engine/crates/example/src/codec.rs";
  bookkeeping.domains[0].canonicalPaths.rust = ["engine/crates/example/src/domain.rs"];
  bookkeeping.domains[0].evidence.tests.push("tests/example.test.ts");
  bookkeeping.domains[0].assurance.bounds.status = "verified";
  bookkeeping.domains[0].completion.remaining.push("more-byte-evidence");
  assert.equal(integratedRuntimeSchemaFingerprint(bookkeeping), baseline);

  const wireChange = structuredClone(source);
  wireChange.domains[0].families.requests[0].innerSchema += 1;
  assert.notEqual(integratedRuntimeSchemaFingerprint(wireChange), baseline);
});
