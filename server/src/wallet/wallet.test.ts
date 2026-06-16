import { describe, expect, it } from "vitest";
import { MockWalletAdapter } from "./mockWalletAdapter";
import { WalletService } from "./walletService";
import type { RoundSettlement, WalletContext } from "./types";

function freshAdapter() {
  return new MockWalletAdapter({
    defaultCurrency: "FUN",
    accounts: [
      { playerId: "alice", balanceCents: 10_000, tokens: ["tok-alice"] },
      { playerId: "bob", balanceCents: 500, tokens: ["tok-bob"] },
    ],
  });
}

describe("MockWalletAdapter", () => {
  it("authentifie un jeton valide et rejette un jeton inconnu", async () => {
    const w = freshAdapter();
    const ok = await w.authenticate("tok-alice");
    expect(ok).toEqual({ ok: true, context: { playerId: "alice", currency: "FUN" } });
    const ko = await w.authenticate("tok-?");
    expect(ko.ok).toBe(false);
    if (!ko.ok) expect(ko.code).toBe("INVALID_TOKEN");
  });

  it("débite, renvoie le solde, et reste idempotent sur le même txId", async () => {
    const w = freshAdapter();
    const r1 = await w.debit({ txId: "t1", playerId: "alice", currency: "FUN", amountCents: 3000 });
    expect(r1).toMatchObject({ ok: true, balanceCents: 7000, duplicate: false });

    // Rejeu du même txId : aucun double débit.
    const r2 = await w.debit({ txId: "t1", playerId: "alice", currency: "FUN", amountCents: 3000 });
    expect(r2).toMatchObject({ ok: true, balanceCents: 7000, duplicate: true });

    const bal = await w.getBalance("alice");
    expect(bal).toMatchObject({ ok: true, balanceCents: 7000 });
  });

  it("refuse fonds insuffisants, montant invalide, devise et joueur inconnus", async () => {
    const w = freshAdapter();
    expect(await w.debit({ txId: "a", playerId: "bob", currency: "FUN", amountCents: 600 })).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_FUNDS",
    });
    expect(await w.debit({ txId: "b", playerId: "alice", currency: "FUN", amountCents: 0 })).toMatchObject({
      ok: false,
      code: "INVALID_AMOUNT",
    });
    expect(await w.debit({ txId: "c", playerId: "alice", currency: "FUN", amountCents: 12.5 })).toMatchObject({
      ok: false,
      code: "INVALID_AMOUNT",
    });
    expect(await w.debit({ txId: "d", playerId: "alice", currency: "USD", amountCents: 100 })).toMatchObject({
      ok: false,
      code: "CURRENCY_MISMATCH",
    });
    expect(await w.debit({ txId: "e", playerId: "ghost", currency: "FUN", amountCents: 100 })).toMatchObject({
      ok: false,
      code: "UNKNOWN_PLAYER",
    });
  });

  it("crédite et annule (rollback) de façon compensatoire et idempotente", async () => {
    const w = freshAdapter();
    const c = await w.credit({ txId: "win-1", playerId: "alice", currency: "FUN", amountCents: 2500 });
    expect(c).toMatchObject({ ok: true, balanceCents: 12_500, duplicate: false });

    // Rollback du crédit → retire les 2500.
    const rb = await w.rollback("win-1");
    expect(rb).toMatchObject({ ok: true, balanceCents: 10_000, duplicate: false });

    // Double rollback : idempotent (pas de nouvelle compensation).
    const rb2 = await w.rollback("win-1");
    expect(rb2).toMatchObject({ ok: true, balanceCents: 10_000, duplicate: true });

    // Rollback d'un txId inconnu.
    expect(await w.rollback("nope")).toMatchObject({ ok: false, code: "TX_NOT_FOUND" });
  });

  it("rollback d'un débit recrédite la mise", async () => {
    const w = freshAdapter();
    await w.debit({ txId: "stake-1", playerId: "alice", currency: "FUN", amountCents: 4000 });
    expect(await w.getBalance("alice")).toMatchObject({ balanceCents: 6000 });
    const rb = await w.rollback("stake-1");
    expect(rb).toMatchObject({ ok: true, balanceCents: 10_000 });
  });
});

describe("WalletService", () => {
  const contexts = new Map<string, WalletContext>([
    ["alice", { playerId: "alice", currency: "FUN" }],
    ["bob", { playerId: "bob", currency: "FUN" }],
  ]);

  function settlement(): RoundSettlement {
    return {
      roundId: 42,
      crashPoint: 2.5,
      totalStakedCents: 3000,
      totalPaidCents: 2500,
      instructions: [
        { type: "credit", playerId: "alice", betId: "A", amountCents: 2500 },
        { type: "lost", playerId: "bob", betId: "B", amountCents: 500 },
      ],
    };
  }

  it("débite une mise avec un txId déterministe et idempotent", async () => {
    const w = freshAdapter();
    const svc = new WalletService(w);
    const ctx = contexts.get("alice")!;
    const r1 = await svc.debitStake(ctx, 42, "A", 1000);
    expect(r1).toMatchObject({ ok: true, balanceCents: 9000, txId: "r42:bA:stake", duplicate: false });
    const r2 = await svc.debitStake(ctx, 42, "A", 1000);
    expect(r2).toMatchObject({ ok: true, duplicate: true, balanceCents: 9000 });
  });

  it("règle un tour : crédite les gagnants, ignore les perdants, et reste idempotent", async () => {
    const w = freshAdapter();
    const svc = new WalletService(w);

    const rep1 = await svc.settle(settlement(), contexts);
    expect(rep1.credited).toEqual([{ betId: "A", playerId: "alice", amountCents: 2500, duplicate: false }]);
    expect(rep1.errors).toHaveLength(0);
    expect(rep1.totalCreditedCents).toBe(2500);
    expect(await w.getBalance("alice")).toMatchObject({ balanceCents: 12_500 });
    // bob (perdant) n'est pas touché par le règlement (débit fait au pari).
    expect(await w.getBalance("bob")).toMatchObject({ balanceCents: 500 });

    // Rejeu du règlement : aucun double crédit.
    const rep2 = await svc.settle(settlement(), contexts);
    expect(rep2.credited[0]).toMatchObject({ duplicate: true });
    expect(rep2.totalCreditedCents).toBe(0);
    expect(await w.getBalance("alice")).toMatchObject({ balanceCents: 12_500 });
  });

  it("signale un contexte wallet manquant sans crasher", async () => {
    const w = freshAdapter();
    const svc = new WalletService(w);
    const rep = await svc.settle(settlement(), new Map()); // aucun contexte
    expect(rep.credited).toHaveLength(0);
    expect(rep.errors[0]).toMatchObject({ betId: "A", code: "UNKNOWN_PLAYER" });
  });

  it("rollbackStake recrédite une mise débitée", async () => {
    const w = freshAdapter();
    const svc = new WalletService(w);
    await svc.debitStake(contexts.get("alice")!, 7, "Z", 2000);
    expect(await w.getBalance("alice")).toMatchObject({ balanceCents: 8000 });
    const rb = await svc.rollbackStake(7, "Z");
    expect(rb).toMatchObject({ ok: true, balanceCents: 10_000 });
  });
});
