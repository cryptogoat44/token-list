import { describe, expect, it } from "vitest";
import { ComplianceService } from "./complianceService";
import { countryFromHeaders } from "./geo";
import { ResponsibleGamingService } from "./responsibleGaming";
import type { OperatorConfig } from "./types";

const OPERATOR: OperatorConfig = {
  operatorId: "demo",
  name: "Demo Operator",
  jurisdictions: ["GB", "CA"],
  defaultAllow: false,
  defaultMaxBetCents: 50_000,
};

describe("ComplianceService — geo-gating", () => {
  const svc = new ComplianceService();

  it("bloque la France par défaut", () => {
    const d = svc.evaluateAccess({ operator: OPERATOR, country: "FR" });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toContain("France");
  });

  it("bloque un pays indéterminé (prudence)", () => {
    const d = svc.evaluateAccess({ operator: OPERATOR, country: null });
    expect(d.allowed).toBe(false);
  });

  it("bloque un pays hors périmètre opérateur (defaultAllow=false)", () => {
    const d = svc.evaluateAccess({ operator: OPERATOR, country: "DE" });
    expect(d.allowed).toBe(false);
  });

  it("autorise un pays servi et expose le plafond de mise", () => {
    const d = svc.evaluateAccess({ operator: OPERATOR, country: "gb" });
    expect(d.allowed).toBe(true);
    if (d.allowed) {
      expect(d.country).toBe("GB");
      expect(d.maxBetCents).toBe(50_000);
    }
  });

  it("respecte une stance defaultAllow=true tout en bloquant les interdits", () => {
    const open = new ComplianceService();
    const operatorOpen: OperatorConfig = { ...OPERATOR, defaultAllow: true };
    expect(open.evaluateAccess({ operator: operatorOpen, country: "DE" }).allowed).toBe(true);
    // France reste bloquée même si defaultAllow=true.
    expect(open.evaluateAccess({ operator: operatorOpen, country: "FR" }).allowed).toBe(false);
  });
});

describe("countryFromHeaders", () => {
  it("lit l'en-tête edge et rejette les valeurs non fiables", () => {
    expect(countryFromHeaders({ "cf-ipcountry": "gb" })).toBe("GB");
    expect(countryFromHeaders({ "x-vercel-ip-country": "FR" })).toBe("FR");
    expect(countryFromHeaders({ "cf-ipcountry": "XX" })).toBeNull();
    expect(countryFromHeaders({})).toBeNull();
  });
});

describe("ResponsibleGamingService", () => {
  it("bloque pendant une auto-exclusion puis la lève", () => {
    let t = 1000;
    const rg = new ResponsibleGamingService({ now: () => t });
    rg.selfExclude("p", 5000);
    expect(rg.canBet("p", 100).allowed).toBe(false);
    t = 6001; // après le cool-off
    expect(rg.canBet("p", 100).allowed).toBe(true);
  });

  it("applique le plafond de mise de session", () => {
    const rg = new ResponsibleGamingService({ limits: { sessionWagerCapCents: 1000 } });
    rg.recordBet("p", 800);
    expect(rg.canBet("p", 100).allowed).toBe(true);
    const blocked = rg.canBet("p", 300); // 800 + 300 > 1000
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.reason).toBe("session_wager_cap");
  });

  it("applique le plafond de perte nette de session", () => {
    const rg = new ResponsibleGamingService({ limits: { sessionLossCapCents: 500 } });
    rg.recordBet("p", 400);
    rg.recordReturn("p", 0);
    // perte projetée si on mise 200 de plus = 600 > 500
    const blocked = rg.canBet("p", 200);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.reason).toBe("session_loss_cap");
    // un gain réduit la perte nette et redébloque.
    rg.recordReturn("p", 400);
    expect(rg.canBet("p", 200).allowed).toBe(true);
  });

  it("déclenche un reality check après l'intervalle puis se réarme", () => {
    let t = 0;
    const rg = new ResponsibleGamingService({ limits: { realityCheckMs: 1000 }, now: () => t });
    rg.canBet("p", 10); // crée la session à t=0
    expect(rg.realityCheckDue("p")).toBe(false);
    t = 1000;
    expect(rg.realityCheckDue("p")).toBe(true);
    expect(rg.realityCheckDue("p")).toBe(false); // réarmé
  });
});
