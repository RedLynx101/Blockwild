import assert from "node:assert/strict";
import test from "node:test";

import { createNetworkInterestSetV1 } from "../app/game/network-authority-contract.ts";
import {
  MultiplayerOperationCancelledError,
  MultiplayerProtocolError,
  MultiplayerSession,
  decodeInviteCode,
  type PeerIdentity,
} from "../app/game/multiplayer.ts";
import {
  bindReadyRustMultiplayerRuntimeV2,
  createRustMultiplayerGuestAuthorityFactoryV2,
  createRustMultiplayerRuntimeDescriptorV2,
  validateRustMultiplayerRuntimeDescriptorV2,
  type RustMultiplayerRuntimeBindingV2,
  type RustMultiplayerRuntimeManagerPortV1,
} from "../app/game/rust-multiplayer-runtime-bootstrap.ts";
import type { RustIntegratedRuntimeIdentityV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustWorldRuntimeHostConfigV1 } from "../app/game/rust-world-runtime-host.ts";
import type { RustWorldRuntimeManagedHostV1 } from "../app/game/rust-world-runtime-manager.ts";
import {
  CONTENT_HASH,
  FixtureRtcNetwork,
  FixtureRustAuthority,
  GENERATION_OPTIONS_JSON,
  GENERATOR_HASH,
  GUEST_IDENTITY,
  HOST_IDENTITY,
  RUNTIME_DESCRIPTOR,
  RUNTIME_INTEREST,
  TERRAIN_CONTENT_HASH,
  deferred,
  deterministicRuntimeIds,
  unsafeInviteCode,
} from "./fixtures/rust-multiplayer-runtime-fixtures.ts";

function readySession(
  identity: PeerIdentity,
  network: FixtureRtcNetwork,
  authority = new FixtureRustAuthority(),
) {
  return new MultiplayerSession({
    identity,
    sessionId: RUNTIME_DESCRIPTOR.runtimeSessionId,
    rustAuthority: authority,
    authorityInterest: () => RUNTIME_INTEREST,
    rustRuntimeDescriptor: RUNTIME_DESCRIPTOR,
    peerConnectionFactory: network.factory,
    randomId: deterministicRuntimeIds(identity.id),
    autoMaintenance: false,
  });
}

function guestSession(
  network: FixtureRtcNetwork,
  factory: ConstructorParameters<typeof MultiplayerSession>[0]["guestAuthorityFactory"],
  sessionId?: string,
) {
  return new MultiplayerSession({
    identity: GUEST_IDENTITY,
    ...(sessionId ? { sessionId } : {}),
    guestAuthorityFactory: factory!,
    peerConnectionFactory: network.factory,
    randomId: deterministicRuntimeIds(GUEST_IDENTITY.id),
    autoMaintenance: false,
  });
}

function runtimeBinding(
  authority: FixtureRustAuthority,
  shutdown: () => Promise<unknown>,
  descriptor = RUNTIME_DESCRIPTOR,
): RustMultiplayerRuntimeBindingV2 {
  return { descriptor, authority, interest: () => RUNTIME_INTEREST, shutdown };
}

async function hostOffer(network: FixtureRtcNetwork) {
  const host = readySession(HOST_IDENTITY, network);
  const offer = await host.createHostInvite();
  return { host, offer, signal: decodeInviteCode(offer.inviteCode) };
}

