import type { RustIntegratedRuntimeIdentityV1 } from "../../app/game/rust-integrated-runtime-contract.ts";
import {
  rustIntegratedRuntimeNativePlayerDropOriginHashV1,
  rustIntegratedRuntimeNativePlayerDropReceiptHashV1,
  type RustIntegratedRuntimeNativePlayerDropProjectionV1,
} from "../../app/game/rust-integrated-runtime-player-drop.ts";

export function nativePlayerDropRepeatedHash(byte: number) {
  return byte.toString(16).padStart(2, "0").repeat(16);
}

export function nativePlayerDropIdentity(
  tick = 9,
  stateHash = nativePlayerDropRepeatedHash(0xa1),
): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe:native-player-drop",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 5,
      world: 14,
      entities: 23,
      gameplay: 31,
      persistence: 6,
      network: 7,
      simulation: 9,
    }),
    tick,
    stateHash,
  });
}

/** Exact mirror of runtime_domain_wire.rs::native_player_drop_projection_fixture_v1. */
export function nativePlayerDropProjectionFixture(): RustIntegratedRuntimeNativePlayerDropProjectionV1 {
  const stackBefore = Object.freeze({
    itemCode: 42,
    count: 2,
    durabilityMillionths: 875_000,
    metadataHash: nativePlayerDropRepeatedHash(0x62),
  });
  const stackAfter = Object.freeze({ ...stackBefore, count: 1 });
  const dropStack = Object.freeze({ ...stackBefore, count: 1 });
  const gameplayBefore = Object.freeze({
    epoch: 3,
    sequence: BigInt(30),
    inventory: BigInt(20),
    machines: BigInt(4),
    combat: BigInt(5),
    progression: BigInt(6),
    cardforge: BigInt(7),
  });
  const worldViewBefore = Object.freeze({
    epoch: 4,
    sequence: BigInt(40),
    clock: BigInt(41),
    machineAnchors: BigInt(42),
    droppedItems: BigInt(43),
    playerBindings: BigInt(44),
    environment: BigInt(45),
    atmosphereGravity: BigInt(46),
    celestial: BigInt(47),
  });
  const base = Object.freeze({
    schema: 1 as const,
    sequence: 6,
    originInputSequence: 41,
    completionTick: 9,
    world: Object.freeze({
      universeId: "universe:native-player-drop",
      locationId: "surface",
      revision: Object.freeze({ epoch: 2, mutation: 14, residency: 4 }),
      canonicalStateHash: nativePlayerDropRepeatedHash(0x63),
    }),
    player: Object.freeze({
      playerId: (BigInt(3) << BigInt(32)) | BigInt(7),
      entityId: (BigInt(4) << BigInt(32)) | BigInt(9),
    }),
    inventory: Object.freeze({
      container: Object.freeze({
        kind: "player" as const,
        id: "actor:native-player-drop",
        ownerId: "actor:native-player-drop",
      }),
      selectedSlot: 2,
      beforeRevision: BigInt(12),
      afterRevision: BigInt(13),
      beforeStack: stackBefore,
      afterStack: stackAfter,
    }),
    drop: Object.freeze({
      dropId: "drop:41:6",
      entityId: (BigInt(4) << BigInt(32)) | BigInt(10),
      stack: dropStack,
      custodyContainer: Object.freeze({
        kind: "container" as const,
        id: "drop-custody:41:6",
        ownerId: null,
      }),
      custodySlot: 0,
      custodyRevision: BigInt(0),
      spatialRevision: BigInt(0),
      position: Object.freeze({ xMilli: BigInt(-1_250), yMilli: BigInt(65_750), zMilli: BigInt(2_500) }),
      velocityMilliPerSecond: Object.freeze({ xMilli: BigInt(-350), yMilli: BigInt(1_250), zMilli: BigInt(75) }),
      rotation: Object.freeze({ yaw: 875_000, pitch: 125_000, roll: 0 }),
      createdTick: BigInt(8),
      expiresTick: null,
      pickupLockActorId: null,
      pickupUnlockTick: BigInt(15),
      originHash: nativePlayerDropRepeatedHash(0x70),
    }),
    authority: Object.freeze({
      gameplay: Object.freeze({
        before: Object.freeze({
          revision: gameplayBefore,
          canonicalStateHash: nativePlayerDropRepeatedHash(0x64),
        }),
        after: Object.freeze({
          revision: Object.freeze({
            ...gameplayBefore,
            sequence: BigInt(31),
            inventory: BigInt(21),
          }),
          canonicalStateHash: nativePlayerDropRepeatedHash(0x65),
        }),
      }),
      entity: Object.freeze({
        before: Object.freeze({ revision: BigInt(22), canonicalStateHash: nativePlayerDropRepeatedHash(0x66) }),
        after: Object.freeze({ revision: BigInt(23), canonicalStateHash: nativePlayerDropRepeatedHash(0x67) }),
      }),
      worldView: Object.freeze({
        before: Object.freeze({
          revision: worldViewBefore,
          canonicalStateHash: nativePlayerDropRepeatedHash(0x68),
        }),
        after: Object.freeze({
          revision: Object.freeze({
            ...worldViewBefore,
            sequence: BigInt(41),
            droppedItems: BigInt(44),
          }),
          canonicalStateHash: nativePlayerDropRepeatedHash(0x69),
        }),
      }),
    }),
    content: Object.freeze({
      configuredManifestHash: nativePlayerDropRepeatedHash(0x71),
      installedManifestHash: nativePlayerDropRepeatedHash(0x71),
      installedRegistryHash: nativePlayerDropRepeatedHash(0x72),
      itemContentHash: nativePlayerDropRepeatedHash(0x73),
      itemContentVersion: 11,
    }),
    receiptHash: nativePlayerDropRepeatedHash(0x74),
  });
  const originHash = rustIntegratedRuntimeNativePlayerDropOriginHashV1(base);
  const withOrigin = Object.freeze({
    ...base,
    drop: Object.freeze({ ...base.drop, originHash }),
  });
  return Object.freeze({
    ...withOrigin,
    receiptHash: rustIntegratedRuntimeNativePlayerDropReceiptHashV1(withOrigin),
  });
}

