/**
 * Profil de joueur persistant — logique pure et testable.
 *
 * Conserve les RECORDS de toujours (meilleure profondeur, meilleur
 * multiplicateur, plus longue série de remontées), le carnet de plongée, les
 * succès et cosmétiques débloqués, et l'apparence choisie. Mis à jour à la fin
 * de chaque tour. Aucun de ces éléments ne touche aux probabilités ni à
 * l'économie — c'est de la gratification saine, non monétisée.
 */
import { depthForMultiplier } from "./curve";
import { DEFAULT_CONFIG } from "./config";
import {
  evaluateAchievements,
  type AchievementContext,
} from "./achievements";
import {
  cosmeticsForAchievements,
  defaultUnlockedCosmetics,
  DEFAULT_COSMETICS,
  type CosmeticSlot,
} from "./cosmetics";

export interface DiveLogEntry {
  id: string;
  /** Date ISO de la plongée. */
  date: string;
  outcome: "cashed" | "lost";
  /** Meilleur multiplicateur du tour (remontée, ou point de crash si perdu). */
  multiplier: number;
  depthMeters: number;
  /** Net du tour, en centimes (peut être négatif). */
  netCents: number;
}

export interface PlayerProfile {
  version: 1;
  diverName: string;
  // Records de toujours.
  bestCashoutX: number;
  bestDepthMeters: number;
  bestWinCents: number;
  longestCashoutStreak: number;
  currentCashoutStreak: number;
  totalDives: number;
  totalCashouts: number;
  verifiedARound: boolean;
  // Progression cosmétique.
  unlockedAchievements: string[];
  unlockedCosmetics: string[];
  selectedCosmetics: Record<CosmeticSlot, string>;
  // Carnet.
  diveLog: DiveLogEntry[];
}

const MAX_DIVE_LOG = 40;
const METERS_PER_MULT = DEFAULT_CONFIG.metersPerMultiplier;

export function emptyProfile(): PlayerProfile {
  return {
    version: 1,
    diverName: "",
    bestCashoutX: 0,
    bestDepthMeters: 0,
    bestWinCents: 0,
    longestCashoutStreak: 0,
    currentCashoutStreak: 0,
    totalDives: 0,
    totalCashouts: 0,
    verifiedARound: false,
    unlockedAchievements: [],
    unlockedCosmetics: defaultUnlockedCosmetics(),
    selectedCosmetics: { ...DEFAULT_COSMETICS },
    diveLog: [],
  };
}

export interface RoundOutcome {
  /** Le joueur a remonté au moins un panier ET n'a pas perdu d'argent net. */
  cashed: boolean;
  /** Meilleur multiplicateur encaissé du tour (null si aucune remontée). */
  cashoutMultiplier: number | null;
  /** Point de crash du tour (pour le carnet). */
  crashPoint: number;
  /** Gain brut du meilleur panier encaissé, en centimes (0 si perdu). */
  winCents: number;
  /** Net du tour, en centimes. */
  netCents: number;
  date: string;
}

export interface ApplyRoundResult {
  profile: PlayerProfile;
  /** Succès nouvellement débloqués ce tour. */
  newAchievements: string[];
  /** true si un record personnel a été battu ce tour. */
  newRecord: boolean;
}

function contextOf(p: PlayerProfile): AchievementContext {
  return {
    totalDives: p.totalDives,
    totalCashouts: p.totalCashouts,
    bestCashoutX: p.bestCashoutX,
    bestDepthMeters: p.bestDepthMeters,
    longestCashoutStreak: p.longestCashoutStreak,
    verifiedARound: p.verifiedARound,
  };
}

/** Recalcule les succès + cosmétiques débloqués à partir de l'état courant. */
function refreshUnlocks(p: PlayerProfile): string[] {
  const earned = evaluateAchievements(contextOf(p));
  const before = new Set(p.unlockedAchievements);
  const fresh = earned.filter((id) => !before.has(id));
  if (fresh.length > 0) {
    p.unlockedAchievements = [...p.unlockedAchievements, ...fresh];
    const cosmetics = cosmeticsForAchievements(p.unlockedAchievements);
    const cset = new Set([...p.unlockedCosmetics, ...cosmetics]);
    p.unlockedCosmetics = [...cset];
  }
  return fresh;
}

