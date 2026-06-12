import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import {
  clampBet,
  creditWin,
  debitBet,
  payoutCents,
  validateBet,
} from "../wallet";

const cfg = DEFAULT_CONFIG; // min 100, max 50 000 centimes

describe("validateBet", () => {
  it("accepte une mise valide", () => {
    expect(validateBet(10_000, 500, cfg)).toEqual({ ok: true });
  });
  it("refuse de miser plus que le solde", () => {
    expect(validateBet(400, 500, cfg)).toEqual({
      ok: false,
      reason: "insufficient",
    });
  });
  it("refuse sous la mise minimale et au-dessus de la maximale", () => {
    expect(validateBet(10_000, 50, cfg)).toEqual({ ok: false, reason: "belowMin" });
    expect(validateBet(1_000_000, 60_000, cfg)).toEqual({
      ok: false,
      reason: "aboveMax",
    });
  });
  it("refuse les montants non entiers ou ≤ 0", () => {
    expect(validateBet(10_000, 100.5, cfg).ok).toBe(false);
    expect(validateBet(10_000, 0, cfg).ok).toBe(false);
    expect(validateBet(10_000, -100, cfg).ok).toBe(false);
  });
});

describe("payoutCents — gain = mise × multiplicateur", () => {
  it("calcule exactement au centime", () => {
    expect(payoutCents(10_000, 2.45)).toBe(24_500); // 100 crédits × 2.45
    expect(payoutCents(100, 1.0)).toBe(100);
    expect(payoutCents(333, 3.33)).toBe(1_109); // arrondi au centime
  });
  it("résiste au bruit flottant des valeurs à 2 décimales", () => {
    // 100 × 2.45 = 245.00000000000003 en IEEE 754 : l'arrondi doit absorber.
    for (let m = 100; m <= 1000; m++) {
      const x = m / 100;
      expect(payoutCents(10_000, x)).toBe(m * 100);
    }
  });
});

describe("debitBet / creditWin — le solde ne devient jamais négatif", () => {
  it("débite et crédite correctement", () => {
    expect(debitBet(1_000, 400)).toBe(600);
    expect(creditWin(600, 980)).toBe(1_580);
  });
  it("lève si le débit rendrait le solde négatif", () => {
    expect(() => debitBet(100, 200)).toThrow();
  });
  it("propriété : aucune séquence aléatoire d'opérations ne crée de négatif", () => {
    let balance = 100_000;
    for (let i = 0; i < 5_000; i++) {
      const bet = Math.floor(Math.random() * 60_000) + 1;
      if (validateBet(balance, bet, cfg).ok) {
        balance = debitBet(balance, bet);
        // une fois sur deux, cash out à un multiplicateur aléatoire
        if (Math.random() < 0.5) {
          const x = Math.floor((1 + Math.random() * 9) * 100) / 100;
          balance = creditWin(balance, payoutCents(bet, x));
        }
      }
      expect(balance).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(balance)).toBe(true);
    }
  });
});

describe("clampBet", () => {
  it("borne au solde et au plafond", () => {
    expect(clampBet(999_999, 20_000, cfg)).toBe(20_000); // limité par le solde
    expect(clampBet(999_999, 200_000, cfg)).toBe(50_000); // limité par le max
    expect(clampBet(1, 20_000, cfg)).toBe(100); // remonté au min
  });
});
