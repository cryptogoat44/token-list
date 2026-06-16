/**
 * Types de la logique de jeu serveur (autoritaire).
 * Montants en CENTIMES entiers, temps en MILLISECONDES (horloge SERVEUR).
 */

/** Phases du cycle d'un tour, pilotées par le serveur. */
export type Phase = "BETTING" | "RUNNING" | "CRASH" | "SETTLEMENT";

export interface RoundDurations {
  /** Fenêtre de pari. */
  bettingMs: number;
  /** Animation de crash (affichage). */
  crashMs: number;
  /** Règlement (crédit des gagnants, écriture audit). */
  settlementMs: number;
}

export interface RoundMathConfig {
  houseEdge: number;
  maxMultiplier: number;
  growthRateK: number;
}

export type BetStatus = "active" | "cashed" | "lost";

export interface Bet {
  betId: string;
  playerId: string;
  amountCents: number;
  /** Horodatage SERVEUR de la mise (ms). */
  placedAt: number;
  status: BetStatus;
  /** Multiplicateur d'encaissement (si cashed). */
  cashoutMultiplier?: number;
  /** Horodatage SERVEUR de l'encaissement (ms). */
  cashedAt?: number;
  /** Gain brut crédité, en centimes (si cashed). */
  payoutCents?: number;
}

/** Graines d'un tour (la graine serveur reste secrète jusqu'à la révélation). */
export interface RoundSeeds {
  serverSeedHash: string;
  /** null tant que le tour n'est pas terminé (révélation après crash). */
  serverSeedRevealed: string | null;
  clientSeed: string;
  nonce: number;
}

/** Instantané public d'un tour (diffusable au client — JAMAIS la graine secrète avant la fin). */
export interface RoundSnapshot {
  roundId: number;
  phase: Phase;
  now: number;
  bettingEndsAt: number;
  crashAt: number;
  /** Multiplicateur courant, tronqué (1.00 hors RUNNING ; figé au crashPoint après). */
  multiplier: number;
  seeds: RoundSeeds;
  /** Point de crash, révélé seulement après le crash. */
  crashPoint: number | null;
  bets: Bet[];
}

/** Résultat d'une action (mise/encaissement). */
export type ActionResult =
  | { ok: true; bet: Bet }
  | { ok: false; reason: string };

/** Instruction de règlement à router vers le wallet opérateur (étape 4). */
export interface SettlementInstruction {
  type: "credit" | "lost";
  playerId: string;
  betId: string;
  amountCents: number;
}

export interface RoundSettlement {
  roundId: number;
  crashPoint: number;
  instructions: SettlementInstruction[];
  totalStakedCents: number;
  totalPaidCents: number;
}
