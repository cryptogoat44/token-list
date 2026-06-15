/**
 * Assemblage de l'application : scène, paniers de mise, panneaux latéraux,
 * sons, raccourcis clavier et bandeaux de jeu responsable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineEvent, RoundHistoryEntry } from "../engine/types";
import {
  generateRoundBettors,
  onlineCountForRound,
  viewBettors,
  type FakeBettor,
} from "../sim/liveBets";
import { FakeMoneyBanner, ResponsibleGamingNotice } from "./components/Banners";
import { BetPanel } from "./components/BetPanel";
import { ChatPanel } from "./components/ChatPanel";
import { FairnessPanel } from "./components/FairnessPanel";
import { HistoryBar } from "./components/HistoryBar";
import { LiveBets } from "./components/LiveBets";
import { StatsPanel } from "./components/StatsPanel";
import { StreamsPanel } from "./components/StreamsPanel";
import { diveTier, formatCredits, formatMultiplier, type DiveTier } from "./format";
import { DiveScene } from "./scene/DiveScene";
import { SoundManager } from "./sound";
import { readStoredMuted, storeMuted, useEngine } from "./useEngine";
import { useProfile } from "./useProfile";
import { ACHIEVEMENT_BY_ID } from "../engine/achievements";

type SideTab = "live" | "chat" | "stats" | "fair" | "streams";

interface Celebration {
  id: number;
  multiplier: number;
  tier: DiveTier;
  /** true = remontée gagnante du joueur ; false = gros tour (syncope haute). */
  playerWin: boolean;
}

interface Toast {
  id: number;
  text: string;
  kind: "win" | "info";
}

let toastId = 0;

/** Préférence système « réduire les animations » (accessibilité). */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** Vibration mobile discrète si disponible (et hors réduction d'animations). */
function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== "undefined" && navigator.vibrate && !prefersReducedMotion()) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}

