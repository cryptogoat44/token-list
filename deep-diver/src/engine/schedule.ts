/**
 * Planificateur déterministe d'une timeline de tours — fonctions pures.
 *
 * À partir d'une suite de points de crash (calculés de façon déterministe à
 * partir d'une graine publique, voir sharedWorld.ts) et des durées de phase,
 * on peut savoir EXACTEMENT quel tour est en cours et dans quelle phase à un
 * instant donné. Comme tout est déterministe, deux navigateurs qui partagent
 * la même graine et la même horloge sont parfaitement synchronisés : c'est ce
 * qui donne « un seul lobby » sans serveur.
 */
import { timeToReachMultiplier } from "./curve";
import type { Phase } from "./types";

export interface ScheduleDurations {
  bettingMs: number;
  crashMs: number;
  resultMs: number;
  growthRateK: number;
}

/** Durée de la phase de plongée pour un point de crash donné. */
export function diveDurationMs(crashPoint: number, d: ScheduleDurations): number {
  return timeToReachMultiplier(crashPoint, d.growthRateK) * 1000;
}

/** Durée totale d'un tour (betting + plongée + crash + résultat). */
export function roundDurationMs(crashPoint: number, d: ScheduleDurations): number {
  return d.bettingMs + diveDurationMs(crashPoint, d) + d.crashMs + d.resultMs;
}

export interface LocatedRound {
  /** Index du tour dans la période. */
  roundIndex: number;
  crashPoint: number;
  phase: Phase;
  /** Bornes en ms, dans la même base de temps que `elapsedMs`. */
  roundStartMs: number;
  bettingEndsMs: number; // = début de plongée
  crashAtMs: number; // instant exact de la syncope
  crashEndsMs: number; // fin de l'animation de crash
  roundEndsMs: number; // fin du résultat = début du tour suivant
}

/**
 * Localise le tour actif à `elapsedMs` (depuis le début de la période), à
 * partir des points de crash déjà calculés. Renvoie `null` si la liste ne
 * couvre pas encore `elapsedMs` (il faut calculer plus de points).
 */
export function locateRound(
  elapsedMs: number,
  crashPoints: readonly number[],
  d: ScheduleDurations,
): LocatedRound | null {
  if (elapsedMs < 0) return null;
  let start = 0;
  for (let i = 0; i < crashPoints.length; i++) {
    const cp = crashPoints[i];
    const bettingEnds = start + d.bettingMs;
    const crashAt = bettingEnds + diveDurationMs(cp, d);
    const crashEnds = crashAt + d.crashMs;
    const roundEnds = crashEnds + d.resultMs;
    if (elapsedMs < roundEnds) {
      let phase: Phase;
      if (elapsedMs < bettingEnds) phase = "BETTING";
      else if (elapsedMs < crashAt) phase = "DIVING";
      else if (elapsedMs < crashEnds) phase = "CRASH";
      else phase = "RESULT";
      return {
        roundIndex: i,
        crashPoint: cp,
        phase,
        roundStartMs: start,
        bettingEndsMs: bettingEnds,
        crashAtMs: crashAt,
        crashEndsMs: crashEnds,
        roundEndsMs: roundEnds,
      };
    }
    start = roundEnds;
  }
  return null;
}

/** Somme des durées des `crashPoints.length` premiers tours. */
export function totalDurationMs(
  crashPoints: readonly number[],
  d: ScheduleDurations,
): number {
  let total = 0;
  for (const cp of crashPoints) total += roundDurationMs(cp, d);
  return total;
}
