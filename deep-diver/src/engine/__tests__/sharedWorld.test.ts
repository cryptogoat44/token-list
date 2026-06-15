import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import { GameEngine } from "../engine";
import { timeToReachMultiplier } from "../curve";
import { locateRound, roundDurationMs, type ScheduleDurations } from "../schedule";
import { SharedWorld } from "../sharedWorld";

const D: ScheduleDurations = {
  bettingMs: 8_000,
  crashMs: 1_600,
  resultMs: 3_500,
  growthRateK: 0.14,
};
const diveMs = (m: number) => timeToReachMultiplier(m, D.growthRateK) * 1000;

describe("locateRound — découpage déterministe de la timeline", () => {
  const crashPoints = [2.0, 1.0, 5.0];

  it("identifie la phase selon le temps écoulé", () => {
    const dive2 = diveMs(2.0);
    // Tour 0 : betting [0,8000), diving [8000, 8000+dive2), crash, result.
    expect(locateRound(0, crashPoints, D)!.phase).toBe("BETTING");
    expect(locateRound(7_999, crashPoints, D)!.phase).toBe("BETTING");
    expect(locateRound(8_000, crashPoints, D)!.phase).toBe("DIVING");
    expect(locateRound(8_000 + dive2 - 1, crashPoints, D)!.phase).toBe("DIVING");
    expect(locateRound(8_000 + dive2 + 1, crashPoints, D)!.phase).toBe("CRASH");
    expect(locateRound(8_000 + dive2 + D.crashMs + 1, crashPoints, D)!.phase).toBe("RESULT");
  });

  it("passe au tour suivant après la fin du résultat", () => {
    const r0 = roundDurationMs(2.0, D);
    expect(locateRound(r0 - 1, crashPoints, D)!.roundIndex).toBe(0);
    expect(locateRound(r0, crashPoints, D)!.roundIndex).toBe(1);
    // Tour 1 est un 1.00x (plongée nulle) : très court.
    expect(locateRound(r0, crashPoints, D)!.crashPoint).toBe(1.0);
  });

  it("renvoie null au-delà des points calculés", () => {
    const total = crashPoints.reduce((s, cp) => s + roundDurationMs(cp, D), 0);
    expect(locateRound(total + 1, crashPoints, D)).toBeNull();
  });
});

