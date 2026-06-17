import { describe, expect, it } from "vitest";
import { simulate } from "./simulate";
import { formatReport } from "./report";

describe("simulate — conformité statistique", () => {
  // Échantillon déterministe (graine fixe) → reproductible, donc non flaky.
  const report = simulate({ rounds: 40_000, seed: "test-rgs" });

  it("taux de crash instantané ≈ théorique (≈ 3,96 %)", () => {
    expect(report.theoreticalInstantRate).toBeCloseTo(0.0396, 3);
    expect(Math.abs(report.instantCrashRate - report.theoreticalInstantRate)).toBeLessThan(0.005);
  });

  it("P(crash ≥ m) colle à la théorie (1−edge)/m", () => {
    const two = report.targets.find((t) => t.target === 2)!;
    expect(two.theoreticalProb).toBeCloseTo(0.485, 3);
    expect(Math.abs(two.empiricalProb - 0.485)).toBeLessThan(0.015);
  });

  it("RTP implicite ≈ 97 % à chaque cible", () => {
    for (const t of report.targets) {
      // Cibles élevées = peu d'occurrences sur 40 000 tours → plus bruitées.
      const tol = t.target <= 10 ? 0.03 : 0.2;
      expect(Math.abs(t.impliedRtp - 0.97)).toBeLessThan(tol);
    }
  });

  it("la distribution couvre tous les tours et la médiane est plausible (~1.9x)", () => {
    const total = report.buckets.reduce((a, b) => a + b.count, 0);
    expect(total).toBe(40_000);
    expect(report.quantiles.p50).toBeGreaterThan(1.5);
    expect(report.quantiles.p50).toBeLessThan(2.5);
    expect(report.maxCrash).toBeGreaterThanOrEqual(report.quantiles.p99);
  });

  it("est reproductible à graine égale", () => {
    const again = simulate({ rounds: 40_000, seed: "test-rgs" });
    expect(again.instantCrashRate).toBe(report.instantCrashRate);
    expect(again.maxCrash).toBe(report.maxCrash);
  });

  it("produit un rapport Markdown lisible", () => {
    const md = formatReport(report);
    expect(md).toContain("rapport du modèle mathématique");
    expect(md).toContain("P(crash ≥ m)");
    expect(md).toContain("RTP");
  });
});
