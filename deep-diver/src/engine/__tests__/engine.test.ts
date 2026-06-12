import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine";
import type { FairnessProvider } from "../fairness";
import { timeToReachMultiplier } from "../curve";
import { DEFAULT_CONFIG } from "../config";

/**
 * Fournisseur scripté : rejoue une liste de points de crash prédéterminés,
 * pour scénariser les tours sans aléa. Le moteur ne sait pas la différence.
 */
function scriptedFairness(crashPoints: number[]): FairnessProvider {
  let i = 0;
  return {
    generateServerSeed: () => `seed-${i}`,
    commit: async (s) => `hash(${s})`,
    crashPoint: async () => crashPoints[Math.min(i++, crashPoints.length - 1)],
  };
}

const CFG = {
  bettingDurationMs: 5_000,
  crashDurationMs: 1_000,
  resultDurationMs: 2_000,
};
const K = DEFAULT_CONFIG.growthRateK;

/** Crée un moteur prêt à plonger, avec horloge simulée démarrant à t = 0. */
async function makeEngine(crashPoints: number[], extra: Record<string, unknown> = {}) {
  const engine = new GameEngine({
    fairness: scriptedFairness(crashPoints),
    config: { ...CFG, ...extra },
    clientSeed: "test-client",
  });
  engine.tick(0); // démarre la première fenêtre de pari
  await engine.whenRoundReady();
  return engine;
}

/** Avance l'horloge par pas de `step` ms jusqu'à `target`. */
function advance(engine: GameEngine, from: number, target: number, step = 50) {
  let t = from;
  while (t < target) {
    t = Math.min(t + step, target);
    engine.tick(t);
  }
  return t;
}

/** Instant (ms depuis le début de plongée) où la courbe atteint m. */
const msToReach = (m: number) => timeToReachMultiplier(m, K) * 1000;

describe("cycle de vie d'un tour", () => {
  it("enchaîne BETTING → DIVING → CRASH → RESULT → BETTING", async () => {
    const engine = await makeEngine([2.0]);
    expect(engine.getSnapshot().phase).toBe("BETTING");

    engine.tick(5_000);
    expect(engine.getSnapshot().phase).toBe("DIVING");

    // Le crash à 2.00x survient ~4,95 s après le début de la plongée.
    const crashAt = 5_000 + msToReach(2.0);
    advance(engine, 5_000, crashAt + 10);
    expect(engine.getSnapshot().phase).toBe("CRASH");
    expect(engine.getSnapshot().lastCrashPoint).toBe(2.0);

    advance(engine, crashAt + 10, crashAt + CFG.crashDurationMs + 10);
    expect(engine.getSnapshot().phase).toBe("RESULT");

    advance(
      engine,
      crashAt + CFG.crashDurationMs + 10,
      crashAt + CFG.crashDurationMs + CFG.resultDurationMs + 10,
    );
    await engine.whenRoundReady();
    expect(engine.getSnapshot().phase).toBe("BETTING");
    expect(engine.getSnapshot().round.roundId).toBe(2);
  });

  it("rattrape plusieurs phases dans un seul tick (onglet endormi)", async () => {
    const engine = await makeEngine([1.5]);
    engine.tick(60_000); // saute toute la plongée et la fin du tour
    const snap = engine.getSnapshot();
    // Le tour s'est résolu correctement, l'historique en garde la trace…
    expect(snap.history[0]?.crashPoint).toBe(1.5);
    // …et le moteur attend la préparation du tour suivant (ou y est déjà).
    expect(["BETTING", "DIVING", "CRASH", "RESULT"]).toContain(snap.phase);
  });

  it("un crash à 1.00x termine la plongée immédiatement (syncope en surface)", async () => {
    const engine = await makeEngine([1.0]);
    engine.placeBet(0, 1_000);
    engine.tick(5_000);
    engine.tick(5_001);
    const snap = engine.getSnapshot();
    expect(snap.phase).toBe("CRASH");
    expect(snap.lastCrashPoint).toBe(1.0);
    expect(snap.slots[0].status).toBe("lost");
  });

  it("le multiplicateur affiché suit la courbe et se fige au crashPoint", async () => {
    const engine = await makeEngine([3.0]);
    engine.tick(5_000);
    engine.tick(5_000 + msToReach(2.0));
    expect(engine.getSnapshot().multiplier).toBeCloseTo(2.0, 2);
    engine.tick(5_000 + msToReach(3.0) + 500); // après le crash
    expect(engine.getSnapshot().multiplier).toBe(3.0);
  });
});

