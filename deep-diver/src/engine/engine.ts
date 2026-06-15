/**
 * Moteur de jeu Deep Diver — machine à états pure, sans DOM.
 *
 * Cycle d'un tour :  BETTING → DIVING → CRASH → RESULT → BETTING → …
 *
 * Le moteur est piloté de l'extérieur par `tick(now)` (requestAnimationFrame
 * côté UI, horloge simulée dans les tests). Toute l'évolution de l'état est
 * fonction du temps passé en paramètre : le moteur ne lit jamais Date.now(),
 * ce qui le rend entièrement déterministe et testable.
 *
 * Garanties importantes :
 *  - le point de crash est calculé (commit-reveal, voir fairness.ts) pendant
 *    la fenêtre de pari et FIGÉ avant le début de la plongée — jamais ajusté
 *    en fonction des actions du joueur ;
 *  - sémantique en temps continu : si un tick « saute » par-dessus l'instant
 *    du crash, un cash out manuel arrivé trop tard est refusé, mais un auto
 *    cash out dont la cible était atteignable AVANT le crash est honoré au
 *    multiplicateur cible exact ;
 *  - le solde ne peut jamais devenir négatif (validations dans wallet.ts).
 */
import { resolveConfig, type GameConfig } from "./config";
import {
  depthForMultiplier,
  multiplierAt,
  timeToReachMultiplier,
  truncateMultiplier,
} from "./curve";
import {
  randomSeedHex,
  realFairnessProvider,
  type FairnessProvider,
} from "./fairness";
import type { SharedState, SharedWorld } from "./sharedWorld";
import type {
  AutoBetConfig,
  EngineEvent,
  EngineSnapshot,
  Phase,
  RoundHistoryEntry,
  SessionStats,
  SlotState,
} from "./types";
import {
  creditWin,
  debitBet,
  payoutCents,
  validateBet,
  type BetValidation,
} from "./wallet";

export type ActionResult =
  | { ok: true }
  | { ok: false; reason: string };

export type EngineListener = (
  snapshot: EngineSnapshot,
  events: EngineEvent[],
) => void;

export interface EngineOptions {
  config?: Partial<GameConfig>;
  /** Seed client initial (sinon généré aléatoirement). */
  clientSeed?: string;
  /** Solde initial en centimes (sinon config.startingBalanceCents). */
  initialBalanceCents?: number;
  /** Fournisseur d'aléa — remplaçable dans les tests. */
  fairness?: FairnessProvider;
  /**
   * Monde partagé : si fourni, le moteur passe en mode « lobby unique ». La
   * timeline des tours (phases, points de crash) n'est plus pilotée par des
   * minuteurs internes mais lue depuis cette horloge déterministe commune à
   * tous les joueurs. Les paris et le solde restent locaux à chaque joueur.
   */
  sharedWorld?: SharedWorld;
}

interface RoundInternal {
  roundId: number;
  nonce: number;
  clientSeed: string;
  serverSeed: string;
  serverSeedHash: string | null;
  /** Figé avant la plongée ; jamais exposé avant la fin du tour. */
  crashPoint: number | null;
  /** true quand hash + crashPoint sont calculés (préparation async finie). */
  ready: boolean;
}

function freshStats(): SessionStats {
  return {
    roundsPlayed: 0,
    betsPlaced: 0,
    totalWageredCents: 0,
    totalReturnedCents: 0,
    netCents: 0,
    bestCashoutX: 0,
    bestWinCents: 0,
    longestWinStreak: 0,
    longestLossStreak: 0,
    currentStreak: 0,
  };
}

function freshSlot(id: 0 | 1): SlotState {
  return {
    id,
    status: "idle",
    betCents: null,
    autoCashout: null,
    cashedOutAt: null,
    winCents: null,
    autoBet: null,
  };
}

export class GameEngine {
  readonly config: GameConfig;

  private readonly fairness: FairnessProvider;
  private phase: Phase = "BETTING";
  private phaseEndsAt = 0;
  private started = false;
  private now = 0;

  private balanceCents: number;
  private slots: [SlotState, SlotState] = [freshSlot(0), freshSlot(1)];

