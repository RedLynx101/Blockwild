import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(
  path.join(root, "engine/schema/integrated-runtime-r5-r9.v1.json"),
  "utf8",
));
const familyCount = manifest.domains.reduce(
  (total, row) => total + row.families.requests.length + row.families.receipts.length,
  0,
);

test("R5-R9 generated Rust and TypeScript domain registries are current", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/generate-integrated-runtime-domain-schema.mjs", "--check"],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.match(output, /integrated-runtime-domain-schema=ok/u);
  assert.match(output, new RegExp(`families=${familyCount}`, "u"));
  assert.match(output, new RegExp(`fingerprint=${manifest.fingerprint.value}`, "u"));

  const typescript = readFileSync(
    path.join(root, "app/game/rust-integrated-runtime-domain-schema.generated.ts"),
    "utf8",
  );
  const rust = readFileSync(
    path.join(root, "engine/crates/blockwild-engine/src/runtime_domain_schema_generated.rs"),
    "utf8",
  );
  for (const source of [typescript, rust]) {
    assert.match(source, new RegExp(manifest.fingerprint.value, "u"));
    assert.match(source, /simulation-camera-config-v1/u);
    assert.match(source, /native-player-drop-projection-receipt-v1/u);
    assert.match(source, /network-peer-grant-v1/u);
  }
});

test("R7-R9 production TypeScript wire consumers use generated family descriptors", () => {
  const consumers = new Map([
    ["app/game/rust-integrated-runtime-basic-dirt-action.ts", [
      "basic-dirt-action-receipt-v1",
      "basic-dirt-action-projection-receipt-v1",
    ]],
    ["app/game/rust-integrated-runtime-content.ts", [
      "content-install-page-v1",
      "content-install-receipt-v1",
    ]],
    ["app/game/rust-integrated-runtime-native-block-edit.ts", [
      "native-block-edit-receipt-v1",
      "native-block-edit-projection-receipt-v1",
      "native-block-edit-receipt-v2",
      "native-block-edit-projection-receipt-v2",
    ]],
    ["app/game/rust-integrated-runtime-drop-pickup.ts", [
      "native-drop-pickup-receipt-v1",
      "native-drop-pickup-projection-receipt-v1",
    ]],
    ["app/game/rust-integrated-runtime-player-drop.ts", [
      "native-player-drop-receipt-v1",
      "native-player-drop-projection-receipt-v1",
    ]],
    ["app/game/rust-integrated-runtime-player-creative-slot.ts", [
      "player-creative-slot-set-v1",
      "player-creative-slot-set-receipt-v1",
    ]],
    ["app/game/rust-integrated-runtime-player-inventory.ts", [
      "player-inventory-import-v1",
      "player-inventory-import-receipt-v1",
    ]],
    ["app/game/rust-integrated-runtime-player-locator-consume.ts", [
      "player-locator-item-consume-v1",
      "player-locator-item-consume-receipt-v1",
    ]],
    ["app/game/rust-integrated-runtime-persistence.ts", [
      "persistence-dispatch-v1",
      "persistence-dispatch-receipt-v1",
    ]],
    ["app/game/rust-integrated-runtime-domain-adapters.ts", [
      "network-browser-request-v1",
      "network-browser-response-v1",
      "network-peer-grant-v1",
      "network-command-release-receipt-v1",
    ]],
  ]);
  const families = new Map(manifest.domains.flatMap((domain) => [
    ...domain.families.requests,
    ...domain.families.receipts,
  ]).map((family) => [family.id, family]));

  for (const [relativePath, familyIds] of consumers) {
    const source = readFileSync(path.join(root, relativePath), "utf8");
    assert.match(source, /rustIntegratedRuntimeDomainWireFamilyV1/u, relativePath);
    for (const familyId of familyIds) {
      const family = families.get(familyId);
      assert.ok(family, `unknown manifest family ${familyId}`);
      assert.ok(
        source.includes(`rustIntegratedRuntimeDomainWireFamilyV1("${familyId}")`),
        `${relativePath} does not select ${familyId}`,
      );
      assert.equal(
        source.includes(family.typeId),
        false,
        `${relativePath} duplicates ${familyId}'s generated type ID`,
      );
    }
  }

  for (const relativePath of [
    "app/game/rust-integrated-runtime-basic-dirt-action.ts",
    "app/game/rust-integrated-runtime-native-block-edit.ts",
    "app/game/rust-integrated-runtime-drop-pickup.ts",
    "app/game/rust-integrated-runtime-player-drop.ts",
    "app/game/rust-integrated-runtime-player-creative-slot.ts",
    "app/game/rust-integrated-runtime-player-locator-consume.ts",
    "app/game/rust-integrated-runtime-persistence.ts",
    "app/game/rust-integrated-runtime-domain-adapters.ts",
  ]) {
    const source = readFileSync(path.join(root, relativePath), "utf8");
    assert.match(source, /\.operationSchema/u, `${relativePath} must consume the outer schema`);
  }
});
