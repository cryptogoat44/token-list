/**
 * Économie du jeu — fonctions pures sur des montants en CENTIMES (entiers).
 * Aucune de ces fonctions ne peut produire un solde négatif.
 */
import type { GameConfig } from "./config";

export type BetValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalidAmount" //  montant non entier / non positif
        | "belowMin" //       sous la mise minimale
        | "aboveMax" //       au-dessus de la mise maximale
        | "insufficient"; //  solde insuffisant
    };

/** Valide une mise par rapport au solde et aux bornes configurées. */
export function validateBet(
  balanceCents: number,
  betCents: number,
  config: Pick<GameConfig, "minBetCents" | "maxBetCents">,
): BetValidation {
  if (!Number.isInteger(betCents) || betCents <= 0) {
    return { ok: false, reason: "invalidAmount" };
  }
  if (betCents < config.minBetCents) return { ok: false, reason: "belowMin" };
  if (betCents > config.maxBetCents) return { ok: false, reason: "aboveMax" };
  if (betCents > balanceCents) return { ok: false, reason: "insufficient" };
  return { ok: true };
}

/** Débite une mise déjà validée. Lève si elle rendrait le solde négatif. */
export function debitBet(balanceCents: number, betCents: number): number {
  const next = balanceCents - betCents;
  if (next < 0) throw new Error("Solde insuffisant (invariant violé)");
  return next;
}

/**
 * Gain d'un cash out : mise × multiplicateur, arrondi au centime.
 * Le multiplicateur payé est toujours tronqué à 2 décimales en amont, donc
 * betCents · m est exact au centime près (Math.round absorbe le bruit IEEE).
 */
export function payoutCents(betCents: number, multiplier: number): number {
  if (!Number.isInteger(betCents) || betCents < 0) {
    throw new Error("Mise invalide");
  }
  if (multiplier < 1) throw new Error("Multiplicateur < 1.00");
  return Math.round(betCents * multiplier);
}

/** Crédite un gain sur le solde. */
export function creditWin(balanceCents: number, winCents: number): number {
  if (!Number.isInteger(winCents) || winCents < 0) {
    throw new Error("Gain invalide");
  }
  return balanceCents + winCents;
}

/** Borne une mise libre dans [min, min(max, solde)] — pour les boutons ½/×2/Max. */
export function clampBet(
  desiredCents: number,
  balanceCents: number,
  config: Pick<GameConfig, "minBetCents" | "maxBetCents">,
): number {
  const ceiling = Math.min(config.maxBetCents, balanceCents);
  const floor = Math.min(config.minBetCents, ceiling);
  return Math.max(floor, Math.min(ceiling, Math.round(desiredCents)));
}
