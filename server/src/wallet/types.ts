/**
 * Wallet « seamless » (transfer wallet) — contrat d'intégration opérateur.
 *
 * Modèle de l'industrie : l'OPÉRATEUR licencié détient les fonds, le KYC et la
 * licence. Le RGS ne stocke aucun solde réel : à chaque transaction il APPELLE
 * l'API wallet de l'opérateur (authenticate / getBalance / debit / credit /
 * rollback). Le studio fournit le contenu, l'opérateur porte l'argent.
 *
 * Propriétés exigées par la certification :
 *  - IDEMPOTENCE : chaque opération porte un `txId` unique et déterministe ;
 *    rejouer la même opération ne double JAMAIS l'effet (réseau peu fiable).
 *  - Montants en CENTIMES entiers, devise explicite (jamais de flottant sur
 *    l'argent), devise vérifiée à chaque appel.
 *  - ROLLBACK par `txId` pour compenser une opération en cas d'échec/timeout.
 *
 * La monnaie de la démo reste FICTIVE : `MockWalletAdapter` implémente ce
 * contrat en mémoire. Un opérateur réel fournira son propre adaptateur.
 */
import type { RoundSettlement } from "../game/types";

/** Code devise (ISO 4217 côté réel ; « FUN » pour la monnaie fictive de démo). */
export type Currency = string;

export interface WalletContext {
  playerId: string;
  currency: Currency;
}

export type WalletErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "UNKNOWN_PLAYER"
  | "INVALID_AMOUNT"
  | "CURRENCY_MISMATCH"
  | "INVALID_TOKEN"
  | "TX_NOT_FOUND";

/** Requête de mouvement (débit ou crédit). `txId` = clé d'idempotence. */
export interface MovementRequest {
  txId: string;
  playerId: string;
  currency: Currency;
  /** Montant strictement positif, en centimes. */
  amountCents: number;
  /** Traçabilité (audit). */
  roundId?: number;
  betId?: string;
  reason?: string;
}

export type WalletError = { ok: false; code: WalletErrorCode; message: string };

/** Résultat d'un mouvement : solde résultant + indicateur de rejeu idempotent. */
export type WalletResult =
  | { ok: true; balanceCents: number; txId: string; duplicate: boolean }
  | WalletError;

export type BalanceResult = { ok: true; balanceCents: number; currency: Currency } | WalletError;

export type AuthResult = { ok: true; context: WalletContext } | WalletError;

/**
 * Adaptateur wallet à implémenter par l'opérateur. Le RGS ne connaît que cette
 * interface : il est agnostique au PSP/wallet réel derrière.
 */
export interface WalletAdapter {
  /** Identifie un joueur depuis un jeton opérateur (session/licence/KYC côté opérateur). */
  authenticate(token: string): Promise<AuthResult>;
  getBalance(playerId: string): Promise<BalanceResult>;
  /** Débit (mise). Échoue si fonds insuffisants. Idempotent par `txId`. */
  debit(req: MovementRequest): Promise<WalletResult>;
  /** Crédit (gain). Idempotent par `txId`. */
  credit(req: MovementRequest): Promise<WalletResult>;
  /** Annule l'effet d'un mouvement déjà appliqué. Idempotent. */
  rollback(txId: string): Promise<WalletResult>;
}

/** Compte-rendu de règlement d'un tour. */
export interface SettleReport {
  roundId: number;
  credited: { betId: string; playerId: string; amountCents: number; duplicate: boolean }[];
  errors: { betId: string; playerId: string; code: WalletErrorCode; message: string }[];
  totalCreditedCents: number;
}

export type { RoundSettlement };