test("runtime descriptor V2 seals the exact canonical terrain identity", () => {
  assert.equal(RUNTIME_DESCRIPTOR.schema, 2);
  assert.equal(RUNTIME_DESCRIPTOR.terrainContentHash, TERRAIN_CONTENT_HASH);
  assert.equal(RUNTIME_DESCRIPTOR.generationOptionsJson, GENERATION_OPTIONS_JSON);
  assert.equal(RUNTIME_DESCRIPTOR.descriptorHash, "0c3c5dd8ba9c03cc50de0b40d1a7c5bb");
  assert.equal(validateRustMultiplayerRuntimeDescriptorV2(RUNTIME_DESCRIPTOR), true);
  assert.equal(validateRustMultiplayerRuntimeDescriptorV2({ ...RUNTIME_DESCRIPTOR, schema: 1 }), false, "V1 is rejected rather than defaulted");
  assert.equal(validateRustMultiplayerRuntimeDescriptorV2({ ...RUNTIME_DESCRIPTOR, futureField: true }), false);
  assert.equal(validateRustMultiplayerRuntimeDescriptorV2({ ...RUNTIME_DESCRIPTOR, terrainContentHash: "d".repeat(32) }), false);
  assert.equal(validateRustMultiplayerRuntimeDescriptorV2({
    ...RUNTIME_DESCRIPTOR,
    generationOptionsJson: `${GENERATION_OPTIONS_JSON} `,
  }), false);

  const options = JSON.parse(GENERATION_OPTIONS_JSON) as Record<string, unknown>;
  assert.throws(() => createRustMultiplayerRuntimeDescriptorV2({
    ...RUNTIME_DESCRIPTOR,
    generationOptionsJson: JSON.stringify(Object.fromEntries(Object.entries(options).reverse())),
  }), /canonical terrain option shape and order/iu);
  assert.throws(() => createRustMultiplayerRuntimeDescriptorV2({
    ...RUNTIME_DESCRIPTOR,
    generationOptionsJson: JSON.stringify({ ...options, origin: { mode: "wilderness" } }),
  }), /canonical terrain option shape and order/iu);
  assert.throws(() => createRustMultiplayerRuntimeDescriptorV2({
    ...RUNTIME_DESCRIPTOR,
    generationOptionsJson: JSON.stringify({ ...options, biomeScale: 4.01 }),
  }), /unsupported|non-normalized/iu);
  assert.doesNotThrow(() => createRustMultiplayerRuntimeDescriptorV2({
    ...RUNTIME_DESCRIPTOR,
    generationOptionsJson: JSON.stringify({ ...options, settlementDensity: 2 }),
  }));
  for (const settlementDensity of [2.01, 3]) {
    assert.throws(() => createRustMultiplayerRuntimeDescriptorV2({
      ...RUNTIME_DESCRIPTOR,
      generationOptionsJson: JSON.stringify({ ...options, settlementDensity }),
    }), /unsupported|non-normalized/iu);
  }

  const changedOptions = JSON.stringify({ ...options, resourceAbundance: 2 });
  const changed = createRustMultiplayerRuntimeDescriptorV2({
    ...RUNTIME_DESCRIPTOR,
    generationOptionsJson: changedOptions,
  });
  assert.notEqual(changed.descriptorHash, RUNTIME_DESCRIPTOR.descriptorHash);
});

test("authoritative offers use the prebound session and reject missing or tampered descriptors before guest startup", async () => {
  const network = new FixtureRtcNetwork();
  const { host, signal } = await hostOffer(network);
  assert.equal(signal.kind, "offer");
  assert.equal(signal.sessionId, RUNTIME_DESCRIPTOR.runtimeSessionId);
  assert.deepEqual(signal.runtime, RUNTIME_DESCRIPTOR);

  let factoryCalls = 0;
  const guest = guestSession(network, async () => {
    factoryCalls += 1;
    return runtimeBinding(new FixtureRustAuthority(), async () => undefined);
  });
  const withoutRuntime = { ...signal };
  delete withoutRuntime.runtime;
  await assert.rejects(guest.createGuestAnswer(unsafeInviteCode(withoutRuntime)), MultiplayerProtocolError);
  assert.equal(factoryCalls, 0);
  assert.equal(network.connections.length, 1, "invalid offer never allocates a guest RTCPeerConnection");

  const tampered = {
    ...signal,
    runtime: { ...signal.runtime!, locationId: "tampered-surface" },
  };
  assert.equal(validateRustMultiplayerRuntimeDescriptorV2(tampered.runtime), false);
  await assert.rejects(guest.createGuestAnswer(unsafeInviteCode(tampered)), MultiplayerProtocolError);
  assert.equal(factoryCalls, 0);
  assert.equal(network.connections.length, 1);
  host.dispose(); guest.dispose();
});

