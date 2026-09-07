import { TYPESCRIPT_RENDEZVOUS_APP_ID } from "./edition";

type JsonRecord = Record<string, string | number | boolean | null>;

export type RendezvousStatus = "opening" | "waiting" | "retrying" | "exchanging" | "connected" | "closed" | "error";

type RequestContext = { peerId: string };
type RequestOptions = { target: string; timeoutMs?: number };

export type RendezvousRequest<T extends JsonRecord, R extends JsonRecord> = {
  request(data: T, options: RequestOptions): Promise<R>;
  onRequest: ((data: T, context: RequestContext) => R | Promise<R>) | null;
};

export type RendezvousRoom = {
  makeAction<T extends JsonRecord, R extends JsonRecord>(
    namespace: string,
    config: { kind: "request"; onRequest?: (data: T, context: RequestContext) => R | Promise<R> },
  ): RendezvousRequest<T, R>;
  getPeers(): Record<string, unknown>;
  leave(): Promise<void>;
  onPeerJoin: ((peerId: string) => void) | null;
};

export type RendezvousRole = "host" | "guest";
export type RendezvousRoomFactory = (role: RendezvousRole, code: string) => Promise<RendezvousRoom>;

type InviteRequest = { guestName: string };
type InviteResponse = { inviteCode: string; hostName: string };
type AnswerRequest = { answerCode: string };
type AnswerResponse = { accepted: boolean };

export const RENDEZVOUS_APP_ID = TYPESCRIPT_RENDEZVOUS_APP_ID;
const INVITE_ACTION = "bwinvite";
const ANSWER_ACTION = "bwanswer";
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
/**
 * A small explicitly verified relay set avoids repeatedly reconnecting to a
 * dead default relay (notably the old Halifax endpoint) while retaining enough
 * independent Nostr rendezvous paths for home networks and school firewalls.
 */
export const RENDEZVOUS_RELAY_URLS = Object.freeze([
  "wss://nos.lol",
  "wss://relay.mostr.pub",
  "wss://relay.nostr.place",
  "wss://purplerelay.com",
  "wss://nostr-01.yakihonne.com",
]);

export function normalizeRoomCode(value: string) {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  if (clean.replace(/-/g, "").length < 6) throw new Error("Invite codes need at least six letters or numbers.");
  return clean;
}

export function createRoomCode(randomValues: (target: Uint8Array) => Uint8Array = (target) => crypto.getRandomValues(target)) {
  const bytes = randomValues(new Uint8Array(10));
  const symbols = [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]);
  return `${symbols.slice(0, 5).join("")}-${symbols.slice(5).join("")}`;
}

function roleHandshake(role: RendezvousRole) {
  return async (_peerId: string, send: (data: JsonRecord) => Promise<void>, receive: () => Promise<{ data: unknown }>) => {
    await send({ role });
    const remote = await receive();
    const expected = role === "host" ? "guest" : "host";
    if (!remote.data || typeof remote.data !== "object" || (remote.data as { role?: unknown }).role !== expected) {
      throw new Error(`Expected a ${expected} rendezvous peer.`);
    }
  };
}

export async function defaultRendezvousRoomFactory(role: RendezvousRole, code: string): Promise<RendezvousRoom> {
  if (typeof window === "undefined") throw new Error("Invite-code rendezvous is only available in a browser.");
  const { joinRoom } = await import("trystero");
  return joinRoom({
    appId: RENDEZVOUS_APP_ID,
    password: code,
    trickleIce: true,
    relayConfig: { urls: [...RENDEZVOUS_RELAY_URLS] },
  }, code, {
    handshakeTimeoutMs: 12_000,
    onPeerHandshake: roleHandshake(role),
  }) as unknown as RendezvousRoom;
}

function waitForPeer(room: RendezvousRoom, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const previous = room.onPeerJoin;
    const cleanup = () => {
      clearTimeout(timer);
      if (room.onPeerJoin === listener) room.onPeerJoin = previous;
    };
    const finish = (peerId: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(peerId);
    };
    const listener = (peerId: string) => {
      previous?.(peerId);
      finish(peerId);
    };
    room.onPeerJoin = listener;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("No host answered that invite code. Check the code and that the host is still waiting."));
    }, timeoutMs);
    const existing = Object.keys(room.getPeers())[0];
    if (existing) finish(existing);
  });
}

export function isBenignRendezvousCloseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /user[- ]initiated.*(?:abort|close)|(?:abort|close).*called|room (?:is )?closed|already (?:left|closed)/iu.test(message);
}

export function isRetryableRendezvousError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /missing .* handler|no .* peer|peer .* unavailable|request .* timed? ?out|timed? ?out|not (?:yet )?connected|connection .* opening|abort|close/iu.test(message);
}

