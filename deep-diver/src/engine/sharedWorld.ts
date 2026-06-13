/**
 * « Monde partagé » : une timeline de tours identique pour TOUS les joueurs,
 * sans serveur.
 *
 * Idée : le temps est découpé en périodes fixes (1 h). Dans une période, les
 * points de crash sont dérivés de façon déterministe d'une GRAINE PUBLIQUE
 * (codée en dur, donc identique partout) via le même SHA-256 que le reste du
 * jeu. Chaque navigateur calcule alors la même suite de tours et, en lisant
 * simplement l'horloge murale (UTC), se place exactement sur le même tour, à
 * la même phase, au même instant que les autres. C'est ce qui donne « un seul
 * lobby » partagé sans aucun backend.
 *
 * Équité : tout est public et reproductible. N'importe qui peut recalculer le
 * point de crash d'un tour à partir de (graine publique, index de période,
 * index de tour) — c'est la version « déterministe et vérifiable par tous » du
 * provably fair (il n'y a pas de graine serveur secrète puisque tout tourne
 * côté client).
 */
import type { GameConfig } from "./config";
import { commitServerSeed, computeCrashPoint } from "./fairness";
import {
  diveDurationMs,
  locateRound,
  type ScheduleDurations,
} from "./schedule";
import type { Phase, RoundHistoryEntry } from "./types";

/** Graine publique du monde partagé (publique par nature, côté client). */
export const SHARED_MASTER_SEED = "deep-diver-shared-world-v1";
/** Durée d'une période : au changement de période, la timeline repart à 0. */
export const SHARED_PERIOD_MS = 3_600_000; // 1 heure
/** Sécurité : plafond du nombre de tours calculés par période. */
const MAX_ROUNDS_PER_PERIOD = 6000;
/** On garde toujours ce délai d'avance précalculé (ms). */
const LOOKAHEAD_MS = 90_000;

export interface SharedState {
  ready: boolean;
  periodIndex: number;
  roundIndex: number;
  crashPoint: number;
  phase: Phase;
  /** Bornes absolues (ms, horloge murale). */
  bettingEndsAt: number;
  diveStartAt: number;
  crashAt: number;
  roundEndsAt: number;
  /** Infos d'équité du tour courant. */
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  roundId: number;
  /** Historique partagé (tours déjà « syncopés »), du plus récent au plus ancien. */
  history: RoundHistoryEntry[];
}

function clientSeedForPeriod(periodIndex: number): string {
  return `period-${periodIndex}`;
}

function roundIdFor(periodIndex: number, roundIndex: number): number {
  return periodIndex * 100_000 + roundIndex;
}

const EMPTY_STATE = (periodIndex: number): SharedState => ({
  ready: false,
  periodIndex,
  roundIndex: 0,
  crashPoint: 1,
  phase: "BETTING",
  bettingEndsAt: 0,
  diveStartAt: 0,
  crashAt: 0,
  roundEndsAt: 0,
  serverSeed: SHARED_MASTER_SEED,
  serverSeedHash: "",
  clientSeed: clientSeedForPeriod(periodIndex),
  nonce: 0,
  roundId: 0,
  history: [],
});

export class SharedWorld {
  private readonly durations: ScheduleDurations;
  private readonly houseEdge: number;
  private readonly maxMultiplier: number;
  private readonly maxHistory: number;
  private readonly periodMs: number;
  private readonly masterSeed: string;

  private periodIndex = -1;
  private crashPoints: number[] = [];
  private serverSeedHash = "";
  private computing = false;

  constructor(
    config: Pick<
      GameConfig,
      | "houseEdge"
      | "maxMultiplier"
      | "growthRateK"
      | "bettingDurationMs"
      | "crashDurationMs"
      | "resultDurationMs"
      | "maxHistory"
    >,
    options: { masterSeed?: string; periodMs?: number } = {},
  ) {
    this.houseEdge = config.houseEdge;
    this.maxMultiplier = config.maxMultiplier;
    this.maxHistory = config.maxHistory;
    this.masterSeed = options.masterSeed ?? SHARED_MASTER_SEED;
    this.periodMs = options.periodMs ?? SHARED_PERIOD_MS;
    this.durations = {
      bettingMs: config.bettingDurationMs,
      crashMs: config.crashDurationMs,
      resultMs: config.resultDurationMs,
      growthRateK: config.growthRateK,
    };
    void this.init();
  }

  private async init(): Promise<void> {
    this.serverSeedHash = await commitServerSeed(this.masterSeed);
  }