describe("SharedWorld — timeline partagée déterministe", () => {
  const cfg = DEFAULT_CONFIG;
  const periodMs = 10_000_000;
  const now0 = 500 * periodMs + 1234; // période 500, un peu après son début

  it("deux mondes avec la même graine produisent la même timeline", async () => {
    const a = new SharedWorld(cfg, { periodMs, masterSeed: "graine-test" });
    const b = new SharedWorld(cfg, { periodMs, masterSeed: "graine-test" });
    await a.prime(now0);
    await b.prime(now0);
    for (const dt of [0, 5_000, 20_000, 60_000]) {
      const sa = a.stateAt(now0 + dt);
      const sb = b.stateAt(now0 + dt);
      expect(sa.ready).toBe(true);
      expect(sb.crashPoint).toBe(sa.crashPoint);
      expect(sb.phase).toBe(sa.phase);
      expect(sb.roundIndex).toBe(sa.roundIndex);
      expect(sb.roundId).toBe(sa.roundId);
    }
  });

  it("des graines différentes donnent des timelines différentes", async () => {
    const a = new SharedWorld(cfg, { periodMs, masterSeed: "graine-A" });
    const b = new SharedWorld(cfg, { periodMs, masterSeed: "graine-B" });
    await a.prime(now0);
    await b.prime(now0);
    // Au moins un des premiers tours diffère (proba de collision ~nulle).
    const sa = [0, 1, 2, 3, 4].map((i) => a.stateAt(now0 + i).crashPoint);
    const sb = [0, 1, 2, 3, 4].map((i) => b.stateAt(now0 + i).crashPoint);
    expect(sa).not.toEqual(sb);
  });

  it("révèle la graine publique et construit un historique", async () => {
    const w = new SharedWorld(cfg, { periodMs, masterSeed: "graine-test" });
    await w.prime(now0 + 120_000); // couvre plusieurs tours
    const st = w.stateAt(now0 + 120_000);
    expect(st.ready).toBe(true);
    expect(st.serverSeed).toBe("graine-test"); // publique, toujours révélée
    expect(st.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(st.history.length).toBeGreaterThan(0);
    // L'historique est antéchronologique et ne contient que des tours passés.
    expect(st.history[0].roundId).toBeGreaterThanOrEqual(st.history.at(-1)!.roundId);
  });

  it("tous les points de crash respectent le plafond Aviator (≤ 1 000 000x)", async () => {
    const w = new SharedWorld(cfg, { periodMs, masterSeed: "plafond" });
    await w.prime(now0 + 200_000);
    for (let dt = 0; dt < 200_000; dt += 2_000) {
      const st = w.stateAt(now0 + dt);
      if (st.ready) {
        expect(st.crashPoint).toBeGreaterThanOrEqual(1);
        expect(st.crashPoint).toBeLessThanOrEqual(cfg.maxMultiplier);
      }
    }
  });
});

describe("GameEngine — mode lobby partagé", () => {
  const cfg = DEFAULT_CONFIG;
  const periodMs = 10_000_000;
  const now0 = 777 * periodMs; // pile au début d'une période

  async function makeShared(seed = "lobby-test") {
    const world = new SharedWorld(cfg, { periodMs, masterSeed: seed });
    await world.prime(now0 + 300_000);
    const engine = new GameEngine({ sharedWorld: world });
    return { engine, world };
  }

  it("deux joueurs distincts voient exactement la même partie", async () => {
    const seed = "lobby-sync";
    const w1 = new SharedWorld(cfg, { periodMs, masterSeed: seed });
    const w2 = new SharedWorld(cfg, { periodMs, masterSeed: seed });
    await w1.prime(now0 + 300_000);
    await w2.prime(now0 + 300_000);
    const e1 = new GameEngine({ sharedWorld: w1, initialBalanceCents: 100_000 });
    const e2 = new GameEngine({ sharedWorld: w2, initialBalanceCents: 50_000 });

    for (let dt = 0; dt <= 120_000; dt += 250) {
      e1.tick(now0 + dt);
      e2.tick(now0 + dt);
      const s1 = e1.getSnapshot();
      const s2 = e2.getSnapshot();
      // Solde différent (local) mais MÊME timeline partagée.
      expect(s2.phase).toBe(s1.phase);
      expect(s2.multiplier).toBe(s1.multiplier);
      expect(s2.round.roundId).toBe(s1.round.roundId);
      expect(s2.round.crashPoint).toBe(s1.round.crashPoint);
    }
  });

  it("le joueur peut miser, encaisser et l'historique partagé se remplit", async () => {
    const { engine } = await makeShared("lobby-bet");
    // Avance jusqu'à trouver une fenêtre de pari, place une mise.
    let t = now0;
    const step = (toMs: number) => {
      for (; t < toMs; t += 200) engine.tick(t);
      engine.tick(toMs);
      t = toMs;
    };
    // Tour 0 commence en BETTING à t=now0.
    engine.tick(now0);
    expect(engine.getSnapshot().phase).toBe("BETTING");
    expect(engine.placeBet(0, 1_000).ok).toBe(true);
    expect(engine.getSnapshot().slots[0].status).toBe("placed");

    // Passe en plongée, encaisse à un instant donné.
    const st0 = engine.getSnapshot();
    void st0;
    step(now0 + 8_000 + 100); // début de plongée
    expect(engine.getSnapshot().phase).toBe("DIVING");
    expect(engine.getSnapshot().slots[0].status).toBe("playing");
    engine.cashOut(0, now0 + 8_000 + diveMs(1.5));
    expect(engine.getSnapshot().slots[0].status).toBe("cashed");
    expect(engine.getSnapshot().balanceCents).toBeGreaterThan(99_000);
  });

  it("une mise non encaissée est perdue à la syncope", async () => {
    const { engine, world } = await makeShared("lobby-loss");
    // Trouve un tour dont le crash est > 1.00 pour pouvoir y miser et perdre.
    let target = -1;
    for (let dt = 0; dt < 250_000; dt += 50) {
      const st = world.stateAt(now0 + dt);
      if (st.ready && st.phase === "BETTING" && st.crashPoint > 1.2 && st.crashPoint < 50) {
        target = dt;
        break;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    let t = now0;
    for (; t <= now0 + target; t += 200) engine.tick(t);
    engine.tick(now0 + target);
    expect(engine.getSnapshot().phase).toBe("BETTING");
    engine.placeBet(0, 2_000);
    const balAfterBet = engine.getSnapshot().balanceCents;
    // Avance loin au-delà du crash de ce tour sans encaisser.
    const st = world.stateAt(now0 + target);
    const crashRel = st.crashAt - now0;
    for (; t <= now0 + crashRel + 2_000; t += 200) engine.tick(t);
    engine.tick(now0 + crashRel + 2_000);
    expect(engine.getSnapshot().slots[0].status).toBe("lost");
    expect(engine.getSnapshot().balanceCents).toBe(balAfterBet);
  });
});
