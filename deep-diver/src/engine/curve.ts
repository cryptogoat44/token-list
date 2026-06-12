/**
 * Courbe du multiplicateur et conversion en profondeur — fonctions pures.
 *
 *   multiplier(t) = e^(k·t)        (t en secondes, démarre à 1.00)
 *   t(m)          = ln(m) / k      (inverse exacte, sert à planifier le crash)
 *   depth(m)      = (m − 1) · c    (profondeur en mètres, 0 à la surface)
 *
 * Le tour s'arrête net dès que multiplier(t) ≥ crashPoint : le moteur calcule
 * l'instant exact du crash via timeToReachMultiplier au début de la plongée.
 */

/** Multiplicateur continu après t secondes de plongée. */
export function multiplierAt(tSeconds: number, k: number): number {
  if (tSeconds <= 0) return 1.0;
  return Math.exp(k * tSeconds);
}

/** Temps (s) nécessaire pour atteindre le multiplicateur m. 0 si m ≤ 1. */
export function timeToReachMultiplier(m: number, k: number): number {
  if (m <= 1) return 0;
  return Math.log(m) / k;
}

/**
 * Troncature à 2 décimales — c'est le multiplicateur AFFICHÉ et PAYÉ.
 * On tronque (plutôt qu'arrondir) pour ne jamais payer plus que la courbe.
 */
export function truncateMultiplier(m: number): number {
  return Math.max(1.0, Math.floor(m * 100 + 1e-9) / 100);
}

/** Profondeur (mètres, valeur positive) correspondant à un multiplicateur. */
export function depthForMultiplier(m: number, metersPerMultiplier: number): number {
  return Math.max(0, (m - 1) * metersPerMultiplier);
}
