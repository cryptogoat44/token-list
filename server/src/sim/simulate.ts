/**
 * Banc de simulation à grande échelle.
 *
 * Tire N tours via la MÊME dérivation provably-fair que la production
 * (`deriveCrashPoint`) et agrège des statistiques de conformité : taux de crash
 * instantané (≈ avantage maison), P(crash ≥ m) vs théorie, RTP implicite à
 * chaque cible, quantiles et distribution. Déterministe si `seed` est fourni
 * (reproductible pour l'audit) ; sinon graines CSPRNG.
 */
import { deriveCrashPoint, generateServerSeed } from "../rng/provablyFair";

export interface SimMath {
  houseEdge: number;
  maxMultiplier: number;
}

export interface SimOptions {
  rounds: number;
  math?: Partial<SimMath>;
  /** Graine déterministe ; si absent → CSPRNG (non reproductible). */
  seed?: string;
  /** Cibles de cash-out pour le tableau P(crash ≥ m) / RTP. */
  targets?: number[];
}

export interface TargetStat {
  target: number;
  empiricalProb: number;
  theoreticalProb: number;
  /** RTP implicite si l'on encaisse à cette cible = target × P(crash ≥ target). */
  impliedRtp: number;
}

export interface Bucket {
  label: string;
  from: number;
  to: number;
  count: number;
  share: number;
}

export interface SimReport {
  rounds: number;
  math: SimMath;
  seed: string | null;
  /** Fraction de tours à 1.00x (matérialise l'avantage maison). */
  instantCrashRate: number;
  /**
   * Taux de crash instantané THÉORIQUE = 1 − (1−edge)/1.01. Un tour vaut 1.00x
   * dès que le brut `2³²/(int+1)·(1−edge)` est < 1.01 (troncature à 2 décimales).
   * ≈ 3,96 % pour edge = 3 % — proche de l'avantage maison mais distinct.
   */
  theoreticalInstantRate: number;
  /** Avantage maison configuré. */
  houseEdge: number;
  meanCrash: number;
  quantiles: { p50: number; p90: number; p99: number };
  maxCrash: number;
  targets: TargetStat[];
  buckets: Bucket[];
}

const DEFAULT_MATH: SimMath = { houseEdge: 0.03, maxMultiplier: 1_000_000 };
const DEFAULT_TARGETS = [1.5, 2, 3, 5, 10, 50, 100, 1000];
const BUCKET_EDGES = [1, 1.5, 2, 5, 10, 50, 100, 1000, Number.POSITIVE_INFINITY];

function quantile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

export function simulate(opts: SimOptions): SimReport {
  const math: SimMath = { ...DEFAULT_MATH, ...opts.math };
  const targets = opts.targets ?? DEFAULT_TARGETS;
  const rounds = Math.max(1, Math.floor(opts.rounds));
  const seed = opts.seed ?? null;
  const clientSeed = "sim";

  const values = new Float64Array(rounds);
  const targetHits = new Array(targets.length).fill(0);
  const bucketCounts = new Array(BUCKET_EDGES.length - 1).fill(0);
  let instant = 0;
  let sum = 0;
  let max = 0;

  for (let i = 0; i < rounds; i++) {
    const serverSeed = seed ? `${seed}:${i}` : generateServerSeed();
    const { crashPoint } = deriveCrashPoint(serverSeed, clientSeed, i, math.houseEdge, math.maxMultiplier);
    values[i] = crashPoint;
    sum += crashPoint;
    if (crashPoint > max) max = crashPoint;
    if (crashPoint < 1.005) instant++;
    for (let t = 0; t < targets.length; t++) {
      if (crashPoint >= targets[t]) targetHits[t]++;
    }
    for (let b = 0; b < bucketCounts.length; b++) {
      if (crashPoint >= BUCKET_EDGES[b] && crashPoint < BUCKET_EDGES[b + 1]) {
        bucketCounts[b]++;
        break;
      }
    }
  }

  values.sort();

  const targetStats: TargetStat[] = targets.map((target, t) => {
    const empiricalProb = targetHits[t] / rounds;
    const theoreticalProb = Math.min(1, (1 - math.houseEdge) / target);
    return { target, empiricalProb, theoreticalProb, impliedRtp: target * empiricalProb };
  });

  const buckets: Bucket[] = bucketCounts.map((count, b) => ({
    label: `${BUCKET_EDGES[b]}–${BUCKET_EDGES[b + 1] === Infinity ? "∞" : BUCKET_EDGES[b + 1]}x`,
    from: BUCKET_EDGES[b],
    to: BUCKET_EDGES[b + 1],
    count,
    share: count / rounds,
  }));

  return {
    rounds,
    math,
    seed,
    instantCrashRate: instant / rounds,
    theoreticalInstantRate: 1 - (1 - math.houseEdge) / 1.01,
    houseEdge: math.houseEdge,
    meanCrash: sum / rounds,
    quantiles: { p50: quantile(values, 0.5), p90: quantile(values, 0.9), p99: quantile(values, 0.99) },
    maxCrash: max,
    targets: targetStats,
    buckets,
  };
}