  private round: RoundInternal;
  /** true tant que le tour construit n'a pas encore servi (1er tour). */
  private roundFresh = true;
  private nextRoundId = 1;
  private nextNonce = 0;
  private clientSeed: string;
  private pendingClientSeed: string | null = null;

  /** Début de plongée et instant exact du crash (ms, horloge du tick). */
  private diveStartAt = 0;
  private crashAt = 0;

  private history: RoundHistoryEntry[] = [];
  private lastCrashPoint: number | null = null;
  private stats: SessionStats = freshStats();

  private listeners = new Set<EngineListener>();
  private pendingEvents: EngineEvent[] = [];
  private snapshotCache: EngineSnapshot | null = null;
  /** Promesse de préparation du tour courant (utile aux tests). */
  private prepPromise: Promise<void> = Promise.resolve();

  // ── Mode lobby partagé ────────────────────────────────────────────────────
  private readonly sharedWorld: SharedWorld | null;
  private sharedState: SharedState | null = null;
  private sharedPeriodIndex = -1;
  private sharedRoundIndex: number | null = null;
  private sharedPhase: Phase | null = null;
  private syncing = false;

  constructor(options: EngineOptions = {}) {
    this.config = resolveConfig(options.config);
    this.fairness = options.fairness ?? realFairnessProvider;
    this.sharedWorld = options.sharedWorld ?? null;
    this.clientSeed = options.clientSeed ?? randomSeedHex(8);
    this.balanceCents =
      options.initialBalanceCents ?? this.config.startingBalanceCents;
    // Le premier tour est construit et préparé dès maintenant : le hash
    // d'engagement est souvent déjà disponible au premier rendu de l'UI.
    this.round = this.buildRound();
    this.prepPromise = this.prepareRound(this.round);
  }

  // ──────────────────────────────────────────────────────────── cycle de vie

  /**
   * Avance le moteur jusqu'à l'instant `now`. Gère plusieurs transitions de
   * phase dans un même appel (onglet endormi, gros écart entre deux frames).
   */
  tick(now: number): void {
    this.now = Math.max(now, this.now); // l'horloge ne recule jamais

    // Mode lobby partagé : la timeline vient du monde commun, pas des minuteurs.
    if (this.sharedWorld) {
      this.syncShared(now);
      return;
    }

    if (!this.started) {
      this.started = true;
      this.enterBetting(this.now);
    }

    // Boucle : un tick peut traverser BETTING→DIVING→CRASH→RESULT d'un coup.
    let safety = 16;
    while (safety-- > 0) {
      const advanced = this.step();
      if (!advanced) break;
    }
    this.emitChange();
  }

  // ─────────────────────────────────────────────────── mode lobby partagé

  /**
   * Synchronise l'état du moteur sur la timeline partagée à l'instant `now`.
   * Les paris/solde/stats du joueur restent locaux ; seules les phases et les
   * points de crash sont dictés par le monde commun.
   */
  private syncShared(now: number): void {
    const st = this.sharedWorld!.stateAt(now);
    this.sharedState = st;

    if (!st.ready) {
      // Timeline pas encore calculée : on affiche un état neutre « sync ».
      this.syncing = true;
      this.phase = "BETTING";
      this.phaseEndsAt = 0;
      this.emitChange();
      return;
    }
    this.syncing = false;

    const roundChanged =
      this.sharedRoundIndex === null ||
      st.periodIndex !== this.sharedPeriodIndex ||
      st.roundIndex !== this.sharedRoundIndex;

    // Bornes temporelles du tour courant (pour le multiplicateur et l'anim).
    this.diveStartAt = st.diveStartAt;
    this.crashAt = st.crashAt;
    this.phaseEndsAt = st.bettingEndsAt;

    if (roundChanged) {
      // Un pari encore « playing » appartenait au tour précédent : il a crashé
      // (cas d'un onglet en arrière-plan ayant sauté la phase CRASH).
      this.forceSettleLingering();
      this.sharedPeriodIndex = st.periodIndex;
      this.sharedRoundIndex = st.roundIndex;
      this.sharedPhase = null;
      this.slots.forEach((s) => {
        s.status = "idle";
        s.betCents = null;
        s.cashedOutAt = null;
        s.winCents = null;
      });
    }

    this.phase = st.phase;

    if (this.sharedPhase !== st.phase) {
      this.handleSharedPhaseTransition(st.phase, st.crashPoint);
      this.sharedPhase = st.phase;
      if (st.phase === "BETTING") this.applyAutoBets();
    }

    if (st.phase === "DIVING") {
      this.settleAutoCashoutsUpTo(this.currentRawMultiplier());
    }

    this.history = st.history;
    this.emitChange();
  }

