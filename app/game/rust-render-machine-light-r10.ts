/**
 * Renderer-unit adapter for exact native machine-light presentations.
 *
 * BWX0 stores positions/ranges in millimetres, linear RGB in millionths, and
 * luminous flux in millilumens. BWRF's current local-light shader is unitless;
 * its reviewed contract is one intensity unit per kilolumen, so dividing the
 * native scalar by 1,000,000 is deliberate (900,000 millilumens -> 0.9), not a
 * claim that the shader performs physically based photometry.
 *
 * BWRF v2 has one non-shadowing machine point-light slot. Only native Point
 * profiles with castsShadows=false can inhabit it. Shadow-casting Point,
 * Spot, area, and emissive profiles remain explicit omissions until the
 * renderer protocol can preserve their semantics.
 */

import { compareCanonicalUtf8R10 } from "./rust-authoritative-extraction-r10.ts";
import type {
  RenderCameraV2,
  RenderEnvironmentV2,
  RenderPointLightV2,
} from "./rust-render-extraction-v2.ts";
import type {
  RustMachineLightPresentationR10,
  RustMachinePresentationR10,
} from "./rust-render-presentation-extraction-r10.ts";

const U64_MAX = BigInt("0xffffffffffffffff");
const COORDINATE_LIMIT_MILLI = BigInt(33_554_432_000);
const MILLILUMENS_PER_RENDER_INTENSITY = BigInt(1_000_000);
const FRACTION_SCALE = 1_000_000;
const POINT_LIGHT_KIND = 0;

export type RustRenderMachineLightSourceR10 = Readonly<Pick<
  RustMachinePresentationR10,
  "machineId" | "anchorRevision" | "gameplayRevision" | "positionMilli" | "light"
>>;

export type RustRenderMachineLightOmissionReasonR10 =
  | "no-light-profile"
  | "disabled"
  | "unsupported-kind"
  | "unsupported-shadow"
  | "point-light-slot-budget"
  | "lighting-extension-absent";

export type RustRenderMachineLightOmissionR10 = Readonly<{
  machineId: string;
  kind: number | null;
  reason: RustRenderMachineLightOmissionReasonR10;
}>;

export type RustRenderMachineLightDiagnosticsR10 = Readonly<{
  schema: 1;
  status: "not-composed" | "selected" | "cleared" | "lighting-extension-absent";
  sourcePresentations: number;
  exactLightProfiles: number;
  eligiblePointLights: number;
  selectedMachineId: string | null;
  selectedAnchorRevision: bigint | null;
  selectedGameplayRevision: bigint | null;
  selectedCastsShadows: boolean | null;
  omitted: readonly RustRenderMachineLightOmissionR10[];
}>;

export type RustRenderMachineLightCompositionR10 = Readonly<{
  environment: RenderEnvironmentV2;
  diagnostics: RustRenderMachineLightDiagnosticsR10;
}>;

export const RUST_RENDER_MACHINE_LIGHT_NOT_COMPOSED_R10: RustRenderMachineLightDiagnosticsR10 = Object.freeze({
  schema: 1,
  status: "not-composed",
  sourcePresentations: 0,
  exactLightProfiles: 0,
  eligiblePointLights: 0,
  selectedMachineId: null,
  selectedAnchorRevision: null,
  selectedGameplayRevision: null,
  selectedCastsShadows: null,
  omitted: Object.freeze([]),
});

