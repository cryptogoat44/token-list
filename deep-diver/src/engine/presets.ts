/**
 * Présets de stratégie d'auto cash-out — fonctions pures.
 *
 * Chaque préset affiche HONNÊTEMENT la probabilité réelle d'atteindre sa cible :
 * P(crash ≥ m) = (1 − houseEdge) / m. Aucun préset n'est « meilleur » qu'un
 * autre en espérance (toujours 97 %) : viser plus haut = plus rare mais plus
 * gros, viser bas = fréquent mais petit. On ne suggère jamais qu'on peut
 * prédire un tour.
 */
import { DEFAULT_CONFIG } from "./config";

export interface CashoutPreset {
  id: string;
  name: string;
  multiplier: number;
  /** true pour les présets que le joueur a créés (sauvegardés). */
  custom?: boolean;
}

/** Probabilité d'atteindre (au moins) le multiplicateur `m` : (1 − edge)/m. */
export function reachProbability(
  multiplier: number,
  houseEdge: number = DEFAULT_CONFIG.houseEdge,
): number {
  if (!Number.isFinite(multiplier) || multiplier <= 1) return 1;
  return Math.min(1, (1 - houseEdge) / multiplier);
}

/** Probabilité en pourcentage arrondi à 0,1 % (pour l'affichage). */
export function reachProbabilityPct(
  multiplier: number,
  houseEdge: number = DEFAULT_CONFIG.houseEdge,
): number {
  return Math.round(reachProbability(multiplier, houseEdge) * 1000) / 10;
}

export const DEFAULT_PRESETS: CashoutPreset[] = [
  { id: "prudent", name: "Prudent", multiplier: 1.3 },
  { id: "equilibre", name: "Équilibré", multiplier: 2 },
  { id: "abysses", name: "Abysses", multiplier: 10 },
];

/** Ajoute/sauvegarde un préset personnalisé (déduplique par multiplicateur). */
export function addCustomPreset(
  presets: CashoutPreset[],
  name: string,
  multiplier: number,
): CashoutPreset[] {
  const m = Math.floor(multiplier * 100) / 100;
  if (!Number.isFinite(m) || m < 1.01) return presets;
  const filtered = presets.filter((p) => !(p.custom && p.multiplier === m));
  return [
    ...filtered,
    { id: `custom-${m}`, name: name.trim().slice(0, 24) || `${m}x`, multiplier: m, custom: true },
  ];
}