describe("paris et cash out manuel", () => {
  it("accepte une mise pendant BETTING, la refuse pendant DIVING", async () => {
    const engine = await makeEngine([5.0]);
    expect(engine.placeBet(0, 1_000).ok).toBe(true);
    expect(engine.getSnapshot().balanceCents).toBe(99_000);
    engine.tick(5_000);
    expect(engine.getSnapshot().phase).toBe("DIVING");
    expect(engine.placeBet(1, 1_000)).toEqual({
      ok: false,
      reason: "bettingClosed",
    });
  });

  it("refuse de miser plus que le solde et hors bornes", async () => {
    const engine = await makeEngine([2.0]);
    expect(engine.placeBet(0, 200_000).ok).toBe(false); // > max et > solde
    expect(engine.placeBet(0, 50).ok).toBe(false); // < min
    expect(engine.getSnapshot().balanceCents).toBe(100_000);
  });

  it("refuse une double mise sur le même panier, accepte sur l'autre", async () => {
    const engine = await makeEngine([2.0]);
    expect(engine.placeBet(0, 1_000).ok).toBe(true);
    expect(engine.placeBet(0, 1_000).ok).toBe(false);
    expect(engine.placeBet(1, 2_000).ok).toBe(true);
    expect(engine.getSnapshot().balanceCents).toBe(97_000);
  });

  it("annuler une mise pendant BETTING rembourse intégralement", async () => {
    const engine = await makeEngine([2.0]);
    engine.placeBet(0, 1_000);
    expect(engine.cancelBet(0).ok).toBe(true);
    expect(engine.getSnapshot().balanceCents).toBe(100_000);
    expect(engine.getSnapshot().stats.betsPlaced).toBe(0);
  });

  it("cash out crédite mise × multiplicateur à l'instant du clic", async () => {
    const engine = await makeEngine([10.0]);
    engine.placeBet(0, 10_000); // 100 crédits
    engine.tick(5_000);
    const t = 5_000 + msToReach(2.45000001);
    engine.tick(t);
    expect(engine.cashOut(0, t).ok).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.slots[0].status).toBe("cashed");
    expect(snap.slots[0].cashedOutAt).toBe(2.45);
    expect(snap.slots[0].winCents).toBe(24_500); // 100 × 2.45 = 245 crédits
    expect(snap.balanceCents).toBe(90_000 + 24_500);
  });

  it("cash out arrivé APRÈS l'instant du crash : refusé, mise perdue", async () => {
    const engine = await makeEngine([2.0]);
    engine.placeBet(0, 1_000);
    engine.tick(5_000);
    // Le joueur clique 1 ms après le crash (aucun tick intermédiaire) :
    // le moteur avance d'abord la machine à états, donc syncope.
    const lateClick = 5_000 + msToReach(2.0) + 1;
    expect(engine.cashOut(0, lateClick).ok).toBe(false);
    const snap = engine.getSnapshot();
    expect(snap.phase).toBe("CRASH");
    expect(snap.slots[0].status).toBe("lost");
    expect(snap.balanceCents).toBe(99_000);
  });

  it("les deux paniers sont indépendants sur le même tour", async () => {
    const engine = await makeEngine([4.0]);
    engine.placeBet(0, 1_000);
    engine.placeBet(1, 2_000);
    engine.tick(5_000);
    const t = 5_000 + msToReach(1.5);
    engine.tick(t);
    engine.cashOut(0, t); // panier 1 encaisse à 1.50x
    advance(engine, t, 5_000 + msToReach(4.0) + 10); // panier 2 syncope
    const snap = engine.getSnapshot();
    expect(snap.slots[0].status).toBe("cashed");
    expect(snap.slots[1].status).toBe("lost");
    expect(snap.balanceCents).toBe(100_000 - 3_000 + 1_500);
  });
});

