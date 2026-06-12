/**
 * Bandeaux d'avertissement : argent fictif (permanent) et jeu responsable.
 */
import { memo } from "react";

export const FakeMoneyBanner = memo(function FakeMoneyBanner() {
  return (
    <div
      role="note"
      className="sticky top-0 z-50 border-b border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-center text-xs font-semibold text-amber-200 backdrop-blur"
    >
      🪙 Argent fictif — jeu de démonstration, aucun gain réel.
    </div>
  );
});

export const ResponsibleGamingNotice = memo(function ResponsibleGamingNotice() {
  return (
    <aside
      aria-label="Message de jeu responsable"
      className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4 text-xs leading-relaxed text-slate-400"
    >
      <h2 className="mb-1.5 text-sm font-bold text-slate-200">🛟 Jeu responsable</h2>
      <p>
        Deep Diver est une <strong>démonstration technique</strong> avec des crédits
        fictifs : rien ne peut être déposé, gagné ni perdu. Les vrais « crash
        games » sont en revanche des <strong>jeux d'argent à risque</strong> : le
        point de crash de chaque tour est tiré au hasard et il est{" "}
        <strong>impossible de prédire le prochain crash</strong> — aucune
        stratégie, série ou intuition ne change l'espérance de gain, qui est
        négative (avantage maison). Si le jeu d'argent devient un problème pour
        vous ou un proche, parlez-en : en France, appelez Joueurs Info Service
        au 09&nbsp;74&nbsp;75&nbsp;13&nbsp;13 (appel non surtaxé).
      </p>
    </aside>
  );
});
