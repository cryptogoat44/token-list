/**
 * Statistiques de la session du joueur + remise à zéro du portefeuille.
 */
import { memo } from "react";
import type { SessionStats } from "../../engine/types";
import { formatCredits, formatMultiplier } from "../format";

interface Props {
  stats: SessionStats;
  balanceCents: number;
  onReset: () => void;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: "up" | "down" }) {
  return (
    <div className="rounded-xl border border-cyan-400/10 bg-slate-950/50 px-3 py-2.5">
      <dt className="text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd
        className={`mt-0.5 font-mono text-sm font-bold ${
          accent === "up" ? "text-emerald-300" : accent === "down" ? "text-red-300" : "text-cyan-100"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export const StatsPanel = memo(function StatsPanel({ stats, balanceCents, onReset }: Props) {
  const net = stats.netCents;
  return (
    <div className="flex h-full flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2">
        <StatCard label="Tours joués" value={String(stats.roundsPlayed)} />
        <StatCard label="Mises posées" value={String(stats.betsPlaced)} />
        <StatCard label="Total misé" value={formatCredits(stats.totalWageredCents)} />
        <StatCard label="Total encaissé" value={formatCredits(stats.totalReturnedCents)} />
        <StatCard
          label="Gain / perte net"
          value={`${net >= 0 ? "+" : "−"}${formatCredits(Math.abs(net))}`}
          accent={net > 0 ? "up" : net < 0 ? "down" : undefined}
        />
        <StatCard
          label="Meilleure remontée"
          value={stats.bestCashoutX > 0 ? formatMultiplier(stats.bestCashoutX) : "—"}
        />
        <StatCard
          label="Plus gros gain"
          value={stats.bestWinCents > 0 ? `+${formatCredits(stats.bestWinCents)}` : "—"}
          accent={stats.bestWinCents > 0 ? "up" : undefined}
        />
        <StatCard
          label="Série en cours"
          value={
            stats.currentStreak === 0
              ? "—"
              : stats.currentStreak > 0
                ? `${stats.currentStreak} ✓`
                : `${-stats.currentStreak} ✗`
          }
          accent={stats.currentStreak > 0 ? "up" : stats.currentStreak < 0 ? "down" : undefined}
        />
        <StatCard label="Meilleure série de gains" value={String(stats.longestWinStreak)} />
        <StatCard label="Pire série de pertes" value={String(stats.longestLossStreak)} />
      </dl>
      <div className="mt-auto rounded-xl border border-amber-400/20 bg-amber-500/5 p-3">
        <p className="text-xs text-amber-200/80">
          Solde actuel : <strong className="font-mono">{formatCredits(balanceCents)}</strong> crédits
          fictifs.
        </p>
        <button
          type="button"
          onClick={onReset}
          className="mt-2 w-full rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-amber-200 transition hover:bg-amber-500/30 active:scale-95"
        >
          Réinitialiser solde &amp; statistiques
        </button>
        <p className="mt-1.5 text-[10px] text-slate-500">
          Indisponible pendant une plongée avec mise engagée.
        </p>
      </div>
    </div>
  );
});
