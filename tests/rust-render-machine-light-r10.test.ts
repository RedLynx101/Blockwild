import assert from "node:assert/strict";
import test from "node:test";

import {
  composeRustRenderMachineLightR10,
  snapshotRustRenderMachineLightSourceR10,
  type RustRenderMachineLightSourceR10,
} from "../app/game/rust-render-machine-light-r10.ts";
import type {
  RenderCameraV2,
  RenderEnvironmentV2,
} from "../app/game/rust-render-extraction-v2.ts";

const CAMERA = Object.freeze({
  position: Object.freeze([0, 4, 0] as const),
  orientation: Object.freeze([0, 0, 0, 1] as const),
  verticalFovRadians: 1,
  near: 0.1,
  far: 512,
  viewport: Object.freeze([1_280, 720] as const),
}) satisfies RenderCameraV2;

function environment(withLighting = true): RenderEnvironmentV2 {
  return Object.freeze({
    clearRgba8: Object.freeze([80, 130, 170, 255] as const),
    ambientRgb8: Object.freeze([160, 170, 180] as const),
    ambientIntensity: 0.7,
    sunDirection: Object.freeze([0.2, 0.8, 0.4] as const),
    sunRgb8: Object.freeze([255, 238, 200] as const),
    sunIntensity: 0.9,
    fogRgb8: Object.freeze([80, 130, 170] as const),
    fogNear: 24,
    fogFar: 220,
    underwater: 0,
    caveOcclusion: 0,
    ...(withLighting ? {
      lighting: Object.freeze({
        blockIntensity: 1.35,
        minimumAmbient: 0.026,
        waterPhase: 0.375,
        held: Object.freeze({
          position: Object.freeze([1, 2, 3] as const),
          colorRgb8: Object.freeze([255, 116, 40] as const),
          intensity: 0.72,
          radius: 9,
        }),
        // This compatibility-shell value must never survive R10 composition.
        machine: Object.freeze({
          position: Object.freeze([777, 778, 779] as const),
          colorRgb8: Object.freeze([1, 2, 3] as const),
          intensity: 99,
          radius: 98,
        }),
      }),
    } : {}),
  });
}

function machine(
  machineId: string,
  positionMilli: readonly [bigint, bigint, bigint],
  light: RustRenderMachineLightSourceR10["light"] = Object.freeze({
    kind: 0,
    colorMillionths: Object.freeze([1_000_000, 700_000, 300_000] as const),
    luminousFluxMillilumens: BigInt(900_000),
    rangeMilli: 12_000,
    innerConeMicroturns: 0,
    outerConeMicroturns: 0,
    castsShadows: false,
    enabled: true,
  }),
): RustRenderMachineLightSourceR10 {
  return Object.freeze({
    machineId,
    anchorRevision: BigInt(9),
    gameplayRevision: BigInt(12),
    positionMilli: Object.freeze([...positionMilli] as [bigint, bigint, bigint]),
    light,
  });
}

test("nearest exact point source replaces the shell slot with reviewed renderer units", () => {
  const source = environment();
  const farther = machine("machine:farther", [BigInt(8_000), BigInt(4_000), BigInt(0)]);
  const nearer = machine("machine:nearer", [BigInt(3_000), BigInt(4_000), BigInt(-4_000)]);
  const result = composeRustRenderMachineLightR10(source, CAMERA, [farther, nearer]);

  assert.deepEqual(result.environment.lighting?.machine, {
    position: [3, 4, -4],
    colorRgb8: [255, 179, 77],
    // One renderer intensity unit is one kilolumen: 900,000 millilumens -> 0.9.
    intensity: 0.9,
    radius: 12,
  });
  assert.deepEqual(result.environment.lighting?.held, source.lighting?.held);
  assert.deepEqual({
    blockIntensity: result.environment.lighting?.blockIntensity,
    minimumAmbient: result.environment.lighting?.minimumAmbient,
    waterPhase: result.environment.lighting?.waterPhase,
  }, { blockIntensity: 1.35, minimumAmbient: 0.026, waterPhase: 0.375 });
  assert.deepEqual(source.lighting?.machine.position, [777, 778, 779], "the source frame must stay untouched");
  assert.deepEqual(result.diagnostics, {
    schema: 1,
    status: "selected",
    sourcePresentations: 2,
    exactLightProfiles: 2,
    eligiblePointLights: 2,
    selectedMachineId: "machine:nearer",
    selectedAnchorRevision: BigInt(9),
    selectedGameplayRevision: BigInt(12),
    selectedCastsShadows: false,
    omitted: [{ machineId: "machine:farther", kind: 0, reason: "point-light-slot-budget" }],
  });
  assert.equal(Object.isFrozen(result.environment), true);
  assert.equal(Object.isFrozen(result.environment.lighting), true);
  assert.equal(Object.isFrozen(result.environment.lighting?.machine.position), true);
  assert.equal(Object.isFrozen(result.diagnostics.omitted), true);
});

