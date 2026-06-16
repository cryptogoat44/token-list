import { describe, expect, it } from "vitest";
import {
  commitServerSeed,
  deriveCrashPoint,
  generateServerSeed,
  roundMessage,
  sha256Hex,
  verifyRound,
} from "./provablyFair";

const EDGE = 0.03;
const MAX = 1_000_000;

describe("sha256Hex", () => {
  it("respecte les vecteurs NIST", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("generateServerSeed (CSPRNG)", () => {
  it("produit 32 octets hex, non répétés", () => {
    const a = generateServerSeed();
    const b = generateServerSeed();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("commit-reveal & dérivation", () => {
  it("engagement = SHA-256(serverSeed), déterministe", () => {
    const s = generateServerSeed();
    expect(commitServerSeed(s)).toBe(sha256Hex(s));
  });
  it("crashPoint déterministe pour mêmes seeds + nonce", () => {
    const a = deriveCrashPoint("server-x", "client-y", 7, EDGE, MAX);
    const b = deriveCrashPoint("server-x", "client-y", 7, EDGE, MAX);
    expect(a.crashPoint).toBe(b.crashPoint);
    expect(a.hash).toBe(b.hash);
    expect(a.crashPoint).toBeGreaterThanOrEqual(1);
    expect(a.crashPoint).toBeLessThanOrEqual(MAX);
  });
  it("change avec le nonce et le clientSeed", () => {
    const base = deriveCrashPoint("s", "c", 0, EDGE, MAX).hash;
    expect(deriveCrashPoint("s", "c", 1, EDGE, MAX).hash).not.toBe(base);
    expect(deriveCrashPoint("s", "c2", 0, EDGE, MAX).hash).not.toBe(base);
  });
  it("roundMessage = serverSeed:clientSeed:nonce", () => {
    expect(roundMessage("a", "b", 3)).toBe("a:b:3");
  });
});

describe("verifyRound", () => {
  it("valide engagement + crashPoint d'un vrai tour", () => {
    const serverSeed = generateServerSeed();
    const clientSeed = "joueur-1+joueur-2+joueur-3";
    const nonce = 42;
    const hash = commitServerSeed(serverSeed);
    const { crashPoint } = deriveCrashPoint(serverSeed, clientSeed, nonce, EDGE, MAX);
    const r = verifyRound({
      serverSeed,
      clientSeed,
      nonce,
      houseEdge: EDGE,
      maxMultiplier: MAX,
      expectedServerSeedHash: hash,
      expectedCrashPoint: crashPoint,
    });
    expect(r.ok).toBe(true);
    expect(r.commitMatches).toBe(true);
    expect(r.crashPointMatches).toBe(true);
  });
  it("détecte une graine serveur falsifiée", () => {
    const serverSeed = generateServerSeed();
    const hash = commitServerSeed(serverSeed);
    const r = verifyRound({
      serverSeed: serverSeed + "00",
      clientSeed: "c",
      nonce: 0,
      houseEdge: EDGE,
      expectedServerSeedHash: hash,
    });
    expect(r.commitMatches).toBe(false);
    expect(r.ok).toBe(false);
  });
  it("détecte un crashPoint annoncé mensonger", () => {
    const serverSeed = generateServerSeed();
    const { crashPoint } = deriveCrashPoint(serverSeed, "c", 0, EDGE, MAX);
    const r = verifyRound({
      serverSeed,
      clientSeed: "c",
      nonce: 0,
      houseEdge: EDGE,
      expectedCrashPoint: crashPoint + 1,
    });
    expect(r.crashPointMatches).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe("preuve de conformité : RTP empirique ≈ RTP configuré", () => {
  it("sur 100 000 tours réels (graine CSPRNG), RTP ride-to-crash ≈ 97 %", () => {
    // Joueur de référence qui « ride to crash » (ne sort jamais) : son retour
    // est crashPoint si crash ≥ cible... ici on mesure l'espérance du retour
    // d'une mise unitaire sortie à une cible fixe t : t · P(crash ≥ t) = RTP.
    const target = 2;
    const serverSeed = generateServerSeed();
    const clientSeed = "conformite";
    let wins = 0;
    const N = 100_000;
    for (let nonce = 0; nonce < N; nonce++) {
      const { crashPoint } = deriveCrashPoint(serverSeed, clientSeed, nonce, EDGE, MAX);
      if (crashPoint >= target) wins += 1;
    }
    const rtp = target * (wins / N);
    expect(rtp).toBeGreaterThan(0.95);
    expect(rtp).toBeLessThan(0.99);
  });

  it("taux de crash instantané ≈ avantage maison", () => {
    const serverSeed = generateServerSeed();
    let instant = 0;
    const N = 100_000;
    for (let nonce = 0; nonce < N; nonce++) {
      if (deriveCrashPoint(serverSeed, "edge", nonce, EDGE, MAX).crashPoint === 1.0) instant += 1;
    }
    expect(instant / N).toBeGreaterThan(0.03);
    expect(instant / N).toBeLessThan(0.05);
  });
});
