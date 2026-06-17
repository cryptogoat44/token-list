/**
 * Passerelle temps réel WebSocket.
 *
 * Fait tourner le `GameEngine` autoritaire, diffuse l'état PUBLIC à tous les
 * clients (vrai multijoueur partagé) et reçoit leurs INTENTIONS (place_bet,
 * cashout) en les horodatant CÔTÉ SERVEUR (`Date.now()`), jamais avec l'horloge
 * du client. L'état diffusé ne contient jamais `crashAt` ni la graine secrète
 * avant le crash.
 *
 * Wallet & audit sont OPTIONNELS (injectés) :
 *  - avec wallet : la mise DÉBITE le solde (refus si insuffisant, rollback si le
 *    moteur refuse après débit) ; le règlement CRÉDITE les gagnants ;
 *  - avec audit : chaque événement autoritaire est journalisé (chaîne de hash).
 * Sans eux, la passerelle se comporte comme un pur transport (démo).
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { GameEngine, type GameEvent } from "../game/engine";
import type { RoundSettlement, RoundSnapshot } from "../game/types";
import type { AuditLogger } from "../audit/auditLogger";
import { WalletService } from "../wallet/walletService";
import type { WalletContext } from "../wallet/types";
import type { ComplianceService } from "../compliance/complianceService";
import type { ResponsibleGamingService } from "../compliance/responsibleGaming";
import type { OperatorConfig } from "../compliance/types";
import {
  parseClientMessage,
  type ClientMessage,
  type PublicRoundState,
  type ServerMessage,
} from "./protocol";

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

export type ResolveContext = (
  playerId: string,
  req: IncomingMessage,
) => Promise<WalletContext | null> | WalletContext | null;

export interface GatewayOptions {
  engine: GameEngine;
  /** Période de diffusion de l'état (ms). ~12 Hz par défaut. */
  tickIntervalMs?: number;
  /** Horloge serveur (injectable pour les tests). */
  now?: () => number;
  /** Service wallet opérateur (optionnel). */
  wallet?: WalletService;
  /** Journal d'audit (optionnel). */
  audit?: AuditLogger;
  /** Résout le contexte wallet d'un joueur à la connexion (auth/provisionnement). */
  resolveContext?: ResolveContext;
  /** Service de conformité (geo-gating, limites par juridiction/opérateur). */
  compliance?: ComplianceService;
  /** Opérateur courant (périmètre de juridictions, limites par défaut). */
  operator?: OperatorConfig;
  /** Résout le pays d'origine de la connexion (en-tête edge). */
  resolveCountry?: (req: IncomingMessage) => string | null;
  /** Garde-fous de jeu responsable (optionnel). */
  responsibleGaming?: ResponsibleGamingService;
}

export class RealtimeGateway {
  private readonly engine: GameEngine;
  private readonly tickIntervalMs: number;
  private readonly now: () => number;
  private readonly wallet?: WalletService;
  private readonly audit?: AuditLogger;
  private readonly resolveContext?: ResolveContext;
  private readonly compliance?: ComplianceService;
  private readonly operator?: OperatorConfig;
  private readonly resolveCountry?: (req: IncomingMessage) => string | null;
  private readonly responsibleGaming?: ResponsibleGamingService;
  private wss: WebSocketServer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly players = new WeakMap<WebSocket, string>();
  /** Contexte wallet par joueur (persiste le temps de la session). */
  private readonly contexts = new Map<string, WalletContext>();
  /** Limites par joueur résolues à la connexion (plafond de mise). */
  private readonly limits = new Map<string, { maxBetCents?: number }>();

  constructor(opts: GatewayOptions) {
    this.engine = opts.engine;
    this.tickIntervalMs = opts.tickIntervalMs ?? 80;
    this.now = opts.now ?? Date.now;
    this.wallet = opts.wallet;
    this.audit = opts.audit;
    this.resolveContext = opts.resolveContext;
    this.compliance = opts.compliance;
    this.operator = opts.operator;
    this.resolveCountry = opts.resolveCountry;
    this.responsibleGaming = opts.responsibleGaming;
  }

