/**
 * Faux flux « joueurs en direct » — décoratif uniquement (voir sim/liveBets).
 * La liste est régénérée à chaque tour ; les statuts suivent le multiplicateur.
 */
import { memo } from "react";
import type { FakeBettorView } from "../../sim/liveBets";
import { formatCredits, formatMultiplier } from "../format";

interface Props {
  bettors: FakeBettorView[];
  onlineCount: number;
}

export const LiveBets = memo(function LiveBets({ bettors, onlineCount }: Props) {
  const cashedCount = bettors.filter((b) => b.status === "cashed").length;
  const totalBet = bettors.reduce((sum, b) => sum + b.betCents, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span>
          <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" />
          {onlineCount} en ligne (simulé)
        </span>
        <span>
          {cashedCount}/{bettors.length} remontés · {formatCredits(totalBet)} misés
        </span>
      </div>
      <p className="mb-2 rounded-md bg-slate-950/60 px-2 py-1 text-[10px] text-slate-500">
        Flux purement décoratif : pseudos et mises générés localement, sans
        influence sur le tirage.
      </p>
      <ul className="flex-1 space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]" aria-label="Paris simulés en direct">
        {bettors.map((b) => (
          <li
            key={b.id}
            className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${
              b.status === "cashed"
                ? "bg-emerald-500/10 text-emerald-200"
                : b.status === "lost"
                  ? "bg-red-500/10 text-red-300/70 line-through decoration-red-400/40"
                  : "bg-slate-800/50 text-slate-300"
            }`}
          >
            <span className="w-24 truncate font-medium">{b.name}</span>
            <span className="font-mono">{formatCredits(b.betCents)}</span>
            <span className="w-24 text-right font-mono">
              {b.status === "cashed" && b.winCents !== null
                ? `${formatMultiplier(b.target)} · +${formatCredits(b.winCents)}`
                : b.status === "lost"
                  ? "syncope"
                  : "en plongée…"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
});
