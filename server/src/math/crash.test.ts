import { describe, expect, it } from "vitest";
import { crashPointFromUint32, probReachAtLeast, uint32FromHashHex } from "./crash";

const EDGE = 0.03;
const TWO_POW_32 = 2 ** 32;

describe("uint32FromHashHex", () => {
  it("dérive l'entier des 8 premiers caractères hex", () => {
    expect(uint32FromHashHex("00000000ffff")).toBe(0);
    expect(uint32FromHashHex("ffffffff0000")).toBe(TWO_POW_32 - 1);
    expect(uint32FromHashHex("0000000aab")).toBe(10);
  });
  it("rejette un hash invalide", () => {
    expect(() => uint32FromHashHex("zz")).toThrow();
  });
});

describe("crashPointFromUint32", () => {
  it("ne descend jamais sous 1.00 et plafonne", () => {
    expect(crashPointFromUint32(TWO_POW_32 - 1, EDGE)).toBe(1.0);
    expect(crashPointFromUint32(0, EDGE, 1_000_000)).toBe(1_000_000);
  });
  it("est décroissante en fonction de l'entier", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const n of [0, 1_000, 1_000_000, 2 ** 30, 2 ** 31, TWO_POW_32 - 1]) {
      const cp = crashPointFromUint32(n, EDGE);
      expect(cp).toBeLessThanOrEqual(prev);
      prev = cp;
    }
  });
  it("frontière exacte P(crash ≥ 2) : int + 1 ≤ 0.485·2^32", () => {
    const boundary = Math.floor(0.485 * TWO_POW_32);
    expect(crashPointFromUint32(boundary - 1, EDGE)).toBeGreaterThanOrEqual(2);
    expect(crashPointFromUint32(boundary + 1, EDGE)).toBeLessThan(2);
  });
});

describe("distribution empirique (échantillon 200 000)", () => {
  const N = 200_000;
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    samples.push(crashPointFromUint32(Math.floor(Math.random() * TWO_POW_32), EDGE));
  }
  const freqAtLeast = (m: number) => samples.filter((x) => x >= m).length / N;

  it("P(crash ≥ m) ≈ (1 − edge)/m (2x, 3x, 10x)", () => {
    expect(freqAtLeast(2)).toBeGreaterThan(0.475);
    expect(freqAtLeast(2)).toBeLessThan(0.495);
    expect(freqAtLeast(3)).toBeGreaterThan(0.313);
    expect(freqAtLeast(3)).toBeLessThan(0.333);
    expect(freqAtLeast(10)).toBeGreaterThan(0.09);
    expect(freqAtLeast(10)).toBeLessThan(0.104);
  });
  it("taux de crash instantané (1.00x) ≈ avantage maison", () => {
    const instant = samples.filter((x) => x === 1.0).length / N;
    expect(instant).toBeGreaterThan(0.03);
    expect(instant).toBeLessThan(0.05);
  });
  it("colle à la formule théorique sur toute la gamme", () => {
    for (const m of [1.5, 5, 20, 50]) {
      expect(Math.abs(freqAtLeast(m) - probReachAtLeast(m, EDGE))).toBeLessThan(0.008);
    }
  });
});
