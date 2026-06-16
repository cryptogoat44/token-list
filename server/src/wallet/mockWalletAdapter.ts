/**
 * Adaptateur wallet EN MÉMOIRE (monnaie fictive) — pour la démo et les tests.
 *
 * Implémente fidèlement le contrat « seamless » : idempotence par `txId`,
 * rollback compensatoire, devise vérifiée, montants entiers. Aucun argent réel.
 * Un opérateur licencié remplacera cet adaptateur par le sien (même interface).
 */
import type {
  AuthResult,
  BalanceResult,
  Currency,
  MovementRequest,
  WalletAdapter,
  WalletResult,
} from "./types";

interface Account {
  balanceCents: number;
  currency: Currency;
}

interface AppliedTx {
  kind: "debit" | "credit";
  playerId: string;
  amountCents: number;
  /** Solde du compte juste après l'application (renvoyé en cas de rejeu). */
  balanceAfter: number;
}

export interface MockAccountSeed {
  playerId: string;
  balanceCents: number;
  currency?: Currency;
  /** Jeton(s) d'authentification associés à ce joueur. */
  tokens?: string[];
}

export interface MockWalletOptions {
  accounts?: MockAccountSeed[];
  defaultCurrency?: Currency;
}

export class MockWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, Account>();
  private readonly tokens = new Map<string, string>(); // token → playerId
  private readonly applied = new Map<string, AppliedTx>(); // txId → mouvement
  private readonly rolledBack = new Set<string>();
  private readonly defaultCurrency: Currency;

  constructor(opts: MockWalletOptions = {}) {
    this.defaultCurrency = opts.defaultCurrency ?? "FUN";
    for (const seed of opts.accounts ?? []) {
      this.accounts.set(seed.playerId, {
        balanceCents: seed.balanceCents,
        currency: seed.currency ?? this.defaultCurrency,
      });
      for (const tok of seed.tokens ?? []) this.tokens.set(tok, seed.playerId);
    }
  }

  /** Crée/replace un compte (utilitaire de test/démo). */
  setAccount(playerId: string, balanceCents: number, currency?: Currency, tokens: string[] = []): void {
    this.accounts.set(playerId, { balanceCents, currency: currency ?? this.defaultCurrency });
    for (const tok of tokens) this.tokens.set(tok, playerId);
  }

  async authenticate(token: string): Promise<AuthResult> {
    const playerId = this.tokens.get(token);
    if (!playerId) return { ok: false, code: "INVALID_TOKEN", message: "jeton inconnu" };
    const acc = this.accounts.get(playerId);
    if (!acc) return { ok: false, code: "UNKNOWN_PLAYER", message: "compte introuvable" };
    return { ok: true, context: { playerId, currency: acc.currency } };
  }

  async getBalance(playerId: string): Promise<BalanceResult> {
    const acc = this.accounts.get(playerId);
    if (!acc) return { ok: false, code: "UNKNOWN_PLAYER", message: "compte introuvable" };
    return { ok: true, balanceCents: acc.balanceCents, currency: acc.currency };
  }

  async debit(req: MovementRequest): Promise<WalletResult> {
    return this.move(req, "debit");
  }

  async credit(req: MovementRequest): Promise<WalletResult> {
    return this.move(req, "credit");
  }

  private move(req: MovementRequest, kind: "debit" | "credit"): WalletResult {
    if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) {
      return { ok: false, code: "INVALID_AMOUNT", message: "montant invalide" };
    }
    // Idempotence : un txId déjà appliqué renvoie le même résultat sans rejouer.
    const prior = this.applied.get(req.txId);
    if (prior) {
      return { ok: true, balanceCents: prior.balanceAfter, txId: req.txId, duplicate: true };
    }
    const acc = this.accounts.get(req.playerId);
    if (!acc) return { ok: false, code: "UNKNOWN_PLAYER", message: "compte introuvable" };
    if (req.currency !== acc.currency) {
      return { ok: false, code: "CURRENCY_MISMATCH", message: `devise ${req.currency} ≠ ${acc.currency}` };
    }
    if (kind === "debit" && acc.balanceCents < req.amountCents) {
      return { ok: false, code: "INSUFFICIENT_FUNDS", message: "fonds insuffisants" };
    }
    acc.balanceCents += kind === "debit" ? -req.amountCents : req.amountCents;
    this.applied.set(req.txId, {
      kind,
      playerId: req.playerId,
      amountCents: req.amountCents,
      balanceAfter: acc.balanceCents,
    });
    return { ok: true, balanceCents: acc.balanceCents, txId: req.txId, duplicate: false };
  }

  async rollback(txId: string): Promise<WalletResult> {
    const acc0Balance = (pid: string) => this.accounts.get(pid)?.balanceCents ?? 0;
    // Double rollback : idempotent.
    if (this.rolledBack.has(txId)) {
      const tx = this.applied.get(txId);
      return { ok: true, balanceCents: tx ? acc0Balance(tx.playerId) : 0, txId, duplicate: true };
    }
    const tx = this.applied.get(txId);
    if (!tx) return { ok: false, code: "TX_NOT_FOUND", message: "transaction inconnue" };
    const acc = this.accounts.get(tx.playerId);
    if (!acc) return { ok: false, code: "UNKNOWN_PLAYER", message: "compte introuvable" };
    // Compensation : on inverse le sens du mouvement initial.
    acc.balanceCents += tx.kind === "debit" ? tx.amountCents : -tx.amountCents;
    this.rolledBack.add(txId);
    return { ok: true, balanceCents: acc.balanceCents, txId, duplicate: false };
  }
}
