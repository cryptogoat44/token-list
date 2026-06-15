/**
 * Cosmétiques de plongeur — PUREMENT esthétiques.
 *
 * Aucune progression cosmétique ne modifie les probabilités, l'économie ou
 * l'avantage maison. Rien n'est payant, rien ne se débloque par la fréquence
 * de mise : on débloque par des accomplissements (succès) ou par défaut.
 */

export type CosmeticSlot = "suit" | "trail";

export interface Cosmetic {
  id: string;
  slot: CosmeticSlot;
  name: string;
  /** Couleur principale (combinaison ou traînée de bulles). */
  color: string;
  /** Débloqué d'emblée, ou par un succès (id de succès). */
  unlockedBy: "default" | string;
}

export const COSMETICS: Cosmetic[] = [
  // Combinaisons.
  { id: "suit-classic", slot: "suit", name: "Combinaison classique", color: "#16243d", unlockedBy: "default" },
  { id: "suit-coral", slot: "suit", name: "Combinaison corail", color: "#3a2233", unlockedBy: "profond-100" },
  { id: "suit-kelp", slot: "suit", name: "Combinaison algue", color: "#16341f", unlockedBy: "serie-10" },
  { id: "suit-abyss", slot: "suit", name: "Combinaison abysse", color: "#241640", unlockedBy: "zone-hadale" },
  { id: "suit-gold", slot: "suit", name: "Combinaison dorée", color: "#3a2f12", unlockedBy: "legende" },
  // Traînées de bulles.
  { id: "trail-cyan", slot: "trail", name: "Bulles cyan", color: "#67e8f9", unlockedBy: "default" },
  { id: "trail-emerald", slot: "trail", name: "Bulles émeraude", color: "#6ee7b7", unlockedBy: "premiere-remontee" },
  { id: "trail-violet", slot: "trail", name: "Bulles violettes", color: "#c4b5fd", unlockedBy: "profond-100" },
  { id: "trail-gold", slot: "trail", name: "Bulles dorées", color: "#fcd34d", unlockedBy: "legende" },
];

export const DEFAULT_COSMETICS: Record<CosmeticSlot, string> = {
  suit: "suit-classic",
  trail: "trail-cyan",
};

export function cosmeticById(id: string): Cosmetic | undefined {
  return COSMETICS.find((c) => c.id === id);
}

/** Liste des cosmétiques débloqués d'emblée. */
export function defaultUnlockedCosmetics(): string[] {
  return COSMETICS.filter((c) => c.unlockedBy === "default").map((c) => c.id);
}

/** Cosmétiques débloqués par un ensemble de succès obtenus. */
export function cosmeticsForAchievements(achievementIds: string[]): string[] {
  const set = new Set(achievementIds);
  return COSMETICS.filter((c) => c.unlockedBy !== "default" && set.has(c.unlockedBy)).map((c) => c.id);
}
