/**
 * Types du journal d'audit infalsifiable (tamper-evident).
 *
 * Chaque enregistrement est CHAÎNÉ par hash au précédent (façon registre) :
 * modifier ou retirer une ligne casse la chaîne et devient détectable. Le
 * journal est APPEND-ONLY : on n'écrit qu'à la fin, jamais de mise à jour.
 *
 * Le stockage est abstrait (`AuditStore`) : implémentations mémoire et fichier
 * JSONL ici, un adaptateur PostgreSQL pourra se brancher plus tard SANS rien
 * réécrire (même interface, mêmes hash).
 */

/** Valeur JSON sérialisable (les payloads d'audit doivent l'être). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type AuditPayload = { [k: string]: JsonValue };

/** Catégories d'événements journalisés (cycle de jeu + argent). */
export type AuditEventType =
  | "round_open"
  | "bet_accepted"
  | "bet_rejected"
  | "cashout"
  | "crash_revealed"
  | "settlement"
  | "wallet_movement";

/** Un enregistrement scellé du journal. */
export interface AuditRecord {
  /** Index monotone à partir de 0. */
  seq: number;
  /** Horodatage serveur (ms). */
  timestamp: number;
  type: AuditEventType;
  payload: AuditPayload;
  /** Hash de l'enregistrement précédent (GENESIS pour seq 0). */
  prevHash: string;
  /** SHA-256 de (seq, timestamp, type, payload, prevHash) canonicalisés. */
  hash: string;
}

export type VerifyResult =
  | { ok: true; count: number; head: string }
  | { ok: false; count: number; brokenAt: number; reason: string };

/**
 * Stockage append-only du journal. Toutes les opérations sont asynchrones pour
 * autoriser les implémentations fichier / base de données.
 */
export interface AuditStore {
  /** Ajoute un enregistrement scellé (calcule prevHash/hash). Sérialisé. */
  append(type: AuditEventType, payload: AuditPayload): Promise<AuditRecord>;
  /** Dernier enregistrement, ou null si le journal est vide. */
  head(): Promise<AuditRecord | null>;
  /** Lit une plage (bornes incluses) ; tout le journal par défaut. */
  read(opts?: { fromSeq?: number; toSeq?: number }): Promise<AuditRecord[]>;
  /** Nombre d'enregistrements. */
  count(): Promise<number>;
  /** Recalcule et vérifie toute la chaîne (depuis la source de vérité). */
  verify(): Promise<VerifyResult>;
}
