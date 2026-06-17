/**
 * Rejouabilité du journal d'audit — preuve d'intégrité « métier ».
 *
 * Au-delà de la chaîne de hash (intégrité structurelle), on RE-DÉRIVE chaque
 * tour à partir des graines enregistrées via le même vérificateur provably-fair
 * que le client, et on recontrôle l'arithmétique de règlement. Un auditeur peut
 * ainsi rejouer tout l'historique et confirmer qu'aucun résultat n'a été truqué.
 */
import { verifyRound } from "../rng/provablyFair";
import type { AuditRecord } from "./types";

export interface ReplayFailure {
  seq: number;
  roundId: number;
  reason: string;
}

export interface ReplayResult {
  ok: boolean;
  /** Tours dont l'équité a été re-vérifiée. */
  fairnessChecked: number;
  /** Règlements dont l'arithmétique a été re-vérifiée. */
  settlementsChecked: number;
  failures: ReplayFailure[];
}

/**
 * Rejoue le journal : équité (graine → point de crash) + cohérence des
 * règlements (total payé = somme des crédits ; crashPoint = celui révélé).
 */
export function replayAudit(records: AuditRecord[]): ReplayResult {
  const failures: ReplayFailure[] = [];
  const crashByRound = new Map<number, number>(); // roundId → crashPoint révélé
  let fairnessChecked = 0;
  let settlementsChecked = 0;

  for (const r of records) {
    if (r.type === "crash_revealed") {
      fairnessChecked++;
      const p = r.payload;
      const roundId = Number(p.roundId);
      const crashPoint = Number(p.crashPoint);
      crashByRound.set(roundId, crashPoint);
      const res = verifyRound({
        serverSeed: String(p.serverSeed),
        clientSeed: String(p.clientSeed),
        nonce: Number(p.nonce),
        houseEdge: Number(p.houseEdge),
        maxMultiplier: Number(p.maxMultiplier),
        expectedServerSeedHash: String(p.serverSeedHash),
        expectedCrashPoint: crashPoint,
      });
      if (!res.ok) {
        const reason =
          res.commitMatches === false
            ? "engagement (SHA-256 de la graine) ne correspond pas"
            : "point de crash re-dérivé ≠ point de crash enregistré";
        failures.push({ seq: r.seq, roundId, reason });
      }
    } else if (r.type === "settlement") {
      settlementsChecked++;
      const p = r.payload;
      const roundId = Number(p.roundId);
      const declaredPaid = Number(p.totalPaidCents);
      const instructions = Array.isArray(p.instructions) ? p.instructions : [];
      let summedPaid = 0;
      for (const raw of instructions) {
        const inst = raw as { type?: unknown; amountCents?: unknown };
        if (inst.type === "credit") summedPaid += Number(inst.amountCents);
      }
      if (summedPaid !== declaredPaid) {
        failures.push({
          seq: r.seq,
          roundId,
          reason: `total payé déclaré ${declaredPaid} ≠ somme des crédits ${summedPaid}`,
        });
      }
      const revealed = crashByRound.get(roundId);
      if (revealed !== undefined && Math.abs(revealed - Number(p.crashPoint)) > 1e-9) {
        failures.push({ seq: r.seq, roundId, reason: "crashPoint du règlement ≠ crashPoint révélé" });
      }
    }
  }

  return {
    ok: failures.length === 0,
    fairnessChecked,
    settlementsChecked,
    failures,
  };
}