test("equal-distance selection is canonical UTF-8 order and independent of source order", () => {
  const dragon = machine("machine:🐉", [BigInt(-3_000), BigInt(4_000), BigInt(-4_000)]);
  const ascii = machine("machine:a", [BigInt(3_000), BigInt(4_000), BigInt(4_000)]);
  const first = composeRustRenderMachineLightR10(environment(), CAMERA, [dragon, ascii]);
  const second = composeRustRenderMachineLightR10(environment(), CAMERA, [ascii, dragon]);

  assert.equal(first.diagnostics.selectedMachineId, "machine:a");
  assert.deepEqual(first, second);
  assert.deepEqual(first.diagnostics.omitted, [
    { machineId: "machine:🐉", kind: 0, reason: "point-light-slot-budget" },
  ]);
});

test("absent, disabled, shadow-casting, and unsupported exact profiles clear rather than inherit the shell light", () => {
  const disabledLight = Object.freeze({ ...machine("unused", [BigInt(0), BigInt(0), BigInt(0)]).light!, enabled: false });
  const spotLight = Object.freeze({
    ...machine("unused", [BigInt(0), BigInt(0), BigInt(0)]).light!,
    kind: 1,
    innerConeMicroturns: 50_000,
    outerConeMicroturns: 100_000,
  });
  const shadowLight = Object.freeze({
    ...machine("unused", [BigInt(0), BigInt(0), BigInt(0)]).light!,
    castsShadows: true,
  });
  const result = composeRustRenderMachineLightR10(environment(), CAMERA, [
    machine("machine:no-profile", [BigInt(0), BigInt(0), BigInt(0)], null),
    machine("machine:disabled", [BigInt(0), BigInt(0), BigInt(0)], disabledLight),
    machine("machine:shadow", [BigInt(0), BigInt(0), BigInt(0)], shadowLight),
    machine("machine:spot", [BigInt(0), BigInt(0), BigInt(0)], spotLight),
  ]);

  assert.deepEqual(result.environment.lighting?.machine, {
    position: [0, 0, 0], colorRgb8: [0, 0, 0], intensity: 0, radius: 0,
  });
  assert.equal(result.diagnostics.status, "cleared");
  assert.equal(result.diagnostics.selectedMachineId, null);
  assert.deepEqual(result.diagnostics.omitted, [
    { machineId: "machine:disabled", kind: 0, reason: "disabled" },
    { machineId: "machine:no-profile", kind: null, reason: "no-light-profile" },
    { machineId: "machine:shadow", kind: 0, reason: "unsupported-shadow" },
    { machineId: "machine:spot", kind: 1, reason: "unsupported-kind" },
  ]);

  const empty = composeRustRenderMachineLightR10(environment(), CAMERA, []);
  assert.equal(empty.diagnostics.status, "cleared");
  assert.deepEqual(empty.environment.lighting?.machine, result.environment.lighting?.machine);
});

test("missing lighting extension reports every otherwise eligible source and invents no base lighting", () => {
  const result = composeRustRenderMachineLightR10(environment(false), CAMERA, [
    machine("machine:b", [BigInt(1_000), BigInt(4_000), BigInt(0)]),
    machine("machine:a", [BigInt(-1_000), BigInt(4_000), BigInt(0)]),
  ]);

  assert.equal(result.environment.lighting, undefined);
  assert.deepEqual(result.diagnostics, {
    schema: 1,
    status: "lighting-extension-absent",
    sourcePresentations: 2,
    exactLightProfiles: 2,
    eligiblePointLights: 2,
    selectedMachineId: null,
    selectedAnchorRevision: null,
    selectedGameplayRevision: null,
    selectedCastsShadows: null,
    omitted: [
      { machineId: "machine:a", kind: 0, reason: "lighting-extension-absent" },
      { machineId: "machine:b", kind: 0, reason: "lighting-extension-absent" },
    ],
  });
});

test("accepted source snapshots detach mutable extractor-owned arrays before terrain composition", () => {
  const position: [bigint, bigint, bigint] = [BigInt(1_000), BigInt(2_000), BigInt(3_000)];
  const color: [number, number, number] = [1_000_000, 500_000, 0];
  const light = {
    kind: 0,
    colorMillionths: color,
    luminousFluxMillilumens: BigInt(500_000),
    rangeMilli: 8_000,
    innerConeMicroturns: 0,
    outerConeMicroturns: 0,
    castsShadows: false,
    enabled: true,
  };
  const snapshot = snapshotRustRenderMachineLightSourceR10({
    machineId: "machine:mutable-extractor",
    anchorRevision: BigInt(1),
    gameplayRevision: BigInt(2),
    positionMilli: position,
    light,
  });
  position[0] = BigInt(99_000);
  color[0] = 0;
  light.enabled = false;

  assert.deepEqual(snapshot.positionMilli, [BigInt(1_000), BigInt(2_000), BigInt(3_000)]);
  assert.deepEqual(snapshot.light?.colorMillionths, [1_000_000, 500_000, 0]);
  assert.equal(snapshot.light?.enabled, true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.positionMilli), true);
  assert.equal(Object.isFrozen(snapshot.light), true);
  assert.equal(Object.isFrozen(snapshot.light?.colorMillionths), true);
});