  /** Attache la passerelle à un serveur HTTP existant et démarre la boucle. */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server });
    this.unsubscribe = this.engine.subscribe((e) => this.onEngineEvent(e));
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      void this.onConnection(ws, req);
    });
    this.start();
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const playerId = this.assignPlayerId(req);
    this.players.set(ws, playerId);

    // Geo-gating / conformité (avant tout le reste).
    if (this.compliance && this.operator) {
      const country = this.resolveCountry?.(req) ?? null;
      const decision = this.compliance.evaluateAccess({ operator: this.operator, country });
      if (!decision.allowed) {
        if (this.audit) await this.audit.accessDenied(playerId, decision.country, decision.reason);
        this.send(ws, { t: "error", message: `accès refusé : ${decision.reason}` });
        ws.close();
        return;
      }
      if (decision.maxBetCents !== undefined) this.limits.set(playerId, { maxBetCents: decision.maxBetCents });
    }

    if (this.resolveContext && !this.contexts.has(playerId)) {
      const ctx = await this.resolveContext(playerId, req);
      if (ctx) this.contexts.set(playerId, ctx);
    }
    this.send(ws, { t: "welcome", playerId, serverTime: this.now() });
    this.send(ws, { t: "state", state: publicState(this.engine.snapshot(this.now()), this.now()) });
    ws.on("message", (data: RawData) => void this.onMessage(ws, data));
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
    // Journalisation (round_open / crash_revealed / settlement).
    if (this.audit) void this.audit.fromGameEvent(e);
    // Règlement financier des gagnants.
    if (e.type === "settled" && this.wallet) void this.settleWallet(e.settlement);
  }

  private async settleWallet(s: RoundSettlement): Promise<void> {
    if (!this.wallet) return;
    const report = await this.wallet.settle(s, this.contexts);
    for (const c of report.credited) {
      // Le gain réduit la perte nette de session (jeu responsable).
      this.responsibleGaming?.recordReturn(c.playerId, c.amountCents);
      if (this.audit) {
        await this.audit.walletMovement({
          kind: "credit",
          txId: WalletService.payoutTxId(s.roundId, c.betId),
          playerId: c.playerId,
          amountCents: c.amountCents,
          ok: true,
          roundId: s.roundId,
          betId: c.betId,
        });
      }
    }
    if (this.audit) {
      for (const err of report.errors) {
        await this.audit.walletMovement({
          kind: "credit",
          txId: WalletService.payoutTxId(s.roundId, err.betId),
          playerId: err.playerId,
          amountCents: 0,
          ok: false,
          code: err.code,
          roundId: s.roundId,
          betId: err.betId,
        });
      }
    }
  }

  private async onMessage(ws: WebSocket, data: RawData): Promise<void> {
    const msg = parseClientMessage(data.toString());
    if (!msg) return this.send(ws, { t: "error", message: "message invalide" });
    const playerId = this.players.get(ws) ?? "anon";
    // L'instant qui fait foi = horodatage SERVEUR à la réception.
    const now = this.now();
    if (msg.t === "place_bet") {
      await this.handlePlaceBet(ws, playerId, msg, now);
    } else if (msg.t === "cashout") {
      await this.handleCashout(ws, playerId, msg, now);
    }
  }

  private currentRoundId(now: number): number {
    return this.engine.snapshot(now).roundId;
  }

  private async handlePlaceBet(
    ws: WebSocket,
    playerId: string,
    msg: Extract<ClientMessage, { t: "place_bet" }>,
    now: number,
  ): Promise<void> {
    const roundId = this.currentRoundId(now);

    // Plafond de mise (juridiction / opérateur).
    const limit = this.limits.get(playerId);
    if (limit?.maxBetCents !== undefined && msg.amountCents > limit.maxBetCents) {
      if (this.audit) await this.audit.betRejected(roundId, msg.betId, playerId, msg.amountCents, "exceedsMaxBet");
      return this.send(ws, { t: "bet_ack", betId: msg.betId, ok: false, reason: "exceedsMaxBet" });
    }
    // Jeu responsable (auto-exclusion, plafonds de session).
    if (this.responsibleGaming) {
      const rg = this.responsibleGaming.canBet(playerId, msg.amountCents);
      if (!rg.allowed) {
        if (this.audit) await this.audit.rgBlock(playerId, rg.reason, msg.amountCents);
        return this.send(ws, { t: "bet_ack", betId: msg.betId, ok: false, reason: rg.reason });
      }
    }

    if (this.wallet) {
      const ctx = this.contexts.get(playerId);
      if (!ctx) {
        if (this.audit) await this.audit.betRejected(roundId, msg.betId, playerId, msg.amountCents, "notAuthenticated");
        return this.send(ws, { t: "bet_ack", betId: msg.betId, ok: false, reason: "notAuthenticated" });
      }
      const debit = await this.wallet.debitStake(ctx, roundId, msg.betId, msg.amountCents);
      if (this.audit) {
        await this.audit.walletMovement({
          kind: "debit",
          txId: WalletService.stakeTxId(roundId, msg.betId),
          playerId,
          amountCents: msg.amountCents,
          ok: debit.ok,
          balanceCents: debit.ok ? debit.balanceCents : undefined,
          code: debit.ok ? undefined : debit.code,
          roundId,
          betId: msg.betId,
        });
      }
      if (!debit.ok) {
        if (this.audit) await this.audit.betRejected(roundId, msg.betId, playerId, msg.amountCents, debit.code);
        return this.send(ws, { t: "bet_ack", betId: msg.betId, ok: false, reason: debit.code });
      }
      const r = this.engine.placeBet({ betId: msg.betId, playerId, amountCents: msg.amountCents }, now);
      if (!r.ok) {
        // Le moteur a refusé après débit → on compense (rollback).
        await this.wallet.rollbackStake(roundId, msg.betId);
        if (this.audit) {
          await this.audit.walletMovement({
            kind: "rollback",
            txId: WalletService.stakeTxId(roundId, msg.betId),
            playerId,
            amountCents: msg.amountCents,
            ok: true,
            roundId,
            betId: msg.betId,
          });
          await this.audit.betRejected(roundId, msg.betId, playerId, msg.amountCents, r.reason);
        }
        return this.send(ws, { t: "bet_ack", betId: msg.betId, ok: false, reason: r.reason });
      }
      this.responsibleGaming?.recordBet(playerId, msg.amountCents);
      if (this.audit) await this.audit.betAccepted(roundId, msg.betId, playerId, msg.amountCents);
      return this.send(ws, { t: "bet_ack", betId: msg.betId, ok: true });
    }

    // Sans wallet (démo) : le moteur fait foi, audit facultatif.
    const r = this.engine.placeBet({ betId: msg.betId, playerId, amountCents: msg.amountCents }, now);
    if (r.ok) this.responsibleGaming?.recordBet(playerId, msg.amountCents);
    if (this.audit) {
      if (r.ok) await this.audit.betAccepted(roundId, msg.betId, playerId, msg.amountCents);
      else await this.audit.betRejected(roundId, msg.betId, playerId, msg.amountCents, r.reason);
    }
    this.send(ws, { t: "bet_ack", betId: msg.betId, ok: r.ok, reason: r.ok ? undefined : r.reason });
  }

  private async handleCashout(
    ws: WebSocket,
    playerId: string,
    msg: Extract<ClientMessage, { t: "cashout" }>,
    now: number,
  ): Promise<void> {
    const r = this.engine.cashOut(msg.betId, now);
    if (this.audit && r.ok) {
      await this.audit.cashout(
        this.currentRoundId(now),
        msg.betId,
        playerId,
        r.bet.cashoutMultiplier ?? 0,
        r.bet.payoutCents ?? 0,
        now,
      );
    }
    this.send(ws, {
      t: "cashout_ack",
      betId: msg.betId,
      ok: r.ok,
      multiplier: r.ok ? r.bet.cashoutMultiplier : undefined,
      payoutCents: r.ok ? r.bet.payoutCents : undefined,
      reason: r.ok ? undefined : r.reason,
    });
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
