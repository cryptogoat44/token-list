import { describe, expect, it } from "vitest";
import {
  RgsClient,
  type AckEvent,
  type CrashReveal,
  type MessageLike,
  type SocketEventHandler,
  type SocketEventType,
  type WebSocketLike,
} from "./rgsClient";
import type { ClientMessage, PublicRoundState, ServerMessage } from "@shared/protocol";

/** Socket factice pilotable, conforme à WebSocketLike. */
class FakeSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  private handlers: Record<string, SocketEventHandler[]> = {};

  addEventListener(type: SocketEventType, handler: SocketEventHandler): void {
    (this.handlers[type] ??= []).push(handler);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3; // CLOSED
    this.fire("close");
  }

  // --- helpers de test ---
  fire(type: SocketEventType, ev: MessageLike = { data: undefined }): void {
    (this.handlers[type] ?? []).forEach((h) => h(ev));
  }
  open(): void {
    this.readyState = 1; // OPEN
    this.fire("open");
  }
  emit(msg: ServerMessage): void {
    this.fire("message", { data: JSON.stringify(msg) });
  }
  parsedSent(): ClientMessage[] {
    return this.sent.map((s) => JSON.parse(s) as ClientMessage);
  }
}

function makeState(over: Partial<PublicRoundState> = {}): PublicRoundState {
  return {
    roundId: 1,
    phase: "BETTING",
    multiplier: 1,
    bettingEndsAt: 5000,
    serverSeedHash: "hash-abc",
    serverSeedRevealed: null,
    crashPoint: null,
    betCount: 0,
    totalStakedCents: 0,
    serverTime: 10_000,
    ...over,
  };
}

interface Harness {
  client: RgsClient;
  sockets: FakeSocket[];
  runTimers: () => void;
  setNow: (t: number) => void;
}

function harness(player?: string): Harness {
  const sockets: FakeSocket[] = [];
  let clock = 1000;
  const timers: Array<{ id: number; cb: () => void }> = [];
  let tid = 0;
  const client = new RgsClient({
    url: "ws://test",
    player,
    now: () => clock,
    reconnectBaseMs: 10,
    socketFactory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    setTimeoutFn: (cb) => {
      const id = ++tid;
      timers.push({ id, cb });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: (id) => {
      const i = timers.findIndex((t) => t.id === (id as unknown as number));
      if (i >= 0) timers.splice(i, 1);
    },
  });
  return {
    client,
    sockets,
    runTimers: () => timers.splice(0).forEach((t) => t.cb()),
    setNow: (t) => {
      clock = t;
    },
  };
}

describe("RgsClient", () => {
  it("passe en 'open', applique welcome/state et n'expose jamais crashAt", () => {
    const h = harness("alice");
    const seen: string[] = [];
    h.client.subscribe((s) => seen.push(s.status));
    h.client.connect();

    expect(h.sockets).toHaveLength(1);
    // L'URL inclut le pseudo (transport seulement).
    h.sockets[0].open();
    h.sockets[0].emit({ t: "welcome", playerId: "alice", serverTime: 10_000 });
    h.sockets[0].emit({ t: "state", state: makeState({ multiplier: 1, phase: "BETTING" }) });

    const snap = h.client.getSnapshot();
    expect(snap.status).toBe("open");
    expect(snap.playerId).toBe("alice");
    expect(snap.state?.roundId).toBe(1);
    // Décalage horloge = serverTime − now() = 10000 − 1000.
    expect(snap.clockOffsetMs).toBe(9000);
    expect(h.client.serverNow()).toBe(10_000);
    // SÉCURITÉ : l'état public ne contient pas crashAt.
    expect(Object.prototype.hasOwnProperty.call(snap.state!, "crashAt")).toBe(false);
    expect(seen).toContain("connecting");
    expect(seen).toContain("open");
  });

  it("n'envoie une mise que connecté, renvoie un betId, et remonte le bet_ack", () => {
    const h = harness();
    const acks: AckEvent[] = [];
    h.client.onAck((a) => acks.push(a));
    h.client.connect();

    // Avant 'open' : refus d'envoi.
    expect(h.client.placeBet(1000)).toBeNull();

    h.sockets[0].open();
    const betId = h.client.placeBet(1500);
    expect(betId).not.toBeNull();
    const sent = h.sockets[0].parsedSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: "place_bet", betId, amountCents: 1500 });

    h.sockets[0].emit({ t: "bet_ack", betId: betId!, ok: true });
    expect(acks).toContainEqual({ kind: "bet", betId, ok: true, reason: undefined });
  });

  it("encaisse et remonte le cashout_ack avec multiplicateur et gain", () => {
    const h = harness();
    const acks: AckEvent[] = [];
    h.client.onAck((a) => acks.push(a));
    h.client.connect();
    h.sockets[0].open();

    expect(h.client.cashout("b1")).toBe(true);
    expect(h.sockets[0].parsedSent()[0]).toMatchObject({ t: "cashout", betId: "b1" });

    h.sockets[0].emit({
      t: "cashout_ack",
      betId: "b1",
      ok: true,
      multiplier: 2.5,
      payoutCents: 2500,
    });
    expect(acks[0]).toMatchObject({ kind: "cashout", betId: "b1", ok: true, multiplier: 2.5, payoutCents: 2500 });
  });

  it("révèle le crash (graine dévoilée) via onCrash et lastReveal", () => {
    const h = harness();
    const reveals: CrashReveal[] = [];
    h.client.onCrash((r) => reveals.push(r));
    h.client.connect();
    h.sockets[0].open();

    h.sockets[0].emit({
      t: "crashed",
      roundId: 7,
      crashPoint: 3.21,
      serverSeed: "secret-seed",
      serverSeedHash: "hash-abc",
      clientSeed: "client-xyz",
      nonce: 7,
    });

    expect(reveals).toHaveLength(1);
    expect(reveals[0].crashPoint).toBe(3.21);
    expect(reveals[0].serverSeed).toBe("secret-seed");
    expect(h.client.getSnapshot().lastReveal?.roundId).toBe(7);
  });

  it("se reconnecte automatiquement après une coupure, puis s'arrête sur close()", () => {
    const h = harness();
    const statuses: string[] = [];
    h.client.subscribe((s) => statuses.push(s.status));
    h.client.connect();
    h.sockets[0].open();
    expect(h.client.getSnapshot().status).toBe("open");

    // Coupure non sollicitée → reconnexion planifiée.
    h.sockets[0].close();
    expect(h.client.getSnapshot().status).toBe("reconnecting");
    h.runTimers();
    expect(h.sockets).toHaveLength(2); // nouveau socket créé
    h.sockets[1].open();
    expect(h.client.getSnapshot().status).toBe("open");

    // Fermeture volontaire → plus de reconnexion.
    h.client.close();
    expect(h.client.getSnapshot().status).toBe("closed");
    h.sockets[1].close();
    h.runTimers();
    expect(h.sockets).toHaveLength(2); // aucun nouveau socket
  });
});