  private handleSharedPhaseTransition(next: Phase, crashPoint: number): void {
    switch (next) {
      case "DIVING":
        this.slots.forEach((s) => {
          if (s.status === "placed") s.status = "playing";
        });
        this.pushEvent({ type: "phaseChanged", phase: "DIVING" });
        break;
      case "CRASH":
        this.settleSharedCrash(crashPoint);
        this.pushEvent({ type: "phaseChanged", phase: "CRASH" });
        break;
      case "RESULT":
        this.pushEvent({ type: "phaseChanged", phase: "RESULT" });
        break;
      case "BETTING":
        this.pushEvent({ type: "phaseChanged", phase: "BETTING" });
        break;
    }
  }

  /** Règle la syncope du tour courant : paniers non encaissés = perdus. */
  private settleSharedCrash(crashPoint: number): void {
    let playerHadBet = false;
    let roundNet = 0;
    this.slots.forEach((s) => {
      if (s.status === "cashed") {
        playerHadBet = true;
        roundNet += (s.winCents ?? 0) - (s.betCents ?? 0);
      }
      if (s.status === "playing") {
        playerHadBet = true;
        roundNet -= s.betCents ?? 0;
        s.status = "lost";
        this.pushEvent({ type: "betLost", slot: s.id, betCents: s.betCents ?? 0 });
        if (s.autoBet?.stopOnLoss) this.stopAutoBet(s.id, "loss");
      }
    });
    if (playerHadBet) {
      this.stats.roundsPlayed += 1;
      this.updateStreaks(roundNet);
    }
    this.lastCrashPoint = crashPoint;
    this.pushEvent({ type: "crashed", crashPoint });
  }

  /**
   * Clôture défensive d'un tour dont la phase CRASH n'aurait pas été traitée
   * (gros saut d'horloge). Sans effet si rien n'est resté « playing ».
   */
  private forceSettleLingering(): void {
    if (!this.slots.some((s) => s.status === "playing")) return;
    let roundNet = 0;
    this.slots.forEach((s) => {
      if (s.status === "playing") {
        roundNet -= s.betCents ?? 0;
        s.status = "lost";
        this.pushEvent({ type: "betLost", slot: s.id, betCents: s.betCents ?? 0 });
        if (s.autoBet?.stopOnLoss) this.stopAutoBet(s.id, "loss");
      } else if (s.status === "cashed") {
        roundNet += (s.winCents ?? 0) - (s.betCents ?? 0);
      }
    });
    this.stats.roundsPlayed += 1;
    this.updateStreaks(roundNet);
  }

  /** Une étape de machine à états ; renvoie true si une transition a eu lieu. */
  private step(): boolean {
    switch (this.phase) {
      case "BETTING":
        // On ne plonge que lorsque le compte à rebours est fini ET que la
        // préparation provably fair (hash d'engagement + crashPoint) est prête.
        if (this.now >= this.phaseEndsAt && this.round.ready) {
          this.enterDiving(this.phaseEndsAt);
          return true;
        }
        return false;
      case "DIVING":
        if (this.now >= this.crashAt) {
          this.settleAutoCashoutsUpTo(Number.POSITIVE_INFINITY);
          this.enterCrash();
          return true;
        }
        this.settleAutoCashoutsUpTo(this.currentRawMultiplier());
        return false;
      case "CRASH":
        if (this.now >= this.phaseEndsAt) {
          this.enterResult(this.phaseEndsAt);
          return true;
        }
        return false;
      case "RESULT":
        if (this.now >= this.phaseEndsAt) {
          this.enterBetting(this.phaseEndsAt);
          return true;
        }
        return false;
    }
  }

