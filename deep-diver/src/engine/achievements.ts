/**
 * Succès / badges — PUREMENT cosmétiques et positifs.
 *
 * Ils récompensent l'exploration, la maîtrise et la curiosité (vérifier
 * l'équité), jamais le temps de jeu ni la fréquence de mise. Aucun succès ne
 * donne d'avantage économique. Logique pure et testable.
 */

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "premiere-plongee", name: "Premier souffle", description: "Effectuer sa première plongée.", icon: "🤿" },
  { id: "premiere-remontee", name: "Sain et sauf", description: "Réussir sa première remontée.", icon: "🌊" },
  { id: "profond-100", name: "−100 mètres", description: "Atteindre 100 m de profondeur (remontée à 11x).", icon: "🪸" },
  { id: "serie-5", name: "Sang-froid", description: "5 remontées réussies d'affilée.", icon: "🧊" },
  { id: "serie-10", name: "Maître apnéiste", description: "10 remontées réussies d'affilée.", icon: "🏅" },
  { id: "zone-hadale", name: "Zone hadale", description: "Atteindre ~490 m (remontée à 50x).", icon: "🌋" },
  { id: "legende", name: "Légende des abysses", description: "Une remontée à 100x ou plus.", icon: "👑" },
  { id: "verificateur", name: "Confiance vérifiée", description: "Vérifier un tour dans le panneau Équité.", icon: "🔍" },
];

export const ACHIEVEMENT_BY_ID: Record<string, Achievement> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

/** Les compteurs/records nécessaires pour évaluer les succès. */
export interface AchievementContext {
  totalDives: number;
  totalCashouts: number;
  bestCashoutX: number;
  bestDepthMeters: number;
  longestCashoutStreak: number;
  verifiedARound: boolean;
}

/** Renvoie les ids de TOUS les succès mérités par le contexte (pur). */
export function evaluateAchievements(ctx: AchievementContext): string[] {
  const out: string[] = [];
  if (ctx.totalDives >= 1) out.push("premiere-plongee");
  if (ctx.totalCashouts >= 1) out.push("premiere-remontee");
  if (ctx.bestDepthMeters >= 100) out.push("profond-100");
  if (ctx.longestCashoutStreak >= 5) out.push("serie-5");
  if (ctx.longestCashoutStreak >= 10) out.push("serie-10");
  if (ctx.bestDepthMeters >= 490) out.push("zone-hadale");
  if (ctx.bestCashoutX >= 100) out.push("legende");
  if (ctx.verifiedARound) out.push("verificateur");
  return out;
}
