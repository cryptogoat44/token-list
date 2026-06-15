/**
 * Bandeau des derniers multiplicateurs, codés par couleur :
 * rouge < 1.2x, bleu < 2x, vert < 10x, violet ≥ 10x.
 * Cliquer un chip ouvre le panneau d'équité prérempli pour vérification.
 */
import { memo } from "react";
import type { RoundHistoryEntry } from "../../engine/types";
import { crashColorClass, formatMultiplier } from "../format";

interface Props {
  history: RoundHistoryEntry[];
  onSelectRound: (round: RoundHistoryEntry) => void;
}

export const HistoryBar = memo(function HistoryBar({ history, onSelectRound }: Props) {
  if (history.length === 0) {
    return (
      <p className="px-1 text-xs text-slate-500">
        L'historique des plongées apparaîtra ici après le premier tour.
      </p>
    );
  }
  return (
    <ul
      aria-label="Historique des derniers multiplicateurs"
      className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]"
    >
      {history.slice(0, 30).map((entry) => (
        <li key={entry.roundId} className="shrink-0">
          <button
            type="button"
            onClick={() => onSelectRound(entry)}
            title={`Tour #${entry.roundId} — cliquer pour vérifier l'équité`}
            className={`rounded-full px-2.5 py-1 font-mono text-xs font-semibold ring-1 transition hover:brightness-125 active:scale-95 ${crashColorClass(entry.crashPoint)}`}
          >
            {formatMultiplier(entry.crashPoint)}
          </button>
        </li>
      ))}
    </ul>
  );
});