async function leaveQuietly(room: RendezvousRoom) {
  try {
    await room.leave();
  } catch {
    // Rendezvous teardown is best-effort after the direct WebRTC exchange. A
    // cleanup failure must never replace either the real join result or its
    // actionable primary error.
  }
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export type HostRendezvous = {
  code: string;
  /** Clears completed offer/answer flights so the same browser can rejoin. */
  reset(): void;
  close(): Promise<void>;
};

export async function hostByRoomCode(options: {
  code: string;
  hostName: string;
  createInvite(): Promise<{ inviteCode: string }>;
  acceptAnswer(answerCode: string): Promise<void>;
  roomFactory?: RendezvousRoomFactory;
  onStatus?: (status: RendezvousStatus) => void;
}): Promise<HostRendezvous> {
  const code = normalizeRoomCode(options.code);
  options.onStatus?.("opening");
  const room = await (options.roomFactory ?? defaultRendezvousRoomFactory)("host", code);
  const inviteFlights = new Map<string, Promise<InviteResponse>>();
  const answerFlights = new Map<string, { answerCode: string; flight: Promise<AnswerResponse> }>();
  const invite = room.makeAction<InviteRequest, InviteResponse>(INVITE_ACTION, {
    kind: "request",
    onRequest: async (_request, context) => {
      options.onStatus?.("exchanging");
      let flight = inviteFlights.get(context.peerId);
      if (!flight) {
        flight = options.createInvite().then((created) => ({ inviteCode: created.inviteCode, hostName: options.hostName }));
        inviteFlights.set(context.peerId, flight);
        void flight.catch(() => { if (inviteFlights.get(context.peerId) === flight) inviteFlights.delete(context.peerId); });
      }
      return await flight;
    },
  });
  const answer = room.makeAction<AnswerRequest, AnswerResponse>(ANSWER_ACTION, {
    kind: "request",
    onRequest: async ({ answerCode }, context) => {
      const previous = answerFlights.get(context.peerId);
      if (previous && previous.answerCode !== answerCode) throw new Error("That guest changed answers during connection setup. Please join again.");
      let flight = previous?.flight;
      if (!flight) {
        flight = options.acceptAnswer(answerCode).then(() => ({ accepted: true }));
        answerFlights.set(context.peerId, { answerCode, flight });
        void flight.catch(() => { if (answerFlights.get(context.peerId)?.flight === flight) answerFlights.delete(context.peerId); });
      }
      await flight;
      options.onStatus?.("connected");
      return { accepted: true };
    },
  });
  // Hold strong references to the request actions for the life of the room.
  void invite;
  void answer;
  options.onStatus?.("waiting");
  let closeFlight: Promise<void> | null = null;
  return {
    code,
    reset() {
      inviteFlights.clear();
      answerFlights.clear();
      options.onStatus?.("waiting");
    },
    async close() {
      closeFlight ??= leaveQuietly(room).finally(() => options.onStatus?.("closed"));
      await closeFlight;
    },
  };
}

export async function joinByRoomCode(options: {
  code: string;
  guestName: string;
  createAnswer(inviteCode: string): Promise<{ answerCode: string }>;
  roomFactory?: RendezvousRoomFactory;
  timeoutMs?: number;
  retryDelayMs?: number;
  onStatus?: (status: RendezvousStatus) => void;
}) {
  const code = normalizeRoomCode(options.code);
  const timeoutMs = Math.max(options.roomFactory ? 100 : 5_000, options.timeoutMs ?? 35_000);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 350);
  const deadline = Date.now() + timeoutMs;
  options.onStatus?.("opening");
  const room = await (options.roomFactory ?? defaultRendezvousRoomFactory)("guest", code);
  try {
    options.onStatus?.("waiting");
    const invite = room.makeAction<InviteRequest, InviteResponse>(INVITE_ACTION, { kind: "request" });
    const answer = room.makeAction<AnswerRequest, AnswerResponse>(ANSWER_ACTION, { kind: "request" });
    let peerId = "";
    let offered: InviteResponse | null = null;
    let created: { answerCode: string } | null = null;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        const peers = Object.keys(room.getPeers());
        const nextPeerId = peers.includes(peerId) ? peerId : peers[0] ?? await waitForPeer(room, Math.max(50, deadline - Date.now()));
        if (nextPeerId !== peerId) {
          peerId = nextPeerId;
          offered = null;
          created = null;
        }
        options.onStatus?.("exchanging");
        const requestTimeout = Math.max(50, Math.min(4_000, deadline - Date.now()));
        offered ??= await invite.request({ guestName: options.guestName }, { target: peerId, timeoutMs: requestTimeout });
        created ??= await options.createAnswer(offered.inviteCode);
        const accepted = await answer.request({ answerCode: created.answerCode }, { target: peerId, timeoutMs: requestTimeout });
        if (!accepted.accepted) throw new Error("The host declined the multiplayer answer.");
        options.onStatus?.("connected");
        return { code, hostName: offered.hostName };
      } catch (error) {
        lastError = error;
        if (!isRetryableRendezvousError(error) || Date.now() + retryDelayMs >= deadline) throw error;
        options.onStatus?.("retrying");
        if (retryDelayMs) await delay(retryDelayMs);
        options.onStatus?.("waiting");
      }
    }
    throw lastError ?? new Error("No host answered that invite code before the connection window closed.");
  } catch (error) {
    options.onStatus?.("error");
    throw error;
  } finally {
    await leaveQuietly(room);
  }
}