describe("auto cash out", () => {
  it("encaisse exactement au multiplicateur cible", async () => {
    const engine = await makeEngine([5.0]);
    engine.placeBet(0, 1_000);
    engine.setAutoCashout(0, 2.0);
    engine.tick(5_000);
    advance(engine, 5_000, 5_000 + msToReach(2.5));
    const snap = engine.getSnapshot();
    expect(snap.slots[0].status).toBe("cashed");
    expect(snap.slots[0].cashedOutAt).toBe(2.0); // exactement la cible
    expect(snap.slots[0].winCents).toBe(2_000);
  });

  it("perd si la cible est au-delà du point de crash", async () => {
    const engine = await makeEngine([1.8]);
    engine.placeBet(0, 1_000);
    engine.setAutoCashout(0, 2.0);
    engine.tick(5_000);
    advance(engine, 5_000, 5_000 + msToReach(1.8) + 10);
    expect(engine.getSnapshot().slots[0].status).toBe("lost");
  });

  it("sémantique temps continu : cible franchie dans le même tick que le crash", async () => {
    // Cible 2.0, crash 3.0 : un unique tick saute de 1.0x à après-crash.
    // En temps continu la cible a été atteinte AVANT la syncope ⇒ gagné à 2.0.
    const engine = await makeEngine([3.0]);
    engine.placeBet(0, 1_000);
    engine.setAutoCashout(0, 2.0);
    engine.tick(5_000);
    engine.tick(5_000 + msToReach(3.0) + 500); // gros saut d'horloge
    const snap = engine.getSnapshot();
    expect(snap.slots[0].status).toBe("cashed");
    expect(snap.slots[0].cashedOutAt).toBe(2.0);
    expect(snap.slots[0].winCents).toBe(2_000);
  });

  it("cible égale au crashPoint : perdu (la syncope gagne l'égalité)", async () => {
    const engine = await makeEngine([2.0]);
    engine.placeBet(0, 1_000);
    engine.setAutoCashout(0, 2.0);
    engine.tick(5_000);
    advance(engine, 5_000, 5_000 + msToReach(2.0) + 10);
    expect(engine.getSnapshot().slots[0].status).toBe("lost");
  });

  it("rejette une cible sous 1.01", async () => {
    const engine = await makeEngine([2.0]);
    expect(engine.setAutoCashout(0, 1.0).ok).toBe(false);
    expect(engine.setAutoCashout(0, 1.01).ok).toBe(true);
  });
});

