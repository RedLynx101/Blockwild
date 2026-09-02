import * as THREE from "three";
import { BLOCKS, POLLINATOR_FLOWERS, BlockId, type ItemCode, type Weather } from "./data";
import { BUTTERFLY_ANTENNA_CONTRACT } from "./model-specs";
import { BUTTERFLY_ORDER, MOB_DEFS, type ButterflyKind } from "./mobs";
import { BiomeId, CHUNK_SIZE, type ChunkWorld } from "./world";

export type ButterflySnapshot = {
  id: number;
  kind: ButterflyKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  landed: boolean;
  wing: number;
};

export type ButterflyCapture = {
  id: number;
  kind: ButterflyKind;
  item: ItemCode;
};

export type ButterflyEnvironment = {
  player: THREE.Vector3;
  daylight: number;
  weather: Weather;
  density: number;
  cap: number;
  smallEntities?: readonly THREE.Vector3[];
};

type ButterflyEntity = {
  id: number;
  kind: ButterflyKind;
  group: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  flower: THREE.Vector3;
  landed: boolean;
  stateTimer: number;
  age: number;
  phase: number;
};

export type ButterflyVisual = {
  group: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
};

const FLOWERS = new Set<BlockId>(POLLINATOR_FLOWERS);
const BUTTERFLY_BIOMES = new Set<BiomeId>([
  BiomeId.Meadow, BiomeId.Wildwood, BiomeId.Birchlight, BiomeId.Bloomwood,
  BiomeId.Savanna, BiomeId.Badlands, BiomeId.Frostpine, BiomeId.Snowfield,
  BiomeId.Siltfen, BiomeId.MushroomFen,
  BiomeId.Beach, BiomeId.RainveilJungle, BiomeId.SakurabloomGrove,
  BiomeId.SugarplumVale,
  BiomeId.Glimmerwood,
]);

export const BUTTERFLY_FLIGHT_TUNING = Object.freeze({
  seekFlowerChance: 0.24,
  flightSecondsMin: 3.1,
  flightSecondsRange: 4.8,
  landedSecondsMin: 0.4,
  landedSecondsRange: 1.25,
});

/** Butterfly geometry faces local -Z (its antennae point forward), so its
 * world yaw is the opposite of the common +Z-facing sprite formula. */
export function butterflyYawForVelocity(velocity: Pick<THREE.Vector3, "x" | "z">) {
  return Math.atan2(velocity.x, velocity.z) + Math.PI;
}

export function butterflyFlowerKey(position: Pick<THREE.Vector3, "x" | "y" | "z">) {
  return `${Math.round(position.x)},${Math.round(position.y)},${Math.round(position.z)}`;
}

export function butterflyKindForBiome(biome: BiomeId, roll = Math.random()): ButterflyKind | null {
  if (biome === BiomeId.Glimmerwood) return roll < 0.84 ? "moonveil-wing" : "fen-lantern";
  if (biome === BiomeId.SugarplumVale) return "bonbonwing";
  if (biome === BiomeId.SakurabloomGrove) return roll < 0.72 ? "bloom-monarch" : "azure-skippers";
  if (biome === BiomeId.RainveilJungle) return roll < 0.68 ? "fen-lantern" : "meadowwing";
  if (biome === BiomeId.Beach) return roll < 0.76 ? "meadowwing" : "embertip";
  if (biome === BiomeId.Bloomwood) return roll < 0.74 ? "bloom-monarch" : "azure-skippers";
  if (biome === BiomeId.Siltfen || biome === BiomeId.MushroomFen) return roll < 0.82 ? "fen-lantern" : "meadowwing";
  if (biome === BiomeId.Frostpine || biome === BiomeId.Snowfield) return "frostveil";
  if (biome === BiomeId.Savanna || biome === BiomeId.Badlands) return roll < 0.8 ? "embertip" : "meadowwing";
  if (biome === BiomeId.Birchlight || biome === BiomeId.Wildwood) return roll < 0.66 ? "azure-skippers" : "meadowwing";
  if (biome === BiomeId.Meadow) return roll < 0.72 ? "meadowwing" : roll < 0.9 ? "azure-skippers" : "bloom-monarch";
  return null;
}

