import { RustNetworkRuntimeContractError } from "./rust-network-runtime-contract";
import type { RustNetworkRuntimePortV1 } from "./rust-network-runtime-service";
import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated";
import type {
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeCommandReceiptV1,
  RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract";
import {
  RustIntegratedRuntimeServiceError,
  RustIntegratedRuntimeServiceV1,
} from "./rust-integrated-runtime-service";
import type { NetworkPeerGrantV1 } from "./network-authority-contract";
import {
  RUST_INTEGRATED_NETWORK_AGENT_GRANT_TYPE_V1,
  RUST_INTEGRATED_NETWORK_COMMAND_RELEASE_TYPE_V1,
  RUST_INTEGRATED_NETWORK_COMMAND_RELEASE_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_NETWORK_DELTA_BUILD_RESPONSE_TYPE_V1,
  RUST_INTEGRATED_NETWORK_DELTA_BUILD_TYPE_V1,
  RUST_INTEGRATED_NETWORK_GRANT_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_NETWORK_PEER_GRANT_TYPE_V1,
  RUST_INTEGRATED_NETWORK_PEER_RELEASE_TYPE_V1,
  RUST_INTEGRATED_NETWORK_PEER_RELEASE_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_NETWORK_RECONNECT_RESPONSE_TYPE_V1,
  RUST_INTEGRATED_NETWORK_RECONNECT_TYPE_V1,
  RUST_INTEGRATED_NETWORK_REPLICATION_REMOVE_TYPE_V1,
  RUST_INTEGRATED_NETWORK_REPLICATION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_NETWORK_REPLICATION_UPSERT_TYPE_V1,
  decodeRustIntegratedNetworkAcknowledgementV1,
  decodeRustIntegratedNetworkDeltaBuildResponseV1,
  decodeRustIntegratedNetworkReconnectResponseV1,
  encodeRustIntegratedNetworkAgentGrantV1,
  encodeRustIntegratedNetworkCommandReleaseV1,
  encodeRustIntegratedNetworkDeltaBuildV1,
  encodeRustIntegratedNetworkPeerGrantV1,
  encodeRustIntegratedNetworkPeerReleaseV1,
  encodeRustIntegratedNetworkReconnectV1,
  encodeRustIntegratedNetworkReplicationRecordV1,
  type RustIntegratedNetworkAgentGrantV1,
  type RustIntegratedNetworkAcknowledgementFamilyV1,
  type RustIntegratedNetworkDeltaBuildRequestV1,
  type RustIntegratedScopedDeltaRecordV1,
} from "./rust-integrated-runtime-network-lifecycle";

const NETWORK_REQUEST_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-browser-request-v1");
const NETWORK_RESPONSE_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-browser-response-v1");
type NetworkLifecycleSchemaV1 = Readonly<{ typeId: string; operationSchema: number }>;
const NETWORK_LIFECYCLE_SCHEMAS: ReadonlyMap<string, Readonly<{
  request: NetworkLifecycleSchemaV1;
  response: NetworkLifecycleSchemaV1;
}>> = new Map<string, Readonly<{
  request: NetworkLifecycleSchemaV1;
  response: NetworkLifecycleSchemaV1;
}>>([
  [rustIntegratedRuntimeDomainWireFamilyV1("network-peer-grant-v1").typeId, Object.freeze({
    request: rustIntegratedRuntimeDomainWireFamilyV1("network-peer-grant-v1"),
    response: rustIntegratedRuntimeDomainWireFamilyV1("network-peer-grant-receipt-v1"),
  })],
  [rustIntegratedRuntimeDomainWireFamilyV1("network-agent-grant-v1").typeId, Object.freeze({
    request: rustIntegratedRuntimeDomainWireFamilyV1("network-agent-grant-v1"),
    response: rustIntegratedRuntimeDomainWireFamilyV1("network-agent-grant-receipt-v1"),
  })],
  [rustIntegratedRuntimeDomainWireFamilyV1("network-replication-upsert-v1").typeId, Object.freeze({
    request: rustIntegratedRuntimeDomainWireFamilyV1("network-replication-upsert-v1"),
    response: rustIntegratedRuntimeDomainWireFamilyV1("network-replication-upsert-receipt-v1"),
  })],
  [rustIntegratedRuntimeDomainWireFamilyV1("network-replication-remove-v1").typeId, Object.freeze({
    request: rustIntegratedRuntimeDomainWireFamilyV1("network-replication-remove-v1"),
    response: rustIntegratedRuntimeDomainWireFamilyV1("network-replication-remove-receipt-v1"),
  })],
  [rustIntegratedRuntimeDomainWireFamilyV1("network-delta-build-v1").typeId, Object.freeze({
    request: rustIntegratedRuntimeDomainWireFamilyV1("network-delta-build-v1"),
    response: rustIntegratedRuntimeDomainWireFamilyV1("network-delta-build-response-v1"),
  })],
  [rustIntegratedRuntimeDomainWireFamilyV1("network-reconnect-v1").typeId, Object.freeze({
    request: rustIntegratedRuntimeDomainWireFamilyV1("network-reconnect-v1"),
    response: rustIntegratedRuntimeDomainWireFamilyV1("network-reconnect-response-v1"),
  })],
  [rustIntegratedRuntimeDomainWireFamilyV1("network-peer-release-v1").typeId, Object.freeze({
    request: rustIntegratedRuntimeDomainWireFamilyV1("network-peer-release-v1"),
    response: rustIntegratedRuntimeDomainWireFamilyV1("network-peer-release-receipt-v1"),
  })],
  [rustIntegratedRuntimeDomainWireFamilyV1("network-command-release-v1").typeId, Object.freeze({
    request: rustIntegratedRuntimeDomainWireFamilyV1("network-command-release-v1"),
    response: rustIntegratedRuntimeDomainWireFamilyV1("network-command-release-receipt-v1"),
  })],
]);

export const RUST_INTEGRATED_NETWORK_REQUEST_TYPE_V1 = NETWORK_REQUEST_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_RESPONSE_TYPE_V1 = NETWORK_RESPONSE_SCHEMA.typeId;

const MAX_CACHED_NETWORK_RESPONSES = 4_096;
const MAX_STALE_NETWORK_REAUTHOR_ATTEMPTS = 8;
const identityScopeEncoder = new TextEncoder();

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function runtimeIdentityScope(identity: RustIntegratedRuntimeIdentityV1) {
  const revision = identity.revision;
  return rustIntegratedRuntimeWireChecksumV1(identityScopeEncoder.encode(JSON.stringify([
    identity.universeId,
    identity.locationId,
    revision.epoch,
    revision.world,
    revision.entities,
    revision.gameplay,
    revision.persistence,
    revision.network,
    revision.simulation,
    identity.tick,
    identity.stateHash,
  ])));
}

function acknowledgementFamily(
  typeId: string,
): RustIntegratedNetworkAcknowledgementFamilyV1 | null {
  if (typeId === RUST_INTEGRATED_NETWORK_PEER_GRANT_TYPE_V1) return "peer-grant";
  if (typeId === RUST_INTEGRATED_NETWORK_AGENT_GRANT_TYPE_V1) return "agent-grant";
  if (typeId === RUST_INTEGRATED_NETWORK_REPLICATION_UPSERT_TYPE_V1) return "replication-upsert";
  if (typeId === RUST_INTEGRATED_NETWORK_REPLICATION_REMOVE_TYPE_V1) return "replication-remove";
  if (typeId === RUST_INTEGRATED_NETWORK_PEER_RELEASE_TYPE_V1) return "peer-release";
  if (typeId === RUST_INTEGRATED_NETWORK_COMMAND_RELEASE_TYPE_V1) return "command-release";
  return null;
}

/**
 * Adapts the browser WebRTC shell to the sole integrated Rust authority.
 * Complete BWRN/BWNA packets remain opaque; this layer only adds the reliable
 * BWRQ receipt and never translates peer, agent, interest, or delta objects.
 */
export class RustIntegratedNetworkRuntimePortV1 implements RustNetworkRuntimePortV1 {
  readonly backend = "rust-wasm-worker" as const;
  private readonly settled = new Map<string, Readonly<{ request: Uint8Array; response: Uint8Array }>>();
  private readonly pending = new Map<string, Readonly<{ request: Uint8Array; promise: Promise<Uint8Array> }>>();
  private readonly order: string[] = [];
  private serial = Promise.resolve<unknown>(undefined);

  constructor(
    private readonly runtime: RustIntegratedRuntimeServiceV1,
    private readonly actorId = "platform:network",
  ) {}

  request(message: Uint8Array, transfer: readonly ArrayBuffer[]) {
    void transfer;
    if (!(message instanceof Uint8Array)) {
      return Promise.reject(new RustNetworkRuntimeContractError("packet", "integrated network request must be a Uint8Array"));
    }
    const payload = Uint8Array.from(message);
    const payloadHash = rustIntegratedRuntimeWireChecksumV1(payload);
    const cached = this.settled.get(payloadHash);
    if (cached) {
      if (!sameBytes(cached.request, payload)) return Promise.reject(new RustNetworkRuntimeContractError("checksum-collision", "different BWRN bytes share one integrated checksum"));
      return Promise.resolve(Uint8Array.from(cached.response));
    }
    const pending = this.pending.get(payloadHash);
    if (pending) {
      if (!sameBytes(pending.request, payload)) return Promise.reject(new RustNetworkRuntimeContractError("checksum-collision", "different pending BWRN bytes share one integrated checksum"));
      return pending.promise.then((bytes) => Uint8Array.from(bytes));
    }

    const request = this.enqueue(async () => {
      const operation = createRustIntegratedRuntimeDomainOperationV1({
        domain: "network",
        typeId: RUST_INTEGRATED_NETWORK_REQUEST_TYPE_V1,
        schema: NETWORK_REQUEST_SCHEMA.operationSchema,
        payload,
      });
      const receipt = await this.commandAgainstCurrentIdentity((expected) => createRustIntegratedRuntimeCommandBatchV1({
        commandId: `network:${payloadHash}`,
        idempotencyKey: `network:${payloadHash}`,
        actorId: this.actorId,
        expected,
        operations: [operation],
      }));
      const bytes = this.responseBytes(receipt);
      this.settled.set(payloadHash, Object.freeze({ request: payload, response: bytes }));
      this.order.push(payloadHash);
      while (this.order.length > MAX_CACHED_NETWORK_RESPONSES) {
        const expired = this.order.shift();
        if (expired) this.settled.delete(expired);
      }
      return Uint8Array.from(bytes);
    }).finally(() => {
      this.pending.delete(payloadHash);
    });
    this.pending.set(payloadHash, Object.freeze({ request: payload, promise: request }));
    return request;
  }

  installPeerGrant(grant: NetworkPeerGrantV1) {
    return this.lifecycle(
      RUST_INTEGRATED_NETWORK_PEER_GRANT_TYPE_V1,
      RUST_INTEGRATED_NETWORK_GRANT_RECEIPT_TYPE_V1,
      encodeRustIntegratedNetworkPeerGrantV1(grant),
    ).then(() => undefined);
  }

  installAgentGrant(grant: RustIntegratedNetworkAgentGrantV1) {
    return this.lifecycle(
      RUST_INTEGRATED_NETWORK_AGENT_GRANT_TYPE_V1,
      RUST_INTEGRATED_NETWORK_GRANT_RECEIPT_TYPE_V1,
      encodeRustIntegratedNetworkAgentGrantV1(grant),
    ).then(() => undefined);
  }

  upsertReplicationRecord(value: RustIntegratedScopedDeltaRecordV1) {
    return this.lifecycle(
      RUST_INTEGRATED_NETWORK_REPLICATION_UPSERT_TYPE_V1,
      RUST_INTEGRATED_NETWORK_REPLICATION_RECEIPT_TYPE_V1,
      encodeRustIntegratedNetworkReplicationRecordV1(value),
    ).then(() => undefined);
  }

  removeReplicationRecord(value: RustIntegratedScopedDeltaRecordV1) {
    return this.lifecycle(
      RUST_INTEGRATED_NETWORK_REPLICATION_REMOVE_TYPE_V1,
      RUST_INTEGRATED_NETWORK_REPLICATION_RECEIPT_TYPE_V1,
      encodeRustIntegratedNetworkReplicationRecordV1(value),
    ).then(() => undefined);
  }

  buildDelta(value: RustIntegratedNetworkDeltaBuildRequestV1) {
    return this.lifecycle(
      RUST_INTEGRATED_NETWORK_DELTA_BUILD_TYPE_V1,
      RUST_INTEGRATED_NETWORK_DELTA_BUILD_RESPONSE_TYPE_V1,
      encodeRustIntegratedNetworkDeltaBuildV1(value),
      false,
    ).then(decodeRustIntegratedNetworkDeltaBuildResponseV1);
  }

  reconnectCheckpoint(sessionId: string, peerId: string, connectionGeneration: number) {
    return this.lifecycle(
      RUST_INTEGRATED_NETWORK_RECONNECT_TYPE_V1,
      RUST_INTEGRATED_NETWORK_RECONNECT_RESPONSE_TYPE_V1,
      encodeRustIntegratedNetworkReconnectV1(sessionId, peerId, connectionGeneration),
    ).then(decodeRustIntegratedNetworkReconnectResponseV1);
  }

  releasePeer(peerId: string) {
    return this.lifecycle(
      RUST_INTEGRATED_NETWORK_PEER_RELEASE_TYPE_V1,
      RUST_INTEGRATED_NETWORK_PEER_RELEASE_RECEIPT_TYPE_V1,
      encodeRustIntegratedNetworkPeerReleaseV1(peerId),
    ).then(() => undefined);
  }

  /** Releases the Rust authority lease only after the host commits or cancels the command. */
  releaseCommand(commandId: string) {
    return this.lifecycle(
      RUST_INTEGRATED_NETWORK_COMMAND_RELEASE_TYPE_V1,
      RUST_INTEGRATED_NETWORK_COMMAND_RELEASE_RECEIPT_TYPE_V1,
      encodeRustIntegratedNetworkCommandReleaseV1(commandId),
    ).then(() => undefined);
  }

  private lifecycle(typeId: string, responseTypeId: string, payload: Uint8Array, reauthorOnStale = true) {
    const schemas = NETWORK_LIFECYCLE_SCHEMAS.get(typeId);
    if (!schemas || schemas.response.typeId !== responseTypeId) {
      return Promise.reject(new RustNetworkRuntimeContractError(
        "schema-family",
        `integrated network lifecycle schema is not registered for ${typeId}`,
      ));
    }
    const payloadHash = rustIntegratedRuntimeWireChecksumV1(payload);
    return this.enqueue(async () => {
      const operation = createRustIntegratedRuntimeDomainOperationV1({
        domain: "network",
        typeId,
        schema: schemas.request.operationSchema,
        payload,
      });
      const receipt = await this.commandAgainstCurrentIdentity((expected) => {
        // The same lifecycle payload may be valid again after another accepted
        // command advances the integrated authority. Bind outer idempotency to
        // the complete expected identity so that a later invocation cannot
        // collide with the earlier command's differently encoded batch.
        const commandKey = `${typeId}:${payloadHash}:${runtimeIdentityScope(expected)}`;
        return createRustIntegratedRuntimeCommandBatchV1({
          commandId: commandKey,
          idempotencyKey: commandKey,
          actorId: this.actorId,
          expected,
          operations: [operation],
        });
      }, reauthorOnStale);
      if (receipt.status === "rejected") throw new RustNetworkRuntimeContractError(receipt.code, receipt.message);
      const response = receipt.domainReceipts[0];
      if (receipt.domainReceipts.length !== 1 || response.domain !== "network" || response.typeId !== responseTypeId
        || response.schema !== schemas.response.operationSchema) {
        throw new RustNetworkRuntimeContractError("response-kind", `integrated network lifecycle expected ${responseTypeId}`);
      }
      const responsePayload = Uint8Array.from(response.payload);
      const family = acknowledgementFamily(typeId);
      if (family) {
        const acknowledgement = decodeRustIntegratedNetworkAcknowledgementV1(family, responsePayload);
        if (acknowledgement.requestPayloadHash !== payloadHash) {
          throw new RustNetworkRuntimeContractError(
            "response-request-hash",
            `integrated network ${family} acknowledgement does not attest its request payload`,
          );
        }
        if (acknowledgement.resultingRuntimeStateHash !== receipt.after.stateHash) {
          throw new RustNetworkRuntimeContractError(
            "response-state-hash",
            `integrated network ${family} acknowledgement does not attest the resulting runtime state`,
          );
        }
      }
      return responsePayload;
    });
  }

  /**
   * Integrated domains share one serial native authority queue. A different
   * domain can advance that queue after this adapter reads identity but before
   * its command reaches the head. The service classifies that exact case as a
   * pre-dispatch stale command and leaves authority healthy, so rebuild the
   * batch from the new head identity. Never retry dispatched, indeterminate,
   * or protocol failures.
   */
  private async commandAgainstCurrentIdentity(
    createBatch: (expected: RustIntegratedRuntimeIdentityV1) => RustIntegratedRuntimeCommandBatchV1,
    reauthorOnStale = true,
  ) {
    const attemptLimit = reauthorOnStale ? MAX_STALE_NETWORK_REAUTHOR_ATTEMPTS : 1;
    for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
      const batch = createBatch(this.runtime.identity());
      try {
        return await this.runtime.command(batch);
      } catch (error) {
        if (!(error instanceof RustIntegratedRuntimeServiceError)
          || error.code !== "stale-command"
          || attempt + 1 >= attemptLimit) throw error;
      }
    }
    throw new RustNetworkRuntimeContractError("stale-command", "integrated network command exhausted its stale re-authoring bound");
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const next = this.serial.then(operation, operation);
    this.serial = next.then(() => undefined, () => undefined);
    return next;
  }

  private responseBytes(receipt: RustIntegratedRuntimeCommandReceiptV1) {
    if (receipt.status === "rejected") {
      throw new RustNetworkRuntimeContractError(receipt.code, receipt.message);
    }
    const responses = receipt.domainReceipts.filter((operation) => (
      operation.domain === "network"
      && operation.typeId === RUST_INTEGRATED_NETWORK_RESPONSE_TYPE_V1
      && operation.schema === NETWORK_RESPONSE_SCHEMA.operationSchema
    ));
    if (responses.length !== 1 || receipt.domainReceipts.length !== 1) {
      throw new RustNetworkRuntimeContractError("response-kind", "integrated network command must return exactly one opaque BWNA response");
    }
    return Uint8Array.from(responses[0].payload);
  }
}
