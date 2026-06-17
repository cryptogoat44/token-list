/**
 * Table des juridictions. La **France est bloquée par défaut** (exigence
 * produit : pas d'accès depuis la France tant qu'une licence/opérateur dédié
 * n'est pas en place). D'autres juridictions explicitement interdites peuvent
 * être ajoutées ici ; les pays absents de la table sont régis par la stance de
 * l'opérateur (`defaultAllow`) et sa liste `jurisdictions`.
 */
import type { JurisdictionRule } from "./types";

export const DEFAULT_JURISDICTIONS: Record<string, JurisdictionRule> = {
  FR: { code: "FR", allowed: false, note: "France bloquée par défaut (régulation ANJ)." },
  // Exemples de juridictions explicitement interdites (à compléter selon le besoin) :
  US: { code: "US", allowed: false, note: "États-Unis bloqués par défaut (régulation par État)." },
};

/** Règle d'une juridiction (insensible à la casse), ou undefined si non listée. */
export function jurisdictionRule(
  code: string | null,
  table: Record<string, JurisdictionRule> = DEFAULT_JURISDICTIONS,
): JurisdictionRule | undefined {
  if (!code) return undefined;
  return table[code.toUpperCase()];
}