export default function App() {
  const { engine, snapshot, onEvents, clock } = useEngine();
  const profileApi = useProfile(engine);
  const soundRef = useRef<SoundManager | null>(null);
  if (soundRef.current === null) {
    soundRef.current = new SoundManager(readStoredMuted());
  }
  const sound = soundRef.current;

  const [muted, setMuted] = useState(sound.muted);
  const [tab, setTab] = useState<SideTab>("live");
  const [betCents0, setBetCents0] = useState(1_000);
  const [betCents1, setBetCents1] = useState(1_000);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedRound, setSelectedRound] = useState<RoundHistoryEntry | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Déclenche une célébration plein écran pour un gros multiplicateur.
  const celebrate = useCallback((multiplier: number, playerWin: boolean) => {
    const tier = diveTier(multiplier);
    if (!tier.celebrate) return;
    setCelebration({ id: ++toastId, multiplier, tier, playerWin });
    if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    celebrationTimer.current = setTimeout(() => setCelebration(null), 4200);
  }, []);

  // ── Faux joueurs en direct (déterministes par tour : salle partagée) ──────
  // Dérivés de l'identifiant du tour : tous les joueurs du lobby voient
  // exactement la même salle au même moment.
  const roundId = snapshot.round.roundId;
  const bettors = useMemo<FakeBettor[]>(() => generateRoundBettors(roundId), [roundId]);
  const onlineCount = useMemo(() => onlineCountForRound(roundId), [roundId]);

  const pushToast = useCallback((text: string, kind: Toast["kind"]) => {
    const id = ++toastId;
    setToasts((list) => [...list.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3500);
  }, []);

  // Toasts de progression : succès débloqués et records personnels battus.
  useEffect(() => {
    return profileApi.onProfileEvents(({ newAchievements, newRecord }) => {
      if (newRecord) pushToast("Nouveau record personnel ! 🏆", "win");
      newAchievements.forEach((id) => {
        const a = ACHIEVEMENT_BY_ID[id];
        if (a) pushToast(`Succès débloqué : ${a.icon} ${a.name}`, "win");
      });
    });
  }, [profileApi, pushToast]);

  // ── Réactions aux événements du moteur (sons, toasts, annonce ARIA) ──────
  useEffect(() => {
    return onEvents((events: EngineEvent[]) => {
      for (const e of events) {
        switch (e.type) {
          case "phaseChanged":
            if (e.phase === "DIVING") {
              // Sous l'eau : on retient son souffle (diaphragme + glotte).
              sound.stopBreathing();
              sound.startBreathHold();
            }
            if (e.phase === "BETTING") {
              // Prise d'air : grandes inspirations jusqu'à la grande finale,
              // calée pour culminer juste avant le départ de la plongée.
              sound.stopBreathHold();
              const remaining = engine.getSnapshot().bettingEndsAt - clock();
              sound.startBreathing(remaining > 0 ? remaining : engine.config.bettingDurationMs);
            }
            break;
          case "betPlaced":
            sound.betPlaced();
            break;
          case "betCancelled":
            sound.betCancelled();
            break;
          case "cashedOut":
            sound.cashout();
            vibrate(diveTier(e.multiplier).celebrate ? [25, 40, 25] : 30);
            pushToast(
              `Panier ${e.slot + 1} : +${formatCredits(e.winCents)} crédits (à ${formatMultiplier(e.multiplier)})`,
              "win",
            );
            setAnnouncement(
              `Remontée réussie du panier ${e.slot + 1} à ${formatMultiplier(e.multiplier)}, gain ${formatCredits(e.winCents)} crédits`,
            );
            // Le joueur encaisse gros : on fête sa remontée.
            if (diveTier(e.multiplier).celebrate) {
              sound.bigWin();
              celebrate(e.multiplier, true);
            }
            break;
          case "crashed":
            sound.stopBreathHold();
            sound.stopBreathing();
            sound.crash();
            setAnnouncement(`Syncope à ${formatMultiplier(e.crashPoint)}`);
            // Tour à multiplicateur « de dingue » : on le met en scène même si
            // le joueur n'était pas dessus, pour donner envie de retenter.
            if (diveTier(e.crashPoint).celebrate) {
              sound.bigWin();
              celebrate(e.crashPoint, false);
            }
            break;
          case "creditsToppedUp":
            sound.betPlaced();
            pushToast(
              `+${formatCredits(e.amountCents)} crédits fictifs rechargés 🪙`,
              "win",
            );
            break;
          case "betLost":
            pushToast(`Panier ${e.slot + 1} : mise perdue (−${formatCredits(e.betCents)})`, "info");
            break;
          case "autoBetStopped":
            pushToast(
              `Pari auto du panier ${e.slot + 1} arrêté${
                e.reason === "finished"
                  ? " (tours épuisés)"
                  : e.reason === "balance"
                    ? " (solde insuffisant)"
                    : e.reason === "stopCondition"
                      ? " (seuil de solde atteint)"
                      : e.reason === "loss"
                        ? " (perte subie)"
                        : ""
              }`,
              "info",
            );
            break;
          default:
            break;
        }
      }
    });
  }, [onEvents, pushToast, sound, celebrate, engine, clock]);

  // La tension du souffle retenu suit la profondeur (multiplicateur).
  useEffect(() => {
    if (snapshot.phase === "DIVING") sound.updateBreathHold(snapshot.multiplier);
  }, [snapshot.phase, snapshot.multiplier, sound]);

  const unlockAudio = useCallback(() => sound.ensure(), [sound]);

  const toggleMute = useCallback(() => {
    sound.ensure();
    const next = !sound.muted;
    sound.setMuted(next);
    storeMuted(next);
    setMuted(next);
  }, [sound]);

  // ── Action principale d'un panier (partagée bouton / clavier) ────────────
  const slotAction = useCallback(
    (slot: 0 | 1) => {
      unlockAudio();
      const state = engine.getSnapshot();
      const slotState = state.slots[slot];
      if (state.phase === "BETTING" && slotState.status === "idle") {
        engine.placeBet(slot, slot === 0 ? betCents0 : betCents1);
      } else if (state.phase === "BETTING" && slotState.status === "placed") {
        engine.cancelBet(slot);
      } else if (state.phase === "DIVING" && slotState.status === "playing") {
        engine.cashOut(slot, clock());
      }
    },
    [engine, betCents0, betCents1, unlockAudio, clock],
  );

  // ── Raccourcis clavier : Espace/1 → panier 1, 2 → panier 2, M → muet ─────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (e.code === "Space" || e.key === "1") {
        // Un bouton focalisé gère déjà Espace nativement : ne pas doubler.
        if (e.code === "Space" && tag === "BUTTON") return;
        e.preventDefault();
        slotAction(0);
      } else if (e.key === "2") {
        e.preventDefault();
        slotAction(1);
      } else if (e.key.toLowerCase() === "m") {
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slotAction, toggleMute]);

  // ── Vue des faux joueurs selon l'état du tour ─────────────────────────────
  const crashed = snapshot.phase === "CRASH" || snapshot.phase === "RESULT";
  const liveBettorViews = useMemo(
    () =>
      viewBettors(
        bettors,
        snapshot.phase === "BETTING" ? 0 : snapshot.multiplier,
        crashed,
      ),
    [bettors, snapshot.phase, snapshot.multiplier, crashed],
  );

  const handleSelectRound = useCallback((round: RoundHistoryEntry) => {
    setSelectedRound(round);
    setTab("fair");
  }, []);

  const tabButton = (id: SideTab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
        tab === id
          ? "bg-cyan-500/20 text-cyan-200"
          : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" onPointerDown={unlockAudio}>
      <FakeMoneyBanner />

      {/* Annonces pour lecteurs d'écran */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:px-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <span aria-hidden="true">🤿</span>
            <span className="bg-gradient-to-r from-cyan-300 to-blue-500 bg-clip-text text-transparent">
              Deep Diver
            </span>
            <span className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
              démo
            </span>
            <span
              className="hidden items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 sm:inline-flex"
              title="Tous les joueurs partagent la même partie, au même instant."
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Lobby partagé
            </span>
          </h1>
          <div className="flex items-center gap-2">
            <div
              className="rounded-xl border border-cyan-400/20 bg-slate-900/80 px-4 py-1.5 text-right"
              aria-label={`Solde : ${formatCredits(snapshot.balanceCents)} crédits fictifs`}
            >
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Solde fictif</p>
              <p className="font-mono text-lg font-bold leading-tight text-cyan-100">
                {formatCredits(snapshot.balanceCents)} <span className="text-xs text-slate-400">crédits</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                engine.topUp();
              }}
              aria-label={`Recharger ${formatCredits(engine.config.topUpCents)} crédits fictifs`}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-sm font-bold text-emerald-200 transition hover:bg-emerald-500/25 active:scale-95"
            >
              <span aria-hidden="true">🪙</span>
              <span className="hidden sm:inline">Recharger</span>
              <span className="font-mono">+{formatCredits(engine.config.topUpCents)}</span>
            </button>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "Activer le son" : "Couper le son"}
              aria-pressed={muted}
              className="rounded-xl border border-cyan-400/20 bg-slate-900/80 p-2.5 text-lg transition hover:bg-slate-800 active:scale-95"
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        </header>

        <HistoryBar history={snapshot.history} onSelectRound={handleSelectRound} />

        <main className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="relative">
              <DiveScene engine={engine} snapshot={snapshot} />
              {/* Toasts au-dessus de la scène */}
              <div className="pointer-events-none absolute right-3 top-3 flex w-64 flex-col gap-2">
                {toasts.map((t) => (
                  <p
                    key={t.id}
                    className={`animate-[fadeSlide_0.25s_ease-out] rounded-lg border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur ${
                      t.kind === "win"
                        ? "border-emerald-400/40 bg-emerald-950/80 text-emerald-200"
                        : "border-slate-500/40 bg-slate-900/85 text-slate-300"
                    }`}
                  >
                    {t.text}
                  </p>
                ))}
              </div>

              {/* Célébration plein écran d'un gros multiplicateur */}
              {celebration && (
                <div
                  key={celebration.id}
                  className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                  role="status"
                >
                  <div className="animate-[celebPop_0.4s_ease-out] rounded-2xl border border-amber-300/40 bg-slate-950/70 px-6 py-4 text-center shadow-[0_0_60px_-10px_rgba(251,191,36,0.7)] backdrop-blur-sm">
                    <p className="text-4xl">{celebration.tier.emoji}</p>
                    <p className="mt-1 bg-gradient-to-r from-amber-200 via-yellow-100 to-fuchsia-300 bg-clip-text font-mono text-5xl font-black text-transparent drop-shadow">
                      {formatMultiplier(celebration.multiplier)}
                    </p>
                    <p className="mt-1 text-sm font-bold uppercase tracking-[0.2em] text-amber-200">
                      {celebration.tier.label}
                    </p>
                    <p className="mt-0.5 text-xs text-cyan-200/80">
                      {celebration.playerWin
                        ? "Remontée spectaculaire ! 🎉"
                        : "Quelle descente ! La prochaine est pour vous ?"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <BetPanel
                engine={engine}
                snapshot={snapshot}
                slot={0}
                betCents={betCents0}
                onBetCentsChange={setBetCents0}
                onInteract={unlockAudio}
                clock={clock}
              />
              <BetPanel
                engine={engine}
                snapshot={snapshot}
                slot={1}
                betCents={betCents1}
                onBetCentsChange={setBetCents1}
                onInteract={unlockAudio}
                clock={clock}
              />
            </div>
          </div>

          <aside className="flex max-h-[860px] min-h-[420px] flex-col rounded-2xl border border-cyan-400/10 bg-slate-900/60 p-3 backdrop-blur">
            <div role="tablist" aria-label="Panneaux d'information" className="mb-3 grid grid-cols-5 gap-1 rounded-xl bg-slate-950/60 p-1">
              {tabButton("live", "Direct")}
              {tabButton("chat", "Chat")}
              {tabButton("streams", "Lives")}
              {tabButton("stats", "Stats")}
              {tabButton("fair", "Équité")}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
              {tab === "live" && <LiveBets bettors={liveBettorViews} onlineCount={onlineCount} />}
              {tab === "chat" && (
                <ChatPanel roundId={roundId} lastCrashPoint={snapshot.lastCrashPoint} />
              )}
              {tab === "streams" && <StreamsPanel />}
              {tab === "stats" && (
                <StatsPanel
                  stats={snapshot.stats}
                  balanceCents={snapshot.balanceCents}
                  onReset={() => {
                    const result = engine.resetWallet();
                    pushToast(
                      result.ok
                        ? "Solde et statistiques réinitialisés."
                        : "Impossible pendant une plongée avec mise engagée.",
                      "info",
                    );
                  }}
                />
              )}
              {tab === "fair" && (
                <FairnessPanel engine={engine} snapshot={snapshot} selectedRound={selectedRound} shared />
              )}
            </div>
          </aside>
        </main>

        <ResponsibleGamingNotice />

        <footer className="pb-4 text-center text-[11px] text-slate-600">
          Deep Diver — mécanique de crash game « provably fair » re-thématisée apnée. Clavier :{" "}
          <kbd className="rounded bg-slate-800 px-1">Espace</kbd>/<kbd className="rounded bg-slate-800 px-1">1</kbd>{" "}
          miser ou remonter (panier 1), <kbd className="rounded bg-slate-800 px-1">2</kbd> panier 2,{" "}
          <kbd className="rounded bg-slate-800 px-1">M</kbd> son.
        </footer>
      </div>
    </div>
  );
}
