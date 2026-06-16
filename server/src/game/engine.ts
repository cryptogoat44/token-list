/**
 * Moteur de jeu SERVEUR — autoritaire, piloté par l'horloge serveur.
 *
 * Fait tourner les tours en boucle (BETTING → RUNNING → CRASH → SETTLEMENT),
 * génère chaque point de crash via le RNG provably-fair (graine secrète), figé
 * au début du tour, et émet des événements (révélation au crash, règlement)
 * que la couche temps réel diffusera et que l'audit journalisera.
 *
 * Le moteur ne lit jamais l'horloge lui-même : il est avancé par `tick(now)`
 * (boucle serveur en prod, horloge simulée dans les tests) — déterministe.
 */
import { DEFAULT_MATH_CONFIG } from "../math/config";
import { realRng, type RngProvider } from "./rngProvider";
import { Round } from "./round";
import type {
  ActionResult,
  Phase,
  RoundDurations,
  RoundMathConfig,
  RoundSettlement,
  RoundSnapshot,
} from "./types";

export const DEFAULT_DURATIONS: RoundDurations = {
  bettingMs: 8_000,
  crashMs: 1_600,
  settlementMs: 3_500,
};

export interface EngineConfig {
  durations?: Partial<RoundDurations>;
  math?: Partial<RoundMathConfig>;
  /** Base du clientSeed (en prod : agrégat des seeds des premiers parieurs). */
  clientSeedBase?: string;
}

export type GameEvent =
  | { type: "roundCreated"; roundId: number; serverSeedHash: string; startedAt: number; bettingEndsAt: number }
  | { type: "running"; roundId: number }
  | { type: "crashed"; roundId: number; crashPoint: number; serverSeed: string; clientSeed: string; nonce: number; serverSeedHash: string }
  | { type: "settled"; settlement: RoundSettlement };

export type GameListener = (event: GameEvent) => void;

export class GameEngine {
  readonly durations: RoundDurations;
  readonly math: RoundMathConfig;
  private readonly rng: RngProvider;
  private readonly clientSeedBase: string;

  private current: Round | null = null;
  private nextRoundId = 1;
  private nextNonce = 0;
  private lastPhase: Phase | null = null;
  private now = 0;
  private listeners = new Set<GameListener>();
  private pending: GameEvent[] = [];

  constructor(opts: { rng?: RngProvider; config?: EngineConfig } = {}) {
    this.rng = opts.rng ?? realRng;
    this.durations = { ...DEFAULT_DURATIONS, ...opts.config?.durations };
    this.math = {
      houseEdge: DEFAULT_MATH_CONFIG.houseEdge,
      maxMultiplier: DEFAULT_MATH_CONFIG.maxMultiplier,
      growthRateK: DEFAULT_MATH_CONFIG.growthRateK,
      ...opts.config?.math,
    };
    this.clientSeedBase = opts.config?.clientSeedBase ?? "deep-diver";
  }

  subscribe(listener: GameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Avance le moteur à l'instant serveur `now`. Gère plusieurs tours d'un coup. */
  tick(now: number): void {
    this.now = Math.max(now, this.now);
    const t = this.now;

    if (!this.current) {
      this.current = this.createRound(t);
      this.lastPhase = null;
    }

    let safety = 1000;
    while (t >= this.current.endsAt && safety-- > 0) {
      this.finalizeRound(this.current);
      this.current = this.createRound(this.current.endsAt);
      this.lastPhase = null;
    }

    const phase = this.current.phaseAt(t);
    if (phase !== this.lastPhase) {
      this.handleTransition(this.current, phase);
      this.lastPhase = phase;
    }
    this.flush();
  }

  private createRound(startedAt: number): Round {
    const serverSeed = this.rng.newServerSeed();
    const serverSeedHash = this.rng.commit(serverSeed);
    const clientSeed = `${this.clientSeedBase}:${this.nextRoundId}`;
    const nonce = this.nextNonce++;
    const crashPoint = this.rng.crashPoint(
      serverSeed,
      clientSeed,
      nonce,
      this.math.houseEdge,
      this.math.maxMultiplier,
    );
    const round = new Round({
      id: this.nextRoundId++,
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      crashPoint,
      startedAt,
      durations: this.durations,
      math: this.math,
    });
    this.emit({
      type: "roundCreated",
      roundId: round.id,
      serverSeedHash,
      startedAt,
      bettingEndsAt: round.bettingEndsAt,
    });
    return round;
  }

  private handleTransition(round: Round, phase: Phase): void {
    if (phase === "RUNNING") {
      this.emit({ type: "running", roundId: round.id });
    } else if (phase === "CRASH" || phase === "SETTLEMENT") {
      this.settleOnce(round);
    }
  }

  /** Clôture défensive d'un tour (gros saut d'horloge ayant sauté le crash). */
  private finalizeRound(round: Round): void {
    this.settleOnce(round);
  }

  private settleOnce(round: Round): void {
    if (round.isSettled) return;
    const reveal = round.reveal();
    this.emit({
      type: "crashed",
      roundId: round.id,
      crashPoint: reveal.crashPoint,
      serverSeed: reveal.serverSeed,
      serverSeedHash: reveal.serverSeedHash,
      clientSeed: reveal.clientSeed,
      nonce: reveal.nonce,
    });
    this.emit({ type: "settled", settlement: round.settle() });
  }

  // ── Intentions joueur (l'instant SERVEUR `now` fait foi) ──────────────────

  placeBet(
    args: { betId: string; playerId: string; amountCents: number },
    now: number,
  ): ActionResult {
    this.tick(now);
    if (!this.current) return { ok: false, reason: "noRound" };
    const r = this.current.placeBet(args, this.now);
    this.flush();
    return r;
  }

  cashOut(betId: string, now: number): ActionResult {
    this.tick(now);
    if (!this.current) return { ok: false, reason: "noRound" };
    const r = this.current.cashOut(betId, this.now);
    this.flush();
    return r;
  }

  /** Instantané public du tour courant (pour diffusion). */
  snapshot(now: number): RoundSnapshot {
    this.tick(now);
    return this.current!.snapshot(this.now);
  }

  private emit(event: GameEvent): void {
    this.pending.push(event);
  }
  private flush(): void {
    if (this.pending.length === 0) return;
    const events = this.pending;
    this.pending = [];
    for (const e of events) this.listeners.forEach((l) => l(e));
  }
}