  private enterBetting(at: number): void {
    this.phase = "BETTING";
    this.phaseEndsAt = at + this.config.bettingDurationMs;
    // Le seed client modifié par le joueur s'applique au tour suivant,
    // c'est-à-dire maintenant ; le nonce repart alors de zéro.
    if (this.pendingClientSeed !== null) {
      this.clientSeed = this.pendingClientSeed;
      this.pendingClientSeed = null;
      this.nextNonce = 0;
      this.roundFresh = false; // force la reconstruction avec la nouvelle seed
    }
    this.slots.forEach((s) => {
      s.status = "idle";
      s.betCents = null;
      s.cashedOutAt = null;
      s.winCents = null;
    });
    // Le tour préparé par le constructeur sert tel quel au premier passage ;
    // ensuite, chaque fenêtre de pari construit un nouveau tour.
    if (!this.roundFresh) {
      this.round = this.buildRound();
      this.prepPromise = this.prepareRound(this.round);
    }
    this.roundFresh = false;
    this.applyAutoBets();
    this.pushEvent({ type: "phaseChanged", phase: "BETTING" });
  }

  private buildRound(): RoundInternal {
    return {
      roundId: this.nextRoundId++,
      nonce: this.nextNonce++,
      clientSeed: this.clientSeed,
      serverSeed: this.fairness.generateServerSeed(),
      serverSeedHash: null,
      crashPoint: null,
      ready: false,
    };
  }

  /** Engagement + point de crash, calculés pendant la fenêtre de pari. */
  private async prepareRound(round: RoundInternal): Promise<void> {
    const [hash, crashPoint] = await Promise.all([
      this.fairness.commit(round.serverSeed),
      this.fairness.crashPoint(
        round.serverSeed,
        round.clientSeed,
        round.nonce,
        this.config.houseEdge,
        this.config.maxMultiplier,
      ),
    ]);
    // Le tour a pu être abandonné (reset) entre-temps : on vérifie l'identité.
    if (this.round.roundId !== round.roundId) return;
    round.serverSeedHash = hash;
    round.crashPoint = crashPoint;
    round.ready = true;
    this.emitChange();
  }

  private enterDiving(at: number): void {
    this.phase = "DIVING";
    this.diveStartAt = at;
    const crashPoint = this.round.crashPoint ?? 1.0;
    // Instant exact où multiplier(t) atteint le crashPoint — figé dès le départ.
    this.crashAt =
      at + timeToReachMultiplier(crashPoint, this.config.growthRateK) * 1000;
    this.slots.forEach((s) => {
      if (s.status === "placed") s.status = "playing";
    });
    this.pushEvent({ type: "phaseChanged", phase: "DIVING" });
  }

  private enterCrash(): void {
    const crashPoint = this.round.crashPoint ?? 1.0;
    this.phase = "CRASH";
    // La phase CRASH démarre à l'instant logique du crash (pas du tick).
    this.phaseEndsAt = this.crashAt + this.config.crashDurationMs;

    let playerHadBet = false;
    let roundNet = 0;
    this.slots.forEach((s) => {
      if (s.status === "cashed") {
        playerHadBet = true;
        roundNet += (s.winCents ?? 0) - (s.betCents ?? 0);
      }
      if (s.status === "playing") {
        playerHadBet = true;
        roundNet -= s.betCents ?? 0;
        s.status = "lost";
        this.pushEvent({ type: "betLost", slot: s.id, betCents: s.betCents ?? 0 });
        if (s.autoBet?.stopOnLoss) this.stopAutoBet(s.id, "loss");
      }
    });
    if (playerHadBet) {
      this.stats.roundsPlayed += 1;
      this.updateStreaks(roundNet);
    }

    this.lastCrashPoint = crashPoint;
    this.history.unshift({
      roundId: this.round.roundId,
      nonce: this.round.nonce,
      clientSeed: this.round.clientSeed,
      serverSeed: this.round.serverSeed,
      serverSeedHash: this.round.serverSeedHash ?? "",
      crashPoint,
      endedAt: this.crashAt,
    });
    if (this.history.length > this.config.maxHistory) {
      this.history.length = this.config.maxHistory;
    }
    this.pushEvent({ type: "crashed", crashPoint });
    this.pushEvent({ type: "phaseChanged", phase: "CRASH" });
  }

