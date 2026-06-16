/**
 * Configuration du modèle mathématique — IMPOSÉE PAR LE SERVEUR.
 *
 * Le client ne peut jamais fixer ces valeurs : le serveur est la seule source
 * de vérité. Le RTP est configurable (certaines juridictions imposent des
 * plages), mais toujours décidé côté serveur.
 *
 * Montants en CENTIMES entiers, durées en millisecondes, multiplicateurs en
 * flottant (1.00 = mise rendue).
 */
export interface GameMathConfig {
  /** Avantage maison (0.03 = 3 %, RTP 97 %). */
  houseEdge: number;
  /** Plafond du multiplicateur (comme Aviator : 1 000 000x). */
  maxMultiplier: number;
  /** Taux de croissance k de multiplier(t) = e^(k·t) (t en secondes). */
  growthRateK: number;
}

export const DEFAULT_MATH_CONFIG: GameMathConfig = {
  houseEdge: 0.03,
  maxMultiplier: 1_000_000,
  growthRateK: 0.14,
};

/** RTP théorique (= 1 − houseEdge) pour le RTP « ride-to-crash » par cible. */
export function theoreticalRtp(houseEdge: number): number {
  return 1 - houseEdge;
}

/** Valide une config (plages de RTP autorisées par juridiction, p.ex.). */
export function assertValidMathConfig(c: GameMathConfig): void {
  if (!(c.houseEdge >= 0 && c.houseEdge < 1)) {
    throw new Error("houseEdge doit être dans [0, 1)");
  }
  if (!(c.maxMultiplier > 1)) {
    throw new Error("maxMultiplier doit être > 1");
  }
  if (!(c.growthRateK > 0)) {
    throw new Error("growthRateK doit être > 0");
  }
}
