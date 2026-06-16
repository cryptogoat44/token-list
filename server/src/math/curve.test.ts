import { describe, expect, it } from "vitest";
import { multiplierAt, timeToReachMultiplier, truncateMultiplier } from "./curve";

const K = 0.14;

describe("multiplierAt", () => {
  it("démarre à 1.00 et croît", () => {
    expect(multiplierAt(0, K)).toBe(1.0);
    expect(multiplierAt(-5, K)).toBe(1.0);
    let prev = 0;
    for (let t = 0; t <= 30; t += 0.5) {
      const m = multiplierAt(t, K);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });
});

describe("timeToReachMultiplier — inverse exacte", () => {
  it("multiplierAt(timeToReach(m)) == m", () => {
    for (const m of [1.01, 1.5, 2, 3.7, 10, 123.45, 5000]) {
      expect(multiplierAt(timeToReachMultiplier(m, K), K)).toBeCloseTo(m, 9);
    }
  });
  it("vaut 0 pour m ≤ 1", () => {
    expect(timeToReachMultiplier(1.0, K)).toBe(0);
    expect(timeToReachMultiplier(0.5, K)).toBe(0);
  });
});

describe("truncateMultiplier", () => {
  it("tronque à 2 décimales sans arrondir au-dessus, plancher 1.00", () => {
    expect(truncateMultiplier(2.4599)).toBe(2.45);
    expect(truncateMultiplier(1.999999)).toBe(1.99);
    expect(truncateMultiplier(2.45)).toBe(2.45);
    expect(truncateMultiplier(0.97)).toBe(1.0);
  });
});