test("guest factory bindings must match address, fingerprints, and session and are cleaned before any negotiation on mismatch", async () => {
  const network = new FixtureRtcNetwork();
  const { host, offer } = await hostOffer(network);
  const wrongFingerprint = createRustMultiplayerRuntimeDescriptorV2({
    ...RUNTIME_DESCRIPTOR,
    contentHash: "c".repeat(32),
  });
  const authority = new FixtureRustAuthority();
  let shutdowns = 0;
  const guest = guestSession(network, async () => runtimeBinding(authority, async () => { shutdowns += 1; }, wrongFingerprint));
  await assert.rejects(guest.createGuestAnswer(offer.inviteCode), /does not match|different|mismatch/iu);
  assert.equal(shutdowns, 1);
  assert.equal(authority.events.includes("negotiate"), false);
  assert.equal(network.connections.length, 1);
  assert.equal(guest.role, null);

  let preboundFactoryCalls = 0;
  const preboundGuest = guestSession(network, async () => {
    preboundFactoryCalls += 1;
    return runtimeBinding(new FixtureRustAuthority(), async () => undefined);
  }, "session_different_runtime_001");
  await assert.rejects(preboundGuest.createGuestAnswer(offer.inviteCode), /different prebound/iu);
  assert.equal(preboundFactoryCalls, 0);

  const wrongAddress = new FixtureRustAuthority(RUNTIME_DESCRIPTOR.universeId, "other-location");
  let addressShutdowns = 0;
  const addressGuest = guestSession(network, async () => runtimeBinding(wrongAddress, async () => { addressShutdowns += 1; }));
  await assert.rejects(addressGuest.createGuestAnswer(offer.inviteCode), /address/iu);
  assert.equal(addressShutdowns, 1);
  assert.equal(wrongAddress.events.includes("negotiate"), false);
  host.dispose(); guest.dispose(); preboundGuest.dispose(); addressGuest.dispose();
});

test("host rejects a guest answer that echoes a different valid runtime fingerprint before negotiation", async () => {
  const network = new FixtureRtcNetwork();
  const hostAuthority = new FixtureRustAuthority();
  const guestAuthority = new FixtureRustAuthority();
  const host = readySession(HOST_IDENTITY, network, hostAuthority);
  const guest = readySession(GUEST_IDENTITY, network, guestAuthority);
  const offer = await host.createHostInvite();
  const answer = await guest.createGuestAnswer(offer.inviteCode);
  const signal = decodeInviteCode(answer.answerCode);
  assert.equal(signal.kind, "answer");
  const different = createRustMultiplayerRuntimeDescriptorV2({
    ...RUNTIME_DESCRIPTOR,
    generationOptionsJson: JSON.stringify({
      ...(JSON.parse(GENERATION_OPTIONS_JSON) as Record<string, unknown>),
      caveFrequency: 2,
    }),
  });
  const tampered = { ...signal, runtime: different };
  const negotiationsBefore = hostAuthority.events.filter((event) => event === "negotiate").length;
  await assert.rejects(host.acceptGuestAnswer(unsafeInviteCode(tampered)), /different Rust runtime/iu);
  assert.equal(hostAuthority.events.filter((event) => event === "negotiate").length, negotiationsBefore);
  assert.equal(host.getPeers()[0]?.state, "invited");
  host.dispose(); guest.dispose();
});

test("factory failure remains fail closed and leaves no peer or adopted runtime", async () => {
  const network = new FixtureRtcNetwork();
  const { host, offer } = await hostOffer(network);
  const guest = guestSession(network, async () => { throw new Error("fixture startup failed"); });
  await assert.rejects(guest.createGuestAnswer(offer.inviteCode), /fixture startup failed/iu);
  assert.equal(network.connections.length, 1);
  assert.equal(guest.role, null);
  assert.equal(guest.sessionId, null);
  assert.equal(guest.state, "error");
  host.dispose(); guest.dispose();
});

