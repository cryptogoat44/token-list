/**
 * Vue « mode serveur » : afficheur mince branché sur le Remote Game Server.
 *
 * Le serveur est la SEULE source de vérité (multiplicateur, phases, équité).
 * Ce composant n'affiche que ce que le serveur diffuse et n'envoie que des
 * INTENTIONS (miser / encaisser). Aucune logique de jeu ni d'argent ici.
 *
 * N'est rendu QUE si `VITE_RGS_URL` est défini (sinon : démo locale habituelle).
 * À ce stade, le protocole serveur expose un panier de mise unique par tour
 * (les paniers multiples / auto cash out arriveront avec l'extension du
 * protocole). C'est volontairement plus sobre que la démo, mais 100 % autoritaire.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { RoundPhase } from "@shared/protocol";
import { getRgsUrl } from "../net/config";
import { useRgsGame } from "./useRgsGame";
import {
  crashColorClass,
  formatCredits,
  formatMultiplier,
  multiplierColor,
  shortSeed,
} from "./format";

const PHASE_LABEL: Record<RoundPhase, string> = {
  BETTING: "Fenêtre de mise",
  RUNNING: "Plongée en cours",
  CRASH: "Syncope",
  SETTLEMENT: "Résultats",
};

const STATUS_LABEL: Record<string, string> = {
  idle: "Inactif",
  connecting: "Connexion…",
  open: "Connecté",
  reconnecting: "Reconnexion…",
  closed: "Déconnecté",
};

type MyBetStatus = "pending" | "placed" | "cashed" | "lost" | "rejected";
interface MyBet {
  betId: string;
  amountCents: number;
  status: MyBetStatus;
  multiplier?: number;
  payoutCents?: number;
}

const QUICK_CREDITS = [1, 5, 10, 50];

/** Identité de joueur stable (pseudo de transport, pas un compte). */
function stablePlayerId(): string {
  const key = "deepdiver.serverPlayer";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = `plongeur-${Math.random().toString(36).slice(2, 7)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `plongeur-${Math.random().toString(36).slice(2, 7)}`;
  }
}

export default function ServerModeApp() {
  const url = getRgsUrl()!;
  const player = useMemo(stablePlayerId, []);
  const { snapshot, placeBet, cashout, onAck, onCrash, serverNow } = useRgsGame(url, player);
  const { status, state, lastReveal } = snapshot;

  const [betCredits, setBetCredits] = useState(1);
  const [myBet, setMyBet] = useState<MyBet | null>(null);
  const myBetRef = useRef<MyBet | null>(null);
  myBetRef.current = myBet;

  // Accusés de réception serveur (mise / encaissement).
  useEffect(() => {
    const offAck = onAck((a) => {
      setMyBet((prev) => {
        if (!prev || prev.betId !== a.betId) return prev;
        if (a.kind === "bet") {
          return { ...prev, status: a.ok ? "placed" : "rejected" };
        }
        if (a.ok) {
          return { ...prev, status: "cashed", multiplier: a.multiplier, payoutCents: a.payoutCents };
        }
        return prev;
      });
    });
    const offCrash = onCrash(() => {
      setMyBet((prev) => (prev && prev.status === "placed" ? { ...prev, status: "lost" } : prev));
    });
    return () => {
      offAck();
      offCrash();
    };
  }, [onAck, onCrash]);

  // Nouveau tour → on remet à zéro le panier local.
  const roundId = state?.roundId ?? null;
  useEffect(() => {
    setMyBet(null);
  }, [roundId]);

  const phase = state?.phase ?? "BETTING";
  const connected = status === "open";
  const canBet = connected && phase === "BETTING" && !myBet;
  const canCashout =
    connected && phase === "RUNNING" && myBet?.status === "placed";

  const bettingRemainingMs =
    state && phase === "BETTING" ? Math.max(0, state.bettingEndsAt - serverNow()) : 0;

  function doPlaceBet() {
    const cents = Math.round(betCredits * 100);
    if (cents <= 0) return;
    const betId = placeBet(cents);
    if (betId) setMyBet({ betId, amountCents: cents, status: "pending" });
  }
  function doCashout() {
    if (myBet) cashout(myBet.betId);
  }

  const mult = state?.multiplier ?? 1;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-6">
      <header className="w-full max-w-3xl flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold tracking-wide text-cyan-300">
          Deep Diver <span className="text-slate-400 font-normal">· mode serveur</span>
        </h1>
        <span
          className={`text-xs px-2 py-1 rounded-full ring-1 ${
            connected
              ? "text-emerald-300 bg-emerald-500/10 ring-emerald-400/30"
              : "text-amber-300 bg-amber-500/10 ring-amber-400/30"
          }`}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </header>

      <p className="w-full max-w-3xl mt-2 text-[11px] text-slate-400">
        Monnaie fictive. Le serveur est la seule source de vérité : le
        multiplicateur, l'instant d'encaissement et l'équité sont arbitrés côté
        serveur, jamais par votre navigateur.
      </p>

      {/* Multiplicateur central */}
      <section className="w-full max-w-3xl mt-6 rounded-2xl bg-slate-900/60 ring-1 ring-slate-700/50 p-8 flex flex-col items-center">
        <div className="text-xs uppercase tracking-widest text-slate-400">
          {PHASE_LABEL[phase]}
        </div>
        <div
          className="text-6xl font-black tabular-nums mt-2"
          style={{ color: phase === "CRASH" ? "#fb7185" : multiplierColor(mult) }}
        >
          {formatMultiplier(mult)}
        </div>
        {phase === "BETTING" && (
          <div className="mt-2 text-sm text-slate-400">
            Mises ouvertes — {(bettingRemainingMs / 1000).toFixed(1)} s
          </div>
        )}
        {state && (
          <div className="mt-3 text-xs text-slate-500">
            Tour #{state.roundId} · {state.betCount} plongeur(s) ·{" "}
            {formatCredits(state.totalStakedCents)} crédits engagés
          </div>
        )}
      </section>

      {/* Panier de mise */}
      <section className="w-full max-w-3xl mt-4 rounded-2xl bg-slate-900/60 ring-1 ring-slate-700/50 p-5">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm text-slate-300">Mise (crédits)</label>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={betCredits}
            onChange={(e) => setBetCredits(Math.max(0, Number(e.target.value) || 0))}
            className="w-28 bg-slate-800 rounded-lg px-3 py-1.5 text-right tabular-nums ring-1 ring-slate-700 focus:outline-none focus:ring-cyan-400"
          />
          {QUICK_CREDITS.map((c) => (
            <button
              key={c}
              onClick={() => setBetCredits(c)}
              className="text-xs px-2 py-1 rounded-lg bg-slate-800 ring-1 ring-slate-700 hover:ring-cyan-400"
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {canCashout ? (
            <button
              onClick={doCashout}
              className="w-full py-3 rounded-xl font-bold bg-amber-400 text-slate-900 hover:bg-amber-300 transition"
            >
              Remonter — encaisser {formatMultiplier(mult)}
            </button>
          ) : (
            <button
              onClick={doPlaceBet}
              disabled={!canBet}
              className="w-full py-3 rounded-xl font-bold bg-cyan-500 text-slate-950 enabled:hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {myBet ? "Mise enregistrée" : "Plonger"}
            </button>
          )}
        </div>

        {myBet && (
          <div className="mt-3 text-sm">
            {myBet.status === "pending" && <span className="text-slate-400">Envoi de la mise…</span>}
            {myBet.status === "placed" && (
              <span className="text-cyan-300">
                Mise de {formatCredits(myBet.amountCents)} engagée — prêt à remonter.
              </span>
            )}
            {myBet.status === "cashed" && (
              <span className="text-emerald-300">
                Remontée à {formatMultiplier(myBet.multiplier ?? 1)} —{" "}
                +{formatCredits(myBet.payoutCents ?? 0)} crédits.
              </span>
            )}
            {myBet.status === "lost" && (
              <span className="text-rose-300">Syncope — mise perdue.</span>
            )}
            {myBet.status === "rejected" && (
              <span className="text-amber-300">Mise refusée par le serveur.</span>
            )}
          </div>
        )}
      </section>

      {/* Équité : engagement + révélation */}
      <section className="w-full max-w-3xl mt-4 rounded-2xl bg-slate-900/60 ring-1 ring-slate-700/50 p-5 text-xs">
        <div className="font-semibold text-slate-300 mb-2">Équité (provably fair)</div>
        <div className="text-slate-400">
          Engagement (hash de graine) :{" "}
          <code className="text-slate-200">
            {state ? shortSeed(state.serverSeedHash) : "—"}
          </code>
        </div>
        {lastReveal && (
          <div className="mt-2 flex items-center gap-2 flex-wrap text-slate-400">
            <span>Dernier crash #{lastReveal.roundId} :</span>
            <span className={`px-2 py-0.5 rounded ring-1 ${crashColorClass(lastReveal.crashPoint)}`}>
              {formatMultiplier(lastReveal.crashPoint)}
            </span>
            <span>
              graine révélée <code className="text-slate-200">{shortSeed(lastReveal.serverSeed)}</code>
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