describe("pari automatique", () => {
  /** Joue un tour complet et revient à la fenêtre de pari suivante. */
  async function playFullRound(engine: GameEngine, from: number, crash: number) {
    engine.tick(from + 5_000); // fin du betting
    const crashAt = from + 5_000 + msToReach(crash);
    advance(engine, from + 5_000, crashAt + CFG.crashDurationMs + CFG.resultDurationMs + 100);
    await engine.whenRoundReady();
    return crashAt + CFG.crashDurationMs + CFG.resultDurationMs;
  }

  it("rejoue la même mise sur N tours puis s'arrête", async () => {
    const engine = await makeEngine([1.5, 1.5, 1.5, 1.5]);
    engine.startAutoBet(0, {
      betCents: 1_000,
      roundsRemaining: 2,
      stopIfBalanceBelowCents: null,
      stopOnLoss: false,
    });
    // Tour 1 : la mise est posée immédiatement (fenêtre ouverte).
    expect(engine.getSnapshot().slots[0].status).toBe("placed");
    let t = await playFullRound(engine, 0, 1.5);
    // Tour 2 : rejouée automatiquement.
    expect(engine.getSnapshot().slots[0].status).toBe("placed");
    t = await playFullRound(engine, t, 1.5);
    // Tour 3 : épuisé ⇒ plus de mise, pari auto désactivé.
    expect(engine.getSnapshot().slots[0].status).toBe("idle");
    expect(engine.getSnapshot().slots[0].autoBet).toBeNull();
    expect(engine.getSnapshot().stats.betsPlaced).toBe(2);
  });

  it("s'arrête quand le solde passe sous le seuil configuré", async () => {
    const engine = await makeEngine([1.5, 1.5, 1.5], {});
    engine.startAutoBet(0, {
      betCents: 30_000,
      roundsRemaining: 10,
      stopIfBalanceBelowCents: 60_000,
      stopOnLoss: false,
    });
    // Mise 1 OK (solde 100 000 ≥ 60 000), perdue ⇒ solde 70 000.
    let t = await playFullRound(engine, 0, 1.5);
    // Mise 2 OK (70 000 ≥ 60 000), perdue ⇒ solde 40 000.
    t = await playFullRound(engine, t, 1.5);
    // Mise 3 refusée : 40 000 < 60 000 ⇒ pari auto stoppé.
    expect(engine.getSnapshot().slots[0].status).toBe("idle");
    expect(engine.getSnapshot().slots[0].autoBet).toBeNull();
    expect(engine.getSnapshot().balanceCents).toBe(40_000);
  });

  it("s'arrête après une perte si stopOnLoss est actif", async () => {
    const engine = await makeEngine([1.5, 1.5]);
    engine.startAutoBet(0, {
      betCents: 1_000,
      roundsRemaining: 10,
      stopIfBalanceBelowCents: null,
      stopOnLoss: true,
    });
    await playFullRound(engine, 0, 1.5); // pas de cash out ⇒ perte
    expect(engine.getSnapshot().slots[0].autoBet).toBeNull();
    expect(engine.getSnapshot().slots[0].status).toBe("idle");
  });

  it("combiné à l'auto cash out : gagne et continue", async () => {
    const engine = await makeEngine([3.0, 3.0]);
    engine.setAutoCashout(0, 1.5);
    engine.startAutoBet(0, {
      betCents: 1_000,
      roundsRemaining: 2,
      stopIfBalanceBelowCents: null,
      stopOnLoss: true,
    });
    await playFullRound(engine, 0, 3.0);
    // Gagné à 1.5 ⇒ stopOnLoss ne déclenche pas, la mise 2 est posée.
    expect(engine.getSnapshot().slots[0].status).toBe("placed");
    expect(engine.getSnapshot().balanceCents).toBe(100_000 - 1_000 + 1_500 - 1_000);
  });
});

