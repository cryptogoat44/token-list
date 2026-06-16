/**
 * Courbe du multiplicateur — fonctions PURES.
 *
 *   multiplier(t) = e^(k·t)        (t en secondes, démarre à 1.00)
 *   t(m)          = ln(m) / k      (inverse exacte ; le serveur l'utilise pour
 *                                   planifier l'instant exact du crash)
 *
 * Le serveur fige le crashPoint au début du tour et en déduit l'instant de
 * crash via timeToReachMultiplier.
 */

/** Multiplicateur continu après t secondes. */
export function multiplierAt(tSeconds: number, k: number): number {
  if (tSeconds <= 0) return 1.0;
  return Math.exp(k * tSeconds);
}

/** Temps (s) pour atteindre le multiplicateur m. 0 si m ≤ 1. */
export function timeToReachMultiplier(m: number, k: number): number {
  if (m <= 1) return 0;
  return Math.log(m) / k;
}

/**
 * Troncature à 2 décimales — multiplicateur AFFICHÉ et PAYÉ (on tronque, jamais
 * d'arrondi au-dessus, pour ne pas payer plus que la courbe).
 */
export function truncateMultiplier(m: number): number {
  return Math.max(1.0, Math.floor(m * 100 + 1e-9) / 100);
}
