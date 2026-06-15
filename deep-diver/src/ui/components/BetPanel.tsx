/**
 * Panneau de mise d'un panier (le jeu en affiche deux, indépendants).
 * Gère : montant + boutons rapides, bouton principal contextuel
 * (Miser / Annuler / Remonter), auto cash out et pari automatique.
 */
import { useState } from "react";
import type { GameEngine } from "../../engine/engine";
import type { EngineSnapshot, SlotState } from "../../engine/types";
import { clampBet } from "../../engine/wallet";
import { reachProbabilityPct, type CashoutPreset } from "../../engine/presets";
import { formatCredits, formatMultiplier } from "../format";

interface Props {
  engine: GameEngine;
  snapshot: EngineSnapshot;
  slot: 0 | 1;
  betCents: number;
  onBetCentsChange: (cents: number) => void;
  /** Appelé sur toute interaction (déverrouille l'audio). */
  onInteract: () => void;
  /** Horloge du moteur (murale en lobby partagé). */
  clock: () => number;
  /** Présets d'auto cash-out (avec proba honnête). */
  presets: CashoutPreset[];
  /** Sauvegarde la cible courante comme préset. */
  onSavePreset: (name: string, multiplier: number) => void;
}

const REASON_LABELS: Record<string, string> = {
  bettingClosed: "Les paris sont fermés pendant la plongée.",
  alreadyPlaced: "Mise déjà posée sur ce panier.",
  insufficient: "Solde insuffisant.",
  belowMin: "Mise sous le minimum (1 crédit).",
  aboveMax: "Mise au-dessus du maximum (500 crédits).",
  invalidAmount: "Montant invalide.",
  invalidRounds: "Nombre de tours invalide.",
  invalidTarget: "Cible d'auto-remontée invalide (min 1.01).",
  notDiving: "Aucune plongée en cours.",
  noActiveBet: "Aucune mise engagée.",
  noBet: "Aucune mise à annuler.",
};