describe("provably fair côté moteur", () => {
  it("publie le hash d'engagement avant le tour, révèle le seed après", async () => {
    const engine = await makeEngine([2.0]);
    let snap = engine.getSnapshot();
    expect(snap.round.serverSeedHash).toBe("hash(seed-0)");
    expect(snap.round.serverSeedRevealed).toBeNull(); // rien avant la fin
    expect(snap.round.crashPoint).toBeNull();

    engine.tick(5_000);
    snap = engine.getSnapshot();
    expect(snap.round.serverSeedRevealed).toBeNull(); // toujours caché en plongée

    advance(engine, 5_000, 5_000 + msToReach(2.0) + 10);
    snap = engine.getSnapshot();
    expect(snap.phase).toBe("CRASH");
    expect(snap.round.serverSeedRevealed).toBe("seed-0"); // révélé
    expect(snap.round.crashPoint).toBe(2.0);
    expect(snap.history[0].serverSeed).toBe("seed-0");
    expect(snap.history[0].serverSeedHash).toBe("hash(seed-0)");
  });

  it("incrémente le nonce à chaque tour", async () => {
    const engine = await makeEngine([1.2, 1.2]);
    expect(engine.getSnapshot().round.nonce).toBe(0);
    engine.tick(5_000);
    advance(engine, 5_000, 5_000 + msToReach(1.2) + CFG.crashDurationMs + CFG.resultDurationMs + 100);
    await engine.whenRoundReady();
    expect(engine.getSnapshot().round.nonce).toBe(1);
  });

  it("changer le clientSeed s'applique au tour suivant et remet le nonce à 0", async () => {
    const engine = await makeEngine([1.2, 1.2]);
    expect(engine.getSnapshot().round.clientSeed).toBe("test-client");
    engine.setClientSeed("ma-nouvelle-seed");
    // Le tour courant n'est pas affecté.
    expect(engine.getSnapshot().round.clientSeed).toBe("test-client");
    engine.tick(5_000);
    advance(engine, 5_000, 5_000 + msToReach(1.2) + CFG.crashDurationMs + CFG.resultDurationMs + 100);
    await engine.whenRoundReady();
    const snap = engine.getSnapshot();
    expect(snap.round.clientSeed).toBe("ma-nouvelle-seed");
    expect(snap.round.nonce).toBe(0);
  });
});

describe("économie et statistiques", () => {
  it("le solde n'est jamais négatif sur une longue session aléatoire", async () => {
    const crashes = Array.from({ length: 30 }, () =>
      Math.random() < 0.3 ? 1.0 : 1 + Math.random() * 5,
    );
    const engine = await makeEngine(crashes);
    let t = 0;
    for (let round = 0; round < 25; round++) {
      // mise aléatoire (parfois volontairement invalide)
      engine.placeBet(0, Math.floor(Math.random() * 60_000));
      engine.placeBet(1, 5_000);
      engine.setAutoCashout(1, 1.5);
      engine.tick(t + 5_000);
      const crashAt = t + 5_000 + msToReach(crashes[round]);
      // cash out manuel à un instant aléatoire (parfois après le crash)
      engine.cashOut(0, t + 5_000 + Math.random() * (crashAt - t - 5_000) * 1.2);
      t = advance(engine, t + 5_000, crashAt + CFG.crashDurationMs + CFG.resultDurationMs + 100);
      await engine.whenRoundReady();
      expect(engine.getSnapshot().balanceCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("tient des statistiques cohérentes (net = encaissé − misé)", async () => {
    const engine = await makeEngine([3.0, 1.2]);
    engine.placeBet(0, 10_000);
    engine.setAutoCashout(0, 2.0);
    engine.tick(5_000);
    advance(engine, 5_000, 5_000 + msToReach(3.0) + CFG.crashDurationMs + CFG.resultDurationMs + 100);
    await engine.whenRoundReady();
    const s = engine.getSnapshot().stats;
    expect(s.roundsPlayed).toBe(1);
    expect(s.betsPlaced).toBe(1);
    expect(s.totalWageredCents).toBe(10_000);
    expect(s.totalReturnedCents).toBe(20_000);
    expect(s.netCents).toBe(10_000);
    expect(s.bestCashoutX).toBe(2.0);
    expect(s.bestWinCents).toBe(20_000);
    expect(s.currentStreak).toBe(1);
  });

  it("reset du portefeuille : solde de départ, stats remises à zéro", async () => {
    const engine = await makeEngine([1.0]);
    engine.placeBet(0, 10_000);
    expect(engine.resetWallet().ok).toBe(false); // refusé : mise engagée
    engine.cancelBet(0);
    expect(engine.resetWallet().ok).toBe(true);
    expect(engine.getSnapshot().balanceCents).toBe(100_000);
    expect(engine.getSnapshot().stats.betsPlaced).toBe(0);
  });
});
