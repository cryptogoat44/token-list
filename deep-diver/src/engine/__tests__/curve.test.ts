import { describe, expect, it } from "vitest";
import {
  depthForMultiplier,
  multiplierAt,
  timeToReachMultiplier,
  truncateMultiplier,
} from "../curve";

const K = 0.14;

describe("multiplierAt", () => {
  it("démarre exactement à 1.00", () => {
    expect(multiplierAt(0, K)).toBe(1.0);
    expect(multiplierAt(-5, K)).toBe(1.0);
  });

  it("est strictement croissante", () => {
    let prev = 0;
    for (let t = 0; t <= 30; t += 0.5) {
      const m = multiplierAt(t, K);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });

  it("atteint ~2x en quelques secondes (k = 0.14 ⇒ ≈ 4,95 s)", () => {
    const t2 = Math.log(2) / K;
    expect(t2).toBeGreaterThan(3);
    expect(t2).toBeLessThan(7);
    expect(multiplierAt(t2, K)).toBeCloseTo(2.0, 10);
  });
});

describe("timeToReachMultiplier — inverse exacte de la courbe", () => {
  it("multiplierAt(timeToReach(m)) == m", () => {
    for (const m of [1.01, 1.5, 2, 3.7, 10, 123.45, 5000]) {
      const t = timeToReachMultiplier(m, K);
      expect(multiplierAt(t, K)).toBeCloseTo(m, 9);
    }
  });

  it("vaut 0 pour m ≤ 1 (crash instantané)", () => {
    expect(timeToReachMultiplier(1.0, K)).toBe(0);
    expect(timeToReachMultiplier(0.5, K)).toBe(0);
  });
});

describe("truncateMultiplier", () => {
  it("tronque à 2 décimales sans jamais arrondir au-dessus", () => {
    expect(truncateMultiplier(2.4599)).toBe(2.45);
    expect(truncateMultiplier(1.999999)).toBe(1.99);
  });
  it("est exacte sur les valeurs déjà à 2 décimales", () => {
    expect(truncateMultiplier(2.45)).toBe(2.45);
    expect(truncateMultiplier(1.0)).toBe(1.0);
  });
  it("ne descend jamais sous 1.00", () => {
    expect(truncateMultiplier(0.97)).toBe(1.0);
  });
});

describe("depthForMultiplier", () => {
  it("0 m à la surface (1.00x), puis 10 m par point de multiplicateur", () => {
    expect(depthForMultiplier(1.0, 10)).toBe(0);
    expect(depthForMultiplier(2.0, 10)).toBeCloseTo(10);
    expect(depthForMultiplier(4.7, 10)).toBeCloseTo(37);
  });
  it("jamais négative", () => {
    expect(depthForMultiplier(0.5, 10)).toBe(0);
  });
});
