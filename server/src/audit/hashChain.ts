/**
 * Primitives de chaînage par hash (pures, déterministes).
 *
 * Le hash d'un enregistrement scelle son contenu ET le hash précédent : la
 * chaîne entière est donc vérifiable et toute altération est détectable.
 * On réutilise le même SHA-256 que le RNG provably-fair (cohérence + zéro dép.).
 */
import { sha256Hex } from "../rng/provablyFair";
import type { AuditEventType, AuditPayload, AuditRecord, JsonValue, VerifyResult } from "./types";

/** Hash « génésis » précédant le tout premier enregistrement. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * Sérialisation CANONIQUE et stable : clés d'objet triées récursivement, pour
 * que deux objets équivalents (ordre de clés différent) produisent le même
 * hash. Indispensable à la reproductibilité de la vérification.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
  return `{${parts.join(",")}}`;
}

/** Construit un enregistrement scellé (calcule son hash). */
export function makeRecord(
  seq: number,
  prevHash: string,
  type: AuditEventType,
  payload: AuditPayload,
  timestamp: number,
): AuditRecord {
  const sealed = { seq, timestamp, type, payload, prevHash };
  const hash = sha256Hex(canonicalJson(sealed as unknown as JsonValue));
  return { ...sealed, hash };
}

/** Recalcule le hash d'un enregistrement existant (pour vérification). */
export function recomputeHash(rec: AuditRecord): string {
  const { seq, timestamp, type, payload, prevHash } = rec;
  return sha256Hex(canonicalJson({ seq, timestamp, type, payload, prevHash } as unknown as JsonValue));
}

/**
 * Vérifie une chaîne complète : seq contigus depuis 0, prevHash correct, et
 * hash recalculé identique. Renvoie le premier point de rupture le cas échéant.
 */
export function verifyChain(records: AuditRecord[]): VerifyResult {
  let prev = GENESIS_HASH;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.seq !== i) {
      return { ok: false, count: records.length, brokenAt: i, reason: `seq attendu ${i}, trouvé ${r.seq}` };
    }
    if (r.prevHash !== prev) {
      return { ok: false, count: records.length, brokenAt: i, reason: "prevHash ne suit pas la chaîne" };
    }
    if (recomputeHash(r) !== r.hash) {
      return { ok: false, count: records.length, brokenAt: i, reason: "hash ne correspond pas au contenu (altération)" };
    }
    prev = r.hash;
  }
  return { ok: true, count: records.length, head: prev };
}
