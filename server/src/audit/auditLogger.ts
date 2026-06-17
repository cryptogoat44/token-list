/**
 * Façade typée d'écriture du journal d'audit.
 *
 * Traduit les événements du domaine (ouverture de tour, mise, encaissement,
 * révélation de crash, règlement, mouvement wallet) en enregistrements scellés.
 * Le payload `crash_revealed` embarque l'avantage maison et le plafond afin que
 * la rejouabilité provably-fair soit AUTONOME (voir `auditReplay.ts`).
 */
import type { GameEvent } from "../game/engine";
import type { RoundSettlement } from "../game/types";
import type { AuditRecord, AuditStore } from "./types";

export interface CrashMath {
  houseEdge: number;
  maxMultiplier: number;
}

export interface WalletMovementEntry {
  kind: "debit" | "credit" | "rollback";
  txId: string;
  playerId: string;
  amountCents: number;
  ok: boolean;
  balanceCents?: number;
  code?: string;
  roundId?: number;
  betId?: string;
}

export class AuditLogger {
  constructor(
    private readonly store: AuditStore,
    private readonly math: CrashMath,
  ) {}

  roundOpen(roundId: number, serverSeedHash: string, startedAt: number, bettingEndsAt: number) {
    return this.store.append("round_open", { roundId, serverSeedHash, startedAt, bettingEndsAt });
  }

  betAccepted(roundId: number, betId: string, playerId: string, amountCents: number) {
    return this.store.append("bet_accepted", { roundId, betId, playerId, amountCents });
  }

  betRejected(roundId: number, betId: string, playerId: string, amountCents: number, reason: string) {
    return this.store.append("bet_rejected", { roundId, betId, playerId, amountCents, reason });
  }

  cashout(
    roundId: number,
    betId: string,
    playerId: string,
    multiplier: number,
    payoutCents: number,
    atServerTime: number,
  ) {
    return this.store.append("cashout", {
      roundId,
      betId,
      playerId,
      multiplier,
      payoutCents,
      atServerTime,
    });
  }

  crashRevealed(
    roundId: number,
    crashPoint: number,
    serverSeed: string,
    serverSeedHash: string,
    clientSeed: string,
    nonce: number,
  ) {
    return this.store.append("crash_revealed", {
      roundId,
      crashPoint,
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      houseEdge: this.math.houseEdge,
      maxMultiplier: this.math.maxMultiplier,
    });
  }

  settlement(s: RoundSettlement) {
    return this.store.append("settlement", {
      roundId: s.roundId,
      crashPoint: s.crashPoint,
      totalStakedCents: s.totalStakedCents,
      totalPaidCents: s.totalPaidCents,
      instructions: s.instructions.map((i) => ({
        type: i.type,
        playerId: i.playerId,
        betId: i.betId,
        amountCents: i.amountCents,
      })),
    });
  }

  accessDenied(playerId: string, country: string | null, reason: string) {
    return this.store.append("access_denied", { playerId, country: country ?? null, reason });
  }

  rgBlock(playerId: string, reason: string, amountCents: number) {
    return this.store.append("rg_block", { playerId, reason, amountCents });
  }

  walletMovement(m: WalletMovementEntry) {
    return this.store.append("wallet_movement", {
      kind: m.kind,
      txId: m.txId,
      playerId: m.playerId,
      amountCents: m.amountCents,
      ok: m.ok,
      balanceCents: m.balanceCents ?? null,
      code: m.code ?? null,
      roundId: m.roundId ?? null,
      betId: m.betId ?? null,
    });
  }

  /** Journalise un événement moteur. Renvoie null pour les événements sans audit dédié. */
  async fromGameEvent(e: GameEvent): Promise<AuditRecord | null> {
    if (e.type === "roundCreated") {
      return this.roundOpen(e.roundId, e.serverSeedHash, e.startedAt, e.bettingEndsAt);
    }
    if (e.type === "crashed") {
      return this.crashRevealed(e.roundId, e.crashPoint, e.serverSeed, e.serverSeedHash, e.clientSeed, e.nonce);
    }
    if (e.type === "settled") {
      return this.settlement(e.settlement);
    }
    return null; // "running" : pas d'enregistrement dédié
  }
}
