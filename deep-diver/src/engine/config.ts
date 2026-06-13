/**
 * Configuration centrale du jeu.
 *
 * Tout est exprimé en unités explicites :
 *  - les montants en CENTIMES de crédit (entiers) pour éviter les erreurs de
 *    virgule flottante sur les soldes ;
 *  - les durées en millisecondes ;
 *  - les multiplicateurs en nombre flottant (1.00 = mise rendue).
 */
export interface GameConfig {
  /** Avantage maison (0.03 = 3 %, soit un RTP de 97 %). */
  houseEdge: number;
  /** Multiplicateur maximal possible (comme Aviator : 1 000 000x). */
  maxMultiplier: number;
  /**
   * Taux de croissance k de la courbe multiplier(t) = e^(k·t) (t en secondes).
   * k = 0.14 → ~2x atteint en ≈ 4,95 s, ~10x en ≈ 16,4 s.
   */
  growthRateK: number;
  /** Durée de la fenêtre de pari (phase BETTING). */
  bettingDurationMs: number;
  /** Durée de l'animation de syncope (phase CRASH). */
  crashDurationMs: number;
  /** Durée de l'écran de résultat avant le tour suivant (phase RESULT). */
  resultDurationMs: number;
  /** Mise minimale, en centimes de crédit. */
  minBetCents: number;
  /** Mise maximale, en centimes de crédit. */
  maxBetCents: number;
  /** Solde de départ (et de reset), en centimes de crédit. */
  startingBalanceCents: number;
  /** Montant ajouté à chaque recharge « démo » de crédits fictifs. */
  topUpCents: number;
  /** Conversion multiplicateur → profondeur : depth = (m − 1) × metersPerMultiplier. */
  metersPerMultiplier: number;
  /** Nombre de tours conservés dans l'historique. */
  maxHistory: number;
  /** Borne minimale autorisée pour l'auto cash out. */
  minAutoCashout: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  houseEdge: 0.03,
  maxMultiplier: 1_000_000, // plafond identique à Aviator
  growthRateK: 0.14,
  bettingDurationMs: 8_000,
  crashDurationMs: 1_600,
  resultDurationMs: 3_500,
  minBetCents: 100, // 1 crédit
  maxBetCents: 50_000, // 500 crédits
  startingBalanceCents: 100_000, // 1 000 crédits
  topUpCents: 100_000, // recharge « démo » : +1 000 crédits fictifs
  metersPerMultiplier: 10,
  maxHistory: 50,
  minAutoCashout: 1.01,
};

/** Fusionne une config partielle avec les valeurs par défaut. */
export function resolveConfig(partial?: Partial<GameConfig>): GameConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}