  private enterResult(at: number): void {
    this.phase = "RESULT";
    this.phaseEndsAt = at + this.config.resultDurationMs;
    this.pushEvent({ type: "phaseChanged", phase: "RESULT" });
  }

  // ─────────────────────────────────────────────────────── multiplicateur

  /** Point de crash du tour courant (monde partagé ou tour solo). */
  private currentCrashPoint(): number {
    if (this.sharedWorld && this.sharedState) return this.sharedState.crashPoint;
    return this.round.crashPoint ?? 1.0;
  }

  /** Multiplicateur continu à l'instant du dernier tick (borné au crash). */
  private currentRawMultiplier(): number {
    if (this.phase !== "DIVING") {
      return this.phase === "CRASH" || this.phase === "RESULT"
        ? (this.lastCrashPoint ?? 1.0)
        : 1.0;
    }
    const t = Math.min(this.now, this.crashAt);
    return multiplierAt((t - this.diveStartAt) / 1000, this.config.growthRateK);
  }

  // ──────────────────────────────────────────────────────────────── paris

  /** Mise sur un panier — uniquement pendant la fenêtre de pari. */
  placeBet(slot: 0 | 1, betCents: number): ActionResult {
    if (this.phase !== "BETTING") {
      return { ok: false, reason: "bettingClosed" };
    }
    const s = this.slots[slot];
    if (s.status !== "idle") return { ok: false, reason: "alreadyPlaced" };
    const validation: BetValidation = validateBet(
      this.balanceCents,
      betCents,
      this.config,
    );
    if (!validation.ok) return { ok: false, reason: validation.reason };

    this.balanceCents = debitBet(this.balanceCents, betCents);
    s.status = "placed";
    s.betCents = betCents;
    s.cashedOutAt = null;
    s.winCents = null;
    this.stats.betsPlaced += 1;
    this.stats.totalWageredCents += betCents;
    this.stats.netCents -= betCents;
    this.pushEvent({ type: "betPlaced", slot, betCents });
    this.emitChange();
    return { ok: true };
  }

  /** Annule une mise pendant la fenêtre de pari (remboursement intégral). */
  cancelBet(slot: 0 | 1): ActionResult {
    if (this.phase !== "BETTING") return { ok: false, reason: "bettingClosed" };
    const s = this.slots[slot];
    if (s.status !== "placed" || s.betCents === null) {
      return { ok: false, reason: "noBet" };
    }
    this.balanceCents = creditWin(this.balanceCents, s.betCents);
    this.stats.betsPlaced -= 1;
    this.stats.totalWageredCents -= s.betCents;
    this.stats.netCents += s.betCents;
    this.pushEvent({ type: "betCancelled", slot, betCents: s.betCents });
    s.status = "idle";
    s.betCents = null;
    this.emitChange();
    return { ok: true };
  }

  /**
   * Cash out manuel (« Remonter »). `now` est l'instant du clic : si le crash
   * est déjà passé en temps continu, la remontée est refusée — on avance
   * d'abord la machine à états pour ne jamais payer après la syncope.
   */
  cashOut(slot: 0 | 1, now: number): ActionResult {
    this.tick(now);
    if (this.phase !== "DIVING") return { ok: false, reason: "notDiving" };
    const s = this.slots[slot];
    if (s.status !== "playing") return { ok: false, reason: "noActiveBet" };
    const x = truncateMultiplier(this.currentRawMultiplier());
    this.settleCashout(s, x, false);
    this.emitChange();
    return { ok: true };
  }

  /** Fixe (ou retire) le multiplicateur d'auto cash out d'un panier. */
  setAutoCashout(slot: 0 | 1, target: number | null): ActionResult {
    if (target !== null) {
      if (!Number.isFinite(target) || target < this.config.minAutoCashout) {
        return { ok: false, reason: "invalidTarget" };
      }
      target = Math.floor(target * 100) / 100;
    }
    this.slots[slot].autoCashout = target;
    this.emitChange();
    return { ok: true };
  }