export function butterflyCaptureAlongRay(
  snapshots: readonly Pick<ButterflySnapshot, "id" | "kind" | "x" | "y" | "z">[],
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  reach = 4.2,
) {
  let best: { id: number; forward: number } | null = null;
  for (const snapshot of snapshots) {
    const dx = snapshot.x - origin.x;
    const dy = snapshot.y - origin.y;
    const dz = snapshot.z - origin.z;
    const forward = dx * direction.x + dy * direction.y + dz * direction.z;
    if (forward < 0.15 || forward > reach) continue;
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    const radialSquared = distanceSquared - forward * forward;
    const captureRadius = 0.28 + forward * 0.025;
    if (radialSquared > captureRadius * captureRadius) continue;
    if (!best || forward < best.forward) best = { id: snapshot.id, forward };
  }
  return best?.id ?? null;
}

export type ButterflyWingPanelProfile = Readonly<{
  outward: number;
  z: number;
  scale: readonly [number, number, number];
  yaw: number;
}>;

const ORDINARY_WING_PANELS: readonly ButterflyWingPanelProfile[] = Object.freeze([
  { outward: 0.1, z: 0, scale: [1, 1, 1], yaw: 0 },
]);
const BONBONWING_PANELS: readonly ButterflyWingPanelProfile[] = Object.freeze([
  { outward: 0.095, z: -0.055, scale: [1.08, 1, 0.78], yaw: 0.1 },
  { outward: 0.08, z: 0.085, scale: [0.84, 1, 1.08], yaw: -0.12 },
]);

/** Shared by standalone, live, held and conservatory butterflies. */
export function butterflyWingPanelProfile(kind: ButterflyKind) {
  return kind === "bonbonwing" ? BONBONWING_PANELS : ORDINARY_WING_PANELS;
}