test("dispose cancels pending guest startup and cleans a late factory result exactly once", async () => {
  const network = new FixtureRtcNetwork();
  const { host, offer } = await hostOffer(network);
  const pending = deferred<RustMultiplayerRuntimeBindingV2>();
  const factorySignals: AbortSignal[] = [];
  let shutdowns = 0;
  const guest = guestSession(network, async ({ signal }) => {
    factorySignals.push(signal);
    return pending.promise;
  });
  const joining = guest.createGuestAnswer(offer.inviteCode);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(factorySignals[0]?.aborted, false);
  guest.dispose();
  assert.equal(factorySignals[0]?.aborted, true);
  pending.resolve(runtimeBinding(new FixtureRustAuthority(), async () => { shutdowns += 1; }));
  await assert.rejects(joining, MultiplayerOperationCancelledError);
  await guest.drainAuthority();
  assert.equal(shutdowns, 1);
  assert.equal(network.connections.length, 1);
  host.dispose();
});

test("dispose aborts in-flight authority negotiation before shutting down the owned runtime", async () => {
  const network = new FixtureRtcNetwork();
  const { host, offer } = await hostOffer(network);
  const negotiation = deferred<void>();
  const authority = new FixtureRustAuthority();
  authority.negotiateGate = negotiation.promise;
  let shutdowns = 0;
  const guest = guestSession(network, async () => runtimeBinding(authority, async () => { shutdowns += 1; }));
  const joining = guest.createGuestAnswer(offer.inviteCode);
  for (let index = 0; index < 8 && !authority.events.includes("negotiate"); index += 1) await Promise.resolve();
  assert.equal(authority.events.includes("negotiate"), true);
  guest.dispose();
  await assert.rejects(joining, MultiplayerOperationCancelledError);
  await guest.drainAuthority();
  assert.equal(shutdowns, 1);
  negotiation.resolve();
  host.dispose();
});

test("concurrent joins invoke one factory, then normal disposal drains and shuts down the adopted runtime", async () => {
  const network = new FixtureRtcNetwork();
  const { host, offer } = await hostOffer(network);
  const pending = deferred<RustMultiplayerRuntimeBindingV2>();
  const authority = new FixtureRustAuthority();
  let calls = 0;
  let shutdowns = 0;
  const guest = guestSession(network, async () => {
    calls += 1;
    return pending.promise;
  });
  const first = guest.createGuestAnswer(offer.inviteCode);
  await Promise.resolve(); await Promise.resolve();
  await assert.rejects(guest.createGuestAnswer(offer.inviteCode), /already hosting or joining/iu);
  assert.equal(calls, 1);
  assert.equal(network.connections.length, 1, "WebRTC waits for runtime attestation");
  pending.resolve(runtimeBinding(authority, async () => { shutdowns += 1; }));
  await first;
  assert.equal(network.connections.length, 2);
  assert.ok(authority.events.indexOf("identity") < authority.events.indexOf("negotiate"));
  guest.dispose();
  await guest.drainAuthority();
  assert.equal(shutdowns, 1);
  host.dispose();
});

test("negotiation failure closes the peer and owned runtime without double cleanup", async () => {
  const network = new FixtureRtcNetwork();
  const { host, offer } = await hostOffer(network);
  const authority = new FixtureRustAuthority();
  authority.negotiateError = new Error("fixture negotiation failed");
  let shutdowns = 0;
  const guest = guestSession(network, async () => runtimeBinding(authority, async () => { shutdowns += 1; }));
  await assert.rejects(guest.createGuestAnswer(offer.inviteCode), /fixture negotiation failed/iu);
  assert.equal(shutdowns, 1);
  assert.equal(network.connections[1]?.closed, true);
  assert.equal(network.connections[1]?.remoteDescription, null, "negotiation precedes WebRTC SDP installation");
  guest.dispose();
  await guest.drainAuthority();
  assert.equal(shutdowns, 1);
  host.dispose();
});