export function BetPanel({
  engine,
  snapshot,
  slot,
  betCents,
  onBetCentsChange,
  onInteract,
  clock,
  presets,
  onSavePreset,
}: Props) {
  const slotState: SlotState = snapshot.slots[slot];
  const [error, setError] = useState<string | null>(null);
  const [autoCashoutOn, setAutoCashoutOn] = useState(false);
  const [autoCashoutX, setAutoCashoutX] = useState("2.00");
  const [autoBetRounds, setAutoBetRounds] = useState("10");
  const [autoBetStopBelow, setAutoBetStopBelow] = useState("");
  const [autoBetStopOnLoss, setAutoBetStopOnLoss] = useState(false);

  const cfg = engine.config;
  const phase = snapshot.phase;

  const report = (result: { ok: boolean; reason?: string }) => {
    setError(result.ok ? null : (REASON_LABELS[result.reason ?? ""] ?? "Action impossible."));
  };

  const setBet = (cents: number) => {
    onBetCentsChange(clampBet(cents, Math.max(cfg.minBetCents, snapshot.balanceCents), cfg));
    setError(null);
  };

  const applyAutoCashout = (on: boolean, value: string) => {
    const target = Number.parseFloat(value.replace(",", "."));
    if (on && Number.isFinite(target)) {
      report(engine.setAutoCashout(slot, target));
    } else {
      engine.setAutoCashout(slot, null);
    }
  };

  // ── Bouton principal contextuel ───────────────────────────────────────────
  const liveWinCents = slotState.betCents
    ? Math.round(slotState.betCents * snapshot.multiplier)
    : 0;

  let mainButton: { label: string; sub?: string; className: string; disabled: boolean; action: () => void };
  if (phase === "BETTING" && slotState.status === "idle") {
    mainButton = {
      label: "Plonger",
      sub: `miser ${formatCredits(betCents)}`,
      className:
        "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-[0_0_25px_-5px_rgba(34,211,238,0.8)]",
      disabled: false,
      action: () => report(engine.placeBet(slot, betCents)),
    };
  } else if (phase === "BETTING" && slotState.status === "placed") {
    mainButton = {
      label: "Annuler",
      sub: `mise ${formatCredits(slotState.betCents ?? 0)} posée`,
      className: "bg-slate-700 hover:bg-slate-600 text-slate-100",
      disabled: false,
      action: () => report(engine.cancelBet(slot)),
    };
  } else if (phase === "DIVING" && slotState.status === "playing") {
    mainButton = {
      label: `Remonter ${formatCredits(liveWinCents)}`,
      sub: `à ${formatMultiplier(snapshot.multiplier)}`,
      className:
        "bg-emerald-500 hover:bg-emerald-400 text-slate-950 animate-pulse shadow-[0_0_30px_-5px_rgba(52,211,153,0.9)]",
      disabled: false,
      action: () => report(engine.cashOut(slot, clock())),
    };
  } else if (slotState.status === "cashed") {
    mainButton = {
      label: `Remonté +${formatCredits(slotState.winCents ?? 0)}`,
      sub: `à ${formatMultiplier(slotState.cashedOutAt ?? 1)}`,
      className: "bg-emerald-900/60 text-emerald-300 border border-emerald-500/40",
      disabled: true,
      action: () => {},
    };
  } else if (slotState.status === "lost") {
    mainButton = {
      label: `Syncope −${formatCredits(slotState.betCents ?? 0)}`,
      sub: "mise perdue",
      className: "bg-red-950/60 text-red-300 border border-red-500/40",
      disabled: true,
      action: () => {},
    };
  } else if (slotState.status === "placed" || slotState.status === "playing") {
    mainButton = {
      label: "En plongée…",
      className: "bg-slate-800 text-slate-300",
      disabled: true,
      action: () => {},
    };
  } else {
    mainButton = {
      label: "Prochain tour…",
      sub: "paris bientôt ouverts",
      className: "bg-slate-800 text-slate-400",
      disabled: true,
      action: () => {},
    };
  }

  // ── Pari automatique ──────────────────────────────────────────────────────
  const autoBetActive = slotState.autoBet !== null;
  const toggleAutoBet = () => {
    onInteract();
    if (autoBetActive) {
      engine.stopAutoBet(slot);
      return;
    }
    const rounds = Number.parseInt(autoBetRounds, 10);
    const stopBelow = Number.parseFloat(autoBetStopBelow.replace(",", "."));
    report(
      engine.startAutoBet(slot, {
        betCents,
        roundsRemaining: Number.isFinite(rounds) ? rounds : 0,
        stopIfBalanceBelowCents: Number.isFinite(stopBelow)
          ? Math.round(stopBelow * 100)
          : null,
        stopOnLoss: autoBetStopOnLoss,
      }),
    );
  };

  const inputCls =
    "w-full rounded-lg border border-cyan-400/20 bg-slate-900/80 px-3 py-2 font-mono text-sm text-cyan-50 outline-none focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40 disabled:opacity-40";
  const quickCls =
    "rounded-md border border-cyan-400/15 bg-slate-800/80 px-2 py-1 text-xs font-semibold text-cyan-100/90 transition hover:border-cyan-400/40 hover:bg-slate-700/80 active:scale-95 disabled:opacity-40";

  const bettingOpen = phase === "BETTING" && slotState.status === "idle";

  return (
    <section
      aria-label={`Panier de mise ${slot + 1}`}
      className="flex flex-col gap-3 rounded-2xl border border-cyan-400/10 bg-slate-900/60 p-4 backdrop-blur"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-200/80">
          Panier {slot + 1}
        </h3>
        <span className="text-[11px] text-slate-400">
          {slot === 0 ? "raccourci : Espace ou 1" : "raccourci : 2"}
        </span>
      </header>

      {/* Montant de la mise */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={quickCls}
          aria-label="Diminuer la mise"
          disabled={!bettingOpen}
          onClick={() => {
            onInteract();
            setBet(betCents - cfg.minBetCents);
          }}
        >
          −
        </button>
        <label className="sr-only" htmlFor={`bet-input-${slot}`}>
          Montant de la mise du panier {slot + 1} en crédits
        </label>
        <input
          id={`bet-input-${slot}`}
          className={inputCls + " text-center"}
          inputMode="decimal"
          value={(betCents / 100).toString()}
          disabled={!bettingOpen}
          onChange={(e) => {
            const v = Number.parseFloat(e.target.value.replace(",", "."));
            if (Number.isFinite(v)) setBet(Math.round(v * 100));
          }}
        />
        <button
          type="button"
          className={quickCls}
          aria-label="Augmenter la mise"
          disabled={!bettingOpen}
          onClick={() => {
            onInteract();
            setBet(betCents + cfg.minBetCents);
          }}
        >
          +
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <button type="button" className={quickCls} disabled={!bettingOpen} onClick={() => setBet(Math.round(betCents / 2))}>
          ½
        </button>
        <button type="button" className={quickCls} disabled={!bettingOpen} onClick={() => setBet(betCents * 2)}>
          ×2
        </button>
        <button type="button" className={quickCls} disabled={!bettingOpen} onClick={() => setBet(cfg.minBetCents)}>
          Min
        </button>
        <button
          type="button"
          className={quickCls}
          disabled={!bettingOpen}
          onClick={() => setBet(Math.min(cfg.maxBetCents, snapshot.balanceCents))}
        >
          Max
        </button>
      </div>

      {/* Bouton principal */}
      <button
        type="button"
        className={`flex min-h-16 flex-col items-center justify-center rounded-xl px-4 py-2 text-lg font-extrabold uppercase tracking-wide transition active:scale-[0.98] ${mainButton.className}`}
        disabled={mainButton.disabled}
        aria-label={`${mainButton.label} — panier ${slot + 1}`}
        onClick={() => {
          onInteract();
          mainButton.action();
        }}
      >
        <span>{mainButton.label}</span>
        {mainButton.sub && (
          <span className="text-xs font-medium normal-case opacity-80">{mainButton.sub}</span>
        )}
      </button>

      {error && (
        <p role="alert" className="text-xs font-medium text-amber-300">
          {error}
        </p>
      )}

      {/* Auto cash out + présets honnêtes (proba réelle affichée) */}
      <div className="rounded-lg border border-cyan-400/10 bg-slate-950/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            id={`auto-cashout-${slot}`}
            type="checkbox"
            className="h-4 w-4 accent-cyan-400"
            checked={autoCashoutOn}
            onChange={(e) => {
              onInteract();
              setAutoCashoutOn(e.target.checked);
              applyAutoCashout(e.target.checked, autoCashoutX);
            }}
          />
          <label htmlFor={`auto-cashout-${slot}`} className="flex-1 text-xs text-slate-300">
            Remontée auto à
          </label>
          <input
            aria-label={`Multiplicateur de remontée automatique du panier ${slot + 1}`}
            className={inputCls + " max-w-20 py-1 text-center text-xs"}
            inputMode="decimal"
            value={autoCashoutX}
            onChange={(e) => {
              setAutoCashoutX(e.target.value);
              applyAutoCashout(autoCashoutOn, e.target.value);
            }}
          />
          <span className="text-xs text-slate-400">x</span>
        </div>
        {(() => {
          const m = Number.parseFloat(autoCashoutX.replace(",", "."));
          if (!Number.isFinite(m) || m <= 1) return null;
          return (
            <p className="mt-1 text-[10px] text-slate-500">
              Probabilité d'atteindre {formatMultiplier(m)} :{" "}
              <span className="font-mono text-cyan-300">{reachProbabilityPct(m)} %</span> —
              impossible de prédire le tour.
            </p>
          );
        })()}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              title={`${p.name} — ${reachProbabilityPct(p.multiplier)} % d'atteindre ${formatMultiplier(p.multiplier)}`}
              onClick={() => {
                onInteract();
                setAutoCashoutOn(true);
                setAutoCashoutX(p.multiplier.toFixed(2));
                applyAutoCashout(true, String(p.multiplier));
              }}
              className="rounded-md border border-cyan-400/15 bg-slate-800/70 px-2 py-1 text-[11px] text-cyan-100 transition hover:border-cyan-400/40"
            >
              {p.name} <span className="font-mono text-slate-400">{formatMultiplier(p.multiplier)}</span>
              <span className="text-emerald-300/80"> · {reachProbabilityPct(p.multiplier)}%</span>
            </button>
          ))}
          <button
            type="button"
            title="Enregistrer la cible courante comme préset"
            onClick={() => {
              const m = Number.parseFloat(autoCashoutX.replace(",", "."));
              if (Number.isFinite(m) && m >= 1.01) onSavePreset(`${Math.floor(m * 100) / 100}x`, m);
            }}
            className="rounded-md border border-cyan-400/15 bg-slate-800/40 px-2 py-1 text-[11px] text-slate-300 transition hover:border-cyan-400/40"
          >
            ＋ préset
          </button>
        </div>
      </div>

      {/* Pari automatique */}
      <details className="group rounded-lg border border-cyan-400/10 bg-slate-950/40 px-3 py-2" open={autoBetActive}>
        <summary className="cursor-pointer select-none text-xs font-semibold text-slate-300">
          Pari automatique{" "}
          {autoBetActive && (
            <span className="ml-1 rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
              actif · {slotState.autoBet?.roundsRemaining} tours restants
            </span>
          )}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label htmlFor={`autobet-rounds-${slot}`} className="flex-1 text-xs text-slate-400">
              Nombre de tours
            </label>
            <input
              id={`autobet-rounds-${slot}`}
              className={inputCls + " max-w-20 py-1 text-center text-xs"}
              inputMode="numeric"
              value={autoBetRounds}
              disabled={autoBetActive}
              onChange={(e) => setAutoBetRounds(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor={`autobet-stop-${slot}`} className="flex-1 text-xs text-slate-400">
              Stop si solde &lt;
            </label>
            <input
              id={`autobet-stop-${slot}`}
              className={inputCls + " max-w-20 py-1 text-center text-xs"}
              inputMode="decimal"
              placeholder="—"
              value={autoBetStopBelow}
              disabled={autoBetActive}
              onChange={(e) => setAutoBetStopBelow(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-cyan-400"
              checked={autoBetStopOnLoss}
              disabled={autoBetActive}
              onChange={(e) => setAutoBetStopOnLoss(e.target.checked)}
            />
            Stop après une perte
          </label>
          <button
            type="button"
            onClick={toggleAutoBet}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition active:scale-95 ${
              autoBetActive
                ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                : "bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
            }`}
          >
            {autoBetActive ? "Arrêter le pari auto" : "Lancer le pari auto"}
          </button>
        </div>
      </details>
    </section>
  );
}