/** Standalone production butterfly used by held items and conservatories. */
export function createButterflyVisual(kind: ButterflyKind, id: string | number = kind): ButterflyVisual {
  const [wingColor, bodyColor, accentColor] = MOB_DEFS[kind].colors;
  const group = new THREE.Group();
  group.name = `butterfly-${kind}`;
  group.userData.butterflyId = id;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.17), new THREE.MeshLambertMaterial({ color: bodyColor }));
  body.name = `${kind}-body`;
  body.userData.butterflyId = id;
  group.add(body);
  const wingMaterial = new THREE.MeshLambertMaterial({ color: wingColor, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
  const wingGeometry = new THREE.BoxGeometry(0.2, 0.018, 0.14);
  const leftWing = new THREE.Group();
  const rightWing = new THREE.Group();
  leftWing.name = `${kind}-left-wing`;
  rightWing.name = `${kind}-right-wing`;
  leftWing.userData.wingSide = 1;
  rightWing.userData.wingSide = -1;
  leftWing.position.x = -0.035;
  rightWing.position.x = 0.035;
  for (const [pivot, side] of [[leftWing, -1], [rightWing, 1]] as const) {
    butterflyWingPanelProfile(kind).forEach((profile, panelIndex) => {
      const wing = new THREE.Mesh(wingGeometry, wingMaterial.clone());
      wing.name = `${kind}-${side < 0 ? "left" : "right"}-wing-panel${panelIndex ? `-${panelIndex + 1}` : ""}`;
      wing.position.set(side * profile.outward, 0, profile.z);
      wing.scale.set(...profile.scale);
      wing.rotation.y = side * profile.yaw;
      wing.userData.butterflyId = id;
      pivot.add(wing);
    });
  }
  wingMaterial.dispose();
  group.add(leftWing, rightWing);
  const antennaGeometry = new THREE.BoxGeometry(
    BUTTERFLY_ANTENNA_CONTRACT.thickness,
    BUTTERFLY_ANTENNA_CONTRACT.thickness,
    BUTTERFLY_ANTENNA_CONTRACT.length,
  );
  const tipSize = BUTTERFLY_ANTENNA_CONTRACT.thickness * BUTTERFLY_ANTENNA_CONTRACT.tipScale;
  const antennaTipGeometry = new THREE.BoxGeometry(tipSize, tipSize, tipSize);
  const antennaMaterial = new THREE.MeshBasicMaterial({ color: accentColor });
  for (const side of [-1, 1]) {
    attachButterflyAntenna(group, side, antennaGeometry, antennaTipGeometry, antennaMaterial, kind, id);
  }
  return { group, leftWing, rightWing };
}

function attachButterflyAntenna(
  group: THREE.Group,
  side: number,
  shaftGeometry: THREE.BoxGeometry,
  tipGeometry: THREE.BoxGeometry,
  material: THREE.Material,
  prefix: string,
  id: string | number,
) {
  const sideName = side < 0 ? "left" : "right";
  const root = new THREE.Group();
  root.name = `${prefix}-${sideName}-antenna-root`;
  root.position.set(
    side * BUTTERFLY_ANTENNA_CONTRACT.rootLateral,
    BUTTERFLY_ANTENNA_CONTRACT.rootCenter[1],
    BUTTERFLY_ANTENNA_CONTRACT.rootCenter[2],
  );
  root.rotation.set(
    BUTTERFLY_ANTENNA_CONTRACT.forwardTiltRadians,
    -side * BUTTERFLY_ANTENNA_CONTRACT.lateralSplayRadians,
    0,
  );
  const antenna = new THREE.Mesh(shaftGeometry, material);
  antenna.name = `${prefix}-${sideName}-antenna`;
  antenna.position.z = -BUTTERFLY_ANTENNA_CONTRACT.length / 2;
  antenna.userData.butterflyId = id;
  const tip = new THREE.Mesh(tipGeometry, material);
  tip.name = `${prefix}-${sideName}-antenna-tip`;
  tip.position.z = -BUTTERFLY_ANTENNA_CONTRACT.length;
  tip.userData.butterflyId = id;
  root.add(antenna, tip);
  group.add(root);
}

export class ButterflySystem {
  readonly group = new THREE.Group();
  readonly entities: ButterflyEntity[] = [];
  private readonly bodyGeometry = new THREE.BoxGeometry(0.055, 0.055, 0.17);
  private readonly wingGeometry = new THREE.BoxGeometry(0.2, 0.018, 0.14);
  private readonly antennaGeometry = new THREE.BoxGeometry(
    BUTTERFLY_ANTENNA_CONTRACT.thickness,
    BUTTERFLY_ANTENNA_CONTRACT.thickness,
    BUTTERFLY_ANTENNA_CONTRACT.length,
  );
  private readonly antennaTipGeometry = new THREE.BoxGeometry(
    BUTTERFLY_ANTENNA_CONTRACT.thickness * BUTTERFLY_ANTENNA_CONTRACT.tipScale,
    BUTTERFLY_ANTENNA_CONTRACT.thickness * BUTTERFLY_ANTENNA_CONTRACT.tipScale,
    BUTTERFLY_ANTENNA_CONTRACT.thickness * BUTTERFLY_ANTENNA_CONTRACT.tipScale,
  );
  private readonly materials = new Map<ButterflyKind, { body: THREE.MeshLambertMaterial; wing: THREE.MeshLambertMaterial; accent: THREE.MeshBasicMaterial }>();
  private readonly scratch = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private nextId = 1;
  private spawnTimer = 1.5;

  constructor(private readonly world: ChunkWorld, private readonly onObserved?: (kind: ButterflyKind, captured: boolean) => void) {
    this.group.name = "butterflies";
  }

  private materialFor(kind: ButterflyKind) {
    let material = this.materials.get(kind);
    if (material) return material;
    const [wing, body, accent] = MOB_DEFS[kind].colors;
    material = {
      body: new THREE.MeshLambertMaterial({ color: body }),
      wing: new THREE.MeshLambertMaterial({ color: wing, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
      accent: new THREE.MeshBasicMaterial({ color: accent }),
    };
    this.materials.set(kind, material);
    return material;
  }

  private createEntity(kind: ButterflyKind, flower: THREE.Vector3, position = flower.clone().add(new THREE.Vector3(0, 0.62, 0))) {
    const material = this.materialFor(kind);
    const group = new THREE.Group();
    group.position.copy(position);
    group.userData.butterflyId = this.nextId;
    const body = new THREE.Mesh(this.bodyGeometry, material.body);
    body.userData.butterflyId = this.nextId;
    group.add(body);

    const leftWing = new THREE.Group();
    const rightWing = new THREE.Group();
    leftWing.position.x = -0.035;
    rightWing.position.x = 0.035;
    butterflyWingPanelProfile(kind).forEach((profile, panelIndex) => {
      const left = new THREE.Mesh(this.wingGeometry, material.wing);
      const right = new THREE.Mesh(this.wingGeometry, material.wing);
      left.name = `${kind}-left-wing-panel${panelIndex ? `-${panelIndex + 1}` : ""}`;
      right.name = `${kind}-right-wing-panel${panelIndex ? `-${panelIndex + 1}` : ""}`;
      left.position.set(-profile.outward, 0, profile.z);
      right.position.set(profile.outward, 0, profile.z);
      left.scale.set(...profile.scale);
      right.scale.set(...profile.scale);
      left.rotation.y = -profile.yaw;
      right.rotation.y = profile.yaw;
      left.userData.butterflyId = right.userData.butterflyId = this.nextId;
      leftWing.add(left);
      rightWing.add(right);
    });
    group.add(leftWing, rightWing);

    for (const side of [-1, 1]) {
      attachButterflyAntenna(group, side, this.antennaGeometry, this.antennaTipGeometry, material.accent, kind, this.nextId);
    }
    const entity: ButterflyEntity = {
      id: this.nextId++, kind, group, leftWing, rightWing,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.15, (Math.random() - 0.5) * 0.5),
      target: position.clone(), flower: flower.clone(), landed: false,
      stateTimer: 0.6 + Math.random() * 2.4, age: 0, phase: Math.random() * Math.PI * 2,
    };
    this.entities.push(entity);
    this.group.add(group);
    return entity;
  }

  private flowerAt(x: number, z: number) {
    const column = this.world.installedColumn(x, z);
    if (!column || this.world.getBlock(x, column.height, z) === undefined) {
      this.world.requestChunkForResidency(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
      return null;
    }
    const ground = column.height;
    const y = ground + 1;
    const type = this.world.getBlock(x, y, z);
    return type !== undefined && FLOWERS.has(type) ? new THREE.Vector3(x, y, z) : null;
  }

  private findFlowerNear(x: number, z: number, radius: number) {
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * radius;
      const flower = this.flowerAt(Math.round(x + Math.cos(angle) * distance), Math.round(z + Math.sin(angle) * distance));
      if (flower) return flower;
    }
    return this.flowerAt(Math.round(x), Math.round(z));
  }

  private canOccupy(position: THREE.Vector3) {
    const type = this.world.getBlock(Math.floor(position.x + 0.5), Math.floor(position.y + 0.5), Math.floor(position.z + 0.5));
    return type !== undefined && (!BLOCKS[type]?.solid || FLOWERS.has(type));
  }

  private flowerHasLandedVisitor(flower: THREE.Vector3, exceptId: number) {
    const key = butterflyFlowerKey(flower);
    return this.entities.some((candidate) => candidate.id !== exceptId
      && candidate.landed
      && butterflyFlowerKey(candidate.flower) === key);
  }

  private trySpawn(environment: ButterflyEnvironment) {
    if (environment.daylight < 0.5 || environment.weather === "rain" || this.entities.length >= environment.cap) return;
    const angle = Math.random() * Math.PI * 2;
    const distance = 7 + Math.random() * 25;
    const x = Math.round(environment.player.x + Math.cos(angle) * distance);
    const z = Math.round(environment.player.z + Math.sin(angle) * distance);
    const column = this.world.installedColumn(x, z);
    if (!column || this.world.getBlock(x, column.height, z) === undefined) {
      this.world.requestChunkForResidency(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
      return;
    }
    const biome = column.biome;
    if (!BUTTERFLY_BIOMES.has(biome)) return;
    const flower = this.findFlowerNear(x, z, 7);
    if (!flower || this.world.skyVisibilityAt(flower.x, flower.y + 0.7, flower.z) < 0.72) return;
    const kind = butterflyKindForBiome(biome);
    if (!kind) return;
    this.createEntity(kind, flower);
  }

  update(dt: number, environment: ButterflyEnvironment) {
    this.spawnTimer -= dt * Math.max(0.15, environment.density);
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.8 + Math.random() * 3.2;
      this.trySpawn(environment);
    }

    for (let index = this.entities.length - 1; index >= 0; index -= 1) {
      const butterfly = this.entities[index];
      butterfly.age += dt;
      butterfly.stateTimer -= dt;
      const distanceToPlayer = butterfly.group.position.distanceTo(environment.player);
      if (distanceToPlayer < 7) this.onObserved?.(butterfly.kind, false);
      if (distanceToPlayer > 58 || butterfly.age > 360) {
        this.removeAt(index);
        continue;
      }
      const flowerStillThere = FLOWERS.has(this.world.getBlock(Math.round(butterfly.flower.x), Math.round(butterfly.flower.y), Math.round(butterfly.flower.z)) ?? BlockId.Air);
      if (butterfly.landed) {
        butterfly.group.position.set(butterfly.flower.x, butterfly.flower.y + 0.52, butterfly.flower.z);
        butterfly.velocity.set(0, 0, 0);
        if (!flowerStillThere || butterfly.stateTimer <= 0 || environment.weather === "rain" || environment.daylight < 0.35) {
          butterfly.landed = false;
          butterfly.stateTimer = 0.5 + Math.random() * 1.5;
          butterfly.velocity.set((Math.random() - 0.5) * 0.7, 0.45, (Math.random() - 0.5) * 0.7);
        }
      } else {
        if (butterfly.stateTimer <= 0) {
          const flower = environment.daylight > 0.38 && environment.weather !== "rain" && Math.random() < BUTTERFLY_FLIGHT_TUNING.seekFlowerChance
            ? this.findFlowerNear(butterfly.group.position.x, butterfly.group.position.z, 7)
            : null;
          if (flower) {
            butterfly.flower.copy(flower);
            butterfly.target.set(flower.x, flower.y + 0.54, flower.z);
          } else {
            butterfly.target.set(
              butterfly.flower.x + (Math.random() - 0.5) * 7,
              butterfly.flower.y + 0.8 + Math.random() * 2.6,
              butterfly.flower.z + (Math.random() - 0.5) * 7,
            );
          }
          butterfly.stateTimer = BUTTERFLY_FLIGHT_TUNING.flightSecondsMin + Math.random() * BUTTERFLY_FLIGHT_TUNING.flightSecondsRange;
        }
        this.desired.copy(butterfly.target).sub(butterfly.group.position);
        const targetDistance = this.desired.length();
        if (targetDistance > 0.001) this.desired.multiplyScalar(1 / targetDistance);
        const speed = MOB_DEFS[butterfly.kind].speed * (environment.weather === "rain" ? 0.55 : 1);
        this.desired.multiplyScalar(speed);
        this.desired.y += Math.sin(butterfly.age * 4.2 + butterfly.phase) * 0.18;
        butterfly.velocity.lerp(this.desired, 1 - Math.exp(-dt * 3.8));
        this.scratch.copy(butterfly.group.position).addScaledVector(butterfly.velocity, dt);
        if (this.canOccupy(this.scratch)) butterfly.group.position.copy(this.scratch);
        else {
          butterfly.velocity.multiplyScalar(-0.45);
          butterfly.target.copy(butterfly.group.position).add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.8 + Math.random(), (Math.random() - 0.5) * 3));
          butterfly.stateTimer = 0.35;
        }
        if (flowerStillThere && butterfly.group.position.distanceTo(butterfly.target) < 0.16 && environment.daylight > 0.35) {
          if (this.flowerHasLandedVisitor(butterfly.flower, butterfly.id)) {
            // A flower is a single landing site. The later arrival immediately
            // resumes its daytime loop instead of clipping through its neighbor.
            butterfly.target.set(
              butterfly.flower.x + (Math.random() - 0.5) * 4,
              butterfly.flower.y + 1 + Math.random() * 1.8,
              butterfly.flower.z + (Math.random() - 0.5) * 4,
            );
            butterfly.stateTimer = 0.35;
          } else {
            butterfly.landed = true;
            butterfly.stateTimer = BUTTERFLY_FLIGHT_TUNING.landedSecondsMin + Math.random() * BUTTERFLY_FLIGHT_TUNING.landedSecondsRange;
          }
        }
      }

      for (const other of this.entities) {
        if (other === butterfly) continue;
        const separation = this.scratch.copy(butterfly.group.position).sub(other.group.position);
        const distanceSquared = separation.lengthSq();
        if (distanceSquared > 0.0001 && distanceSquared < 0.075) butterfly.velocity.addScaledVector(separation.normalize(), dt * 1.8);
      }
      for (const small of environment.smallEntities ?? []) {
        const separation = this.scratch.copy(butterfly.group.position).sub(small);
        const distanceSquared = separation.lengthSq();
        if (distanceSquared > 0.0001 && distanceSquared < 0.12) butterfly.velocity.addScaledVector(separation.normalize(), dt * 1.2);
      }

      const flap = butterfly.landed ? 0.16 : Math.sin(butterfly.age * 21 + butterfly.phase) * 0.92;
      butterfly.leftWing.rotation.z = flap;
      butterfly.rightWing.rotation.z = -flap;
      if (butterfly.velocity.lengthSq() > 0.01) butterfly.group.rotation.y = butterflyYawForVelocity(butterfly.velocity);
    }
  }

  capture(origin: THREE.Vector3, direction: THREE.Vector3, reach = 4.2): ButterflyCapture | null {
    const id = butterflyCaptureAlongRay(this.snapshots(), origin, direction, reach);
    if (id === null) return null;
    const index = this.entities.findIndex((candidate) => candidate.id === id);
    if (index < 0) return null;
    const butterfly = this.entities[index];
    const definition = MOB_DEFS[butterfly.kind];
    this.removeAt(index);
    // The caller commits custody only after the filled Capture Orb fits in the
    // authoritative inventory. Merely removing the visual is not a capture.
    this.onObserved?.(butterfly.kind, false);
    return { id, kind: butterfly.kind, item: definition.captureItem! };
  }

  /** Non-custodial survey used by the retired net as an optional research tool. */
  survey(origin: THREE.Vector3, direction: THREE.Vector3, reach = 4.2): ButterflyKind | null {
    const id = butterflyCaptureAlongRay(this.snapshots(), origin, direction, reach);
    if (id === null) return null;
    const butterfly = this.entities.find((candidate) => candidate.id === id);
    if (!butterfly) return null;
    this.onObserved?.(butterfly.kind, false);
    return butterfly.kind;
  }

  release(kind: ButterflyKind, position: THREE.Vector3) {
    if (!BUTTERFLY_ORDER.includes(kind) || !this.canOccupy(position)) return false;
    const flower = this.findFlowerNear(position.x, position.z, 7) ?? position.clone().add(new THREE.Vector3(0, -0.5, 0));
    this.createEntity(kind, flower, position);
    this.onObserved?.(kind, false);
    return true;
  }

  snapshots(): ButterflySnapshot[] {
    return this.entities.map((butterfly) => ({
      id: butterfly.id, kind: butterfly.kind,
      x: butterfly.group.position.x, y: butterfly.group.position.y, z: butterfly.group.position.z,
      yaw: butterfly.group.rotation.y, landed: butterfly.landed,
      wing: butterfly.leftWing.rotation.z,
    }));
  }

  private removeAt(index: number) {
    const [butterfly] = this.entities.splice(index, 1);
    if (butterfly) this.group.remove(butterfly.group);
  }

  clear() {
    while (this.entities.length) this.removeAt(this.entities.length - 1);
  }

  dispose() {
    this.clear();
    this.bodyGeometry.dispose();
    this.wingGeometry.dispose();
    this.antennaGeometry.dispose();
    this.antennaTipGeometry.dispose();
    for (const material of this.materials.values()) {
      material.body.dispose();
      material.wing.dispose();
      material.accent.dispose();
    }
    this.materials.clear();
  }
}