function integratedIdentity(config: RustWorldRuntimeHostConfigV1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: config.universeId,
    locationId: config.locationId,
    revision: Object.freeze({ epoch: 1, world: 0, entities: 0, gameplay: 0, persistence: 0, network: 0, simulation: 0 }),
    tick: 0,
    stateHash: "d".repeat(32),
  });
}

function managedHost(
  config: RustWorldRuntimeHostConfigV1,
  authority: FixtureRustAuthority,
  contentHash = CONTENT_HASH,
): RustWorldRuntimeManagedHostV1 {
  const identity = integratedIdentity(config);
  return {
    config,
    start: async () => identity,
    shutdown: async () => undefined,
    multiplayerAuthority: () => authority,
    authorityInterest: (source) => createNetworkInterestSetV1(source),
    runtimeAdapter: () => ({}) as ReturnType<RustWorldRuntimeManagedHostV1["runtimeAdapter"]>,
    runtimeService: () => ({}) as ReturnType<RustWorldRuntimeManagedHostV1["runtimeService"]>,
    diagnostics: () => Object.freeze({
      state: "ready" as const,
      artifactHash: "e".repeat(64),
      contentHash,
      generatorHash: config.generatorHash,
      identity,
      adapter: Object.freeze({ authoritative: true, contentReady: true, contentManifestHash: contentHash }),
      lastError: null,
    }),
  };
}

class FixtureRuntimeManager implements RustMultiplayerRuntimeManagerPortV1 {
  readonly configs: RustWorldRuntimeHostConfigV1[] = [];
  shutdowns = 0;
  contentHash = CONTENT_HASH;

  async activate(config: RustWorldRuntimeHostConfigV1) {
    this.configs.push(config);
    return managedHost(config, new FixtureRustAuthority(config.universeId, config.locationId), this.contentHash);
  }
  async shutdown() { this.shutdowns += 1; }
}

test("production guest bootstrap attests manager identity/content and rejects local fingerprint drift", async () => {
  const manager = new FixtureRuntimeManager();
  const factory = createRustMultiplayerGuestAuthorityFactoryV2({
    manager,
    generatorHash: GENERATOR_HASH,
    terrainContentHash: TERRAIN_CONTENT_HASH,
    waterBlockId: 7,
    directionalBlockIds: [9, 2, 9],
    waterloggedBlockIds: [18],
    interest: () => ({ sequence: 1, chunks: RUNTIME_INTEREST.chunks, entityIds: [] }),
  });
  const binding = await factory({ descriptor: RUNTIME_DESCRIPTOR, signal: new AbortController().signal });
  assert.deepEqual(manager.configs[0], {
    worldSeed: RUNTIME_DESCRIPTOR.worldSeed,
    universeId: RUNTIME_DESCRIPTOR.universeId,
    locationId: RUNTIME_DESCRIPTOR.locationId,
    sessionId: RUNTIME_DESCRIPTOR.runtimeSessionId,
    generatorHash: GENERATOR_HASH,
    terrainContentHash: TERRAIN_CONTENT_HASH,
    generationOptionsJson: GENERATION_OPTIONS_JSON,
    waterBlockId: 7,
    directionalBlockIds: [2, 9],
    waterloggedBlockIds: [18],
  });
  assert.deepEqual(binding.descriptor, RUNTIME_DESCRIPTOR);
  await binding.shutdown(); await binding.shutdown();
  assert.equal(manager.shutdowns, 1);

  const contentMismatchManager = new FixtureRuntimeManager();
  contentMismatchManager.contentHash = "f".repeat(32);
  const contentFactory = createRustMultiplayerGuestAuthorityFactoryV2({
    manager: contentMismatchManager,
    generatorHash: GENERATOR_HASH,
    terrainContentHash: TERRAIN_CONTENT_HASH,
    waterBlockId: 7,
    directionalBlockIds: [],
    waterloggedBlockIds: [],
    interest: () => ({ sequence: 1, chunks: RUNTIME_INTEREST.chunks, entityIds: [] }),
  });
  await assert.rejects(contentFactory({ descriptor: RUNTIME_DESCRIPTOR, signal: new AbortController().signal }), /differs|mismatch/iu);
  assert.equal(contentMismatchManager.shutdowns, 1);

  const generatorMismatch = createRustMultiplayerRuntimeDescriptorV2({ ...RUNTIME_DESCRIPTOR, generatorHash: "f".repeat(32) });
  const freshManager = new FixtureRuntimeManager();
  const generatorFactory = createRustMultiplayerGuestAuthorityFactoryV2({
    manager: freshManager,
    generatorHash: GENERATOR_HASH,
    terrainContentHash: TERRAIN_CONTENT_HASH,
    waterBlockId: 7,
    directionalBlockIds: [],
    waterloggedBlockIds: [],
    interest: () => ({ sequence: 1, chunks: [], entityIds: [] }),
  });
  await assert.rejects(generatorFactory({ descriptor: generatorMismatch, signal: new AbortController().signal }), /generator fingerprints differ/iu);
  assert.equal(freshManager.configs.length, 0);

  const terrainMismatch = createRustMultiplayerRuntimeDescriptorV2({
    ...RUNTIME_DESCRIPTOR,
    terrainContentHash: "f".repeat(32),
  });
  const terrainManager = new FixtureRuntimeManager();
  const terrainFactory = createRustMultiplayerGuestAuthorityFactoryV2({
    manager: terrainManager,
    generatorHash: GENERATOR_HASH,
    terrainContentHash: TERRAIN_CONTENT_HASH,
    waterBlockId: 7,
    directionalBlockIds: [],
    waterloggedBlockIds: [],
    interest: () => ({ sequence: 1, chunks: [], entityIds: [] }),
  });
  await assert.rejects(
    terrainFactory({ descriptor: terrainMismatch, signal: new AbortController().signal }),
    /terrain corpus fingerprints differ/iu,
  );
  assert.equal(terrainManager.configs.length, 0, "terrain corpus drift fails before runtime activation");
});

