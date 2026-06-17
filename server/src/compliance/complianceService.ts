/**
 * Service de conformité : décide l'accès d'un joueur selon son pays et
 * l'opérateur, et expose le plafond de mise applicable.
 *
 * Ordre des règles :
 *  1. pays indéterminé → refus prudent ;
 *  2. juridiction explicitement interdite (ex. France) → refus, même si
 *     l'opérateur la liste ;
 *  3. pays hors périmètre de l'opérateur et `defaultAllow=false` → refus ;
 *  4. sinon autorisé, avec le plafond de mise de la juridiction sinon de
 *     l'opérateur.
 */
import { DEFAULT_JURISDICTIONS, jurisdictionRule } from "./jurisdictions";
import type { AccessDecision, AccessRequest, JurisdictionRule } from "./types";

export class ComplianceService {
  constructor(private readonly jurisdictions: Record<string, JurisdictionRule> = DEFAULT_JURISDICTIONS) {}

  evaluateAccess(req: AccessRequest): AccessDecision {
    const { country, operator } = req;
    if (!country) {
      return { allowed: false, reason: "pays indéterminé", country: null };
    }
    const code = country.toUpperCase();
    const rule = jurisdictionRule(code, this.jurisdictions);
    if (rule && !rule.allowed) {
      return { allowed: false, reason: rule.note ?? `juridiction ${code} non autorisée`, country: code };
    }
    const served = operator.jurisdictions.map((c) => c.toUpperCase()).includes(code);
    if (!served && !operator.defaultAllow) {
      return { allowed: false, reason: `opérateur ${operator.operatorId} ne sert pas ${code}`, country: code };
    }
    return {
      allowed: true,
      country: code,
      maxBetCents: rule?.maxBetCents ?? operator.defaultMaxBetCents,
      currency: rule?.currency,
    };
  }
}
