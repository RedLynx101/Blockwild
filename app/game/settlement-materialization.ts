import type { SettlementCandidate, SettlementLayoutPlan } from "./settlements";
import type { GuildHallPlacement } from "./guilds";

export type SettlementMaterializationColumn = Readonly<{ height: number; waterline: number }>;
export type SettlementMaterializationSampler = (x: number, z: number) => SettlementMaterializationColumn;

function settlementMaterializationHash2(x: number, z: number, seed: number) {
  let value = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

/** Applies the same deterministic guild parcel expansion used by stamping. */
export function applySettlementGuildHallMaterializationV1(
  candidate: SettlementCandidate,
  layout: SettlementLayoutPlan,
  hall: GuildHallPlacement | null,
  numericSeed: number,
) {
  if (!hall) return layout;
  const replaceable = layout.buildings.filter((building) => ![
    "mayor-hall", "tide-hall", "sugar-palace", "moonbough-hall", "deepgear-hall", "guardhouse", "entrance-barracks",
  ].includes(building.role));
  const replacement = replaceable[Math.floor(settlementMaterializationHash2(
    candidate.center.x,
    candidate.center.z,
    numericSeed ^ 0x71a11,
  ) * Math.max(1, replaceable.length))] ?? layout.buildings.at(-1);
  if (!replacement) return layout;
  return Object.freeze({
    ...layout,
    buildings: Object.freeze(layout.buildings.map((building) => building.id !== replacement.id ? building : Object.freeze({
      ...building,
      width: Math.max(7, building.width),
      depth: Math.max(7, building.depth),
      materialPalette: Object.freeze([...building.materialPalette, `guild:${hall.guildId}`, `hall-state:${hall.state}`]),
      furniture: Object.freeze([
        ...building.furniture,
        { kind: "table" as const, position: building.position, facing: building.facing, functional: true },
        { kind: "chair" as const, position: { ...building.position, x: building.position.x + 2 }, facing: ((building.facing + 2) & 3) as 0 | 1 | 2 | 3, functional: true },
        { kind: "chair" as const, position: { ...building.position, x: building.position.x - 2 }, facing: building.facing, functional: true },
      ]),
      guildHall: Object.freeze({
        placementId: hall.id,
        guildId: hall.guildId,
        state: hall.state,
        variantId: hall.variantId,
      }),
    }))),
  });
}

/**
 * Fits an aquatic settlement to the water volume at every authored point.
 * Legacy generation, rollback origin planning, and the promotion oracle share
 * this production function. Rust retains an independent implementation.
 */
export function fitUnderwaterSettlementLayoutV1(
  layout: SettlementLayoutPlan,
  sample: SettlementMaterializationSampler,
): SettlementLayoutPlan | null {
  if (layout.environment !== "underwater") return layout;
  let invalid = false;
  const clampWaterPoint = <T extends Readonly<{ x: number; z: number; y?: number }>>(point: T): T => {
    const column = sample(point.x, point.z);
    const minimum = column.height + 1;
    const maximum = column.waterline - 1;
    if (minimum > maximum) invalid = true;
    const requested = point.y ?? minimum;
    return { ...point, y: Math.max(minimum, Math.min(maximum, requested)) };
  };
  const buildings = layout.buildings.map((building) => {
    const halfWidth = Math.floor(building.width / 2);
    const halfDepth = Math.floor(building.depth / 2);
    let highestBed = Number.NEGATIVE_INFINITY;
    let lowestSurface = Number.POSITIVE_INFINITY;
    for (let x = building.position.x - halfWidth; x <= building.position.x + halfWidth; x += 1) {
      for (let z = building.position.z - halfDepth; z <= building.position.z + halfDepth; z += 1) {
        const column = sample(x, z);
        highestBed = Math.max(highestBed, column.height);
        lowestSurface = Math.min(lowestSurface, column.waterline);
      }
    }
    const roofRise = Math.min(5, building.floors * 3 + 1);
    const minimumY = highestBed + 2;
    const maximumY = lowestSurface - roofRise;
    if (minimumY > maximumY) invalid = true;
    const previousY = building.position.y ?? minimumY;
    const positionY = Math.max(minimumY, Math.min(maximumY, previousY));
    const deltaY = positionY - previousY;
    return {
      ...building,
      position: { ...building.position, y: positionY },
      furniture: building.furniture.map((furniture) => ({
        ...furniture,
        position: clampWaterPoint({
          ...furniture.position,
          y: (furniture.position.y ?? previousY) + deltaY,
        }),
      })),
    };
  });
  if (invalid) return null;
  const center = clampWaterPoint(layout.center);
  const paths = layout.paths.map(clampWaterPoint);
  const approaches = layout.approaches.map((approach) => ({
    ...approach,
    position: clampWaterPoint(approach.position),
  }));
  const lights = layout.lights.map((light) => ({
    ...light,
    position: clampWaterPoint(light.position),
  }));
  const centerColumn = sample(center.x, center.z);
  const minimumLayer = centerColumn.height + 1;
  const maximumLayer = centerColumn.waterline - 1;
  const verticalLayers = layout.verticalLayers.map((layer) => ({
    ...layer,
    y: Math.max(minimumLayer, Math.min(maximumLayer, layer.y)),
  }));
  if (invalid || minimumLayer > maximumLayer) return null;
  return { ...layout, center, buildings, paths, approaches, lights, verticalLayers };
}

/** Mirrors the exact pre-stamp order: layout, guild parcel, aquatic fit. */
export function materializeSettlementLayoutV1(
  candidate: SettlementCandidate,
  layout: SettlementLayoutPlan,
  sample: SettlementMaterializationSampler,
  hall: GuildHallPlacement | null,
  numericSeed: number,
) {
  return fitUnderwaterSettlementLayoutV1(
    applySettlementGuildHallMaterializationV1(candidate, layout, hall, numericSeed),
    sample,
  );
}

export type SettlementPublicArrivalV1 = Readonly<{
  layout: SettlementLayoutPlan;
  position: Readonly<{ x: number; y: number; z: number }>;
  anchorKind: "public-approach" | "reef-air-arrival" | "surface-entry";
}>;

/** Resolves a public arrival only after the full layout is materializable. */
export function materializeSettlementPublicArrivalV1(
  candidate: SettlementCandidate,
  layout: SettlementLayoutPlan,
  sample: SettlementMaterializationSampler,
  breathesWater: boolean,
  hall: GuildHallPlacement | null = null,
  numericSeed = 0,
): SettlementPublicArrivalV1 | null {
  const fitted = materializeSettlementLayoutV1(candidate, layout, sample, hall, numericSeed);
  if (!fitted) return null;
  const gate = fitted.gates[0];
  const publicAnchor = gate?.position ?? fitted.approaches[0]?.position ?? fitted.center;
  const offset = gate
    ? ([[0, -4], [4, 0], [0, 4], [-4, 0]] as const)[gate.facing]
    : [0, 0] as const;
  const x = Math.round(publicAnchor.x + offset[0]);
  const z = Math.round(publicAnchor.z + offset[1]);
  const column = sample(x, z);
  const environment = candidate.environment ?? "surface";
  const y = environment === "underwater" && breathesWater
    ? Math.max((candidate.floorY ?? column.height) + 2, publicAnchor.y ?? column.height + 2, column.height + 2)
    : environment === "underwater"
      ? column.waterline + 1.51
      : column.height + 1.51;
  const anchorKind = environment === "underground"
    ? "surface-entry"
    : environment === "underwater" && !breathesWater
      ? "reef-air-arrival"
      : "public-approach";
  return Object.freeze({
    layout: fitted,
    position: Object.freeze({ x, y, z }),
    anchorKind,
  });
}
