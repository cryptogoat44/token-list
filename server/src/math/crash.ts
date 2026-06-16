/**
 * Distribution du point de crash — fonctions PURES, cœur audité.
 *
 * Formule de référence (style Stake/BC.Game/Aviator, sur 32 bits) :
 *
 *     int        = 32 premiers bits d'un hash uniforme
 *     crashPoint = max(1.00, floor((2^32 / (int + 1)) · (1 − houseEdge) · 100) / 100)
 *
 * Propriétés (int uniforme sur [0, 2^32 − 1]) :
 *  - P(crash ≥ m) = (1 − houseEdge) / m   → petits multiplicateurs fréquents,
 *    gros exponentiellement rares ;
 *  - P(crash = 1.00) = 1 − (1 − houseEdge)/1.01 ≈ 3,96 % (edge 3 %) : ce sont les
 *    tours instantanés qui matérialisent l'avantage maison ;
 *  - RTP par cible m (sortie auto à m) = m · P(crash ≥ m) = (1 − houseEdge),
 *    constant : c'est l'unique distribution à RTP identique à toute cible.
 *
 * Identique à la formule de la démo client : le vérificateur reste compatible,
 * mais ici l'aléa vient d'une graine SECRÈTE générée côté serveur (cf. rng/).
 */
const TWO_POW_32 = 2 ** 32;

/** Entier 32 bits non signé depuis les 8 premiers caractères hex d'un hash. */
export function uint32FromHashHex(hashHex: string): number {
  if (!/^[0-9a-f]{8,}$/i.test(hashHex)) {
    throw new Error("Hash hexadécimal invalide");
  }
  return Number.parseInt(hashHex.slice(0, 8), 16);
}

/** Point de crash depuis un entier 32 bits uniforme. */
export function crashPointFromUint32(
  int32: number,
  houseEdge: number,
  maxMultiplier: number = Number.POSITIVE_INFINITY,
): number {
  if (!Number.isInteger(int32) || int32 < 0 || int32 >= TWO_POW_32) {
    throw new Error("int32 doit être un entier dans [0, 2^32 − 1]");
  }
  if (houseEdge < 0 || houseEdge >= 1) {
    throw new Error("houseEdge doit être dans [0, 1)");
  }
  const raw = (TWO_POW_32 / (int32 + 1)) * (1 - houseEdge);
  const crash = Math.max(1.0, Math.floor(raw * 100 + 1e-9) / 100);
  return Math.min(crash, maxMultiplier);
}

/** Probabilité théorique P(crash ≥ m) = (1 − houseEdge) / m. */
export function probReachAtLeast(multiplier: number, houseEdge: number): number {
  if (multiplier <= 1) return 1;
  return Math.min(1, (1 - houseEdge) / multiplier);
}
