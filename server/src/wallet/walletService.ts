/**
 * Service wallet : traduit les événements de jeu (mise, encaissement,
 * règlement de tour) en appels au `WalletAdapter` opérateur, avec des `txId`
 * DÉTERMINISTES garantissant l'idempotence de bout en bout.
 *
 * Convention de txId (traçable et rejouable sans double effet) :
 *   - mise   : `r{roundId}:b{betId}:stake`
 *   - gain   : `r{roundId}:b{betId}:payout`
 *
 * Le RGS reste la seule source de vérité sur le résultat ; le wallet ne fait
 * que déplacer des fonds détenus par l'opérateur.
 */
import type {
  RoundSettlement,
  SettleReport,
  WalletAdapter,
  WalletContext,
  WalletResult,
} from "./types";

export class WalletService {
  constructor(private readonly adapter: WalletAdapter) {}

  static stakeTxId(roundId: number, betId: string): string {
    return `r${roundId}:b${betId}:stake`;
  }
  static payoutTxId(roundId: number, betId: string): string {
    return `r${roundId}:b${betId}:payout`;
  }

  authenticate(token: string) {
    return this.adapter.authenticate(token);
  }
  balance(playerId: string) {
    return this.adapter.getBalance(playerId);
  }

  /** Débite la mise au moment du pari (idempotent par tour+pari). */
  debitStake(ctx: WalletContext, roundId: number, betId: string, amountCents: number): Promise<WalletResult> {
    return this.adapter.debit({
      txId: WalletService.stakeTxId(roundId, betId),
      playerId: ctx.playerId,
      currency: ctx.currency,
      amountCents,
      roundId,
      betId,
      reason: "stake",
    });
  }

  /** Annule une mise débitée (ex : tour avorté, intention rejetée après débit). */
  rollbackStake(roundId: number, betId: string): Promise<WalletResult> {
    return this.adapter.rollback(WalletService.stakeTxId(roundId, betId));
  }

  /**
   * Règle un tour : crédite les gagnants. IDEMPOTENT — rejouer le même
   * règlement ne crédite pas deux fois (txId déterministes). Les mises perdues
   * n'entraînent aucun appel : le débit a eu lieu au moment du pari.
   */
  async settle(
    settlement: RoundSettlement,
    contexts: Map<string, WalletContext>,
  ): Promise<SettleReport> {
    const report: SettleReport = {
      roundId: settlement.roundId,
      credited: [],
      errors: [],
      totalCreditedCents: 0,
    };
    for (const inst of settlement.instructions) {
      if (inst.type !== "credit" || inst.amountCents <= 0) continue;
      const ctx = contexts.get(inst.playerId);
      if (!ctx) {
        report.errors.push({
          betId: inst.betId,
          playerId: inst.playerId,
          code: "UNKNOWN_PLAYER",
          message: "contexte wallet manquant pour le joueur",
        });
        continue;
      }
      const r = await this.adapter.credit({
        txId: WalletService.payoutTxId(settlement.roundId, inst.betId),
        playerId: ctx.playerId,
        currency: ctx.currency,
        amountCents: inst.amountCents,
        roundId: settlement.roundId,
        betId: inst.betId,
        reason: "payout",
      });
      if (r.ok) {
        report.credited.push({
          betId: inst.betId,
          playerId: inst.playerId,
          amountCents: inst.amountCents,
          duplicate: r.duplicate,
        });
        if (!r.duplicate) report.totalCreditedCents += inst.amountCents;
      } else {
        report.errors.push({
          betId: inst.betId,
          playerId: inst.playerId,
          code: r.code,
          message: r.message,
        });
      }
    }
    return report;
  }
}