  /**
   * Déclenche les auto cash out dont la cible est atteinte, payés exactement
   * au multiplicateur cible (sémantique temps continu : même si le tick a
   * dépassé la cible, le joueur est crédité de SA cible, pas du dépassement).
   * Avec `upTo = +∞` (appel au moment du crash), seules les cibles
   * STRICTEMENT inférieures au crashPoint sont honorées.
   */
  private settleAutoCashoutsUpTo(upTo: number): void {
    const crashPoint = this.currentCrashPoint();
    this.slots.forEach((s) => {
      if (s.status !== "playing" || s.autoCashout === null) return;
      const target = s.autoCashout;
      if (target >= crashPoint) return; // la syncope arrive avant la cible
      if (target <= upTo) this.settleCashout(s, target, true);
    });
  }

  private settleCashout(s: SlotState, multiplier: number, auto: boolean): void {
    const win = payoutCents(s.betCents ?? 0, multiplier);
    this.balanceCents = creditWin(this.balanceCents, win);
    s.status = "cashed";
    s.cashedOutAt = multiplier;
    s.winCents = win;
    this.stats.totalReturnedCents += win;
    this.stats.netCents += win;
    if (multiplier > this.stats.bestCashoutX) this.stats.bestCashoutX = multiplier;
    if (win > this.stats.bestWinCents) this.stats.bestWinCents = win;
    this.pushEvent({
      type: "cashedOut",
      slot: s.id,
      multiplier,
      winCents: win,
      auto,
    });
  }

  // ──────────────────────────────────────────────────────────── pari auto

  startAutoBet(slot: 0 | 1, config: AutoBetConfig): ActionResult {
    if (
      !Number.isInteger(config.roundsRemaining) ||
      config.roundsRemaining <= 0
    ) {
      return { ok: false, reason: "invalidRounds" };
    }
    const validation = validateBet(this.balanceCents, config.betCents, this.config);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    this.slots[slot].autoBet = { ...config };
    // Si la fenêtre de pari est ouverte et le panier libre, on joue tout de suite.
    if (this.phase === "BETTING" && this.slots[slot].status === "idle") {
      this.applyAutoBetForSlot(this.slots[slot]);
    }
    this.emitChange();
    return { ok: true };
  }

  stopAutoBet(
    slot: 0 | 1,
    reason: "finished" | "balance" | "stopCondition" | "loss" | "manual" = "manual",
  ): void {
    if (this.slots[slot].autoBet === null) return;
    this.slots[slot].autoBet = null;
    this.pushEvent({ type: "autoBetStopped", slot, reason });
    this.emitChange();
  }

  /** À chaque ouverture des paris, rejoue les paniers en pari auto. */
  private applyAutoBets(): void {
    this.slots.forEach((s) => this.applyAutoBetForSlot(s));
  }

  private applyAutoBetForSlot(s: SlotState): void {
    const ab = s.autoBet;
    if (!ab || s.status !== "idle") return;
    if (ab.roundsRemaining <= 0) return this.stopAutoBet(s.id, "finished");
    if (
      ab.stopIfBalanceBelowCents !== null &&
      this.balanceCents < ab.stopIfBalanceBelowCents
    ) {
      return this.stopAutoBet(s.id, "stopCondition");
    }
    if (ab.betCents > this.balanceCents) return this.stopAutoBet(s.id, "balance");
    const result = this.placeBet(s.id, ab.betCents);
    if (!result.ok) return this.stopAutoBet(s.id, "balance");
    ab.roundsRemaining -= 1;
  }

  // ─────────────────────────────────────────────────────── seeds & reset

  /** Change le seed client ; appliqué au prochain tour (nonce remis à 0). */
  setClientSeed(seed: string): ActionResult {
    const trimmed = seed.trim();
    if (trimmed.length === 0 || trimmed.length > 64) {
      return { ok: false, reason: "invalidSeed" };
    }
    this.pendingClientSeed = trimmed;
    this.emitChange();
    return { ok: true };
  }

  /**
   * Remet le solde de départ et efface les statistiques. Refusé pendant une
   * plongée avec mise engagée (le tour doit d'abord se résoudre).
   */
  resetWallet(): ActionResult {
    const hasLiveBet = this.slots.some(
      (s) => s.status === "playing" || s.status === "placed",
    );
    if (hasLiveBet) return { ok: false, reason: "betInProgress" };
    this.balanceCents = this.config.startingBalanceCents;
    this.stats = freshStats();
    this.pushEvent({ type: "walletReset" });
    this.emitChange();
    return { ok: true };
  }

