/**
 * Passerelle temps réel WebSocket.
 *
 * Fait tourner le `GameEngine` autoritaire, diffuse l'état PUBLIC à tous les
 * clients (vrai multijoueur partagé) et reçoit leurs INTENTIONS (place_bet,
 * cashout) en les horodatant CÔTÉ SERVEUR (`Date.now()`), jamais avec l'horloge
 * du client. L'état diffusé ne contient jamais `crashAt` ni la graine secrète
 * avant le crash.
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { GameEngine, type GameEvent } from "../game/engine";
import type { RoundSnapshot } from "../game/types";
import { parseClientMessage, type PublicRoundState, type ServerMessage } from "./protocol";

function publicState(snap: RoundSnapshot, now: number): PublicRoundState {
  return {
    roundId: snap.roundId,
    phase: snap.phase,
    multiplier: snap.multiplier,
    bettingEndsAt: snap.bettingEndsAt,
    serverSeedHash: snap.seeds.serverSeedHash,
    serverSeedRevealed: snap.seeds.serverSeedRevealed,
    crashPoint: snap.crashPoint,
    betCount: snap.bets.length,
    totalStakedCents: snap.bets.reduce((a, b) => a + b.amountCents, 0),
    serverTime: now,
  };
}

let anonCounter = 0;

export interface GatewayOptions {
  engine: GameEngine;
  /** Période de diffusion de l'état (ms). ~12 Hz par défaut. */
  tickIntervalMs?: number;
  /** Horloge serveur (injectable pour les tests). */
  now?: () => number;
}

export class RealtimeGateway {
  private readonly engine: GameEngine;
  private readonly tickIntervalMs: number;
  private readonly now: () => number;
  private wss: WebSocketServer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly players = new WeakMap<WebSocket, string>();

  constructor(opts: GatewayOptions) {
    this.engine = opts.engine;
    this.tickIntervalMs = opts.tickIntervalMs ?? 80;
    this.now = opts.now ?? Date.now;
  }

  /** Attache la passerelle à un serveur HTTP existant et démarre la boucle. */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server });

    // Diffusion des événements discrets du moteur (création de tour, crash).
    this.unsubscribe = this.engine.subscribe((e) => this.onEngineEvent(e));

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const playerId = this.assignPlayerId(req);
      this.players.set(ws, playerId);
      this.send(ws, { t: "welcome", playerId, serverTime: this.now() });
      this.send(ws, { t: "state", state: publicState(this.engine.snapshot(this.now()), this.now()) });
      ws.on("message", (data: RawData) => this.onMessage(ws, data));
    });

    this.start();
  }

  private assignPlayerId(req: IncomingMessage): string {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.searchParams.get("player");
      if (p) return p.slice(0, 48);
    } catch {
      /* ignore */
    }
    return `anon-${++anonCounter}`;
  }

  private start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = this.now();
      this.engine.tick(now);
      this.broadcast({ t: "state", state: publicState(this.engine.snapshot(now), now) });
    }, this.tickIntervalMs);
  }

  private onEngineEvent(e: GameEvent): void {
    if (e.type === "roundCreated") {
      this.broadcast({
        t: "round_created",
        roundId: e.roundId,
        serverSeedHash: e.serverSeedHash,
        bettingEndsAt: e.bettingEndsAt,
        serverTime: this.now(),
      });
    } else if (e.type === "crashed") {
      this.broadcast({
        t: "crashed",
        roundId: e.roundId,
        crashPoint: e.crashPoint,
        serverSeed: e.serverSeed,
        serverSeedHash: e.serverSeedHash,
        clientSeed: e.clientSeed,
        nonce: e.nonce,
      });
    }
  }

  private onMessage(ws: WebSocket, data: RawData): void {
    const msg = parseClientMessage(data.toString());
    if (!msg) return this.send(ws, { t: "error", message: "message invalide" });
    const playerId = this.players.get(ws) ?? "anon";
    // L'instant qui fait foi = horodatage SERVEUR à la réception.
    const now = this.now();
    if (msg.t === "place_bet") {
      const r = this.engine.placeBet(
        { betId: msg.betId, playerId, amountCents: msg.amountCents },
        now,
      );
      this.send(ws, { t: "bet_ack", betId: msg.betId, ok: r.ok, reason: r.ok ? undefined : r.reason });
    } else if (msg.t === "cashout") {
      const r = this.engine.cashOut(msg.betId, now);
      this.send(ws, {
        t: "cashout_ack",
        betId: msg.betId,
        ok: r.ok,
        multiplier: r.ok ? r.bet.cashoutMultiplier : undefined,
        payoutCents: r.ok ? r.bet.payoutCents : undefined,
        reason: r.ok ? undefined : r.reason,
      });
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    if (!this.wss) return;
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.wss?.close();
    this.wss = null;
  }
}
