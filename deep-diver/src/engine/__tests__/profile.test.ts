import { describe, expect, it } from "vitest";
import { addCustomPreset, reachProbability, reachProbabilityPct } from "../presets";
import { evaluateAchievements } from "../achievements";
import {
  applyRound,
  emptyProfile,
  markVerified,
  reviveProfile,
  selectCosmetic,
  type RoundOutcome,
} from "../profile";

const date = "2026-06-15T10:00:00.000Z";

function cashRound(multiplier: number, winCents = 1000, netCents = 500): RoundOutcome {
  return { cashed: true, cashoutMultiplier: multiplier, crashPoint: multiplier + 1, winCents, netCents, date };
}
function lostRound(crashPoint = 1.5): RoundOutcome {
  return { cashed: false, cashoutMultiplier: null, crashPoint, winCents: 0, netCents: -1000, date };
}

describe("presets — probabilité honnête 0.97/m", () => {
  it("reachProbability suit (1 − edge)/m", () => {
    expect(reachProbabilityPct(1.3)).toBeCloseTo(74.6, 1);
    expect(reachProbabilityPct(2)).toBeCloseTo(48.5, 1);
    expect(reachProbabilityPct(10)).toBeCloseTo(9.7, 1);
    expect(reachProbability(1)).toBe(1);
  });
  it("addCustomPreset ajoute et borne", () => {
    let p = addCustomPreset([], "Mon préset", 3.5);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ multiplier: 3.5, custom: true });
    // sous 1.01 → ignoré
    expect(addCustomPreset(p, "x", 1.0)).toHaveLength(1);
    // même multiplicateur → remplace (pas de doublon)
    p = addCustomPreset(p, "Autre", 3.5);
    expect(p.filter((x) => x.multiplier === 3.5)).toHaveLength(1);
  });
});

describe("evaluateAchievements", () => {
  it("débloque selon les seuils", () => {
    expect(evaluateAchievements({ totalDives: 0, totalCashouts: 0, bestCashoutX: 0, bestDepthMeters: 0, longestCashoutStreak: 0, verifiedARound: false })).toEqual([]);
    const all = evaluateAchievements({ totalDives: 50, totalCashouts: 40, bestCashoutX: 120, bestDepthMeters: 1190, longestCashoutStreak: 12, verifiedARound: true });
    expect(all).toEqual(
      expect.arrayContaining(["premiere-plongee", "premiere-remontee", "profond-100", "serie-5", "serie-10", "zone-hadale", "legende", "verificateur"]),
    );
  });
});

describe("applyRound — records, séries, carnet, succès", () => {
  it("compte les plongées et débloque les premiers succès", () => {
    let { profile, newAchievements } = applyRound(emptyProfile(), cashRound(2));
    expect(profile.totalDives).toBe(1);
    expect(profile.totalCashouts).toBe(1);
    expect(newAchievements).toEqual(expect.arrayContaining(["premiere-plongee", "premiere-remontee"]));
    expect(profile.bestCashoutX).toBe(2);
    expect(profile.bestDepthMeters).toBeCloseTo(10); // (2-1)*10
  });

  it("série de remontées : incrémente puis se réinitialise sur une perte", () => {
    let p = emptyProfile();
    for (let i = 0; i < 5; i++) p = applyRound(p, cashRound(1.5)).profile;
    expect(p.currentCashoutStreak).toBe(5);
    expect(p.longestCashoutStreak).toBe(5);
    expect(p.unlockedAchievements).toContain("serie-5");
    p = applyRound(p, lostRound()).profile;
    expect(p.currentCashoutStreak).toBe(0);
    expect(p.longestCashoutStreak).toBe(5); // record conservé
  });

  it("bat les records de profondeur et débloque les cosmétiques liés", () => {
    let p = emptyProfile();
    const res = applyRound(p, cashRound(11)); // 100 m
    p = res.profile;
    expect(p.bestDepthMeters).toBeCloseTo(100);
    expect(p.unlockedAchievements).toContain("profond-100");
    // le cosmétique débloqué par profond-100 est présent
    expect(p.unlockedCosmetics).toContain("suit-coral");
    expect(res.newRecord).toBe(true);
  });

  it("légende à 100x débloque combinaison + bulles dorées", () => {
    const p = applyRound(emptyProfile(), cashRound(100, 100000, 99000)).profile;
    expect(p.unlockedAchievements).toContain("legende");
    expect(p.unlockedCosmetics).toEqual(expect.arrayContaining(["suit-gold", "trail-gold"]));
  });

  it("le carnet n'enregistre que les plongées marquantes (≥3x ou record)", () => {
    let p = emptyProfile();
    p = applyRound(p, cashRound(1.2)).profile; // 1er tour = record (premier best) → marquant
    const after1 = p.diveLog.length;
    p = applyRound(p, cashRound(1.1)).profile; // pas un record, <3x → pas inscrit
    expect(p.diveLog.length).toBe(after1);
    p = applyRound(p, cashRound(5)).profile; // ≥3x → inscrit
    expect(p.diveLog.length).toBe(after1 + 1);
    expect(p.diveLog[0].multiplier).toBe(5);
  });

  it("markVerified débloque le succès 'verificateur' une seule fois", () => {
    let p = emptyProfile();
    const r1 = markVerified(p);
    expect(r1.newAchievements).toContain("verificateur");
    p = r1.profile;
    const r2 = markVerified(p);
    expect(r2.newAchievements).toEqual([]);
  });
});

describe("cosmétiques & persistance", () => {
  it("selectCosmetic n'accepte qu'un cosmétique débloqué", () => {
    let p = emptyProfile();
    expect(selectCosmetic(p, "suit", "suit-gold").selectedCosmetics.suit).toBe("suit-classic"); // verrouillé
    p = applyRound(p, cashRound(100, 100000, 99000)).profile; // débloque suit-gold
    expect(selectCosmetic(p, "suit", "suit-gold").selectedCosmetics.suit).toBe("suit-gold");
  });

  it("reviveProfile répare un objet partiel", () => {
    const revived = reviveProfile({ diverName: "Nemo", bestCashoutX: 7 });
    expect(revived.diverName).toBe("Nemo");
    expect(revived.bestCashoutX).toBe(7);
    expect(revived.unlockedCosmetics).toContain("suit-classic"); // défauts réinjectés
    expect(revived.selectedCosmetics.trail).toBe("trail-cyan");
  });
});
