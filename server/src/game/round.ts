/**
 * Un tour de jeu AUTORITAIRE.
 *
 * Le point de crash est figé à la création du tour (jamais ajusté ensuite). La
 * graine serveur est gardée SECRÈTE et n'est exposée qu'après le crash. Les
 * mises ne sont acceptées qu'en BETTING ; les encaissements qu'en RUNNING et
 * AVANT l'instant de crash — et l'instant qui fait foi est l'horodatage
 * SERVEUR passé en paramètre (jamais l'horloge du client).
 */
import { multiplierAt, timeToReachMultiplier, truncateMultiplier } from "../math/curve";
import type {
  ActionResult,
  Bet,
  Phase,
  RoundDurations,
  RoundMathConfig,
  RoundSeeds,
  RoundSettlement,
  RoundSnapshot,
  SettlementInstruction,
} from "./types";

export interface RoundInit {
  id: number;
  serverSeed: string; // SECRET
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  crashPoint: number;
  startedAt: number; // début de BETTING (ms serveur)
  durations: RoundDurations;
  math: RoundMathConfig;
}

export class Round {
  readonly id: number;
  readonly crashPoint: number;
  readonly startedAt: number;
  readonly bettingEndsAt: number; // = début de RUNNING
  readonly crashAt: number; // instant exact du crash
  readonly crashEndsAt: number;
  readonly endsAt: number; // fin de SETTLEMENT

  private readonly serverSeed: string; // jamais exposé avant la fin
  private readonly serverSeedHash: string;
  private readonly clientSeed: string;
  private readonly nonce: number;
  private readonly k: number;
  private readonly bets = new Map<string, Bet>();
  private settled = false;

  constructor(init: RoundInit) {
    this.id = init.id;
    this.crashPoint = init.crashPoint;
    this.startedAt = init.startedAt;
    this.serverSeed = init.serverSeed;
    this.serverSeedHash = init.serverSeedHash;
    this.clientSeed = init.clientSeed;
    this.nonce = init.nonce;
    this.k = init.math.growthRateK;
    this.bettingEndsAt = init.startedAt + init.durations.bettingMs;
    this.crashAt =
      this.bettingEndsAt + timeToReachMultiplier(init.crashPoint, this.k) * 1000;
    this.crashEndsAt = this.crashAt + init.durations.crashMs;
    this.endsAt = this.crashEndsAt + init.durations.settlementMs;
  }

  phaseAt(now: number): Phase {
    if (now < this.bettingEndsAt) return "BETTING";
    if (now < this.crashAt) return "RUNNING";
    if (now < this.crashEndsAt) return "CRASH";
    return "SETTLEMENT";
  }

  /** true quand le tour est entièrement terminé (l'engine peut passer au suivant). */
  isOver(now: number): boolean {
    return now >= this.endsAt;
  }

  /** Le crash a-t-il eu lieu (à `now`) ? → autorise la révélation de la graine. */
  hasCrashed(now: number): boolean {
    return now >= this.crashAt;
  }

  /** true une fois le tour réglé (évite un double règlement). */
  get isSettled(): boolean {
    return this.settled;
  }

  /** Révèle les graines + le point de crash (usage SERVEUR : audit/diffusion post-crash). */
  reveal(): {
    serverSeed: string;
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    crashPoint: number;
  } {
    return {
      serverSeed: this.serverSeed,
      serverSeedHash: this.serverSeedHash,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
      crashPoint: this.crashPoint,
    };
  }

  /** Multiplicateur courant, tronqué ; 1.00 hors RUNNING, figé au crashPoint après. */
  multiplierAt(now: number): number {
    if (now <= this.bettingEndsAt) return 1.0;
    if (now >= this.crashAt) return this.crashPoint;
    return truncateMultiplier(multiplierAt((now - this.bettingEndsAt) / 1000, this.k));
  }

  /** Place une mise. Acceptée uniquement en BETTING. */
  placeBet(
    args: { betId: string; playerId: string; amountCents: number },
    now: number,
  ): ActionResult {
    if (this.phaseAt(now) !== "BETTING") return { ok: false, reason: "bettingClosed" };
    if (this.bets.has(args.betId)) return { ok: false, reason: "duplicateBet" };
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
      return { ok: false, reason: "invalidAmount" };
    }
    const bet: Bet = {
      betId: args.betId,
      playerId: args.playerId,
      amountCents: args.amountCents,
      placedAt: now,
      status: "active",
    };
    this.bets.set(bet.betId, bet);
    return { ok: true, bet };
  }

  /**
   * Encaisse une mise. Acceptée uniquement en RUNNING et AVANT l'instant de
   * crash (horodatage serveur `now`). Paye mise × multiplicateur courant.
   */
  cashOut(betId: string, now: number): ActionResult {
    const bet = this.bets.get(betId);
    if (!bet) return { ok: false, reason: "noBet" };
    if (bet.status !== "active") return { ok: false, reason: "alreadySettled" };
    if (now < this.bettingEndsAt) return { ok: false, reason: "notRunning" };
    if (now >= this.crashAt) return { ok: false, reason: "tooLate" }; // syncope déjà survenue
    const mult = this.multiplierAt(now);
    bet.status = "cashed";
    bet.cashoutMultiplier = mult;
    bet.cashedAt = now;
    bet.payoutCents = Math.round(bet.amountCents * mult);
    return { ok: true, bet };
  }

  /**
   * Règle le tour (une seule fois) : les mises encore actives sont perdues.
   * Renvoie les instructions à router vers le wallet opérateur (étape 4).
   */
  settle(): RoundSettlement {
    const instructions: SettlementInstruction[] = [];
    let totalStaked = 0;
    let totalPaid = 0;
    for (const bet of this.bets.values()) {
      totalStaked += bet.amountCents;
      if (!this.settled && bet.status === "active") bet.status = "lost";
      if (bet.status === "cashed") {
        const payout = bet.payoutCents ?? 0;
        totalPaid += payout;
        instructions.push({ type: "credit", playerId: bet.playerId, betId: bet.betId, amountCents: payout });
      } else {
        instructions.push({ type: "lost", playerId: bet.playerId, betId: bet.betId, amountCents: bet.amountCents });
      }
    }
    this.settled = true;
    return {
      roundId: this.id,
      crashPoint: this.crashPoint,
      instructions,
      totalStakedCents: totalStaked,
      totalPaidCents: totalPaid,
    };
  }

  private seeds(now: number): RoundSeeds {
    return {
      serverSeedHash: this.serverSeedHash,
      // Révélée seulement une fois le crash survenu.
      serverSeedRevealed: this.hasCrashed(now) ? this.serverSeed : null,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
    };
  }

  /** Instantané public, diffusable au client. Ne révèle jamais le secret en avance. */
  snapshot(now: number): RoundSnapshot {
    const crashed = this.hasCrashed(now);
    return {
      roundId: this.id,
      phase: this.phaseAt(now),
      now,
      bettingEndsAt: this.bettingEndsAt,
      crashAt: this.crashAt,
      multiplier: this.multiplierAt(now),
      seeds: this.seeds(now),
      crashPoint: crashed ? this.crashPoint : null,
      bets: [...this.bets.values()].map((b) => ({ ...b })),
    };
  }
}