  /**
   * Recharge de crédits FICTIFS (mode démo) : ajoute `amountCents` au solde
   * sans toucher aux statistiques. Disponible à tout moment — c'est de la
   * monnaie virtuelle sans aucune valeur réelle.
   */
  topUp(amountCents: number = this.config.topUpCents): ActionResult {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return { ok: false, reason: "invalidAmount" };
    }
    this.balanceCents = creditWin(this.balanceCents, amountCents);
    this.pushEvent({
      type: "creditsToppedUp",
      amountCents,
      balanceCents: this.balanceCents,
    });
    this.emitChange();
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────── statistiques

  private updateStreaks(roundNet: number): void {
    if (roundNet > 0) {
      this.stats.currentStreak =
        this.stats.currentStreak > 0 ? this.stats.currentStreak + 1 : 1;
      this.stats.longestWinStreak = Math.max(
        this.stats.longestWinStreak,
        this.stats.currentStreak,
      );
    } else if (roundNet < 0) {
      this.stats.currentStreak =
        this.stats.currentStreak < 0 ? this.stats.currentStreak - 1 : -1;
      this.stats.longestLossStreak = Math.max(
        this.stats.longestLossStreak,
        -this.stats.currentStreak,
      );
    }
    // roundNet == 0 (cash out à 1.00x exactement) : la série est inchangée.
  }

  // ─────────────────────────────────────────────────── abonnement / snapshot

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Attend la fin de la préparation provably fair du tour courant (tests). */
  async whenRoundReady(): Promise<void> {
    await this.prepPromise;
  }

  getSnapshot(): EngineSnapshot {
    if (this.snapshotCache) return this.snapshotCache;
    const raw = this.currentRawMultiplier();
    const displayed = truncateMultiplier(raw);
    const roundOver = this.phase === "CRASH" || this.phase === "RESULT";
    const shared = this.sharedWorld !== null;
    const ss = this.sharedState;

    // Bloc « provably fair » : en mode partagé, la graine est PUBLIQUE et donc
    // toujours révélée (timeline déterministe, vérifiable par tous).
    const round =
      shared && ss
        ? {
            roundId: ss.roundId,
            nonce: ss.nonce,
            clientSeed: ss.clientSeed,
            serverSeedHash: ss.serverSeedHash || null,
            serverSeedRevealed: ss.serverSeed,
            crashPoint: roundOver ? ss.crashPoint : null,
          }
        : {
            roundId: this.round.roundId,
            nonce: this.round.nonce,
            clientSeed: this.round.clientSeed,
            serverSeedHash: this.round.serverSeedHash,
            // Solo : seed serveur et crash révélés seulement après coup.
            serverSeedRevealed: roundOver ? this.round.serverSeed : null,
            crashPoint: roundOver ? this.round.crashPoint : null,
          };

    this.snapshotCache = {
      phase: this.phase,
      syncing: this.syncing,
      now: this.now,
      bettingEndsAt: this.phase === "BETTING" ? this.phaseEndsAt : 0,
      multiplier: displayed,
      rawMultiplier: raw,
      depthMeters: depthForMultiplier(raw, this.config.metersPerMultiplier),
      diveElapsedMs:
        this.phase === "DIVING"
          ? Math.max(0, this.now - this.diveStartAt)
          : roundOver
            ? Math.max(0, this.crashAt - this.diveStartAt)
            : 0,
      balanceCents: this.balanceCents,
      slots: [{ ...this.slots[0], autoBet: this.slots[0].autoBet && { ...this.slots[0].autoBet } },
              { ...this.slots[1], autoBet: this.slots[1].autoBet && { ...this.slots[1].autoBet } }],
      round,
      lastCrashPoint: this.lastCrashPoint,
      history: [...this.history],
      stats: { ...this.stats },
    };
    return this.snapshotCache;
  }

  private pushEvent(event: EngineEvent): void {
    this.pendingEvents.push(event);
  }

  private emitChange(): void {
    this.snapshotCache = null;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const snapshot = this.getSnapshot();
    this.listeners.forEach((l) => l(snapshot, events));
  }
}