test("ready-host binding rejects interest or authority addresses outside the attested runtime", () => {
  const config: RustWorldRuntimeHostConfigV1 = {
    worldSeed: RUNTIME_DESCRIPTOR.worldSeed,
    universeId: RUNTIME_DESCRIPTOR.universeId,
    locationId: RUNTIME_DESCRIPTOR.locationId,
    sessionId: RUNTIME_DESCRIPTOR.runtimeSessionId,
    generatorHash: GENERATOR_HASH,
    terrainContentHash: TERRAIN_CONTENT_HASH,
    generationOptionsJson: GENERATION_OPTIONS_JSON,
    waterBlockId: 7,
    directionalBlockIds: [],
    waterloggedBlockIds: [],
  };
  assert.throws(() => bindReadyRustMultiplayerRuntimeV2(
    managedHost(config, new FixtureRustAuthority(config.universeId, "wrong-location")),
    () => ({ sequence: 1, chunks: [], entityIds: [] }),
  ), /address/iu);
  assert.throws(() => bindReadyRustMultiplayerRuntimeV2(
    managedHost({ ...config, generationOptionsJson: `${GENERATION_OPTIONS_JSON} ` }, new FixtureRustAuthority()),
    () => ({ sequence: 1, chunks: [], entityIds: [] }),
  ), /canonical terrain option shape and order/iu);
  const binding = bindReadyRustMultiplayerRuntimeV2(
    managedHost(config, new FixtureRustAuthority()),
    () => ({ sequence: 1, chunks: [{ universeId: config.universeId, locationId: "wrong-location", chunkX: 0, chunkZ: 0 }], entityIds: [] }),
  );
  assert.equal(binding.descriptor.terrainContentHash, config.terrainContentHash);
  assert.equal(binding.descriptor.generationOptionsJson, config.generationOptionsJson);
  assert.throws(() => binding.interest({ sessionId: config.sessionId, local: HOST_IDENTITY, peer: GUEST_IDENTITY, role: "host" }), /escaped|address/iu);
});