/** Applique le résultat d'un tour joué (pur : renvoie un nouveau profil). */
export function applyRound(
  profile: PlayerProfile,
  outcome: RoundOutcome,
): ApplyRoundResult {
  const p: PlayerProfile = {
    ...profile,
    unlockedAchievements: [...profile.unlockedAchievements],
    unlockedCosmetics: [...profile.unlockedCosmetics],
    diveLog: [...profile.diveLog],
  };
  p.totalDives += 1;

  let newRecord = false;
  let notableRecord = false; // record « marquant » pour le carnet (hors série)
  if (outcome.cashed && outcome.cashoutMultiplier !== null) {
    p.totalCashouts += 1;
    p.currentCashoutStreak += 1;
    if (p.currentCashoutStreak > p.longestCashoutStreak) {
      p.longestCashoutStreak = p.currentCashoutStreak;
      newRecord = true;
    }
    if (outcome.cashoutMultiplier > p.bestCashoutX) {
      p.bestCashoutX = outcome.cashoutMultiplier;
      p.bestDepthMeters = depthForMultiplier(outcome.cashoutMultiplier, METERS_PER_MULT);
      newRecord = true;
      notableRecord = true;
    }
    if (outcome.winCents > p.bestWinCents) {
      p.bestWinCents = outcome.winCents;
      newRecord = true;
      notableRecord = true;
    }
  } else {
    p.currentCashoutStreak = 0;
  }

  // Carnet : plongées marquantes seulement (record de profondeur/gain, ou
  // belle remontée ≥ 3x). Les simples prolongations de série n'inondent pas.
  const notable =
    notableRecord || (outcome.cashed && (outcome.cashoutMultiplier ?? 0) >= 3);
  if (notable) {
    p.diveLog.unshift({
      id: `${Date.parse(outcome.date) || Date.now()}-${p.totalDives}`,
      date: outcome.date,
      outcome: outcome.cashed ? "cashed" : "lost",
      multiplier: outcome.cashed ? (outcome.cashoutMultiplier ?? 1) : outcome.crashPoint,
      depthMeters: depthForMultiplier(
        outcome.cashed ? (outcome.cashoutMultiplier ?? 1) : outcome.crashPoint,
        METERS_PER_MULT,
      ),
      netCents: outcome.netCents,
    });
    if (p.diveLog.length > MAX_DIVE_LOG) p.diveLog.length = MAX_DIVE_LOG;
  }

  const newAchievements = refreshUnlocks(p);
  return { profile: p, newAchievements, newRecord };
}

/** Marque « a vérifié un tour » (débloque le succès correspondant). */
export function markVerified(profile: PlayerProfile): ApplyRoundResult {
  if (profile.verifiedARound) {
    return { profile, newAchievements: [], newRecord: false };
  }
  const p: PlayerProfile = {
    ...profile,
    verifiedARound: true,
    unlockedAchievements: [...profile.unlockedAchievements],
    unlockedCosmetics: [...profile.unlockedCosmetics],
  };
  const newAchievements = refreshUnlocks(p);
  return { profile: p, newAchievements, newRecord: false };
}

/** Sélectionne un cosmétique (s'il est débloqué). Pur. */
export function selectCosmetic(
  profile: PlayerProfile,
  slot: CosmeticSlot,
  cosmeticId: string,
): PlayerProfile {
  if (!profile.unlockedCosmetics.includes(cosmeticId)) return profile;
  return { ...profile, selectedCosmetics: { ...profile.selectedCosmetics, [slot]: cosmeticId } };
}

/** Recharge un profil depuis un objet inconnu (localStorage), en réparant les trous. */
export function reviveProfile(raw: unknown): PlayerProfile {
  const base = emptyProfile();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<PlayerProfile>;
  const merged: PlayerProfile = {
    ...base,
    ...r,
    version: 1,
    selectedCosmetics: { ...base.selectedCosmetics, ...(r.selectedCosmetics ?? {}) },
    unlockedCosmetics: Array.from(
      new Set([...base.unlockedCosmetics, ...(r.unlockedCosmetics ?? [])]),
    ),
    unlockedAchievements: Array.isArray(r.unlockedAchievements) ? r.unlockedAchievements : [],
    diveLog: Array.isArray(r.diveLog) ? r.diveLog.slice(0, MAX_DIVE_LOG) : [],
  };
  return merged;
}
