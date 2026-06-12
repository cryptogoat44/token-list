/**
 * Panneau « Provably Fair » :
 *  - engagement du tour courant (hash du serverSeed publié avant la plongée),
 *  - clientSeed éditable (appliqué au tour suivant, nonce remis à zéro),
 *  - tours précédents avec seeds révélés,
 *  - vérificateur indépendant qui recalcule le point de crash.
 */
import { useEffect, useState } from "react";
import type { GameEngine } from "../../engine/engine";
import { verifyRound, type VerificationResult } from "../../engine/fairness";
import type { EngineSnapshot, RoundHistoryEntry } from "../../engine/types";
import { storeClientSeed } from "../useEngine";
import { formatMultiplier, shortSeed } from "../format";

interface Props {
  engine: GameEngine;
  snapshot: EngineSnapshot;
  /** Tour présélectionné (clic sur l'historique), à vérifier. */
  selectedRound: RoundHistoryEntry | null;
}

const fieldCls =
  "w-full rounded-lg border border-cyan-400/20 bg-slate-950/70 px-2.5 py-1.5 font-mono text-xs text-cyan-50 outline-none focus:border-cyan-400/60";

export function FairnessPanel({ engine, snapshot, selectedRound }: Props) {
  const [seedDraft, setSeedDraft] = useState(snapshot.round.clientSeed);
  const [seedApplied, setSeedApplied] = useState(false);

  const [vServerSeed, setVServerSeed] = useState("");
  const [vClientSeed, setVClientSeed] = useState("");
  const [vNonce, setVNonce] = useState("0");
  const [vExpectedHash, setVExpectedHash] = useState("");
  const [vExpectedCrash, setVExpectedCrash] = useState("");
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Préremplit le vérificateur quand on clique un tour dans l'historique.
  useEffect(() => {
    if (!selectedRound) return;
    setVServerSeed(selectedRound.serverSeed);
    setVClientSeed(selectedRound.clientSeed);
    setVNonce(String(selectedRound.nonce));
    setVExpectedHash(selectedRound.serverSeedHash);
    setVExpectedCrash(selectedRound.crashPoint.toFixed(2));
    setVerification(null);
  }, [selectedRound]);

  const runVerification = async () => {
    setVerifying(true);
    try {
      const result = await verifyRound({
        serverSeed: vServerSeed.trim(),
        clientSeed: vClientSeed.trim(),
        nonce: Number.parseInt(vNonce, 10) || 0,
        houseEdge: engine.config.houseEdge,
        expectedServerSeedHash: vExpectedHash.trim() || undefined,
        expectedCrashPoint: vExpectedCrash.trim()
          ? Number.parseFloat(vExpectedCrash.replace(",", "."))
          : undefined,
      });
      setVerification(result);
    } finally {
      setVerifying(false);
    }
  };

  const round = snapshot.round;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <section className="rounded-xl border border-cyan-400/10 bg-slate-950/50 p-3">
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-cyan-200/70">
          Tour en cours #{round.roundId} — engagement
        </h4>
        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">Hash du serverSeed (publié avant)</dt>
            <dd className="break-all font-mono text-cyan-100" title={round.serverSeedHash ?? ""}>
              {round.serverSeedHash ? shortSeed(round.serverSeedHash, 12, 8) : "calcul…"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">serverSeed (révélé après)</dt>
            <dd className="break-all font-mono text-cyan-100">
              {round.serverSeedRevealed ? shortSeed(round.serverSeedRevealed, 12, 8) : "🔒 caché"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">Nonce</dt>
            <dd className="font-mono text-cyan-100">{round.nonce}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">Avantage maison</dt>
            <dd className="font-mono text-cyan-100">
              {(engine.config.houseEdge * 100).toFixed(1)} % (RTP{" "}
              {(100 - engine.config.houseEdge * 100).toFixed(1)} %)
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-cyan-400/10 bg-slate-950/50 p-3">
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-cyan-200/70">
          Votre clientSeed
        </h4>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="client-seed-input">
            Seed client
          </label>
          <input
            id="client-seed-input"
            className={fieldCls}
            value={seedDraft}
            maxLength={64}
            onChange={(e) => {
              setSeedDraft(e.target.value);
              setSeedApplied(false);
            }}
          />
          <button
            type="button"
            className="shrink-0 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/30 active:scale-95"
            onClick={() => {
              const result = engine.setClientSeed(seedDraft);
              if (result.ok) {
                storeClientSeed(seedDraft.trim());
                setSeedApplied(true);
              }
            }}
          >
            Appliquer
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          {seedApplied
            ? "✓ Sera utilisé à partir du prochain tour (nonce remis à 0)."
            : "Participe au tirage : changez-le quand vous voulez, il s'applique au tour suivant."}
        </p>
      </section>

      <section className="rounded-xl border border-cyan-400/10 bg-slate-950/50 p-3">
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-cyan-200/70">
          Vérificateur de tour
        </h4>
        <div className="space-y-2">
          <label className="block text-[11px] text-slate-400">
            serverSeed révélé
            <input className={fieldCls + " mt-1"} value={vServerSeed} onChange={(e) => setVServerSeed(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-slate-400">
              clientSeed
              <input className={fieldCls + " mt-1"} value={vClientSeed} onChange={(e) => setVClientSeed(e.target.value)} />
            </label>
            <label className="block text-[11px] text-slate-400">
              nonce
              <input className={fieldCls + " mt-1"} inputMode="numeric" value={vNonce} onChange={(e) => setVNonce(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-slate-400">
              hash d'engagement (optionnel)
              <input className={fieldCls + " mt-1"} value={vExpectedHash} onChange={(e) => setVExpectedHash(e.target.value)} />
            </label>
            <label className="block text-[11px] text-slate-400">
              crash annoncé (optionnel)
              <input className={fieldCls + " mt-1"} inputMode="decimal" value={vExpectedCrash} onChange={(e) => setVExpectedCrash(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            disabled={verifying || vServerSeed.trim() === ""}
            onClick={() => void runVerification()}
            className="w-full rounded-lg bg-cyan-500 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-slate-950 transition hover:bg-cyan-400 active:scale-[0.98] disabled:opacity-40"
          >
            {verifying ? "Vérification…" : "Recalculer le point de crash"}
          </button>

          {verification && (
            <div
              role="status"
              className={`rounded-lg border p-2.5 text-xs ${
                verification.ok
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                  : "border-red-400/40 bg-red-500/10 text-red-200"
              }`}
            >
              <p className="font-bold">
                {verification.ok ? "✓ Tour vérifié — résultat conforme" : "✗ Incohérence détectée"}
              </p>
              <p className="mt-1 font-mono">
                crashPoint recalculé : {formatMultiplier(verification.crashPoint)}
              </p>
              {verification.commitMatches !== undefined && (
                <p className="font-mono">
                  engagement : {verification.commitMatches ? "conforme ✓" : "NON conforme ✗"}
                </p>
              )}
              {verification.crashPointMatches !== undefined && (
                <p className="font-mono">
                  crash annoncé : {verification.crashPointMatches ? "conforme ✓" : "NON conforme ✗"}
                </p>
              )}
              <p className="mt-1 break-all font-mono text-[10px] opacity-70">
                SHA-256(seed) = {verification.serverSeedHash}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-cyan-400/10 bg-slate-950/50 p-3">
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-cyan-200/70">
          Tours révélés
        </h4>
        {snapshot.history.length === 0 ? (
          <p className="text-xs text-slate-500">Aucun tour terminé pour le moment.</p>
        ) : (
          <ul className="max-h-44 space-y-1 overflow-y-auto pr-1 text-[11px] [scrollbar-width:thin]">
            {snapshot.history.slice(0, 15).map((h) => (
              <li key={h.roundId} className="flex items-center justify-between gap-2 rounded bg-slate-900/60 px-2 py-1">
                <span className="font-mono text-slate-400">#{h.roundId}</span>
                <span className="font-mono font-bold text-cyan-100">{formatMultiplier(h.crashPoint)}</span>
                <span className="hidden font-mono text-slate-500 sm:inline" title={h.serverSeed}>
                  {shortSeed(h.serverSeed, 6, 4)}
                </span>
                <button
                  type="button"
                  className="rounded bg-cyan-500/15 px-2 py-0.5 font-semibold text-cyan-300 transition hover:bg-cyan-500/30"
                  onClick={() => {
                    setVServerSeed(h.serverSeed);
                    setVClientSeed(h.clientSeed);
                    setVNonce(String(h.nonce));
                    setVExpectedHash(h.serverSeedHash);
                    setVExpectedCrash(h.crashPoint.toFixed(2));
                    setVerification(null);
                  }}
                >
                  Vérifier
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
