import { describe, expect, it } from "vitest";
import { Round } from "./round";
import { timeToReachMultiplier } from "../math/curve";

const DUR = { bettingMs: 8_000, crashMs: 1_600, settlementMs: 3_500 };
const MATH = { houseEdge: 0.03, maxMultiplier: 1_000_000, growthRateK: 0.14 };

function makeRound(crashPoint: number, startedAt = 0): Round {
  return new Round({
    id: 1,
    serverSeed: "secret-seed",
    serverSeedHash: "hash-of-secret",
    clientSeed: "client",
    nonce: 0,
    crashPoint,
    startedAt,
    durations: DUR,
    math: MATH,
  });
}
const reach = (m: number) => timeToReachMultiplier(m, MATH.growthRateK) * 1000;

describe("Round — phases & timing", () => {
  it("séquence BETTING → RUNNING → CRASH → SETTLEMENT", () => {
    const r = makeRound(2.0);
    expect(r.phaseAt(0)).toBe("BETTING");
    expect(r.phaseAt(7_999)).toBe("BETTING");
    expect(r.phaseAt(8_000)).toBe("RUNNING");
    expect(r.phaseAt(r.crashAt - 1)).toBe("RUNNING");
    expect(r.phaseAt(r.crashAt)).toBe("CRASH");
    expect(r.phaseAt(r.crashEndsAt)).toBe("SETTLEMENT");
    expect(r.isOver(r.endsAt)).toBe(true);
  });

  it("crashAt = fin du betting + temps pour atteindre le crashPoint", () => {
    const r = makeRound(2.0);
    expect(r.crashAt).toBeCloseTo(8_000 + reach(2.0), 6);
  });

  it("multiplicateur : 1.00 en betting, figé au crashPoint après le crash", () => {
    const r = makeRound(3.0);
    expect(r.multiplierAt(0)).toBe(1.0);
    expect(r.multiplierAt(8_000 + reach(2.0))).toBeCloseTo(2.0, 2);
    expect(r.multiplierAt(r.crashAt + 500)).toBe(3.0);
  });
});

describe("Round — mises & encaissements (horodatage serveur)", () => {
  it("mise acceptée seulement en BETTING", () => {
    const r = makeRound(5.0);
    expect(r.placeBet({ betId: "b1", playerId: "p1", amountCents: 1000 }, 1_000).ok).toBe(true);
    expect(r.placeBet({ betId: "b2", playerId: "p1", amountCents: 1000 }, 9_000)).toEqual({
      ok: false,
      reason: "bettingClosed",
    });
  });

  it("encaissement : paye mise × multiplicateur tronqué", () => {
    const r = makeRound(5.0);
    r.placeBet({ betId: "b1", playerId: "p1", amountCents: 1000 }, 1_000);
    const now = 8_000 + reach(1.5); // multiplicateur = 1.50
    const res = r.cashOut("b1", now);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.bet.cashoutMultiplier).toBe(1.5);
      expect(res.bet.payoutCents).toBe(1500);
      expect(res.bet.status).toBe("cashed");
    }
  });

  it("encaissement APRÈS l'instant de crash refusé (serveur fait foi)", () => {
    const r = makeRound(2.0);
    r.placeBet({ betId: "b1", playerId: "p1", amountCents: 1000 }, 1_000);
    expect(r.cashOut("b1", r.crashAt + 1)).toEqual({ ok: false, reason: "tooLate" });
  });

  it("règlement : encaissés crédités, actifs perdus, totaux corrects", () => {
    const r = makeRound(4.0);
    r.placeBet({ betId: "win", playerId: "p1", amountCents: 1000 }, 500);
    r.placeBet({ betId: "lose", playerId: "p2", amountCents: 2000 }, 500);
    r.cashOut("win", 8_000 + reach(2.0)); // 2.00x → 2000
    const s = r.settle();
    expect(s.totalStakedCents).toBe(3000);
    expect(s.totalPaidCents).toBe(2000);
    const win = s.instructions.find((i) => i.betId === "win")!;
    const lose = s.instructions.find((i) => i.betId === "lose")!;
    expect(win).toMatchObject({ type: "credit", amountCents: 2000 });
    expect(lose).toMatchObject({ type: "lost", amountCents: 2000 });
  });
});

describe("Round — secret jamais révélé en avance", () => {
  it("la graine serveur n'apparaît qu'après le crash", () => {
    const r = makeRound(2.0);
    expect(r.snapshot(1_000).seeds.serverSeedRevealed).toBeNull();
    expect(r.snapshot(1_000).crashPoint).toBeNull();
    const after = r.snapshot(r.crashAt + 1);
    expect(after.seeds.serverSeedRevealed).toBe("secret-seed");
    expect(after.crashPoint).toBe(2.0);
  });
});