const CLEARED_MACHINE_LIGHT: RenderPointLightV2 = Object.freeze({
  position: Object.freeze([0, 0, 0] as const),
  colorRgb8: Object.freeze([0, 0, 0] as const),
  intensity: 0,
  radius: 0,
});

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function validateSource(source: RustRenderMachineLightSourceR10) {
  invariant(typeof source.machineId === "string" && source.machineId.length > 0,
    "machine light source id is empty");
  invariant(typeof source.anchorRevision === "bigint" && source.anchorRevision >= BigInt(0)
    && source.anchorRevision <= U64_MAX, `machine light '${source.machineId}' anchor revision is invalid`);
  invariant(typeof source.gameplayRevision === "bigint" && source.gameplayRevision >= BigInt(0)
    && source.gameplayRevision <= U64_MAX, `machine light '${source.machineId}' gameplay revision is invalid`);
  invariant(source.positionMilli.length === 3 && source.positionMilli.every((value) => typeof value === "bigint"
    && (value < BigInt(0) ? -value : value) <= COORDINATE_LIMIT_MILLI),
  `machine light '${source.machineId}' position is invalid`);
  if (source.light === null) return;
  const light = source.light;
  invariant(Number.isInteger(light.kind) && light.kind >= 0 && light.kind <= 3,
    `machine light '${source.machineId}' kind is invalid`);
  invariant(light.colorMillionths.length === 3 && light.colorMillionths.every((value) => Number.isInteger(value)
    && value >= 0 && value <= FRACTION_SCALE), `machine light '${source.machineId}' color is invalid`);
  invariant(typeof light.luminousFluxMillilumens === "bigint" && light.luminousFluxMillilumens > BigInt(0)
    && light.luminousFluxMillilumens <= U64_MAX, `machine light '${source.machineId}' flux is invalid`);
  invariant(Number.isInteger(light.rangeMilli) && light.rangeMilli > 0 && light.rangeMilli <= 1_024_000,
    `machine light '${source.machineId}' range is invalid`);
  invariant(Number.isInteger(light.innerConeMicroturns) && Number.isInteger(light.outerConeMicroturns)
    && light.innerConeMicroturns >= 0 && light.innerConeMicroturns <= light.outerConeMicroturns
    && light.outerConeMicroturns <= 500_000
    && (light.kind === 1 || light.innerConeMicroturns === 0 && light.outerConeMicroturns === 0),
  `machine light '${source.machineId}' cone is invalid`);
  invariant(typeof light.castsShadows === "boolean" && typeof light.enabled === "boolean",
    `machine light '${source.machineId}' flags are invalid`);
}

/** Detaches a validated source from an injected extractor or Worker envelope. */
export function snapshotRustRenderMachineLightSourceR10(
  source: RustRenderMachineLightSourceR10,
): RustRenderMachineLightSourceR10 {
  validateSource(source);
  return Object.freeze({
    machineId: source.machineId,
    anchorRevision: source.anchorRevision,
    gameplayRevision: source.gameplayRevision,
    positionMilli: Object.freeze([...source.positionMilli] as [bigint, bigint, bigint]),
    light: source.light === null ? null : Object.freeze({
      ...source.light,
      colorMillionths: Object.freeze([...source.light.colorMillionths] as [number, number, number]),
    }),
  });
}

function worldPosition(source: RustRenderMachineLightSourceR10) {
  return Object.freeze(source.positionMilli.map((value) => Number(value) / 1_000) as [number, number, number]);
}

function linearMillionthsToRgb8(value: readonly [number, number, number]) {
  const channels = value.map((channel) =>
    Math.floor((channel * 255 + FRACTION_SCALE / 2) / FRACTION_SCALE)) as [number, number, number];
  return Object.freeze(channels);
}

function rendererIntensity(light: RustMachineLightPresentationR10) {
  const whole = Number(light.luminousFluxMillilumens / MILLILUMENS_PER_RENDER_INTENSITY);
  const remainder = Number(light.luminousFluxMillilumens % MILLILUMENS_PER_RENDER_INTENSITY)
    / Number(MILLILUMENS_PER_RENDER_INTENSITY);
  return whole + remainder;
}

function pointLight(source: RustRenderMachineLightSourceR10): RenderPointLightV2 {
  const light = source.light;
  invariant(light !== null && light.enabled && light.kind === POINT_LIGHT_KIND && !light.castsShadows,
    `machine light '${source.machineId}' is not an eligible point light`);
  return Object.freeze({
    position: worldPosition(source),
    colorRgb8: linearMillionthsToRgb8(light.colorMillionths),
    intensity: rendererIntensity(light),
    radius: light.rangeMilli / 1_000,
  });
}

function omission(
  source: RustRenderMachineLightSourceR10,
  reason: RustRenderMachineLightOmissionReasonR10,
): RustRenderMachineLightOmissionR10 {
  return Object.freeze({ machineId: source.machineId, kind: source.light?.kind ?? null, reason });
}

