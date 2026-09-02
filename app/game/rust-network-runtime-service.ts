import {
  RustNetworkRuntimeContractError,
  decodeRustNetworkResponseV1,
  encodeRustNetworkAgentRequestV1,
  encodeRustNetworkCommandBatchRequestV1,
  encodeRustNetworkDeltaDeliveryRequestV1,
  encodeRustNetworkGuestPoseRequestV1,
  encodeRustNetworkHandshakeRequestV1,
  type RustNetworkResponseV1,
} from "./rust-network-runtime-contract";
import type { NetworkAuthorityIdentityV1, NetworkInterestSetV1 } from "./network-authority-contract";

/** Real production implementations must be backed by the long-lived Rust/Wasm engine worker. */
export interface RustNetworkRuntimePortV1 {
  readonly backend: "rust-wasm-worker";
  request(message: Uint8Array, transfer: readonly ArrayBuffer[]): Promise<Uint8Array>;
}

/** Thin request/response client. It never makes a multiplayer authority decision in TypeScript. */
export class RustNetworkRuntimeServiceV1 {
  private nextRequestId = 1;
  private readonly pending = new Map<number, Promise<RustNetworkResponseV1>>();

  constructor(private readonly port: RustNetworkRuntimePortV1) {
    if (port.backend !== "rust-wasm-worker") throw new RustNetworkRuntimeContractError("backend", "R9 authority requires a Rust/Wasm worker port");
  }

  negotiate(hostPacket: Uint8Array, peerPacket: Uint8Array) { return this.transact("handshake", (id) => encodeRustNetworkHandshakeRequestV1(id, hostPacket, peerPacket)); }
  authorize(current: NetworkAuthorityIdentityV1, now: number, commandPackets: readonly Uint8Array[]) { return this.transact("command-batch", (id) => encodeRustNetworkCommandBatchRequestV1(id, current, now, commandPackets)); }
  validateDelta(checkpointPacket: Uint8Array, interest: NetworkInterestSetV1, deltaPacket: Uint8Array) { return this.transact("delta-delivery", (id) => encodeRustNetworkDeltaDeliveryRequestV1(id, checkpointPacket, interest, deltaPacket)); }
  authorizeAgent(current: NetworkAuthorityIdentityV1, now: number, envelopePacket: Uint8Array, workPacket: Uint8Array) { return this.transact("agent-command", (id) => encodeRustNetworkAgentRequestV1(id, current, now, envelopePacket, workPacket)); }
  authorizeGuestPose(current: NetworkAuthorityIdentityV1, now: number, commandPacket: Uint8Array) { return this.transact("guest-pose", (id) => encodeRustNetworkGuestPoseRequestV1(id, current, now, commandPacket)); }

  private transact(expectedKind: Exclude<RustNetworkResponseV1["kind"], "error">, build: (requestId: number) => Uint8Array) {
    const requestId = this.nextRequestId++;
    const message = build(requestId);
    const transfer = message.buffer instanceof ArrayBuffer ? [message.buffer] : [];
    const promise = this.port.request(message, transfer).then((bytes) => {
      const response = decodeRustNetworkResponseV1(bytes);
      if (response.requestId !== requestId) throw new RustNetworkRuntimeContractError("stale", `Rust network response ${response.requestId} does not match request ${requestId}`);
      if (response.kind === "error") throw new RustNetworkRuntimeContractError(response.code, response.message);
      if (response.kind !== expectedKind) throw new RustNetworkRuntimeContractError("response-kind", `Expected Rust ${expectedKind} response, received ${response.kind}`);
      return response;
    }).finally(() => { this.pending.delete(requestId); });
    this.pending.set(requestId, promise);
    return promise;
  }

  get pendingCount() { return this.pending.size; }
}
