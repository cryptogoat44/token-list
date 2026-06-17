/**
 * Jeu responsable (responsible gaming) — garde-fous serveur, AUTORITAIRES.
 *
 * Hooks neutres, sans dark pattern : auto-exclusion, limites de mise et de
 * perte par session, et « reality check » (rappel après une durée de jeu). Ce
 * sont des PROTECTIONS, jamais des incitations. La monnaie reste fictive ; en
 * production, l'opérateur peut brancher ses propres limites réglementaires via
 * la même interface.
 *
 * Implémentation en mémoire et par session (injectable horloge pour les tests).
 */

export interface RgLimits {
  /** Mise totale maximale par session (centimes), null = pas de limite. */
  sessionWagerCapCents?: number | null;
  /** Perte nette maximale par session (centimes), null = pas de limite. */
  sessionLossCapCents?: number | null;
  /** Intervalle de « reality check » (ms), null = désactivé. */
  realityCheckMs?: number | null;
}

export type RgDecision = { allowed: true } | { allowed: false; reason: string };

interface Session {
  startedAt: number;
  wageredCents: number;
  returnedCents: number;
  lastRealityCheckAt: number;
  excludedUntil: number | null;
}

const NO_LIMITS: Required<RgLimits> = {
  sessionWagerCapCents: null,
  sessionLossCapCents: null,
  realityCheckMs: null,
};

export class ResponsibleGamingService {
  private readonly limits: Required<RgLimits>;
  private readonly now: () => number;
  private readonly sessions = new Map<string, Session>();

  constructor(opts: { limits?: RgLimits; now?: () => number } = {}) {
    this.limits = { ...NO_LIMITS, ...opts.limits };
    this.now = opts.now ?? Date.now;
  }

  private session(playerId: string): Session {
    let s = this.sessions.get(playerId);
    if (!s) {
      const t = this.now();
      s = { startedAt: t, wageredCents: 0, returnedCents: 0, lastRealityCheckAt: t, excludedUntil: null };
      this.sessions.set(playerId, s);
    }
    return s;
  }

  /** Auto-exclusion temporaire (cool-off) : aucune mise pendant `durationMs`. */
  selfExclude(playerId: string, durationMs: number): void {
    this.session(playerId).excludedUntil = this.now() + durationMs;
  }

  /** Décide si une mise est autorisée (auto-exclusion + plafonds de session). */
  canBet(playerId: string, amountCents: number): RgDecision {
    const s = this.session(playerId);
    if (s.excludedUntil !== null && this.now() < s.excludedUntil) {
      return { allowed: false, reason: "self_excluded" };
    }
    const { sessionWagerCapCents, sessionLossCapCents } = this.limits;
    if (sessionWagerCapCents !== null && s.wageredCents + amountCents > sessionWagerCapCents) {
      return { allowed: false, reason: "session_wager_cap" };
    }
    if (sessionLossCapCents !== null) {
      const projectedLoss = s.wageredCents + amountCents - s.returnedCents;
      if (projectedLoss > sessionLossCapCents) {
        return { allowed: false, reason: "session_loss_cap" };
      }
    }
    return { allowed: true };
  }

  /** Enregistre une mise acceptée (mise totale de session). */
  recordBet(playerId: string, amountCents: number): void {
    this.session(playerId).wageredCents += amountCents;
  }

  /** Enregistre un gain crédité (réduit la perte nette de session). */
  recordReturn(playerId: string, amountCents: number): void {
    this.session(playerId).returnedCents += amountCents;
  }

  /** true si un « reality check » est dû (et réarme le compteur). */
  realityCheckDue(playerId: string): boolean {
    const { realityCheckMs } = this.limits;
    if (realityCheckMs === null) return false;
    const s = this.session(playerId);
    if (this.now() - s.lastRealityCheckAt >= realityCheckMs) {
      s.lastRealityCheckAt = this.now();
      return true;
    }
    return false;
  }

  /** État de session (pour affichage/transparence). */
  snapshot(playerId: string): { wageredCents: number; returnedCents: number; netLossCents: number } {
    const s = this.session(playerId);
    return {
      wageredCents: s.wageredCents,
      returnedCents: s.returnedCents,
      netLossCents: s.wageredCents - s.returnedCents,
    };
  }
}
