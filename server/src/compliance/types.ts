/**
 * Types de conformité : juridictions, opérateurs, décision d'accès.
 *
 * Le RGS applique un geo-gating et des limites PAR JURIDICTION et PAR OPÉRATEUR.
 * La France est **bloquée par défaut** (voir `jurisdictions.ts`). Aucune passerelle
 * vers de l'argent réel : ces règles encadrent l'accès au contenu, l'opérateur
 * licencié restant responsable du KYC, de la licence et des fonds.
 */

/** Règle d'une juridiction (code ISO-3166 alpha-2). */
export interface JurisdictionRule {
  code: string;
  /** false = juridiction interdite (bloquée même si l'opérateur la liste). */
  allowed: boolean;
  /** Plafond de mise imposé (centimes), optionnel. */
  maxBetCents?: number;
  /** Devise imposée, optionnel. */
  currency?: string;
  /** Note réglementaire. */
  note?: string;
}

export interface OperatorConfig {
  operatorId: string;
  name: string;
  /** Juridictions servies (codes ISO). */
  jurisdictions: string[];
  /** Stance si le pays n'est pas listé : false = refus prudent. */
  defaultAllow: boolean;
  /** Plafond de mise par défaut (centimes), surchargé par la juridiction. */
  defaultMaxBetCents?: number;
}

export interface AccessRequest {
  operator: OperatorConfig;
  /** Pays résolu (geo), ou null si indéterminé. */
  country: string | null;
}

export type AccessDecision =
  | { allowed: true; country: string; maxBetCents?: number; currency?: string }
  | { allowed: false; reason: string; country: string | null };