  /**
   * Amorce le précalcul pour couvrir l'instant `now` (+ marge). À appeler au
   * démarrage pour éviter le bref état « synchronisation », et dans les tests.
   */
  async prime(now: number): Promise<void> {
    const periodIndex = Math.floor(now / this.periodMs);
    if (periodIndex !== this.periodIndex) {
      this.periodIndex = periodIndex;
      this.crashPoints = [];
    }
    if (this.serverSeedHash === "") {
      this.serverSeedHash = await commitServerSeed(this.masterSeed);
    }
    await this.ensureAhead(periodIndex, now - periodIndex * this.periodMs);
  }

  /** État partagé à l'instant `now` (ms, horloge murale). Synchrone. */
  stateAt(now: number): SharedState {
    const periodIndex = Math.floor(now / this.periodMs);
    if (periodIndex !== this.periodIndex) {
      this.periodIndex = periodIndex;
      this.crashPoints = [];
    }
    const elapsed = now - periodIndex * this.periodMs;
    const located = locateRound(elapsed, this.crashPoints, this.durations);

    if (!located || this.serverSeedHash === "") {
      void this.ensureAhead(periodIndex, elapsed);
      return EMPTY_STATE(periodIndex);
    }
    void this.ensureAhead(periodIndex, elapsed);

    const base = periodIndex * this.periodMs;
    return {
      ready: true,
      periodIndex,
      roundIndex: located.roundIndex,
      crashPoint: located.crashPoint,
      phase: located.phase,
      bettingEndsAt: base + located.bettingEndsMs,
      diveStartAt: base + located.bettingEndsMs,
      crashAt: base + located.crashAtMs,
      roundEndsAt: base + located.roundEndsMs,
      serverSeed: this.masterSeed,
      serverSeedHash: this.serverSeedHash,
      clientSeed: clientSeedForPeriod(periodIndex),
      nonce: located.roundIndex,
      roundId: roundIdFor(periodIndex, located.roundIndex),
      history: this.buildHistory(periodIndex, elapsed, located.roundIndex),
    };
  }

  /** Historique partagé : tours déjà syncopés (crash ≤ elapsed), récents d'abord. */
  private buildHistory(
    periodIndex: number,
    elapsed: number,
    currentRound: number,
  ): RoundHistoryEntry[] {
    const out: RoundHistoryEntry[] = [];
    let start = 0;
    const base = periodIndex * this.periodMs;
    for (let i = 0; i <= currentRound && i < this.crashPoints.length; i++) {
      const cp = this.crashPoints[i];
      const crashAt = start + this.durations.bettingMs + diveDurationMs(cp, this.durations);
      if (crashAt <= elapsed) {
        out.push({
          roundId: roundIdFor(periodIndex, i),
          nonce: i,
          clientSeed: clientSeedForPeriod(periodIndex),
          serverSeed: this.masterSeed,
          serverSeedHash: this.serverSeedHash,
          crashPoint: cp,
          endedAt: base + crashAt,
        });
      }
      start +=
        this.durations.bettingMs +
        diveDurationMs(cp, this.durations) +
        this.durations.crashMs +
        this.durations.resultMs;
    }
    return out.reverse().slice(0, this.maxHistory);
  }

  /** Étend le précalcul des points de crash pour couvrir `elapsed` + marge. */
  private async ensureAhead(periodIndex: number, elapsed: number): Promise<void> {
    if (this.computing) return;
    this.computing = true;
    try {
      const target = elapsed + LOOKAHEAD_MS;
      // Recalcule le temps déjà couvert.
      let covered = 0;
      for (const cp of this.crashPoints) {
        covered +=
          this.durations.bettingMs +
          diveDurationMs(cp, this.durations) +
          this.durations.crashMs +
          this.durations.resultMs;
      }
      while (
        covered < target &&
        this.crashPoints.length < MAX_ROUNDS_PER_PERIOD &&
        periodIndex === this.periodIndex
      ) {
        const index = this.crashPoints.length;
        const { crashPoint } = await computeCrashPoint(
          this.masterSeed,
          clientSeedForPeriod(periodIndex),
          index,
          this.houseEdge,
          this.maxMultiplier,
        );
        // La période a pu changer pendant l'await : on abandonne dans ce cas.
        if (periodIndex !== this.periodIndex) break;
        this.crashPoints.push(crashPoint);
        covered +=
          this.durations.bettingMs +
          diveDurationMs(crashPoint, this.durations) +
          this.durations.crashMs +
          this.durations.resultMs;
      }
    } finally {
      this.computing = false;
    }
  }
}