export function plainNativePlayerDropProjection(
  sequence = 1,
  completionTick = 1,
): RustIntegratedRuntimeNativePlayerDropProjectionV1 {
  const fixture = nativePlayerDropProjectionFixture();
  const beforeStack = Object.freeze({
    itemCode: 2,
    count: 2,
    durabilityMillionths: null,
    metadataHash: "0".repeat(32),
  });
  const base = Object.freeze({
    ...fixture,
    sequence,
    originInputSequence: sequence,
    completionTick,
    inventory: Object.freeze({
      ...fixture.inventory,
      selectedSlot: 0,
      beforeStack,
      afterStack: Object.freeze({ ...beforeStack, count: 1 }),
    }),
    drop: Object.freeze({
      ...fixture.drop,
      dropId: `drop:${sequence}:${sequence}`,
      entityId: BigInt(100 + sequence),
      stack: Object.freeze({ ...beforeStack, count: 1 }),
      custodyContainer: Object.freeze({
        kind: "container" as const,
        id: `drop-custody:${sequence}:${sequence}`,
        ownerId: null,
      }),
      createdTick: BigInt(completionTick),
      pickupUnlockTick: BigInt(completionTick + 7),
      originHash: nativePlayerDropRepeatedHash(0x70),
    }),
    receiptHash: nativePlayerDropRepeatedHash(0x74),
  });
  const originHash = rustIntegratedRuntimeNativePlayerDropOriginHashV1(base);
  const withOrigin = Object.freeze({
    ...base,
    drop: Object.freeze({ ...base.drop, originHash }),
  });
  return Object.freeze({
    ...withOrigin,
    receiptHash: rustIntegratedRuntimeNativePlayerDropReceiptHashV1(withOrigin),
  });
}
