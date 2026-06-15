import { describe, expect, it } from "vitest";
import {
  commitServerSeed,
  computeCrashPoint,
  crashPointFromUint32,
  randomSeedHex,
  roundMessage,
  sha256Hex,
  uint32FromHashHex,
  verifyRound,
} from "../fairness";

const EDGE = 0.03;
const TWO_POW_32 = 2 ** 32;

describe("sha256Hex", () => {
  it("correspond aux vecteurs de test FIPS 180-2", async () => {
    // Vecteurs officiels NIST pour SHA-256.
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("uint32FromHashHex", () => {
  it("dérive l'entier des 8 premiers caractères hex", () => {
    expect(uint32FromHashHex("00000000ffff")).toBe(0);
    expect(uint32FromHashHex("ffffffff0000")).toBe(TWO_POW_32 - 1);
    expect(uint32FromHashHex("0000000a" + "ab")).toBe(10);
  });
  it("rejette un hash invalide", () => {
    expect(() => uint32FromHashHex("zz")).toThrow();
  });
});

describe("crashPointFromUint32 — formule de référence", () => {
  it("ne descend jamais sous 1.00", () => {
    expect(crashPointFromUint32(TWO_POW_32 - 1, EDGE)).toBe(1.0);
  });

  it("donne un multiplicateur astronomique pour int = 0", () => {
    expect(crashPointFromUint32(0, EDGE)).toBeGreaterThan(1_000_000);
  });

  it("est décroissante en fonction de l'entier", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const n of [0, 1_000, 1_000_000, 2 ** 30, 2 ** 31, TWO_POW_32 - 1]) {
      const cp = crashPointFromUint32(n, EDGE);
      expect(cp).toBeLessThanOrEqual(prev);
      prev = cp;
    }
  });

  it("respecte la frontière exacte P(crash ≥ 2) : int ≤ ⌊0.485·2^32⌋ − 1", () => {
    // crash ≥ 2.00 ⇔ (2^32/(int+1))·0.97 ≥ 2 ⇔ int + 1 ≤ 0.485·2^32.
    const boundary = Math.floor(0.485 * TWO_POW_32);
    expect(crashPointFromUint32(boundary - 1, EDGE)).toBeGreaterThanOrEqual(2);
    expect(crashPointFromUint32(boundary + 1, EDGE)).toBeLessThan(2);
  });

  it("avec edge nul, P(crash = 1.00) ne vient que de la troncature", () => {
    // Sans avantage maison, presque tout l'espace donne crash > 1.00.
    expect(crashPointFromUint32(0, 0)).toBeGreaterThan(1);
    expect(crashPointFromUint32(TWO_POW_32 - 1, 0)).toBe(1.0);
  });
});

describe("distribution des crashPoints (échantillon 200 000)", () => {
  // Échantillonnage direct de la fonction pure sur des entiers 32 bits
  // uniformes : c'est exactement la distribution induite par SHA-256.
  const N = 200_000;
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    samples.push(crashPointFromUint32(Math.floor(Math.random() * TWO_POW_32), EDGE));
  }
  const freqAtLeast = (m: number) =>
    samples.filter((x) => x >= m).length / N;

  it("P(crash ≥ 2) ≈ 48,5 %", () => {
    expect(freqAtLeast(2)).toBeGreaterThan(0.475);
    expect(freqAtLeast(2)).toBeLessThan(0.495);
  });

  it("P(crash ≥ 3) ≈ 32,3 %", () => {
    expect(freqAtLeast(3)).toBeGreaterThan(0.313);
    expect(freqAtLeast(3)).toBeLessThan(0.333);
  });

  it("P(crash ≥ 10) ≈ 9,7 %", () => {
    expect(freqAtLeast(10)).toBeGreaterThan(0.09);
    expect(freqAtLeast(10)).toBeLessThan(0.104);
  });

  it("~3-4 % de tours crashent instantanément à 1.00x (avantage maison)", () => {
    // Valeur théorique exacte : 1 − 0.97/1.01 ≈ 3,96 % — l'ordre de grandeur
    // de l'avantage maison (3 %), matérialisé par les syncopes immédiates.
    const instant = samples.filter((x) => x === 1.0).length / N;
    expect(instant).toBeGreaterThan(0.03);
    expect(instant).toBeLessThan(0.05);
  });

  it("suit P(crash ≥ m) = (1 − edge)/m sur toute la gamme", () => {
    for (const m of [1.5, 5, 20, 50]) {
      const expected = (1 - EDGE) / m;
      expect(Math.abs(freqAtLeast(m) - expected)).toBeLessThan(0.008);
    }
  });
});

describe("pipeline hash → crashPoint (bout en bout)", () => {
  it("est déterministe : mêmes seeds + nonce ⇒ même point de crash", async () => {
    const a = await computeCrashPoint("serveur-test", "client-test", 7, EDGE);
    const b = await computeCrashPoint("serveur-test", "client-test", 7, EDGE);
    expect(a.crashPoint).toBe(b.crashPoint);
    expect(a.hash).toBe(b.hash);
  });

  it("change avec le nonce et avec le clientSeed", async () => {
    const base = await computeCrashPoint("s", "c", 0, EDGE);
    const otherNonce = await computeCrashPoint("s", "c", 1, EDGE);
    const otherClient = await computeCrashPoint("s", "c2", 0, EDGE);
    expect(otherNonce.hash).not.toBe(base.hash);
    expect(otherClient.hash).not.toBe(base.hash);
  });

  it("produit une distribution plausible sur 2 000 tours réels", async () => {
    const serverSeed = randomSeedHex(32);
    const clientSeed = "joueur-vitest";
    const points: number[] = [];
    for (let nonce = 0; nonce < 2000; nonce++) {
      const { crashPoint } = await computeCrashPoint(
        serverSeed,
        clientSeed,
        nonce,
        EDGE,
      );
      expect(crashPoint).toBeGreaterThanOrEqual(1.0);
      points.push(crashPoint);
    }
    // Médiane théorique : P(crash ≥ m) = 0.5 ⇒ m = 0.97/0.5 = 1.94.
    const sorted = [...points].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeGreaterThan(1.5);
    expect(median).toBeLessThan(2.5);
  });
});

describe("verifyRound — le vérificateur provably fair", () => {
  it("recalcule le même crashPoint et valide l'engagement", async () => {
    const serverSeed = randomSeedHex(32);
    const clientSeed = "ma-seed";
    const nonce = 42;
    const committed = await commitServerSeed(serverSeed);
    const { crashPoint } = await computeCrashPoint(
      serverSeed,
      clientSeed,
      nonce,
      EDGE,
    );

    const result = await verifyRound({
      serverSeed,
      clientSeed,
      nonce,
      houseEdge: EDGE,
      expectedServerSeedHash: committed,
      expectedCrashPoint: crashPoint,
    });
    expect(result.ok).toBe(true);
    expect(result.commitMatches).toBe(true);
    expect(result.crashPointMatches).toBe(true);
    expect(result.crashPoint).toBe(crashPoint);
  });

  it("détecte un serverSeed falsifié", async () => {
    const serverSeed = randomSeedHex(32);
    const committed = await commitServerSeed(serverSeed);
    const result = await verifyRound({
      serverSeed: serverSeed + "00", // seed altéré après coup
      clientSeed: "c",
      nonce: 0,
      houseEdge: EDGE,
      expectedServerSeedHash: committed,
    });
    expect(result.commitMatches).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("détecte un point de crash annoncé mensonger", async () => {
    const serverSeed = randomSeedHex(32);
    const { crashPoint } = await computeCrashPoint(serverSeed, "c", 0, EDGE);
    const result = await verifyRound({
      serverSeed,
      clientSeed: "c",
      nonce: 0,
      houseEdge: EDGE,
      expectedCrashPoint: crashPoint + 1,
    });
    expect(result.crashPointMatches).toBe(false);
    expect(result.ok).toBe(false);
  });
});

describe("roundMessage", () => {
  it("suit le format serverSeed:clientSeed:nonce", () => {
    expect(roundMessage("a", "b", 3)).toBe("a:b:3");
  });
});