function safeEnvironment(environment: RenderEnvironmentV2, machine: RenderPointLightV2): RenderEnvironmentV2 {
  const lighting = environment.lighting;
  invariant(lighting !== undefined, "machine light composition requires the BWRF lighting extension");
  return Object.freeze({
    ...environment,
    lighting: Object.freeze({
      blockIntensity: lighting.blockIntensity,
      minimumAmbient: lighting.minimumAmbient,
      waterPhase: lighting.waterPhase,
      held: Object.freeze({
        position: Object.freeze([...lighting.held.position] as [number, number, number]),
        colorRgb8: Object.freeze([...lighting.held.colorRgb8] as [number, number, number]),
        intensity: lighting.held.intensity,
        radius: lighting.held.radius,
      }),
      machine,
    }),
  });
}

function diagnostics(
  status: RustRenderMachineLightDiagnosticsR10["status"],
  sources: readonly RustRenderMachineLightSourceR10[],
  exactLightProfiles: number,
  eligible: readonly RustRenderMachineLightSourceR10[],
  selected: RustRenderMachineLightSourceR10 | null,
  omitted: readonly RustRenderMachineLightOmissionR10[],
): RustRenderMachineLightDiagnosticsR10 {
  return Object.freeze({
    schema: 1,
    status,
    sourcePresentations: sources.length,
    exactLightProfiles,
    eligiblePointLights: eligible.length,
    selectedMachineId: selected?.machineId ?? null,
    selectedAnchorRevision: selected?.anchorRevision ?? null,
    selectedGameplayRevision: selected?.gameplayRevision ?? null,
    selectedCastsShadows: selected?.light?.castsShadows ?? null,
    omitted: Object.freeze([...omitted].sort((left, right) => compareCanonicalUtf8R10(left.machineId, right.machineId))),
  });
}

/**
 * Replaces BWRF's compatibility-shell machine slot from exact BWX0 machine
 * presentations. The source slot is always cleared when no exact,
 * non-shadowing Point source can be selected, so a stale TypeScript light
 * cannot survive composition.
 */
export function composeRustRenderMachineLightR10(
  environment: RenderEnvironmentV2,
  camera: Pick<RenderCameraV2, "position">,
  values: readonly RustRenderMachineLightSourceR10[],
): RustRenderMachineLightCompositionR10 {
  invariant(camera.position.length === 3 && camera.position.every(Number.isFinite),
    "machine light camera position is invalid");
  const sources = [...values].sort((left, right) => compareCanonicalUtf8R10(left.machineId, right.machineId));
  const seen = new Set<string>();
  const eligible: RustRenderMachineLightSourceR10[] = [];
  const omitted: RustRenderMachineLightOmissionR10[] = [];
  let exactLightProfiles = 0;
  for (const source of sources) {
    validateSource(source);
    invariant(!seen.has(source.machineId), `machine light source '${source.machineId}' is duplicated`);
    seen.add(source.machineId);
    if (source.light === null) {
      omitted.push(omission(source, "no-light-profile"));
      continue;
    }
    exactLightProfiles += 1;
    if (!source.light.enabled) {
      omitted.push(omission(source, "disabled"));
    } else if (source.light.kind !== POINT_LIGHT_KIND) {
      omitted.push(omission(source, "unsupported-kind"));
    } else if (source.light.castsShadows) {
      omitted.push(omission(source, "unsupported-shadow"));
    } else {
      eligible.push(source);
    }
  }

  if (environment.lighting === undefined) {
    for (const source of eligible) omitted.push(omission(source, "lighting-extension-absent"));
    return Object.freeze({
      environment: Object.freeze({ ...environment }),
      diagnostics: diagnostics("lighting-extension-absent", sources, exactLightProfiles, eligible, null, omitted),
    });
  }

  const distanceSquared = (source: RustRenderMachineLightSourceR10) => {
    const position = worldPosition(source);
    const dx = position[0] - camera.position[0];
    const dy = position[1] - camera.position[1];
    const dz = position[2] - camera.position[2];
    return dx * dx + dy * dy + dz * dz;
  };
  eligible.sort((left, right) => distanceSquared(left) - distanceSquared(right)
    || compareCanonicalUtf8R10(left.machineId, right.machineId));
  const selected = eligible[0] ?? null;
  for (const source of eligible.slice(1)) omitted.push(omission(source, "point-light-slot-budget"));
  return Object.freeze({
    environment: safeEnvironment(environment, selected === null ? CLEARED_MACHINE_LIGHT : pointLight(selected)),
    diagnostics: diagnostics(selected === null ? "cleared" : "selected",
      sources, exactLightProfiles, eligible, selected, omitted),
  });
}
