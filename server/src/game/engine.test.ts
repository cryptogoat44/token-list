import { describe, expect, it } from "vitest";
import { GameEngine, type GameEvent } from "./engine";
import type { RngProvider } from "./rngProvider";
import { timeToReachMultiplier } from "../math/curve";

const K = 0.14;
const reach = (m: number) => timeToReachMultiplier(m, K) * 1000;
const DUR = { bettingMs: 8_000, crashMs: 1_600, settlementMs: 3_500 };
const ROUND = (cp: number) => 8_000 + reach(cp) + DUR.crashMs + DUR.settlementMs;

/** RNG scripté : rejoue une liste de points de crash déterministes. */
function scriptedRng(crashPoints: number[]): RngProvider {
  let i = 0;
  return {
    newServerSeed: () => `seed-${i}`,
    commit: (s) => `hash:${s}`,
    crashPoint: () => crashPoints[Math.min(i++, crashPoints.length - 1)],
  };
}

function makeEngine(crashPoints: number[]) {
  const events: GameEvent[] = [];
  const engine = new GameEngine({
    rng: scriptedRng(crashPoints),
    config: { durations: DUR },
  });
  engine.subscribe((e) => events.push(e));
  return { engine, events };
}

describe("GameEngine — cycle de vie & événements", () => {
  it("crée un tour, passe en RUNNING, révèle au crash, règle, puis enchaîne", () => {
    const { engine, events } = makeEngine([2.0, 5.0]);
    engine.tick(0);
    expect(events.find((e) => e.type === "roundCreated")).toMatchObject({
      roundId: 1,
      serverSeedHash: "hash:seed-0",
    });
    expect(engine.snapshot(0).phase).toBe("BETTING");

    engine.tick(8_000);
    expect(events.some((e) => e.type === "running" && e.roundId === 1)).toBe(true);

    const crashAt = 8_000 + reach(2.0);
    engine.tick(crashAt + 10);
    const crashed = events.find((e) => e.type === "crashed");
    expect(crashed).toMatchObject({ roundId: 1, crashPoint: 2.0, serverSeed: "seed-0" });
    expect(events.some((e) => e.type === "settled")).toBe(true);

    // Tour suivant créé après la fin du règlement.
    engine.tick(ROUND(2.0) + 10);
    expect(events.filter((e) => e.type === "roundCreated").length).toBe(2);
    expect(engine.snapshot(ROUND(2.0) + 10).roundId).toBe(2);
  });

  it("incrémente le nonce à chaque tour", () => {
    const { engine } = makeEngine([1.2, 1.2]);
    engine.tick(0);
    expect(engine.snapshot(0).seeds.nonce).toBe(0);
    engine.tick(ROUND(1.2) + 10);
    expect(engine.snapshot(ROUND(1.2) + 10).seeds.nonce).toBe(1);
  });

  it("règle même en cas de gros saut d'horloge (plusieurs tours sautés)", () => {
    const { engine, events } = makeEngine([1.5, 1.5, 1.5, 1.5]);
    engine.tick(0);
    engine.tick(ROUND(1.5) * 3 + 100); // saute ~3 tours d'un coup
    // Chaque tour traversé a été réglé.
    expect(events.filter((e) => e.type === "settled").length).toBeGreaterThanOrEqual(3);
  });
});

describe("GameEngine — mises & encaissements", () => {
  it("mise en BETTING, encaissement en RUNNING, gain crédité au règlement", () => {
    const { engine, events } = makeEngine([5.0]);
    engine.tick(0);
    expect(engine.placeBet({ betId: "b1", playerId: "p1", amountCents: 1000 }, 1_000).ok).toBe(true);
    // Encaisse à 2.00x.
    const res = engine.cashOut("b1", 8_000 + reach(2.0));
    expect(res.ok).toBe(true);
    // Va jusqu'au règlement.
    engine.tick(8_000 + reach(5.0) + 10);
    const settled = events.find((e) => e.type === "settled");
    expect(settled && settled.type === "settled" && settled.settlement.totalPaidCents).toBe(2000);
  });

  it("mise refusée hors BETTING ; encaissement refusé après le crash", () => {
    const { engine } = makeEngine([2.0]);
    engine.tick(0);
    engine.placeBet({ betId: "b1", playerId: "p1", amountCents: 1000 }, 1_000);
    engine.tick(8_000);
    expect(engine.placeBet({ betId: "b2", playerId: "p1", amountCents: 1000 }, 8_000).ok).toBe(false);
    expect(engine.cashOut("b1", 8_000 + reach(2.0) + 1).ok).toBe(false); // après crash
  });
});
